"""Tests for zero-knowledge reveal protocol."""

import numpy as np
import pytest

from zk_reveal import (
    prover_commit,
    prover_respond,
    verifier_issue_challenge,
    verifier_verify,
    full_protocol_demo,
    ZKProof,
    cleanup_expired,
)


@pytest.fixture
def embeddings():
    rng = np.random.default_rng(42)
    base = rng.standard_normal(512).astype(np.float32)
    base /= np.linalg.norm(base)
    similar = base + rng.normal(0, 0.01, 512).astype(np.float32)
    similar /= np.linalg.norm(similar)
    different = rng.standard_normal(512).astype(np.float32)
    different /= np.linalg.norm(different)
    return base, similar, different


class TestProtocolSteps:
    def test_commit_produces_unique_values(self, embeddings):
        base, _, _ = embeddings
        c1, n1 = prover_commit(base)
        c2, n2 = prover_commit(base)
        assert c1 != c2
        assert n1 != n2

    def test_respond_is_deterministic(self, embeddings):
        base, _, _ = embeddings
        _, nonce = prover_commit(base)
        r1 = prover_respond(base, nonce, "challenge-1")
        r2 = prover_respond(base, nonce, "challenge-1")
        assert r1 == r2

    def test_different_challenges_give_different_responses(self, embeddings):
        base, _, _ = embeddings
        _, nonce = prover_commit(base)
        r1 = prover_respond(base, nonce, "challenge-1")
        r2 = prover_respond(base, nonce, "challenge-2")
        assert r1 != r2


class TestVerification:
    def test_valid_proof_same_embedding(self, embeddings):
        base, _, _ = embeddings
        commitment, nonce = prover_commit(base)
        challenge = verifier_issue_challenge(commitment)
        response = prover_respond(base, nonce, challenge)

        proof = ZKProof(commitment=commitment, challenge=challenge, response=response, nonce=nonce)
        result = verifier_verify(proof, stored_embedding=base)
        assert result["valid"] is True

    def test_wrong_nonce_fails(self, embeddings):
        base, _, _ = embeddings
        commitment, _ = prover_commit(base)
        challenge = verifier_issue_challenge(commitment)
        response = prover_respond(base, "wrong-nonce", challenge)

        proof = ZKProof(commitment=commitment, challenge=challenge, response=response, nonce="wrong-nonce")
        result = verifier_verify(proof, stored_embedding=base)
        assert result["valid"] is False

    def test_replay_attack_fails(self, embeddings):
        base, _, _ = embeddings
        commitment, nonce = prover_commit(base)
        challenge = verifier_issue_challenge(commitment)
        response = prover_respond(base, nonce, challenge)

        proof = ZKProof(commitment=commitment, challenge=challenge, response=response, nonce=nonce)
        verifier_verify(proof, stored_embedding=base)

        result = verifier_verify(proof, stored_embedding=base)
        assert result["valid"] is False
        assert result["reason"] == "no_pending_challenge"

    def test_wrong_embedding_fails(self, embeddings):
        base, _, different = embeddings
        commitment, nonce = prover_commit(base)
        challenge = verifier_issue_challenge(commitment)
        response = prover_respond(base, nonce, challenge)

        proof = ZKProof(commitment=commitment, challenge=challenge, response=response, nonce=nonce)
        result = verifier_verify(proof, stored_embedding=different)
        assert result["valid"] is False


class TestFullProtocol:
    def test_same_embedding_succeeds(self, embeddings):
        base, _, _ = embeddings
        result = full_protocol_demo(base, base)
        assert result["result"]["valid"] is True

    def test_similar_embedding_succeeds(self, embeddings):
        base, similar, _ = embeddings
        result = full_protocol_demo(similar, base, threshold=0.45)
        assert result["result"]["valid"] is True

    def test_different_embedding_fails(self, embeddings):
        base, _, different = embeddings
        result = full_protocol_demo(different, base, threshold=0.45)
        assert result["result"]["valid"] is False


class TestCleanup:
    def test_cleanup_returns_count(self):
        cleaned = cleanup_expired()
        assert isinstance(cleaned, int)
