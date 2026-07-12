"""
FinOps Report Service — produces consultant-grade, board-ready FinOps reports for a
selected set of Azure subscriptions, mirroring the BIA / BCDR report architecture.

Design principle (hard requirement): EVERY monetary figure in the report is sourced
directly from Azure Cost Management via the warehouse (finops_daily_dimension_costs)
and the grounded metrics/insights services. The AI pass writes ONLY narrative prose
(executive summary, section commentary, recommendations, conclusion) and is explicitly
constrained to cite the numbers it is given — it never invents or recomputes a figure.

Report types (aligned to the FinOps Framework domains):
  • executive     — Executive Cost Summary (estate + per-subscription, CEO/CIO/CFO)
  • optimization  — Cost Optimization & Savings (waste, rightsize, RI, modernization)
  • allocation    — Cost Allocation / Showback & Chargeback (by sub/RG/tag/env, untagged)
  • commitments   — Commitment & Reservation Coverage (RI/SP coverage, utilization)
  • budgets       — Budget & Forecast (budget vs actual, burn rate, forecast)
  • anomalies     — Anomaly & Cost-Spike (spikes, drivers, affected areas)

The deterministic layer builds every numeric block; the AI layer narrates on top.
The output JSON maps 1:1 to the PDF (utils/finopsExecReportPro.jsx) + the Excel export.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

MAX_TOKENS_REPORT = 9000

REPORT_TYPES: Dict[str, Dict[str, Any]] = {
    "executive": {
        "label": "Executive Cost Summary",
        "subtitle": "Estate-wide and per-subscription cost intelligence for executive leadership",
        "sections": ["spend_overview", "subscriptions", "movers", "savings", "cost_at_risk", "commitments"],
        "focus": (
            "A holistic executive overview for the C-suite. Give a BALANCED read of the whole estate: total spend and "
            "its trajectory, where it concentrates (service families, subscriptions, regions), the biggest movers, the "
            "headline savings opportunity, cost-at-risk and commitment posture. The headline states the estate spend "
            "and the single most important takeaway."
        ),
    },
    "optimization": {
        "label": "Cost Optimization & Savings",
        "subtitle": "Prioritised savings opportunities across waste, rightsizing, commitments and modernization",
        "sections": ["savings", "cost_at_risk", "spend_overview", "subscriptions"],
        "focus": (
            "A COST OPTIMIZATION & SAVINGS action plan whose sole purpose is to REDUCE spend. LEAD with the total "
            "identified savings (monthly and annualised) and decompose it by lever: waste, idle/orphaned resources, "
            "rightsizing, reservations/savings plans and modernization. RANK the largest dollar opportunities and NAME "
            "the specific resources, resource groups and subscriptions behind them (use the resource-level tables). "
            "Quantify effort/ROI and sequence the roadmap by dollar impact. Do NOT write a generic estate-spend summary "
            "— every paragraph must be about capturing savings. The headline states how much can be saved per month and "
            "per year."
        ),
    },
    "allocation": {
        "label": "Cost Allocation, Showback & Chargeback",
        "subtitle": "Where spend lands by subscription, resource group and tag — and what is unallocated",
        "sections": ["allocation", "subscriptions", "spend_overview"],
        "focus": (
            "A COST ALLOCATION / SHOWBACK & CHARGEBACK report about WHERE spend lands and WHO owns it. Focus on "
            "allocation by subscription, management group, resource group and tag; the untagged/unallocated spend that "
            "cannot be charged back; and tagging governance with concrete steps to close the gap. Provide a showback "
            "view per subscription and management group. Do NOT dwell on total-spend trends or savings levers. The "
            "headline states the unallocated (untagged) spend and the allocation coverage."
        ),
    },
    "commitments": {
        "label": "Commitment & Reservation Coverage",
        "subtitle": "Reserved Instance and Savings Plan coverage, utilisation and purchase headroom",
        "sections": ["commitments", "spend_overview", "subscriptions"],
        "focus": (
            "A COMMITMENT & RESERVATION COVERAGE report about Reserved Instances and Savings Plans. Focus on current "
            "coverage %, utilisation, active commitments, commitments expiring soon, and the on-demand baseline spend "
            "that is a candidate for commitment. Recommend specific purchase actions with the expected saving and the "
            "coverage/utilisation trade-off. Do NOT write a generic spend summary. The headline states coverage, "
            "utilisation and the commitment opportunity."
        ),
    },
    "budgets": {
        "label": "Budget & Forecast",
        "subtitle": "Budget performance, burn rate and forward spend projection",
        "sections": ["budgets", "spend_overview", "subscriptions"],
        "focus": (
            "A BUDGET & FORECAST report about budget performance and the forward trajectory. Focus on budgets defined, "
            "breaching/at-risk budgets, utilisation, burn rate, and the forecast (run-rate) versus the prior period. "
            "Call out the subscriptions and service families most likely to drive a breach. The headline states the "
            "forecast run-rate and overall budget health."
        ),
    },
    "anomalies": {
        "label": "Anomaly & Cost-Spike",
        "subtitle": "Detected cost spikes, their drivers and the affected spend",
        "sections": ["anomalies", "movers", "spend_overview"],
        "focus": (
            "An ANOMALY & COST-SPIKE report about unexpected change. Focus on the biggest month-over-month movers (up "
            "AND down), the likely drivers, the service families and subscriptions responsible, and any open anomaly "
            "signals. Explain what changed and why it matters. The headline states the single largest spike (or drop) "
            "and its driver."
        ),
    },
}


def _f(v: Any, default: float = 0.0) -> float:
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return default


def _pct(part: float, whole: float) -> Optional[float]:
    return round(part / whole * 100.0, 1) if whole and whole > 0 else None


# ─────────────────────────────────────────────────────────────────────────────
# Deterministic facts — 100% warehouse (Cost Management) + grounded services.
# ─────────────────────────────────────────────────────────────────────────────
def _gather_facts(
    report_type: str,
    subscription_ids: List[str],
    sub_names: Dict[str, str],
    insights: Dict[str, Any],
    metrics: Dict[str, Any],
    sub_mg: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    from services import cost_analytics_service as ca
    sub_mg = sub_mg or {}

    subs = [s for s in (subscription_ids or []) if s]
    ins_sum = (insights or {}).get("summary", {}) or {}
    m = metrics or {}

    # ── Authoritative estate spend (last 30 days = reliable run-rate window) ──
    total_30d = ca.estate_total(period="last_30d", subscription_ids=subs)
    prior_30d = ca.estate_total(period="last_month", subscription_ids=subs)
    delta_usd = round(total_30d - prior_30d, 2)
    delta_pct = _pct(delta_usd, prior_30d) if prior_30d else None

    # ── Breakdowns (warehouse, with period comparison for movers) ──
    # IMPORTANT: use `service_family` (the canonical, always-complete cost partition) rather
    # than `service_name`. service_name is frequently only partially backfilled — on this
    # tenant it covered just 2% of the estate total, so a service_name breakdown would grossly
    # misrepresent where money goes (e.g. hiding a $10k Storage spend). service_family always
    # reconciles to the authoritative estate total, so every figure the report shows is correct.
    by_service = ca.analyze(subs, "service_family", period="last_30d", compare=True, top=14)
    by_region = ca.analyze(subs, "location", period="last_30d", top=10)
    by_rg = ca.analyze(subs, "resource_group", period="last_30d", top=12)
    by_sub = ca.analyze(subs, "subscription", period="last_30d", compare=True, top=60)

    def _rows(analysis: Dict[str, Any]) -> List[Dict[str, Any]]:
        out = []
        for b in (analysis.get("breakdown") or []):
            out.append({
                "name": b.get("key"),
                "cost": _f(b.get("cost")),
                "prev": _f(b.get("prev_cost")) if b.get("prev_cost") is not None else None,
                "delta_usd": _f(b.get("delta_usd")) if b.get("delta_usd") is not None else None,
                "delta_pct": b.get("delta_pct"),
            })
        return out

    services = _rows(by_service)
    regions = [{"name": b.get("key"), "cost": _f(b.get("cost"))} for b in (by_region.get("breakdown") or [])]
    resource_groups = [{"name": b.get("key"), "cost": _f(b.get("cost"))} for b in (by_rg.get("breakdown") or [])]

    # ── Movers (biggest MoM increases / decreases by service) ──
    movers_src = [s for s in services if s.get("delta_usd") is not None and s.get("name") != "Other"]
    up = sorted([s for s in movers_src if (s["delta_usd"] or 0) > 0], key=lambda x: -(x["delta_usd"] or 0))[:6]
    down = sorted([s for s in movers_src if (s["delta_usd"] or 0) < 0], key=lambda x: (x["delta_usd"] or 0))[:6]

    # ── Per-subscription blocks (each with its own breakdown) ──
    subscriptions: List[Dict[str, Any]] = []
    name_map = dict(sub_names or {})
    for b in (by_sub.get("breakdown") or []):
        sid = str(b.get("key") or "")
        if sid == "Other":
            continue
        sub_total = _f(b.get("cost"))
        if sub_total <= 0:
            continue
        top_svc = ca.analyze([sid], "service_family", period="last_30d", top=6)
        subscriptions.append({
            "id": sid,
            "name": name_map.get(sid) or (sid[:8] + "…" if len(sid) > 8 else sid),
            "management_group": sub_mg.get(sid) or "—",
            "total": sub_total,
            "prev": _f(b.get("prev_cost")) if b.get("prev_cost") is not None else None,
            "delta_usd": _f(b.get("delta_usd")) if b.get("delta_usd") is not None else None,
            "delta_pct": b.get("delta_pct"),
            "share_pct": _pct(sub_total, total_30d),
            "top_services": [{"name": x.get("key"), "cost": _f(x.get("cost"))}
                             for x in (top_svc.get("breakdown") or []) if x.get("key") != "Other"][:6],
        })
    subscriptions.sort(key=lambda s: -s["total"])

    # ── Per-resource risk / savings context (grounded from the insights rows) ──
    #   Adds the "which subscription / resource / RG" detail behind the cost-at-risk and
    #   savings headlines. Note: per-resource cost is rate-limited by Cost Management, so
    #   these attribute only part of the estate total (coverage_pct) — a lower bound.
    ins_rows = (insights or {}).get("rows", []) or []

    def _sname(sid: str) -> str:
        return name_map.get(sid) or (sid[:8] + "…" if sid and len(sid) > 8 else (sid or "—"))

    car_by_sub: Dict[str, Dict[str, float]] = {}
    at_risk_res: List[Dict[str, Any]] = []
    save_res: List[Dict[str, Any]] = []
    for r in ins_rows:
        sid = r.get("subscription_id") or ""
        c = float(r.get("cost_current") or 0)
        d = car_by_sub.setdefault(sid, {"unprotected_usd": 0.0, "non_zone_redundant_usd": 0.0,
                                        "untagged_usd": 0.0, "idle_orphaned_usd": 0.0})
        reasons = []
        if not r.get("has_backup"):
            d["unprotected_usd"] += c; reasons.append("no backup")
        zs = str(r.get("zone_status") or "").lower().replace(" ", "")
        if zs and zs not in ("zoneredundant", "redundantbydefault"):
            d["non_zone_redundant_usd"] += c; reasons.append("not zone-redundant")
        if not r.get("has_tags"):
            d["untagged_usd"] += c; reasons.append("untagged")
        if r.get("is_orphan") or (r.get("days_idle") or 0) >= 30:
            d["idle_orphaned_usd"] += c; reasons.append("idle/orphaned")
        if reasons and c > 0:
            at_risk_res.append({"name": r.get("resource_name"), "type": r.get("service") or r.get("resource_type"),
                                "resource_group": r.get("resource_group"), "subscription": _sname(sid),
                                "cost": round(c, 2), "reason": ", ".join(reasons)})
        msav = float(r.get("modernization_savings") or 0)
        if msav > 0:
            save_res.append({"name": r.get("resource_name"), "type": r.get("service") or r.get("resource_type"),
                             "resource_group": r.get("resource_group"), "subscription": _sname(sid),
                             "monthly": round(msav, 2), "action": r.get("modernization_title") or "Modernize"})
    at_risk_res.sort(key=lambda x: -x["cost"]); at_risk_res = at_risk_res[:12]
    save_res.sort(key=lambda x: -x["monthly"]); save_res = save_res[:12]
    car_by_sub_list = [{"subscription": _sname(sid), "management_group": sub_mg.get(sid) or "—",
                        "unprotected_usd": round(v["unprotected_usd"], 2),
                        "non_zone_redundant_usd": round(v["non_zone_redundant_usd"], 2),
                        "untagged_usd": round(v["untagged_usd"], 2),
                        "idle_orphaned_usd": round(v["idle_orphaned_usd"], 2)}
                       for sid, v in car_by_sub.items()
                       if any(x > 0 for x in v.values())]
    car_by_sub_list.sort(key=lambda x: -(x["unprotected_usd"] + x["untagged_usd"]
                                         + x["non_zone_redundant_usd"] + x["idle_orphaned_usd"]))

    # ── Trend (throttle-immune daily series) ──
    trend = []
    tr = m.get("trend") or {}
    dates, values = tr.get("dates") or [], tr.get("values") or []
    if values:
        trend = [{"date": dates[i] if i < len(dates) else str(i + 1), "cost": _f(values[i])}
                 for i in range(len(values))]
    elif by_service.get("series"):
        trend = [{"date": p.get("date"), "cost": _f(p.get("cost"))} for p in by_service["series"]]

    forecast = m.get("forecast") or {}

    # ── Savings / waste / cost-at-risk (grounded per-resource + savings services) ──
    car = ins_sum.get("cost_at_risk", {}) or {}
    savings_m = m.get("savings", {}) or {}
    facts: Dict[str, Any] = {
        "period_label": "Last 30 days",
        "currency": "USD",
        "total_30d": total_30d,
        "prior_30d": prior_30d,
        "delta_usd": delta_usd,
        "delta_pct": delta_pct,
        "forecast_eom": _f(forecast.get("eom")),
        "forecast_model": forecast.get("model"),
        "trend": trend,
        "by_service": services,
        "by_region": regions,
        "by_resource_group": resource_groups,
        "subscriptions": subscriptions,
        "subscription_count": len(subscriptions),
        "movers_up": up,
        "movers_down": down,
        "coverage_pct": ins_sum.get("coverage_pct"),
        "authoritative_total_usd": ins_sum.get("authoritative_total_usd"),
        "attributed_total_usd": ins_sum.get("attributed_total_usd"),
        "data_through": m.get("dataThroughDate"),
        # cost-at-risk
        "cost_at_risk": {
            "unprotected_usd": _f(car.get("unprotected_usd")),
            "non_zone_redundant_usd": _f(car.get("non_zone_redundant_usd")),
            "untagged_usd": _f(car.get("untagged_usd")),
            "idle_orphaned_usd": _f(car.get("idle_orphaned_usd")),
            "by_subscription": car_by_sub_list,
            "top_resources": at_risk_res,
            "resources_evaluated": len(ins_rows),
        },
        # savings
        "savings": {
            "monthly_run_rate": _f(savings_m.get("monthlyRunRate")),
            "annualized_potential": _f(savings_m.get("identifiedAnnualizedPotential")),
            "advisor_monthly": _f(savings_m.get("advisorMonthly")),
            "rightsize_monthly": _f(savings_m.get("rightsizeMonthly")),
            "orphaned_monthly": _f(savings_m.get("orphanedMonthly")),
            "orphaned_count": savings_m.get("orphanedCount", 0),
            "modernization_monthly": _f(ins_sum.get("total_modernization_savings")),
            "waste_usd": _f(ins_sum.get("total_waste_usd")),
            "top_resources": save_res,
        },
        # commitments
        "commitments": m.get("reservations", {}) or {},
        # budgets
        "budgets": m.get("budgets", {}) or {},
        # anomalies
        "anomalies": m.get("anomalies", {}) or {},
        # allocation / governance
        "allocation": {
            "untagged_usd": _f(car.get("untagged_usd")),
            "resources_total": ins_sum.get("total_resources", 0),
            "by_subscription": [{"name": s["name"], "cost": s["total"], "share_pct": s["share_pct"]}
                                for s in subscriptions],
            "by_resource_group": resource_groups,
            "by_service": [{"name": s["name"], "cost": s["cost"]} for s in services if s.get("name") != "Other"],
        },
    }
    return facts


# ─────────────────────────────────────────────────────────────────────────────
# AI narrative pass (prose only; numbers are supplied).
# ─────────────────────────────────────────────────────────────────────────────
def _fmt_usd(v: Any) -> str:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return "$0"
    if abs(n) >= 1000:
        return "$" + format(round(n), ",")
    return "$" + format(n, ".2f")


def _kpis_for(rt: str, f: Dict[str, Any]) -> List[Dict[str, str]]:
    """Report-type-specific headline KPIs, so each report leads with the metrics that
    matter to ITS purpose (a savings report leads with savings, not estate spend)."""
    car = f.get("cost_at_risk", {}) or {}
    sav = f.get("savings", {}) or {}
    com = f.get("commitments", {}) or {}
    bud = f.get("budgets", {}) or {}
    an = f.get("anomalies", {}) or {}
    dpct = f.get("delta_pct")
    mom = (f"{'+' if (dpct or 0) >= 0 else ''}{dpct}%" if dpct is not None else "—")

    def k(label, value, sub):
        return {"label": label, "value": value, "sub": sub}

    spend = k("Estate Spend (30d)", _fmt_usd(f["total_30d"]),
              (f"{mom} vs prior 30d" if dpct is not None else "last 30 days"))
    forecast = k("Forecast (run-rate)", _fmt_usd(f["forecast_eom"]), "monthly projection")

    if rt == "optimization":
        return [
            k("Identified Savings", _fmt_usd(sav.get("monthly_run_rate")) + "/mo",
              f"{_fmt_usd(sav.get('annualized_potential'))}/yr potential"),
            k("Waste (idle/over)", _fmt_usd(sav.get("waste_usd")), "flagged inefficiency"),
            k("Orphaned Resources", str(sav.get("orphaned_count", 0)), f"{_fmt_usd(sav.get('orphaned_monthly'))}/mo"),
            k("Rightsizing", _fmt_usd(sav.get("rightsize_monthly")) + "/mo", "oversized compute"),
            k("Modernization", _fmt_usd(sav.get("modernization_monthly")) + "/mo", "platform upgrades"),
            k("Cost at Risk", _fmt_usd((car.get("unprotected_usd") or 0) + (car.get("untagged_usd") or 0)),
              "unprotected + unallocated"),
        ]
    if rt == "allocation":
        return [
            spend,
            k("Unallocated Spend", _fmt_usd(car.get("untagged_usd")), "untagged resources"),
            k("Subscriptions", str(f.get("subscription_count", 0)), "in scope"),
            k("Resource Groups", str(len(f.get("by_resource_group") or [])), "cost centres (top)"),
            k("Service Families", str(len(f.get("by_service") or [])), "spend categories"),
            k("Cost at Risk", _fmt_usd((car.get("unprotected_usd") or 0) + (car.get("untagged_usd") or 0)),
              "unprotected + unallocated"),
        ]
    if rt == "commitments":
        return [
            k("RI Coverage", f"{com.get('coveragePct', 0)}%", "of eligible spend"),
            k("Utilisation", f"{com.get('utilizationPct', 0)}%", "of purchased"),
            k("Active Commitments", str(com.get("count", 0)), "reservations / plans"),
            k("Commitment Savings", _fmt_usd(com.get("savingsMonthly")) + "/mo", "current"),
            k("Savings Plans", _fmt_usd(com.get("savingsPlansMonthly")) + "/mo", "current"),
            k("Expiring (30d)", str(com.get("expiring30d", 0)), "renewals due"),
        ]
    if rt == "budgets":
        return [
            spend, forecast,
            k("Budgets Defined", str(bud.get("count", 0)), "tracked"),
            k("Breaching / At Risk", str(len(bud.get("breaching") or [])), "need attention"),
            k("Budget Utilisation", f"{bud.get('utilizationPct', 0)}%", "of allocated"),
            k("MoM Change", mom, "vs prior 30d"),
        ]
    if rt == "anomalies":
        up = (f.get("movers_up") or [{}])[0]
        down = (f.get("movers_down") or [{}])[0]
        return [
            spend,
            k("MoM Change", mom, "vs prior 30d"),
            k("Open Anomalies", str(an.get("openCount", 0)), "signals"),
            k("Biggest Increase", _fmt_usd(up.get("delta_usd")), str(up.get("name") or "—")),
            k("Biggest Decrease", _fmt_usd(down.get("delta_usd")), str(down.get("name") or "—")),
            forecast,
        ]
    # executive (default) — balanced overview
    return [
        spend, forecast,
        k("Identified Savings", _fmt_usd(sav.get("monthly_run_rate")),
          f"{_fmt_usd(sav.get('annualized_potential'))}/yr potential"),
        k("Subscriptions", str(f.get("subscription_count", 0)), "with billable spend"),
        k("RI Coverage", f"{com.get('coveragePct', 0)}%", f"utilisation {com.get('utilizationPct', 0)}%"),
        k("Cost at Risk", _fmt_usd((car.get("unprotected_usd") or 0) + (car.get("untagged_usd") or 0)),
          "unprotected + unallocated"),
    ]


def _grounding_block(rt: str, f: Dict[str, Any]) -> str:
    L: List[str] = []
    L.append("AUTHORITATIVE COST FACTS (from Azure Cost Management via the cost warehouse — "
             "use these EXACT figures; never invent, recompute or round differently):")
    L.append(f"  Reporting window: {f['period_label']} (data through {f.get('data_through') or 'latest snapshot'})")
    L.append(f"  Estate spend (last 30 days): {_fmt_usd(f['total_30d'])}")
    L.append(f"  Prior 30 days: {_fmt_usd(f['prior_30d'])}  |  Change: {_fmt_usd(f['delta_usd'])} "
             f"({'+' if (f.get('delta_pct') or 0) >= 0 else ''}{f.get('delta_pct')}% MoM)")
    if f.get("forecast_eom"):
        L.append(f"  Forecast (monthly run-rate): {_fmt_usd(f['forecast_eom'])} [{f.get('forecast_model')}]")
    L.append(f"  Subscriptions in scope with spend: {f['subscription_count']}")
    if f.get("by_service"):
        L.append("  Top service families by spend (service family = the complete, reconciling cost "
                 "partition; sums to the estate total):")
        for s in f["by_service"][:8]:
            d = f"{_fmt_usd(s['delta_usd'])}" if s.get("delta_usd") is not None else "n/a"
            L.append(f"    - {s['name']}: {_fmt_usd(s['cost'])} | Δ {d}")
    if f.get("subscriptions"):
        L.append("  Per-subscription spend (last 30 days) [subscription | management group | spend | share]:")
        for s in f["subscriptions"][:12]:
            L.append(f"    - {s['name']} | MG: {s.get('management_group') or '-'} | "
                     f"{_fmt_usd(s['total'])} | {s.get('share_pct')}% of estate")
        _subs = f["subscriptions"]
        if len(_subs) > 1:
            _rest = round(sum(x["total"] for x in _subs[1:]), 2)
            L.append(f"    (Combined spend of all subscriptions except {_subs[0]['name']}: {_fmt_usd(_rest)})")
    mv_up = f.get("movers_up") or []
    if mv_up:
        L.append("  Largest increases (MoM): " + "; ".join(
            f"{s['name']} +{_fmt_usd(s['delta_usd'])}" for s in mv_up[:5]))
    mv_dn = f.get("movers_down") or []
    if mv_dn:
        L.append("  Largest decreases (MoM): " + "; ".join(
            f"{s['name']} {_fmt_usd(s['delta_usd'])}" for s in mv_dn[:5]))
    sav = f.get("savings", {})
    L.append(f"  Identified savings (monthly run-rate): {_fmt_usd(sav.get('monthly_run_rate'))} "
             f"(annualised {_fmt_usd(sav.get('annualized_potential'))}); "
             f"waste {_fmt_usd(sav.get('waste_usd'))}, "
             f"orphaned {sav.get('orphaned_count', 0)} resources ({_fmt_usd(sav.get('orphaned_monthly'))}/mo), "
             f"modernization {_fmt_usd(sav.get('modernization_monthly'))}/mo.")
    car = f.get("cost_at_risk", {})
    L.append(f"  Cost at risk: unprotected {_fmt_usd(car.get('unprotected_usd'))}, "
             f"not zone-redundant {_fmt_usd(car.get('non_zone_redundant_usd'))}, "
             f"untagged {_fmt_usd(car.get('untagged_usd'))}, "
             f"idle/orphaned {_fmt_usd(car.get('idle_orphaned_usd'))}.")
    com = f.get("commitments", {})
    L.append(f"  Commitments: RI coverage {com.get('coveragePct', 0)}%, utilisation "
             f"{com.get('utilizationPct', 0)}%, {com.get('count', 0)} active, "
             f"savings {_fmt_usd(com.get('savingsMonthly'))}/mo, expiring 30d: {com.get('expiring30d', 0)}.")
    bud = f.get("budgets", {})
    L.append(f"  Budgets: {bud.get('count', 0)} defined, {len(bud.get('breaching', []))} breaching/at-risk, "
             f"utilisation {bud.get('utilizationPct', 0)}%.")
    an = f.get("anomalies", {})
    L.append(f"  Open cost anomalies: {an.get('openCount', 0)}.")
    cov = f.get("coverage_pct")
    if cov is not None:
        L.append(f"  NOTE: cost-at-risk and savings figures come from per-resource attribution, which "
                 f"currently covers ~{cov}% of the authoritative estate total (Cost Management rate limits "
                 f"per-resource cost) — present them as a LOWER BOUND. Spend, subscription and service-family "
                 f"totals above are 100% complete and authoritative.")
    car_subs = (f.get("cost_at_risk") or {}).get("by_subscription") or []
    if car_subs:
        L.append("  Cost-at-risk by subscription [subscription | MG | unprotected | untagged]:")
        for c in car_subs[:8]:
            L.append(f"    - {c['subscription']} | {c.get('management_group') or '-'} | "
                     f"unprotected {_fmt_usd(c['unprotected_usd'])} | untagged {_fmt_usd(c['untagged_usd'])}")
    return "\n".join(L)


def _system_prompt(rt: str) -> str:
    meta = REPORT_TYPES.get(rt, REPORT_TYPES["executive"])
    return (
        "You are a principal Microsoft Azure FinOps consultant authoring a board-ready "
        f"'{meta['label']}' for executive leadership (CEO, CIO, CFO, IT Director). Your writing is "
        "precise, business-focused and grounded in the FinOps Framework (Inform, Optimize, Operate).\n\n"
        "THIS REPORT'S PURPOSE (write specifically to it — two different report types for the SAME estate "
        f"MUST read very differently, with different emphasis, structure and recommendations):\n{meta['focus']}\n\n"
        "ABSOLUTE MONEY DISCIPLINE — non-negotiable:\n"
        "  • Every currency figure and percentage you reference MUST come verbatim from the "
        "AUTHORITATIVE COST FACTS block. Do NOT invent, estimate, extrapolate, annualize or alter any number.\n"
        "  • If a figure is not in the facts, do not state one — describe it qualitatively instead.\n"
        "  • Never contradict the supplied totals, deltas or per-subscription figures.\n\n"
        "Write for a senior audience: clear, confident, no hype, no filler. Reference subscriptions by "
        "their friendly names. Tie cost to business outcomes (efficiency, risk, governance, forecast confidence).\n\n"
        "DEPTH: this is a board-level document — be thorough and analytical (comparable to a consultant-grade "
        "Business Impact Analysis). Interpret WHY spend is where it is, WHAT it means for the business, and WHAT to "
        "do next. Every section narrative should be 2-4 substantive sentences (not one line). Populate the scorecard "
        "and a 30/60/90-day roadmap. Provide 5-8 recommendations.\n\n"
        "Return STRICT JSON only (no markdown fences) with this exact shape:\n"
        "{\n"
        '  "executive_summary": {\n'
        '     "headline": "one strong sentence stating the estate spend and the single most important takeaway",\n'
        '     "narrative": "3-5 short paragraphs of executive commentary grounded in the facts",\n'
        '     "key_findings": ["5-8 concise, number-anchored findings"],\n'
        '     "efficiency_score": <integer 0-100, your judgement of cost-efficiency/governance maturity>\n'
        "  },\n"
        '  "section_narratives": {\n'
        '     "spend_overview": "...", "cost_drivers": "why spend concentrates where it does", "subscriptions": "...",\n'
        '     "movers": "...", "savings": "...", "cost_at_risk": "...", "allocation": "...", "governance": "tagging/allocation/commitment governance posture",\n'
        '     "commitments": "...", "budgets": "...", "anomalies": "...", "financial_outlook": "forecast + run-rate trajectory and confidence",\n'
        '     "finops_maturity": "assessment of the estate against the FinOps Framework (Inform/Optimize/Operate)"\n'
        "  },\n"
        '  "scorecard": [\n'
        '     {"dimension": "Cost visibility", "rating": "Strong|Adequate|Weak", "commentary": "..."},\n'
        '     {"dimension": "Allocation & tagging", "rating": "...", "commentary": "..."},\n'
        '     {"dimension": "Commitment coverage", "rating": "...", "commentary": "..."},\n'
        '     {"dimension": "Waste & efficiency", "rating": "...", "commentary": "..."},\n'
        '     {"dimension": "Forecast confidence", "rating": "...", "commentary": "..."},\n'
        '     {"dimension": "Resilience of spend", "rating": "...", "commentary": "..."}\n'
        "  ],\n"
        '  "roadmap": [\n'
        '     {"horizon": "0-30 days", "actions": ["..."]},\n'
        '     {"horizon": "30-60 days", "actions": ["..."]},\n'
        '     {"horizon": "60-90 days", "actions": ["..."]}\n'
        "  ],\n"
        '  "recommendations": [\n'
        '     {"title": "...", "detail": "action-oriented, 1-2 sentences", "impact": "$ figure FROM THE FACTS or qualitative",\n'
        '      "priority": "High|Medium|Low", "effort": "Low|Medium|High"}\n'
        "  ],\n"
        '  "conclusion": {"summary": "2-3 sentences", "next_steps": ["3-5 concrete next steps"]}\n'
        "}\n"
        "Populate every section_narratives key that is relevant to the facts (leave truly N/A ones as empty string). "
        f"Emphasise these sections for this report: {', '.join(meta['sections'])}."
    )


def _user_prompt(rt: str, f: Dict[str, Any], customer: str) -> str:
    meta = REPORT_TYPES.get(rt, REPORT_TYPES["executive"])
    return (
        f"Customer: {customer}\n"
        f"Report type: {meta['label']} — {meta['subtitle']}\n"
        f"Report brief: {meta['focus']}\n\n"
        f"{_grounding_block(rt, f)}\n\n"
        "Author the report JSON now, written SPECIFICALLY for this report type's purpose (not a generic summary). "
        "Anchor every claim to the figures above. Recommendations must be specific to THIS estate's numbers "
        "(name the services/subscriptions/resources and the levers with the largest $ impact)."
    )


def _fallback_ai(rt: str, f: Dict[str, Any]) -> Dict[str, Any]:
    """Deterministic narrative when no AI provider is configured / the call fails."""
    top = (f.get("by_service") or [{}])[0]
    findings = [
        f"Estate spend over the last 30 days is {_fmt_usd(f['total_30d'])}"
        + (f", {'up' if (f.get('delta_pct') or 0) >= 0 else 'down'} {abs(f.get('delta_pct') or 0)}% versus the prior period."
           if f.get("delta_pct") is not None else "."),
        f"Spend is concentrated in {top.get('name', 'top services')} ({_fmt_usd(top.get('cost'))}).",
        f"{f['subscription_count']} subscription(s) carry billable spend.",
        f"Identified savings run-rate is {_fmt_usd(f['savings']['monthly_run_rate'])}/month "
        f"({_fmt_usd(f['savings']['annualized_potential'])} annualised).",
    ]
    return {
        "executive_summary": {
            "headline": f"Azure estate spend is {_fmt_usd(f['total_30d'])} over the last 30 days.",
            "narrative": "This report summarises Azure cost across the subscriptions in scope, using "
                         "figures sourced directly from Azure Cost Management. Configure an AI provider in "
                         "Settings for a full narrative analysis.",
            "key_findings": findings,
            "efficiency_score": None,
        },
        "section_narratives": {},
        "recommendations": [],
        "conclusion": {"summary": "", "next_steps": []},
    }


# ─────────────────────────────────────────────────────────────────────────────
# Public entry point.
# ─────────────────────────────────────────────────────────────────────────────
def generate_finops_report(
    report_type: str = "executive",
    subscription_ids: Optional[List[str]] = None,
    sub_names: Optional[Dict[str, str]] = None,
    insights: Optional[Dict[str, Any]] = None,
    metrics: Optional[Dict[str, Any]] = None,
    customer: str = "",
    use_ai: bool = True,
    sub_mg: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Build a full, grounded FinOps report of the requested type."""
    rt = report_type if report_type in REPORT_TYPES else "executive"
    meta = REPORT_TYPES[rt]
    customer = (customer or "").strip() or "Azure Cost Management"

    facts = _gather_facts(rt, subscription_ids or [], sub_names or {}, insights or {}, metrics or {}, sub_mg or {})

    # AI narrative (prose only).
    ai: Dict[str, Any] = {}
    model = None
    if use_ai:
        try:
            from services.ai_infra_service import _get_ai_client_for_analysis, _call_ai
            from services.ai_module_analysis_service import _safe_json_parse
            client, model, _provider = _get_ai_client_for_analysis()
            if client:
                raw = _call_ai(_system_prompt(rt), _user_prompt(rt, facts, customer), max_tokens=MAX_TOKENS_REPORT)
                ai = _safe_json_parse(raw) or {}
        except Exception as exc:
            logger.warning("FinOps report AI narrative failed (%s) — using deterministic fallback", exc)
            ai = {}
    if not ai:
        ai = _fallback_ai(rt, facts)

    es = ai.get("executive_summary") or {}
    score = es.get("efficiency_score")
    if isinstance(score, (int, float)):
        score = max(0, min(100, int(round(score))))
    else:
        score = None

    now = datetime.now(timezone.utc)
    cover = {
        "customer_name": customer,
        "title": meta["label"],
        "subtitle": meta["subtitle"],
        "period_label": facts["period_label"],
        "prepared_by": "Azure Infra IQ",
        "report_version": "1.0",
        "date": now.strftime("%d %B %Y"),
    }

    # Headline KPIs — report-type-specific (all deterministic).
    kpis = _kpis_for(rt, facts)

    report = {
        "report_type": rt,
        "report_type_label": meta["label"],
        "cover": cover,
        "sections": meta["sections"],
        "kpis": kpis,
        "efficiency_score": score,
        "executive_summary": {
            "headline": es.get("headline", ""),
            "narrative": es.get("narrative", ""),
            "key_findings": es.get("key_findings", []) or [],
        },
        "section_narratives": ai.get("section_narratives", {}) or {},
        "scorecard": ai.get("scorecard", []) or [],
        "roadmap": ai.get("roadmap", []) or [],
        "spend_overview": {
            "total_30d": facts["total_30d"],
            "prior_30d": facts["prior_30d"],
            "delta_usd": facts["delta_usd"],
            "delta_pct": facts["delta_pct"],
            "forecast_eom": facts["forecast_eom"],
            "forecast_model": facts["forecast_model"],
            "trend": facts["trend"],
            "by_service": facts["by_service"],
            "by_region": facts["by_region"],
            "by_resource_group": facts["by_resource_group"],
        },
        "subscriptions": facts["subscriptions"],
        "movers": {"up": facts["movers_up"], "down": facts["movers_down"]},
        "savings": facts["savings"],
        "cost_at_risk": facts["cost_at_risk"],
        "allocation": facts["allocation"],
        "commitments": facts["commitments"],
        "budgets": facts["budgets"],
        "anomalies": facts["anomalies"],
        "recommendations": ai.get("recommendations", []) or [],
        "conclusion": ai.get("conclusion", {}) or {},
        "grounding": {
            "coverage_pct": facts["coverage_pct"],
            "authoritative_total_usd": facts["authoritative_total_usd"],
            "attributed_total_usd": facts["attributed_total_usd"],
            "data_through": facts["data_through"],
            "subscriptions_count": facts["subscription_count"],
            "data_source": "Azure Cost Management (warehouse) + grounded resource metrics",
        },
        "model": model,
        "generated_at": now.isoformat(),
    }
    return report
