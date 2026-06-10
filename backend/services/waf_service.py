"""
Well-Architected Framework (WAF) Scorecard Service

Computes a 0-100 score for each of the 5 WAF pillars using the resource data
already collected during the scan — no additional Azure API calls required.

Pillars
───────
1. Cost Optimization      — waste, orphans, reserved instance coverage
2. Reliability            — backup coverage, locked resources, zone distribution
3. Security               — private endpoints, locks on critical resources, public exposure
4. Operational Excellence — tag compliance, monitoring, auto-shutdown
5. Performance Efficiency — right-sizing, over-provisioned resources
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from models.schemas import (
    ModernizationOpportunity, ResourceMetrics, KPIData, OrphanResource,
    RightSizeOpportunity, SecurityGap, WAFPillar, WAFScorecard,
)


# ── Grade / colour helpers ─────────────────────────────────────────────────────

def _grade(score: float) -> str:
    if score >= 90: return "A"
    if score >= 75: return "B"
    if score >= 60: return "C"
    if score >= 45: return "D"
    return "F"


def _color(score: float) -> str:
    if score >= 75: return "#22c55e"   # green
    if score >= 60: return "#eab308"   # yellow
    if score >= 45: return "#f97316"   # orange
    return "#ef4444"                   # red


# ── 1. Cost Optimization ──────────────────────────────────────────────────────

def _cost_pillar(
    resources: List[ResourceMetrics],
    kpi: KPIData,
    orphans: List[OrphanResource],
) -> WAFPillar:
    total = max(kpi.total_cost_current_month, 0.01)
    scorable = [r for r in resources if not r.is_infrastructure]

    not_used     = [r for r in scorable if r.score_label and r.score_label.value == "Not Used"]
    waste_cost   = sum(r.cost_current_month for r in not_used) + kpi.orphan_cost
    waste_pct    = waste_cost / total * 100

    # RI coverage bonus
    ri_eligible  = [r for r in scorable if r.ri_eligible]
    ri_covered   = [r for r in scorable if r.ri_covered]
    ri_gap_pct   = 0.0
    if ri_eligible:
        ri_gap_pct = max(0.0, 1 - len(ri_covered) / len(ri_eligible)) * 20.0

    score = max(0.0, min(100.0, 100.0 - (waste_pct * 2.5) - ri_gap_pct))

    gaps = []
    recs = []
    if waste_pct > 5:
        gaps.append(f"{len(not_used)} resources confirmed unused (${waste_cost:,.0f}/month in confirmed waste)")
    if kpi.orphan_count > 0:
        gaps.append(f"{kpi.orphan_count} orphaned resources costing ${kpi.orphan_cost:,.0f}/month")
    if ri_eligible and len(ri_covered) < len(ri_eligible):
        gaps.append(f"{len(ri_eligible) - len(ri_covered)} eligible resources not covered by Reservations")
        recs.append("Azure Reservations — save up to 72% vs pay-as-you-go")
    if kpi.mom_cost_delta_pct > 10:
        gaps.append(f"Month-over-month spend increased {kpi.mom_cost_delta_pct:.1f}%")
        recs.append("Azure Cost Management + Budgets — set alerts before overspend")
    recs.append("Azure Advisor Cost recommendations")

    return WAFPillar(
        pillar="Cost Optimization",
        score=round(score, 1),
        grade=_grade(score),
        color=_color(score),
        gaps=gaps[:4],
        recommendations=recs[:3],
        resource_gap_count=len(not_used) + kpi.orphan_count,
    )


# ── 2. Reliability ─────────────────────────────────────────────────────────────

_BACKUP_WORTHY_TYPES = {
    "microsoft.compute/virtualmachines",
    "microsoft.sql/servers/databases",
    "microsoft.storage/storageaccounts",
    "microsoft.documentdb/databaseaccounts",
    "microsoft.dbformysql/flexibleservers",
    "microsoft.dbforpostgresql/flexibleservers",
    "microsoft.web/sites",
}


def _reliability_pillar(resources: List[ResourceMetrics]) -> WAFPillar:
    backup_worthy   = [r for r in resources if r.resource_type.lower() in _BACKUP_WORTHY_TYPES]
    unprotected     = [r for r in backup_worthy if not r.has_backup]
    unlocked_costly = [r for r in resources if not r.has_lock and r.cost_current_month > 100
                       and not r.is_infrastructure]
    stopped_vms     = [r for r in resources if r.resource_type.lower() == "microsoft.compute/virtualmachines"
                       and r.power_state == "deallocated"]

    total  = max(len(resources), 1)
    score  = 100.0

    # Penalty: unprotected backup-worthy resources
    if backup_worthy:
        unprotected_pct = len(unprotected) / len(backup_worthy) * 100
        score -= unprotected_pct * 0.5   # max -50

    # Penalty: costly resources with no lock
    if unlocked_costly:
        score -= min(20.0, len(unlocked_costly) * 2.0)

    # Penalty: deallocated VMs (potential forgotten resources)
    if stopped_vms:
        score -= min(10.0, len(stopped_vms) * 1.5)

    score = max(0.0, min(100.0, score))

    gaps = []
    recs = []
    if unprotected:
        gaps.append(f"{len(unprotected)} VMs/databases have no Azure Backup policy")
        recs.append("Azure Backup — protect critical workloads from data loss")
    if unlocked_costly:
        gaps.append(f"{len(unlocked_costly)} high-cost resources have no delete lock")
        recs.append("Azure Resource Locks — prevent accidental deletion of critical resources")
    if stopped_vms:
        gaps.append(f"{len(stopped_vms)} deallocated VMs still accruing disk/IP costs")
        recs.append("Azure Site Recovery — replicate instead of keeping redundant stopped VMs")

    return WAFPillar(
        pillar="Reliability",
        score=round(score, 1),
        grade=_grade(score),
        color=_color(score),
        gaps=gaps[:4],
        recommendations=recs[:3],
        resource_gap_count=len(unprotected) + len(unlocked_costly),
    )


# ── 3. Security ────────────────────────────────────────────────────────────────

_SENSITIVE_TYPES = {
    "microsoft.sql/servers/databases",
    "microsoft.documentdb/databaseaccounts",
    "microsoft.storage/storageaccounts",
    "microsoft.keyvault/vaults",
    "microsoft.dbformysql/flexibleservers",
    "microsoft.dbforpostgresql/flexibleservers",
    "microsoft.cognitiveservices/accounts",
    "microsoft.machinelearningservices/workspaces",
}


def _security_pillar(resources: List[ResourceMetrics], security_gaps: List[SecurityGap]) -> WAFPillar:
    sensitive       = [r for r in resources if r.resource_type.lower() in _SENSITIVE_TYPES]
    no_pe           = [r for r in sensitive if not r.has_private_endpoint]
    untagged        = [r for r in resources if r.missing_tags and not r.is_infrastructure]
    critical_gaps   = [g for g in security_gaps if g.severity == "critical"]
    high_gaps       = [g for g in security_gaps if g.severity == "high"]

    score = 100.0
    if sensitive:
        score -= min(35.0, len(no_pe) / len(sensitive) * 35.0)
    if untagged:
        score -= min(20.0, len(untagged) / max(len(resources), 1) * 40.0)
    score -= min(25.0, len(critical_gaps) * 5.0 + len(high_gaps) * 2.0)
    score = max(0.0, min(100.0, score))

    gaps = []
    recs = []
    if no_pe:
        gaps.append(f"{len(no_pe)} data/AI services exposed without Private Endpoints")
        recs.append("Azure Private Endpoint — remove public network exposure for sensitive services")
    if critical_gaps:
        gaps.append(f"{len(critical_gaps)} critical security gaps identified across the estate")
        recs.append("Microsoft Defender for Cloud — continuous security posture management")
    if untagged:
        gaps.append(f"{len(untagged)} resources missing ownership/cost-center tags")
        recs.append("Azure Policy + Governance — enforce tagging and RBAC at scale")
    recs.append("Microsoft Entra ID PIM — just-in-time privileged access management")

    return WAFPillar(
        pillar="Security",
        score=round(score, 1),
        grade=_grade(score),
        color=_color(score),
        gaps=gaps[:4],
        recommendations=recs[:3],
        resource_gap_count=len(no_pe) + len(critical_gaps),
    )


# ── 4. Operational Excellence ─────────────────────────────────────────────────

def _ops_pillar(resources: List[ResourceMetrics]) -> WAFPillar:
    scorable   = [r for r in resources if not r.is_infrastructure]
    untagged   = [r for r in scorable if r.missing_tags]
    no_monitor = [r for r in scorable if r.data_confidence in ("none", "low") and r.cost_current_month > 50]
    no_autoshut = [r for r in resources
                   if r.resource_type.lower() == "microsoft.compute/virtualmachines"
                   and not r.auto_shutdown and r.score_label and r.score_label.value in ("Not Used", "Rarely Used")]

    total = max(len(scorable), 1)
    score = 100.0
    score -= min(30.0, len(untagged) / total * 60.0)
    score -= min(25.0, len(no_monitor) / total * 50.0)
    score -= min(15.0, len(no_autoshut) * 3.0)
    score = max(0.0, min(100.0, score))

    tag_pct = round((1 - len(untagged) / total) * 100, 0)
    gaps = []
    recs = []
    if untagged:
        gaps.append(f"Tag compliance at {int(tag_pct)}% — {len(untagged)} resources missing required tags")
        recs.append("Azure Policy — enforce mandatory tags at resource creation")
    if no_monitor:
        gaps.append(f"{len(no_monitor)} high-cost resources have no diagnostic/monitoring data")
        recs.append("Azure Monitor + Application Insights — unified observability across all workloads")
    if no_autoshut:
        gaps.append(f"{len(no_autoshut)} idle VMs have no auto-shutdown schedule")
        recs.append("Azure Automation + Dev/Test Labs — schedule shutdowns to cut dev environment costs")

    return WAFPillar(
        pillar="Operational Excellence",
        score=round(score, 1),
        grade=_grade(score),
        color=_color(score),
        gaps=gaps[:4],
        recommendations=recs[:3],
        resource_gap_count=len(untagged) + len(no_monitor),
    )


# ── 5. Performance Efficiency ─────────────────────────────────────────────────

def _perf_pillar(
    resources: List[ResourceMetrics],
    rightsize_opps: List[RightSizeOpportunity],
) -> WAFPillar:
    scorable     = [r for r in resources if not r.is_infrastructure]
    over_prov    = [r for r in scorable
                    if r.primary_utilization_pct is not None
                    and r.primary_utilization_pct < 20
                    and r.cost_current_month > 50]
    old_skus     = [r for r in resources
                    if r.resource_type.lower() == "microsoft.compute/virtualmachines"
                    and r.sku and any(v in (r.sku or "") for v in ("_v2", "_v3")) ]

    score = 100.0
    if scorable:
        score -= min(30.0, len(over_prov) / len(scorable) * 60.0)
    score -= min(25.0, len(rightsize_opps) * 2.0)
    score -= min(15.0, len(old_skus) * 2.0)
    score = max(0.0, min(100.0, score))

    gaps = []
    recs = []
    if over_prov:
        gaps.append(f"{len(over_prov)} resources are over-provisioned (utilization < 20%)")
        recs.append("Azure Advisor Compute recommendations — right-size VMs automatically")
    if rightsize_opps:
        savings = sum(o.estimated_savings for o in rightsize_opps)
        gaps.append(f"{len(rightsize_opps)} right-size opportunities identified (${savings:,.0f}/month savings)")
        recs.append("Azure Compute Optimizer — continuous right-sizing recommendations")
    if old_skus:
        gaps.append(f"{len(old_skus)} VMs running deprecated v2/v3 SKUs — v5 series is faster and cheaper")
        recs.append("Azure VM Boost (v5 series) — up to 40% better price-performance vs v2/v3")

    return WAFPillar(
        pillar="Performance Efficiency",
        score=round(score, 1),
        grade=_grade(score),
        color=_color(score),
        gaps=gaps[:4],
        recommendations=recs[:3],
        resource_gap_count=len(over_prov) + len(rightsize_opps),
    )


# ── Public entry point ─────────────────────────────────────────────────────────

def compute_waf_scorecard(
    resources: List[ResourceMetrics],
    kpi: KPIData,
    orphans: List[OrphanResource],
    rightsize_opps: List[RightSizeOpportunity],
    security_gaps: List[SecurityGap],
) -> WAFScorecard:
    pillars = [
        _cost_pillar(resources, kpi, orphans),
        _reliability_pillar(resources),
        _security_pillar(resources, security_gaps),
        _ops_pillar(resources),
        _perf_pillar(resources, rightsize_opps),
    ]
    overall = sum(p.score for p in pillars) / len(pillars)
    return WAFScorecard(
        overall_score=round(overall, 1),
        overall_grade=_grade(overall),
        pillars=pillars,
        generated_at=datetime.now(tz=timezone.utc).isoformat(),
    )
