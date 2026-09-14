"""
Quota & Capacity service — Azure compute quota usage per region.

Uses the Compute usages API (azure-mgmt-compute, already a dependency) to report
vCPU, VM-family and instance quota usage versus limits for every region the
estate runs in — PLUS strategically important / capacity-restricted regions
(e.g. Qatar Central) even when nothing is deployed there yet, because those are
exactly the regions where customers must request a quota whitelist before they
can create resources. Resilient — degrades gracefully.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from services.azure_auth import get_credential, get_subscription_ids
from services.resource_graph_service import query_resource_graph

logger = logging.getLogger(__name__)

# All regions the estate touches (any resource type — not just compute), so we
# also surface quota for regions a customer wants to expand into.
_REGIONS_KQL = """
resources
| where location != '' and location != 'global'
| summarize c = count() by location, subscriptionId
"""

_WARN_PCT = 80.0
# Always include these capacity-restricted regions even with zero deployments.
_DEFAULT_STRATEGIC_REGIONS = {"qatarcentral"}
_GLOBALish = {"", "global", "centraluseuap", "eastus2euap"}


def _strategic_regions() -> set:
    regions = set(_DEFAULT_STRATEGIC_REGIONS)
    try:
        from services import settings_service
        extra = settings_service.get_value("QUOTA_EXTRA_REGIONS", "") or ""
        for x in extra.split(","):
            x = x.strip().lower().replace(" ", "")
            if x:
                regions.add(x)
    except Exception:
        pass
    return regions


def _classify_quota(name_lower: str) -> str:
    if "total regional" in name_lower and ("vcpu" in name_lower or "core" in name_lower):
        return "regional_vcpu"
    if "family" in name_lower and ("vcpu" in name_lower or "core" in name_lower):
        return "vm_family"
    if any(k in name_lower for k in ("virtual machines", "virtual machine scale sets",
                                     "availability sets", "dedicated host")):
        return "instances"
    if "vcpu" in name_lower or "core" in name_lower:
        return "vcpu_other"
    return "other"


def _family_short(name: str) -> str:
    m = re.search(r"standard\s+(.+?)\s+family", name, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return name.replace(" vCPUs", "").replace(" cores", "").strip()


def get_quota_usage(subscription_ids: Optional[List[str]] = None,
                    resources: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Compute quota usage vs limits per (subscription, region), including blocked
    (limit=0) families that require a quota request, near-limit families, and
    per-region vCPU headroom for capacity planning."""
    subs = subscription_ids or get_subscription_ids()
    result: Dict[str, Any] = {
        "items": [], "near_limit": [], "blocked": [], "regions_summary": [],
        "regions": 0, "subscriptions": len(subs or []),
        "near_limit_count": 0, "blocked_count": 0, "total_quotas": 0,
        "total_vcpu_used": 0, "total_vcpu_limit": 0, "vcpu_headroom": 0,
        "strategic_regions": sorted(_strategic_regions()),
        "generated_at": datetime.now(timezone.utc).isoformat(), "note": "",
    }
    try:
        region_rows = query_resource_graph(_REGIONS_KQL, subscription_ids, max_results=20000)
    except Exception as exc:
        logger.warning("quota: region discovery failed: %s", exc)
        region_rows = []

    # Build {sub -> set(regions)} = estate regions ∪ strategic regions (per sub)
    sub_regions: Dict[str, set] = {}
    for r in region_rows:
        loc = (r.get("location") or "").strip().lower().replace(" ", "")
        sub = (r.get("subscriptionId") or "").strip()
        if loc and sub and loc not in _GLOBALish:
            sub_regions.setdefault(sub, set()).add(loc)
    strategic = _strategic_regions()
    for sub in (subs or []):
        sub_regions.setdefault(sub, set()).update(strategic)
    if not sub_regions:
        result["note"] = "No subscriptions/regions in scope to query quota for."
        return result

    try:
        from azure.mgmt.compute import ComputeManagementClient
    except Exception as exc:
        logger.warning("quota: azure-mgmt-compute unavailable: %s", exc)
        result["note"] = "azure-mgmt-compute not available."
        return result

    # Families actually in use in the estate (for an "in use" flag)
    used_families: set = set()
    for res in (resources or []):
        size = str(res.get("sku") or res.get("size") or res.get("vm_size") or "").strip()
        if size.lower().startswith("standard_"):
            # Standard_D4s_v3 -> Dsv3-ish token (best effort)
            used_families.add(size.lower())

    cred = get_credential()
    clients: Dict[str, Any] = {}
    region_roll: Dict[tuple, Dict[str, Any]] = {}
    queried_regions: set = set()

    for sub, regions in sorted(sub_regions.items()):
        for loc in sorted(regions):
            try:
                client = clients.get(sub)
                if client is None:
                    client = ComputeManagementClient(cred, sub)
                    clients[sub] = client
                usages = list(client.usage.list(loc))
            except Exception as exc:
                logger.debug("quota: usage.list failed for %s/%s: %s", sub, loc, exc)
                continue
            queried_regions.add(loc)
            for u in usages:
                try:
                    current = int(float(u.current_value or 0))
                    limit = int(float(u.limit or 0))
                    name = getattr(u.name, "localized_value", None) or getattr(u.name, "value", "") or ""
                except Exception:
                    continue
                if not name:
                    continue
                lname = name.lower()
                cat = _classify_quota(lname)
                if cat == "other":
                    continue  # skip non-compute-capacity quotas (e.g. images, snapshots)
                pct = round(current / limit * 100, 1) if limit else 0.0
                headroom = (limit - current) if limit else 0
                blocked = (limit == 0)
                item = {
                    "subscription_id": sub,
                    "region": loc,
                    "quota": name,
                    "family": _family_short(name) if cat == "vm_family" else "",
                    "category": cat,
                    "current": current,
                    "limit": limit,
                    "usage_pct": pct,
                    "headroom": headroom,
                    "blocked": blocked,
                    "near_limit": bool(limit and pct >= _WARN_PCT),
                }
                result["items"].append(item)
                if item["near_limit"]:
                    result["near_limit"].append(item)
                if blocked:
                    result["blocked"].append(item)
                # Per-region vCPU rollup uses the regional-total line
                if cat == "regional_vcpu":
                    rk = (sub, loc)
                    roll = region_roll.setdefault(rk, {"subscription_id": sub, "region": loc,
                                                        "vcpu_used": 0, "vcpu_limit": 0,
                                                        "blocked_families": 0, "near_limit": 0})
                    roll["vcpu_used"] = current
                    roll["vcpu_limit"] = limit

    # Fill per-region blocked/near-limit family counts
    for it in result["items"]:
        rk = (it["subscription_id"], it["region"])
        if rk not in region_roll:
            region_roll[rk] = {"subscription_id": it["subscription_id"], "region": it["region"],
                               "vcpu_used": 0, "vcpu_limit": 0, "blocked_families": 0, "near_limit": 0}
        if it["category"] == "vm_family":
            if it["blocked"]:
                region_roll[rk]["blocked_families"] += 1
            if it["near_limit"]:
                region_roll[rk]["near_limit"] += 1

    for roll in region_roll.values():
        roll["vcpu_pct"] = round(roll["vcpu_used"] / roll["vcpu_limit"] * 100, 1) if roll["vcpu_limit"] else 0.0
        roll["is_strategic"] = roll["region"] in strategic
        result["regions_summary"].append(roll)

    result["regions_summary"].sort(key=lambda x: (-x["vcpu_pct"], -x["blocked_families"]))
    result["items"].sort(key=lambda x: (not x["blocked"], -x["usage_pct"]))
    result["near_limit"].sort(key=lambda x: -x["usage_pct"])
    result["blocked"].sort(key=lambda x: (x["region"], x["quota"]))

    result["regions"] = len(queried_regions)
    result["total_quotas"] = len(result["items"])
    result["near_limit_count"] = len(result["near_limit"])
    result["blocked_count"] = len(result["blocked"])
    result["total_vcpu_used"] = sum(r["vcpu_used"] for r in result["regions_summary"])
    result["total_vcpu_limit"] = sum(r["vcpu_limit"] for r in result["regions_summary"])
    result["vcpu_headroom"] = result["total_vcpu_limit"] - result["total_vcpu_used"]

    if not result["items"]:
        result["note"] = ("No compute quota data returned. The subscriptions may not be registered for "
                          "Microsoft.Compute in the in-scope regions, or the credential lacks reader access.")
    return result
