# 0001 — Cubist Voronoi mosaic as the primary face-mask algorithm

* **Status:** Accepted
* **Date:** 2026-02-12

## Context

The system stores CCTV recordings that, by regulation, must not let an
ordinary viewer identify subjects. Three off-the-shelf options exist:

1. **Gaussian blur** — standard in consumer CCTV. Easy to implement,
   easy to *reverse*: a CNN trained on un-blurred faces routinely
   recovers identity from σ≤8 blurs (Oh et al., ECCV 2016).
2. **Pixelation (mosaic)** — 8×8 blocks. Better than Gaussian but the
   block structure still leaks low-frequency identity (skin tone, hair
   colour, glasses).
3. **Black bar / solid fill** — total information loss, but the
   recording becomes useless for anything except "person present".

The system needs:

- Strong privacy (an attacker who decrypts the blurred MP4 must not be
  able to identify subjects).
- Reversibility under controlled flow (4-eyes reveal-job re-derives the
  un-blurred frame from the encrypted original).
- Acceptable runtime cost (≤ 50 ms / face / CPU core to keep up with
  real-time RTSP at 5 cameras × 5 FPS).

## Decision

Implement a custom **Cubist Voronoi mosaic** in
`ml-service/recording_pipeline.py:_cubist_anonymize`:

1. Scatter 18-50 Voronoi seeds inside the face bbox (count varies by
   `privacy_tier`: `relaxed/standard/vip`).
2. Build the Voronoi tessellation via `cv2.Subdiv2D`.
3. Replace each polygon with the mean BGR colour of the underlying
   pixels.
4. Light Gaussian blur (σ=2) on the polygon edges to suppress aliasing.

The benchmark in [`docs/BENCHMARK.md`][bench] / [`BENCHMARK_REAL.md`][real]
shows the cubist mask achieves SSIM 0.60 vs Gaussian 0.78 on the same
20 StyleGAN3 face crops (lower SSIM = more privacy).

[bench]: ../BENCHMARK.md
[real]: ../BENCHMARK_REAL.md

## Consequences

### Positive

- Strongest privacy of the three candidates on SSIM/PSNR — paper-ready.
- Visually distinctive (a Cubist mosaic is obviously *intended* masking,
  not a video glitch) — supports the consent-required UX.
- Deterministic given the seed → reproducible benchmark.

### Negative

- Custom code → we own the maintenance burden (vs `cv2.GaussianBlur`).
- 50 % slower than Gaussian in microbench (still ~12 ms per 128×128
  face crop on a single CPU core, well within budget).
- "Cubist" aesthetic is a brand choice — some operators may prefer a
  more boring mask. Mitigated by the `privacy_tier=relaxed` variant
  which approaches a low-fidelity mosaic.

### Reversal cost

The encrypted original frame is still stored. A reveal-job at
`ml-service/reveal_job.py` re-derives the un-blurred face from the
AES-GCM ciphertext on demand. The cubist mask itself is *not* invertible
— that's the security property we want.
