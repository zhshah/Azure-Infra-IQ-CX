"""
FinOps Tag Analytics Service.

Analyses tag coverage and tag-based cost allocation using:
  - Azure Cost Management API  → cost grouped by TagKey:{key}  (live billing data)
  - azure-mgmt-resourcegraph   → resource count coverage       (already in requirements.txt)
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

from services import finops_data_service as fds
from services.finops_data_service import (
    query_cost_multi_subscription,
    normalise_cost_rows,
    get_subscription_ids,
    resolve_time_range,
)
from .azure_auth import get_credential

from models.schemas import (
    FinOpsTagKeyStats,
    FinOpsTagCostMatrix,
    FinOpsTagAnalyticsResult,
)

# Required tags (mirrors tagging_service.py pre-seeded schema)
DEFAULT_REQUIRED_TAGS = [
    "CostCenter",
    "Environment",
    "Owner",
    "Application",
    "Department",
]


def get_tag_analytics(
    time_range: str = "mtd",
    subscription_ids: Optional[List[str]] = None,
    required_tags: Optional[List[str]] = None,
) -> FinOpsTagAnalyticsResult:
    """
    Full tag analytics report.  Cost per tag key fetched from Azure Cost
    Management API (group_by=[TagKey:{key}]).  Coverage from ResourceGraph.
    """
    if subscription_ids is None:
        subscription_ids = get_subscription_ids()
    if required_tags is None:
        required_tags = DEFAULT_REQUIRED_TAGS

    from_date, to_date = resolve_time_range(time_range)

    coverage_map   = _get_tag_coverage_resourcegraph(subscription_ids)
    total_resources = coverage_map.get("__total__", 0)

    # Tag keys come back in whatever case Azure stored them, while required tags are
    # typed by the user ("Environment" vs "environment"). Match case-insensitively or
    # a correctly-tagged estate scores 0%.
    _cov_ci = {}
    for _k, _v in coverage_map.items():
        if str(_k).startswith("__"):
            continue
        _cov_ci[str(_k).lower()] = _cov_ci.get(str(_k).lower(), 0) + int(_v or 0)

    def _covered_for(key: str) -> int:
        return _cov_ci.get(str(key).lower(), 0)

    tag_key_stats: List[FinOpsTagKeyStats] = []
    for tag_key in required_tags:
        matrix = get_tag_cost_matrix(tag_key, time_range=time_range, subscription_ids=subscription_ids)
        covered = _covered_for(tag_key)
        coverage_pct = (covered / total_resources * 100) if total_resources else 0.0
        tag_key_stats.append(FinOpsTagKeyStats(
            tag_key=tag_key,
            covered_resources=covered,
            total_resources=total_resources,
            coverage_pct=round(coverage_pct, 1),
            total_cost_usd=round(matrix.total_usd, 2),
            distinct_values=len(matrix.rows),
            top_values=matrix.rows[:5],
            is_required=True,
        ))

    # Coverage for EVERY discovered key (no cost lookup — that is one API call per key).
    # Folded case-insensitively so this table matches the tag chips, which also fold:
    # "Environment" (120) and "environment" (16) are one key at 136, not two rows.
    _req_ci = {str(t).lower() for t in required_tags}
    _display: Dict[str, str] = {}
    for key, covered in ((k, v) for k, v in coverage_map.items() if not str(k).startswith("__")):
        low = str(key).lower()
        # Prefer the casing carried by the most resources.
        if low not in _display or int(covered or 0) > int(coverage_map.get(_display[low], 0) or 0):
            _display[low] = key
    tag_stats = [
        FinOpsTagKeyStats(
            tag_key=_display[low],
            covered_resources=covered,
            total_resources=total_resources,
            coverage_pct=round((covered / total_resources * 100) if total_resources else 0.0, 1),
            total_cost_usd=0.0,
            distinct_values=0,
            top_values=[],
            is_required=low in _req_ci,
        )
        for low, covered in sorted(_cov_ci.items(), key=lambda kv: -int(kv[1] or 0))
    ]

    # Untagged cost — query cost without any tag grouping, then subtract tagged
    untagged_cost = _get_untagged_cost(subscription_ids, from_date, to_date)
    untagged_count = coverage_map.get("__untagged__", 0)

    # Compliance = % resources that have ALL required tags
    compliance_pct = _compute_compliance(coverage_map, required_tags, total_resources)
    compliant = min((_covered_for(k) for k in required_tags), default=total_resources) if required_tags else total_resources
    compliant = max(0, min(int(compliant), int(total_resources)))
    missing_required = [k for k in required_tags if _covered_for(k) == 0]

    return FinOpsTagAnalyticsResult(
        tag_keys=tag_key_stats,
        untagged_cost_usd=round(untagged_cost, 2),
        untagged_resource_count=untagged_count,
        compliance_score_pct=round(compliance_pct, 1),
        required_tags=required_tags,
        total_resources=int(total_resources),
        compliant_resources=compliant,
        non_compliant_resources=max(int(total_resources) - compliant, 0),
        untagged_spend_usd=round(untagged_cost, 2),
        tag_stats=tag_stats,
        missing_required_tags=missing_required,
        generated_at=datetime.now(tz=timezone.utc).isoformat(),
        data_source="azure_cost_management",
    )


def get_tag_cost_matrix(
    tag_key: str,
    time_range: str = "mtd",
    subscription_ids: Optional[List[str]] = None,
) -> FinOpsTagCostMatrix:
    """
    Return cost broken down by values of `tag_key`.
    Uses Azure Cost Management group_by=[TagKey:{tag_key}].
    """
    if subscription_ids is None:
        subscription_ids = get_subscription_ids()

    from_date, to_date = resolve_time_range(time_range)
    dim_key = f"TagKey:{tag_key}"

    rows = query_cost_multi_subscription(
        subscription_ids, from_date, to_date,
        granularity="None",
        group_by=[dim_key],
        cost_type="ActualCost",
    )
    norm = normalise_cost_rows(rows, [dim_key])

    by_value: Dict[str, float] = {}
    for r in norm:
        val = r["dimensions"].get(dim_key, "(untagged)") or "(untagged)"
        by_value[val] = by_value.get(val, 0.0) + r["cost_usd"]

    total = sum(by_value.values())
    untagged = by_value.pop("(untagged)", 0.0)

    sorted_rows = sorted(
        [{"tag_value": k, "cost_usd": round(v, 2), "resource_count": 0,
          "pct": round(v / total * 100, 1) if total else 0.0}
         for k, v in by_value.items()],
        key=lambda x: x["cost_usd"], reverse=True,
    )

    return FinOpsTagCostMatrix(
        tag_key=tag_key,
        rows=sorted_rows,
        total_usd=round(total - untagged, 2),
        untagged_usd=round(untagged, 2),
        date_from=str(from_date),
        date_to=str(to_date),
        data_source="azure_cost_management",
    )


def _get_untagged_cost(subscription_ids: list, from_date, to_date) -> float:
    """
    Approximate untagged cost: total cost minus tagged cost.
    (Azure Cost Management does not natively filter on 'tag missing'.)
    """
    total_rows = query_cost_multi_subscription(
        subscription_ids, from_date, to_date,
        granularity="None", group_by=[], cost_type="ActualCost",
    )
    total_norm = normalise_cost_rows(total_rows, [])
    total_cost = sum(r["cost_usd"] for r in total_norm)

    # Tagged cost: query grouped by any required tag key
    tag_rows = query_cost_multi_subscription(
        subscription_ids, from_date, to_date,
        granularity="None", group_by=["TagKey:CostCenter"], cost_type="ActualCost",
    )
    tag_norm = normalise_cost_rows(tag_rows, ["TagKey:CostCenter"])
    tagged_cost = sum(
        r["cost_usd"] for r in tag_norm
        if r["dimensions"].get("TagKey:CostCenter", "")
    )
    return max(0.0, total_cost - tagged_cost)


def _get_tag_coverage_resourcegraph(subscription_ids: List[str]) -> Dict[str, int]:
    """
    Use azure-mgmt-resourcegraph KQL to count resources with/without each tag.
    Returns {tag_key: count_with_tag, "__total__": total, "__untagged__": untagged_count}.
    Falls back to empty dict if ResourceGraph is unavailable.
    """
    result: Dict[str, int] = {}
    try:
        from azure.mgmt.resourcegraph import ResourceGraphClient
        from azure.mgmt.resourcegraph.models import QueryRequest
        credential = get_credential()
        rg_client  = ResourceGraphClient(credential)

        # Total resources
        total_query = QueryRequest(
            subscriptions=subscription_ids,
            query="Resources | summarize count()",
        )
        total_resp = rg_client.resources(total_query)
        total = int((total_resp.data or [{}])[0].get("count_", 0))
        result["__total__"] = total

        # Untagged — no tags at all
        untagged_query = QueryRequest(
            subscriptions=subscription_ids,
            query="Resources | where isnull(tags) or array_length(bag_keys(tags)) == 0 | summarize count()",
        )
        unt_resp = rg_client.resources(untagged_query)
        untagged = int((unt_resp.data or [{}])[0].get("count_", 0))
        result["__untagged__"] = untagged

        # Per required tag key
        for tag_key in DEFAULT_REQUIRED_TAGS:
            q = QueryRequest(
                subscriptions=subscription_ids,
                query=f"Resources | where isnotempty(tags['{tag_key}']) | summarize count()",
            )
            try:
                resp = rg_client.resources(q)
                result[tag_key] = int((resp.data or [{}])[0].get("count_", 0))
            except Exception:
                result[tag_key] = 0

    except Exception as e:
        logger.debug("_get_tag_coverage_resourcegraph: %s", e)

    return result


def _compute_compliance(coverage_map: Dict[str, int], required_tags: List[str], total: int) -> float:
    if not total or not required_tags:
        return 100.0
    # Azure preserves whatever case a tag was written in, so fold before matching.
    ci: Dict[str, int] = {}
    for k, v in coverage_map.items():
        if str(k).startswith("__"):
            continue
        ci[str(k).lower()] = ci.get(str(k).lower(), 0) + int(v or 0)
    # Approximate: resource has all required tags ≈ min coverage across required keys
    min_covered = min(ci.get(str(k).lower(), 0) for k in required_tags)
    return min(min_covered / total * 100, 100.0)
