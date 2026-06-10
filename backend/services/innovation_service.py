"""
innovation_service.py — Azure service adoption gap analysis.

Analyses scanned resources and identifies which Azure service categories are missing
or under-adopted, turning each gap into a named modernisation / upsell opportunity.
"""
from __future__ import annotations
import logging
from typing import List
from models.schemas import ResourceMetrics, InnovationGap, ServiceAdoptionScore

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Category definitions
# Each entry describes one Azure innovation domain.
# ---------------------------------------------------------------------------
CATEGORIES: list[dict] = [
    {
        "key": "ai_ml",
        "name": "AI & Machine Learning",
        "icon": "🤖",
        "resource_types": [
            "microsoft.cognitiveservices/accounts",
            "microsoft.machinelearningservices/workspaces",
            "microsoft.openai/accounts",
            "microsoft.search/searchservices",
            "microsoft.botservice/botservices",
        ],
        "description": "Azure AI Services, Azure OpenAI, Machine Learning, and AI-powered search — build intelligent applications without deep ML expertise.",
        "opportunity": (
            "No AI or ML workloads detected. Azure OpenAI and Azure AI Services can unlock "
            "intelligent automation, Copilot experiences, RAG applications, and document intelligence "
            "— areas where customers are actively investing in 2025–2026."
        ),
        "azure_services": [
            "Azure OpenAI Service",
            "Azure AI Services (Cognitive Services)",
            "Azure Machine Learning",
            "Azure AI Search (vector RAG)",
            "Azure Document Intelligence",
        ],
        "business_impact": "High",
        "estimated_effort": "Medium",
        "recommendation_detail": (
            "Start with Azure OpenAI or a pre-built Cognitive Services API to demonstrate immediate value. "
            "Layer Azure AI Search for RAG over existing data stores. "
            "A typical first AI project takes 4–8 weeks with a single team."
        ),
    },
    {
        "key": "containers",
        "name": "Containers & Kubernetes",
        "icon": "📦",
        "resource_types": [
            "microsoft.containerservice/managedclusters",
            "microsoft.app/containerapps",
            "microsoft.containerregistry/registries",
        ],
        "description": "AKS, Azure Container Apps, and Azure Container Registry — the foundation for cloud-native microservices and DevOps.",
        "opportunity": (
            "No containerised workloads found. Moving from VMs to containers reduces infrastructure cost "
            "by 30–60%, enables zero-downtime deployments, and is a prerequisite for modern DevOps practices."
        ),
        "azure_services": [
            "Azure Kubernetes Service (AKS)",
            "Azure Container Apps",
            "Azure Container Registry",
            "Azure Service Mesh (Istio add-on)",
        ],
        "business_impact": "High",
        "estimated_effort": "Medium",
        "recommendation_detail": (
            "Azure Container Apps is the fastest on-ramp — no Kubernetes expertise required, "
            "scales to zero, and integrates with Dapr for microservices patterns. "
            "AKS is the right choice for teams that need full orchestration control."
        ),
    },
    {
        "key": "serverless",
        "name": "Serverless & Event-Driven",
        "icon": "⚡",
        "resource_types": [
            "microsoft.logic/workflows",
            "microsoft.eventgrid/topics",
            "microsoft.eventgrid/domains",
            "microsoft.servicebus/namespaces",
            "microsoft.eventhub/namespaces",
        ],
        "description": "Azure Functions, Logic Apps, Event Grid, Service Bus — event-driven compute that scales to zero and eliminates VM management overhead.",
        "opportunity": (
            "Limited event-driven and serverless patterns. Serverless architectures reduce operational burden, "
            "pay only for execution time (often >80% cheaper than equivalent VMs), "
            "and enable rapid integration of disparate systems."
        ),
        "azure_services": [
            "Azure Functions (Flex Consumption plan)",
            "Azure Logic Apps (Standard)",
            "Azure Event Grid",
            "Azure Service Bus",
            "Azure Event Hubs",
        ],
        "business_impact": "Medium",
        "estimated_effort": "Low",
        "recommendation_detail": (
            "Azure Functions Flex Consumption plan (GA 2024) offers dynamic scaling and per-second billing. "
            "Logic Apps Standard integrates 1,000+ connectors with built-in state management. "
            "Both services can be deployed from VS Code in under an hour."
        ),
    },
    {
        "key": "data_analytics",
        "name": "Data & Analytics Platform",
        "icon": "📊",
        "resource_types": [
            "microsoft.synapse/workspaces",
            "microsoft.databricks/workspaces",
            "microsoft.datafactory/factories",
            "microsoft.kusto/clusters",
            "microsoft.purview/accounts",
        ],
        "description": "Azure Synapse, Databricks, Data Factory, Microsoft Fabric — a unified data platform for analytics, AI-ready pipelines, and business intelligence.",
        "opportunity": (
            "No modern analytics platform detected. A unified data platform enables business intelligence, "
            "self-service analytics, and AI-ready data pipelines — often replacing on-premises data warehouses "
            "at lower cost with better performance."
        ),
        "azure_services": [
            "Microsoft Fabric (unified analytics)",
            "Azure Synapse Analytics",
            "Azure Databricks",
            "Azure Data Factory",
            "Azure Purview (data governance)",
        ],
        "business_impact": "High",
        "estimated_effort": "High",
        "recommendation_detail": (
            "Microsoft Fabric unifies data engineering, warehousing, and BI in one SaaS experience. "
            "It directly competes with Snowflake and Databricks at a compelling TCO. "
            "An Azure Data Factory proof-of-concept pipeline can demonstrate ROI within two weeks."
        ),
    },
    {
        "key": "devops_automation",
        "name": "DevOps & Infrastructure Automation",
        "icon": "🔧",
        "resource_types": [
            "microsoft.automation/automationaccounts",
            "microsoft.devtestlabs/labs",
            "microsoft.devhub/iovirtualnetworks",
        ],
        "description": "Azure DevOps, Automation Accounts, GitHub Actions — consistent, auditable deployments and automated operational runbooks.",
        "opportunity": (
            "No automation infrastructure detected. Manual deployments increase risk, slow delivery, "
            "and raise operational cost. Azure DevOps + Automation Accounts can cut deployment time "
            "by 70% and eliminate manual patching toil."
        ),
        "azure_services": [
            "Azure DevOps (Pipelines + Boards)",
            "GitHub Actions with Azure integration",
            "Azure Automation (runbooks + DSC)",
            "Azure Arc (hybrid management)",
            "Bicep / Terraform for IaC",
        ],
        "business_impact": "Medium",
        "estimated_effort": "Medium",
        "recommendation_detail": (
            "Azure DevOps starter projects provision a pipeline in minutes. "
            "Pair with Bicep IaC templates for immutable, reproducible environments. "
            "Azure Arc extends management to on-premises or multi-cloud resources."
        ),
    },
    {
        "key": "monitoring_observability",
        "name": "Monitoring & Observability",
        "icon": "📡",
        "resource_types": [
            "microsoft.insights/components",
            "microsoft.operationalinsights/workspaces",
            "microsoft.insights/metricalerts",
            "microsoft.dashboard/grafana",
        ],
        "description": "Application Insights, Log Analytics, Azure Monitor — end-to-end observability from infrastructure to application code.",
        "opportunity": (
            "Limited observability tooling. Without Application Insights and Log Analytics, "
            "incidents go undetected for longer and root-cause analysis is time-consuming — "
            "directly impacting SLA compliance and customer trust."
        ),
        "azure_services": [
            "Application Insights",
            "Log Analytics Workspace",
            "Azure Monitor (Alerts + Dashboards)",
            "Azure Managed Grafana",
            "Microsoft Sentinel (SIEM/SOAR)",
        ],
        "business_impact": "High",
        "estimated_effort": "Low",
        "recommendation_detail": (
            "Application Insights can be added to existing App Services with one toggle in the Azure Portal. "
            "Log Analytics centralises VM and container logs with KQL query support. "
            "Both can be set up in a day and provide immediate visibility."
        ),
    },
    {
        "key": "security_posture",
        "name": "Advanced Security & Zero Trust",
        "icon": "🔐",
        "resource_types": [
            "microsoft.keyvault/vaults",
            "microsoft.network/applicationgateways",
            "microsoft.network/azurefirewalls",
            "microsoft.security/automations",
            "microsoft.network/frontdoors",
        ],
        "description": "Key Vault, Application Gateway WAF, Azure Firewall, Defender for Cloud — Zero Trust network and identity security.",
        "opportunity": (
            "Security posture can be materially improved. Without centralised secrets management, "
            "WAF, and network segmentation, the attack surface is unnecessarily large. "
            "Microsoft Defender for Cloud provides immediate risk quantification."
        ),
        "azure_services": [
            "Azure Key Vault (secrets + certificates)",
            "Application Gateway with WAF v2",
            "Azure Firewall Premium",
            "Microsoft Defender for Cloud",
            "Microsoft Entra ID (PIM + Conditional Access)",
        ],
        "business_impact": "High",
        "estimated_effort": "Low",
        "recommendation_detail": (
            "Key Vault replaces hard-coded secrets in minutes. "
            "Defender for Cloud Free tier activates immediately and shows a Secure Score with prioritised fixes. "
            "These two alone reduce breach risk significantly with minimal cost."
        ),
    },
    {
        "key": "global_delivery",
        "name": "Global Delivery & Resilience",
        "icon": "🌐",
        "resource_types": [
            "microsoft.cdn/profiles",
            "microsoft.network/frontdoors",
            "microsoft.network/trafficmanagerprofiles",
        ],
        "description": "Azure Front Door, CDN, Traffic Manager — low-latency global delivery, geo-redundancy, and DDoS protection.",
        "opportunity": (
            "No global traffic management or CDN layer. Customers with global users or SLA requirements "
            "benefit significantly from Azure Front Door for origin shielding, automatic failover, "
            "and integrated WAF at the edge — without changing application code."
        ),
        "azure_services": [
            "Azure Front Door (Standard/Premium)",
            "Azure CDN",
            "Azure Traffic Manager",
            "Azure DDoS Protection Standard",
        ],
        "business_impact": "Medium",
        "estimated_effort": "Low",
        "recommendation_detail": (
            "Azure Front Door Standard can be provisioned in 30 minutes and immediately reduces "
            "origin load via edge caching. It also provides built-in bot protection and WAF rules. "
            "Upgrade to Premium for Private Link origins (zero public IP exposure)."
        ),
    },
]


def _normalise_type(t: str) -> str:
    return t.lower().strip()


def detect_innovation_gaps(
    resources: List[ResourceMetrics],
) -> tuple[List[InnovationGap], List[ServiceAdoptionScore]]:
    """
    Returns (innovation_gaps, service_adoption_scores).

    innovation_gaps  — categories with zero or minimal adoption
    service_adoption — all categories with adopted/partial/absent status
    """
    # Build a set of all present resource types (lowercase)
    present_types: set[str] = {_normalise_type(r.resource_type) for r in resources}

    innovation_gaps: List[InnovationGap]        = []
    adoption_scores: List[ServiceAdoptionScore] = []

    for cat in CATEGORIES:
        cat_types = [_normalise_type(t) for t in cat["resource_types"]]
        matching  = [t for t in cat_types if t in present_types]
        count     = sum(1 for r in resources if _normalise_type(r.resource_type) in set(cat_types))

        adopted = len(matching) >= 2
        partial = len(matching) == 1

        adoption_scores.append(ServiceAdoptionScore(
            category=cat["name"],
            category_key=cat["key"],
            icon=cat["icon"],
            adopted=adopted,
            partial=partial,
            resource_count=count,
            resource_types_present=matching,
        ))

        if not adopted:
            status = "partially_adopted" if partial else "not_adopted"
            innovation_gaps.append(InnovationGap(
                category=cat["name"],
                category_key=cat["key"],
                icon=cat["icon"],
                status=status,
                description=cat["description"],
                opportunity=cat["opportunity"],
                azure_services=cat["azure_services"],
                business_impact=cat["business_impact"],
                estimated_effort=cat["estimated_effort"],
                current_resource_count=count,
                recommendation_detail=cat.get("recommendation_detail", ""),
            ))

    # Sort: High impact first, then Medium
    _impact_order = {"High": 0, "Medium": 1, "Low": 2}
    innovation_gaps.sort(key=lambda g: _impact_order.get(g.business_impact, 9))

    return innovation_gaps, adoption_scores
