"""
Business Impact Analysis (BIA) Service — produces a consultant-grade, framework-based
Business Impact Analysis for a selected set of Azure resources.

Unlike the legacy static BIA (services.bcdr_enhanced_service.build_business_impact_analysis,
a deterministic weight-based scoring matrix), this service runs an AI pass that turns the
customer's real estate + classification into the kind of BIA a skilled BCDR/IT-service-
continuity consultant would author, grounded in the recognised standards:

  • ISO 22301:2019            — Business Continuity Management Systems
  • NIST SP 800-34 Rev. 1     — Contingency Planning (the canonical BIA process:
                                identify processes → MTD/MTPD → RTO/RPO → recovery
                                priorities → resource requirements)
  • ITIL 4                    — Service Continuity Management practice
  • ISO/IEC 27031            — ICT readiness for business continuity (IRBC)

Inputs:
  1. The selected Azure resources (live scan data: type, region, SKU, zone_status,
     has_backup, is_sql_replica, cost, utilisation, Azure tags …),
  2. The customer's Phase-1 BCDR metadata + custom tags per resource (criticality, DR
     tier, current/target RTO/RPO, business owner, financial loss/hour, dependencies,
     data classification, compliance, business function),
  3. A consultant BIA intake (critical business processes, dependent applications, user
     base, peak/blackout windows, MTD, impact-over-time appetite, recovery resources …).

Deterministic facts (criticality tiers, per-resource impact scores, estimated downtime
cost, the resource BIA matrix) are COMPUTED via the existing static engine and passed to
the model as authoritative grounding — the AI writes the narrative, impact-over-time,
dependency / single-point-of-failure analysis, recovery objectives and prioritised
recovery sequence on top of those facts, never inventing numbers.

The output JSON maps 1:1 to the BIA report rendered by the PDF + Excel exporters.
"""
from __future__ import annotations

import logging
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
from services.qatar_bcdr_policy import (
    QATAR_POLICY_SYSTEM_RULES,
    build_qatar_grounding_block,
    build_service_playbook_prompt_block,
)
from services.bcdr_report_service import (
    _compute_posture_metrics,
    _build_metadata_lines,
    _short_type,
    _f,
    _augment_intake_from_resources,
)
from services.bcdr_enhanced_service import (
    build_business_impact_analysis,
    _TIER_ANNUAL_DT_HRS,
    _POSTURE_FACTOR,
)

logger = logging.getLogger(__name__)

MAX_TOKENS_BIA = 16000

# The standard impact horizons a BIA evaluates downtime against (NIST SP 800-34 / ISO 22301).
IMPACT_HORIZONS = ["1 hour", "4 hours", "8 hours", "24 hours", "72 hours", "1 week"]

FRAMEWORKS = [
    "ISO 22301:2019 (Business Continuity Management Systems)",
    "NIST SP 800-34 Rev. 1 (Contingency Planning / BIA)",
    "ITIL 4 Service Continuity Management",
    "ISO/IEC 27031 (ICT readiness for business continuity)",
]


def _bia_grounding_block(static_bia: Dict[str, Any]) -> str:
    """Render the deterministic BIA matrix (tiers, downtime cost, RTO) the AI must respect."""
    ts = static_bia.get("tier_summary", []) or []
    lines = ["DETERMINISTIC BIA GROUNDING (computed from resource type, cost, workload tier, zone "
             "risk and the customer's criticality tags — these tier counts, RTO defaults and "
             "downtime-cost estimates are authoritative; do not contradict them):"]
    lines.append(f"  Total resources analysed: {static_bia.get('total_resources', 0)}")
    tagged_pct = static_bia.get("tagged_pct", 0)
    lines.append(f"  Customer-tagged criticality coverage: {tagged_pct}% "
                 f"({static_bia.get('tagged_count', 0)} of {static_bia.get('total_resources', 0)} resources)")
    sd = static_bia.get("stated_downtime_count", 0)
    if sd:
        lines.append(f"  Resources with a stated financial loss/hour: {sd} "
                     f"(total ${static_bia.get('total_stated_downtime_cost_hr', 0):,.0f}/hr stated)")
    for t in ts:
        lines.append(
            f"  - {t.get('tier')}: {t.get('count')} resources ({t.get('pct')}%), "
            f"avg impact {t.get('avg_impact_score')}/100, "
            f"est. downtime ${t.get('est_downtime_cost_hr', 0):,.0f}/hr, "
            f"tier-default RTO {t.get('target_rto_hours')}h"
        )
    top = static_bia.get("top_critical", []) or []
    if top:
        lines.append("  Most critical resources (by computed impact score):")
        for m in top[:10]:
            lines.append(
                f"    • {m.get('resource_name')} [{_short_type(m)} @ {m.get('location')}] — "
                f"{m.get('bia_tier')} (score {m.get('impact_score')}), "
                f"RTO {m.get('target_rto_hours')}h, "
                f"${m.get('downtime_cost_hr', 0):,.0f}/hr ({m.get('downtime_cost_source')}), "
                f"criticality {m.get('criticality_source')}"
            )
    return "\n".join(lines)


def _build_bia_system_prompt() -> str:
    return (
        "You are a principal IT Service Continuity & Business Continuity consultant authoring a "
        "formal Business Impact Analysis (BIA) — the deliverable a customer receives after a paid "
        "resiliency engagement. You write to the standard of a top-tier consultancy and ground EVERY "
        "statement in (a) the customer's REAL Azure resources and their posture, (b) the customer-"
        "supplied per-resource classification (criticality, DR tier, current/target RTO/RPO, business "
        "owner, financial loss per hour, dependencies, data classification, compliance, business "
        "function), and (c) the stated BIA intake (critical business processes, dependent applications, "
        "user base, peak/blackout windows, maximum tolerable downtime, recovery resources).\n\n"
        "You conduct the analysis using the recognised business-continuity standards and you NAME them "
        "where you apply them:\n"
        "  • ISO 22301:2019 — Business Continuity Management Systems (BIA + risk assessment).\n"
        "  • NIST SP 800-34 Rev. 1 — the canonical BIA process: identify business processes and the "
        "resources that support them; determine outage impacts over time; establish Maximum Tolerable "
        "Downtime (MTD/MTPD), Recovery Time Objective (RTO) and Recovery Point Objective (RPO); "
        "identify recovery priorities and resource requirements.\n"
        "  • ITIL 4 Service Continuity Management — service criticality, vital business functions.\n"
        "  • ISO/IEC 27031 — ICT readiness for business continuity (IRBC).\n\n"
        "HARD RULES — STRICT GROUNDING (the customer is an enterprise; an invented fact discredits the "
        "whole engagement):\n"
        "- Reference ONLY the supplied resources, regions, SKUs, tags and costs. NEVER invent resource "
        "names, counts, owners, compliance regimes or dollar figures not present in the data or intake. "
        "The DETERMINISTIC BIA GROUNDING and METRICS blocks are the single source of truth for every "
        "number — do not contradict them.\n"
        "- When you must propose a value the customer did NOT supply (an MTD, a target RTO/RPO, a "
        "dollar impact), you MAY do so as professional guidance but MUST suffix it with '(recommended)'. "
        "Where a required input is genuinely absent, write 'not supplied' rather than fabricating it.\n"
        "- SUPPLIED-vs-RECOMMENDED DISCIPLINE (Recovery Objectives table — non-negotiable): for every row "
        "in recovery_objectives, populate current_rto/current_rpo with the EXACT customer-stated value if "
        "and only if the customer supplied it (per-resource RTO/RPO tag, Phase-1 classification, or the "
        "stated default_rto/default_rpo intake). Otherwise write the literal string 'Not supplied' — do "
        "NOT write 'Best Effort', 'Standard', 'TBD', 'N/A', '—' or any other placeholder. recommended_rto/"
        "recommended_rpo must end with the suffix ' (recommended — no customer target)' whenever the "
        "customer did not supply default_rto/default_rpo at intake, so the reader can see at a glance "
        "which values are professional guidance versus stated requirements. The same rule applies to the "
        "criticality_tiers table: tier-level mtd/rto/rpo must carry the same suffix when no customer "
        "target was stated.\n"
        "- Map the selected Azure resources to the CRITICAL BUSINESS PROCESSES / SERVICES they support "
        "(use the stated business processes + business_function tags); a BIA is about business "
        "services, not just infrastructure. Where the mapping is inferred, label it (recommended).\n"
        "- Tier workloads as Tier 1 (Mission Critical), Tier 2 (Business Critical / Important), Tier 3 "
        "(Business-Operational / Standard), Tier 4 (Low) using the supplied criticality; give real "
        "examples from the inventory and respect the deterministic tier counts.\n"
        "- Quantify the IMPACT OVER TIME for each horizon (1h, 4h, 8h, 24h, 72h, 1 week) across five "
        "impact categories — Financial, Operational, Reputational/Customer, Regulatory/Legal, and "
        "Health & Safety — escalating realistically with outage duration. Use the stated cost-of-"
        "downtime / financial_loss_per_hour where supplied; otherwise describe qualitatively and say a "
        "dollar figure was not supplied.\n"
        "- MONEY DISCIPLINE (critical — the customer flagged inflated numbers): NEVER invent or inflate a "
        "dollar figure. The ONLY authoritative dollar figures are (a) values the customer explicitly "
        "stated, and (b) the AUTHORITATIVE FINANCIAL EXPOSURE block provided to you. Any financial figure "
        "in the Financial impact column or anywhere else MUST be consistent with — and never larger than — "
        "that exposure block. NEVER annualize by a full year of downtime (8,760 hours); a real estate is "
        "not down 24/7/365. For a small / dev / test estate the right answer is small numbers — say so "
        "plainly rather than manufacturing an enterprise-scale loss.\n"
        "- Derive MTD/MTPD, RTO and RPO per critical workload; show current vs recommended and the gap.\n"
        "- Analyse dependencies (upstream/downstream) and call out SINGLE POINTS OF FAILURE grounded in "
        "the real topology (non-zone-redundant SKUs, single-region, no backup, single replica).\n"
        "- Produce a prioritised RECOVERY SEQUENCE (which services first and why), and a minimum "
        "RESOURCE REQUIREMENTS / vital-records list to recover them.\n"
        + QATAR_POLICY_SYSTEM_RULES
        + RESOURCE_ATTRIBUTION_INSTRUCTION
        + "\n\nReturn ONLY compact JSON (no markdown fences) with EXACTLY this shape:\n"
        "{\n"
        '  "executive_summary": {"purpose": "<2-3 sentences>", "scope": "<resources/services in scope>", "frameworks": ["ISO 22301:2019","NIST SP 800-34 Rev. 1","ITIL 4 Service Continuity Management","ISO/IEC 27031"], "headline": "<one punchy sentence on the business exposure>", "overall_criticality_rating": "Mission-Critical|Business-Critical|Business-Operational|Low", "aggregate_downtime_cost_per_hour": "<$ value or \'not supplied\'>", "key_findings": ["<finding>"], "criticality_score": <int 0-100, higher = more business-critical / exposed>, "criticality_label": "<Mission-Critical|Business-Critical|Business-Operational|Low>"},\n'
        '  "methodology": {"approach": "<2-3 sentences on the BIA approach>", "frameworks_applied": [{"framework": "<name>", "how_applied": "<short>"}], "data_sources": ["<source>"]},\n'
        '  "business_services": [{"service": "<business service/process name>", "business_function": "<text>", "criticality_tier": "Tier 1 — Mission Critical|Tier 2 — Business Critical|Tier 3 — Business-Operational|Tier 4 — Low", "supporting_resources": ["<resource name>"], "users_affected": "<text or \'not supplied\'>", "peak_periods": "<text or \'not supplied\'>"}],\n'
        '  "criticality_tiers": [{"tier": "Tier 1 — Mission Critical", "definition": "<short>", "mtd": "<max tolerable downtime>", "rto": "<recommended RTO>", "rpo": "<recommended RPO>", "resource_count": <int>, "examples": ["<resource name>"]}],\n'
        '  "impact_over_time": [{"duration": "1 hour", "financial": "<text>", "operational": "<text>", "reputational": "<text>", "regulatory": "<text>", "health_safety": "<text>"}],\n'
        '  "recovery_objectives": [{"workload": "<name>", "criticality": "<tier>", "mtd": "<val>", "current_rto": "<val or not supplied>", "recommended_rto": "<val>", "current_rpo": "<val or not supplied>", "recommended_rpo": "<val>", "rationale": "<short>"}],\n'
        '  "dependency_analysis": {"upstream_dependencies": ["<text>"], "downstream_dependencies": ["<text>"], "single_points_of_failure": [{"resource": "<name>", "why": "<grounded reason>", "impact": "<business impact>", "mitigation": "<azure mechanism>"}], "notes": "<short>"},\n'
        '  "financial_exposure": {"per_hour": "<$ or not supplied>", "per_day": "<$ or not supplied>", "annualized": "<$ or not supplied>", "basis": "<how derived; cite stated figures vs estimates>", "most_exposed_services": ["<service/resource>"]},\n'
        '  "resource_requirements": {"minimum_recovery_resources": ["<text>"], "vital_records": ["<text>"], "staffing_roles": ["<role>"], "third_party_dependencies": ["<text or not supplied>"]},\n'
        '  "recovery_sequence": [{"order": <int>, "service": "<service/workload>", "resources": ["<resource name>"], "target_rto": "<val>", "rationale": "<why this order>"}],\n'
        '  "gaps_and_recommendations": [{"gap": "<short>", "business_impact": "<short>", "recommendation": "<imperative, concrete Azure action>", "priority": "P1|P2|P3", "effort": "Low|Medium|High"}],\n'
        '  "risk_register": [{"risk": "<text>", "probability": "Low|Medium|High", "impact": "Low|Medium|High", "mitigation": "<text>"}],\n'
        '  "conclusion": {"summary": "<2-3 sentences>", "immediate_actions": ["<action>"], "next_steps": ["<action>"]}\n'
        "}\n"
        "Limits: \u22648 business_services, \u22644 criticality_tiers, impact_over_time MUST cover exactly the "
        "horizons 1 hour / 4 hours / 8 hours / 24 hours / 72 hours / 1 week, \u226414 recovery_objectives, "
        "\u226410 single_points_of_failure, \u226410 recovery_sequence, \u226412 gaps_and_recommendations, "
        "\u226410 risk_register. Order everything by business criticality (most critical / widest gap first)."
    )


def _build_bia_user_prompt(metrics: Dict[str, Any], grounding: str, meta_lines: str,
                           resources_json: str, intake: Dict[str, Any],
                           resources_full: Optional[List[Dict[str, Any]]] = None) -> str:
    ci = intake or {}
    _req_labels = [
        ("Industry / sector", "industry"),
        ("Critical business processes / services", "critical_processes"),
        ("Dependent applications / systems", "dependent_apps"),
        ("User base / population affected", "user_base"),
        ("Peak / seasonal / blackout windows", "peak_windows"),
        ("Maximum Tolerable Downtime (MTD/MTPD)", "mtd"),
        ("Default target RTO", "default_rto"),
        ("Default target RPO", "default_rpo"),
        ("Cost of downtime ($/hr)", "downtime_cost"),
        ("Revenue at risk", "revenue_at_risk"),
        ("Operational impact of an outage", "operational_impact"),
        ("Reputational / customer impact", "reputational_impact"),
        ("Regulatory / legal / compliance impact", "regulatory_impact"),
        ("Health & safety impact", "health_safety_impact"),
        ("Known dependencies / single points of failure", "known_dependencies"),
        ("Minimum recovery resources (people/systems)", "recovery_resources"),
        ("Vital records / critical data", "vital_records"),
        ("Data classification", "data_classification"),
        ("Regulatory frameworks in scope", "compliance"),
        ("Additional context", "notes"),
    ]
    _req_lines = [f"  - {label}: {ci.get(key)}" for label, key in _req_labels if ci.get(key)]
    req_block = ("STATED BIA INTAKE (authoritative customer context — apply across the whole analysis):\n"
                 + "\n".join(_req_lines) + "\n\n") if _req_lines else (
                 "STATED BIA INTAKE: (none supplied — derive the BIA from the resource posture, tags and "
                 "classification, and flag the missing business context as a key assumption/gap.)\n\n")
    qatar_block = build_qatar_grounding_block(resources_full or [], intake)
    playbook_block = build_service_playbook_prompt_block(resources_full or [])
    return (
        f"CUSTOMER: {ci.get('customer_name') or 'Customer'}\n"
        f"INDUSTRY (stated): {ci.get('industry') or 'Not specified'}\n"
        f"REGULATORY / COMPLIANCE (stated): {ci.get('compliance') or 'Not specified'}\n\n"
        f"{req_block}"
        f"{qatar_block}"
        f"{playbook_block}"
        f"{grounding}\n\n"
        "DETERMINISTIC ESTATE METRICS (authoritative — use these exact numbers, do not invent others):\n"
        f"  Total resources: {metrics['total_resources']}\n"
        f"  Subscriptions: {metrics['subscription_count']} | Regions in use: {metrics['region_count']} ({', '.join(metrics['regions'][:12])})\n"
        f"  Zone-redundant: {metrics['zone_redundant']} | Non-zonal: {metrics['non_zonal']} | Locally-redundant (LRS): {metrics['locally_redundant']}\n"
        f"  Backup coverage: {metrics['backup_coverage_pct']}% of {metrics['backup_eligible']} backup-eligible resources\n"
        f"  DR coverage (geo/zone redundant or replica): {metrics['dr_coverage_pct']}%\n"
        f"  Categorized in Phase 1: {metrics['categorized']} of {metrics['total_resources']}\n"
        f"  Criticality breakdown (customer-supplied): {metrics['by_criticality'] or 'none yet'}\n"
        f"  Resource types: {metrics['by_type']}\n"
        f"  Total monthly spend: ${metrics['total_monthly_cost']:,.0f}\n\n"
        "CUSTOMER PHASE-1 CLASSIFICATION (authoritative business intent per resource):\n"
        f"{meta_lines}\n\n"
        "SELECTED RESOURCE INVENTORY (JSON — analyse only these resources and the metrics above):\n"
        f"{resources_json}\n\n"
        "Produce the full Business Impact Analysis JSON now."
    )


def _criticality_label(score) -> str:
    if not isinstance(score, (int, float)):
        return "Business-Operational"
    if score >= 80:
        return "Mission-Critical"
    if score >= 55:
        return "Business-Critical"
    if score >= 30:
        return "Business-Operational"
    return "Low"


def _money(v) -> str:
    try:
        return "$" + format(float(v), ",.0f")
    except Exception:
        return "$0"


# ── Stated-vs-assumed audit ──────────────────────────────────────────────────
# The single canonical list of BIA intake fields. Anything not in here is "extra context".
# A field is "supplied" when the value is a non-empty string after strip — anything else
# (None, "", whitespace, the literal placeholders the AI sometimes echoes) is treated as
# missing, which forces the deterministic post-processor to label values "Not supplied".
_BIA_INTAKE_FIELDS: List[tuple] = [
    ("customer_name",        "Customer / organisation",                     "required"),
    ("industry",             "Industry / sector",                           "optional"),
    ("critical_processes",   "Critical business processes",                 "required"),
    ("dependent_apps",       "Dependent applications / systems",            "optional"),
    ("user_base",            "User base / population affected",             "optional"),
    ("peak_windows",         "Peak / seasonal / blackout windows",          "optional"),
    ("mtd",                  "Maximum Tolerable Downtime (MTD/MTPD)",       "recovery_target"),
    ("default_rto",          "Default target RTO",                          "recovery_target"),
    ("default_rpo",          "Default target RPO",                          "recovery_target"),
    ("downtime_cost",        "Cost of downtime ($/hr)",                     "impact_signal"),
    ("revenue_at_risk",      "Revenue at risk",                             "impact_signal"),
    ("operational_impact",   "Operational impact of an outage",             "impact_signal"),
    ("reputational_impact",  "Reputational / customer impact",              "optional"),
    ("regulatory_impact",    "Regulatory / legal / compliance impact",      "optional"),
    ("health_safety_impact", "Health & safety impact",                      "optional"),
    ("known_dependencies",   "Known dependencies / single points of failure", "optional"),
    ("recovery_resources",   "Minimum recovery resources (people/systems)", "optional"),
    ("vital_records",        "Vital records / critical data",               "optional"),
    ("data_classification",  "Data classification",                         "optional"),
    ("compliance",           "Regulatory frameworks in scope",              "optional"),
]

# Placeholder strings the AI sometimes emits when it has nothing to anchor on. We strip
# these out of the current_* columns and force them to the literal "Not supplied" so the
# reader can never confuse an inferred guess with a stated SLA.
_BLANK_PLACEHOLDERS = {
    "", "-", "—", "tbd", "n/a", "na", "best effort", "best-effort", "standard",
    "default", "as required", "not stated", "to be determined", "not specified",
}


def _supplied(intake: Dict[str, Any], key: str) -> bool:
    v = intake.get(key)
    if v is None:
        return False
    if isinstance(v, str):
        return bool(v.strip())
    return True


def _build_intake_audit(intake: Dict[str, Any]) -> tuple:
    """Walk the canonical BIA intake field list and return (intake_summary, assumptions)
    so the PDF + Excel can clearly show what the customer stated vs what the BIA had to
    assume because the customer left it blank."""
    intake = intake or {}
    supplied: List[Dict[str, Any]] = []
    not_supplied: List[Dict[str, Any]] = []
    for key, label, kind in _BIA_INTAKE_FIELDS:
        row = {"key": key, "label": label, "kind": kind}
        if _supplied(intake, key):
            row["value"] = intake.get(key)
            supplied.append(row)
        else:
            not_supplied.append(row)

    any_recovery_target = any(_supplied(intake, k) for k in ("mtd", "default_rto", "default_rpo"))
    any_impact_signal = any(_supplied(intake, k) for k in ("downtime_cost", "revenue_at_risk", "operational_impact"))

    assumptions: List[str] = []
    if not _supplied(intake, "critical_processes"):
        assumptions.append(
            "Critical business processes were not supplied at intake. Business-service mapping "
            "is inferred from resource names, types and Phase-1 business-function tags — validate "
            "with the business owner before approval."
        )
    if not any_recovery_target:
        assumptions.append(
            "No recovery targets (MTD / default RTO / default RPO) were supplied at intake. "
            "Recovery objectives shown are professional recommendations derived from each "
            "workload's criticality tier and Microsoft DR doctrine; the 'Current' columns are "
            "labelled 'Not supplied' and the 'Recommended' columns carry the suffix "
            "'(recommended — no customer target)'."
        )
    if not any_impact_signal:
        assumptions.append(
            "No business impact signal (cost of downtime, revenue at risk, operational impact) "
            "was supplied at intake. Financial exposure is estimated from the deterministic "
            "tier-based exposure model (see Financial Exposure basis), not from stated business "
            "figures — treat the dollar figures as planning estimates, not approved numbers."
        )
    if not _supplied(intake, "industry"):
        assumptions.append(
            "Industry / sector was not supplied; regulatory and reputational impact statements "
            "are generic rather than industry-specific."
        )
    if not _supplied(intake, "compliance"):
        assumptions.append(
            "No regulatory framework was named at intake; compliance impact is described "
            "generically. Re-run with the in-scope frameworks (e.g. ISO 27001, PCI-DSS) for "
            "framework-specific findings."
        )
    if not _supplied(intake, "known_dependencies"):
        assumptions.append(
            "Known dependencies / single points of failure were not stated at intake. SPOF "
            "analysis is derived from real Azure posture (non-zone-redundant SKUs, single-region, "
            "no backup) and does not include external business / vendor dependencies."
        )

    summary = {
        "supplied": supplied,
        "not_supplied": not_supplied,
        "supplied_count": len(supplied),
        "not_supplied_count": len(not_supplied),
        "supplied_pct": int(round(100.0 * len(supplied) / max(1, len(supplied) + len(not_supplied)))),
        "any_recovery_target_supplied": any_recovery_target,
        "any_impact_signal_supplied": any_impact_signal,
    }
    return summary, assumptions


def _is_blank(val) -> bool:
    if val is None:
        return True
    s = str(val).strip().lower()
    return s in _BLANK_PLACEHOLDERS


def _normalize_recovery_objectives(report: Dict[str, Any], intake: Dict[str, Any]) -> None:
    """Force honest 'Not supplied' / '(recommended — no customer target)' labelling on every
    row of recovery_objectives. The AI is told to do this in the prompt; this is the safety
    net so the PDF / Excel are correct even when the model goes off-script (e.g. it wrote
    'Best Effort' in the customer's BIA where nothing was supplied)."""
    rows = report.get("recovery_objectives") or []
    if not isinstance(rows, list):
        return
    rto_supplied = _supplied(intake, "default_rto") or _supplied(intake, "mtd")
    rpo_supplied = _supplied(intake, "default_rpo")
    suffix = " (recommended — no customer target)"
    for r in rows:
        if not isinstance(r, dict):
            continue
        # Current columns — blank/placeholder => "Not supplied"
        if _is_blank(r.get("current_rto")):
            r["current_rto"] = "Not supplied" if not rto_supplied else r.get("current_rto") or "Not supplied"
        if _is_blank(r.get("current_rpo")):
            r["current_rpo"] = "Not supplied" if not rpo_supplied else r.get("current_rpo") or "Not supplied"
        # Recommended columns — add the "(recommended — no customer target)" suffix when no
        # default target was stated AND the AI didn't already mark it. Idempotent.
        if not rto_supplied and r.get("recommended_rto"):
            rv = str(r["recommended_rto"])
            if "recommended" not in rv.lower() and "not supplied" not in rv.lower():
                r["recommended_rto"] = rv + suffix
        if not rpo_supplied and r.get("recommended_rpo"):
            rv = str(r["recommended_rpo"])
            if "recommended" not in rv.lower() and "not supplied" not in rv.lower():
                r["recommended_rpo"] = rv + suffix
        # MTD column on the same table.
        if not _supplied(intake, "mtd") and r.get("mtd"):
            mv = str(r["mtd"])
            if "recommended" not in mv.lower() and "not supplied" not in mv.lower():
                r["mtd"] = mv + suffix


def _normalize_criticality_tiers(report: Dict[str, Any], intake: Dict[str, Any]) -> None:
    """Same discipline for the tier-level MTD / RTO / RPO."""
    rows = report.get("criticality_tiers") or []
    if not isinstance(rows, list):
        return
    rto_supplied = _supplied(intake, "default_rto") or _supplied(intake, "mtd")
    rpo_supplied = _supplied(intake, "default_rpo")
    mtd_supplied = _supplied(intake, "mtd")
    suffix = " (recommended — no customer target)"
    for r in rows:
        if not isinstance(r, dict):
            continue
        for key, ok in (("mtd", mtd_supplied), ("rto", rto_supplied), ("rpo", rpo_supplied)):
            v = r.get(key)
            if not v:
                continue
            sv = str(v)
            if ok or "recommended" in sv.lower() or "not supplied" in sv.lower():
                continue
            r[key] = sv + suffix


def _posture_key(rd: Dict[str, Any]) -> str:
    """backup+zone / backup / none — from the resource's real backup + zone posture."""
    has_backup = bool(rd.get("has_backup"))
    z = str(rd.get("zone_status") or "").lower().replace("-", "").replace(" ", "")
    zone_redundant = "zoneredundant" in z  # excludes 'locallyredundant' / 'notzoneaware'
    if has_backup and zone_redundant:
        return "backup+zone"
    if has_backup:
        return "backup"
    return "none"


def _compute_financial_exposure(matrix: List[dict], resource_dicts: List[dict]) -> Dict[str, Any]:
    """Deterministic, reality-anchored financial exposure — the single source of truth the
    AI is NOT allowed to override or annualize away.

    Per-resource hourly loss = the grounded downtime_cost_hr from the BIA matrix (a customer-
    stated financial_loss_per_hour, or an estimate anchored to the resource's actual Azure
    run-rate — never a fictional score multiple). Aggregates:
      • per_hour    = sum of hourly losses (worst case: the whole in-scope estate down at once)
      • per_day     = per_hour × 24 (worst-case 24h concurrent outage)
      • annualized  = sum(hourly × EXPECTED annual outage hours per tier × posture factor) —
                      a realistic availability budget (a few hours a year), NOT 8,760 hours.
    """
    rd_by_id = {(r.get("resource_id") or r.get("id") or "").lower(): r for r in resource_dicts}
    total_per_hr = 0.0
    total_annual = 0.0
    total_monthly = 0.0
    stated_n = 0
    exposed: List[tuple] = []
    for m in matrix:
        per_hr = float(m.get("downtime_cost_hr") or 0)
        tier = m.get("bia_tier") or "Business-Operational"
        rd = rd_by_id.get((m.get("resource_id") or "").lower(), {})
        annual_hrs = _TIER_ANNUAL_DT_HRS.get(tier, 2.0)
        posture = _POSTURE_FACTOR.get(_posture_key(rd), 1.0)
        annual = per_hr * annual_hrs * posture
        total_per_hr += per_hr
        total_annual += annual
        total_monthly += float(m.get("monthly_cost") or 0)
        if (m.get("downtime_cost_source") or "") == "Stated":
            stated_n += 1
        if per_hr > 0:
            exposed.append((per_hr, m.get("resource_name") or "", tier))
    exposed.sort(reverse=True)
    most_exposed = [f"{name} ({tier}) — est. {_money(hr)}/hr" for hr, name, tier in exposed[:6]]

    per_hour = round(total_per_hr, 2)
    per_day = round(total_per_hr * 24, 2)
    annualized = round(total_annual, 2)
    if stated_n:
        src = (f"{stated_n} of {len(matrix)} resources use the customer's stated financial loss/hour; "
               "the remainder are anchored to each resource's actual Azure run-rate")
    else:
        src = ("no resource has a stated financial loss/hour, so the downtime figures are ESTIMATES of "
               "business loss anchored to each resource's actual Azure run-rate (hourly spend × a "
               "conservative tier multiplier, tier-floored) — not the Azure bill and not an abstract "
               "criticality score")
    basis = (
        f"FACT — the in-scope estate's actual Azure run-rate is {_money(total_monthly)}/month "
        f"(Azure Cost Management, region/SKU-accurate). The downtime figures below are ESTIMATES of "
        f"business impact, not the Azure cost: per-hour is the worst-case concurrent loss if all "
        f"{len(matrix)} in-scope resources are down at once; per-day is that rate over 24h; annualized "
        f"applies a realistic expected outage budget per tier (Mission-Critical 8h, Business-Critical 4h, "
        f"Business-Operational 2h, Low 1h/yr) reduced by current backup/zone posture — NOT a full year of "
        f"downtime. {src}. For precise business-loss figures, tag financial_loss_per_hour on critical workloads."
    )
    return {
        "actual_monthly_run_rate": f"{_money(total_monthly)}/mo",
        "per_hour": f"{_money(per_hour)}/hr",
        "per_day": f"{_money(per_day)}/day",
        "annualized": f"{_money(annualized)}/yr",
        "basis": basis,
        "most_exposed_services": most_exposed,
        "_per_hour_num": per_hour,
        "_annualized_num": annualized,
        "_monthly_num": round(total_monthly, 2),
    }


def generate_bia_report(
    resources: List[Any],
    metadata_map: Optional[Dict[str, dict]] = None,
    intake: Optional[Dict[str, Any]] = None,
    custom_tags: Optional[Dict[str, dict]] = None,
    sub_names: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Generate the full consultant-grade, framework-based Business Impact Analysis (deterministic
    grounding + AI narrative) for the supplied (already filtered) resources."""
    client, model, provider = _get_ai_client_for_analysis()
    if not client:
        raise RuntimeError(
            "No AI provider configured. Set AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_KEY (or ANTHROPIC_API_KEY) in Settings."
        )

    resource_dicts = [r if isinstance(r, dict) else getattr(r, "__dict__", {}) for r in (resources or [])]
    meta = metadata_map or {}
    intake = intake or {}
    # Honour per-resource customer intent: promote dominant per-resource RTO / RPO / target
    # region (Phase-1 classification or custom tags) to the intake defaults when not stated on
    # the form, so the BIA references the customer's DESIRED values rather than labelling them
    # "(recommended - no customer target)".
    intake = _augment_intake_from_resources(dict(intake), resource_dicts, meta, custom_tags or {})

    # 1. Deterministic grounding — reuse the static BIA engine + posture metrics.
    static_bia = build_business_impact_analysis(
        resource_dicts, bcdr_assessments=None, metadata=meta,
        custom_tags=custom_tags or {}, sub_names=sub_names or {},
    )
    metrics = _compute_posture_metrics(resource_dicts, meta)
    grounding = _bia_grounding_block(static_bia)

    # 2. AI context — prioritise customer-classified workloads, then the most impactful by the
    #    deterministic score, capped so the prompt stays within budget.
    matrix = static_bia.get("impact_matrix", []) or []
    rank = {m.get("resource_id"): i for i, m in enumerate(matrix)}  # already sorted by impact desc
    ordered = sorted(resource_dicts, key=lambda r: rank.get(r.get("resource_id") or r.get("id"), 10_000))
    MAX_NARRATIVE = 140
    sample = ordered[:MAX_NARRATIVE]
    compressed = [_compress_resource(r) for r in sample]
    resources_json = _serialize_for_ai(compressed)
    meta_lines = _build_metadata_lines(resource_dicts, meta)

    # Deterministic, reality-anchored financial exposure (authoritative — the AI may NOT
    # change these figures or annualize by a full year). Appended to the grounding so the
    # narrative stays consistent with the numbers we surface.
    exposure = _compute_financial_exposure(matrix, resource_dicts)
    grounding = grounding + (
        "\n\nAUTHORITATIVE FINANCIAL EXPOSURE (use these EXACT figures; do NOT recompute, inflate or "
        "annualize by a full year of downtime):\n"
        f"  Per hour (worst-case concurrent): {exposure['per_hour']}\n"
        f"  Per day (24h concurrent): {exposure['per_day']}\n"
        f"  Annualized (realistic expected outage budget per tier × posture, NOT 8,760h): {exposure['annualized']}\n"
        f"  Basis: {exposure['basis']}"
    )

    # 3. AI narrative.
    system_prompt = _build_bia_system_prompt()
    user_prompt = _build_bia_user_prompt(metrics, grounding, meta_lines, resources_json, intake,
                                          resources_full=resource_dicts)
    raw = _call_ai(system_prompt, user_prompt, max_tokens=MAX_TOKENS_BIA)
    ai = _safe_json_parse(raw) or {}

    # 4. Normalise the criticality score.
    es = ai.get("executive_summary") or {}
    score = es.get("criticality_score")
    if not isinstance(score, (int, float)):
        score = _coerce_score(ai)
    if not isinstance(score, (int, float)):
        # Fall back to the deterministic tier mix (share of critical resources).
        ts = {t.get("tier"): t.get("count", 0) for t in static_bia.get("tier_summary", [])}
        total = max(1, static_bia.get("total_resources", 0))
        crit_share = (ts.get("Mission-Critical", 0) * 1.0 + ts.get("Business-Critical", 0) * 0.7
                      + ts.get("Business-Operational", 0) * 0.4 + ts.get("Low", 0) * 0.15) / total
        score = int(round(crit_share * 100))
    score = max(0, min(100, int(round(score))))
    es["criticality_score"] = score
    es["criticality_label"] = es.get("criticality_label") or _criticality_label(score)
    if not es.get("frameworks"):
        es["frameworks"] = FRAMEWORKS
    # Override the headline downtime-cost figure with the deterministic per-hour exposure so the
    # executive summary can never show an inflated number.
    es["aggregate_downtime_cost_per_hour"] = exposure["per_hour"]
    ai["executive_summary"] = es

    # Replace the AI's financial_exposure with the deterministic block (keep the AI's
    # most_exposed_services only if it supplied a non-empty list).
    fe_ai = ai.get("financial_exposure") or {}
    fe = {k: v for k, v in exposure.items() if not k.startswith("_")}
    if isinstance(fe_ai.get("most_exposed_services"), list) and fe_ai["most_exposed_services"]:
        fe["most_exposed_services"] = fe_ai["most_exposed_services"]
    ai["financial_exposure"] = fe

    # 5. Assemble cover + deterministic appendix (per-resource BIA matrix the model must not alter).
    now = datetime.now(timezone.utc)
    cover = {
        "customer_name": intake.get("customer_name") or "Customer",
        "assessment_period": intake.get("assessment_period") or now.strftime("%B %Y"),
        "prepared_by": intake.get("prepared_by") or "Azure Infra IQ",
        "report_version": intake.get("report_version") or "1.0",
        "date": now.strftime("%d %B %Y"),
        "title": "Business Impact Analysis",
    }
    bia_matrix = []
    for m in matrix:
        bia_matrix.append({
            "resource_name": m.get("resource_name"),
            "resource_type": _short_type(m),
            "resource_group": m.get("resource_group"),
            "location": m.get("location"),
            "subscription_name": m.get("subscription_name") or "",
            "bia_tier": m.get("bia_tier"),
            "impact_score": m.get("impact_score"),
            "criticality_source": m.get("criticality_source"),
            "criticality_tag": m.get("criticality_tag") or "",
            "dr_tier": m.get("dr_tier") or "",
            "rto_target": m.get("rto_target") or "",
            "rpo_target": m.get("rpo_target") or "",
            "target_rto_hours": m.get("target_rto_hours"),
            "downtime_cost_hr": m.get("downtime_cost_hr"),
            "downtime_cost_source": m.get("downtime_cost_source"),
            "business_owner": m.get("business_owner") or "",
            "data_classification": m.get("data_classification") or "",
            "monthly_cost": m.get("monthly_cost"),
        })

    report = {
        "cover": cover,
        "metrics": metrics,
        "tier_summary": static_bia.get("tier_summary", []),
        "executive_summary": ai.get("executive_summary", {}),
        "methodology": ai.get("methodology", {}) or {
            "approach": "Standards-based Business Impact Analysis over the selected Azure estate.",
            "frameworks_applied": [{"framework": f, "how_applied": ""} for f in FRAMEWORKS],
            "data_sources": ["Azure resource inventory", "Azure resource tags",
                             "Phase-1 BCDR classification & custom tags", "Resource properties & posture",
                             "Stakeholder BIA intake"],
        },
        "business_services": ai.get("business_services", []),
        "criticality_tiers": ai.get("criticality_tiers", []),
        "impact_over_time": ai.get("impact_over_time", []),
        "recovery_objectives": ai.get("recovery_objectives", []),
        "dependency_analysis": ai.get("dependency_analysis", {}),
        "financial_exposure": ai.get("financial_exposure", {}),
        "resource_requirements": ai.get("resource_requirements", {}),
        "recovery_sequence": ai.get("recovery_sequence", []),
        "gaps_and_recommendations": ai.get("gaps_and_recommendations", []),
        "risk_register": ai.get("risk_register", []),
        "conclusion": ai.get("conclusion", {}),
        "appendices": {
            "bia_matrix": bia_matrix,
        },
        # grounding signals
        "grounding": {
            "tagged_count": static_bia.get("tagged_count", 0),
            "tagged_pct": static_bia.get("tagged_pct", 0),
            "stated_downtime_count": static_bia.get("stated_downtime_count", 0),
            "total_stated_downtime_cost_hr": static_bia.get("total_stated_downtime_cost_hr", 0),
            "frameworks": FRAMEWORKS,
        },
        # run metadata
        "overall_score": score,
        "score_label": es.get("criticality_label"),
        "model": model or "unknown",
        "provider": provider or "unknown",
        "generated_at": now.isoformat(),
        "intake": intake,
    }

    # Deterministic post-processing — never trust the AI for this. Compute what the customer
    # actually supplied at intake (vs what we had to assume), and force the recovery-objective
    # tables to say "Not supplied" in the current columns + suffix recommended columns with
    # "(recommended — no customer target)" wherever no target was stated. This is what gives
    # the reader an honest, auditable view of stated vs assumed.
    intake_summary, assumptions = _build_intake_audit(intake)
    report["intake_summary"] = intake_summary
    report["assumptions"] = assumptions
    _normalize_recovery_objectives(report, intake)
    _normalize_criticality_tiers(report, intake)

    logger.info(
        "BIA report generated | customer=%s resources=%d tagged=%d%% score=%s model=%s",
        cover["customer_name"], metrics["total_resources"], static_bia.get("tagged_pct", 0), score, model,
    )
    return report
