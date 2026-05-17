# 0007 — On-prem edge agent for >5 cameras

* **Status:** Accepted
* **Date:** 2026-05-18

## Context

One Railway dyno running InsightFace ArcFace + RetinaFace on CPU keeps
up with ~4-6 RTSP streams at 5 FPS each before frames start dropping.
Beyond that, the cloud-only architecture stops scaling:

| Constraint | Limit |
|---|---|
| ML compute / dyno | ~5 cameras @ 5 FPS |
| Vercel function invocation cost | $$ per chunk upload |
| Public-internet bandwidth | ≈ 1 Mbps continuous / camera |
| RTSP credentials | sent to cloud — surface for credential theft |

The CCTV industry standard for >5 cameras is an **on-prem appliance**
that handles the noisy work locally and only sends frames-of-interest
to the cloud. See Verkada, Eufy, Reolink, Camio, Spot AI.

## Decision

Ship `edge-agent/` — a Python container that:

1. Opens RTSP **on the LAN** (credentials never leave the site).
2. Samples one frame per `SAMPLE_INTERVAL_SEC` (default 1 s).
3. **Motion gate** — mean abs diff vs previous sample; skip if < threshold.
4. **Haar cascade face presence** — skip if zero faces.
5. **Upload survivors** as JPEG to the cloud ML service `/detect`.

Heavy InsightFace inference stays in the cloud. The agent only runs the
cheap pre-filters so a $50 Raspberry Pi 5 can keep up with 4 cameras.

Components: `edge-agent/agent.py`, `Dockerfile`, `docker-compose.yml`,
`README.md` (Verkada-pattern docs + sizing table).

## Consequences

### Positive

- ~100× bandwidth reduction (raw RTSP at 1 Mbps → ~50 kbps avg).
- ML throughput-per-dyno goes from 5 cameras to ~50 (frame budget no
  longer the bottleneck).
- Camera credentials physically isolated on customer LAN.
- Pay-once hardware ($50-200) replaces ongoing cloud-egress cost.

### Negative

- Adds an on-prem ops surface (agent uptime, container updates,
  outbound 443 firewall rule).
- Frame loss during agent crash — mitigated by `docker compose restart`
  + log shipping.
- ML service still must scale to handle bursty face-event traffic from
  N agents.

### Reversal cost

Tiny. Removing `edge-agent/` and pointing customers back at cloud-fed
RTSP returns the system to the all-cloud topology.

### Roadmap (not in scope here)

* Coral USB accelerator for on-device face detection — moves more
  compute to the edge, further reduces cloud bill.
* Live HLS preview from agent → cloud → admin browser via WebRTC TURN.
* OTA agent update via Docker Hub channels.
