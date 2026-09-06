"""
FinOps Cost Analytics — warehouse-backed "Analyze" (Azure Cost Management parity).

Serves the Analyze experience ENTIRELY from Azure SQL (finops_daily_dimension_costs
+ finops_daily_subscription_costs), so it is immune to Cost Management API throttling:

  • Scope   — management group / subscription(s) (frontend resolves MG→subs) + optional
              resource-group filter.
  • Period  — presets (today, 7d, last week, 30d, this month, last month, last 3 months)
              OR a custom from/to date range.
  • Group by — subscription | resource_group | service_name | service_family |
              meter_category | location.
  • Cost type — actual | amortized (the dimension table stores both).
  • Chart-ready output for Accumulated (cumulative), Daily (stacked), and Visualize
    (breakdown) — the frontend renders all three from one payload.

Because any single dimension is a complete partition of a subscription's spend, the
subscription/MG total is derived by summing the `service_family` partition — this gives
uniform actual/amortized support for every grouping.
"""
from __future__ import annotations

import calendar
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

try:
    from services.database import get_raw_connection
except Exception:  # pragma: no cover
    get_raw_connection = None  # type: ignore

_GROUP_DIMS = {"resource_group", "service_name", "service_family", "meter_category", "location"}
_CANON_PARTITION = "service_family"   # any complete partition works for sub/MG totals


def _today() -> date:
    return datetime.now(timezone.utc).date()


# Cost Management publishes a day late, so the warehouse's newest row is typically
# yesterday. Anchoring a rolling "last 30 days" window on TODAY therefore slid the
# window past the data: it dropped a real day off the front and added an empty day at
# the back, under-reporting the estate by that day's spend (1.7% when this was caught).
# Anchor rolling windows on the newest date that actually has data instead.
_ASOF_TTL_SECONDS = 300
_asof_cache: Dict[str, Any] = {"date": None, "ts": 0.0}


def data_asof() -> date:
    """Newest snapshot_date present in the cost warehouse, or today if unknown."""
    import time as _t
    now = _t.monotonic()
    if _asof_cache["date"] is not None and (now - _asof_cache["ts"]) < _ASOF_TTL_SECONDS:
        return _asof_cache["date"]
    asof = _today()
    if get_raw_connection is not None:
        try:
            con = get_raw_connection()
            try:
                row = con.cursor().execute(
                    "SELECT MAX(snapshot_date) FROM finops_daily_dimension_costs "
                    "WHERE dimension = ? AND cost_type = 'actual'",
                    (_CANON_PARTITION,)).fetchone()
                if row and row[0]:
                    latest = row[0]
                    if not isinstance(latest, date):
                        latest = date.fromisoformat(str(latest)[:10])
                    # Never look into the future, and ignore an absurdly stale warehouse
                    # (>10 days) so a broken ETL cannot freeze every window in the past.
                    if latest <= asof and (asof - latest).days <= 10:
                        asof = latest
            finally:
                con.close()
        except Exception as e:
            logger.debug("data_asof lookup failed, falling back to today: %s", e)
    _asof_cache.update({"date": asof, "ts": now})
    return asof


def resolve_period(period: Optional[str], date_from: Optional[str], date_to: Optional[str]) -> Tuple[str, str]:
    """Return (from, to) as YYYY-MM-DD. Explicit date_from/date_to win (custom range)."""
    if date_from and date_to:
        return date_from[:10], date_to[:10]
    t = _today()
    p = (period or "last_30d").lower()
    # Rolling day-count windows anchor on the newest day of data, not the wall clock.
    r = data_asof()
    if p in ("today", "1d", "last_1d"):
        return str(r), str(r)
    if p in ("7d", "last_7d", "last_week"):
        return str(r - timedelta(days=6)), str(r)
    if p in ("14d", "last_14d"):
        return str(r - timedelta(days=13)), str(r)
    if p in ("30d", "last_30d"):
        return str(r - timedelta(days=29)), str(r)
    if p == "this_month":
        return str(t.replace(day=1)), str(t)
    if p == "last_month":
        first_this = t.replace(day=1)
        last_prev = first_this - timedelta(days=1)
        return str(last_prev.replace(day=1)), str(last_prev)
    if p in ("3m", "last_3m", "last_3_months", "90d", "last_90d"):
        start = (t.replace(day=1))
        for _ in range(2):
            start = (start - timedelta(days=1)).replace(day=1)
        return str(start), str(t)
    if p in ("6m", "last_6_months"):
        start = t.replace(day=1)
        for _ in range(5):
            start = (start - timedelta(days=1)).replace(day=1)
        return str(start), str(t)
    if p in ("12m", "last_12_months", "1y"):
        start = t.replace(day=1)
        for _ in range(11):
            start = (start - timedelta(days=1)).replace(day=1)
        return str(start), str(t)
    return str(r - timedelta(days=29)), str(r)   # default is last_30d


def _norm_cost_type(ct: Optional[str]) -> str:
    return "amortized" if str(ct or "").lower().startswith("amort") else "actual"


def _previous_period(d_from: str, d_to: str) -> Tuple[str, str]:
    """Comparison window preceding [d_from, d_to].

    If the range is a full calendar month (1st → last day of the same month), the
    comparison is the *previous calendar month* (what users mean by "vs last month").
    Otherwise it's the immediately-preceding window of equal length."""
    try:
        a = datetime.strptime(d_from, "%Y-%m-%d").date()
        b = datetime.strptime(d_to, "%Y-%m-%d").date()
    except Exception:
        return d_from, d_to
    last_day = calendar.monthrange(a.year, a.month)[1]
    if a.day == 1 and b.day == last_day and a.year == b.year and a.month == b.month:
        prev_last = a - timedelta(days=1)           # last day of previous month
        return str(prev_last.replace(day=1)), str(prev_last)
    length = (b - a).days + 1
    prev_to = a - timedelta(days=1)
    prev_from = prev_to - timedelta(days=length - 1)
    return str(prev_from), str(prev_to)


def _agg_by_key(cur, ct: str, d_from: str, d_to: str, gb: str,
                subs: List[str], resource_group: Optional[str]) -> Tuple[Dict[str, float], float]:
    """Aggregate cost by group key + authoritative period total for one date window.

    Used for the comparison window; the primary window is aggregated inline in
    analyze() because it additionally needs the daily/stacked series."""
    params: List[Any] = []
    where = ["cost_type = ?", "snapshot_date >= ?", "snapshot_date <= ?"]
    params += [ct, d_from, d_to]
    if gb == "subscription":
        where.append("dimension = ?"); params.append(_CANON_PARTITION)
        key_expr = "subscription_id"
    else:
        where.append("dimension = ?"); params.append(gb)
        key_expr = "dim_value"
    if resource_group and gb == "resource_group":
        where.append("dim_value = ?"); params.append(resource_group)
    if subs:
        ph = ",".join("?" * len(subs)); where.append(f"subscription_id IN ({ph})"); params += subs
    by_key: Dict[str, float] = {}
    total = 0.0
    try:
        for k, c in cur.execute(
            f"SELECT {key_expr} AS k, SUM(cost_usd) AS c FROM finops_daily_dimension_costs "
            f"WHERE {' AND '.join(where)} GROUP BY {key_expr}", params
        ).fetchall():
            c = float(c or 0); k = str(k or "(none)")
            by_key[k] = by_key.get(k, 0.0) + c
            total += c
    except Exception:
        return {}, 0.0
    # Authoritative total from canonical partition when grouping by a sparse dimension.
    period_total = round(total, 2)
    if gb not in ("subscription", _CANON_PARTITION):
        try:
            cw = ["cost_type = ?", "snapshot_date >= ?", "snapshot_date <= ?", "dimension = ?"]
            cp: List[Any] = [ct, d_from, d_to, _CANON_PARTITION]
            if subs:
                cph = ",".join("?" * len(subs)); cw.append(f"subscription_id IN ({cph})"); cp += subs
            row = cur.execute(
                f"SELECT SUM(cost_usd) FROM finops_daily_dimension_costs WHERE {' AND '.join(cw)}", cp
            ).fetchone()
            if row and row[0] is not None:
                period_total = round(float(row[0]), 2)
        except Exception:
            pass
    return by_key, period_total


def analyze(
    subscription_ids: Optional[List[str]] = None,
    group_by: str = "service_name",
    period: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    cost_type: str = "actual",
    resource_group: Optional[str] = None,
    top: int = 12,
    compare: bool = False,
    compare_from: Optional[str] = None,
    compare_to: Optional[str] = None,
) -> Dict[str, Any]:
    """Warehouse-backed Analyze. Returns chart-ready series + breakdown + stacked."""
    if get_raw_connection is None:
        return _empty("database unavailable", group_by, cost_type)

    d_from, d_to = resolve_period(period, date_from, date_to)
    ct = _norm_cost_type(cost_type)
    gb = group_by if group_by in _GROUP_DIMS or group_by == "subscription" else "service_name"
    subs = [s for s in (subscription_ids or []) if s]

    # Build the row query. Subscription/MG totals come from summing the canonical
    # partition; other groupings read that dimension directly.
    params: List[Any] = []
    where = ["cost_type = ?", "snapshot_date >= ?", "snapshot_date <= ?"]
    params += [ct, d_from, d_to]
    if gb == "subscription":
        where.append("dimension = ?"); params.append(_CANON_PARTITION)
        key_expr = "subscription_id"
    else:
        where.append("dimension = ?"); params.append(gb)
        key_expr = "dim_value"
    if resource_group and gb != "resource_group":
        # RG filter with a different grouping isn't representable in the per-dimension
        # rollup; caller should group_by=resource_group for RG focus. Ignored here.
        pass
    if resource_group and gb == "resource_group":
        where.append("dim_value = ?"); params.append(resource_group)
    if subs:
        ph = ",".join("?" * len(subs))
        where.append(f"subscription_id IN ({ph})")
        params += subs

    sql = (
        f"SELECT snapshot_date, {key_expr} AS k, SUM(cost_usd) AS c "
        f"FROM finops_daily_dimension_costs WHERE {' AND '.join(where)} "
        f"GROUP BY snapshot_date, {key_expr}"
    )

    try:
        con = get_raw_connection()
        cur = con.cursor()
        rows = cur.execute(sql, params).fetchall()
    except Exception as e:
        return _empty(f"query failed: {e}", group_by, cost_type)

    # Aggregate.
    by_day: Dict[str, float] = {}
    by_key: Dict[str, float] = {}
    by_day_key: Dict[str, Dict[str, float]] = {}
    total = 0.0
    for sd, k, c in rows:
        c = float(c or 0)
        k = str(k or "(none)")
        by_day[sd] = by_day.get(sd, 0.0) + c
        by_key[k] = by_key.get(k, 0.0) + c
        by_day_key.setdefault(sd, {})[k] = by_day_key.get(sd, {}).get(k, 0.0) + c
        total += c

    # Top-N keys, rest → Other.
    top_keys = [k for k, _ in sorted(by_key.items(), key=lambda x: -x[1])[:top]]
    top_set = set(top_keys)
    breakdown = [{"key": k, "cost": round(by_key[k], 2)} for k in top_keys]
    other = round(sum(v for k, v in by_key.items() if k not in top_set), 2)
    if other > 0:
        breakdown.append({"key": "Other", "cost": other})

    # Authoritative period total from the canonical (always-complete) partition, so the
    # headline is correct even if the selected group-by dimension is mid-backfill.
    period_total = round(total, 2)
    if gb not in ("subscription", _CANON_PARTITION):
        try:
            cw = ["cost_type = ?", "snapshot_date >= ?", "snapshot_date <= ?", "dimension = ?"]
            cp: List[Any] = [ct, d_from, d_to, _CANON_PARTITION]
            if subs:
                cph = ",".join("?" * len(subs)); cw.append(f"subscription_id IN ({cph})"); cp += subs
            row = cur.execute(
                f"SELECT SUM(cost_usd) FROM finops_daily_dimension_costs WHERE {' AND '.join(cw)}", cp
            ).fetchone()
            if row and row[0] is not None:
                period_total = round(float(row[0]), 2)
        except Exception:
            pass
    breakdown_sum = round(sum(b["cost"] for b in breakdown), 2)
    breakdown_coverage_pct = round(breakdown_sum / period_total * 100, 1) if period_total > 0 else 100.0

    # ── Optional period comparison ────────────────────────────────────────────
    # Auto = the immediately-preceding window of equal length; or an explicit
    # compare_from/compare_to. Each breakdown row gets prev_cost + delta.
    cmp_meta: Dict[str, Any] = {}
    if compare or (compare_from and compare_to):
        if compare_from and compare_to:
            c_from, c_to = compare_from[:10], compare_to[:10]
        else:
            c_from, c_to = _previous_period(d_from, d_to)
        prev_by_key, prev_total = _agg_by_key(cur, ct, c_from, c_to, gb, subs, resource_group)
        for b in breakdown:
            if b["key"] == "Other":
                pv = round(sum(v for k, v in prev_by_key.items() if k not in top_set), 2)
            else:
                pv = round(prev_by_key.get(b["key"], 0.0), 2)
            b["prev_cost"] = pv
            b["delta_usd"] = round(b["cost"] - pv, 2)
            b["delta_pct"] = round((b["cost"] - pv) / pv * 100, 1) if pv > 0 else (None if b["cost"] == 0 else 100.0)
        cmp_meta = {
            "compare_from": c_from,
            "compare_to": c_to,
            "compare_total_usd": prev_total,
            "total_delta_usd": round(period_total - prev_total, 2),
            "total_delta_pct": round((period_total - prev_total) / prev_total * 100, 1) if prev_total > 0 else None,
        }

    # Dense daily axis (fill gaps with 0) for accumulated + daily charts.
    all_dates = _date_axis(d_from, d_to)
    series: List[Dict[str, Any]] = []
    cum = 0.0
    for dt in all_dates:
        day_total = round(by_day.get(dt, 0.0), 2)
        cum = round(cum + day_total, 2)
        series.append({"date": dt, "cost": day_total, "accumulated": cum})

    # Stacked daily (date × top keys, rest into Other).
    stacked: List[Dict[str, Any]] = []
    for dt in all_dates:
        rec: Dict[str, Any] = {"date": dt}
        dk = by_day_key.get(dt, {})
        other_day = 0.0
        for k, v in dk.items():
            if k in top_set:
                rec[k] = round(rec.get(k, 0.0) + v, 2)
            else:
                other_day += v
        if other_day > 0:
            rec["Other"] = round(other_day, 2)
        stacked.append(rec)

    return {
        "group_by": gb,
        "cost_type": ct,
        "date_from": d_from,
        "date_to": d_to,
        "currency": "USD",
        "total_cost": round(total, 2),
        "period_total_usd": period_total,
        "breakdown_coverage_pct": breakdown_coverage_pct,
        "series": series,               # [{date, cost, accumulated}]
        "breakdown": breakdown,         # [{key, cost}] top-N + Other
        "stacked": stacked,             # [{date, <key>:cost, Other:cost}]
        "series_keys": top_keys + (["Other"] if other > 0 else []),
        "subscription_ids": subs,
        "resource_group": resource_group or None,
        "data_source": "warehouse",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        **cmp_meta,
    }


def _date_axis(d_from: str, d_to: str) -> List[str]:
    try:
        a = datetime.strptime(d_from, "%Y-%m-%d").date()
        b = datetime.strptime(d_to, "%Y-%m-%d").date()
    except Exception:
        return []
    if b < a or (b - a).days > 400:
        return []
    out = []
    cur = a
    while cur <= b:
        out.append(str(cur))
        cur += timedelta(days=1)
    return out


def estate_total(
    period: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    subscription_ids: Optional[List[str]] = None,
    cost_type: str = "actual",
) -> float:
    """Authoritative estate spend for a period, from the warehouse (throttle-immune).

    Sums the canonical `service_family` partition (a complete partition of spend) so
    this is the SINGLE source of truth for the headline total across the FinOps UI
    (Overview, Cost Insights, Cost Lens) — reconciling them with the Analyze tab.
    Returns 0.0 when the warehouse is unavailable/empty (caller falls back)."""
    if get_raw_connection is None:
        _LAST_ESTATE_TOTAL_ERROR["error"] = "Cost warehouse is not configured, so spend was never read."
        return 0.0
    d_from, d_to = resolve_period(period, date_from, date_to)
    ct = _norm_cost_type(cost_type)
    subs = [s for s in (subscription_ids or []) if s]
    try:
        con = get_raw_connection()
        cur = con.cursor()
        _, total = _agg_by_key(cur, ct, d_from, d_to, "service_family", subs, None)
        _LAST_ESTATE_TOTAL_ERROR["error"] = ""
        return round(float(total or 0.0), 2)
    except Exception as exc:
        # Returning a bare 0.0 here would let a warehouse outage be reported as "$0 spend".
        logger.warning("estate_total failed: %s", exc)
        _LAST_ESTATE_TOTAL_ERROR["error"] = str(exc)
        return 0.0


# Set by estate_total(); read via estate_total_ex() so callers can tell $0 from "unavailable".
_LAST_ESTATE_TOTAL_ERROR: Dict[str, str] = {"error": ""}


def estate_total_ex(
    period: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    subscription_ids: Optional[List[str]] = None,
    cost_type: str = "actual",
) -> Dict[str, Any]:
    """estate_total plus whether the warehouse actually answered.

    ``{"total": float, "ok": bool, "error": str}`` — ``ok=False`` means the total is
    unknown, NOT zero, and must never be printed as a spend figure.
    """
    total = estate_total(period, date_from, date_to, subscription_ids, cost_type)
    err = _LAST_ESTATE_TOTAL_ERROR.get("error", "")
    return {"total": total, "ok": not err, "error": err}


def available_dimensions() -> List[Dict[str, str]]:
    return [
        {"value": "subscription", "label": "Subscription"},
        {"value": "resource_group", "label": "Resource group"},
        {"value": "service_name", "label": "Service"},
        {"value": "service_family", "label": "Service family"},
        {"value": "meter_category", "label": "Meter category"},
        {"value": "location", "label": "Location"},
    ]


def coverage() -> Dict[str, Any]:
    """Data-through-date + row counts so the UI can label freshness / empty-states."""
    if get_raw_connection is None:
        return {"available": False}
    try:
        con = get_raw_connection()
        cur = con.cursor()
        n = cur.execute("SELECT COUNT(*) FROM finops_daily_dimension_costs").fetchone()[0]
        rng = cur.execute("SELECT MIN(snapshot_date), MAX(snapshot_date) FROM finops_daily_dimension_costs").fetchone()
        return {"available": n > 0, "rows": int(n or 0),
                "date_from": rng[0] if rng else None, "date_to": rng[1] if rng else None}
    except Exception:
        return {"available": False}


def _empty(reason: str, group_by: str, cost_type: str) -> Dict[str, Any]:
    return {
        "group_by": group_by, "cost_type": _norm_cost_type(cost_type),
        "total_cost": 0.0, "series": [], "breakdown": [], "stacked": [], "series_keys": [],
        "data_source": "unavailable", "message": reason,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
