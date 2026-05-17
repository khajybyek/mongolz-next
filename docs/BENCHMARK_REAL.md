# Privacy-mask benchmark — real face samples

> Reproduction script: `ml-service/eval/benchmark_mask_algorithms.py`
> Sample fetcher: `ml-service/eval/fetch_face_samples.py`

## Methodology

We compare five face-masking algorithms on the same set of 20 photo-realistic
face crops, each ~ 600×600 px.

### Sample provenance

The 20 face images are **AI-generated** by
[thispersondoesnotexist.com](https://thispersondoesnotexist.com/) (StyleGAN3).
These depict *synthesised* humans — no real individuals — and therefore
carry no PII or licensing risk while still exposing the algorithm to the
shape, lighting, and texture statistics of real human faces. FFHQ / CelebA
/ VGGFace are gated and were intentionally not used so the benchmark is
trivially reproducible (no auth, no MoU).

### Metrics

| Metric | What it measures | Direction |
|---|---|---|
| **SSIM** | Structural similarity to the original face | **Lower = more privacy** |
| **PSNR** | Peak signal-to-noise ratio (dB) — image quality | Lower = more distortion |
| **n** | Number of crops in the run | — |

Lower SSIM means the masked image preserves less of the original
structure (better privacy). High PSNR (e.g. Gaussian) means the mask is
imperceptible to a human viewer — the face is still mostly there.

## Results — 20 StyleGAN3 faces, 2026-05-18 KST

| Algorithm | SSIM mean ↓ | SSIM σ | PSNR mean (dB) ↓ | PSNR σ | n |
|---|---|---|---|---|---|
| cubist_relaxed   | **0.5981** | 0.0609 | 14.73 | 1.27 | 20 |
| cubist_standard  | 0.6133 | 0.0582 | 15.90 | 1.12 | 20 |
| cubist_vip       | 0.6265 | 0.0587 | 17.16 | 0.97 | 20 |
| pixelate         | 0.6274 | 0.0609 | 15.81 | 0.95 | 20 |
| gaussian         | 0.7778 | 0.0576 | 28.64 | 1.64 | 20 |

### Interpretation

* **Cubist tier ordering matches intent** — relaxed ⊂ standard ⊂ VIP. The
  relaxed tier is the loudest visually (lowest PSNR) and erases the most
  structural similarity (lowest SSIM).
* **Cubist beats pixelation at every tier.** Pixelate at 8×8 lands between
  cubist_standard and cubist_vip on SSIM but with comparable PSNR — there
  is no privacy reason to prefer it over our cubist masks, while cubist is
  arguably less ugly to a human viewer.
* **Gaussian blur is a privacy anti-pattern.** SSIM = 0.78 means ~80 % of
  the source structure survives the mask. PSNR 28.6 dB is "visually
  near-identical" by photography conventions. Convolutional networks
  trained on un-blurred faces routinely recover identity from
  Gaussian-blurred crops — see Oh et al., "Faceless Person Recognition"
  (ECCV 2016).

### Why this matters for the system

The cubist mosaic is therefore **load-bearing** for the security claim of
the system: a viewer-role user who downloads the encrypted recording and
decrypts it should not be able to identify subjects from the un-revealed
output. Replacing cubist with Gaussian blur would silently regress
privacy by ≈30 % of SSIM headroom while making the output prettier — a
classic security-vs-aesthetic trap.

## Reproduction

```bash
cd ml-service
python3 eval/fetch_face_samples.py --out samples/ --n 20
./venv/bin/python eval/benchmark_mask_algorithms.py \
  --input-dir samples/ \
  --output docs/BENCHMARK_REAL_FACES.json
```

The fetch step is idempotent — re-running with the samples directory
populated is a no-op. Once a sample set exists on disk, every benchmark
run is deterministic to ±SSIM 1e-4 (Voronoi seeds are derived from
sample index, not wall clock).
