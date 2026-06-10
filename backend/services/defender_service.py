"""
Microsoft Defender for Cloud — Comprehensive Security Posture Service.

Pulls ALL security data available via Azure Resource Graph securityresources table:
- Defender for Cloud Secure Score (overall + per-subscription)
- Security Assessments / Recommendations (unhealthy findings)
- Defender Plan Status (per-subscription per-service enablement)
- Security Alerts (active threat detections)
- Regulatory Compliance (standards + controls + failed assessments)
- Sub-Assessments (vulnerability findings on servers, SQL, containers)
- Azure Advisor Security Recommendations
- Secure Score Controls (improvement actions)

Defender Plans covered:
- Microsoft Defender for Servers
- Microsoft Defender for Storage
- Microsoft Defender for SQL
- Microsoft Defender for Cosmos DB
- Microsoft Defender for App Service
- Microsoft Defender for Key Vault
- Microsoft Defender for Resource Manager
- Microsoft Defender for DNS
- Microsoft Defender for Containers
- Microsoft Defender for APIs
"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional
from collections import Counter

from .resource_graph_service import query_resource_graph
from .azure_auth import get_subscription_ids

logger = logging.getLogger(__name__)

# ── In-memory TTL cache for full security posture (15 minutes) ────────────────
_SECURITY_CACHE_TTL = 900  # 15 minutes
_security_cache: Dict[str, Any] = {}  # key -> {"data": ..., "ts": float}


# ══════════════════════════════════════════════════════════════════════════════════
# RESOURCE GRAPH KQL QUERIES
# ══════════════════════════════════════════════════════════════════════════════════

# ── 1. Unhealthy Assessments (Recommendations) ───────────────────────────────

_DEFENDER_ASSESSMENTS_KQL = """
securityresources
| where type == "microsoft.security/assessments"
| where properties.status.code == "Unhealthy"
| extend
    assessmentName = name,
    displayName = tostring(properties.displayName),
    description = tostring(properties.status.description),
    severity = tostring(properties.metadata.severity),
    category = tostring(properties.metadata.categories[0]),
    resourceId = tostring(properties.resourceDetails.Id),
    resourceSource = tostring(properties.resourceDetails.Source),
    statusCode = tostring(properties.status.code),
    statusCause = tostring(properties.status.cause),
    implementationEffort = tostring(properties.metadata.implementationEffort),
    userImpact = tostring(properties.metadata.userImpact),
    threats = tostring(properties.metadata.threats),
    remediationDescription = tostring(properties.metadata.remediationDescription),
    policyDefinitionId = tostring(properties.metadata.policyDefinitionId),
    assessmentType = tostring(properties.metadata.assessmentType)
| project assessmentName, displayName, description, severity, category,
          resourceId, resourceSource, statusCode, statusCause,
          implementationEffort, userImpact, threats, remediationDescription,
          policyDefinitionId, assessmentType, subscriptionId, resourceGroup=resourceGroup
"""

# ── 2. Secure Score (Overall) ────────────────────────────────────────────────

_DEFENDER_SECURE_SCORE_KQL = """
securityresources
| where type == "microsoft.security/securescores"
| where name == "ascScore"
| extend
    currentScore = todouble(properties.score.current),
    maxScore = todouble(properties.score.max),
    percentage = todouble(properties.score.percentage),
    weight = toint(properties.weight)
| project subscriptionId, currentScore, maxScore, percentage, weight
"""

# ── 3. Secure Score Controls (Improvement Actions) ──────────────────────────

_DEFENDER_SCORE_CONTROLS_KQL = """
securityresources
| where type == "microsoft.security/securescores/securescorecontrols"
| extend
    controlName = tostring(properties.displayName),
    controlKey = name,
    currentScore = todouble(properties.score.current),
    maxScore = todouble(properties.score.max),
    percentage = todouble(properties.score.percentage),
    healthyCount = toint(properties.healthyResourceCount),
    unhealthyCount = toint(properties.unhealthyResourceCount),
    notApplicableCount = toint(properties.notApplicableResourceCount),
    weight = toint(properties.weight)
| where unhealthyCount > 0
| project subscriptionId, controlName, controlKey, currentScore, maxScore, percentage,
          healthyCount, unhealthyCount, notApplicableCount, weight
| order by unhealthyCount desc
"""

# ── 4. Defender Plan Pricing/Status ──────────────────────────────────────────

_DEFENDER_PRICING_KQL = """
securityresources
| where type == "microsoft.security/pricings"
| extend
    planName = name,
    pricingTier = tostring(properties.pricingTier),
    freeTrialRemaining = tostring(properties.freeTrialRemainingTime),
    subPlan = tostring(properties.subPlan),
    enablementStatus = tostring(properties.enablementStatus)
| project subscriptionId, planName, pricingTier, freeTrialRemaining, subPlan, enablementStatus
"""

# ── 5. Security Alerts ───────────────────────────────────────────────────────

_SECURITY_ALERTS_KQL = """
securityresources
| where type == "microsoft.security/locations/alerts"
| where properties.status == "Active"
| extend
    alertName = name,
    displayName = tostring(properties.alertDisplayName),
    description = tostring(properties.description),
    severity = tostring(properties.severity),
    status = tostring(properties.status),
    alertType = tostring(properties.alertType),
    compromisedEntity = tostring(properties.compromisedEntity),
    intent = tostring(properties.intent),
    startTime = tostring(properties.startTimeUtc),
    endTime = tostring(properties.endTimeUtc),
    resourceId = tostring(properties.resourceIdentifiers[0].azureResourceId),
    vendorName = tostring(properties.vendorName),
    productName = tostring(properties.productName),
    techniques = tostring(properties.techniques),
    tactics = tostring(properties.extendedProperties.Tactics)
| project alertName, displayName, description, severity, status, alertType,
          compromisedEntity, intent, startTime, endTime, resourceId,
          vendorName, productName, techniques, tactics,
          subscriptionId, resourceGroup=resourceGroup
| order by severity asc, startTime desc
"""

# ── 6. Regulatory Compliance Standards ───────────────────────────────────────

_REGULATORY_STANDARDS_KQL = """
securityresources
| where type == "microsoft.security/regulatorycompliancestandards"
| extend
    standardName = name,
    state = tostring(properties.state),
    passedControls = toint(properties.passedControls),
    failedControls = toint(properties.failedControls),
    skippedControls = toint(properties.skippedControls),
    unsupportedControls = toint(properties.unsupportedControls)
| project subscriptionId, standardName, state, passedControls, failedControls,
          skippedControls, unsupportedControls
"""

# ── 7. Regulatory Compliance Controls (Failed) ──────────────────────────────

_REGULATORY_CONTROLS_KQL = """
securityresources
| where type == "microsoft.security/regulatorycompliancestandards/regulatorycompliancecontrols"
| where properties.state == "Failed"
| extend
    standardId = tostring(split(id, "/regulatoryComplianceControls/")[0]),
    controlId = name,
    controlName = tostring(properties.description),
    state = tostring(properties.state),
    passedAssessments = toint(properties.passedAssessments),
    failedAssessments = toint(properties.failedAssessments),
    skippedAssessments = toint(properties.skippedAssessments)
| project subscriptionId, standardId, controlId, controlName, state,
          passedAssessments, failedAssessments, skippedAssessments
| order by failedAssessments desc
| limit 200
"""

# ── 8. Sub-Assessments (Vulnerability Findings) ─────────────────────────────

_SUB_ASSESSMENT_KQL = """
securityresources
| where type == "microsoft.security/assessments/subassessments"
| extend
    parentAssessment = tostring(split(id, "/subAssessments/")[0]),
    displayName = tostring(properties.displayName),
    description = tostring(properties.description),
    severity = tostring(properties.status.severity),
    statusCode = tostring(properties.status.code),
    resourceId = tostring(properties.resourceDetails.id),
    category = tostring(properties.category),
    remediation = tostring(properties.remediation),
    impact = tostring(properties.impact),
    cve = tostring(properties.additionalData.cve)
| where statusCode == "Unhealthy"
| project displayName, description, severity, statusCode, resourceId,
          category, remediation, impact, cve, subscriptionId
| limit 1000
"""

# ── 9. Azure Advisor Security Recommendations ────────────────────────────────

_ADVISOR_SECURITY_KQL = """
advisorresources
| where type == "microsoft.advisor/recommendations"
| where properties.category == "Security"
| extend
    displayName = tostring(properties.shortDescription.solution),
    problem = tostring(properties.shortDescription.problem),
    impact = tostring(properties.impact),
    resourceId = tostring(properties.resourceMetadata.resourceId),
    resourceType = tostring(properties.impactedField),
    lastUpdated = tostring(properties.lastUpdated),
    extendedProperties = properties.extendedProperties
| project id, displayName, problem, impact, resourceId, resourceType,
          lastUpdated, subscriptionId, resourceGroup=resourceGroup
"""

# ── 10. Software Inventory / Vulnerabilities ─────────────────────────────────

_SOFTWARE_VULNERABILITIES_KQL = """
securityresources
| where type == "microsoft.security/assessments/subassessments"
| where properties.category == "Vulnerability"
| extend
    displayName = tostring(properties.displayName),
    severity = tostring(properties.status.severity),
    statusCode = tostring(properties.status.code),
    resourceId = tostring(properties.resourceDetails.id),
    cveId = tostring(properties.id),
    patchable = tostring(properties.additionalData.patchable),
    vendorReferences = tostring(properties.additionalData.vendorReferences)
| where statusCode == "Unhealthy"
| summarize vulnCount=count() by severity, subscriptionId
| order by severity asc
"""


# ══════════════════════════════════════════════════════════════════════════════════
# DATA FETCHING FUNCTIONS
# ══════════════════════════════════════════════════════════════════════════════════

def get_defender_assessments(subscription_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Get all unhealthy Defender for Cloud assessments/recommendations."""
    try:
        results = query_resource_graph(_DEFENDER_ASSESSMENTS_KQL, subscription_ids)
        logger.info("Fetched %d Defender assessments", len(results))
        return results
    except Exception as e:
        logger.warning("Failed to fetch Defender assessments: %s", e)
        return []


def get_secure_score(subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Get Microsoft Defender Secure Score summary across all subscriptions."""
    try:
        results = query_resource_graph(_DEFENDER_SECURE_SCORE_KQL, subscription_ids)
        if results:
            total_current = sum(r.get("currentScore", 0) for r in results)
            total_max = sum(r.get("maxScore", 0) for r in results)
            avg_pct = (total_current / total_max * 100) if total_max > 0 else 0
            return {
                "current_score": round(total_current, 1),
                "max_score": round(total_max, 1),
                "percentage": round(avg_pct, 1),
                "subscription_scores": results,
            }
        return {"current_score": 0, "max_score": 0, "percentage": 0, "subscription_scores": []}
    except Exception as e:
        logger.warning("Failed to fetch secure score: %s", e)
        return {"current_score": 0, "max_score": 0, "percentage": 0, "subscription_scores": []}


def get_score_controls(subscription_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Get Defender Secure Score controls with unhealthy resource counts."""
    try:
        results = query_resource_graph(_DEFENDER_SCORE_CONTROLS_KQL, subscription_ids)
        logger.info("Fetched %d score controls", len(results))
        return results
    except Exception as e:
        logger.warning("Failed to fetch score controls: %s", e)
        return []


def get_defender_plans(subscription_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Get Defender plan enablement status per subscription (Defender for Servers, Storage, SQL etc.)."""
    try:
        results = query_resource_graph(_DEFENDER_PRICING_KQL, subscription_ids)
        logger.info("Fetched %d Defender plan statuses", len(results))
        return results
    except Exception as e:
        logger.warning("Failed to fetch Defender plans: %s", e)
        return []


def get_security_alerts(subscription_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Get active security alerts from Defender for Cloud."""
    try:
        results = query_resource_graph(_SECURITY_ALERTS_KQL, subscription_ids)
        logger.info("Fetched %d active security alerts", len(results))
        return results
    except Exception as e:
        logger.warning("Failed to fetch security alerts: %s", e)
        return []


def get_regulatory_standards(subscription_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Get regulatory compliance standards and their pass/fail status."""
    try:
        results = query_resource_graph(_REGULATORY_STANDARDS_KQL, subscription_ids)
        logger.info("Fetched %d regulatory standards", len(results))
        return results
    except Exception as e:
        logger.warning("Failed to fetch regulatory standards: %s", e)
        return []


def get_regulatory_controls(subscription_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Get failed regulatory compliance controls."""
    try:
        results = query_resource_graph(_REGULATORY_CONTROLS_KQL, subscription_ids)
        logger.info("Fetched %d failed regulatory controls", len(results))
        return results
    except Exception as e:
        logger.warning("Failed to fetch regulatory controls: %s", e)
        return []


def get_sub_assessments(subscription_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Get detailed sub-assessments (vulnerability findings, CVEs, etc.)."""
    try:
        results = query_resource_graph(_SUB_ASSESSMENT_KQL, subscription_ids)
        logger.info("Fetched %d sub-assessments", len(results))
        return results
    except Exception as e:
        logger.warning("Failed to fetch sub-assessments: %s", e)
        return []


def get_vulnerability_summary(subscription_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Get aggregated vulnerability counts by severity."""
    try:
        results = query_resource_graph(_SOFTWARE_VULNERABILITIES_KQL, subscription_ids)
        return results
    except Exception as e:
        logger.warning("Failed to fetch vulnerability summary: %s", e)
        return []


def get_advisor_security_recommendations(subscription_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Get Azure Advisor security recommendations."""
    try:
        results = query_resource_graph(_ADVISOR_SECURITY_KQL, subscription_ids)
        logger.info("Fetched %d Advisor security recommendations", len(results))
        return results
    except Exception as e:
        logger.warning("Failed to fetch Advisor security recommendations: %s", e)
        return []


# ══════════════════════════════════════════════════════════════════════════════════
# AGGREGATION & ANALYTICS
# ══════════════════════════════════════════════════════════════════════════════════

def _build_defender_plan_summary(plans: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Build a summary of Defender plan enablement across all subscriptions.
    Shows which plans are enabled (Standard) vs disabled (Free) per subscription.
    """
    PLAN_DISPLAY_NAMES = {
        "VirtualMachines": "Defender for Servers",
        "SqlServers": "Defender for SQL (Azure)",
        "SqlServerVirtualMachines": "Defender for SQL (on VMs)",
        "AppServices": "Defender for App Service",
        "StorageAccounts": "Defender for Storage",
        "KeyVaults": "Defender for Key Vault",
        "KubernetesService": "Defender for Containers",
        "ContainerRegistry": "Defender for Container Registry",
        "Dns": "Defender for DNS",
        "Arm": "Defender for Resource Manager",
        "OpenSourceRelationalDatabases": "Defender for Open-Source DBs",
        "CosmosDbs": "Defender for Cosmos DB",
        "Containers": "Defender for Containers",
        "CloudPosture": "Defender CSPM",
        "Api": "Defender for APIs",
    }

    plan_status = {}  # planName -> { enabled: count, disabled: count, subs: [...] }
    for p in plans:
        pname = p.get("planName", "Unknown")
        tier = p.get("pricingTier", "Free")
        sub_id = p.get("subscriptionId", "")

        if pname not in plan_status:
            plan_status[pname] = {"enabled": 0, "disabled": 0, "subscriptions": []}

        if tier.lower() == "standard":
            plan_status[pname]["enabled"] += 1
        else:
            plan_status[pname]["disabled"] += 1
        plan_status[pname]["subscriptions"].append({
            "subscription_id": sub_id,
            "tier": tier,
            "sub_plan": p.get("subPlan", ""),
        })

    # Build ordered list
    plan_list = []
    for pname, status in plan_status.items():
        total = status["enabled"] + status["disabled"]
        plan_list.append({
            "plan_key": pname,
            "plan_name": PLAN_DISPLAY_NAMES.get(pname, pname),
            "enabled_count": status["enabled"],
            "disabled_count": status["disabled"],
            "total_subscriptions": total,
            "coverage_pct": round(status["enabled"] / total * 100, 1) if total > 0 else 0,
            "status": "full" if status["disabled"] == 0 else ("partial" if status["enabled"] > 0 else "none"),
        })

    plan_list.sort(key=lambda x: (-x["coverage_pct"], x["plan_name"]))

    total_plans = len(plan_list)
    fully_enabled = sum(1 for p in plan_list if p["status"] == "full")
    partially_enabled = sum(1 for p in plan_list if p["status"] == "partial")

    return {
        "plans": plan_list,
        "total_plans": total_plans,
        "fully_enabled": fully_enabled,
        "partially_enabled": partially_enabled,
        "not_enabled": total_plans - fully_enabled - partially_enabled,
        "overall_coverage_pct": round(fully_enabled / total_plans * 100, 1) if total_plans > 0 else 0,
    }


def _build_charts_data(assessments: List[Dict], alerts: List[Dict],
                       controls: List[Dict], plans_summary: Dict) -> Dict[str, Any]:
    """
    Build chart-ready data for the frontend visualizations.
    """
    # Findings by severity (donut chart)
    sev_counts = Counter()
    for a in assessments:
        sev = (a.get("severity", "Medium") or "Medium")
        sev_counts[sev] += 1

    severity_chart = [
        {"name": "High", "value": sev_counts.get("High", 0), "color": "#ef4444"},
        {"name": "Medium", "value": sev_counts.get("Medium", 0), "color": "#eab308"},
        {"name": "Low", "value": sev_counts.get("Low", 0), "color": "#64748b"},
    ]

    # Findings by category (bar chart)
    cat_counts = Counter()
    for a in assessments:
        cat = a.get("category", "General") or "General"
        cat_counts[cat] += 1
    category_chart = [
        {"name": k, "value": v}
        for k, v in cat_counts.most_common(10)
    ]

    # Findings by resource type (bar chart)
    type_counts = Counter()
    for a in assessments:
        rid = a.get("resourceId", "")
        parts = rid.lower().split("/providers/")
        if len(parts) > 1:
            type_parts = parts[-1].split("/")
            if len(type_parts) >= 2:
                rtype = f"{type_parts[0]}/{type_parts[1]}"
                type_counts[rtype] += 1
    resource_type_chart = [
        {"name": k.split("/")[-1] if "/" in k else k, "fullType": k, "value": v}
        for k, v in type_counts.most_common(10)
    ]

    # Top affected resources (resources with most findings)
    resource_finding_counts = Counter()
    for a in assessments:
        rname = a.get("resourceId", "").split("/")[-1] if a.get("resourceId") else "Unknown"
        resource_finding_counts[rname] += 1
    top_resources_chart = [
        {"name": k[:25], "value": v}
        for k, v in resource_finding_counts.most_common(8)
    ]

    # Alerts by severity
    alert_sev = Counter()
    for al in alerts:
        sev = (al.get("severity", "Medium") or "Medium")
        alert_sev[sev] += 1
    alerts_chart = [
        {"name": "High", "value": alert_sev.get("High", 0), "color": "#ef4444"},
        {"name": "Medium", "value": alert_sev.get("Medium", 0), "color": "#eab308"},
        {"name": "Low", "value": alert_sev.get("Low", 0), "color": "#64748b"},
        {"name": "Informational", "value": alert_sev.get("Informational", 0), "color": "#38bdf8"},
    ]

    # Implementation effort distribution
    effort_counts = Counter()
    for a in assessments:
        effort = a.get("implementationEffort", "Moderate") or "Moderate"
        effort_counts[effort] += 1
    effort_chart = [
        {"name": k, "value": v}
        for k, v in effort_counts.most_common()
    ]

    # Controls progress (top 10 by unhealthy)
    controls_chart = [
        {
            "name": c.get("controlName", "")[:30],
            "healthy": c.get("healthyCount", 0),
            "unhealthy": c.get("unhealthyCount", 0),
            "pct": round(c.get("percentage", 0) * 100, 1) if c.get("percentage", 0) <= 1 else round(c.get("percentage", 0), 1),
        }
        for c in controls[:10]
    ]

    # Defender plan coverage chart
    plan_chart = [
        {
            "name": p["plan_name"][:20],
            "coverage": p["coverage_pct"],
            "status": p["status"],
        }
        for p in plans_summary.get("plans", [])[:12]
    ]

    return {
        "severity_distribution": severity_chart,
        "category_breakdown": category_chart,
        "resource_type_breakdown": resource_type_chart,
        "top_affected_resources": top_resources_chart,
        "alerts_by_severity": alerts_chart,
        "implementation_effort": effort_chart,
        "controls_progress": controls_chart,
        "defender_plan_coverage": plan_chart,
    }


# ══════════════════════════════════════════════════════════════════════════════════
# MAIN PUBLIC API
# ══════════════════════════════════════════════════════════════════════════════════

def get_full_security_posture(subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Pull the COMPLETE security posture from Defender for Cloud, Advisor, and all
    related security services. Returns a comprehensive dict for the frontend.
    
    Data sources:
    1. Secure Score (overall health metric)
    2. Security Assessments (unhealthy recommendations)
    3. Defender Plans (enablement status per service)
    4. Security Alerts (active threats)
    5. Regulatory Compliance (standards compliance)
    6. Vulnerability Findings (CVEs on servers/containers)
    7. Azure Advisor Security Recommendations
    8. Score Controls (improvement actions)
    """
    sub_ids = subscription_ids or get_subscription_ids()
    cache_key = ",".join(sorted(sub_ids)) if sub_ids else "__all__"

    # ── Check TTL cache first ──────────────────────────────────────────────────
    cached = _security_cache.get(cache_key)
    if cached and (time.monotonic() - cached["ts"]) < _SECURITY_CACHE_TTL:
        logger.info("security posture: returning cached result (age %.0fs)", time.monotonic() - cached["ts"])
        return cached["data"]

    # ── Parallel fetch — all 10 Resource Graph queries run concurrently ────────
    tasks = {
        "assessments":  lambda: get_defender_assessments(sub_ids),
        "secure_score": lambda: get_secure_score(sub_ids),
        "controls":     lambda: get_score_controls(sub_ids),
        "plans_raw":    lambda: get_defender_plans(sub_ids),
        "alerts":       lambda: get_security_alerts(sub_ids),
        "standards":    lambda: get_regulatory_standards(sub_ids),
        "reg_controls": lambda: get_regulatory_controls(sub_ids),
        "sub_assessments": lambda: get_sub_assessments(sub_ids),
        "vuln_summary": lambda: get_vulnerability_summary(sub_ids),
        "advisor_recs": lambda: get_advisor_security_recommendations(sub_ids),
    }
    results: Dict[str, Any] = {}
    with ThreadPoolExecutor(max_workers=10) as exe:
        futures = {exe.submit(fn): name for name, fn in tasks.items()}
        for future in as_completed(futures):
            name = futures[future]
            try:
                results[name] = future.result()
            except Exception as exc:
                logger.warning("security posture: task %s failed: %s", name, exc)
                results[name] = [] if name != "secure_score" else {"current_score": 0, "max_score": 0, "percentage": 0, "subscription_scores": []}

    assessments    = results["assessments"]
    secure_score   = results["secure_score"]
    controls       = results["controls"]
    plans_raw      = results["plans_raw"]
    alerts         = results["alerts"]
    standards      = results["standards"]
    reg_controls   = results["reg_controls"]
    sub_assessments = results["sub_assessments"]
    vuln_summary   = results["vuln_summary"]
    advisor_recs   = results["advisor_recs"]

    # ── Process Defender plans ──
    plans_summary = _build_defender_plan_summary(plans_raw)

    # ── Categorize assessments by severity ──
    severity_counts = {"High": 0, "Medium": 0, "Low": 0}
    for a in assessments:
        sev = a.get("severity", "Medium")
        if sev in severity_counts:
            severity_counts[sev] += 1

    # ── Process alerts ──
    alert_severity_counts = {"High": 0, "Medium": 0, "Low": 0, "Informational": 0}
    for al in alerts:
        sev = al.get("severity", "Medium")
        if sev in alert_severity_counts:
            alert_severity_counts[sev] += 1

    normalized_alerts = []
    for al in alerts:
        normalized_alerts.append({
            "id": al.get("alertName", ""),
            "title": al.get("displayName", "Security Alert"),
            "description": al.get("description", ""),
            "severity": (al.get("severity", "Medium") or "Medium").lower(),
            "alert_type": al.get("alertType", ""),
            "compromised_entity": al.get("compromisedEntity", ""),
            "intent": al.get("intent", ""),
            "start_time": al.get("startTime", ""),
            "resource_id": al.get("resourceId", ""),
            "resource_name": al.get("resourceId", "").split("/")[-1] if al.get("resourceId") else "",
            "subscription_id": al.get("subscriptionId", ""),
            "resource_group": al.get("resourceGroup", ""),
            "tactics": al.get("tactics", ""),
            "product": al.get("productName", "Microsoft Defender for Cloud"),
            "source": "alert",
        })

    # ── Normalize assessments (recommendations) ──
    normalized_findings = []
    for a in assessments:
        resource_id = a.get("resourceId", "")
        resource_name = resource_id.split("/")[-1] if resource_id else "Unknown"
        parts = resource_id.lower().split("/providers/")
        resource_type = ""
        if len(parts) > 1:
            type_parts = parts[-1].split("/")
            if len(type_parts) >= 2:
                resource_type = f"{type_parts[0]}/{type_parts[1]}"

        normalized_findings.append({
            "id": a.get("assessmentName", ""),
            "title": a.get("displayName", "Unknown Assessment"),
            "description": a.get("description", ""),
            "severity": (a.get("severity", "Medium") or "Medium").lower(),
            "category": a.get("category", "General"),
            "resource_id": resource_id,
            "resource_name": resource_name,
            "resource_type": resource_type,
            "resource_group": a.get("resourceGroup", ""),
            "subscription_id": a.get("subscriptionId", ""),
            "source": "defender",
            "implementation_effort": a.get("implementationEffort", ""),
            "user_impact": a.get("userImpact", ""),
            "threats": a.get("threats", ""),
            "remediation": a.get("remediationDescription", ""),
            "status": a.get("statusCode", "Unhealthy"),
        })

    # ── Normalize Advisor recommendations ──
    for r in advisor_recs:
        resource_id = r.get("resourceId", "")
        resource_name = resource_id.split("/")[-1] if resource_id else "Unknown"
        impact = (r.get("impact", "Medium") or "Medium").lower()
        severity = impact if impact in ("high", "medium", "low") else "medium"

        normalized_findings.append({
            "id": r.get("id", ""),
            "title": r.get("displayName", r.get("problem", "Security Recommendation")),
            "description": r.get("problem", ""),
            "severity": severity,
            "category": "Advisor Security",
            "resource_id": resource_id,
            "resource_name": resource_name,
            "resource_type": r.get("resourceType", ""),
            "resource_group": r.get("resourceGroup", ""),
            "subscription_id": r.get("subscriptionId", ""),
            "source": "advisor",
            "implementation_effort": "",
            "user_impact": impact,
            "threats": "",
            "remediation": "",
            "status": "Active",
        })

    # Sort findings by severity
    sev_order = {"high": 0, "medium": 1, "low": 2}
    normalized_findings.sort(key=lambda f: sev_order.get(f["severity"], 9))

    # ── Process Compliance ──
    compliance_summary = []
    for s in standards:
        total_controls = (s.get("passedControls", 0) + s.get("failedControls", 0)
                          + s.get("skippedControls", 0))
        passed = s.get("passedControls", 0)
        compliance_pct = round(passed / total_controls * 100, 1) if total_controls > 0 else 0
        compliance_summary.append({
            "standard": s.get("standardName", ""),
            "subscription_id": s.get("subscriptionId", ""),
            "state": s.get("state", ""),
            "passed_controls": passed,
            "failed_controls": s.get("failedControls", 0),
            "skipped_controls": s.get("skippedControls", 0),
            "total_controls": total_controls,
            "compliance_pct": compliance_pct,
        })

    # ── Vulnerability summary ──
    vuln_total = sum(v.get("vulnCount", 0) for v in vuln_summary)

    # ── Build chart data ──
    charts = _build_charts_data(assessments, alerts, controls, plans_summary)

    result = {
        # KPI data
        "secure_score": secure_score,
        "total_recommendations": len(assessments),
        "total_alerts": len(alerts),
        "total_vulnerabilities": vuln_total,
        "severity_counts": severity_counts,
        "alert_severity_counts": alert_severity_counts,

        # Detailed data
        "findings": normalized_findings,
        "finding_count": len(normalized_findings),
        "alerts": normalized_alerts,
        "controls": controls,
        "defender_plans": plans_summary,
        "compliance": compliance_summary,
        "regulatory_controls": reg_controls[:100],
        "sub_assessments": sub_assessments[:200],
        "vulnerability_summary": vuln_summary,

        # Counts
        "advisor_count": len(advisor_recs),
        "defender_count": len(assessments),

        # Chart data
        "charts": charts,
    }

    # ── Store in TTL cache ────────────────────────────────────────────────────
    _security_cache[cache_key] = {"data": result, "ts": time.monotonic()}
    logger.info("security posture: cached result for key '%s'", cache_key)

    return result

