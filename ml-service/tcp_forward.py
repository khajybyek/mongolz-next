"""
TCP forwarder via SOCKS5 — Tailscale userspace networking bridge.

Railway-ийн container нь TUN device-гүй учир Tailscale-ийг userspace
networking mode-д ажиллуулдаг. Тэр mode-д ердийн TCP socket нь tailnet
IP-руу шууд хүрч чаддаггүй — Tailscale-ийн SOCKS5 proxy (:1055)-аар
дамжих ёстой.

FFmpeg / OpenCV нь SOCKS5 native дэмжихгүй учир, бид localhost-д TCP
listener асааж, түүн рүү ирсэн connection бүрийг PySocks-аар Tailscale
SOCKS5-руу proxying хийнэ.

CAMERA_TAILNET_FWD env-ийн форматhybnyh:

    "5554:192.168.0.15:554"           — нэг forwarding
    "5554:192.168.0.15:554;5555:..."  — олон forwarding (semicolon-аар хуваана)

Жишээ ашиглалт:
    rtsp://{user}:{password}@127.0.0.1:5554/...   ← Vercel /cameras-д

Readiness (``tunnel_status``)
-----------------------------
Энэ модуль нь script (forwarder process) төдийгүй main.py-аас import
хийгддэг: ``GET /`` дээр tunnel-ийн бодит байдлыг харуулна. Tailnet
доош байхад ML нь "ok" гэж хариулаад камер огт хүрэхгүй байх нь
операторт харагдахгүй байсан (audit). Тиймээс:

  * tailnet хүсэгдсэн эсэх (TAILSCALE_AUTHKEY)
  * ``tailscale status`` backend ажиллаж буй эсэх
  * forwarder listener + SOCKS5-аар камерын порт хүлээж авах эсэх

гэсэн 3 зүйлийг хэмжиж, богино шалтгаантайгаар буцаана. Хариунд
хэзээ ч URL / host / key орохгүй.
"""

from __future__ import annotations

import errno
import json
import logging
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Iterable, NamedTuple

try:
    import socks  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - PySocks is installed in the image
    # NOT fatal at import time: main.py imports this module for the readiness
    # probe, and the API must still boot (and say why the tunnel is dead)
    # when PySocks is missing. The script path exits in main() instead.
    socks = None  # type: ignore[assignment]

log = logging.getLogger("tcp_forward")


class Forward(NamedTuple):
    local_port: int
    remote_host: str
    remote_port: int


def parse_forwards(spec: str) -> list[Forward]:
    """
    "5554:192.168.0.15:554;5555:10.0.0.5:80" → [Forward(5554, ...), Forward(5555, ...)]
    """
    out: list[Forward] = []
    for piece in spec.split(";"):
        piece = piece.strip()
        if not piece:
            continue
        parts = piece.split(":")
        if len(parts) != 3:
            log.warning("Invalid forward spec %r (expected PORT:HOST:PORT)", piece)
            continue
        try:
            local_p = int(parts[0])
            remote_p = int(parts[2])
        except ValueError:
            log.warning("Invalid port numbers in %r", piece)
            continue
        out.append(Forward(local_p, parts[1], remote_p))
    return out


def pipe(src: socket.socket, dst: socket.socket, tag: str) -> None:
    """Half-duplex copy until EOF."""
    try:
        while True:
            data = src.recv(8192)
            if not data:
                break
            dst.sendall(data)
    except OSError as e:
        log.debug("pipe %s closed: %s", tag, e)
    finally:
        for s in (src, dst):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                s.close()
            except OSError:
                pass


def handle_client(client: socket.socket, fwd: Forward, proxy_host: str, proxy_port: int) -> None:
    """Open SOCKS5 connection to remote, then full-duplex pipe."""
    if socks is None:  # pragma: no cover - guarded again in main()
        log.error("PySocks not installed — cannot proxy")
        client.close()
        return
    upstream = socks.socksocket()
    upstream.set_proxy(socks.SOCKS5, proxy_host, proxy_port)
    try:
        upstream.connect((fwd.remote_host, fwd.remote_port))
    except (socks.GeneralProxyError, socks.ProxyConnectionError, OSError) as e:
        # WARN, not ERROR — the local TCP accept already succeeded; this is an
        # upstream/runtime condition (tailnet subnet router offline, target
        # camera unreachable, transient network blip). ERROR-level here drives
        # alerts on every container restart because docker-entrypoint.sh
        # probes the forwarder port with `echo > /dev/tcp/127.0.0.1/$PORT`,
        # which lights up this exact path even when nothing is wrong with
        # the code or the deploy.
        log.warning("SOCKS5 → %s:%d failed: %s", fwd.remote_host, fwd.remote_port, e)
        client.close()
        return

    log.info("Forward open: client → %s:%d (via SOCKS5)", fwd.remote_host, fwd.remote_port)

    # Full-duplex
    t1 = threading.Thread(target=pipe, args=(client, upstream, "c→u"), daemon=True)
    t2 = threading.Thread(target=pipe, args=(upstream, client, "u→c"), daemon=True)
    t1.start()
    t2.start()
    t1.join()
    t2.join()
    log.debug("Forward closed: %s:%d", fwd.remote_host, fwd.remote_port)


def run_listener(fwd: Forward, proxy_host: str, proxy_port: int) -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("127.0.0.1", fwd.local_port))
    except OSError as e:
        log.error("Bind 127.0.0.1:%d failed: %s", fwd.local_port, e)
        return
    sock.listen(64)
    log.info(
        "Listening 127.0.0.1:%d → SOCKS5(%s:%d) → %s:%d",
        fwd.local_port, proxy_host, proxy_port, fwd.remote_host, fwd.remote_port,
    )

    while True:
        try:
            client, addr = sock.accept()
        except OSError as e:
            log.warning("accept() failed: %s", e)
            continue
        threading.Thread(
            target=handle_client,
            args=(client, fwd, proxy_host, proxy_port),
            daemon=True,
        ).start()


# ── Readiness probe (GET / → "tunnel") ──────────────────────────────────
#
# Never returns a host, port, URL or key: the health endpoint is public.

# The entrypoint drops the reason `tailscale up` failed here (key=value).
BOOT_STATUS_FILE = os.environ.get("TS_STATUS_FILE", "/tmp/mongolz-tailnet.status")  # noqa: S108 — written by docker-entrypoint.sh
_BOOT_STATUS_MAX_BYTES = 4096
_REASON_MAX_CHARS = 200
_SAFE_TEXT_RE = re.compile(r"[^\x20-\x7e]")
_BACKEND_STATE_RE = re.compile(r"^[A-Za-z]{1,32}$")

# Health is polled by the Docker healthcheck (30 s), the site and the uptime
# cron. Each measurement opens one real TCP connection to the camera through
# the tunnel, so keep it to about one per minute.
TUNNEL_CACHE_TTL_SEC = 60.0
_BACKEND_TIMEOUT_SEC = 3.0
_CONNECT_TIMEOUT_SEC = 2.5

_tunnel_cache: dict | None = None
_tunnel_cache_at = 0.0
_tunnel_lock = threading.Lock()


def _short(text: str | None) -> str:
    """Printable, bounded, single-line — never a raw command output."""
    if not text:
        return ""
    return _SAFE_TEXT_RE.sub(" ", str(text)).strip()[:_REASON_MAX_CHARS]


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def tailnet_requested() -> bool:
    """A tailnet was asked for at boot (the key value is never read here)."""
    return bool(os.environ.get("TAILSCALE_AUTHKEY", "").strip())


def read_boot_status(path: str | None = None) -> dict[str, str]:
    """The entrypoint's `key=value` note about tailscaled / `tailscale up`.

    Missing file → empty dict (older image, or the block never ran). Values
    are sanitised: the file is written by our own entrypoint, but it feeds a
    public endpoint.
    """
    target = path or BOOT_STATUS_FILE
    try:
        with open(target, "r", encoding="utf-8", errors="replace") as fh:
            raw = fh.read(_BOOT_STATUS_MAX_BYTES)
    except OSError:
        return {}
    out: dict[str, str] = {}
    for line in raw.splitlines():
        key, sep, value = line.partition("=")
        key = key.strip().lower()
        if sep and key.isidentifier():
            out[key] = _short(value)
    return out


def _tailscale_socket() -> str | None:
    sock = os.path.join(os.environ.get("TS_STATE_DIR", "/tmp/tailscale-state"), "tailscaled.sock")  # noqa: S108 — set by docker-entrypoint.sh
    return sock if os.path.exists(sock) else None


def probe_backend(timeout: float = _BACKEND_TIMEOUT_SEC) -> tuple[bool, str | None, str]:
    """`tailscale status --json` → (running, BackendState, reason).

    Only BackendState is read out of the JSON: the rest of that document is
    the tailnet's device list (names, IPs) and, when logged out, an auth URL.
    """
    binary = shutil.which("tailscale")
    if not binary:
        return False, None, "tailscale binary not found"
    cmd = [binary]
    sock = _tailscale_socket()
    if sock:
        cmd += ["--socket", sock]
    cmd += ["status", "--json"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)  # noqa: S603 — resolved tailscale binary, fixed argv
    except subprocess.TimeoutExpired:
        return False, None, "tailscale status timed out"
    except OSError as e:
        return False, None, f"tailscale status failed: {type(e).__name__}"

    state: str | None = None
    try:
        payload = json.loads(proc.stdout or "{}")
        raw_state = payload.get("BackendState")
        if isinstance(raw_state, str) and _BACKEND_STATE_RE.match(raw_state):
            state = raw_state
    except (ValueError, AttributeError):
        state = None

    if state is None:
        # No parseable state: fall back to the exit code, like the entrypoint.
        if proc.returncode == 0:
            return True, None, "tailnet up (state unreported)"
        return False, None, f"tailscale status exited {proc.returncode}"
    if state == "Running":
        return True, state, "tailnet up"
    return False, state, f"tailnet backend {state}"


def probe_listener(port: int) -> bool:
    """Is the local forwarder listening on 127.0.0.1:<port>?

    A bind attempt, NOT a connect: connecting makes the forwarder open a
    SOCKS5 connection to the camera for every health poll — a warning line
    per poll while the tailnet is down (the healthcheck runs every 30 s), and
    a real RTSP TCP open when it is up. Binding costs nothing and answers the
    same question: a listening socket makes bind fail with EADDRINUSE.

    Note this says nothing about the tunnel — the listener accepts even when
    the tailnet is down, which is why probe_socks_target exists. EACCES
    (privileged port, so we cannot tell) is reported as listening: crying
    wolf about the forwarder would bury the real reason.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(("127.0.0.1", port))
        return False  # bound → nothing was listening
    except OSError as e:
        return e.errno in (errno.EADDRINUSE, errno.EACCES)
    finally:
        sock.close()


def probe_socks_target(fwd: Forward, timeout: float = _CONNECT_TIMEOUT_SEC) -> tuple[bool, str]:
    """Open (and immediately close) a SOCKS5 connection to the forward target.

    This is the only check that proves the camera side of the tunnel is
    actually reachable — the tailnet subnet router being offline shows up
    here as a refusal/timeout while everything local looks healthy.
    """
    if socks is None:
        return False, "PySocks not installed"
    proxy_host = os.environ.get("TAILSCALE_SOCKS_HOST", "127.0.0.1")
    try:
        proxy_port = int(os.environ.get("TAILSCALE_SOCKS_PORT", "1055"))
    except ValueError:
        return False, "invalid socks port config"
    sock = socks.socksocket()
    sock.set_proxy(socks.SOCKS5, proxy_host, proxy_port)
    sock.settimeout(timeout)
    try:
        sock.connect((fwd.remote_host, fwd.remote_port))
        return True, "camera port reachable via tailnet"
    except socket.timeout:
        return False, "socks5 connect timed out"
    except Exception as e:  # noqa: BLE001 — PySocks raises its own hierarchy
        # Type only: the message embeds the target host/port.
        return False, f"socks5 connect failed: {type(e).__name__}"
    finally:
        try:
            sock.close()
        except OSError:
            pass


def _probe_tunnel() -> dict:
    """One full measurement. Callers use tunnel_status() (cached)."""
    boot = read_boot_status()
    requested = tailnet_requested()
    checked_at = _iso_now()
    if not requested:
        return {
            "requested": False,
            "state": "disabled",
            "backend_ok": None,
            "backend_state": None,
            "forwarder_ok": None,
            "target_ok": None,
            "reason": "tailnet disabled (no auth key)",
            "boot": boot.get("reason") or None,
            "checked_at": checked_at,
        }

    backend_ok, backend_state, reason = probe_backend()
    forwards = parse_forwards(os.environ.get("CAMERA_TAILNET_FWD", "").strip())
    forwarder_ok: bool | None = None
    target_ok: bool | None = None
    if forwards:
        # One camera per deployment today: the first forward is the one the
        # registered camera URL points at.
        fwd = forwards[0]
        forwarder_ok = probe_listener(fwd.local_port)
        # A dead backend is the root cause — keep its reason and report the
        # local listener honestly rather than blaming the forwarder.
        if backend_ok:
            if not forwarder_ok:
                reason = "forwarder listener not accepting"
            else:
                target_ok, reason = probe_socks_target(fwd)

    if not backend_ok:
        state = "down"
        # The boot note explains *why* it never came up (auth key rejected,
        # tailscaled crash) — keep the live reason, surface both.
        if boot.get("state") == "up-failed" and boot.get("reason"):
            reason = f"{reason} ({boot['reason']})"
    elif forwarder_ok is False or target_ok is False:
        state = "degraded"
    else:
        state = "ok"

    return {
        "requested": True,
        "state": state,
        "backend_ok": backend_ok,
        "backend_state": backend_state,
        "forwarder_ok": forwarder_ok,
        "target_ok": target_ok,
        "reason": _short(reason),
        "boot": boot.get("reason") or None,
        "checked_at": checked_at,
    }


def _unknown_status(reason: str) -> dict:
    return {
        "requested": tailnet_requested(),
        "state": "unknown",
        "backend_ok": None,
        "backend_state": None,
        "forwarder_ok": None,
        "target_ok": None,
        "reason": reason,
        "boot": read_boot_status().get("reason") or None,
        "checked_at": _iso_now(),
    }


def _refresh_tunnel(ttl: float = TUNNEL_CACHE_TTL_SEC, *, force: bool = False) -> dict:
    """Measure (single-flighted) and cache. Blocks for the probe's duration."""
    global _tunnel_cache, _tunnel_cache_at
    with _tunnel_lock:
        if not force and _tunnel_cache is not None and time.monotonic() - _tunnel_cache_at < ttl:
            return _tunnel_cache  # another thread just measured
        try:
            value = _probe_tunnel()
        except Exception as e:  # noqa: BLE001 — health must answer regardless
            log.warning("tunnel probe failed: %s", type(e).__name__)
            value = _unknown_status(f"probe error: {type(e).__name__}")
        _tunnel_cache, _tunnel_cache_at = value, time.monotonic()
        return value


def _schedule_refresh() -> None:
    """Kick off a probe off-request. Skipped while one is already running."""
    if _tunnel_lock.locked():
        return
    threading.Thread(target=_refresh_tunnel, name="tunnel-probe", daemon=True).start()


def tunnel_status(ttl: float = TUNNEL_CACHE_TTL_SEC, *, force: bool = False) -> dict:
    """Tunnel readiness for the health endpoint — never blocks the request.

    The probe opens real TCP connections (tailscale status, the forwarder
    listener, the camera port through SOCKS5), which can take seconds when
    the tailnet is down — and Docker's HEALTHCHECK allows 5 s per poll, so a
    blocking probe would restart the container it is diagnosing. The measured
    value is therefore cached and refreshed on a background thread; callers
    get the previous answer (or an explicit "measuring" state on the very
    first poll after boot). ``force=True`` measures synchronously.
    """
    if force:
        return _refresh_tunnel(ttl, force=True)
    cached = _tunnel_cache
    if cached is not None and time.monotonic() - _tunnel_cache_at < ttl:
        return cached
    _schedule_refresh()
    return cached if cached is not None else _unknown_status("measuring")


def main(argv: Iterable[str]) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [tcp_forward] %(levelname)s %(message)s",
    )
    if socks is None:
        print("FATAL: PySocks not installed. Add 'PySocks' to requirements.txt", file=sys.stderr)
        return 2

    spec = os.environ.get("CAMERA_TAILNET_FWD", "").strip()
    if not spec:
        log.info("CAMERA_TAILNET_FWD not set — nothing to forward, exiting.")
        return 0

    forwards = parse_forwards(spec)
    if not forwards:
        log.error("CAMERA_TAILNET_FWD parsed empty: %r", spec)
        return 1

    proxy_host = os.environ.get("TAILSCALE_SOCKS_HOST", "127.0.0.1")
    proxy_port = int(os.environ.get("TAILSCALE_SOCKS_PORT", "1055"))

    log.info("Starting %d forwarder(s) via SOCKS5 %s:%d", len(forwards), proxy_host, proxy_port)

    threads: list[threading.Thread] = []
    for fwd in forwards:
        t = threading.Thread(
            target=run_listener,
            args=(fwd, proxy_host, proxy_port),
            daemon=False,  # Main thread waits on these
            name=f"fwd-{fwd.local_port}",
        )
        t.start()
        threads.append(t)

    for t in threads:
        t.join()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
