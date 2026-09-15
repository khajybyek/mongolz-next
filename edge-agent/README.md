# MONGOLZ Edge Agent

The edge agent runs beside a CCTV camera on a Raspberry Pi, Intel NUC, or
small Linux computer. RTSP credentials stay on that device. It samples the
local stream, gates on motion and face presence, and sends only selected JPEG
frames to the cloud ML service.

## Delivery and outage behavior

Every selected frame is AES-256-GCM encrypted into a persistent local outbox
before the first network request. Each item has a stable event UUID and SHA-256
checksum. If the internet, tunnel, Railway service, or database is unavailable,
the encrypted item remains on disk and retries with bounded exponential
backoff. The cloud event UUID is the idempotency key, so a lost response cannot
create a second event. Files leave the outbox only after a durable cloud
acknowledgement.

The agent sends a sanitized heartbeat containing device name, camera ID,
queue depth, oldest pending timestamp, delivery totals, and a short error code.
It never sends the RTSP URL, spool key, token, or queued frame bytes as status
metadata. Administrators can see this status on `/edge-agents`.

The default 2 GiB outbox is a hard bound. When it fills, new capture pauses
while delivery keeps retrying; old evidence is never silently evicted.

## Install

```bash
cd edge-agent
cp .env.example .env
uuidgen                         # use once for AGENT_ID
openssl rand -base64 32         # use once for EDGE_SPOOL_KEY
docker compose up -d --build
docker compose logs -f
```

Set `CAMERA_ID` to an enabled camera UUID from MONGOLZ and keep `AGENT_ID` and
`EDGE_SPOOL_KEY` stable across upgrades. The named Docker volume preserves the
encrypted queue across container replacements.

Stop with `docker compose down`. Do not add `-v` unless you intentionally want
to remove the pending encrypted queue.

## Pipeline

1. Open RTSP over the camera LAN.
2. Sample one frame every `SAMPLE_INTERVAL_SEC` and drain stale frames.
3. Skip frames below `MOTION_THRESHOLD`.
4. Skip frames without a Haar face candidate.
5. Encrypt the selected JPEG to the persistent outbox.
6. Deliver to `/edge/detect`; retry until the event UUID is acknowledged.
7. Send `/edge/heartbeat` every 30 seconds for device status.

InsightFace remains in the cloud. The edge device only performs the cheap Haar
gate, so a Raspberry Pi 5 can serve several cameras when each camera has its own
agent container.

## Local run

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -u agent.py
```

`python agent.py --healthcheck` returns nonzero when the main loop has not
updated its local health file for three minutes.

## Network policy

Place the device on a camera VLAN. Allow inbound RTSP only from the camera
subnet and outbound HTTPS only to the configured ML service. Rotate
`ML_SERVICE_TOKEN` and `EDGE_SPOOL_KEY` if either leaves the device.
