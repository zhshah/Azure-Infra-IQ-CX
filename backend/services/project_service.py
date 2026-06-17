"""
Project service — saves named groups of resource IDs as "projects" or "workloads".

Projects are portal-first: the user browses all resources, selects/filters a subset,
and saves that selection with a name. No project-creation wizard. No mandatory onboarding.

Schema (SQLite table):
  projects
    id         TEXT  PRIMARY KEY  (uuid4)
    name       TEXT  NOT NULL
    description TEXT DEFAULT ''
    resource_ids TEXT NOT NULL  (JSON array of lowercased resource IDs)
    color       TEXT DEFAULT '#3b82f6'  (display accent color)
    icon        TEXT DEFAULT '📁'
    created_at  TEXT NOT NULL
    updated_at  TEXT NOT NULL
"""
from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from services.database import get_raw_connection, is_azure_sql, create_table_sql

logger = logging.getLogger(__name__)

# project_assessments stores tag-grounded AI assessment runs per project + category.
# DDL is written in SQLite dialect; create_table_sql() translates it for Azure SQL.
_PROJECT_ASSESSMENTS_DDL = """
CREATE TABLE IF NOT EXISTS project_assessments (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL,
    category       TEXT NOT NULL,
    category_label TEXT,
    score          INTEGER,
    score_label    TEXT,
    summary        TEXT,
    result_json    TEXT NOT NULL DEFAULT '{}',
    model          TEXT,
    resource_count INTEGER DEFAULT 0,
    created_at     TEXT NOT NULL
)
"""

_assessments_table_ensured = False

# Generic project metadata columns — added idempotently so a project works for ANY
# category/purpose (not just BCDR). Stored directly on the projects table so every
# project detail persists in the same row (incl. Azure SQL).
# (column_name, azure_sql_type, sqlite_type)
_METADATA_COLUMNS = [
    ("business_unit", "NVARCHAR(255)", "TEXT"),
    ("owner",         "NVARCHAR(255)", "TEXT"),
    ("focus_area",    "NVARCHAR(100)", "TEXT"),
    ("criticality",   "NVARCHAR(50)",  "TEXT"),
    ("environment",   "NVARCHAR(50)",  "TEXT"),
    ("dr_tier",       "NVARCHAR(50)",  "TEXT"),
    ("rto_target",    "NVARCHAR(50)",  "TEXT"),
    ("rpo_target",    "NVARCHAR(50)",  "TEXT"),
]
_METADATA_FIELDS = [c[0] for c in _METADATA_COLUMNS]
_metadata_columns_ensured = False


def _ensure_metadata_columns(db) -> None:
    """Idempotently add the generic metadata columns to the projects table on both
    SQLite and Azure SQL. No-op once present; marked done per process on success."""
    global _metadata_columns_ensured
    if _metadata_columns_ensured:
        return
    try:
        cur = db.cursor()
        if is_azure_sql():
            existing = {r[0] for r in cur.execute(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='projects'"
            ).fetchall()}
            for name, az_type, _lite in _METADATA_COLUMNS:
                if name not in existing:
                    cur.execute(f"ALTER TABLE projects ADD {name} {az_type}")
            db.commit()
        else:
            existing = {c[1] for c in cur.execute("PRAGMA table_info(projects)").fetchall()}
            for name, _az, lite_type in _METADATA_COLUMNS:
                if name not in existing:
                    cur.execute(f"ALTER TABLE projects ADD COLUMN {name} {lite_type}")
            db.commit()
        _metadata_columns_ensured = True
    except Exception as exc:
        logger.warning("ensure project metadata columns failed: %s", exc)


def _conn():
    db = get_raw_connection()
    if not is_azure_sql():
        db.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id           TEXT PRIMARY KEY,
                name         TEXT NOT NULL,
                description  TEXT DEFAULT '',
                resource_ids TEXT NOT NULL DEFAULT '[]',
                color        TEXT DEFAULT '#3b82f6',
                icon         TEXT DEFAULT '📁',
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL
            )
        """)
        db.commit()
    # Ensure the assessments table on BOTH backends (Azure SQL DDL is auto-translated,
    # idempotent via IF NOT EXISTS). Runs once per process.
    global _assessments_table_ensured
    if not _assessments_table_ensured:
        try:
            db.execute(create_table_sql(_PROJECT_ASSESSMENTS_DDL, indexed_cols={"id", "project_id"}))
            db.commit()
            _assessments_table_ensured = True
        except Exception as exc:
            logger.warning("project_assessments table ensure failed (will retry next call): %s", exc)
    # Ensure generic metadata columns exist on the projects table (both backends).
    _ensure_metadata_columns(db)
    return db


def _row_to_dict(row: dict) -> Dict[str, Any]:
    d = dict(row)
    d["resource_ids"] = json.loads(d.get("resource_ids") or "[]")
    d["resource_count"] = len(d["resource_ids"])
    return d


# ── CRUD ──────────────────────────────────────────────────────────────────────

def _cursor_rows_to_dicts(cursor) -> List[Dict[str, Any]]:
    cols = [col[0] for col in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def list_projects() -> List[Dict[str, Any]]:
    try:
        db = _conn()
        if is_azure_sql():
            cursor = db.cursor()
            cursor.execute("SELECT * FROM projects ORDER BY updated_at DESC")
            rows = _cursor_rows_to_dicts(cursor)
        else:
            db.row_factory = sqlite3.Row
            rows = [dict(r) for r in db.execute("SELECT * FROM projects ORDER BY updated_at DESC").fetchall()]
        db.close()
        return [_row_to_dict(r) for r in rows]
    except Exception as exc:
        logger.error("list_projects failed: %s", exc)
        return []


def get_project(project_id: str) -> Optional[Dict[str, Any]]:
    try:
        db = _conn()
        if is_azure_sql():
            cursor = db.cursor()
            cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
            rows = _cursor_rows_to_dicts(cursor)
            row = rows[0] if rows else None
        else:
            db.row_factory = sqlite3.Row
            r = db.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
            row = dict(r) if r else None
        db.close()
        return _row_to_dict(row) if row else None
    except Exception as exc:
        logger.error("get_project failed: %s", exc)
        return None


def create_project(
    name: str,
    resource_ids: List[str],
    description: str = "",
    color: str = "#3b82f6",
    icon: str = "📁",
    business_unit: Optional[str] = None,
    owner: Optional[str] = None,
    focus_area: Optional[str] = None,
    criticality: Optional[str] = None,
    environment: Optional[str] = None,
    dr_tier: Optional[str] = None,
    rto_target: Optional[str] = None,
    rpo_target: Optional[str] = None,
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    project_id = str(uuid.uuid4())
    # Normalise resource IDs to lowercase
    ids = [r.lower() for r in resource_ids if r]
    try:
        db = _conn()
        db.execute(
            "INSERT INTO projects (id, name, description, resource_ids, color, icon, created_at, updated_at, "
            "business_unit, owner, focus_area, criticality, environment, dr_tier, rto_target, rpo_target) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (project_id, name.strip(), (description or "").strip(), json.dumps(ids), color, icon, now, now,
             business_unit, owner, focus_area, criticality, environment, dr_tier, rto_target, rpo_target),
        )
        db.commit()
        db.close()
        logger.info("Created project '%s' with %d resources", name, len(ids))
        return get_project(project_id) or {}
    except Exception as exc:
        logger.error("create_project failed: %s", exc)
        raise


def update_project(
    project_id: str,
    name: Optional[str] = None,
    resource_ids: Optional[List[str]] = None,
    description: Optional[str] = None,
    color: Optional[str] = None,
    icon: Optional[str] = None,
    **metadata: Any,
) -> Optional[Dict[str, Any]]:
    existing = get_project(project_id)
    if not existing:
        return None
    now = datetime.now(timezone.utc).isoformat()
    updates: Dict[str, Any] = {"updated_at": now}
    if name is not None:
        updates["name"] = name.strip()
    if description is not None:
        updates["description"] = description.strip()
    if resource_ids is not None:
        updates["resource_ids"] = json.dumps([r.lower() for r in resource_ids if r])
    if color is not None:
        updates["color"] = color
    if icon is not None:
        updates["icon"] = icon
    # Generic metadata fields (focus_area, criticality, owner, …) — only known columns.
    for key in _METADATA_FIELDS:
        if key in metadata and metadata[key] is not None:
            updates[key] = metadata[key]

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [project_id]
    try:
        db = _conn()
        db.execute(f"UPDATE projects SET {set_clause} WHERE id = ?", values)
        db.commit()
        db.close()
        return get_project(project_id)
    except Exception as exc:
        logger.error("update_project failed: %s", exc)
        raise


def delete_project(project_id: str) -> bool:
    try:
        db = _conn()
        affected = db.execute("DELETE FROM projects WHERE id = ?", (project_id,)).rowcount
        db.commit()
        db.close()
        return affected > 0
    except Exception as exc:
        logger.error("delete_project failed: %s", exc)
        return False


def add_resources_to_project(project_id: str, resource_ids: List[str]) -> Optional[Dict[str, Any]]:
    """Append resources to an existing project (no duplicates)."""
    existing = get_project(project_id)
    if not existing:
        return None
    current = set(existing["resource_ids"])
    new_ids = current | {r.lower() for r in resource_ids if r}
    return update_project(project_id, resource_ids=list(new_ids))


def remove_resources_from_project(project_id: str, resource_ids: List[str]) -> Optional[Dict[str, Any]]:
    """Remove specific resources from a project."""
    existing = get_project(project_id)
    if not existing:
        return None
    remove_set = {r.lower() for r in resource_ids}
    remaining = [r for r in existing["resource_ids"] if r not in remove_set]
    return update_project(project_id, resource_ids=remaining)


# ── Project assessments (tag-grounded AI runs per category) ────────────────────

def _assessment_row_to_dict(row: dict, include_result: bool = True) -> Dict[str, Any]:
    d = dict(row)
    raw = d.pop("result_json", None)
    if include_result:
        try:
            d["result"] = json.loads(raw) if raw else {}
        except Exception:
            d["result"] = {}
    return d


def save_project_assessment(project_id: str, result: Dict[str, Any]) -> Dict[str, Any]:
    """Persist a completed AI assessment run for a project. Returns the stored record."""
    now = datetime.now(timezone.utc).isoformat()
    assessment_id = str(uuid.uuid4())
    category = str(result.get("category", ""))
    category_label = str(result.get("category_label", ""))
    score = result.get("overall_score")
    score = int(score) if isinstance(score, (int, float)) else None
    score_label = str(result.get("score_label", ""))
    summary = str(result.get("executive_summary", ""))[:2000]
    model = str(result.get("model", ""))
    resource_count = result.get("resource_count")
    resource_count = int(resource_count) if isinstance(resource_count, (int, float)) else 0
    try:
        db = _conn()
        db.execute(
            "INSERT INTO project_assessments "
            "(id, project_id, category, category_label, score, score_label, summary, result_json, model, resource_count, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (assessment_id, project_id, category, category_label, score, score_label, summary,
             json.dumps(result), model, resource_count, now),
        )
        db.commit()
        db.close()
        logger.info("Saved project assessment %s (project=%s category=%s score=%s)",
                    assessment_id, project_id, category, score)
        return get_project_assessment(assessment_id) or {}
    except Exception as exc:
        logger.error("save_project_assessment failed: %s", exc)
        raise


def list_project_assessments(project_id: str) -> List[Dict[str, Any]]:
    """List assessment runs for a project (newest first), without the full result blob."""
    try:
        db = _conn()
        if is_azure_sql():
            cursor = db.cursor()
            cursor.execute("SELECT * FROM project_assessments WHERE project_id = ? ORDER BY created_at DESC", (project_id,))
            rows = _cursor_rows_to_dicts(cursor)
        else:
            db.row_factory = sqlite3.Row
            rows = [dict(r) for r in db.execute(
                "SELECT * FROM project_assessments WHERE project_id = ? ORDER BY created_at DESC",
                (project_id,)).fetchall()]
        db.close()
        return [_assessment_row_to_dict(r, include_result=False) for r in rows]
    except Exception as exc:
        logger.error("list_project_assessments failed: %s", exc)
        return []


def get_project_assessment(assessment_id: str) -> Optional[Dict[str, Any]]:
    """Get a single assessment run with its full result payload."""
    try:
        db = _conn()
        if is_azure_sql():
            cursor = db.cursor()
            cursor.execute("SELECT * FROM project_assessments WHERE id = ?", (assessment_id,))
            rows = _cursor_rows_to_dicts(cursor)
            row = rows[0] if rows else None
        else:
            db.row_factory = sqlite3.Row
            r = db.execute("SELECT * FROM project_assessments WHERE id = ?", (assessment_id,)).fetchone()
            row = dict(r) if r else None
        db.close()
        return _assessment_row_to_dict(row, include_result=True) if row else None
    except Exception as exc:
        logger.error("get_project_assessment failed: %s", exc)
        return None


def delete_project_assessment(assessment_id: str) -> bool:
    try:
        db = _conn()
        affected = db.execute("DELETE FROM project_assessments WHERE id = ?", (assessment_id,)).rowcount
        db.commit()
        db.close()
        return affected > 0
    except Exception as exc:
        logger.error("delete_project_assessment failed: %s", exc)
        return False
