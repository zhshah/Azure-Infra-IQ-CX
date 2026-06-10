"""
Resilience Service — Server-side port of the 6 resilience rules from ResiliencePanel.jsx.

Adds full resource attribution (resource_id, resource_group, subscription_id) to each
finding so the frontend can link directly to the Resource Detail Drawer.
"""
from __future__ import annotations

import logging
from typing import List, Any

logger = logging.getLogger(__name__)


def _r(resource: Any) -> dict:
    """Normalise resource to plain dict."""
    if isinstance(resource, dict):
        return resource
    if hasattr(resource, "model_dump"):
        return resource.model_dump()
    if hasattr(resource, "__dict__"):
        return resource.__dict__
    return {}


def analyze_resilience(resources: List[Any]) -> dict:
    """
    Run all 6 resilience rules against the resource list.

    Returns:
        {
            "score": 0-100,
            "risk_level": "Critical|High|Medium|Low",
            "total_findings": int,
            "findings": [...]
        }

    Each finding includes:
        resource_id, resource_name, resource_type, resource_group,
        subscription_id, risk, category, description, recommendation,
        cost_usd, az_link
    """
    resources = [_r(r) for r in resources]
    findings: list = []

    # ── Rule 1: Single-instance VMs ───────────────────────────────────────────
    vms_by_rg: dict = {}
    for r in resources:
        if "microsoft.compute/virtualmachines" in r.get("resource_type", "").lower():
            key = f"{r.get('subscription_id', '')}/{r.get('resource_group', '')}"
            vms_by_rg.setdefault(key, []).append(r)
    for key, vms in vms_by_rg.items():
        if len(vms) == 1:
            vm = vms[0]
            findings.append({
                "id": vm.get("resource_id") or vm.get("resource_name"),
                "resource_id": vm.get("resource_id", ""),
                "resource_name": vm.get("resource_name", ""),
                "resource_type": vm.get("resource_type", "Microsoft.Compute/virtualMachines"),
                "resource_group": vm.get("resource_group", ""),
                "subscription_id": vm.get("subscription_id", ""),
                "type": "Virtual Machine",
                "risk": "High",
                "category": "Single Instance",
                "icon": "🖥️",
                "description": (
                    f'"{vm.get("resource_name")}" is the only VM in resource group '
                    f'"{vm.get("resource_group")}". A failure means full service outage — '
                    "no redundancy exists."
                ),
                "recommendation": (
                    "Add a second VM instance, or migrate to Azure Virtual Machine Scale Sets "
                    "with 2+ instances spread across Availability Zones."
                ),
                "az_link": "https://learn.microsoft.com/azure/virtual-machine-scale-sets/overview",
                "cost_usd": round(vm.get("cost_current_month", 0), 2),
            })

    # ── Rule 2: Storage without geo-replication (LRS only) ────────────────────
    import re
    for r in resources:
        if "microsoft.storage/storageaccounts" not in r.get("resource_type", "").lower():
            continue
        sku = r.get("sku") or ""
        if re.search(r"lrs", sku, re.IGNORECASE) and not re.search(r"grs|gzrs|zrs", sku, re.IGNORECASE):
            findings.append({
                "id": r.get("resource_id") or r.get("resource_name"),
                "resource_id": r.get("resource_id", ""),
                "resource_name": r.get("resource_name", ""),
                "resource_type": r.get("resource_type", "Microsoft.Storage/storageAccounts"),
                "resource_group": r.get("resource_group", ""),
                "subscription_id": r.get("subscription_id", ""),
                "type": "Storage Account",
                "risk": "Medium",
                "category": "No Geo-Replication",
                "icon": "💾",
                "description": (
                    f'"{r.get("resource_name")}" uses {sku or "LRS"} — locally redundant only. '
                    "A datacenter-level failure could result in permanent data loss."
                ),
                "recommendation": (
                    "Upgrade to GRS (Geo-Redundant Storage) or RAGRS for read-access. "
                    "Use GZRS for combined zone + geo protection on critical data."
                ),
                "az_link": "https://learn.microsoft.com/azure/storage/common/storage-redundancy",
                "cost_usd": round(r.get("cost_current_month", 0), 2),
            })

    # ── Rule 3: Unmonitored VMs (no metric data, score_label = Unknown) ───────
    for r in resources:
        if "microsoft.compute/virtualmachines" not in r.get("resource_type", "").lower():
            continue
        label = r.get("score_label", "")
        label_str = label.value if hasattr(label, "value") else str(label)
        if label_str.lower() == "unknown":
            findings.append({
                "id": f"unmonitored-{r.get('resource_id') or r.get('resource_name')}",
                "resource_id": r.get("resource_id", ""),
                "resource_name": r.get("resource_name", ""),
                "resource_type": r.get("resource_type", "Microsoft.Compute/virtualMachines"),
                "resource_group": r.get("resource_group", ""),
                "subscription_id": r.get("subscription_id", ""),
                "type": "Virtual Machine",
                "risk": "Medium",
                "category": "Unmonitored Compute",
                "icon": "👁️",
                "description": (
                    f'"{r.get("resource_name")}" has no performance metrics available. '
                    "Failures, degradation, and capacity issues will go undetected."
                ),
                "recommendation": (
                    "Enable Azure Monitor, install the Azure Monitor Agent, and configure metric alerts "
                    "for CPU > 80%, available memory < 10%, and disk latency."
                ),
                "az_link": "https://learn.microsoft.com/azure/azure-monitor/agents/azure-monitor-agent-overview",
                "cost_usd": round(r.get("cost_current_month", 0), 2),
            })

    # ── Rule 4: Resource groups with 2+ VMs but no load balancer ─────────────
    rg_resources: dict = {}
    for r in resources:
        key = f"{r.get('subscription_id', '')}/{r.get('resource_group', '')}"
        rg_resources.setdefault(key, []).append(r)
    for key, rlist in rg_resources.items():
        vms = [r for r in rlist if "microsoft.compute/virtualmachines" in r.get("resource_type", "").lower()]
        has_lb = any(
            "microsoft.network/loadbalancers" in r.get("resource_type", "").lower() or
            "microsoft.network/applicationgateways" in r.get("resource_type", "").lower()
            for r in rlist
        )
        if len(vms) >= 2 and not has_lb:
            rg = key.split("/", 1)[-1]
            # Use the first VM's subscription_id as representative
            sub_id = vms[0].get("subscription_id", "")
            findings.append({
                "id": f"no-lb-{key}",
                "resource_id": "",
                "resource_name": rg,
                "resource_type": "Resource Group",
                "resource_group": rg,
                "subscription_id": sub_id,
                "type": "Resource Group",
                "risk": "High",
                "category": "No Load Balancer",
                "icon": "⚖️",
                "description": (
                    f'Resource group "{rg}" has {len(vms)} VMs but no Load Balancer or Application Gateway. '
                    "Traffic is not distributed — a single VM failure will cause service disruption."
                ),
                "recommendation": (
                    "Add an Azure Load Balancer (Layer 4) or Azure Application Gateway (Layer 7) "
                    "to distribute traffic and enable automatic failover across the VM instances."
                ),
                "az_link": "https://learn.microsoft.com/azure/load-balancer/load-balancer-overview",
                "cost_usd": round(sum(v.get("cost_current_month", 0) for v in vms), 2),
                "affected_vms": [
                    {
                        "resource_id": v.get("resource_id", ""),
                        "resource_name": v.get("resource_name", ""),
                        "resource_group": v.get("resource_group", ""),
                        "subscription_id": v.get("subscription_id", ""),
                    }
                    for v in vms
                ],
            })

    # ── Rule 5: Region concentration risk (>80% resources in one region) ──────
    region_count: dict = {}
    for r in resources:
        loc = r.get("location", "")
        if loc:
            region_count[loc] = region_count.get(loc, 0) + 1
    total_with_region = sum(region_count.values())
    if total_with_region >= 5:
        top_region, top_count = max(region_count.items(), key=lambda x: x[1])
        pct = round(top_count / total_with_region * 100)
        if pct >= 80:
            findings.append({
                "id": "region-concentration",
                "resource_id": "",
                "resource_name": top_region,
                "resource_type": "Topology",
                "resource_group": "Estate-wide",
                "subscription_id": "",
                "type": "Topology",
                "risk": "Medium",
                "category": "Region Concentration",
                "icon": "🌍",
                "description": (
                    f"{pct}% of your estate ({top_count}/{total_with_region} resources) is deployed "
                    f"in {top_region}. A regional outage would affect the vast majority of your workloads."
                ),
                "recommendation": (
                    "Replicate critical workloads to a paired Azure region. "
                    "Use Azure Traffic Manager or Azure Front Door for geo-failover routing."
                ),
                "az_link": "https://learn.microsoft.com/azure/reliability/cross-region-replication-azure",
                "cost_usd": 0,
            })

    # ── Rule 6: SQL databases on Basic/S0/S1 tier (limited backup retention) ──
    for r in resources:
        rtype = r.get("resource_type", "").lower()
        if not ("microsoft.sql/servers/databases" in rtype or "sql" in rtype):
            continue
        sku = r.get("sku") or ""
        if re.search(r"basic|s0|s1", sku, re.IGNORECASE):
            findings.append({
                "id": f"sql-backup-{r.get('resource_id') or r.get('resource_name')}",
                "resource_id": r.get("resource_id", ""),
                "resource_name": r.get("resource_name", ""),
                "resource_type": r.get("resource_type", "Microsoft.Sql/servers/databases"),
                "resource_group": r.get("resource_group", ""),
                "subscription_id": r.get("subscription_id", ""),
                "type": "SQL Database",
                "risk": "Medium",
                "category": "Limited Backup Retention",
                "icon": "🗄️",
                "description": (
                    f'"{r.get("resource_name")}" is on the {sku} tier, which provides only 7 days of '
                    "backup retention. Data recovery beyond one week is not possible."
                ),
                "recommendation": (
                    "Upgrade to Standard S2+ or General Purpose tier for 35-day retention, "
                    "or configure long-term backup retention for compliance requirements."
                ),
                "az_link": "https://learn.microsoft.com/azure/azure-sql/database/long-term-retention-overview",
                "cost_usd": round(r.get("cost_current_month", 0), 2),
            })

    # Sort: Critical → High → Medium → Low
    order = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}
    findings.sort(key=lambda f: order.get(f.get("risk", "Low"), 4))

    # Compute score
    critical = sum(1 for f in findings if f.get("risk") == "Critical")
    high = sum(1 for f in findings if f.get("risk") == "High")
    medium = sum(1 for f in findings if f.get("risk") == "Medium")
    penalty = critical * 20 + high * 10 + medium * 5
    score = max(0, min(100, 100 - penalty))

    risk_level = (
        "Critical" if critical > 0 or score < 30
        else "High" if high > 2 or score < 55
        else "Medium" if medium > 3 or score < 75
        else "Low"
    )

    return {
        "score": score,
        "risk_level": risk_level,
        "total_findings": len(findings),
        "critical_count": critical,
        "high_count": high,
        "medium_count": medium,
        "low_count": sum(1 for f in findings if f.get("risk") == "Low"),
        "findings": findings,
    }
