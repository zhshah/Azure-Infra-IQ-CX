"""
FinOps Budget Service.

Two-layer budget management:
  Layer 1 — Azure Native: reads existing budgets from Azure Cost Management
             (CostManagementClient.budgets.list) — same budgets as Azure Portal.
  Layer 2 — Custom: additional budgets stored in SQLite (finops_budgets table)
             for cost-center / project-level tracking not defined in Azure.

Budget variance is always computed from LIVE Azure cost data via finops_data_service.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, date, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

from services import finops_data_service as fds
from services.finops_data_service import query_cost, resolve_time_range, get_subscription_ids
from .azure_auth import get_credential
from services.database import get_connection as _db_conn, limit_sql, is_azure_sql

from models.schemas import (
    FinOpsBudgetDefinition,
    FinOpsBudgetVariance,
    FinOpsBudgetAlert,
)

# ── Database connection ────────────────────────────────────────────────────────

@contextmanager
def _conn():
    with _db_conn() as con:
        yield con


def _ensure_tables() -> None:
    if is_azure_sql():
        return  # Schema managed by migration scripts for Azure SQL
    with _conn() as con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS finops_budgets (
                id                TEXT PRIMARY KEY,
                name              TEXT NOT NULL,
                source            TEXT DEFAULT 'custom',
                scope_type        TEXT DEFAULT 'subscription',
                scope_id          TEXT DEFAULT '',
                amount_usd        REAL DEFAULT 0,
                period            TEXT DEFAULT 'Monthly',
                start_date        TEXT DEFAULT '',
                alert_thresholds  TEXT DEFAULT '[50,75,90,100]',
                owner_email       TEXT DEFAULT '',
                cost_center       TEXT DEFAULT '',
                tag_filters       TEXT DEFAULT '{}',
                created_at        TEXT DEFAULT '',
                updated_at        TEXT DEFAULT ''
            )
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS budget_alerts_log (
                id             TEXT PRIMARY KEY,
                budget_id      TEXT NOT NULL,
                budget_name    TEXT DEFAULT '',
                threshold_pct  REAL,
                triggered_at   TEXT,
                actual_usd     REAL DEFAULT 0,
                budgeted_usd   REAL DEFAULT 0,
                severity       TEXT DEFAULT 'warning'
            )
        """)


_ensure_tables()


# ── Helpers ────────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _row_to_budget(row: tuple, cols: list) -> FinOpsBudgetDefinition:
    d = dict(zip(cols, row))
    return FinOpsBudgetDefinition(
        id=d["id"],
        name=d["name"],
        source=d.get("source", "custom"),
        scope_type=d.get("scope_type", "subscription"),
        scope_id=d.get("scope_id", ""),
        amount_usd=float(d.get("amount_usd") or 0),
        period=d.get("period", "Monthly"),
        start_date=d.get("start_date", ""),
        alert_thresholds=json.loads(d.get("alert_thresholds") or "[50,75,90,100]"),
        owner_email=d.get("owner_email", ""),
        cost_center=d.get("cost_center", ""),
        tag_filters=json.loads(d.get("tag_filters") or "{}"),
        created_at=d.get("created_at", ""),
        updated_at=d.get("updated_at", ""),
    )


# ── Azure native budget sync ───────────────────────────────────────────────────

def sync_azure_budgets(subscription_ids: Optional[List[str]] = None) -> int:
    """
    Fetch budgets defined in Azure Portal and upsert them into the local SQLite
    cache as source='azure_native'.  Returns count synced.
    """
    try:
        from azure.mgmt.costmanagement import CostManagementClient
    except ImportError:
        return 0

    if not subscription_ids:
        subscription_ids = get_subscription_ids()

    try:
        credential = get_credential()
    except Exception:
        return 0

    client = CostManagementClient(credential)
    synced = 0

    for sub_id in subscription_ids:
        scope = f"/subscriptions/{sub_id}"
        try:
            for budget in client.budgets.list(scope):
                _upsert_azure_budget(budget, sub_id)
                synced += 1
        except Exception as e:
            logger.debug("sync_azure_budgets: could not list budgets for %s: %s", sub_id, e)

    logger.info("sync_azure_budgets: synced %d Azure native budgets", synced)
    return synced


def _upsert_azure_budget(budget: Any, subscription_id: str) -> None:
    """Map an Azure SDK Budget object into our local schema."""
    try:
        amount = float(getattr(getattr(budget, "amount", None) or 0, "__float__", lambda: 0)()) if budget.amount else 0.0
    except Exception:
        amount = 0.0

    period = "Monthly"
    try:
        if budget.time_grain:
            tg = str(budget.time_grain).lower()
            if "quarter" in tg:
                period = "Quarterly"
            elif "annual" in tg or "year" in tg:
                period = "Annual"
    except Exception:
        pass

    thresholds: List[float] = []
    try:
        for n in (budget.notifications or {}).values():
            if hasattr(n, "threshold"):
                thresholds.append(float(n.threshold))
    except Exception:
        pass
    if not thresholds:
        thresholds = [50.0, 75.0, 90.0, 100.0]

    budget_id = getattr(budget, "id", None) or str(uuid.uuid4())
    name = getattr(budget, "name", "Azure Budget")

    with _conn() as con:
        existing = con.execute("SELECT id FROM finops_budgets WHERE id=?", (budget_id,)).fetchone()
        now = _now_iso()
        if existing:
            con.execute("""
                UPDATE finops_budgets SET name=?, source='azure_native', scope_type='subscription',
                    scope_id=?, amount_usd=?, period=?, alert_thresholds=?, updated_at=?
                WHERE id=?
            """, (name, subscription_id, amount, period, json.dumps(thresholds), now, budget_id))
        else:
            con.execute("""
                INSERT INTO finops_budgets (id,name,source,scope_type,scope_id,amount_usd,period,alert_thresholds,created_at,updated_at)
                VALUES (?,?,'azure_native','subscription',?,?,?,?,?,?)
            """, (budget_id, name, subscription_id, amount, period, json.dumps(thresholds), now, now))


# ── CRUD ──────────────────────────────────────────────────────────────────────

def create_budget(
    name: str,
    scope_type: str = "all",
    scope_id: str = "",
    amount_usd: float = 0.0,
    period: str = "Monthly",
    start_date: str = "",
    alert_thresholds: Optional[List[float]] = None,
    owner_email: str = "",
    cost_center: str = "",
    tag_filters: Optional[Dict[str, str]] = None,
) -> FinOpsBudgetDefinition:
    bid = str(uuid.uuid4())
    now = _now_iso()
    thresholds = alert_thresholds or [50.0, 75.0, 90.0, 100.0]
    tfilters   = tag_filters or {}
    with _conn() as con:
        con.execute("""
            INSERT INTO finops_budgets
              (id,name,source,scope_type,scope_id,amount_usd,period,start_date,alert_thresholds,owner_email,cost_center,tag_filters,created_at,updated_at)
            VALUES (?,?,'custom',?,?,?,?,?,?,?,?,?,?,?)
        """, (bid, name, scope_type, scope_id, amount_usd, period, start_date,
              json.dumps(thresholds), owner_email, cost_center, json.dumps(tfilters), now, now))
    return get_budget(bid)  # type: ignore


def list_budgets(include_azure_native: bool = True) -> List[FinOpsBudgetDefinition]:
    with _conn() as con:
        if include_azure_native:
            rows = con.execute("SELECT * FROM finops_budgets ORDER BY name").fetchall()
        else:
            rows = con.execute("SELECT * FROM finops_budgets WHERE source='custom' ORDER BY name").fetchall()
        if is_azure_sql():
            cols = [r[0] for r in con.execute(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='finops_budgets' ORDER BY ORDINAL_POSITION"
            ).fetchall()]
        else:
            cols = [d[0] for d in con.execute("PRAGMA table_info(finops_budgets)").fetchall()]
    return [_row_to_budget(r, cols) for r in rows]


def get_budget(budget_id: str) -> Optional[FinOpsBudgetDefinition]:
    with _conn() as con:
        row = con.execute("SELECT * FROM finops_budgets WHERE id=?", (budget_id,)).fetchone()
        if not row:
            return None
        if is_azure_sql():
            cols = [r[0] for r in con.execute(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='finops_budgets' ORDER BY ORDINAL_POSITION"
            ).fetchall()]
        else:
            cols = [d[0] for d in con.execute("PRAGMA table_info(finops_budgets)").fetchall()]
    return _row_to_budget(row, cols)


def update_budget(budget_id: str, **kwargs) -> Optional[FinOpsBudgetDefinition]:
    b = get_budget(budget_id)
    if not b:
        return None
    allowed = {"name", "scope_type", "scope_id", "amount_usd", "period", "start_date",
               "alert_thresholds", "owner_email", "cost_center", "tag_filters"}
    updates: Dict[str, Any] = {}
    for k, v in kwargs.items():
        if k in allowed:
            updates[k] = json.dumps(v) if k in ("alert_thresholds", "tag_filters") else v

    if not updates:
        return b
    updates["updated_at"] = _now_iso()
    set_clause = ", ".join(f"{k}=?" for k in updates)
    with _conn() as con:
        con.execute(
            f"UPDATE finops_budgets SET {set_clause} WHERE id=?",  # noqa: S608
            list(updates.values()) + [budget_id]
        )
    return get_budget(budget_id)


def delete_budget(budget_id: str) -> bool:
    with _conn() as con:
        cur = con.execute("DELETE FROM finops_budgets WHERE id=?", (budget_id,))
        return cur.rowcount > 0


# ── Variance computation (live Azure data) ────────────────────────────────────

def compute_budget_variance(budget_id: str) -> Optional[FinOpsBudgetVariance]:
    """
    Compute live budget vs. actual spend using Azure Cost Management API.
    Returns None if budget not found.
    """
    budget = get_budget(budget_id)
    if not budget:
        return None

    # Determine date range for the current period
    today = datetime.now(tz=timezone.utc).date()
    if budget.period == "Monthly":
        from_date = today.replace(day=1)
        # Last day of current month
        if today.month == 12:
            to_date = date(today.year, 12, 31)
        else:
            to_date = date(today.year, today.month + 1, 1) - __import__("datetime").timedelta(days=1)
    elif budget.period == "Quarterly":
        q = (today.month - 1) // 3
        from_date = date(today.year, q * 3 + 1, 1)
        end_month = min(q * 3 + 3, 12)
        if end_month == 12:
            to_date = date(today.year, 12, 31)
        else:
            to_date = date(today.year, end_month + 1, 1) - __import__("datetime").timedelta(days=1)
    else:  # Annual
        from_date = date(today.year, 1, 1)
        to_date = date(today.year, 12, 31)

    elapsed_days = max(1, (today - from_date).days + 1)
    total_days   = max(1, (to_date - from_date).days + 1)
    days_remaining = (to_date - today).days

    # Determine scope for the query
    sub_ids = get_subscription_ids()
    if budget.scope_type == "subscription" and budget.scope_id:
        sub_ids = [budget.scope_id]
    elif budget.scope_type == "all":
        pass  # use all sub_ids

    # Fetch actual daily spend from Azure
    rows = fds.query_cost_multi_subscription(
        sub_ids, from_date, today,
        granularity="Daily",
        group_by=[],
        cost_type="ActualCost",
    )
    normalised = fds.normalise_cost_rows(rows, [])

    # Build daily breakdown
    daily: Dict[str, float] = {}
    for nr in normalised:
        if nr["date"]:
            daily[nr["date"]] = daily.get(nr["date"], 0.0) + nr["cost_usd"]

    actual_usd = sum(daily.values())
    burn_rate  = actual_usd / elapsed_days if elapsed_days else 0.0
    forecasted = actual_usd + burn_rate * days_remaining

    variance_usd = actual_usd - budget.amount_usd
    variance_pct = (variance_usd / budget.amount_usd * 100) if budget.amount_usd else 0.0
    util_pct     = (actual_usd / budget.amount_usd * 100) if budget.amount_usd else 0.0
    overrun      = max(0.0, forecasted - budget.amount_usd)

    status = "on_track"
    if util_pct >= 100:
        status = "exceeded"
    elif util_pct >= 75:
        status = "at_risk"

    # Budget reference line per day
    daily_budget = budget.amount_usd / total_days
    all_dates = sorted(daily.keys())
    breakdown = [
        {"date": d, "actual": round(daily.get(d, 0), 2), "budget_line": round(daily_budget, 2)}
        for d in all_dates
    ]

    period_label = from_date.strftime("%B %Y")

    return FinOpsBudgetVariance(
        budget_id=budget.id,
        budget_name=budget.name,
        period_label=period_label,
        budgeted_usd=round(budget.amount_usd, 2),
        actual_usd=round(actual_usd, 2),
        forecasted_usd=round(forecasted, 2),
        variance_usd=round(variance_usd, 2),
        variance_pct=round(variance_pct, 1),
        utilization_pct=round(util_pct, 1),
        status=status,
        daily_burn_rate=round(burn_rate, 2),
        days_remaining=days_remaining,
        projected_overrun_usd=round(overrun, 2),
        daily_breakdown=breakdown,
        data_source="azure_cost_management",
    )


# ── Alert checking ────────────────────────────────────────────────────────────

def check_all_budget_alerts() -> List[FinOpsBudgetAlert]:
    """
    Check all budgets against live actual spend.  Log new threshold breaches
    into budget_alerts_log.  Return all triggered alerts.
    """
    alerts: List[FinOpsBudgetAlert] = []
    for budget in list_budgets():
        variance = compute_budget_variance(budget.id)
        if not variance:
            continue
        util = variance.utilization_pct
        for threshold in sorted(budget.alert_thresholds):
            if util >= threshold:
                # Only log if not already logged in the last 24h for this threshold
                already = _recent_alert_exists(budget.id, threshold)
                severity = "critical" if threshold >= 100 else ("warning" if threshold >= 75 else "info")
                if not already:
                    _log_alert(budget.id, budget.name, threshold, variance.actual_usd, budget.amount_usd, severity)
                alerts.append(FinOpsBudgetAlert(
                    budget_id=budget.id,
                    budget_name=budget.name,
                    threshold_pct=threshold,
                    triggered_at=_now_iso(),
                    actual_usd=variance.actual_usd,
                    budgeted_usd=variance.budgeted_usd,
                    severity=severity,
                ))
    return alerts


def get_budget_alerts(budget_id: Optional[str] = None) -> List[FinOpsBudgetAlert]:
    """Return stored alert log entries."""
    with _conn() as con:
        if budget_id:
            rows = con.execute(
                limit_sql("SELECT * FROM budget_alerts_log WHERE budget_id=? ORDER BY triggered_at DESC", 100),
                (budget_id,)
            ).fetchall()
        else:
            rows = con.execute(
                limit_sql("SELECT * FROM budget_alerts_log ORDER BY triggered_at DESC", 200)
            ).fetchall()
        if is_azure_sql():
            cols = [r[0] for r in con.execute(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='budget_alerts_log' ORDER BY ORDINAL_POSITION"
            ).fetchall()]
        else:
            cols = [d[0] for d in con.execute("PRAGMA table_info(budget_alerts_log)").fetchall()]

    return [
        FinOpsBudgetAlert(
            budget_id=dict(zip(cols, r))["budget_id"],
            budget_name=dict(zip(cols, r)).get("budget_name", ""),
            threshold_pct=float(dict(zip(cols, r)).get("threshold_pct") or 0),
            triggered_at=dict(zip(cols, r)).get("triggered_at", ""),
            actual_usd=float(dict(zip(cols, r)).get("actual_usd") or 0),
            budgeted_usd=float(dict(zip(cols, r)).get("budgeted_usd") or 0),
            severity=dict(zip(cols, r)).get("severity", "warning"),
        )
        for r in rows
    ]


def _recent_alert_exists(budget_id: str, threshold_pct: float) -> bool:
    """True if a matching alert was already logged in the last 24 hours."""
    try:
        cutoff = (datetime.now(tz=timezone.utc) - __import__("datetime").timedelta(hours=24)).isoformat()
        with _conn() as con:
            row = con.execute(
                "SELECT id FROM budget_alerts_log WHERE budget_id=? AND threshold_pct=? AND triggered_at>?",
                (budget_id, threshold_pct, cutoff)
            ).fetchone()
            return row is not None
    except Exception:
        return False


def _log_alert(budget_id: str, budget_name: str, threshold_pct: float,
               actual_usd: float, budgeted_usd: float, severity: str) -> None:
    try:
        with _conn() as con:
            con.execute("""
                INSERT INTO budget_alerts_log (id,budget_id,budget_name,threshold_pct,triggered_at,actual_usd,budgeted_usd,severity)
                VALUES (?,?,?,?,?,?,?,?)
            """, (str(uuid.uuid4()), budget_id, budget_name, threshold_pct, _now_iso(),
                  actual_usd, budgeted_usd, severity))
    except Exception as e:
        logger.debug("_log_alert error: %s", e)
