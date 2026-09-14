"""
FinOps Cost Insights — grounded, filter-ready cost lens over the estate.

Produces ONE flat, per-resource dataset that annotates every resource with its
REAL cost (cost_current_month / previous — the throttle-immune run-rate from the
dashboard cache) plus the dimensions needed to "translate cost into ideas":

  • Azure service + resource category            (what am I paying for?)
  • Region / subscription / resource group        (where?)
  • SKU tier                                       (what size/tier?)
  • Storage redundancy (LRS/ZRS/GRS/GZRS/RA-*)     (parsed from the storage sku — grounded)
  • Zone-resilience posture + geo-redundancy       (from the GENUINE BCDR zone assessment)
  • Data-protection posture (backup / RI covered)  (from the cache flags)
  • Waste (idle / orphaned cumulative $)           (from scoring)
  • Modernization target + monthly saving          (SQL-on-VM → SQL MI, etc. — joined
                                                     from modernization_opportunities)

The frontend fetches this ONCE and does ALL filtering + chart aggregation client-side
(useMemo), so every chart re-renders instantly on a filter change — no Cost Management
API at view time, no throttling. 100% grounded: every number comes from the cache; no
estimates are invented here.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

# Friendly Azure service names for the common resource types (extend as needed).
_SERVICE_LABELS: Dict[str, str] = {
    "microsoft.compute/virtualmachines": "Virtual Machines",
    "microsoft.compute/virtualmachinescalesets": "VM Scale Sets",
    "microsoft.compute/disks": "Managed Disks",
    "microsoft.compute/snapshots": "Disk Snapshots",
    "microsoft.storage/storageaccounts": "Storage Accounts",
    "microsoft.sql/servers": "Azure SQL Server",
    "microsoft.sql/servers/databases": "Azure SQL Database",
    "microsoft.sql/managedinstances": "SQL Managed Instance",
    "microsoft.sqlvirtualmachine/sqlvirtualmachines": "SQL Server on VM",
    "microsoft.dbforpostgresql/servers": "PostgreSQL (Single)",
    "microsoft.dbforpostgresql/flexibleservers": "PostgreSQL Flexible",
    "microsoft.dbformysql/servers": "MySQL (Single)",
    "microsoft.dbformysql/flexibleservers": "MySQL Flexible",
    "microsoft.documentdb/databaseaccounts": "Cosmos DB",
    "microsoft.cache/redis": "Azure Cache for Redis",
    "microsoft.web/serverfarms": "App Service Plans",
    "microsoft.web/sites": "App Service / Functions",
    "microsoft.app/containerapps": "Container Apps",
    "microsoft.app/managedenvironments": "Container Apps Env",
    "microsoft.containerservice/managedclusters": "AKS Clusters",
    "microsoft.containerregistry/registries": "Container Registry",
    "microsoft.network/loadbalancers": "Load Balancers",
    "microsoft.network/applicationgateways": "Application Gateway",
    "microsoft.network/azurefirewalls": "Azure Firewall",
    "microsoft.network/publicipaddresses": "Public IP Addresses",
    "microsoft.network/virtualnetworkgateways": "VPN / ER Gateways",
    "microsoft.network/natgateways": "NAT Gateways",
    "microsoft.network/bastionhosts": "Bastion Hosts",
    "microsoft.network/privateendpoints": "Private Endpoints",
    "microsoft.cognitiveservices/accounts": "Azure AI / Cognitive",
    "microsoft.search/searchservices": "Azure AI Search",
    "microsoft.recoveryservices/vaults": "Recovery Services Vaults",
    "microsoft.operationalinsights/workspaces": "Log Analytics",
    "microsoft.insights/components": "Application Insights",
    "microsoft.apimanagement/service": "API Management",
    "microsoft.servicebus/namespaces": "Service Bus",
    "microsoft.eventhub/namespaces": "Event Hubs",
    "microsoft.keyvault/vaults": "Key Vault",
}


def _service_label(rtype: str) -> str:
    t = (rtype or "").lower()
    if t in _SERVICE_LABELS:
        return _SERVICE_LABELS[t]
    # Fallback: prettify the last path segment.
    seg = t.split("/")[-1] if "/" in t else t
    seg = seg.replace("microsoft.", "")
    words = re.sub(r"([a-z])([A-Z])", r"\1 \2", seg).replace("_", " ").strip()
    return words.title() or (rtype or "Other")


def _sku_tier(sku: Optional[str]) -> str:
    """Coarse tier label from a sku string (grounded, best-effort)."""
    if not sku:
        return "Unspecified"
    s = str(sku)
    low = s.lower()
    for tier in ("premium", "standard", "basic", "free", "shared", "isolated", "developer"):
        if low.startswith(tier) or f"_{tier}" in low or low == tier:
            return tier.title()
    # VM-style families: Standard_D2s_v5 -> "D-series"; else first token.
    m = re.match(r"^[a-z]*_?([a-z]+)\d", low)
    if m:
        return f"{m.group(1).upper()}-series"
    return s.split("_")[0].title() if "_" in s else s


def _storage_redundancy(rtype: str, sku: Optional[str]) -> Optional[str]:
    """Parse storage replication from the sku (storage accounts only). Grounded."""
    if "microsoft.storage/storageaccounts" not in (rtype or "").lower():
        return None
    s = (sku or "").upper()
    if "RAGZRS" in s or "RA-GZRS" in s:
        return "RA-GZRS"
    if "GZRS" in s:
        return "GZRS"
    if "RAGRS" in s or "RA-GRS" in s:
        return "RA-GRS"
    if "GRS" in s:
        return "GRS"
    if "ZRS" in s:
        return "ZRS"
    if "LRS" in s:
        return "LRS"
    return "Unknown"


_ZONE_LABELS = {
    "zoneredundant": "Zone-redundant",
    "zonal": "Zonal (single zone)",
    "locallyredundant": "Locally-redundant",
    "notzoneaware": "Not zone-aware",
    "redundantbydefault": "Zone-redundant (default)",
    "unknown": "Unknown",
}


def _zone_label(zone_status: Optional[str]) -> str:
    return _ZONE_LABELS.get(str(zone_status or "unknown").lower().replace(" ", ""), str(zone_status or "Unknown"))


def _num(v: Any) -> float:
    try:
        return round(float(v or 0), 2)
    except Exception:
        return 0.0


def build_cost_insights(
    resources: List[Dict[str, Any]],
    zone_by_id: Optional[Dict[str, Dict[str, Any]]] = None,
    modern_by_id: Optional[Dict[str, Dict[str, Any]]] = None,
    sub_names: Optional[Dict[str, str]] = None,
    authoritative_total: Optional[float] = None,
) -> Dict[str, Any]:
    """Annotate every resource with cost + grounded cost-lens dimensions.

    The frontend aggregates client-side, so we return the flat `rows` (source of
    truth) plus a light `summary` for headline KPIs + the distinct filter options.
    """
    zone_by_id = zone_by_id or {}
    modern_by_id = modern_by_id or {}
    sub_names = sub_names or {}

    rows: List[Dict[str, Any]] = []
    total_cost = 0.0
    total_prev = 0.0
    total_waste = 0.0
    total_savings = 0.0

    for r in resources:
        rid = (r.get("resource_id") or "").strip()
        rl = rid.lower()
        rtype = r.get("resource_type") or ""
        sku = r.get("sku")
        cost = _num(r.get("cost_current_month"))
        prev = _num(r.get("cost_previous_month"))
        za = zone_by_id.get(rl, {}) or {}
        mo = modern_by_id.get(rl, {}) or {}

        storage_red = _storage_redundancy(rtype, sku)
        zone_status = za.get("zone_status") or "Unknown"
        geo_redundant = bool(za.get("geo_redundant"))

        # Unified redundancy posture (for a single "cost by resilience" chart):
        # storage uses its replication; everything else uses the zone posture.
        if storage_red:
            redundancy_posture = {
                "LRS": "Locally-redundant (LRS)",
                "ZRS": "Zone-redundant (ZRS)",
                "GRS": "Geo-redundant (GRS)",
                "RA-GRS": "Geo-redundant (RA-GRS)",
                "GZRS": "Geo+Zone redundant (GZRS)",
                "RA-GZRS": "Geo+Zone redundant (RA-GZRS)",
            }.get(storage_red, storage_red)
        else:
            redundancy_posture = _zone_label(zone_status)

        score_label = r.get("score_label")
        score_label = getattr(score_label, "value", score_label)

        savings = _num(mo.get("estimated_savings_usd"))
        waste = _num(r.get("cumulative_waste_usd"))

        total_cost += cost
        total_prev += prev
        total_waste += waste
        total_savings += savings

        sub_id = r.get("subscription_id") or ""
        rows.append({
            "resource_id": rid,
            "resource_name": r.get("resource_name") or "",
            "resource_type": rtype,
            "service": _service_label(rtype),
            "category": r.get("resource_category") or "other",
            "region": r.get("location") or "unknown",
            "subscription_id": sub_id,
            "subscription_name": sub_names.get(sub_id) or (sub_id[:8] if sub_id else "unknown"),
            "resource_group": r.get("resource_group") or "unknown",
            "sku": sku or "",
            "sku_tier": _sku_tier(sku),
            "cost_current": cost,
            "cost_previous": prev,
            "cost_delta_pct": _num(r.get("cost_delta_pct")),
            "storage_redundancy": storage_red,          # storage only; else None
            "zone_status": zone_status,                 # from genuine assessment
            "zone_label": _zone_label(zone_status),
            "geo_redundant": geo_redundant,
            "redundancy_posture": redundancy_posture,   # unified label for one chart
            "is_orphan": bool(r.get("is_orphan")),
            "days_idle": r.get("days_idle"),
            "waste_usd": waste,
            "has_backup": bool(r.get("has_backup")),
            "has_tags": bool(r.get("tags")),
            "ri_covered": bool(r.get("ri_covered")),
            "is_protected": bool(r.get("is_protected")),
            "utilization_pct": r.get("primary_utilization_pct"),
            "score_label": str(score_label or "Unknown"),
            "power_state": r.get("power_state"),
            "modernization_type": mo.get("opportunity_type"),
            "modernization_title": mo.get("title"),
            "modernization_savings": savings,
            "modernization_complexity": mo.get("complexity"),
        })

    # Distinct filter options (for the client dropdowns), sorted.
    def _distinct(key: str) -> List[str]:
        return sorted({str(r[key]) for r in rows if r.get(key)})

    attributed = round(total_cost, 2)
    auth = round(float(authoritative_total), 2) if authoritative_total and authoritative_total > 0 else None
    coverage_pct = round(attributed / auth * 100, 1) if (auth and auth > 0) else None

    # ── Cost at risk (grounded, board-level) ────────────────────────────────
    unprotected = round(sum(r["cost_current"] for r in rows if not r["has_backup"]), 2)
    non_zone_redundant = round(sum(r["cost_current"] for r in rows
                                   if r["zone_status"] and str(r["zone_status"]).lower().replace(" ", "") not in ("zoneredundant", "redundantbydefault")), 2)
    untagged_spend = round(sum(r["cost_current"] for r in rows if not r["has_tags"]), 2)
    idle_spend = round(sum(r["cost_current"] for r in rows if r["is_orphan"] or (r.get("days_idle") or 0) >= 30), 2)

    summary = {
        "total_resources": len(rows),
        "billable_resources": sum(1 for r in rows if r["cost_current"] > 0),
        "total_cost_current": attributed,
        "authoritative_total_usd": auth,           # warehouse (real bill) — headline
        "attributed_total_usd": attributed,        # sum of per-resource (for breakdown)
        "coverage_pct": coverage_pct,              # attributed / authoritative
        "total_cost_previous": round(total_prev, 2),
        "total_waste_usd": round(total_waste, 2),
        "total_modernization_savings": round(total_savings, 2),
        "unprotected_spend": unprotected,
        "cost_at_risk": {
            "unprotected_usd": unprotected,
            "non_zone_redundant_usd": non_zone_redundant,
            "untagged_usd": untagged_spend,
            "idle_orphaned_usd": idle_spend,
        },
        "options": {
            "subscriptions": sorted({(r["subscription_id"], r["subscription_name"]) for r in rows if r["subscription_id"]}),
            "regions": _distinct("region"),
            "resource_groups": _distinct("resource_group"),
            "services": _distinct("service"),
            "categories": _distinct("category"),
        },
    }
    # subscriptions option as list of {id,name}
    summary["options"]["subscriptions"] = [
        {"id": sid, "name": nm} for (sid, nm) in summary["options"]["subscriptions"]
    ]

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_source": "dashboard cache (run-rate) + genuine zone assessment + modernization engine",
        "summary": summary,
        "rows": rows,
    }
