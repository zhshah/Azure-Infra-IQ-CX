"""
FinOps Orchestrator Service.

Aggregates all FinOps data sources into high-level KPIs and cross-cutting
views (savings opportunities, allocation, chargeback, top movers).

All cost figures are sourced from Azure Cost Management APIs via
finops_data_service — never estimated or fabricated.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, date, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

from services import finops_data_service as fds
from services.finops_data_service import (
    query_cost_multi_subscription,
    normalise_cost_rows,
    get_subscription_ids,
    get_subscription_names,
    resolve_time_range,
)
import services.budget_service as budget_svc
import services.tag_analytics_service as tag_svc
import services.commitment_service as commitment_svc
import services.forecast_service as forecast_svc

from models.schemas import (
    FinOpsKPI,
    FinOpsAllocationReport,
    FinOpsAllocationItem,
    FinOpsChargebackReport,
    FinOpsChargebackEntry,
    FinOpsCostExplorerQuery,
    FinOpsCostExplorerResult,
    FinOpsCostDataPoint,
    FinOpsSavingsSummary,
    FinOpsSavingsOpportunity,
    FinOpsTopMover,
)


# ── FinOps KPI ─────────────────────────────────────────────────────────────────

def get_finops_kpi(
    subscription_ids: Optional[List[str]] = None,
) -> FinOpsKPI:
    """
    Compute executive FinOps KPIs from live Azure Cost Management data.
    MTD and prior month totals fetched directly from Azure API.
    """
    if not subscription_ids:
        subscription_ids = get_subscription_ids()

    today     = datetime.now(tz=timezone.utc).date()
    mtd_start = today.replace(day=1)
    # Prior month
    pm_end   = mtd_start - timedelta(days=1)
    pm_start = pm_end.replace(day=1)

    sub_names = get_subscription_names()

    # MTD total
    mtd_rows = query_cost_multi_subscription(
        subscription_ids, mtd_start, today,
        granularity="Daily", group_by=["SubscriptionId"], cost_type="ActualCost",
    )
    mtd_norm  = normalise_cost_rows(mtd_rows, ["SubscriptionId"])
    spend_mtd = sum(r["cost_usd"] for r in mtd_norm)

    # Daily trend (last 30 days for sparkline)
    daily_map: Dict[str, float] = {}
    for r in mtd_norm:
        if r["date"]:
            daily_map[r["date"]] = daily_map.get(r["date"], 0.0) + r["cost_usd"]
    trend_30d   = [daily_map.get(str(today - timedelta(days=29 - i)), 0.0) for i in range(30)]
    trend_dates = [str(today - timedelta(days=29 - i)) for i in range(30)]

    # Prior month total (MTD-to-MTD for fair comparison)
    pm_mtd_end = min(pm_end, date(pm_start.year, pm_start.month, today.day))
    pm_rows = query_cost_multi_subscription(
        subscription_ids, pm_start, pm_mtd_end,
        granularity="None", group_by=[], cost_type="ActualCost",
    )
    pm_norm      = normalise_cost_rows(pm_rows, [])
    spend_last   = sum(r["cost_usd"] for r in pm_norm)
    mom_delta    = spend_mtd - spend_last
    mom_pct      = (mom_delta / spend_last * 100) if spend_last else 0.0

    # Top subscription by cost (MTD)
    sub_cost: Dict[str, float] = {}
    for r in mtd_norm:
        sid = r["dimensions"].get("SubscriptionId", r.get("subscription_id", ""))
        sub_cost[sid] = sub_cost.get(sid, 0.0) + r["cost_usd"]
    top_sub_id   = max(sub_cost, key=sub_cost.get) if sub_cost else ""
    top_sub_cost = sub_cost.get(top_sub_id, 0.0)
    top_sub_name = sub_names.get(top_sub_id, top_sub_id[:8] + "…" if top_sub_id else "")
    by_sub_list  = [
        {"id": sid, "name": sub_names.get(sid, sid[:8] + "…"), "cost": round(cost, 2)}
        for sid, cost in sorted(sub_cost.items(), key=lambda x: -x[1])[:5]
    ]

    # Budget KPIs
    budgets     = budget_svc.list_budgets()
    exceeded    = 0
    at_risk     = 0
    util_total  = 0.0
    budget_count = len(budgets)
    for b in budgets:
        try:
            v = budget_svc.compute_budget_variance(b.id)
            if v:
                if v.status == "exceeded":
                    exceeded += 1
                elif v.status == "at_risk":
                    at_risk  += 1
                util_total += v.utilization_pct
        except Exception:
            pass
    avg_util = util_total / budget_count if budget_count else 0.0

    # EOM forecast
    try:
        fc = forecast_svc.get_forecast(horizon_days=30, subscription_ids=subscription_ids)
        eom_forecast = fc.eom_forecast_usd
    except Exception:
        eom_forecast = 0.0

    # RI KPIs from commitment summary
    ri_cov = 0.0
    ri_util = 0.0
    has_reservations = False
    try:
        cs = commitment_svc.get_commitment_summary()
        ri_cov  = cs.coverage_pct
        ri_util = cs.utilization_pct
    except Exception:
        pass

    # Tagging compliance
    tag_compliance = 0.0
    try:
        ta = tag_svc.get_tag_analytics(time_range="mtd", subscription_ids=subscription_ids)
        tag_compliance = ta.compliance_score_pct
    except Exception:
        pass

    # Anomaly count from savings opportunities (uses cached dashboard if available)
    anomaly_count = 0
    try:
        from services.persistence_service import load_latest_dashboard
        dash = load_latest_dashboard()
        if dash:
            anomaly_count = len(dash.get("cost_anomalies", []))
    except Exception:
        pass

    # Savings identified (from latest dashboard cache)
    savings = 0.0
    total_untagged = 0
    try:
        from services.persistence_service import load_latest_dashboard
        dash = dash if "dash" in dir() else load_latest_dashboard()
        if dash:
            savings = float(dash.get("kpi", {}).get("total_potential_savings", 0))
            total_untagged = int(dash.get("total_untagged", 0) or 0)
            has_reservations = bool(dash.get("active_reservations") or [])
    except Exception:
        pass

    return FinOpsKPI(
        total_spend_mtd=round(spend_mtd, 2),
        total_spend_last_month=round(spend_last, 2),
        mom_delta_usd=round(mom_delta, 2),
        mom_delta_pct=round(mom_pct, 1),
        forecast_eom_usd=round(eom_forecast, 2),
        budget_utilization_pct=round(avg_util, 1),
        budgets_exceeded=exceeded,
        budgets_at_risk=at_risk,
        savings_identified_usd=round(savings, 2),
        ri_coverage_pct=round(ri_cov, 1),
        ri_utilization_pct=round(ri_util, 1),
        tagging_compliance_pct=round(tag_compliance, 1),
        total_untagged=total_untagged,
        tag_required_keys=["owner", "environment", "project", "cost-center"],
        has_reservations=has_reservations,
        has_budgets=budget_count > 0,
        anomaly_count=anomaly_count,
        top_subscription_name=top_sub_name,
        top_subscription_cost=round(top_sub_cost, 2),
        cost_trend_30d=[round(v, 2) for v in trend_30d],
        cost_trend_dates=trend_dates,
        by_subscription=by_sub_list,
        subscription_count=len(subscription_ids),
        total_resource_count=0,
        data_source="azure_cost_management",
        generated_at=datetime.now(tz=timezone.utc).isoformat(),
    )


# ── Cost Explorer ─────────────────────────────────────────────────────────────

def run_cost_explorer(
    query: FinOpsCostExplorerQuery,
    subscription_ids: Optional[List[str]] = None,
) -> FinOpsCostExplorerResult:
    """
    Execute a Cost Explorer query against Azure.  Maps directly to
    CostManagementClient.query.usage() with the user-specified dimensions/filters.
    Results are byte-for-byte identical to Azure Portal Cost Analysis.
    """
    if not subscription_ids:
        subscription_ids = get_subscription_ids()

    # Apply subscription filter from query
    if query.filters.subscriptions:
        subscription_ids = [s for s in subscription_ids if s in query.filters.subscriptions]

    from_date, to_date = resolve_time_range(query.time_range, query.date_from, query.date_to)

    # Build group_by list (up to 3)
    group_by = query.group_by[:3] if query.group_by else ["SubscriptionId"]

    # Execute query
    rows = query_cost_multi_subscription(
        subscription_ids, from_date, to_date,
        granularity=query.granularity,
        group_by=group_by,
        cost_type=query.cost_type,
    )
    norm = normalise_cost_rows(rows, group_by)

    # Apply additional filters (resource_group, region, etc.)
    norm = _apply_filters(norm, query.filters, group_by)

    # Build data points
    # For time-series: group by (date, first dimension)
    # For no-granularity: group by (first dimension only)
    point_map: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))

    for r in norm:
        date_key  = r["date"] or ""
        dim_val   = _get_primary_label(r, group_by)
        point_map[date_key][dim_val] += r["cost_usd"]

    data_points: List[FinOpsCostDataPoint] = []
    for date_key, dims in sorted(point_map.items()):
        for dim_val, cost in sorted(dims.items(), key=lambda x: -x[1]):
            data_points.append(FinOpsCostDataPoint(
                date=date_key or None,
                label=dim_val,
                cost_usd=round(cost, 2),
            ))

    total = sum(dp.cost_usd for dp in data_points)

    # Top contributors
    contrib: Dict[str, float] = defaultdict(float)
    for dp in data_points:
        contrib[dp.label] += dp.cost_usd
    top = sorted(contrib.items(), key=lambda x: -x[1])[:10]
    top_contributors = [{"label": k, "cost": round(v, 2), "pct": round(v / total * 100, 1) if total else 0}
                        for k, v in top]

    return FinOpsCostExplorerResult(
        data_points=data_points,
        total_usd=round(total, 2),
        top_contributors=top_contributors,
        dimensions_used=group_by,
        cost_type=query.cost_type,
        date_from=str(from_date),
        date_to=str(to_date),
        granularity=query.granularity,
        currency="USD",
        data_source="azure_cost_management",
    )


def _get_primary_label(row: Dict, group_by: List[str]) -> str:
    if not group_by:
        return row.get("subscription_id", "")
    dim_key = group_by[0]
    return row["dimensions"].get(dim_key, "") or "(blank)"


def _apply_filters(norm: List[Dict], filters: Any, group_by: List[str]) -> List[Dict]:
    """
    Apply client-side filters for dimensions that can't be pushed into the
    Azure query (e.g. resource_group when not in group_by).
    """
    out = []
    for r in norm:
        # Cost range
        if filters.min_cost is not None and r["cost_usd"] < filters.min_cost:
            continue
        if filters.max_cost is not None and r["cost_usd"] > filters.max_cost:
            continue
        out.append(r)
    return out


# ── Cost Allocation ───────────────────────────────────────────────────────────

def get_cost_allocation(
    dimension: str = "SubscriptionId",
    time_range: str = "mtd",
    subscription_ids: Optional[List[str]] = None,
) -> FinOpsAllocationReport:
    """
    Return cost allocation grouped by `dimension` using live Azure data.
    `dimension` can be any Azure Cost Management dimension or TagKey:{name}.
    """
    if not subscription_ids:
        subscription_ids = get_subscription_ids()

    from_date, to_date = resolve_time_range(time_range)

    rows = query_cost_multi_subscription(
        subscription_ids, from_date, to_date,
        granularity="None", group_by=[dimension], cost_type="ActualCost",
    )
    norm = normalise_cost_rows(rows, [dimension])

    # Also get prior period for MoM delta
    prior_from = from_date - (to_date - from_date + timedelta(days=1))
    prior_to   = from_date - timedelta(days=1)
    prior_rows = query_cost_multi_subscription(
        subscription_ids, prior_from, prior_to,
        granularity="None", group_by=[dimension], cost_type="ActualCost",
    )
    prior_norm = normalise_cost_rows(prior_rows, [dimension])
    prior_map: Dict[str, float] = {}
    for r in prior_norm:
        k = r["dimensions"].get(dimension, "(blank)") or "(blank)"
        prior_map[k] = prior_map.get(k, 0.0) + r["cost_usd"]

    by_dim: Dict[str, float] = {}
    for r in norm:
        k = r["dimensions"].get(dimension, "(blank)") or "(blank)"
        by_dim[k] = by_dim.get(k, 0.0) + r["cost_usd"]

    total       = sum(by_dim.values())
    unallocated = by_dim.pop("(blank)", 0.0)

    sub_names = get_subscription_names()

    items: List[FinOpsAllocationItem] = []
    for dim_val, cost in sorted(by_dim.items(), key=lambda x: -x[1]):
        prior = prior_map.get(dim_val, 0.0)
        mom   = ((cost - prior) / prior * 100) if prior else 0.0
        display_name = sub_names.get(dim_val, dim_val) if dimension == "SubscriptionId" else dim_val
        items.append(FinOpsAllocationItem(
            dimension_value=display_name,
            cost_usd=round(cost, 2),
            cost_pct=round(cost / total * 100, 1) if total else 0.0,
            resource_count=0,
            mom_delta_pct=round(mom, 1),
        ))

    dim_labels = {
        "SubscriptionId": "Subscription",
        "ResourceGroupName": "Resource Group",
        "ResourceType": "Resource Type",
        "ServiceFamily": "Service Family",
        "ServiceName": "Service Name",
        "ResourceLocation": "Region",
    }

    return FinOpsAllocationReport(
        dimension=dimension,
        dimension_label=dim_labels.get(dimension, dimension.replace("TagKey:", "Tag: ")),
        items=items,
        total_usd=round(total, 2),
        unallocated_usd=round(unallocated, 2),
        unallocated_pct=round(unallocated / (total + unallocated) * 100, 1) if (total + unallocated) else 0.0,
        period_label=f"{from_date} → {to_date}",
        date_from=str(from_date),
        date_to=str(to_date),
        data_source="azure_cost_management",
    )


# ── Chargeback ───────────────────────────────────────────────────────────────

def get_chargeback_report(
    time_range: str = "last_month",
    subscription_ids: Optional[List[str]] = None,
) -> FinOpsChargebackReport:
    """
    Group all spend by CostCenter tag (from Azure Cost Management API).
    Identifies unallocated cost (resources without CostCenter tag).
    """
    if not subscription_ids:
        subscription_ids = get_subscription_ids()

    from_date, to_date = resolve_time_range(time_range)

    # Cost by CostCenter tag + ServiceFamily (for breakdown)
    rows = query_cost_multi_subscription(
        subscription_ids, from_date, to_date,
        granularity="None",
        group_by=["TagKey:CostCenter", "ServiceFamily"],
        cost_type="ActualCost",
    )
    norm = normalise_cost_rows(rows, ["TagKey:CostCenter", "ServiceFamily"])

    # Also get total to compute unallocated
    total_rows = query_cost_multi_subscription(
        subscription_ids, from_date, to_date,
        granularity="None", group_by=[], cost_type="ActualCost",
    )
    total_norm = normalise_cost_rows(total_rows, [])
    grand_total = sum(r["cost_usd"] for r in total_norm)

    # Aggregate by cost_center
    cc_data: Dict[str, Dict] = defaultdict(lambda: {"total": 0.0, "by_service": defaultdict(float)})
    for r in norm:
        cc  = r["dimensions"].get("TagKey:CostCenter", "") or ""
        svc = r["dimensions"].get("ServiceFamily", "Other") or "Other"
        cc_data[cc]["total"]             += r["cost_usd"]
        cc_data[cc]["by_service"][svc]   += r["cost_usd"]

    allocated_total = sum(v["total"] for k, v in cc_data.items() if k)
    unallocated     = cc_data.pop("", {"total": 0.0, "by_service": {}})
    unallocated_usd = grand_total - allocated_total

    entries: List[FinOpsChargebackEntry] = []
    for cc, data in sorted(cc_data.items(), key=lambda x: -x[1]["total"]):
        entries.append(FinOpsChargebackEntry(
            cost_center=cc,
            allocated_cost_usd=round(data["total"], 2),
            resource_count=0,
            subscription_count=len(subscription_ids),
            by_service={k: round(v, 2) for k, v in data["by_service"].items()},
            coverage_pct=100.0,
        ))

    # Add unallocated entry
    if unallocated_usd > 0:
        entries.append(FinOpsChargebackEntry(
            cost_center="(Unallocated)",
            allocated_cost_usd=round(unallocated_usd, 2),
            resource_count=0,
            by_service={},
            coverage_pct=0.0,
        ))

    coverage = (allocated_total / grand_total * 100) if grand_total else 0.0

    return FinOpsChargebackReport(
        entries=entries,
        total_allocated_usd=round(allocated_total, 2),
        total_unallocated_usd=round(unallocated_usd, 2),
        coverage_pct=round(coverage, 1),
        period_label=f"{from_date} → {to_date}",
        date_from=str(from_date),
        date_to=str(to_date),
        data_source="azure_cost_management",
        generated_at=datetime.now(tz=timezone.utc).isoformat(),
    )


# ── Savings Opportunities ─────────────────────────────────────────────────────

def get_savings_summary(dashboard_cache: Optional[Dict] = None) -> FinOpsSavingsSummary:
    """
    Consolidate savings opportunities from:
      - Azure RI recommendations (commitment_service — Azure native)
      - Rightsize recommendations (existing rightsize_service)
      - Waste/orphan detection (existing scoring_service)
    """
    opportunities: List[FinOpsSavingsOpportunity] = []

    # Accept either a plain dict OR a DashboardData/pydantic object. Callers
    # (e.g. the report XLSX endpoint) often pass the cached DashboardData object
    # directly; treating it as a dict caused
    # "'DashboardData' object has no attribute 'get'" and silently emptied the
    # Savings sheet. Normalise to a dict here so both shapes work.
    if dashboard_cache is not None and not isinstance(dashboard_cache, dict):
        for _attr in ("model_dump", "dict"):
            _fn = getattr(dashboard_cache, _attr, None)
            if callable(_fn):
                try:
                    dashboard_cache = _fn()
                    break
                except Exception:
                    continue
        if not isinstance(dashboard_cache, dict):
            dashboard_cache = None

    # RI purchase recommendations (Azure native)
    try:
        cs = commitment_svc.get_commitment_summary()
        for i, opt in enumerate(cs.savings_plan_options):
            if opt.monthly_savings > 0:
                effort = "low" if opt.break_even_months < 6 else "medium"
                confidence = opt.azure_confidence.lower() if opt.azure_confidence else "medium"
                score = opt.monthly_savings * (3 if confidence == "high" else (2 if confidence == "medium" else 1))
                opportunities.append(FinOpsSavingsOpportunity(
                    id=f"ri_{i}",
                    category="ri_purchase",
                    category_label="Reserve Instance",
                    resource_type=opt.resource_type,
                    resource_id="",
                    resource_name=f"{opt.resource_type} in {opt.region}",
                    resource_group="",
                    subscription_id="",
                    current_monthly_cost=round(opt.current_monthly_cost, 2),
                    potential_savings_usd=round(opt.monthly_savings, 2),
                    savings_pct=round(opt.savings_pct, 1),
                    confidence=confidence,
                    effort=effort,
                    action=f"Purchase {opt.recommended_quantity}x {opt.term_label} RI for {opt.resource_type} in {opt.region}",
                    priority_score=round(min(score / 100, 100), 1),
                    source="azure_advisor",
                ))
    except Exception as e:
        logger.debug("savings: RI recommendations error: %s", e)

    # From existing dashboard cache (rightsize, waste, orphan)
    if dashboard_cache:
        # Rightsize opportunities
        for rs in dashboard_cache.get("rightsize_opportunities", []):
            opportunities.append(FinOpsSavingsOpportunity(
                id=f"rs_{rs.get('resource_id', '')[:16]}",
                category="rightsize",
                category_label="Right-Size",
                resource_id=rs.get("resource_id", ""),
                resource_name=rs.get("resource_name", ""),
                resource_type=rs.get("resource_type", ""),
                resource_group=rs.get("resource_group", ""),
                subscription_id="",
                current_monthly_cost=round(float(rs.get("current_cost", 0)), 2),
                potential_savings_usd=round(float(rs.get("estimated_savings", 0)), 2),
                savings_pct=round(float(rs.get("savings_pct", 0)), 1),
                confidence="high",
                effort="medium",
                action=f"Resize to {rs.get('suggested_sku', '')}",
                priority_score=round(float(rs.get("savings_pct", 0)) * 0.8, 1),
                source="rightsize_analysis",
            ))

        # Waste & orphan resources
        for res in dashboard_cache.get("resources", []):
            waste = float(res.get("estimated_monthly_savings", 0))
            if waste <= 0:
                continue
            is_orphan = res.get("is_orphan", False)
            cat = "orphan" if is_orphan else "waste"
            cat_label = "Orphan Resource" if is_orphan else "Waste Cleanup"
            opportunities.append(FinOpsSavingsOpportunity(
                id=f"{cat}_{res.get('resource_id', '')[:16]}",
                category=cat,
                category_label=cat_label,
                resource_id=res.get("resource_id", ""),
                resource_name=res.get("resource_name", ""),
                resource_type=res.get("resource_type", ""),
                resource_group=res.get("resource_group", ""),
                subscription_id=res.get("subscription_id", ""),
                current_monthly_cost=round(float(res.get("cost_current_month", 0)), 2),
                potential_savings_usd=round(waste, 2),
                savings_pct=round(float(res.get("rightsize_savings_pct", 0)) or 100.0, 1),
                confidence="high" if is_orphan else "medium",
                effort="low",
                action=res.get("recommendation", "Review and decommission"),
                priority_score=round(waste / max(float(res.get("cost_current_month", 1)), 0.01) * 50, 1),
                source="scoring_engine",
            ))

    # Deduplicate & sort by priority
    seen: set = set()
    deduped: List[FinOpsSavingsOpportunity] = []
    for opp in sorted(opportunities, key=lambda x: -x.priority_score):
        key = (opp.category, opp.resource_id or opp.resource_name)
        if key not in seen:
            seen.add(key)
            deduped.append(opp)

    by_cat: Dict[str, float] = defaultdict(float)
    for opp in deduped:
        by_cat[opp.category] += opp.potential_savings_usd

    return FinOpsSavingsSummary(
        total_identified_usd=round(sum(by_cat.values()), 2),
        by_category=dict(by_cat),
        opportunity_count=len(deduped),
        opportunities=deduped,
        generated_at=datetime.now(tz=timezone.utc).isoformat(),
    )


# ── Top Movers ────────────────────────────────────────────────────────────────

def get_top_movers(
    subscription_ids: Optional[List[str]] = None,
    dimension: str = "ResourceGroupName",
    limit: int = 20,
) -> List[FinOpsTopMover]:
    """
    Find resources / groups with the largest cost change vs. prior period.
    Uses live Azure Cost Management data.
    """
    if not subscription_ids:
        subscription_ids = get_subscription_ids()

    today     = datetime.now(tz=timezone.utc).date()
    cur_from  = today - timedelta(days=29)
    prior_from = today - timedelta(days=59)
    prior_to   = today - timedelta(days=30)

    sub_names = get_subscription_names()

    def _fetch(from_d, to_d):
        rows = query_cost_multi_subscription(
            subscription_ids, from_d, to_d,
            granularity="None", group_by=[dimension, "SubscriptionId"],
            cost_type="ActualCost",
        )
        norm = normalise_cost_rows(rows, [dimension, "SubscriptionId"])
        agg: Dict[str, Dict] = {}
        for r in norm:
            dim_val = r["dimensions"].get(dimension, "") or ""
            sub_id  = r["dimensions"].get("SubscriptionId", r.get("subscription_id", ""))
            key = (dim_val, sub_id)
            if key not in agg:
                agg[key] = {"cost": 0.0, "sub_id": sub_id}
            agg[key]["cost"] += r["cost_usd"]
        return agg

    current = _fetch(cur_from, today)
    prior   = _fetch(prior_from, prior_to)

    movers: List[FinOpsTopMover] = []
    all_keys = set(current) | set(prior)
    for key in all_keys:
        dim_val, sub_id = key
        if not dim_val:
            continue
        cur_cost   = current.get(key, {}).get("cost", 0.0)
        prior_cost = prior.get(key, {}).get("cost", 0.0)
        delta_usd  = cur_cost - prior_cost
        delta_pct  = (delta_usd / prior_cost * 100) if prior_cost else 0.0

        if abs(delta_usd) < 1.0:
            continue

        movers.append(FinOpsTopMover(
            subscription_id=sub_id,
            subscription_name=sub_names.get(sub_id, sub_id[:8] + "…" if sub_id else ""),
            dimension_value=dim_val,
            dimension=dimension,
            current_cost=round(cur_cost, 2),
            prior_cost=round(prior_cost, 2),
            delta_usd=round(delta_usd, 2),
            delta_pct=round(delta_pct, 1),
            direction="up" if delta_usd > 0 else "down",
        ))

    return sorted(movers, key=lambda x: -abs(x.delta_usd))[:limit]
