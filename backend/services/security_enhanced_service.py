"""
Security Enhanced Service — Zero Trust Scorecard & Attack Surface Analysis.

Builds on top of cached dashboard data and Defender posture data to provide:
1. Zero Trust Scorecard — 6 pillar assessment (Identity, Network, Endpoint, Data, App, Infrastructure)
2. Attack Surface Analysis — public endpoints, open ports, exposed services
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ══════════════════════════════════════════════════════════════════════════════════
# ZERO TRUST SCORECARD
# ══════════════════════════════════════════════════════════════════════════════════

_ZT_PILLARS = [
    {
        "key": "identity",
        "name": "Identity",
        "icon": "🔑",
        "description": "Verify explicitly — authenticate and authorize based on all available data points",
        "max_score": 100,
    },
    {
        "key": "network",
        "name": "Network",
        "icon": "🌐",
        "description": "Segment access, use micro-segmentation, and encrypt all traffic",
        "max_score": 100,
    },
    {
        "key": "endpoint",
        "name": "Endpoint",
        "icon": "💻",
        "description": "Ensure device compliance, health, and integrity before granting access",
        "max_score": 100,
    },
    {
        "key": "data",
        "name": "Data",
        "icon": "📊",
        "description": "Classify, label, encrypt, and restrict access to sensitive data",
        "max_score": 100,
    },
    {
        "key": "application",
        "name": "Application",
        "icon": "📱",
        "description": "Ensure appropriate in-app permissions, monitor for anomalous behavior",
        "max_score": 100,
    },
    {
        "key": "infrastructure",
        "name": "Infrastructure",
        "icon": "🏗️",
        "description": "Use telemetry, harden configuration, enforce least-privilege, detect anomalies",
        "max_score": 100,
    },
]


def build_zero_trust_scorecard(
    resources: List[Any],
    security_gaps: List[Any],
    defender_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Build a Zero Trust scorecard across 6 pillars based on resource data,
    security gaps, and Defender for Cloud posture.
    """
    pillar_scores = {}

    # Pre-compute helper sets
    rtypes = {}
    for r in resources:
        rt = _rt(r)
        rtypes.setdefault(rt, []).append(r)

    total = len(resources)
    if total == 0:
        total = 1  # avoid div-by-zero

    # Gap counts by type
    gap_types = {}
    for g in security_gaps:
        gt = _gap_type(g)
        gap_types[gt] = gap_types.get(gt, 0) + 1

    # Defender info
    defender = defender_data or {}
    secure_score_pct = 0
    plans_coverage = 0
    if defender.get("secure_score"):
        secure_score_pct = defender["secure_score"].get("percentage", 0)
    if defender.get("defender_plans"):
        plans_coverage = defender["defender_plans"].get("overall_coverage_pct", 0)

    # ── Identity Pillar ──────────────────────────────────────────────────────
    identity_score = 50  # baseline
    kv_count = len(rtypes.get("microsoft.keyvault/vaults", []))
    managed_id_count = sum(1 for r in resources if "managedidentit" in _rt(r))
    if kv_count > 0:
        identity_score += 15
    if managed_id_count > 0:
        identity_score += 15
    # Penalize if many resources lack locks (proxy for RBAC discipline)
    lock_gaps = gap_types.get("no_lock", 0)
    if lock_gaps > 5:
        identity_score -= 15
    elif lock_gaps > 0:
        identity_score -= 5
    # Tag compliance = governance proxy
    tag_gaps = gap_types.get("missing_tags", 0)
    if tag_gaps > 10:
        identity_score -= 15
    elif tag_gaps > 3:
        identity_score -= 5
    identity_checks = [
        _check("Key Vault for Secrets Management", kv_count > 0, f"{kv_count} Key Vaults deployed",
               "Deploy Azure Key Vault for centralized secrets, keys, and certificate management"),
        _check("Managed Identities", managed_id_count > 0, f"{managed_id_count} managed identities detected",
               "Use system/user-assigned managed identities to eliminate credential management"),
        _check("Resource Locks (RBAC Discipline)", lock_gaps == 0,
               f"{lock_gaps} high-cost resources without delete locks",
               "Apply CanNotDelete locks on critical resources to enforce governance"),
        _check("Tag Governance", tag_gaps <= 3,
               f"{tag_gaps} resources with missing governance tags",
               "Enforce required tags via Azure Policy for Owner, CostCenter, Environment"),
    ]

    # ── Network Pillar ───────────────────────────────────────────────────────
    network_score = 50
    pe_gaps = gap_types.get("no_private_endpoint", 0)
    pe_eligible = sum(1 for g in security_gaps if _gap_type(g) == "no_private_endpoint") + \
                  sum(1 for r in resources if _has_pe(r))
    firewall_count = len(rtypes.get("microsoft.network/azurefirewalls", []))
    nsg_count = len(rtypes.get("microsoft.network/networksecuritygroups", []))
    vnet_count = len(rtypes.get("microsoft.network/virtualnetworks", []))
    public_ip_count = len(rtypes.get("microsoft.network/publicipaddresses", []))

    if pe_gaps == 0 and pe_eligible > 0:
        network_score += 20
    elif pe_gaps < 3:
        network_score += 10
    else:
        network_score -= min(20, pe_gaps * 3)
    if firewall_count > 0:
        network_score += 15
    if nsg_count >= vnet_count and nsg_count > 0:
        network_score += 10
    if public_ip_count > 5:
        network_score -= 10

    network_checks = [
        _check("Private Endpoints", pe_gaps == 0,
               f"{pe_gaps} data services exposed without private endpoints",
               "Configure private endpoints for all data services (SQL, Cosmos, Storage, Key Vault)"),
        _check("Azure Firewall", firewall_count > 0,
               f"{firewall_count} Azure Firewalls deployed",
               "Deploy Azure Firewall for centralized network traffic inspection and filtering"),
        _check("NSG Coverage", nsg_count >= vnet_count and nsg_count > 0,
               f"{nsg_count} NSGs across {vnet_count} VNets",
               "Ensure every subnet has an NSG with deny-by-default rules"),
        _check("Public IP Minimization", public_ip_count <= 5,
               f"{public_ip_count} public IP addresses",
               "Minimize public IPs — use Azure Front Door, App Gateway, or Private Link instead"),
    ]

    # ── Endpoint Pillar ──────────────────────────────────────────────────────
    endpoint_score = 50
    vm_count = len(rtypes.get("microsoft.compute/virtualmachines", []))
    arc_count = len(rtypes.get("microsoft.hybridcompute/machines", []))
    unmonitored_gaps = gap_types.get("unmonitored", 0)

    if plans_coverage >= 80:
        endpoint_score += 25
    elif plans_coverage >= 50:
        endpoint_score += 10
    else:
        endpoint_score -= 15

    if unmonitored_gaps == 0:
        endpoint_score += 15
    elif unmonitored_gaps < 5:
        endpoint_score += 5
    else:
        endpoint_score -= 10

    endpoint_checks = [
        _check("Defender for Servers", plans_coverage >= 80,
               f"Defender plan coverage: {plans_coverage:.0f}%",
               "Enable Microsoft Defender for Servers on all subscriptions for EDR and vulnerability scanning"),
        _check("Monitoring & Diagnostics", unmonitored_gaps == 0,
               f"{unmonitored_gaps} high-cost resources with no monitoring",
               "Enable Azure Monitor diagnostic settings on all critical resources"),
        _check("VM Fleet Visibility", vm_count + arc_count > 0,
               f"{vm_count} Azure VMs, {arc_count} Arc-enabled machines",
               "Onboard all servers to Azure Arc for consistent management and security policy"),
    ]

    # ── Data Pillar ──────────────────────────────────────────────────────────
    data_score = 50
    storage_count = len(rtypes.get("microsoft.storage/storageaccounts", []))
    sql_count = len(rtypes.get("microsoft.sql/servers/databases", []))
    cosmos_count = len(rtypes.get("microsoft.documentdb/databaseaccounts", []))
    no_backup_gaps = gap_types.get("no_backup", 0)
    backup_eligible = no_backup_gaps + sum(1 for r in resources if _attr(r, "has_backup"))

    if kv_count > 0:
        data_score += 10
    if no_backup_gaps == 0 and backup_eligible > 0:
        data_score += 20
    elif no_backup_gaps < 5:
        data_score += 10
    else:
        data_score -= 15
    if pe_gaps == 0:
        data_score += 15
    # Encryption is default in Azure, give partial credit
    data_score += 5

    data_checks = [
        _check("Backup Coverage", no_backup_gaps == 0,
               f"{no_backup_gaps} backup-eligible resources without backup",
               "Enable Azure Backup for all VMs, databases, and storage accounts"),
        _check("Data Encryption at Rest", True,
               "Azure encrypts all data at rest by default (SSE/TDE)",
               "Verify customer-managed keys (CMK) for regulated workloads"),
        _check("Private Data Access", pe_gaps == 0,
               f"{pe_gaps} data services without private endpoints",
               "Use Private Link to ensure data never traverses the public internet"),
        _check("Secrets in Key Vault", kv_count > 0,
               f"{kv_count} Key Vaults for secrets management",
               "Store all connection strings, API keys, and certificates in Azure Key Vault"),
    ]

    # ── Application Pillar ───────────────────────────────────────────────────
    app_score = 50
    app_svc_count = len(rtypes.get("microsoft.web/sites", []))
    aca_count = len(rtypes.get("microsoft.app/containerapps", []))
    aks_count = len(rtypes.get("microsoft.containerservice/managedclusters", []))
    apim_count = len(rtypes.get("microsoft.apimanagement/service", []))
    agw_count = len(rtypes.get("microsoft.network/applicationgateways", []))

    if agw_count > 0 or apim_count > 0:
        app_score += 20  # WAF / API gateway
    if aca_count > 0 or aks_count > 0:
        app_score += 10  # containerized = better isolation
    if app_svc_count > 0:
        app_score += 5

    app_checks = [
        _check("WAF / API Gateway", agw_count > 0 or apim_count > 0,
               f"{agw_count} App Gateways, {apim_count} APIM instances",
               "Deploy Application Gateway with WAF or Azure Front Door for web app protection"),
        _check("Container Isolation", aca_count > 0 or aks_count > 0,
               f"{aca_count} Container Apps, {aks_count} AKS clusters",
               "Use Container Apps or AKS with network policies for workload isolation"),
        _check("App Service Security", app_svc_count == 0 or True,
               f"{app_svc_count} App Services deployed",
               "Enable authentication, HTTPS-only, and VNet integration on all App Services"),
    ]

    # ── Infrastructure Pillar ────────────────────────────────────────────────
    infra_score = 50
    if secure_score_pct >= 70:
        infra_score += 25
    elif secure_score_pct >= 50:
        infra_score += 10
    else:
        infra_score -= 10
    if lock_gaps == 0:
        infra_score += 10
    if tag_gaps <= 3:
        infra_score += 10

    infra_checks = [
        _check("Defender Secure Score", secure_score_pct >= 70,
               f"Secure Score: {secure_score_pct:.0f}%",
               "Address Defender for Cloud recommendations to improve your secure score above 70%"),
        _check("Resource Locks", lock_gaps == 0,
               f"{lock_gaps} critical resources without delete locks",
               "Apply CanNotDelete locks on production resources to prevent accidental deletion"),
        _check("Policy & Governance", tag_gaps <= 3,
               f"{tag_gaps} resources with missing governance tags",
               "Use Azure Policy to enforce tagging, allowed regions, and SKU restrictions"),
    ]

    # Clamp all scores
    for key, score, checks in [
        ("identity", identity_score, identity_checks),
        ("network", network_score, network_checks),
        ("endpoint", endpoint_score, endpoint_checks),
        ("data", data_score, data_checks),
        ("application", app_score, app_checks),
        ("infrastructure", infra_score, infra_checks),
    ]:
        score = max(0, min(100, score))
        pillar_scores[key] = {
            "score": score,
            "checks": checks,
            "grade": _grade(score),
        }

    # Merge pillar metadata
    pillars = []
    for p in _ZT_PILLARS:
        ps = pillar_scores[p["key"]]
        pillars.append({**p, **ps})

    overall = round(sum(p["score"] for p in pillars) / len(pillars))
    maturity = (
        "Advanced" if overall >= 80 else
        "Intermediate" if overall >= 60 else
        "Initial" if overall >= 40 else
        "Traditional"
    )

    return {
        "overall_score": overall,
        "overall_grade": _grade(overall),
        "maturity_level": maturity,
        "pillars": pillars,
        "total_checks": sum(len(p["checks"]) for p in pillars),
        "passing_checks": sum(1 for p in pillars for c in p["checks"] if c["status"] == "pass"),
    }


# ══════════════════════════════════════════════════════════════════════════════════
# ATTACK SURFACE ANALYSIS
# ══════════════════════════════════════════════════════════════════════════════════

def build_attack_surface_analysis(
    resources: List[Any],
    security_gaps: List[Any],
) -> Dict[str, Any]:
    """
    Analyze the attack surface: public endpoints, exposed services,
    network exposure, and data exposure risk.
    """
    exposures = []
    risk_score = 0
    total_weight = 0

    rtypes = {}
    for r in resources:
        rt = _rt(r)
        rtypes.setdefault(rt, []).append(r)

    # ── 1. Public IP addresses ───────────────────────────────────────────────
    public_ips = rtypes.get("microsoft.network/publicipaddresses", [])
    if public_ips:
        risk_score += min(30, len(public_ips) * 5)
        total_weight += 30
        for ip in public_ips:
            exposures.append({
                "category": "Public IP",
                "severity": "high" if len(public_ips) > 3 else "medium",
                "resource_name": _attr(ip, "resource_name"),
                "resource_type": _attr(ip, "resource_type"),
                "resource_group": _attr(ip, "resource_group"),
                "description": f"Public IP address exposes resources to the internet",
                "remediation": "Consider using Private Link, Azure Front Door, or remove if unused",
            })
    else:
        total_weight += 30

    # ── 2. Data services without Private Endpoints ───────────────────────────
    pe_exposed = [g for g in security_gaps if _gap_type(g) == "no_private_endpoint"]
    if pe_exposed:
        sev_weight = sum(10 if _attr(g, "severity") == "critical" else 5 for g in pe_exposed)
        risk_score += min(25, sev_weight)
        total_weight += 25
        for g in pe_exposed:
            exposures.append({
                "category": "Data Service Exposure",
                "severity": _attr(g, "severity") or "high",
                "resource_name": _attr(g, "resource_name"),
                "resource_type": _attr(g, "resource_type"),
                "resource_group": _attr(g, "resource_group"),
                "description": f"{_attr(g, 'resource_name')} accessible over public internet without private endpoint",
                "remediation": "Configure Azure Private Endpoint to restrict access to your VNet only",
            })
    else:
        total_weight += 25

    # ── 3. Resources without backup (data loss vector) ───────────────────────
    no_backup = [g for g in security_gaps if _gap_type(g) == "no_backup"]
    if no_backup:
        risk_score += min(15, len(no_backup) * 2)
        total_weight += 15
        # Summarize rather than list each
        exposures.append({
            "category": "Data Loss Risk",
            "severity": "high" if len(no_backup) > 5 else "medium",
            "resource_name": f"{len(no_backup)} resources",
            "resource_type": "Multiple",
            "resource_group": "—",
            "description": f"{len(no_backup)} backup-eligible resources have no backup policy configured",
            "remediation": "Enable Azure Backup for all VMs, databases, and storage accounts",
        })
    else:
        total_weight += 15

    # ── 4. Unmonitored resources (blind spots) ──────────────────────────────
    unmonitored = [g for g in security_gaps if _gap_type(g) == "unmonitored"]
    if unmonitored:
        risk_score += min(15, len(unmonitored) * 3)
        total_weight += 15
        exposures.append({
            "category": "Monitoring Blind Spot",
            "severity": "medium",
            "resource_name": f"{len(unmonitored)} resources",
            "resource_type": "Multiple",
            "resource_group": "—",
            "description": f"{len(unmonitored)} high-cost resources have no diagnostics/monitoring enabled",
            "remediation": "Enable Azure Monitor diagnostic settings and configure alert rules",
        })
    else:
        total_weight += 15

    # ── 5. Public-facing web apps ────────────────────────────────────────────
    app_svcs = rtypes.get("microsoft.web/sites", [])
    agw_count = len(rtypes.get("microsoft.network/applicationgateways", []))
    fd_count = len(rtypes.get("microsoft.network/frontdoors", []) +
                    rtypes.get("microsoft.cdn/profiles", []))
    if app_svcs and agw_count == 0 and fd_count == 0:
        risk_score += 10
        total_weight += 10
        exposures.append({
            "category": "Unprotected Web Apps",
            "severity": "high",
            "resource_name": f"{len(app_svcs)} App Services",
            "resource_type": "microsoft.web/sites",
            "resource_group": "—",
            "description": f"{len(app_svcs)} web apps with no WAF (Application Gateway or Front Door) protection",
            "remediation": "Deploy Application Gateway with WAF v2 or Azure Front Door in front of web apps",
        })
    else:
        total_weight += 10

    # ── 6. Cognitive/AI services exposure ────────────────────────────────────
    ai_svcs = rtypes.get("microsoft.cognitiveservices/accounts", [])
    ai_exposed = [g for g in pe_exposed if "cognitive" in _attr(g, "resource_type").lower()]
    if ai_exposed:
        risk_score += 5
        total_weight += 5
    else:
        total_weight += 5

    # Normalize risk score to 0-100
    attack_surface_score = round(risk_score / max(total_weight, 1) * 100)
    risk_level = (
        "critical" if attack_surface_score >= 70 else
        "high" if attack_surface_score >= 50 else
        "medium" if attack_surface_score >= 30 else
        "low"
    )

    # Category summary
    cat_summary = {}
    for e in exposures:
        cat = e["category"]
        if cat not in cat_summary:
            cat_summary[cat] = {"category": cat, "count": 0, "severity": e["severity"]}
        cat_summary[cat]["count"] += 1
        # Escalate severity
        if _sev_rank(e["severity"]) < _sev_rank(cat_summary[cat]["severity"]):
            cat_summary[cat]["severity"] = e["severity"]

    return {
        "attack_surface_score": attack_surface_score,
        "risk_level": risk_level,
        "grade": _grade(100 - attack_surface_score),  # invert: lower exposure = better grade
        "total_exposures": len(exposures),
        "exposures": exposures,
        "category_summary": list(cat_summary.values()),
        "public_ip_count": len(public_ips),
        "pe_gaps_count": len(pe_exposed),
        "unmonitored_count": len(unmonitored),
        "no_backup_count": len(no_backup),
    }


# ══════════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════════

def _rt(r) -> str:
    """Get resource type, normalized."""
    if hasattr(r, "resource_type"):
        return (r.resource_type or "").lower()
    if isinstance(r, dict):
        return (r.get("resource_type") or "").lower()
    return ""


def _attr(obj, key) -> Any:
    """Get attribute from object or dict."""
    if hasattr(obj, key):
        return getattr(obj, key, "")
    if isinstance(obj, dict):
        return obj.get(key, "")
    return ""


def _gap_type(g) -> str:
    return _attr(g, "gap_type") or ""


def _has_pe(r) -> bool:
    return bool(_attr(r, "has_private_endpoint"))


def _grade(score: float) -> str:
    if score >= 90:
        return "A"
    if score >= 80:
        return "B"
    if score >= 70:
        return "C"
    if score >= 55:
        return "D"
    return "F"


def _sev_rank(sev: str) -> int:
    return {"critical": 0, "high": 1, "medium": 2, "low": 3}.get(sev, 9)


def _check(name: str, passing: bool, detail: str, recommendation: str) -> Dict[str, Any]:
    return {
        "name": name,
        "status": "pass" if passing else "fail",
        "detail": detail,
        "recommendation": recommendation,
    }
