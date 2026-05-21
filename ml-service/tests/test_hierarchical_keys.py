"""
Tests for hierarchical_keys.py — hash-chain per-face key access control.

Аюулгүй байдлын гол шинжүүдийг батлана:
  1. Round-trip — encrypt/decrypt тус бүрийн key-ээр
  2. Forward derivation — Kᵢ-ээс Kᵢ₊₁ гаргана
  3. Backward resistance — Kᵢ-ээс Kᵢ₋₁ ГАРГАХГҮЙ (гол security property)
  4. Hierarchy — K₀ бүгдийг, K₃ зөвхөн дээшээ
  5. Determinism — ижил input → ижил key
  6. Recording isolation — өөр recording → огт өөр chain
"""

import secrets

import pytest
from cryptography.exceptions import InvalidTag

import hierarchical_keys as hk


KEY_SIZE = 32


@pytest.fixture
def master() -> bytes:
    return secrets.token_bytes(KEY_SIZE)


@pytest.fixture
def crops() -> list[bytes]:
    # 6 хүний нүүрний "secret" payload (хэрэглэгчийн жишээ: 1-6)
    return [f"PERSON_{i}_face_jpeg_bytes".encode() for i in range(6)]


# ─────────────────────────────────────────────────────────────
# 1. Round-trip
# ─────────────────────────────────────────────────────────────
def test_encrypt_decrypt_roundtrip(master):
    crop = b"hello-face-crop"
    key = hk.key_at_index("rec-1", 0, master)
    blob = hk.encrypt_face(crop, key)
    assert hk.decrypt_face(blob, key) == crop


def test_blob_has_nonce_and_tag(master):
    key = hk.key_at_index("rec-1", 0, master)
    blob = hk.encrypt_face(b"x", key)
    # nonce(12) + ct(>=1) + tag(16)
    assert len(blob) >= 12 + 1 + 16


# ─────────────────────────────────────────────────────────────
# 2 & 3. Hash chain — forward works, backward impossible
# ─────────────────────────────────────────────────────────────
def test_forward_derivation(master):
    """Kᵢ-ээс next_key давтаснаар Kᵢ₊ₙ гарна."""
    k0 = hk.key_at_index("rec-1", 0, master)
    k1_direct = hk.key_at_index("rec-1", 1, master)
    k1_chain = hk.next_key(k0)
    assert k1_direct == k1_chain


def test_backward_resistance(master, crops):
    """
    ГОЛ SECURITY: K₃ эзэмшигч Face 0,1,2-ийг ХЭЗЭЭ Ч нээж чадахгүй.
    SHA256 нэг чиглэлт тул K₃-ээс K₂, K₁, K₀ руу буцах боломжгүй.
    """
    blobs = hk.encrypt_faces(crops, "rec-1", master)
    encrypted = {i: b for i, b in enumerate(blobs)}

    k3 = hk.key_at_index("rec-1", 3, master)
    revealed = hk.reveal_with_level_key(encrypted, 3, k3)

    # Доош нь хүрэхгүй
    assert 0 not in revealed
    assert 1 not in revealed
    assert 2 not in revealed
    # Дээш нь хүрнэ
    assert revealed[3] == crops[3]
    assert revealed[4] == crops[4]
    assert revealed[5] == crops[5]


def test_brute_force_backward_fails(master, crops):
    """K₃-аас хэдэн ч удаа SHA хийсэн K₀-той тэнцэхгүй (chain forward-only)."""
    k0 = hk.key_at_index("rec-1", 0, master)
    k3 = hk.key_at_index("rec-1", 3, master)

    # K₃-аас урагшаа 1000 алхам — K₀-той хэзээ ч давхцахгүй
    probe = k3
    for _ in range(1000):
        probe = hk.next_key(probe)
        assert probe != k0


# ─────────────────────────────────────────────────────────────
# 4. Hierarchy — role mapping
# ─────────────────────────────────────────────────────────────
def test_director_reveals_all(master, crops):
    """K₀ (Director) → бүх 6 нүүр."""
    blobs = hk.encrypt_faces(crops, "rec-1", master)
    encrypted = {i: b for i, b in enumerate(blobs)}
    k0 = hk.key_at_index("rec-1", 0, master)
    revealed = hk.reveal_with_level_key(encrypted, 0, k0)
    assert set(revealed.keys()) == {0, 1, 2, 3, 4, 5}
    for i in range(6):
        assert revealed[i] == crops[i]


def test_operator_reveals_only_self(master, crops):
    """K₅ (Operator, хамгийн доод) → зөвхөн өөрийн нүүр."""
    blobs = hk.encrypt_faces(crops, "rec-1", master)
    encrypted = {i: b for i, b in enumerate(blobs)}
    k5 = hk.key_at_index("rec-1", 5, master)
    revealed = hk.reveal_with_level_key(encrypted, 5, k5)
    assert set(revealed.keys()) == {5}
    assert revealed[5] == crops[5]


@pytest.mark.parametrize("level,expected", [
    (0, {0, 1, 2, 3, 4, 5}),
    (1, {1, 2, 3, 4, 5}),
    (2, {2, 3, 4, 5}),
    (3, {3, 4, 5}),
    (4, {4, 5}),
    (5, {5}),
])
def test_each_level_scope(master, crops, level, expected):
    """Level бүрийн reveal scope-ыг бүрэн шалгана (хэрэглэгчийн жишээ)."""
    blobs = hk.encrypt_faces(crops, "rec-1", master)
    encrypted = {i: b for i, b in enumerate(blobs)}
    k = hk.key_at_index("rec-1", level, master)
    revealed = hk.reveal_with_level_key(encrypted, level, k)
    assert set(revealed.keys()) == expected


# ─────────────────────────────────────────────────────────────
# 5. Determinism
# ─────────────────────────────────────────────────────────────
def test_deterministic_key(master):
    """Ижил (recording, index, master) → ижил key."""
    a = hk.key_at_index("rec-1", 3, master)
    b = hk.key_at_index("rec-1", 3, master)
    assert a == b


# ─────────────────────────────────────────────────────────────
# 6. Recording isolation
# ─────────────────────────────────────────────────────────────
def test_recording_isolation(master):
    """Өөр recording → огт өөр chain root."""
    a = hk.key_at_index("rec-1", 0, master)
    b = hk.key_at_index("rec-2", 0, master)
    assert a != b


def test_cross_recording_key_cannot_decrypt(master, crops):
    """rec-1-ийн key rec-2-ийн нүүрийг decrypt хийж чадахгүй."""
    blobs1 = hk.encrypt_faces(crops, "rec-1", master)
    k_other = hk.key_at_index("rec-2", 0, master)
    with pytest.raises(InvalidTag):
        hk.decrypt_face(blobs1[0], k_other)


# ─────────────────────────────────────────────────────────────
# 7. Master key isolation
# ─────────────────────────────────────────────────────────────
def test_different_master_different_chain(crops):
    """Master key солигдвол chain бүхэлдээ өөр."""
    m1 = secrets.token_bytes(KEY_SIZE)
    m2 = secrets.token_bytes(KEY_SIZE)
    assert hk.key_at_index("rec-1", 0, m1) != hk.key_at_index("rec-1", 0, m2)


# ─────────────────────────────────────────────────────────────
# 8. Tamper detection (GCM)
# ─────────────────────────────────────────────────────────────
def test_tampered_blob_rejected(master):
    key = hk.key_at_index("rec-1", 0, master)
    blob = bytearray(hk.encrypt_face(b"secret", key))
    blob[-1] ^= 0xFF  # tag-ийг эвдэх
    with pytest.raises(InvalidTag):
        hk.decrypt_face(bytes(blob), key)


# ─────────────────────────────────────────────────────────────
# 9. Self-test
# ─────────────────────────────────────────────────────────────
def test_self_test_runs():
    hk.self_test()  # raises бол fail
