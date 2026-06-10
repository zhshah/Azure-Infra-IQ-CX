"""
backup_enhanced_service.py — Comprehensive Azure Backup & DR Analysis.

Queries Azure Resource Graph for:
  1. Recovery Services Vaults (RSV) — properties, redundancy, soft-delete, CRR
  2. Backup Vaults (new-style) — properties, redundancy
  3. Protected Items in RSV — VM backup items with vault/source region comparison
  4. Backup Instances in Backup Vault — AKS, Blobs, PostgreSQL, Disks
  5. Recent Backup Jobs — success/failure/in-progress
  6. ASR Replication Items — cross-region VM replication
  7. Backup Policies — retention details

Produces:
  - Region of Choice (RoC) advisory: VMs backed up in same region as source
  - Vault health analysis: LRS vaults, soft-delete disabled, CRR not enabled
  - Backup job success/failure metrics
  - DR replication gaps for VMs
  - Charts data for the frontend dashboard
"""
from __future__ import annotations

import logging
import time
import threading
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .resource_graph_service import query_resource_graph
from .azure_auth import get_subscription_ids

logger = logging.getLogger(__name__)

# ── Region of Choice defaults (from MS Engineering Team Content) ───────────

ROC_DEFAULT_REGIONS = {
    "primary":   "swedencentral",
    "secondary": "switzerlandnorth",
}

ROC_DISPLAY = {
    "swedencentral":    "Sweden Central",
    "switzerlandnorth": "Switzerland North",
    "italynorth":       "Italy North",
}

# Regions that have no native paired region (ROC is critical)
ROC_CRITICAL_REGIONS = {
    "qatarcentral", "uaenorth", "uaecentral",
    "israelcentral", "italynorth", "polandcentral",
    "mexicocentral", "spaincentral", "austriaeast",
    "belgiumcentral", "chilecentral", "malaysiawest",
    "newzealandnorth", "taiwannorth",
}

# Supported RoC workloads (from engineering docs)
ROC_SUPPORTED_WORKLOADS = [
    "IaaS VM (General Purpose)",
    "SQL in VM",
    "SAP HANA in VM",
    "Confidential VM (PMK / mHSM CMK)",
    "Azure Files (up to 10 TB / 10M files)",
    "Azure Blobs",
    "ADLS Gen2",
    "AKS (up to 100 nodes, 1 TB disks)",
    "PostgreSQL Flexible Server (up to 1 TB)",
]

# ── KQL Queries ────────────────────────────────────────────────────────────

_RSV_QUERY = """
resources
| where type == "microsoft.recoveryservices/vaults"
| extend sku_name = tostring(properties.sku.name),
         sku_tier = tostring(properties.sku.tier),
         provisioningState = tostring(properties.provisioningState),
         privateEndpointState = tostring(properties.privateEndpointStateForBackup),
         publicNetworkAccess = tostring(properties.publicNetworkAccess),
         softDeleteState = tostring(properties.enhancedSecurityState),
         immutability = tostring(properties.securitySettings.immutabilitySettings.state),
         softDeleteSettings = properties.securitySettings.softDeleteSettings,
         crossRegionRestore = tostring(properties.redundancySettings.crossRegionRestore),
         stdTierStorageRedundancy = tostring(properties.redundancySettings.standardTierStorageRedundancy)
| project id, name, resourceGroup, subscriptionId, location,
          sku_name, sku_tier, provisioningState,
          privateEndpointState, publicNetworkAccess,
          softDeleteState, immutability,
          softDeleteEnabled = tostring(softDeleteSettings.softDeleteState),
          softDeleteRetentionDays = toint(softDeleteSettings.softDeleteRetentionPeriodInDays),
          crossRegionRestore,
          storageRedundancy = stdTierStorageRedundancy
"""

_BACKUP_VAULT_QUERY = """
resources
| where type == "microsoft.dataprotection/backupvaults"
| extend storageType = tostring(properties.storageSettings[0].type),
         datastoreType = tostring(properties.storageSettings[0].datastoreType),
         softDelete = tostring(properties.securitySettings.softDeleteSettings.state),
         softDeleteRetention = toint(properties.securitySettings.softDeleteSettings.retentionDurationInDays),
         immutability = tostring(properties.securitySettings.immutabilitySettings.state),
         crossRegionRestore = tostring(properties.featureSettings.crossRegionRestoreSettings.state)
| project id, name, resourceGroup, subscriptionId, location,
          storageType, datastoreType, softDelete, softDeleteRetention,
          immutability, crossRegionRestore
"""

_PROTECTED_ITEMS_QUERY = """
recoveryservicesresources
| where type == "microsoft.recoveryservices/vaults/backupfabrics/protectioncontainers/protecteditems"
| extend vaultId = tostring(split(id, "/backupFabrics/")[0]),
         sourceResourceId = tostring(properties.sourceResourceId),
         protectionStatus = tostring(properties.protectionStatus),
         protectionState = tostring(properties.protectionState),
         lastBackupStatus = tostring(properties.lastBackupStatus),
         lastBackupTime = tostring(properties.lastBackupTime),
         policyId = tostring(properties.policyId),
         backupManagementType = tostring(properties.backupManagementType),
         workloadType = tostring(properties.workloadType),
         healthStatus = tostring(properties.healthStatus),
         friendlyName = tostring(properties.friendlyName)
| project id, name, resourceGroup, subscriptionId, location,
          vaultId, sourceResourceId, protectionStatus, protectionState,
          lastBackupStatus, lastBackupTime, policyId,
          backupManagementType, workloadType, healthStatus, friendlyName
"""

_BACKUP_INSTANCES_QUERY = """
resources
| where type == "microsoft.dataprotection/backupvaults/backupinstances"
| extend vaultId = tostring(split(id, "/backupInstances/")[0]),
         sourceResourceId = tostring(properties.dataSourceInfo.resourceID),
         datasourceType = tostring(properties.dataSourceInfo.datasourceType),
         protectionStatus = tostring(properties.protectionStatus.status),
         friendlyName = tostring(properties.friendlyName),
         policyId = tostring(properties.policyInfo.policyId)
| project id, name, resourceGroup, subscriptionId, location,
          vaultId, sourceResourceId, datasourceType,
          protectionStatus, friendlyName, policyId
"""

_BACKUP_JOBS_QUERY = """
recoveryservicesresources
| where type == "microsoft.recoveryservices/vaults/backupjobs"
| extend vaultId = tostring(split(id, "/backupJobs/")[0]),
         operation = tostring(properties.operation),
         status = tostring(properties.status),
         startTime = tostring(properties.startTime),
         endTime = tostring(properties.endTime),
         backupManagementType = tostring(properties.backupManagementType),
         entityFriendlyName = tostring(properties.entityFriendlyName),
         duration = tostring(properties.duration)
| project id, name, resourceGroup, subscriptionId, location,
          vaultId, operation, status, startTime, endTime,
          backupManagementType, entityFriendlyName, duration
| order by startTime desc
| take 500
"""

_ASR_REPLICATION_QUERY = """
recoveryservicesresources
| where type == "microsoft.recoveryservices/vaults/replicationfabrics/replicationprotectioncontainers/replicationprotecteditems"
| extend friendlyName = tostring(properties.friendlyName),
         protectionState = tostring(properties.protectionState),
         protectionStateDescription = tostring(properties.protectionStateDescription),
         primaryFabricFriendlyName = tostring(properties.primaryFabricFriendlyName),
         primaryFabricProvider = tostring(properties.customDetails.primaryFabricLocation),
         recoveryFabricFriendlyName = tostring(properties.recoveryFabricFriendlyName),
         recoveryLocation = tostring(properties.customDetails.recoveryFabricLocation),
         sourceResourceId = tostring(properties.providerSpecificDetails.fabricObjectId),
         replicationHealth = tostring(properties.replicationHealth),
         failoverHealth = tostring(properties.failoverHealth),
         testFailoverState = tostring(properties.testFailoverState),
         activeLocation = tostring(properties.activeLocation),
         lastSuccessfulTestFailover = tostring(properties.lastSuccessfulTestFailoverTime),
         lastSuccessfulFailover = tostring(properties.lastSuccessfulFailoverTime)
| project id, name, resourceGroup, subscriptionId, location,
          friendlyName, protectionState, protectionStateDescription,
          primaryFabricFriendlyName, primaryFabricProvider,
          recoveryFabricFriendlyName, recoveryLocation,
          sourceResourceId, replicationHealth, failoverHealth,
          testFailoverState, activeLocation,
          lastSuccessfulTestFailover, lastSuccessfulFailover
"""

_VM_QUERY = """
resources
| where type == "microsoft.compute/virtualmachines"
| project id, name, resourceGroup, subscriptionId, location,
          vmSize = tostring(properties.hardwareProfile.vmSize),
          osType = tostring(properties.storageProfile.osDisk.osType)
"""

_SQL_DB_QUERY = """
resources
| where type == "microsoft.sql/servers/databases"
| where name != "master"
| extend serverName = tostring(split(id, "/databases/")[0]),
         sku_name = tostring(sku.name),
         sku_tier = tostring(sku.tier),
         requestedBackupStorageRedundancy = tostring(properties.requestedBackupStorageRedundancy),
         currentBackupStorageRedundancy = tostring(properties.currentBackupStorageRedundancy),
         status = tostring(properties.status)
| project id, name, resourceGroup, subscriptionId, location,
          serverName, sku_name, sku_tier,
          requestedBackupStorageRedundancy, currentBackupStorageRedundancy, status
"""

_POSTGRES_QUERY = """
resources
| where type in~ ("microsoft.dbforpostgresql/flexibleservers", "microsoft.dbforpostgresql/servers")
| extend backupRetentionDays = toint(properties.backup.backupRetentionDays),
         geoRedundantBackup = tostring(properties.backup.geoRedundantBackup),
         sku_name = tostring(sku.name),
         sku_tier = tostring(sku.tier),
         storageSize = toint(properties.storage.storageSizeGB)
| project id, name, type, resourceGroup, subscriptionId, location,
          backupRetentionDays, geoRedundantBackup, sku_name, sku_tier, storageSize
"""

_MYSQL_QUERY = """
resources
| where type in~ ("microsoft.dbformysql/flexibleservers", "microsoft.dbformysql/servers")
| extend backupRetentionDays = toint(properties.backup.backupRetentionDays),
         geoRedundantBackup = tostring(properties.backup.geoRedundantBackup),
         sku_name = tostring(sku.name),
         sku_tier = tostring(sku.tier)
| project id, name, type, resourceGroup, subscriptionId, location,
          backupRetentionDays, geoRedundantBackup, sku_name, sku_tier
"""

_COSMOS_DB_QUERY = """
resources
| where type == "microsoft.documentdb/databaseaccounts"
| extend backupPolicy = tostring(properties.backupPolicy.type),
         backupIntervalHours = toint(properties.backupPolicy.periodicModeProperties.backupIntervalInMinutes) / 60,
         backupRetentionHours = toint(properties.backupPolicy.periodicModeProperties.backupRetentionIntervalInHours),
         continuousBackupTier = tostring(properties.backupPolicy.continuousModeProperties.tier),
         isVirtualNetworkFilterEnabled = tobool(properties.isVirtualNetworkFilterEnabled)
| project id, name, resourceGroup, subscriptionId, location,
          backupPolicy, backupIntervalHours, backupRetentionHours,
          continuousBackupTier, isVirtualNetworkFilterEnabled
"""


# ── In-memory cache ────────────────────────────────────────────────────────

_backup_cache: Dict[str, Any] = {}
_backup_cache_lock = threading.Lock()
_CACHE_TTL_SECONDS = 900  # 15 min default


def _is_cache_valid() -> bool:
    ts = _backup_cache.get("_ts")
    if ts is None:
        return False
    return (time.time() - ts) < _CACHE_TTL_SECONDS


def get_backup_cache_info() -> Dict[str, Any]:
    """Return cache metadata for the frontend."""
    ts = _backup_cache.get("_ts")
    return {
        "cached": ts is not None,
        "cached_at": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else None,
        "ttl_seconds": _CACHE_TTL_SECONDS,
        "stale": not _is_cache_valid(),
    }


# ── Helpers ────────────────────────────────────────────────────────────────

def _loc(s: str) -> str:
    return (s or "").lower().replace(" ", "")


def _vault_location(vault_id: str, vaults_map: dict) -> str:
    return _loc(vaults_map.get(vault_id.lower(), {}).get("location", ""))


def _resource_short_type(rid: str) -> str:
    """Extract short resource type from ID like 'VM', 'SQL DB', etc."""
    rid_l = rid.lower()
    if "/virtualmachines/" in rid_l:
        return "Virtual Machine"
    if "/databases/" in rid_l and "/servers/" in rid_l:
        return "SQL Database"
    if "/managedclusters/" in rid_l:
        return "AKS Cluster"
    if "/storageaccounts/" in rid_l:
        return "Storage Account"
    if "/flexibleservers/" in rid_l:
        if "postgresql" in rid_l:
            return "PostgreSQL"
        if "mysql" in rid_l:
            return "MySQL"
    return "Other"


# ── Main analysis function ─────────────────────────────────────────────────

def get_enhanced_backup_analysis(
    subscription_ids: Optional[List[str]] = None,
    refresh: bool = False,
) -> Dict[str, Any]:
    """
    Run comprehensive backup & DR analysis using Azure Resource Graph.
    Returns a dict consumed by the /api/backup/enhanced endpoint.

    Results are cached in-memory with a 15-min TTL. Pass refresh=True
    to force a re-query.
    """
    # ── Return cached data if still valid ──────────────────────────────
    if not refresh and _is_cache_valid():
        cached = _backup_cache.get("_data")
        if cached is not None:
            logger.info("Enhanced backup analysis: returning cached result (age=%.0fs)",
                        time.time() - _backup_cache.get("_ts", 0))
            return {**cached, "_cache": get_backup_cache_info()}

    sub_ids = subscription_ids or get_subscription_ids()

    # ── Run all queries IN PARALLEL ────────────────────────────────────
    logger.info("Enhanced backup analysis: running %d Resource Graph queries in parallel …", 11)
    t0 = time.time()

    query_map = {
        "rsv":           _RSV_QUERY,
        "bv":            _BACKUP_VAULT_QUERY,
        "protected":     _PROTECTED_ITEMS_QUERY,
        "backup_inst":   _BACKUP_INSTANCES_QUERY,
        "jobs":          _BACKUP_JOBS_QUERY,
        "asr":           _ASR_REPLICATION_QUERY,
        "vms":           _VM_QUERY,
        "sql":           _SQL_DB_QUERY,
        "pg":            _POSTGRES_QUERY,
        "mysql":         _MYSQL_QUERY,
        "cosmos":        _COSMOS_DB_QUERY,
    }

    results: Dict[str, List] = {}
    with ThreadPoolExecutor(max_workers=8) as executor:
        future_to_key = {
            executor.submit(query_resource_graph, kql, sub_ids): key
            for key, kql in query_map.items()
        }
        for future in as_completed(future_to_key):
            key = future_to_key[future]
            try:
                results[key] = future.result()
            except Exception as exc:
                logger.error("Parallel query '%s' failed: %s", key, exc)
                results[key] = []

    rsv_rows         = results["rsv"]
    bv_rows          = results["bv"]
    protected_rows   = results["protected"]
    backup_inst_rows = results["backup_inst"]
    job_rows         = results["jobs"]
    asr_rows         = results["asr"]
    vm_rows          = results["vms"]
    sql_rows         = results["sql"]
    pg_rows          = results["pg"]
    mysql_rows       = results["mysql"]
    cosmos_rows      = results["cosmos"]

    elapsed = time.time() - t0

    logger.info(
        "Enhanced backup: %d RSVs, %d BVs, %d protected items, %d backup instances, "
        "%d jobs, %d ASR items, %d VMs, %d SQL DBs, %d PG, %d MySQL, %d Cosmos (%.1fs parallel)",
        len(rsv_rows), len(bv_rows), len(protected_rows), len(backup_inst_rows),
        len(job_rows), len(asr_rows), len(vm_rows), len(sql_rows),
        len(pg_rows), len(mysql_rows), len(cosmos_rows), elapsed,
    )

    # ── Build maps ─────────────────────────────────────────────────────
    rsv_map: Dict[str, Dict] = {}
    for v in rsv_rows:
        rsv_map[v["id"].lower()] = v

    bv_map: Dict[str, Dict] = {}
    for v in bv_rows:
        bv_map[v["id"].lower()] = v

    vm_map: Dict[str, Dict] = {}
    for vm in vm_rows:
        vm_map[vm["id"].lower()] = vm

    # Protected source IDs (lowercased)
    protected_source_ids: set = set()
    for pi in protected_rows:
        src = (pi.get("sourceResourceId") or "").lower()
        if src:
            protected_source_ids.add(src)
    for bi in backup_inst_rows:
        src = (bi.get("sourceResourceId") or "").lower()
        if src:
            protected_source_ids.add(src)

    # ASR replicated source IDs
    asr_source_ids: set = set()
    for ar in asr_rows:
        src = (ar.get("sourceResourceId") or "").lower()
        if src:
            asr_source_ids.add(src)

    # ── 1. Vault Analysis ──────────────────────────────────────────────
    vault_findings = []
    rsv_redundancy_counts = Counter()
    rsv_softdelete_counts = Counter()
    total_vaults = len(rsv_rows) + len(bv_rows)

    for v in rsv_rows:
        redundancy = (v.get("storageRedundancy") or "Unknown").strip()
        if not redundancy or redundancy == "":
            redundancy = "Unknown"
        rsv_redundancy_counts[redundancy] += 1

        sd_state = (v.get("softDeleteEnabled") or "").lower()
        is_sd_enabled = sd_state in ("enabled", "alwayson")
        rsv_softdelete_counts["Enabled" if is_sd_enabled else "Disabled"] += 1

        crr = (v.get("crossRegionRestore") or "").lower()
        is_crr = crr in ("enabled", "true")

        # Flag LRS vaults
        if redundancy.lower() in ("locallyredundant", "lrs"):
            vault_findings.append({
                "vault_id": v["id"],
                "vault_name": v["name"],
                "vault_type": "Recovery Services Vault",
                "location": v.get("location", ""),
                "resource_group": v.get("resourceGroup", ""),
                "finding_type": "lrs_vault",
                "severity": "high",
                "title": f"RSV \"{v['name']}\" uses Locally Redundant Storage",
                "description": (
                    f"Recovery Services Vault \"{v['name']}\" in {v.get('location', 'unknown')} "
                    "uses Locally Redundant Storage (LRS). If the primary region experiences "
                    "a disaster, all backup data would be lost. Geo-Redundant Storage (GRS) "
                    "or Zone-Redundant Storage (ZRS) is recommended for production workloads."
                ),
                "recommendation": "Change vault redundancy to GRS or ZRS for production workloads.",
            })

        # Flag soft-delete disabled
        if not is_sd_enabled:
            vault_findings.append({
                "vault_id": v["id"],
                "vault_name": v["name"],
                "vault_type": "Recovery Services Vault",
                "location": v.get("location", ""),
                "resource_group": v.get("resourceGroup", ""),
                "finding_type": "softdelete_disabled",
                "severity": "critical",
                "title": f"Soft-delete DISABLED on RSV \"{v['name']}\"",
                "description": (
                    f"Soft-delete is not enabled on Recovery Services Vault \"{v['name']}\". "
                    "Without soft-delete, backup data deleted by ransomware, malicious actors, "
                    "or accidental operations is permanently lost with no recovery option."
                ),
                "recommendation": (
                    "Enable soft-delete with a minimum 14-day retention. "
                    "Consider enabling 'Always-On' soft-delete for critical vaults."
                ),
            })

        # Flag CRR not enabled on GRS vaults
        if redundancy.lower() in ("georedundant", "grs") and not is_crr:
            vault_findings.append({
                "vault_id": v["id"],
                "vault_name": v["name"],
                "vault_type": "Recovery Services Vault",
                "location": v.get("location", ""),
                "resource_group": v.get("resourceGroup", ""),
                "finding_type": "crr_not_enabled",
                "severity": "medium",
                "title": f"Cross-Region Restore not enabled on GRS vault \"{v['name']}\"",
                "description": (
                    f"Vault \"{v['name']}\" uses Geo-Redundant Storage but Cross-Region "
                    "Restore (CRR) is not enabled. Without CRR, you cannot restore backups "
                    "to the secondary region during a regional outage."
                ),
                "recommendation": "Enable Cross-Region Restore on this GRS vault for DR readiness.",
            })

    # Backup Vault analysis
    bv_redundancy_counts = Counter()
    bv_softdelete_counts = Counter()
    for v in bv_rows:
        st = (v.get("storageType") or "Unknown").strip()
        bv_redundancy_counts[st] += 1

        sd = (v.get("softDelete") or "").lower()
        is_sd = sd in ("on", "enabled", "alwayson")
        bv_softdelete_counts["Enabled" if is_sd else "Disabled"] += 1

        if st.lower() in ("locallyredundant", "lrs"):
            vault_findings.append({
                "vault_id": v["id"],
                "vault_name": v["name"],
                "vault_type": "Backup Vault",
                "location": v.get("location", ""),
                "resource_group": v.get("resourceGroup", ""),
                "finding_type": "lrs_vault",
                "severity": "high",
                "title": f"Backup Vault \"{v['name']}\" uses Locally Redundant Storage",
                "description": (
                    f"Backup Vault \"{v['name']}\" in {v.get('location', 'unknown')} "
                    "uses LRS. Data is not replicated to another region."
                ),
                "recommendation": "Switch to GRS or ZRS for production backup vaults.",
            })

        if not is_sd:
            vault_findings.append({
                "vault_id": v["id"],
                "vault_name": v["name"],
                "vault_type": "Backup Vault",
                "location": v.get("location", ""),
                "resource_group": v.get("resourceGroup", ""),
                "finding_type": "softdelete_disabled",
                "severity": "critical",
                "title": f"Soft-delete DISABLED on Backup Vault \"{v['name']}\"",
                "description": (
                    f"Soft-delete is not enabled on Backup Vault \"{v['name']}\". "
                    "Backup data can be permanently deleted without recovery."
                ),
                "recommendation": "Enable soft-delete with at least 14-day retention.",
            })

    # ── 2. Region of Choice (RoC) Analysis ─────────────────────────────
    roc_findings = []
    same_region_backup_count = 0
    cross_region_backup_count = 0
    roc_critical_vms = 0

    for pi in protected_rows:
        src_id = (pi.get("sourceResourceId") or "").lower()
        vault_id = (pi.get("vaultId") or "").lower()
        if not src_id or not vault_id:
            continue

        vault_info = rsv_map.get(vault_id, {})
        vault_loc = _loc(vault_info.get("location", ""))
        source_loc = ""

        # Get source resource location
        if src_id in vm_map:
            source_loc = _loc(vm_map[src_id].get("location", ""))
        else:
            # Use the protected item's own location as fallback
            source_loc = _loc(pi.get("location", ""))

        if not vault_loc or not source_loc:
            continue

        workload_type = pi.get("workloadType") or pi.get("backupManagementType") or "Unknown"

        if vault_loc == source_loc:
            same_region_backup_count += 1

            # Check if source is in a critical RoC region
            is_roc_critical = source_loc in ROC_CRITICAL_REGIONS

            roc_findings.append({
                "resource_id": pi.get("sourceResourceId", ""),
                "resource_name": pi.get("friendlyName", ""),
                "workload_type": workload_type,
                "source_region": source_loc,
                "vault_name": vault_info.get("name", ""),
                "vault_region": vault_loc,
                "vault_id": pi.get("vaultId", ""),
                "severity": "high" if is_roc_critical else "medium",
                "is_roc_critical_region": is_roc_critical,
                "finding_type": "same_region_backup",
                "title": (
                    f"\"{pi.get('friendlyName', 'Unknown')}\" backup vault in SAME region as source"
                ),
                "description": (
                    f"The backup for \"{pi.get('friendlyName', 'Unknown')}\" ({workload_type}) "
                    f"is stored in {source_loc}, the same region as the source resource. "
                    "In a regional disaster, both the source and backup data would be unavailable. "
                    + (
                        f"This region ({source_loc}) has NO native paired region — "
                        "Region of Choice (RoC) is critical for off-site protection."
                        if is_roc_critical else
                        "Consider using Region of Choice (RoC) to back up to an alternate region."
                    )
                ),
                "recommendation": (
                    f"Use Azure Backup Region of Choice (RoC) to create a vault in "
                    f"{ROC_DISPLAY.get(ROC_DEFAULT_REGIONS['primary'], 'Sweden Central')} "
                    f"(primary) or "
                    f"{ROC_DISPLAY.get(ROC_DEFAULT_REGIONS['secondary'], 'Switzerland North')} "
                    f"(secondary) and migrate backup protection."
                ),
                "last_backup_status": pi.get("lastBackupStatus", ""),
                "health_status": pi.get("healthStatus", ""),
            })
            if is_roc_critical:
                roc_critical_vms += 1
        else:
            cross_region_backup_count += 1

    # ── 3. Unprotected Resource Analysis ───────────────────────────────
    unprotected = []

    # VMs without backup
    for vm in vm_rows:
        vm_id = vm["id"].lower()
        if vm_id not in protected_source_ids:
            unprotected.append({
                "resource_id": vm["id"],
                "resource_name": vm["name"],
                "resource_type": "Microsoft.Compute/virtualMachines",
                "resource_group": vm.get("resourceGroup", ""),
                "location": vm.get("location", ""),
                "category": "Virtual Machine",
                "severity": "critical",
                "title": f"VM \"{vm['name']}\" has NO backup",
                "description": (
                    f"Virtual Machine \"{vm['name']}\" in {vm.get('location', 'unknown')} "
                    "has no Azure Backup protection. Disk corruption, ransomware, or "
                    "accidental deletion would cause permanent data loss."
                ),
                "recommendation": (
                    "Enroll in a Recovery Services Vault backup policy with daily frequency "
                    "and minimum 30-day retention. Use application-consistent snapshots for VMs running databases."
                ),
            })

    # SQL DBs with LRS backup redundancy
    for db in sql_rows:
        redundancy = (db.get("currentBackupStorageRedundancy") or db.get("requestedBackupStorageRedundancy") or "").lower()
        if redundancy in ("local", "lrs", "locallyredundant"):
            unprotected.append({
                "resource_id": db["id"],
                "resource_name": db["name"],
                "resource_type": "Microsoft.Sql/servers/databases",
                "resource_group": db.get("resourceGroup", ""),
                "location": db.get("location", ""),
                "category": "SQL Database",
                "severity": "high",
                "sku": f"{db.get('sku_tier', '')} / {db.get('sku_name', '')}",
                "title": f"SQL DB \"{db['name']}\" uses Locally Redundant backup",
                "description": (
                    f"SQL Database \"{db['name']}\" ({db.get('sku_tier', 'unknown')} tier) "
                    "uses Locally Redundant backup storage. In a regional disaster, "
                    "all point-in-time restore data would be lost."
                ),
                "recommendation": (
                    "Change backup storage redundancy to Geo-Redundant (GRS) or Zone-Redundant (ZRS) "
                    "for production databases. This can be configured in the SQL Database backup settings."
                ),
                "backup_redundancy": redundancy,
            })

    # PostgreSQL with no geo-redundant backup
    for pg in pg_rows:
        geo = (pg.get("geoRedundantBackup") or "").lower()
        if geo != "enabled":
            retention = pg.get("backupRetentionDays", 7)
            unprotected.append({
                "resource_id": pg["id"],
                "resource_name": pg["name"],
                "resource_type": pg.get("type", "Microsoft.DBforPostgreSQL/flexibleServers"),
                "resource_group": pg.get("resourceGroup", ""),
                "location": pg.get("location", ""),
                "category": "PostgreSQL",
                "severity": "medium",
                "title": f"PostgreSQL \"{pg['name']}\" — geo-redundant backup disabled",
                "description": (
                    f"PostgreSQL server \"{pg['name']}\" has {retention}-day PITR retention "
                    "but geo-redundant backup is not enabled. Cross-region recovery is not possible."
                ),
                "recommendation": (
                    "Enable geo-redundant backup for cross-region protection. "
                    "Consider Azure Backup for PostgreSQL for vaulted backup with up to 10-year retention."
                ),
                "backup_retention_days": retention,
                "backup_redundancy": "local",
            })

    # MySQL with no geo-redundant backup
    for my in mysql_rows:
        geo = (my.get("geoRedundantBackup") or "").lower()
        if geo != "enabled":
            retention = my.get("backupRetentionDays", 7)
            unprotected.append({
                "resource_id": my["id"],
                "resource_name": my["name"],
                "resource_type": my.get("type", "Microsoft.DBforMySQL/flexibleServers"),
                "resource_group": my.get("resourceGroup", ""),
                "location": my.get("location", ""),
                "category": "MySQL",
                "severity": "medium",
                "title": f"MySQL \"{my['name']}\" — geo-redundant backup disabled",
                "description": (
                    f"MySQL server \"{my['name']}\" has {retention}-day retention "
                    "but geo-redundant backup is not enabled."
                ),
                "recommendation": "Enable geo-redundant backup for cross-region protection.",
                "backup_retention_days": retention,
                "backup_redundancy": "local",
            })

    # Cosmos DB backup analysis
    cosmos_findings = []
    for c in cosmos_rows:
        policy = (c.get("backupPolicy") or "Periodic").strip()
        if policy.lower() == "periodic":
            interval = c.get("backupIntervalHours", 0) or 0
            retention = c.get("backupRetentionHours", 0) or 0
            if retention < 168:  # < 7 days in hours
                cosmos_findings.append({
                    "resource_id": c["id"],
                    "resource_name": c["name"],
                    "resource_type": "Microsoft.DocumentDB/databaseAccounts",
                    "resource_group": c.get("resourceGroup", ""),
                    "location": c.get("location", ""),
                    "category": "Cosmos DB",
                    "severity": "medium",
                    "title": f"Cosmos DB \"{c['name']}\" — short periodic backup retention",
                    "description": (
                        f"Cosmos DB \"{c['name']}\" uses Periodic backup with {retention}h retention "
                        f"(~{retention // 24}d) and {interval}h interval. Consider switching to "
                        "Continuous backup for finer-grained point-in-time restore."
                    ),
                    "recommendation": "Switch to Continuous backup mode for granular PITR capability.",
                    "backup_policy": policy,
                    "backup_interval_hours": interval,
                    "backup_retention_hours": retention,
                })

    # ── 4. Backup Job Analysis ─────────────────────────────────────────
    job_status_counts = Counter()
    job_failures = []
    for j in job_rows:
        status = (j.get("status") or "Unknown").strip()
        job_status_counts[status] += 1
        if status.lower() in ("failed", "completedwithwarnings"):
            job_failures.append({
                "job_id": j["id"],
                "entity_name": j.get("entityFriendlyName", ""),
                "operation": j.get("operation", ""),
                "status": status,
                "start_time": j.get("startTime", ""),
                "end_time": j.get("endTime", ""),
                "vault_id": j.get("vaultId", ""),
                "backup_type": j.get("backupManagementType", ""),
            })

    # ── 5. ASR / DR Replication Analysis ───────────────────────────────
    asr_findings = []
    asr_health_counts = Counter()
    asr_protection_counts = Counter()

    for ar in asr_rows:
        health = ar.get("replicationHealth") or "Unknown"
        asr_health_counts[health] += 1
        state = ar.get("protectionState") or "Unknown"
        asr_protection_counts[state] += 1

        asr_findings.append({
            "resource_name": ar.get("friendlyName", ""),
            "source_region": ar.get("primaryFabricProvider", ar.get("primaryFabricFriendlyName", "")),
            "target_region": ar.get("recoveryLocation", ar.get("recoveryFabricFriendlyName", "")),
            "replication_health": health,
            "failover_health": ar.get("failoverHealth", ""),
            "protection_state": state,
            "test_failover_state": ar.get("testFailoverState", ""),
            "last_test_failover": ar.get("lastSuccessfulTestFailover", ""),
            "active_location": ar.get("activeLocation", ""),
        })

    # VMs with no ASR replication
    vms_without_dr = []
    for vm in vm_rows:
        vm_id = vm["id"].lower()
        if vm_id not in asr_source_ids:
            vms_without_dr.append({
                "resource_id": vm["id"],
                "resource_name": vm["name"],
                "resource_group": vm.get("resourceGroup", ""),
                "location": vm.get("location", ""),
                "vm_size": vm.get("vmSize", ""),
                "os_type": vm.get("osType", ""),
            })

    # ── 6. Build Charts Data ───────────────────────────────────────────
    # Chart: Backup coverage by resource type
    coverage_by_type = {}
    all_vms = len(vm_rows)
    backed_vms = sum(1 for vm in vm_rows if vm["id"].lower() in protected_source_ids)
    coverage_by_type["Virtual Machines"] = {
        "protected": backed_vms,
        "unprotected": all_vms - backed_vms,
        "total": all_vms,
    }

    # Chart: Vault redundancy distribution
    combined_redundancy = Counter()
    for k, v in rsv_redundancy_counts.items():
        combined_redundancy[k] += v
    for k, v in bv_redundancy_counts.items():
        combined_redundancy[k] += v

    # Chart: Soft-delete status
    combined_softdelete = Counter()
    for k, v in rsv_softdelete_counts.items():
        combined_softdelete[k] += v
    for k, v in bv_softdelete_counts.items():
        combined_softdelete[k] += v

    # Chart: RoC analysis
    roc_chart = {
        "Same Region": same_region_backup_count,
        "Cross Region": cross_region_backup_count,
    }

    # Chart: Unprotected by category
    unprotected_by_cat = Counter()
    for u in unprotected:
        unprotected_by_cat[u["category"]] += 1

    # Chart: Job status
    job_chart = dict(job_status_counts)

    # Chart: DB backup redundancy
    db_redundancy = Counter()
    for db in sql_rows:
        r = (db.get("currentBackupStorageRedundancy") or "Unknown").strip()
        db_redundancy[r] += 1
    for pg in pg_rows:
        geo = (pg.get("geoRedundantBackup") or "Disabled")
        db_redundancy["Geo" if geo.lower() == "enabled" else "Local"] += 1
    for my in mysql_rows:
        geo = (my.get("geoRedundantBackup") or "Disabled")
        db_redundancy["Geo" if geo.lower() == "enabled" else "Local"] += 1

    # Chart: VMs without backup by region
    vm_no_backup_by_region = Counter()
    for u in unprotected:
        if u["category"] == "Virtual Machine":
            vm_no_backup_by_region[u.get("location", "Unknown")] += 1

    # Chart: ASR replication health
    asr_chart = dict(asr_health_counts)

    charts = {
        "vault_redundancy": dict(combined_redundancy),
        "soft_delete_status": dict(combined_softdelete),
        "roc_distribution": roc_chart,
        "unprotected_by_category": dict(unprotected_by_cat),
        "job_status": job_chart,
        "db_backup_redundancy": dict(db_redundancy),
        "vm_no_backup_by_region": dict(vm_no_backup_by_region),
        "asr_health": asr_chart,
        "coverage_by_type": coverage_by_type,
    }

    # ── 7. Summary KPIs ────────────────────────────────────────────────
    total_protected = len(protected_source_ids)
    total_vms = len(vm_rows)
    vms_backed_up = backed_vms
    vms_not_backed = total_vms - vms_backed_up
    total_unprotected = len(unprotected)
    lrs_vaults = sum(1 for f in vault_findings if f["finding_type"] == "lrs_vault")
    sd_disabled = sum(1 for f in vault_findings if f["finding_type"] == "softdelete_disabled")
    failed_jobs = sum(1 for j in job_failures)
    asr_replicated = len(asr_rows)
    vms_no_dr = len(vms_without_dr)

    kpis = {
        "total_vaults": total_vaults,
        "total_rsv": len(rsv_rows),
        "total_bv": len(bv_rows),
        "total_protected_items": total_protected,
        "total_vms": total_vms,
        "vms_backed_up": vms_backed_up,
        "vms_not_backed_up": vms_not_backed,
        "vm_backup_coverage_pct": round(vms_backed_up / max(total_vms, 1) * 100, 1),
        "same_region_backups": same_region_backup_count,
        "cross_region_backups": cross_region_backup_count,
        "roc_critical_items": roc_critical_vms,
        "lrs_vaults": lrs_vaults,
        "softdelete_disabled": sd_disabled,
        "failed_jobs": failed_jobs,
        "total_unprotected_resources": total_unprotected,
        "asr_replicated_items": asr_replicated,
        "vms_without_dr": vms_no_dr,
        "total_sql_dbs": len(sql_rows),
        "total_pg_servers": len(pg_rows),
        "total_mysql_servers": len(mysql_rows),
        "total_cosmos_accounts": len(cosmos_rows),
    }

    # ── 8. RoC Advisory ────────────────────────────────────────────────
    roc_advisory = {
        "default_primary_region": ROC_DEFAULT_REGIONS["primary"],
        "default_secondary_region": ROC_DEFAULT_REGIONS["secondary"],
        "default_primary_display": ROC_DISPLAY.get(ROC_DEFAULT_REGIONS["primary"], "Sweden Central"),
        "default_secondary_display": ROC_DISPLAY.get(ROC_DEFAULT_REGIONS["secondary"], "Switzerland North"),
        "supported_workloads": ROC_SUPPORTED_WORKLOADS,
        "critical_regions": sorted(ROC_CRITICAL_REGIONS),
        "total_same_region": same_region_backup_count,
        "total_cross_region": cross_region_backup_count,
        "roc_critical_count": roc_critical_vms,
        "description": (
            "Azure Backup Region of Choice (RoC) enables off-site data protection "
            "in non-paired regions. For regions without native paired regions (e.g., "
            "Qatar Central, UAE North), RoC is critical for cross-region backup. "
            "The recommended target regions are Sweden Central (primary) and "
            "Switzerland North (secondary)."
        ),
        "migration_steps": [
            "Stop protection and retain existing backup data in the source vault",
            "Unregister the container from the source vault",
            "Create a new Recovery Services Vault in the target RoC region",
            "Register the container to the new RoC vault",
            "Configure backup policy and start protection",
        ],
        "cost_note": (
            "Additional network egress charges and a marked-up Protected Instance "
            "fee will apply for RoC backup. Storage costs continue for retained data "
            "in the source vault."
        ),
    }

    logger.info(
        "Enhanced backup analysis complete: %d vault findings, %d RoC warnings, "
        "%d unprotected, %d failed jobs, %d ASR items, %d cosmos findings (total %.1fs)",
        len(vault_findings), len(roc_findings), len(unprotected),
        len(job_failures), len(asr_findings), len(cosmos_findings),
        time.time() - t0,
    )

    result = {
        "kpis": kpis,
        "vault_findings": vault_findings,
        "roc_findings": roc_findings,
        "roc_advisory": roc_advisory,
        "unprotected_resources": unprotected,
        "cosmos_findings": cosmos_findings,
        "job_failures": job_failures,
        "asr_findings": asr_findings,
        "vms_without_dr": vms_without_dr,
        "charts": charts,
        "vaults": {
            "rsv": rsv_rows,
            "backup_vaults": bv_rows,
        },
    }

    # ── Store in cache ─────────────────────────────────────────────────
    with _backup_cache_lock:
        _backup_cache["_data"] = result
        _backup_cache["_ts"] = time.time()

    return {**result, "_cache": get_backup_cache_info()}


# ── RPO / RTO Compliance Matrix ────────────────────────────────────────────

# Default RPO/RTO targets by business tier
_RPO_RTO_TARGETS = {
    "critical":  {"rpo_hours": 1,  "rto_hours": 1,  "label": "Tier 1 — Mission Critical"},
    "important": {"rpo_hours": 4,  "rto_hours": 4,  "label": "Tier 2 — Business Important"},
    "standard":  {"rpo_hours": 24, "rto_hours": 24, "label": "Tier 3 — Standard"},
    "dev_test":  {"rpo_hours": 72, "rto_hours": 72, "label": "Tier 4 — Dev/Test"},
}

# Estimated RPO/RTO from backup type
_BACKUP_RPO_MAP = {
    "VM":              {"rpo_hours": 24, "rto_hours": 2,  "method": "Daily VM snapshot"},
    "SQL_DB_PITR":     {"rpo_hours": 0.25, "rto_hours": 0.5, "method": "Continuous PITR (15-min log backup)"},
    "SQL_IN_VM":       {"rpo_hours": 0.25, "rto_hours": 1, "method": "SQL workload backup (15-min RPO)"},
    "AKS":             {"rpo_hours": 24, "rto_hours": 4,  "method": "AKS Backup (daily)"},
    "STORAGE":         {"rpo_hours": 24, "rto_hours": 1,  "method": "Azure Backup for Files/Blobs"},
    "POSTGRESQL":      {"rpo_hours": 0.25, "rto_hours": 1, "method": "PITR (continuous WAL backup)"},
    "MYSQL":           {"rpo_hours": 0.25, "rto_hours": 1, "method": "PITR (continuous binlog backup)"},
    "COSMOS":          {"rpo_hours": 0, "rto_hours": 0.01, "method": "Continuous backup (point-in-time)"},
    "ASR_REPLICATED":  {"rpo_hours": 0.25, "rto_hours": 0.5, "method": "ASR replication (near real-time)"},
    "NONE":            {"rpo_hours": float("inf"), "rto_hours": float("inf"), "method": "No backup"},
}


def _classify_business_tier(r: dict) -> str:
    """Infer business tier from tags or name heuristics."""
    tags = r.get("tags") or {}
    # Check common tag keys
    for key in ("environment", "env", "tier", "criticality"):
        val = str(tags.get(key, "")).lower()
        if val in ("production", "prod", "critical", "tier1", "p1"):
            return "critical"
        if val in ("staging", "stg", "important", "tier2", "p2"):
            return "important"
        if val in ("development", "dev", "test", "sandbox", "tier4", "p4"):
            return "dev_test"
    # Name-based heuristic
    name = (r.get("name") or r.get("resource_name") or "").lower()
    if any(t in name for t in ("prod", "prd", "live")):
        return "important"
    if any(t in name for t in ("dev", "test", "sandbox", "demo")):
        return "dev_test"
    return "standard"


def build_rpo_rto_matrix(enhanced_data: Dict[str, Any]) -> Dict[str, Any]:
    """Build RPO/RTO compliance matrix from enhanced backup analysis data."""
    kpis = enhanced_data.get("kpis", {})
    vaults = enhanced_data.get("vaults", {})
    unprotected = enhanced_data.get("unprotected_resources", [])

    entries: list[dict] = []

    # Protected VMs
    protected_vms = set()
    for item in (enhanced_data.get("_protected_source_ids", set()) or set()):
        protected_vms.add(item.lower())

    # ASR replicated VMs (best RPO/RTO)
    asr_vms = set()
    for asr in enhanced_data.get("asr_findings", []):
        src = (asr.get("source_resource_id") or "").lower()
        if src:
            asr_vms.add(src)

    # All VMs from vaults data
    rsv_rows = vaults.get("rsv", [])

    # Process unprotected resources
    for u in unprotected:
        tier = _classify_business_tier(u)
        target = _RPO_RTO_TARGETS[tier]
        backup_type = "NONE"
        current = _BACKUP_RPO_MAP[backup_type]

        entries.append({
            "resource_name": u.get("name", "Unknown"),
            "resource_type": u.get("type", ""),
            "resource_group": u.get("resource_group", ""),
            "category": u.get("category", ""),
            "location": u.get("location", ""),
            "business_tier": tier,
            "target_rpo_hours": target["rpo_hours"],
            "target_rto_hours": target["rto_hours"],
            "current_rpo_hours": None,
            "current_rto_hours": None,
            "backup_method": "No backup configured",
            "rpo_compliant": False,
            "rto_compliant": False,
            "compliance_status": "non_compliant",
            "gap_severity": "critical" if tier in ("critical", "important") else "high",
        })

    # Summary
    total = len(entries)
    compliant = sum(1 for e in entries if e["compliance_status"] == "compliant")
    partial = sum(1 for e in entries if e["compliance_status"] == "partial")
    non_compliant = sum(1 for e in entries if e["compliance_status"] == "non_compliant")

    by_tier = {}
    for e in entries:
        t = e["business_tier"]
        if t not in by_tier:
            by_tier[t] = {"total": 0, "compliant": 0, "non_compliant": 0}
        by_tier[t]["total"] += 1
        if e["compliance_status"] == "compliant":
            by_tier[t]["compliant"] += 1
        else:
            by_tier[t]["non_compliant"] += 1

    tier_summary = []
    for tier_key in ("critical", "important", "standard", "dev_test"):
        info = by_tier.get(tier_key, {"total": 0, "compliant": 0, "non_compliant": 0})
        target = _RPO_RTO_TARGETS[tier_key]
        tier_summary.append({
            "tier": tier_key,
            "label": target["label"],
            "target_rpo": f"{target['rpo_hours']}h",
            "target_rto": f"{target['rto_hours']}h",
            **info,
            "compliance_pct": round(info["compliant"] / max(info["total"], 1) * 100, 1),
        })

    return {
        "total_assessed": total,
        "compliant": compliant,
        "partial": partial,
        "non_compliant": non_compliant,
        "compliance_pct": round(compliant / max(total, 1) * 100, 1),
        "tier_summary": tier_summary,
        "entries": entries,
        "targets": _RPO_RTO_TARGETS,
    }


# ── Ransomware Readiness Assessment ────────────────────────────────────────

def build_ransomware_readiness(enhanced_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Assess ransomware readiness based on vault security posture.
    Produces a 0-100 score and detailed findings.
    """
    kpis = enhanced_data.get("kpis", {})
    vault_findings = enhanced_data.get("vault_findings", [])
    vaults = enhanced_data.get("vaults", {})
    rsv_list = vaults.get("rsv", [])
    bv_list = vaults.get("backup_vaults", [])
    total_vaults = len(rsv_list) + len(bv_list)

    checks: list[dict] = []
    score = 100  # Start at 100 and deduct for issues

    # 1. Soft Delete status
    sd_disabled = sum(1 for f in vault_findings if f.get("finding_type") == "softdelete_disabled")
    sd_total = total_vaults
    sd_pct = round((sd_total - sd_disabled) / max(sd_total, 1) * 100)
    deduction = min(25, int(sd_disabled / max(sd_total, 1) * 25))
    score -= deduction
    checks.append({
        "check": "Soft Delete Enabled",
        "icon": "🗑️",
        "description": "Soft delete prevents permanent backup deletion for 14 days, protecting against ransomware wiping backups",
        "status": "pass" if sd_disabled == 0 else ("warn" if sd_disabled < sd_total else "fail"),
        "detail": f"{sd_total - sd_disabled}/{sd_total} vaults have soft delete enabled",
        "coverage_pct": sd_pct,
        "weight": 25,
        "deduction": deduction,
    })

    # 2. Immutability (check for immutable vaults)
    immutable_count = sum(
        1 for v in rsv_list
        if (v.get("immutabilityState") or "").lower() in ("locked", "unlocked")
    )
    imm_pct = round(immutable_count / max(total_vaults, 1) * 100)
    deduction = min(20, 20 - int(imm_pct / 100 * 20))
    score -= deduction
    checks.append({
        "check": "Immutable Vaults",
        "icon": "🔒",
        "description": "Immutable vaults prevent any backup modification/deletion, providing strongest ransomware protection",
        "status": "pass" if immutable_count >= total_vaults * 0.5 else ("warn" if immutable_count > 0 else "fail"),
        "detail": f"{immutable_count}/{total_vaults} vaults have immutability configured",
        "coverage_pct": imm_pct,
        "weight": 20,
        "deduction": deduction,
    })

    # 3. Cross-Region Backup (GRS/CRR)
    lrs_count = sum(1 for f in vault_findings if f.get("finding_type") == "lrs_vault")
    grs_pct = round((total_vaults - lrs_count) / max(total_vaults, 1) * 100)
    deduction = min(20, int(lrs_count / max(total_vaults, 1) * 20))
    score -= deduction
    checks.append({
        "check": "Cross-Region Redundancy (GRS/CRR)",
        "icon": "🌍",
        "description": "GRS/CRR stores backup copies in a secondary region, ensuring recovery even if the primary region is compromised",
        "status": "pass" if lrs_count == 0 else ("warn" if lrs_count < total_vaults else "fail"),
        "detail": f"{total_vaults - lrs_count}/{total_vaults} vaults use GRS or have CRR enabled",
        "coverage_pct": grs_pct,
        "weight": 20,
        "deduction": deduction,
    })

    # 4. Network Isolation (Private Endpoints)
    pe_count = sum(
        1 for v in rsv_list
        if (v.get("privateEndpointState") or "").lower() not in ("", "none")
    )
    pe_pct = round(pe_count / max(len(rsv_list), 1) * 100)
    deduction = min(15, 15 - int(pe_pct / 100 * 15))
    score -= deduction
    checks.append({
        "check": "Network Isolation (Private Endpoints)",
        "icon": "🛡️",
        "description": "Private endpoints prevent public internet access to backup vaults, reducing attack surface",
        "status": "pass" if pe_count >= len(rsv_list) * 0.5 else ("warn" if pe_count > 0 else "fail"),
        "detail": f"{pe_count}/{len(rsv_list)} Recovery Services Vaults use private endpoints",
        "coverage_pct": pe_pct,
        "weight": 15,
        "deduction": deduction,
    })

    # 5. Backup Coverage (are all critical resources backed up?)
    vm_coverage = kpis.get("vm_backup_coverage_pct", 0)
    unprotected_count = kpis.get("total_unprotected_resources", 0)
    deduction = min(20, int((100 - vm_coverage) / 100 * 20))
    score -= deduction
    checks.append({
        "check": "Backup Coverage",
        "icon": "✅",
        "description": "Complete backup coverage ensures all workloads can be restored after a ransomware attack",
        "status": "pass" if vm_coverage >= 90 else ("warn" if vm_coverage >= 50 else "fail"),
        "detail": f"{vm_coverage:.0f}% VM backup coverage, {unprotected_count} total unprotected resources",
        "coverage_pct": round(vm_coverage),
        "weight": 20,
        "deduction": deduction,
    })

    score = max(0, score)
    grade = "A" if score >= 90 else "B" if score >= 75 else "C" if score >= 60 else "D" if score >= 40 else "F"
    risk_level = "low" if score >= 80 else "medium" if score >= 60 else "high" if score >= 40 else "critical"

    return {
        "score": score,
        "grade": grade,
        "risk_level": risk_level,
        "total_vaults": total_vaults,
        "checks": checks,
        "recommendations": [
            c for c in checks if c["status"] != "pass"
        ],
        "summary": (
            f"Ransomware readiness score: {score}/100 (Grade {grade}). "
            f"{sum(1 for c in checks if c['status'] == 'pass')}/{len(checks)} security controls passed. "
            f"Risk level: {risk_level}."
        ),
    }
