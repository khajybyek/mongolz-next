"""Supply-chain guards on the ML image build (RUNBOOK §5a.4).

The Tailscale binaries used to be fetched with `curl | tar` and no checksum,
so a compromised mirror or a MITM on the build host would have shipped an
arbitrary root-run daemon into the image.
"""
import re
from pathlib import Path

DOCKERFILE = Path(__file__).resolve().parent.parent / "Dockerfile"


def _text() -> str:
    return DOCKERFILE.read_text(encoding="utf-8")


def test_tailscale_tarball_is_checksum_pinned():
    text = _text()
    m = re.search(r"^ARG TS_SHA256=([0-9a-f]+)$", text, re.MULTILINE)
    assert m, "TS_SHA256 build arg missing"
    assert len(m.group(1)) == 64
    assert 'sha256sum -c -' in text
    # Verification must happen before extraction, and nothing may pipe the
    # download straight into tar.
    assert text.index("sha256sum -c -") < text.index("tar -xzf /tmp/tailscale.tgz")
    assert not re.search(r"curl[^\n]*tailscale[^\n]*\n?\s*\|\s*tar", text)
