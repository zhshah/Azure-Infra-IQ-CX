"""
BCDR Recommendation Service
============================
Ports Phase2-AddRecommendations.ps1 (Microsoft Qatar SA-level BCDR analysis).

Generates 19 SA columns per resource:
 1.  SA_Criticality
 2.  SA_ZRContext
 3.  SA_BCDRStrategy
 4.  SA_DRRegionChoice
 5.  SA_DRMethod
 6.  SA_RPO
 7.  SA_RTO
 8.  SA_BCDRGuidanceSummary
 9.  SA_ActionRequired
 10. SA_ImplementationEffort
 11. SA_CostImpact
 12. SA_Priority
 13. SA_QuickWin
 14. SA_ComplianceNote
 15. SA_Dependencies
 16. SA_CurrentGapSummary
 17. SA_PhysicalZonePlacement
 18. SA_ZoneTransitionPath
 19. SA_AzurePortalLink

Qatar Central specific:
 - No GRS storage → Object Replication
 - No native AKS Backup → Velero
 - No Key Vault cross-region sync → Custom Function
 - No paired region → UAE North or West/North Europe (NIA-certified)
 - Zone redundancy DISABLED
"""

from __future__ import annotations
from dataclasses import dataclass, asdict
from typing import Optional
from .bcdr_assessment_service import ZoneAssessment, AZURE_PAIRED_REGIONS


# ---------------------------------------------------------------------------
# DR Knowledge Base (ported from $drKnowledge in Phase2)
# ---------------------------------------------------------------------------
DR_KNOWLEDGE: dict[str, dict] = {

    # ── COMPUTE ───────────────────────────────────────────────────────────────
    "microsoft.compute/virtualmachines": {
        "BCDRStrategy":   "Active-Passive (Warm Standby)",
        "DRMethod":       "Azure Site Recovery (ASR)",
        "RPO":            "15 minutes",
        "RTO":            "1–2 hours",
        "Effort":         "Medium",
        "CostImpact":     "Medium",
        "QuickWin":       "No",
        "ActionRequired": "Enable ASR replication to UAE North for all production VMs. Configure ASR Recovery Plans with automated scripts. Test failover quarterly. Use Azure Backup alongside ASR for file-level recovery.",
        "Dependencies":   "Recovery Services Vault (UAE North), VNet in UAE North, Storage Account in UAE North for ASR cache",
        "ComplianceNote": "Verify data classification before replicating PII/sensitive VM data to UAE North. Align with Qatar PDPPL if applicable.",
    },
    "microsoft.compute/virtualmachinescalesets": {
        "BCDRStrategy":   "Active-Passive (Warm Standby)",
        "DRMethod":       "Azure Site Recovery (ASR) + Azure Front Door",
        "RPO":            "15 minutes",
        "RTO":            "2–4 hours",
        "Effort":         "High",
        "CostImpact":     "Medium-High",
        "QuickWin":       "No",
        "ActionRequired": "Enable ASR for VMSS. Pre-provision matching VMSS in UAE North (0–1 instances). Use Azure Front Door with health probes for traffic failover. Scale up during DR activation.",
        "Dependencies":   "Azure Front Door profile, VMSS autoscale config mirrored in UAE North, VNet/NSG in UAE North",
        "ComplianceNote": "Confirm VM SKU availability in UAE North before planning capacity. Qatar Central VMSS ZR is blocked — ASR is the only native HA cross-region path.",
    },
    "microsoft.compute/disks": {
        "BCDRStrategy":   "Backup & Restore",
        "DRMethod":       "Azure Backup with Cross-Region Restore (CRR)",
        "RPO":            "Daily (configurable to 4-hourly with Enhanced Policy)",
        "RTO":            "4–8 hours",
        "Effort":         "Low",
        "CostImpact":     "Low",
        "QuickWin":       "Yes",
        "ActionRequired": "Enable Cross-Region Restore on Recovery Services Vault. Ensure all managed disks attached to critical VMs are covered by Azure Backup. Verify RSV CRR is enabled and secondary region is UAE North.",
        "Dependencies":   "Recovery Services Vault with CRR enabled, UAE North as secondary in RSV settings",
        "ComplianceNote": "LRS disks have no built-in geo-redundancy. ZRS is DISABLED in Qatar Central. Azure Backup CRR is the ONLY supported path for cross-region disk recoverability.",
    },
    "microsoft.compute/snapshots": {
        "BCDRStrategy":   "Backup & Restore",
        "DRMethod":       "Scheduled Snapshot Copy via Azure Automation to UAE North",
        "RPO":            "Snapshot schedule frequency",
        "RTO":            "4–8 hours",
        "Effort":         "Low",
        "CostImpact":     "Low",
        "QuickWin":       "Yes",
        "ActionRequired": "Create Azure Automation runbook to copy disk snapshots to UAE North resource group. Schedule runbook daily/weekly. Alternatively, use Azure Backup incremental snapshots with CRR policy.",
        "Dependencies":   "Azure Automation Account, UAE North Resource Group, RBAC permissions for cross-region snapshot copy",
        "ComplianceNote": "Snapshots are stored in local region storage. No automatic cross-region copy — manual scripting required.",
    },
    "microsoft.compute/availabilitysets": {
        "BCDRStrategy":   "Infrastructure Configuration DR",
        "DRMethod":       "IaC (Bicep/Terraform) Redeploy in UAE North",
        "RPO":            "N/A (configuration resource)",
        "RTO":            "15–30 minutes",
        "Effort":         "Low",
        "CostImpact":     "None",
        "QuickWin":       "Yes",
        "ActionRequired": "Export Availability Set configurations to Bicep/ARM templates. Store in Azure DevOps/GitHub. Note: Availability Sets do NOT help with cross-region DR. Migrate HA-critical VMs to Availability Zones or use ASR for DR. Consider migrating to VMSS with Flexible Orchestration.",
        "Dependencies":   "IaC Repository, UAE North resource group",
        "ComplianceNote": "Availability Sets are a legacy HA construct for single-region only. In Qatar Central, ZR is blocked. ASR is the replacement path for HA+DR.",
    },
    "microsoft.compute/galleries": {
        "BCDRStrategy":   "Active-Active (Image Replication)",
        "DRMethod":       "Azure Compute Gallery — Add UAE North as Replication Target",
        "RPO":            "Near-zero (async replication after publish)",
        "RTO":            "Automatic",
        "Effort":         "Low",
        "CostImpact":     "Low",
        "QuickWin":       "Yes",
        "ActionRequired": "Add UAE North as a replication target region in all Azure Compute Gallery image versions. Set replication count >= 1 in UAE North. Ensures VM images are immediately available during DR.",
        "Dependencies":   "Existing Azure Compute Gallery, UAE North subscription access",
        "ComplianceNote": "Image replication is asynchronous. Ensure replication completes before initiating VM deployments in UAE North during DR.",
    },

    # ── STORAGE ───────────────────────────────────────────────────────────────
    "microsoft.storage/storageaccounts": {
        "BCDRStrategy":   "Active-Passive (Object Replication + Scheduled File Sync)",
        "DRMethod":       "Object Replication (Block Blobs) to UAE North + AzCopy/ADF for Azure Files",
        "RPO":            "15–30 minutes (object replication lag, asynchronous)",
        "RTO":            "< 1 hour (redirect to secondary storage account)",
        "Effort":         "Medium",
        "CostImpact":     "Low-Medium",
        "QuickWin":       "No",
        "ActionRequired": "QATAR CENTRAL CONSTRAINT: Standard GRS/RA-GRS is NOT available for Qatar Central (no paired region). DO NOT attempt to enable GRS. Use: (1) Block Blobs — Enable Object Replication to UAE North destination account. (2) Azure Files — Schedule syncs using AzCopy or Azure Data Factory to UAE North. (3) Destination storage in UAE North should use GRS/RA-GRS (UAE North has a paired region). (4) For storage backing AKS/VMs: coordinate with ASR/ANF CRR strategy.",
        "Dependencies":   "UAE North Storage Account (GPv2, GRS/RA-GRS), Object Replication policy per container, AzCopy or ADF for Files, UAE North VNet Private Endpoint",
        "ComplianceNote": "Qatar Central has NO paired region — GRS auto-failover does NOT apply. Object Replication replicates block blobs only (NOT tables, queues, or Azure Files). Validate regulatory requirements before replicating to UAE North.",
    },

    # ── DATABASES ─────────────────────────────────────────────────────────────
    "microsoft.sql/servers": {
        "BCDRStrategy":   "Active-Passive (Auto-Failover)",
        "DRMethod":       "Auto-Failover Groups targeting UAE North",
        "RPO":            "< 5 seconds",
        "RTO":            "< 30 seconds (auto) / < 1 hour (manual)",
        "Effort":         "Medium",
        "CostImpact":     "High (secondary replica)",
        "QuickWin":       "No",
        "ActionRequired": "Configure Azure SQL Failover Group with UAE North secondary server. Use failover group listener endpoint in all application connection strings. Enable geo-redundant backup. Test failover quarterly.",
        "Dependencies":   "UAE North Azure SQL Server, Matching firewall rules and AAD admins in secondary, Application connection string update",
        "ComplianceNote": "SQL data will be replicated to UAE North. Confirm data residency compliance. Consider Private Endpoints in both regions.",
    },
    "microsoft.sql/servers/databases": {
        "BCDRStrategy":   "Active-Passive (Auto-Failover)",
        "DRMethod":       "Auto-Failover Groups or Active Geo-Replication",
        "RPO":            "< 5 seconds",
        "RTO":            "< 30 seconds (auto) / < 1 hour (manual)",
        "Effort":         "Medium",
        "CostImpact":     "High (secondary replica billed at same tier)",
        "QuickWin":       "No",
        "ActionRequired": "For production DBs: Use Auto-Failover Groups for automatic DNS-based failover. For non-critical: Active Geo-Replication with manual failover. Enable geo-redundant backup. Update app connection strings to use failover group endpoint.",
        "Dependencies":   "UAE North SQL Server, Failover Group configuration, App connection string updates",
        "ComplianceNote": "All data replicated to UAE North secondary. Validate compliance and Qatar PDPPL requirements with customer's DPO.",
    },
    "microsoft.sql/managedinstances": {
        "BCDRStrategy":   "Active-Passive (Instance Failover Group)",
        "DRMethod":       "SQL Managed Instance Failover Groups to UAE North",
        "RPO":            "< 5 seconds",
        "RTO":            "< 1 hour",
        "Effort":         "High",
        "CostImpact":     "Very High (secondary MI at same SKU)",
        "QuickWin":       "No",
        "ActionRequired": "Deploy SQL MI in UAE North with matching tier/vCores. Configure Failover Group. Ensure VNet peering with non-overlapping subnets. Minimum 9 hours provisioning time. Update apps to use failover group endpoint.",
        "Dependencies":   "UAE North subnet /24 minimum, VNet Global Peering QC↔UAE North, Matching MI SKU in UAE North, DNS configuration",
        "ComplianceNote": "Full SQL MI deployment in UAE North — very high cost. Evaluate if Hyperscale SQL DB is a better fit for DR at lower cost.",
    },
    "microsoft.dbformysql/flexibleservers": {
        "BCDRStrategy":   "Active-Passive (Read Replica + Geo-Redundant Backup)",
        "DRMethod":       "Geo-Redundant Backup + Cross-Region Read Replica to UAE North",
        "RPO":            "< 1 hour",
        "RTO":            "< 2 hours (read replica promotion)",
        "Effort":         "Medium",
        "CostImpact":     "Medium-High",
        "QuickWin":       "No",
        "ActionRequired": "Enable Geo-Redundant Backup on all production MySQL Flexible Servers. Create Cross-Region Read Replica in UAE North. Document replica promotion procedure. ZR HA is blocked in Qatar Central — geo-redundant read replica is the primary resilience mechanism.",
        "Dependencies":   "MySQL Flexible Server in UAE North with same tier/SKU, Geo-redundant backup enabled, Private access requires VNet in UAE North",
        "ComplianceNote": "Database data replicated to UAE North. Verify compliance requirements. Ensure private endpoint in UAE North VNet.",
    },
    "microsoft.dbforpostgresql/flexibleservers": {
        "BCDRStrategy":   "Active-Passive (Read Replica + Geo-Redundant Backup)",
        "DRMethod":       "Geo-Redundant Backup + Cross-Region Read Replica to UAE North",
        "RPO":            "< 1 hour",
        "RTO":            "< 2 hours",
        "Effort":         "Medium",
        "CostImpact":     "Medium-High",
        "QuickWin":       "No",
        "ActionRequired": "Enable Geo-Redundant Backup. Create Cross-Region Read Replica in UAE North. Document promotion procedure (read replica → primary). ZR HA is blocked in Qatar Central — replace with geo-DR strategy.",
        "Dependencies":   "PostgreSQL Flexible Server in UAE North, Geo-Redundant Backup enabled, VNet/Private endpoint in UAE North",
        "ComplianceNote": "Cross-border data replication to UAE North — validate Qatar data residency/DPO approval.",
    },
    "microsoft.documentdb/databaseaccounts": {
        "BCDRStrategy":   "Active-Active (Multi-Region Writes) or Active-Passive (Read Replica)",
        "DRMethod":       "Cosmos DB Multi-Region: Add UAE North as Secondary Region",
        "RPO":            "< 15 seconds (single-write) / ~0 (multi-write with CAP trade-off)",
        "RTO":            "< 5 minutes (automatic service-managed failover)",
        "Effort":         "Medium",
        "CostImpact":     "High (multi-region write = 2x+ RU cost)",
        "QuickWin":       "No",
        "ActionRequired": "Add UAE North as secondary read region for all production Cosmos DB accounts. For tier-1 critical: Enable multi-region writes. Configure automatic failover priorities. Validate consistency level aligns with RPO (Bounded Staleness or Session recommended).",
        "Dependencies":   "UAE North region availability in Cosmos DB, SDK multi-region endpoint, Cosmos DB account-level firewall rules",
        "ComplianceNote": "Cosmos DB replicates all data to UAE North. Verify classified data compliance. Same encryption keys apply across regions.",
    },

    # ── CONTAINERS ────────────────────────────────────────────────────────────
    "microsoft.containerservice/managedclusters": {
        "BCDRStrategy":   "Active-Passive (Architecture-Based DR — IaC + GitOps)",
        "DRMethod":       "Multi-Region AKS via IaC + Velero + Azure Front Door + Geo-Replicated ACR",
        "RPO":            "Stateless: near-zero; Stateful: Velero backup schedule (15–60 min)",
        "RTO":            "< 30 minutes (pre-provisioned standby cluster)",
        "Effort":         "High",
        "CostImpact":     "High",
        "QuickWin":       "No",
        "ActionRequired": "CRITICAL QATAR CONSTRAINT: Native AKS Backup is NOT available in Qatar Central. Architecture-based DR is MANDATORY. Steps: (1) Provision secondary AKS cluster in UAE North via IaC — minimal nodes, scale up on DR. (2) Use GitOps (Flux/ArgoCD) to sync manifests to both clusters. (3) Install Velero with geo-redundant blob storage backend in UAE North. Schedule Velero backups per RPO. (4) Geo-replicate ACR (Premium tier — add UAE North replica). (5) Use ANF CRR for ANF-backed PVs. (6) Deploy Azure Front Door for health-probe-based traffic failover. (7) Test DR quarterly.",
        "Dependencies":   "Geo-replicated ACR (Premium, mandatory), Azure Front Door, UAE North AKS cluster (IaC), Velero + Azure Blob plugin, UAE North GRS Blob Storage, ANF CRR, GitOps repo, UAE North Key Vault, Non-overlapping VNet IP space",
        "ComplianceNote": "Velero backups include PV data and Kubernetes secrets — may contain sensitive data. Ensure UAE North Storage uses encryption and Private Endpoint. Validate data residency with DPO.",
    },
    "microsoft.containerregistry/registries": {
        "BCDRStrategy":   "Active-Active (Geo-Replication)",
        "DRMethod":       "ACR Premium Geo-Replication to UAE North",
        "RPO":            "Near-zero (async replication upon image push)",
        "RTO":            "Automatic — Traffic Manager detects unhealthy replica",
        "Effort":         "Low",
        "CostImpact":     "Low-Medium (Premium tier surcharge)",
        "QuickWin":       "Yes",
        "ActionRequired": "(1) Upgrade ACR to Premium tier. (2) Add UAE North as geo-replication target. (3) Single registry endpoint (e.g., myregistry.azurecr.io) routes to nearest healthy replica. (4) No application config change needed. (5) For AKS: use standard ACR endpoint, not region-specific.",
        "Dependencies":   "Premium tier SKU (mandatory), UAE North replication endpoint",
        "ComplianceNote": "Images replicated to UAE North — review IP/data classification if images embed proprietary model weights or configuration.",
    },

    # ── NETWORKING ────────────────────────────────────────────────────────────
    "microsoft.network/virtualnetworks": {
        "BCDRStrategy":   "Infrastructure Foundation — Pre-provision before other DR actions",
        "DRMethod":       "IaC Mirror VNet in UAE North",
        "RPO":            "N/A (infrastructure)",
        "RTO":            "30 min (pre-staged) / 4+ hours (cold build)",
        "Effort":         "Medium",
        "CostImpact":     "Low (peering/gateway costs)",
        "QuickWin":       "No",
        "ActionRequired": "FOUNDATION: All other DR services depend on UAE North networking. Option A: Peer to existing West Europe Landing Zone (if available). Option B: Build standalone UAE North Landing Zone. Export all VNet topology to Bicep/Terraform. Deploy and validate before any DR event. Plan IP addressing to avoid overlap.",
        "Dependencies":   "Non-overlapping IP address space, UAE North subscription with quotas, GatewaySubnet /27 if gateways required",
        "ComplianceNote": "Network topology is a P1 prerequisite. Without UAE North VNets pre-provisioned, no DR service can function.",
    },
    "microsoft.network/applicationgateways": {
        "BCDRStrategy":   "Active-Passive with Global Load Balancer",
        "DRMethod":       "Azure Front Door + Application Gateway in UAE North",
        "RPO":            "N/A (traffic routing)",
        "RTO":            "< 5 minutes (Front Door health probe)",
        "Effort":         "High",
        "CostImpact":     "High",
        "QuickWin":       "No",
        "ActionRequired": "(1) Deploy AppGW v2 in UAE North DR VNet. (2) Place Azure Front Door in front of both AppGW instances. (3) Sync WAF policy between regions via Azure Policy or Bicep. (4) Ensure SSL certificates available in UAE North Key Vault.",
        "Dependencies":   "UAE North VNet/subnet for AppGW, Azure Front Door profile, SSL certificates in UAE North Key Vault, WAF policy parity",
        "ComplianceNote": "Ensure WAF policy parity between regions. AppGW v2 in UAE North can use ZR for improved availability.",
    },
    "microsoft.network/loadbalancers": {
        "BCDRStrategy":   "Active-Passive",
        "DRMethod":       "Standard Load Balancer in UAE North + Azure Traffic Manager",
        "RPO":            "N/A",
        "RTO":            "Traffic Manager DNS TTL (60–300 seconds)",
        "Effort":         "Medium",
        "CostImpact":     "Low-Medium",
        "QuickWin":       "No",
        "ActionRequired": "Deploy Standard LB in UAE North. Configure Azure Traffic Manager with Qatar Central and UAE North endpoints. Set health probe for automatic failover. Upgrade any Basic LBs to Standard.",
        "Dependencies":   "UAE North VNet/backend pool VMs, Traffic Manager profile, Standard LB SKU",
        "ComplianceNote": "Standard LB required for cross-region scenarios. Basic LB is being retired.",
    },
    "microsoft.network/bastionhosts": {
        "BCDRStrategy":   "Active-Passive (Operational Access)",
        "DRMethod":       "Deploy Azure Bastion Standard in UAE North DR VNet",
        "RPO":            "N/A (management plane)",
        "RTO":            "1–2 hours (if not pre-provisioned)",
        "Effort":         "Low",
        "CostImpact":     "Low-Medium",
        "QuickWin":       "Yes",
        "ActionRequired": "Pre-provision Azure Bastion (Standard tier) in UAE North Hub VNet. Required for secure VM access during DR. Use Bastion Shareable Links for operations team access. Standard tier supports VNet peering.",
        "Dependencies":   "UAE North Hub VNet, AzureBastionSubnet /26 minimum",
        "ComplianceNote": "Bastion removes public RDP/SSH exposure. Deploy BEFORE DR event.",
    },
    "microsoft.network/publicipaddresses": {
        "BCDRStrategy":   "Active-Passive (DNS Failover)",
        "DRMethod":       "Pre-provision Static Public IPs in UAE North + Azure Traffic Manager",
        "RPO":            "N/A",
        "RTO":            "DNS TTL (60–300 seconds)",
        "Effort":         "Low",
        "CostImpact":     "Minimal",
        "QuickWin":       "Yes",
        "ActionRequired": "Reserve Static Public IPs in UAE North (Standard SKU) for DR services. Attach to DR LBs, AppGW, Bastion. Use Traffic Manager or Azure Front Door for DNS-based failover. Lower DNS TTL to 60s before DR exercises. Migrate any Basic Public IPs to Standard.",
        "Dependencies":   "UAE North Resource Group, Standard SKU Public IP, Traffic Manager profile",
        "ComplianceNote": "Basic SKU is being retired — migrate all Basic Public IPs to Standard.",
    },
    "microsoft.network/virtualnetworkgateways": {
        "BCDRStrategy":   "Active-Passive (BGP-enabled Gateway Failover)",
        "DRMethod":       "BGP-enabled VPN Gateway in UAE North",
        "RPO":            "N/A (connectivity infrastructure)",
        "RTO":            "Near-automatic (BGP reconvergence < 60 sec); 30–60 min if not pre-provisioned",
        "Effort":         "High",
        "CostImpact":     "High",
        "QuickWin":       "No",
        "ActionRequired": "(1) Deploy VPN Gateway in UAE North Hub VNet (VpnGw2+). (2) Enable BGP on UAE North gateway. (3) Configure S2S VPN from on-premises to UAE North as secondary path. (4) Set BGP route preferences so Qatar Central is preferred; UAE North is secondary. (5) Test BGP failover — confirm traffic reroutes within 60 seconds.",
        "Dependencies":   "UAE North Hub VNet, GatewaySubnet /27, BGP ASN configured, On-premises VPN device with BGP support",
        "ComplianceNote": "Validate that routing traffic via UAE North complies with customer's data sovereignty policy.",
    },
    "microsoft.network/privatednszones": {
        "BCDRStrategy":   "Infrastructure Configuration DR",
        "DRMethod":       "Link Private DNS Zones to UAE North VNet",
        "RPO":            "N/A",
        "RTO":            "Minutes",
        "Effort":         "Low",
        "CostImpact":     "Minimal",
        "QuickWin":       "Yes",
        "ActionRequired": "Link existing Private DNS zones to UAE North DR VNet (Virtual Network Links). Ensure Private DNS Resolver or custom DNS in UAE North is configured. Critical for all private endpoint-based services.",
        "Dependencies":   "UAE North VNet, Private DNS Resolver in UAE North if multi-hub",
        "ComplianceNote": "Critical for all private endpoint-based services — without UAE North VNet links, DR services cannot resolve private endpoint DNS names.",
    },
    "microsoft.network/networksecuritygroups": {
        "BCDRStrategy":   "Infrastructure Configuration DR",
        "DRMethod":       "Export NSG rules to IaC — Redeploy in UAE North",
        "RPO":            "N/A",
        "RTO":            "15–30 minutes",
        "Effort":         "Low",
        "CostImpact":     "None",
        "QuickWin":       "Yes",
        "ActionRequired": "Export all NSG rules to Bicep/ARM. Store in Azure DevOps/GitHub. Include NSG deployment in DR runbook. Use Azure Policy to enforce NSG standards in both regions.",
        "Dependencies":   "IaC repository, Azure DevOps pipeline or GitHub Actions",
        "ComplianceNote": "NSGs are the primary network-layer defense. Ensure NSG rules don't inadvertently allow traffic after failover.",
    },
    "microsoft.network/privateendpoints": {
        "BCDRStrategy":   "Active-Passive (Recreate in UAE North)",
        "DRMethod":       "Script Private Endpoint creation in UAE North via IaC",
        "RPO":            "N/A",
        "RTO":            "10–30 minutes",
        "Effort":         "Low",
        "CostImpact":     "Low",
        "QuickWin":       "Yes",
        "ActionRequired": "Script Private Endpoint creation for all UAE North DR services using Bicep. Include PE DNS records in Private DNS zones. Automate as part of DR runbook. All DR services should also use Private Endpoints.",
        "Dependencies":   "UAE North VNet/subnets, DR service instances in UAE North, Private DNS zones linked to UAE North VNet",
        "ComplianceNote": "Private Endpoints eliminate public internet exposure. All DR services should use Private Endpoints — do not expose DR services publicly.",
    },

    # ── KEY VAULT ─────────────────────────────────────────────────────────────
    "microsoft.keyvault/vaults": {
        "BCDRStrategy":   "Active-Passive (Custom Cross-Region Sync)",
        "DRMethod":       "Azure Function / Logic App Custom Sync to Mirror Key Vault in UAE North",
        "RPO":            "Near-real-time (Function triggered by KV Event Grid events)",
        "RTO":            "< 1 hour (applications redirect to UAE North KV URI)",
        "Effort":         "Medium",
        "CostImpact":     "Low",
        "QuickWin":       "No",
        "ActionRequired": "CRITICAL QATAR CONSTRAINT: Key Vault does NOT automatically sync across non-paired regions. Custom synchronization is MANDATORY. Steps: (1) Create mirrored Key Vault in UAE North. (2) Implement custom sync using Azure Function or Logic App triggered by KV Event Grid events. (3) Enable Soft Delete and Purge Protection on ALL vaults. (4) Update DR application configurations to reference UAE North KV URI. (5) Configure certificate auto-renewal in UAE North KV.",
        "Dependencies":   "Azure Function or Logic App for event-triggered sync, Event Grid subscription on each Qatar Central KV, UAE North Key Vault with matching RBAC, UAE North VNet Private Endpoint",
        "ComplianceNote": "Key Vault holds credentials, certificates, and encryption keys — most sensitive data. HSM-protected keys CANNOT be exported — CMK-encrypted resources must have UAE North HSM key vault. Enable Soft Delete, Purge Protection, and Azure Defender for Key Vault on all vaults.",
    },

    # ── APP SERVICES ──────────────────────────────────────────────────────────
    "microsoft.web/sites": {
        "BCDRStrategy":   "Active-Passive (Identical Standby) or Active-Active",
        "DRMethod":       "Pre-Deployed App Service in UAE North + Azure Front Door",
        "RPO":            "Near-zero (stateless) / State-dependent (stateful: align with storage/database RPO)",
        "RTO":            "< 5 minutes (Azure Front Door health probe-based rerouting)",
        "Effort":         "Medium",
        "CostImpact":     "Medium",
        "QuickWin":       "No",
        "ActionRequired": "Deploy identical App Service in UAE North using region-parameterized IaC. Use App Service Backup/Restore to GRS-enabled storage. Deploy Azure Front Door in front of both instances. CI/CD pipeline targets both regions. Use Key Vault references for all app settings. Disable direct-IP access — restrict to Azure Front Door only.",
        "Dependencies":   "UAE North App Service Plan, Azure Front Door, SSL certificates in UAE North Key Vault, CI/CD pipeline targeting both regions, GRS Storage Account for backup, UAE North database/storage DR",
        "ComplianceNote": "App Service configuration may contain secrets — use Key Vault references only, never inline secrets. Session state must be backed by geo-replicated Redis or stateless JWT.",
    },
    "microsoft.web/serverfarms": {
        "BCDRStrategy":   "Active-Passive (Pre-provisioned)",
        "DRMethod":       "Pre-provision App Service Plan in UAE North via IaC",
        "RPO":            "N/A (infrastructure)",
        "RTO":            "App deployment is the bottleneck",
        "Effort":         "Low",
        "CostImpact":     "Medium (plan charges even at idle)",
        "QuickWin":       "No",
        "ActionRequired": "Create App Service Plans in UAE North at same SKU (or lower for standby, scale up during DR). Include in IaC templates.",
        "Dependencies":   "UAE North resource group",
        "ComplianceNote": "App Service Environment requires dedicated VNet subnet — pre-stage UAE North ASE VNet/subnet if customer uses ASE.",
    },
    "microsoft.web/staticsites": {
        "BCDRStrategy":   "Active-Active (Global CDN — Built-In)",
        "DRMethod":       "No additional DR action needed — Azure Static Web Apps are globally distributed",
        "RPO":            "N/A",
        "RTO":            "Automatic",
        "Effort":         "None",
        "CostImpact":     "None",
        "QuickWin":       "Yes",
        "ActionRequired": "No action required for DR — Static Web Apps use global Azure CDN distribution natively. Verify custom domain and SSL certificate validity. Ensure backend API (if any) has DR coverage.",
        "Dependencies":   "Backend API DR coverage (if applicable)",
        "ComplianceNote": "Static content distributed globally. Review CDN security headers if content is sensitive.",
    },

    # ── MESSAGING / INTEGRATION ───────────────────────────────────────────────
    "microsoft.eventhub/namespaces": {
        "BCDRStrategy":   "Active-Passive (Metadata Geo-DR or Full Geo-Replication)",
        "DRMethod":       "[Standard] Metadata Geo-DR | [Premium/Dedicated] Geo-Replication",
        "RPO":            "[Standard] Near-zero for config; in-flight events LOST | [Premium] Near-zero for events + metadata",
        "RTO":            "< 10 minutes (alias failover — manually initiated)",
        "Effort":         "Medium",
        "CostImpact":     "Medium (Standard) / High (Premium Geo-Replication)",
        "QuickWin":       "No",
        "ActionRequired": "Standard: Configure Geo-DR pairing to UAE North — replicates configuration ONLY, NOT event data. Use Geo-DR Alias endpoint in all producer/consumer connection strings. Failover is MANUAL. For zero event loss: Upgrade to Premium and configure Geo-Replication which replicates events + metadata.",
        "Dependencies":   "UAE North Event Hubs namespace (same tier), Alias/Geo-Replication endpoint in all apps",
        "ComplianceNote": "Standard Geo-DR: apps MUST implement idempotency and event replay since in-flight events are NOT recoverable after failover.",
    },
    "microsoft.servicebus/namespaces": {
        "BCDRStrategy":   "Active-Passive (Geo-DR or Geo-Replication)",
        "DRMethod":       "[Premium] Alias-based Geo-DR or Full Geo-Replication to UAE North",
        "RPO":            "[Geo-DR] Config: near-zero; Messages: LOST | [Geo-Replication] Messages + config: near-zero",
        "RTO":            "Nearly instantaneous once failover is manually initiated",
        "Effort":         "Medium",
        "CostImpact":     "Medium (Geo-DR) / High (Geo-Replication)",
        "QuickWin":       "No",
        "ActionRequired": "Premium tier REQUIRED for both Geo-DR and Geo-Replication. Use Geo-DR Alias endpoint in ALL connection strings. Failover is MANUAL. For mission-critical message streams: upgrade to Premium and configure Geo-Replication.",
        "Dependencies":   "Premium tier namespace (mandatory), UAE North Service Bus namespace, Alias endpoint in all apps",
        "ComplianceNote": "Service Bus messages may contain business transaction data — UAE North replication must be approved by data residency review.",
    },

    # ── API MANAGEMENT ────────────────────────────────────────────────────────
    "microsoft.apimanagement/service": {
        "BCDRStrategy":   "Active-Active (Premium Multi-Region) or Active-Passive (Backup/Restore)",
        "DRMethod":       "[Preferred] APIM Premium Multi-Region with UAE North Regional Gateway | [Fallback] Scheduled Backup/Restore",
        "RPO":            "[Multi-region] Near-zero | [Backup/Restore] Up to 24h",
        "RTO":            "[Multi-region] < 5 min | [Backup/Restore] 30 min – 4 hours",
        "Effort":         "High",
        "CostImpact":     "Very High (Premium multi-region = 2x unit cost) / Medium (Backup/Restore)",
        "QuickWin":       "No",
        "ActionRequired": "Option A (Production): Upgrade to Premium tier. Add UAE North as secondary regional gateway. Use Azure Front Door to distribute API traffic. Option B (Cost-Optimized): Schedule daily APIM backup to GRS storage account. On DR: restore to UAE North deployment. Re-apply custom domains after restore.",
        "Dependencies":   "Premium tier (Option A), UAE North VNet with APIM subnet, SSL/custom domains in UAE North Key Vault, Azure Front Door, GRS Storage for backups",
        "ComplianceNote": "APIM stores API subscriptions, products, policies, and developer data. Backup excludes logs and reports — document what is NOT covered.",
    },

    # ── KEY VAULT ─────────────────────────────────────────────────────────────
    "microsoft.logic/workflows": {
        "BCDRStrategy":   "Active-Passive (Pre-Deployed Standby)",
        "DRMethod":       "Standby Logic App in UAE North via IaC + Region-Parameterized Connections",
        "RPO":            "Near-zero (if standby pre-deployed and continuously updated via IaC)",
        "RTO":            "< 30 minutes (traffic switch); 1–2 hours if rebuilding from scratch",
        "Effort":         "Medium",
        "CostImpact":     "Low-Medium",
        "QuickWin":       "No",
        "ActionRequired": "Logic Apps are region-specific — a pre-deployed standby in UAE North is the ONLY reliable DR approach. Steps: (1) Use region-parameterized IaC. (2) Deploy UAE North Logic App in DISABLED state. (3) Reconfigure all connections to UAE North service endpoints. (4) Implement Traffic Manager for HTTP-triggered or Service Bus topic routing for message-triggered apps.",
        "Dependencies":   "UAE North resource group, IaC Bicep/ARM with region parameterization, UAE North connections pre-authorized, Traffic Manager or Service Bus routing",
        "ComplianceNote": "Logic App connection OAuth tokens are region-scoped and NOT exportable — must be re-authorized in UAE North. Use service principals or Managed Identity for connectors.",
    },

    # ── RECOVERY SERVICES ─────────────────────────────────────────────────────
    "microsoft.recoveryservices/vaults": {
        "BCDRStrategy":   "Backup & Region of Choice (RoC) for Qatar Central | CRR for paired regions",
        "DRMethod":       "[Qatar Central] Azure Backup Region of Choice (RoC — Preview) | [Paired Regions] Standard CRR",
        "RPO":            "Backup frequency (daily / 4-hourly enhanced policy)",
        "RTO":            "4–8 hours (restore from RoC or CRR secondary)",
        "Effort":         "Medium (RoC requires Microsoft Engineering engagement)",
        "CostImpact":     "Low-Medium",
        "QuickWin":       "No",
        "ActionRequired": "QATAR CENTRAL: Standard GRS-based CRR is NOT available (no paired region). Use Azure Backup Region of Choice (RoC) — Preview: (1) Supported workloads: IaaS VM, SQL in VM, SAP HANA, Azure File Share. (2) Valid target regions: Sweden Central or Switzerland North ONLY. (3) Requires Microsoft Engineering engagement via account team. Enable Soft Delete and Multi-User Authorization (MUA) on ALL vaults.",
        "Dependencies":   "Microsoft Engineering engagement for RoC, Target vault in Sweden Central or Switzerland North, Separate ASR RSV in DR region for VM replication",
        "ComplianceNote": "RoC replicates to Sweden Central or Switzerland North — validate Qatar PDPPL compliance. Enable Soft Delete and MUA to prevent accidental deletion.",
    },

    # ── ANF ────────────────────────────────────────────────────────────────────
    "microsoft.netapp/netappaccounts": {
        "BCDRStrategy":   "Active-Passive (Async Volume Replication)",
        "DRMethod":       "ANF Cross-Region Replication (CRR) to UAE North",
        "RPO":            "15–60 minutes (configurable replication schedule)",
        "RTO":            "1–2 hours (break replication + mount)",
        "Effort":         "Medium",
        "CostImpact":     "Medium-High",
        "QuickWin":       "No",
        "ActionRequired": "(1) Create ANF Account in UAE North. (2) Create destination capacity pool. (3) Enable ANF CRR on each volume to UAE North. (4) Configure replication schedule based on RPO. (5) Document DR activation: break replication → mount destination volumes on UAE North VMs.",
        "Dependencies":   "UAE North ANF Account, Capacity Pool, VNet delegation for ANF",
        "ComplianceNote": "ANF CRR replicates to UAE North — verify data classification and residency requirements.",
    },

    # ── CACHE ─────────────────────────────────────────────────────────────────
    "microsoft.cache/redis": {
        "BCDRStrategy":   "Active-Passive (Geo-Replication) or Export/Import Fallback",
        "DRMethod":       "[Preferred] Redis Cache Premium Geo-Replication | [Fallback] Scheduled Export to GRS Storage",
        "RPO":            "[Geo-Replication] Near-zero (async, possible brief data loss on failover) | [Export] Export schedule frequency",
        "RTO":            "[Geo-Replication] Minutes (manual unlink + promote) | [Export/Import] 1–2 hours",
        "Effort":         "Medium",
        "CostImpact":     "High (Premium tier + UAE North cache at same size)",
        "QuickWin":       "No",
        "ActionRequired": "Geo-Replication requires PREMIUM tier. Steps: (1) Upgrade to Premium. (2) Configure Geo-Replication linking Qatar Central (primary) to UAE North (secondary — same or larger). (3) DR failover requires manual 'unlink' to promote secondary. (4) Schedule RDB exports to GRS storage as point-in-time recovery fallback.",
        "Dependencies":   "Premium tier for both caches, UAE North Premium Redis Cache, GRS Storage for RDB exports",
        "ComplianceNote": "Redis may hold sessions or sensitive cached data. Use Private Endpoints in both regions. Geo-replicated cache in UAE North holds a copy of all cached data — review Qatar PDPLL compliance.",
    },

    # ── DATA FACTORY ──────────────────────────────────────────────────────────
    "microsoft.datafactory/factories": {
        "BCDRStrategy":   "Active-Passive (Git-based DR)",
        "DRMethod":       "ADF Git Integration + Automated Redeployment to UAE North",
        "RPO":            "Git commit frequency",
        "RTO":            "1–2 hours",
        "Effort":         "Medium",
        "CostImpact":     "Medium",
        "QuickWin":       "No",
        "ActionRequired": "(1) Enable Git integration for all ADF instances. (2) Create DR ADF instance in UAE North. (3) Implement automated deployment pipeline to publish ADF artifacts from Git to UAE North on DR trigger. (4) Reconfigure linked service credentials via Key Vault references. (5) Self-hosted IR in UAE North must be provisioned separately.",
        "Dependencies":   "Git repository with ADF artifacts, UAE North ADF instance, UAE North SHIR, Linked service credential refresh",
        "ComplianceNote": "ADF pipelines may access on-premises data — ensure connectivity from UAE North (VPN/ExpressRoute).",
    },

    # ── MONITORING ────────────────────────────────────────────────────────────
    "microsoft.operationalinsights/workspaces": {
        "BCDRStrategy":   "Active-Active (Dual-Ingestion) for Security / Active-Passive for General",
        "DRMethod":       "Dual-Ingestion to Qatar Central + UAE North | Log Analytics Data Export",
        "RPO":            "Near-zero (dual-ingestion) / Log export interval (data export)",
        "RTO":            "1–2 hours (workspace redirect); Near-zero with dual-ingestion",
        "Effort":         "Medium",
        "CostImpact":     "Medium-High (dual-ingestion doubles log cost)",
        "QuickWin":       "No",
        "ActionRequired": "SECURITY/SENTINEL workspaces: Implement Dual-Ingestion to both regions simultaneously. Configure all Diagnostic Settings to send to both workspace resource IDs. For AMA agents: configure DCR targeting both workspaces. GENERAL workspaces: Configure Log Analytics Data Export to UAE North storage or Event Hub. Pre-deploy UAE North workspace before DR event.",
        "Dependencies":   "UAE North Log Analytics Workspace, UAE North Storage/Event Hub for export, AMA/DCR for dual-agent reporting",
        "ComplianceNote": "Log data may contain security events and PII. Dual-ingestion to UAE North must be approved by information security and data protection teams. Verify Qatar PDPLL compliance.",
    },

    # ── CONTAINER INSTANCES ───────────────────────────────────────────────────
    "microsoft.containerinstance/containergroups": {
        "BCDRStrategy":   "Active-Passive (Redeploy from Template)",
        "DRMethod":       "IaC Redeployment in UAE North + Azure Traffic Manager",
        "RPO":            "N/A (stateless containers)",
        "RTO":            "< 15 minutes",
        "Effort":         "Low",
        "CostImpact":     "Low",
        "QuickWin":       "Yes",
        "ActionRequired": "Export ACI container group definitions to ARM/Bicep. Store in version control. Script redeployment to UAE North. Use Azure Traffic Manager for DNS failover if ACI exposes public endpoints.",
        "Dependencies":   "IaC templates in source control, UAE North resource group, Container images in geo-replicated ACR",
        "ComplianceNote": "ACI is stateless by default. Ensure any persistent storage is backed by geo-redundant Azure Files.",
    },

    # ── EVENT GRID ────────────────────────────────────────────────────────────
    "microsoft.eventgrid/systemtopics": {
        "BCDRStrategy":   "Platform-Managed (Regional built-in redundancy)",
        "DRMethod":       "Event Grid subscription replication to UAE North handlers",
        "RPO":            "Near-zero (platform HA)",
        "RTO":            "Platform-managed",
        "Effort":         "Low",
        "CostImpact":     "None",
        "QuickWin":       "Yes",
        "ActionRequired": "Event Grid System Topics are platform-redundant within region. For DR: ensure Event Grid subscriptions point to UAE North handlers (Functions, Logic Apps, Webhooks) during failover. Recreate subscriptions in UAE North using IaC if source service fails over.",
        "Dependencies":   "UAE North event handler endpoints (Azure Functions, Logic Apps, etc.)",
        "ComplianceNote": "Event Grid is a regional service but resilient within the region. Subscription endpoints must be updated to UAE North targets during DR.",
    },

    # ── DATABRICKS ────────────────────────────────────────────────────────────
    "microsoft.databricks/workspaces": {
        "BCDRStrategy":   "Active-Passive (Config Export + Redeploy)",
        "DRMethod":       "Databricks CLI Export → Git → UAE North Workspace Deployment",
        "RPO":            "Git-backed notebook/config export frequency",
        "RTO":            "2–4 hours",
        "Effort":         "High",
        "CostImpact":     "High",
        "QuickWin":       "No",
        "ActionRequired": "1) Enable Databricks Repos (Git integration) for all notebooks. 2) Export cluster configs, job definitions, secret scopes using Databricks CLI into Git. 3) Deploy Databricks workspace in UAE North. 4) Restore from Git using automated pipeline. 5) Replicate data in mounted ADLS/Blob via GRS. 6) Recreate secret scopes linked to UAE North Key Vault.",
        "Dependencies":   "Git repository, Azure DevOps pipeline, UAE North VNet/private endpoint for Databricks, ADLS with GRS, UAE North Key Vault",
        "ComplianceNote": "Databricks workspace-level secrets are NOT exported automatically. Cluster access tokens must be regenerated. Managed Identity and AAD group permissions must be reconfigured in UAE North.",
    },

    # ── ANF CAPACITY POOLS ────────────────────────────────────────────────────
    "microsoft.netapp/netappaccounts/capacitypools": {
        "BCDRStrategy":   "Active-Passive (Part of ANF CRR setup)",
        "DRMethod":       "ANF CRR — Destination Capacity Pool in UAE North",
        "RPO":            "15–60 minutes",
        "RTO":            "1–2 hours",
        "Effort":         "Low (configuration part of ANF CRR)",
        "CostImpact":     "Medium (pre-provisioned capacity in UAE North)",
        "QuickWin":       "No",
        "ActionRequired": "Create destination capacity pool in UAE North ANF account. This is a prerequisite for ANF CRR volume replication. Recommended tier: same as source (Standard/Premium). Include in DR IaC templates.",
        "Dependencies":   "UAE North ANF Account must exist first",
        "ComplianceNote": "Capacity pool provisioning is required before volumes can be replicated. Plan capacity sizing carefully — ANF is billed on provisioned capacity.",
    },

    # ── ANF VOLUMES ───────────────────────────────────────────────────────────
    "microsoft.netapp/netappaccounts/capacitypools/volumes": {
        "BCDRStrategy":   "Active-Passive (Volume-level ANF CRR)",
        "DRMethod":       "ANF Volume Cross-Region Replication (CRR) to UAE North",
        "RPO":            "15–60 minutes (schedule: hourly/daily)",
        "RTO":            "1–2 hours",
        "Effort":         "Medium",
        "CostImpact":     "Medium-High",
        "QuickWin":       "No",
        "ActionRequired": "Enable CRR individually on each production ANF volume. Select replication schedule based on data criticality. Document DR activation: 1) Break replication 2) Mount destination volume on UAE North VMs 3) Validate data integrity 4) Redirect application.",
        "Dependencies":   "UAE North capacity pool (same tier/size), Networking in UAE North for ANF mount, DR VMs or AKS in UAE North",
        "ComplianceNote": "ANF volumes contain application data. CRR replicates to UAE North — verify data classification and residency requirements.",
    },

    # ── COGNITIVE SERVICES / AI ───────────────────────────────────────────────
    "microsoft.cognitiveservices/accounts": {
        "BCDRStrategy":   "Active-Active or Active-Passive",
        "DRMethod":       "Deploy Cognitive Services in UAE North + APIM/Traffic Manager",
        "RPO":            "N/A (stateless inference)",
        "RTO":            "< 5 minutes",
        "Effort":         "Low-Medium",
        "CostImpact":     "Medium",
        "QuickWin":       "Yes",
        "ActionRequired": "Deploy equivalent Cognitive Services / Azure AI Services instances in UAE North. Route via Azure API Management (multi-region) or Traffic Manager. Sync model configurations and fine-tuned models. For OpenAI: ensure model deployments are pre-provisioned in UAE North (capacity dependent). Update API keys/endpoints in application config (use Key Vault).",
        "Dependencies":   "UAE North Cognitive Services quota and model availability, API keys in UAE North Key Vault, Application config update",
        "ComplianceNote": "Some may process sensitive/NLP data. Verify data classification and whether UAE North is a compliant location for data processing. Azure AI Services share no data between regions.",
    },

    # ── APPLICATION INSIGHTS ──────────────────────────────────────────────────
    "microsoft.insights/components": {
        "BCDRStrategy":   "Active-Passive (Redirect Instrumentation Key)",
        "DRMethod":       "Deploy App Insights in UAE North + Key switch on DR",
        "RPO":            "Near-real-time (dual instrumentation)",
        "RTO":            "< 1 hour",
        "Effort":         "Low",
        "CostImpact":     "Low-Medium",
        "QuickWin":       "Yes",
        "ActionRequired": "Deploy Application Insights in UAE North. Store instrumentation key/connection string in Key Vault. DR applications in UAE North reference the UAE North App Insights instance. No data is lost — UAE North apps log to UAE North App Insights from start.",
        "Dependencies":   "UAE North App Insights tied to UAE North Log Analytics Workspace",
        "ComplianceNote": "App Insights data includes application telemetry and performance data. Negligible data residency concern — confirm with customer.",
    },

    # ── MANAGED IDENTITY ──────────────────────────────────────────────────────
    "microsoft.managedidentity/userassignedidentities": {
        "BCDRStrategy":   "Active-Passive (IaC Recreation)",
        "DRMethod":       "Recreate User-Assigned Managed Identities in UAE North",
        "RPO":            "N/A (identity resource)",
        "RTO":            "30 minutes",
        "Effort":         "Low",
        "CostImpact":     "None",
        "QuickWin":       "Yes",
        "ActionRequired": "Create User-Assigned Managed Identities in UAE North resource group using IaC. Assign same RBAC roles in UAE North (RBAC assignments are not cross-region, must be re-applied). Include in DR IaC automation.",
        "Dependencies":   "UAE North resource group, RBAC role assignment automation in DR runbook",
        "ComplianceNote": "Managed Identities have no data to replicate. Pure configuration resource. Prioritize automation of RBAC assignments in UAE North to reduce RTO.",
    },

    # ── MACHINE LEARNING ──────────────────────────────────────────────────────
    "microsoft.machinelearningservices/workspaces": {
        "BCDRStrategy":   "Active-Passive (Model Registry Sync)",
        "DRMethod":       "Deploy AML Workspace in UAE North + Model Export + Pipeline Redeployment",
        "RPO":            "Model registry: configurable sync schedule",
        "RTO":            "2–4 hours",
        "Effort":         "High",
        "CostImpact":     "High",
        "QuickWin":       "No",
        "ActionRequired": "1) Deploy Azure ML Workspace in UAE North. 2) Configure linked Storage with GRS. 3) Register trained models in UAE North model registry (automated via CI/CD). 4) Export compute cluster configs and environment definitions. 5) Pipeline to redeploy training/inference in UAE North. 6) For inference: deploy managed online endpoints in UAE North and route via Traffic Manager.",
        "Dependencies":   "UAE North AML workspace, GRS Storage, Key Vault, Container Registry (geo-replicated ACR), training compute (GPU quotas in UAE North)",
        "ComplianceNote": "ML models may encode sensitive data patterns. Evaluate IP sensitivity before cross-region replication. GPU quota availability in UAE North must be verified.",
    },

    # ── REDIS ENTERPRISE ──────────────────────────────────────────────────────
    "microsoft.cache/redisenterprise": {
        "BCDRStrategy":   "Active-Active (Geo-Replication)",
        "DRMethod":       "Redis Enterprise Active Geo-Replication to UAE North",
        "RPO":            "Near-zero (async replication with eventual consistency)",
        "RTO":            "Automatic (application reconnects to healthy endpoint)",
        "Effort":         "Medium",
        "CostImpact":     "High (Redis Enterprise tier, doubled for two regions)",
        "QuickWin":       "No",
        "ActionRequired": "Configure Redis Enterprise Active Geo-Replication linking Qatar Central and UAE North clusters. Use geo-distributed compute endpoint in application. Note: Active Geo-Replication requires Enterprise or Enterprise Flash tier. Ensure VNet Peering between regions for inter-cluster replication.",
        "Dependencies":   "UAE North Redis Enterprise cluster at same tier/capacity, VNet Peering between QC and UAE North, Enterprise tier SKU",
        "ComplianceNote": "Redis Enterprise data is replicated to UAE North. Session data or cached sensitive query results may require data residency review. Use TLS and Redis AUTH for encryption in transit.",
    },

    # ── AVS ───────────────────────────────────────────────────────────────────
    "microsoft.avs/privateclouds": {
        "BCDRStrategy":   "Active-Passive (VMware HCX + Site Recovery Manager)",
        "DRMethod":       "VMware HCX + Azure Site Recovery Manager (SRM) to UAE North AVS",
        "RPO":            "15 minutes (HCX replication)",
        "RTO":            "2–4 hours",
        "Effort":         "Very High",
        "CostImpact":     "Very High",
        "QuickWin":       "No",
        "ActionRequired": "1) Deploy AVS Private Cloud in UAE North (major cost commitment). 2) Configure VMware HCX for cross-region workload migration and replication. 3) Use VMware Site Recovery Manager (SRM) for orchestrated failover. 4) Alternative: use Azure Migrate to lift-and-shift critical VMs to native Azure VMs — then apply standard ASR DR.",
        "Dependencies":   "UAE North AVS Private Cloud (3-node minimum), ExpressRoute circuit, VMware HCX license, SRM license",
        "ComplianceNote": "AVS is the most expensive DR option. Conduct a cost-benefit analysis vs. migration to native Azure VMs. Work with Microsoft account team for AVS DR design.",
    },

    # ── AI SEARCH ─────────────────────────────────────────────────────────────
    "microsoft.search/searchservices": {
        "BCDRStrategy":   "Active-Passive (Index Repopulation)",
        "DRMethod":       "Deploy Azure AI Search in UAE North + Reindex from Source",
        "RPO":            "Indexer run frequency",
        "RTO":            "Indexer run duration (1–6 hours depending on data volume)",
        "Effort":         "Medium",
        "CostImpact":     "Medium",
        "QuickWin":       "No",
        "ActionRequired": "Deploy Azure AI Search in UAE North. Pre-create indexes with same schema. Configure indexers to point to UAE North data sources. On DR: run indexers to populate. Use Traffic Manager for search endpoint routing. For lower RTO: keep UAE North indexers running continuously.",
        "Dependencies":   "UAE North data sources accessible, UAE North AI Search instance, Traffic Manager endpoint",
        "ComplianceNote": "Search indexes are derived from source data — no independent data residency concern. Secrets in indexer data source connections must be stored in UAE North Key Vault.",
    },

    # ── CONTAINER APPS ────────────────────────────────────────────────────────
    "microsoft.app/containerapps": {
        "BCDRStrategy":   "Active-Active or Active-Passive",
        "DRMethod":       "Deploy Container Apps to UAE North + Azure Front Door",
        "RPO":            "Near-zero (stateless) / Application state-dependent",
        "RTO":            "< 10 minutes (if pre-provisioned environment)",
        "Effort":         "Medium",
        "CostImpact":     "Medium",
        "QuickWin":       "No",
        "ActionRequired": "1) Deploy Container Apps to UAE North Managed Environment. 2) Use geo-replicated ACR for container images. 3) Place Azure Front Door in front for global routing and health-probe-based failover. 4) Replicate any stateful data (Dapr state store, bound storage) to UAE North.",
        "Dependencies":   "UAE North Container Apps Managed Environment, Geo-replicated ACR, Azure Front Door, UAE North stateful backend (Cosmos DB, Redis)",
        "ComplianceNote": "Container Apps use Dapr and Keda — ensure Dapr state store component (Cosmos DB/Redis) is geo-replicated. Secrets in Container Apps environment should reference Azure Key Vault.",
    },
    "microsoft.app/managedenvironments": {
        "BCDRStrategy":   "Active-Passive (Infrastructure Pre-stage)",
        "DRMethod":       "Pre-provision Container Apps Managed Environment in UAE North",
        "RPO":            "N/A (infrastructure)",
        "RTO":            "15–30 minutes",
        "Effort":         "Low",
        "CostImpact":     "Low",
        "QuickWin":       "Yes",
        "ActionRequired": "Pre-provision Container Apps Managed Environment in UAE North using IaC. Include Log Analytics Workspace, VNet integration, and certificates. Prerequisite for deploying Container Apps in UAE North.",
        "Dependencies":   "UAE North Log Analytics Workspace, VNet for internal managed environment",
        "ComplianceNote": "Managed Environment is infrastructure only — no data stored. Low compliance risk.",
    },

    # ── AUTOMATION ────────────────────────────────────────────────────────────
    "microsoft.automation/automationaccounts": {
        "BCDRStrategy":   "Active-Passive (Source Control-Linked DR)",
        "DRMethod":       "Both Qatar Central and UAE North Automation Accounts linked to same Git repository",
        "RPO":            "Git commit frequency (near-real-time if commits on every change)",
        "RTO":            "< 30 minutes (UAE North account already exists; runbooks reload from source control)",
        "Effort":         "Low",
        "CostImpact":     "Low",
        "QuickWin":       "Yes",
        "ActionRequired": "1) Deploy Automation Account in UAE North via IaC. 2) Link BOTH Qatar Central AND UAE North Automation Accounts to the same Git repo — ensures runbooks, modules, schedules remain in parity. 3) Variable assets: document all variables in Key Vault (NOT synced via source control). 4) Use Managed Identity where possible to eliminate stored credentials.",
        "Dependencies":   "GitHub or Azure DevOps repository, UAE North Automation Account, UAE North Managed Identity with appropriate RBAC",
        "ComplianceNote": "Automation runbooks may contain sensitive operational logic. Ensure Git repository is private with access controls. Never store credentials in runbook code — use Managed Identity or Key Vault references.",
    },

    # ── CDN / FRONT DOOR ──────────────────────────────────────────────────────
    "microsoft.cdn/profiles": {
        "BCDRStrategy":   "Active-Active (Global by Design)",
        "DRMethod":       "Azure Front Door is Global — Add UAE North Origins",
        "RPO":            "N/A",
        "RTO":            "Automatic (health probe-based routing)",
        "Effort":         "Low",
        "CostImpact":     "Minimal (additional origin endpoints)",
        "QuickWin":       "Yes",
        "ActionRequired": "Add UAE North origin endpoints to Azure Front Door/CDN profiles. Configure origin groups with health probes. Front Door automatically routes away from unhealthy origins. Verify WAF policy parity if Front Door WAF is enabled.",
        "Dependencies":   "UAE North origin services (App Service, AppGW, etc.) must exist",
        "ComplianceNote": "Azure Front Door is a global anycast service. Traffic routing policies should be reviewed to ensure compliance with data residency requirements.",
    },

    # ── DESKTOP VIRTUALIZATION (AVD) ──────────────────────────────────────────
    "microsoft.desktopvirtualization/hostpools": {
        "BCDRStrategy":   "Active-Passive (User Profile Protected)",
        "DRMethod":       "AVD Secondary Host Pool in UAE North + FSLogix GRS Storage",
        "RPO":            "FSLogix profile: GRS storage RPO (minutes)",
        "RTO":            "2–4 hours",
        "Effort":         "High",
        "CostImpact":     "High",
        "QuickWin":       "No",
        "ActionRequired": "1) Deploy secondary AVD Host Pool in UAE North with matching session host count. 2) Use Azure Files with GRS (or ANF CRR) for FSLogix profile containers. 3) Configure FSLogix Cloud Cache for near-real-time profile replication. 4) Update AVD Workspace with UAE North application group. 5) Configure Traffic Manager or Conditional Access to redirect users during DR.",
        "Dependencies":   "UAE North VMs with AVD session host config, GRS Azure Files or ANF CRR for FSLogix, UAE North VNet with AD/Domain join capability",
        "ComplianceNote": "FSLogix profiles contain user data and potentially sensitive files. GRS replicates to UAE North — verify compliance. Domain controller accessibility from UAE North is critical.",
    },
    "microsoft.desktopvirtualization/applicationgroups": {
        "BCDRStrategy":   "Active-Passive",
        "DRMethod":       "IaC Redeploy Application Groups in UAE North",
        "RPO":            "N/A",
        "RTO":            "As part of Host Pool DR",
        "Effort":         "Low",
        "CostImpact":     "None",
        "QuickWin":       "Yes",
        "ActionRequired": "Include AVD Application Group definitions in DR IaC templates. Assign users/groups to UAE North application groups. Part of Host Pool DR package.",
        "Dependencies":   "UAE North Host Pool",
        "ComplianceNote": "Configuration resource — no data stored.",
    },
    "microsoft.desktopvirtualization/workspaces": {
        "BCDRStrategy":   "Active-Passive",
        "DRMethod":       "Deploy AVD Workspace in UAE North",
        "RPO":            "N/A",
        "RTO":            "As part of Host Pool DR",
        "Effort":         "Low",
        "CostImpact":     "None",
        "QuickWin":       "Yes",
        "ActionRequired": "Deploy AVD Workspace in UAE North linked to UAE North Application Groups. Update workspace friendly name to indicate DR. Publish to users via Conditional Access policy update.",
        "Dependencies":   "UAE North Application Groups",
        "ComplianceNote": "Workspace is a configuration resource. Ensure users are informed of the UAE North workspace URL during DR.",
    },

    # ── PURVIEW ───────────────────────────────────────────────────────────────
    "microsoft.purview/accounts": {
        "BCDRStrategy":   "Active-Passive (Manual Recovery)",
        "DRMethod":       "Purview Backup + UAE North Deployment (limited automation)",
        "RPO":            "Manual export frequency",
        "RTO":            "4–8 hours",
        "Effort":         "High",
        "CostImpact":     "High",
        "QuickWin":       "No",
        "ActionRequired": "Microsoft Purview does not natively support cross-region DR replication. Options: 1) Export collections, policies, scan results via API periodically. 2) Deploy secondary Purview account in UAE North — rescan data sources. 3) Work with Microsoft account team for Purview BCDR roadmap.",
        "Dependencies":   "UAE North Purview account, Re-run of all scan rules in UAE North, Data source connectivity from UAE North",
        "ComplianceNote": "Purview contains data governance metadata, classifications, and sensitivity labels. Loss of Purview does not impact operational workloads but governance visibility is lost. Prioritize based on compliance requirements.",
    },

    # ── HYBRID COMPUTE (ARC) ──────────────────────────────────────────────────
    "microsoft.hybridcompute/machines": {
        "BCDRStrategy":   "N/A (On-Premises — Azure Arc agent is metadata only)",
        "DRMethod":       "Azure Arc re-onboarding in UAE North environment if applicable",
        "RPO":            "N/A (on-premises asset)",
        "RTO":            "Re-onboarding time (hours)",
        "Effort":         "Low",
        "CostImpact":     "None",
        "QuickWin":       "Yes",
        "ActionRequired": "Azure Arc-enabled Servers are on-premises or other cloud VMs managed via Azure. DR for the underlying server is handled by on-premises DR plan. If on-premises systems fail over to a colocation in UAE vicinity, re-register Arc agent with Azure.",
        "Dependencies":   "On-premises DR plan, connectivity from DR site to Azure Arc endpoints",
        "ComplianceNote": "Arc agent communicates with Azure control plane. Verify outbound connectivity requirements from DR site (proxy/firewall rules).",
    },

    # ── NAT GATEWAY ───────────────────────────────────────────────────────────
    "microsoft.network/natgateways": {
        "BCDRStrategy":   "Active-Passive (Outbound Connectivity)",
        "DRMethod":       "Deploy NAT Gateway in UAE North DR VNet subnets",
        "RPO":            "N/A",
        "RTO":            "15–30 minutes",
        "Effort":         "Low",
        "CostImpact":     "Low",
        "QuickWin":       "Yes",
        "ActionRequired": "Pre-provision NAT Gateway in UAE North for subnets requiring outbound internet access. Associate with relevant subnets. Required for DR workloads (AKS, VMs, App Services with VNet integration) to reach external services.",
        "Dependencies":   "UAE North VNet subnets, Public IP or Public IP Prefix in UAE North",
        "ComplianceNote": "NAT Gateway provides SNAT with static outbound IPs. Pre-provision to avoid outbound connectivity issues during DR activation.",
    },

    # ── TRAFFIC MANAGER ───────────────────────────────────────────────────────
    "microsoft.network/trafficmanagerprofiles": {
        "BCDRStrategy":   "Active-Active or Active-Passive (Global DNS)",
        "DRMethod":       "Traffic Manager is Global — Add UAE North Endpoints",
        "RPO":            "N/A",
        "RTO":            "DNS TTL (60–300 seconds typical)",
        "Effort":         "Low",
        "CostImpact":     "Minimal",
        "QuickWin":       "Yes",
        "ActionRequired": "Add UAE North service endpoints to existing Traffic Manager profiles. Configure routing method (Priority for A/P, Weighted for A/A). Set health probe interval. Reduce DNS TTL to 60s. Traffic Manager is a global service — remains available during regional outage.",
        "Dependencies":   "UAE North service endpoints (LB, AppGW, App Service) must exist first",
        "ComplianceNote": "Traffic Manager DNS responses resolve to the healthy endpoint. Clients with cached DNS may still route to failed region during TTL window — design applications with retry logic.",
    },

    # ── DEFAULT FALLBACK ──────────────────────────────────────────────────────
    "default": {
        "BCDRStrategy":   "Active-Passive — Review Service-Specific DR Guidance",
        "DRMethod":       "Cross-Region Replication to UAE North via IaC + Azure Backup",
        "RPO":            "Service-dependent — review Microsoft documentation",
        "RTO":            "2–4 hours (estimated)",
        "Effort":         "Medium",
        "CostImpact":     "Medium",
        "QuickWin":       "No",
        "ActionRequired": "Review Microsoft Azure service-specific BCDR documentation. Evaluate native geo-replication capabilities. Export configuration to IaC. Deploy in UAE North DR environment. Include in DR runbook and test.",
        "Dependencies":   "Service-specific DR dependencies — review docs.microsoft.com",
        "ComplianceNote": "Verify data residency compliance for cross-region replication to UAE North.",
    },
}


# ---------------------------------------------------------------------------
# Criticality mapping
# ---------------------------------------------------------------------------
_CRITICALITY_MAP = {
    "Production":     "Critical",
    "Non-Production": "High",
    "Dev/Test":       "Medium",
    "Sandbox":        "Low",
    "Unknown":        "Medium",
}

_PRIORITY_MAP = {
    "Critical": "P1",
    "High":     "P2",
    "Medium":   "P3",
    "Low":      "P4",
}


# ---------------------------------------------------------------------------
# ZR Context note generator
# ---------------------------------------------------------------------------
def _zr_context(assessment: ZoneAssessment, zone_status: str) -> str:
    if assessment.is_qatar_central:
        if zone_status == "LocallyRedundant":
            return ("Qatar Central: Zone Redundancy is DISABLED (capacity restricted). "
                    "This resource has NO zone redundancy — cross-region DR to UAE North is the primary resilience strategy.")
        if zone_status == "ZoneRedundant":
            return ("Qatar Central: Zone Redundancy is generally DISABLED. "
                    "This resource appears zone-redundant — verify it is still functioning as expected given regional restrictions.")
        return ("Qatar Central: Zone Redundancy is DISABLED (capacity restricted). "
                "Cross-region DR planning required to UAE North, West Europe, or North Europe.")
    if not assessment.has_paired_region:
        return "No Azure paired region for this location. Manual DR region selection required."
    return f"Paired region: {assessment.paired_region}. Standard geo-redundancy applicable."


# ---------------------------------------------------------------------------
# Gap summary generator
# ---------------------------------------------------------------------------
def _gap_summary(assessment: ZoneAssessment, zone_status: str, dr_knowledge: dict) -> str:
    gaps = []
    if zone_status == "LocallyRedundant":
        gaps.append("No zone redundancy (single point of failure within region)")
    elif zone_status == "Zonal":
        gaps.append("Zonal (single zone — not cross-zone redundant)")
    if assessment.is_qatar_central:
        gaps.append("No paired region — no automatic geo-DR")
        gaps.append("Zone Redundancy disabled in Qatar Central")
    if not assessment.geo_redundant and assessment.resource_type == "microsoft.storage/storageaccounts":
        gaps.append("Storage not geo-redundant (GRS unavailable in Qatar Central — use Object Replication)")
    if not gaps:
        gaps.append("Zone redundant — review cross-region DR coverage")
    return "; ".join(gaps)


# ---------------------------------------------------------------------------
# Zone transition path
# ---------------------------------------------------------------------------
_TRANSITION_PATHS = {
    "microsoft.compute/virtualmachines": (
        "1. Identify current physical placement (Azure Portal → VM → Properties → Fault/Update Domain) "
        "2. Capture VM config (OS disk, data disks, NIC, NSG) "
        "3. Create Zonal VM in same region with zone=1 (or 2/3) "
        "4. Use Azure Site Recovery or Disk Snapshot to migrate data "
        "5. Validate and cut over. Estimated downtime: 15–60 min"
    ),
    "microsoft.compute/virtualmachinescalesets": (
        "1. VMSS zone redundancy cannot be added after creation "
        "2. Create new VMSS with zones=[1,2,3] using same image/config "
        "3. Migrate workloads to new VMSS (blue/green deployment) "
        "4. Update Load Balancer backend pool to point to new VMSS "
        "5. Delete old non-zonal VMSS"
    ),
    "microsoft.compute/disks": (
        "Convert Managed Disk LRS → ZRS: "
        "1. Stop the associated VM "
        "2. Create ZRS disk snapshot "
        "3. Create new ZRS disk from snapshot "
        "4. Swap disk on VM "
        "5. Restart VM. Estimated downtime: 5–15 min per VM"
    ),
    "microsoft.storage/storageaccounts": (
        "Qatar Central: ZRS not available. "
        "1. Create new storage account in UAE North with Standard_GRS (UAE North has paired region) "
        "2. Configure Object Replication from Qatar Central to UAE North for block blobs "
        "3. For Azure Files: schedule AzCopy sync to UAE North account "
        "4. Update application connection strings to UAE North primary "
        "5. Verify replication is active"
    ),
    "microsoft.network/publicipaddresses": (
        "1. Create Standard Public IP in UAE North with zone redundancy (zones: [1,2,3]) "
        "2. Associate with UAE North LB/AppGW/Bastion "
        "3. Update DNS records to point to new IP "
        "4. Lower DNS TTL to 60s before cutover"
    ),
    "microsoft.sql/servers/databases": (
        "1. Enable zoneRedundant: true in Azure SQL database properties (Business Critical or Premium tiers) "
        "2. Or configure Auto-Failover Group to UAE North "
        "3. Update application connection string to use failover group listener endpoint "
        "4. Test failover"
    ),
    "microsoft.containerservice/managedclusters": (
        "AKS zone redundancy cannot be added to existing node pools. "
        "1. Create new node pool with availabilityZones=[1,2,3] "
        "2. Cordon and drain existing non-zonal nodes "
        "3. Verify workloads scheduled on new zonal nodes "
        "4. Delete old node pool. Zero-downtime if using blue/green approach"
    ),
    "microsoft.dbforpostgresql/flexibleservers": (
        "Zone redundancy cannot be enabled after creation. "
        "1. Create new Flexible Server with zone_redundant_ha=Enabled in same region "
        "2. Use pg_dump or Point-In-Time Restore to migrate data "
        "3. Update application connection strings "
        "4. Estimated downtime: dependent on DB size"
    ),
    "microsoft.dbformysql/flexibleservers": (
        "Zone redundancy cannot be enabled after creation. "
        "1. Create new Flexible Server with zone_redundant_ha=Enabled in same region "
        "2. Use mysqldump or Point-In-Time Restore to migrate data "
        "3. Update application connection strings "
        "4. Estimated downtime: dependent on DB size"
    ),
    "microsoft.network/applicationgateways": (
        "App Gateway v2 zone redundancy requires zones property at creation. "
        "1. Create new App Gateway v2 with zones=[1,2,3] in same subnet "
        "2. Migrate backend pools and WAF rules "
        "3. Update DNS/frontend IPs "
        "4. Delete old gateway"
    ),
    "microsoft.cache/redis": (
        "Redis zone redundancy requires Premium tier + zones at creation. "
        "1. Create new Premium Redis Cache with zones=[1,2,3] "
        "2. Export RDB from existing cache "
        "3. Import RDB to new zonal cache "
        "4. Update application connection strings "
        "5. Delete old cache"
    ),
}


def _zone_transition_path(rtype: str, zone_status: str) -> str:
    if zone_status == "ZoneRedundant":
        return "Resource is already zone-redundant. Review cross-region DR coverage."
    return _TRANSITION_PATHS.get(rtype, (
        "1. Review Microsoft documentation for zone redundancy options for this resource type "
        "2. Upgrade SKU/tier if required for zone redundancy "
        "3. Configure zone assignment via Azure Portal, IaC, or CLI "
        "4. Validate with Azure Advisor recommendations"
    ))


# ---------------------------------------------------------------------------
# Azure Portal link builder
# ---------------------------------------------------------------------------
def _portal_link(resource_id: str) -> str:
    if not resource_id:
        return "https://portal.azure.com/"
    encoded = resource_id.replace("/", "%2F")
    return f"https://portal.azure.com/#resource{resource_id}"


# ---------------------------------------------------------------------------
# Main recommendation function
# ---------------------------------------------------------------------------
@dataclass
class BCDRRecommendation:
    """Full 19-column SA-level BCDR recommendation for one resource."""
    resource_id:          str
    resource_name:        str
    resource_type:        str
    resource_group:       str
    location:             str
    subscription_id:      str
    zone_status:          str
    zone_detail:          str
    workload_tier:        str
    has_paired_region:    bool
    paired_region:        Optional[str]
    is_qatar_central:     bool
    zone_risk_score:      int
    geo_redundant:        bool

    # 19 SA columns
    sa_criticality:          str = ""
    sa_zr_context:           str = ""
    sa_bcdr_strategy:        str = ""
    sa_dr_region_choice:     str = ""
    sa_dr_method:            str = ""
    sa_rpo:                  str = ""
    sa_rto:                  str = ""
    sa_bcdr_guidance_summary:str = ""
    sa_action_required:      str = ""
    sa_implementation_effort:str = ""
    sa_cost_impact:          str = ""
    sa_priority:             str = ""
    sa_quick_win:            str = ""
    sa_compliance_note:      str = ""
    sa_dependencies:         str = ""
    sa_current_gap_summary:  str = ""
    sa_physical_zone_placement: str = ""
    sa_zone_transition_path: str = ""
    sa_azure_portal_link:    str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def generate_recommendation(assessment: ZoneAssessment) -> BCDRRecommendation:
    """Generate a full 19-column BCDR recommendation from a ZoneAssessment."""
    rtype = assessment.resource_type.lower()
    dk = DR_KNOWLEDGE.get(rtype, DR_KNOWLEDGE["default"])

    criticality = _CRITICALITY_MAP.get(assessment.workload_tier, "Medium")
    priority    = _PRIORITY_MAP.get(criticality, "P3")

    zr_context = _zr_context(assessment, assessment.zone_status)
    gap_summary = _gap_summary(assessment, assessment.zone_status, dk)
    transition_path = _zone_transition_path(rtype, assessment.zone_status)

    # DR region choice
    if assessment.is_qatar_central:
        dr_region = "UAE North (primary) | West Europe / North Europe (NIA-certified secondary — customer to confirm)"
    elif assessment.paired_region:
        dr_region = assessment.paired_region
    else:
        dr_region = "Customer to select based on compliance and latency requirements"

    # Physical zone placement note for VMs
    if rtype == "microsoft.compute/virtualmachines":
        if assessment.zones:
            zone_placement = f"Logical zones: {assessment.zones}. Physical zone mapping depends on subscription-level zone mapping. Run 'az account list-locations --query \"[].availabilityZoneMappings\"' to resolve."
        else:
            zone_placement = "VM is NOT deployed in an Availability Zone (NonZonal). Physical zone placement is UNDETERMINED — VM may reside on any physical host in the region. ZR is BLOCKED in Qatar Central."
    else:
        zone_placement = "Not applicable for this resource type"

    # BCDR guidance summary
    guidance = (
        f"Resource Type: {rtype} | Tier: {assessment.workload_tier} | Zone Status: {assessment.zone_status}. "
        f"Strategy: {dk.get('BCDRStrategy', 'N/A')}. "
        f"DR Method: {dk.get('DRMethod', 'N/A')}. "
        f"Target RPO: {dk.get('RPO', 'N/A')} | Target RTO: {dk.get('RTO', 'N/A')}. "
        f"{'Qatar Central: Zone Redundancy is disabled — cross-region DR to UAE North is mandatory.' if assessment.is_qatar_central else ''}"
    )

    return BCDRRecommendation(
        resource_id=assessment.resource_id,
        resource_name=assessment.resource_name,
        resource_type=assessment.resource_type,
        resource_group=assessment.resource_group,
        location=assessment.location,
        subscription_id=assessment.subscription_id,
        zone_status=assessment.zone_status,
        zone_detail=assessment.zone_detail,
        workload_tier=assessment.workload_tier,
        has_paired_region=assessment.has_paired_region,
        paired_region=assessment.paired_region,
        is_qatar_central=assessment.is_qatar_central,
        zone_risk_score=assessment.zone_risk_score,
        geo_redundant=assessment.geo_redundant,
        sa_criticality=criticality,
        sa_zr_context=zr_context,
        sa_bcdr_strategy=dk.get("BCDRStrategy", ""),
        sa_dr_region_choice=dr_region,
        sa_dr_method=dk.get("DRMethod", ""),
        sa_rpo=dk.get("RPO", ""),
        sa_rto=dk.get("RTO", ""),
        sa_bcdr_guidance_summary=guidance,
        sa_action_required=dk.get("ActionRequired", ""),
        sa_implementation_effort=dk.get("Effort", ""),
        sa_cost_impact=dk.get("CostImpact", ""),
        sa_priority=priority,
        sa_quick_win=dk.get("QuickWin", "No"),
        sa_compliance_note=dk.get("ComplianceNote", ""),
        sa_dependencies=dk.get("Dependencies", ""),
        sa_current_gap_summary=gap_summary,
        sa_physical_zone_placement=zone_placement,
        sa_zone_transition_path=transition_path,
        sa_azure_portal_link=_portal_link(assessment.resource_id),
    )


def generate_all_recommendations(assessments: list[ZoneAssessment]) -> list[BCDRRecommendation]:
    """Generate BCDR recommendations for all assessments."""
    results = []
    for a in assessments:
        try:
            results.append(generate_recommendation(a))
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning("BCDR recommendation failed for %s: %s", a.resource_name, e)
    return results


# ---------------------------------------------------------------------------
# Priority + quick wins summary
# ---------------------------------------------------------------------------
def build_quick_wins(recommendations: list[BCDRRecommendation]) -> list[dict]:
    """Return quick-win recommendations sorted by priority."""
    qw = [r for r in recommendations if r.sa_quick_win == "Yes"]
    qw.sort(key=lambda r: (r.sa_priority, r.zone_risk_score * -1))
    return [r.to_dict() for r in qw[:20]]


def build_priority_summary(recommendations: list[BCDRRecommendation]) -> dict:
    """Aggregate P1/P2/P3/P4 counts and effort/cost breakdown."""
    priority_counts: dict[str, int] = {}
    effort_counts:   dict[str, int] = {}
    strategy_counts: dict[str, int] = {}
    quick_wins = 0

    for r in recommendations:
        p = r.sa_priority or "P4"
        priority_counts[p] = priority_counts.get(p, 0) + 1
        e = r.sa_implementation_effort or "Medium"
        effort_counts[e] = effort_counts.get(e, 0) + 1
        s = r.sa_bcdr_strategy.split("(")[0].strip() if r.sa_bcdr_strategy else "Unknown"
        strategy_counts[s] = strategy_counts.get(s, 0) + 1
        if r.sa_quick_win == "Yes":
            quick_wins += 1

    return {
        "priority_breakdown": priority_counts,
        "effort_breakdown":   effort_counts,
        "strategy_breakdown": strategy_counts,
        "quick_wins_count":   quick_wins,
        "total":              len(recommendations),
    }
