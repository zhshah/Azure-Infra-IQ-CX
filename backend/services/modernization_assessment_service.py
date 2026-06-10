"""
Modernization assessment service — data gatherers for AI-driven modernization
assessments (SQL modernization, App Service modernization).

ARG-first (Azure Resource Graph), resilient and dependency-light. Grounds the AI
assessments with the customer's real estate so recommendations are workload-level
and drive Azure consumption (SQL DB / Managed Instance / App Service tiers).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from services.resource_graph_service import query_resource_graph

logger = logging.getLogger(__name__)


# ── SQL estate ────────────────────────────────────────────────────────────────
_SQL_KQL = """
resources
| where type in~ (
    'microsoft.sqlvirtualmachine/sqlvirtualmachines',
    'microsoft.azurearcdata/sqlserverinstances',
    'microsoft.azurearcdata/sqlmanagedinstances',
    'microsoft.sql/servers',
    'microsoft.sql/servers/databases',
    'microsoft.sql/managedinstances',
    'microsoft.dbforpostgresql/flexibleservers',
    'microsoft.dbformysql/flexibleservers'
  )
| extend skuName = tostring(sku.name), skuTier = tostring(sku.tier)
| project name, type, location, resourceGroup, subscriptionId, id, skuName, skuTier, kind
"""

# IaaS VMs (Azure + Arc) — candidates that may host SQL Server and could move to
# Azure SQL Managed Instance for a fully-managed path.
_VM_KQL = """
resources
| where type in~ ('microsoft.compute/virtualmachines','microsoft.hybridcompute/machines')
| extend osType = tostring(properties.storageProfile.osDisk.osType),
         vmSize = tostring(properties.hardwareProfile.vmSize),
         powerState = tostring(properties.extended.instanceView.powerState.displayStatus)
| project name, type, location, resourceGroup, subscriptionId, id, osType, vmSize, powerState
"""


def _sql_kind(rtype: str) -> str:
    t = (rtype or "").lower()
    if "sqlvirtualmachine" in t:
        return "iaas_sql_vm"
    if "azurearcdata/sqlserverinstances" in t:
        return "arc_sql"
    if "azurearcdata/sqlmanagedinstances" in t:
        return "arc_sql_mi"
    if "managedinstances" in t:
        return "azure_sql_mi"
    if "servers/databases" in t:
        return "azure_sql_db"
    if t.endswith("sql/servers"):
        return "azure_sql_server"
    if "postgresql" in t:
        return "postgresql"
    if "mysql" in t:
        return "mysql"
    return "other"


def get_sql_estate(subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """SQL footprint across Azure PaaS, IaaS SQL VMs, Arc-enabled SQL and (best
    effort) on-prem SQL — the basis for SQL DB vs Managed Instance migration."""
    try:
        rows = query_resource_graph(_SQL_KQL, subscription_ids, max_results=20000)
    except Exception as exc:
        logger.warning("sql_estate: query failed: %s", exc)
        rows = []
    try:
        vms = query_resource_graph(_VM_KQL, subscription_ids, max_results=20000)
    except Exception as exc:
        logger.warning("sql_estate: vm query failed: %s", exc)
        vms = []

    by_kind: Dict[str, int] = {}
    items: List[Dict[str, Any]] = []
    for r in rows:
        kind = _sql_kind(r.get("type"))
        by_kind[kind] = by_kind.get(kind, 0) + 1
        items.append({
            "resource_name": r.get("name"),
            "resource_type": r.get("type"),
            "kind": kind,
            "location": r.get("location"),
            "resource_group": r.get("resourceGroup"),
            "subscription_id": r.get("subscriptionId"),
            "resource_id": r.get("id"),
            "sku": r.get("skuName") or r.get("skuTier") or "",
        })

    # SQL-on-VM candidates: VMs/Arc machines whose name suggests SQL. The AI
    # refines this with deeper signals (extensions, Arc-discovered instances).
    sql_vm_candidates: List[Dict[str, Any]] = []
    arc_machines = 0
    for v in vms:
        is_arc = "hybridcompute/machines" in (v.get("type") or "").lower()
        if is_arc:
            arc_machines += 1
        nm = (v.get("name") or "").lower()
        if "sql" in nm or "db" in nm:
            sql_vm_candidates.append({
                "resource_name": v.get("name"),
                "resource_type": v.get("type"),
                "kind": "arc_machine" if is_arc else "azure_vm",
                "location": v.get("location"),
                "resource_group": v.get("resourceGroup"),
                "subscription_id": v.get("subscriptionId"),
                "resource_id": v.get("id"),
                "sku": v.get("vmSize") or "",
                "power_state": v.get("powerState"),
            })

    # On-prem SQL (best effort from the on-prem collection inventory)
    onprem_sql: List[Dict[str, Any]] = []
    try:
        from services import onprem_service  # type: ignore
        inv = onprem_service.get_inventory() if hasattr(onprem_service, "get_inventory") else None
        servers = (inv or {}).get("servers", []) if isinstance(inv, dict) else []
        for s in servers:
            if not isinstance(s, dict):
                continue
            sw = " ".join(str(x) for x in (s.get("software") or [])).lower()
            if "sql server" in sw or "sql" in str(s.get("name", "")).lower():
                onprem_sql.append({
                    "resource_name": s.get("name"),
                    "kind": "onprem_sql",
                    "os": s.get("os"),
                    "hypervisor": s.get("hypervisor") or s.get("platform"),
                })
    except Exception:
        pass

    return {
        "total_sql_resources": len(items),
        "by_kind": by_kind,
        "iaas_sql_vms": by_kind.get("iaas_sql_vm", 0),
        "arc_sql_instances": by_kind.get("arc_sql", 0) + by_kind.get("arc_sql_mi", 0),
        "azure_sql_servers": by_kind.get("azure_sql_server", 0),
        "azure_sql_databases": by_kind.get("azure_sql_db", 0),
        "managed_instances": by_kind.get("azure_sql_mi", 0),
        "sql_vm_candidates": sql_vm_candidates[:80],
        "sql_vm_candidate_count": len(sql_vm_candidates),
        "onprem_sql": onprem_sql[:80],
        "onprem_sql_count": len(onprem_sql),
        "arc_machines": arc_machines,
        "items": items[:300],
    }


# ── App Service estate ────────────────────────────────────────────────────────
_APPSVC_KQL = """
resources
| where type in~ ('microsoft.web/serverfarms','microsoft.web/sites')
| extend skuName = tostring(sku.name), skuTier = tostring(sku.tier),
         skuCapacity = toint(sku.capacity), kindLower = tolower(kind),
         state = tostring(properties.state),
         httpsOnly = tobool(properties.httpsOnly)
| project name, type, location, resourceGroup, subscriptionId, id, skuName, skuTier, skuCapacity, kind, kindLower, state, httpsOnly
"""


def get_appservice_estate(subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """App Service plans + sites (web apps, function apps, containers) with SKU
    tier, capacity and basic posture — the basis for scaling / modernization."""
    try:
        rows = query_resource_graph(_APPSVC_KQL, subscription_ids, max_results=20000)
    except Exception as exc:
        logger.warning("appservice_estate: query failed: %s", exc)
        rows = []

    plans: List[Dict[str, Any]] = []
    sites: List[Dict[str, Any]] = []
    by_tier: Dict[str, int] = {}
    by_kind: Dict[str, int] = {}
    functions = 0
    containers = 0
    for r in rows:
        is_plan = "serverfarms" in (r.get("type") or "").lower()
        tier = r.get("skuTier") or r.get("skuName") or "Unknown"
        entry = {
            "resource_name": r.get("name"),
            "resource_type": r.get("type"),
            "location": r.get("location"),
            "resource_group": r.get("resourceGroup"),
            "subscription_id": r.get("subscriptionId"),
            "resource_id": r.get("id"),
            "sku": r.get("skuName") or "",
            "tier": tier,
            "capacity": r.get("skuCapacity"),
            "kind": r.get("kind") or "",
            "state": r.get("state") or "",
            "https_only": r.get("httpsOnly"),
        }
        if is_plan:
            by_tier[tier] = by_tier.get(tier, 0) + 1
            plans.append(entry)
        else:
            kl = r.get("kindLower") or ""
            if "functionapp" in kl:
                functions += 1
                by_kind["function"] = by_kind.get("function", 0) + 1
            elif "container" in kl:
                containers += 1
                by_kind["container"] = by_kind.get("container", 0) + 1
            else:
                by_kind["webapp"] = by_kind.get("webapp", 0) + 1
            sites.append(entry)

    free_basic = sum(c for t, c in by_tier.items() if str(t).lower() in ("free", "shared", "basic", "d1"))
    return {
        "total_plans": len(plans),
        "total_sites": len(sites),
        "function_apps": functions,
        "container_apps": containers,
        "web_apps": by_kind.get("webapp", 0),
        "by_tier": by_tier,
        "by_kind": by_kind,
        "free_basic_plans": free_basic,
        "plans": plans[:150],
        "items": sites[:300],
    }
