"""
BCDR Enhanced Service — Business Impact Analysis & Recovery Sequence Planner
=============================================================================
Adds two enterprise BCDR capabilities on top of the existing BCDR assessment:

1. Business Impact Analysis (BIA)
   - Classifies every resource into a criticality tier (Mission-Critical → Low)
   - Computes impact scores based on resource type, cost, dependencies, tier
   - Calculates downtime cost estimates per tier
   - Produces a BIA matrix suitable for executive reporting

2. Recovery Sequence Planner
   - Builds dependency graph from resource relationships
   - Computes dependency-aware recovery ordering (topological sort)
   - Groups into recovery waves (tiers of parallel-recoverable resources)
   - Produces estimated recovery timeline with cumulative RTO
"""

from __future__ import annotations
import logging
from typing import Any
from collections import defaultdict

logger = logging.getLogger(__name__)

# ── BIA criticality weights by resource type prefix ──────────────────────────
_CRITICALITY_WEIGHTS: dict[str, int] = {
    "microsoft.sql/servers":                  90,
    "microsoft.dbforpostgresql":              88,
    "microsoft.dbformysql":                   88,
    "microsoft.documentdb/databaseaccounts":  92,
    "microsoft.cache/redis":                  75,
    "microsoft.keyvault/vaults":              95,
    "microsoft.containerservice":             85,
    "microsoft.app/containerapps":            80,
    "microsoft.web/sites":                    78,
    "microsoft.compute/virtualmachines":      70,
    "microsoft.compute/virtualmachinescalesets": 72,
    "microsoft.network/applicationgateways":  82,
    "microsoft.network/azurefirewalls":       88,
    "microsoft.network/loadbalancers":        76,
    "microsoft.network/virtualnetworkgateways": 84,
    "microsoft.storage/storageaccounts":      65,
    "microsoft.recoveryservices/vaults":      60,
    "microsoft.apimanagement/service":        80,
    "microsoft.servicebus/namespaces":        78,
    "microsoft.eventhub/namespaces":          76,
    "microsoft.cognitiveservices/accounts":   70,
    "microsoft.search/searchservices":        72,
}

# Default RTO hours by tier
_TIER_RTO_HOURS = {
    "Mission-Critical": 0.25,
    "Business-Critical": 1.0,
    "Business-Operational": 4.0,
    "Low": 24.0,
}

# Downtime cost multiplier (fictional $/hour per impact score point)
_DOWNTIME_COST_PER_POINT = 50.0


def _rt(r: dict) -> str:
    return (r.get("resource_type") or r.get("type") or "").lower()


def _attr(r: dict, key: str, default=""):
    return r.get(key, default) or default


def _monthly_cost(r: dict) -> float:
    return float(r.get("monthly_cost", 0) or r.get("cost", 0) or 0)


def _resource_weight(rtype: str) -> int:
    """Return criticality weight for a resource type (0-100)."""
    for prefix, w in _CRITICALITY_WEIGHTS.items():
        if rtype.startswith(prefix):
            return w
    return 40  # baseline for unknown types


def _tier_label(score: int) -> str:
    if score >= 85:
        return "Mission-Critical"
    if score >= 65:
        return "Business-Critical"
    if score >= 40:
        return "Business-Operational"
    return "Low"


# ═════════════════════════════════════════════════════════════════════════════
# 1. Business Impact Analysis
# ═════════════════════════════════════════════════════════════════════════════

def build_business_impact_analysis(
    resources: list[dict],
    bcdr_assessments: list | None = None,
) -> dict[str, Any]:
    """
    Produce a Business Impact Analysis for every resource.

    Returns:
        {
          "total_resources": int,
          "tier_summary": [ {tier, count, pct, avg_impact, est_downtime_cost_hr} ],
          "impact_matrix": [ {resource_id, resource_name, resource_type, ..., impact_score, bia_tier, ...} ],
          "top_critical": [...top 10...],
          "dependency_count": int,
        }
    """
    if not resources:
        return {
            "total_resources": 0,
            "tier_summary": [],
            "impact_matrix": [],
            "top_critical": [],
            "dependency_count": 0,
        }

    # Build quick lookup for BCDR assessment data
    bcdr_map: dict[str, dict] = {}
    for a in (bcdr_assessments or []):
        rid = a.resource_id if hasattr(a, "resource_id") else a.get("resource_id", "")
        bcdr_map[rid] = a if isinstance(a, dict) else (a.to_dict() if hasattr(a, "to_dict") else {})

    matrix: list[dict] = []

    for r in resources:
        rid   = _attr(r, "resource_id")
        rtype = _rt(r)
        rname = _attr(r, "resource_name")
        rg    = _attr(r, "resource_group")
        loc   = _attr(r, "location")
        cost  = _monthly_cost(r)

        # Base weight from resource type
        type_weight = _resource_weight(rtype)

        # Cost weight: higher cost = higher business impact
        cost_weight = min(int(cost / 50), 30)  # max 30 extra pts

        # Tier weight from BCDR assessment
        bcdr = bcdr_map.get(rid, {})
        tier_str = bcdr.get("workload_tier", "Unknown")
        tier_boost = {"Production": 20, "Non-Production": 5, "Dev/Test": -10, "Sandbox": -20}.get(tier_str, 0)

        # Zone risk penalty
        zone_risk = bcdr.get("zone_risk_score", 0)
        risk_penalty = min(int(zone_risk / 10), 10)  # up to 10 extra pts

        # Compute impact score (clamped 0-100)
        raw_score = type_weight + cost_weight + tier_boost + risk_penalty
        impact_score = max(0, min(100, raw_score))

        bia_tier = _tier_label(impact_score)
        target_rto = _TIER_RTO_HOURS.get(bia_tier, 24.0)
        downtime_cost_hr = round(impact_score * _DOWNTIME_COST_PER_POINT, 2)

        matrix.append({
            "resource_id":      rid,
            "resource_name":    rname,
            "resource_type":    rtype,
            "resource_group":   rg,
            "location":         loc,
            "monthly_cost":     round(cost, 2),
            "workload_tier":    tier_str,
            "zone_status":      bcdr.get("zone_status", "Unknown"),
            "impact_score":     impact_score,
            "bia_tier":         bia_tier,
            "target_rto_hours": target_rto,
            "downtime_cost_hr": downtime_cost_hr,
            "type_weight":      type_weight,
            "cost_weight":      cost_weight,
            "tier_boost":       tier_boost,
            "risk_penalty":     risk_penalty,
        })

    # Sort by impact score descending
    matrix.sort(key=lambda x: x["impact_score"], reverse=True)

    # Tier summary
    tier_counts: dict[str, list] = defaultdict(list)
    for m in matrix:
        tier_counts[m["bia_tier"]].append(m)

    tier_order = ["Mission-Critical", "Business-Critical", "Business-Operational", "Low"]
    tier_summary = []
    for tier in tier_order:
        items = tier_counts.get(tier, [])
        if not items:
            continue
        avg_impact = round(sum(i["impact_score"] for i in items) / len(items), 1)
        avg_downtime = round(sum(i["downtime_cost_hr"] for i in items) / len(items), 2)
        tier_summary.append({
            "tier":                 tier,
            "count":                len(items),
            "pct":                  round(len(items) / len(matrix) * 100, 1),
            "avg_impact_score":     avg_impact,
            "est_downtime_cost_hr": avg_downtime,
            "target_rto_hours":     _TIER_RTO_HOURS.get(tier, 24.0),
        })

    return {
        "total_resources": len(matrix),
        "tier_summary":    tier_summary,
        "impact_matrix":   matrix[:200],  # cap for API response size
        "top_critical":    matrix[:10],
        "dependency_count": 0,
    }


# ═════════════════════════════════════════════════════════════════════════════
# 2. Recovery Sequence Planner
# ═════════════════════════════════════════════════════════════════════════════

# Implicit dependency rules: "resource type A depends on B"
_DEPENDENCY_RULES: list[tuple[str, str]] = [
    # Apps depend on databases
    ("microsoft.web/sites",                          "microsoft.sql/servers"),
    ("microsoft.web/sites",                          "microsoft.dbforpostgresql"),
    ("microsoft.web/sites",                          "microsoft.dbformysql"),
    ("microsoft.web/sites",                          "microsoft.documentdb/databaseaccounts"),
    ("microsoft.web/sites",                          "microsoft.cache/redis"),
    ("microsoft.web/sites",                          "microsoft.storage/storageaccounts"),
    ("microsoft.app/containerapps",                  "microsoft.sql/servers"),
    ("microsoft.app/containerapps",                  "microsoft.dbforpostgresql"),
    ("microsoft.app/containerapps",                  "microsoft.documentdb/databaseaccounts"),
    ("microsoft.app/containerapps",                  "microsoft.storage/storageaccounts"),
    ("microsoft.containerservice/managedclusters",   "microsoft.sql/servers"),
    ("microsoft.containerservice/managedclusters",   "microsoft.dbforpostgresql"),
    ("microsoft.containerservice/managedclusters",   "microsoft.storage/storageaccounts"),
    # Databases depend on networking & key vault
    ("microsoft.sql/servers",                        "microsoft.keyvault/vaults"),
    ("microsoft.dbforpostgresql",                    "microsoft.keyvault/vaults"),
    ("microsoft.documentdb/databaseaccounts",        "microsoft.keyvault/vaults"),
    # Apps depend on Key Vault
    ("microsoft.web/sites",                          "microsoft.keyvault/vaults"),
    ("microsoft.app/containerapps",                  "microsoft.keyvault/vaults"),
    # Load balancers & gateways depend on compute
    ("microsoft.network/loadbalancers",              "microsoft.compute/virtualmachines"),
    ("microsoft.network/applicationgateways",        "microsoft.web/sites"),
    ("microsoft.network/applicationgateways",        "microsoft.compute/virtualmachines"),
    # API Management depends on backends
    ("microsoft.apimanagement/service",              "microsoft.web/sites"),
    ("microsoft.apimanagement/service",              "microsoft.app/containerapps"),
    # Messaging depends on storage
    ("microsoft.servicebus/namespaces",              "microsoft.storage/storageaccounts"),
    ("microsoft.eventhub/namespaces",                "microsoft.storage/storageaccounts"),
]


def _match_type(rtype: str, pattern: str) -> bool:
    """Check if resource type starts with the dependency pattern."""
    return rtype.startswith(pattern)


def _build_dependency_edges(resources: list[dict]) -> list[tuple[str, str]]:
    """
    Build dependency edges (dependent_id, dependency_id) using:
    1. Resource group co-location + type-based rules
    2. Implicit type dependency rules
    """
    # Group resources by resource_group
    rg_groups: dict[str, list[dict]] = defaultdict(list)
    for r in resources:
        rg = _attr(r, "resource_group").lower()
        rg_groups[rg].append(r)

    edges: list[tuple[str, str]] = []
    seen = set()

    for rg, rg_resources in rg_groups.items():
        for r1 in rg_resources:
            r1_type = _rt(r1)
            r1_id = _attr(r1, "resource_id")
            for r2 in rg_resources:
                r2_type = _rt(r2)
                r2_id = _attr(r2, "resource_id")
                if r1_id == r2_id:
                    continue
                # Check dependency rules
                for dep_type, prereq_type in _DEPENDENCY_RULES:
                    if _match_type(r1_type, dep_type) and _match_type(r2_type, prereq_type):
                        edge = (r1_id, r2_id)
                        if edge not in seen:
                            seen.add(edge)
                            edges.append(edge)

    return edges


def _topological_sort_waves(
    resource_ids: set[str],
    edges: list[tuple[str, str]],
) -> list[list[str]]:
    """
    Topological sort into waves (layers). Resources with no unresolved
    dependencies go in the earliest wave. This yields a valid recovery order
    where each wave can be recovered in parallel.
    """
    # Build adjacency
    in_degree: dict[str, int] = {rid: 0 for rid in resource_ids}
    dependents: dict[str, list[str]] = defaultdict(list)  # prereq -> [dependents]

    for dep_id, prereq_id in edges:
        if dep_id in resource_ids and prereq_id in resource_ids:
            in_degree[dep_id] = in_degree.get(dep_id, 0) + 1
            dependents[prereq_id].append(dep_id)

    waves: list[list[str]] = []
    remaining = set(resource_ids)

    while remaining:
        # Current wave: all with in_degree == 0
        wave = [rid for rid in remaining if in_degree.get(rid, 0) == 0]
        if not wave:
            # Cycle detected — put all remaining in one wave
            wave = list(remaining)
        waves.append(sorted(wave))
        for rid in wave:
            remaining.discard(rid)
            for dep_id in dependents.get(rid, []):
                in_degree[dep_id] = max(0, in_degree[dep_id] - 1)

    return waves


def build_recovery_sequence_plan(
    resources: list[dict],
    bcdr_assessments: list | None = None,
) -> dict[str, Any]:
    """
    Build a dependency-aware recovery sequence plan.

    Returns:
        {
          "total_resources": int,
          "total_dependencies": int,
          "waves": [
            {
              "wave": 1,
              "label": "Foundation — Networking & Identity",
              "resources": [...],
              "parallel_recoverable": true,
              "estimated_rto_hours": 0.5,
              "cumulative_rto_hours": 0.5,
            }, ...
          ],
          "dependency_edges": [ {from, to, reason} ],
          "critical_path": [...resource IDs on longest chain...],
          "total_estimated_rto_hours": float,
        }
    """
    if not resources:
        return {
            "total_resources": 0, "total_dependencies": 0,
            "waves": [], "dependency_edges": [], "critical_path": [],
            "total_estimated_rto_hours": 0,
        }

    # Build resource lookup
    r_map: dict[str, dict] = {}
    for r in resources:
        rid = _attr(r, "resource_id")
        r_map[rid] = r

    # Build BIA for scoring
    bia = build_business_impact_analysis(resources, bcdr_assessments)
    bia_map: dict[str, dict] = {}
    for item in bia.get("impact_matrix", []):
        bia_map[item["resource_id"]] = item

    # Build dependency edges
    edges = _build_dependency_edges(resources)

    # Build edge descriptions
    edge_descriptions = []
    for dep_id, prereq_id in edges:
        dep_name = _attr(r_map.get(dep_id, {}), "resource_name")
        prereq_name = _attr(r_map.get(prereq_id, {}), "resource_name")
        edge_descriptions.append({
            "from": prereq_id,
            "from_name": prereq_name,
            "to": dep_id,
            "to_name": dep_name,
            "reason": f"{_rt(r_map.get(dep_id, {}))} depends on {_rt(r_map.get(prereq_id, {}))}",
        })

    # Topological sort into waves
    all_ids = set(r_map.keys())
    waves_ids = _topological_sort_waves(all_ids, edges)

    # Wave labels by typical content
    _WAVE_LABELS = [
        "Foundation — Networking, Identity & Key Vault",
        "Data Tier — Databases & Storage",
        "Compute — VMs, Containers & App Services",
        "Application — APIs, Load Balancers & Gateways",
        "Edge — CDN, Front Door & DNS",
    ]

    # RTO per wave based on max BIA tier in the wave
    waves_output = []
    cumulative_rto = 0.0

    for i, wave_ids in enumerate(waves_ids):
        wave_resources = []
        max_rto = 0.0
        for rid in wave_ids:
            r = r_map.get(rid, {})
            bia_entry = bia_map.get(rid, {})
            rto = bia_entry.get("target_rto_hours", 4.0)
            max_rto = max(max_rto, rto)
            wave_resources.append({
                "resource_id":    rid,
                "resource_name":  _attr(r, "resource_name"),
                "resource_type":  _rt(r),
                "resource_group": _attr(r, "resource_group"),
                "bia_tier":       bia_entry.get("bia_tier", "Unknown"),
                "impact_score":   bia_entry.get("impact_score", 0),
                "target_rto_hours": rto,
            })

        # Sort resources within wave by impact score desc
        wave_resources.sort(key=lambda x: x["impact_score"], reverse=True)
        wave_rto = round(max_rto, 2)
        cumulative_rto += wave_rto

        label = _WAVE_LABELS[i] if i < len(_WAVE_LABELS) else f"Wave {i + 1} — Additional Resources"

        waves_output.append({
            "wave":                  i + 1,
            "label":                 label,
            "resource_count":        len(wave_resources),
            "resources":             wave_resources[:50],  # cap per wave
            "parallel_recoverable":  True,
            "estimated_rto_hours":   wave_rto,
            "cumulative_rto_hours":  round(cumulative_rto, 2),
        })

    # Critical path: the chain of resources with the highest cumulative impact
    # (simplified: just the top-impact resource from each wave)
    critical_path = []
    for w in waves_output:
        if w["resources"]:
            critical_path.append(w["resources"][0]["resource_id"])

    return {
        "total_resources":          len(resources),
        "total_dependencies":       len(edges),
        "waves":                    waves_output,
        "dependency_edges":         edge_descriptions[:100],  # cap
        "critical_path":            critical_path,
        "total_estimated_rto_hours": round(cumulative_rto, 2),
    }
