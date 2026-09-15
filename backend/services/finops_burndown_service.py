"""
Budget burn-down.

Answers the question a budget actually exists to answer: at today's rate, will this
period end over or under, and on which day does each Azure alert threshold trip.

Budgets, amounts and thresholds come from Azure (ConsumptionManagementClient.budgets.list,
synced by budget_service) - none of it is synthetic. Actuals come from the cost warehouse,
so the curve is the same data the rest of FinOps reports.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

try:
    from services.database import get_connection
    _DB = True
except Exception:  # pragma: no cover
    _DB = False


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _period_bounds(period: str, today: Optional[date] = None) -> tuple[date, date]:
    t = today or _today()
    p = (period or "Monthly").lower()
    if "quarter" in p:
        q = (t.month - 1) // 3
        start = date(t.year, q * 3 + 1, 1)
        end = (date(t.year + (q == 3), 1 if q == 3 else q * 3 + 4, 1) - timedelta(days=1))
    elif "annual" in p or "year" in p:
        start, end = date(t.year, 1, 1), date(t.year, 12, 31)
    else:
        start = date(t.year, t.month, 1)
        nxt = date(t.year + (t.month == 12), 1 if t.month == 12 else t.month + 1, 1)
        end = nxt - timedelta(days=1)
    return start, end


def _daily_actuals(start: date, end: date, subscription_id: Optional[str]) -> List[Dict[str, Any]]:
    if not _DB:
        return []
    sql = ("SELECT snapshot_date, SUM(cost_usd) FROM finops_daily_resource_costs "
           "WHERE snapshot_date >= ? AND snapshot_date <= ?")
    params: List[Any] = [str(start), str(end)]
    if subscription_id:
        sql += " AND subscription_id = ?"
        params.append(subscription_id)
    sql += " GROUP BY snapshot_date ORDER BY snapshot_date"
    try:
        with get_connection() as con:
            return [{"date": str(r[0]), "cost": float(r[1] or 0)} for r in con.execute(sql, tuple(params)).fetchall()]
    except Exception as e:
        logger.warning("burndown: actuals unavailable: %s", e)
        return []


def burndown(budget: Dict[str, Any], subscription_id: Optional[str] = None) -> Dict[str, Any]:
    """Cumulative actual vs the straight-line budget pace, projected to period end."""
    amount = float(budget.get("amount_usd") or 0)
    start, end = _period_bounds(str(budget.get("period") or "Monthly"))
    today = _today()
    total_days = (end - start).days + 1
    elapsed = max((min(today, end) - start).days + 1, 1)

    actuals = _daily_actuals(start, end, subscription_id)
    by_day = {a["date"]: a["cost"] for a in actuals}

    series: List[Dict[str, Any]] = []
    cum = 0.0
    for i in range(total_days):
        d = start + timedelta(days=i)
        ds = str(d)
        past = d <= today
        if past:
            cum += by_day.get(ds, 0.0)
        # Straight line is the pace Azure's own threshold alerts imply.
        pace = amount * ((i + 1) / total_days) if amount else 0.0
        series.append({
            "date": ds,
            "actual_cumulative": round(cum, 2) if past else None,
            "budget_pace": round(pace, 2),
        })

    spent = round(cum, 2)
    run_rate = spent / elapsed if elapsed else 0.0
    projected = round(run_rate * total_days, 2)
    variance = round(projected - amount, 2) if amount else 0.0

    # Project the remaining days so the curve continues past today rather than stopping.
    for i in range(total_days):
        if series[i]["actual_cumulative"] is None:
            series[i]["projected_cumulative"] = round(run_rate * (i + 1), 2)
        elif str(start + timedelta(days=i)) == str(min(today, end)):
            series[i]["projected_cumulative"] = spent

    thresholds = []
    # Azure notifications frequently repeat a threshold (one per contact channel); the
    # burn-down cares about the line, not how many people get emailed when it trips.
    for t in sorted({float(x) for x in (budget.get("alert_thresholds") or [])}):
        target = amount * t / 100.0
        hit = next((s["date"] for s in series
                    if s["actual_cumulative"] is not None and s["actual_cumulative"] >= target), None)
        eta = None
        if not hit and run_rate > 0 and target > spent:
            days_out = (target - spent) / run_rate
            eta_date = today + timedelta(days=int(days_out) + 1)
            eta = str(eta_date) if eta_date <= end else None
        thresholds.append({
            "threshold_pct": t, "amount_usd": round(target, 2),
            "breached_on": hit,
            "projected_breach": eta,
            # Distinguishes "will not trip" from "trips after the period ends".
            "status": "breached" if hit else ("projected" if eta else "clear"),
        })

    exhaust = None
    if amount and run_rate > 0 and spent < amount:
        d_out = (amount - spent) / run_rate
        cand = today + timedelta(days=int(d_out) + 1)
        exhaust = str(cand) if cand <= end else None
    elif amount and spent >= amount:
        exhaust = next((s["date"] for s in series
                        if s["actual_cumulative"] is not None and s["actual_cumulative"] >= amount), None)

    return {
        "available": True,
        "budget_id": budget.get("id"),
        "name": budget.get("name"),
        "scope_id": budget.get("scope_id"),
        "source": budget.get("source"),
        "amount_usd": round(amount, 2),
        "period": budget.get("period"),
        "period_start": str(start),
        "period_end": str(end),
        "days_total": total_days,
        "days_elapsed": elapsed,
        "spent_usd": spent,
        "spent_pct": round(spent / amount * 100, 1) if amount else 0.0,
        "remaining_usd": round(amount - spent, 2) if amount else 0.0,
        "run_rate_usd_per_day": round(run_rate, 2),
        "projected_total_usd": projected,
        "projected_variance_usd": variance,
        "projected_pct_of_budget": round(projected / amount * 100, 1) if amount else 0.0,
        "forecast": ("over" if variance > 0 else "under") if amount else "no budget amount",
        "exhaustion_date": exhaust,
        "thresholds": thresholds,
        "series": series,
        "has_actuals": bool(actuals),
    }


def _as_dict(b: Any) -> Dict[str, Any]:
    """list_budgets returns Pydantic models; accept either shape."""
    if isinstance(b, dict):
        return b
    for attr in ("model_dump", "dict"):
        fn = getattr(b, attr, None)
        if callable(fn):
            try:
                return fn()
            except Exception:
                pass
    return {k: getattr(b, k, None) for k in
            ("id", "name", "source", "scope_id", "amount_usd", "period", "alert_thresholds")}


import re

_GUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)


def _subscription_of(budget: Dict[str, Any]) -> Optional[str]:
    """Subscription a budget is scoped to.

    scope_id is stored as a bare GUID for Azure-native budgets, not the full
    /subscriptions/<id>/... path. Matching only the path form left every budget
    unscoped, so three per-subscription budgets all charted the same estate-wide spend.
    """
    for field in ("scope_id", "id"):
        val = str(budget.get(field) or "")
        m = _GUID.search(val)
        if m:
            return m.group(0)
    return None


def burndown_all(subscription_id: Optional[str] = None) -> Dict[str, Any]:
    """Burn-down for every synced budget, worst projected overrun first."""
    try:
        from services import budget_service as bs
        budgets = bs.list_budgets() or []
    except Exception as e:
        logger.warning("burndown_all: budgets unavailable: %s", e)
        return {"available": False, "budgets": [], "reason": str(e)}

    if isinstance(budgets, dict):
        budgets = budgets.get("budgets") or []
    out = []
    # A budget scoped above subscription level is stored once per subscription by the
    # sync; scope is part of the fingerprint so genuinely distinct per-subscription
    # budgets that share a name are still kept apart.
    seen: set = set()
    for raw in budgets:
        b = _as_dict(raw)
        fingerprint = (str(b.get("name") or "").lower(),
                       str(b.get("scope_id") or "").lower(),
                       round(float(b.get("amount_usd") or 0), 2),
                       str(b.get("period") or "").lower())
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        try:
            sid = subscription_id or _subscription_of(b)
            row = burndown(b, sid)
            row["subscription_id"] = sid
            out.append(row)
        except Exception as e:
            logger.warning("burndown for %s failed: %s", b.get("name"), e)
    out.sort(key=lambda x: -x.get("projected_variance_usd", 0))
    return {
        "available": bool(out),
        "budgets": out,
        "count": len(out),
        "over_forecast": sum(1 for x in out if x.get("forecast") == "over"),
    }
