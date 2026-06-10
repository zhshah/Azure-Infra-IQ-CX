"""
licensing_service.py — Azure licensing, reservation & commercial optimisation.

Surfaces:
  - Reserved Instance gaps and planning
  - Azure Hybrid Benefit candidates (Windows, SQL)
  - BYOL (Bring Your Own License) tracking — VMware, Oracle, RHEL, etc.
  - Reservation coverage analysis with uncovered resource detection
  - Spot-eligible workloads and burstable VM downsizing opportunities
  - Savings Plan recommendations
"""
from __future__ import annotations
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from models.schemas import ResourceMetrics, LicensingOpportunity

logger = logging.getLogger(__name__)

_VM_TYPES = {"microsoft.compute/virtualmachines", "microsoft.compute/virtualmachinescalesets"}
_SPOT_BURSTABLE_MIN_CPU_DAYS = 7   # need some CPU data to flag spot/burstable


def _normalise_type(t: str) -> str:
    return t.lower().strip()


def _is_vm(r: ResourceMetrics) -> bool:
    return _normalise_type(r.resource_type) in _VM_TYPES


def _looks_sql(r: ResourceMetrics) -> bool:
    name_lower = (r.resource_name or "").lower()
    tags_lower = " ".join(str(v) for v in r.tags.values()).lower()
    sql_kw = ("sql", "sqlserver", "sqlsrv", "mssql", "database")
    return any(kw in name_lower or kw in tags_lower for kw in sql_kw)


def _monthly_cost(r: ResourceMetrics) -> float:
    return r.cost_current_month or r.cost_previous_month or 0.0


# ── Opportunity detectors ──────────────────────────────────────────────────────

def _detect_reserved_instance_gaps(resources: List[ResourceMetrics]) -> List[LicensingOpportunity]:
    """
    VMs that are RI-eligible (flagged by the scoring service) but not covered
    by an active reservation. Buying a 1-year RI saves ~30–40% vs pay-as-you-go.
    """
    opps: List[LicensingOpportunity] = []
    for r in resources:
        if not _is_vm(r):
            continue
        if not r.ri_eligible:
            continue
        if r.ri_covered:
            continue   # already on a reservation
        monthly = _monthly_cost(r)
        if monthly < 10:
            continue   # not worth the recommendation noise

        saving_1yr = r.ri_1yr_monthly_savings or monthly * 0.30
        saving_3yr = r.ri_3yr_monthly_savings or monthly * 0.40

        opps.append(LicensingOpportunity(
            opportunity_type="reserved_instance",
            resource_id=r.resource_id,
            resource_name=r.resource_name,
            resource_type=r.resource_type,
            resource_group=r.resource_group,
            subscription_id=r.subscription_id,
            current_sku=r.sku or "",
            description=(
                f"VM '{r.resource_name}' ({r.sku or 'unknown SKU'}) is running consistently "
                f"and is eligible for Reserved Instances. "
                f"1-year RI saves ~${saving_1yr:.0f}/mo; 3-year saves ~${saving_3yr:.0f}/mo."
            ),
            estimated_monthly_saving=round(saving_1yr, 2),
            confidence="high",
            implementation=(
                "Purchase a VM Reserved Instance in the Azure Portal under "
                "'Cost Management + Billing → Reservations'. Scope to the subscription or resource group."
            ),
            az_cli=(
                f"# View RI recommendations for this VM size\n"
                f"az reservations reservation-order list --query "
                f"\"[?contains(skuName, '{r.sku or 'Standard_D2s_v3'}')] | [0]\" "
                f"--subscription {r.subscription_id}"
            ),
        ))
    return opps


def _detect_ahub_sql_vms(resources: List[ResourceMetrics]) -> List[LicensingOpportunity]:
    """
    VMs identified as SQL Server hosts that may benefit from Azure Hybrid Benefit
    for SQL Server (requires active Software Assurance). Saves 20–40%.
    """
    opps: List[LicensingOpportunity] = []
    for r in resources:
        if not _is_vm(r):
            continue
        if not _looks_sql(r):
            continue
        monthly = _monthly_cost(r)
        if monthly < 20:
            continue

        # SQL AHUB saves approximately 25% on the VM licence component.
        # We estimate that ~40% of VM cost is licence, 25% saving → ~10% total saving.
        saving = round(monthly * 0.10, 2)
        opps.append(LicensingOpportunity(
            opportunity_type="ahub_sql",
            resource_id=r.resource_id,
            resource_name=r.resource_name,
            resource_type=r.resource_type,
            resource_group=r.resource_group,
            subscription_id=r.subscription_id,
            current_sku=r.sku or "",
            description=(
                f"VM '{r.resource_name}' appears to be running SQL Server. "
                "If you hold active SQL Server Software Assurance licences, "
                "Azure Hybrid Benefit (AHUB) for SQL can reduce licensing costs by up to 40%."
            ),
            estimated_monthly_saving=saving,
            confidence="medium",
            implementation=(
                "In the Azure Portal, navigate to the VM → Configuration → "
                "'SQL Server licence type' and set to 'Azure Hybrid Benefit'. "
                "Requires active Microsoft Software Assurance coverage."
            ),
            az_cli=(
                f"az sql vm update --name {r.resource_name} "
                f"--resource-group {r.resource_group} "
                "--license-type AHUB"
            ),
        ))
    return opps


def _detect_ahub_windows_vms(resources: List[ResourceMetrics]) -> List[LicensingOpportunity]:
    """
    VMs that likely run Windows Server and could use AHUB for Windows.
    Heuristic: SKU names that are *not* Linux-specific (no 'ubuntu', 'debian', etc.)
    and cost more than a threshold suggest Windows licensing.
    Saves ~15% of total VM cost on average.
    """
    LINUX_MARKERS = ("ubuntu", "debian", "centos", "redhat", "rhel", "suse", "linux", "cbl-mariner")
    opps: List[LicensingOpportunity] = []
    for r in resources:
        if not _is_vm(r):
            continue
        if _looks_sql(r):
            continue   # handled by AHUB SQL detector
        sku_lower  = (r.sku or "").lower()
        name_lower = (r.resource_name or "").lower()
        # Skip if any Linux marker found
        if any(m in sku_lower or m in name_lower for m in LINUX_MARKERS):
            continue
        monthly = _monthly_cost(r)
        if monthly < 30:
            continue   # too small to bother

        saving = round(monthly * 0.15, 2)
        opps.append(LicensingOpportunity(
            opportunity_type="ahub_windows",
            resource_id=r.resource_id,
            resource_name=r.resource_name,
            resource_type=r.resource_type,
            resource_group=r.resource_group,
            subscription_id=r.subscription_id,
            current_sku=r.sku or "",
            description=(
                f"VM '{r.resource_name}' may be running Windows Server. "
                "With active Windows Server Software Assurance, "
                "Azure Hybrid Benefit can reduce the OS licence cost by up to 49%."
            ),
            estimated_monthly_saving=saving,
            confidence="medium",
            implementation=(
                "In Azure Portal → VM → Configuration → 'Already have a Windows Server licence?' "
                "set to 'Yes'. Or apply in bulk via Azure Policy."
            ),
            az_cli=(
                f"az vm update --name {r.resource_name} "
                f"--resource-group {r.resource_group} "
                "--license-type Windows_Server"
            ),
        ))
    return opps


def _detect_spot_eligible(resources: List[ResourceMetrics]) -> List[LicensingOpportunity]:
    """
    VMs with confirmed low utilisation (<20% CPU) that are not protected
    and could run as Spot or Burstable (B-series) instances.
    """
    PROTECTED_PATTERNS = ("prod", "production", "prd", "critical", "db", "sql", "primary")
    opps: List[LicensingOpportunity] = []
    for r in resources:
        if not _is_vm(r):
            continue
        if r.avg_cpu_pct is None:
            continue
        if r.avg_cpu_pct > 20:
            continue
        if r.is_protected:
            continue
        # Skip if name suggests production/critical workload
        name_lower = (r.resource_name or "").lower()
        if any(p in name_lower for p in PROTECTED_PATTERNS):
            continue

        monthly = _monthly_cost(r)
        if monthly < 15:
            continue

        # Spot saves ~60-80%; B-series saves ~30-40%
        spot_saving   = round(monthly * 0.60, 2)
        burst_saving  = round(monthly * 0.30, 2)

        opps.append(LicensingOpportunity(
            opportunity_type="spot_eligible",
            resource_id=r.resource_id,
            resource_name=r.resource_name,
            resource_type=r.resource_type,
            resource_group=r.resource_group,
            subscription_id=r.subscription_id,
            current_sku=r.sku or "",
            description=(
                f"VM '{r.resource_name}' averages {r.avg_cpu_pct:.0f}% CPU — "
                "suitable for Azure Spot (evictable, non-critical) saving ~60%, "
                f"or B-series burstable saving ~30% (${burst_saving:.0f}/mo)."
            ),
            estimated_monthly_saving=burst_saving,
            confidence="medium",
            implementation=(
                "For non-critical workloads: redeploy as Azure Spot VM for maximum savings. "
                "For workloads needing availability: resize to a B-series (burstable) SKU "
                "which credits unused CPU for later bursts."
            ),
            az_cli=(
                f"# Resize to burstable B-series (non-disruptive)\n"
                f"az vm resize --name {r.resource_name} "
                f"--resource-group {r.resource_group} "
                f"--size Standard_B2s"
            ),
        ))
    return opps


def _detect_savings_plan_candidates(resources: List[ResourceMetrics]) -> List[LicensingOpportunity]:
    """
    Identify if there's a meaningful cluster of VMs not covered by any RI/Savings Plan,
    and suggest an Azure Savings Plan for Compute (flexible across SKUs/regions).
    Only emit this once if total uncovered monthly spend is significant.
    """
    uncovered_vms  = [
        r for r in resources
        if _is_vm(r) and not r.ri_covered and _monthly_cost(r) > 20
    ]
    if len(uncovered_vms) < 3:
        return []

    total_monthly = sum(_monthly_cost(r) for r in uncovered_vms)
    if total_monthly < 200:
        return []

    saving = round(total_monthly * 0.12, 2)   # Savings Plan ~12% vs PAYG on average
    return [LicensingOpportunity(
        opportunity_type="savings_plan",
        resource_id="portfolio",
        resource_name="VM Portfolio",
        resource_type="microsoft.compute/virtualmachines",
        resource_group="(multiple)",
        subscription_id="",
        current_sku="Pay-as-you-go",
        description=(
            f"{len(uncovered_vms)} VMs (${total_monthly:.0f}/mo combined) are running on pay-as-you-go pricing "
            "without any coverage commitment. An Azure Savings Plan for Compute provides "
            f"~12% discount automatically across any VM SKU or region."
        ),
        estimated_monthly_saving=saving,
        confidence="high",
        implementation=(
            "Purchase an Azure Savings Plan for Compute in the Azure Portal under "
            "'Cost Management + Billing → Azure Savings Plans'. "
            "Unlike Reservations, Savings Plans apply automatically across any VM SKU, region, or OS."
        ),
        az_cli=(
            "# View Savings Plan purchase recommendations\n"
            "az billing savings-plan-order list --query \"[0]\" 2>/dev/null || "
            "echo 'Use Azure Portal: Cost Management -> Savings Plans'"
        ),
    )]


# ── Main entry-point ───────────────────────────────────────────────────────────

def detect_licensing_opportunities(
    resources: List[ResourceMetrics],
) -> List[LicensingOpportunity]:
    """
    Returns all detected licensing and commercial optimisation opportunities,
    sorted by estimated monthly saving descending.
    """
    opps: List[LicensingOpportunity] = []

    try:
        opps += _detect_reserved_instance_gaps(resources)
    except Exception as e:
        logger.warning("RI gap detection failed: %s", e)

    try:
        opps += _detect_ahub_sql_vms(resources)
    except Exception as e:
        logger.warning("AHUB SQL detection failed: %s", e)

    try:
        opps += _detect_ahub_windows_vms(resources)
    except Exception as e:
        logger.warning("AHUB Windows detection failed: %s", e)

    try:
        opps += _detect_spot_eligible(resources)
    except Exception as e:
        logger.warning("Spot VM detection failed: %s", e)

    try:
        opps += _detect_savings_plan_candidates(resources)
    except Exception as e:
        logger.warning("Savings Plan detection failed: %s", e)

    try:
        opps += _detect_byol_opportunities(resources)
    except Exception as e:
        logger.warning("BYOL detection failed: %s", e)

    # Sort by saving descending, putting the portfolio entry last
    opps.sort(key=lambda o: (-o.estimated_monthly_saving, o.resource_name))
    return opps


# ── BYOL Detector ──────────────────────────────────────────────────────────────

_BYOL_TYPES = {
    "microsoft.avs/privateclouds": {
        "label": "Azure VMware Solution",
        "desc": "AVS nodes include VMware licensing by default. If you hold existing VMware Enterprise "
                "licences with portability rights, you may negotiate BYOL pricing with Microsoft — "
                "reducing per-node costs by 15–25%.",
        "saving_pct": 0.20,
    },
}

_BYOL_SKU_PATTERNS = {
    "rhel": {
        "label": "Red Hat Enterprise Linux",
        "desc": "VM is running RHEL with Azure-included licence. If you hold Red Hat subscriptions "
                "through Red Hat Cloud Access, BYOL eliminates the per-core RHEL premium (~$0.06–$0.13/core/hr).",
        "saving_pct": 0.12,
    },
    "sles": {
        "label": "SUSE Linux Enterprise",
        "desc": "VM is running SLES with Azure-included licence. If you own SUSE subscriptions, "
                "BYOL via SUSE Public Cloud Program can save 10–15% of the VM cost.",
        "saving_pct": 0.10,
    },
    "oracle": {
        "label": "Oracle Database",
        "desc": "VM appears to host Oracle workloads. Oracle Licence Mobility with Software Assurance "
                "allows BYOL on Azure Dedicated Hosts — eliminating per-core Oracle licensing from Azure billing.",
        "saving_pct": 0.25,
    },
}


def _detect_byol_opportunities(resources: List[ResourceMetrics]) -> List[LicensingOpportunity]:
    """
    Detect BYOL (Bring Your Own License) opportunities:
    - Azure VMware Solution nodes
    - RHEL/SLES VMs (Red Hat/SUSE BYOL)
    - Oracle workloads on VMs
    """
    opps: List[LicensingOpportunity] = []

    for r in resources:
        rtype = _normalise_type(r.resource_type)
        monthly = _monthly_cost(r)
        if monthly < 20:
            continue

        # AVS private clouds
        if rtype == "microsoft.avs/privateclouds":
            meta = _BYOL_TYPES[rtype]
            saving = round(monthly * meta["saving_pct"], 2)
            opps.append(LicensingOpportunity(
                opportunity_type="byol_vmware",
                resource_id=r.resource_id,
                resource_name=r.resource_name,
                resource_type=r.resource_type,
                resource_group=r.resource_group,
                subscription_id=r.subscription_id,
                current_sku=r.sku or "",
                description=(
                    f"AVS private cloud '{r.resource_name}' costing ${monthly:.0f}/mo. "
                    f"{meta['desc']}"
                ),
                estimated_monthly_saving=saving,
                confidence="medium",
                implementation=(
                    "Contact your Microsoft account team to discuss VMware BYOL pricing for AVS. "
                    "Requires proof of existing VMware Enterprise Agreement with portability rights. "
                    "Savings are applied at contract renewal or new node purchases."
                ),
                az_cli=(
                    f"# Check AVS node details\n"
                    f"az vmware private-cloud show --name {r.resource_name} "
                    f"--resource-group {r.resource_group} --query '{{sku: sku.name, hosts: managementCluster.hosts}}'"
                ),
            ))
            continue

        # VM-based BYOL (RHEL, SLES, Oracle)
        if rtype in _VM_TYPES:
            sku_lower = (r.sku or "").lower()
            name_lower = (r.resource_name or "").lower()
            tags_lower = " ".join(str(v) for v in r.tags.values()).lower()
            combined = f"{sku_lower} {name_lower} {tags_lower}"

            for pattern, meta in _BYOL_SKU_PATTERNS.items():
                if pattern in combined:
                    saving = round(monthly * meta["saving_pct"], 2)
                    opps.append(LicensingOpportunity(
                        opportunity_type=f"byol_{pattern}",
                        resource_id=r.resource_id,
                        resource_name=r.resource_name,
                        resource_type=r.resource_type,
                        resource_group=r.resource_group,
                        subscription_id=r.subscription_id,
                        current_sku=r.sku or "",
                        description=(
                            f"VM '{r.resource_name}' ({r.sku or 'unknown'}) at ${monthly:.0f}/mo. "
                            f"{meta['desc']}"
                        ),
                        estimated_monthly_saving=saving,
                        confidence="medium",
                        implementation=(
                            f"Verify you hold active {meta['label']} subscriptions with cloud portability rights. "
                            f"Register via the vendor's cloud access program, then convert the VM image to BYOL."
                        ),
                        az_cli=(
                            f"az vm show --name {r.resource_name} "
                            f"--resource-group {r.resource_group} "
                            f"--query '{{licenseType: licenseType, offer: storageProfile.imageReference.offer}}'"
                        ),
                    ))
                    break  # one BYOL per VM

    return opps


# ── Reservation Coverage Analysis ──────────────────────────────────────────────

# Resource types that support Azure Reservations
_RESERVABLE_TYPES = {
    "microsoft.compute/virtualmachines",
    "microsoft.compute/virtualmachinescalesets",
    "microsoft.sql/servers/databases",
    "microsoft.sql/managedinstances",
    "microsoft.sql/servers/elasticpools",
    "microsoft.cache/redis",
    "microsoft.cache/redisenterprise",
    "microsoft.documentdb/databaseaccounts",
    "microsoft.dbforpostgresql/flexibleservers",
    "microsoft.dbformysql/flexibleservers",
    "microsoft.web/serverfarms",
    "microsoft.compute/disks",
    "microsoft.databricks/workspaces",
    "microsoft.synapse/workspaces",
    "microsoft.kusto/clusters",
    "microsoft.compute/dedicatedhosts",
    "microsoft.avs/privateclouds",
    "microsoft.netapp/netappaccounts/capacitypools",
}

# Discount rates by type for 1yr and 3yr RI
_RI_RATES = {
    "microsoft.compute/virtualmachines":             (0.37, 0.57),
    "microsoft.compute/virtualmachinescalesets":     (0.37, 0.57),
    "microsoft.sql/servers/databases":               (0.33, 0.44),
    "microsoft.sql/managedinstances":                (0.33, 0.55),
    "microsoft.sql/servers/elasticpools":            (0.33, 0.44),
    "microsoft.cache/redis":                         (0.37, 0.55),
    "microsoft.cache/redisenterprise":               (0.37, 0.55),
    "microsoft.documentdb/databaseaccounts":         (0.24, 0.48),
    "microsoft.dbforpostgresql/flexibleservers":     (0.33, 0.50),
    "microsoft.dbformysql/flexibleservers":          (0.33, 0.50),
    "microsoft.web/serverfarms":                     (0.35, 0.55),
    "microsoft.compute/disks":                       (0.20, 0.38),
    "microsoft.databricks/workspaces":               (0.40, 0.60),
    "microsoft.synapse/workspaces":                  (0.40, 0.60),
    "microsoft.kusto/clusters":                      (0.22, 0.42),
    "microsoft.compute/dedicatedhosts":              (0.30, 0.45),
    "microsoft.avs/privateclouds":                   (0.28, 0.46),
    "microsoft.netapp/netappaccounts/capacitypools": (0.17, 0.31),
}


def build_reservation_analysis(resources: List[ResourceMetrics]) -> Dict[str, Any]:
    """
    Comprehensive reservation coverage analysis:
    - What's covered vs uncovered
    - Potential savings breakdown by type
    - Reservation planning recommendations
    """
    covered = []
    uncovered = []
    type_summary: Dict[str, Dict[str, Any]] = {}

    for r in resources:
        rtype = _normalise_type(r.resource_type)
        monthly = _monthly_cost(r)
        if monthly < 5:
            continue
        if rtype not in _RESERVABLE_TYPES:
            continue

        entry = {
            "resource_id": r.resource_id,
            "resource_name": r.resource_name,
            "resource_type": r.resource_type,
            "resource_group": r.resource_group,
            "subscription_id": r.subscription_id,
            "sku": r.sku or "",
            "location": r.location,
            "monthly_cost": round(monthly, 2),
            "score": r.final_score,
            "score_label": r.score_label.value if hasattr(r.score_label, 'value') else str(r.score_label),
            "trend": r.trend.value if hasattr(r.trend, 'value') else str(r.trend),
            "ri_covered": r.ri_covered,
        }

        if r.ri_covered:
            covered.append(entry)
        else:
            # Calculate potential savings
            rates = _RI_RATES.get(rtype, (0.30, 0.45))
            entry["saving_1yr"] = round(monthly * rates[0], 2)
            entry["saving_3yr"] = round(monthly * rates[1], 2)
            # Recommend term based on usage pattern
            if r.final_score >= 75 and r.trend.value in ("stable", "rising"):
                entry["recommended_term"] = "3yr"
                entry["recommendation"] = "High-utilisation, stable workload — 3-year RI offers maximum savings."
            elif r.final_score >= 40:
                entry["recommended_term"] = "1yr"
                entry["recommendation"] = "Moderate usage — 1-year RI gives good savings with lower commitment risk."
            else:
                entry["recommended_term"] = "verify"
                entry["recommendation"] = "Low/uncertain usage — verify workload longevity before committing."
            uncovered.append(entry)

        # Type summary
        if rtype not in type_summary:
            type_summary[rtype] = {
                "resource_type": rtype,
                "total_count": 0,
                "covered_count": 0,
                "uncovered_count": 0,
                "total_monthly_spend": 0.0,
                "covered_spend": 0.0,
                "uncovered_spend": 0.0,
                "potential_1yr_saving": 0.0,
                "potential_3yr_saving": 0.0,
            }
        ts = type_summary[rtype]
        ts["total_count"] += 1
        ts["total_monthly_spend"] += monthly
        if r.ri_covered:
            ts["covered_count"] += 1
            ts["covered_spend"] += monthly
        else:
            ts["uncovered_count"] += 1
            ts["uncovered_spend"] += monthly
            ts["potential_1yr_saving"] += entry.get("saving_1yr", 0)
            ts["potential_3yr_saving"] += entry.get("saving_3yr", 0)

    # Round type summary values
    for ts in type_summary.values():
        for k in ("total_monthly_spend", "covered_spend", "uncovered_spend", "potential_1yr_saving", "potential_3yr_saving"):
            ts[k] = round(ts[k], 2)

    # Calculate totals
    total_eligible_spend = sum(ts["total_monthly_spend"] for ts in type_summary.values())
    total_covered_spend = sum(ts["covered_spend"] for ts in type_summary.values())
    total_uncovered_spend = sum(ts["uncovered_spend"] for ts in type_summary.values())
    total_1yr_saving = sum(ts["potential_1yr_saving"] for ts in type_summary.values())
    total_3yr_saving = sum(ts["potential_3yr_saving"] for ts in type_summary.values())
    coverage_pct = (total_covered_spend / total_eligible_spend * 100) if total_eligible_spend > 0 else 0

    # Prioritized purchase plan (top uncovered resources by potential saving)
    purchase_plan = sorted(uncovered, key=lambda x: -x.get("saving_3yr", 0))[:20]

    # Summary by type for quick view
    type_breakdown = sorted(type_summary.values(), key=lambda x: -x["potential_3yr_saving"])

    return {
        "summary": {
            "total_reservable_resources": len(covered) + len(uncovered),
            "covered_count": len(covered),
            "uncovered_count": len(uncovered),
            "coverage_pct": round(coverage_pct, 1),
            "total_eligible_spend": round(total_eligible_spend, 2),
            "covered_spend": round(total_covered_spend, 2),
            "uncovered_spend": round(total_uncovered_spend, 2),
            "potential_1yr_saving_monthly": round(total_1yr_saving, 2),
            "potential_3yr_saving_monthly": round(total_3yr_saving, 2),
            "potential_1yr_saving_annual": round(total_1yr_saving * 12, 2),
            "potential_3yr_saving_annual": round(total_3yr_saving * 12, 2),
        },
        "type_breakdown": type_breakdown,
        "purchase_plan": purchase_plan,
        "covered_resources": covered,
        "uncovered_resources": uncovered,
    }
