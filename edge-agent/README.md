# MONGOLZ edge agent

Lightweight Python agent that runs on a small box (Raspberry Pi 5, Intel
NUC, Mini PC) inside the customer's LAN to scale the system past
~5 concurrent cloud-fed RTSP streams.

## Why an edge agent?

```
WITHOUT edge agent (current):                WITH edge agent (this):

[CCTV] ─RTSP─► [Cloud Railway ML]            [CCTV] ─RTSP LAN─► [Pi 5]
        every frame, raw bytes                                    │
                                                       ◀───frames-of-interest only───▶
                                              POST /detect → [Cloud Railway ML]
```

| Concern | Cloud-only | Edge agent |
|---|---|---|
| Public-internet bandwidth/camera | ≈ 1 Mbps continuous | ≈ 0.05 Mbps avg |
| Camera RTSP credentials | Sent to cloud | Stay on LAN |
| Cloud ML CPU/camera | full 30 FPS | only motion + face frames |
| Practical limit | ~5 cameras / Railway dyno | ~50 cameras / dyno |

The agent is the standard Verkada / Eufy / Reolink pattern: on-prem
appliance handles the noisy work, cloud only sees frames-of-interest.

## Pipeline inside the agent

1. **Open RTSP** over LAN with OpenCV `cv2.VideoCapture`.
2. **Sample** one frame every `SAMPLE_INTERVAL_SEC` (default 1.0 s); keep
   the buffer drained between samples to avoid stale frames.
3. **Motion gate** — mean absolute pixel diff (8-bit grey) against the
   previous sample. Skip if `< MOTION_THRESHOLD` (default 8.0).
4. **Face presence gate** — Haar frontal-face cascade (ships with
   OpenCV). Skip if zero detections.
5. **Upload** — POST JPEG (quality 80) + `camera_id` to the cloud ML
   service `/detect` endpoint. Exponential backoff on errors.

InsightFace ArcFace / RetinaFace stay in the cloud — the agent intentionally
runs only the cheap Haar pre-filter so a $50 Pi 5 can keep up.

## Run

```bash
cd edge-agent
cp .env.example .env       # fill in RTSP_URL, ML_SERVICE_TOKEN, CAMERA_ID
docker compose up -d
docker compose logs -f
```

Stop with `docker compose down`.

## Hardware sizing

| Box | Cameras handled (1 FPS sample, motion + face) |
|---|---|
| Raspberry Pi 5 (4 GB) | 4 |
| Intel NUC i3 | 12 |
| Mini PC i5 + Coral USB | 30 |

## Local dev (no Docker)

```bash
cd edge-agent
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
export $(cat .env | xargs)
python agent.py
```

## Security notes

* `.env` is in `.gitignore` — rotate `ML_SERVICE_TOKEN` if it ever leaks.
* Container runs as non-root user `agent`.
* The Pi/NUC should be on its own VLAN with outbound 443 to
  `*.up.railway.app` and inbound RTSP from camera subnet only.
* Frames uploaded to the cloud are **already JPEG-encoded** — raw pixel
  buffers never leave the agent.
