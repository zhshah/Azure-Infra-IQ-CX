"""
FinOps Forecast Service.

Calls Azure Cost Management Forecast API (CostManagementClient.forecast.usage)
— the exact same Azure-native ML forecasting Azure Portal Cost Analysis shows.

Falls back to linear regression when the Forecast API returns 403 (some billing
account types don't support it).
"""
from __future__ import annotations

import logging
from datetime import datetime, date, timedelta, timezone
from typing import List, Optional

logger = logging.getLogger(__name__)

try:
    from services import finops_data_service as fds
    from services.finops_data_service import (
        query_forecast,
        query_cost_multi_subscription,
        linear_regression_forecast,
        normalise_cost_rows,
        get_subscription_ids,
    )
except ImportError:
    import finops_data_service as fds  # type: ignore
    from finops_data_service import (  # type: ignore
        query_forecast,
        query_cost_multi_subscription,
        linear_regression_forecast,
        normalise_cost_rows,
        get_subscription_ids,
    )

from models.schemas import FinOpsForecastPoint, FinOpsForecastResult


def get_forecast(
    horizon_days: int = 90,
    subscription_ids: Optional[List[str]] = None,
    scope_label: str = "All Subscriptions",
) -> FinOpsForecastResult:
    """
    Return historical actuals + Azure-forecasted future costs.

    Tries Azure Forecast API first.  If it returns 403 / empty, falls back to
    linear regression on the last 90 days of daily actuals.
    """
    if subscription_ids is None:
        subscription_ids = get_subscription_ids()

    today = datetime.now(tz=timezone.utc).date()
    history_start = today - timedelta(days=89)   # 90 days of history
    forecast_end  = today + timedelta(days=horizon_days)

    # ── Step 1: fetch historical daily actuals ────────────────────────────────
    hist_rows = query_cost_multi_subscription(
        subscription_ids, history_start, today,
        granularity="Daily", group_by=[], cost_type="ActualCost",
    )
    hist_norm = normalise_cost_rows(hist_rows, [])

    daily_hist: dict = {}
    for r in hist_norm:
        if r["date"]:
            daily_hist[r["date"]] = daily_hist.get(r["date"], 0.0) + r["cost_usd"]

    history_points: List[FinOpsForecastPoint] = [
        FinOpsForecastPoint(
            date=d,
            cost_usd=round(c, 2),
            is_forecast=False,
            source="azure_cost_management",
        )
        for d, c in sorted(daily_hist.items())
    ]

    # ── Step 2: try Azure native forecast ────────────────────────────────────
    azure_forecast_rows: list = []
    method = "azure_cost_management"

    for sub_id in subscription_ids:
        scope = f"/subscriptions/{sub_id}"
        rows = query_forecast(
            scope, today + timedelta(days=1), forecast_end,
            granularity="Daily", cost_type="ActualCost",
        )
        azure_forecast_rows.extend(rows)

    forecast_points: List[FinOpsForecastPoint] = []

    if azure_forecast_rows:
        # Azure Forecast API returns actuals + forecast in one response
        # Filter to future dates only
        fc_norm = normalise_cost_rows(azure_forecast_rows, [])
        daily_fc: dict = {}
        for r in fc_norm:
            if r["date"] and r["date"] > str(today):
                daily_fc[r["date"]] = daily_fc.get(r["date"], 0.0) + r["cost_usd"]

        # Azure API includes confidence bands via ChargeType dimension
        # Build points from aggregated data
        for d, c in sorted(daily_fc.items()):
            forecast_points.append(FinOpsForecastPoint(
                date=d,
                cost_usd=round(c, 2),
                confidence_lower=round(c * 0.85, 2),   # ±15% bands as approximation
                confidence_upper=round(c * 1.15, 2),
                is_forecast=True,
                source="azure_cost_management",
            ))

    # ── Step 3: fallback to linear regression if Azure returned nothing ───────
    if not forecast_points:
        method = "linear_regression_fallback"
        ordered_actuals = [daily_hist.get(str(history_start + timedelta(days=i)), 0.0)
                           for i in range(90)]
        projected = linear_regression_forecast(ordered_actuals, horizon_days)
        std_dev = (sum((v - sum(ordered_actuals) / max(len(ordered_actuals), 1)) ** 2
                       for v in ordered_actuals) / max(len(ordered_actuals), 1)) ** 0.5
        for i, c in enumerate(projected):
            fc_date = str(today + timedelta(days=i + 1))
            forecast_points.append(FinOpsForecastPoint(
                date=fc_date,
                cost_usd=round(c, 2),
                confidence_lower=round(max(0, c - std_dev), 2),
                confidence_upper=round(c + std_dev, 2),
                is_forecast=True,
                source="linear_regression_fallback",
            ))

    # ── Step 4: compute summary metrics ──────────────────────────────────────
    total_forecast = sum(p.cost_usd for p in forecast_points)
    eom_forecast   = _compute_eom_forecast(daily_hist, forecast_points, today)
    eoq_forecast   = _compute_eoq_forecast(daily_hist, forecast_points, today)

    # Trend direction from last 30d actuals
    recent = sorted(daily_hist.items())[-30:] if len(daily_hist) >= 30 else sorted(daily_hist.items())
    if len(recent) >= 2:
        first_half = sum(v for _, v in recent[:len(recent)//2])
        second_half = sum(v for _, v in recent[len(recent)//2:])
        mom = (second_half - first_half) / first_half * 100 if first_half else 0.0
        trend = "rising" if mom > 5 else ("falling" if mom < -5 else "stable")
    else:
        mom   = 0.0
        trend = "stable"

    confidence = "high" if method == "azure_cost_management" else "medium"

    return FinOpsForecastResult(
        scope_label=scope_label,
        history=history_points,
        forecast=forecast_points,
        horizon_days=horizon_days,
        forecast_method=method,
        total_forecast_usd=round(total_forecast, 2),
        eom_forecast_usd=round(eom_forecast, 2),
        eoq_forecast_usd=round(eoq_forecast, 2),
        trend_direction=trend,
        mom_trend_pct=round(mom, 1),
        confidence_level=confidence,
        generated_at=datetime.now(tz=timezone.utc).isoformat(),
    )


def _compute_eom_forecast(daily_hist: dict, forecast_points: List[FinOpsForecastPoint], today: date) -> float:
    """Project total spend for the current calendar month."""
    month_start = today.replace(day=1)
    # Actuals for current month so far
    actual_mtd = sum(
        v for d, v in daily_hist.items()
        if d >= str(month_start)
    )
    # Forecast for remaining days this month
    if today.month == 12:
        month_end = date(today.year, 12, 31)
    else:
        month_end = date(today.year, today.month + 1, 1) - timedelta(days=1)

    forecast_remaining = sum(
        p.cost_usd for p in forecast_points
        if str(today) < p.date <= str(month_end)
    )
    return actual_mtd + forecast_remaining


def _compute_eoq_forecast(daily_hist: dict, forecast_points: List[FinOpsForecastPoint], today: date) -> float:
    """Project total spend for the current calendar quarter."""
    q = (today.month - 1) // 3
    q_start = date(today.year, q * 3 + 1, 1)
    end_month = min(q * 3 + 3, 12)
    if end_month == 12:
        q_end = date(today.year, 12, 31)
    else:
        q_end = date(today.year, end_month + 1, 1) - timedelta(days=1)

    actual_qtd = sum(
        v for d, v in daily_hist.items()
        if d >= str(q_start)
    )
    forecast_remaining = sum(
        p.cost_usd for p in forecast_points
        if str(today) < p.date <= str(q_end)
    )
    return actual_qtd + forecast_remaining
