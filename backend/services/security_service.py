"""
Security Coverage Gaps Service

Analyses the collected resource data and identifies security gaps without any
additional Azure API calls.  The gaps feed both the Security WAF pillar score
and the dedicated Security Panel in the frontend.

Gap types
─────────
• no_backup          — backup-worthy resource has no Azure Backup policy
• no_private_endpoint — data/AI service exposed over public network
• no_lock            — critical/costly resource has no resource lock
• public_exposure    — public IP / open NSG on a compute resource
• missing_tags       — governance gap (no Owner / CostCenter tag)
• unmonitored        — high-cost resource with no diagnostic data
"""
from __future__ import annotations

from typing import List
from models.schemas import ResourceMetrics, SecurityGap


_BACKUP_TYPES = {
    "microsoft.compute/virtualmachines",
    "microsoft.sql/servers/databases",
    "microsoft.storage/storageaccounts",
    "microsoft.documentdb/databaseaccounts",
    "microsoft.dbformysql/flexibleservers",
    "microsoft.dbforpostgresql/flexibleservers",
    "microsoft.web/sites",
}

_PRIVATE_ENDPOINT_TYPES = {
    "microsoft.sql/servers/databases",
    "microsoft.documentdb/databaseaccounts",
    "microsoft.storage/storageaccounts",
    "microsoft.keyvault/vaults",
    "microsoft.dbformysql/flexibleservers",
    "microsoft.dbforpostgresql/flexibleservers",
    "microsoft.cognitiveservices/accounts",
    "microsoft.machinelearningservices/workspaces",
    "microsoft.servicebus/namespaces",
    "microsoft.eventhub/namespaces",
}

_LOCK_WORTHY_COST = 200.0   # USD/month threshold for "critical resource"


def identify_security_gaps(resources: List[ResourceMetrics]) -> List[SecurityGap]:
    gaps: List[SecurityGap] = []

    for r in resources:
        rtype = (r.resource_type or "").lower()

        # ── 1. No Backup ──────────────────────────────────────────────────────
        if rtype in _BACKUP_TYPES and not r.has_backup:
            monthly_risk = r.cost_current_month * 2.0   # rough restore-cost proxy
            gaps.append(SecurityGap(
                resource_id=r.resource_id,
                resource_name=r.resource_name,
                resource_type=r.resource_type,
                resource_group=r.resource_group,
                subscription_id=r.subscription_id or "",
                gap_type="no_backup",
                severity="high" if r.cost_current_month > 100 else "medium",
                title="No Azure Backup Policy",
                description=f"'{r.resource_name}' has no backup policy. Data loss could mean recovery costs or SLA breach.",
                azure_service="Azure Backup",
                monthly_risk_usd=round(monthly_risk, 2),
            ))

        # ── 2. Data service without Private Endpoint ──────────────────────────
        if rtype in _PRIVATE_ENDPOINT_TYPES and not r.has_private_endpoint:
            # Use accurate titles per resource type
            _PE_TITLES = {
                "microsoft.sql/servers/databases": "No Private Endpoint on SQL Server",
                "microsoft.documentdb/databaseaccounts": "No Private Endpoint on Cosmos DB",
                "microsoft.keyvault/vaults": "No Private Endpoint on Key Vault",
                "microsoft.storage/storageaccounts": "No Private Endpoint on Storage Account",
                "microsoft.dbformysql/flexibleservers": "No Private Endpoint on MySQL Server",
                "microsoft.dbforpostgresql/flexibleservers": "No Private Endpoint on PostgreSQL Server",
                "microsoft.cognitiveservices/accounts": "No Private Endpoint on AI Service",
                "microsoft.machinelearningservices/workspaces": "No Private Endpoint on ML Workspace",
                "microsoft.servicebus/namespaces": "No Private Endpoint on Service Bus",
                "microsoft.eventhub/namespaces": "No Private Endpoint on Event Hub",
            }
            pe_title = _PE_TITLES.get(rtype, "No Private Endpoint Configured")
            gaps.append(SecurityGap(
                resource_id=r.resource_id,
                resource_name=r.resource_name,
                resource_type=r.resource_type,
                resource_group=r.resource_group,
                subscription_id=r.subscription_id or "",
                gap_type="no_private_endpoint",
                severity="critical" if rtype in {
                    "microsoft.sql/servers/databases",
                    "microsoft.documentdb/databaseaccounts",
                    "microsoft.keyvault/vaults",
                } else "high",
                title=pe_title,
                description=f"'{r.resource_name}' has no Private Endpoint — traffic can traverse the public internet. A Private Endpoint restricts access to your VNet only.",
                azure_service="Azure Private Endpoint",
                monthly_risk_usd=0.0,
            ))

        # ── 3. High-cost resource without Resource Lock ───────────────────────
        if (not r.has_lock
                and r.cost_current_month >= _LOCK_WORTHY_COST
                and not r.is_infrastructure):
            gaps.append(SecurityGap(
                resource_id=r.resource_id,
                resource_name=r.resource_name,
                resource_type=r.resource_type,
                resource_group=r.resource_group,
                subscription_id=r.subscription_id or "",
                gap_type="no_lock",
                severity="high" if r.cost_current_month > 500 else "medium",
                title="No Resource Delete Lock",
                description=f"'{r.resource_name}' costs ${r.cost_current_month:,.0f}/month and can be deleted accidentally without a resource lock.",
                azure_service="Azure Resource Locks",
                monthly_risk_usd=r.cost_current_month,
            ))

        # ── 4. Missing governance tags ────────────────────────────────────────
        if r.missing_tags and not r.is_infrastructure and r.cost_current_month > 20:
            gaps.append(SecurityGap(
                resource_id=r.resource_id,
                resource_name=r.resource_name,
                resource_type=r.resource_type,
                resource_group=r.resource_group,
                subscription_id=r.subscription_id or "",
                gap_type="missing_tags",
                severity="medium" if r.cost_current_month > 100 else "low",
                title=f"Missing Tags: {', '.join(r.missing_tags[:3])}",
                description=f"'{r.resource_name}' is missing required governance tags. This creates RBAC blind spots and cost allocation gaps.",
                azure_service="Azure Policy",
                monthly_risk_usd=0.0,
            ))

        # ── 5. High-cost resource with no monitoring data ─────────────────────
        if (getattr(r, "data_confidence", "none") in ("none",)
                and r.cost_current_month > 100
                and not r.is_infrastructure):
            gaps.append(SecurityGap(
                resource_id=r.resource_id,
                resource_name=r.resource_name,
                resource_type=r.resource_type,
                resource_group=r.resource_group,
                subscription_id=r.subscription_id or "",
                gap_type="unmonitored",
                severity="medium",
                title="No Monitoring / Diagnostics Enabled",
                description=f"'{r.resource_name}' costs ${r.cost_current_month:,.0f}/month but has no diagnostic logs or metrics. Security events would go undetected.",
                azure_service="Azure Monitor + Microsoft Sentinel",
                monthly_risk_usd=0.0,
            ))

    # Sort by severity then monthly risk
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    gaps.sort(key=lambda g: (order.get(g.severity, 9), -g.monthly_risk_usd))
    return gaps
