"""
Networking Assessment Service
==============================
Analyses all Azure networking resources from the cached scan and produces:

1. Estate Overview — component inventory, cost breakdown, regional distribution
2. Architecture Review — hub-spoke detection, peering topology, missing DR links
3. Security Posture — NSG gaps, public IP exposure, WAF coverage, private endpoints
4. Design Anti-Patterns — oversized gateways, orphan NICs/NSGs/PIPs, missing locks
5. ACR Opportunity Scoring — upsell signals for FW, DDOS, FD, PL, WAF, etc.
6. Cost Analysis — per-component cost rollup, waste detection, right-size signals

All data is derived from the in-memory resource list (no extra Azure API calls).
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, asdict, field
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Azure Networking resource type taxonomy
# ---------------------------------------------------------------------------
NETWORKING_TYPES = {
    # Core
    "microsoft.network/virtualnetworks":           "Virtual Networks",
    "microsoft.network/virtualnetworks/subnets":   "Subnets",
    "microsoft.network/networkinterfaces":          "Network Interfaces",
    "microsoft.network/networksecuritygroups":      "Network Security Groups",
    "microsoft.network/routetables":               "Route Tables",
    "microsoft.network/publicipaddresses":          "Public IP Addresses",
    "microsoft.network/privateendpoints":           "Private Endpoints",
    "microsoft.network/privatelinkservices":        "Private Link Services",
    "microsoft.network/privatednszones":            "Private DNS Zones",
    "microsoft.network/dnszones":                  "DNS Zones",

    # Connectivity
    "microsoft.network/virtualnetworkgateways":     "VPN/ER Gateways",
    "microsoft.network/connections":                "VPN/ER Connections",
    "microsoft.network/expressroutecircuits":       "ExpressRoute Circuits",
    "microsoft.network/expressrouteports":          "ExpressRoute Ports",
    "microsoft.network/virtualhubs":                "Virtual WAN Hubs",
    "microsoft.network/virtualwans":                "Virtual WANs",
    "microsoft.network/vpngateways":                "VPN Gateways (vWAN)",
    "microsoft.network/expressroutegateways":       "ER Gateways (vWAN)",
    "microsoft.network/p2svpngateways":             "P2S VPN Gateways",

    # Load Balancing & Delivery
    "microsoft.network/loadbalancers":              "Load Balancers",
    "microsoft.network/applicationgateways":        "Application Gateways",
    "microsoft.network/frontdoors":                 "Front Doors (Classic)",
    "microsoft.cdn/profiles":                       "Front Door / CDN Profiles",
    "microsoft.network/trafficmanagerprofiles":     "Traffic Manager",
    "microsoft.network/natgateways":                "NAT Gateways",

    # Security
    "microsoft.network/azurefirewalls":             "Azure Firewalls",
    "microsoft.network/firewallpolicies":           "Firewall Policies",
    "microsoft.network/bastionhosts":               "Bastion Hosts",
    "microsoft.network/ddosprotectionplans":        "DDoS Protection Plans",
    "microsoft.network/applicationgatewaywebapplicationfirewallpolicies": "WAF Policies",
    "microsoft.network/frontdoorwebapplicationfirewallpolicies": "FD WAF Policies",

    # Monitoring
    "microsoft.network/networkwatchers":            "Network Watchers",
    "microsoft.network/networkwatchers/flowlogs":   "NSG Flow Logs",
}

# Types that are specifically networking
_NET_TYPE_SET = set(NETWORKING_TYPES.keys())

# Additional types we also want to count in networking context
_EXTRA_NET_TYPES = {
    "microsoft.network/networksecuritygroups",
    "microsoft.network/networkinterfaces",
    "microsoft.network/publicipaddresses",
}

# Security-sensitive types
_SECURITY_TYPES = {
    "microsoft.network/azurefirewalls",
    "microsoft.network/ddosprotectionplans",
    "microsoft.network/bastionhosts",
    "microsoft.network/applicationgatewaywebapplicationfirewallpolicies",
    "microsoft.network/frontdoorwebapplicationfirewallpolicies",
}


def _rt(r: dict) -> str:
    """Lowercase resource type."""
    return (r.get("resource_type") or r.get("type") or "").lower()


def _is_networking(r: dict) -> bool:
    rt = _rt(r)
    return rt in _NET_TYPE_SET or rt.startswith("microsoft.network/")


# ---------------------------------------------------------------------------
# Main analysis function
# ---------------------------------------------------------------------------

def build_networking_dashboard(resources: list[dict]) -> dict:
    """
    Analyse all resources and return a comprehensive networking dashboard payload.

    Parameters
    ----------
    resources : list[dict]
        Full resource list from the cached scan (all types, not just networking).

    Returns
    -------
    dict with keys: kpi, component_inventory, cost_breakdown, regional_distribution,
        security_posture, architecture_review, design_issues, acr_opportunities,
        public_ip_analysis, nsg_analysis, gateway_analysis, high_risk_resources
    """
    all_resources = resources
    net_resources = [r for r in all_resources if _is_networking(r)]
    total_all = len(all_resources)
    total_net = len(net_resources)

    if total_net == 0:
        return {"kpi": {"total_networking_resources": 0, "total_all_resources": total_all}, "empty": True}

    # ── Component Inventory ───────────────────────────────────────────────
    component_counts: dict[str, int] = defaultdict(int)
    for r in net_resources:
        display = NETWORKING_TYPES.get(_rt(r), _rt(r).split("/")[-1])
        component_counts[display] += 1
    component_inventory = dict(sorted(component_counts.items(), key=lambda x: -x[1]))

    # ── Cost Breakdown ────────────────────────────────────────────────────
    cost_by_type: dict[str, float] = defaultdict(float)
    total_net_cost = 0.0
    for r in net_resources:
        cost = r.get("cost_current_month") or r.get("cost") or 0.0
        display = NETWORKING_TYPES.get(_rt(r), _rt(r).split("/")[-1])
        cost_by_type[display] += cost
        total_net_cost += cost
    cost_breakdown = dict(sorted(cost_by_type.items(), key=lambda x: -x[1])[:12])

    # ── Regional Distribution ─────────────────────────────────────────────
    region_counts: dict[str, int] = defaultdict(int)
    for r in net_resources:
        loc = (r.get("location") or "global").lower()
        region_counts[loc] += 1
    regional_distribution = dict(sorted(region_counts.items(), key=lambda x: -x[1])[:10])

    # ── Public IP Analysis ────────────────────────────────────────────────
    public_ips = [r for r in net_resources if _rt(r) == "microsoft.network/publicipaddresses"]
    pip_total = len(public_ips)
    pip_attached = 0
    pip_unattached = 0
    pip_basic_sku = 0
    pip_standard_sku = 0
    pip_static = 0
    pip_dynamic = 0
    pip_no_zone = 0

    for pip in public_ips:
        props = pip.get("properties") or pip.get("extra") or {}
        sku_name = (pip.get("sku", {}) or {}).get("name", "").lower() if isinstance(pip.get("sku"), dict) else ""
        if not sku_name:
            sku_name = (props.get("sku") or "").lower()

        # Check attachment
        ip_config = props.get("ipConfiguration") or props.get("ip_configuration")
        nat_gw = props.get("natGateway") or props.get("nat_gateway")
        if ip_config or nat_gw:
            pip_attached += 1
        else:
            pip_unattached += 1

        if "basic" in sku_name:
            pip_basic_sku += 1
        else:
            pip_standard_sku += 1

        alloc = (props.get("publicIPAllocationMethod") or props.get("allocation_method") or "").lower()
        if alloc == "static":
            pip_static += 1
        else:
            pip_dynamic += 1

        zones = pip.get("zones") or props.get("zones") or []
        if not zones:
            pip_no_zone += 1

    public_ip_analysis = {
        "total": pip_total,
        "attached": pip_attached,
        "unattached": pip_unattached,
        "basic_sku": pip_basic_sku,
        "standard_sku": pip_standard_sku,
        "static": pip_static,
        "dynamic": pip_dynamic,
        "no_zone_redundancy": pip_no_zone,
        "unattached_monthly_waste": round(pip_unattached * 3.65, 2),  # ~$3.65/mo per idle Standard PIP
    }

    # ── NSG Analysis ──────────────────────────────────────────────────────
    nsgs = [r for r in net_resources if _rt(r) == "microsoft.network/networksecuritygroups"]
    nsg_total = len(nsgs)
    nsg_with_any_star = 0
    nsg_allow_all_inbound = 0
    nsg_empty_rules = 0
    nsg_not_attached = 0

    for nsg in nsgs:
        props = nsg.get("properties") or nsg.get("extra") or {}
        rules = props.get("securityRules") or props.get("security_rules") or []
        subnets = props.get("subnets") or []
        nics = props.get("networkInterfaces") or props.get("network_interfaces") or []

        if not subnets and not nics:
            nsg_not_attached += 1

        if not rules:
            nsg_empty_rules += 1

        for rule in rules:
            rule_props = rule.get("properties") or rule
            access = (rule_props.get("access") or "").lower()
            direction = (rule_props.get("direction") or "").lower()
            src = rule_props.get("sourceAddressPrefix") or rule_props.get("source_address_prefix") or ""
            dst_port = rule_props.get("destinationPortRange") or rule_props.get("destination_port_range") or ""

            if access == "allow" and src == "*":
                nsg_with_any_star += 1
                if direction == "inbound" and dst_port == "*":
                    nsg_allow_all_inbound += 1
                break  # count each NSG once

    nsg_analysis = {
        "total": nsg_total,
        "with_allow_star_rules": nsg_with_any_star,
        "allow_all_inbound": nsg_allow_all_inbound,
        "empty_no_custom_rules": nsg_empty_rules,
        "not_attached": nsg_not_attached,
    }

    # ── Gateway Analysis ──────────────────────────────────────────────────
    gateways = [r for r in net_resources if _rt(r) in (
        "microsoft.network/virtualnetworkgateways",
        "microsoft.network/vpngateways",
        "microsoft.network/expressroutegateways",
    )]
    gw_vpn = sum(1 for g in gateways if "vpn" in _rt(g) or "vpn" in ((g.get("properties") or {}).get("gatewayType") or "").lower())
    gw_er = sum(1 for g in gateways if "expressroute" in _rt(g) or "expressroute" in ((g.get("properties") or {}).get("gatewayType") or "").lower())
    er_circuits = [r for r in net_resources if _rt(r) == "microsoft.network/expressroutecircuits"]

    gateway_analysis = {
        "total_gateways": len(gateways),
        "vpn_gateways": gw_vpn,
        "expressroute_gateways": gw_er,
        "expressroute_circuits": len(er_circuits),
    }

    # ── Security Posture ──────────────────────────────────────────────────
    firewalls = [r for r in net_resources if _rt(r) == "microsoft.network/azurefirewalls"]
    bastions = [r for r in net_resources if _rt(r) == "microsoft.network/bastionhosts"]
    ddos_plans = [r for r in net_resources if _rt(r) == "microsoft.network/ddosprotectionplans"]
    waf_policies = [r for r in net_resources if "webapplicationfirewallpolicies" in _rt(r)]
    private_endpoints = [r for r in net_resources if _rt(r) == "microsoft.network/privateendpoints"]
    private_dns = [r for r in net_resources if _rt(r) == "microsoft.network/privatednszones"]
    app_gateways = [r for r in net_resources if _rt(r) == "microsoft.network/applicationgateways"]
    front_doors = [r for r in net_resources if _rt(r) in ("microsoft.network/frontdoors", "microsoft.cdn/profiles")]
    load_balancers = [r for r in net_resources if _rt(r) == "microsoft.network/loadbalancers"]

    # Count LBs with Basic SKU
    lb_basic = 0
    for lb in load_balancers:
        sku = (lb.get("sku") or {}).get("name", "").lower() if isinstance(lb.get("sku"), dict) else ""
        if "basic" in sku:
            lb_basic += 1

    # Check which VNets have subnets
    vnets = [r for r in net_resources if _rt(r) == "microsoft.network/virtualnetworks"]

    # Peering detection
    peering_count = 0
    for vnet in vnets:
        props = vnet.get("properties") or vnet.get("extra") or {}
        peerings = props.get("virtualNetworkPeerings") or props.get("peerings") or []
        peering_count += len(peerings)

    # Services without private endpoints (high-value PaaS)
    paas_types = {
        "microsoft.sql/servers", "microsoft.sql/servers/databases",
        "microsoft.storage/storageaccounts",
        "microsoft.keyvault/vaults",
        "microsoft.documentdb/databaseaccounts",
        "microsoft.dbforpostgresql/flexibleservers",
        "microsoft.dbformysql/flexibleservers",
        "microsoft.web/sites",
        "microsoft.containerregistry/registries",
        "microsoft.cognitiveservices/accounts",
        "microsoft.search/searchservices",
    }
    paas_resources = [r for r in all_resources if _rt(r) in paas_types]
    paas_without_pe = len(paas_resources) - len(private_endpoints)  # approximation

    security_posture = {
        "firewalls": len(firewalls),
        "bastion_hosts": len(bastions),
        "ddos_protection_plans": len(ddos_plans),
        "waf_policies": len(waf_policies),
        "private_endpoints": len(private_endpoints),
        "private_dns_zones": len(private_dns),
        "app_gateways": len(app_gateways),
        "front_doors": len(front_doors),
        "load_balancers": len(load_balancers),
        "load_balancers_basic_sku": lb_basic,
        "public_ips_exposed": pip_total,
        "public_ips_unattached": pip_unattached,
        "nsgs_with_allow_star": nsg_with_any_star,
        "nsgs_allow_all_inbound": nsg_allow_all_inbound,
        "vnets": len(vnets),
        "vnet_peerings": peering_count,
        "paas_without_private_endpoint": max(paas_without_pe, 0),
        "has_firewall": len(firewalls) > 0,
        "has_bastion": len(bastions) > 0,
        "has_ddos": len(ddos_plans) > 0,
        "has_waf": len(waf_policies) > 0 or len(app_gateways) > 0,
    }

    # Security score (0-100)
    sec_score = 100
    if not security_posture["has_firewall"]:
        sec_score -= 20
    if not security_posture["has_ddos"]:
        sec_score -= 15
    if not security_posture["has_waf"]:
        sec_score -= 15
    if not security_posture["has_bastion"]:
        sec_score -= 10
    if nsg_allow_all_inbound > 0:
        sec_score -= min(nsg_allow_all_inbound * 5, 15)
    if pip_unattached > 0:
        sec_score -= min(pip_unattached * 2, 10)
    if lb_basic > 0:
        sec_score -= 5
    if paas_without_pe > 5:
        sec_score -= 10
    sec_score = max(sec_score, 0)
    security_posture["security_score"] = sec_score

    # ── Architecture Review ───────────────────────────────────────────────
    hub_spoke_detected = peering_count > 0 and len(vnets) > 1
    vwan_detected = any(_rt(r) in ("microsoft.network/virtualwans", "microsoft.network/virtualhubs") for r in net_resources)
    nat_gateways = [r for r in net_resources if _rt(r) == "microsoft.network/natgateways"]
    route_tables = [r for r in net_resources if _rt(r) == "microsoft.network/routetables"]
    network_watchers = [r for r in net_resources if _rt(r) == "microsoft.network/networkwatchers"]
    flow_logs = [r for r in net_resources if "flowlogs" in _rt(r)]
    connections = [r for r in net_resources if _rt(r) == "microsoft.network/connections"]

    arch_review = {
        "hub_spoke_detected": hub_spoke_detected,
        "vwan_detected": vwan_detected,
        "total_vnets": len(vnets),
        "total_peerings": peering_count,
        "nat_gateways": len(nat_gateways),
        "route_tables": len(route_tables),
        "network_watchers": len(network_watchers),
        "flow_logs_enabled": len(flow_logs),
        "vpn_er_connections": len(connections),
        "topology": "Virtual WAN" if vwan_detected else ("Hub-Spoke" if hub_spoke_detected else ("Flat/Simple" if len(vnets) <= 2 else "Multi-VNet (no peering)" if peering_count == 0 else "Mesh/Custom")),
    }

    # ── Design Issues & Anti-Patterns ─────────────────────────────────────
    design_issues = []

    if pip_unattached > 0:
        design_issues.append({
            "severity": "Medium",
            "category": "Cost Waste",
            "title": f"{pip_unattached} Unattached Public IPs",
            "description": f"Found {pip_unattached} public IPs not associated with any resource. Each idle Standard PIP costs ~$3.65/mo.",
            "monthly_waste": round(pip_unattached * 3.65, 2),
            "action": "Delete unused PIPs or associate them with active resources.",
        })

    if pip_basic_sku > 0:
        design_issues.append({
            "severity": "High",
            "category": "Deprecation",
            "title": f"{pip_basic_sku} Basic SKU Public IPs (Retirement Sept 2025)",
            "description": "Basic SKU PIPs are being retired. Migrate to Standard SKU immediately.",
            "action": "Upgrade all Basic PIPs to Standard. Basic LBs must also be upgraded.",
        })

    if lb_basic > 0:
        design_issues.append({
            "severity": "High",
            "category": "Deprecation",
            "title": f"{lb_basic} Basic Load Balancers (Retirement Sept 2025)",
            "description": "Basic LBs are being retired. Standard LBs offer zone redundancy and better SLA.",
            "action": "Migrate Basic LBs to Standard SKU using Azure migration tool.",
        })

    if nsg_allow_all_inbound > 0:
        design_issues.append({
            "severity": "Critical",
            "category": "Security",
            "title": f"{nsg_allow_all_inbound} NSGs Allow All Inbound Traffic",
            "description": "NSGs with Allow * on all ports from any source expose resources to the internet.",
            "action": "Restrict inbound rules to specific IPs and ports. Use Azure Firewall for centralized control.",
        })

    if nsg_not_attached > 0:
        design_issues.append({
            "severity": "Low",
            "category": "Hygiene",
            "title": f"{nsg_not_attached} Orphaned NSGs (Not Attached)",
            "description": "NSGs not associated with any subnet or NIC. May be leftover from deleted resources.",
            "action": "Review and delete if no longer needed.",
        })

    if not security_posture["has_firewall"] and len(vnets) > 1:
        design_issues.append({
            "severity": "High",
            "category": "Security",
            "title": "No Azure Firewall Deployed",
            "description": "Multi-VNet environment without centralized firewall. All east-west and north-south traffic is unfiltered.",
            "action": "Deploy Azure Firewall (Standard or Premium) in a hub VNet for centralized traffic inspection.",
            "acr_opportunity": True,
        })

    if not security_posture["has_ddos"]:
        design_issues.append({
            "severity": "Medium",
            "category": "Security",
            "title": "No DDoS Protection Plan",
            "description": "Public-facing resources have only Basic DDoS protection (no SLA, limited mitigation).",
            "action": "Enable DDoS Network Protection for SLA-backed DDoS mitigation and telemetry.",
            "acr_opportunity": True,
        })

    if not security_posture["has_waf"] and (len(app_gateways) > 0 or len(front_doors) > 0 or pip_total > 5):
        design_issues.append({
            "severity": "High",
            "category": "Security",
            "title": "No WAF Policy Deployed",
            "description": "Web-facing resources without Web Application Firewall protection against OWASP top 10.",
            "action": "Deploy WAF policy on Application Gateway or Front Door.",
            "acr_opportunity": True,
        })

    if not security_posture["has_bastion"]:
        design_issues.append({
            "severity": "Medium",
            "category": "Security",
            "title": "No Azure Bastion Deployed",
            "description": "VMs may be accessed via public RDP/SSH. Bastion provides secure, browser-based access without public IPs.",
            "action": "Deploy Azure Bastion (Standard tier) in hub VNet for secure VM management.",
            "acr_opportunity": True,
        })

    if paas_without_pe > 3:
        design_issues.append({
            "severity": "Medium",
            "category": "Security",
            "title": f"~{max(paas_without_pe, 0)} PaaS Resources Without Private Endpoints",
            "description": "PaaS services accessed over the public internet instead of private connectivity.",
            "action": "Create Private Endpoints and disable public network access for sensitive PaaS services.",
            "acr_opportunity": True,
        })

    if len(flow_logs) == 0 and len(nsgs) > 0:
        design_issues.append({
            "severity": "Medium",
            "category": "Monitoring",
            "title": "No NSG Flow Logs Configured",
            "description": "NSG Flow Logs provide network traffic visibility for security and troubleshooting.",
            "action": "Enable NSG Flow Logs v2 with Traffic Analytics for all production NSGs.",
            "acr_opportunity": True,
        })

    if len(network_watchers) == 0:
        design_issues.append({
            "severity": "Low",
            "category": "Monitoring",
            "title": "No Network Watcher Deployed",
            "description": "Network Watcher provides diagnostics, packet capture, and connection monitoring.",
            "action": "Enable Network Watcher in all active regions.",
        })

    # ── ACR Opportunities ─────────────────────────────────────────────────
    acr_opportunities = []

    if not security_posture["has_firewall"]:
        acr_opportunities.append({
            "service": "Azure Firewall",
            "category": "Security",
            "priority": "High",
            "estimated_monthly_acr": 1250,  # Standard ~$1.25/hr
            "description": "Centralized network security with IDPS, TLS inspection, threat intelligence.",
            "business_case": "Zero-trust network security, compliance requirement, east-west traffic control.",
        })

    if not security_posture["has_ddos"]:
        acr_opportunities.append({
            "service": "DDoS Network Protection",
            "category": "Security",
            "priority": "Medium",
            "estimated_monthly_acr": 2944,  # ~$2,944/mo fixed
            "description": "SLA-backed DDoS mitigation with real-time telemetry and rapid response.",
            "business_case": "SLA guarantee, cost protection (DDoS Protection credits), regulatory compliance.",
        })

    if not security_posture["has_waf"]:
        acr_opportunities.append({
            "service": "WAF on Application Gateway / Front Door",
            "category": "Security",
            "priority": "High",
            "estimated_monthly_acr": 350,
            "description": "OWASP top-10 protection, bot mitigation, custom rules for web applications.",
            "business_case": "Web app security, PCI-DSS compliance, automated threat protection.",
        })

    if not security_posture["has_bastion"]:
        acr_opportunities.append({
            "service": "Azure Bastion",
            "category": "Security",
            "priority": "Medium",
            "estimated_monthly_acr": 140,  # Standard tier
            "description": "Secure browser-based RDP/SSH without public IPs on VMs.",
            "business_case": "Eliminate public management endpoints, improve security posture.",
        })

    if paas_without_pe > 3:
        acr_opportunities.append({
            "service": "Private Link / Private Endpoints",
            "category": "Security",
            "priority": "High",
            "estimated_monthly_acr": round(max(paas_without_pe, 1) * 7.3, 0),  # ~$7.30/PE/mo
            "description": f"Private connectivity for ~{max(paas_without_pe, 0)} PaaS resources.",
            "business_case": "Data exfiltration prevention, compliance, zero public exposure.",
        })

    if len(flow_logs) == 0:
        acr_opportunities.append({
            "service": "NSG Flow Logs + Traffic Analytics",
            "category": "Monitoring",
            "priority": "Medium",
            "estimated_monthly_acr": 200,
            "description": "Network traffic visibility with ML-powered Traffic Analytics.",
            "business_case": "Security investigations, capacity planning, compliance auditing.",
        })

    if len(front_doors) == 0 and pip_total > 3:
        acr_opportunities.append({
            "service": "Azure Front Door Premium",
            "category": "Performance",
            "priority": "Medium",
            "estimated_monthly_acr": 330,
            "description": "Global load balancing with integrated WAF, private origin, caching.",
            "business_case": "Global performance, built-in WAF, multi-region resilience.",
        })

    if not vwan_detected and len(vnets) > 3 and not hub_spoke_detected:
        acr_opportunities.append({
            "service": "Azure Virtual WAN",
            "category": "Architecture",
            "priority": "Medium",
            "estimated_monthly_acr": 500,
            "description": "Managed hub-spoke with integrated VPN, ER, Firewall, and SD-WAN.",
            "business_case": "Simplified networking, reduced operational overhead, any-to-any connectivity.",
        })

    total_acr = sum(o["estimated_monthly_acr"] for o in acr_opportunities)

    # ── High Risk Resources ───────────────────────────────────────────────
    high_risk = []
    for r in net_resources:
        risk_score = 0
        reasons = []
        rt = _rt(r)

        if rt == "microsoft.network/publicipaddresses":
            props = r.get("properties") or r.get("extra") or {}
            ip_config = props.get("ipConfiguration") or props.get("ip_configuration")
            if not ip_config:
                risk_score += 30
                reasons.append("Unattached PIP")
            sku_name = ((r.get("sku") or {}).get("name", "") if isinstance(r.get("sku"), dict) else "").lower()
            if "basic" in sku_name:
                risk_score += 40
                reasons.append("Basic SKU (retiring)")
            zones = r.get("zones") or props.get("zones") or []
            if not zones:
                risk_score += 15
                reasons.append("No zone redundancy")

        if rt == "microsoft.network/loadbalancers":
            sku_name = ((r.get("sku") or {}).get("name", "") if isinstance(r.get("sku"), dict) else "").lower()
            if "basic" in sku_name:
                risk_score += 50
                reasons.append("Basic LB (retiring)")

        if rt == "microsoft.network/networksecuritygroups":
            props = r.get("properties") or r.get("extra") or {}
            rules = props.get("securityRules") or props.get("security_rules") or []
            for rule in rules:
                rp = rule.get("properties") or rule
                if (rp.get("access") or "").lower() == "allow" and (rp.get("sourceAddressPrefix") or "") == "*":
                    risk_score += 35
                    reasons.append("Allow * source rule")
                    break

        if risk_score >= 30:
            high_risk.append({
                "resource_id": r.get("resource_id") or r.get("id"),
                "resource_name": r.get("resource_name") or r.get("name"),
                "resource_type": _rt(r),
                "location": r.get("location"),
                "resource_group": r.get("resource_group"),
                "risk_score": min(risk_score, 100),
                "reasons": reasons,
                "cost": r.get("cost_current_month") or r.get("cost") or 0,
            })

    high_risk.sort(key=lambda x: -x["risk_score"])

    # ── KPI Summary ───────────────────────────────────────────────────────
    kpi = {
        "total_networking_resources": total_net,
        "total_all_resources": total_all,
        "networking_pct": round(total_net / total_all * 100, 1) if total_all else 0,
        "total_networking_cost": round(total_net_cost, 2),
        "security_score": sec_score,
        "design_issues_count": len(design_issues),
        "critical_issues": sum(1 for d in design_issues if d["severity"] == "Critical"),
        "high_issues": sum(1 for d in design_issues if d["severity"] == "High"),
        "acr_opportunity_count": len(acr_opportunities),
        "total_monthly_acr_potential": round(total_acr, 0),
        "public_ips": pip_total,
        "private_endpoints": len(private_endpoints),
        "vnets": len(vnets),
        "firewalls": len(firewalls),
    }

    return {
        "kpi": kpi,
        "component_inventory": component_inventory,
        "cost_breakdown": cost_breakdown,
        "regional_distribution": regional_distribution,
        "security_posture": security_posture,
        "architecture_review": arch_review,
        "public_ip_analysis": public_ip_analysis,
        "nsg_analysis": nsg_analysis,
        "gateway_analysis": gateway_analysis,
        "design_issues": sorted(design_issues, key=lambda x: {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}.get(x["severity"], 4)),
        "acr_opportunities": acr_opportunities,
        "high_risk_resources": high_risk[:20],
    }


# ---------------------------------------------------------------------------
# Advanced Topology Detection via Azure Resource Graph
# ---------------------------------------------------------------------------
# Builds a deep understanding of the networking topology:
#  - Hub/spoke identification (VNets with firewalls, gateways = hubs)
#  - Multi-region hub detection (hubs in different regions with global peering)
#  - Per-VNet subnet analysis (AzureFirewallSubnet, GatewaySubnet, etc.)
#  - Route table UDR analysis (next-hop to NVA/firewall)
#  - NVA detection (VMs with IP forwarding enabled)
#  - Peering details (gateway transit, remote gateways, global vs regional)
#  - Firewall policies and SKU tiers
# ---------------------------------------------------------------------------

_TOPOLOGY_VNETS_KQL = """
resources
| where type == "microsoft.network/virtualnetworks"
| extend addressPrefixes = properties.addressSpace.addressPrefixes
| extend subnets = properties.subnets
| extend peerings = properties.virtualNetworkPeerings
| extend enableDdosProtection = properties.enableDdosProtection
| extend dhcpOptions = properties.dhcpOptions
| project id, name, resourceGroup, location, subscriptionId,
          addressPrefixes, subnets, peerings, enableDdosProtection, dhcpOptions, tags
"""

_TOPOLOGY_FIREWALLS_KQL = """
resources
| where type == "microsoft.network/azurefirewalls"
| extend ipConfigs = properties.ipConfigurations
| extend firewallPolicy = properties.firewallPolicy.id
| extend skuName = properties.sku.name
| extend skuTier = properties.sku.tier
| extend threatIntelMode = properties.threatIntelMode
| extend provisioningState = properties.provisioningState
| mv-expand ipConfig = ipConfigs
| extend subnetId = tostring(ipConfig.properties.subnet.id)
| extend privateIp = tostring(ipConfig.properties.privateIPAddress)
| project id, name, resourceGroup, location, subscriptionId,
          subnetId, privateIp, firewallPolicy, skuName, skuTier,
          threatIntelMode, provisioningState
"""

_TOPOLOGY_GATEWAYS_KQL = """
resources
| where type == "microsoft.network/virtualnetworkgateways"
| extend gatewayType = tostring(properties.gatewayType)
| extend skuName = tostring(properties.sku.name)
| extend skuTier = tostring(properties.sku.tier)
| extend vpnType = tostring(properties.vpnType)
| extend activeActive = properties.activeActive
| extend enableBgp = properties.enableBgp
| extend bgpPeeringAddress = properties.bgpSettings.bgpPeeringAddress
| mv-expand ipConfig = properties.ipConfigurations
| extend subnetId = tostring(ipConfig.properties.subnet.id)
| project id, name, resourceGroup, location, subscriptionId,
          gatewayType, skuName, skuTier, vpnType, activeActive,
          enableBgp, bgpPeeringAddress, subnetId
"""

_TOPOLOGY_ROUTE_TABLES_KQL = """
resources
| where type == "microsoft.network/routetables"
| extend routes = properties.routes
| extend associatedSubnets = properties.subnets
| extend disableBgpRoutePropagation = properties.disableBgpRoutePropagation
| project id, name, resourceGroup, location, subscriptionId,
          routes, associatedSubnets, disableBgpRoutePropagation
"""

_TOPOLOGY_NVA_KQL = """
resources
| where type == "microsoft.network/networkinterfaces"
| where properties.enableIPForwarding == true
| extend vmId = tostring(properties.virtualMachine.id)
| extend privateIp = tostring(properties.ipConfigurations[0].properties.privateIPAddress)
| extend subnetId = tostring(properties.ipConfigurations[0].properties.subnet.id)
| project nicId = id, name, resourceGroup, location, subscriptionId,
          vmId, privateIp, subnetId
"""

_TOPOLOGY_FW_POLICIES_KQL = """
resources
| where type == "microsoft.network/firewallpolicies"
| extend ruleCollectionGroups = properties.ruleCollectionGroups
| extend childPolicies = properties.childPolicies
| extend basePolicy = properties.basePolicy
| extend dnsSettings = properties.dnsSettings
| extend intrusionDetection = properties.intrusionDetection
| extend sku = properties.sku.tier
| extend threatIntelMode = properties.threatIntelMode
| extend transportSecurity = properties.transportSecurity
| project id, name, resourceGroup, location, subscriptionId,
          sku, threatIntelMode, intrusionDetection, dnsSettings,
          transportSecurity, basePolicy
"""

_TOPOLOGY_ER_CIRCUITS_KQL = """
resources
| where type == "microsoft.network/expressroutecircuits"
| extend serviceProviderName = properties.serviceProviderProperties.serviceProviderName
| extend peeringLocation = properties.serviceProviderProperties.peeringLocation
| extend bandwidthInMbps = properties.serviceProviderProperties.bandwidthInMbps
| extend skuTier = sku.tier
| extend skuFamily = sku.family
| extend circuitProvisioningState = properties.circuitProvisioningState
| extend serviceProviderProvisioningState = properties.serviceProviderProvisioningState
| project id, name, resourceGroup, location, subscriptionId,
          serviceProviderName, peeringLocation, bandwidthInMbps,
          skuTier, skuFamily, circuitProvisioningState, serviceProviderProvisioningState
"""


def _extract_vnet_id_from_subnet(subnet_id: str) -> str:
    """Extract VNet ID from a subnet resource ID."""
    # /subscriptions/.../virtualNetworks/<vnet>/subnets/<subnet>
    parts = subnet_id.lower().split("/subnets/")
    return parts[0] if len(parts) >= 2 else ""


def build_advanced_topology(subscription_ids=None) -> dict:
    """
    Build deep networking topology analysis via Azure Resource Graph.
    Returns hub/spoke map, multi-region topology, peering details,
    route analysis, NVA detection, and connectivity gaps.
    """
    from .resource_graph_service import query_resource_graph

    topology = {
        "hubs": [],
        "spokes": [],
        "standalone_vnets": [],
        "global_peerings": [],
        "regional_peerings": [],
        "multi_region": False,
        "hub_regions": [],
        "topology_type": "Unknown",
        "route_analysis": {},
        "nva_appliances": [],
        "firewall_details": [],
        "gateway_details": [],
        "er_circuits": [],
        "fw_policies": [],
        "connectivity_gaps": [],
        "subnet_analysis": [],
        "peering_health": {"total": 0, "connected": 0, "disconnected": 0, "initiated": 0},
    }

    try:
        # ── Fetch all topology data in parallel-safe manner ───────────
        vnets = query_resource_graph(_TOPOLOGY_VNETS_KQL, subscription_ids)
        firewalls = query_resource_graph(_TOPOLOGY_FIREWALLS_KQL, subscription_ids)
        gateways = query_resource_graph(_TOPOLOGY_GATEWAYS_KQL, subscription_ids)
        route_tables = query_resource_graph(_TOPOLOGY_ROUTE_TABLES_KQL, subscription_ids)
        nva_nics = query_resource_graph(_TOPOLOGY_NVA_KQL, subscription_ids)
        fw_policies = query_resource_graph(_TOPOLOGY_FW_POLICIES_KQL, subscription_ids)
        er_circuits = query_resource_graph(_TOPOLOGY_ER_CIRCUITS_KQL, subscription_ids)

        if not vnets:
            topology["topology_type"] = "No VNets Found"
            return topology

        logger.info(
            "Advanced topology: %d VNets, %d firewalls, %d gateways, %d route tables, %d NVA NICs, %d ER circuits",
            len(vnets), len(firewalls), len(gateways), len(route_tables), len(nva_nics), len(er_circuits),
        )

        # ── Index firewalls and gateways by VNet ─────────────────────
        fw_by_vnet = {}   # vnet_id_lower → firewall record
        for fw in firewalls:
            vnet_id = _extract_vnet_id_from_subnet(fw.get("subnetId", ""))
            if vnet_id:
                fw_by_vnet[vnet_id] = fw

        gw_by_vnet = defaultdict(list)  # vnet_id_lower → [gateway records]
        for gw in gateways:
            vnet_id = _extract_vnet_id_from_subnet(gw.get("subnetId", ""))
            if vnet_id:
                gw_by_vnet[vnet_id].append(gw)

        nva_by_vnet = defaultdict(list)  # vnet_id_lower → [NVA NIC records]
        for nic in nva_nics:
            vnet_id = _extract_vnet_id_from_subnet(nic.get("subnetId", ""))
            if vnet_id:
                nva_by_vnet[vnet_id].append(nic)

        # ── Parse VNets and classify hub vs spoke ────────────────────
        vnet_map = {}  # id_lower → vnet enriched record
        for vnet in vnets:
            vid = (vnet.get("id") or "").lower()
            loc = (vnet.get("location") or "").lower()
            peerings_raw = vnet.get("peerings") or []
            subnets_raw = vnet.get("subnets") or []

            # Parse subnets
            subnet_names = []
            special_subnets = []
            for s in subnets_raw:
                sname = (s.get("name") or "")
                sprops = s.get("properties") or {}
                subnet_names.append(sname)
                prefix = sprops.get("addressPrefix", "")
                nsg_id = (sprops.get("networkSecurityGroup") or {}).get("id", "")
                rt_id = (sprops.get("routeTable") or {}).get("id", "")
                delegations = sprops.get("delegations") or []
                deleg_names = [d.get("properties", {}).get("serviceName", "") for d in delegations]
                if sname.lower() in ("azurefirewallsubnet", "azurefirewallmanagementsubnet",
                                      "gatewaysubnet", "azurebastionsubnet", "routeserversubnet"):
                    special_subnets.append(sname)
                subnet_names.append(sname)

            # Parse peerings
            peering_list = []
            for p in peerings_raw:
                pprops = p.get("properties") or {}
                remote_id = ((pprops.get("remoteVirtualNetwork") or {}).get("id") or "").lower()
                peering_state = pprops.get("peeringState", "Unknown")
                peering_sync = pprops.get("peeringSyncLevel", "")
                allow_gw_transit = pprops.get("allowGatewayTransit", False)
                use_remote_gw = pprops.get("useRemoteGateways", False)
                allow_forwarded = pprops.get("allowForwardedTraffic", False)
                allow_vnet_access = pprops.get("allowVirtualNetworkAccess", True)
                remote_loc = (pprops.get("remoteVirtualNetwork", {}).get("location") or
                              pprops.get("remoteAddressSpace", {}).get("location") or "")

                # Determine if global peering (cross-region)
                is_global = False
                remote_name = remote_id.split("/")[-1] if remote_id else ""

                peering_list.append({
                    "remote_vnet_id": remote_id,
                    "remote_vnet_name": remote_name,
                    "state": peering_state,
                    "sync_level": peering_sync,
                    "allow_gateway_transit": allow_gw_transit,
                    "use_remote_gateways": use_remote_gw,
                    "allow_forwarded_traffic": allow_forwarded,
                    "allow_vnet_access": allow_vnet_access,
                })

                # Track peering health
                topology["peering_health"]["total"] += 1
                st = peering_state.lower()
                if st == "connected":
                    topology["peering_health"]["connected"] += 1
                elif st == "disconnected":
                    topology["peering_health"]["disconnected"] += 1
                elif st == "initiated":
                    topology["peering_health"]["initiated"] += 1

            has_firewall = vid in fw_by_vnet
            has_gateway = vid in gw_by_vnet
            has_nva = vid in nva_by_vnet
            has_bastion = "AzureBastionSubnet" in [s for s in special_subnets]
            has_fw_subnet = "AzureFirewallSubnet" in [s for s in special_subnets]
            has_gw_subnet = "GatewaySubnet" in [s for s in special_subnets]

            # Hub score: VNets with firewall/NVA/gateway + peerings are hubs
            hub_score = 0
            if has_firewall:
                hub_score += 40
            if has_nva:
                hub_score += 30
            if has_gateway:
                hub_score += 25
            if has_bastion:
                hub_score += 5
            if has_fw_subnet:
                hub_score += 10
            if has_gw_subnet:
                hub_score += 10
            if len(peering_list) >= 2:
                hub_score += 15
            if len(peering_list) >= 5:
                hub_score += 10

            fw_detail = fw_by_vnet.get(vid)
            gw_details = gw_by_vnet.get(vid, [])
            nva_details = nva_by_vnet.get(vid, [])

            vnet_record = {
                "id": vid,
                "name": vnet.get("name", ""),
                "resource_group": vnet.get("resourceGroup", ""),
                "location": loc,
                "subscription_id": vnet.get("subscriptionId", ""),
                "address_prefixes": vnet.get("addressPrefixes") or [],
                "subnet_count": len(subnets_raw),
                "subnet_names": list(set(subnet_names)),
                "special_subnets": special_subnets,
                "peering_count": len(peering_list),
                "peerings": peering_list,
                "has_firewall": has_firewall,
                "has_gateway": has_gateway,
                "has_nva": has_nva,
                "has_bastion": has_bastion,
                "has_ddos": vnet.get("enableDdosProtection", False),
                "hub_score": hub_score,
                "role": "hub" if hub_score >= 40 else "spoke" if len(peering_list) > 0 else "standalone",
                "tags": vnet.get("tags") or {},
            }

            # Add firewall details
            if fw_detail:
                vnet_record["firewall"] = {
                    "name": fw_detail.get("name", ""),
                    "sku_tier": fw_detail.get("skuTier", ""),
                    "private_ip": fw_detail.get("privateIp", ""),
                    "threat_intel_mode": fw_detail.get("threatIntelMode", ""),
                    "policy_id": fw_detail.get("firewallPolicy", ""),
                }

            # Add gateway details
            if gw_details:
                vnet_record["gateways"] = [{
                    "name": gw.get("name", ""),
                    "type": gw.get("gatewayType", ""),
                    "sku": gw.get("skuName", ""),
                    "vpn_type": gw.get("vpnType", ""),
                    "active_active": gw.get("activeActive", False),
                    "bgp_enabled": gw.get("enableBgp", False),
                } for gw in gw_details]

            # Add NVA details
            if nva_details:
                vnet_record["nvas"] = [{
                    "nic_name": n.get("name", ""),
                    "vm_id": n.get("vmId", ""),
                    "private_ip": n.get("privateIp", ""),
                } for n in nva_details]

            vnet_map[vid] = vnet_record

        # ── Classify and resolve hub-spoke relationships ─────────────
        hubs = {vid: v for vid, v in vnet_map.items() if v["role"] == "hub"}
        spokes = {}
        standalone = {}

        for vid, v in vnet_map.items():
            if v["role"] == "hub":
                continue
            # Find which hub this VNet peers with
            connected_hub = None
            for p in v["peerings"]:
                if p["remote_vnet_id"] in hubs:
                    connected_hub = p["remote_vnet_id"]
                    break
            if connected_hub:
                v["role"] = "spoke"
                v["connected_hub"] = hubs[connected_hub]["name"]
                v["connected_hub_region"] = hubs[connected_hub]["location"]
                v["uses_remote_gateway"] = any(p.get("use_remote_gateways") for p in v["peerings"]
                                                if p["remote_vnet_id"] == connected_hub)
                v["allows_forwarded"] = any(p.get("allow_forwarded_traffic") for p in v["peerings"]
                                            if p["remote_vnet_id"] == connected_hub)
                spokes[vid] = v
            else:
                v["role"] = "standalone"
                standalone[vid] = v

        # ── Detect multi-region hub topology ─────────────────────────
        hub_regions = list(set(h["location"] for h in hubs.values()))
        multi_region = len(hub_regions) > 1

        # Detect global (cross-region) peerings between hubs
        global_peerings = []
        regional_peerings = []
        for vid, hub in hubs.items():
            for p in hub["peerings"]:
                remote_id = p["remote_vnet_id"]
                if remote_id in hubs:
                    remote_hub = hubs[remote_id]
                    link = {
                        "hub_a": hub["name"],
                        "hub_a_region": hub["location"],
                        "hub_b": remote_hub["name"],
                        "hub_b_region": remote_hub["location"],
                        "state": p["state"],
                        "gateway_transit": p["allow_gateway_transit"],
                    }
                    if hub["location"] != remote_hub["location"]:
                        global_peerings.append(link)
                    else:
                        regional_peerings.append(link)

        # Deduplicate bi-directional peerings
        seen_pairs = set()
        deduped_global = []
        for gp in global_peerings:
            pair = tuple(sorted([gp["hub_a"], gp["hub_b"]]))
            if pair not in seen_pairs:
                seen_pairs.add(pair)
                deduped_global.append(gp)
        deduped_regional = []
        seen_pairs = set()
        for rp in regional_peerings:
            pair = tuple(sorted([rp["hub_a"], rp["hub_b"]]))
            if pair not in seen_pairs:
                seen_pairs.add(pair)
                deduped_regional.append(rp)

        # ── Route table analysis (UDR → Firewall/NVA) ────────────────
        all_fw_ips = set()
        for fw in firewalls:
            ip = fw.get("privateIp", "")
            if ip:
                all_fw_ips.add(ip)
        all_nva_ips = set()
        for nic in nva_nics:
            ip = nic.get("privateIp", "")
            if ip:
                all_nva_ips.add(ip)

        routes_to_fw = 0
        routes_to_nva = 0
        routes_to_internet = 0
        routes_to_none = 0
        default_routes_to_fw = 0
        rt_details = []

        for rt in route_tables:
            routes = rt.get("routes") or []
            assoc_subnets = rt.get("associatedSubnets") or []
            rt_record = {
                "name": rt.get("name", ""),
                "location": rt.get("location", ""),
                "resource_group": rt.get("resourceGroup", ""),
                "associated_subnet_count": len(assoc_subnets),
                "disable_bgp_propagation": rt.get("disableBgpRoutePropagation", False),
                "route_count": len(routes),
                "has_default_to_fw": False,
                "has_default_to_nva": False,
                "routes_summary": [],
            }

            for route in routes:
                rprops = route.get("properties") or {}
                prefix = rprops.get("addressPrefix", "")
                next_hop_type = (rprops.get("nextHopType") or "").lower()
                next_hop_ip = rprops.get("nextHopIpAddress", "")
                is_default = prefix in ("0.0.0.0/0", "0/0")

                rt_record["routes_summary"].append({
                    "prefix": prefix,
                    "next_hop_type": next_hop_type,
                    "next_hop_ip": next_hop_ip,
                })

                if next_hop_type == "virtualappliance" and next_hop_ip:
                    if next_hop_ip in all_fw_ips:
                        routes_to_fw += 1
                        if is_default:
                            default_routes_to_fw += 1
                            rt_record["has_default_to_fw"] = True
                    elif next_hop_ip in all_nva_ips:
                        routes_to_nva += 1
                        if is_default:
                            rt_record["has_default_to_nva"] = True
                    else:
                        routes_to_nva += 1  # assume NVA if IP forwarding target
                elif next_hop_type == "internet":
                    routes_to_internet += 1
                elif next_hop_type == "none":
                    routes_to_none += 1

            rt_details.append(rt_record)

        route_analysis = {
            "total_route_tables": len(route_tables),
            "routes_to_firewall": routes_to_fw,
            "routes_to_nva": routes_to_nva,
            "default_routes_to_firewall": default_routes_to_fw,
            "routes_to_internet": routes_to_internet,
            "routes_to_none_blackhole": routes_to_none,
            "route_tables": rt_details[:20],
        }

        # ── Connectivity gap detection ────────────────────────────────
        gaps = []

        # Spokes without UDR to firewall
        for vid, spoke in spokes.items():
            hub_name = spoke.get("connected_hub", "")
            if hub_name:
                hub_vnet = next((h for h in hubs.values() if h["name"] == hub_name), None)
                if hub_vnet and hub_vnet.get("has_firewall") and not spoke.get("uses_remote_gateway"):
                    # Check if any route tables for this spoke have default route to FW
                    # (simplified: check by address overlap)
                    gaps.append({
                        "type": "spoke_no_forced_tunnel",
                        "severity": "High",
                        "vnet": spoke["name"],
                        "region": spoke["location"],
                        "detail": f"Spoke VNet '{spoke['name']}' peers with hub '{hub_name}' (has firewall) but may not force-tunnel traffic through it. Verify UDR 0.0.0.0/0 → firewall IP.",
                    })

        # Hubs without firewall or NVA
        for vid, hub in hubs.items():
            if not hub["has_firewall"] and not hub["has_nva"]:
                gaps.append({
                    "type": "hub_no_central_firewall",
                    "severity": "Critical",
                    "vnet": hub["name"],
                    "region": hub["location"],
                    "detail": f"Hub VNet '{hub['name']}' has {hub['peering_count']} peerings but no Azure Firewall or NVA. All east-west traffic is unfiltered.",
                })

        # Multi-region without global peering
        if multi_region and not deduped_global:
            gaps.append({
                "type": "multi_region_no_global_peering",
                "severity": "Critical",
                "vnet": "",
                "region": ", ".join(hub_regions),
                "detail": f"Hubs exist in {len(hub_regions)} regions ({', '.join(hub_regions)}) but no global VNet peering between them. Regions are network-isolated.",
            })

        # Hubs without VPN/ER gateway (no on-prem connectivity)
        for vid, hub in hubs.items():
            if not hub["has_gateway"]:
                gaps.append({
                    "type": "hub_no_gateway",
                    "severity": "Medium",
                    "vnet": hub["name"],
                    "region": hub["location"],
                    "detail": f"Hub VNet '{hub['name']}' has no VPN or ExpressRoute gateway. On-premises connectivity not available from this hub.",
                })

        # VNets without any peering (isolated)
        for vid, sv in standalone.items():
            gaps.append({
                "type": "isolated_vnet",
                "severity": "Medium",
                "vnet": sv["name"],
                "region": sv["location"],
                "detail": f"VNet '{sv['name']}' has no peerings — completely isolated from the rest of the network.",
            })

        # Disconnected peerings
        if topology["peering_health"]["disconnected"] > 0:
            gaps.append({
                "type": "disconnected_peerings",
                "severity": "High",
                "vnet": "",
                "region": "",
                "detail": f"{topology['peering_health']['disconnected']} VNet peering(s) are in Disconnected state — traffic cannot flow.",
            })

        # ── Determine overall topology type ───────────────────────────
        if len(hubs) == 0 and len(vnets) <= 2:
            topo_type = "Simple/Flat"
        elif len(hubs) == 0:
            topo_type = "Multi-VNet (No Hub)"
        elif multi_region and deduped_global:
            topo_type = "Multi-Region Hub-Spoke (Global Peering)"
        elif multi_region:
            topo_type = "Multi-Region Hub-Spoke (Disconnected Hubs)"
        elif len(hubs) == 1:
            topo_type = "Hub-Spoke (Single Hub)"
        elif len(hubs) > 1:
            topo_type = "Multi-Hub (Same Region)"
        else:
            topo_type = "Custom"

        # Compact hub summaries (for AI context)
        hub_summaries = []
        for vid, h in hubs.items():
            summary = {
                "name": h["name"],
                "region": h["location"],
                "address_space": h["address_prefixes"],
                "spoke_count": sum(1 for s in spokes.values() if s.get("connected_hub") == h["name"]),
                "spokes": [s["name"] for s in spokes.values() if s.get("connected_hub") == h["name"]],
                "has_firewall": h["has_firewall"],
                "has_nva": h["has_nva"],
                "has_vpn_gateway": any(gw.get("type", "").lower() == "vpn" for gw in (h.get("gateways") or [])),
                "has_er_gateway": any(gw.get("type", "").lower() == "expressroute" for gw in (h.get("gateways") or [])),
                "has_bastion": h["has_bastion"],
                "has_ddos": h["has_ddos"],
                "subnet_count": h["subnet_count"],
                "special_subnets": h["special_subnets"],
            }
            if h.get("firewall"):
                summary["firewall_sku"] = h["firewall"]["sku_tier"]
                summary["firewall_ip"] = h["firewall"]["private_ip"]
                summary["threat_intel"] = h["firewall"]["threat_intel_mode"]
            if h.get("gateways"):
                summary["gateways"] = h["gateways"]
            if h.get("nvas"):
                summary["nva_count"] = len(h["nvas"])
                summary["nva_ips"] = [n["private_ip"] for n in h["nvas"]]
            hub_summaries.append(summary)

        spoke_summaries = []
        for vid, s in spokes.items():
            spoke_summaries.append({
                "name": s["name"],
                "region": s["location"],
                "address_space": s["address_prefixes"],
                "connected_hub": s.get("connected_hub", ""),
                "uses_remote_gateway": s.get("uses_remote_gateway", False),
                "allows_forwarded": s.get("allows_forwarded", False),
                "subnet_count": s["subnet_count"],
                "has_nva": s["has_nva"],
            })

        topology.update({
            "hubs": hub_summaries,
            "spokes": spoke_summaries,
            "standalone_vnets": [{"name": v["name"], "region": v["location"],
                                   "address_space": v["address_prefixes"]}
                                  for v in standalone.values()],
            "global_peerings": deduped_global,
            "regional_peerings": deduped_regional,
            "multi_region": multi_region,
            "hub_regions": hub_regions,
            "topology_type": topo_type,
            "route_analysis": route_analysis,
            "nva_appliances": [{"vm_id": n.get("vmId", ""), "private_ip": n.get("privateIp", ""),
                                 "location": n.get("location", "")} for n in nva_nics],
            "firewall_details": [{
                "name": fw.get("name", ""),
                "region": fw.get("location", ""),
                "sku_tier": fw.get("skuTier", ""),
                "private_ip": fw.get("privateIp", ""),
                "threat_intel": fw.get("threatIntelMode", ""),
                "policy": (fw.get("firewallPolicy") or "").split("/")[-1] if fw.get("firewallPolicy") else "",
            } for fw in firewalls],
            "gateway_details": [{
                "name": gw.get("name", ""),
                "region": gw.get("location", ""),
                "type": gw.get("gatewayType", ""),
                "sku": gw.get("skuName", ""),
                "active_active": gw.get("activeActive", False),
                "bgp_enabled": gw.get("enableBgp", False),
            } for gw in gateways],
            "er_circuits": [{
                "name": erc.get("name", ""),
                "provider": erc.get("serviceProviderName", ""),
                "peering_location": erc.get("peeringLocation", ""),
                "bandwidth_mbps": erc.get("bandwidthInMbps", 0),
                "sku_tier": erc.get("skuTier", ""),
                "state": erc.get("circuitProvisioningState", ""),
            } for erc in er_circuits],
            "fw_policies": [{
                "name": p.get("name", ""),
                "sku": p.get("sku", ""),
                "threat_intel": p.get("threatIntelMode", ""),
                "idps_enabled": bool(p.get("intrusionDetection")),
                "tls_inspection": bool(p.get("transportSecurity")),
                "dns_proxy": bool(p.get("dnsSettings")),
            } for p in fw_policies],
            "connectivity_gaps": gaps,
        })

        logger.info(
            "Advanced topology: type=%s, hubs=%d, spokes=%d, standalone=%d, global_peerings=%d, gaps=%d",
            topo_type, len(hubs), len(spokes), len(standalone), len(deduped_global), len(gaps),
        )

    except Exception as exc:
        logger.error("Advanced topology detection failed (non-fatal): %s", exc, exc_info=True)
        topology["error"] = str(exc)

    return topology
