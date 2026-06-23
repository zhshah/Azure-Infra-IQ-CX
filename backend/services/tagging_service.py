"""
Custom Resource Tagging Service

Manages user-defined (portal) tags alongside Azure-native tags.
All data lives in SQLite — two tables:
  resource_custom_tags  — per-resource key/value tags
  custom_tag_schema     — what tag keys are valid (user-defined schema)

Features
--------
- Per-resource CRUD (set / delete / get)
- Bulk apply tags to a selection of resources
- Tag schema management  (create / edit / delete tag keys)
- Export CSV / Import CSV
- Merge Azure tags + custom tags for display
"""
from __future__ import annotations

import csv
import io
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from services.database import get_raw_connection, is_azure_sql, limit_sql, upsert_conflict_sql

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _conn():
    """Shared connection factory — tables are created by persistence_service._conn()."""
    db = get_raw_connection()
    if not is_azure_sql():
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
        db.commit()
    return db


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


# ── Tag Schema ────────────────────────────────────────────────────────────────

# Built-in common tag keys that customers typically use — pre-seeded on first call
_BUILTIN_SCHEMA = [
    {"tag_key": "Application",  "display_name": "Application",   "tag_type": "text",  "category": "Business",  "color": "#6366f1"},
    {"tag_key": "Owner",        "display_name": "Owner",          "tag_type": "text",  "category": "Business",  "color": "#8b5cf6"},
    {"tag_key": "Environment",  "display_name": "Environment",    "tag_type": "enum",  "category": "Business",  "color": "#22c55e",
     "enum_values": ["Production", "Staging", "UAT", "Dev", "Test", "Sandbox", "Shared"]},
    {"tag_key": "CostCenter",   "display_name": "Cost Center",    "tag_type": "text",  "category": "Business",  "color": "#f59e0b"},
    {"tag_key": "DataClass",    "display_name": "Data Classification", "tag_type": "enum", "category": "Compliance", "color": "#ef4444",
     "enum_values": ["Public", "Internal", "Confidential", "Restricted", "Secret"]},
    {"tag_key": "Criticality",  "display_name": "Business Criticality", "tag_type": "enum", "category": "BCDR",  "color": "#f97316",
     "enum_values": ["Mission Critical", "Business Critical", "Business Important", "Business Normal", "Non-Business"]},
    {"tag_key": "DR_Tier",      "display_name": "DR Tier",         "tag_type": "enum", "category": "BCDR",    "color": "#0ea5e9",
     "enum_values": ["Tier1-Hot", "Tier2-Warm", "Tier3-Cold", "Tier4-Archive", "Excluded"]},
    {"tag_key": "RPO",          "display_name": "RPO Target",      "tag_type": "enum", "category": "BCDR",    "color": "#06b6d4",
     "enum_values": ["0 (Zero)", "< 15 min", "< 1 hr", "< 4 hrs", "< 24 hrs", "Best Effort"]},
    {"tag_key": "RTO",          "display_name": "RTO Target",      "tag_type": "enum", "category": "BCDR",    "color": "#06b6d4",
     "enum_values": ["< 1 hr", "< 4 hrs", "< 8 hrs", "< 24 hrs", "< 72 hrs", "Best Effort"]},
    {"tag_key": "WorkloadName", "display_name": "Workload Name",   "tag_type": "text", "category": "Business", "color": "#84cc16"},
    {"tag_key": "TeamSlack",    "display_name": "Team / Slack",    "tag_type": "text", "category": "Business", "color": "#a78bfa"},
    {"tag_key": "ReviewDate",   "display_name": "Review Date",     "tag_type": "text", "category": "Governance","color": "#6b7280"},
    {"tag_key": "MigrationStatus","display_name": "Migration Status","tag_type": "enum","category":"Migration","color":"#f97316",
     "enum_values": ["Not Started", "Assessed", "In Progress", "Migrated", "Decommission"]},
]


def _seed_schema_if_empty(db) -> None:
    count = db.execute("SELECT COUNT(*) FROM custom_tag_schema").fetchone()[0]
    if count == 0:
        now = _now()
        for entry in _BUILTIN_SCHEMA:
            try:
                db.execute("""
                    INSERT INTO custom_tag_schema
                        (tag_key, display_name, tag_type, enum_values, category, is_required, color, created_at)
                    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
                """, (
                    entry["tag_key"], entry["display_name"], entry.get("tag_type", "text"),
                    json.dumps(entry.get("enum_values", [])), entry.get("category", "Custom"),
                    entry.get("color", "#6b7280"), now,
                ))
            except Exception:
                pass  # ignore duplicates
        db.commit()


def get_tag_schema() -> List[dict]:
    """Return all tag key definitions, seeding built-ins on first call."""
    db = _conn()
    _seed_schema_if_empty(db)
    rows = db.execute(
        "SELECT tag_key, display_name, tag_type, enum_values, category, is_required, color, created_at "
        "FROM custom_tag_schema ORDER BY category, display_name"
    ).fetchall()
    db.close()
    return [
        {
            "tag_key": r[0], "display_name": r[1], "tag_type": r[2],
            "enum_values": json.loads(r[3] or "[]"), "category": r[4],
            "is_required": bool(r[5]), "color": r[6], "created_at": r[7],
        }
        for r in rows
    ]


def upsert_tag_schema(entry: dict) -> dict:
    """Create or update a tag key definition."""
    now = _now()
    db  = _conn()
    _upsert = upsert_conflict_sql(
        "custom_tag_schema",
        insert_cols=["tag_key", "display_name", "tag_type", "enum_values", "category", "is_required", "color", "created_at"],
        pk_cols=["tag_key"],
        update_cols=["display_name", "tag_type", "enum_values", "category", "is_required", "color"],
    )
    _params = (
        entry["tag_key"], entry.get("display_name", entry["tag_key"]),
        entry.get("tag_type", "text"),
        json.dumps(entry.get("enum_values", [])),
        entry.get("category", "Custom"),
        1 if entry.get("is_required") else 0,
        entry.get("color", "#6b7280"),
        now,
    )
    if is_azure_sql():
        _params = _params + _params
    db.execute(_upsert, _params)
    db.commit()
    db.close()
    return {**entry, "created_at": now}


def delete_tag_schema(tag_key: str) -> None:
    """Remove a tag key definition AND all resource values for that key."""
    db = _conn()
    db.execute("DELETE FROM custom_tag_schema WHERE tag_key = ?", (tag_key,))
    db.execute("DELETE FROM resource_custom_tags WHERE tag_key = ?", (tag_key,))
    db.commit()
    db.close()


# ── Per-resource Tags ─────────────────────────────────────────────────────────

def get_custom_tags(resource_id: str) -> Dict[str, str]:
    """Return all custom tags for a single resource."""
    db = _conn()
    rows = db.execute(
        "SELECT tag_key, tag_value FROM resource_custom_tags WHERE resource_id = ?",
        (resource_id.lower(),)
    ).fetchall()
    db.close()
    return {r[0]: r[1] for r in rows}


def set_custom_tag(resource_id: str, tag_key: str, tag_value: str) -> None:
    now = _now()
    db  = _conn()
    _upsert = upsert_conflict_sql(
        "resource_custom_tags",
        insert_cols=["resource_id", "tag_key", "tag_value", "source", "created_at", "updated_at"],
        pk_cols=["resource_id", "tag_key"],
        update_cols=["tag_value", "updated_at"],
    )
    _params = (resource_id.lower(), tag_key, tag_value, 'user', now, now)
    if is_azure_sql():
        _params = _params + _params
    db.execute(_upsert, _params)
    db.commit()
    db.close()


def set_resource_tags(resource_id: str, tags: Dict[str, str]) -> None:
    """Replace ALL custom tags for a resource with the provided dict."""
    now = _now()
    db  = _conn()
    db.execute("DELETE FROM resource_custom_tags WHERE resource_id = ?", (resource_id.lower(),))
    for k, v in tags.items():
        db.execute("""
            INSERT INTO resource_custom_tags (resource_id, tag_key, tag_value, source, created_at, updated_at)
            VALUES (?, ?, ?, 'user', ?, ?)
        """, (resource_id.lower(), k, v, now, now))
    db.commit()
    db.close()


def delete_custom_tag(resource_id: str, tag_key: str) -> None:
    db = _conn()
    db.execute(
        "DELETE FROM resource_custom_tags WHERE resource_id = ? AND tag_key = ?",
        (resource_id.lower(), tag_key),
    )
    db.commit()
    db.close()


def bulk_set_tags(resource_ids: List[str], tags: Dict[str, str]) -> int:
    """Apply the same tags dict to multiple resources (merge, not replace)."""
    now   = _now()
    db    = _conn()
    count = 0
    _upsert = upsert_conflict_sql(
        "resource_custom_tags",
        insert_cols=["resource_id", "tag_key", "tag_value", "source", "created_at", "updated_at"],
        pk_cols=["resource_id", "tag_key"],
        update_cols=["tag_value", "updated_at"],
    )
    for rid in resource_ids:
        for k, v in tags.items():
            _params = (rid.lower(), k, v, 'user', now, now)
            if is_azure_sql():
                _params = _params + _params
            db.execute(_upsert, _params)
            count += 1
    db.commit()
    db.close()
    return count


def get_all_custom_tags(resource_ids: Optional[List[str]] = None) -> Dict[str, Dict[str, str]]:
    """
    Return {resource_id: {tag_key: tag_value}}.
    If resource_ids is None, return all stored custom tags.
    """
    db = _conn()
    if resource_ids:
        placeholders = ",".join("?" * len(resource_ids))
        rows = db.execute(
            f"SELECT resource_id, tag_key, tag_value FROM resource_custom_tags "
            f"WHERE resource_id IN ({placeholders})",
            [r.lower() for r in resource_ids],
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT resource_id, tag_key, tag_value FROM resource_custom_tags"
        ).fetchall()
    db.close()
    result: Dict[str, Dict[str, str]] = {}
    for rid, k, v in rows:
        result.setdefault(rid, {})[k] = v
    return result


def get_tag_statistics() -> dict:
    """Usage statistics — most-used keys, coverage %, unique values."""
    db = _conn()
    key_counts = dict(db.execute(
        limit_sql("SELECT tag_key, COUNT(DISTINCT resource_id) FROM resource_custom_tags GROUP BY tag_key ORDER BY 2 DESC", 20)
    ).fetchall())
    total_tagged = db.execute(
        "SELECT COUNT(DISTINCT resource_id) FROM resource_custom_tags"
    ).fetchone()[0]
    total_tags = db.execute("SELECT COUNT(*) FROM resource_custom_tags").fetchone()[0]
    db.close()
    return {"key_counts": key_counts, "total_tagged_resources": total_tagged, "total_tag_values": total_tags}


# ── Export / Import ───────────────────────────────────────────────────────────

def export_tags_csv() -> str:
    """Export all custom tags to CSV string."""
    db   = _conn()
    rows = db.execute(
        "SELECT resource_id, tag_key, tag_value, source, updated_at "
        "FROM resource_custom_tags ORDER BY resource_id, tag_key"
    ).fetchall()
    db.close()
    buf = io.StringIO()
    w   = csv.writer(buf)
    w.writerow(["resource_id", "tag_key", "tag_value", "source", "updated_at"])
    w.writerows(rows)
    return buf.getvalue()


def import_tags_csv(csv_text: str) -> dict:
    """Import tags from CSV string. Merges with existing (upsert)."""
    reader   = csv.DictReader(io.StringIO(csv_text))
    now      = _now()
    db       = _conn()
    imported = 0
    errors: List[str] = []
    _upsert = upsert_conflict_sql(
        "resource_custom_tags",
        insert_cols=["resource_id", "tag_key", "tag_value", "source", "created_at", "updated_at"],
        pk_cols=["resource_id", "tag_key"],
        update_cols=["tag_value", "updated_at"],
    )
    for row in reader:
        try:
            rid = row.get("resource_id", "").lower().strip()
            key = row.get("tag_key", "").strip()
            val = row.get("tag_value", "").strip()
            if not rid or not key:
                continue
            _params = (rid, key, val, 'import', now, now)
            if is_azure_sql():
                _params = _params + _params
            db.execute(_upsert, _params)
            imported += 1
        except Exception as exc:
            errors.append(str(exc))
    db.commit()
    db.close()
    return {"imported": imported, "errors": errors[:5]}


# ── Resource Snapshots ────────────────────────────────────────────────────────

def save_resource_snapshot(resource: dict, change_type: str = "snapshot") -> None:
    """Save a point-in-time snapshot of a resource's key properties."""
    try:
        db = _conn()
        # On Azure SQL the table is created by migration 003 (raw SQLite DDL with
        # AUTOINCREMENT/IF NOT EXISTS is invalid T-SQL). Only self-create on SQLite.
        if not is_azure_sql():
            db.execute("""
                CREATE TABLE IF NOT EXISTS resource_snapshots (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    resource_id TEXT NOT NULL,
                    captured_at TEXT NOT NULL,
                    sku         TEXT,
                    location    TEXT,
                    tags        TEXT,
                    config      TEXT,
                    status      TEXT,
                    change_type TEXT DEFAULT 'snapshot'
                )
            """)
        db.execute("""
            INSERT INTO resource_snapshots (resource_id, captured_at, sku, location, tags, config, status, change_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            resource.get("resource_id", "").lower(),
            _now(),
            resource.get("sku"),
            resource.get("location"),
            json.dumps(resource.get("tags", {})),
            json.dumps({
                "resource_type": resource.get("resource_type"),
                "resource_group": resource.get("resource_group"),
                "subscription_id": resource.get("subscription_id"),
                "power_state": resource.get("power_state"),
                "final_score": resource.get("final_score"),
                "cost_current_month": resource.get("cost_current_month"),
            }),
            resource.get("power_state") or resource.get("app_state"),
            change_type,
        ))
        db.commit()
        db.close()
    except Exception as exc:
        logger.warning("Snapshot save failed for %s: %s", resource.get("resource_id", "?"), exc)


def get_resource_snapshots(resource_id: str, limit: int = 20) -> List[dict]:
    """Return recent snapshots for a resource, newest first."""
    try:
        db   = _conn()
        rows = db.execute(
            limit_sql(
                "SELECT id, captured_at, sku, location, tags, status, change_type "
                "FROM resource_snapshots WHERE resource_id = ? ORDER BY id DESC", limit),
            (resource_id.lower(),),
        ).fetchall()
        db.close()
        return [
            {
                "id": r[0], "captured_at": r[1], "sku": r[2],
                "location": r[3], "tags": json.loads(r[4] or "{}"),
                "status": r[5], "change_type": r[6],
            }
            for r in rows
        ]
    except Exception as exc:
        logger.warning("Snapshot load failed: %s", exc)
        return []


# ── AI Analysis Cache ─────────────────────────────────────────────────────────

def save_ai_analysis(analysis_type: str, subject_id: Optional[str], model: str,
                     result: dict, prompt_tokens: int = 0) -> int:
    """Persist an AI analysis result."""
    try:
        db = _conn()
        if not is_azure_sql():
            db.execute("""
                CREATE TABLE IF NOT EXISTS ai_analyses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    analysis_type TEXT NOT NULL, subject_id TEXT,
                    analyzed_at TEXT NOT NULL, model TEXT NOT NULL,
                    prompt_tokens INTEGER DEFAULT 0, result TEXT NOT NULL
                )
            """)
        cur = db.execute(
            "INSERT INTO ai_analyses (analysis_type, subject_id, analyzed_at, model, prompt_tokens, result) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (analysis_type, subject_id, _now(), model, prompt_tokens, json.dumps(result, default=str)),
        )
        # pyodbc (Azure SQL) cursors don't expose lastrowid — the row id isn't
        # used by callers, so degrade gracefully instead of raising.
        try:
            row_id = cur.lastrowid
        except Exception:
            row_id = -1
        # Keep only last 50 analyses per type
        if is_azure_sql():
            db.execute(
                "DELETE FROM ai_analyses WHERE analysis_type = ? AND id NOT IN "
                "(SELECT TOP 50 id FROM ai_analyses WHERE analysis_type = ? ORDER BY id DESC)",
                (analysis_type, analysis_type),
            )
        else:
            db.execute(
                "DELETE FROM ai_analyses WHERE analysis_type = ? AND id NOT IN "
                "(SELECT id FROM ai_analyses WHERE analysis_type = ? ORDER BY id DESC LIMIT 50)",
                (analysis_type, analysis_type),
            )
        db.commit()
        db.close()
        return row_id
    except Exception as exc:
        logger.warning("AI analysis save failed: %s", exc)
        return -1


def get_latest_ai_analysis(analysis_type: str, subject_id: Optional[str] = None,
                            max_age_hours: int = 24) -> Optional[dict]:
    """Return the most recent cached AI analysis, or None if stale/missing."""
    try:
        from datetime import timedelta
        cutoff = (datetime.now(tz=timezone.utc) - timedelta(hours=max_age_hours)).isoformat()
        db = _conn()
        if not is_azure_sql():
            db.execute("""
                CREATE TABLE IF NOT EXISTS ai_analyses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, analysis_type TEXT NOT NULL,
                    subject_id TEXT, analyzed_at TEXT NOT NULL, model TEXT NOT NULL,
                    prompt_tokens INTEGER DEFAULT 0, result TEXT NOT NULL
                )
            """)
        if subject_id is not None:
            row = db.execute(
                limit_sql(
                    "SELECT result, analyzed_at, model FROM ai_analyses "
                    "WHERE analysis_type = ? AND subject_id = ? AND analyzed_at > ? "
                    "ORDER BY id DESC", 1),
                (analysis_type, subject_id, cutoff),
            ).fetchone()
        else:
            row = db.execute(
                limit_sql(
                    "SELECT result, analyzed_at, model FROM ai_analyses "
                    "WHERE analysis_type = ? AND (subject_id IS NULL OR subject_id = '') AND analyzed_at > ? "
                    "ORDER BY id DESC", 1),
                (analysis_type, cutoff),
            ).fetchone()
        db.close()
        if row:
            return {"result": json.loads(row[0]), "analyzed_at": row[1], "model": row[2]}
        return None
    except Exception as exc:
        logger.warning("AI analysis load failed: %s", exc)
        return None


def get_latest_ai_analysis_any_scope(analysis_type_base: str,
                                     max_age_hours: int = 24) -> Optional[dict]:
    """Return the most recent cached AI analysis for a module regardless of its
    scope suffix.

    Per-module analyses are persisted under a scope-fingerprinted analysis_type
    (e.g. ``ai_security_posture:d77bfc7eed7d``) so each subscription/scope slice
    caches independently. The home-page AI insights summary, however, only knows
    the bare module key (``ai_security_posture``). Without this scope-tolerant
    lookup every card reverts to "Not analyzed yet" after a process restart even
    though a full analysis is persisted. Matches the bare key OR any
    ``base:<scope>`` variant and returns the freshest one.
    """
    try:
        from datetime import timedelta
        cutoff = (datetime.now(tz=timezone.utc) - timedelta(hours=max_age_hours)).isoformat()
        db = _conn()
        if not is_azure_sql():
            db.execute("""
                CREATE TABLE IF NOT EXISTS ai_analyses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, analysis_type TEXT NOT NULL,
                    subject_id TEXT, analyzed_at TEXT NOT NULL, model TEXT NOT NULL,
                    prompt_tokens INTEGER DEFAULT 0, result TEXT NOT NULL
                )
            """)
        row = db.execute(
            limit_sql(
                "SELECT result, analyzed_at, model FROM ai_analyses "
                "WHERE (analysis_type = ? OR analysis_type LIKE ?) "
                "AND (subject_id IS NULL OR subject_id = '') AND analyzed_at > ? "
                "ORDER BY analyzed_at DESC, id DESC", 1),
            (analysis_type_base, analysis_type_base + ":%", cutoff),
        ).fetchone()
        db.close()
        if row:
            return {"result": json.loads(row[0]), "analyzed_at": row[1], "model": row[2]}
        return None
    except Exception as exc:
        logger.warning("AI analysis (any-scope) load failed: %s", exc)
        return None
