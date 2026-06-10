"""
Azure Arc On-Premise Service — Discovery, Security, Monitoring, Governance & BCDR.

Uses Azure Resource Graph to discover Arc-enabled machines and related data:
- microsoft.hybridcompute/machines (Arc servers)
- microsoft.hybridcompute/machines/extensions (installed extensions)
- microsoft.azurearcdata/sqlserverinstances (Arc SQL instances)
- microsoft.azurearcdata/sqlserverinstances/databases (Arc SQL databases)
- microsoft.azurearcdata/sqlserverinstances/availabilitygroups (AG)

Provides a comprehensive picture of on-premise infrastructure managed through Arc.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional
from datetime import datetime

from .resource_graph_service import query_resource_graph
from .azure_auth import get_credential, get_subscription_ids

logger = logging.getLogger(__name__)


# ── KQL Queries ──────────────────────────────────────────────────────────────

_ARC_MACHINES_KQL = """
resources
| where type == "microsoft.hybridcompute/machines"
| extend
    status          = tostring(properties.status),
    osType          = tostring(properties.osProfile.osType),
    osName          = tostring(properties.osName),
    osVersion       = tostring(properties.osVersion),
    osSku           = tostring(properties.osSku),
    manufacturer    = tostring(properties.detectedProperties.manufacturer),
    model           = tostring(properties.detectedProperties.model),
    processor       = tostring(properties.detectedProperties.processorNames),
    cores           = toint(properties.detectedProperties.logicalCoreCount),
    totalMemoryGB   = todouble(properties.detectedProperties.totalPhysicalMemoryInBytes) / 1073741824,
    domainName      = tostring(properties.domainName),
    machineFqdn     = tostring(properties.machineFqdn),
    agentVersion    = tostring(properties.agentVersion),
    lastStatusChange= tostring(properties.lastStatusChange),
    cloudProvider   = tostring(properties.cloudMetadata.provider),
    licenseStatus   = tostring(properties.licenseProfile.licenseStatus),
    esuEnabled      = tostring(properties.licenseProfile.esuProfile.esuEligibility)
| project id, name, location, resourceGroup, subscriptionId, tags,
          status, osType, osName, osVersion, osSku,
          manufacturer, model, processor, cores, totalMemoryGB,
          domainName, machineFqdn, agentVersion, lastStatusChange,
          cloudProvider, licenseStatus, esuEnabled
"""

_ARC_EXTENSIONS_KQL = """
resources
| where type == "microsoft.hybridcompute/machines/extensions"
| extend
    machineId        = tostring(split(id, '/extensions/')[0]),
    extensionName    = tostring(properties.type),
    publisher        = tostring(properties.publisher),
    provisioningState= tostring(properties.provisioningState),
    extensionVersion = tostring(properties.typeHandlerVersion)
| project id, machineId, extensionName, publisher, provisioningState, extensionVersion, resourceGroup, subscriptionId
"""

_ARC_SQL_INSTANCES_KQL = """
resources
| where type == "microsoft.azurearcdata/sqlserverinstances"
| extend
    containerResourceId = tostring(properties.containerResourceId),
    status              = tostring(properties.status),
    version             = tostring(properties.version),
    edition             = tostring(properties.edition),
    patchLevel          = tostring(properties.patchLevel),
    collation           = tostring(properties.collation),
    tcpPorts            = tostring(properties.tcpStaticPorts),
    productId           = tostring(properties.productId),
    licenseType         = tostring(properties.licenseType),
    vCore               = tostring(properties.vCore),
    instanceName        = tostring(properties.instanceName),
    currentVersion      = tostring(properties.currentVersion)
| project id, name, location, resourceGroup, subscriptionId, tags,
          containerResourceId, status, version, edition, patchLevel,
          collation, tcpPorts, productId, licenseType, vCore, instanceName, currentVersion
"""

_ARC_SQL_DATABASES_KQL = """
resources
| where type == "microsoft.azurearcdata/sqlserverinstances/databases"
| extend
    databaseName       = name,
    sqlInstanceId      = tostring(split(id, '/databases/')[0]),
    state              = tostring(properties.databaseOptions.state),
    recoveryMode       = tostring(properties.databaseOptions.recoveryModel),
    compatLevel        = tostring(properties.databaseOptions.compatibilityLevel),
    sizeMB             = todouble(properties.sizeMB),
    spaceAvailableMB   = todouble(properties.spaceAvailableMB),
    isReadOnly         = tobool(properties.databaseOptions.isReadOnly),
    backupStatus       = tostring(properties.backupInformation.lastFullBackup),
    lastLogBackup      = tostring(properties.backupInformation.lastLogBackup)
| project id, databaseName, sqlInstanceId, resourceGroup, subscriptionId,
          state, recoveryMode, compatLevel, sizeMB, spaceAvailableMB,
          isReadOnly, backupStatus, lastLogBackup
"""

_ARC_SQL_AG_KQL = """
resources
| where type == "microsoft.azurearcdata/sqlserverinstances/availabilitygroups"
| extend
    sqlInstanceId  = tostring(split(id, '/availabilityGroups/')[0]),
    agName         = name,
    replicas       = tostring(properties.info.replicas),
    failoverMode   = tostring(properties.info.failoverMode),
    availabilityMode = tostring(properties.info.availabilityMode),
    primaryReplica = tostring(properties.info.primaryReplicaServerName),
    healthState    = tostring(properties.info.healthState)
| project id, agName, sqlInstanceId, resourceGroup, subscriptionId,
          replicas, failoverMode, availabilityMode, primaryReplica, healthState
"""

_ARC_MACHINE_LICENSES_KQL = """
resources
| where type == "microsoft.hybridcompute/licenses"
| project id, name, location, resourceGroup, subscriptionId, tags, properties
"""


# ── Core discovery functions ─────────────────────────────────────────────────

def discover_arc_machines(subscription_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Discover all Azure Arc-enabled machines across subscriptions."""
    return query_resource_graph(_ARC_MACHINES_KQL, subscription_ids)


def discover_arc_extensions(subscription_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Discover all extensions installed on Arc machines."""
    return query_resource_graph(_ARC_EXTENSIONS_KQL, subscription_ids)


def discover_arc_sql_instances(subscription_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Discover all Arc-enabled SQL Server instances."""
    return query_resource_graph(_ARC_SQL_INSTANCES_KQL, subscription_ids)


def discover_arc_sql_databases(subscription_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Discover all databases on Arc SQL instances."""
    return query_resource_graph(_ARC_SQL_DATABASES_KQL, subscription_ids)


def discover_arc_sql_availability_groups(subscription_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Discover availability groups on Arc SQL."""
    return query_resource_graph(_ARC_SQL_AG_KQL, subscription_ids)


def discover_arc_licenses(subscription_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Discover Arc license resources (ESU, etc)."""
    return query_resource_graph(_ARC_MACHINE_LICENSES_KQL, subscription_ids)


# ── Extension classification ─────────────────────────────────────────────────

EXTENSION_CATEGORIES = {
    # Monitoring
    "MicrosoftMonitoringAgent":         {"category": "monitoring", "label": "Log Analytics Agent (MMA)"},
    "AzureMonitorLinuxAgent":           {"category": "monitoring", "label": "Azure Monitor Agent (Linux)"},
    "AzureMonitorWindowsAgent":         {"category": "monitoring", "label": "Azure Monitor Agent (Windows)"},
    "OmsAgentForLinux":                 {"category": "monitoring", "label": "OMS Agent (Linux)"},
    # Security
    "MDE.Linux":                        {"category": "security", "label": "Microsoft Defender for Endpoint (Linux)"},
    "MDE.Windows":                      {"category": "security", "label": "Microsoft Defender for Endpoint (Windows)"},
    "AzureSecurityLinuxAgent":          {"category": "security", "label": "Azure Security Agent (Linux)"},
    "AzureSecurityWindowsAgent":        {"category": "security", "label": "Azure Security Agent (Windows)"},
    "Qualys":                           {"category": "security", "label": "Qualys Vulnerability Scanner"},
    # Change tracking
    "ChangeTracking-Linux":             {"category": "change_tracking", "label": "Change Tracking (Linux)"},
    "ChangeTracking-Windows":           {"category": "change_tracking", "label": "Change Tracking (Windows)"},
    # Update management
    "MicrosoftDependencyAgent":         {"category": "dependency", "label": "Dependency Agent"},
    "LinuxPatchExtension":              {"category": "patching", "label": "Linux Patch Extension"},
    "WindowsPatchExtension":            {"category": "patching", "label": "Windows Patch Extension"},
    "WindowsOsUpdateExtension":         {"category": "patching", "label": "Windows OS Update Extension"},
    # SQL
    "WindowsAgent.SqlServer":           {"category": "sql", "label": "SQL Server Extension (Windows)"},
    "LinuxAgent.SqlServer":             {"category": "sql", "label": "SQL Server Extension (Linux)"},
    # Custom script
    "CustomScriptExtension":            {"category": "automation", "label": "Custom Script Extension"},
    "CustomScript":                     {"category": "automation", "label": "Custom Script (Linux)"},
    # Admin
    "AdminCenter":                      {"category": "admin", "label": "Windows Admin Center"},
}

def classify_extension(ext_name: str) -> Dict[str, str]:
    """Classify an extension by name into category and label."""
    return EXTENSION_CATEGORIES.get(ext_name, {"category": "other", "label": ext_name})


# ── Comprehensive Arc summary ────────────────────────────────────────────────

def get_arc_summary(subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Build a comprehensive summary of all Arc resources.
    Returns dashboard-ready data for the On-Premise module.
    """
    machines = discover_arc_machines(subscription_ids)
    extensions = discover_arc_extensions(subscription_ids)
    sql_instances = discover_arc_sql_instances(subscription_ids)
    sql_databases = discover_arc_sql_databases(subscription_ids)
    sql_ags = discover_arc_sql_availability_groups(subscription_ids)

    # Build extension map: machineId -> list of extensions
    ext_map: Dict[str, List[Dict]] = {}
    for ext in extensions:
        mid = ext.get("machineId", "").lower()
        if mid:
            ext_map.setdefault(mid, []).append(ext)

    # Build SQL instance map: containerResourceId -> SQL instances
    sql_map: Dict[str, List[Dict]] = {}
    for sql in sql_instances:
        container = sql.get("containerResourceId", "").lower()
        if container:
            sql_map.setdefault(container, []).append(sql)

    # Build SQL DB map: sqlInstanceId -> databases
    db_map: Dict[str, List[Dict]] = {}
    for db in sql_databases:
        inst_id = db.get("sqlInstanceId", "").lower()
        if inst_id:
            db_map.setdefault(inst_id, []).append(db)

    # Build AG map: sqlInstanceId -> AGs
    ag_map: Dict[str, List[Dict]] = {}
    for ag in sql_ags:
        inst_id = ag.get("sqlInstanceId", "").lower()
        if inst_id:
            ag_map.setdefault(inst_id, []).append(ag)

    # Enrich machines
    enriched_machines = []
    for m in machines:
        mid = m.get("id", "").lower()
        m_exts = ext_map.get(mid, [])
        m_sqls = sql_map.get(mid, [])
        classified_exts = [classify_extension(e.get("extensionName", "")) for e in m_exts]

        # Security coverage
        has_monitoring = any(c["category"] == "monitoring" for c in classified_exts)
        has_security = any(c["category"] == "security" for c in classified_exts)
        has_patching = any(c["category"] == "patching" for c in classified_exts)
        has_change_tracking = any(c["category"] == "change_tracking" for c in classified_exts)
        has_sql_ext = any(c["category"] == "sql" for c in classified_exts)

        # SQL enrichment
        sql_info = []
        for sql in m_sqls:
            sql_id = sql.get("id", "").lower()
            sql["databases"] = db_map.get(sql_id, [])
            sql["availability_groups"] = ag_map.get(sql_id, [])
            sql_info.append(sql)

        enriched_machines.append({
            **m,
            "extensions": m_exts,
            "extension_categories": list(set(c["category"] for c in classified_exts)),
            "classified_extensions": classified_exts,
            "sql_instances": sql_info,
            "coverage": {
                "monitoring": has_monitoring,
                "security": has_security,
                "patching": has_patching,
                "change_tracking": has_change_tracking,
                "sql_extension": has_sql_ext,
            },
        })

    # Aggregate stats
    total = len(enriched_machines)
    connected = sum(1 for m in enriched_machines if m.get("status") == "Connected")
    disconnected = total - connected
    windows_count = sum(1 for m in enriched_machines if (m.get("osType") or "").lower() == "windows")
    linux_count = sum(1 for m in enriched_machines if (m.get("osType") or "").lower() == "linux")
    has_sql = sum(1 for m in enriched_machines if m.get("sql_instances"))
    total_sql_instances = sum(len(m.get("sql_instances", [])) for m in enriched_machines)
    total_databases = sum(
        len(db_map.get(sql.get("id", "").lower(), []))
        for m in enriched_machines for sql in m.get("sql_instances", [])
    )
    total_ags = sum(
        len(ag_map.get(sql.get("id", "").lower(), []))
        for m in enriched_machines for sql in m.get("sql_instances", [])
    )

    # Coverage stats
    monitoring_coverage = (sum(1 for m in enriched_machines if m["coverage"]["monitoring"]) / total * 100) if total else 0
    security_coverage = (sum(1 for m in enriched_machines if m["coverage"]["security"]) / total * 100) if total else 0
    patching_coverage = (sum(1 for m in enriched_machines if m["coverage"]["patching"]) / total * 100) if total else 0
    change_tracking_coverage = (sum(1 for m in enriched_machines if m["coverage"]["change_tracking"]) / total * 100) if total else 0

    # By location
    by_location: Dict[str, int] = {}
    for m in enriched_machines:
        loc = m.get("location", "unknown")
        by_location[loc] = by_location.get(loc, 0) + 1

    # By resource group
    by_rg: Dict[str, Dict] = {}
    for m in enriched_machines:
        rg = m.get("resourceGroup", "unknown")
        if rg not in by_rg:
            by_rg[rg] = {"count": 0, "windows": 0, "linux": 0, "sql_count": 0}
        by_rg[rg]["count"] += 1
        if (m.get("osType") or "").lower() == "windows":
            by_rg[rg]["windows"] += 1
        else:
            by_rg[rg]["linux"] += 1
        by_rg[rg]["sql_count"] += len(m.get("sql_instances", []))

    # By subscription
    by_sub: Dict[str, Dict] = {}
    for m in enriched_machines:
        sub = m.get("subscriptionId", "unknown")
        if sub not in by_sub:
            by_sub[sub] = {"count": 0, "connected": 0, "disconnected": 0}
        by_sub[sub]["count"] += 1
        if m.get("status") == "Connected":
            by_sub[sub]["connected"] += 1
        else:
            by_sub[sub]["disconnected"] += 1

    # By OS version
    by_os: Dict[str, int] = {}
    for m in enriched_machines:
        os_label = m.get("osSku") or m.get("osName") or m.get("osType") or "Unknown"
        by_os[os_label] = by_os.get(os_label, 0) + 1

    # Extension distribution
    ext_dist: Dict[str, int] = {}
    for m in enriched_machines:
        for c in m.get("classified_extensions", []):
            lbl = c["label"]
            ext_dist[lbl] = ext_dist.get(lbl, 0) + 1

    # BCDR readiness
    bcdr = _compute_bcdr_readiness(enriched_machines, sql_databases, sql_ags)

    # Governance — tag compliance
    tagged = sum(1 for m in enriched_machines if m.get("tags") and len(m["tags"]) > 0)
    tag_compliance = (tagged / total * 100) if total else 0

    # ESU eligible
    esu_eligible = sum(1 for m in enriched_machines if m.get("esuEnabled") == "Eligible")

    return {
        "has_data": total > 0,
        "total_machines": total,
        "connected": connected,
        "disconnected": disconnected,
        "windows_count": windows_count,
        "linux_count": linux_count,
        "has_sql_count": has_sql,
        "total_sql_instances": total_sql_instances,
        "total_databases": total_databases,
        "total_availability_groups": total_ags,
        "coverage": {
            "monitoring_pct": round(monitoring_coverage, 1),
            "security_pct": round(security_coverage, 1),
            "patching_pct": round(patching_coverage, 1),
            "change_tracking_pct": round(change_tracking_coverage, 1),
        },
        "by_location": by_location,
        "by_resource_group": by_rg,
        "by_subscription": by_sub,
        "by_os": by_os,
        "extension_distribution": ext_dist,
        "bcdr": bcdr,
        "governance": {
            "tag_compliance_pct": round(tag_compliance, 1),
            "tagged_count": tagged,
            "untagged_count": total - tagged,
            "esu_eligible": esu_eligible,
        },
        "machines": enriched_machines,
        "sql_instances": sql_instances,
        "sql_databases": sql_databases,
        "sql_availability_groups": sql_ags,
    }


def _compute_bcdr_readiness(
    machines: List[Dict], databases: List[Dict], ags: List[Dict]
) -> Dict[str, Any]:
    """Compute BCDR readiness metrics for Arc machines and SQL."""
    total_machines = len(machines)
    total_dbs = len(databases)

    # SQL backup assessment
    dbs_with_backup = 0
    dbs_full_recovery = 0
    dbs_simple_recovery = 0
    for db in databases:
        if db.get("backupStatus"):
            dbs_with_backup += 1
        recovery = (db.get("recoveryMode") or "").lower()
        if recovery == "full":
            dbs_full_recovery += 1
        elif recovery == "simple":
            dbs_simple_recovery += 1

    # AG protection
    ag_protected_instances = set()
    for ag in ags:
        inst_id = ag.get("sqlInstanceId", "")
        if inst_id:
            ag_protected_instances.add(inst_id.lower())

    # Machine-level readiness
    machines_with_backup_ext = 0
    machines_with_monitoring = 0
    for m in machines:
        if m.get("coverage", {}).get("monitoring"):
            machines_with_monitoring += 1
        # Check for backup-related extensions
        for ext in m.get("extensions", []):
            ext_name = (ext.get("extensionName") or "").lower()
            if "backup" in ext_name or "recovery" in ext_name:
                machines_with_backup_ext += 1
                break

    db_backup_pct = (dbs_with_backup / total_dbs * 100) if total_dbs else 0
    ag_coverage_pct = (len(ag_protected_instances) / len(set(
        db.get("sqlInstanceId", "").lower() for db in databases if db.get("sqlInstanceId")
    )) * 100) if databases else 0

    # Overall BCDR score (weighted)
    score_components = []
    if total_dbs > 0:
        score_components.append(("db_backup", db_backup_pct, 0.3))
        score_components.append(("full_recovery", (dbs_full_recovery / total_dbs * 100), 0.2))
    if total_machines > 0:
        score_components.append(("monitoring", (machines_with_monitoring / total_machines * 100), 0.3))
    if databases:
        score_components.append(("ag_coverage", ag_coverage_pct, 0.2))

    overall_score = 0
    total_weight = sum(w for _, _, w in score_components) or 1
    for _, val, weight in score_components:
        overall_score += (val * weight / total_weight)

    return {
        "overall_score": round(overall_score, 1),
        "total_databases": total_dbs,
        "databases_with_backup": dbs_with_backup,
        "db_backup_pct": round(db_backup_pct, 1),
        "dbs_full_recovery": dbs_full_recovery,
        "dbs_simple_recovery": dbs_simple_recovery,
        "dbs_bulk_logged": total_dbs - dbs_full_recovery - dbs_simple_recovery,
        "ag_protected_instances": len(ag_protected_instances),
        "ag_coverage_pct": round(ag_coverage_pct, 1),
        "machines_with_monitoring": machines_with_monitoring,
        "machines_with_backup_ext": machines_with_backup_ext,
        "total_availability_groups": len(ags),
        "risks": _identify_bcdr_risks(machines, databases, ags),
    }


def _identify_bcdr_risks(
    machines: List[Dict], databases: List[Dict], ags: List[Dict]
) -> List[Dict[str, str]]:
    """Identify specific BCDR risks for on-premise infrastructure."""
    risks: List[Dict[str, str]] = []

    # Disconnected machines
    disconnected = [m for m in machines if m.get("status") != "Connected"]
    if disconnected:
        risks.append({
            "severity": "high",
            "category": "connectivity",
            "finding": f"{len(disconnected)} Arc machine(s) disconnected — cannot monitor or manage remotely",
            "recommendation": "Check network connectivity and Arc agent status on disconnected machines",
            "affected_count": len(disconnected),
        })

    # Machines without monitoring
    no_monitoring = [m for m in machines if not m.get("coverage", {}).get("monitoring")]
    if no_monitoring:
        risks.append({
            "severity": "high",
            "category": "monitoring",
            "finding": f"{len(no_monitoring)} machine(s) without monitoring agent — blind spots in observability",
            "recommendation": "Deploy Azure Monitor Agent (AMA) to all Arc machines for centralized monitoring",
            "affected_count": len(no_monitoring),
        })

    # Machines without security agent
    no_security = [m for m in machines if not m.get("coverage", {}).get("security")]
    if no_security:
        risks.append({
            "severity": "critical",
            "category": "security",
            "finding": f"{len(no_security)} machine(s) without endpoint protection — vulnerable to threats",
            "recommendation": "Deploy Microsoft Defender for Endpoint on all Arc machines",
            "affected_count": len(no_security),
        })

    # Machines without patching
    no_patching = [m for m in machines if not m.get("coverage", {}).get("patching")]
    if no_patching:
        risks.append({
            "severity": "medium",
            "category": "patching",
            "finding": f"{len(no_patching)} machine(s) without patch management — risk of unpatched vulnerabilities",
            "recommendation": "Enable Azure Update Manager for automated patch management",
            "affected_count": len(no_patching),
        })

    # Databases without backups
    no_backup_dbs = [db for db in databases if not db.get("backupStatus")]
    if no_backup_dbs:
        risks.append({
            "severity": "critical",
            "category": "bcdr",
            "finding": f"{len(no_backup_dbs)} database(s) without recent backup — risk of data loss",
            "recommendation": "Configure regular full and log backups for all production databases",
            "affected_count": len(no_backup_dbs),
        })

    # Databases in Simple recovery mode (can't do point-in-time recovery)
    simple_dbs = [db for db in databases if (db.get("recoveryMode") or "").lower() == "simple"]
    if simple_dbs:
        risks.append({
            "severity": "medium",
            "category": "bcdr",
            "finding": f"{len(simple_dbs)} database(s) in Simple recovery mode — no point-in-time restore capability",
            "recommendation": "Switch production databases to Full recovery model and configure log backups",
            "affected_count": len(simple_dbs),
        })

    # SQL without AG (single point of failure)
    # Find SQL instances that aren't protected by any AG
    ag_instance_ids = set()
    for ag in ags:
        inst_id = ag.get("sqlInstanceId", "").lower()
        if inst_id:
            ag_instance_ids.add(inst_id)

    # Get unique SQL instance IDs from databases
    sql_instance_ids = set(db.get("sqlInstanceId", "").lower() for db in databases if db.get("sqlInstanceId"))
    unprotected = sql_instance_ids - ag_instance_ids
    if unprotected:
        risks.append({
            "severity": "high",
            "category": "bcdr",
            "finding": f"{len(unprotected)} SQL instance(s) without Availability Group — single point of failure",
            "recommendation": "Configure Always On Availability Groups for high availability and disaster recovery",
            "affected_count": len(unprotected),
        })

    return sorted(risks, key=lambda r: {"critical": 0, "high": 1, "medium": 2, "low": 3}.get(r["severity"], 4))


# ── Filtered queries (with filters) ─────────────────────────────────────────

def get_arc_machines_filtered(
    subscription_ids: Optional[List[str]] = None,
    resource_groups: Optional[List[str]] = None,
    os_type: Optional[str] = None,
    status: Optional[str] = None,
    tags: Optional[Dict[str, str]] = None,
) -> List[Dict[str, Any]]:
    """Get Arc machines with optional filters applied."""
    machines = discover_arc_machines(subscription_ids)

    if resource_groups:
        rg_lower = [rg.lower() for rg in resource_groups]
        machines = [m for m in machines if (m.get("resourceGroup") or "").lower() in rg_lower]

    if os_type:
        machines = [m for m in machines if (m.get("osType") or "").lower() == os_type.lower()]

    if status:
        machines = [m for m in machines if (m.get("status") or "").lower() == status.lower()]

    if tags:
        def matches_tags(m_tags):
            if not m_tags:
                return False
            for k, v in tags.items():
                if m_tags.get(k) != v:
                    return False
            return True
        machines = [m for m in machines if matches_tags(m.get("tags"))]

    return machines
