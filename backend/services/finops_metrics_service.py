"""
FinOps Metrics Service — the SINGLE SOURCE OF TRUTH for headline numbers.

Every KPI card, dashboard tile, Cost Studio strip, and AI narrative MUST read
from `get_metrics_summary()` so the same number is never computed two different
ways in two different places (the root cause of the Overview-vs-AI contradictions:
310-vs-183 untagged, two different forecasts, "identified potential" shown as if
it were monthly run-rate, etc.).

Design rules (from the Wiring & Fix Plan, Fix #1):
  • Each metric is defined ONCE here.
  • Untagged = a resource carrying NONE of the mandatory tag keys.
  • ONE forecast model — linear month-to-date run-rate — shared by card and chart.
  • "Annualized identified potential" is kept SEPARATE from "monthly run-rate savings".
  • Always return dataThroughDate + currency so the UI can label freshness/units.

The object shape is intentionally stable and JSON-serialisable so the frontend
can bind to it directly.
"""
from __future__ import annotations

import calendar
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger("finops.metrics")

# Mandatory tag keys — matched case/hyphen-insensitively downstream.
MANDATORY_TAG_KEYS = ["owner", "environment", "project", "cost-center"]


def _norm_key(k: str) -> str:
    return str(k).lower().replace("-", "").replace("_", "").replace(" ", "")

_MANDATORY_NORM = {_norm_key(k) for k in MANDATORY_TAG_KEYS}


def _resource_tag_counts(resources: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Single definition of resource tagging health.

      untagged        = resources carrying NONE of the mandatory tag keys
      tagged          = total - untagged  (has at least one mandatory tag)
      tagCompliancePct = tagged / total * 100

    Case- and hyphen-insensitive: "CostCenter" satisfies "cost-center".
    """
    total = len(resources)
    untagged = 0
    for r in resources:
        tags = r.get("tags") or {}
        present = _MANDATORY_NORM & {_norm_key(k) for k in tags.keys()}
        if not present:
            untagged += 1
    tagged = total - untagged
    pct = round(tagged / total * 100, 1) if total else 100.0
    return {"total": total, "tagged": tagged, "untagged": untagged, "tagCompliancePct": pct}


def _orphan_stats(dash: Dict[str, Any]) -> Dict[str, Any]:
    """Orphan count + monthly run-rate cost from the dashboard cache."""
    count = 0
    monthly = 0.0
    for res in dash.get("resources", []) or []:
        if not res.get("is_orphan"):
            continue
        count += 1
        # Prefer current-month run-rate; fall back to last full month when the
        # current month hasn't accrued (or Cost Management is throttling
        # per-resource granularity).
        c = float(res.get("cost_current_month", 0) or 0) or float(res.get("cost_previous_month", 0) or 0)
        monthly += c
    return {"count": count, "monthly": round(monthly, 2)}


def _linear_mtd_forecast(spend_mtd: float, today) -> Dict[str, Any]:
    """
    THE forecast model. Linear month-to-date run-rate:
        eom = spend_mtd / day_of_month * days_in_month
    Confidence band widens early in the month (fewer days observed).
    """
    day = today.day
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    if day <= 0 or spend_mtd <= 0:
        return {"eom": 0.0, "model": "linear-mtd", "low": 0.0, "high": 0.0}
    eom = spend_mtd / day * days_in_month
    # Band: proportional to how little of the month has elapsed.
    elapsed = day / days_in_month
    spread = (1.0 - elapsed) * 0.35 + 0.05  # 40% early, ~5% at month end
    return {
        "eom": round(eom, 2),
        "model": "linear-mtd",
        "low": round(eom * (1 - spread), 2),
        "high": round(eom * (1 + spread), 2),
    }


def get_metrics_summary(
    subscription_ids: Optional[List[str]] = None,
    period: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    Assemble the one canonical metrics object. Reuses `get_finops_kpi` (spend,
    budgets, reservations, anomalies) and the dashboard cache (resources, orphans,
    savings) so nothing is recomputed inconsistently.
    """
    from services.finops_service import get_finops_kpi, get_savings_summary
    from services.persistence_service import load_latest_dashboard

    today = datetime.now(tz=timezone.utc).date()

    # Spend/trend/anomalies are sourced from the dashboard cache below (throttle-immune);
    # reservations & budgets come from their own services. We deliberately do NOT call the
    # live get_finops_kpi here — it 429-stalls on rate-limited tenants and would blank the UI.
    kpi = None

    dash = load_latest_dashboard() or {}
    resources = dash.get("resources", []) or []

    # ── Resources / tagging (single definition) ─────────────────────────────────
    resource_counts = _resource_tag_counts(resources)

    # ── Spend — CACHE-FIRST (throttle-immune). The live get_finops_kpi 429-returns
    #    $0 on rate-limited tenants, which must NEVER zero out the real cached spend. ─
    dk = dash.get("kpi") or {}
    def _dkf(*keys) -> float:
        for k in keys:
            v = dk.get(k)
            if v is not None:
                try:
                    return float(v)
                except (TypeError, ValueError):
                    pass
        return 0.0
    cache_mtd = _dkf("total_cost_current_month", "total_spend_mtd")
    cache_prev = _dkf("total_cost_previous_month", "total_spend_last_month")
    live_mtd = round(float(getattr(kpi, "total_spend_mtd", 0.0) or 0.0), 2)
    live_prev = round(float(getattr(kpi, "total_spend_last_month", 0.0) or 0.0), 2)
    # Prefer whichever source actually has data (cache is primary; live is a fallback).
    spend_mtd = round(cache_mtd if cache_mtd > 0 else live_mtd, 2)
    prior_full = round(cache_prev if cache_prev > 0 else live_prev, 2)

    # ── AUTHORITATIVE OVERRIDE (warehouse) — the single source of truth ──────────
    # Per-resource / cached KPI spend is undercounted on 429-throttled tenants, so the
    # subscription-scope warehouse wins. `mtd` must be an ACTUAL month-to-date figure:
    # it previously carried the rolling-30-day run rate, so the UI showed "This month
    # MTD $2,491" for a month that had really cost $690. The run rate is still exposed,
    # under its own name, for the surfaces that legitimately want a 30-day window.
    rolling_30d = 0.0
    mom_basis_label = "prior_month_full"
    try:
        from services import finops_dashboard_service as _fdc
        _auth = _fdc.get_authoritative_spend()
        if _auth.get("mtd_usd", 0) > 0:
            spend_mtd = round(_auth["mtd_usd"], 2)
        if _auth.get("last_month_usd", 0) > 0:
            prior_full = round(_auth["last_month_usd"], 2)
        rolling_30d = round(_auth.get("rolling_30d_usd", 0) or 0, 2)
        # Like-for-like only works when the prior period was actually collected.
        # Cost history began mid-July here, so Jul 1-13 held $239 against a $2,200
        # month — comparing against it invented a +212% rise. Require most of those
        # days to be present, else prorate the full month.
        elapsed = int(_auth.get("elapsed_days", 0) or 0)
        have_days = int(_auth.get("prior_month_to_date_days", 0) or 0)
        prior_days = int(_auth.get("prior_month_days", 0) or 0)
        if elapsed and have_days >= max(1, int(elapsed * 0.8)):
            prior_mtd = round(_auth.get("prior_month_to_date_usd", 0) or 0, 2)
            mom_basis_label = "prior_month_to_date"
        elif prior_full > 0 and elapsed and prior_days:
            prior_mtd = round(prior_full * min(1.0, elapsed / prior_days), 2)
            mom_basis_label = "prior_month_prorated"
        else:
            prior_mtd = prior_full
    except Exception as e:
        logger.debug("metrics: authoritative spend unavailable: %s", e)
        prior_mtd = prior_full
    if not rolling_30d:
        try:
            from services import cost_analytics_service as _ca
            rolling_30d = round(_ca.estate_total(period="last_30d",
                                                 subscription_ids=subscription_ids) or 0.0, 2)
        except Exception:
            pass

    _basis = prior_mtd if prior_mtd > 0 else prior_full
    mom_delta_usd = round(spend_mtd - _basis, 2)
    mom_delta_pct = round((mom_delta_usd / _basis * 100.0), 1) if _basis > 0 else 0.0

    # Trend cache-first too (live arrays can be empty under throttling).
    trend_dates = list(getattr(kpi, "cost_trend_dates", []) or []) if kpi else []
    trend_values = list(getattr(kpi, "cost_trend_30d", []) or []) if kpi else []
    if not any(float(v or 0) for v in trend_values):
        pm = [float(x or 0) for x in (dash.get("total_daily_pm") or [])]
        cm = [float(x or 0) for x in (dash.get("total_daily_cm") or [])]
        combined = pm + cm
        if combined:
            trend_values = [round(v, 2) for v in combined[-30:]]
            n = len(trend_values)
            trend_dates = [str(today - timedelta(days=n - 1 - i)) for i in range(n)]

    # ── Forecast (ONE model) ──────────────────────────────────────────────────────
    # When the warehouse run-rate is available, the rolling 30-day total IS the monthly
    # run-rate (robust; avoids the noisy early-month linear-MTD overshoot). Else linear.
    if rolling_30d and rolling_30d > 0:
        forecast = {"eom": round(rolling_30d, 2), "model": "rolling-30d-run-rate",
                    "low": round(rolling_30d * 0.95, 2), "high": round(rolling_30d * 1.05, 2)}
    else:
        forecast = _linear_mtd_forecast(spend_mtd, today)

    # ── Reservations / commitments ─────────────────────────────────────────────────
    reservations = {
        "count": 0,
        "coveragePct": round(float(getattr(kpi, "ri_coverage_pct", 0.0) or 0.0), 1),
        "utilizationPct": round(float(getattr(kpi, "ri_utilization_pct", 0.0) or 0.0), 1),
        "savingsMonthly": 0.0,
        "savingsPlansMonthly": 0.0,
        "expiring30d": 0,
    }
    try:
        from services import commitment_service as commitment_svc
        cs = commitment_svc.get_commitment_summary()
        reservations["count"] = int(getattr(cs, "active_count", 0) or len(getattr(cs, "reservations", []) or []))
        reservations["savingsMonthly"] = round(float(getattr(cs, "monthly_savings", 0.0) or 0.0), 2)
        reservations["savingsPlansMonthly"] = round(
            sum(float(getattr(o, "monthly_savings", 0.0) or 0.0) for o in (getattr(cs, "savings_plan_options", []) or [])),
            2,
        )
        reservations["expiring30d"] = int(getattr(cs, "expiring_30d", 0) or 0)
    except Exception as e:
        logger.debug("metrics: commitment summary unavailable: %s", e)

    # ── Budgets ──────────────────────────────────────────────────────────────────
    breaching: List[Dict[str, Any]] = []
    try:
        from services import budget_service as budget_svc
        for b in budget_svc.list_budgets():
            v = budget_svc.compute_budget_variance(b.id)
            if v and getattr(v, "status", "") in ("exceeded", "at_risk"):
                breaching.append({
                    "id": b.id,
                    "name": getattr(b, "name", b.id),
                    "utilizationPct": round(float(getattr(v, "utilization_pct", 0.0) or 0.0), 1),
                    "status": v.status,
                })
    except Exception as e:
        logger.debug("metrics: budget breaching list unavailable: %s", e)
    budgets = {
        "count": int(getattr(kpi, "budgets_exceeded", 0) or 0) + int(getattr(kpi, "budgets_at_risk", 0) or 0)
        if kpi else len(breaching),
        "utilizationPct": round(float(getattr(kpi, "budget_utilization_pct", 0.0) or 0.0), 1),
        "breaching": breaching,
    }
    # count should be TOTAL budgets, not just breaching — recover from list_budgets
    try:
        from services import budget_service as budget_svc
        budgets["count"] = len(budget_svc.list_budgets())
    except Exception:
        pass

    # ── Savings — SEPARATE monthly run-rate from annualized identified potential ──
    orphan = _orphan_stats(dash)
    advisor_monthly = 0.0
    rightsize_monthly = 0.0
    try:
        sav = get_savings_summary(dash)
        by_cat = getattr(sav, "by_category", {}) or {}
        advisor_monthly = round(float(by_cat.get("ri_purchase", 0.0) or 0.0), 2)
        rightsize_monthly = round(float(by_cat.get("rightsize", 0.0) or 0.0), 2)
        monthly_run_rate = round(float(getattr(sav, "total_identified_usd", 0.0) or 0.0), 2)
    except Exception as e:
        logger.debug("metrics: savings summary unavailable: %s", e)
        monthly_run_rate = round(advisor_monthly + rightsize_monthly + orphan["monthly"], 2)

    savings = {
        "advisorMonthly": advisor_monthly,
        "orphanedCount": orphan["count"],
        "orphanedMonthly": orphan["monthly"],
        "rightsizeMonthly": rightsize_monthly,
        "monthlyRunRate": monthly_run_rate,
        # Explicit annualized figure — never conflate with the monthly numbers above.
        "identifiedAnnualizedPotential": round(monthly_run_rate * 12, 2),
    }

    # ── Anomalies ──────────────────────────────────────────────────────────────────
    anomalies = {"openCount": len(dash.get("cost_anomalies", []) or [])}

    # ── Freshness / units ───────────────────────────────────────────────────────────
    data_through = dash.get("last_refreshed") or (
        getattr(kpi, "generated_at", "") if kpi else ""
    ) or datetime.now(tz=timezone.utc).isoformat()

    return {
        "dataThroughDate": data_through,
        "currency": "USD",
        "spend": {
            "mtd": spend_mtd,
            "rolling30d": rolling_30d,
            "priorMonthFull": prior_full,
            "priorMonthToDate": prior_mtd,
            "momDeltaUsd": mom_delta_usd,
            "momDeltaPct": mom_delta_pct,
            "momBasis": mom_basis_label,
        },
        "forecast": forecast,
        "resources": resource_counts,
        "reservations": reservations,
        "budgets": budgets,
        "savings": savings,
        "anomalies": anomalies,
        "trend": {
            "dates": trend_dates,
            "values": trend_values,
        },
        "generatedAt": datetime.now(tz=timezone.utc).isoformat(),
    }
