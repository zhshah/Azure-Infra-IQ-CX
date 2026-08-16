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

    # ── Management cost & usage review categories ────────────────────────────
    # Sourced from the management-dashboard services (meter grain, utilisation
    # snapshots, savings ledger) rather than the service-family grain alone.
    "management": {
        "label": "Management Cost & Usage Review",
        "subtitle": "Board-level review across categories, compute, storage, network, security and savings",
        "sections": ["spend_overview", "service_categories", "compute", "storage",
                     "network", "security_monitoring", "environments", "savings_roi"],
        "mgmt": True,
        "focus": (
            "A MANAGEMENT COST & USAGE REVIEW for the executive board. Cover the whole estate in one pass: total spend "
            "and trend, the share of spend by service category, compute cost versus utilisation, storage cost by access "
            "tier and its growth, network and data-egress cost, security and monitoring cost, the Production versus "
            "Non-Production split, and the savings position including what has actually been realized. The headline "
            "states total spend, the single largest category and the biggest efficiency opportunity."
        ),
    },
    "subscriptions_mg": {
        "label": "Subscription & Management Group",
        "subtitle": "Cost by management group and subscription, growth rates and governance gaps",
        "sections": ["subscriptions", "management_groups", "governance", "spend_overview"],
        "mgmt": True,
        "focus": (
            "A SUBSCRIPTION & MANAGEMENT GROUP report about how spend distributes across the tenant hierarchy. Focus on "
            "cost per management group (including descendant rollup), cost per subscription, the growth percentage of "
            "each subscription, and governance gaps — subscriptions with no management-group assignment, zero-spend "
            "subscriptions and disabled subscriptions still incurring charges. The headline states the largest "
            "management group by rollup cost and the number of governance exceptions."
        ),
    },
    "resource_groups": {
        "label": "Resource Group Cost",
        "subtitle": "Cost, growth and density per resource group, split by environment",
        "sections": ["resource_groups", "environments", "spend_overview"],
        "mgmt": True,
        "focus": (
            "A RESOURCE GROUP COST report. Focus on the costliest resource groups, their growth rate, how many "
            "resources each contains versus what it costs (cost-per-resource density), the idle spend inside each, and "
            "the Production versus Non-Production split. Call out groups where a large cost sits on very few resources "
            "and groups where non-production spend is disproportionate. The headline states the top resource group and "
            "the non-production share."
        ),
    },
    "service_categories": {
        "label": "Azure Service Category",
        "subtitle": "Percentage of spend by service category across the estate",
        "sections": ["service_categories", "spend_overview", "subscriptions"],
        "mgmt": True,
        "focus": (
            "An AZURE SERVICE CATEGORY report about what proportion of spend goes to each class of service: Virtual "
            "Machines, Azure SQL / Cosmos DB, Storage Accounts, Firewall / Load Balancer, Log Analytics / Sentinel and "
            "the remainder. Give the percentage share of every category and comment on whether the mix is what a "
            "well-run estate should look like. The headline states the dominant category and its share."
        ),
    },
    "compute": {
        "label": "Virtual Machines — Cost & Utilization",
        "subtitle": "VM spend, power state, CPU and memory utilisation and underutilised capacity",
        "sections": ["compute", "savings_roi", "spend_overview"],
        "mgmt": True,
        "focus": (
            "A VIRTUAL MACHINE COST & UTILIZATION report. Focus on total VM spend, how many VMs are running versus "
            "stopped and what each group costs, the cost of idle VMs, average CPU and memory utilisation, the "
            "percentage of VMs that are underutilised and the specific VMs where high cost meets low utilisation. "
            "Recommend rightsizing or decommissioning by name with the dollar impact. The headline states the VM spend "
            "and the share of it that is underutilised."
        ),
    },
    "storage": {
        "label": "Storage Cost & Growth",
        "subtitle": "Storage spend by access tier, capacity growth and orphaned disks and snapshots",
        "sections": ["storage", "savings_roi", "spend_overview"],
        "mgmt": True,
        "focus": (
            "A STORAGE COST & GROWTH report. Focus on total storage spend, how it splits across Hot, Cool, Cold and "
            "Archive access tiers, the measured capacity growth rate in GB per month, and the cost of orphaned disks "
            "and snapshots. Recommend lifecycle-management and tiering actions where hot-tier data is not being read, "
            "and cleanup where unattached disks or snapshots persist. The headline states storage spend, the growth "
            "rate and the reclaimable amount."
        ),
    },
    "network": {
        "label": "Network & Data Egress Cost",
        "subtitle": "Network spend, data egress, inter-region transfer and the costliest network resources",
        "sections": ["network", "spend_overview"],
        "mgmt": True,
        "focus": (
            "A NETWORK & DATA EGRESS COST report. Focus on total network spend, the portion that is data egress "
            "(including the gigabytes transferred), inter-region traffic cost, and the individual VNets, gateways, "
            "firewalls and load balancers that cost the most. Comment on whether egress volume suggests chatty "
            "cross-region architecture or unnecessary internet-bound traffic. The headline states network spend and the "
            "egress share of it."
        ),
    },
    "paas": {
        "label": "Platform Services (PaaS) Cost",
        "subtitle": "Managed-service spend by service and by environment",
        "sections": ["service_categories", "environments", "spend_overview", "subscriptions"],
        "mgmt": True,
        "focus": (
            "A PLATFORM SERVICES (PaaS) COST report about managed services — databases, app services, functions, "
            "integration, containers and AI services. Focus on cost per PaaS service and the split of that spend "
            "between Production and Non-Production. Call out non-production platform spend that could be scaled down or "
            "scheduled off. The headline states total PaaS spend and the non-production share."
        ),
    },
    "security_monitoring": {
        "label": "Security & Monitoring Cost",
        "subtitle": "Defender and Sentinel spend, log ingestion volume and cost per GB",
        "sections": ["security_monitoring", "spend_overview"],
        "mgmt": True,
        "focus": (
            "A SECURITY & MONITORING COST report. Focus on total security spend broken down by service (Defender plans, "
            "Sentinel, Key Vault), the volume of data ingested into Log Analytics and Sentinel, the derived cost per "
            "gigabyte ingested, and retention cost. Comment on whether ingestion volume justifies its cost and where "
            "table-level retention or basic-tier ingestion would reduce it. The headline states security spend and the "
            "cost per GB ingested."
        ),
    },
    "savings_roi": {
        "label": "Savings, Realization & ROI",
        "subtitle": "Identified versus realized savings, capture rate and return on optimisation effort",
        "sections": ["savings_roi", "savings", "spend_overview"],
        "mgmt": True,
        "focus": (
            "A SAVINGS REALIZATION & ROI report about whether optimisation is actually delivering. Focus on savings "
            "identified, how much has been accepted, how much has been implemented, and how much has been MEASURED as "
            "realized by comparing each action's baseline cost against the resource's cost afterwards. Report the "
            "capture rate (realized divided by identified) and the return on the engineering effort spent. Where the "
            "capture rate is low, explain what is stalling in the pipeline. The headline states realized savings and "
            "ROI percentage."
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


def _gather_mgmt_facts(subscription_ids: List[str], days: int = 30) -> Dict[str, Any]:
    """Facts for the management review categories.

    Sourced from the management-dashboard services (meter grain, utilisation
    snapshots, savings ledger). Every block degrades to an `available: False`
    payload rather than raising, so a report still renders when a collector has
    not run yet."""
    subs = [s for s in (subscription_ids or []) if s] or None
    out: Dict[str, Any] = {}

    def _safe(name: str, fn, default):
        try:
            return fn()
        except Exception as exc:
            logger.warning("FinOps report: %s facts unavailable: %s", name, exc)
            return default

    try:
        from services import finops_dashboard_service as fd
        from services import finops_meter_service as fm
        from services import finops_savings_service as fs
    except Exception as exc:
        logger.warning("FinOps report: management services unavailable: %s", exc)
        return {"service_categories": {"available": False}, "compute": {"available": False},
                "storage": {"available": False}, "network": {"available": False},
                "security_monitoring": {"available": False}, "environments": {"available": False},
                "resource_groups": {"available": False}, "management_groups": {"available": False},
                "savings_roi": {"available": False}, "governance": {"available": False}}

    out["service_categories"] = _safe(
        "service categories", lambda: fd.get_service_category_costs(days, subs), {"available": False})
    out["compute"] = _safe(
        "compute", lambda: fd.get_vm_cost_utilization(subs), {"available": False})
    out["environments"] = _safe(
        "environments", lambda: fd.get_environment_costs(subs), {"available": False})
    out["resource_groups"] = _safe(
        "resource groups", lambda: fd.get_resource_group_economics(subs, 25), {"available": False})
    out["management_groups"] = _safe(
        "management groups", lambda: fd.get_mgmt_group_costs(), {"available": False})
    out["network"] = _safe(
        "network", lambda: fm.get_network_costs(days, subs), {"available": False})
    out["savings_roi"] = _safe(
        "savings roi", lambda: fs.get_savings_rollup(), {"available": False})

    tiers = _safe("storage tiers", lambda: fm.get_storage_tier_costs(days, subs), {"available": False})
    growth = _safe("storage growth", lambda: fd.get_storage_growth(60, subs), {"available": False})
    out["storage"] = {
        "available": bool(tiers.get("available") or growth.get("available")),
        "tiers": tiers.get("tiers", []),
        "total_usd": tiers.get("total_usd", 0.0),
        "growth_gb_per_month": growth.get("growth_gb_per_month", 0.0),
        "current_gb": growth.get("current_gb", 0.0),
        "growth_pct": growth.get("growth_pct", 0.0),
        "series": growth.get("series", []),
    }

    security = _safe("security", lambda: fm.get_security_costs(days, subs), {"available": False})
    ingestion = _safe("ingestion", lambda: fm.get_ingestion_costs(days, subs), {"available": False})
    out["security_monitoring"] = {
        "available": bool(security.get("available") or ingestion.get("available")),
        "total_security_usd": security.get("total_usd", 0.0),
        "by_service": security.get("by_service", []),
        "ingestion_cost_usd": ingestion.get("ingestion_cost_usd", 0.0),
        "ingested_gb": ingestion.get("ingested_gb", 0.0),
        "cost_per_gb_usd": ingestion.get("cost_per_gb_usd", 0.0),
        "retention_cost_usd": ingestion.get("retention_cost_usd", 0.0),
    }

    # Orphaned disks and snapshots come from the scan cache, not the warehouse.
    orphans = {"available": False, "disks_usd": 0.0, "snapshots_usd": 0.0, "total_usd": 0.0, "items": []}
    try:
        from services import persistence_service as _ps
        snap = _ps.load_latest_dashboard() or {}
        for r in (snap.get("resources") or []):
            rt = str(r.get("resource_type", "") or "").lower()
            is_snap = "snapshots" in rt
            if not (r.get("is_orphan") or is_snap):
                continue
            cost = _f(r.get("cost_current_month"))
            if is_snap:
                orphans["snapshots_usd"] += cost
            elif "disks" in rt:
                orphans["disks_usd"] += cost
            else:
                continue
            orphans["items"].append({"name": r.get("resource_name"), "type": rt,
                                     "resource_group": r.get("resource_group"), "cost": cost})
        orphans["disks_usd"] = round(orphans["disks_usd"], 2)
        orphans["snapshots_usd"] = round(orphans["snapshots_usd"], 2)
        orphans["total_usd"] = round(orphans["disks_usd"] + orphans["snapshots_usd"], 2)
        orphans["items"].sort(key=lambda x: -x["cost"])
        orphans["items"] = orphans["items"][:25]
        orphans["available"] = bool(orphans["items"])
    except Exception as exc:
        logger.warning("FinOps report: orphan storage facts unavailable: %s", exc)
    out["storage"]["orphans"] = orphans

    return out


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

    # Management review categories pull from the meter grain, utilisation snapshots
    # and savings ledger. Only gathered when the report type needs them so the
    # existing report types keep their current cost of generation.
    if (REPORT_TYPES.get(report_type) or {}).get("mgmt"):
        facts.update(_gather_mgmt_facts(subs))
        facts["governance"] = _gather_governance_facts(subscriptions)

    return facts


def _gather_governance_facts(subscriptions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Subscription governance exceptions for the subscription/MG report.

    Assignment is read from the persisted MG rollup. If the hierarchy was never
    collected we report unavailable rather than guessing — claiming "0 unassigned"
    from missing data would be a fabricated finding."""
    try:
        from services import finops_dashboard_service as fd

        sub_costs: Dict[str, float] = {}
        for s in subscriptions:
            sid = s.get("id") or s.get("subscription_id") or ""
            if sid:
                sub_costs[sid] = _f(s.get("total"))

        assigned: List[str] = []
        hierarchy_known = False
        try:
            with fd._conn() as con:
                row = con.execute("SELECT MAX(billing_month) FROM finops_mgmt_group_costs").fetchone()
                hierarchy_known = bool(row and row[0])
        except Exception:
            hierarchy_known = False

        if not hierarchy_known:
            return {"available": False,
                    "reason": "management-group hierarchy not collected — assignment cannot be determined"}

        # The rollup stores counts, not ids; re-read the live hierarchy for ids.
        try:
            from services.azure_auth import get_credential
            import json as _json, urllib.request as _rq
            token = get_credential().get_token("https://management.azure.com/.default").token

            def _get(path):
                req = _rq.Request("https://management.azure.com" + path,
                                  headers={"Authorization": f"Bearer {token}"})
                with _rq.urlopen(req, timeout=30) as r:
                    return _json.loads(r.read().decode())

            listing = _get("/providers/Microsoft.Management/managementGroups?api-version=2020-05-01")
            vals = listing.get("value") or []
            if vals:
                tree = _get(f"/providers/Microsoft.Management/managementGroups/{vals[0]['name']}"
                            "?api-version=2020-05-01&$expand=children&$recurse=true")

                def walk(node):
                    props = node.get("properties") or node
                    for ch in (props.get("children") or []):
                        ctype = (ch.get("type") or "").lower()
                        if "subscription" in ctype and ch.get("name"):
                            assigned.append(ch["name"])
                        elif "managementgroup" in ctype:
                            walk(ch)
                walk(tree)
        except Exception as exc:
            logger.warning("FinOps report: MG assignment lookup failed: %s", exc)
            return {"available": False,
                    "reason": "management-group hierarchy unreadable — assignment cannot be determined"}

        subs_in = [{"subscription_id": (s.get("id") or s.get("subscription_id") or ""),
                    "display_name": s.get("name") or "",
                    "state": s.get("state") or "Enabled"} for s in subscriptions]
        return fd.find_orphan_subscriptions(subs_in, assigned, sub_costs)
    except Exception as exc:
        logger.warning("FinOps report: governance facts unavailable: %s", exc)
        return {"available": False, "reason": str(exc)}


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

    # ── Management review categories ─────────────────────────────────────────
    cat = f.get("service_categories", {}) or {}
    vm = f.get("compute", {}) or {}
    sto = f.get("storage", {}) or {}
    net = f.get("network", {}) or {}
    secm = f.get("security_monitoring", {}) or {}
    envs = f.get("environments", {}) or {}
    rgs = f.get("resource_groups", {}) or {}
    mgs = f.get("management_groups", {}) or {}
    gov = f.get("governance", {}) or {}
    roi = f.get("savings_roi", {}) or {}

    def _env_cost(name: str) -> float:
        for e in (envs.get("environments") or []):
            if e.get("environment") == name:
                return _f(e.get("cost_usd"))
        return 0.0

    def _top_cat() -> Dict[str, Any]:
        cats = cat.get("categories") or []
        return cats[0] if cats else {}

    if rt == "management":
        tc = _top_cat()
        return [
            spend, forecast,
            k("Top Category", str(tc.get("category") or "—"),
              f"{tc.get('cost_pct', 0)}% of spend" if tc else "—"),
            k("VM Spend", _fmt_usd(vm.get("total_vm_cost_usd")),
              f"{vm.get('underutilized_pct', 0)}% underutilised"),
            k("Storage Growth", f"{sto.get('growth_gb_per_month', 0)} GB/mo",
              _fmt_usd(sto.get("total_usd")) + " storage spend"),
            k("Realized Savings", _fmt_usd(roi.get("realized_monthly_usd")) + "/mo",
              (f"ROI {roi.get('roi_pct')}%" if roi.get("roi_available") else "not yet measured")),
        ]
    if rt == "subscriptions_mg":
        mg_list = mgs.get("management_groups") or []
        top_mg = mg_list[0] if mg_list else {}
        return [
            spend,
            k("Management Groups", str(len(mg_list)), "in hierarchy"),
            k("Top Group", str(top_mg.get("mg_name") or "—"),
              _fmt_usd(top_mg.get("rollup_cost_usd")) + " rollup" if top_mg else "—"),
            k("Subscriptions", str(f.get("subscription_count", 0)), "with billable spend"),
            k("Unassigned Subs", str(gov.get("unassigned_count", 0)), "outside any group"),
            k("Zero-Spend Subs", str(gov.get("zero_spend_count", 0)), "cleanup candidates"),
        ]
    if rt == "resource_groups":
        prod, nonprod = _env_cost("Production"), _env_cost("Non-Production")
        rg_list = rgs.get("resource_groups") or []
        top_rg = rg_list[0] if rg_list else {}
        return [
            spend,
            k("Resource Groups", str(rgs.get("rg_count", 0)), "with spend"),
            k("Top Group", str(top_rg.get("resource_group") or "—"),
              _fmt_usd(top_rg.get("cost_usd")) if top_rg else "—"),
            k("Production", _fmt_usd(prod), "classified prod spend"),
            k("Non-Production", _fmt_usd(nonprod),
              (f"{round(nonprod / (prod + nonprod) * 100)}% of classified" if (prod + nonprod) else "—")),
            k("Idle in Groups", _fmt_usd(sum(_f(r.get("idle_cost_usd")) for r in rg_list)), "reclaimable"),
        ]
    if rt == "service_categories":
        cats = cat.get("categories") or []
        out = [spend, k("Categories", str(len(cats)), "with spend")]
        for c in cats[:4]:
            out.append(k(str(c.get("category")), _fmt_usd(c.get("cost_usd")), f"{c.get('cost_pct')}% of spend"))
        while len(out) < 6:
            out.append(forecast if len(out) == 2 else k("—", "—", "no further categories"))
        return out[:6]
    if rt == "compute":
        return [
            k("Total VM Spend", _fmt_usd(vm.get("total_vm_cost_usd")), f"{vm.get('vm_count', 0)} VMs"),
            k("Running / Stopped", f"{vm.get('running_count', 0)} / {vm.get('stopped_count', 0)}",
              _fmt_usd(vm.get("stopped_cost_usd")) + " on stopped"),
            k("Idle VM Cost", _fmt_usd(vm.get("idle_cost_usd")), "deallocated or inactive"),
            k("Avg CPU", (f"{vm.get('avg_cpu_pct')}%" if vm.get("avg_cpu_pct") is not None else "—"), "30-day average"),
            k("Avg Memory", (f"{vm.get('avg_memory_pct')}%" if vm.get("avg_memory_pct") is not None else "—"),
              f"{vm.get('memory_coverage_pct', 0)}% of VMs reporting"),
            k("% Underutilised", f"{vm.get('underutilized_pct', 0)}%",
              _fmt_usd(vm.get("underutilized_cost_usd")) + " at stake"),
        ]
    if rt == "storage":
        orph = (sto.get("orphans") or {})
        tiers = sto.get("tiers") or []
        top_tier = tiers[0] if tiers else {}
        return [
            k("Storage Spend", _fmt_usd(sto.get("total_usd")), "metered storage"),
            k("Largest Tier", str(top_tier.get("tier") or "—"),
              (f"{top_tier.get('cost_pct')}% of storage" if top_tier else "—")),
            k("Capacity", f"{sto.get('current_gb', 0)} GB", "current used"),
            k("Growth", f"{sto.get('growth_gb_per_month', 0)} GB/mo", f"{sto.get('growth_pct', 0)}% over window"),
            k("Orphaned Disks", _fmt_usd(orph.get("disks_usd")), "unattached"),
            k("Orphaned Snapshots", _fmt_usd(orph.get("snapshots_usd")), "reclaimable"),
        ]
    if rt == "network":
        tops = net.get("top_meters") or []
        return [
            k("Network Spend", _fmt_usd(net.get("total_usd")), "metered network"),
            k("Data Egress", _fmt_usd(net.get("egress_usd")), f"{net.get('egress_gb', 0)} GB out"),
            k("Inter-Region", _fmt_usd(net.get("inter_region_usd")), f"{net.get('inter_region_gb', 0)} GB"),
            k("Egress Share", (f"{round(_f(net.get('egress_usd')) / _f(net.get('total_usd')) * 100)}%"
                               if _f(net.get("total_usd")) else "—"), "of network spend"),
            k("Other Network", _fmt_usd(net.get("other_network_usd")), "gateways, LB, firewall"),
            k("Top Meter", str((tops[0] or {}).get("meter_name") or "—") if tops else "—",
              _fmt_usd((tops[0] or {}).get("cost_usd")) if tops else "—"),
        ]
    if rt == "security_monitoring":
        svcs = secm.get("by_service") or []
        top_svc = svcs[0] if svcs else {}
        return [
            k("Security Spend", _fmt_usd(secm.get("total_security_usd")), "Defender, Sentinel, Key Vault"),
            k("Top Security Service", str(top_svc.get("service") or "—"),
              _fmt_usd(top_svc.get("cost_usd")) if top_svc else "—"),
            k("Ingestion Cost", _fmt_usd(secm.get("ingestion_cost_usd")), "Log Analytics / Sentinel"),
            k("GB Ingested", f"{secm.get('ingested_gb', 0)} GB", "over the window"),
            k("Cost per GB", (f"${secm.get('cost_per_gb_usd')}" if secm.get("cost_per_gb_usd") else "—"),
              "derived from metered usage"),
            k("Retention Cost", _fmt_usd(secm.get("retention_cost_usd")), "beyond included period"),
        ]
    if rt == "paas":
        prod, nonprod = _env_cost("Production"), _env_cost("Non-Production")
        cats = cat.get("categories") or []
        paas_names = ("Azure SQL / Cosmos DB", "App / Web Services", "Containers / Kubernetes",
                      "AI / Machine Learning")
        paas_total = sum(_f(c.get("cost_usd")) for c in cats if c.get("category") in paas_names)
        return [
            spend,
            k("PaaS Spend", _fmt_usd(paas_total), "managed services"),
            k("PaaS Share", (f"{round(paas_total / f['total_30d'] * 100)}%" if f.get("total_30d") else "—"),
              "of estate spend"),
            k("Production", _fmt_usd(prod), "classified prod"),
            k("Non-Production", _fmt_usd(nonprod),
              (f"{round(nonprod / (prod + nonprod) * 100)}% of classified" if (prod + nonprod) else "—")),
            forecast,
        ]
    if rt == "savings_roi":
        return [
            k("Identified", _fmt_usd(roi.get("identified_monthly_usd")) + "/mo",
              _fmt_usd(roi.get("identified_annualized_usd")) + "/yr"),
            k("Potential (open)", _fmt_usd(roi.get("potential_monthly_usd")), "not yet actioned"),
            k("Accepted", _fmt_usd(roi.get("accepted_monthly_usd")), "approved, pending work"),
            k("Realized", _fmt_usd(roi.get("realized_monthly_usd")) + "/mo",
              _fmt_usd(roi.get("realized_annualized_usd")) + "/yr measured"),
            k("Capture Rate", f"{roi.get('capture_rate_pct', 0)}%", "realized / identified"),
            k("ROI", (f"{roi.get('roi_pct')}%" if roi.get("roi_available") else "Not measured"),
              f"impl. cost {_fmt_usd(roi.get('implementation_cost_usd'))}"),
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

    # ── Management review facts (only present for the mgmt report types) ─────
    cat = f.get("service_categories") or {}
    if cat.get("available"):
        L.append("  Spend by service category: " + "; ".join(
            f"{c['category']} {_fmt_usd(c['cost_usd'])} ({c['cost_pct']}%)"
            for c in (cat.get("categories") or [])[:10]))

    vm = f.get("compute") or {}
    if vm.get("available"):
        L.append(f"  Virtual machines: {vm.get('vm_count', 0)} VMs, total {_fmt_usd(vm.get('total_vm_cost_usd'))}; "
                 f"{vm.get('running_count', 0)} running ({_fmt_usd(vm.get('running_cost_usd'))}), "
                 f"{vm.get('stopped_count', 0)} stopped ({_fmt_usd(vm.get('stopped_cost_usd'))}); "
                 f"idle cost {_fmt_usd(vm.get('idle_cost_usd'))}; "
                 f"avg CPU {vm.get('avg_cpu_pct')}%, avg memory {vm.get('avg_memory_pct')}% "
                 f"(memory reported for {vm.get('memory_coverage_pct', 0)}% of VMs); "
                 f"{vm.get('underutilized_pct', 0)}% of running VMs underutilised "
                 f"({_fmt_usd(vm.get('underutilized_cost_usd'))}).")
        top_vms = sorted((vm.get("vms") or []), key=lambda v: -(v.get("cost_month_usd") or 0))[:8]
        if top_vms:
            L.append("  Costliest VMs [name | size | state | cost | CPU | memory]:")
            for v in top_vms:
                L.append(f"    - {v.get('resource_name')} | {v.get('sku') or '-'} | {v.get('power_state')} | "
                         f"{_fmt_usd(v.get('cost_month_usd'))} | CPU {v.get('avg_cpu_pct')}% | "
                         f"mem {v.get('avg_memory_pct')}%")

    sto = f.get("storage") or {}
    if sto.get("available"):
        tiers = sto.get("tiers") or []
        if tiers:
            L.append("  Storage by access tier: " + "; ".join(
                f"{t['tier']} {_fmt_usd(t['cost_usd'])} ({t.get('cost_pct', 0)}%)" for t in tiers))
        L.append(f"  Storage capacity: {sto.get('current_gb', 0)} GB now, growing "
                 f"{sto.get('growth_gb_per_month', 0)} GB/month ({sto.get('growth_pct', 0)}% over the window).")
        orph = sto.get("orphans") or {}
        if orph.get("available"):
            L.append(f"  Orphaned storage: unattached disks {_fmt_usd(orph.get('disks_usd'))}, "
                     f"snapshots {_fmt_usd(orph.get('snapshots_usd'))}, "
                     f"total reclaimable {_fmt_usd(orph.get('total_usd'))}.")

    net = f.get("network") or {}
    if net.get("available"):
        L.append(f"  Network: total {_fmt_usd(net.get('total_usd'))}; data egress "
                 f"{_fmt_usd(net.get('egress_usd'))} over {net.get('egress_gb', 0)} GB; inter-region "
                 f"{_fmt_usd(net.get('inter_region_usd'))} over {net.get('inter_region_gb', 0)} GB; "
                 f"other network {_fmt_usd(net.get('other_network_usd'))}.")
        tops = net.get("top_meters") or []
        if tops:
            L.append("  Top network meters: " + "; ".join(
                f"{t['meter_name']} {_fmt_usd(t['cost_usd'])}" for t in tops[:6]))

    secm = f.get("security_monitoring") or {}
    if secm.get("available"):
        L.append(f"  Security & monitoring: security spend {_fmt_usd(secm.get('total_security_usd'))}; "
                 f"ingestion {_fmt_usd(secm.get('ingestion_cost_usd'))} for {secm.get('ingested_gb', 0)} GB "
                 f"(${secm.get('cost_per_gb_usd', 0)}/GB); retention {_fmt_usd(secm.get('retention_cost_usd'))}.")
        svcs = secm.get("by_service") or []
        if svcs:
            L.append("  Security spend by service: " + "; ".join(
                f"{s['service']} {_fmt_usd(s['cost_usd'])}" for s in svcs[:6]))

    envs = f.get("environments") or {}
    if envs.get("available"):
        L.append("  Environment split: " + "; ".join(
            f"{e['environment']} {_fmt_usd(e['cost_usd'])} ({e.get('cost_pct', 0)}%, "
            f"{e.get('resource_count', 0)} resources)" for e in (envs.get("environments") or [])))

    rgs = f.get("resource_groups") or {}
    if rgs.get("available"):
        L.append(f"  Resource groups with spend: {rgs.get('rg_count', 0)}. "
                 "Top groups [name | env | resources | cost | cost/resource | idle]:")
        for r in (rgs.get("resource_groups") or [])[:10]:
            L.append(f"    - {r['resource_group']} | {r.get('environment')} | {r.get('resource_count')} | "
                     f"{_fmt_usd(r.get('cost_usd'))} | {_fmt_usd(r.get('cost_per_resource_usd'))} | "
                     f"idle {_fmt_usd(r.get('idle_cost_usd'))}")

    mgs = f.get("management_groups") or {}
    if mgs.get("available"):
        L.append("  Management groups [name | subscriptions | direct | rollup]:")
        for m2 in (mgs.get("management_groups") or [])[:10]:
            L.append(f"    - {m2['mg_name']} | {m2.get('subscription_count')} | "
                     f"{_fmt_usd(m2.get('direct_cost_usd'))} | rollup {_fmt_usd(m2.get('rollup_cost_usd'))}")

    gov = f.get("governance") or {}
    if gov.get("available"):
        unassigned = gov.get("unassigned_count")
        unassigned_txt = (f"{unassigned} unassigned to a management group" if unassigned is not None
                          else "unassigned count UNKNOWN (management-group hierarchy unreadable — "
                               "do NOT state a number for it)")
        L.append(f"  Subscription governance: {unassigned_txt}, "
                 f"{gov.get('zero_spend_count', 0)} zero-spend, "
                 f"{gov.get('disabled_with_cost_count', 0)} disabled but still billing "
                 f"(of {gov.get('total_subscriptions', 0)} total).")
    elif gov:
        L.append(f"  Subscription governance: NOT AVAILABLE ({gov.get('reason', 'not collected')}) — "
                 "do NOT report governance findings.")

    roi = f.get("savings_roi") or {}
    if roi.get("available"):
        L.append(f"  Savings realization: identified {_fmt_usd(roi.get('identified_monthly_usd'))}/mo, "
                 f"open {_fmt_usd(roi.get('potential_monthly_usd'))}, "
                 f"accepted {_fmt_usd(roi.get('accepted_monthly_usd'))}, "
                 f"REALIZED (measured) {_fmt_usd(roi.get('realized_monthly_usd'))}/mo "
                 f"({_fmt_usd(roi.get('realized_annualized_usd'))}/yr); "
                 f"capture rate {roi.get('capture_rate_pct', 0)}%; "
                 f"implementation cost {_fmt_usd(roi.get('implementation_cost_usd'))}; "
                 + (f"ROI {roi.get('roi_pct')}%." if roi.get("roi_available")
                    else "ROI not yet measurable — nothing implemented has been measured."))

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
        "  • Never contradict the supplied totals, deltas or per-subscription figures.\n"
        "  • A section absent from the facts has NOT been collected. Say so plainly (e.g. 'meter-level "
        "data has not been collected yet') and leave that section_narratives key an empty string. "
        "Never infer, model or substitute a value for missing data, and never present an absence as a zero.\n"
        "  • Where the facts explicitly say UNKNOWN or NOT AVAILABLE, repeat that as the finding — do not "
        "resolve it with a guess.\n\n"
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
        '     "service_categories": "what the category mix says about the estate", "compute": "VM cost vs utilisation and rightsizing",\n'
        '     "storage": "tiering, growth trajectory and reclaimable storage", "network": "egress and inter-region traffic economics",\n'
        '     "security_monitoring": "security spend and log-ingestion economics", "environments": "production vs non-production balance",\n'
        '     "resource_groups": "resource-group concentration and density", "management_groups": "cost across the tenant hierarchy",\n'
        '     "savings_roi": "realization pipeline, capture rate and return on effort",\n'
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

    # Management review blocks — only present for those report types, so the
    # existing six report shapes are unchanged.
    if meta.get("mgmt"):
        for block in ("service_categories", "compute", "storage", "network",
                      "security_monitoring", "environments", "resource_groups",
                      "management_groups", "savings_roi", "governance"):
            report[block] = facts.get(block, {"available": False})

    return report
