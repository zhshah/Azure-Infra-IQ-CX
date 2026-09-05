"""
Log Analytics / Microsoft Sentinel per-TABLE cost service.

Azure Cost Management stops at the workspace resource — it can tell you what a
Log Analytics workspace cost, but never which TABLE inside it drove that cost.
That answer only exists in the workspace's own ``Usage`` table, which records
billable volume per ``DataType`` (table) and is itself free to query.

This service joins the two:

    billable GB per table   (KQL: Usage, via api.loganalytics.io)
              ×
    real workspace cost     (finops_daily_resource_costs / finops_daily_meter_costs)
              =
    allocated cost per table

IMPORTANT — the per-table figure is an ALLOCATION, not a billed amount. Azure does
not invoice per table, so cost is apportioned across tables by their share of
billable GB. Every row carries a ``cost_basis`` describing how it was derived so the
UI can label it honestly and never imply a precision Azure itself does not provide.

Sentinel free data types (SecurityIncident, Defender-sourced SecurityAlert,
AzureActivity, Office 365 audit) are collected for visibility but are excluded from
the billable pool, so they never attract phantom cost.

Collection is additive: no existing table or query is altered.
"""
from __future__ import annotations

import hashlib
import logging
import time
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

try:
    from services.database import get_connection, upsert_conflict_sql
    _DB_AVAILABLE = True
except Exception as e:  # pragma: no cover
    _DB_AVAILABLE = False
    logger.warning("LA cost: database unavailable: %s", e)

try:
    from services.azure_auth import get_credential
    from services.settings_service import get_subscription_ids
    _AUTH_AVAILABLE = True
except Exception as e:  # pragma: no cover
    _AUTH_AVAILABLE = False
    logger.warning("LA cost: azure auth unavailable: %s", e)

try:
    from services.resource_graph_service import query_resource_graph
    _ARG_AVAILABLE = True
except Exception as e:  # pragma: no cover
    _ARG_AVAILABLE = False
    logger.warning("LA cost: resource graph unavailable: %s", e)


LA_HISTORY_DAYS = 30

# Per-workspace query ceiling. The Logs API allows 200 requests / 30s; one query per
# workspace with a pause between keeps us far under that even on large estates.
_WORKSPACE_PAUSE_SECS = 0.6
_QUERY_TIMEOUT_SECS = 120

# Data types Microsoft does not charge ingestion for. Sourced from Sentinel billing
# docs; kept as a prefix/exact set because Defender tables vary by connector.
# These still surface in the UI (volume matters operationally) but never carry cost.
FREE_DATA_TYPES = {
    "securityincident",
    "securityalert",
    "azureactivity",
    "officeactivity",
    "securityrecommendation",
    "securitybaseline",
    "securitybaselinesummary",
    "protectionstatus",
    "advisor",
    "operation",
    "usage",
    "heartbeat",
}

_SENTINEL_TABLE_HINTS = (
    "security", "threat", "anomalies", "watchlist", "incident", "alert",
)


# ── DB helpers ────────────────────────────────────────────────────────────────

@contextmanager
def _conn():
    with get_connection() as con:
        yield con


def _window(days: int) -> Tuple[str, str]:
    today = datetime.now(timezone.utc).date()
    return str(today - timedelta(days=max(1, days) - 1)), str(today)


def _sub_clause(subscription_ids: Optional[List[str]], col: str = "subscription_id") -> str:
    subs = [s for s in (subscription_ids or []) if s]
    if not subs:
        return ""
    quoted = ",".join("'" + s.replace("'", "''") + "'" for s in subs)
    return f" AND {col} IN ({quoted})"


def _upsert_batch(sql: str, batch: List[tuple]) -> int:
    if not batch:
        return 0
    try:
        with _conn() as con:
            cur = con.cursor()
            try:
                cur.fast_executemany = True   # pyodbc only
            except AttributeError:
                pass
            cur.executemany(sql, batch)
        return len(batch)
    except Exception as e:
        logger.warning("LA cost: batch upsert failed (%s) — retrying row by row", e)
        written = 0
        try:
            with _conn() as con:
                for params in batch:
                    try:
                        con.execute(sql, params)
                        written += 1
                    except Exception:
                        pass
        except Exception as inner:
            logger.error("LA cost: row-by-row fallback failed: %s", inner)
        return written


def _is_free_table(data_type: str) -> bool:
    return (data_type or "").strip().lower() in FREE_DATA_TYPES


def _looks_sentinel(data_type: str) -> bool:
    dt = (data_type or "").lower()
    return any(h in dt for h in _SENTINEL_TABLE_HINTS)


# ── Workspace discovery ───────────────────────────────────────────────────────

_WORKSPACE_KQL = """
Resources
| where type =~ 'microsoft.operationalinsights/workspaces'
| project id, name, resourceGroup, subscriptionId, location,
          customerId = tostring(properties.customerId),
          sku = tostring(properties.sku.name),
          retentionInDays = toint(properties.retentionInDays)
"""

_SENTINEL_KQL = """
Resources
| where type =~ 'microsoft.operationsmanagement/solutions'
| where name startswith 'SecurityInsights'
| project workspaceResourceId = tolower(tostring(properties.workspaceResourceId))
"""


def discover_workspaces(subscription_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Every Log Analytics workspace in scope, flagged with whether Sentinel is on it."""
    if not _ARG_AVAILABLE:
        return []
    try:
        rows = query_resource_graph(_WORKSPACE_KQL, subscription_ids=subscription_ids)
    except Exception as e:
        logger.warning("LA cost: workspace discovery failed: %s", e)
        return []

    sentinel_ids: set = set()
    try:
        for r in query_resource_graph(_SENTINEL_KQL, subscription_ids=subscription_ids):
            wid = (r.get("workspaceResourceId") or "").strip().lower()
            if wid:
                sentinel_ids.add(wid)
    except Exception as e:
        logger.info("LA cost: Sentinel solution lookup skipped: %s", e)

    out: List[Dict[str, Any]] = []
    for r in rows:
        rid = str(r.get("id") or "")
        if not rid:
            continue
        out.append({
            "workspace_id":     rid,
            "workspace_name":   str(r.get("name") or ""),
            "resource_group":   str(r.get("resourceGroup") or ""),
            "subscription_id":  str(r.get("subscriptionId") or ""),
            "location":         str(r.get("location") or ""),
            "customer_id":      str(r.get("customerId") or ""),
            "sku":              str(r.get("sku") or ""),
            "retention_days":   int(r.get("retentionInDays") or 0),
            "sentinel_enabled": rid.lower() in sentinel_ids,
        })
    return out


# ── Usage query (per-table billable GB) ───────────────────────────────────────

# Quantity is MB. Splitting billable from non-billable in one pass keeps this to a
# single query per workspace. Usage is a free table, so this costs nothing to run.
_USAGE_KQL = """
Usage
| where TimeGenerated >= ago({days}d)
| where QuantityUnit =~ 'MBytes'
| summarize BillableMB = sumif(Quantity, IsBillable == true),
            NonBillableMB = sumif(Quantity, IsBillable != true)
        by DataType, UsageDate = format_datetime(bin(TimeGenerated, 1d), 'yyyy-MM-dd')
| where BillableMB > 0 or NonBillableMB > 0
| order by UsageDate asc, BillableMB desc
"""


def query_table_usage(customer_id: str,
                      days: int = LA_HISTORY_DAYS) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """Billable / non-billable GB per table per day for one workspace.

    Returns (rows, error). An unreadable workspace yields ([], "reason") rather than
    raising, so one bad workspace cannot abort the whole collection — but the caller
    can still tell "no data" apart from "no access".
    """
    if not (_AUTH_AVAILABLE and customer_id):
        return [], "no credential or workspace id"
    try:
        from azure.monitor.query import LogsQueryClient, LogsQueryStatus
    except Exception as e:
        logger.warning("LA cost: azure-monitor-query not installed: %s", e)
        return [], "azure-monitor-query not installed"

    kql = _USAGE_KQL.format(days=max(1, days))
    try:
        client = LogsQueryClient(get_credential())
        resp = client.query_workspace(
            workspace_id=customer_id,
            query=kql,
            timespan=timedelta(days=max(1, days)),
            server_timeout=_QUERY_TIMEOUT_SECS,
        )
    except Exception as e:
        logger.warning("LA cost: Usage query failed for workspace %s: %s", customer_id[:8], e)
        return [], str(e)[:200]

    if getattr(resp, "status", None) == LogsQueryStatus.PARTIAL:
        tables = list(getattr(resp, "partial_data", []) or [])
    else:
        tables = list(getattr(resp, "tables", []) or [])

    out: List[Dict[str, Any]] = []
    for t in tables:
        cols = [str(c) for c in (getattr(t, "columns", []) or [])]
        try:
            i_dt = cols.index("DataType")
            i_b = cols.index("BillableMB")
            i_nb = cols.index("NonBillableMB")
            i_d = cols.index("UsageDate")
        except ValueError:
            logger.warning("LA cost: unexpected Usage columns: %s", cols)
            continue
        for row in (getattr(t, "rows", []) or []):
            dt = str(row[i_dt] or "")
            if not dt:
                continue
            out.append({
                "data_type":       dt,
                "usage_date":      str(row[i_d] or "")[:10],
                "billable_gb":     float(row[i_b] or 0) / 1024.0,
                "non_billable_gb": float(row[i_nb] or 0) / 1024.0,
            })
    return out, None


# ── Workspace cost lookup ─────────────────────────────────────────────────────

def _workspace_cost(workspace_id: str, subscription_id: str,
                    d_from: str, d_to: str) -> Tuple[float, str]:
    """Real cost for one workspace over the window, with the basis used.

    Preference order:
      1. ``finops_daily_resource_costs`` filtered to the workspace resource id —
         this is the workspace's ACTUAL billed cost.
      2. Subscription-level Log Analytics meters from ``finops_daily_meter_costs``,
         which the caller then apportions across workspaces by GB share.
    Returns (cost_usd, basis).
    """
    if not _DB_AVAILABLE:
        return 0.0, "none"

    try:
        with _conn() as con:
            cur = con.execute(
                "SELECT SUM(cost_usd) FROM finops_daily_resource_costs "
                "WHERE LOWER(resource_id) = ? AND snapshot_date >= ? AND snapshot_date <= ?",
                (workspace_id.lower(), d_from, d_to),
            )
            row = cur.fetchone()
            if row and row[0]:
                return round(float(row[0]), 2), "resource_meter"
    except Exception as e:
        logger.info("LA cost: resource-cost lookup failed for %s: %s", workspace_id[-24:], e)

    try:
        with _conn() as con:
            cur = con.execute(
                "SELECT SUM(cost_usd) FROM finops_daily_meter_costs "
                "WHERE subscription_id = ? AND snapshot_date >= ? AND snapshot_date <= ? "
                "AND classification IN ('monitor_ingestion','monitor_retention')",
                (subscription_id, d_from, d_to),
            )
            row = cur.fetchone()
            if row and row[0]:
                return round(float(row[0]), 2), "subscription_allocated"
    except Exception as e:
        logger.info("LA cost: meter-cost fallback failed for %s: %s", subscription_id[:8], e)

    return 0.0, "none"


# ── Collection ────────────────────────────────────────────────────────────────

_COLS = ["id", "snapshot_date", "subscription_id", "workspace_id", "workspace_name",
         "resource_group", "table_name", "billable_gb", "non_billable_gb",
         "allocated_cost_usd", "cost_basis", "is_sentinel", "etl_run_id"]


def collect_all(subscription_ids: Optional[List[str]] = None,
                run_id: str = "", days: int = LA_HISTORY_DAYS) -> Dict[str, Any]:
    """Collect per-table LA/Sentinel cost across every workspace in scope."""
    if not (_DB_AVAILABLE and _AUTH_AVAILABLE):
        return {"available": False, "workspaces": 0, "rows": 0}

    subs = subscription_ids or (get_subscription_ids() if _AUTH_AVAILABLE else [])
    workspaces = discover_workspaces(subs)
    if not workspaces:
        return {"available": False, "workspaces": 0, "rows": 0,
                "reason": "no Log Analytics workspaces found in scope"}

    # Pre-compute each workspace's GB share within its subscription so the
    # subscription-level cost fallback can be split fairly between workspaces.
    gb_by_ws: Dict[str, float] = {}
    usage_by_ws: Dict[str, List[Dict[str, Any]]] = {}
    unreadable: List[Dict[str, str]] = []
    for ws in workspaces:
        u, err = query_table_usage(ws.get("customer_id", ""), days=days)
        if err:
            unreadable.append({"workspace": ws.get("workspace_name", "?"), "reason": err})
        usage_by_ws[ws["workspace_id"]] = u
        gb_by_ws[ws["workspace_id"]] = sum(
            x["billable_gb"] for x in u if not _is_free_table(x["data_type"]))
        time.sleep(_WORKSPACE_PAUSE_SECS)

    gb_by_sub: Dict[str, float] = {}
    for ws in workspaces:
        gb_by_sub[ws["subscription_id"]] = gb_by_sub.get(ws["subscription_id"], 0.0) \
            + gb_by_ws.get(ws["workspace_id"], 0.0)

    rows = 0
    collected = 0
    for ws in workspaces:
        sub_total = gb_by_sub.get(ws["subscription_id"], 0.0)
        share = (gb_by_ws.get(ws["workspace_id"], 0.0) / sub_total) if sub_total > 0 else None
        try:
            written = _collect_from_usage(
                ws, usage_by_ws.get(ws["workspace_id"], []), run_id, days, share)
            if written:
                collected += 1
            rows += written
        except Exception as e:
            logger.warning("LA cost: workspace %s failed: %s",
                           ws.get("workspace_name", "?"), e)

    return {"available": rows > 0, "workspaces": collected,
            "workspaces_found": len(workspaces), "rows": rows,
            "workspaces_unreadable": len(unreadable), "unreadable": unreadable[:10]}


def _collect_from_usage(ws: Dict[str, Any], usage: List[Dict[str, Any]],
                        run_id: str, days: int,
                        sub_gb_share: Optional[float]) -> int:
    """Persist an already-fetched usage set (avoids querying each workspace twice)."""
    if not usage:
        return 0
    d_from, d_to = _window(days)
    total_cost, basis = _workspace_cost(
        ws.get("workspace_id", ""), ws.get("subscription_id", ""), d_from, d_to)
    if basis == "subscription_allocated" and sub_gb_share is not None:
        total_cost = round(total_cost * sub_gb_share, 2)

    billable = [u for u in usage if not _is_free_table(u["data_type"])]
    total_billable_gb = sum(u["billable_gb"] for u in billable)
    cost_per_gb = (total_cost / total_billable_gb) if total_billable_gb > 0 else 0.0

    sql = upsert_conflict_sql("finops_la_table_costs", _COLS, ["id"],
                              [c for c in _COLS if c != "id"])
    ws_id = ws.get("workspace_id", "")
    ws_sentinel = bool(ws.get("sentinel_enabled"))

    batch: List[tuple] = []
    for u in usage:
        dt = u["data_type"]
        free = _is_free_table(dt)
        billable_gb = 0.0 if free else u["billable_gb"]
        rid = hashlib.sha256(f"{u['usage_date']}|{ws_id}|{dt}".encode("utf-8")).hexdigest()
        batch.append((
            rid, u["usage_date"], ws.get("subscription_id", ""), ws_id,
            ws.get("workspace_name", ""), ws.get("resource_group", ""), dt,
            round(billable_gb, 6),
            round(u["non_billable_gb"] + (u["billable_gb"] if free else 0.0), 6),
            round(billable_gb * cost_per_gb, 4),
            basis,
            1 if (ws_sentinel and _looks_sentinel(dt)) else 0,
            run_id,
        ))
    return _upsert_batch(sql, batch)


def purge_old(today: Optional[date] = None, keep_days: int = 120) -> None:
    if not _DB_AVAILABLE:
        return
    today = today or datetime.now(timezone.utc).date()
    cutoff = str(today - timedelta(days=keep_days))
    try:
        with _conn() as con:
            con.execute("DELETE FROM finops_la_table_costs WHERE snapshot_date < ?", (cutoff,))
    except Exception as e:
        logger.warning("LA cost: purge failed: %s", e)


def has_data() -> bool:
    if not _DB_AVAILABLE:
        return False
    try:
        with _conn() as con:
            cur = con.execute("SELECT COUNT(*) FROM finops_la_table_costs")
            row = cur.fetchone()
            return bool(row and row[0])
    except Exception:
        return False


# ── Read helpers ──────────────────────────────────────────────────────────────

def get_workspace_summary(days: int = 30,
                          subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """One row per workspace: billable GB, allocated cost, table count, $/GB."""
    if not _DB_AVAILABLE:
        return {"available": False, "workspaces": [], "total_usd": 0.0, "total_gb": 0.0}
    d_from, d_to = _window(days)
    sql = (
        "SELECT workspace_id, workspace_name, resource_group, subscription_id, "
        "       SUM(billable_gb), SUM(non_billable_gb), SUM(allocated_cost_usd), "
        "       COUNT(DISTINCT table_name), MAX(cost_basis), MAX(is_sentinel) "
        "FROM finops_la_table_costs "
        "WHERE snapshot_date >= ? AND snapshot_date <= ?"
        f"{_sub_clause(subscription_ids)} "
        "GROUP BY workspace_id, workspace_name, resource_group, subscription_id "
        "ORDER BY SUM(allocated_cost_usd) DESC"
    )
    items: List[Dict[str, Any]] = []
    try:
        with _conn() as con:
            for r in con.execute(sql, (d_from, d_to)).fetchall():
                raw_gb = float(r[4] or 0)
                raw_cost = float(r[6] or 0)
                items.append({
                    "workspace_id":     r[0],
                    "workspace_name":   r[1],
                    "resource_group":   r[2],
                    "subscription_id":  r[3],
                    "billable_gb":      round(raw_gb, 3),
                    "non_billable_gb":  round(float(r[5] or 0), 3),
                    "allocated_cost_usd": round(raw_cost, 2),
                    "table_count":      int(r[7] or 0),
                    "cost_basis":       r[8] or "none",
                    "sentinel_enabled": bool(r[9]),
                    "cost_per_gb_usd":  round(raw_cost / raw_gb, 4) if raw_gb else 0.0,
                })
    except Exception as e:
        logger.warning("LA cost: workspace summary failed: %s", e)
        return {"available": False, "workspaces": [], "total_usd": 0.0, "total_gb": 0.0}

    return {
        "available": bool(items),
        "workspaces": items,
        "total_usd": round(sum(i["allocated_cost_usd"] for i in items), 2),
        "total_gb": round(sum(i["billable_gb"] for i in items), 3),
        "period_days": days, "date_from": d_from, "date_to": d_to,
    }


def get_table_costs(workspace_id: Optional[str] = None, days: int = 30,
                    top: int = 50,
                    subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Per-table billable GB and allocated cost, plus a daily trend for the top tables."""
    if not _DB_AVAILABLE:
        return {"available": False, "tables": [], "trend": []}
    d_from, d_to = _window(days)

    where = "WHERE snapshot_date >= ? AND snapshot_date <= ?"
    params: List[Any] = [d_from, d_to]
    if workspace_id:
        where += " AND LOWER(workspace_id) = ?"
        params.append(workspace_id.lower())
    where += _sub_clause(subscription_ids)

    tables: List[Dict[str, Any]] = []
    try:
        with _conn() as con:
            rows = con.execute(
                "SELECT table_name, SUM(billable_gb), SUM(non_billable_gb), "
                "       SUM(allocated_cost_usd), MAX(is_sentinel), MAX(cost_basis) "
                f"FROM finops_la_table_costs {where} "
                "GROUP BY table_name ORDER BY SUM(allocated_cost_usd) DESC, SUM(billable_gb) DESC",
                tuple(params),
            ).fetchall()
    except Exception as e:
        logger.warning("LA cost: table query failed: %s", e)
        return {"available": False, "tables": [], "trend": []}

    total_cost = sum(float(r[3] or 0) for r in rows)
    total_gb = sum(float(r[1] or 0) for r in rows)
    basis = next((r[5] for r in rows if r[5]), "none")
    for r in rows[:max(1, top)]:
        # Percentages come from the RAW sums; deriving them from the rounded display
        # values reports impossible figures like 101% on small volumes.
        raw_gb = float(r[1] or 0)
        raw_cost = float(r[3] or 0)
        tables.append({
            "table_name":       r[0],
            "billable_gb":      round(raw_gb, 3),
            "non_billable_gb":  round(float(r[2] or 0), 3),
            "allocated_cost_usd": round(raw_cost, 2),
            "pct_of_cost":      round(raw_cost / total_cost * 100, 1) if total_cost else 0.0,
            "pct_of_gb":        round(raw_gb / total_gb * 100, 1) if total_gb else 0.0,
            "is_sentinel":      bool(r[4]),
            "is_free":          _is_free_table(r[0]),
            "cost_per_gb_usd":  round(raw_cost / raw_gb, 4) if raw_gb else 0.0,
        })

    top_names = [t["table_name"] for t in tables[:8]]
    trend: List[Dict[str, Any]] = []
    if top_names:
        quoted = ",".join("'" + n.replace("'", "''") + "'" for n in top_names)
        try:
            with _conn() as con:
                for r in con.execute(
                    "SELECT snapshot_date, table_name, SUM(billable_gb), SUM(allocated_cost_usd) "
                    f"FROM finops_la_table_costs {where} AND table_name IN ({quoted}) "
                    "GROUP BY snapshot_date, table_name ORDER BY snapshot_date ASC",
                    tuple(params),
                ).fetchall():
                    trend.append({
                        "date": r[0], "table_name": r[1],
                        "billable_gb": round(float(r[2] or 0), 3),
                        "cost_usd": round(float(r[3] or 0), 2),
                    })
        except Exception as e:
            logger.info("LA cost: trend query failed: %s", e)

    return {
        "available": bool(tables),
        "workspace_id": workspace_id or "",
        "tables": tables,
        "trend": trend,
        "total_usd": round(total_cost, 2),
        "total_gb": round(total_gb, 3),
        "cost_basis": basis,
        "period_days": days, "date_from": d_from, "date_to": d_to,
    }
