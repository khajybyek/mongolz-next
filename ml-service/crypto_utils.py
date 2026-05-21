"""
crypto_utils
============

Recording-уудыг **AES-256-GCM**-аар at-rest encrypt хийнэ. Visual blur нь
зөвхөн UI-н түвшний далдалт боловч, бодит cybersecurity нь cryptographic
encryption хэрэгтэй.

Архитектур
----------
1. **Master key** — `ML_ENCRYPTION_KEY` env (32 байт, base64)
   - Service-ийн startup-д ачаалагдана
   - DB-д ХЭЗЭЭ Ч хадгалагдахгүй
   - Хэрэв тохируулаагүй бол service start fail хийнэ. Зөвхөн local throwaway
     dev үед `ALLOW_RANDOM_ENCRYPTION_KEY=1` гэж explicit зөвшөөрвөл random key
     ашиглаж болно.

2. **Per-recording key** — `HKDF(master_key, info=recording_id)`
   - Master key л leak хийсэн ч халдлагач recording бүрд key derive хийх ёстой
   - Recording delete хийхэд тэр key forever lost (forward secrecy-н нэг хувилбар)

3. **Ciphertext format** (1 файлд):
   ```
   [nonce(12)] [ciphertext...] [tag(16)]
   ```
   AES-GCM нь auth tag-аар integrity-ыг шалгана — байт солихыг илрүүлнэ.

Performance
-----------
- AES-NI hardware acceleration → ~1-2 GB/s
- 5-минутын 720p MP4 (~50MB) → ~25-50ms
- Reveal flow-д тэр зөвхөн нэг л удаа decrypt хийдэг тул негatte impact ~0.

Usage
-----
```python
from crypto_utils import encrypt_bytes, decrypt_bytes, init_master_key

init_master_key()                                 # service startup
ct = encrypt_bytes(plaintext, recording_id)       # finalize рекорд
pt = decrypt_bytes(ct, recording_id)              # reveal job
```
"""

from __future__ import annotations

import base64
import logging
import os
import secrets

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes

log = logging.getLogger("mongolz-ml.crypto")

# Dual-key support: NEW key encrypt-д, PREV key зөвхөн decrypt fallback-д.
# Энэ нь key rotation хийхэд хуучин encrypted recordings алдагдахгүйг хангана.
_MASTER_KEY: bytes | None = None        # ML_ENCRYPTION_KEY (active, encrypts new files)
_MASTER_KEY_PREV: bytes | None = None   # ML_ENCRYPTION_KEY_PREV (decrypt old files only)
_NONCE_SIZE = 12  # AES-GCM standard
_KEY_SIZE = 32    # AES-256


def _parse_b64_key(raw: str, name: str) -> bytes | None:
    """Base64 key-ийг decode + size validation. Алдаа → None."""
    raw = raw.strip()
    if not raw:
        return None
    try:
        key = base64.urlsafe_b64decode(raw)
        if len(key) != _KEY_SIZE:
            raise ValueError(f"size = {len(key)}, expected {_KEY_SIZE}")
        return key
    except Exception as e:
        log.error("%s parse алдаа: %s", name, e)
        return None


# ─────────────────────────────────────────────────────────────
# Master key management (dual-key for rotation)
# ─────────────────────────────────────────────────────────────
def init_master_key() -> None:
    """Master key + previous key-ийг env-ээс ачаална.

    ML_ENCRYPTION_KEY      — active (encrypt + decrypt-ын эхний оролдлого)
    ML_ENCRYPTION_KEY_PREV — fallback (зөвхөн decrypt үед, хуучин recording-уудад)

    Rotation workflow:
        1. Шинэ key үүсгэнэ
        2. ML_ENCRYPTION_KEY_PREV = (хуучин ML_ENCRYPTION_KEY-ний утга)
        3. ML_ENCRYPTION_KEY = (шинэ key)
        4. Service restart → шинэ файлууд шинэ key-аар encrypt хийгдэнэ
        5. Хуучин файлууд PREV key-аар decrypt хийгдсээр (эрхгүй биш)
        6. Сүүлд: бүх хуучин файлуудыг re-encrypt хийсний дараа _PREV-ийг арилгана
    """
    global _MASTER_KEY, _MASTER_KEY_PREV
    if _MASTER_KEY is not None:
        return

    _MASTER_KEY = _parse_b64_key(os.getenv("ML_ENCRYPTION_KEY", ""), "ML_ENCRYPTION_KEY")
    _MASTER_KEY_PREV = _parse_b64_key(
        os.getenv("ML_ENCRYPTION_KEY_PREV", ""), "ML_ENCRYPTION_KEY_PREV"
    )

    if _MASTER_KEY is not None:
        log.info(
            "Encryption: master key loaded%s",
            " (with PREV key for legacy decrypt)" if _MASTER_KEY_PREV else "",
        )
        return

    if os.getenv("ALLOW_RANDOM_ENCRYPTION_KEY") != "1":
        raise RuntimeError(
            "ML_ENCRYPTION_KEY тохируулагдаагүй. "
            "Production болон persistent recording-д заавал 32 байт base64 key тавина уу. "
            "Зөвхөн local throwaway dev үед ALLOW_RANDOM_ENCRYPTION_KEY=1 ашиглаж болно."
        )

    # Explicit local-dev fallback — random key үүсгэнэ. Secret value-г log-д хэвлэхгүй.
    _MASTER_KEY = secrets.token_bytes(_KEY_SIZE)
    log.warning(
        "⚠️  ML_ENCRYPTION_KEY тохируулаагүй — RANDOM түр key үүсгэлээ.\n"
        "   Service restart хийхэд recording-уудыг decrypt хийж чадахгүй!\n"
        "   Production-д ML_ENCRYPTION_KEY заавал тохируулна уу."
    )


def _master() -> bytes:
    if _MASTER_KEY is None:
        init_master_key()
    assert _MASTER_KEY is not None
    return _MASTER_KEY


def _master_prev() -> bytes | None:
    if _MASTER_KEY is None:
        init_master_key()
    return _MASTER_KEY_PREV


def master_key() -> bytes:
    """Public accessor for the master key (used by hierarchical_keys chain
    root derivation). Lazily initialises from env on first call."""
    return _master()


# ─────────────────────────────────────────────────────────────
# Per-recording key derivation (HKDF-SHA256)
# ─────────────────────────────────────────────────────────────
def _derive_key(recording_id: str, master: bytes) -> bytes:
    """HKDF-аар recording-д тусгай 32-байт key derive хийнэ."""
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=_KEY_SIZE,
        salt=b"mongolz-recording-v1",
        info=recording_id.encode("utf-8"),
    )
    return hkdf.derive(master)


# ─────────────────────────────────────────────────────────────
# Encrypt / Decrypt (dual-key support)
# ─────────────────────────────────────────────────────────────
def encrypt_bytes(plaintext: bytes, recording_id: str) -> bytes:
    """AES-256-GCM encrypt → `nonce || ciphertext || tag`. Үргэлж active key-ээр."""
    key = _derive_key(recording_id, _master())
    nonce = secrets.token_bytes(_NONCE_SIZE)
    aesgcm = AESGCM(key)
    ct_with_tag = aesgcm.encrypt(nonce, plaintext, associated_data=None)
    return nonce + ct_with_tag


def decrypt_bytes(blob: bytes, recording_id: str) -> bytes:
    """`nonce || ciphertext || tag` blob-аас plaintext-ыг сэргээнэ.

    Dual-key: эхлээд active key-ээр оролдоно, амжилтгүй бол previous key-ээр.
    Аль ч key-ээр амжилтгүй бол `InvalidTag` гарна.
    """
    if len(blob) < _NONCE_SIZE + 16:
        raise ValueError("blob хэт жижиг — nonce/tag багтахгүй")
    nonce, ct = blob[:_NONCE_SIZE], blob[_NONCE_SIZE:]

    # 1. Active key-ээр оролдох
    try:
        key = _derive_key(recording_id, _master())
        return AESGCM(key).decrypt(nonce, ct, associated_data=None)
    except InvalidTag:
        pass

    # 2. Previous key-ээр оролдох (rotation үед хуучин файлд)
    prev = _master_prev()
    if prev is not None:
        try:
            key = _derive_key(recording_id, prev)
            result = AESGCM(key).decrypt(nonce, ct, associated_data=None)
            log.info(
                "Decrypt via PREV key (recording=%s) — re-encryption хэрэгтэй",
                recording_id[:8],
            )
            return result
        except InvalidTag:
            pass

    # Аль ч key ажиллахгүй → бодит integrity failure
    raise InvalidTag()


# ─────────────────────────────────────────────────────────────
# Утилит — service startup-д шалгах
# ─────────────────────────────────────────────────────────────
def self_test() -> None:
    """Encrypt/decrypt round-trip шалгана."""
    init_master_key()
    pt = b"mongolz security - encrypted at rest"
    ct = encrypt_bytes(pt, recording_id="test-id")
    pt2 = decrypt_bytes(ct, recording_id="test-id")
    assert pt2 == pt, "encryption round-trip failed"
    log.info("Crypto self-test: ok (%d bytes round-trip)", len(pt))
