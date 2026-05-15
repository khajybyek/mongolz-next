"""Tests for crypto_utils — AES-256-GCM encrypt/decrypt with dual-key rotation."""

import base64
import logging
import os
import secrets

import pytest

os.environ["ML_ENCRYPTION_KEY"] = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()

import crypto_utils


@pytest.fixture(autouse=True)
def reset_keys():
    crypto_utils._MASTER_KEY = None
    crypto_utils._MASTER_KEY_PREV = None
    crypto_utils.init_master_key()
    yield


class TestEncryptDecrypt:
    def test_round_trip(self):
        pt = b"test plaintext data for mongolz"
        ct = crypto_utils.encrypt_bytes(pt, "rec-001")
        result = crypto_utils.decrypt_bytes(ct, "rec-001")
        assert result == pt

    def test_different_recording_ids_produce_different_ciphertext(self):
        pt = b"same data"
        ct1 = crypto_utils.encrypt_bytes(pt, "rec-001")
        ct2 = crypto_utils.encrypt_bytes(pt, "rec-002")
        assert ct1 != ct2

    def test_wrong_recording_id_fails(self):
        pt = b"secret"
        ct = crypto_utils.encrypt_bytes(pt, "rec-001")
        with pytest.raises(Exception):
            crypto_utils.decrypt_bytes(ct, "rec-999")

    def test_tampered_ciphertext_fails(self):
        pt = b"integrity test"
        ct = crypto_utils.encrypt_bytes(pt, "rec-001")
        tampered = bytearray(ct)
        tampered[20] ^= 0xFF
        with pytest.raises(Exception):
            crypto_utils.decrypt_bytes(bytes(tampered), "rec-001")

    def test_empty_blob_raises(self):
        with pytest.raises(ValueError):
            crypto_utils.decrypt_bytes(b"short", "rec-001")


class TestDualKey:
    def test_prev_key_fallback(self):
        old_key = secrets.token_bytes(32)
        new_key = secrets.token_bytes(32)

        crypto_utils._MASTER_KEY = old_key
        crypto_utils._MASTER_KEY_PREV = None
        pt = b"encrypted with old key"
        ct = crypto_utils.encrypt_bytes(pt, "rec-dual")

        crypto_utils._MASTER_KEY = new_key
        crypto_utils._MASTER_KEY_PREV = old_key

        result = crypto_utils.decrypt_bytes(ct, "rec-dual")
        assert result == pt

    def test_new_key_takes_priority(self):
        old_key = secrets.token_bytes(32)
        new_key = secrets.token_bytes(32)

        crypto_utils._MASTER_KEY = new_key
        crypto_utils._MASTER_KEY_PREV = old_key
        pt = b"encrypted with new key"
        ct = crypto_utils.encrypt_bytes(pt, "rec-new")

        crypto_utils._MASTER_KEY_PREV = None
        result = crypto_utils.decrypt_bytes(ct, "rec-new")
        assert result == pt


class TestSelfTest:
    def test_self_test_passes(self):
        crypto_utils.self_test()


class TestMissingKeyPolicy:
    def test_missing_key_requires_explicit_random_opt_in(self, monkeypatch):
        crypto_utils._MASTER_KEY = None
        crypto_utils._MASTER_KEY_PREV = None
        monkeypatch.delenv("ML_ENCRYPTION_KEY", raising=False)
        monkeypatch.delenv("ML_ENCRYPTION_KEY_PREV", raising=False)
        monkeypatch.delenv("ALLOW_RANDOM_ENCRYPTION_KEY", raising=False)

        with pytest.raises(RuntimeError):
            crypto_utils.init_master_key()

    def test_random_key_opt_in_does_not_log_secret(self, monkeypatch, caplog):
        crypto_utils._MASTER_KEY = None
        crypto_utils._MASTER_KEY_PREV = None
        monkeypatch.delenv("ML_ENCRYPTION_KEY", raising=False)
        monkeypatch.delenv("ML_ENCRYPTION_KEY_PREV", raising=False)
        monkeypatch.setenv("ALLOW_RANDOM_ENCRYPTION_KEY", "1")

        with caplog.at_level(logging.WARNING, logger="mongolz-ml.crypto"):
            crypto_utils.init_master_key()

        assert crypto_utils._MASTER_KEY is not None
        assert "ML_ENCRYPTION_KEY=" not in caplog.text
