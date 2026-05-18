#!/bin/bash
# Container entrypoint — starts Tailscale (userspace) + TCP forwarder + FastAPI.
#
# Why Tailscale here:
#   Railway's containers have no TUN device, so we run tailscaled in
#   --tun=userspace-networking mode. This exposes a SOCKS5 listener on :1055
#   through which the container can reach tailnet IPs (incl. subnet-routed
#   192.168.0.0/24 via the home laptop). FFmpeg / OpenCV don't speak SOCKS5,
#   so we spin up a localhost TCP forwarder (tcp_forward.py) that bridges
#   localhost:5554 → SOCKS5 → 192.168.0.15:554.
#
# Required env vars to enable the live RTSP path:
#   TAILSCALE_AUTHKEY        — reusable + ephemeral key from Tailscale admin
#   CAMERA_TAILNET_FWD       — e.g. "5554:192.168.0.15:554"
#
# Optional:
#   TS_HOSTNAME              — default "mongolz-ml"
#   TS_ACCEPT_ROUTES         — default true
set -euo pipefail

# ── 1. Tailscale (only if auth key present — backwards-compatible) ──────
if [ -n "${TAILSCALE_AUTHKEY:-}" ]; then
  STATE_DIR="${TS_STATE_DIR:-/tmp/tailscale-state}"
  mkdir -p "$STATE_DIR"

  echo "[entrypoint] Starting tailscaled (userspace networking)…"
  tailscaled \
    --tun=userspace-networking \
    --state="$STATE_DIR/state.tsstate" \
    --socket="$STATE_DIR/tailscaled.sock" \
    --socks5-server=127.0.0.1:1055 \
    --outbound-http-proxy-listen=127.0.0.1:1056 \
    > /tmp/tailscaled.log 2>&1 &
  TAILSCALED_PID=$!

  # Wait for socket
  for i in {1..30}; do
    if [ -S "$STATE_DIR/tailscaled.sock" ]; then break; fi
    sleep 0.5
  done

  echo "[entrypoint] tailscale up…"
  tailscale --socket="$STATE_DIR/tailscaled.sock" up \
    --authkey="$TAILSCALE_AUTHKEY" \
    --hostname="${TS_HOSTNAME:-mongolz-ml}" \
    --accept-routes \
    --accept-dns=false \
    --advertise-tags=tag:mongolz-ml || {
      echo "[entrypoint] tailscale up failed — continuing without tailnet"
      kill "$TAILSCALED_PID" 2>/dev/null || true
  }

  if tailscale --socket="$STATE_DIR/tailscaled.sock" status > /dev/null 2>&1; then
    echo "[entrypoint] ✓ Tailscale tailnet joined:"
    tailscale --socket="$STATE_DIR/tailscaled.sock" status | head -10
  fi

  # ── 2. TCP forwarder (only if forwarding spec defined) ────────────────
  if [ -n "${CAMERA_TAILNET_FWD:-}" ]; then
    echo "[entrypoint] Starting TCP forwarder: $CAMERA_TAILNET_FWD"
    # Avoid pipe-into-sed buffering issues — tcp_forward.py already
    # prefixes its log lines via Python logging.basicConfig(format=...).
    # Previously the pipe pid was sed's, not python's, so a python crash
    # was invisible.
    python -u /app/tcp_forward.py &
    FORWARDER_PID=$!
    sleep 2

    if kill -0 "$FORWARDER_PID" 2>/dev/null; then
      echo "[entrypoint] ✓ tcp_forward.py running (pid=$FORWARDER_PID)"
    else
      # DO NOT re-run in foreground — tcp_forward.py is a server that
      # never exits, so a fg invocation here would block exec uvicorn
      # forever and trigger Railway's healthcheck rollback.
      echo "[entrypoint] ✗ tcp_forward.py died at startup — continuing without forwarder"
    fi

    # Verify the forwarder port is actually accepting TCP. Best-effort —
    # don't fail startup if /dev/tcp isn't available or port not ready.
    FWD_PORT=$(echo "$CAMERA_TAILNET_FWD" | cut -d: -f1)
    for i in 1 2 3; do
      if (echo > /dev/tcp/127.0.0.1/$FWD_PORT) 2>/dev/null; then
        echo "[entrypoint] ✓ Port 127.0.0.1:$FWD_PORT accepts TCP"
        break
      fi
      sleep 1
    done
  fi
else
  echo "[entrypoint] TAILSCALE_AUTHKEY not set — tailnet disabled (cloud-only mode)"
fi

# ── 3. Force RTSP over TCP ──────────────────────────────────────────────
# Tailscale userspace SOCKS5 only supports TCP, but OpenCV's libffmpeg
# defaults to UDP transport for RTSP media. Pin transport=tcp so the entire
# stream flows through the SOCKS5 tunnel cleanly. Without this, RTSP DESCRIBE
# succeeds but media SETUP/PLAY produce 30s timeouts (zero frames received).
export OPENCV_FFMPEG_CAPTURE_OPTIONS="rtsp_transport;tcp|stimeout;5000000|max_delay;500000"
echo "[entrypoint] OPENCV_FFMPEG_CAPTURE_OPTIONS=$OPENCV_FFMPEG_CAPTURE_OPTIONS"

# ── 4. FastAPI ──────────────────────────────────────────────────────────
echo "[entrypoint] Launching app: $*"
exec "$@"
