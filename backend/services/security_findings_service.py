"""
Security Findings Persistence Service

Persists security findings (internal gaps, Defender, Advisor, Arc) to the
database and provides server-side querying with filtering, sorting, pagination,
and export.  Works with both SQLite and Azure SQL Database via the database
abstraction layer.
"""
from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from services.database import (
    get_connection,
    get_raw_connection,
    is_azure_sql,
    create_table_sql,
)

logger = logging.getLogger(__name__)

# ── Table bootstrap (idempotent) ─────────────────────────────────────────────

_tables_ensured = False


def _ensure_tables():
    global _tables_ensured
    if _tables_ensured:
        return
    if is_azure_sql():
        _tables_ensured = True
        return  # Azure SQL tables created by migration script

    conn = get_raw_connection()
    try:
        conn.execute(create_table_sql("""
            CREATE TABLE IF NOT EXISTS security_findings (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                finding_id      TEXT NOT NULL,
                scan_id         TEXT NOT NULL,
                source          TEXT NOT NULL DEFAULT 'internal',
                severity        TEXT NOT NULL DEFAULT 'medium',
                title           TEXT NOT NULL,
                description     TEXT DEFAULT '',
                category        TEXT DEFAULT '',
                resource_id     TEXT DEFAULT '',
                resource_name   TEXT DEFAULT '',
                resource_type   TEXT DEFAULT '',
                resource_group  TEXT DEFAULT '',
                subscription_id TEXT DEFAULT '',
                remediation     TEXT DEFAULT '',
                threats         TEXT DEFAULT '',
                status          TEXT DEFAULT 'active',
                monthly_risk_usd REAL DEFAULT 0,
                implementation_effort TEXT DEFAULT '',
                metadata        TEXT DEFAULT '{}',
                detected_at     TEXT NOT NULL,
                resolved_at     TEXT
            )
        """))
        conn.execute(create_table_sql("""
            CREATE TABLE IF NOT EXISTS security_scans (
                scan_id         TEXT PRIMARY KEY,
                scan_type       TEXT NOT NULL DEFAULT 'full',
                started_at      TEXT NOT NULL,
                completed_at    TEXT,
                total_findings  INTEGER DEFAULT 0,
                critical_count  INTEGER DEFAULT 0,
                high_count      INTEGER DEFAULT 0,
                medium_count    INTEGER DEFAULT 0,
                low_count       INTEGER DEFAULT 0,
                sources         TEXT DEFAULT '[]',
                status          TEXT DEFAULT 'completed'
            )
        """))
        conn.execute("CREATE INDEX IF NOT EXISTS idx_security_findings_scan ON security_findings (scan_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_security_findings_severity ON security_findings (severity)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_security_findings_source ON security_findings (source)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_security_findings_resource ON security_findings (resource_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_security_findings_status ON security_findings (status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_security_findings_finding_id ON security_findings (finding_id)")
        conn.commit()
    finally:
        conn.close()
    _tables_ensured = True


# ── Helpers ──────────────────────────────────────────────────────────────────

def _finding_hash(finding: dict) -> str:
    """Deterministic hash for dedup — based on resource_id + source + title."""
    key = f"{finding.get('resource_id', '')}|{finding.get('source', 'internal')}|{finding.get('title', '')}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Persist findings ─────────────────────────────────────────────────────────

def persist_findings(findings: List[Dict[str, Any]], scan_type: str = "full") -> Dict[str, Any]:
    """
    Persist a batch of security findings to the database.
    Creates a scan record and upserts individual findings.
    Returns scan summary.
    """
    _ensure_tables()

    scan_id = str(uuid.uuid4())
    now = _now_iso()
    sources = list(set(f.get("source", "internal") for f in findings))

    severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for f in findings:
        sev = f.get("severity", "medium").lower()
        if sev in severity_counts:
            severity_counts[sev] += 1

    conn = get_raw_connection()
    try:
        cursor = conn.cursor()

        # Insert scan record
        cursor.execute(
            "INSERT INTO security_scans (scan_id, scan_type, started_at, completed_at, "
            "total_findings, critical_count, high_count, medium_count, low_count, sources, status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (scan_id, scan_type, now, now,
             len(findings), severity_counts["critical"], severity_counts["high"],
             severity_counts["medium"], severity_counts["low"],
             json.dumps(sources), "completed")
        )

        # Mark previous active findings as superseded (they'll be re-inserted if still present)
        cursor.execute(
            "UPDATE security_findings SET status = 'superseded' WHERE status = 'active'"
        )

        # Insert new findings
        for f in findings:
            finding_id = _finding_hash(f)
            metadata = {}
            for k in ("gap_type", "azure_service", "implementation_effort", "threats"):
                if f.get(k):
                    metadata[k] = f[k]

            cursor.execute(
                "INSERT INTO security_findings "
                "(finding_id, scan_id, source, severity, title, description, category, "
                "resource_id, resource_name, resource_type, resource_group, subscription_id, "
                "remediation, threats, status, monthly_risk_usd, implementation_effort, "
                "metadata, detected_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (finding_id, scan_id,
                 f.get("source", "internal"),
                 f.get("severity", "medium"),
                 f.get("title", ""),
                 f.get("description", ""),
                 f.get("category", f.get("gap_type", "")),
                 f.get("resource_id", ""),
                 f.get("resource_name", ""),
                 f.get("resource_type", ""),
                 f.get("resource_group", ""),
                 f.get("subscription_id", ""),
                 f.get("remediation", ""),
                 f.get("threats", ""),
                 "active",
                 f.get("monthly_risk_usd", 0) or 0,
                 f.get("implementation_effort", ""),
                 json.dumps(metadata),
                 now)
            )

        conn.commit()
        logger.info("Persisted %d security findings (scan %s)", len(findings), scan_id[:8])

        return {
            "scan_id": scan_id,
            "total_findings": len(findings),
            "severity_counts": severity_counts,
            "sources": sources,
            "status": "completed",
        }
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("Failed to persist security findings: %s", e)
        raise
    finally:
        conn.close()


# ── Query findings ───────────────────────────────────────────────────────────

# Allowed columns for sorting (prevent SQL injection)
_SORT_COLUMNS = {
    "severity", "title", "resource_name", "resource_type", "resource_group",
    "source", "category", "subscription_id", "monthly_risk_usd", "detected_at",
    "status",
}

# Severity sort order for proper ranking
_SEV_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "informational": 4}


def query_findings(
    severity: Optional[str] = None,
    source: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_group: Optional[str] = None,
    subscription: Optional[str] = None,
    category: Optional[str] = None,
    status: Optional[str] = "active",
    search: Optional[str] = None,
    sort_by: str = "severity",
    sort_dir: str = "asc",
    page: int = 0,
    page_size: int = 50,
) -> Dict[str, Any]:
    """
    Query persisted security findings with server-side filtering, sorting, pagination.
    Returns {items, total, page, page_size, total_pages, filters_applied}.
    """
    _ensure_tables()

    where_clauses = []
    params = []

    if severity and severity != "all":
        where_clauses.append("severity = ?")
        params.append(severity.lower())
    if source and source != "all":
        where_clauses.append("source = ?")
        params.append(source)
    if resource_type and resource_type != "all":
        if is_azure_sql():
            where_clauses.append("LOWER(resource_type) = LOWER(?)")
        else:
            where_clauses.append("LOWER(resource_type) = LOWER(?)")
        params.append(resource_type)
    if resource_group and resource_group != "all":
        where_clauses.append("resource_group = ?")
        params.append(resource_group)
    if subscription and subscription != "all":
        where_clauses.append("subscription_id = ?")
        params.append(subscription)
    if category and category != "all":
        where_clauses.append("category = ?")
        params.append(category)
    if status and status != "all":
        where_clauses.append("status = ?")
        params.append(status)
    if search:
        if is_azure_sql():
            where_clauses.append(
                "(title LIKE ? OR resource_name LIKE ? OR description LIKE ? OR resource_group LIKE ?)"
            )
        else:
            where_clauses.append(
                "(title LIKE ? OR resource_name LIKE ? OR description LIKE ? OR resource_group LIKE ?)"
            )
        pattern = f"%{search}%"
        params.extend([pattern, pattern, pattern, pattern])

    where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"

    # Sort
    safe_sort = sort_by if sort_by in _SORT_COLUMNS else "severity"
    safe_dir = "ASC" if sort_dir.lower() == "asc" else "DESC"

    # Special handling: severity sort uses CASE for ranking
    if safe_sort == "severity":
        order_expr = (
            f"CASE severity "
            f"WHEN 'critical' THEN 0 WHEN 'high' THEN 1 "
            f"WHEN 'medium' THEN 2 WHEN 'low' THEN 3 "
            f"WHEN 'informational' THEN 4 ELSE 5 END {safe_dir}"
        )
    else:
        order_expr = f"{safe_sort} {safe_dir}"

    conn = get_raw_connection()
    try:
        cursor = conn.cursor()

        # Count total matching
        cursor.execute(f"SELECT COUNT(*) FROM security_findings WHERE {where_sql}", params)
        total = cursor.fetchone()[0]

        # Fetch page
        offset = page * page_size
        if is_azure_sql():
            query = (
                f"SELECT * FROM security_findings WHERE {where_sql} "
                f"ORDER BY {order_expr} "
                f"OFFSET ? ROWS FETCH NEXT ? ROWS ONLY"
            )
            params.extend([offset, page_size])
        else:
            query = (
                f"SELECT * FROM security_findings WHERE {where_sql} "
                f"ORDER BY {order_expr} "
                f"LIMIT ? OFFSET ?"
            )
            params.extend([page_size, offset])

        cursor.execute(query, params)
        columns = [desc[0] for desc in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

        # Get filter options (distinct values for active findings)
        filter_options = _get_filter_options(cursor)

        total_pages = max(1, (total + page_size - 1) // page_size)

        return {
            "items": rows,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "filter_options": filter_options,
        }
    finally:
        conn.close()


def _get_filter_options(cursor) -> Dict[str, List[str]]:
    """Get distinct values for filter dropdowns from active findings."""
    options = {}
    for col in ("severity", "source", "resource_type", "resource_group", "subscription_id", "category"):
        try:
            cursor.execute(
                f"SELECT DISTINCT {col} FROM security_findings WHERE status = 'active' AND {col} IS NOT NULL AND {col} != '' ORDER BY {col}"
            )
            options[col] = [row[0] for row in cursor.fetchall()]
        except Exception:
            options[col] = []
    return options


# ── Export ────────────────────────────────────────────────────────────────────

def export_findings_csv(
    severity: Optional[str] = None,
    source: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_group: Optional[str] = None,
    subscription: Optional[str] = None,
    category: Optional[str] = None,
    status: Optional[str] = "active",
    search: Optional[str] = None,
) -> str:
    """Export filtered findings as CSV string."""
    result = query_findings(
        severity=severity, source=source, resource_type=resource_type,
        resource_group=resource_group, subscription=subscription,
        category=category, status=status, search=search,
        page=0, page_size=10000,
    )
    headers = [
        "Severity", "Title", "Resource Name", "Resource Type", "Resource Group",
        "Subscription", "Source", "Category", "Description", "Remediation",
        "Monthly Risk USD", "Status", "Detected At",
    ]
    rows = []
    for f in result["items"]:
        rows.append([
            f.get("severity", ""),
            _csv_escape(f.get("title", "")),
            _csv_escape(f.get("resource_name", "")),
            f.get("resource_type", ""),
            f.get("resource_group", ""),
            f.get("subscription_id", ""),
            f.get("source", ""),
            f.get("category", ""),
            _csv_escape(f.get("description", "")),
            _csv_escape(f.get("remediation", "")),
            str(f.get("monthly_risk_usd", 0)),
            f.get("status", ""),
            f.get("detected_at", ""),
        ])
    lines = [",".join(f'"{h}"' for h in headers)]
    for row in rows:
        lines.append(",".join(f'"{c}"' for c in row))
    return "\n".join(lines)


def _csv_escape(val: str) -> str:
    """Escape CSV field value."""
    if not val:
        return ""
    return val.replace('"', '""').replace('\n', ' ').replace('\r', '')


# ── Scan history ─────────────────────────────────────────────────────────────

def get_scan_history(limit: int = 10) -> List[Dict[str, Any]]:
    """Get recent security scan history."""
    _ensure_tables()
    conn = get_raw_connection()
    try:
        cursor = conn.cursor()
        if is_azure_sql():
            cursor.execute(
                f"SELECT TOP {limit} * FROM security_scans ORDER BY started_at DESC"
            )
        else:
            cursor.execute(
                "SELECT * FROM security_scans ORDER BY started_at DESC LIMIT ?",
                (limit,)
            )
        columns = [desc[0] for desc in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]
    finally:
        conn.close()


# ── Summary stats ────────────────────────────────────────────────────────────

def get_findings_summary() -> Dict[str, Any]:
    """Get aggregate stats for active findings."""
    _ensure_tables()
    conn = get_raw_connection()
    try:
        cursor = conn.cursor()

        cursor.execute("SELECT COUNT(*) FROM security_findings WHERE status = 'active'")
        total = cursor.fetchone()[0]

        cursor.execute(
            "SELECT severity, COUNT(*) FROM security_findings WHERE status = 'active' GROUP BY severity"
        )
        by_severity = {row[0]: row[1] for row in cursor.fetchall()}

        cursor.execute(
            "SELECT source, COUNT(*) FROM security_findings WHERE status = 'active' GROUP BY source"
        )
        by_source = {row[0]: row[1] for row in cursor.fetchall()}

        cursor.execute(
            "SELECT COALESCE(SUM(monthly_risk_usd), 0) FROM security_findings WHERE status = 'active'"
        )
        total_risk = cursor.fetchone()[0]

        return {
            "total_active": total,
            "by_severity": by_severity,
            "by_source": by_source,
            "total_monthly_risk_usd": round(total_risk, 2),
        }
    finally:
        conn.close()
