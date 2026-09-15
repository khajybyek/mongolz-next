# MONGOLZ edge agent — on-prem RTSP capture container.
# Designed to run on a Raspberry Pi 5 / Intel NUC / Coral TPU host inside
# the customer's LAN. Pulls frames from the camera, gates on motion +
# face presence, then uploads JPEG-encoded frames-of-interest to the
# cloud ML service.

FROM python:3.12-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /agent

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY agent.py .

# Run as non-root to satisfy on-prem hardening checklists.
RUN useradd --create-home --shell /bin/false agent \
    && mkdir -p /var/lib/mongolz-edge \
    && chown -R agent:agent /agent /var/lib/mongolz-edge
USER agent

# Health probe checks the running loop timestamp, not only an import.
HEALTHCHECK --interval=60s --timeout=10s --start-period=10s --retries=2 \
    CMD python agent.py --healthcheck || exit 1

CMD ["python", "-u", "agent.py"]
