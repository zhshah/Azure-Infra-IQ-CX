"""
Monitoring Service — Azure Monitor observability for the whole estate.

Surfaces, primarily via Azure Resource Graph (resilient — no warehouse / SQL
dependency) plus Azure Monitor metrics and Log Analytics:
  • Resource Health      (healthresources)
  • Fired alerts         (alertsmanagementresources)
  • Monitoring coverage  (Azure Monitor Agent / Log Analytics agent presence on
                          native VMs + Arc-enabled servers)
  • Platform metrics     (CPU / memory / disk / network via Azure Monitor)
  • Log Analytics perf   (Perf / Heartbeat for Arc + on-premises machines)

Covers native Azure resources, Azure Arc-enabled servers, and (best-effort)
on-premises machines reporting through the Azure Monitor Agent. Every function
degrades gracefully (returns empty / available=False) instead of raising.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from services.azure_auth import get_credential, get_subscription_ids
from services.resource_graph_service import query_resource_graph

logger = logging.getLogger(__name__)


# ── KQL queries (Azure Resource Graph) ────────────────────────────────────────

_HEALTH_KQL = """
healthresources
| where type =~ 'microsoft.resourcehealth/availabilitystatuses'
| extend p = properties
| project targetResourceId = tostring(p.targetResourceId),
          availabilityState = tostring(p.availabilityState),
          summary = tostring(p.summary),
          reasonType = tostring(p.reasonType),
          occurredTime = tostring(p.occurredTime),
          subscriptionId
"""

_ALERTS_KQL = """
alertsmanagementresources
| where type =~ 'microsoft.alertsmanagement/alerts'
| extend e = properties.essentials
| project alertId = id, alertName = name,
          severity = tostring(e.severity),
          alertState = tostring(e.alertState),
          monitorCondition = tostring(e.monitorCondition),
          targetResource = tostring(e.targetResource),
          targetResourceName = tostring(e.targetResourceName),
          targetResourceType = tostring(e.targetResourceType),
          signalType = tostring(e.signalType),
          firedTime = tostring(e.startDateTime),
          subscriptionId
"""

_MACHINES_KQL = """
resources
| where type =~ 'microsoft.compute/virtualmachines' or type =~ 'microsoft.hybridcompute/machines'
| extend machineType = iff(type contains 'hybridcompute', 'Arc', 'AzureVM')
| extend osType = tostring(properties.osProfile.windowsConfiguration) 
| extend osName = tostring(properties.osName)
| project id = tolower(id), name, machineType,
          osType = tostring(properties.storageProfile.osDisk.osType),
          osName = tostring(properties.osName),
          powerState = tostring(properties.extended.instanceView.powerState.displayStatus),
          status = tostring(properties.status),
          resourceGroup, subscriptionId, location
"""

_AGENT_EXT_KQL = """
resources
| where type in~ ('microsoft.compute/virtualmachines/extensions','microsoft.hybridcompute/machines/extensions')
| extend extType = tostring(properties.type)
| where extType in~ ('AzureMonitorWindowsAgent','AzureMonitorLinuxAgent','MicrosoftMonitoringAgent','OmsAgentForLinux','DependencyAgentWindows','DependencyAgentLinux')
| extend machineId = tolower(tostring(split(id, '/extensions/')[0]))
| project machineId, extType,
          provisioningState = tostring(properties.provisioningState)
"""

_WORKSPACE_KQL = """
resources
| where type =~ 'microsoft.operationalinsights/workspaces'
| project id, name, customerId = tostring(properties.customerId),
          subscriptionId, resourceGroup, location
"""

_SEV_LABELS = {"Sev0": "Critical", "Sev1": "Error", "Sev2": "Warning", "Sev3": "Informational", "Sev4": "Verbose"}
_MONITOR_AGENTS = ("AzureMonitorWindowsAgent", "AzureMonitorLinuxAgent", "MicrosoftMonitoringAgent", "OmsAgentForLinux")

# Resource types that emit real utilisation metrics — ranked so the Performance
# table surfaces compute/db/web before storage/other (which lack CPU/mem).
_METRIC_PRIORITY = {
    "microsoft.compute/virtualmachines": 0,
    "microsoft.compute/virtualmachinescalesets": 0,
    "microsoft.containerservice/managedclusters": 1,
    "microsoft.web/sites": 1,
    "microsoft.web/serverfarms": 1,
    "microsoft.sql/servers/databases": 2,
    "microsoft.sql/servers/elasticpools": 2,
    "microsoft.dbformysql/flexibleservers": 2,
    "microsoft.dbforpostgresql/flexibleservers": 2,
    "microsoft.cache/redis": 2,
    "microsoft.documentdb/databaseaccounts": 2,
    "microsoft.containerinstance/containergroups": 2,
    "microsoft.compute/disks": 3,
}

_PRIMARY_LABEL = {
    "microsoft.compute/virtualmachines": "CPU %",
    "microsoft.compute/virtualmachinescalesets": "CPU %",
    "microsoft.web/sites": "CPU %",
    "microsoft.containerservice/managedclusters": "Node CPU %",
    "microsoft.sql/servers/databases": "DTU %",
    "microsoft.documentdb/databaseaccounts": "RU %",
    "microsoft.cache/redis": "CPU %",
    "microsoft.storage/storageaccounts": "Used Capacity",
    "microsoft.keyvault/vaults": "Transactions",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _rg_from_id(rid: str) -> str:
    parts = (rid or "").split("/")
    for i, p in enumerate(parts):
        if p.lower() == "resourcegroups" and i + 1 < len(parts):
            return parts[i + 1]
    return ""


def _rtype_from_id(rid: str) -> str:
    parts = (rid or "").lower().split("/providers/")
    if len(parts) > 1:
        seg = parts[-1].split("/")
        if len(seg) >= 3:
            return f"{seg[0]}/{seg[1]}"
    return ""


def _name_from_id(rid: str) -> str:
    return (rid or "").rstrip("/").split("/")[-1]


# ── Resource Health ───────────────────────────────────────────────────────────

def get_resource_health(subscription_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Per-resource availability (Available / Degraded / Unavailable / Unknown)."""
    try:
        rows = query_resource_graph(_HEALTH_KQL, subscription_ids, max_results=20000)
    except Exception as exc:
        logger.warning("monitoring: resource health query failed: %s", exc)
        return []
    items: List[Dict[str, Any]] = []
    for r in rows:
        rid = r.get("targetResourceId") or ""
        if not rid:
            continue
        items.append({
            "resource_id": rid,
            "resource_name": _name_from_id(rid),
            "resource_type": _rtype_from_id(rid),
            "resource_group": _rg_from_id(rid),
            "subscription_id": r.get("subscriptionId", ""),
            "availability_state": (r.get("availabilityState") or "Unknown").title(),
            "summary": r.get("summary", "") or "",
            "reason_type": r.get("reasonType", "") or "",
            "occurred_time": r.get("occurredTime", "") or "",
        })
    items.sort(key=lambda x: 0 if x["availability_state"] != "Available" else 1)
    return items


# ── Fired Alerts ──────────────────────────────────────────────────────────────

def get_fired_alerts(subscription_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Azure Monitor alerts (severity Sev0-Sev4, state, target)."""
    try:
        rows = query_resource_graph(_ALERTS_KQL, subscription_ids, max_results=20000)
    except Exception as exc:
        logger.warning("monitoring: alerts query failed: %s", exc)
        return []
    items: List[Dict[str, Any]] = []
    for r in rows:
        sev = (r.get("severity") or "Sev4")
        target = r.get("targetResource") or ""
        items.append({
            "alert_id": r.get("alertId", ""),
            "name": r.get("alertName", "") or "",
            "severity": sev,
            "severity_label": _SEV_LABELS.get(sev, sev),
            "state": r.get("alertState", "") or "",
            "monitor_condition": r.get("monitorCondition", "") or "",
            "target_resource_id": target,
            "target_resource_name": r.get("targetResourceName", "") or _name_from_id(target),
            "target_resource_type": r.get("targetResourceType", "") or "",
            "signal_type": r.get("signalType", "") or "",
            "fired_time": r.get("firedTime", "") or "",
            "subscription_id": r.get("subscriptionId", ""),
        })
    sev_order = {"Sev0": 0, "Sev1": 1, "Sev2": 2, "Sev3": 3, "Sev4": 4}
    items.sort(key=lambda x: sev_order.get(x["severity"], 9))
    return items


# ── Monitoring coverage (agent presence) ──────────────────────────────────────

def get_monitoring_coverage(subscription_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Per-machine monitoring coverage: is an Azure Monitor / Log Analytics agent
    installed on each native VM and Arc-enabled server?"""
    try:
        machines = query_resource_graph(_MACHINES_KQL, subscription_ids, max_results=20000)
    except Exception as exc:
        logger.warning("monitoring: machines query failed: %s", exc)
        machines = []
    try:
        exts = query_resource_graph(_AGENT_EXT_KQL, subscription_ids, max_results=20000)
    except Exception as exc:
        logger.warning("monitoring: agent extension query failed: %s", exc)
        exts = []

    agent_by_machine: Dict[str, str] = {}
    for e in exts:
        mid = (e.get("machineId") or "").lower()
        et = e.get("extType") or ""
        if mid:
            # prefer a real monitoring agent label over a dependency agent
            if mid not in agent_by_machine or et in _MONITOR_AGENTS:
                agent_by_machine[mid] = et

    items: List[Dict[str, Any]] = []
    for m in machines:
        mid = (m.get("id") or "").lower()
        agent = agent_by_machine.get(mid)
        items.append({
            "machine_id": mid,
            "machine_name": m.get("name", "") or _name_from_id(mid),
            "machine_type": m.get("machineType", "AzureVM"),
            "os_type": m.get("osType", "") or m.get("osName", "") or "",
            "power_state": m.get("powerState", "") or m.get("status", "") or "",
            "resource_group": m.get("resourceGroup", ""),
            "subscription_id": m.get("subscriptionId", ""),
            "location": m.get("location", ""),
            "agent_installed": bool(agent),
            "agent_type": agent or "",
        })
    items.sort(key=lambda x: (x["agent_installed"], x["machine_name"]))
    return items


# ── Platform metrics (Azure Monitor) ──────────────────────────────────────────

_PERF_CACHE: Dict[str, Any] = {"data": None, "ts": 0.0, "limit": 0}
_PERF_TTL = 300


def get_platform_metrics(resources: List[Any], limit: int = 40) -> List[Dict[str, Any]]:
    """CPU / memory / disk / network utilisation via Azure Monitor. Prioritises
    resource types that actually emit utilisation metrics (VM / VMSS / AKS / App
    Service / SQL / Redis / Cosmos) so the table isn't dominated by storage
    accounts with no CPU/mem, surfaces power state + the right primary metric per
    type, fetches concurrently, and caches for 5 minutes. `resources` are
    dashboard resource objects/dicts."""
    import time as _time
    import concurrent.futures as _cf
    if _PERF_CACHE["data"] is not None and _PERF_CACHE["limit"] >= limit and (_time.time() - _PERF_CACHE["ts"]) < _PERF_TTL:
        return _PERF_CACHE["data"][:limit]

    from services import metrics_service

    def _attr(r, *names, default=""):
        for n in names:
            v = r.get(n) if isinstance(r, dict) else getattr(r, n, None)
            if v not in (None, ""):
                return v
        return default

    ranked = []
    for r in resources:
        rid = _attr(r, "resource_id", "id")
        rtype = (_attr(r, "resource_type", "type_full", "type") or "").lower()
        if not rid or not rtype:
            continue
        cost = _attr(r, "cost_mtd", "cost_current", default=0) or 0
        cost = float(cost) if isinstance(cost, (int, float)) else 0.0
        prio = _METRIC_PRIORITY.get(rtype, 5)
        ranked.append((prio, -cost, rid, rtype, r))
    # Compute / DB / web first (these emit utilisation), then everything else by cost.
    ranked.sort(key=lambda x: (x[0], x[1]))
    candidates = ranked[: max(limit + 30, 70)]

    def _fetch(item):
        prio, _neg, rid, rtype, r = item
        try:
            mr = metrics_service.get_resource_metrics(rid, rtype, _attr(r, "subscription_id"))
        except Exception as exc:
            logger.debug("monitoring: metrics failed for %s: %s", rid.split("/")[-1], exc)
            mr = None
        return (item, mr)

    fetched = []
    try:
        with _cf.ThreadPoolExecutor(max_workers=16) as ex:
            fetched = list(ex.map(_fetch, candidates))
    except Exception as exc:
        logger.warning("monitoring: concurrent metrics fetch failed: %s", exc)
        fetched = [_fetch(c) for c in candidates]

    out: List[Dict[str, Any]] = []
    for (prio, _neg_cost, rid, rtype, r), mr in fetched:
        if len(out) >= max(1, limit):
            break
        is_priority = prio <= 3
        has_data = mr is not None and (mr.has_any_activity or mr.primary_utilization is not None or mr.cpu is not None)
        # Skip non-priority resources with no usable metric (keeps the table focused
        # on things that actually report utilisation); always show priority types so
        # deallocated VMs remain visible (with their power state).
        if not is_priority and not has_data:
            continue
        out.append({
            "resource_id": rid,
            "resource_name": _attr(r, "resource_name", "name") or _name_from_id(rid),
            "resource_type": rtype,
            "resource_group": _attr(r, "resource_group"),
            "subscription_id": _attr(r, "subscription_id"),
            "location": _attr(r, "location", "region"),
            "power_state": _attr(r, "power_state", "status", "vm_status"),
            "primary_label": _PRIMARY_LABEL.get(rtype, "Util %"),
            "cpu": round(mr.cpu, 1) if mr and mr.cpu is not None else None,
            "memory": round(mr.memory, 1) if mr and mr.memory is not None else None,
            "disk": round(mr.disk, 1) if mr and mr.disk is not None else None,
            "network": round(mr.network, 1) if mr and mr.network is not None else None,
            "primary_utilization": round(mr.primary_utilization, 1) if mr and mr.primary_utilization is not None else None,
            "peak_utilization": round(mr.peak_utilization, 1) if mr and mr.peak_utilization is not None else None,
            "has_activity": bool(mr.has_any_activity) if mr else False,
        })
    _PERF_CACHE.update(data=out, ts=_time.time(), limit=limit)
    return out


# ── Log Analytics performance (Arc + on-prem via Azure Monitor Agent) ──────────

def get_la_perf(subscription_ids: Optional[List[str]] = None, hours: int = 24) -> Dict[str, Any]:
    """Best-effort Log Analytics query for agent-reported performance + heartbeat
    (covers Arc-enabled and on-prem machines). Returns available=False gracefully
    when no workspace exists or the query cannot run."""
    result: Dict[str, Any] = {"available": False, "workspaces": 0, "heartbeats": [], "perf": [], "note": ""}
    try:
        workspaces = query_resource_graph(_WORKSPACE_KQL, subscription_ids, max_results=200)
    except Exception as exc:
        logger.warning("monitoring: workspace discovery failed: %s", exc)
        workspaces = []
    result["workspaces"] = len(workspaces)
    if not workspaces:
        result["note"] = "No Log Analytics workspace found — Arc/on-prem performance requires the Azure Monitor Agent reporting to a workspace."
        return result

    try:
        from azure.monitor.query import LogsQueryClient, LogsQueryStatus
    except Exception as exc:
        logger.warning("monitoring: azure-monitor-query unavailable: %s", exc)
        result["note"] = "azure-monitor-query package not available."
        return result

    cred = get_credential()
    client = LogsQueryClient(cred)
    timespan = timedelta(hours=max(1, hours))
    hb_query = (
        "Heartbeat | summarize LastSeen=max(TimeGenerated) by Computer, OSType, Category "
        "| top 200 by LastSeen desc"
    )
    perf_query = (
        "Perf | where CounterName in ('% Processor Time','Available MBytes','% Used Memory','% Free Space') "
        "| summarize Avg=avg(CounterValue) by Computer, CounterName | top 400 by Avg desc"
    )
    for ws in workspaces:
        cust = ws.get("customerId")
        if not cust:
            continue
        try:
            hb = client.query_workspace(workspace_id=cust, query=hb_query, timespan=timespan)
            if getattr(hb, "status", None) == LogsQueryStatus.SUCCESS and hb.tables:
                for row in hb.tables[0].rows:
                    result["heartbeats"].append({
                        "computer": row[0], "os_type": row[1] if len(row) > 1 else "",
                        "category": row[2] if len(row) > 2 else "", "last_seen": str(row[-1]),
                        "workspace": ws.get("name", ""),
                    })
            pf = client.query_workspace(workspace_id=cust, query=perf_query, timespan=timespan)
            if getattr(pf, "status", None) == LogsQueryStatus.SUCCESS and pf.tables:
                for row in pf.tables[0].rows:
                    result["perf"].append({
                        "computer": row[0], "counter": row[1] if len(row) > 1 else "",
                        "avg": round(float(row[2]), 2) if len(row) > 2 and row[2] is not None else None,
                        "workspace": ws.get("name", ""),
                    })
            result["available"] = True
        except Exception as exc:
            logger.debug("monitoring: LA query failed for workspace %s: %s", ws.get("name"), exc)
            continue
    if not result["available"]:
        result["note"] = "Log Analytics workspace(s) found but no agent performance/heartbeat data was returned."
    return result


# ── Overview (rollup) ─────────────────────────────────────────────────────────

def get_monitoring_overview(subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Aggregate monitoring posture: machine coverage, health rollup, alert rollup."""
    coverage = get_monitoring_coverage(subscription_ids)
    health = get_resource_health(subscription_ids)
    alerts = get_fired_alerts(subscription_ids)

    total_machines = len(coverage)
    azure_vms = sum(1 for c in coverage if c["machine_type"] == "AzureVM")
    arc_machines = sum(1 for c in coverage if c["machine_type"] == "Arc")
    agent_covered = sum(1 for c in coverage if c["agent_installed"])
    coverage_pct = round(agent_covered / total_machines * 100, 1) if total_machines else 0.0

    health_roll = {"Available": 0, "Degraded": 0, "Unavailable": 0, "Unknown": 0}
    for h in health:
        st = h["availability_state"]
        health_roll[st] = health_roll.get(st, 0) + 1
    unhealthy = health_roll.get("Degraded", 0) + health_roll.get("Unavailable", 0)

    sev_roll = {"Sev0": 0, "Sev1": 0, "Sev2": 0, "Sev3": 0, "Sev4": 0}
    fired = 0
    for a in alerts:
        sev_roll[a["severity"]] = sev_roll.get(a["severity"], 0) + 1
        if (a.get("monitor_condition") or "").lower() == "fired" or (a.get("state") or "").lower() in ("new", "acknowledged"):
            fired += 1

    return {
        "total_machines": total_machines,
        "azure_vms": azure_vms,
        "arc_machines": arc_machines,
        "agent_covered": agent_covered,
        "uncovered": total_machines - agent_covered,
        "coverage_pct": coverage_pct,
        "health": health_roll,
        "unhealthy": unhealthy,
        "health_tracked": len(health),
        "alerts": sev_roll,
        "alerts_fired": fired,
        "alerts_critical": sev_roll.get("Sev0", 0) + sev_roll.get("Sev1", 0),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_sources": {
            "azure_resource_graph": True,
            "machines": total_machines,
            "health_records": len(health),
            "alerts": len(alerts),
        },
    }
