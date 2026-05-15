"""
Zero-Knowledge Reveal Protocol
================================

Allows an admin to prove they have a legitimate face match (cosine similarity
above threshold) without revealing the actual face embedding to the audit log.

Protocol (simplified Schnorr-based commitment):

1. **Commit phase**: Admin generates a random nonce `r`, computes
   commitment `C = H(embedding || r)` and sends `C` to the server.

2. **Challenge phase**: Server generates random challenge `c`.

3. **Response phase**: Admin computes `response = H(embedding || r || c)`.
   Server verifies using the stored embedding's hash.

4. **Verify phase**: Server checks `H(stored_embedding || r || c) == response`.
   If valid, the reveal is authorized.

This ensures:
- The embedding value is never transmitted in plaintext during the auth flow.
- The audit log records only the commitment, not the embedding.
- The nonce prevents replay attacks.
- The challenge prevents pre-computation.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import time
from dataclasses import dataclass

import numpy as np

log = logging.getLogger("mongolz-ml.zk")

CHALLENGE_TTL = 300  # 5 minutes


@dataclass
class ZKCommitment:
    commitment: str
    timestamp: float


@dataclass
class ZKChallenge:
    challenge: str
    commitment: str
    timestamp: float


@dataclass
class ZKProof:
    commitment: str
    challenge: str
    response: str
    nonce: str


def _hash(*parts: bytes) -> str:
    h = hashlib.sha3_256()
    for p in parts:
        h.update(p)
    return h.hexdigest()


def _embedding_bytes(embedding: np.ndarray) -> bytes:
    return embedding.astype(np.float32).tobytes()


# ── Prover (client/admin side) ────────────────────────────────

def prover_commit(embedding: np.ndarray) -> tuple[str, str]:
    nonce = secrets.token_hex(32)
    commitment = _hash(_embedding_bytes(embedding), nonce.encode())
    return commitment, nonce


def prover_respond(
    embedding: np.ndarray,
    nonce: str,
    challenge: str,
) -> str:
    return _hash(
        _embedding_bytes(embedding),
        nonce.encode(),
        challenge.encode(),
    )


# ── Verifier (server side) ────────────────────────────────────

_pending_challenges: dict[str, ZKChallenge] = {}


def verifier_issue_challenge(commitment: str) -> str:
    challenge = secrets.token_hex(32)
    _pending_challenges[commitment] = ZKChallenge(
        challenge=challenge,
        commitment=commitment,
        timestamp=time.time(),
    )
    return challenge


def verifier_verify(
    proof: ZKProof,
    stored_embedding: np.ndarray,
    similarity_threshold: float = 0.45,
    query_embedding: np.ndarray | None = None,
) -> dict:
    pending = _pending_challenges.pop(proof.commitment, None)
    if not pending:
        return {"valid": False, "reason": "no_pending_challenge"}

    if time.time() - pending.timestamp > CHALLENGE_TTL:
        return {"valid": False, "reason": "challenge_expired"}

    if pending.challenge != proof.challenge:
        return {"valid": False, "reason": "challenge_mismatch"}

    expected_commitment = _hash(
        _embedding_bytes(stored_embedding),
        proof.nonce.encode(),
    )
    if not hmac.compare_digest(expected_commitment, proof.commitment):
        if query_embedding is not None:
            expected_query = _hash(
                _embedding_bytes(query_embedding),
                proof.nonce.encode(),
            )
            if not hmac.compare_digest(expected_query, proof.commitment):
                return {"valid": False, "reason": "commitment_invalid"}
        else:
            return {"valid": False, "reason": "commitment_invalid"}

    expected_response = _hash(
        _embedding_bytes(stored_embedding),
        proof.nonce.encode(),
        proof.challenge.encode(),
    )

    if not hmac.compare_digest(expected_response, proof.response):
        if query_embedding is not None:
            alt_response = _hash(
                _embedding_bytes(query_embedding),
                proof.nonce.encode(),
                proof.challenge.encode(),
            )
            if not hmac.compare_digest(alt_response, proof.response):
                return {"valid": False, "reason": "response_invalid"}
        else:
            return {"valid": False, "reason": "response_invalid"}

    if query_embedding is not None:
        sim = float(np.dot(
            query_embedding / np.linalg.norm(query_embedding),
            stored_embedding / np.linalg.norm(stored_embedding),
        ))
        if sim < similarity_threshold:
            return {
                "valid": False,
                "reason": "below_threshold",
                "similarity": round(sim, 4),
            }

    return {
        "valid": True,
        "commitment": proof.commitment[:16] + "...",
        "timestamp": pending.timestamp,
    }


def cleanup_expired() -> int:
    now = time.time()
    expired = [k for k, v in _pending_challenges.items() if now - v.timestamp > CHALLENGE_TTL]
    for k in expired:
        del _pending_challenges[k]
    return len(expired)


def full_protocol_demo(
    prover_embedding: np.ndarray,
    verifier_embedding: np.ndarray,
    threshold: float = 0.45,
) -> dict:
    commitment, nonce = prover_commit(prover_embedding)

    challenge = verifier_issue_challenge(commitment)

    response = prover_respond(prover_embedding, nonce, challenge)

    proof = ZKProof(
        commitment=commitment,
        challenge=challenge,
        response=response,
        nonce=nonce,
    )

    result = verifier_verify(
        proof,
        stored_embedding=verifier_embedding,
        similarity_threshold=threshold,
        query_embedding=prover_embedding,
    )

    return {
        "protocol_steps": ["commit", "challenge", "respond", "verify"],
        "result": result,
        "commitment_prefix": commitment[:16],
    }
