"""
BCDR Assessment Service
=======================
Ports the logic from Phase1-CollectResources.ps1:
- Zone redundancy assessment per resource type
- Azure paired region lookup (Qatar Central = no paired region)
- Cross-region DR readiness flags
- Criticality / workload tier classification

Qatar Central context:
 - NO zone redundancy available (capacity restricted)
 - NO Azure paired region
 - NO GRS storage support (use Object Replication)
 - DR targets: UAE North, West Europe, North Europe (NIA-certified)
"""

from __future__ import annotations
import re
import logging
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field, asdict

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Azure paired region map (ported from $AzurePairedRegions in Phase1)
# ---------------------------------------------------------------------------
AZURE_PAIRED_REGIONS: dict[str, dict] = {
    # Americas
    "eastus":          {"paired": "westus",          "geo": "United States"},
    "eastus2":         {"paired": "centralus",        "geo": "United States"},
    "westus":          {"paired": "eastus",           "geo": "United States"},
    "westus2":         {"paired": "westcentralus",    "geo": "United States"},
    "westus3":         {"paired": "eastus",           "geo": "United States"},
    "centralus":       {"paired": "eastus2",          "geo": "United States"},
    "northcentralus":  {"paired": "southcentralus",   "geo": "United States"},
    "southcentralus":  {"paired": "northcentralus",   "geo": "United States"},
    "westcentralus":   {"paired": "westus2",          "geo": "United States"},
    "canadacentral":   {"paired": "canadaeast",       "geo": "Canada"},
    "canadaeast":      {"paired": "canadacentral",    "geo": "Canada"},
    "brazilsouth":     {"paired": "southcentralus",   "geo": "Brazil"},
    "brazilsoutheast": {"paired": "brazilsouth",      "geo": "Brazil"},
    # Europe
    "northeurope":         {"paired": "westeurope",        "geo": "Europe"},
    "westeurope":          {"paired": "northeurope",       "geo": "Europe"},
    "uksouth":             {"paired": "ukwest",            "geo": "UK"},
    "ukwest":              {"paired": "uksouth",           "geo": "UK"},
    "francecentral":       {"paired": "francesouth",       "geo": "France"},
    "francesouth":         {"paired": "francecentral",     "geo": "France"},
    "germanywestcentral":  {"paired": "germanynorth",      "geo": "Germany"},
    "germanynorth":        {"paired": "germanywestcentral","geo": "Germany"},
    "switzerlandnorth":    {"paired": "switzerlandwest",   "geo": "Switzerland"},
    "switzerlandwest":     {"paired": "switzerlandnorth",  "geo": "Switzerland"},
    "norwayeast":          {"paired": "norwaywest",        "geo": "Norway"},
    "norwaywest":          {"paired": "norwayeast",        "geo": "Norway"},
    "swedencentral":       {"paired": "swedensouth",       "geo": "Sweden"},
    "swedensouth":         {"paired": "swedencentral",     "geo": "Sweden"},
    # Middle East
    "uaenorth":     {"paired": "uaecentral",  "geo": "UAE"},
    "uaecentral":   {"paired": "uaenorth",    "geo": "UAE"},
    "qatarcentral": {"paired": None,
                     "geo": "Qatar",
                     "note": "No paired region. Zone redundancy DISABLED (capacity restricted). "
                             "DR planning required to UAE North, West Europe, or North Europe."},
    "israelcentral": {"paired": "italynorth", "geo": "Israel"},
    # Asia Pacific
    "eastasia":           {"paired": "southeastasia",    "geo": "Asia Pacific"},
    "southeastasia":      {"paired": "eastasia",         "geo": "Asia Pacific"},
    "australiaeast":      {"paired": "australiasoutheast","geo": "Australia"},
    "australiasoutheast": {"paired": "australiaeast",    "geo": "Australia"},
    "japaneast":          {"paired": "japanwest",        "geo": "Japan"},
    "japanwest":          {"paired": "japaneast",        "geo": "Japan"},
    "koreacentral":       {"paired": "koreasouth",       "geo": "Korea"},
    "koreasouth":         {"paired": "koreacentral",     "geo": "Korea"},
    "centralindia":       {"paired": "southindia",       "geo": "India"},
    "southindia":         {"paired": "centralindia",     "geo": "India"},
    "southafricanorth":   {"paired": "southafricawest",  "geo": "South Africa"},
    "southafricawest":    {"paired": "southafricanorth", "geo": "South Africa"},
}

# Zone-aware resource types (ported from $ZoneAwareResourceTypes in Phase1)
ZONE_AWARE_TYPES: dict[str, dict] = {
    # Compute
    "microsoft.compute/virtualmachines":        {"redundancy_type": "Zonal",      "zone_property": "zones", "single_zone_only": True},
    "microsoft.compute/virtualmachinescalesets":{"redundancy_type": "ZoneSpread",  "zone_property": "zones"},
    "microsoft.compute/disks":                   {"redundancy_type": "SKU-Based",  "sku_pattern": r"ZRS$"},
    "microsoft.compute/availabilitysets":        {"redundancy_type": "Default",    "default": "LocallyRedundant"},
    # Storage
    "microsoft.storage/storageaccounts":         {"redundancy_type": "SKU-Based",  "sku_pattern": r"ZRS|GZRS|RAGZRS",
                                                  "geo_pattern": r"GRS|RAGRS|GZRS|RAGZRS"},
    # Networking
    "microsoft.network/publicipaddresses":       {"redundancy_type": "Zonal",      "zone_property": "zones"},
    "microsoft.network/loadbalancers":           {"redundancy_type": "SKU+Zone",   "sku_name": "Standard", "zone_property": "zones"},
    "microsoft.network/applicationgateways":    {"redundancy_type": "Zonal",      "zone_property": "zones"},
    "microsoft.network/azurefirewalls":         {"redundancy_type": "Zonal",      "zone_property": "zones"},
    "microsoft.network/virtualnetworkgateways": {"redundancy_type": "SKU-Based",  "sku_pattern": r"AZ$"},
    "microsoft.network/natgateways":            {"redundancy_type": "Zonal",      "zone_property": "zones", "single_zone_only": True},
    "microsoft.network/bastionhosts":           {"redundancy_type": "Zonal",      "zone_property": "zones"},
    # Databases
    "microsoft.sql/servers/databases":          {"redundancy_type": "Property-Based", "property_path": "properties.zoneRedundant"},
    "microsoft.sql/managedinstances":           {"redundancy_type": "Property-Based", "property_path": "properties.zoneRedundant"},
    "microsoft.dbforpostgresql/flexibleservers":{"redundancy_type": "Property-Based",
                                                  "property_path": "properties.highAvailability.mode",
                                                  "value_match": "ZoneRedundant"},
    "microsoft.dbformysql/flexibleservers":     {"redundancy_type": "Property-Based",
                                                  "property_path": "properties.highAvailability.mode",
                                                  "value_match": "ZoneRedundant"},
    "microsoft.documentdb/databaseaccounts":    {"redundancy_type": "Property-Based",
                                                  "property_path": "properties.locations[*].isZoneRedundant"},
    "microsoft.cache/redis":                    {"redundancy_type": "Zonal", "zone_property": "zones"},
    "microsoft.cache/redisenterprise":          {"redundancy_type": "Zonal", "zone_property": "zones"},
    # App Services
    "microsoft.web/serverfarms":                {"redundancy_type": "Property-Based",
                                                  "property_path": "properties.zoneRedundant"},
    "microsoft.web/sites":                      {"redundancy_type": "Inherited", "inherit_from": "serverFarms"},
    # Containers
    "microsoft.containerservice/managedclusters":{"redundancy_type": "Property-Based",
                                                   "property_path": "properties.agentPoolProfiles[*].availabilityZones"},
    "microsoft.containerregistry/registries":   {"redundancy_type": "Property-Based",
                                                  "property_path": "properties.zoneRedundancy",
                                                  "value_match": "Enabled"},
    "microsoft.app/containerapps":              {"redundancy_type": "Inherited", "inherit_from": "managedEnvironments"},
    "microsoft.app/managedenvironments":        {"redundancy_type": "Property-Based",
                                                  "property_path": "properties.zoneRedundant"},
    # Messaging
    "microsoft.servicebus/namespaces":          {"redundancy_type": "Property-Based",
                                                  "property_path": "properties.zoneRedundant"},
    "microsoft.eventhub/namespaces":            {"redundancy_type": "Property-Based",
                                                  "property_path": "properties.zoneRedundant"},
    "microsoft.eventgrid/domains":              {"redundancy_type": "Default",    "default": "ZoneRedundant"},
    "microsoft.eventgrid/topics":               {"redundancy_type": "Default",    "default": "ZoneRedundant"},
    "microsoft.eventgrid/systemtopics":         {"redundancy_type": "Default",    "default": "RedundantByDefault"},
    # Recovery Services
    "microsoft.recoveryservices/vaults":        {"redundancy_type": "Property-Based",
                                                  "property_path": "properties.redundancySettings.standardTierStorageRedundancy"},
    # Search & AI
    "microsoft.search/searchservices":          {"redundancy_type": "Property-Based",
                                                  "property_path": "properties.replicaCount", "min_value": 2},
    "microsoft.cognitiveservices/accounts":     {"redundancy_type": "Default", "default": "RedundantByDefault"},
    # API Management
    "microsoft.apimanagement/service":          {"redundancy_type": "SKU+Zone", "sku_name": "Premium", "zone_property": "zones"},
}

# Resources that are zone redundant by platform default (no user config needed)
ZONE_REDUNDANT_BY_DEFAULT = {
    "microsoft.network/virtualnetworks",
    "microsoft.network/networksecuritygroups",
    "microsoft.network/routetables",
    "microsoft.network/privateendpoints",
    "microsoft.network/networkinterfaces",
    "microsoft.network/dnsZones",
    "microsoft.network/privatednszones",
    "microsoft.network/trafficmanagerprofiles",
    "microsoft.network/frontdoors",
    "microsoft.cdn/profiles",
    "microsoft.logic/workflows",
    "microsoft.automation/automationaccounts",
    "microsoft.managedidentity/userassignedidentities",
    "microsoft.insights/components",
    "microsoft.operationalinsights/workspaces",
    "microsoft.keyvault/vaults",
}

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------
@dataclass
class ZoneAssessment:
    resource_id:        str
    resource_name:      str
    resource_type:      str
    resource_group:     str
    location:           str
    subscription_id:    str

    # Zone status
    zone_status:        str = "Unknown"          # ZoneRedundant | Zonal | LocallyRedundant | NotZoneAware | Unknown
    zone_detail:        str = ""                 # e.g. "zones: [1, 2, 3]" or "sku: ZRS"
    zones:              list = field(default_factory=list)

    # Cross-region
    has_paired_region:  bool = False
    paired_region:      Optional[str] = None
    paired_region_note: str = ""
    geo_redundant:      bool = False

    # Qatar-specific flags
    is_qatar_central:   bool = False
    qatar_zr_blocked:   bool = False             # True = ZR would be ideal but is blocked in QC
    recommended_dr_region: str = "UAE North"

    # Workload tier
    workload_tier:      str = "Unknown"          # Production | Non-Production | Dev/Test | Sandbox
    tier_confidence:    str = "Low"
    tier_source:        str = ""

    # Risk
    zone_risk_score:    int = 0                  # 0–100 (higher = more at risk)
    needs_dr_action:    bool = True

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Workload tier classification (ported from Get-WorkloadTier in Phase2)
# ---------------------------------------------------------------------------
_PROD_KW    = [r'\bprod\b', r'\bprod-', r'-prod-', r'-prod$', r'production', r'\bprd\b', r'\blive\b']
_SANDBOX_KW = [r'sandbox', r'\bsbx\b', r'\bpoc\b', r'proof-of-concept', r'demo', r'trial', r'playground', r'learning', r'\blab\b']
_DEVTEST_KW = [r'\bdev\b', r'development', r'\btest\b', r'testing', r'\buat\b', r'\bqa\b', r'\bstage\b', r'\bstaging\b', r'\bstg\b', r'\btst\b']
_NONPROD_KW = [r'nonprod', r'non-prod', r'nonprd', r'\bnp-', r'-np-', r'-np$']


def _matches(text: str, patterns: list[str]) -> bool:
    t = text.lower()
    return any(re.search(p, t) for p in patterns)


def classify_workload_tier(name: str, rg: str, subscription_name: str, tags: dict) -> tuple[str, str, str]:
    """Returns (tier, confidence, source) — Production | Non-Production | Dev/Test | Sandbox | Unknown"""
    # Priority 1: subscription name
    for tier, patterns in [("Sandbox", _SANDBOX_KW), ("Dev/Test", _DEVTEST_KW),
                            ("Non-Production", _NONPROD_KW), ("Production", _PROD_KW)]:
        if _matches(subscription_name, patterns):
            return tier, "High", f"Subscription: {subscription_name}"

    # Priority 2: tags
    for tag_key in ["Environment", "Env", "Tier", "Stage", "Workload", "env", "environment"]:
        val = (tags or {}).get(tag_key, "")
        if not val:
            continue
        if _matches(val, _PROD_KW):
            return "Production", "Medium", f"Tag: {tag_key}={val}"
        if _matches(val, _SANDBOX_KW):
            return "Sandbox", "Medium", f"Tag: {tag_key}={val}"
        if _matches(val, _DEVTEST_KW):
            return "Dev/Test", "Medium", f"Tag: {tag_key}={val}"
        if _matches(val, _NONPROD_KW):
            return "Non-Production", "Medium", f"Tag: {tag_key}={val}"

    # Priority 3: resource group
    for tier, patterns in [("Sandbox", _SANDBOX_KW), ("Dev/Test", _DEVTEST_KW), ("Production", _PROD_KW)]:
        if _matches(rg, patterns):
            return tier, "Low", f"Resource Group: {rg}"

    # Priority 4: resource name
    for tier, patterns in [("Dev/Test", _DEVTEST_KW), ("Production", _PROD_KW)]:
        if _matches(name, patterns):
            return tier, "Low", f"Resource Name: {name}"

    return "Unknown", "None", ""


# ---------------------------------------------------------------------------
# Zone redundancy evaluation
# ---------------------------------------------------------------------------
def _get_nested(obj: Any, path: str) -> Any:
    """Navigate a dot-separated property path with basic array support."""
    if not isinstance(obj, dict):
        return None
    parts = path.split(".")
    current = obj
    for part in parts:
        if current is None:
            return None
        if "[*]" in part:
            key = part.replace("[*]", "")
            val = current.get(key)
            if isinstance(val, list):
                return val
            return None
        current = current.get(part) if isinstance(current, dict) else None
    return current


def _assess_zone_status(resource: dict) -> tuple[str, str, list]:
    """
    Returns (zone_status, zone_detail, zones_list).
    zone_status: ZoneRedundant | Zonal | LocallyRedundant | NotZoneAware | Unknown
    """
    rtype = (resource.get("resource_type") or resource.get("type") or "").lower()
    props = resource.get("properties") or resource.get("extended_properties") or {}
    if isinstance(props, str):
        try:
            import json
            props = json.loads(props)
        except Exception:
            props = {}

    sku = resource.get("sku") or props.get("sku") or {}
    if isinstance(sku, str):
        sku = {"name": sku}
    sku_name = (sku.get("name") or sku.get("tier") or "").upper()

    raw_zones = resource.get("zones") or []
    if isinstance(raw_zones, str):
        raw_zones = [z.strip() for z in raw_zones.split(",") if z.strip()]
    elif not isinstance(raw_zones, list):
        raw_zones = []

    # Check zone-redundant by default
    if rtype in ZONE_REDUNDANT_BY_DEFAULT:
        return "ZoneRedundant", "Platform-managed (zone redundant by default)", []

    # Look up the rule for this resource type
    rule = ZONE_AWARE_TYPES.get(rtype)
    if rule is None:
        return "NotZoneAware", "Resource type not in zone-aware classification list", []

    redundancy_type = rule.get("redundancy_type", "Unknown")

    if redundancy_type == "Default":
        default_val = rule.get("default", "Unknown")
        if default_val in ("ZoneRedundant", "RedundantByDefault"):
            return "ZoneRedundant", f"Default: {default_val}", []
        return "LocallyRedundant", f"Default: {default_val}", []

    if redundancy_type == "Inherited":
        return "Unknown", "Inherits zone status from parent resource", []

    if redundancy_type == "SKU-Based":
        sku_pattern = rule.get("sku_pattern", "")
        if sku_pattern and re.search(sku_pattern, sku_name, re.IGNORECASE):
            return "ZoneRedundant", f"SKU: {sku_name}", []
        geo_pattern = rule.get("geo_pattern", "")
        if geo_pattern and re.search(geo_pattern, sku_name, re.IGNORECASE):
            return "ZoneRedundant", f"GRS SKU: {sku_name}", []
        return "LocallyRedundant", f"SKU: {sku_name or '(unknown)'}", []

    if redundancy_type in ("Zonal", "ZoneSpread", "SKU+Zone"):
        if raw_zones:
            if len(raw_zones) >= 3 or (rule.get("single_zone_only") and len(raw_zones) >= 1):
                zone_label = "ZoneRedundant" if len(raw_zones) >= 3 else "Zonal"
                return zone_label, f"zones: {raw_zones}", raw_zones
            return "Zonal", f"zones: {raw_zones}", raw_zones
        # SKU+Zone: check SKU first
        if redundancy_type == "SKU+Zone":
            req_sku = rule.get("sku_name", "")
            if req_sku and sku_name != req_sku.upper():
                return "LocallyRedundant", f"SKU {sku_name} not zone-capable (needs {req_sku})", []
        return "LocallyRedundant", "No availability zones configured", []

    if redundancy_type == "Property-Based":
        prop_path = rule.get("property_path", "")
        value_match = rule.get("value_match")
        min_value = rule.get("min_value")

        # Reconstruct full resource dict for property traversal
        full = dict(resource)
        full["properties"] = props

        val = _get_nested(full, prop_path)

        if val is None and "sku" in prop_path:
            val = _get_nested(sku, prop_path.split(".")[-1])

        if val is None:
            return "Unknown", f"Property not found: {prop_path}", []

        if isinstance(val, list):
            # e.g. Cosmos DB locations[*].isZoneRedundant
            if any(v is True or str(v).lower() == "true" for v in val):
                return "ZoneRedundant", f"{prop_path}: has zone-redundant location", []
            return "LocallyRedundant", f"{prop_path}: no zone-redundant locations", []

        if isinstance(val, bool) or str(val).lower() in ("true", "false"):
            bval = val if isinstance(val, bool) else str(val).lower() == "true"
            if value_match:
                is_match = bval == (value_match.lower() == "true") or str(val) == value_match
                return ("ZoneRedundant" if is_match else "LocallyRedundant",
                        f"{prop_path}: {val}", [])
            return ("ZoneRedundant" if bval else "LocallyRedundant", f"{prop_path}: {val}", [])

        if value_match:
            is_match = str(val).strip().lower() == value_match.lower()
            return ("ZoneRedundant" if is_match else "LocallyRedundant",
                    f"{prop_path}: {val}", [])

        if min_value is not None:
            try:
                numeric_val = int(val)
                if numeric_val >= min_value:
                    return "ZoneRedundant", f"{prop_path}: {val} (min {min_value})", []
                return "LocallyRedundant", f"{prop_path}: {val} (needs {min_value}+)", []
            except (ValueError, TypeError):
                return "Unknown", f"{prop_path}: {val} (non-numeric)", []

        return "ZoneRedundant" if val else "LocallyRedundant", f"{prop_path}: {val}", []

    return "Unknown", f"Unhandled redundancy_type: {redundancy_type}", []


# ---------------------------------------------------------------------------
# Zone risk scoring
# ---------------------------------------------------------------------------
_RISK_SCORE_MAP = {
    "ZoneRedundant":  10,
    "Zonal":          60,   # single zone = SPOF within region
    "LocallyRedundant": 80, # no zone protection at all
    "NotZoneAware":   40,   # platform-managed, lower risk
    "Unknown":        50,
}

_TIER_MULTIPLIER = {
    "Production":     1.5,
    "Non-Production": 1.0,
    "Dev/Test":       0.5,
    "Sandbox":        0.3,
    "Unknown":        1.0,
}


def _compute_risk_score(zone_status: str, tier: str, is_qatar: bool) -> int:
    base = _RISK_SCORE_MAP.get(zone_status, 50)
    mult = _TIER_MULTIPLIER.get(tier, 1.0)
    # Qatar Central penalty — ZR is blocked so LocallyRedundant is expected
    # but still needs cross-region DR
    if is_qatar and zone_status == "LocallyRedundant":
        base = max(base, 70)
    score = min(100, int(base * mult))
    return score


# ---------------------------------------------------------------------------
# Main assessment function
# ---------------------------------------------------------------------------
def assess_resource(resource: dict, subscription_name: str = "") -> ZoneAssessment:
    """Produce a ZoneAssessment for a single resource dict."""
    resource_id   = resource.get("resource_id") or resource.get("id") or ""
    resource_name = resource.get("resource_name") or resource.get("name") or ""
    rtype         = (resource.get("resource_type") or resource.get("type") or "").lower()
    rg            = resource.get("resource_group") or resource.get("resourceGroup") or ""
    location      = (resource.get("location") or "").lower().replace(" ", "")
    sub_id        = resource.get("subscription_id") or ""
    tags          = resource.get("tags") or {}
    if isinstance(tags, str):
        try:
            import json
            tags = json.loads(tags)
        except Exception:
            tags = {}

    # Zone assessment
    zone_status, zone_detail, zones = _assess_zone_status(resource)

    # Paired region lookup
    region_info   = AZURE_PAIRED_REGIONS.get(location, {})
    paired_region = region_info.get("paired")
    paired_note   = region_info.get("note", "")
    has_paired    = paired_region is not None

    is_qatar = (location == "qatarcentral")
    qatar_zr_blocked = is_qatar  # ZR is always blocked in Qatar Central

    # Geo-redundant check for storage
    geo_redundant = False
    sku_name = ""
    sku = resource.get("sku") or {}
    if isinstance(sku, dict):
        sku_name = (sku.get("name") or sku.get("tier") or "").upper()
    if rtype == "microsoft.storage/storageaccounts":
        geo_pat = ZONE_AWARE_TYPES.get(rtype, {}).get("geo_pattern", "")
        if geo_pat and re.search(geo_pat, sku_name, re.IGNORECASE):
            geo_redundant = True

    # Workload tier
    tier, confidence, source = classify_workload_tier(resource_name, rg, subscription_name, tags)

    # Risk score
    risk_score = _compute_risk_score(zone_status, tier, is_qatar)

    # Recommended DR region
    if is_qatar:
        recommended_dr = "UAE North (primary) or West Europe / North Europe (NIA-certified)"
    elif paired_region:
        recommended_dr = paired_region
    else:
        recommended_dr = "Refer to regional DR guidance"

    # Needs DR action?
    needs_dr = zone_status not in ("ZoneRedundant",) or not has_paired
    if is_qatar:
        needs_dr = True  # Always needs cross-region DR in Qatar Central

    return ZoneAssessment(
        resource_id=resource_id,
        resource_name=resource_name,
        resource_type=rtype,
        resource_group=rg,
        location=location,
        subscription_id=sub_id,
        zone_status=zone_status,
        zone_detail=zone_detail,
        zones=zones,
        has_paired_region=has_paired,
        paired_region=paired_region,
        paired_region_note=paired_note,
        geo_redundant=geo_redundant,
        is_qatar_central=is_qatar,
        qatar_zr_blocked=qatar_zr_blocked,
        recommended_dr_region=recommended_dr,
        workload_tier=tier,
        tier_confidence=confidence,
        tier_source=source,
        zone_risk_score=risk_score,
        needs_dr_action=needs_dr,
    )


def assess_all_resources(resources: list[dict], subscription_name: str = "") -> list[ZoneAssessment]:
    """Assess all resources and return list of ZoneAssessments."""
    results = []
    for r in resources:
        try:
            results.append(assess_resource(r, subscription_name))
        except Exception as e:
            logger.warning("BCDR assessment failed for %s: %s",
                           r.get("resource_name") or r.get("name", "?"), e)
    return results


# ---------------------------------------------------------------------------
# Dashboard summary helper
# ---------------------------------------------------------------------------
def build_bcdr_dashboard_summary(assessments: list[ZoneAssessment]) -> dict:
    """Aggregate assessments into dashboard summary data.

    Mirrors the charts produced by Phase1-CollectResources.ps1:
      1. Zone Resilience Distribution (doughnut)
      2. Zone Status by Subscription (stacked bar)
      3. Top Resource Types by Count (horizontal bar)
      4. Risk Assessment — Zone Exposure (doughnut)
      5. Cross-Region Replication Status (doughnut)
      6. Regional Distribution (horizontal bar)
      7. Non-Zonal Resources by Type (horizontal bar)
      8. IaaS vs PaaS vs Platform (doughnut)
      9. Subscription Risk Score (horizontal bar)
    """
    total = len(assessments)
    if total == 0:
        return {"total": 0}

    zone_breakdown: dict[str, int] = {}
    tier_breakdown: dict[str, int] = {}
    qatar_count = sum(1 for a in assessments if a.is_qatar_central)
    needs_dr = sum(1 for a in assessments if a.needs_dr_action)
    geo_redundant = sum(1 for a in assessments if a.geo_redundant)

    for a in assessments:
        zone_breakdown[a.zone_status] = zone_breakdown.get(a.zone_status, 0) + 1
        tier_breakdown[a.workload_tier] = tier_breakdown.get(a.workload_tier, 0) + 1

    avg_risk = sum(a.zone_risk_score for a in assessments) / total

    high_risk = [a.to_dict() for a in sorted(assessments, key=lambda x: x.zone_risk_score, reverse=True)
                 if a.zone_risk_score >= 70][:20]

    # ── Chart 3: Top resource types ───────────────────────────────────────
    type_counts: dict[str, int] = {}
    for a in assessments:
        short = a.resource_type.split("/")[-1] if "/" in a.resource_type else a.resource_type
        type_counts[short] = type_counts.get(short, 0) + 1
    top_resource_types = dict(sorted(type_counts.items(), key=lambda x: -x[1])[:12])

    # ── Chart 4: Risk Assessment — Zone Exposure ──────────────────────────
    CRITICAL_TYPES = {
        "microsoft.compute/virtualmachines", "microsoft.sql/servers/databases",
        "microsoft.storage/storageaccounts", "microsoft.containerservice/managedclusters",
        "microsoft.dbforpostgresql/flexibleservers", "microsoft.dbformysql/flexibleservers",
        "microsoft.documentdb/databaseaccounts",
    }
    high_risk_count = sum(1 for a in assessments
                         if a.zone_status in ("NonZonal", "LocallyRedundant", "Unknown")
                         and a.resource_type.lower() in CRITICAL_TYPES)
    medium_risk_count = sum(1 for a in assessments
                           if a.zone_status in ("NonZonal", "LocallyRedundant", "Unknown")
                           and a.resource_type.lower() not in CRITICAL_TYPES)
    low_risk_count = total - high_risk_count - medium_risk_count
    risk_exposure = {
        "High Risk (Critical Non-Zonal)": high_risk_count,
        "Medium Risk (Other Non-Zonal)": medium_risk_count,
        "Low Risk (Protected)": low_risk_count,
    }

    # ── Chart 5: Cross-Region Replication Status ──────────────────────────
    cross_region = {"Geo-Redundant": 0, "Global/Multi-Region": 0, "Single-Region": 0, "Unknown": 0}
    for a in assessments:
        if a.geo_redundant:
            cross_region["Geo-Redundant"] += 1
        elif a.location and a.location.lower() == "global":
            cross_region["Global/Multi-Region"] += 1
        elif a.has_paired_region is False and not a.geo_redundant:
            cross_region["Single-Region"] += 1
        else:
            cr = a.zone_detail.lower() if a.zone_detail else ""
            if "grs" in cr or "gzrs" in cr or "ragrs" in cr:
                cross_region["Geo-Redundant"] += 1
            else:
                cross_region["Single-Region"] += 1

    # ── Chart 6: Regional Distribution ────────────────────────────────────
    region_counts: dict[str, int] = {}
    for a in assessments:
        loc = a.location or "unknown"
        region_counts[loc] = region_counts.get(loc, 0) + 1
    regional_distribution = dict(sorted(region_counts.items(), key=lambda x: -x[1])[:10])

    # ── Chart 7: Non-Zonal by Resource Type ───────────────────────────────
    nz_types: dict[str, int] = {}
    for a in assessments:
        if a.zone_status in ("NonZonal", "Unknown"):
            short = a.resource_type.split("/")[-1] if "/" in a.resource_type else a.resource_type
            nz_types[short] = nz_types.get(short, 0) + 1
    nonzonal_by_type = dict(sorted(nz_types.items(), key=lambda x: -x[1])[:12])

    # ── Chart 8: IaaS vs PaaS vs Platform ─────────────────────────────────
    IAAS_TYPES = {
        "microsoft.compute/virtualmachines", "microsoft.compute/disks",
        "microsoft.compute/virtualmachinescalesets",
        "microsoft.network/loadbalancers", "microsoft.network/applicationgateways",
        "microsoft.network/publicipaddresses",
    }
    PLATFORM_TYPES = {
        "microsoft.network/virtualnetworks", "microsoft.network/networkinterfaces",
        "microsoft.network/networksecuritygroups", "microsoft.network/routetables",
        "microsoft.keyvault/vaults", "microsoft.operationalinsights/workspaces",
        "microsoft.recoveryservices/vaults", "microsoft.automation/automationaccounts",
        "microsoft.insights/components", "microsoft.logic/workflows",
    }
    iaas_c = sum(1 for a in assessments if a.resource_type.lower() in IAAS_TYPES)
    plat_c = sum(1 for a in assessments if a.resource_type.lower() in PLATFORM_TYPES)
    paas_c = total - iaas_c - plat_c
    iaas_paas_platform = {"IaaS": iaas_c, "PaaS & App Services": max(paas_c, 0), "Platform Infrastructure": plat_c}

    # ── Chart 2 / Chart 9: Subscription-level data ────────────────────────
    heatmap = _build_risk_heatmap(assessments)
    subscription_zone_breakdown = []
    for row in heatmap:
        subscription_zone_breakdown.append({
            "subscription_id": row["subscription_id"],
            "total": row["total"],
            "ZoneRedundant": row.get("ZoneRedundant", 0),
            "NonZonal": row.get("NonZonal", 0) + row.get("Unknown", 0),
            "LocallyRedundant": row.get("LocallyRedundant", 0),
            "risk_score": row["avg_risk"],
        })

    # ── Qatar Central RoC (Region of Choice) summary ─────────────────────
    qatar_roc_summary = None
    if qatar_count > 0:
        rsv_count = sum(1 for a in assessments
                        if a.resource_type.lower() == "microsoft.recoveryservices/vaults"
                        and a.is_qatar_central)
        vm_count = sum(1 for a in assessments
                       if a.resource_type.lower() == "microsoft.compute/virtualmachines"
                       and a.is_qatar_central)
        qatar_roc_summary = {
            "total_qatar_resources": qatar_count,
            "recovery_vaults_in_qatar": rsv_count,
            "vms_in_qatar": vm_count,
            "roc_target_regions": ["Sweden Central", "Switzerland North"],
            "roc_supported_workloads": [
                "IaaS VM (General Purpose)", "SQL in VM", "SAP HANA in VM",
                "Azure Files", "Blob", "ADLS", "AKS", "PostgreSQL Flexible Server",
            ],
            "roc_not_supported": ["ADE (Azure Disk Encryption) VMs"],
            "nia_certified_dr_regions": ["West Europe", "North Europe"],
            "note": "Standard CRR unavailable for Qatar Central (no paired region). "
                    "Use Azure Backup Region of Choice (RoC) preview to back up "
                    "to Sweden Central or Switzerland North vaults.",
        }

    return {
        "total": total,
        "needs_dr_action": needs_dr,
        "geo_redundant": geo_redundant,
        "qatar_central_count": qatar_count,
        "average_risk_score": round(avg_risk, 1),
        "zone_breakdown": zone_breakdown,
        "tier_breakdown": tier_breakdown,
        "high_risk_resources": high_risk,
        "risk_heatmap": heatmap,
        # New chart data matching Phase1 PowerShell dashboard
        "top_resource_types": top_resource_types,
        "risk_exposure": risk_exposure,
        "cross_region_status": cross_region,
        "regional_distribution": regional_distribution,
        "nonzonal_by_type": nonzonal_by_type,
        "iaas_paas_platform": iaas_paas_platform,
        "subscription_zone_breakdown": subscription_zone_breakdown,
        "qatar_roc_summary": qatar_roc_summary,
    }


def _build_risk_heatmap(assessments: list[ZoneAssessment]) -> list[dict]:
    """Build subscription × zone_status risk heatmap rows."""
    subs: dict[str, dict] = {}
    for a in assessments:
        key = a.subscription_id or "unknown"
        if key not in subs:
            subs[key] = {
                "subscription_id": key,
                "total": 0,
                "ZoneRedundant": 0,
                "Zonal": 0,
                "LocallyRedundant": 0,
                "NotZoneAware": 0,
                "Unknown": 0,
                "avg_risk": 0,
                "_risk_sum": 0,
                "has_qatar": False,
            }
        row = subs[key]
        row["total"] += 1
        row[a.zone_status] = row.get(a.zone_status, 0) + 1
        row["_risk_sum"] += a.zone_risk_score
        if a.is_qatar_central:
            row["has_qatar"] = True

    rows = []
    for row in subs.values():
        total = row["total"] or 1
        row["avg_risk"] = round(row["_risk_sum"] / total, 1)
        row["pct_zone_redundant"] = round(row["ZoneRedundant"] / total * 100, 1)
        del row["_risk_sum"]
        rows.append(row)

    return sorted(rows, key=lambda x: x["avg_risk"], reverse=True)
