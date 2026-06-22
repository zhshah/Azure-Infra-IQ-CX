"""
BCDR Consultant Report Service — produces a full, consultant-grade Azure Resource BCDR
Planning & Assessment Report from:

  1. The customer's Azure resource inventory (live scan data: type, region, SKU, zone_status,
     has_backup, is_sql_replica, cost, utilisation …),
  2. The Phase-1 BCDR metadata the customer supplies per resource (criticality, DR tier,
     current/target RTO/RPO, target region, desired SKU, environment, business owner,
     financial loss/hour, dependencies, data classification, compliance),
  3. A one-time customer intake (customer name, prepared by, report version, drivers, region
     strategy),
  4. An AI pass that turns all of the above into a structured 13-section consultant document.

The output JSON maps 1:1 to the report outline rendered by the PDF/Excel:
  cover, executive_summary, environment_overview, bc_requirements, methodology,
  current_state, gap_analysis, recommended_architecture, solution_options, cost_licensing,
  roadmap, dr_testing, risk_register, conclusion, appendices.

Deterministic facts (the executive dashboard numbers, workload counts, the RTO/RPO matrix and
the resource inventory) are COMPUTED here — never invented by the model. The AI only writes the
narrative + recommendations, grounded strictly on the supplied resources and metadata.
"""
from __future__ import annotations

import logging
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from services.ai_infra_service import (
    _get_ai_client_for_analysis,
    _compress_resource,
    _serialize_for_ai,
    _call_ai,
)
from services.ai_module_analysis_service import (
    _safe_json_parse,
    _coerce_score,
    RESOURCE_ATTRIBUTION_INSTRUCTION,
)

logger = logging.getLogger(__name__)

MAX_TOKENS_REPORT = 16000

# Resource types whose resilience is measured by backup/replication (stateful/regional).
_BACKUP_ELIGIBLE = (
    "virtualmachines", "databases", "servers", "managedinstances", "storageaccounts",
    "sqlmanagedinstances", "cosmosdb", "fileshares", "disks", "flexibleservers",
)
_ZONAL_HINTS = ("zone-redundant", "zone redundant", "zoneredundant", "zr", "multi-zone", "availability zone")
_SINGLE_HINTS = ("single-zone", "single zone", "non-zonal", "no zone", "regional", "lrs")


def _f(v) -> str:
    return "" if v is None else str(v)


def _is_zone_redundant(r: Dict[str, Any]) -> bool:
    z = _f(r.get("zone_status")).lower()
    if any(h in z for h in _ZONAL_HINTS):
        return True
    sku = _f(r.get("sku")).lower()
    return "zrs" in sku or "gzrs" in sku


def _is_local_only(r: Dict[str, Any]) -> bool:
    z = _f(r.get("zone_status")).lower()
    sku = _f(r.get("sku")).lower()
    return "lrs" in z or "lrs" in sku or any(h in z for h in _SINGLE_HINTS)


def _short_type(r: Dict[str, Any]) -> str:
    return _f(r.get("resource_type")).split("/")[-1].lower()


def _compute_posture_metrics(resources: List[Dict[str, Any]], meta: Dict[str, dict]) -> Dict[str, Any]:
    """Compute the deterministic executive-dashboard + classification numbers (FACTS)."""
    total = len(resources)
    zone_redundant = sum(1 for r in resources if _is_zone_redundant(r))
    local_only = sum(1 for r in resources if _is_local_only(r))
    non_zonal = total - zone_redundant

    backup_eligible = [r for r in resources if _short_type(r) in _BACKUP_ELIGIBLE]
    backed_up = sum(1 for r in backup_eligible if r.get("has_backup"))
    backup_pct = round(100 * backed_up / len(backup_eligible)) if backup_eligible else 0

    dr_protected = sum(
        1 for r in resources
        if r.get("is_sql_replica") or _is_zone_redundant(r)
        or "geo" in _f(r.get("zone_status")).lower() or "grs" in _f(r.get("sku")).lower()
    )
    dr_pct = round(100 * dr_protected / total) if total else 0

    regions = sorted({_f(r.get("location")).lower() for r in resources if r.get("location")})
    subs = sorted({_f(r.get("subscription_id")) for r in resources if r.get("subscription_id")})
    by_type = Counter(_short_type(r) for r in resources)

    # Criticality / tier from the Phase-1 metadata
    crit = Counter()
    tier = Counter()
    categorized = 0
    for r in resources:
        m = meta.get(r.get("resource_id") or r.get("id") or "") or {}
        if any(m.get(k) for k in ("criticality", "dr_tier", "rto_target", "rpo_target", "business_function", "target_region")):
            categorized += 1
        if m.get("criticality"):
            crit[m["criticality"]] += 1
        if m.get("dr_tier"):
            tier[m["dr_tier"]] += 1

    total_cost = round(sum(float(r.get("cost_current_month") or 0) for r in resources), 2)

    return {
        "total_resources": total,
        "zone_redundant": zone_redundant,
        "non_zonal": non_zonal,
        "locally_redundant": local_only,
        "backup_coverage_pct": backup_pct,
        "dr_coverage_pct": dr_pct,
        "backup_eligible": len(backup_eligible),
        "regions": regions,
        "region_count": len(regions),
        "subscriptions": subs,
        "subscription_count": len(subs),
        "categorized": categorized,
        "by_type": dict(by_type.most_common(25)),
        "by_criticality": dict(crit),
        "by_dr_tier": dict(tier),
        "total_monthly_cost": total_cost,
    }


def _build_metadata_lines(resources: List[Dict[str, Any]], meta: Dict[str, dict]) -> str:
    """Render the customer-supplied Phase-1 intake per categorized resource (authoritative)."""
    lines = []
    for r in resources:
        rid = r.get("resource_id") or r.get("id") or ""
        m = meta.get(rid) or {}
        if not any(m.get(k) for k in ("criticality", "dr_tier", "rto_target", "rpo_target",
                                      "business_function", "target_region", "financial_loss_per_hour")):
            continue
        name = r.get("resource_name") or rid.split("/")[-1]
        parts = [f"{name} [{_short_type(r)} @ {_f(r.get('location'))}]"]
        for label, key in (("crit", "criticality"), ("DRtier", "dr_tier"), ("RTO", "rto_target"),
                           ("RPO", "rpo_target"), ("targetRegion", "target_region"),
                           ("desiredSKU", "desired_sku"), ("env", "environment"),
                           ("owner", "business_owner"), ("$loss/hr", "financial_loss_per_hour"),
                           ("deps", "app_dependencies"), ("dataClass", "data_classification"),
                           ("compliance", "compliance"), ("function", "business_function")):
            v = m.get(key)
            if v:
                parts.append(f"{label}={v}")
        lines.append("  - " + " | ".join(parts))
    if not lines:
        return "(No resources have been categorized in Phase 1 yet — base the plan on the Azure posture and flag the missing classification as a key risk.)"
    return "\n".join(lines[:120])


def _build_system_prompt() -> str:
    return (
        "You are a principal Microsoft Azure Business Continuity & Disaster Recovery (BCDR) consultant "
        "writing the formal deliverable a customer receives after a paid resiliency engagement. Your tone "
        "is executive and precise. You ground EVERY statement in (a) the customer's REAL Azure resources "
        "and their posture, and (b) the customer-supplied Phase-1 classification (criticality, DR tier, "
        "current/target RTO/RPO, target region, desired SKU, environment, business owner, financial loss "
        "per hour of downtime, dependencies, data classification, compliance). You align all guidance to "
        "the Azure Well-Architected Reliability pillar, the Cloud Adoption Framework, and Azure BCDR "
        "guidance, mapping each workload to a CONCRETE Azure DR mechanism (Azure Site Recovery for VMs, "
        "SQL Auto-Failover Groups / active geo-replication, GRS/GZRS or Object Replication for storage, "
        "AKS multi-region, ANF cross-region replication, Key Vault secondary-region, zone-redundant SKUs).\n\n"
        "HARD RULES — STRICT GROUNDING (the customer is a large enterprise; an inaccurate or invented "
        "fact discredits the whole engagement):\n"
        "- Reference ONLY the supplied resources, regions, SKUs and costs; NEVER invent resource names, "
        "regions, SKUs, counts, owners, compliance frameworks or dollar figures that are not in the data "
        "or the stated requirements. The deterministic METRICS block is the single source of truth for "
        "every number — do not contradict it or introduce numbers it does not support.\n"
        "- When you must propose a value the customer did NOT supply (a target RTO/RPO, a target region, a "
        "target SKU, a cost estimate), you MAY do so as professional guidance but you MUST suffix it with "
        "'(recommended)' so the reader can tell inference from customer-stated fact. Where a required "
        "input is genuinely absent, write 'not supplied' rather than fabricating it — never guess "
        "compliance regimes, financial-loss figures or data classifications.\n"
        "- Honour the STATED CUSTOMER CONTINUITY REQUIREMENTS verbatim: use the customer's stated primary "
        "and secondary/DR regions, their Preferred DR strategy (failover model), and their target-region "
        "SKU strategy throughout the architecture, costs and roadmap. Do not substitute a different region "
        "or model.\n"
        "- Engineer the architecture around the STATED dependencies when supplied: choose replication that "
        "meets any zero-data-loss (RPO~0) workloads (synchronous / zone-redundant, SQL Always-On AG "
        "sync-commit, ZRS/GZRS); design the secondary-region network from the stated network topology + "
        "hybrid connectivity (paired-region VNets, ExpressRoute with VPN failover); treat the stated "
        "identity model as a first-class recovery dependency (Entra-ID-only vs hybrid on-prem AD DS domain-"
        "controller placement in the DR region, AD FS); and size/retain to meet the stated uptime/SLA and "
        "backup-retention requirements.\n"
        "- Tier workloads as Tier 1 (Mission Critical), Tier 2 (Important), Tier 3 (Standard) using the "
        "supplied Criticality; give real examples from the inventory.\n"
        "- For every recovery objective, use the customer's stated current vs target RTO/RPO; if a target "
        "is missing, recommend one based on criticality and label it (recommended).\n"
        "- Quantify business impact using financial_loss_per_hour / cost-of-downtime where supplied; if not "
        "supplied, describe impact qualitatively and state that a dollar figure was not provided.\n"
        "- The failover_model MUST be taken from the customer's stated Preferred DR strategy. target_state, "
        "protection_strategy, deployment_plan, activation_plan, costs and roadmap MUST all be internally "
        "consistent with that one model and the stated regions and SKU strategy.\n"
        "- Offer exactly three solution options (Essential / Balanced / Enterprise) with cost trade-offs.\n\n"
        + RESOURCE_ATTRIBUTION_INSTRUCTION
        + "\n\nReturn ONLY compact JSON (no markdown fences) with EXACTLY this shape:\n"
        "{\n"
        '  "executive_summary": {"purpose": "<2-3 sentences>", "business_drivers": ["<driver>"], "scope": "<subs/regions/workloads in scope>", "current_posture": "<2-3 sentences>", "major_risks": ["<risk>"], "maturity_score": <int 0-100>, "maturity_label": "<Initial|Foundational|Established|Resilient|Mission-Ready>", "top_recommendations": [{"action": "<imperative>", "business_outcome": "<outcome>"}]},\n'
        '  "workload_classification": [{"tier": "Tier 1 — Mission Critical|Tier 2 — Important|Tier 3 — Standard", "business_criticality": "<text>", "examples": ["<resource name>"], "count": <int>}],\n'
        '  "bc_requirements": {"regulatory": ["<requirement>"], "data_residency": "<text>", "operational": ["<requirement>"]},\n'
        '  "recovery_objectives": [{"workload": "<name>", "current_rto": "<val>", "target_rto": "<val>", "current_rpo": "<val>", "target_rpo": "<val>", "gap": "<short>"}],\n'
        '  "current_state_findings": {"compute": ["<finding>"], "data_services": ["<finding>"], "storage": ["<finding>"], "networking": ["<finding>"], "identity_security": ["<finding>"], "backup_dr": ["<finding>"]},\n'
        '  "gap_analysis": {"resiliency_gaps": [{"area": "Compute|Storage|Database|Networking|Identity|Backup", "finding": "<short>", "risk": "<short>", "severity": "Critical|High|Medium|Low"}], "business_impact": {"service_outage_impact": "<text, quantified with $/hr or MTD where supplied>", "data_loss_exposure": "<text grounded in current RPO/backup posture>", "compliance_risks": "<text, or \'not supplied\' if no regime stated>", "financial_exposure": "<text using cost-of-downtime if supplied, else \'not supplied\'>", "most_exposed_workloads": ["<resource/workload name from inventory>"]}},\n'
        '  "recommended_architecture": {"failover_model": "Active-Active (Multi-region)|Active-Passive (Warm Standby)|Active-Passive (Pilot Light)|Backup & Restore", "failover_rationale": "<2-3 sentences: why this model fits the stated DR strategy, RTO/RPO, budget and criticality>", "target_state": "<3-5 sentences naming the customer\'s stated primary + secondary region, AZ usage, replication & failover topology, and the target-region SKU strategy (same-size vs scaled-down vs pilot)>", "protection_strategy": [{"azure_service": "<e.g. Virtual Machines>", "recommendation": "<e.g. Azure Site Recovery to paired region>"}], "deployment_plan": [{"step": "<imperative build step to stand up the target state>", "detail": "<services, config, dependency/order, target region & SKU>"}], "activation_plan": [{"step": "<DR activation / failover / cutover step>", "detail": "<trigger criteria, who executes, expected RTO contribution, validation>"}]},\n'
        '  "solution_options": [{"name": "Option 1 — Essential Protection", "approach": "<text>", "cost_level": "Low|Moderate|High", "rto_rpo": "<achievable>", "best_for": "<text>"}],\n'
        '  "cost_licensing": {"monthly_estimate": [{"component": "<e.g. Azure Site Recovery>", "existing": "<$ or —>", "additional": "<$ estimate>"}], "licensing_impact": ["<note>"], "assumptions": ["<assumption>"]},\n'
        '  "roadmap": [{"phase": "Phase 1 — Quick Wins (0-30 Days)", "activities": ["<activity>"], "outcomes": ["<outcome>"]}],\n'
        '  "dr_testing": {"test_plan": ["<step>"], "failback": ["<step>"], "runbooks": ["<runbook>"], "validation_checklist": ["<check>"]},\n'
        '  "risk_register": [{"risk": "<text>", "probability": "Low|Medium|High", "impact": "Low|Medium|High", "mitigation": "<text>"}],\n'
        '  "conclusion": {"immediate_actions": ["<action>"], "medium_priority": ["<action>"], "long_term": ["<action>"], "expected_outcomes": ["<outcome>"]},\n'
        '  "service_recommendations": [{"service": "<azure service>", "current": "<state>", "recommended": "<dr mechanism>", "priority": "P1|P2|P3"}]\n'
        "}\n"
        "Limits: \u22645 workload tiers, \u226414 recovery_objectives, \u226412 resiliency_gaps, \u226412 protection_strategy, "
        "\u22648 deployment_plan, \u22648 activation_plan, "
        "exactly 3 solution_options, \u22645 roadmap phases, \u226410 risk_register, \u226412 service_recommendations. "
        "Order everything by business priority (highest criticality / widest gap first)."
    )


def _build_user_prompt(metrics: Dict[str, Any], meta_lines: str, resources_json: str,
                       customer_info: Dict[str, Any]) -> str:
    ci = customer_info or {}
    region_strategy = ci.get("region_strategy")
    if not region_strategy:
        _pr, _sr = ci.get("primary_region"), ci.get("secondary_region")
        region_strategy = (f"Primary: {_pr or 'unspecified'} \u2192 Secondary/DR: {_sr or 'unspecified'}"
                           if (_pr or _sr) else "Not specified \u2014 recommend a primary + paired secondary region.")
    drivers = ci.get("business_drivers") or "Improve resiliency, reduce downtime, meet recovery objectives."
    _req_labels = [
        ("Industry / sector", "industry"), ("Default target RTO", "default_rto"),
        ("Default target RPO", "default_rpo"), ("Preferred DR strategy", "dr_strategy"),
        ("Target-region SKU strategy", "target_sku_strategy"),
        ("Business uptime / SLA commitment", "uptime_sla"),
        ("Zero-data-loss (RPO~0) workloads", "zero_data_loss"),
        ("Network topology", "network_topology"), ("Hybrid connectivity", "connectivity"),
        ("Identity model", "identity_model"), ("Backup retention requirement", "backup_retention"),
        ("Data classification", "data_classification"), ("Data residency / sovereignty", "data_residency"),
        ("Current DR maturity", "current_dr"), ("DR test frequency", "dr_test_frequency"),
        ("Operational coverage", "ops_model"), ("Budget sensitivity", "budget_sensitivity"),
        ("Cost of downtime ($/hr)", "downtime_cost"), ("Max tolerable downtime (MTD)", "mtd"),
        ("Critical business services", "critical_services"), ("Peak / blackout windows", "peak_windows"),
        ("Additional context", "notes"),
    ]
    _req_lines = [f"  - {label}: {ci.get(key)}" for label, key in _req_labels if ci.get(key)]
    req_block = ("STATED CUSTOMER CONTINUITY REQUIREMENTS (authoritative \u2014 apply across the whole plan "
                 "unless a resource's own classification states otherwise):\n" + "\n".join(_req_lines) + "\n\n") if _req_lines else ""
    return (
        f"CUSTOMER: {ci.get('customer_name') or 'Customer'}\n"
        f"BUSINESS DRIVERS (stated): {drivers}\n"
        f"REGION STRATEGY (stated): {region_strategy}\n"
        f"REGULATORY / COMPLIANCE (stated): {ci.get('compliance') or 'Not specified'}\n\n"
        f"{req_block}"
        "DETERMINISTIC METRICS (authoritative — use these exact numbers, do not invent others):\n"
        f"  Total resources: {metrics['total_resources']}\n"
        f"  Subscriptions: {metrics['subscription_count']} | Regions in use: {metrics['region_count']} ({', '.join(metrics['regions'][:12])})\n"
        f"  Zone-redundant: {metrics['zone_redundant']} | Non-zonal: {metrics['non_zonal']} | Locally-redundant (LRS): {metrics['locally_redundant']}\n"
        f"  Backup coverage: {metrics['backup_coverage_pct']}% of {metrics['backup_eligible']} backup-eligible resources\n"
        f"  DR coverage (geo/zone redundant or replica): {metrics['dr_coverage_pct']}%\n"
        f"  Categorized in Phase 1: {metrics['categorized']} of {metrics['total_resources']}\n"
        f"  Criticality breakdown (customer-supplied): {metrics['by_criticality'] or 'none yet'}\n"
        f"  DR-tier breakdown (customer-supplied): {metrics['by_dr_tier'] or 'none yet'}\n"
        f"  Resource types: {metrics['by_type']}\n"
        f"  Total monthly spend: ${metrics['total_monthly_cost']:,.0f}\n\n"
        "CUSTOMER PHASE-1 CLASSIFICATION (authoritative business intent per resource):\n"
        f"{meta_lines}\n\n"
        "RESOURCE INVENTORY SAMPLE (JSON — for grounding; analyse only these and the metrics above):\n"
        f"{resources_json}\n\n"
        "Produce the full consultant BCDR report JSON now."
    )


def _maturity(score) -> str:
    if not isinstance(score, (int, float)):
        return "Foundational"
    if score >= 85:
        return "Mission-Ready"
    if score >= 70:
        return "Resilient"
    if score >= 50:
        return "Established"
    if score >= 30:
        return "Foundational"
    return "Initial"


def generate_consultant_report(
    resources: List[Any],
    metadata_map: Optional[Dict[str, dict]] = None,
    customer_info: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Generate the full 13-section consultant BCDR report (grounded + AI narrative)."""
    client, model, provider = _get_ai_client_for_analysis()
    if not client:
        raise RuntimeError(
            "No AI provider configured. Set AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_KEY (or ANTHROPIC_API_KEY) in Settings."
        )

    resource_dicts = [r if isinstance(r, dict) else getattr(r, "__dict__", {}) for r in (resources or [])]
    meta = metadata_map or {}
    customer_info = customer_info or {}

    # 1. Deterministic facts.
    metrics = _compute_posture_metrics(resource_dicts, meta)

    # 2. Build AI context — professional-deliverable coverage:
    #    (a) NEVER drop a Phase-1-classified workload from the narrative (they are the customer's
    #        explicit priorities); (b) fill the remaining budget with the most materially exposed
    #        uncategorized resources (backup/zone gaps first, then cost) so the narrative centres on
    #        BCDR risk, not just spend; (c) the deterministic metrics + Appendix A always cover 100%.
    categorized_ids = {
        rid for rid, m in meta.items()
        if any(m.get(k) for k in ("criticality", "dr_tier", "rto_target", "rpo_target", "business_function", "target_region"))
    }
    cat_res = [r for r in resource_dicts if (r.get("resource_id") or r.get("id")) in categorized_ids]
    rest = [r for r in resource_dicts if (r.get("resource_id") or r.get("id")) not in categorized_ids]

    def _exposure_rank(r):
        zone = str(r.get("zone_status") or "").lower()
        no_backup = 0 if r.get("has_backup") else 1
        not_zonal = 0 if ("zone" in zone or "redundant" in zone) else 1
        return (no_backup + not_zonal, float(r.get("cost_current_month") or 0))

    rest.sort(key=_exposure_rank, reverse=True)
    MAX_NARRATIVE = 160
    sample = cat_res + rest[: max(0, MAX_NARRATIVE - len(cat_res))]
    compressed = [_compress_resource(r) for r in sample]
    resources_json = _serialize_for_ai(compressed)
    meta_lines = _build_metadata_lines(resource_dicts, meta)

    # 3. AI narrative.
    system_prompt = _build_system_prompt()
    user_prompt = _build_user_prompt(metrics, meta_lines, resources_json, customer_info)
    raw = _call_ai(system_prompt, user_prompt, max_tokens=MAX_TOKENS_REPORT)
    ai = _safe_json_parse(raw) or {}

    # 4. Normalise the maturity score.
    es = ai.get("executive_summary") or {}
    score = es.get("maturity_score")
    if not isinstance(score, (int, float)):
        score = _coerce_score(ai)
    if not isinstance(score, (int, float)):
        score = 45
    score = max(0, min(100, int(round(score))))
    es["maturity_score"] = score
    es["maturity_label"] = es.get("maturity_label") or _maturity(score)
    ai["executive_summary"] = es

    # 5. Assemble the cover + environment + deterministic appendix inventory.
    now = datetime.now(timezone.utc)
    cover = {
        "customer_name": customer_info.get("customer_name") or "Customer",
        "assessment_period": customer_info.get("assessment_period") or now.strftime("%B %Y"),
        "prepared_by": customer_info.get("prepared_by") or "Azure Infra IQ",
        "report_version": customer_info.get("report_version") or "1.0",
        "date": now.strftime("%d %B %Y"),
    }
    inventory = []
    for r in resource_dicts:
        rid = r.get("resource_id") or r.get("id") or ""
        m = meta.get(rid) or {}
        inventory.append({
            "resource_name": r.get("resource_name") or rid.split("/")[-1],
            "resource_type": _short_type(r),
            "location": _f(r.get("location")),
            "subscription_id": _f(r.get("subscription_id"))[-12:],
            "sku": _f(r.get("sku")),
            "zone_status": _f(r.get("zone_status")) or "—",
            "has_backup": bool(r.get("has_backup")),
            "cost_current_month": float(r.get("cost_current_month") or 0),
            "criticality": m.get("criticality") or "",
            "dr_tier": m.get("dr_tier") or "",
            "current_rto": m.get("rto_target") or "",
            "target_rto": m.get("rto_target") or "",
            "current_rpo": m.get("rpo_target") or "",
            "target_region": m.get("target_region") or "",
            "business_owner": m.get("business_owner") or "",
            "financial_loss_per_hour": m.get("financial_loss_per_hour") or "",
        })

    report = {
        "cover": cover,
        "metrics": metrics,
        "executive_summary": ai.get("executive_summary", {}),
        "workload_classification": ai.get("workload_classification", []),
        "bc_requirements": ai.get("bc_requirements", {}),
        "recovery_objectives": ai.get("recovery_objectives", []),
        "methodology": {
            "discovery_activities": [
                "Azure subscription & resource inventory collection (Azure Resource Graph)",
                "Architecture & resiliency posture assessment (zones, backup, replication)",
                "Phase-1 workload classification with the customer (criticality, RTO/RPO, ownership)",
                "Stakeholder review of business impact and recovery objectives",
                f"Detailed resiliency analysis of {len(sample)} material workloads (all {len(cat_res)} "
                f"Phase-1-classified resources plus the highest-exposure uncategorised resources); the "
                f"full inventory of {len(resource_dicts)} resources is catalogued in Appendix A",
            ],
            "assessment_areas": ["Compute", "Storage", "Databases", "Networking", "Identity",
                                  "Security", "Monitoring", "Backup", "Disaster Recovery"],
        },
        "current_state": {
            "executive_dashboard": {
                "total_resources": metrics["total_resources"],
                "zone_redundant": metrics["zone_redundant"],
                "non_zonal": metrics["non_zonal"],
                "locally_redundant": metrics["locally_redundant"],
                "backup_coverage_pct": metrics["backup_coverage_pct"],
                "dr_coverage_pct": metrics["dr_coverage_pct"],
            },
            "findings": ai.get("current_state_findings", {}),
        },
        "gap_analysis": ai.get("gap_analysis", {}),
        "recommended_architecture": ai.get("recommended_architecture", {}),
        "solution_options": ai.get("solution_options", []),
        "cost_licensing": ai.get("cost_licensing", {}),
        "roadmap": ai.get("roadmap", []),
        "dr_testing": ai.get("dr_testing", {}),
        "risk_register": ai.get("risk_register", []),
        "conclusion": ai.get("conclusion", {}),
        "appendices": {
            "inventory": inventory,
            "rto_rpo_matrix": [o for o in ai.get("recovery_objectives", []) if isinstance(o, dict)],
            "service_recommendations": ai.get("service_recommendations", []),
        },
        # run metadata
        "overall_score": score,
        "score_label": es.get("maturity_label"),
        "model": model or "unknown",
        "provider": provider or "unknown",
        "generated_at": now.isoformat(),
        "customer_info": customer_info,
    }

    logger.info(
        "BCDR consultant report generated | customer=%s resources=%d categorized=%d score=%s model=%s",
        cover["customer_name"], metrics["total_resources"], metrics["categorized"], score, model,
    )
    return report
