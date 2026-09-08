"""The pgvector indexes must not be trained on a table that is still empty.

Measured on production (2026-09-09):

    faces_embedding_idx     ivfflat  lists=200   over    42 rows
    suspects_embedding_idx  ivfflat  lists=100   over     4 rows

ivfflat picks its centroids at BUILD time from the rows that exist, and a
search probes ``ivfflat.probes`` lists (default 1). With more lists than rows,
almost every list is empty and one probe inspects a single, essentially random
cell — recall is not "degraded later", it is broken from the moment the
planner starts using the index (today it still prefers a sequential scan,
which is why nobody noticed). Both indexes are rebuilt as HNSW in
``20260909110000_alert_evidence_and_vector_indexes.sql``: pgvector 0.8.0 is
installed, HNSW is built incrementally, has no training set to get wrong, and
needs no rebuild as the tables grow.

This test guards the schema the migrations add up to, so a future migration
cannot quietly reintroduce an ivfflat index sized for data that does not exist
yet. The runbook says when to revisit the choice.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"
VECTOR_INDEXES = ("faces_embedding_idx", "suspects_embedding_idx")

# CREATE INDEX <name> ON <table> USING <method> (...)
CREATE_INDEX_RE = re.compile(
    r"create\s+index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"
    r"(?P<name>[a-z0-9_\.]+)\s+on\s+(?P<rest>.*?);",
    re.IGNORECASE | re.DOTALL,
)
DROP_INDEX_RE = re.compile(
    r"drop\s+index\s+(?:concurrently\s+)?(?:if\s+exists\s+)?(?P<name>[a-z0-9_\.]+)",
    re.IGNORECASE,
)


def _strip_sql_comments(sql: str) -> str:
    """A rollback recipe in a header comment is documentation, not schema."""
    return re.sub(r"--[^\n]*", "", sql)


def _migration_files() -> list[Path]:
    if not MIGRATIONS.is_dir():
        pytest.skip("repository migrations not present (ml-service deployed standalone)")
    return sorted(p for p in MIGRATIONS.glob("*.sql") if re.match(r"^\d{14}_", p.name))


def _effective_index_definitions() -> dict[str, str]:
    """The last CREATE INDEX that survives for each vector index name."""
    current: dict[str, str] = {}
    for path in _migration_files():
        body = _strip_sql_comments(path.read_text(encoding="utf-8"))
        for m in DROP_INDEX_RE.finditer(body):
            current.pop(m.group("name").split(".")[-1], None)
        for m in CREATE_INDEX_RE.finditer(body):
            name = m.group("name").split(".")[-1]
            if name in VECTOR_INDEXES:
                current[name] = " ".join(m.group("rest").split())
    return current


def test_both_vector_indexes_are_hnsw_with_cosine_ops():
    definitions = _effective_index_definitions()
    for name in VECTOR_INDEXES:
        assert name in definitions, f"{name} is not created by any migration"
        definition = definitions[name].lower()
        assert "using hnsw" in definition, f"{name} is not HNSW: {definition}"
        assert "vector_cosine_ops" in definition, (
            f"{name} must match the `<=>` operator used by match_faces / "
            f"match_suspects: {definition}"
        )


def test_no_ivfflat_index_is_left_behind():
    definitions = _effective_index_definitions()
    offenders = {n: d for n, d in definitions.items() if "ivfflat" in d.lower()}
    assert not offenders, (
        "ivfflat trains its centroids at build time — a list count larger than "
        f"the row count silently destroys recall: {offenders}"
    )


def test_the_rebuild_migration_documents_its_rollback():
    """Every schema change in this batch ships a paste-able way back."""
    path = MIGRATIONS / "20260909110000_alert_evidence_and_vector_indexes.sql"
    if not path.is_file():
        pytest.skip("migration not present")
    header = path.read_text(encoding="utf-8")
    assert "Rollback" in header
    assert "using ivfflat (embedding vector_cosine_ops) with (lists='200')" in header
    assert "using ivfflat (embedding vector_cosine_ops) with (lists='100')" in header
