#!/usr/bin/env python3
"""Download AI-generated face portraits for the privacy-mask benchmark.

Why AI-generated?
  * FFHQ / CelebA / VGGFace are gated; downloads need accounts.
  * thispersondoesnotexist.com is a public StyleGAN endpoint that emits
    fresh photo-realistic faces. The synthesised people are not real, so
    using their images carries no PII risk.
  * Each download is unique, so we save them locally and the *benchmark
    itself* is deterministic against the saved file set.

Usage:
  $ python ml-service/eval/fetch_face_samples.py --out samples/ --n 20

Re-running with an existing populated --out directory is a no-op, so the
script is idempotent for CI / paper reproduction.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import requests

URL = "https://thispersondoesnotexist.com/"
UA = "MongolzCapstoneBenchmark/1.0 (mongolz.vercel.app; admin@mongolz.local)"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=Path("samples"))
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--timeout", type=int, default=20)
    ap.add_argument("--sleep", type=float, default=1.5,
                    help="Polite delay between requests; the endpoint rate-limits.")
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    existing = sorted(args.out.glob("*.jpg"))
    have = len(existing)
    need = max(0, args.n - have)
    if need == 0:
        print(f"Already have {have} samples in {args.out}; nothing to do.", file=sys.stderr)
        return

    print(f"Have {have}, fetching {need} more from {URL}", file=sys.stderr)
    ok = have
    session = requests.Session()
    session.headers.update({"User-Agent": UA})
    for i in range(have, args.n):
        dest = args.out / f"{i:02d}.jpg"
        try:
            resp = session.get(URL, timeout=args.timeout, stream=True)
            resp.raise_for_status()
            with dest.open("wb") as out:
                for chunk in resp.iter_content(chunk_size=64 * 1024):
                    if chunk:
                        out.write(chunk)
            print(f"got  {dest.name}  ({dest.stat().st_size // 1024} KB)", file=sys.stderr)
            ok += 1
            time.sleep(args.sleep)
        except (requests.RequestException, TimeoutError) as e:
            print(f"FAIL {dest.name}: {e}", file=sys.stderr)
            time.sleep(args.sleep * 2)

    print(f"\n{ok}/{args.n} samples present in {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
