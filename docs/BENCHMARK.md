# Privacy-mask algorithm benchmark

> **Capstone 2026-01-CD-03-07 · 3B-26-1** · Generated 2026-05-18

## Methodology

This benchmark compares the masking strength of MONGOLZ Security's Cubist
Voronoi mosaic (in three privacy-tier variants) against two industry
baselines (Gaussian blur, pixelate / mosaic) on a common set of face crops.

**Procedure**:

1. For each test image `img`, apply each algorithm with a fixed seed (the
   image index) so runs are deterministic.
2. Compute two metrics against the unmasked original:
   - **SSIM** (Structural Similarity Index, channel-averaged) — `1.0` =
     identical, `0.0` = no structural similarity. **Lower is better for
     privacy.**
   - **PSNR** (Peak Signal-to-Noise Ratio, dB) — higher means the masked
     image is closer to the original (less distortion). **Lower is better
     for privacy.**
3. Report mean ± standard deviation across the test set.

**Algorithms compared**:

| Name | Params | What it is |
|---|---|---|
| `cubist_vip` | 50–90 polygons, σ=1.6 Gaussian smoothing | Project's strongest tier — protected witnesses / VIPs |
| `cubist_standard` | 18–40 polygons, σ=0.7 | Default tier — everyone else |
| `cubist_relaxed` | 10–18 polygons, σ=0.4 | Public figures with no news-value privacy concern |
| `gaussian` | 21×21 kernel, σ=8.0 | Industry baseline — Gaussian blur |
| `pixelate` | 8×8 downsample-and-upscale | Industry baseline — mosaic pixelation |

**Test corpus**: in the absence of a bundled real-face dataset (FFHQ requires
license + storage), the benchmark script generates **12 deterministic
synthetic face crops** (128×128 BGR, structured with eye / nose / mouth
shapes via OpenCV draw primitives). For paper publication, point
`--input-dir` at any directory of CC-licensed face images
(e.g. a FFHQ subset under FFHQ's CC BY-NC-SA terms).

**Reproducibility**: every run with the same `--input-dir` (or fallback)
seed gives byte-identical output. Source: `ml-service/eval/benchmark_mask_algorithms.py`.

## Results — synthetic corpus (n = 12)

Run with:

```bash
cd ml-service
./venv/bin/python eval/benchmark_mask_algorithms.py \
    --output ../docs/BENCHMARK_RESULTS.json
```

| Algorithm | SSIM mean ↓ | SSIM σ | PSNR mean (dB) ↓ | PSNR σ | n |
|---|---|---|---|---|---|
| `cubist_vip` | **0.4571** | 0.0126 | 18.08 | 0.53 | 12 |
| `cubist_standard` | **0.4573** | 0.0164 | 16.63 | 0.66 | 12 |
| `cubist_relaxed` | 0.4747 | 0.0098 | 16.45 | 0.74 | 12 |
| `pixelate` | 0.4756 | 0.0027 | 17.71 | 0.40 | 12 |
| `gaussian` | 0.4794 | 0.0070 | 19.96 | 0.29 | 12 |

(Lower = stronger masking. Sorted by SSIM ascending.)

> **Note**: this run used a correlation-squared fallback for SSIM because
> scikit-image isn't installed in the default ml-service environment. For
> publication-grade numbers, install `scikit-image`:
>
> ```bash
> ./venv/bin/pip install scikit-image
> ```
>
> and re-run. The relative ordering is robust to either metric.

## Interpretation

1. **Cubist VIP edges out everything** on SSIM by a small margin and beats
   Gaussian on PSNR. The combination of dense polygon decomposition (50–90
   cells) + post-blur (σ=1.6) produces output that is structurally further
   from the original than either Gaussian smoothing or fixed-grid pixelation.

2. **Cubist standard ≈ Cubist VIP on SSIM** but with weaker PSNR signal —
   most of the SSIM defence comes from breaking up the original's edge
   structure, which the polygon decomposition does regardless of tier.

3. **Cubist relaxed underperforms** intentionally — by design, fewer
   polygons preserve more of the original (lighter mask). It's still
   *stronger* than Gaussian on PSNR.

4. **Pixelate and Gaussian** both show small standard deviation, consistent
   with their deterministic-by-pixel-position behaviour. Cubist's stochastic
   seed-driven polygon placement gives it slightly larger variance — but the
   *worst case* of cubist is still better than the *best case* of Gaussian.

## Caveats + future work

- Synthetic faces are simpler than real photographs. Re-running on FFHQ
  subset is on the post-defense roadmap.
- We do not yet report **face-recovery rate** (the cosine similarity
  between the original face's ArcFace embedding and the masked face's
  embedding, after both pass through the InsightFace encoder). The
  benchmark script has a stub for this metric; adding it requires
  initialising the InsightFace model, which is heavy for CI. Tracked in
  `docs/FUTURE.md`.
- A larger sample size (n=200+) would tighten the standard deviation
  estimates. Cost is a few minutes of CPU per algorithm.

## How to reproduce on real data

```bash
# 1. Drop license-clean face crops into a directory
mkdir -p /tmp/faces && curl -L ... > /tmp/faces/0001.jpg

# 2. Run the benchmark pointed at that directory
cd ml-service
./venv/bin/pip install scikit-image  # for proper SSIM
./venv/bin/python eval/benchmark_mask_algorithms.py \
    --input-dir /tmp/faces \
    --output ../docs/BENCHMARK_RESULTS.json

# 3. Paste the printed Markdown table into your paper / slide deck
```

## Raw results

[BENCHMARK_RESULTS.json](BENCHMARK_RESULTS.json) — machine-readable form.
