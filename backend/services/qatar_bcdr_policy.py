"""Qatar-region BCDR policy + per-service technical DR build playbook.

Single source of truth used by EVERY BCDR surface (BIA, project BCDR assessment,
environment AI BCDR analysis, consultant report) AND by both the PDF and Excel
exports so the same authoritative content appears everywhere with full parity.

Sources (Microsoft Qatar engineering — committed to the repo under
``Qatar_BCDR_Plan/``):
  * ``Azure_BCDR_Plan.docx`` — per-service DR build approach for Qatar Central.
  * ``Cross Region Backup (ROC) (1).docx`` — Region-of-Choice backup capability matrix.
  * ``Microsoft Region of Choice - MS Engineering Team Content.docx`` — RoC TSG.

Regional ground rules (Qatar customers):
  * Primary workloads stay in **Qatar Central** (data residency & sovereignty).
  * Non-AI / non-PaaS-gap workloads MUST stay in Qatar Central as the primary
    location. DR target = **West Europe** or **North Europe** (both NCSA- and
    NIA-certified for Qatar entities).
  * AI workloads (Azure OpenAI, Cognitive Services missing in Qatar Central)
    may run in **Sweden Central** as primary; DR target = **Sweden South**
    (Sweden Central's Microsoft-paired region).
  * Qatar Central has NO native paired region, so GRS / GZRS auto-pairing is
    unavailable; backup resiliency uses Azure Backup **Region of Choice
    (RoC)** vaults — typically in Sweden Central (preferred) or
    Switzerland North (second choice).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

# Region constants ------------------------------------------------------------

QATAR_PRIMARY_REGION = "qatarcentral"
QATAR_CERTIFIED_DR_REGIONS = ("westeurope", "northeurope")  # NCSA + NIA certified
QATAR_AI_PRIMARY_REGION = "swedencentral"
QATAR_AI_DR_REGION = "swedensouth"
QATAR_ROC_VAULT_REGIONS = ("swedencentral", "switzerlandnorth")  # RoC vault targets

REGION_DISPLAY = {
    "qatarcentral": "Qatar Central",
    "westeurope": "West Europe",
    "northeurope": "North Europe",
    "swedencentral": "Sweden Central",
    "swedensouth": "Sweden South",
    "switzerlandnorth": "Switzerland North",
    "uaenorth": "UAE North",
    "uaecentral": "UAE Central",
    "italynorth": "Italy North",
}


def display_region(slug: Optional[str]) -> str:
    if not slug:
        return ""
    s = str(slug).strip().lower().replace(" ", "")
    return REGION_DISPLAY.get(s, str(slug))


# Resource-type → AI/non-AI classification (drives region policy) -------------

# Types that are AI / cognitive workloads, which legitimately live outside
# Qatar Central (Azure OpenAI not GA in Qatar Central → Sweden Central).
AI_TYPE_SUBSTRINGS = (
    "/cognitiveservices/",
    "/openai",
    "microsoft.search/",          # Azure AI Search (often paired with AOAI)
    "microsoft.machinelearningservices/",
)

# Types that are eligible for Azure Backup RoC vault protection
# (sourced from the RoC support matrix table).
ROC_ELIGIBLE_TYPE_SUBSTRINGS = (
    "microsoft.compute/virtualmachines",              # IaaS VM (GP + Confidential)
    "microsoft.storage/storageaccounts",              # Blob, ADLS, Files
    "microsoft.dbforpostgresql/flexibleservers",      # PgSQL Flex
    "microsoft.containerservice/managedclusters",     # AKS
    "microsoft.sqlvirtualmachine/sqlvirtualmachines",  # SQL in VM
)


def is_ai_workload(resource_type: str) -> bool:
    """True when the resource type is AI/cognitive (legitimately not in Qatar Central)."""
    t = (resource_type or "").lower()
    return any(s in t for s in AI_TYPE_SUBSTRINGS)


def is_roc_eligible(resource_type: str) -> bool:
    """True when Azure Backup Region-of-Choice (RoC) covers this workload today."""
    t = (resource_type or "").lower()
    return any(s in t for s in ROC_ELIGIBLE_TYPE_SUBSTRINGS)


def recommend_dr_region(resource_type: str, current_region: str,
                        stated_dr_region: Optional[str] = None) -> str:
    """Return the policy-correct DR region for a resource.

    Honours the customer-stated target when supplied; otherwise applies the
    Qatar regional rules above.
    """
    if stated_dr_region:
        return display_region(stated_dr_region)
    cur = (current_region or "").lower().replace(" ", "")
    if is_ai_workload(resource_type):
        # AI workloads in Sweden Central → Sweden South paired region.
        return display_region(QATAR_AI_DR_REGION)
    if cur == QATAR_AI_PRIMARY_REGION:
        return display_region(QATAR_AI_DR_REGION)
    # Default for Qatar Central (and any other Qatar-customer non-AI workload):
    # West Europe (NCSA + NIA certified, also commonly used as paired Landing Zone).
    return display_region("westeurope")


# Per-service technical DR build playbook (Microsoft Qatar engineering) -------
# Keys are normalized short type names (case-insensitive contains-match).

SERVICE_DR_PLAYBOOK: Dict[str, Dict[str, str]] = {
    "microsoft.sql/servers/databases": {
        "service": "Azure SQL Database",
        "prereqs": "Secondary logical SQL server in the DR region (same tier/size). Configure VNet rules + firewall in DR.",
        "backup": "Automated backups (full, diff, log) — geo-redundant by default.",
        "dr": "Preferred: Auto-Failover Group (listener endpoint, near-zero RPO). Fallback: Geo-restore to DR region.",
        "rto": "≤60 sec (FOG) / hours (geo-restore)",
        "rpo": "≤5 sec (FOG) / ~1 h (geo-restore)",
        "ref": "https://learn.microsoft.com/azure/azure-sql/database/auto-failover-group-overview",
    },
    "microsoft.sql/managedinstances": {
        "service": "Azure SQL Managed Instance",
        "prereqs": "Secondary MI in DR region (same tier/size). VNet connectivity + DNS resolution between regions.",
        "backup": "Automated full/diff/log backups; geo-redundant by default; retention up to 35 days.",
        "dr": "Auto-Failover Group (RTO <60 s, RPO <5 s). Geo-restore = fallback (RTO hours, RPO ≤1 h).",
        "rto": "<60 sec (FOG)", "rpo": "<5 sec (FOG)",
        "ref": "https://learn.microsoft.com/azure/azure-sql/managed-instance/auto-failover-group-sql-mi",
    },
    "microsoft.azurearcdata/sqlserverinstances/databases": {
        "service": "SQL Server DB on Azure Arc-enabled SQL Server",
        "prereqs": "A peer SQL Server instance in the DR region (Azure VM in West Europe / North Europe, or another Arc-connected server) at the SAME SQL Server version + edition. Cross-region connectivity (ExpressRoute or site-to-site VPN) for AG replication. SQL Server Enterprise (or Standard for basic AG) licensing on both nodes. Replicated logins / SQL Agent jobs / linked servers.",
        "backup": "SQL Server NATIVE backups via BACKUP TO URL (full + differential + frequent transaction-log, e.g. every 5 min for low RPO) to a storage account in the DR region; OR Azure Backup for SQL Server running in an Azure VM.",
        "dr": "SQL Server-native DR (Azure SQL PaaS Auto-Failover Groups DO NOT apply to customer-managed / Arc SQL): Always On Availability Group with a SYNCHRONOUS-COMMIT secondary in the DR region for RPO=0, or asynchronous-commit / log shipping for relaxed RPO. Use a Distributed AG to span the Arc/on-prem instance and an Azure-VM SQL secondary. BACKUP TO URL restore is the floor mechanism.",
        "rto": "Minutes (AG failover) to <1 h", "rpo": "0 (synchronous-commit AG) / minutes (async or log shipping)",
        "ref": "https://learn.microsoft.com/sql/database-engine/availability-groups/windows/always-on-availability-groups-sql-server",
    },
    "microsoft.azurearcdata/sqlserverinstances": {
        "service": "Azure Arc-enabled SQL Server instance",
        "prereqs": "A peer SQL Server instance in the DR region at the same version/edition; cross-region connectivity; WSFC/AG or Distributed AG configured; instance-level objects (logins, SQL Agent jobs, linked servers) replicated.",
        "backup": "SQL Server native BACKUP TO URL (DR-region blob) or Azure Backup for SQL Server in Azure VM; back up master/model/msdb with the instance.",
        "dr": "Always On Availability Groups (synchronous for RPO=0, asynchronous for distance) and/or Distributed AGs to an Azure-VM SQL secondary in West Europe / North Europe; log shipping as a lower-cost alternative. Not Azure SQL PaaS failover groups.",
        "rto": "Minutes to <1 h (AG failover)", "rpo": "0 (sync) / minutes (async)",
        "ref": "https://learn.microsoft.com/azure/azure-arc/data/managed-instance-disaster-recovery",
    },
    "microsoft.dbforpostgresql/flexibleservers": {
        "service": "Azure Database for PostgreSQL (Flexible Server)",
        "prereqs": "Enable geo-redundant backup AT CREATION (not changeable later). Deploy cross-region read replica (GP/MO tiers).",
        "backup": "Daily full + continuous log backups; geo-redundant if enabled at creation; PITR within retention (1–35 d).",
        "dr": "Preferred: Promote cross-region read replica (RTO minutes, RPO <5 min). Fallback: Geo-restore to a new server.",
        "rto": "Minutes (replica promotion)", "rpo": "<5 min (replica)",
        "ref": "https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-business-continuity",
    },
    "microsoft.dbformysql/flexibleservers": {
        "service": "Azure Database for MySQL (Flexible Server)",
        "prereqs": "Geo-redundant backup AT CREATION. Cross-region read replica (GP/MO tiers).",
        "backup": "Daily full + log backups; geo-redundant if enabled.",
        "dr": "Promote cross-region read replica (preferred). Geo-restore = fallback.",
        "rto": "Minutes (replica promotion)", "rpo": "<5 min (replica)",
        "ref": "https://learn.microsoft.com/azure/mysql/flexible-server/concepts-business-continuity",
    },
    "microsoft.documentdb/databaseaccounts": {
        "service": "Azure Cosmos DB",
        "prereqs": "Enable multi-region replication + automatic failover; choose consistency level aligned to RPO.",
        "backup": "Continuous Backup (PITR, 30 d window) or Periodic Backup; stored in a separate region.",
        "dr": "Multi-region replication with automatic failover (RTO <1 min). PITR restore for accidental deletion.",
        "rto": "<1 min (auto-failover)", "rpo": "Near-zero (strong) / seconds (session/eventual)",
        "ref": "https://learn.microsoft.com/azure/cosmos-db/high-availability",
    },
    "microsoft.compute/virtualmachines": {
        "service": "Azure Virtual Machines (IaaS)",
        "prereqs": "Recovery Services Vault in the DR region; target VNets/subnets pre-created (Qatar Central is NOT paired → manual target selection). For backup: Azure Backup RoC vault in Sweden Central or Switzerland North.",
        "backup": "Azure Backup (snapshot tier + vault tier). Use RoC vault for off-region copy (GRS not available from Qatar).",
        "dr": "Azure Site Recovery (ASR) cross-region replication — manually pick target region (West Europe / North Europe).",
        "rto": "Hours (ASR failover)", "rpo": "Minutes (ASR continuous)",
        "ref": "https://learn.microsoft.com/azure/site-recovery/azure-to-azure-architecture",
    },
    "microsoft.storage/storageaccounts": {
        "service": "Azure Storage (Blob / Files)",
        "prereqs": "GPv2 or Premium account. (GRS unavailable from Qatar Central → use Object Replication.)",
        "backup": "Operational backup for blobs (Azure Backup). For Files: Azure File Sync / AzCopy scheduled syncs.",
        "dr": "Blob: Object Replication to a storage account in the DR region. Files: AzCopy or Azure Data Factory scheduled sync. RoC supports Blob, ADLS, Files vault-tier backups.",
        "rto": "Minutes (DNS swap)", "rpo": "15–30 min (async replication)",
        "ref": "https://learn.microsoft.com/azure/storage/blobs/object-replication-overview",
    },
    "microsoft.keyvault/vaults": {
        "service": "Azure Key Vault",
        "prereqs": "Secondary Key Vault in DR region; soft-delete + purge protection enabled.",
        "backup": "Key Vault does NOT sync across non-paired regions — implement custom sync (Azure Function / Logic App) to back up secrets/keys.",
        "dr": "Restore backed-up secrets/keys into the secondary vault on failover.",
        "rto": "Minutes (DNS / config swap)", "rpo": "Sync-job interval",
        "ref": "https://learn.microsoft.com/azure/key-vault/general/backup",
    },
    "microsoft.containerregistry/registries": {
        "service": "Azure Container Registry (ACR)",
        "prereqs": "Premium SKU.",
        "backup": "Geo-replication keeps images locally accessible in both regions (single registry endpoint).",
        "dr": "Add a replica to the target region (West Europe / North Europe). Traffic Manager handles data-plane failover.",
        "rto": "Automatic", "rpo": "Near-zero (async replication)",
        "ref": "https://learn.microsoft.com/azure/container-registry/container-registry-geo-replication",
    },
    "microsoft.containerservice/managedclusters": {
        "service": "Azure Kubernetes Service (AKS)",
        "prereqs": "Secondary AKS cluster provisioned via IaC; container images replicated via ACR geo-replication.",
        "backup": "Azure Backup for AKS (RoC supported, up to 100 nodes / 1 TB disks). Velero is an alternative.",
        "dr": "Active-passive architecture: identical cluster in DR region. Use Velero or Azure Backup with a custom blob target to replicate workloads + persistent data.",
        "rto": "Hours (cluster bring-up + restore)", "rpo": "Backup-frequency dependent",
        "ref": "https://learn.microsoft.com/azure/aks/operator-best-practices-multi-region",
    },
    "microsoft.containerinstance/containergroups": {
        "service": "Azure Container Instances (ACI)",
        "prereqs": "ACR replication enabled; deployment templates in source control.",
        "backup": "Not applicable — ACI is ephemeral.",
        "dr": "Redeployment strategy via Bicep / Terraform into the secondary region VNet.",
        "rto": "Minutes (redeploy)", "rpo": "N/A (stateless)",
        "ref": "https://learn.microsoft.com/azure/container-instances/container-instances-tutorial-deploy-app",
    },
    "microsoft.web/sites": {
        "service": "Azure App Service",
        "prereqs": "Identical secondary deployment via IaC (Bicep/ARM/Terraform). App Service resources are region-bound.",
        "backup": "App Service Backup/Restore (state capture) — store backups on a GRS storage account.",
        "dr": "Run an identical instance in the secondary region; fail over traffic (Front Door / Traffic Manager).",
        "rto": "Minutes (DNS swap)", "rpo": "Last backup",
        "ref": "https://learn.microsoft.com/azure/app-service/manage-backup",
    },
    "microsoft.web/serverfarms": {
        "service": "Azure App Service Plan", "prereqs": "Same as Azure App Service.",
        "backup": "Plan itself is not backed up; backup the apps inside it.",
        "dr": "Deploy an identical plan in the DR region; deploy apps via IaC.",
        "rto": "Minutes (deploy + DNS)", "rpo": "Last app backup",
        "ref": "https://learn.microsoft.com/azure/app-service/overview-hosting-plans",
    },
    "microsoft.apimanagement/service": {
        "service": "Azure API Management",
        "prereqs": "Premium SKU for multi-region. Plan regional networking (VNet) per gateway.",
        "backup": "Built-in backup/restore (excludes logs, custom domain settings — re-apply on restore).",
        "dr": "Premium multi-region: primary hosts management + dev portal + gateway; secondaries host gateway only. Backup/restore is the manual fallback.",
        "rto": "Automatic (multi-region) / 30+ min (restore)", "rpo": "Last backup",
        "ref": "https://learn.microsoft.com/azure/api-management/api-management-howto-deploy-multi-region",
    },
    "microsoft.cache/redis": {
        "service": "Azure Cache for Redis",
        "prereqs": "Premium tier for geo-replication.",
        "backup": "Export/Import to GRS Storage when a recoverable point is required.",
        "dr": "Premium geo-replication (asynchronous, continuous). Export = cost-sensitive fallback.",
        "rto": "Minutes (failover)", "rpo": "Replication-lag dependent",
        "ref": "https://learn.microsoft.com/azure/azure-cache-for-redis/cache-how-to-geo-replication",
    },
    "microsoft.web/functions": {
        "service": "Azure Functions",
        "prereqs": "Deploy identical Function App in DR via IaC + CI/CD. Reproduce identities, secrets, private networking.",
        "backup": "Source-controlled deployments (IaC + CI/CD). Geo-redundant Storage (GRS/GZRS) for any state.",
        "dr": "Warm/standby instance in DR region + external traffic routing (Front Door).",
        "rto": "Minutes (traffic swap)", "rpo": "Storage RPO",
        "ref": "https://learn.microsoft.com/azure/azure-functions/functions-geo-disaster-recovery",
    },
    "microsoft.eventhub/namespaces": {
        "service": "Azure Event Hubs",
        "prereqs": "Premium/Dedicated for full geo-replication of metadata+data. Standard+ supports metadata-only geo-DR.",
        "backup": "Replication-driven (not snapshot-based).",
        "dr": "Premium/Dedicated geo-replication (active-active metadata+events). Standard+ metadata geo-DR (active-passive, config only). Failover is manual.",
        "rto": "Minutes (manual failover)", "rpo": "Premium: near-zero / Standard+: data loss possible",
        "ref": "https://learn.microsoft.com/azure/event-hubs/event-hubs-geo-dr",
    },
    "microsoft.servicebus/namespaces": {
        "service": "Azure Service Bus",
        "prereqs": "Premium tier.",
        "backup": "Replication-feature driven (Geo-Replication = metadata + messages; Geo-DR = metadata only).",
        "dr": "Geo-DR with alias-based failover — alias re-points to the secondary namespace; promotion is near-instantaneous.",
        "rto": "Near-instant (alias swap)", "rpo": "Geo-Replication: near-zero / Geo-DR: messages lost",
        "ref": "https://learn.microsoft.com/azure/service-bus-messaging/service-bus-geo-dr",
    },
    "microsoft.logic/workflows": {
        "service": "Azure Logic Apps",
        "prereqs": "Each Logic App is region-bound. Use IaC (Bicep/ARM) with region parameters; pre-deploy secondary.",
        "backup": "Implemented via primary/secondary deployments (not backup-based).",
        "dr": "Deploy identical app in both regions; reconfigure connections; monitor and define a failover policy.",
        "rto": "Minutes (failover)", "rpo": "Workflow-design dependent",
        "ref": "https://learn.microsoft.com/azure/logic-apps/business-continuity-disaster-recovery-guidance",
    },
    "microsoft.network/virtualnetworkgateways": {
        "service": "VPN / ExpressRoute Gateway",
        "prereqs": "BGP enabled; secondary Landing-Zone connectivity prepared.",
        "backup": "Configuration in IaC (no native backup).",
        "dr": "Secondary VPN / ExpressRoute Gateway in DR region; BGP automatically prefers the secondary path on Qatar failure.",
        "rto": "Minutes (BGP reconverge)", "rpo": "N/A",
        "ref": "https://learn.microsoft.com/azure/vpn-gateway/vpn-gateway-bgp-overview",
    },
    "microsoft.network/virtualwans": {
        "service": "Azure Virtual WAN",
        "prereqs": "Secondary Virtual WAN Hub in the DR region (Standard tier for global mesh).",
        "backup": "Configuration in IaC.",
        "dr": "Connect Qatar spokes to Qatar Hub, DR spokes to DR Hub — routing is automatic over the Microsoft backbone.",
        "rto": "Automatic", "rpo": "N/A",
        "ref": "https://learn.microsoft.com/azure/virtual-wan/virtual-wan-global-transit-network-architecture",
    },
    "microsoft.aad/domainservices": {
        "service": "Microsoft Entra Domain Services",
        "prereqs": "Secondary VNet connectivity prepared.",
        "backup": "Managed by Microsoft (no customer backup).",
        "dr": "Add a Replica Set in the DR region (up to 5 regions) — local DC availability with the same domain.",
        "rto": "Near-instant (local DCs)", "rpo": "Near-zero (synced)",
        "ref": "https://learn.microsoft.com/entra/identity/domain-services/concepts-replica-sets",
    },
    "microsoft.automation/automationaccounts": {
        "service": "Azure Automation",
        "prereqs": "Secondary Automation Account linked to source control.",
        "backup": "Source-controlled runbooks.",
        "dr": "Link BOTH regional accounts to the same Git repo (GitHub / Azure DevOps) — runbooks, modules and schedules stay in parity.",
        "rto": "Minutes", "rpo": "Last Git commit",
        "ref": "https://learn.microsoft.com/azure/automation/automation-disaster-recovery",
    },
    "microsoft.operationalinsights/workspaces": {
        "service": "Microsoft Sentinel / Log Analytics",
        "prereqs": "Secondary Log Analytics Workspace in the DR region.",
        "backup": "Logs do NOT replicate natively.",
        "dr": "Dual-ingestion — send logs to BOTH Qatar and DR workspaces (security visibility during regional outage).",
        "rto": "Immediate (dual-write)", "rpo": "Zero",
        "ref": "https://learn.microsoft.com/azure/sentinel/multiple-workspace-view",
    },
    "microsoft.netapp/netappaccounts": {
        "service": "Azure NetApp Files (ANF)",
        "prereqs": "ANF capacity pool in BOTH regions.",
        "backup": "Snapshot-based + Cross-Region Replication (CRR).",
        "dr": "Manually establish CRR peering between Qatar and destination volumes. On failover, manually 'break' the peering to make the DR volume writable.",
        "rto": "Minutes (break peering)", "rpo": "Replication-schedule dependent",
        "ref": "https://learn.microsoft.com/azure/azure-netapp-files/cross-region-replication-introduction",
    },
    "microsoft.synapse/workspaces": {
        "service": "Azure Synapse Analytics",
        "prereqs": "Geo-backups enabled (default). Optional: pre-created paused standby SQL pool in DR region.",
        "backup": "Snapshots every 4–8 h (retained 7 days). Daily geo-backups. User-defined restore points.",
        "dr": "Geo-restore to DR region. For lower RPO: warm standby pool updated from restore points.",
        "rto": "1+ hours", "rpo": "Up to 24 h (geo-restore)",
        "ref": "https://learn.microsoft.com/azure/synapse-analytics/sql/business-continuity-disaster-recovery-overview",
    },
    "microsoft.databricks/workspaces": {
        "service": "Azure Databricks",
        "prereqs": "Secondary workspace in DR region. Notebooks/jobs in Git.",
        "backup": "Git integration / Databricks CLI for notebooks. ADLS with GRS/GZRS for data.",
        "dr": "Active-passive — keep notebooks/jobs/cluster configs in sync via CI/CD. Redirect to secondary on disaster.",
        "rto": "1–2 hours", "rpo": "Near-zero (Git)",
        "ref": "https://learn.microsoft.com/azure/databricks/administration-guide/disaster-recovery",
    },
    "microsoft.datafactory/factories": {
        "service": "Azure Data Factory v2",
        "prereqs": "Git integration; ARM templates / CI/CD; HA self-hosted IR (if used).",
        "backup": "Git stores pipelines/datasets/linked services.",
        "dr": "Platform auto-failover for full regional outages; CI/CD redeployment for partial outages.",
        "rto": "Minutes (auto) / hours (manual)", "rpo": "Near-zero (Git)",
        "ref": "https://learn.microsoft.com/azure/data-factory/concepts-data-redundancy",
    },
    "microsoft.kusto/clusters": {
        "service": "Azure Data Explorer (ADX)",
        "prereqs": "Multiple clusters in different regions; ingestion pipeline supports multi-region ingestion.",
        "backup": "Continuous Export to GRS Blob Storage.",
        "dr": "Active-active (dual ingestion) OR active-passive standby cluster. On disaster, redirect queries.",
        "rto": "Near-zero (A-A) / minutes (A-P)", "rpo": "Zero if synced ingestion",
        "ref": "https://learn.microsoft.com/azure/data-explorer/business-continuity-overview",
    },
    "microsoft.appconfiguration/configurationstores": {
        "service": "Azure App Configuration",
        "prereqs": "Geo-replication enabled (replicas have dedicated endpoints; origin = first endpoint).",
        "backup": "Replication = primary protection.",
        "dr": "Automatic failover via App Configuration providers; otherwise custom switch between replica endpoints.",
        "rto": "Near-zero", "rpo": "Eventual consistency",
        "ref": "https://learn.microsoft.com/azure/azure-app-configuration/concept-geo-replication",
    },
    "microsoft.signalrservice/signalr": {
        "service": "Azure SignalR Service",
        "prereqs": "Premium SKU; geo-replication with replicas in required regions.",
        "backup": "Replication-based.",
        "dr": "DNS / health-check based redirection — clients redirect to healthy replicas after DNS TTL (~90 s).",
        "rto": "DNS TTL (~90 s)", "rpo": "Near-zero",
        "ref": "https://learn.microsoft.com/azure/azure-signalr/signalr-howto-replicas",
    },
    "microsoft.notificationhubs/namespaces": {
        "service": "Azure Notification Hubs",
        "prereqs": "IaC for hub + access policies; documented keys / registration strategy.",
        "backup": "Config via IaC; external state stores must be geo-redundant.",
        "dr": "Redeploy a secondary hub in DR region; manual failover (update app config / endpoints).",
        "rto": "Minutes (manual)", "rpo": "Last IaC apply",
        "ref": "https://learn.microsoft.com/azure/notification-hubs/notification-hubs-high-availability",
    },
    "microsoft.search/searchservices": {
        "service": "Azure AI Search (Cognitive Search)",
        "prereqs": "Secondary search service in DR region; index sync setup.",
        "backup": "No native backup — use index-backup-restore scripts or indexers from geo-redundant data sources.",
        "dr": "Dual-region deployment with synced indexes; redirect via Traffic Manager / DNS.",
        "rto": "Minutes (DNS)", "rpo": "Sync-frequency dependent",
        "ref": "https://learn.microsoft.com/azure/search/search-performance-optimization",
    },
    "microsoft.cognitiveservices/accounts": {
        "service": "Azure OpenAI / Cognitive Services",
        "prereqs": "Secondary account in **Sweden South** (Sweden Central's paired region) — AOAI not GA in Qatar Central.",
        "backup": "Deployments + customisations re-applied via IaC.",
        "dr": "Active-passive deployment; redirect via Front Door / Traffic Manager; quota must be reserved in the DR region.",
        "rto": "Minutes (DNS) — quota dependent", "rpo": "Re-deploy customisations",
        "ref": "https://learn.microsoft.com/azure/ai-services/openai/how-to/business-continuity-disaster-recovery",
    },
    "microsoft.machinelearningservices/workspaces": {
        "service": "Azure Machine Learning",
        "prereqs": "Secondary AML workspace in **Sweden South**; models / datasets in geo-redundant storage.",
        "backup": "Workspace assets (models, components, environments) versioned + replicated.",
        "dr": "Active-passive workspace; replicate models + endpoints; redirect inference traffic.",
        "rto": "Hours", "rpo": "Replication-frequency dependent",
        "ref": "https://learn.microsoft.com/azure/machine-learning/how-to-high-availability-machine-learning",
    },
}


def _short_type(resource_type: str) -> str:
    t = (resource_type or "").lower()
    return t


def playbook_for(resource_type: str) -> Optional[Dict[str, str]]:
    """Best-match playbook entry for a resource type (case-insensitive contains)."""
    t = _short_type(resource_type)
    if not t:
        return None
    # Prefer the longest matching key so e.g. /sites doesn't shadow /sites/slots.
    matches = [(k, v) for k, v in SERVICE_DR_PLAYBOOK.items() if k in t]
    if not matches:
        return None
    matches.sort(key=lambda kv: -len(kv[0]))
    return matches[0][1]


# Per-resource DR plan ---------------------------------------------------------

def build_inventory_dr_plan(resources: List[Dict[str, Any]],
                            metadata_map: Optional[Dict[str, dict]] = None,
                            customer_info: Optional[Dict[str, Any]] = None,
                            ) -> List[Dict[str, Any]]:
    """For every in-scope resource, produce a row containing:
      * Azure-native DR mechanism (per the Microsoft Qatar playbook)
      * The policy-correct DR target region (honours per-resource override
        from Phase-1 metadata; else the customer's stated regions; else the
        Qatar regional defaults).
    Resources without a playbook entry still get the region recommendation
    + a generic "deploy identical instance via IaC" note so the customer
    sees an answer for every workload.
    """
    meta = metadata_map or {}
    ci = customer_info or {}
    stated_primary = (ci.get("primary_region") or "").strip()
    stated_secondary = (ci.get("secondary_region") or "").strip()
    rows: List[Dict[str, Any]] = []
    for r in resources or []:
        rid = r.get("resource_id") or r.get("id") or ""
        rtype = r.get("resource_type") or r.get("type") or ""
        loc = r.get("location") or ""
        m = meta.get(rid) or {}
        per_resource_target = m.get("target_region")
        # Resource-level Phase-1 target wins, else stated secondary, else policy default.
        dr_target = (per_resource_target or stated_secondary
                     or recommend_dr_region(rtype, loc, None))
        pb = playbook_for(rtype)
        is_ai = is_ai_workload(rtype)
        roc_ok = is_roc_eligible(rtype)
        if pb:
            entry = {
                "resource_name": r.get("resource_name") or (rid.split("/")[-1] if rid else ""),
                "resource_type": rtype,
                "azure_service": pb["service"],
                "current_region": display_region(loc),
                "recommended_dr_region": display_region(dr_target),
                "is_ai_workload": is_ai,
                "roc_eligible": roc_ok,
                "prereqs": pb.get("prereqs", ""),
                "backup_approach": pb.get("backup", ""),
                "dr_approach": pb.get("dr", ""),
                "target_rto": pb.get("rto", ""),
                "target_rpo": pb.get("rpo", ""),
                "reference": pb.get("ref", ""),
                "region_policy_note": _region_policy_note(rtype, loc, dr_target, is_ai),
            }
        else:
            entry = {
                "resource_name": r.get("resource_name") or (rid.split("/")[-1] if rid else ""),
                "resource_type": rtype,
                "azure_service": rtype.split("/")[-1] if rtype else "",
                "current_region": display_region(loc),
                "recommended_dr_region": display_region(dr_target),
                "is_ai_workload": is_ai,
                "roc_eligible": roc_ok,
                "prereqs": "Deploy identical secondary instance via IaC (Bicep/Terraform). Reproduce identity, secrets, networking, private connectivity.",
                "backup_approach": "Use the service's native backup if available; otherwise version configuration in source control.",
                "dr_approach": ("Active-passive deployment in the DR region + traffic redirection via "
                                "Front Door / Traffic Manager / DNS."),
                "target_rto": "",
                "target_rpo": "",
                "reference": "https://learn.microsoft.com/azure/reliability/",
                "region_policy_note": _region_policy_note(rtype, loc, dr_target, is_ai),
            }
        rows.append(entry)
    return rows


def _region_policy_note(rtype: str, current_region: str, dr_region: str,
                        is_ai: bool) -> str:
    cur = (current_region or "").lower().replace(" ", "")
    if is_ai:
        return ("AI workload (Azure OpenAI / cognitive). Primary stays in Sweden Central — "
                "Azure OpenAI is not GA in Qatar Central. DR target uses Sweden Central's "
                "paired region (Sweden South).")
    if cur == QATAR_PRIMARY_REGION:
        return ("Non-AI workload — must remain in Qatar Central as primary (Qatar data "
                f"residency + sovereignty). DR target: {dr_region} (NCSA + NIA certified). "
                "Qatar Central is not a Microsoft-paired region → no GRS / GZRS; use "
                "Azure Backup Region-of-Choice (RoC) where supported.")
    if cur == QATAR_AI_PRIMARY_REGION:
        return ("Workload currently in Sweden Central — DR target uses Sweden Central's "
                "Microsoft-paired region (Sweden South).")
    return (f"Primary region: {display_region(current_region) or 'unspecified'}. "
            f"Recommended DR target: {dr_region}.")


# AI prompt grounding block ---------------------------------------------------

QATAR_POLICY_SYSTEM_RULES = (
    "QATAR-REGION POLICY (AUTHORITATIVE — apply for every recommendation, do not contradict):\n"
    "  - Primary region for non-AI workloads is Qatar Central (data residency + sovereignty).\n"
    "    Recommend keeping non-AI workloads in Qatar Central; do NOT recommend moving them out.\n"
    "  - Disaster-recovery target region for non-AI workloads is West Europe OR North Europe\n"
    "    (both NCSA- and NIA-certified for Qatar entities). Use whichever the customer stated;\n"
    "    if no target is stated, default to West Europe.\n"
    "  - AI workloads (Azure OpenAI, Azure AI Search, Azure ML, Cognitive Services) may run in\n"
    "    Sweden Central as primary because Azure OpenAI is NOT GA in Qatar Central. Their DR\n"
    "    target is Sweden South (Sweden Central's Microsoft-paired region).\n"
    "  - Qatar Central is NOT a Microsoft-paired region — GRS / GZRS auto-pairing is NOT\n"
    "    available. For Azure Backup workloads recommend the Region-of-Choice (RoC) feature\n"
    "    with a vault in Sweden Central (preferred) or Switzerland North (second choice).\n"
    "  - LANDING ZONE & CONNECTIVITY (Microsoft Qatar methodology): most Qatar entities already\n"
    "    run a secondary Landing Zone in West Europe. The DR design MUST state ONE of two paths:\n"
    "    (a) PEER to the existing West Europe Landing Zone via Global VNet Peering to reuse shared\n"
    "    identity / security / governance services; or (b) build an ACCELERATED Landing Zone in the\n"
    "    DR region (Azure Firewall, Application Gateway, VPN / ExpressRoute Gateway) for full parity.\n"
    "  - INFRASTRUCTURE-AS-CODE PARITY (Bicep / Terraform) is the single most critical RTO factor\n"
    "    for any redeploy-based service — keep 100% IaC parity in source control so the DR estate\n"
    "    can be stood up deterministically. Call this out explicitly in the deployment plan.\n"
    "  - Because Qatar Central is NOT paired you MUST EXPLICITLY choose the secondary region during\n"
    "    vault / replication configuration (West Europe or North Europe for non-AI; Sweden South for\n"
    "    AI). Asynchronous mechanisms (Object Replication, ANF CRR, ACR geo-replication, async AG)\n"
    "    typically yield a 15–30 min RPO; only synchronous replication (sync-commit AG) gives RPO 0.\n"
    "  - Honour every per-resource target_region the customer supplied in Phase-1\n"
    "    classification AND the customer-stated primary_region / secondary_region — never\n"
    "    invent or override a customer-stated region.\n"
    "  - The 'recommended_architecture', 'recommended_dr_target_region', RTO/RPO, deployment\n"
    "    plan, activation plan AND every per-service recommendation MUST cite specific Azure-\n"
    "    native DR mechanisms from the Microsoft Qatar playbook (e.g. Auto-Failover Groups for\n"
    "    Azure SQL, ASR for IaaS VMs, Object Replication for Blob, Geo-replication for ACR,\n"
    "    Cross-region replica promotion for PgSQL/MySQL Flex, Replica Sets for Entra DS,\n"
    "    Premium multi-region for APIM, RoC vaults for Azure Backup workloads).\n"
    "  - AZURE ARC-ENABLED SQL SERVER (microsoft.azurearcdata/sqlserverinstances and /databases)\n"
    "    are CUSTOMER-MANAGED SQL Server instances/databases projected into Azure via Arc — NOT\n"
    "    Azure SQL Database / Managed Instance PaaS. Azure SQL Auto-Failover Groups DO NOT apply.\n"
    "    Recommend SQL Server-NATIVE DR: Always On Availability Groups (synchronous-commit\n"
    "    secondary for RPO=0; asynchronous-commit for distance), Distributed AGs spanning the\n"
    "    Arc/on-prem instance and an Azure-VM SQL secondary in the DR region, log shipping as a\n"
    "    lower-cost option, and SQL-native BACKUP TO URL (full+diff+log) to DR-region blob (or\n"
    "    Azure Backup for SQL Server in Azure VM) as the backup floor. The DR target is an Azure\n"
    "    VM running the same SQL Server version/edition in West Europe / North Europe.\n"
    "  - SQL SERVER SYSTEM DATABASES (master, model, msdb, tempdb): tempdb is recreated on instance\n"
    "    start and needs NO DR/backup; master/model/msdb are recovered WITH the instance (back them\n"
    "    up but they carry no independent business value). Concentrate business RTO/RPO/financial\n"
    "    impact on the USER/application databases; do not present system databases as separate\n"
    "    business-critical workloads even when they share a criticality tag — note this explicitly.\n"
    "  - HONOUR EVERY STATED CUSTOMER INPUT from Phase-1 / custom tags: TargetRegion, RTO, RPO,\n"
    "    DR_Tier, FinancialLossPerHour, Criticality, Compliance, PlanningNotes. If RPO is 0/Zero the\n"
    "    ONLY valid mechanisms are SYNCHRONOUS replication (sync-commit AG / sync storage) — never\n"
    "    propose an async mechanism for a stated RPO=0. If RTO < 1 h, propose a HOT running standby,\n"
    "    not backup-and-restore. Quote the customer's stated values; never invent or override them.\n"
    "  - COST when a resource's Azure run-rate is $0 (e.g. Arc-enabled SQL bills via SQL Server\n"
    "    licensing / the host server, not per database) — do NOT leave the cost section empty and\n"
    "    NEVER write 'Not supplied', 'N/A', 'TBD' or 'estimate required' in the additional column.\n"
    "    You MUST give an INDICATIVE ballpark monthly figure (Azure list price, USD) for EVERY\n"
    "    monthly_estimate component, with the sizing assumption stated inline, e.g.\n"
    "    'approx $520/mo (Standard_E4s_v5 SQL VM, 4 vCPU/32 GB)', 'approx $95/mo (1 TB GRS backup\n"
    "    blob)', 'approx $45/mo (cross-region egress, ~500 GB/mo)', 'approx $180/mo (Arc-enabled SQL\n"
    "    pay-as-you-go, per vCPU)'. Size the DR VM(s) from the workload tier / criticality and the\n"
    "    database count. Cover DR-region SQL Server VM(s), Azure Backup / blob storage (GB-month),\n"
    "    cross-region egress/replication, ExpressRoute/VPN if needed, and Arc-enabled SQL Server\n"
    "    pay-as-you-go licensing. List every sizing assumption in assumptions[]. A ballpark WITH a\n"
    "    stated assumption is mandatory; a blank, 'to be sized' or 'Not supplied' is NOT acceptable.\n"
    "  - IMPLEMENTATION ROADMAP timelines must be REALISTIC and justified by THIS estate's scope and\n"
    "    complexity, NOT a fixed 30/60/90-day template. Give each phase a duration with a one-line\n"
    "    reason; a small, well-understood SQL estate (a handful of databases) can be days-to-weeks,\n"
    "    not 90 days. Do not pad timelines.\n"
)


def build_qatar_grounding_block(resources: List[Dict[str, Any]],
                                customer_info: Optional[Dict[str, Any]] = None,
                                ) -> str:
    """Concise estate-aware grounding text appended to AI user prompts.

    Summarises what's actually in scope (Qatar Central vs other regions, AI vs
    non-AI, RoC-eligible counts) so the AI's narrative is locked to the real
    inventory rather than the generic policy text.
    """
    ci = customer_info or {}
    res = resources or []
    if not res:
        return ""
    qatar_cnt = sum(1 for r in res if (r.get("location") or "").lower().replace(" ", "") == QATAR_PRIMARY_REGION)
    sweden_cnt = sum(1 for r in res if (r.get("location") or "").lower().replace(" ", "") == QATAR_AI_PRIMARY_REGION)
    ai_cnt = sum(1 for r in res if is_ai_workload(r.get("resource_type") or ""))
    roc_cnt = sum(1 for r in res if is_roc_eligible(r.get("resource_type") or ""))
    total = len(res)
    stated_primary = ci.get("primary_region") or ""
    stated_secondary = ci.get("secondary_region") or ""
    types_by_count: Dict[str, int] = {}
    for r in res:
        t = (r.get("resource_type") or "unknown").lower()
        types_by_count[t] = types_by_count.get(t, 0) + 1
    top_types = sorted(types_by_count.items(), key=lambda kv: -kv[1])[:10]
    types_str = ", ".join(f"{t.split('/')[-1] or t}: {n}" for t, n in top_types)
    qatar_only_estate = (qatar_cnt > 0 and sweden_cnt + (total - qatar_cnt - sweden_cnt) <= total)
    lines = [
        "QATAR ESTATE-AWARE GROUNDING (use these counts verbatim):",
        f"  - Total in-scope resources: {total}",
        f"  - In Qatar Central: {qatar_cnt}  (non-AI workloads — must remain in Qatar Central)",
        f"  - In Sweden Central: {sweden_cnt}  (AI / cognitive workloads — DR target Sweden South)",
        f"  - AI / cognitive workloads detected: {ai_cnt}",
        f"  - Azure Backup RoC-eligible workloads: {roc_cnt} "
        "(IaaS VM, Blob/ADLS/Files, PgSQL Flex, AKS, SQL-in-VM, SAP HANA-in-VM)",
        f"  - Top resource types: {types_str}",
    ]
    if stated_primary or stated_secondary:
        lines.append(
            f"  - Customer-stated regions: primary={stated_primary or 'unspecified'} "
            f"| secondary/DR={stated_secondary or 'unspecified'} "
            "(use these literally — DO NOT propose alternates)."
        )
    else:
        lines.append(
            "  - Customer has not stated a region pair — DEFAULT non-AI DR target = West Europe "
            "(NCSA + NIA certified); AI DR target = Sweden South."
        )
    lines.append(
        "  - For every resource the per-service Azure-native DR mechanism is enumerated in the "
        "PER-SERVICE DR PLAYBOOK section below; recommendations MUST align to that playbook."
    )
    if qatar_only_estate and roc_cnt > 0:
        lines.append(
            f"  - {roc_cnt} workload(s) qualify for Azure Backup Region-of-Choice (RoC) vaults — "
            "REQUIRED for off-region copies because Qatar Central has no paired GRS partner."
        )
    return "\n".join(lines) + "\n\n"


def build_service_playbook_prompt_block(resources: List[Dict[str, Any]]) -> str:
    """Render the SUBSET of the per-service playbook that actually applies to
    the in-scope resources, so the AI cites real services + mechanisms only.
    """
    if not resources:
        return ""
    used: Dict[str, Dict[str, str]] = {}
    for r in resources:
        rtype = r.get("resource_type") or r.get("type") or ""
        pb = playbook_for(rtype)
        if not pb:
            continue
        used.setdefault(pb["service"], pb)
    if not used:
        return ""
    lines = ["PER-SERVICE DR PLAYBOOK (Microsoft Qatar engineering — cite these mechanisms verbatim):"]
    for svc, pb in sorted(used.items()):
        lines.append(
            f"  - {svc}: DR = {pb.get('dr', '').strip()} | Backup = {pb.get('backup', '').strip()} | "
            f"RTO {pb.get('rto', '?')} / RPO {pb.get('rpo', '?')}"
        )
    return "\n".join(lines) + "\n\n"


# Static summary returned IN the report (so PDF + Excel can render it) --------

QATAR_POLICY_REPORT_PAYLOAD = {
    "title": "Qatar Regional & Regulatory DR Strategy",
    "applies_to": "Qatar-based entities deploying primary workloads in Azure Qatar Central.",
    "principles": [
        "Primary region for non-AI workloads is Azure Qatar Central (Qatar data residency & sovereignty).",
        "DR region for non-AI workloads: West Europe OR North Europe (NCSA + NIA certified for Qatar entities).",
        "AI workloads (Azure OpenAI, Azure AI Search, Azure ML, Cognitive Services) run in Sweden Central — Azure OpenAI is not GA in Qatar Central.",
        "DR region for AI workloads: Sweden South (Microsoft-paired region of Sweden Central).",
        "Qatar Central is NOT a Microsoft-paired region — GRS / GZRS auto-pairing is unavailable.",
        "Azure Backup Region-of-Choice (RoC) is used for off-region copies, with vaults in Sweden Central (preferred) or Switzerland North.",
        "Existing West Europe Landing Zones may be reused via Global VNet Peering; alternatively build a standalone DR Landing Zone (Azure Firewall + App Gateway + VPN/ER Gateways).",
    ],
    "roc_supported_workloads": [
        "Azure IaaS VM — General Purpose + Confidential VM (PMK and CMK-on-mHSM supported)",
        "Azure Blob, ADLS Gen2, Azure Files (Files: max 10 TB share, 10M files)",
        "Azure Database for PostgreSQL — Flexible Server (up to 1 TB)",
        "Azure Kubernetes Service (AKS) — up to 100 nodes / 1 TB disks",
        "SQL Server in VM, SAP HANA in VM",
    ],
    "roc_not_supported": [
        "Azure Disk Encryption (ADE) VMs",
        "Confidential VM with CMK in Azure Key Vault (must migrate to mHSM)",
        "Multi-protection (the same workload protected by vaults in multiple regions)",
    ],
    "references": [
        "Azure DR Plan — Qatar Central (Microsoft Qatar)",
        "RoC — Region of Choice",
        ("ASR Azure-to-Azure architecture", "https://learn.microsoft.com/azure/site-recovery/azure-to-azure-architecture"),
        ("Azure Backup Region-of-Choice (overview)", "https://learn.microsoft.com/azure/backup/backup-azure-vms-introduction"),
    ],
}
