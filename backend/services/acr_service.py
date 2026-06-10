"""
acr_service.py — Azure Consumption Revenue (ACR) Growth Opportunities Analysis.

Identifies Azure services that are NOT yet enabled on existing resources.
Enabling them opens new consumption streams — growing the customer's Azure footprint
and generating new ACR.

Each opportunity is surfaced with:
  • The specific resource affected
  • Why it matters (risk / business value)
  • What it would cost to enable (estimated monthly ACR impact)
  • Step-by-step implementation guide + Azure CLI snippet

Categories analysed (all work from the already-scanned ResourceMetrics list):
  1.  defender        — Microsoft Defender for Cloud plans not confirmed
  2.  site_recovery   — VMs without Azure Site Recovery (Disaster Recovery)
  3.  monitor         — Resources flying blind — no Azure Monitor diagnostics
  4.  app_insights    — Web/Function apps without Application Insights
  5.  ddos            — Subscriptions without DDoS Protection Standard
  6.  cdn             — Web apps without Azure Front Door / CDN
  7.  bastion         — VMs accessible without Azure Bastion
  8.  autoscale       — App Service Plans / VMSS without autoscale
  9.  update_manager  — VMs without Azure Update Manager / auto-patching
  10. managed_id      — App Services without Managed Identity confirmed
  11. private_ep      — PaaS data services without Private Endpoints
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Tuple

from models.schemas import (
    ResourceMetrics,
    ACRGap,
    ACRCategoryStats,
    ACROpportunities,
)

logger = logging.getLogger(__name__)

# ── Category metadata ──────────────────────────────────────────────────────────

CATEGORY_META: dict[str, dict] = {
    "defender": {
        "name": "Microsoft Defender for Cloud",
        "icon": "🛡️",
        "acr_impact": "high",
        "azure_service": "Microsoft Defender for Cloud",
        "doc_url": "https://learn.microsoft.com/azure/defender-for-cloud/defender-for-cloud-introduction",
    },
    "site_recovery": {
        "name": "Azure Site Recovery (DR)",
        "icon": "🔁",
        "acr_impact": "high",
        "azure_service": "Azure Site Recovery",
        "doc_url": "https://learn.microsoft.com/azure/site-recovery/site-recovery-overview",
    },
    "monitor": {
        "name": "Azure Monitor & Diagnostics",
        "icon": "📊",
        "acr_impact": "medium",
        "azure_service": "Azure Monitor / Log Analytics",
        "doc_url": "https://learn.microsoft.com/azure/azure-monitor/overview",
    },
    "app_insights": {
        "name": "Application Insights",
        "icon": "🔍",
        "acr_impact": "medium",
        "azure_service": "Azure Application Insights",
        "doc_url": "https://learn.microsoft.com/azure/azure-monitor/app/app-insights-overview",
    },
    "ddos": {
        "name": "DDoS Protection Standard",
        "icon": "🌐",
        "acr_impact": "high",
        "azure_service": "Azure DDoS Protection Standard",
        "doc_url": "https://learn.microsoft.com/azure/ddos-protection/ddos-protection-overview",
    },
    "cdn": {
        "name": "Azure Front Door / CDN",
        "icon": "⚡",
        "acr_impact": "medium",
        "azure_service": "Azure Front Door / CDN",
        "doc_url": "https://learn.microsoft.com/azure/frontdoor/front-door-overview",
    },
    "bastion": {
        "name": "Azure Bastion (Secure VM Access)",
        "icon": "🏰",
        "acr_impact": "medium",
        "azure_service": "Azure Bastion",
        "doc_url": "https://learn.microsoft.com/azure/bastion/bastion-overview",
    },
    "autoscale": {
        "name": "Autoscale (Elastic Workloads)",
        "icon": "📈",
        "acr_impact": "high",
        "azure_service": "Azure Autoscale / KEDA",
        "doc_url": "https://learn.microsoft.com/azure/azure-monitor/autoscale/autoscale-overview",
    },
    "update_manager": {
        "name": "Azure Update Manager",
        "icon": "🔄",
        "acr_impact": "low",
        "azure_service": "Azure Update Manager",
        "doc_url": "https://learn.microsoft.com/azure/update-manager/overview",
    },
    "managed_id": {
        "name": "Managed Identity Adoption",
        "icon": "🆔",
        "acr_impact": "medium",
        "azure_service": "Azure Entra Managed Identity",
        "doc_url": "https://learn.microsoft.com/azure/active-directory/managed-identities-azure-resources/overview",
    },
    "private_ep": {
        "name": "Private Endpoint Coverage",
        "icon": "🔒",
        "acr_impact": "medium",
        "azure_service": "Azure Private Endpoint",
        "doc_url": "https://learn.microsoft.com/azure/private-link/private-endpoint-overview",
    },
}

# ── Resource type helpers ──────────────────────────────────────────────────────

_VM_TYPE          = "microsoft.compute/virtualmachines"
_VMSS_TYPE        = "microsoft.compute/virtualmachinescalesets"
_APP_SERVICE_TYPE = "microsoft.web/sites"
_ASP_TYPE         = "microsoft.web/serverfarms"
_AKS_TYPE         = "microsoft.containerservice/managedclusters"
_SQL_TYPE         = "microsoft.sql/servers/databases"
_STORAGE_TYPE     = "microsoft.storage/storageaccounts"
_KV_TYPE          = "microsoft.keyvault/vaults"
_COSMOS_TYPE      = "microsoft.documentdb/databaseaccounts"
_PG_TYPE          = "microsoft.dbforpostgresql/flexibleservers"
_MYSQL_TYPE       = "microsoft.dbformysql/flexibleservers"
_NSG_TYPE         = "microsoft.network/networksecuritygroups"
_VNET_TYPE        = "microsoft.network/virtualnetworks"
_PIP_TYPE         = "microsoft.network/publicipaddresses"
_FD_TYPE          = "microsoft.network/frontdoors"
_CDN_TYPE         = "microsoft.cdn/profiles"
_BASTION_TYPE     = "microsoft.network/bastionhosts"
_DDOS_TYPE        = "microsoft.network/ddosprotectionplans"
_LB_TYPE          = "microsoft.network/loadbalancers"
_AGW_TYPE         = "microsoft.network/applicationgateways"

# Types that should have Defender plan coverage
_DEFENDER_ELIGIBLE = {
    _VM_TYPE, _AKS_TYPE, _SQL_TYPE, _STORAGE_TYPE,
    _APP_SERVICE_TYPE, _COSMOS_TYPE, "microsoft.keyvault/vaults",
}

# Types that benefit from Private Endpoints
_PE_ELIGIBLE = {
    _SQL_TYPE, _COSMOS_TYPE, _STORAGE_TYPE, _KV_TYPE,
    _PG_TYPE, _MYSQL_TYPE,
    "microsoft.cognitiveservices/accounts",
    "microsoft.servicebus/namespaces",
    "microsoft.eventhub/namespaces",
    "microsoft.machinelearningservices/workspaces",
    "microsoft.search/searchservices",
}

# Types to monitor with diagnostics
_MONITOR_ELIGIBLE = {
    _VM_TYPE, _VMSS_TYPE, _APP_SERVICE_TYPE, _ASP_TYPE,
    _AKS_TYPE, _SQL_TYPE, _STORAGE_TYPE, _KV_TYPE,
    _COSMOS_TYPE, _PG_TYPE, _MYSQL_TYPE,
    "microsoft.cache/redis",
    "microsoft.servicebus/namespaces",
    "microsoft.eventhub/namespaces",
    "microsoft.apimanagement/service",
    "microsoft.network/applicationgateways",
}


def _rtype(r: ResourceMetrics) -> str:
    return (r.resource_type or "").lower()


# ── 1. Microsoft Defender for Cloud ──────────────────────────────────────────

def _analyze_defender(resources: List[ResourceMetrics]) -> Tuple[List[ACRGap], ACRCategoryStats]:
    """
    Defender plans are PER resource type — if a plan is not enabled for a type,
    every resource of that type is unprotected.
    We detect using two signals:
      a) Resources with HIGH security Advisor recommendations (strong signal Defender is off)
      b) High-value resources of defender-eligible types where no security advisor
         recs exist (unknown coverage — flag for verification)
    ACR estimates: VMs $15/mo, SQL $15/mo, Storage $10/mo, AKS $7/vCore/mo, App Service $15/mo
    """
    DEFENDER_PRICING = {
        _VM_TYPE:          15.0,
        _SQL_TYPE:         15.0,
        _STORAGE_TYPE:     10.0,
        _AKS_TYPE:         14.0,  # rough $7/vCore × 2 vCore avg
        _APP_SERVICE_TYPE: 15.0,
        _COSMOS_TYPE:       8.0,
        _KV_TYPE:           0.0,  # Key Vault Defender is bundled — no direct cost
    }

    eligible = [r for r in resources if _rtype(r) in _DEFENDER_ELIGIBLE]
    gaps: List[ACRGap] = []

    # Resources with security Advisor recommendations → Defender likely OFF
    has_security_advisors: set[str] = set()
    for r in eligible:
        for rec in r.advisor_recommendations:
            if rec.category and rec.category.lower() in ("security", "highavailability"):
                has_security_advisors.add(r.resource_id.lower())
                break

    # Flag high-cost resources where Defender should be enabled
    for r in eligible:
        rtype_lower = _rtype(r)
        est_acr = DEFENDER_PRICING.get(rtype_lower, 10.0)
        has_sec_rec = r.resource_id.lower() in has_security_advisors

        # Skip very cheap resources unless they have explicit security recs
        if r.cost_current_month < 10 and not has_sec_rec:
            continue

        severity = "high" if has_sec_rec else ("medium" if r.cost_current_month > 50 else "low")

        type_label = {
            _VM_TYPE:          "Virtual Machine",
            _SQL_TYPE:         "Azure SQL Database",
            _STORAGE_TYPE:     "Storage Account",
            _AKS_TYPE:         "AKS Cluster",
            _APP_SERVICE_TYPE: "App Service",
            _COSMOS_TYPE:      "Cosmos DB",
            _KV_TYPE:          "Key Vault",
        }.get(rtype_lower, "resource")

        reason = f"Active Advisor security recommendation detected — Defender plan likely not enabled." if has_sec_rec \
            else f"${r.cost_current_month:.0f}/mo {type_label} — verify Defender plan is active."

        cli = {
            _VM_TYPE:    f"az security pricing create --name VirtualMachines --tier 'Standard'",
            _SQL_TYPE:   f"az security pricing create --name SqlServers --tier 'Standard'",
            _STORAGE_TYPE: f"az security pricing create --name StorageAccounts --tier 'Standard'",
            _AKS_TYPE:   f"az security pricing create --name KubernetesService --tier 'Standard'",
            _APP_SERVICE_TYPE: f"az security pricing create --name AppServices --tier 'Standard'",
        }.get(rtype_lower, "az security pricing create --name <plan-name> --tier Standard")

        gaps.append(ACRGap(
            resource_id=r.resource_id,
            resource_name=r.resource_name,
            resource_type=r.resource_type,
            resource_group=r.resource_group,
            subscription_id=r.subscription_id or "",
            category="Microsoft Defender for Cloud",
            category_key="defender",
            icon="🛡️",
            title=f"Defender for {type_label.split()[-1]} Not Confirmed",
            description=f"'{r.resource_name}' is a {type_label} running ${r.cost_current_month:.0f}/mo. {reason}",
            severity=severity,
            acr_impact="high",
            azure_service="Microsoft Defender for Cloud",
            estimated_monthly_acr=est_acr,
            resource_monthly_cost=r.cost_current_month,
            implementation_steps=[
                f"Open Azure Portal → Defender for Cloud → Environment Settings",
                f"Select subscription → Enable all Defender plans relevant to your workload",
                f"Enable 'Defender for {type_label}' plan",
                f"Review and remediate security recommendations surfaced",
                f"Configure email notifications for security alerts",
            ],
            az_cli_snippet=cli,
            documentation_url="https://learn.microsoft.com/azure/defender-for-cloud/defender-for-cloud-introduction",
        ))

    covered = len(eligible) - len(gaps)
    pct = (covered / max(1, len(eligible))) * 100
    total_acr = sum(g.estimated_monthly_acr for g in gaps)

    cat = ACRCategoryStats(
        category="Microsoft Defender for Cloud",
        category_key="defender",
        icon="🛡️",
        total_eligible=len(eligible),
        covered=max(0, covered),
        gaps=len(gaps),
        coverage_pct=round(pct, 1),
        estimated_total_acr=round(total_acr, 0),
        acr_impact="high",
    )
    return gaps, cat


# ── 2. Azure Site Recovery ────────────────────────────────────────────────────

def _analyze_site_recovery(resources: List[ResourceMetrics]) -> Tuple[List[ACRGap], ACRCategoryStats]:
    """
    ASR protects VMs against region-wide outages by replicating to a secondary region.
    Unlike Azure Backup (file/disk recovery), ASR provides full VM failover.
    We flag all running production VMs (cost > $30) as ASR candidates.
    ACR estimate: ~$25/VM/month (includes ASR licence + target region storage).
    """
    eligible = [r for r in resources if _rtype(r) == _VM_TYPE and r.cost_current_month > 30]
    gaps: List[ACRGap] = []

    for r in eligible:
        power = (r.power_state or "unknown").lower()
        if power == "deallocated":
            severity = "low"
            reason = "VM is currently deallocated but should have ASR configured before it's re-used."
        elif power in ("running", "unknown"):
            severity = "high" if r.cost_current_month > 200 else "medium"
            reason = f"VM is {power} — an outage or region failure would cause unplanned downtime."

        rg = r.resource_group
        name = r.resource_name
        gaps.append(ACRGap(
            resource_id=r.resource_id,
            resource_name=r.resource_name,
            resource_type=r.resource_type,
            resource_group=r.resource_group,
            subscription_id=r.subscription_id or "",
            category="Azure Site Recovery (DR)",
            category_key="site_recovery",
            icon="🔁",
            title="No Site Recovery (DR) Configured",
            description=(
                f"'{name}' (${r.cost_current_month:.0f}/mo, {power}) has no Azure Site Recovery policy. "
                f"{reason} Azure Backup protects data; ASR protects the entire VM and enables failover in minutes."
            ),
            severity=severity,
            acr_impact="high",
            azure_service="Azure Site Recovery",
            estimated_monthly_acr=25.0,
            resource_monthly_cost=r.cost_current_month,
            implementation_steps=[
                "Create or reuse a Recovery Services Vault in the same region",
                "Go to RSV → Site Recovery → Enable Replication",
                f"Select VM: '{name}' in resource group '{rg}'",
                "Choose target region (pair region recommended for compliance)",
                "Configure replication policy (RPO: 15 min, app-consistent snapshots: 4 hrs)",
                "Run Test Failover to validate DR plan",
                "Document RTO/RPO targets in runbook",
            ],
            az_cli_snippet=(
                f"# Enable ASR replication for {name}\n"
                f"az backup protection enable-for-azurefileshare "
                f"# Use Azure Portal or PowerShell for ASR VM replication setup"
            ),
            documentation_url="https://learn.microsoft.com/azure/site-recovery/azure-to-azure-quickstart",
        ))

    covered = 0  # can't determine from existing data
    pct = 0.0 if eligible else 100.0
    total_acr = len(gaps) * 25.0

    cat = ACRCategoryStats(
        category="Azure Site Recovery (DR)",
        category_key="site_recovery",
        icon="🔁",
        total_eligible=len(eligible),
        covered=covered,
        gaps=len(gaps),
        coverage_pct=pct,
        estimated_total_acr=round(total_acr, 0),
        acr_impact="high",
    )
    return gaps, cat


# ── 3. Azure Monitor & Diagnostics ────────────────────────────────────────────

def _analyze_monitor(resources: List[ResourceMetrics]) -> Tuple[List[ACRGap], ACRCategoryStats]:
    """
    Resources with data_confidence == 'none' or telemetry_source == 'none' are
    flying blind — no diagnostic data is flowing to Azure Monitor / Log Analytics.
    ACR estimate: ~$3–8/resource/month (Log Analytics ingestion + retention).
    """
    eligible = [
        r for r in resources
        if _rtype(r) in _MONITOR_ELIGIBLE and r.cost_current_month > 15
    ]
    gaps: List[ACRGap] = []

    for r in eligible:
        if r.data_confidence in ("high", "medium"):
            continue  # Monitor data is flowing

        rtype_lower = _rtype(r)
        est_acr = 8.0 if rtype_lower in (_VM_TYPE, _AKS_TYPE) else 4.0
        severity = "high" if r.cost_current_month > 100 else "medium"

        type_label = r.resource_type.split("/")[-1].replace("s", "", 1).title()
        diag_types = {
            _VM_TYPE:          "VM CPU, disk I/O, network, OS-level metrics",
            _AKS_TYPE:         "Cluster CPU, memory, pod health, node events",
            _SQL_TYPE:         "DTU/vCore usage, query performance, blocking queries",
            _STORAGE_TYPE:     "Read/write IOPS, latency, availability",
            _APP_SERVICE_TYPE: "HTTP requests, response times, failures, dependencies",
            _KV_TYPE:          "Secret access patterns, API calls, availability",
            _COSMOS_TYPE:      "RU consumption, latency, throttling",
        }.get(rtype_lower, "platform metrics and diagnostic logs")

        gaps.append(ACRGap(
            resource_id=r.resource_id,
            resource_name=r.resource_name,
            resource_type=r.resource_type,
            resource_group=r.resource_group,
            subscription_id=r.subscription_id or "",
            category="Azure Monitor & Diagnostics",
            category_key="monitor",
            icon="📊",
            title="No Azure Monitor Diagnostics",
            description=(
                f"'{r.resource_name}' (${r.cost_current_month:.0f}/mo) has no diagnostic settings. "
                f"No {diag_types} are being collected. Without this, performance issues, "
                f"outages, and cost anomalies are invisible until they cause incidents."
            ),
            severity=severity,
            acr_impact="medium",
            azure_service="Azure Monitor / Log Analytics",
            estimated_monthly_acr=est_acr,
            resource_monthly_cost=r.cost_current_month,
            implementation_steps=[
                "Create or reuse a Log Analytics Workspace in the same region",
                f"Open '{r.resource_name}' → Monitoring → Diagnostic settings",
                "Click 'Add diagnostic setting'",
                "Select all relevant log categories and all metrics",
                "Destination: Send to Log Analytics Workspace",
                "Set retention to 90 days for cost-performance balance",
                "Configure alerts on key metrics (CPU > 90%, error rate > 5%)",
            ],
            az_cli_snippet=(
                f"az monitor diagnostic-settings create \\\n"
                f"  --name '{r.resource_name}-diag' \\\n"
                f"  --resource '{r.resource_id}' \\\n"
                f"  --workspace '<log-analytics-workspace-id>' \\\n"
                f"  --metrics '[{{\"category\":\"AllMetrics\",\"enabled\":true}}]' \\\n"
                f"  --logs '[{{\"category\":\"Audit\",\"enabled\":true}}]'"
            ),
            documentation_url="https://learn.microsoft.com/azure/azure-monitor/essentials/diagnostic-settings",
        ))

    covered = len(eligible) - len(gaps)
    pct = (covered / max(1, len(eligible))) * 100
    total_acr = sum(g.estimated_monthly_acr for g in gaps)

    cat = ACRCategoryStats(
        category="Azure Monitor & Diagnostics",
        category_key="monitor",
        icon="📊",
        total_eligible=len(eligible),
        covered=covered,
        gaps=len(gaps),
        coverage_pct=round(pct, 1),
        estimated_total_acr=round(total_acr, 0),
        acr_impact="medium",
    )
    return gaps, cat


# ── 4. Application Insights ───────────────────────────────────────────────────

def _analyze_app_insights(resources: List[ResourceMetrics]) -> Tuple[List[ACRGap], ACRCategoryStats]:
    """
    App Services and Function Apps without App Insights have no visibility into
    request rates, failure rates, response times, or user journeys.
    Detection: App Services with data_confidence == 'none' or health_check_enabled == False.
    ACR estimate: ~$5/app/month (App Insights ingestion, sampling).
    """
    eligible = [
        r for r in resources
        if _rtype(r) == _APP_SERVICE_TYPE and r.cost_current_month > 5
    ]
    gaps: List[ACRGap] = []

    for r in eligible:
        # If we have rich telemetry already, App Insights is likely connected
        if r.data_confidence in ("high", "medium") and r.health_check_enabled:
            continue

        app_kind = (r.app_kind or "web").lower()
        kind_label = {"web": "Web App", "function": "Function App", "logic": "Logic App"}.get(app_kind, "App Service")

        missing_signals = []
        if r.data_confidence in ("none", "low"):
            missing_signals.append("no telemetry data flowing (requests/failures/latency unknown)")
        if not r.health_check_enabled:
            missing_signals.append("health check not configured")

        if not missing_signals:
            continue  # well-monitored

        severity = "high" if r.cost_current_month > 50 else "medium"

        gaps.append(ACRGap(
            resource_id=r.resource_id,
            resource_name=r.resource_name,
            resource_type=r.resource_type,
            resource_group=r.resource_group,
            subscription_id=r.subscription_id or "",
            category="Application Insights",
            category_key="app_insights",
            icon="🔍",
            title=f"{kind_label} Without Application Insights",
            description=(
                f"'{r.resource_name}' ({kind_label}, ${r.cost_current_month:.0f}/mo) has "
                f"{' and '.join(missing_signals)}. Application Insights provides end-to-end "
                f"distributed tracing, live metrics, usage analytics, and automatic anomaly detection."
            ),
            severity=severity,
            acr_impact="medium",
            azure_service="Azure Application Insights",
            estimated_monthly_acr=5.0,
            resource_monthly_cost=r.cost_current_month,
            implementation_steps=[
                "Create an Application Insights resource in the same region",
                f"Open '{r.resource_name}' → Settings → Application Insights",
                "Click 'Turn on Application Insights' → select/create workspace",
                f"Add APPLICATIONINSIGHTS_CONNECTION_STRING to app settings",
                "Install SDK: pip install opencensus-ext-azure (Python) or add NuGet/npm package",
                "Enable health check: Settings → Health check → configure path /health",
                "Set up Smart Detection alerts for anomaly detection",
            ],
            az_cli_snippet=(
                f"# Create App Insights and link to app\n"
                f"AIID=$(az monitor app-insights component create \\\n"
                f"  --app '{r.resource_name}-insights' \\\n"
                f"  --resource-group '{r.resource_group}' \\\n"
                f"  --location <location> --query instrumentationKey -o tsv)\n"
                f"az webapp config appsettings set \\\n"
                f"  --name '{r.resource_name}' \\\n"
                f"  --resource-group '{r.resource_group}' \\\n"
                f"  --settings APPINSIGHTS_INSTRUMENTATIONKEY=$AIID"
            ),
            documentation_url="https://learn.microsoft.com/azure/azure-monitor/app/app-insights-overview",
        ))

    covered = len(eligible) - len(gaps)
    pct = (covered / max(1, len(eligible))) * 100
    total_acr = sum(g.estimated_monthly_acr for g in gaps)

    cat = ACRCategoryStats(
        category="Application Insights",
        category_key="app_insights",
        icon="🔍",
        total_eligible=len(eligible),
        covered=covered,
        gaps=len(gaps),
        coverage_pct=round(pct, 1),
        estimated_total_acr=round(total_acr, 0),
        acr_impact="medium",
    )
    return gaps, cat


# ── 5. DDoS Protection Standard ───────────────────────────────────────────────

def _analyze_ddos(resources: List[ResourceMetrics]) -> Tuple[List[ACRGap], ACRCategoryStats]:
    """
    DDoS Standard protects VNets and all public IPs within them.
    Detection: if no DDoS Protection Plan resource exists in the subscription,
    all internet-facing workloads (VMs, App Gateways, Load Balancers) are unprotected.
    ACR estimate: ~$2,944/month per DDoS plan + ~$30/protected public IP.
    We show one gap per subscription with count of at-risk resources.
    """
    # Check if DDoS plan already exists
    has_ddos_plan = any(_rtype(r) == _DDOS_TYPE for r in resources)
    if has_ddos_plan:
        total_public_facing = len([r for r in resources if _rtype(r) in (_VM_TYPE, _AGW_TYPE, _LB_TYPE)])
        cat = ACRCategoryStats(
            category="DDoS Protection Standard",
            category_key="ddos",
            icon="🌐",
            total_eligible=total_public_facing,
            covered=total_public_facing,
            gaps=0,
            coverage_pct=100.0,
            estimated_total_acr=0.0,
            acr_impact="high",
        )
        return [], cat

    # Identify at-risk public-facing resources
    public_facing = [
        r for r in resources
        if _rtype(r) in (_VM_TYPE, _AGW_TYPE, _LB_TYPE, _PIP_TYPE)
        and r.cost_current_month > 0
    ]
    running_vms = [r for r in resources if _rtype(r) == _VM_TYPE and (r.power_state or "running") != "deallocated"]

    if not public_facing and not running_vms:
        cat = ACRCategoryStats(
            category="DDoS Protection Standard",
            category_key="ddos",
            icon="🌐",
            total_eligible=0,
            covered=0,
            gaps=0,
            coverage_pct=100.0,
            estimated_total_acr=0.0,
            acr_impact="high",
        )
        return [], cat

    public_ip_count = len([r for r in resources if _rtype(r) == _PIP_TYPE])
    at_risk_resources = running_vms + [r for r in public_facing if _rtype(r) in (_AGW_TYPE, _LB_TYPE)]
    est_acr = 2944.0 + (public_ip_count * 30.0)

    # Group by subscription — one gap card per subscription (DDoS plan is sub-level)
    subs: dict[str, list] = {}
    for r in at_risk_resources:
        subs.setdefault(r.subscription_id or "default", []).append(r)

    gaps: List[ACRGap] = []
    for sub_id, sub_resources in subs.items():
        vm_names = ", ".join(r.resource_name for r in sub_resources[:5])
        if len(sub_resources) > 5:
            vm_names += f" +{len(sub_resources)-5} more"

        representative = sub_resources[0]
        total_cost = sum(r.cost_current_month for r in sub_resources)

        gaps.append(ACRGap(
            resource_id=f"sub:{sub_id}:ddos",
            resource_name=f"Subscription — {len(sub_resources)} public-facing resources",
            resource_type="Microsoft.Network/ddosProtectionPlans",
            resource_group=representative.resource_group,
            subscription_id=sub_id,
            category="DDoS Protection Standard",
            category_key="ddos",
            icon="🌐",
            title="No DDoS Protection Standard Plan",
            description=(
                f"Subscription has {len(sub_resources)} public-facing resources "
                f"({vm_names}) totalling ${total_cost:.0f}/mo "
                f"with no DDoS Protection Standard plan. "
                f"A volumetric or protocol attack would bring down all public services. "
                f"DDoS Standard covers all public IPs in the protected VNets — "
                f"currently {public_ip_count} public IP(s) in scope."
            ),
            severity="high",
            acr_impact="high",
            azure_service="Azure DDoS Protection Standard",
            estimated_monthly_acr=round(est_acr, 0),
            resource_monthly_cost=total_cost,
            implementation_steps=[
                "Create a DDoS Protection Plan resource (one per subscription is sufficient)",
                "Associate all production VNets to the DDoS plan",
                "All public IPs in those VNets are automatically protected",
                "Enable DDoS diagnostic logs → send to Log Analytics for attack telemetry",
                "Configure alerts on DDoS attack metric (IsUnderDDoSAttack)",
                "Test with Azure DDoS simulation partner (BreakingPoint Cloud)",
            ],
            az_cli_snippet=(
                f"az network ddos-protection create \\\n"
                f"  --name 'ddos-protection-plan' \\\n"
                f"  --resource-group '{representative.resource_group}' \\\n"
                f"  --location <location>\n"
                f"# Then associate your VNet:\n"
                f"az network vnet update \\\n"
                f"  --name '<your-vnet>' \\\n"
                f"  --resource-group '<vnet-rg>' \\\n"
                f"  --ddos-protection true \\\n"
                f"  --ddos-protection-plan '/subscriptions/.../ddos-protection-plan'"
            ),
            documentation_url="https://learn.microsoft.com/azure/ddos-protection/manage-ddos-protection",
        ))

    cat = ACRCategoryStats(
        category="DDoS Protection Standard",
        category_key="ddos",
        icon="🌐",
        total_eligible=len(at_risk_resources),
        covered=0,
        gaps=len(gaps),
        coverage_pct=0.0,
        estimated_total_acr=round(est_acr * len(subs), 0),
        acr_impact="high",
    )
    return gaps, cat


# ── 6. Azure Front Door / CDN ─────────────────────────────────────────────────

def _analyze_cdn(resources: List[ResourceMetrics]) -> Tuple[List[ACRGap], ACRCategoryStats]:
    """
    Web-facing App Services without a CDN / Front Door profile serve content
    directly from the origin region — higher latency, no edge caching,
    no WAF, no failover.
    ACR estimate: ~$35/month per Front Door Standard endpoint.
    """
    # Check if any CDN / Front Door resources already exist
    existing_cdn_rg: set[str] = set()
    for r in resources:
        if _rtype(r) in (_FD_TYPE, _CDN_TYPE, "microsoft.network/frontdoorwebapplicationfirewallpolicies",
                          "microsoft.cdn/profiles"):
            existing_cdn_rg.add(r.resource_group.lower())
            existing_cdn_rg.add(r.subscription_id.lower() if r.subscription_id else "")

    web_apps = [
        r for r in resources
        if _rtype(r) == _APP_SERVICE_TYPE
        and (r.app_kind or "web").lower() == "web"
        and r.cost_current_month > 20
    ]

    gaps: List[ACRGap] = []
    for r in web_apps:
        # Skip apps already fronted by a CDN in the same subscription
        sub_id_lower = (r.subscription_id or "").lower()
        if sub_id_lower in existing_cdn_rg or r.resource_group.lower() in existing_cdn_rg:
            continue

        runtime = r.runtime_stack or "unknown runtime"
        gaps.append(ACRGap(
            resource_id=r.resource_id,
            resource_name=r.resource_name,
            resource_type=r.resource_type,
            resource_group=r.resource_group,
            subscription_id=r.subscription_id or "",
            category="Azure Front Door / CDN",
            category_key="cdn",
            icon="⚡",
            title="Web App Without Azure Front Door",
            description=(
                f"'{r.resource_name}' ({runtime}, ${r.cost_current_month:.0f}/mo) is serving "
                f"requests directly without a CDN or Front Door. Users outside the deployment "
                f"region experience higher latency, there is no DDoS edge protection, "
                f"no WAF policy, and no automatic failover to a secondary origin."
            ),
            severity="medium",
            acr_impact="medium",
            azure_service="Azure Front Door / CDN",
            estimated_monthly_acr=35.0,
            resource_monthly_cost=r.cost_current_month,
            implementation_steps=[
                "Create an Azure Front Door Standard/Premium profile",
                f"Add '{r.resource_name}.azurewebsites.net' as the origin",
                "Configure routing rules (path-based routing for /api vs /static)",
                "Enable caching for static assets (images, JS, CSS)",
                "Configure WAF policy (OWASP 3.2 managed rules)",
                "Set up health probes to the origin",
                "Map your custom domain to the Front Door endpoint",
            ],
            az_cli_snippet=(
                f"az afd profile create \\\n"
                f"  --profile-name '{r.resource_name}-fd' \\\n"
                f"  --resource-group '{r.resource_group}' \\\n"
                f"  --sku Standard_AzureFrontDoor\n"
                f"az afd origin-group create \\\n"
                f"  --profile-name '{r.resource_name}-fd' \\\n"
                f"  --resource-group '{r.resource_group}' \\\n"
                f"  --origin-group-name default-og \\\n"
                f"  --probe-path '/health' --probe-protocol Https"
            ),
            documentation_url="https://learn.microsoft.com/azure/frontdoor/front-door-overview",
        ))

    covered = len(web_apps) - len(gaps)
    pct = (covered / max(1, len(web_apps))) * 100
    total_acr = len(gaps) * 35.0

    cat = ACRCategoryStats(
        category="Azure Front Door / CDN",
        category_key="cdn",
        icon="⚡",
        total_eligible=len(web_apps),
        covered=covered,
        gaps=len(gaps),
        coverage_pct=round(pct, 1),
        estimated_total_acr=round(total_acr, 0),
        acr_impact="medium",
    )
    return gaps, cat


# ── 7. Azure Bastion ──────────────────────────────────────────────────────────

def _analyze_bastion(resources: List[ResourceMetrics]) -> Tuple[List[ACRGap], ACRCategoryStats]:
    """
    VMs reachable over public IPs via RDP/SSH are directly exposed to the internet.
    Detection: Running VMs where no Azure Bastion host exists in the same subscription.
    ACR estimate: ~$140/month per Bastion Standard host.
    """
    has_bastion_subs: set[str] = set()
    has_bastion_rgs:  set[str] = set()
    for r in resources:
        if _rtype(r) == _BASTION_TYPE:
            has_bastion_subs.add(r.subscription_id or "")
            has_bastion_rgs.add(r.resource_group.lower())

    running_vms = [
        r for r in resources
        if _rtype(r) == _VM_TYPE
        and (r.power_state or "running").lower() in ("running", "unknown")
        and r.cost_current_month > 20
    ]

    gaps: List[ACRGap] = []
    for r in running_vms:
        sub_has_bastion = (r.subscription_id or "") in has_bastion_subs
        if sub_has_bastion:
            continue  # Bastion exists in this subscription — VM is reachable via Bastion

        severity = "high" if not r.has_private_endpoint and r.cost_current_month > 100 else "medium"

        gaps.append(ACRGap(
            resource_id=r.resource_id,
            resource_name=r.resource_name,
            resource_type=r.resource_type,
            resource_group=r.resource_group,
            subscription_id=r.subscription_id or "",
            category="Azure Bastion (Secure VM Access)",
            category_key="bastion",
            icon="🏰",
            title="VM Accessible Without Azure Bastion",
            description=(
                f"'{r.resource_name}' (${r.cost_current_month:.0f}/mo, {r.power_state or 'running'}) "
                f"has no Azure Bastion host in its subscription. Without Bastion, RDP/SSH access "
                f"requires either a public IP (internet-exposed) or a VPN (complex management). "
                f"Bastion provides browser-based RDP/SSH directly from the Azure Portal — "
                f"no public IP needed, no open ports on NSG."
            ),
            severity=severity,
            acr_impact="medium",
            azure_service="Azure Bastion",
            estimated_monthly_acr=140.0 / max(1, len(running_vms)),  # Amortize across VMs
            resource_monthly_cost=r.cost_current_month,
            implementation_steps=[
                "Create AzureBastionSubnet (/27 or larger) in the target VNet",
                f"Deploy Azure Bastion Standard (covers all VMs in the VNet)",
                "Remove public IPs from VMs (if present) — they are no longer needed",
                "Update NSG to deny inbound RDP (3389) and SSH (22) from internet",
                "Connect via Azure Portal: VM → Connect → Bastion",
                "Enable native client support for RDP client compatibility",
            ],
            az_cli_snippet=(
                f"# Create Bastion subnet in your VNet first, then:\n"
                f"az network bastion create \\\n"
                f"  --name 'bastion-{r.resource_group.lower()[:12]}' \\\n"
                f"  --resource-group '{r.resource_group}' \\\n"
                f"  --vnet-name '<your-vnet-name>' \\\n"
                f"  --public-ip-address '<bastion-pip-name>' \\\n"
                f"  --sku Standard"
            ),
            documentation_url="https://learn.microsoft.com/azure/bastion/bastion-overview",
        ))

    covered = len(running_vms) - len(gaps)
    pct = (covered / max(1, len(running_vms))) * 100
    total_acr = len(set(g.subscription_id for g in gaps)) * 140.0  # one Bastion per sub

    cat = ACRCategoryStats(
        category="Azure Bastion (Secure VM Access)",
        category_key="bastion",
        icon="🏰",
        total_eligible=len(running_vms),
        covered=covered,
        gaps=len(gaps),
        coverage_pct=round(pct, 1),
        estimated_total_acr=round(total_acr, 0),
        acr_impact="medium",
    )
    return gaps, cat


# ── 8. Autoscale ──────────────────────────────────────────────────────────────

def _analyze_autoscale(resources: List[ResourceMetrics]) -> Tuple[List[ACRGap], ACRCategoryStats]:
    """
    App Service Plans running on a single instance and VMSS without scale rules
    cannot handle traffic spikes — they either go down or are over-provisioned.
    Autoscale enables elasticity: scale out during peaks, scale in during troughs.
    Detection: App Service Plans with instance_count <= 1 or VMSS/AKS resources.
    ACR impact: enables higher average consumption through demand-driven scaling.
    """
    eligible = [
        r for r in resources
        if _rtype(r) in (_ASP_TYPE, _VMSS_TYPE, _AKS_TYPE)
        and r.cost_current_month > 30
    ]
    gaps: List[ACRGap] = []

    for r in eligible:
        rtype_lower = _rtype(r)
        instance_cnt = r.instance_count or 1

        # App Service Plans: flag single-instance plans (no autoscale headroom)
        if rtype_lower == _ASP_TYPE and instance_cnt > 2:
            continue  # Already scaled — probably has autoscale

        severity = "medium"
        if rtype_lower == _VMSS_TYPE:
            title = "VMSS Without Confirmed Autoscale Rules"
            description = (
                f"'{r.resource_name}' is a VM Scale Set (${r.cost_current_month:.0f}/mo) "
                f"with {instance_cnt} instance(s). Without autoscale rules, capacity is static — "
                f"traffic spikes cause degradation and off-peak hours waste money on idle instances."
            )
            steps = [
                "Navigate to VM Scale Set → Scaling",
                "Enable custom autoscale",
                "Add scale-out rule: CPU average > 75% for 5 minutes → add 1 instance",
                "Add scale-in rule: CPU average < 25% for 10 minutes → remove 1 instance",
                "Set minimum instances: 2, maximum: 10 (adjust for workload)",
                "Configure cool-down period: 5 minutes scale-out, 10 minutes scale-in",
            ]
            cli = (
                f"az monitor autoscale create \\\n"
                f"  --resource-group '{r.resource_group}' \\\n"
                f"  --resource '{r.resource_id}' \\\n"
                f"  --resource-type Microsoft.Compute/virtualMachineScaleSets \\\n"
                f"  --name '{r.resource_name}-autoscale' \\\n"
                f"  --min-count 2 --max-count 10 --count 2"
            )
        elif rtype_lower == _AKS_TYPE:
            title = "AKS Cluster — Verify Cluster Autoscaler"
            description = (
                f"'{r.resource_name}' is an AKS cluster (${r.cost_current_month:.0f}/mo). "
                f"Without the cluster autoscaler and KEDA (pod-level), node pools are static — "
                f"burst traffic degrades pods and idle nodes waste spend."
            )
            steps = [
                "Enable cluster autoscaler on each node pool",
                "Set min/max node counts per pool based on workload profile",
                "Install KEDA for event-driven pod autoscaling",
                "Configure Horizontal Pod Autoscaler (HPA) for each deployment",
                "Enable Azure Monitor for Containers to track autoscale events",
            ]
            cli = (
                f"az aks update \\\n"
                f"  --resource-group '{r.resource_group}' \\\n"
                f"  --name '{r.resource_name}' \\\n"
                f"  --enable-cluster-autoscaler \\\n"
                f"  --min-count 2 --max-count 10"
            )
            severity = "medium"
        else:  # App Service Plan
            sku_upper = (r.sku or "").upper()
            if "FREE" in sku_upper or "SHARED" in sku_upper or "F1" in sku_upper or "D1" in sku_upper:
                continue  # Free/Shared tiers can't autoscale
            title = "App Service Plan — Single Instance (No Autoscale)"
            description = (
                f"'{r.resource_name}' App Service Plan (${r.cost_current_month:.0f}/mo, "
                f"SKU: {r.sku or 'unknown'}) runs {instance_cnt} instance(s). "
                f"A traffic spike will saturate the single instance — requests queue and time out. "
                f"Autoscale adds instances automatically during peaks and removes them when quiet."
            )
            steps = [
                f"Open App Service Plan '{r.resource_name}' → Scale out (App Service plan)",
                "Switch to 'Custom autoscale'",
                "Add CPU-based scale rule: > 70% average for 5 min → scale out by 1",
                "Add HTTP queue scale rule: > 500 queued requests → scale out by 1",
                "Scale in: CPU < 30% for 10 min → remove 1 instance",
                "Set min: 1, max: 5 (or based on your budget)",
            ]
            cli = (
                f"az monitor autoscale create \\\n"
                f"  --resource-group '{r.resource_group}' \\\n"
                f"  --resource '{r.resource_id}' \\\n"
                f"  --resource-type Microsoft.Web/serverFarms \\\n"
                f"  --name '{r.resource_name}-autoscale' \\\n"
                f"  --min-count 1 --max-count 5 --count 1"
            )

        gaps.append(ACRGap(
            resource_id=r.resource_id,
            resource_name=r.resource_name,
            resource_type=r.resource_type,
            resource_group=r.resource_group,
            subscription_id=r.subscription_id or "",
            category="Autoscale (Elastic Workloads)",
            category_key="autoscale",
            icon="📈",
            title=title,
            description=description,
            severity=severity,
            acr_impact="high",
            azure_service="Azure Autoscale / KEDA",
            estimated_monthly_acr=r.cost_current_month * 0.20,  # 20% headroom utilization gain
            resource_monthly_cost=r.cost_current_month,
            implementation_steps=steps,
            az_cli_snippet=cli,
            documentation_url="https://learn.microsoft.com/azure/azure-monitor/autoscale/autoscale-overview",
        ))

    covered = len(eligible) - len(gaps)
    pct = (covered / max(1, len(eligible))) * 100
    total_acr = sum(g.estimated_monthly_acr for g in gaps)

    cat = ACRCategoryStats(
        category="Autoscale (Elastic Workloads)",
        category_key="autoscale",
        icon="📈",
        total_eligible=len(eligible),
        covered=covered,
        gaps=len(gaps),
        coverage_pct=round(pct, 1),
        estimated_total_acr=round(total_acr, 0),
        acr_impact="high",
    )
    return gaps, cat


# ── 9. Azure Update Manager ───────────────────────────────────────────────────

def _analyze_update_manager(resources: List[ResourceMetrics]) -> Tuple[List[ACRGap], ACRCategoryStats]:
    """
    VMs without Update Manager have uncontrolled patching — either manual (admin-intensive)
    or not patched at all (security risk).
    Detection: Running VMs without auto_shutdown (proxy for "not actively managed").
    Focus on Windows VMs (SQL/IIS workloads) where patching is critical.
    ACR: Update Manager is free for Azure VMs. Value = positions for Arc / hybrid management.
    """
    eligible = [
        r for r in resources
        if _rtype(r) == _VM_TYPE
        and r.cost_current_month > 30
        and (r.power_state or "running").lower() in ("running", "unknown")
    ]
    gaps: List[ACRGap] = []

    for r in eligible:
        # Proxy: VMs with auto_shutdown often have Update Manager configured (dev VMs)
        # Skip very well-managed VMs
        if r.auto_shutdown and r.has_backup:
            continue  # likely well-managed dev VM

        # Focus on VMs that look like production (high cost, no dev signals)
        if r.cost_current_month < 50 and r.auto_shutdown:
            continue

        severity = "medium" if r.cost_current_month > 200 else "low"

        # Guess OS from SKU/name if possible
        name_lower = (r.resource_name or "").lower()
        sku_lower  = (r.sku or "").lower()
        os_guess = "Windows" if any(w in name_lower + sku_lower for w in
                                     ("win", "windows", "sql", "2019", "2022", "2016")) else "Linux/Windows"

        gaps.append(ACRGap(
            resource_id=r.resource_id,
            resource_name=r.resource_name,
            resource_type=r.resource_type,
            resource_group=r.resource_group,
            subscription_id=r.subscription_id or "",
            category="Azure Update Manager",
            category_key="update_manager",
            icon="🔄",
            title=f"{os_guess} VM — Update Manager Not Confirmed",
            description=(
                f"'{r.resource_name}' ({os_guess} VM, ${r.cost_current_month:.0f}/mo) has no "
                f"confirmed update schedule via Azure Update Manager. Manual patching is "
                f"error-prone and creates compliance gaps. Update Manager provides "
                f"patch compliance reporting, scheduled maintenance windows, "
                f"and hotpatch support (Windows Server 2022 Datacenter Azure Edition)."
            ),
            severity=severity,
            acr_impact="low",
            azure_service="Azure Update Manager",
            estimated_monthly_acr=2.0,  # positioned for Arc upsell
            resource_monthly_cost=r.cost_current_month,
            implementation_steps=[
                "Navigate to Azure Portal → Update Manager",
                f"Select VM '{r.resource_name}' → Check for updates",
                "Review missing patches by severity (Critical/Important)",
                "Create maintenance configuration: define schedule + patch classification",
                "Assign VMs to maintenance configuration",
                "Enable automatic VM guest patching (Azure-managed maintenance windows)",
                "For hybrid/Arc VMs: Install Azure Arc agent to bring into Update Manager",
            ],
            az_cli_snippet=(
                f"# Enable auto guest patching on VM:\n"
                f"az vm update \\\n"
                f"  --resource-group '{r.resource_group}' \\\n"
                f"  --name '{r.resource_name}' \\\n"
                f"  --set osProfile.windowsConfiguration.enableAutomaticUpdates=true \\\n"
                f"  --set osProfile.windowsConfiguration.patchSettings.patchMode=AutomaticByPlatform\n"
                f"# Check patch status:\n"
                f"az vm assess-patches \\\n"
                f"  --resource-group '{r.resource_group}' \\\n"
                f"  --name '{r.resource_name}'"
            ),
            documentation_url="https://learn.microsoft.com/azure/update-manager/overview",
        ))

    covered = len(eligible) - len(gaps)
    pct = (covered / max(1, len(eligible))) * 100
    total_acr = sum(g.estimated_monthly_acr for g in gaps)

    cat = ACRCategoryStats(
        category="Azure Update Manager",
        category_key="update_manager",
        icon="🔄",
        total_eligible=len(eligible),
        covered=covered,
        gaps=len(gaps),
        coverage_pct=round(pct, 1),
        estimated_total_acr=round(total_acr, 0),
        acr_impact="low",
    )
    return gaps, cat


# ── 10. Managed Identity ──────────────────────────────────────────────────────

def _analyze_managed_identity(resources: List[ResourceMetrics]) -> Tuple[List[ACRGap], ACRCategoryStats]:
    """
    App Services / Function Apps using connection strings or SAS tokens instead
    of Managed Identity have hardcoded secrets — a security risk and an Entra
    adoption gap.
    Detection: App Services with low RBAC assignment count (proxy for no MI configured).
    ACR: Managed Identity is free; drives Entra ID P1/P2 licensing adoption.
    """
    eligible = [
        r for r in resources
        if _rtype(r) == _APP_SERVICE_TYPE
        and r.cost_current_month > 10
    ]
    gaps: List[ACRGap] = []

    for r in eligible:
        # Proxy: rbac_assignment_count > 1 suggests MI is configured (it creates RBAC assignments)
        # private_endpoint also suggests secure, managed architecture
        if r.rbac_assignment_count > 1 or r.has_private_endpoint:
            continue

        app_kind = (r.app_kind or "web").lower()
        kind_label = {"web": "Web App", "function": "Function App", "logic": "Logic App"}.get(app_kind, "App Service")
        runtime = r.runtime_stack or "unknown runtime"
        severity = "medium" if r.cost_current_month > 50 else "low"

        gaps.append(ACRGap(
            resource_id=r.resource_id,
            resource_name=r.resource_name,
            resource_type=r.resource_type,
            resource_group=r.resource_group,
            subscription_id=r.subscription_id or "",
            category="Managed Identity Adoption",
            category_key="managed_id",
            icon="🆔",
            title=f"{kind_label} — Managed Identity Not Confirmed",
            description=(
                f"'{r.resource_name}' ({kind_label}, {runtime}, ${r.cost_current_month:.0f}/mo) "
                f"shows {r.rbac_assignment_count} RBAC assignments — a low count suggests "
                f"the app may be using connection strings, SAS tokens, or client secrets "
                f"instead of Managed Identity. Hardcoded secrets rotate poorly, "
                f"expire unexpectedly, and create data-breach risk if leaked."
            ),
            severity=severity,
            acr_impact="medium",
            azure_service="Azure Entra Managed Identity",
            estimated_monthly_acr=0.0,  # Entra P1 is user-license, not resource cost
            resource_monthly_cost=r.cost_current_month,
            implementation_steps=[
                f"Enable system-assigned managed identity: App Service → Identity → On",
                f"Grant identity access to dependent services (Storage, SQL, Key Vault, etc.)",
                f"For Storage: assign 'Storage Blob Data Contributor' role",
                f"For SQL: CREATE USER [{r.resource_name}] FROM EXTERNAL PROVIDER; GRANT SELECT...",
                f"For Key Vault: assign 'Key Vault Secrets User' role",
                f"Update app code: use DefaultAzureCredential() instead of connection strings",
                f"Remove hardcoded secrets from app settings and rotate all leaked credentials",
            ],
            az_cli_snippet=(
                f"# Enable system-assigned identity:\n"
                f"az webapp identity assign \\\n"
                f"  --name '{r.resource_name}' \\\n"
                f"  --resource-group '{r.resource_group}'\n"
                f"# Grant Storage access:\n"
                f"PRINCIPALID=$(az webapp identity show \\\n"
                f"  --name '{r.resource_name}' --resource-group '{r.resource_group}' \\\n"
                f"  --query principalId -o tsv)\n"
                f"az role assignment create \\\n"
                f"  --assignee $PRINCIPALID \\\n"
                f"  --role 'Storage Blob Data Contributor' \\\n"
                f"  --scope '/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Storage/storageAccounts/<sa>'"
            ),
            documentation_url="https://learn.microsoft.com/azure/app-service/overview-managed-identity",
        ))

    covered = len(eligible) - len(gaps)
    pct = (covered / max(1, len(eligible))) * 100

    cat = ACRCategoryStats(
        category="Managed Identity Adoption",
        category_key="managed_id",
        icon="🆔",
        total_eligible=len(eligible),
        covered=covered,
        gaps=len(gaps),
        coverage_pct=round(pct, 1),
        estimated_total_acr=0.0,
        acr_impact="medium",
    )
    return gaps, cat


# ── 11. Private Endpoints ─────────────────────────────────────────────────────

def _analyze_private_endpoints(resources: List[ResourceMetrics]) -> Tuple[List[ACRGap], ACRCategoryStats]:
    """
    PaaS data services without Private Endpoints are reachable over the public internet.
    This creates compliance gaps and data exfiltration risk.
    Detection: `has_private_endpoint == False` for PE-eligible types.
    ACR estimate: ~$7.30/endpoint/month + Private DNS Zone ~$1/month.
    """
    eligible = [
        r for r in resources
        if _rtype(r) in _PE_ELIGIBLE and r.cost_current_month > 10
    ]
    gaps: List[ACRGap] = []

    TYPE_LABELS = {
        _SQL_TYPE:       ("Azure SQL Database",     "microsoft.sql/servers",                    "sqlServer"),
        _COSMOS_TYPE:    ("Cosmos DB",              "microsoft.documentdb/databaseaccounts",    "Sql"),
        _STORAGE_TYPE:   ("Storage Account",        "microsoft.storage/storageaccounts",        "blob"),
        _KV_TYPE:        ("Key Vault",              "microsoft.keyvault/vaults",                "vault"),
        _PG_TYPE:        ("PostgreSQL Flexible",    "microsoft.dbforpostgresql/flexibleservers", "postgresqlServer"),
        _MYSQL_TYPE:     ("MySQL Flexible",         "microsoft.dbformysql/flexibleservers",     "mysqlServer"),
        "microsoft.cognitiveservices/accounts": ("AI / Cognitive Services", "microsoft.cognitiveservices/accounts", "account"),
        "microsoft.servicebus/namespaces":      ("Service Bus",  "microsoft.servicebus/namespaces",   "namespace"),
        "microsoft.eventhub/namespaces":        ("Event Hub",    "microsoft.eventhub/namespaces",     "namespace"),
    }

    for r in eligible:
        if r.has_private_endpoint:
            continue

        rtype_lower = _rtype(r)
        label, provider_type, subresource = TYPE_LABELS.get(
            rtype_lower, (r.resource_type.split("/")[-1].title(), r.resource_type, "default")
        )

        severity = "critical" if rtype_lower in (_SQL_TYPE, _COSMOS_TYPE, _KV_TYPE) else "high"
        est_acr = 7.30 + 1.0  # endpoint + private DNS zone

        gaps.append(ACRGap(
            resource_id=r.resource_id,
            resource_name=r.resource_name,
            resource_type=r.resource_type,
            resource_group=r.resource_group,
            subscription_id=r.subscription_id or "",
            category="Private Endpoint Coverage",
            category_key="private_ep",
            icon="🔒",
            title=f"{label} Exposed Over Public Network",
            description=(
                f"'{r.resource_name}' ({label}, ${r.cost_current_month:.0f}/mo) has no Private Endpoint. "
                f"It is reachable over the public internet — any application or user with "
                f"the connection string can attempt to connect from anywhere. "
                f"A Private Endpoint creates a private NIC inside your VNet so traffic "
                f"never leaves the Microsoft backbone. Public network access can then be disabled."
            ),
            severity=severity,
            acr_impact="medium",
            azure_service="Azure Private Endpoint",
            estimated_monthly_acr=est_acr,
            resource_monthly_cost=r.cost_current_month,
            implementation_steps=[
                f"Navigate to '{r.resource_name}' → Networking → Private endpoint connections",
                "Click '+ Private endpoint'",
                "Select VNet and subnet for the private NIC",
                f"Select subresource: '{subresource}'",
                "Integrate with Private DNS Zone (auto-creates {provider_type}.privatelink.azure.com)",
                f"After PE is provisioned: set publicNetworkAccess = Disabled",
                "Update application connection strings to use the private FQDN",
            ],
            az_cli_snippet=(
                f"az network private-endpoint create \\\n"
                f"  --name '{r.resource_name}-pe' \\\n"
                f"  --resource-group '{r.resource_group}' \\\n"
                f"  --vnet-name '<vnet-name>' --subnet '<subnet-name>' \\\n"
                f"  --private-connection-resource-id '{r.resource_id}' \\\n"
                f"  --group-id '{subresource}' \\\n"
                f"  --connection-name '{r.resource_name}-pe-conn'"
            ),
            documentation_url="https://learn.microsoft.com/azure/private-link/private-endpoint-overview",
        ))

    covered = len(eligible) - len(gaps)
    pct = (covered / max(1, len(eligible))) * 100
    total_acr = len(gaps) * 8.3

    cat = ACRCategoryStats(
        category="Private Endpoint Coverage",
        category_key="private_ep",
        icon="🔒",
        total_eligible=len(eligible),
        covered=covered,
        gaps=len(gaps),
        coverage_pct=round(pct, 1),
        estimated_total_acr=round(total_acr, 0),
        acr_impact="medium",
    )
    return gaps, cat


# ── Main entry point ───────────────────────────────────────────────────────────

def analyze_acr_opportunities(resources: List[ResourceMetrics]) -> ACROpportunities:
    """
    Run all ACR opportunity analyzers and return a consolidated ACROpportunities object.
    All analyzers work from the already-scanned ResourceMetrics list — no additional
    Azure API calls required.
    """
    analyzers = [
        _analyze_defender,
        _analyze_site_recovery,
        _analyze_monitor,
        _analyze_app_insights,
        _analyze_ddos,
        _analyze_cdn,
        _analyze_bastion,
        _analyze_autoscale,
        _analyze_update_manager,
        _analyze_managed_identity,
        _analyze_private_endpoints,
    ]

    all_gaps:   List[ACRGap]          = []
    all_cats:   List[ACRCategoryStats] = []

    for analyzer in analyzers:
        try:
            gaps, cat = analyzer(resources)
            all_gaps.extend(gaps)
            if cat.total_eligible > 0:
                all_cats.append(cat)
        except Exception as exc:
            logger.warning("ACR analyzer %s failed: %s", analyzer.__name__, exc)

    # Sort gaps: critical → high → medium → low, then by monthly cost desc
    sev_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    all_gaps.sort(key=lambda g: (sev_order.get(g.severity, 9), -g.resource_monthly_cost))

    # Sort categories by estimated_total_acr desc
    all_cats.sort(key=lambda c: -c.estimated_total_acr)

    total_eligible   = sum(c.total_eligible for c in all_cats)
    total_covered    = sum(c.covered        for c in all_cats)
    total_gaps_count = sum(c.gaps           for c in all_cats)
    coverage_pct     = (total_covered / max(1, total_eligible)) * 100

    total_acr = sum(c.estimated_total_acr for c in all_cats)

    critical_count = sum(1 for g in all_gaps if g.severity == "critical")
    high_count     = sum(1 for g in all_gaps if g.severity == "high")
    medium_count   = sum(1 for g in all_gaps if g.severity == "medium")
    low_count      = sum(1 for g in all_gaps if g.severity == "low")

    result = ACROpportunities(
        categories=all_cats,
        gaps=all_gaps,
        total_eligible=total_eligible,
        total_covered=total_covered,
        total_gaps=total_gaps_count,
        coverage_pct=round(coverage_pct, 1),
        estimated_total_monthly_acr=round(total_acr, 0),
        critical_count=critical_count,
        high_count=high_count,
        medium_count=medium_count,
        low_count=low_count,
        generated_at=datetime.now(tz=timezone.utc).isoformat(),
    )

    logger.info(
        "ACR opportunities: %d categories, %d gaps (%d critical, %d high) — "
        "$%.0f/mo estimated ACR potential",
        len(all_cats), len(all_gaps),
        critical_count, high_count, total_acr,
    )
    return result
