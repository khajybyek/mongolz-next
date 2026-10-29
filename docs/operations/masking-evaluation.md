# Offline masking evaluation

Use this check before claiming that the live and playback mask protects faces
in real CCTV scenes. The existing crop benchmark compares visual distortion on
already found faces; this evaluation asks whether **every annotated face in a
full frame actually received a mask**. It calls the same `FaceMasker.mask()`
used by the service. It needs no camera, Supabase connection, or API token.

## Prepare consented local media

Use footage whose subjects and owner have authorized this evaluation. Keep
clips, frames, annotations and reports in a private directory outside the
repository. Do not commit them. The tool reads only local files below the
manifest directory; absolute paths, URLs, and symlinks escaping that directory
are rejected. It never uploads media, writes masked frames, or prints source
paths or face coordinates. An InsightFace run requires an **already installed**
local `buffalo_l` model pack; it refuses to download one.

Make a UTF-8 JSON manifest beside the media:

```json
{
  "schema_version": 1,
  "consent_confirmed": true,
  "assets": [
    {
      "id": "lobby_backlit",
      "type": "video",
      "path": "clips/lobby.mp4",
      "frames": [
        {"frame": 0, "faces": [[100, 45, 150, 110]]},
        {"frame": 15, "faces": [[111, 44, 160, 109], [360, 95, 402, 155]]}
      ]
    },
    {
      "id": "gate_profile",
      "type": "image",
      "path": "frames/gate.png",
      "faces": [[250, 82, 299, 146]]
    }
  ]
}
```

Boxes use integer `[x1, y1, x2, y2]` pixels in the **decoded original** frame,
with the bottom/right edge exclusive. Video frame numbers start at 0. Annotate
**all visible faces** in each selected frame, including profiles and small or
partially occluded faces; `faces: []` is valid for a selected frame with none.
Include day/night, backlight, different distances, camera angles, movement,
motion blur, crowding and entry/exit. Keep an independent review of the boxes
so an omitted face does not look like a successful result. In a video the tool
processes every frame from 0 to the last annotation in order, preserving the
masker's detector cadence and persistence cache; it scores only annotated
frames. Each image uses a fresh masker.

## Run

From the repository root, with `ml-service/requirements.txt` installed:

```bash
ml-service/venv/bin/python ml-service/eval/evaluate_masking.py \
  --manifest /private/local-eval/manifest.json \
  --detector haar \
  --report /private/local-eval/haar-report.json

ml-service/venv/bin/python ml-service/eval/evaluate_masking.py \
  --manifest /private/local-eval/manifest.json \
  --detector insight --privacy-mode standard \
  --report /private/local-eval/standard-report.json

ml-service/venv/bin/python ml-service/eval/evaluate_masking.py \
  --manifest /private/local-eval/manifest.json \
  --detector insight --privacy-mode private \
  --report /private/local-eval/private-report.json
```

`haar` is the dependency-light baseline, **not** the normal production
detector combination. `insight` uses the same local model pack, CPU provider,
320×320 detection size and strict full-frame blackout on detector failure as
live capture. Standard mode
uses full detection/recognition; private mode uses detector-only boxes and the
strongest tier, without embeddings. `--model-root` changes the local model
root if needed. Use identical media for all modes. Model initialization and
video decoding are excluded from per-frame masking latency; the timing includes
face detection, cache updates and masking. It is a local-machine measurement,
not production throughput or a real-camera stability test.

## Read the report

The JSON report contains aggregate and per-asset counts, full-black and
detector-unavailable frame counts, and frame latency
(mean/p95/max milliseconds), plus an `asset_id`, frame and face index for each
suspected exposure. It contains no pixels, embeddings, source paths or face
coordinates. A face is flagged if less than 90% of its annotated rectangle
falls inside the padded mask footprint, **or** fewer than 10% of its pixels
change (difference greater than two levels in any color channel). Adjust via
`--min-coverage` and `--min-altered-fraction` and record the thresholds with
results. Fully blacked-out frames are counted separately and never flagged
as exposures, because no original pixels leave that frame. A naturally black
input may also count as full-black; use `detector_unavailable_frames` to see
detector outages. A nonzero
suspected-exposure count exits with code 2; invalid input
or decoding exits with code 1.

Coverage tests placement; changed fraction and mean absolute pixel difference
are proxies for application/strength. Neither proves that identity is
unrecoverable, and uniform areas can have very little pixel change despite a
placed mask. **Review every flagged frame locally**, fix annotation mistakes,
then investigate detector misses, drift and mask strength. An unflagged run is
not a privacy guarantee: unannotated faces, temporal artifacts, and identity
recovery require separate review. For operational acceptance, follow this
offline evaluation with a consented real-camera capture and 24-hour soak per
[`capture-recovery.md`](capture-recovery.md).
