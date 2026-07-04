"""
FinOps Commitment (Reservation / Savings Plan) What-if Planner.

Lets the user simulate "what if we commit to cover X% of our steady-state compute
& database spend for 1 or 3 years?" and see projected monthly/annual savings, the
committed run-rate, and break-even — grounded in the REAL on-demand eligible spend
from the estate (resources not already reservation-covered), using standard Azure
commitment discount bands. Pure — operates on the dashboard cache dict.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fnum(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _run_rate(r: Dict[str, Any]) -> float:
    cur = _fnum(r.get("cost_current_month"))
    return cur if cur > 0 else _fnum(r.get("cost_previous_month"))


# Commitment-eligible families (compute + managed databases — the usual RI/SP targets).
_ELIGIBLE = ("virtualmachines", "flexibleservers", "servers/databases", "manageddatabases",
             "cosmosdb", "databaseaccounts", "redis", "dedicatedhost")
# Typical Azure discount bands (indicative; real % varies by SKU/region/term).
_DISCOUNT = {
    "1yr": {"no_upfront": 0.28, "partial_upfront": 0.32, "all_upfront": 0.36},
    "3yr": {"no_upfront": 0.48, "partial_upfront": 0.54, "all_upfront": 0.60},
}


def _eligible_spend(resources: List[Dict[str, Any]]) -> float:
    total = 0.0
    for r in resources:
        t = (r.get("resource_type", "") or "").lower()
        if any(n in t for n in _ELIGIBLE) and not r.get("ri_covered"):
            total += _run_rate(r)
    return total


def simulate(
    dash: Optional[Dict[str, Any]],
    term: str = "3yr",
    coverage_target_pct: float = 75.0,
    payment: str = "no_upfront",
) -> Dict[str, Any]:
    resources = dash.get("resources", []) if isinstance(dash, dict) else []
    resources = [r for r in (resources or []) if isinstance(r, dict)]
    eligible = round(_eligible_spend(resources), 2)
    term = term if term in _DISCOUNT else "3yr"
    payment = payment if payment in _DISCOUNT[term] else "no_upfront"
    discount = _DISCOUNT[term][payment]

    def _scenario(cov_pct: float, t: str, pay: str) -> Dict[str, Any]:
        d = _DISCOUNT[t][pay]
        covered = eligible * (cov_pct / 100.0)
        on_demand_of_covered = covered
        committed = covered * (1 - d)
        monthly_savings = covered * d
        uncovered = eligible - covered
        return {
            "term": t, "payment": pay, "coverage_target_pct": round(cov_pct, 1),
            "discount_pct": round(d * 100, 1),
            "covered_on_demand_usd": round(on_demand_of_covered, 2),
            "committed_monthly_usd": round(committed, 2),
            "uncovered_monthly_usd": round(uncovered, 2),
            "monthly_savings_usd": round(monthly_savings, 2),
            "annual_savings_usd": round(monthly_savings * 12, 2),
            "term_savings_usd": round(monthly_savings * 12 * (3 if t == "3yr" else 1), 2),
            "new_monthly_run_rate_usd": round(committed + uncovered, 2),
        }

    selected = _scenario(coverage_target_pct, term, payment)

    # Savings curve for the chart (both terms across coverage levels).
    curve = []
    for cov in (25, 50, 75, 100):
        curve.append({
            "coverage_pct": cov,
            "savings_1yr": _scenario(cov, "1yr", payment)["monthly_savings_usd"],
            "savings_3yr": _scenario(cov, "3yr", payment)["monthly_savings_usd"],
        })

    return {
        "eligible_monthly_spend_usd": eligible,
        "selected": selected,
        "savings_curve": curve,
        "assumptions": {
            "discount_bands": _DISCOUNT,
            "note": "Indicative Azure commitment discounts; actual savings depend on SKU, region and term. Eligible spend = on-demand compute & managed databases not already reservation-covered (run-rate).",
        },
        "data_source": "dashboard_cache",
        "generated_at": _now_iso(),
    }
