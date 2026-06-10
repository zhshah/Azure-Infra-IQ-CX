"""
Modernization Detector Service

Identifies IaaS → PaaS migration opportunities, database modernisation paths,
containerisation candidates, storage consolidation, and legacy configuration
patterns — using only the resource metadata already collected.

Opportunity types (12 patterns)
─────────────────────────────────
• old_vm_sku            — v2/v3 series VMs → Dv5/Ev5 (same IaaS, newer gen)
• sql_vm_to_paas        — SQL Server on IaaS VM → Azure SQL MI / SQL Database
• vm_to_app_service     — low-CPU VMs → Azure App Service
• app_service_to_aca    — high-cost App Service Plans → Azure Container Apps
• storage_lifecycle     — Storage without lifecycle management → tiered storage
• mysql_to_flex         — Azure MySQL Single Server → Flexible Server
• postgres_to_flex      — Azure PostgreSQL Single Server → Flexible Server
• cosmos_optimize       — Cosmos DB with provisioned throughput → autoscale/serverless
• redis_to_managed      — VMs running Redis → Azure Cache for Redis
• container_candidate   — VMs with web server tags → AKS / Container Apps
• storage_to_files      — File shares on VMs → Azure Files Premium
• network_modernize     — Legacy NVA/LB → Azure Firewall / App Gateway WAFv2
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List
from models.schemas import (
    MigrationStep, ModernizationOpportunity, ResourceMetrics,
    MigrationAssessment, MigrationWaveGroup, FiveRSummary,
    MigrationCategorySummary,
)


# ── SKU detection helpers ─────────────────────────────────────────────────────

# Trailing underscore ensures "standard_d2_v3" is matched but not an unrelated
# SKU that merely starts with "standard_d2".
_OLD_VM_PREFIXES = (
    "standard_a",   # A-series (very old)
    "standard_d1_", # D1 v2/v3
    "standard_d2_", # D2 v2/v3
    "standard_d3_", # D3 v2/v3
    "standard_d4_", # D4 v2/v3
)
_OLD_VM_SUFFIXES = ("_v2", "_v3")  # broad v2/v3 generation markers

_SQL_VM_NAME_HINTS = ("sql", "mssql", "database", "db-server", "dbserver")


def _is_old_sku(sku: str | None) -> bool:
    if not sku:
        return False
    s = sku.lower()
    if any(s.startswith(p) for p in _OLD_VM_PREFIXES):
        return True
    if any(s.endswith(suf) for suf in _OLD_VM_SUFFIXES):
        return True
    return False


def _looks_like_sql_vm(r: ResourceMetrics) -> bool:
    """Heuristic: does this VM appear to be running SQL Server?"""
    name  = (r.resource_name or "").lower()
    tags  = {k.lower(): v.lower() for k, v in (r.tags or {}).items()}
    tag_v = " ".join(tags.values())
    return any(kw in name or kw in tag_v for kw in _SQL_VM_NAME_HINTS)


# ── Step builders ─────────────────────────────────────────────────────────────

def _vm_sku_upgrade_steps(r: ResourceMetrics) -> List[MigrationStep]:
    rg = r.resource_group
    return [
        MigrationStep(phase="assess", title="Verify workload compatibility with Dv5/Ev5",
            detail="Check VM extension and guest-OS compatibility with v5 series. RDMA workloads require different SKUs.",
            effort_days=1),
        MigrationStep(phase="prepare", title="Snapshot OS and data disks for rollback",
            detail="Create disk snapshots before any change — this is your rollback point.",
            az_cli=f"az snapshot create -g {rg} --source $(az vm show -g {rg} -n {r.resource_name} --query 'storageProfile.osDisk.managedDisk.id' -o tsv) -n {r.resource_name}-pre-migration",
            effort_days=1),
        MigrationStep(phase="migrate", title="Stop VM and resize to Dv5 equivalent",
            detail="Stop (deallocate) the VM, resize to the equivalent Dv5 size, then restart. Downtime is typically <5 minutes.",
            az_cli=f"az vm deallocate -g {rg} -n {r.resource_name}\naz vm resize -g {rg} -n {r.resource_name} --size Standard_D4_v5\naz vm start -g {rg} -n {r.resource_name}",
            effort_days=1),
        MigrationStep(phase="validate", title="Monitor performance for 24 hours",
            detail="Check CPU, memory, IOPS in Azure Monitor. Confirm application behaves correctly before deleting the snapshot.",
            effort_days=1),
    ]


def _sql_vm_to_paas_steps(r: ResourceMetrics) -> List[MigrationStep]:
    rg = r.resource_group
    loc = r.location or "eastus"
    return [
        MigrationStep(phase="assess", title="Run Database Migration Assistant (DMA) assessment",
            detail="Download the free DMA tool from Microsoft. Run it against the SQL instance to identify compatibility blockers and feature usage (Agent jobs, linked servers, CLR, Service Broker).",
            effort_days=3),
        MigrationStep(phase="assess", title="Choose target: SQL MI (full compat) vs SQL Database (standard OLTP)",
            detail="SQL Managed Instance if you need: SQL Agent, linked servers, cross-database queries, CLR. Azure SQL Database for greenfield or simple OLTP workloads.",
            effort_days=1),
        MigrationStep(phase="prepare", title="Create Azure SQL Managed Instance with private endpoint",
            detail="SQL MI requires a dedicated subnet. Configure VNet integration and private DNS zones before provisioning.",
            az_cli=f"az sql mi create -g {rg} -n {r.resource_name}-sqlmi -l {loc} --admin-user sqladmin --admin-password '<SecurePass!>' --subnet /subscriptions/<sub>/resourceGroups/{rg}/providers/Microsoft.Network/virtualNetworks/<vnet>/subnets/<subnet>",
            effort_days=2),
        MigrationStep(phase="migrate", title="Online migration via Azure Database Migration Service",
            detail="Use DMS in online (minimal-downtime) mode. Monitor replication lag. Cut over during a maintenance window when lag is <10 seconds.",
            effort_days=3),
        MigrationStep(phase="validate", title="Test application against PaaS endpoint",
            detail="Update connection strings. Run full integration test suite. Verify stored procedures, scheduled jobs, and HA failover.",
            effort_days=2),
        MigrationStep(phase="optimize", title="Enable Azure Hybrid Benefit + Reserved Capacity, decommission VM",
            detail="AHB saves up to 55% with existing SQL Server licences. 1-year Reserved Capacity adds another 56%. Deallocate SQL VM after 2-week stable period.",
            az_cli=f"az vm deallocate -g {rg} -n {r.resource_name}",
            effort_days=2),
    ]


def _vm_to_app_service_steps(r: ResourceMetrics) -> List[MigrationStep]:
    rg = r.resource_group
    return [
        MigrationStep(phase="assess", title="Inventory applications and dependencies on the VM",
            detail="List all IIS/Apache/Nginx sites, ports, runtimes (.NET, Java, Node, Python). Run the free Azure App Service Migration Assistant tool.",
            effort_days=2),
        MigrationStep(phase="prepare", title="Create App Service Plan and Web App with managed identity",
            detail="Choose P1v3+ for production. Enable system-assigned managed identity for secure Key Vault access.",
            az_cli=f"az appservice plan create -g {rg} -n {r.resource_name}-asp --sku P1v3 --is-linux\naz webapp create -g {rg} -p {r.resource_name}-asp -n {r.resource_name}-app --assign-identity '[system]'",
            effort_days=1),
        MigrationStep(phase="prepare", title="Move secrets to Azure Key Vault, configure app settings",
            detail="Replace all hardcoded connection strings with Key Vault references. Use @Microsoft.KeyVault() syntax in App Service application settings.",
            effort_days=2),
        MigrationStep(phase="migrate", title="Deploy app to staging slot, smoke test, then swap to production",
            detail="Deploy to the staging slot first. Run integration tests. Perform a slot swap for zero-downtime production go-live.",
            az_cli=f"az webapp deployment slot create -g {rg} -n {r.resource_name}-app --slot staging",
            effort_days=2),
        MigrationStep(phase="validate", title="Monitor Application Insights for errors and latency",
            detail="Watch for 5xx errors, slow dependencies, and memory leaks in Application Insights Live Metrics for 48 hours.",
            effort_days=2),
        MigrationStep(phase="optimize", title="Configure auto-scale rules then decommission VM",
            detail="Set CPU-based scale rules. After 2-week stable period, deallocate the VM. Delete after 30 days.",
            az_cli=f"az vm deallocate -g {rg} -n {r.resource_name}",
            effort_days=1),
    ]


def _app_service_to_aca_steps(r: ResourceMetrics) -> List[MigrationStep]:
    rg  = r.resource_group
    loc = r.location or "eastus"
    return [
        MigrationStep(phase="assess", title="Enumerate all apps on this plan and assess containerisation feasibility",
            detail="List web/function apps. Identify OS-level dependencies. Apps requiring Windows-only features may need to stay on App Service.",
            effort_days=2),
        MigrationStep(phase="prepare", title="Containerise each app and push to Azure Container Registry",
            detail="Add Dockerfiles using official Microsoft base images. Build and push to ACR.",
            az_cli=f"az acr create -g {rg} -n {r.resource_name.replace('-','')[:23]}acr --sku Standard\naz acr build -t myapp:v1 -r {r.resource_name.replace('-','')[:23]}acr .",
            effort_days=3),
        MigrationStep(phase="prepare", title="Create Container Apps Environment with Log Analytics",
            az_cli=f"az containerapp env create -g {rg} -n {r.resource_name}-env -l {loc}",
            detail="Provision the Container Apps Environment. This is the managed Kubernetes control plane.",
            effort_days=1),
        MigrationStep(phase="migrate", title="Deploy apps to Container Apps with 10% traffic split",
            detail="Start with 10% traffic on the new Container Apps deployment. Monitor for errors before full cut-over.",
            az_cli=f"az containerapp create -g {rg} -n myapp-aca --environment {r.resource_name}-env --image myregistry.azurecr.io/myapp:v1 --ingress external --target-port 80",
            effort_days=2),
        MigrationStep(phase="validate", title="Load test scale-to-zero and burst behaviour",
            detail="Verify cold-start times are acceptable for your SLA. Confirm health probes and KEDA triggers work correctly.",
            effort_days=2),
        MigrationStep(phase="optimize", title="Delete App Service Plan after 2-week stable operation",
            az_cli=f"az appservice plan delete -g {rg} -n {r.resource_name} --yes",
            detail="Once all apps are stable on Container Apps, delete the plan to eliminate the fixed monthly cost.",
            effort_days=1),
    ]


def _storage_lifecycle_steps(r: ResourceMetrics) -> List[MigrationStep]:
    rg = r.resource_group
    return [
        MigrationStep(phase="assess", title="Enable Last Access Time tracking to identify cold blobs",
            detail="This is free and allows the lifecycle policy to target blobs by their last access date (not just creation date).",
            az_cli=f"az storage account blob-service-properties update -g {rg} -n {r.resource_name} --enable-last-access-tracking true",
            effort_days=1),
        MigrationStep(phase="prepare", title="Design tiering policy: Hot → Cool after 30 days, Archive after 90 days",
            detail="Create a lifecycle policy JSON. Define rules for blob containers. Consider separate rules for backup vs application data.",
            effort_days=1),
        MigrationStep(phase="migrate", title="Apply lifecycle management policy",
            detail="Upload the policy to the storage account. It runs every 24 hours. Monitor the first week to confirm transitions are occurring as expected.",
            az_cli=f"az storage account management-policy create -g {rg} --account-name {r.resource_name} --policy @lifecycle-policy.json",
            effort_days=1),
        MigrationStep(phase="validate", title="Verify cost reduction in Azure Cost Management after 30 days",
            detail="Check storage cost trend in Azure Cost Management. You should see a reduction as blobs move to Cool/Archive tiers.",
            effort_days=1),
    ]


# ── Wave/effort lookup ────────────────────────────────────────────────────────

_WAVE: dict[str, int]         = {"Low": 1, "Medium": 2, "High": 3}
_EFFORT_DAYS: dict[str, int]  = {"Low": 5, "Medium": 15, "High": 30}


# ── Main detector ─────────────────────────────────────────────────────────────

def detect_modernization_opportunities(
    resources: List[ResourceMetrics],
) -> List[ModernizationOpportunity]:
    opps: List[ModernizationOpportunity] = []
    seen: set[str] = set()

    for r in resources:
        rtype = (r.resource_type or "").lower()
        rid   = r.resource_id

        if rid in seen:
            continue

        # ── 1. Old VM SKU → Dv5/Ev5 series ───────────────────────────────────
        if rtype == "microsoft.compute/virtualmachines" and _is_old_sku(r.sku):
            seen.add(rid)
            complexity = "Low"
            opps.append(ModernizationOpportunity(
                resource_id=rid, resource_name=r.resource_name,
                resource_type=r.resource_type, resource_group=r.resource_group,
                subscription_id=r.subscription_id or "",
                current_config=f"VM {r.sku or 'unknown SKU'} (v2/v3 generation)",
                target_service="Azure VM — Dv5/Ev5 Series",
                target_service_type="microsoft.compute/virtualmachines",
                complexity=complexity, estimated_savings_pct=20.0,
                monthly_cost=r.cost_current_month,
                reason=(f"The {r.sku} SKU is a legacy generation. Dv5/Ev5 series VMs offer up to "
                        "40% better price-performance using Intel Ice Lake/AMD EPYC processors, "
                        "with Azure Boost NVMe storage and Accelerated Networking included."),
                benefits=[
                    "Up to 40% better price-performance vs v2/v3",
                    "Accelerated Networking included (no extra cost)",
                    "Azure Boost NVMe storage — 4× higher IOPS",
                    "Same API / same management — resize only",
                ],
                migration_steps=_vm_sku_upgrade_steps(r),
                migration_wave=_WAVE[complexity],
                estimated_effort_days=_EFFORT_DAYS[complexity],
            ))
            continue

        # ── 2. VM that looks like SQL Server → Azure SQL MI / SQL Database ────
        if rtype == "microsoft.compute/virtualmachines" and _looks_like_sql_vm(r):
            seen.add(rid)
            complexity = "High"
            opps.append(ModernizationOpportunity(
                resource_id=rid, resource_name=r.resource_name,
                resource_type=r.resource_type, resource_group=r.resource_group,
                subscription_id=r.subscription_id or "",
                current_config=f"SQL Server IaaS VM {r.sku or ''} (${r.cost_current_month:,.0f}/month)",
                target_service="Azure SQL Managed Instance / Azure SQL Database",
                target_service_type="microsoft.sql/managedinstances",
                complexity=complexity, estimated_savings_pct=35.0,
                monthly_cost=r.cost_current_month,
                reason=("This VM appears to run SQL Server on IaaS. Azure SQL Managed Instance "
                        "provides near-100% SQL Server compatibility with automated backups, HA, "
                        "and patching. Azure Hybrid Benefit + Reserved Capacity can reduce cost "
                        "by 55–65% vs IaaS."),
                benefits=[
                    "Eliminates OS/SQL Server patching (Microsoft managed)",
                    "Built-in HA with 99.99% SLA — no Always On to configure",
                    "Azure Hybrid Benefit: up to 55% savings with existing licences",
                    "Reserved Capacity: additional 56% on 1-year term",
                    "Automated point-in-time restore up to 35 days",
                ],
                migration_steps=_sql_vm_to_paas_steps(r),
                migration_wave=_WAVE[complexity],
                estimated_effort_days=_EFFORT_DAYS[complexity],
            ))
            continue

        # ── 3. Low-utilisation VM → Azure App Service ─────────────────────────
        if (rtype == "microsoft.compute/virtualmachines"
                and r.cost_current_month > 50
                and (r.primary_utilization_pct is None or r.primary_utilization_pct < 40)):
            seen.add(rid)
            complexity = "Medium"
            cpu_str = (f"avg CPU {r.primary_utilization_pct:.0f}%"
                       if r.primary_utilization_pct is not None else "no metrics")
            opps.append(ModernizationOpportunity(
                resource_id=rid, resource_name=r.resource_name,
                resource_type=r.resource_type, resource_group=r.resource_group,
                subscription_id=r.subscription_id or "",
                current_config=f"VM {r.sku or ''} ({cpu_str}, ${r.cost_current_month:,.0f}/month)",
                target_service="Azure App Service (PaaS)",
                target_service_type="microsoft.web/sites",
                complexity=complexity, estimated_savings_pct=30.0,
                monthly_cost=r.cost_current_month,
                reason=("Low-utilisation VMs running web workloads are strong App Service candidates. "
                        "App Service eliminates OS patching, provides built-in auto-scale and "
                        "deployment slots, and reduces infrastructure management overhead."),
                benefits=[
                    "Eliminates OS/middleware patching (PaaS managed)",
                    "Built-in auto-scale — pay for actual load only",
                    "Zero-downtime deployments via deployment slots",
                    "Integrated CI/CD with Azure DevOps and GitHub Actions",
                    "Estimated 30% cost reduction vs equivalent VM",
                ],
                migration_steps=_vm_to_app_service_steps(r),
                migration_wave=_WAVE[complexity],
                estimated_effort_days=_EFFORT_DAYS[complexity],
            ))
            continue

        # ── 4. Costly App Service Plan → Azure Container Apps ────────────────
        if (rtype == "microsoft.web/serverfarms"
                and r.cost_current_month > 200):
            seen.add(rid)
            complexity = "Medium"
            opps.append(ModernizationOpportunity(
                resource_id=rid, resource_name=r.resource_name,
                resource_type=r.resource_type, resource_group=r.resource_group,
                subscription_id=r.subscription_id or "",
                current_config=f"App Service Plan {r.sku or ''} (${r.cost_current_month:,.0f}/month)",
                target_service="Azure Container Apps",
                target_service_type="microsoft.app/containerapps",
                complexity=complexity, estimated_savings_pct=40.0,
                monthly_cost=r.cost_current_month,
                reason=("Azure Container Apps uses consumption-based pricing — you pay only when "
                        "apps process requests. Dedicated App Service Plans run 24/7 at full cost "
                        "even when idle. Container Apps also support scale-to-zero."),
                benefits=[
                    "Scale to zero — $0 when no requests are active",
                    "Dapr and KEDA built-in for event-driven workloads",
                    "No Kubernetes cluster management required",
                    "Estimated 40% reduction vs dedicated App Service Plan",
                ],
                migration_steps=_app_service_to_aca_steps(r),
                migration_wave=_WAVE[complexity],
                estimated_effort_days=_EFFORT_DAYS[complexity],
            ))
            continue

        # ── 5. Storage without lifecycle management ───────────────────────────
        if (rtype == "microsoft.storage/storageaccounts"
                and r.cost_current_month > 20
                and not r.storage_has_lifecycle_policy):
            seen.add(rid)
            complexity = "Low"
            opps.append(ModernizationOpportunity(
                resource_id=rid, resource_name=r.resource_name,
                resource_type=r.resource_type, resource_group=r.resource_group,
                subscription_id=r.subscription_id or "",
                current_config=f"Storage Account — no lifecycle policy (${r.cost_current_month:,.0f}/month, all data in Hot tier)",
                target_service="Azure Blob Storage — Lifecycle Management + Cool/Archive Tiers",
                target_service_type="microsoft.storage/storageaccounts",
                complexity=complexity, estimated_savings_pct=50.0,
                monthly_cost=r.cost_current_month,
                reason=("Without a lifecycle policy, all data stays in Hot tier indefinitely. "
                        "Moving infrequently accessed blobs to Cool (50% cheaper) or Archive "
                        "(90% cheaper) tiers dramatically reduces storage costs with no code changes."),
                benefits=[
                    "Cool tier: 50% cheaper than Hot for data accessed < monthly",
                    "Archive tier: 90% cheaper for long-term retention data",
                    "Automated policy — zero ongoing operational effort",
                    "No application code changes required",
                ],
                migration_steps=_storage_lifecycle_steps(r),
                migration_wave=_WAVE[complexity],
                estimated_effort_days=_EFFORT_DAYS[complexity],
            ))
            continue

    # Sort: wave first, then by monthly saving potential descending
    opps.sort(key=lambda o: (o.migration_wave, -(o.monthly_cost * o.estimated_savings_pct / 100)))
    return opps


# ── NEW detection patterns (Phase 2) ──────────────────────────────────────────

_WEB_VM_HINTS = ("web", "www", "iis", "nginx", "apache", "frontend", "app-", "api-")
_REDIS_VM_HINTS = ("redis", "cache", "memcache")
_NAS_VM_HINTS = ("nas", "fileserver", "nfs", "smb", "shares")


def _looks_like_web_vm(r: ResourceMetrics) -> bool:
    name = (r.resource_name or "").lower()
    tags = " ".join((r.tags or {}).values()).lower()
    return any(kw in name or kw in tags for kw in _WEB_VM_HINTS)


def _looks_like_redis_vm(r: ResourceMetrics) -> bool:
    name = (r.resource_name or "").lower()
    tags = " ".join((r.tags or {}).values()).lower()
    return any(kw in name or kw in tags for kw in _REDIS_VM_HINTS)


def _looks_like_file_vm(r: ResourceMetrics) -> bool:
    name = (r.resource_name or "").lower()
    tags = " ".join((r.tags or {}).values()).lower()
    return any(kw in name or kw in tags for kw in _NAS_VM_HINTS)


def _mysql_flex_steps(r: ResourceMetrics) -> List[MigrationStep]:
    rg = r.resource_group
    return [
        MigrationStep(phase="assess", title="Check for breaking changes in Flexible Server",
            detail="Review the migration guide for deprecated features (query store v1, local infile). Run mysql_check tool.", effort_days=2),
        MigrationStep(phase="prepare", title="Create Flexible Server target with same compute tier",
            az_cli=f"az mysql flexible-server create -g {rg} -n {r.resource_name}-flex --sku-name Standard_B1ms --tier Burstable",
            detail="Choose the equivalent compute tier. Flexible Server supports burstable, GP, and memory-optimised.", effort_days=1),
        MigrationStep(phase="migrate", title="Use Azure DMS for online migration with minimal downtime",
            detail="Azure Database Migration Service supports online migration. Monitor replication lag and cut over when <5s.", effort_days=2),
        MigrationStep(phase="validate", title="Verify application connectivity and query performance",
            detail="Update connection strings. Run regression tests. Compare query execution times.", effort_days=2),
        MigrationStep(phase="optimize", title="Enable HA zone redundancy and auto-backup",
            az_cli=f"az mysql flexible-server update -g {rg} -n {r.resource_name}-flex --high-availability ZoneRedundant",
            detail="Flexible Server supports zone-redundant HA. Enable automated backups with geo-redundancy.", effort_days=1),
    ]


def _postgres_flex_steps(r: ResourceMetrics) -> List[MigrationStep]:
    rg = r.resource_group
    return [
        MigrationStep(phase="assess", title="Run pg_dump compatibility check against Flexible Server",
            detail="Check for unsupported extensions. Review Flexible Server feature matrix vs Single Server.", effort_days=2),
        MigrationStep(phase="prepare", title="Create Flexible Server with equivalent compute",
            az_cli=f"az postgres flexible-server create -g {rg} -n {r.resource_name}-flex --sku-name Standard_B1ms --tier Burstable",
            detail="Choose matching compute. Flexible Server supports burstable, GP, and memory-optimised tiers.", effort_days=1),
        MigrationStep(phase="migrate", title="Use Azure DMS or pg_dump/pg_restore for migration",
            detail="For <100GB databases, pg_dump is fastest. For larger DBs, use DMS with CDC replication.", effort_days=3),
        MigrationStep(phase="validate", title="Test application queries and extensions",
            detail="Verify all PG extensions work. Check connection pooling (PgBouncer is built into Flex).", effort_days=2),
        MigrationStep(phase="optimize", title="Enable intelligent tuning and HA",
            detail="Flexible Server includes intelligent tuning, zone-redundant HA, and PITR up to 35 days.", effort_days=1),
    ]


def _cosmos_autoscale_steps(r: ResourceMetrics) -> List[MigrationStep]:
    rg = r.resource_group
    return [
        MigrationStep(phase="assess", title="Analyse RU consumption patterns in Azure Monitor",
            detail="Check if provisioned RUs are consistently underutilised (<40% avg) or have bursty patterns.", effort_days=1),
        MigrationStep(phase="prepare", title="Choose autoscale (bursty) or serverless (low-traffic)",
            detail="Autoscale: pay 10–100% of max RUs based on load. Serverless: pay per request (best for <5000 RU/s peak).", effort_days=1),
        MigrationStep(phase="migrate", title="Switch throughput mode (no downtime)",
            az_cli=f"az cosmosdb sql container throughput migrate -g {rg} -a {r.resource_name} -d <db> -n <container> --throughput-type autoscale",
            detail="Autoscale migration is online — zero downtime. Serverless requires container recreation.", effort_days=1),
        MigrationStep(phase="validate", title="Monitor RU consumption and latency for 7 days",
            detail="Use Cosmos DB Insights in Azure Monitor. Check for throttling (429s) and P99 latency.", effort_days=2),
    ]


def _container_candidate_steps(r: ResourceMetrics) -> List[MigrationStep]:
    rg = r.resource_group
    return [
        MigrationStep(phase="assess", title="Profile application dependencies and runtime",
            detail="Identify web server type (IIS/Nginx/Apache), runtime (.NET/Node/Java/Python), and external dependencies.", effort_days=3),
        MigrationStep(phase="prepare", title="Create Dockerfile and build container image",
            detail="Use official Microsoft base images. Multi-stage builds for smaller images. Test locally.", effort_days=5),
        MigrationStep(phase="prepare", title="Push image to Azure Container Registry",
            az_cli=f"az acr create -g {rg} -n myacr --sku Standard\naz acr build -t myapp:v1 -r myacr .",
            detail="ACR provides geo-replication, vulnerability scanning, and content trust.", effort_days=1),
        MigrationStep(phase="migrate", title="Deploy to Azure Container Apps or AKS",
            detail="Container Apps for HTTP APIs/microservices (scale-to-zero). AKS for complex orchestration needs.",
            az_cli=f"az containerapp create -g {rg} -n myapp --environment myenv --image myacr.azurecr.io/myapp:v1 --ingress external --target-port 80",
            effort_days=3),
        MigrationStep(phase="validate", title="Run load tests and verify auto-scaling",
            detail="Confirm health probes, scaling rules, and startup times meet SLA requirements.", effort_days=3),
        MigrationStep(phase="optimize", title="Decommission VM after 2-week stable period",
            az_cli=f"az vm deallocate -g {rg} -n {r.resource_name}",
            detail="Keep VM deallocated for 30 days as rollback option, then delete.", effort_days=1),
    ]


def _redis_to_managed_steps(r: ResourceMetrics) -> List[MigrationStep]:
    rg = r.resource_group
    return [
        MigrationStep(phase="assess", title="Inventory Redis usage patterns and data size",
            detail="Check total memory usage, key count, persistence (RDB/AOF), and client connections. Identify Lua scripts.", effort_days=2),
        MigrationStep(phase="prepare", title="Create Azure Cache for Redis with matching tier",
            az_cli=f"az redis create -g {rg} -n {r.resource_name}-redis --sku Standard --vm-size C1",
            detail="Standard tier for production with replication. Premium for clustering, VNet injection, and persistence.", effort_days=1),
        MigrationStep(phase="migrate", title="Migrate data using RIOT or dual-write pattern",
            detail="Use Redis RIOT tool for bulk migration. For zero-downtime: dual-write to both old and new, then cut over.", effort_days=3),
        MigrationStep(phase="validate", title="Verify application cache hit rates and latency",
            detail="Monitor cache misses, latency P99, and connection pool health for 48 hours.", effort_days=2),
        MigrationStep(phase="optimize", title="Enable data persistence and zone redundancy",
            detail="Enable RDB persistence for recovery. Zone redundancy for 99.99% SLA.", effort_days=1),
    ]


def _file_server_steps(r: ResourceMetrics) -> List[MigrationStep]:
    rg = r.resource_group
    return [
        MigrationStep(phase="assess", title="Inventory file shares, protocols, and access patterns",
            detail="List all SMB/NFS shares, total size, IOPS requirements, and client compatibility.", effort_days=3),
        MigrationStep(phase="prepare", title="Create Azure Files Premium or Azure NetApp Files",
            detail="Azure Files Premium for SMB/NFS up to 100K IOPS. Azure NetApp Files for NFS-heavy workloads requiring sub-ms latency.",
            az_cli=f"az storage account create -g {rg} -n {r.resource_name.replace('-','')}files --kind FileStorage --sku Premium_LRS",
            effort_days=2),
        MigrationStep(phase="migrate", title="Use Azure File Sync or robocopy for data migration",
            detail="Azure File Sync for staged migration with on-prem caching. Robocopy /MIR for one-time migration.", effort_days=5),
        MigrationStep(phase="validate", title="Test SMB/NFS client connectivity and permissions",
            detail="Verify NTFS ACLs are preserved. Test from all client machines. Check throughput.", effort_days=3),
        MigrationStep(phase="optimize", title="Enable soft delete and snapshots",
            detail="Configure soft delete (14-day retention) and periodic snapshots for data protection.", effort_days=1),
    ]


# ── 5R Classification helpers ────────────────────────────────────────────────

def _classify_5r(r: ResourceMetrics, opp_type: str | None) -> str:
    """Assign a 5R category based on resource type and opportunity type."""
    rtype = (r.resource_type or "").lower()

    if opp_type == "old_vm_sku":
        return "Rehost"
    if opp_type in ("sql_vm_to_paas", "mysql_to_flex", "postgres_to_flex"):
        return "Refactor"
    if opp_type in ("vm_to_app_service", "app_service_to_aca", "container_candidate"):
        return "Rearchitect"
    if opp_type in ("cosmos_optimize", "storage_lifecycle", "redis_to_managed", "file_server"):
        return "Refactor"

    # Classify resources with no specific opp
    if rtype in ("microsoft.compute/virtualmachines", "microsoft.compute/virtualmachinescalesets"):
        return "Retain"  # IaaS with no clear migration path → retain for now
    if any(kw in rtype for kw in ("microsoft.web/", "microsoft.app/", "microsoft.containerservice/")):
        return "Retain"  # already PaaS/container
    return "Retain"


def _migration_category(opp_type: str) -> str:
    cats = {
        "old_vm_sku": "compute", "sql_vm_to_paas": "database",
        "vm_to_app_service": "app_platform", "app_service_to_aca": "container",
        "storage_lifecycle": "storage", "mysql_to_flex": "database",
        "postgres_to_flex": "database", "cosmos_optimize": "database",
        "redis_to_managed": "database", "container_candidate": "container",
        "file_server": "storage",
    }
    return cats.get(opp_type, "compute")


def _risk_score(r: ResourceMetrics, complexity: str, dep_count: int = 0) -> int:
    """0-100 migration risk based on cost, complexity, dependencies."""
    risk = 0
    if complexity == "High": risk += 40
    elif complexity == "Medium": risk += 20
    else: risk += 5
    if r.cost_current_month > 500: risk += 15
    elif r.cost_current_month > 100: risk += 8
    if dep_count > 3: risk += 20
    elif dep_count > 1: risk += 10
    if r.has_lock: risk += 10
    if r.has_backup: risk -= 5  # backup = safer migration
    return max(0, min(100, risk))


# ── Extended detect function (adds new patterns) ─────────────────────────────

def detect_modernization_opportunities_v2(
    resources: List[ResourceMetrics],
    dependency_edges: list | None = None,
) -> List[ModernizationOpportunity]:
    """Extended detection with 12 patterns, 5R classification, and risk scoring."""
    # Build dependency count map
    dep_counts: dict[str, int] = {}
    if dependency_edges:
        for edge in dependency_edges:
            src = (edge.get("source") or "").lower()
            tgt = (edge.get("target") or "").lower()
            dep_counts[src] = dep_counts.get(src, 0) + 1
            dep_counts[tgt] = dep_counts.get(tgt, 0) + 1

    # Start with the original 5 patterns
    opps = detect_modernization_opportunities(resources)

    # Tag original opps with 5R / category / risk
    opp_ids = set()
    for opp in opps:
        rid = opp.resource_id.lower()
        opp_ids.add(rid)
        # Infer opp_type from target
        if "Dv5" in opp.target_service: otype = "old_vm_sku"
        elif "SQL" in opp.target_service: otype = "sql_vm_to_paas"
        elif "App Service" in opp.target_service: otype = "vm_to_app_service"
        elif "Container Apps" in opp.target_service: otype = "app_service_to_aca"
        else: otype = "storage_lifecycle"

        r_match = next((r for r in resources if r.resource_id == opp.resource_id), None)
        if r_match:
            dc = dep_counts.get(rid, 0)
            opp.five_r = _classify_5r(r_match, otype)
            opp.migration_category = _migration_category(otype)
            opp.risk_score = _risk_score(r_match, opp.complexity, dc)
            opp.dependency_count = dc

    seen = opp_ids.copy()

    for r in resources:
        rtype = (r.resource_type or "").lower()
        rid = r.resource_id
        rid_lower = rid.lower()
        if rid_lower in seen:
            continue
        dc = dep_counts.get(rid_lower, 0)

        # ── 6. MySQL Single Server → Flexible Server ────────────────────
        if rtype == "microsoft.dbformysql/servers":
            seen.add(rid_lower)
            complexity = "Medium"
            opps.append(ModernizationOpportunity(
                resource_id=rid, resource_name=r.resource_name,
                resource_type=r.resource_type, resource_group=r.resource_group,
                subscription_id=r.subscription_id or "",
                current_config=f"MySQL Single Server {r.sku or ''} (${r.cost_current_month:,.0f}/mo)",
                target_service="Azure Database for MySQL — Flexible Server",
                target_service_type="microsoft.dbformysql/flexibleservers",
                complexity=complexity, estimated_savings_pct=25.0,
                monthly_cost=r.cost_current_month,
                reason=("MySQL Single Server is on the retirement path (Sept 2025). Flexible Server "
                        "offers zone-redundant HA, better performance, same-zone replicas, and "
                        "granular compute scaling — with lower total cost."),
                benefits=[
                    "Zone-redundant HA with automatic failover",
                    "Built-in PgBouncer-equivalent connection pooling",
                    "Flexible compute scaling (stop/start supported)",
                    "Same-zone read replicas for read-heavy workloads",
                    "Single Server retirement deadline: Sept 2025",
                ],
                migration_steps=_mysql_flex_steps(r),
                migration_wave=_WAVE[complexity],
                estimated_effort_days=_EFFORT_DAYS[complexity],
                five_r="Refactor", migration_category="database",
                risk_score=_risk_score(r, complexity, dc), dependency_count=dc,
            ))
            continue

        # ── 7. PostgreSQL Single Server → Flexible Server ────────────────
        if rtype == "microsoft.dbforpostgresql/servers":
            seen.add(rid_lower)
            complexity = "Medium"
            opps.append(ModernizationOpportunity(
                resource_id=rid, resource_name=r.resource_name,
                resource_type=r.resource_type, resource_group=r.resource_group,
                subscription_id=r.subscription_id or "",
                current_config=f"PostgreSQL Single Server {r.sku or ''} (${r.cost_current_month:,.0f}/mo)",
                target_service="Azure Database for PostgreSQL — Flexible Server",
                target_service_type="microsoft.dbforpostgresql/flexibleservers",
                complexity=complexity, estimated_savings_pct=25.0,
                monthly_cost=r.cost_current_month,
                reason=("PostgreSQL Single Server is on the retirement path. Flexible Server "
                        "provides zone-redundant HA, intelligent tuning, built-in PgBouncer, "
                        "and support for PG extensions like pgvector for AI workloads."),
                benefits=[
                    "Zone-redundant HA with 99.99% SLA",
                    "Built-in PgBouncer connection pooling",
                    "Intelligent performance tuning (auto-vacuum, index advisor)",
                    "pgvector extension for AI/vector search workloads",
                    "Single Server retirement deadline approaching",
                ],
                migration_steps=_postgres_flex_steps(r),
                migration_wave=_WAVE[complexity],
                estimated_effort_days=_EFFORT_DAYS[complexity],
                five_r="Refactor", migration_category="database",
                risk_score=_risk_score(r, complexity, dc), dependency_count=dc,
            ))
            continue

        # ── 8. Cosmos DB provisioned throughput → autoscale/serverless ───
        if (rtype == "microsoft.documentdb/databaseaccounts"
                and r.cost_current_month > 50
                and r.primary_utilization_pct is not None
                and r.primary_utilization_pct < 40):
            seen.add(rid_lower)
            complexity = "Low"
            opps.append(ModernizationOpportunity(
                resource_id=rid, resource_name=r.resource_name,
                resource_type=r.resource_type, resource_group=r.resource_group,
                subscription_id=r.subscription_id or "",
                current_config=f"Cosmos DB provisioned throughput ({r.primary_utilization_pct:.0f}% RU util, ${r.cost_current_month:,.0f}/mo)",
                target_service="Cosmos DB — Autoscale or Serverless Throughput",
                target_service_type="microsoft.documentdb/databaseaccounts",
                complexity=complexity, estimated_savings_pct=40.0,
                monthly_cost=r.cost_current_month,
                reason=("This Cosmos DB account uses provisioned throughput but only consumes "
                        f"{r.primary_utilization_pct:.0f}% of provisioned RUs. Switching to autoscale "
                        "pays only for consumed RUs (10-100% range), and serverless is even cheaper "
                        "for sporadic workloads under 5,000 RU/s peak."),
                benefits=[
                    "Autoscale: pay 10-100% of max RUs based on actual demand",
                    "Serverless: pure pay-per-request — ideal for dev/test and low-traffic",
                    "Zero-downtime migration to autoscale",
                    "Estimated 40% cost reduction for underutilised accounts",
                ],
                migration_steps=_cosmos_autoscale_steps(r),
                migration_wave=_WAVE[complexity],
                estimated_effort_days=_EFFORT_DAYS[complexity],
                five_r="Refactor", migration_category="database",
                risk_score=_risk_score(r, complexity, dc), dependency_count=dc,
            ))
            continue

        # ── 9. VM looks like Redis/cache → Azure Cache for Redis ─────────
        if rtype == "microsoft.compute/virtualmachines" and _looks_like_redis_vm(r):
            seen.add(rid_lower)
            complexity = "Medium"
            opps.append(ModernizationOpportunity(
                resource_id=rid, resource_name=r.resource_name,
                resource_type=r.resource_type, resource_group=r.resource_group,
                subscription_id=r.subscription_id or "",
                current_config=f"VM running Redis/cache ({r.sku or ''}, ${r.cost_current_month:,.0f}/mo)",
                target_service="Azure Cache for Redis",
                target_service_type="microsoft.cache/redis",
                complexity=complexity, estimated_savings_pct=30.0,
                monthly_cost=r.cost_current_month,
                reason=("Self-managed Redis on VMs requires patching, HA configuration, and monitoring. "
                        "Azure Cache for Redis provides fully managed caching with built-in clustering, "
                        "replication, persistence, and zone redundancy — eliminating operational overhead."),
                benefits=[
                    "Fully managed — no OS/Redis patching",
                    "Built-in clustering and replication",
                    "Zone redundancy with 99.99% SLA (Premium)",
                    "Active geo-replication for global caching",
                    "Integrated monitoring with Azure Monitor",
                ],
                migration_steps=_redis_to_managed_steps(r),
                migration_wave=_WAVE[complexity],
                estimated_effort_days=_EFFORT_DAYS[complexity],
                five_r="Refactor", migration_category="database",
                risk_score=_risk_score(r, complexity, dc), dependency_count=dc,
            ))
            continue

        # ── 10. VM looks like web server → containerisation candidate ────
        if (rtype == "microsoft.compute/virtualmachines"
                and _looks_like_web_vm(r)
                and r.cost_current_month > 30):
            seen.add(rid_lower)
            complexity = "High"
            opps.append(ModernizationOpportunity(
                resource_id=rid, resource_name=r.resource_name,
                resource_type=r.resource_type, resource_group=r.resource_group,
                subscription_id=r.subscription_id or "",
                current_config=f"VM hosting web workload ({r.sku or ''}, ${r.cost_current_month:,.0f}/mo)",
                target_service="Azure Container Apps / AKS",
                target_service_type="microsoft.app/containerapps",
                complexity=complexity, estimated_savings_pct=45.0,
                monthly_cost=r.cost_current_month,
                reason=("This VM appears to host web/API workloads. Containerising and deploying to "
                        "Azure Container Apps provides scale-to-zero billing, Dapr integration, "
                        "built-in observability, and eliminates infrastructure management. "
                        "AKS is recommended for complex multi-container orchestration."),
                benefits=[
                    "Scale-to-zero — pay only when processing requests",
                    "Built-in service discovery, load balancing, and TLS",
                    "Dapr integration for microservice patterns",
                    "CI/CD with GitHub Actions and Azure DevOps",
                    "Estimated 45% cost reduction from VM elimination",
                ],
                migration_steps=_container_candidate_steps(r),
                migration_wave=_WAVE[complexity],
                estimated_effort_days=_EFFORT_DAYS[complexity],
                five_r="Rearchitect", migration_category="container",
                risk_score=_risk_score(r, complexity, dc), dependency_count=dc,
            ))
            continue

        # ── 11. VM looks like file server → Azure Files ──────────────────
        if (rtype == "microsoft.compute/virtualmachines"
                and _looks_like_file_vm(r)
                and r.cost_current_month > 30):
            seen.add(rid_lower)
            complexity = "Medium"
            opps.append(ModernizationOpportunity(
                resource_id=rid, resource_name=r.resource_name,
                resource_type=r.resource_type, resource_group=r.resource_group,
                subscription_id=r.subscription_id or "",
                current_config=f"VM running file server ({r.sku or ''}, ${r.cost_current_month:,.0f}/mo)",
                target_service="Azure Files Premium / Azure NetApp Files",
                target_service_type="microsoft.storage/storageaccounts",
                complexity=complexity, estimated_savings_pct=35.0,
                monthly_cost=r.cost_current_month,
                reason=("Self-managed file servers on VMs require disk management, OS patching, "
                        "and manual HA configuration. Azure Files provides fully managed SMB/NFS "
                        "shares with snapshots, soft delete, and identity-based access — with "
                        "Azure File Sync for hybrid caching."),
                benefits=[
                    "Fully managed — no OS or disk management",
                    "SMB 3.0 and NFS 4.1 protocol support",
                    "Azure File Sync for hybrid on-prem caching",
                    "Identity-based access with Entra ID integration",
                    "Built-in snapshots and soft delete for recovery",
                ],
                migration_steps=_file_server_steps(r),
                migration_wave=_WAVE[complexity],
                estimated_effort_days=_EFFORT_DAYS[complexity],
                five_r="Refactor", migration_category="storage",
                risk_score=_risk_score(r, complexity, dc), dependency_count=dc,
            ))
            continue

    # Sort: wave first, then by monthly saving potential descending
    opps.sort(key=lambda o: (o.migration_wave, -(o.monthly_cost * o.estimated_savings_pct / 100)))
    return opps


# ── Aggregate into MigrationAssessment ────────────────────────────────────────

_5R_DESCRIPTIONS = {
    "Rehost":      "Lift-and-shift to newer Azure compute (same architecture, better hardware)",
    "Refactor":    "Move to managed PaaS with minimal code changes (DB, caching, storage)",
    "Rearchitect": "Redesign application architecture for cloud-native patterns (containers, serverless)",
    "Rebuild":     "Rewrite application from scratch using cloud-native services",
    "Retire":      "Decommission resources no longer needed",
    "Retain":      "Keep as-is — no clear migration benefit at this time",
}

_CAT_ICONS = {
    "compute": "💻", "database": "🛢️", "storage": "🗄️",
    "app_platform": "🌐", "container": "📦", "messaging": "📨",
    "network": "🌐",
}


def build_migration_assessment(
    resources: List[ResourceMetrics],
    dependency_edges: list | None = None,
) -> MigrationAssessment:
    """Build a comprehensive migration assessment with 5R, waves, and risk."""
    opps = detect_modernization_opportunities_v2(resources, dependency_edges)

    total_savings = sum(o.monthly_cost * o.estimated_savings_pct / 100 for o in opps)
    total_effort = sum(o.estimated_effort_days for o in opps)

    # 5R summary
    five_r_data: dict[str, dict] = {}
    for o in opps:
        cat = o.five_r or "Retain"
        if cat not in five_r_data:
            five_r_data[cat] = {"count": 0, "cost": 0.0, "savings": 0.0}
        five_r_data[cat]["count"] += 1
        five_r_data[cat]["cost"] += o.monthly_cost
        five_r_data[cat]["savings"] += o.monthly_cost * o.estimated_savings_pct / 100

    # Count resources with NO opportunity → "Retain"
    opp_ids = {o.resource_id.lower() for o in opps}
    retain_cost = 0.0
    retain_count = 0
    for r in resources:
        if r.resource_id.lower() not in opp_ids and not r.is_infrastructure:
            retain_count += 1
            retain_cost += r.cost_current_month
    if retain_count > 0:
        if "Retain" not in five_r_data:
            five_r_data["Retain"] = {"count": 0, "cost": 0.0, "savings": 0.0}
        five_r_data["Retain"]["count"] += retain_count
        five_r_data["Retain"]["cost"] += retain_cost

    five_r_summary = [
        FiveRSummary(
            category=cat,
            count=d["count"], total_cost=d["cost"], potential_savings=d["savings"],
            description=_5R_DESCRIPTIONS.get(cat, ""),
        )
        for cat, d in sorted(five_r_data.items(), key=lambda x: -x[1]["savings"])
    ]

    # Category summary
    cat_data: dict[str, dict] = {}
    for o in opps:
        c = o.migration_category or "compute"
        if c not in cat_data:
            cat_data[c] = {"count": 0, "cost": 0.0, "savings": 0.0}
        cat_data[c]["count"] += 1
        cat_data[c]["cost"] += o.monthly_cost
        cat_data[c]["savings"] += o.monthly_cost * o.estimated_savings_pct / 100

    category_summary = [
        MigrationCategorySummary(
            category=c, icon=_CAT_ICONS.get(c, "🔧"),
            count=d["count"], total_cost=d["cost"], potential_savings=d["savings"],
        )
        for c, d in sorted(cat_data.items(), key=lambda x: -x[1]["savings"])
    ]

    # Wave groups
    wave_data: dict[int, list] = {}
    for o in opps:
        w = o.migration_wave
        if w not in wave_data:
            wave_data[w] = []
        wave_data[w].append(o)

    wave_labels = {
        0: ("Immediate Actions", "Critical items requiring immediate attention"),
        1: ("Wave 1 — Quick Wins (0-30 days)", "Low-complexity changes deliverable in a single sprint"),
        2: ("Wave 2 — Core Migrations (30-90 days)", "Medium-complexity, 1-3 sprint effort with real savings"),
        3: ("Wave 3 — Complex Projects (90-180 days)", "High-complexity re-architecture — plan carefully"),
    }

    wave_groups = []
    for w in sorted(wave_data.keys()):
        items = wave_data[w]
        label, desc = wave_labels.get(w, (f"Wave {w}", ""))
        wave_groups.append(MigrationWaveGroup(
            wave=w, label=label, description=desc,
            total_resources=len(items),
            total_savings=sum(i.monthly_cost * i.estimated_savings_pct / 100 for i in items),
            total_effort_days=sum(i.estimated_effort_days for i in items),
            items=items,
        ))

    # IaaS vs PaaS percentages
    iaas_types = {"microsoft.compute/virtualmachines", "microsoft.compute/virtualmachinescalesets"}
    paas_types = {"microsoft.web/sites", "microsoft.web/serverfarms", "microsoft.app/containerapps",
                  "microsoft.containerservice/managedclusters", "microsoft.sql/servers/databases",
                  "microsoft.sql/managedinstances", "microsoft.dbformysql/flexibleservers",
                  "microsoft.dbforpostgresql/flexibleservers"}
    total_compute = 0
    iaas_count = 0
    for r in resources:
        rt = (r.resource_type or "").lower()
        if rt in iaas_types or rt in paas_types:
            total_compute += 1
            if rt in iaas_types:
                iaas_count += 1
    paas_count = total_compute - iaas_count
    iaas_pct = (iaas_count / total_compute * 100) if total_compute > 0 else 0
    paas_pct = (paas_count / total_compute * 100) if total_compute > 0 else 0

    readiness_pct = (len(opps) / max(1, len(resources)) * 100) if resources else 0

    return MigrationAssessment(
        total_resources_assessed=len(resources),
        total_opportunities=len(opps),
        total_monthly_savings=total_savings,
        total_annual_savings=total_savings * 12,
        total_effort_days=total_effort,
        migration_readiness_pct=min(100, readiness_pct),
        iaas_pct=iaas_pct, paas_pct=paas_pct,
        five_r_summary=five_r_summary,
        category_summary=category_summary,
        wave_groups=wave_groups,
        opportunities=opps,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )

