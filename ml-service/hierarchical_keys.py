"""
Hierarchical per-face key derivation — hash-chain access control for reveal.

Одоогийн загвар: recording бүхэлдээ нэг key-ээр encrypt (crypto_utils.py).
Энэ модуль: илрүүлсэн нүүр бүрийг **тусдаа key**-ээр encrypt хийж,
key-нүүдийг нэг чиглэлт hash chain-аар холбоно. Үүний ачаар "дээд түвшний
key доод түвшний бүх нүүрийг reveal хийх" шатлалт хандалт бий болно.

Криптографийн зарчим — forward hash chain:

    K₀ = HKDF(master_key, salt, info = recording_id ‖ "face-chain-root")
    Kᵢ₊₁ = SHA256(Kᵢ)                       (нэг чиглэлт)

    Face i  →  AES-256-GCM(Kᵢ)

Аюулгүй байдлын шинж:
    • SHA256 нэг чиглэлт тул Kᵢ-ээс Kᵢ₊₁, Kᵢ₊₂… гаргаж болно
      ГЭХДЭЭ Kᵢ-ээс Kᵢ₋₁ руу буцаж **боломжгүй**.
    • Тиймээс K₃ эзэмшигч → Face 3,4,5,… reveal хийнэ,
      харин Face 0,1,2-ийг **хэзээ ч** нээж чадахгүй.

Шатлал → role mapping (жишээ):
    K₀  Director       → бүх нүүр
    K₃  Manager        → 3-аас доош
    Kₙ  Operator       → зөвхөн өөрийн scope

Энэ нь GDPR Art.25 "data minimization by design" + NIST SP 800-57
"key hierarchy"-тэй нийцэнэ: эрх бүр зөвхөн шаардлагатай хэмжээний
мэдээлэлд хүрнэ (least-privilege).
"""

from __future__ import annotations

import hashlib
import secrets

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.exceptions import InvalidTag

_KEY_SIZE = 32        # AES-256
_NONCE_SIZE = 12      # GCM standard nonce
_CHAIN_SALT = b"mongolz-face-chain-v1"


# ─────────────────────────────────────────────────────────────
# Chain derivation
# ─────────────────────────────────────────────────────────────
def chain_root(recording_id: str, master: bytes) -> bytes:
    """K₀ — recording-д тусгай hash chain-ийн эх key (HKDF-SHA256)."""
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=_KEY_SIZE,
        salt=_CHAIN_SALT,
        info=f"{recording_id}:face-chain-root".encode("utf-8"),
    )
    return hkdf.derive(master)


def next_key(k: bytes) -> bytes:
    """Kᵢ₊₁ = SHA256(Kᵢ). Нэг чиглэлт — урагшаа л явна."""
    return hashlib.sha256(k).digest()


def key_at_index(recording_id: str, index: int, master: bytes) -> bytes:
    """
    Kᵢ-г root-аас эхлэн hash chain дагуу тооцоолно.

    Зөвхөн master key эзэмшигч (ML service) аль ч index-ийн key-г
    гаргаж чадна. Доод түвшний хэрэглэгчид зөвхөн өөрийн level-ийн
    key-г л хүлээж авна (out-of-band), root-гүй.
    """
    if index < 0:
        raise ValueError("index сөрөг байж болохгүй")
    k = chain_root(recording_id, master)
    for _ in range(index):
        k = next_key(k)
    return k


# ─────────────────────────────────────────────────────────────
# Encrypt — нүүр бүрийг chain key-ээр
# ─────────────────────────────────────────────────────────────
def encrypt_face(crop: bytes, key: bytes) -> bytes:
    """AES-256-GCM(key) → `nonce ‖ ciphertext ‖ tag`."""
    if len(key) != _KEY_SIZE:
        raise ValueError(f"key {_KEY_SIZE} байт байх ёстой, {len(key)} ирлээ")
    nonce = secrets.token_bytes(_NONCE_SIZE)
    ct = AESGCM(key).encrypt(nonce, crop, associated_data=None)
    return nonce + ct


def encrypt_faces(crops: list[bytes], recording_id: str, master: bytes) -> list[bytes]:
    """
    Нүүрсний жагсаалтыг chain-ийн дарааллаар encrypt хийнэ.

    crops[0] → K₀, crops[1] → K₁, …  (chain_index = list index)
    Буцаах: encrypted blob-уудын жагсаалт (мөн дараалалтай).
    """
    out: list[bytes] = []
    k = chain_root(recording_id, master)
    for crop in crops:
        out.append(encrypt_face(crop, k))
        k = next_key(k)
    return out


# ─────────────────────────────────────────────────────────────
# Reveal — зөвхөн granted level + доош
# ─────────────────────────────────────────────────────────────
def decrypt_face(blob: bytes, key: bytes) -> bytes:
    """`nonce ‖ ct ‖ tag` → plaintext. Буруу key → InvalidTag."""
    if len(blob) < _NONCE_SIZE + 16:
        raise ValueError("blob хэт жижиг")
    nonce, ct = blob[:_NONCE_SIZE], blob[_NONCE_SIZE:]
    return AESGCM(key).decrypt(nonce, ct, associated_data=None)


def reveal_with_level_key(
    encrypted_faces: dict[int, bytes],
    start_index: int,
    start_key: bytes,
) -> dict[int, bytes]:
    """
    `start_key = K_{start_index}` эзэмшигчээр reveal хийнэ.

    start_index-ээс ДЭЭШ (≥) бүх нүүрийг decrypt хийнэ — chain-ийг
    урагшаа дагаж. start_index-ээс ДООШ нүүрсийг **хэзээ ч** нээхгүй
    (SHA256 reverse боломжгүй).

    Жишээ: K₃ эзэмшигч → {3,4,5,…} reveal, {0,1,2} → хүрэхгүй.

    Returns: {index: plaintext_crop} — амжилттай decrypt хийсэн нүүрс.
    """
    revealed: dict[int, bytes] = {}
    if not encrypted_faces:
        return revealed

    max_idx = max(encrypted_faces.keys())
    k = start_key
    for idx in range(start_index, max_idx + 1):
        if idx in encrypted_faces:
            try:
                revealed[idx] = decrypt_face(encrypted_faces[idx], k)
            except (InvalidTag, ValueError):
                # Хэрэв энэ index-д буруу key байвал алгасна (зөрчилгүй)
                pass
        k = next_key(k)
    return revealed


# ─────────────────────────────────────────────────────────────
# Self-test (startup sanity)
# ─────────────────────────────────────────────────────────────
def self_test() -> None:
    """Hash chain hierarchy-ийн үндсэн шинжийг шалгана."""
    master = secrets.token_bytes(_KEY_SIZE)
    rec = "selftest-recording-0001"
    crops = [f"FACE_{i}_secret".encode() for i in range(6)]

    blobs = encrypt_faces(crops, rec, master)
    encrypted = {i: b for i, b in enumerate(blobs)}

    # Director (K₀) → бүгдийг reveal
    k0 = key_at_index(rec, 0, master)
    all_revealed = reveal_with_level_key(encrypted, 0, k0)
    assert len(all_revealed) == 6, "K₀ бүгдийг reveal хийх ёстой"
    assert all_revealed[0] == crops[0]

    # Manager (K₃) → зөвхөн 3,4,5
    k3 = key_at_index(rec, 3, master)
    mgr_revealed = reveal_with_level_key(encrypted, 3, k3)
    assert set(mgr_revealed.keys()) == {3, 4, 5}, "K₃ → зөвхөн 3,4,5"
    assert 0 not in mgr_revealed and 2 not in mgr_revealed, "K₃ доош хүрэх ёсгүй"

    print("hierarchical_keys self-test: ok (6 faces, chain hierarchy verified)")


if __name__ == "__main__":
    self_test()
