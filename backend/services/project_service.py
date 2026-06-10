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

from services.database import get_raw_connection, is_azure_sql

logger = logging.getLogger(__name__)


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
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    project_id = str(uuid.uuid4())
    # Normalise resource IDs to lowercase
    ids = [r.lower() for r in resource_ids if r]
    try:
        db = _conn()
        db.execute(
            "INSERT INTO projects (id, name, description, resource_ids, color, icon, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (project_id, name.strip(), description.strip(), json.dumps(ids), color, icon, now, now),
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
