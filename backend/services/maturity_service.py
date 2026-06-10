"""
maturity_service.py — Cloud Maturity Index.

Computes a 5-dimension cloud maturity score from the scanned resource landscape
and existing WAF/security data, producing a consultant-grade maturity assessment.
"""
from __future__ import annotations
import logging
from datetime import datetime, timezone
from typing import List, Optional
from models.schemas import (
    ResourceMetrics, SecurityGap, WAFScorecard,
    MaturityDimension, CloudMaturityScore,
)

logger = logging.getLogger(__name__)


def _grade(score: float) -> str:
    if score >= 85: return "A"
    if score >= 70: return "B"
    if score >= 55: return "C"
    if score >= 40: return "D"
    return "F"


def _color(score: float) -> str:
    if score >= 70: return "#22c55e"
    if score >= 50: return "#eab308"
    if score >= 35: return "#f97316"
    return "#ef4444"


def _normalise_type(t: str) -> str:
    return t.lower().strip()


# ── Dimension scoring helpers ──────────────────────────────────────────────────

def _score_iaas_modernization(resources: List[ResourceMetrics]) -> MaturityDimension:
    """What fraction of workloads are on PaaS/managed services vs raw IaaS?"""
    PAAS_TYPES = {
        "microsoft.web/sites",
        "microsoft.web/serverfarms",
        "microsoft.app/containerapps",
        "microsoft.app/managedenvironments",
        "microsoft.containerservice/managedclusters",
        "microsoft.sql/servers/databases",
        "microsoft.sql/managedinstances",
        "microsoft.dbformysql/flexibleservers",
        "microsoft.dbforpostgresql/flexibleservers",
        "microsoft.logic/workflows",
        "microsoft.cognitiveservices/accounts",
        "microsoft.machinelearningservices/workspaces",
    }
    IAAS_TYPES = {
        "microsoft.compute/virtualmachines",
        "microsoft.compute/virtualmachinescalesets",
    }

    paas_count = sum(1 for r in resources if _normalise_type(r.resource_type) in PAAS_TYPES)
    iaas_count = sum(1 for r in resources if _normalise_type(r.resource_type) in IAAS_TYPES)
    compute_total = paas_count + iaas_count

    if compute_total == 0:
        score = 50.0  # neutral — no compute workloads to assess
    else:
        raw = paas_count / compute_total * 100
        # Scale: 0 PaaS = 10, 100% PaaS = 95
        score = max(10.0, min(95.0, 10 + raw * 0.85))

    gaps, recs = [], []
    if iaas_count > paas_count:
        gaps.append(f"{iaas_count} IaaS VMs vs {paas_count} PaaS services — high dependency on unmanaged infrastructure")
        recs.append("Migrate web workloads to Azure App Service or Container Apps")
        recs.append("Consolidate databases onto Azure SQL or PostgreSQL Flexible Server")
    if iaas_count > 0:
        recs.append("Use Azure Migrate to assess VM suitability for PaaS migration")

    return MaturityDimension(
        key="iaas_modernization",
        name="IaaS Modernisation",
        score=round(score, 1),
        grade=_grade(score),
        color=_color(score),
        description="Ratio of PaaS / managed services vs raw IaaS (VMs) across all compute workloads.",
        gaps=gaps,
        recommendations=recs,
    )


def _score_ai_innovation(resources: List[ResourceMetrics]) -> MaturityDimension:
    """Adoption of AI, ML, data, and analytics services."""
    AI_TYPES = {
        "microsoft.cognitiveservices/accounts",
        "microsoft.machinelearningservices/workspaces",
        "microsoft.openai/accounts",
        "microsoft.search/searchservices",
        "microsoft.synapse/workspaces",
        "microsoft.databricks/workspaces",
        "microsoft.datafactory/factories",
        "microsoft.purview/accounts",
        "microsoft.kusto/clusters",
    }
    ai_count = sum(1 for r in resources if _normalise_type(r.resource_type) in AI_TYPES)

    if ai_count == 0:
        score = 5.0
        gaps = ["No AI, ML, or analytics services found"]
        recs = [
            "Start with Azure OpenAI Service for a generative AI proof-of-concept",
            "Use Azure AI Search to add semantic search over existing data",
            "Explore Microsoft Fabric for unified data analytics",
        ]
    elif ai_count < 3:
        score = 35.0
        gaps = ["AI/analytics adoption is nascent — limited to 1–2 services"]
        recs = [
            "Expand to Azure Machine Learning for MLOps pipelines",
            "Add Azure AI Search for RAG over enterprise data",
        ]
    elif ai_count < 6:
        score = 65.0
        gaps = ["Good AI foundation — opportunity to expand to full MLOps and real-time analytics"]
        recs = ["Integrate Azure Purview for AI-ready data governance"]
    else:
        score = 90.0
        gaps = []
        recs = ["Consider Microsoft Copilot Studio to surface AI capabilities as business user copilots"]

    return MaturityDimension(
        key="ai_innovation",
        name="AI & Innovation",
        score=round(score, 1),
        grade=_grade(score),
        color=_color(score),
        description="Adoption of Azure AI, Machine Learning, analytics, and data platform services.",
        gaps=gaps,
        recommendations=recs,
    )


def _score_devops_automation(resources: List[ResourceMetrics]) -> MaturityDimension:
    """DevOps tooling, infrastructure automation, and CI/CD readiness."""
    DEVOPS_TYPES = {
        "microsoft.automation/automationaccounts",
        "microsoft.devtestlabs/labs",
        "microsoft.containerregistry/registries",
        "microsoft.app/containerapps",
        "microsoft.containerservice/managedclusters",
        "microsoft.logic/workflows",
        "microsoft.eventhub/namespaces",
        "microsoft.servicebus/namespaces",
    }
    count = sum(1 for r in resources if _normalise_type(r.resource_type) in DEVOPS_TYPES)
    total = max(len(resources), 1)

    # DevOps score: based on presence of automation tooling + ratio of modern resource types
    has_containers = any(_normalise_type(r.resource_type) in {
        "microsoft.containerservice/managedclusters",
        "microsoft.app/containerapps",
        "microsoft.containerregistry/registries",
    } for r in resources)
    has_automation = any(_normalise_type(r.resource_type) == "microsoft.automation/automationaccounts"
                         for r in resources)
    has_messaging   = any(_normalise_type(r.resource_type) in {
        "microsoft.eventhub/namespaces", "microsoft.servicebus/namespaces"
    } for r in resources)

    base = (int(has_containers) * 35 + int(has_automation) * 20 + int(has_messaging) * 15
            + min(count, 5) * 5)
    score = min(95.0, float(base))
    if score < 15:
        score = 15.0

    gaps, recs = [], []
    if not has_containers:
        gaps.append("No container or Kubernetes workloads — CI/CD practices limited")
        recs.append("Adopt Azure Container Apps or AKS for containerised deployment pipelines")
    if not has_automation:
        gaps.append("No Azure Automation — manual runbooks and patching")
        recs.append("Create Azure Automation runbooks for patching, backup, and compliance checks")
    if not has_messaging:
        gaps.append("No event-driven messaging layer (Event Hubs / Service Bus)")
        recs.append("Introduce Service Bus for decoupled, resilient inter-service communication")

    return MaturityDimension(
        key="devops_automation",
        name="DevOps & Automation",
        score=round(score, 1),
        grade=_grade(score),
        color=_color(score),
        description="Presence of DevOps tooling, automation accounts, containers, and event-driven infrastructure.",
        gaps=gaps,
        recommendations=recs,
    )


def _score_security_governance(
    resources: List[ResourceMetrics],
    security_gaps: List[SecurityGap],
    waf: Optional[WAFScorecard],
) -> MaturityDimension:
    """Security posture based on WAF Security pillar and detected gaps."""
    # Use WAF Security pillar if available
    if waf:
        waf_sec = next((p for p in waf.pillars if p.pillar == "Security"), None)
        if waf_sec:
            base_score = waf_sec.score
            gaps  = list(waf_sec.gaps)
            recs  = list(waf_sec.recommendations)
            # Penalise for volume of critical/high gaps
            critical = sum(1 for g in security_gaps if g.severity in ("critical", "high"))
            penalty  = min(20, critical * 2)
            score    = max(5.0, base_score - penalty)
            return MaturityDimension(
                key="security_governance",
                name="Security & Governance",
                score=round(score, 1),
                grade=_grade(score),
                color=_color(score),
                description="Security posture from WAF Security pillar, resource protection, and governance gap analysis.",
                gaps=gaps[:5],
                recommendations=recs[:5],
            )

    # Fallback: compute from raw gaps
    total = len(resources)
    if total == 0:
        score = 50.0
    else:
        gap_pct = len(security_gaps) / total
        score   = max(5.0, min(90.0, (1 - gap_pct) * 80 + 10))

    critical = sum(1 for g in security_gaps if g.severity in ("critical", "high"))
    gaps_txt = [f"{critical} critical/high severity gaps found"] if critical else []
    recs     = [
        "Enable Microsoft Defender for Cloud to get a unified Secure Score",
        "Add resource locks to production resources to prevent accidental deletion",
        "Enforce private endpoints for storage accounts and databases",
    ]
    return MaturityDimension(
        key="security_governance",
        name="Security & Governance",
        score=round(score, 1),
        grade=_grade(score),
        color=_color(score),
        description="Security posture based on resource protection, governance gaps, and compliance signals.",
        gaps=gaps_txt,
        recommendations=recs,
    )


def _score_operational_excellence(resources: List[ResourceMetrics]) -> MaturityDimension:
    """Operational excellence — monitoring, tagging, backup, and SLA coverage."""
    if not resources:
        return MaturityDimension(
            key="operational_excellence",
            name="Operational Excellence",
            score=50.0, grade="C", color=_color(50),
            description="Tag compliance, backup coverage, monitoring, and resource hygiene.",
            gaps=[], recommendations=[],
        )

    has_monitoring = any(_normalise_type(r.resource_type) in {
        "microsoft.insights/components",
        "microsoft.operationalinsights/workspaces",
    } for r in resources)

    backup_count   = sum(1 for r in resources if r.has_backup)
    lock_count     = sum(1 for r in resources if r.has_lock)
    tagged_count   = sum(1 for r in resources if not r.missing_tags)
    total          = len(resources)

    backup_pct  = backup_count  / total * 100
    lock_pct    = lock_count    / total * 100
    tagged_pct  = tagged_count  / total * 100
    monitor_pts = 20 if has_monitoring else 0

    score = monitor_pts + backup_pct * 0.30 + lock_pct * 0.20 + tagged_pct * 0.30
    score = max(5.0, min(95.0, score))

    gaps, recs = [], []
    if not has_monitoring:
        gaps.append("No Log Analytics or Application Insights workspace found")
        recs.append("Deploy a Log Analytics Workspace and connect resources for centralised logging")
    if backup_pct < 50:
        gaps.append(f"Only {backup_pct:.0f}% of resources protected by Azure Backup")
        recs.append("Extend Azure Backup policy to cover all production VMs and databases")
    if tagged_pct < 60:
        gaps.append(f"Only {tagged_pct:.0f}% of resources are fully tagged")
        recs.append("Enforce required tags (Owner, Environment, CostCenter) via Azure Policy")
    if lock_pct < 30:
        gaps.append(f"Only {lock_pct:.0f}% of resources have delete/read-only locks")
        recs.append("Apply CanNotDelete locks to all production resource groups")

    return MaturityDimension(
        key="operational_excellence",
        name="Operational Excellence",
        score=round(score, 1),
        grade=_grade(score),
        color=_color(score),
        description="Monitoring coverage, backup protection, tagging compliance, and resource lock coverage.",
        gaps=gaps,
        recommendations=recs,
    )


# ── Main entry-point ───────────────────────────────────────────────────────────

def compute_cloud_maturity(
    resources:      List[ResourceMetrics],
    security_gaps:  List[SecurityGap]   = None,
    waf:            Optional[WAFScorecard] = None,
) -> CloudMaturityScore:
    """
    Returns a CloudMaturityScore with 5 dimensions and an overall label.
    """
    security_gaps = security_gaps or []

    dimensions = [
        _score_iaas_modernization(resources),
        _score_ai_innovation(resources),
        _score_devops_automation(resources),
        _score_security_governance(resources, security_gaps, waf),
        _score_operational_excellence(resources),
    ]

    # Weighted average: IaaS mod 20, AI 20, DevOps 20, Security 25, OpEx 15
    weights = [0.20, 0.20, 0.20, 0.25, 0.15]
    overall = sum(d.score * w for d, w in zip(dimensions, weights))
    overall = round(overall, 1)

    if overall >= 80:
        label = "Cloud Native"
    elif overall >= 65:
        label = "Cloud Smart"
    elif overall >= 50:
        label = "Cloud Ready"
    elif overall >= 35:
        label = "Cloud Aware"
    else:
        label = "Traditional IT"

    return CloudMaturityScore(
        overall_score=overall,
        overall_grade=_grade(overall),
        overall_label=label,
        dimensions=dimensions,
        generated_at=datetime.now(tz=timezone.utc).isoformat(),
    )
