FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt PySocks==1.7.1

# ── Tailscale binaries (userspace networking enables LAN access from Railway) ──
ARG TS_VERSION=1.98.2
RUN curl -fsSL "https://pkgs.tailscale.com/stable/tailscale_${TS_VERSION}_amd64.tgz" \
      | tar -xz -C /tmp \
    && mv "/tmp/tailscale_${TS_VERSION}_amd64/tailscale" /usr/local/bin/tailscale \
    && mv "/tmp/tailscale_${TS_VERSION}_amd64/tailscaled" /usr/local/bin/tailscaled \
    && rm -rf "/tmp/tailscale_${TS_VERSION}_amd64"

# ── runtime ─────────────────────────────────────────────────
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HLS_DIR=/tmp/mongolz-hls

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    iproute2 \
    iptables \
    && rm -rf /var/lib/apt/lists/*

# Drop root: create a dedicated unprivileged user. Required so a remote
# code-execution in the FastAPI process cannot escalate to write /etc,
# mount filesystems, etc.
RUN useradd --create-home --shell /bin/bash --uid 10001 mongolz

# Builder's pip --user output lives under /root/.local; move it to the
# new user's home and re-point PATH so the non-root user can run it.
COPY --from=builder --chown=mongolz:mongolz /root/.local /home/mongolz/.local
ENV PATH="/home/mongolz/.local/bin:$PATH"

# Tailscale binaries from builder
COPY --from=builder /usr/local/bin/tailscale /usr/local/bin/tailscale
COPY --from=builder /usr/local/bin/tailscaled /usr/local/bin/tailscaled

COPY --chown=mongolz:mongolz . .

# Entrypoint must be readable by mongolz user and executable
RUN chmod +x /app/docker-entrypoint.sh

USER mongolz

EXPOSE 8000
ENV PORT=8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://localhost:{os.getenv(\"PORT\",\"8000\")}/').read()"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
