"""
FinOps Budget Scenario / Burndown.

Given a monthly budget target (and an optional month-over-month growth assumption),
build a day-by-day burndown for the CURRENT month: the linear budget line, the
cumulative actual spend so far (from the real daily series), and the projected
cumulative spend to end-of-month (linear MTD run-rate, optionally grown). Returns
the series plus projected EOM, variance and burn %.

PURE — operates on the current-month daily cost array.
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta
from typing import Any, Dict, List, Optional


def build_burndown(
    total_daily_cm: List[float],
    monthly_budget: float,
    growth_pct: float = 0.0,
    today: Optional[date] = None,
) -> Dict[str, Any]:
    today = today or date.today()
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    day_of_month = today.day
    cm = [float(x or 0) for x in (total_daily_cm or [])]
    # Align the daily array to the elapsed days of the month (it is day1→today).
    cm = cm[-day_of_month:] if len(cm) >= day_of_month else ([0.0] * (day_of_month - len(cm)) + cm)

    budget = float(monthly_budget or 0)
    daily_budget = budget / days_in_month if days_in_month else 0.0

    # MTD run-rate for the forecast tail (optionally grown).
    mtd_spend = sum(cm)
    run_rate = (mtd_spend / day_of_month) if day_of_month else 0.0
    run_rate *= (1 + (float(growth_pct or 0) / 100.0))

    series: List[Dict[str, Any]] = []
    actual_cum = 0.0
    first_day = today.replace(day=1)
    for d in range(1, days_in_month + 1):
        dt = str(first_day + timedelta(days=d - 1))
        row: Dict[str, Any] = {"day": d, "date": dt, "budget": round(daily_budget * d, 2)}
        if d <= day_of_month:
            actual_cum += cm[d - 1] if d - 1 < len(cm) else 0.0
            row["actual"] = round(actual_cum, 2)
            row["forecast"] = round(actual_cum, 2)
        else:
            row["actual"] = None
            row["forecast"] = round(actual_cum + run_rate * (d - day_of_month), 2)
        series.append(row)

    projected_eom = round(actual_cum + run_rate * (days_in_month - day_of_month), 2)
    variance = round(budget - projected_eom, 2)
    return {
        "series": series,
        "monthly_budget_usd": round(budget, 2),
        "mtd_spend_usd": round(mtd_spend, 2),
        "projected_eom_usd": projected_eom,
        "variance_usd": variance,
        "burn_pct": round(mtd_spend / budget * 100, 1) if budget > 0 else 0.0,
        "projected_pct": round(projected_eom / budget * 100, 1) if budget > 0 else 0.0,
        "status": "over" if projected_eom > budget else ("at_risk" if budget > 0 and projected_eom > budget * 0.9 else "on_track"),
        "day_of_month": day_of_month,
        "days_in_month": days_in_month,
        "growth_pct": float(growth_pct or 0),
    }
