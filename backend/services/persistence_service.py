"""
Persistence service — stores scan results in a local SQLite database.

Why this exists
---------------
The backend uses an in-memory dict (_cache) that is wiped on every process
restart. By serialising each completed scan to SQLite the portal can open
immediately with the last-run data — no new scan required.

It also maintains a per-resource metrics cache so that the *next* scan can
skip the expensive Azure Monitor API calls for resources whose metrics have
not meaningfully changed (delta / incremental scanning).

Schema
------
scans
    id, saved_at, resource_count, payload (JSON text)

resource_metrics
    resource_id (PK), updated_at, payload (JSON text)
    — keyed by resource ARM id (lower-cased)
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from services.database import get_raw_connection, is_azure_sql, limit_sql, upsert_conflict_sql, create_table_sql

logger = logging.getLogger(__name__)

_MAX_SCANS = 5          # keep last N full scans (older ones pruned automatically)
# Bump whenever the dashboard payload shape changes in a way that would break an
# older snapshot rendered by the current frontend. Snapshots stamped with a
# different (or missing) version are ignored by the UI, which then does a fresh
# build and re-saves a current-schema snapshot.
SNAPSHOT_SCHEMA_VERSION = 1


# ── Internal helpers ──────────────────────────────────────────────────────────

def _conn():
    """Open the database via the abstraction layer, returning a connection."""
    db = get_raw_connection()
    if not is_azure_sql():
        db.execute("""
            CREATE TABLE IF NOT EXISTS scans (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                saved_at       TEXT    NOT NULL,
                resource_count INTEGER DEFAULT 0,
                payload        TEXT    NOT NULL
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS resource_metrics (
                resource_id    TEXT PRIMARY KEY,
                updated_at     TEXT NOT NULL,
                payload        TEXT NOT NULL
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS resource_custom_tags (
                resource_id  TEXT NOT NULL,
                tag_key      TEXT NOT NULL,
                tag_value    TEXT NOT NULL DEFAULT '',
                source       TEXT NOT NULL DEFAULT 'user',
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL,
                PRIMARY KEY (resource_id, tag_key)
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS custom_tag_schema (
                tag_key      TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                tag_type     TEXT DEFAULT 'text',
                enum_values  TEXT DEFAULT '[]',
                category     TEXT DEFAULT 'Custom',
                is_required  INTEGER DEFAULT 0,
                color        TEXT DEFAULT '#6b7280',
                created_at   TEXT NOT NULL
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS resource_snapshots (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                resource_id  TEXT NOT NULL,
                captured_at  TEXT NOT NULL,
                sku          TEXT,
                location     TEXT,
                tags         TEXT,
                config       TEXT,
                status       TEXT,
                change_type  TEXT DEFAULT 'snapshot'
            )
        """)
        db.execute("CREATE INDEX IF NOT EXISTS idx_snapshots_resource ON resource_snapshots(resource_id)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_snapshots_captured ON resource_snapshots(captured_at)")
        db.execute("""
            CREATE TABLE IF NOT EXISTS ai_analyses (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                analysis_type TEXT NOT NULL,
                subject_id    TEXT,
                analyzed_at   TEXT NOT NULL,
                model         TEXT NOT NULL,
                prompt_tokens INTEGER DEFAULT 0,
                result        TEXT NOT NULL
            )
        """)
        db.execute("CREATE INDEX IF NOT EXISTS idx_ai_type_subject ON ai_analyses(analysis_type, subject_id)")
        db.execute("""
            CREATE TABLE IF NOT EXISTS onprem_uploads (
                batch_id       TEXT PRIMARY KEY,
                uploaded_at    TEXT NOT NULL,
                server_count   INTEGER DEFAULT 0,
                filename       TEXT DEFAULT '',
                status         TEXT DEFAULT 'completed',
                warnings       TEXT DEFAULT '[]',
                errors         TEXT DEFAULT '[]'
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS onprem_servers (
                server_id      TEXT PRIMARY KEY,
                hostname       TEXT NOT NULL,
                batch_id       TEXT NOT NULL,
                collected_at   TEXT NOT NULL,
                workload_type  TEXT DEFAULT '',
                payload        TEXT NOT NULL,
                FOREIGN KEY (batch_id) REFERENCES onprem_uploads(batch_id) ON DELETE CASCADE
            )
        """)
        db.execute("CREATE INDEX IF NOT EXISTS idx_onprem_batch ON onprem_servers(batch_id)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_onprem_host  ON onprem_servers(hostname)")
        db.commit()
    return db


# ── Full-scan persistence ─────────────────────────────────────────────────────

def save_dashboard(payload: dict) -> None:
    """Persist a complete dashboard payload to SQLite."""
    try:
        saved_at       = datetime.now(tz=timezone.utc).isoformat()
        resource_count = len(payload.get("resources", []))
        # Stamp the schema version so the UI can reject incompatible snapshots.
        if isinstance(payload, dict):
            payload["_snapshot_schema"] = SNAPSHOT_SCHEMA_VERSION
        db = _conn()
        db.execute(
            "INSERT INTO scans (saved_at, resource_count, payload) VALUES (?, ?, ?)",
            (saved_at, resource_count, json.dumps(payload, default=str)),
        )
        # Prune oldest scans beyond the limit
        if is_azure_sql():
            db.execute(
                f"DELETE FROM scans WHERE id NOT IN "
                f"(SELECT TOP {_MAX_SCANS} id FROM scans ORDER BY id DESC)"
            )
        else:
            db.execute(
                f"DELETE FROM scans WHERE id NOT IN "
                f"(SELECT id FROM scans ORDER BY id DESC LIMIT {_MAX_SCANS})"
            )
        db.commit()
        db.close()
        logger.info(
            "Scan persisted (%d resources, saved %s)",
            resource_count, saved_at,
        )
    except Exception as exc:
        logger.warning("Failed to persist scan: %s", exc)


def load_latest_dashboard() -> Optional[dict]:
    """Return the most recently persisted dashboard payload dict, or None."""
    try:
        db  = _conn()
        row = db.execute(
            limit_sql("SELECT payload, saved_at FROM scans ORDER BY id DESC", 1)
        ).fetchone()
        db.close()
        if row:
            logger.info("Loaded persisted scan (saved %s)", row[1])
            payload = json.loads(row[0])
            # Surface the snapshot age so the UI can show an "as of" badge.
            if isinstance(payload, dict):
                payload["data_as_of"] = row[1]
            return payload
        return None
    except Exception as exc:
        logger.warning("Failed to load persisted scan: %s", exc)
        return None


def list_scans() -> list[dict]:
    """Return summary metadata for all stored scans (no payload)."""
    try:
        db   = _conn()
        rows = db.execute(
            limit_sql("SELECT id, saved_at, resource_count FROM scans ORDER BY id DESC", 20)
        ).fetchall()
        db.close()
        return [{"id": r[0], "saved_at": r[1], "resource_count": r[2]} for r in rows]
    except Exception:
        return []


# ── Per-resource metrics delta cache ─────────────────────────────────────────

def save_resource_metrics(metrics_map: Dict[str, Any]) -> None:
    """
    Persist per-resource metrics so the next scan can skip Monitor API calls.

    metrics_map: { resource_id_lower: metrics_object_or_dict }
    """
    if not metrics_map:
        return
    try:
        now = datetime.now(tz=timezone.utc).isoformat()
        db  = _conn()
        for rid, m in metrics_map.items():
            try:
                # Serialise: try model_dump first (Pydantic), fall back to __dict__
                if hasattr(m, "model_dump"):
                    payload = json.dumps(m.model_dump(mode="json"), default=str)
                elif hasattr(m, "__dict__"):
                    payload = json.dumps(m.__dict__, default=str)
                else:
                    payload = json.dumps(m, default=str)
                _upsert = upsert_conflict_sql(
                    "resource_metrics",
                    insert_cols=["resource_id", "updated_at", "payload"],
                    pk_cols=["resource_id"],
                    update_cols=["updated_at", "payload"],
                )
                _params = (rid.lower(), now, payload)
                # NOTE: upsert_conflict_sql's Azure SQL MERGE references the source columns
                # BY NAME (source.[col]) so it has exactly 3 parameter markers — same as the
                # SQLite INSERT..ON CONFLICT. Do NOT double the params for Azure SQL: doing so
                # raised "3 parameter markers, but 6 parameters were supplied" on EVERY row,
                # which (swallowed below) left resource_metrics permanently EMPTY and the
                # Utilisation column blank on all Azure SQL deployments.
                db.execute(_upsert, _params)
            except Exception:
                pass  # skip individual failures silently
        db.commit()
        db.close()
        logger.debug("Persisted metrics for %d resources", len(metrics_map))
    except Exception as exc:
        logger.warning("Failed to persist resource metrics: %s", exc)


def load_resource_metrics(ttl_hours: float = 6.0) -> Dict[str, dict]:
    """
    Load cached per-resource metrics that are newer than ttl_hours.

    Returns: { resource_id_lower: metrics_dict }
    The caller can skip the Monitor API call for any resource_id present here.
    """
    try:
        from datetime import timedelta
        cutoff = (
            datetime.now(tz=timezone.utc) - timedelta(hours=ttl_hours)
        ).isoformat()
        db   = _conn()
        rows = db.execute(
            "SELECT resource_id, payload FROM resource_metrics WHERE updated_at >= ?",
            (cutoff,),
        ).fetchall()
        db.close()
        return {r[0]: json.loads(r[1]) for r in rows}
    except Exception as exc:
        logger.warning("Failed to load resource metrics cache: %s", exc)
        return {}


def clear_resource_metrics() -> None:
    """Wipe the metrics cache (called when settings change / credentials rotate)."""
    try:
        db = _conn()
        db.execute("DELETE FROM resource_metrics")
        db.commit()
        db.close()
    except Exception:
        pass


# ── Cost snapshots (daily background job) ──────────────────────────────────
# A periodic background job downloads the full cost bundle (tenant total-daily
# series, 30-day trend, etc.) and persists it here. The dashboard / FinOps read
# the latest snapshot so charts are instant and never empty, even when live Cost
# Management calls are 429-throttled.

_MAX_COST_SNAPSHOTS = 10
_cost_snapshots_ensured = False


def _ensure_cost_snapshots_table(db) -> None:
    """Idempotently create the cost_snapshots table on either provider."""
    global _cost_snapshots_ensured
    if _cost_snapshots_ensured:
        return
    ddl = """
        CREATE TABLE IF NOT EXISTS cost_snapshots (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            captured_at      TEXT NOT NULL,
            subscription_key TEXT NOT NULL DEFAULT '',
            payload          TEXT NOT NULL
        )
    """
    try:
        db.execute(create_table_sql(ddl, indexed_cols={"captured_at"}) if is_azure_sql() else ddl)
        db.commit()  # Azure SQL connections are autocommit=False — must commit DDL
        _cost_snapshots_ensured = True
    except Exception as exc:
        logger.warning("Could not ensure cost_snapshots table: %s", exc)


def save_cost_snapshot(payload: dict, subscription_key: str = "") -> None:
    """Persist a cost bundle snapshot; keep only the last N."""
    try:
        captured_at = datetime.now(tz=timezone.utc).isoformat()
        db = _conn()
        _ensure_cost_snapshots_table(db)
        db.execute(
            "INSERT INTO cost_snapshots (captured_at, subscription_key, payload) VALUES (?, ?, ?)",
            (captured_at, subscription_key or "", json.dumps(payload, default=str)),
        )
        # Prune older snapshots beyond the retention limit.
        if is_azure_sql():
            db.execute(
                f"DELETE FROM cost_snapshots WHERE id NOT IN "
                f"(SELECT TOP {_MAX_COST_SNAPSHOTS} id FROM cost_snapshots ORDER BY id DESC)"
            )
        else:
            db.execute(
                f"DELETE FROM cost_snapshots WHERE id NOT IN "
                f"(SELECT id FROM cost_snapshots ORDER BY id DESC LIMIT {_MAX_COST_SNAPSHOTS})"
            )
        db.commit()
        db.close()
        logger.info("Cost snapshot persisted (captured %s)", captured_at)
    except Exception as exc:
        logger.warning("Failed to persist cost snapshot: %s", exc)


def load_latest_cost_snapshot() -> Optional[dict]:
    """Return the most recent cost snapshot payload (with captured_at), or None."""
    try:
        db = _conn()
        _ensure_cost_snapshots_table(db)
        row = db.execute(
            limit_sql("SELECT payload, captured_at FROM cost_snapshots ORDER BY id DESC", 1)
        ).fetchone()
        db.close()
        if row:
            payload = json.loads(row[0])
            if isinstance(payload, dict):
                payload["captured_at"] = row[1]
            return payload
        return None
    except Exception as exc:
        logger.warning("Failed to load cost snapshot: %s", exc)
        return None
