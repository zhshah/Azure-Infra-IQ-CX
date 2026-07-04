"""
FinOps Anomaly Intelligence — statistical cost-spike detection over the daily
spend series (aggregate / warehouse data — immune to per-resource throttling).

Detects anomalies with a rolling-baseline z-score plus a day-over-day % jump test,
classifies severity/direction, and returns a dated series annotated with the
expected (baseline) value so the UI can draw the band + markers. The endpoint layer
adds an AI root-cause narrative grounded on the anomalies + top cost movers.

PURE functions — operate on a plain daily series list, no Azure calls.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional


def build_series_from_daily(total_daily_pm: List[float], total_daily_cm: List[float],
                            today: Optional[date] = None) -> List[Dict[str, Any]]:
    """Concatenate previous-month + current-month daily arrays into one contiguous
    dated series ending today (matches how the FinOps summary builds its trend)."""
    today = today or date.today()
    pm = [float(x or 0) for x in (total_daily_pm or [])]
    cm = [float(x or 0) for x in (total_daily_cm or [])]
    combined = pm + cm
    n = len(combined)
    if n == 0:
        return []
    return [{"date": str(today - timedelta(days=n - 1 - i)), "cost": round(combined[i], 2)}
            for i in range(n)]


def _mean(xs: List[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def _std(xs: List[float], mu: float) -> float:
    if len(xs) < 2:
        return 0.0
    var = sum((x - mu) ** 2 for x in xs) / (len(xs) - 1)
    return var ** 0.5


def detect_anomalies(
    series: List[Dict[str, Any]],
    window: int = 7,
    z_thresh: float = 2.5,
    pct_thresh: float = 40.0,
    min_abs_usd: float = 1.0,
) -> Dict[str, Any]:
    """Rolling-baseline anomaly detection.

    For each day i (after the first `window` days), the baseline = mean/std of the
    prior `window` days. A day is anomalous when its z-score magnitude ≥ z_thresh AND
    it deviates ≥ pct_thresh% from baseline (and ≥ min_abs_usd in absolute terms so
    tiny tenants don't flag noise). Severity scales with the z-score."""
    pts = [p for p in (series or []) if isinstance(p, dict)]
    out_series: List[Dict[str, Any]] = []
    anomalies: List[Dict[str, Any]] = []

    costs = [float(p.get("cost", 0) or 0) for p in pts]
    for i, p in enumerate(pts):
        cost = costs[i]
        expected = None
        z = 0.0
        dev_pct = 0.0
        is_anom = False
        if i >= window:
            base = costs[i - window:i]
            mu = _mean(base)
            sd = _std(base, mu)
            expected = round(mu, 2)
            if sd > 0:
                z = (cost - mu) / sd
            dev_pct = ((cost - mu) / mu * 100.0) if mu > 0 else (100.0 if cost > 0 else 0.0)
            if abs(z) >= z_thresh and abs(dev_pct) >= pct_thresh and abs(cost - mu) >= min_abs_usd:
                is_anom = True
        rec = {"date": p.get("date"), "cost": round(cost, 2),
               "expected": expected, "z": round(z, 2), "deviation_pct": round(dev_pct, 1),
               "is_anomaly": is_anom}
        out_series.append(rec)
        if is_anom:
            az = abs(z)
            sev = "critical" if az >= 4 else ("high" if az >= 3 else "medium")
            anomalies.append({
                "date": p.get("date"), "cost": round(cost, 2), "expected": expected,
                "deviation_pct": round(dev_pct, 1), "z": round(z, 2),
                "direction": "spike" if cost > (expected or 0) else "drop",
                "severity": sev,
                "delta_usd": round(cost - (expected or 0), 2),
            })

    anomalies.sort(key=lambda a: (-abs(a["z"]), a["date"] or ""))
    return {
        "series": out_series,
        "anomalies": anomalies,
        "anomaly_count": len(anomalies),
        "window": window,
        "z_threshold": z_thresh,
        "pct_threshold": pct_thresh,
        "days": len(pts),
    }
