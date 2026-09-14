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

# ── Downtime-cost grounding (REALITY-anchored, not a fictional score multiple) ──
# An estimated $/hr downtime cost is derived from the resource's ACTUAL Azure
# run-rate, never from an abstract impact score: hourly_spend = monthly_cost / 730,
# then estimated_loss = max(tier floor, hourly_spend × tier multiplier). This keeps a
# cheap test resource from ever showing an enterprise-scale loss it could not plausibly
# cause, while a genuinely expensive workload scales up. A customer-stated
# financial_loss_per_hour always overrides this estimate.
_TIER_COST_MULT: dict[str, float] = {
    "Mission-Critical": 50.0, "Business-Critical": 20.0, "Business-Operational": 5.0, "Low": 2.0,
}
_TIER_HOURLY_FLOOR: dict[str, float] = {
    "Mission-Critical": 250.0, "Business-Critical": 50.0, "Business-Operational": 5.0, "Low": 0.0,
}
# Expected ANNUAL outage hours per tier — a realistic availability budget (a few hours
# a year), NOT a full year of downtime. Used for annualized exposure so nothing is
# multiplied by 8,760 hours.
_TIER_ANNUAL_DT_HRS: dict[str, float] = {
    "Mission-Critical": 8.0, "Business-Critical": 4.0, "Business-Operational": 2.0, "Low": 1.0,
}
# Posture reduces expected outage: real backup + zone redundancy shrink the expected
# annual downtime (and therefore the annualized exposure).
_POSTURE_FACTOR: dict[str, float] = {"backup+zone": 0.25, "backup": 0.50, "none": 1.00}


def _rt(r: dict) -> str:
    return (r.get("resource_type") or r.get("type") or "").lower()


def _attr(r: dict, key: str, default=""):
    return r.get(key, default) or default


def _monthly_cost(r: dict) -> float:
    # The live resource schema (ResourceMetrics) carries the ACTUAL billed monthly cost in
    # `cost_current_month` (from Azure Cost Management — already SKU- and region-accurate for
    # the resource's real usage/region). Earlier keys are kept only as fallbacks.
    return float(
        r.get("cost_current_month")
        or r.get("monthly_cost")
        or r.get("cost")
        or 0
    )


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


# ── User-tagged BCDR criticality → authoritative BIA tier ────────────────────
# Maps a BCDR Planning "criticality" value (as the customer tagged it on the
# resource) to the canonical BIA tier plus an anchor impact score. A tagged value
# is AUTHORITATIVE business intent and overrides the type/cost inference — up OR
# down (a resource the customer marks "Low" is demoted even if it is an expensive
# database, and one marked "Critical" is promoted even if its type looks minor).
_CRIT_TIER: dict[str, tuple[str, int]] = {
    "mission critical": ("Mission-Critical", 95), "mission-critical": ("Mission-Critical", 95),
    "missioncritical": ("Mission-Critical", 95), "critical": ("Mission-Critical", 92),
    "tier 0": ("Mission-Critical", 96), "tier0": ("Mission-Critical", 96), "tier 1": ("Mission-Critical", 90),
    "business critical": ("Business-Critical", 78), "business-critical": ("Business-Critical", 78),
    "high": ("Business-Critical", 75), "important": ("Business-Critical", 72), "tier 2": ("Business-Critical", 72),
    "medium": ("Business-Operational", 52), "moderate": ("Business-Operational", 52),
    "business operational": ("Business-Operational", 52), "business-operational": ("Business-Operational", 52),
    "standard": ("Business-Operational", 50), "normal": ("Business-Operational", 50), "tier 3": ("Business-Operational", 50),
    "low": ("Low", 28), "tier 4": ("Low", 25), "best effort": ("Low", 22), "non-critical": ("Low", 22),
    "noncritical": ("Low", 22), "dev/test": ("Low", 20), "dev": ("Low", 20),
}
_TIER_BAND: dict[str, tuple[int, int]] = {
    "Mission-Critical": (85, 100), "Business-Critical": (65, 84),
    "Business-Operational": (40, 64), "Low": (0, 39),
}

# RTO/RPO label → hours (matches the BCDR Planning dropdown options)
_RTO_LABEL_HOURS: dict[str, float] = {
    "< 15 min": 0.25, "<15 min": 0.25, "< 1 hr": 1.0, "<1 hr": 1.0, "< 4 hrs": 4.0, "<4 hrs": 4.0,
    "< 8 hrs": 8.0, "<8 hrs": 8.0, "< 24 hrs": 24.0, "<24 hrs": 24.0, "< 48 hrs": 48.0, "best effort": 72.0,
}


def _parse_rto_hours(label: str):
    """Parse an RTO/RPO label ('< 4 hrs', '30 min', '2 hours') to a float of hours, or None."""
    if not label:
        return None
    key = str(label).strip().lower()
    if key in _RTO_LABEL_HOURS:
        return _RTO_LABEL_HOURS[key]
    import re as _re
    m = _re.search(r"(\d+(?:\.\d+)?)\s*(min|hour|hr|day)", key)
    if m:
        n = float(m.group(1)); unit = m.group(2)
        if unit.startswith("min"):
            return round(n / 60, 3)
        if unit.startswith("day"):
            return n * 24
        return n
    return None


def _parse_money(val):
    """Parse a stated financial-loss value ('$5,000', '5000/hr', '12k') to a float, or None."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip().lower().replace(",", "").replace("$", "").replace("usd", "").strip()
    if not s:
        return None
    import re as _re
    mult = 1.0
    if s.endswith("k"):
        mult = 1_000.0; s = s[:-1]
    elif s.endswith("m"):
        mult = 1_000_000.0; s = s[:-1]
    m = _re.search(r"\d+(?:\.\d+)?", s)
    if not m:
        return None
    try:
        return float(m.group(0)) * mult
    except ValueError:
        return None


# ═════════════════════════════════════════════════════════════════════════════
# 1. Business Impact Analysis
# ═════════════════════════════════════════════════════════════════════════════

def build_business_impact_analysis(
    resources: list[dict],
    bcdr_assessments: list | None = None,
    metadata: dict | None = None,
    custom_tags: dict | None = None,
    sub_names: dict | None = None,
) -> dict[str, Any]:
    """
    Produce a Business Impact Analysis for every resource.

    When BCDR Planning ``metadata`` is supplied, the customer-tagged values
    (criticality, RTO/RPO target, financial loss per hour) are treated as
    AUTHORITATIVE and drive the BIA tier, target RTO and downtime cost — so the
    analysis reflects the business's stated intent rather than a type/cost guess.
    Resources without tags fall back to the inferred score.
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

    # BCDR Planning metadata (criticality / DR tier / RTO / RPO / financial loss) —
    # AUTHORITATIVE business intent the customer tagged in Phase-1. Keyed by id with
    # a lowercase fallback to survive any id case drift.
    meta_map: dict[str, dict] = {}
    for k, v in (metadata or {}).items():
        if not isinstance(v, dict):
            continue
        meta_map[k] = v
        meta_map.setdefault((k or "").lower(), v)

    tagged_count = 0
    stated_downtime_count = 0
    total_stated_downtime = 0.0

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

        # Inferred score from type + cost + workload tier + zone risk
        inferred_score = max(0, min(100, type_weight + cost_weight + tier_boost + risk_penalty))

        # ── Authoritative override from the customer's BCDR Planning tags ──────
        meta = meta_map.get(rid) or meta_map.get((rid or "").lower()) or {}
        crit_tag = (meta.get("criticality") or "").strip()
        mapped = _CRIT_TIER.get(crit_tag.lower()) if crit_tag else None
        if mapped:
            bia_tier, anchor = mapped
            lo, hi = _TIER_BAND[bia_tier]
            # Keep the score inside the tagged tier's band; cost/risk give intra-band ordering.
            impact_score = int(max(lo, min(hi, anchor + cost_weight * 0.3 + risk_penalty * 0.4)))
            criticality_source = "Tagged"
            tagged_count += 1
        else:
            impact_score = inferred_score
            bia_tier = _tier_label(impact_score)
            criticality_source = "Inferred"

        # Target RTO — prefer the tagged value, else the tier default
        rto_tag = (meta.get("rto_target") or "").strip()
        rpo_tag = (meta.get("rpo_target") or "").strip()
        parsed_rto = _parse_rto_hours(rto_tag) if rto_tag else None
        target_rto = parsed_rto if parsed_rto is not None else _TIER_RTO_HOURS.get(bia_tier, 24.0)
        rto_source = "Tagged" if parsed_rto is not None else "Tier default"

        # Downtime cost — prefer the customer's stated financial loss per hour, else
        # GROUND an estimate on the resource's actual Azure run-rate (never a score
        # multiple): hourly_spend × tier multiplier, floored per tier. Conservative so a
        # cheap/test resource cannot show an enterprise-scale loss it could not cause.
        stated_loss = _parse_money(meta.get("financial_loss_per_hour"))
        if stated_loss is not None and stated_loss > 0:
            downtime_cost_hr = round(stated_loss, 2)
            downtime_cost_source = "Stated"
            stated_downtime_count += 1
            total_stated_downtime += stated_loss
        else:
            hourly_spend = cost / 730.0
            mult = _TIER_COST_MULT.get(bia_tier, 5.0)
            floor = _TIER_HOURLY_FLOOR.get(bia_tier, 5.0)
            downtime_cost_hr = round(max(floor, hourly_spend * mult), 2)
            downtime_cost_source = "Estimated"

        matrix.append({
            "resource_id":          rid,
            "resource_name":        rname,
            "resource_type":        rtype,
            "resource_group":       rg,
            "location":             loc,
            "subscription_id":      _attr(r, "subscription_id"),
            "subscription_name":    (sub_names or {}).get(_attr(r, "subscription_id"), ""),
            "azure_tags":           (r.get("tags") or {}),
            "custom_tags":          (custom_tags or {}).get((rid or "").lower(), {}),
            "monthly_cost":         round(cost, 2),
            "workload_tier":        tier_str,
            "zone_status":          bcdr.get("zone_status", "Unknown"),
            "impact_score":         impact_score,
            "bia_tier":             bia_tier,
            "criticality_source":   criticality_source,
            "criticality_tag":      crit_tag or None,
            "dr_tier":              (meta.get("dr_tier") or None),
            "rto_target":           rto_tag or None,
            "rpo_target":           rpo_tag or None,
            "rto_source":           rto_source,
            "data_classification":  (meta.get("data_classification") or None),
            "compliance":           (meta.get("compliance") or None),
            "business_owner":       (meta.get("business_owner") or None),
            "target_rto_hours":     target_rto,
            "downtime_cost_hr":     downtime_cost_hr,
            "downtime_cost_source": downtime_cost_source,
            "inferred_score":       inferred_score,
            "type_weight":          type_weight,
            "cost_weight":          cost_weight,
            "tier_boost":           tier_boost,
            "risk_penalty":         risk_penalty,
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
        "total_resources":  len(matrix),
        "tier_summary":     tier_summary,
        "impact_matrix":    matrix[:5000],  # full set (client filters + recomputes the BIA per selection)
        "top_critical":     matrix[:10],
        "dependency_count": 0,
        # Grounding signals — how much of the BIA is driven by the customer's tags
        "tagged_count":                  tagged_count,
        "tagged_pct":                    round(tagged_count / len(matrix) * 100, 1) if matrix else 0,
        "stated_downtime_count":         stated_downtime_count,
        "total_stated_downtime_cost_hr": round(total_stated_downtime, 2),
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

    # Wave categorisation — these short labels (in priority order) are matched against the
    # resource types in each wave to derive a label like "Foundation (network · identity)"
    # so the label always reflects what is actually in the wave (not a fixed template).
    _WAVE_CATEGORIES: list[tuple[str, list[str]]] = [
        ("network",   ["microsoft.network/"]),
        ("identity",  ["microsoft.keyvault/", "microsoft.managedidentity/", "microsoft.authorization/"]),
        ("data",      ["microsoft.sql/", "microsoft.dbforpostgresql", "microsoft.dbformysql", "microsoft.dbformariadb",
                        "microsoft.documentdb/", "microsoft.cache/redis", "microsoft.storage/storageaccounts",
                        "microsoft.dataprotection/", "microsoft.recoveryservices/", "microsoft.azurearcdata/"]),
        ("compute",   ["microsoft.compute/", "microsoft.containerservice/", "microsoft.app/",
                        "microsoft.containerregistry/", "microsoft.hybridcompute/", "microsoft.azurestackhci/"]),
        ("app",       ["microsoft.web/", "microsoft.apimanagement/"]),
        ("messaging", ["microsoft.servicebus/", "microsoft.eventhub/", "microsoft.eventgrid/"]),
        ("edge",      ["microsoft.cdn/", "microsoft.frontdoor", "microsoft.network/frontdoors",
                        "microsoft.network/dnszones", "microsoft.network/trafficmanagerprofiles"]),
        ("monitor",   ["microsoft.insights/", "microsoft.operationalinsights/", "microsoft.monitor/"]),
    ]
    _WAVE_THEME_NAMES = {
        ("network", "identity"): "Foundation",
        ("network",):            "Networking",
        ("identity",):           "Identity & Secrets",
        ("data",):               "Data Tier",
        ("compute",):            "Compute",
        ("app",):                "Application",
        ("messaging",):          "Messaging",
        ("edge",):               "Edge & DNS",
        ("monitor",):            "Observability",
    }

    def _categorise_wave(wave_resources: list[dict]) -> tuple[str, list[tuple[str, int]]]:
        """Return (theme_label, [(category, count), …]) so the wave label is always grounded
        on what's actually in the wave. Resources that match nothing land in 'other'."""
        counts: dict[str, int] = {}
        for r in wave_resources:
            rtype = (r.get("resource_type") or "").lower()
            matched = False
            for cat, prefixes in _WAVE_CATEGORIES:
                if any(rtype.startswith(p) for p in prefixes):
                    counts[cat] = counts.get(cat, 0) + 1
                    matched = True
                    break
            if not matched:
                counts["other"] = counts.get("other", 0) + 1
        ranked = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
        top_cats = tuple(c for c, _ in ranked[:2] if c != "other")
        theme = _WAVE_THEME_NAMES.get(top_cats) or _WAVE_THEME_NAMES.get(top_cats[:1]) if top_cats else "Mixed"
        if not theme:
            theme = top_cats[0].title() if top_cats else "Mixed"
        return theme, ranked

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

        # Derive a human label from what's actually IN the wave rather than a fixed template,
        # then append a short breakdown so the user knows why this wave got that label.
        theme, ranked = _categorise_wave(wave_resources)
        _CAT_HUMAN = {
            "network":   "network",   "identity": "identity",
            "data":      "data",      "compute":  "compute",
            "app":       "app",       "messaging": "messaging",
            "edge":      "edge",      "monitor":  "observability",
            "other":     "other",
        }
        breakdown_bits = [f"{n} {_CAT_HUMAN.get(c, c)}" for c, n in ranked[:3] if n > 0]
        label = f"Wave {i + 1} — {theme}"
        if breakdown_bits:
            label += f" ({' · '.join(breakdown_bits)})"

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
