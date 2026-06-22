"""
BCDR Metadata Service - Phase 1 Planning

Manages user-defined BCDR categorizations for resources.
Users categorize resources on the Resources page with:
- Criticality (Critical/High/Medium/Low)
- DR Tier (Tier 0/1/2/3)
- RTO Target (< 1 hr / < 4 hrs / < 8 hrs / < 24 hrs / Best Effort)
- RPO Target (< 15 min / < 1 hr / < 4 hrs / < 24 hrs / Best Effort)
- Business Function (e.g., "Production API", "Analytics", "Dev/Test")
- Notes (free text)

This metadata is:
1. Saved to SQLite database
2. Used by AI during BCDR analysis for better recommendations
3. Displayed in affected resources lists
"""
from __future__ import annotations

import base64
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from services.database import get_raw_connection, is_azure_sql, create_table_sql

logger = logging.getLogger(__name__)


# ── Database ──────────────────────────────────────────────────────────────────

BCDR_FIELDS = [
    "criticality", "dr_tier", "rto_target", "rpo_target", "business_function", "notes",
    # Consultant intake fields (the questions a BCDR vendor asks):
    "target_region", "desired_sku", "environment", "business_owner",
    "financial_loss_per_hour", "app_dependencies", "data_classification", "compliance",
]

_BASE_DDL = """
CREATE TABLE IF NOT EXISTS resource_bcdr_metadata (
    resource_id         TEXT PRIMARY KEY,
    criticality         TEXT,
    dr_tier             TEXT,
    rto_target          TEXT,
    rpo_target          TEXT,
    business_function   TEXT,
    notes               TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
)
"""

_schema_ready = False


def _ensure_columns(db) -> None:
    """Add any BCDR_FIELDS columns missing from the table (idempotent, both backends)."""
    cur = db.cursor()
    if is_azure_sql():
        existing = {r[0].lower() for r in cur.execute(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='resource_bcdr_metadata'"
        ).fetchall()}
        for f in BCDR_FIELDS:
            if f.lower() not in existing:
                cur.execute(f"ALTER TABLE resource_bcdr_metadata ADD {f} NVARCHAR(MAX)")
    else:
        existing = {c[1].lower() for c in cur.execute("PRAGMA table_info(resource_bcdr_metadata)").fetchall()}
        for f in BCDR_FIELDS:
            if f.lower() not in existing:
                cur.execute(f"ALTER TABLE resource_bcdr_metadata ADD COLUMN {f} TEXT")
    db.commit()


def _conn():
    """Get a DB connection; ensure the table + all BCDR_FIELDS columns exist (both backends)."""
    db = get_raw_connection()
    global _schema_ready
    if not _schema_ready:
        try:
            db.execute(create_table_sql(_BASE_DDL, indexed_cols={"resource_id"}))
            db.commit()
            _ensure_columns(db)
            _schema_ready = True
        except Exception as exc:
            logger.warning("resource_bcdr_metadata schema ensure failed (will retry next call): %s", exc)
    return db


def _rows_to_dicts(cursor) -> List[dict]:
    cols = [c[0] for c in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


# ── CRUD Operations ───────────────────────────────────────────────────────────

def get_bcdr_metadata(resource_id: str) -> Optional[dict]:
    """Get BCDR metadata for a single resource."""
    db = _conn()
    try:
        cur = db.cursor()
        cur.execute("SELECT * FROM resource_bcdr_metadata WHERE resource_id = ?", (resource_id,))
        rows = _rows_to_dicts(cur)
        return rows[0] if rows else None
    finally:
        db.close()


def get_all_bcdr_metadata() -> Dict[str, dict]:
    """Get all BCDR metadata as dict keyed by resource_id."""
    db = _conn()
    try:
        cur = db.cursor()
        cur.execute("SELECT * FROM resource_bcdr_metadata")
        return {r["resource_id"]: r for r in _rows_to_dicts(cur)}
    finally:
        db.close()


def save_bcdr_metadata(resource_id: str, metadata: dict) -> dict:
    """
    Save or update BCDR metadata for a resource.
    
    Args:
        resource_id: Azure resource ID
        metadata: Dict with keys: criticality, dr_tier, rto_target, rpo_target, business_function, notes
    
    Returns:
        Saved metadata dict
    """
    db = _conn()
    try:
        now = datetime.now(timezone.utc).isoformat()
        provided = [f for f in BCDR_FIELDS if f in metadata]

        exists = db.execute(
            "SELECT 1 FROM resource_bcdr_metadata WHERE resource_id = ?", (resource_id,)
        ).fetchone()

        if exists:
            if provided:
                set_clause = ", ".join(f"{f} = ?" for f in provided) + ", updated_at = ?"
                values = [metadata.get(f) for f in provided] + [now, resource_id]
                db.execute(f"UPDATE resource_bcdr_metadata SET {set_clause} WHERE resource_id = ?", values)
                db.commit()
        else:
            cols = ["resource_id"] + provided + ["created_at", "updated_at"]
            placeholders = ", ".join("?" for _ in cols)
            values = [resource_id] + [metadata.get(f) for f in provided] + [now, now]
            db.execute(
                f"INSERT INTO resource_bcdr_metadata ({', '.join(cols)}) VALUES ({placeholders})",
                values,
            )
            db.commit()

        logger.info("Saved BCDR metadata for %s: %s / %s", resource_id,
                    metadata.get("criticality"), metadata.get("dr_tier"))
        return get_bcdr_metadata(resource_id)
    finally:
        db.close()


def bulk_save_bcdr_metadata(updates: List[Dict[str, Any]]) -> int:
    """
    Bulk save BCDR metadata for multiple resources.
    
    Args:
        updates: List of dicts with 'resource_id' and metadata fields
    
    Returns:
        Number of resources updated
    """
    count = 0
    for item in updates:
        resource_id = item.get("resource_id")
        if not resource_id:
            continue
        
        save_bcdr_metadata(resource_id, item)
        count += 1
    
    return count


def delete_bcdr_metadata(resource_id: str) -> bool:
    """Delete BCDR metadata for a resource."""
    db = _conn()
    try:
        db.execute("DELETE FROM resource_bcdr_metadata WHERE resource_id = ?", (resource_id,))
        db.commit()
        logger.info(f"Deleted BCDR metadata for {resource_id}")
        return True
    finally:
        db.close()


# ── Enrichment ────────────────────────────────────────────────────────────────

def enrich_resources_with_bcdr_metadata(resources: List[dict]) -> List[dict]:
    """
    Enrich resource list with BCDR metadata.
    Adds bcdr_metadata field to each resource.
    """
    metadata_map = get_all_bcdr_metadata()
    
    for resource in resources:
        resource_id = resource.get("resource_id")
        if resource_id and resource_id in metadata_map:
            resource["bcdr_metadata"] = metadata_map[resource_id]
        else:
            resource["bcdr_metadata"] = None
    
    return resources


# ── Statistics ────────────────────────────────────────────────────────────────

def get_bcdr_metadata_stats() -> dict:
    """Get statistics about BCDR metadata coverage."""
    db = _conn()
    try:
        total = db.execute("SELECT COUNT(*) FROM resource_bcdr_metadata").fetchone()[0]
        
        criticality_counts = {}
        for row in db.execute("SELECT criticality, COUNT(*) FROM resource_bcdr_metadata WHERE criticality IS NOT NULL GROUP BY criticality").fetchall():
            criticality_counts[row[0]] = row[1]
        
        dr_tier_counts = {}
        for row in db.execute("SELECT dr_tier, COUNT(*) FROM resource_bcdr_metadata WHERE dr_tier IS NOT NULL GROUP BY dr_tier").fetchall():
            dr_tier_counts[row[0]] = row[1]
        
        return {
            "total_resources_with_metadata": total,
            "by_criticality": criticality_counts,
            "by_dr_tier": dr_tier_counts
        }
    finally:
        db.close()


# ── Phase 1 metadata → AI grounding tags ──────────────────────────────────────
# Map the Phase 1 BCDR fields onto canonical custom-tag keys the assessment prompt
# already understands (Criticality, DR_Tier, RPO, RTO, Environment, Owner, DataClass),
# so the user's Phase 1 planning inputs ground the project AI assessment.
BCDR_TAG_MAP = {
    "criticality":             "Criticality",
    "dr_tier":                 "DR_Tier",
    "rto_target":              "RTO",
    "rpo_target":              "RPO",
    "business_function":       "BusinessFunction",
    "target_region":           "TargetRegion",
    "desired_sku":             "DesiredSKU",
    "environment":             "Environment",
    "business_owner":          "Owner",
    "financial_loss_per_hour": "FinancialLossPerHour",
    "app_dependencies":        "AppDependencies",
    "data_classification":     "DataClass",
    "compliance":              "Compliance",
    "notes":                   "PlanningNotes",
}


def metadata_to_tags(meta: Optional[dict]) -> Dict[str, str]:
    """Convert a Phase 1 BCDR metadata row into canonical custom-tag pairs (non-empty only)."""
    if not meta:
        return {}
    out: Dict[str, str] = {}
    for field, tag in BCDR_TAG_MAP.items():
        val = meta.get(field)
        if val is not None and str(val).strip() != "":
            out[tag] = str(val).strip()
    return out


# ── Phase 1 supporting documents / inputs (stored in Azure SQL) ────────────────
# Users upload supporting inputs as part of the BCDR planning & assessment exercise
# (existing DR runbooks, architecture docs, requirements, RTO/RPO sign-off, etc.).
# Stored in Azure SQL alongside the categorization metadata. Text-extractable files
# also keep an `extracted_text` copy so the content can ground the AI assessment.

MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024  # 8 MB per file
_TEXT_EXTS = {".txt", ".md", ".csv", ".tsv", ".json", ".yaml", ".yml", ".log", ".xml", ".html", ".htm", ".ini", ".env", ".rtf"}

_ATTACH_DDL = """
CREATE TABLE IF NOT EXISTS bcdr_attachments (
    id              TEXT PRIMARY KEY,
    resource_id     TEXT,
    project_id      TEXT,
    filename        TEXT NOT NULL,
    content_type    TEXT,
    size_bytes      INTEGER,
    extracted_text  TEXT,
    content_b64     TEXT,
    uploaded_at     TEXT NOT NULL
)
"""

_attach_ready = False


def _attach_conn():
    db = get_raw_connection()
    global _attach_ready
    if not _attach_ready:
        try:
            db.execute(create_table_sql(_ATTACH_DDL, indexed_cols={"id", "resource_id", "project_id"}))
            db.commit()
            _attach_ready = True
        except Exception as exc:
            logger.warning("bcdr_attachments schema ensure failed (will retry next call): %s", exc)
    return db


def _extract_text(filename: str, content_type: str, raw: bytes) -> str:
    """Best-effort text extraction for text-like files (no heavy binary parsers)."""
    ext = os.path.splitext(filename or "")[1].lower()
    ct = (content_type or "").lower()
    looks_textual = ext in _TEXT_EXTS or ct.startswith("text/") or "json" in ct or "xml" in ct or "csv" in ct or "yaml" in ct
    if not looks_textual:
        return ""
    try:
        text = raw.decode("utf-8", errors="replace")
    except Exception:
        return ""
    # Cap the extracted text so a single document can't blow the AI context window.
    return text[:20000]


def save_attachment(resource_id: Optional[str], project_id: Optional[str],
                    filename: str, content_type: str, raw: bytes) -> dict:
    """Persist an uploaded planning input to Azure SQL. Returns its metadata (no content)."""
    if raw is None:
        raw = b""
    if len(raw) > MAX_ATTACHMENT_BYTES:
        raise ValueError(f"File exceeds the {MAX_ATTACHMENT_BYTES // (1024 * 1024)} MB limit")
    att_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    extracted = _extract_text(filename, content_type, raw)
    content_b64 = base64.b64encode(raw).decode("ascii")
    db = _attach_conn()
    try:
        db.execute(
            "INSERT INTO bcdr_attachments (id, resource_id, project_id, filename, content_type, "
            "size_bytes, extracted_text, content_b64, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (att_id, resource_id, project_id, filename, content_type, len(raw), extracted, content_b64, now),
        )
        db.commit()
    finally:
        db.close()
    return {
        "id": att_id, "resource_id": resource_id, "project_id": project_id,
        "filename": filename, "content_type": content_type, "size_bytes": len(raw),
        "has_text": bool(extracted), "uploaded_at": now,
    }


def list_attachments(resource_id: Optional[str] = None, project_id: Optional[str] = None) -> List[dict]:
    """List attachment metadata (no file content) filtered by resource and/or project."""
    db = _attach_conn()
    try:
        where, params = [], []
        if resource_id:
            where.append("resource_id = ?"); params.append(resource_id)
        if project_id:
            where.append("project_id = ?"); params.append(project_id)
        sql = ("SELECT id, resource_id, project_id, filename, content_type, size_bytes, extracted_text, uploaded_at "
               "FROM bcdr_attachments")
        if where:
            sql += " WHERE " + " AND ".join(where)
        cur = db.cursor()
        cur.execute(sql, params)
        out = []
        for r in _rows_to_dicts(cur):
            r["has_text"] = bool(r.pop("extracted_text", None))
            out.append(r)
        return out
    finally:
        db.close()


def get_attachment(att_id: str) -> Optional[dict]:
    """Get a single attachment INCLUDING its base64 content (for download)."""
    db = _attach_conn()
    try:
        cur = db.cursor()
        cur.execute("SELECT * FROM bcdr_attachments WHERE id = ?", (att_id,))
        rows = _rows_to_dicts(cur)
        return rows[0] if rows else None
    finally:
        db.close()


def delete_attachment(att_id: str) -> bool:
    db = _attach_conn()
    try:
        db.execute("DELETE FROM bcdr_attachments WHERE id = ?", (att_id,))
        db.commit()
        return True
    finally:
        db.close()


def get_attachments_text_for_resources(resource_ids: List[str]) -> Dict[str, List[dict]]:
    """Return {resource_id: [{filename, content_type, extracted_text}]} for AI grounding.

    Matches resource_ids case-insensitively. Only includes files that have extractable text;
    binary files are surfaced by filename (extracted_text empty) so the model knows a document
    exists even if its bytes aren't inlined.
    """
    if not resource_ids:
        return {}
    wanted = {(r or "").lower() for r in resource_ids}
    db = _attach_conn()
    try:
        cur = db.cursor()
        cur.execute("SELECT resource_id, filename, content_type, extracted_text FROM bcdr_attachments "
                    "WHERE resource_id IS NOT NULL")
        out: Dict[str, List[dict]] = {}
        for row in _rows_to_dicts(cur):
            rid = (row.get("resource_id") or "")
            if rid.lower() in wanted:
                out.setdefault(rid, []).append({
                    "filename": row.get("filename"),
                    "content_type": row.get("content_type"),
                    "extracted_text": row.get("extracted_text") or "",
                })
        return out
    finally:
        db.close()


def build_planning_grounding(compressed: List[dict]) -> str:
    """Merge Phase 1 planning inputs into AI-bound resources and return an attachments block.

    Shared by BOTH project-scoped BCDR AI flows (the project assessment + the BCDR plan):
      1. Merges each resource's Phase 1 metadata (criticality, DR tier, RTO/RPO, target region,
         desired SKU, owner, financial loss, dependencies, data class, compliance) into its
         `custom_tags` IN PLACE — Phase 1 is the customer's authoritative intent, so it wins.
      2. Returns a text block of the user-uploaded supporting documents (Phase 1 inputs) so the
         model is grounded on the customer's own runbooks / requirements / sign-off docs.
    Never raises — a storage hiccup must not break an assessment.
    """
    if not compressed:
        return ""
    # 1. Merge planning metadata into custom_tags
    try:
        meta_map = get_all_bcdr_metadata() or {}
        meta_by_lid = {(k or "").lower(): v for k, v in meta_map.items()}
        for rc in compressed:
            rid = (rc.get("resource_id") or rc.get("id") or "")
            m = meta_by_lid.get(rid.lower())
            if m:
                planning_tags = metadata_to_tags(m)
                if planning_tags:
                    tags = rc.get("custom_tags") or {}
                    tags.update(planning_tags)  # Phase 1 wins
                    rc["custom_tags"] = tags
    except Exception as exc:
        logger.warning("planning-tag merge skipped: %s", exc)

    # 2. Attachment text block
    try:
        rids = [(rc.get("resource_id") or rc.get("id") or "") for rc in compressed]
        attach_map = get_attachments_text_for_resources(rids) or {}
    except Exception as exc:
        logger.warning("planning attachments skipped: %s", exc)
        attach_map = {}
    if not attach_map:
        return ""
    name_by_lid: Dict[str, str] = {}
    for rc in compressed:
        rid = (rc.get("resource_id") or rc.get("id") or "").lower()
        name_by_lid[rid] = rc.get("resource_name") or rc.get("name") or rid
    lines: List[str] = []
    for rid, files in attach_map.items():
        rname = name_by_lid.get((rid or "").lower(), rid)
        for f in files:
            txt = (f.get("extracted_text") or "").strip()
            if txt:
                lines.append(f"--- Document '{f.get('filename')}' attached to {rname} ---\n{txt[:6000]}")
            else:
                lines.append(
                    f"--- Document '{f.get('filename')}' ({f.get('content_type') or 'binary'}) attached to "
                    f"{rname} (binary — content not inlined; note its presence) ---"
                )
    if not lines:
        return ""
    body = "\n\n".join(lines)[:24000]
    return (
        "\n\nUSER-UPLOADED SUPPORTING INPUTS (Phase 1 planning documents — treat as authoritative "
        "customer-provided context and cite them where they justify a finding or recommendation):\n"
        + body + "\n"
    )
