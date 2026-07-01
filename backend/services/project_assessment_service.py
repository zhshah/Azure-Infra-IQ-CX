"""
Project Assessment Service — runs a focused, tag-grounded AI assessment for a SAVED
PROJECT (a user-named subset of resources) in a chosen category.

This is the engine behind the "Saved Project Workspace": the customer saves a set of
resources as a project, tags them (RTO / RPO / Criticality / DR_Tier / … via the existing
resource-level custom-tag system), then picks an assessment category (BCDR, Security,
Backup, Resilience, Migration, Cost/FinOps, Update Management, Well-Architected) and runs
an advanced AI assessment scoped ONLY to that project's resources and grounded on those tags.

Design notes
------------
* 100% additive — it does NOT modify the existing per-category dashboard analyses. It reuses
  their proven plumbing (model client, resource compression, custom-tag enrichment, robust
  JSON parsing, anti-hallucination rules) so output quality and grounding match the rest of
  the app and we never duplicate model wiring.
* Grounding: every resource is enriched with its user-defined custom_tags (Criticality,
  DR_Tier, RPO, RTO, Environment, Owner, …) before being sent to the model. The prompt forces
  the model to reference ONLY the supplied resources/tags and to never invent identifiers.
* Uniform output shape across all 8 categories so the UI renders one consistent result view.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from services.ai_infra_service import (
    _get_ai_client_for_analysis,
    _compress_resource,
    _enrich_with_custom_tags,
    _build_tag_summary,
    _serialize_for_ai,
    _call_ai,
)
from services.ai_module_analysis_service import (
    _safe_json_parse,
    _coerce_score,
    _build_resource_lookup,
    _resolve_affected_resources,
    RESOURCE_ATTRIBUTION_INSTRUCTION,
)
from services.qatar_bcdr_policy import (
    QATAR_POLICY_SYSTEM_RULES,
    build_qatar_grounding_block,
    build_service_playbook_prompt_block,
)

logger = logging.getLogger(__name__)

MAX_TOKENS_PROJECT_ASSESSMENT = 8000


# ── Category catalogue ────────────────────────────────────────────────────────
# Each entry drives the system role + the category-specific focus block and the
# weighted pillars the model scores against. Keys MUST match the frontend picker.

CATEGORY_FOCUS: Dict[str, Dict[str, Any]] = {
    "bcdr": {
        "label": "Business Continuity & Disaster Recovery",
        "role": "a senior Azure Business Continuity & Disaster Recovery architect",
        "frameworks": "Azure Well-Architected Reliability pillar, Azure Business Continuity guidance, ISO 22301",
        "pillars": [
            {"name": "Recovery Readiness (RTO/RPO alignment)", "weight": 0.35},
            {"name": "Geo-redundancy & Failover", "weight": 0.25},
            {"name": "Backup Coverage", "weight": 0.20},
            {"name": "DR Testing & Runbooks", "weight": 0.20},
        ],
        "focus": (
            "Evaluate each resource's disaster-recovery posture. Compare the CURRENT replication/"
            "backup/failover configuration against the customer's tagged RTO and RPO targets and "
            "Criticality/DR_Tier. Flag Mission Critical / Business Critical resources with no geo-"
            "redundancy, no backup, or RTO/RPO gaps FIRST. Recommend concrete Azure DR patterns "
            "(zone-redundant, geo-replication, paired-region, Azure Site Recovery, GRS/GZRS storage)."
        ),
        "emphasis": (
            "Ground every point in the resource's ACTUAL recovery posture versus the customer's tagged "
            "targets. For each resource compare has_backup, zone_status and is_sql_replica against its "
            "RTO/RPO/DR_Tier/Criticality custom_tags and state the SPECIFIC gap, e.g. 'Mission Critical, "
            "RTO 1h tagged, but has_backup=false and single-region \u2014 current achievable RTO is hours-to-days'.\n"
            "- Lead with the highest-Criticality resources that have the widest RTO/RPO gap.\n"
            "- Recommend a CONCRETE Azure DR pattern per resource type \u2014 zone-redundant / availability-zone "
            "SKU, geo-replication, SQL Auto-Failover Groups, Azure Site Recovery (VMs), GRS/GZRS or Object "
            "Replication (storage), paired/secondary region \u2014 and state the residual RTO/RPO it achieves. "
            "Never write 'improve DR'.\n"
            "- Assess recovery ONLY for stateful/regional types; control-plane/stateless types (action groups, "
            "NSGs, public IPs, DNS, RBAC) are protected via IaC redeploy + resource lock, not backup/geo-redundancy "
            "\u2014 mark those not-applicable, do not score them as gaps."
        ),
    },
    "security": {
        "label": "Security Posture",
        "role": "a senior Azure Security Architect and CISO advisor",
        "frameworks": "Microsoft Cloud Security Benchmark (MCSB), NIST CSF 2.0, CIS Azure, Zero Trust, WAF Security pillar",
        "pillars": [
            {"name": "Identity & Access", "weight": 0.25},
            {"name": "Network Security", "weight": 0.25},
            {"name": "Data Protection", "weight": 0.25},
            {"name": "Threat Protection & Monitoring", "weight": 0.25},
        ],
        "focus": (
            "Assess the security posture of the project's resources: public exposure, private "
            "endpoints, encryption, identity/RBAC, key management, and threat protection. Prioritise "
            "findings on resources tagged with higher Criticality or sensitive DataClass."
        ),
        "emphasis": (
            "Ground every finding in a REAL exposure / identity / encryption signal present in the data "
            "(has_private_endpoint, public exposure, has_lock, rbac_assignments, and resource-type config) "
            "\u2014 never a generic checklist. Map each material finding briefly to an MCSB / NIST CSF / CIS control.\n"
            "- Put internet-exposed data/PaaS services (has_private_endpoint=false) and higher-Criticality / "
            "sensitive-DataClass resources FIRST.\n"
            "- Give the SPECIFIC control to apply per type \u2014 'add a private endpoint + set public network access "
            "Disabled', 'enforce managed identity and disable shared keys', 'add a resource lock', 'tighten RBAC "
            "(N assignments \u2014 review for least privilege)', 'enable Microsoft Defender for <type>'. Never write "
            "'improve security'.\n"
            "- Do NOT raise backup / DR / RPO / RTO points here \u2014 treat has_backup and zone_status as out of scope.\n"
            "- When a security signal is not collected for a resource, record it as a data gap in key_risks "
            "(low confidence) rather than assuming a vulnerability."
        ),
    },
    "backup": {
        "label": "Backup & Data Protection",
        "role": "a senior Azure Backup and data-protection specialist",
        "frameworks": "Azure Backup best practices, Azure Well-Architected Reliability pillar",
        "pillars": [
            {"name": "Backup Coverage", "weight": 0.40},
            {"name": "Retention vs RPO", "weight": 0.30},
            {"name": "Restore Testing", "weight": 0.15},
            {"name": "Immutability & Soft-delete", "weight": 0.15},
        ],
        "focus": (
            "Determine which resources are protected by backup and which are not. Validate retention "
            "against the tagged RPO target. Mission Critical / Business Critical resources WITHOUT "
            "backup are top findings. Recommend Recovery Services Vault / Backup Vault policies."
        ),
        "emphasis": (
            "Ground every point in has_backup and the resource type. For each stateful resource state "
            "protected vs unprotected and validate retention against the tagged RPO; Mission/Business "
            "Critical resources with has_backup=false are the top findings.\n"
            "- Recommend the SPECIFIC mechanism per type \u2014 Recovery Services Vault policy (VMs / SQL-in-VM / "
            "Azure Files), Backup Vault (Blob / Managed Disks / PostgreSQL), or point-in-time + geo-redundant "
            "backup (PaaS DBs) \u2014 with a retention that meets the tagged RPO, and state the retention/RPO delta. "
            "Never write 'set up backup'.\n"
            "- Stateless/control-plane types (NSGs, route tables, public IPs, action groups, DNS) have nothing to "
            "back up \u2014 mark them not-applicable and protect via IaC + resource lock instead; do NOT score them as gaps.\n"
            "- Where backup state is unknown for a type, note the data gap rather than assuming unprotected."
        ),
    },
    "resilience": {
        "label": "Resilience & High Availability",
        "role": "a senior Azure reliability engineer",
        "frameworks": "Azure Well-Architected Reliability pillar, Azure availability zones guidance",
        "pillars": [
            {"name": "Redundancy (zones/regions)", "weight": 0.35},
            {"name": "Scalability & Self-healing", "weight": 0.25},
            {"name": "Health Monitoring", "weight": 0.20},
            {"name": "Dependency Resilience", "weight": 0.20},
        ],
        "focus": (
            "Assess high availability and fault tolerance: availability-zone usage, redundant SKUs, "
            "autoscale, single points of failure. Align expected resilience to each resource's "
            "Criticality/DR_Tier tag — Mission Critical resources on single-instance SKUs are key findings."
        ),        "emphasis": (
            "Ground every point in real redundancy signals (zone_status, sku, power_state) and the resource "
            "type. Compare expected resilience to each resource's Criticality/DR_Tier tag \u2014 a Mission Critical "
            "resource on a single-instance / non-zonal SKU is a key finding.\n"
            "- Recommend a CONCRETE HA action per type \u2014 move to a zone-redundant SKU / spread across "
            "availability zones, add instances or enable autoscale, front with a load balancer / Azure Front Door, "
            "remove the single point of failure \u2014 and state the failure mode it removes (zone outage, instance "
            "failure, region outage). Never write 'improve resilience'.\n"
            "- Assess HA ONLY for types that support it; stateless/control-plane/managed types are inherently "
            "regional \u2014 mark them not-applicable, do not invent a redundancy gap."
        ),    },
    "migration": {
        "label": "Migration & Modernization",
        "role": "a senior Azure migration and modernization architect",
        "frameworks": "Azure Migrate, Cloud Adoption Framework, 5R rationalization (Rehost/Refactor/Rearchitect/Rebuild/Replace)",
        "pillars": [
            {"name": "Modernization Opportunity", "weight": 0.30},
            {"name": "PaaS/Serverless Fit", "weight": 0.25},
            {"name": "Migration Risk & Readiness", "weight": 0.25},
            {"name": "Cost/Operational Benefit", "weight": 0.20},
        ],
        "focus": (
            "Identify modernization paths for the project's resources (e.g. VM→Container Apps/AKS, "
            "IaaS DB→PaaS Flexible Server, legacy→serverless). Classify with 5R. Respect MigrationStatus "
            "tags. Weigh business benefit against migration risk for Critical workloads."
        ),        "emphasis": (
            "Classify EACH in-scope resource with the 5 Rs (Rehost / Refactor / Rearchitect / Rebuild / Replace) "
            "and name the SPECIFIC Azure target, grounded in its type and utilization \u2014 e.g. 'IaaS VM running a "
            "stateless web tier \u2192 Rearchitect to Azure Container Apps', 'SQL-on-VM \u2192 Replace with Azure SQL "
            "Managed Instance', 'always-on low-util VM \u2192 Rehost then rightsize'. Respect any MigrationStatus tag.\n"
            "- Lead with the highest business-benefit / lowest-risk moves; for Mission/Business Critical workloads "
            "call out the migration risk explicitly.\n"
            "- Quantify the benefit where data allows (cost_mtd that PaaS/serverless could reduce, idle VMs that "
            "should be RETIRED rather than migrated).\n"
            "- Do NOT raise pure backup / security / patching points here unless they are a genuine migration blocker."
        ),    },
    "cost": {
        "label": "Cost & FinOps Optimization",
        "role": "a senior Azure FinOps practitioner",
        "frameworks": "FinOps Framework, Azure Well-Architected Cost Optimization pillar",
        "pillars": [
            {"name": "Rightsizing", "weight": 0.30},
            {"name": "Idle/Orphaned Waste", "weight": 0.30},
            {"name": "Commitment Coverage (RI/SP)", "weight": 0.20},
            {"name": "Tagging & Allocation", "weight": 0.20},
        ],
        "focus": (
            "Find cost-optimization opportunities: idle/orphaned resources, oversized SKUs, missing "
            "reservations/savings plans, and untagged spend. Use cost_mtd/cost_prev and utilization "
            "fields. Do NOT recommend downsizing Mission Critical resources without a resilience caveat."
        ),
        "emphasis": (
            "QUANTIFY EVERYTHING IN DOLLARS — this is a FinOps cost analysis, NOT a generic Well-Architected, "
            "security, or backup review. Every finding, recommendation, and pillar rationale MUST be tied to "
            "real money using each resource's cost_mtd (current month-to-date spend), cost_prev (previous "
            "month), and estimated_monthly_savings fields. An item that does not move spend does not belong "
            "here.\n"
            "- START the executive_summary with the TOTAL identified potential monthly savings — literally sum "
            "estimated_monthly_savings across the in-scope resources — and how many of the N resources drive it "
            "(e.g. 'Approx. $3,250/mo in identified savings across 7 of 26 resources, concentrated in idle VMs "
            "and one oversized file share.').\n"
            "- RANK findings and recommendations by dollar impact: highest cost_mtd or estimated_monthly_savings "
            "FIRST. Lead with the single biggest spender.\n"
            "- Each recommendation MUST name the specific resource(s), quote their actual numbers ($cost_mtd/mo "
            "now, ~$estimated_monthly_savings/mo saving), and give ONE concrete, decision-ready action — NOT "
            "'review/validate/assess'. Use the right lever for the evidence:\n"
            "    • power_state='deallocated' + high days_idle / workload_pattern='inactive' / is_orphan=true → "
            "delete or deallocate-and-strip (note the disk/IP that still bills when a VM is merely stopped).\n"
            "    • low util_pct/cpu_pct/mem_pct on a running resource → downsize to a specific smaller SKU tier "
            "(e.g. one size down within the same family) and state the expected ~$ saved.\n"
            "    • ri_covered=false + stable/always-on usage (trend='stable', not idle) → buy a 1-yr or 3-yr "
            "Reserved Instance or Savings Plan and give the indicative discount band (RI/SP typically ~30-60% "
            "vs pay-as-you-go).\n"
            "    • auto_shutdown=false on a non-production / intermittently used VM → apply an auto-shutdown / "
            "start-stop schedule and estimate the off-hours saving.\n"
            "- When utilization telemetry is missing (telemetry_source='cost_only' or low data_confidence), STILL "
            "give the cost action based on cost + power_state + days_idle, but append 'validate with Azure "
            "Monitor before resizing'. Do NOT let a missing CPU metric downgrade a concrete savings item into "
            "vague advice — that is the failure mode to avoid.\n"
            "- Put real numbers in business_impact too (e.g. '~$1,230/mo, ~$14.8K/yr'). If a recommendation has "
            "no quantifiable spend effect, drop it."
        ),
    },
    "updates": {
        "label": "Update & Patch Management",
        "role": "a senior Azure operations and patch-management engineer",
        "frameworks": "Azure Update Manager best practices, Azure Well-Architected Operational Excellence pillar",
        "pillars": [
            {"name": "Patch Coverage", "weight": 0.40},
            {"name": "Maintenance Windows", "weight": 0.25},
            {"name": "OS/Runtime Currency", "weight": 0.20},
            {"name": "Compliance Reporting", "weight": 0.15},
        ],
        "focus": (
            "Assess patch and update posture for VMs, scale sets, and managed platforms. Identify "
            "resources lacking update management or maintenance configurations. Prioritise Production "
            "(Environment tag) and Mission Critical resources for patch compliance."
        ),
        "emphasis": (
            "Assess patch/update posture ONLY for patchable types (VMs, scale sets, Arc-enabled servers, and "
            "managed runtimes). Ground findings in the real signals available (power_state, telemetry_source, "
            "OS/runtime fields) and prioritise Production (Environment tag) and Mission Critical resources.\n"
            "- Recommend CONCRETE actions \u2014 onboard to Azure Update Manager, attach a maintenance configuration / "
            "patch schedule, enable periodic assessment, bring an end-of-life OS/runtime current. Name the tool, "
            "never write 'keep it patched'.\n"
            "- PaaS / serverless / control-plane types are patched by the platform \u2014 mark them not-applicable; do "
            "NOT flag them as unpatched.\n"
            "- Where patch/update state is not collected, record it as a data gap rather than assuming non-compliance."
        ),
    },
    "waf": {
        "label": "Well-Architected Review",
        "role": "a senior Azure Well-Architected Framework reviewer",
        "frameworks": "Azure Well-Architected Framework (Reliability, Security, Cost Optimization, Operational Excellence, Performance Efficiency)",
        "pillars": [
            {"name": "Reliability", "weight": 0.22},
            {"name": "Security", "weight": 0.22},
            {"name": "Cost Optimization", "weight": 0.20},
            {"name": "Operational Excellence", "weight": 0.18},
            {"name": "Performance Efficiency", "weight": 0.18},
        ],
        "focus": (
            "Run a balanced Well-Architected review across all five pillars for the project's resources. "
            "Use custom tags (Criticality, DR_Tier, RPO, RTO, Environment) to calibrate expectations per "
            "resource. Provide a pillar-by-pillar score and the highest-leverage cross-pillar actions."
        ),
        "emphasis": (
            "Run a balanced five-pillar Well-Architected review, but keep every point EVIDENCE-LED and tied to a "
            "real resource value \u2014 not generic WAF theory. For each pillar cite the specific resources and fields "
            "driving the score: Reliability \u2192 zone_status / has_backup; Security \u2192 has_private_endpoint / "
            "rbac_assignments; Cost \u2192 cost_mtd / ri_covered / utilization; Operational Excellence \u2192 tags / "
            "telemetry_source; Performance \u2192 utilization / sku.\n"
            "- Calibrate expectations per resource using Criticality / DR_Tier / Environment tags.\n"
            "- Surface the highest-leverage CROSS-pillar actions first (one change that helps multiple pillars), "
            "each with a concrete action and the pillars it improves.\n"
            "- Score a pillar only over the resources it applies to; flag any pillar that is thin on evidence as a data gap."
        ),
    },
}

# Friendly fallback so an unknown key still produces a sane generic review.
_DEFAULT_CATEGORY = "waf"


def list_categories() -> List[Dict[str, str]]:
    """Return the catalogue of supported assessment categories for the UI picker."""
    return [{"key": k, "label": v["label"]} for k, v in CATEGORY_FOCUS.items()]


def _score_label(score) -> str:
    if score is None:
        return "Not Applicable"
    if score >= 85:
        return "Excellent"
    if score >= 70:
        return "Good"
    if score >= 50:
        return "Fair"
    if score >= 30:
        return "At Risk"
    return "Critical"


def _build_system_prompt(cat: Dict[str, Any], cat_key: str = "") -> str:
    cat_key = (cat_key or "").lower()
    qatar_addendum = ("\n\n" + QATAR_POLICY_SYSTEM_RULES) if cat_key in ("bcdr", "backup", "resilience") else ""
    return (
        f"You are {cat['role']}. You assess a SPECIFIC, user-defined PROJECT — a curated subset of "
        f"Azure resources — for the '{cat['label']}' category and return a structured, board-ready "
        f"assessment.\n\n"
        f"Reference frameworks: {cat['frameworks']}.\n\n"
        "GROUNDING RULES (MANDATORY — non-negotiable):\n"
        "- Analyse ONLY the resources in the PROJECT RESOURCES JSON below. Never invent resources, "
        "identifiers, SKUs, costs, regions, or configuration that is not present in the data.\n"
        "- Every finding, recommendation, and pillar rationale MUST cite a SPECIFIC value that is present "
        "in the data — a field (e.g. type_full, has_backup, has_private_endpoint, sku, util_pct, "
        "telemetry_source) or a custom_tag (e.g. Criticality, RPO, RTO). If you cannot cite a present "
        "value, DO NOT output the item.\n"
        "- The user's 'custom_tags' are authoritative business intent from the Phase 1 BCDR planning "
        "exercise — ground every score and recommendation in them. They may include: Criticality, "
        "DR_Tier, RPO, RTO, Environment, Owner, DataClass, BusinessFunction, TargetRegion, DesiredSKU, "
        "FinancialLossPerHour, AppDependencies, Compliance and PlanningNotes. Treat TargetRegion/DesiredSKU "
        "as the customer's intended DR target state, FinancialLossPerHour as downtime business impact, "
        "AppDependencies as recovery-ordering constraints, and Compliance/DataClass as residency/retention "
        "drivers.\n\n"
        "RESOURCE-TYPE FIT (MANDATORY — this is what keeps the assessment specific, not generic):\n"
        "- For EACH resource, first determine what its Azure type ('type_full') actually IS and DOES, then "
        "assess it ONLY against controls that are RELEVANT to that type. Tailor every finding and "
        "recommendation to the nature of that exact resource type.\n"
        "- NEVER raise a finding, invent a risk, or lower a score for a capability that does NOT apply to a "
        "resource's type. Non-applicable examples: data backup / geo-replication / RPO-RTO data recovery "
        "for control-plane or stateless resources (action groups, alert rules, NSGs, route tables, public "
        "IPs, DNS zones, RBAC assignments, policy assignments); OS patching for PaaS/serverless; VM "
        "right-sizing for consumption/serverless resources.\n"
        "- A scoring pillar applies to the PROJECT only if it is relevant to AT LEAST ONE in-scope "
        "resource. Score each applicable pillar over just the resources it applies to. If a pillar applies "
        "to NONE of the in-scope resources, OMIT it from 'pillar_scores', EXCLUDE it from 'overall_score' "
        "(renormalise the remaining pillar weights to sum to 1), and add one short 'key_risks' note saying "
        "why it was not applicable. NEVER score an inapplicable pillar as a low number.\n"
        "- When a resource's type makes a control irrelevant, the correct posture is 'not applicable', not "
        "a gap — recommend type-appropriate protection instead (e.g. for an action group: protect via "
        "IaC/ARM redeploy, RBAC + resource lock, and tested notification delivery — never 'enable "
        "geo-redundant backup').\n"
        "- WHOLE-CATEGORY NOT APPLICABLE (CRITICAL): if NONE of this category's pillars apply to ANY "
        "in-scope resource (i.e. the entire category is irrelevant to the resource types present — e.g. an "
        "Update & Patch Management assessment whose only resource is an action group, or a Backup "
        "assessment over only NSGs/route tables), then this is NOT a failing score. Set "
        "\"applicability\": \"not_applicable\", set \"overall_score\": null, leave \"pillar_scores\" empty, "
        "and make the FIRST sentence of executive_summary state plainly that this category does not "
        "directly apply to the in-scope resource type(s) and explain why. Still provide type-appropriate "
        "recommendations and note the mismatch in key_risks. If SOME pillars apply and others do not, set "
        "\"applicability\": \"partial\" and score only the applicable pillars. Otherwise set "
        "\"applicability\": \"applicable\".\n\n"
        "KNOWN vs UNKNOWN (MANDATORY):\n"
        "- A field present and false (e.g. has_backup=false) is a KNOWN state, but only counts as a "
        "deficiency if that capability APPLIES to the resource's type.\n"
        "- If a signal needed to judge a resource is ABSENT (not collected), treat it as UNKNOWN: record "
        "the data gap in 'key_risks' and reflect it in low data confidence — do NOT manufacture a finding "
        "from missing data. Use each resource's 'data_confidence' and 'telemetry_source' to gauge how much "
        "real evidence backs your conclusions.\n\n"
        + RESOURCE_ATTRIBUTION_INSTRUCTION
        + qatar_addendum
        + "\n\nReturn ONLY compact JSON (no markdown fences) with EXACTLY this shape:\n"
        "{\n"
        '  "overall_score": <int 0-100, or null when applicability is "not_applicable">,\n'
        '  "applicability": "applicable|partial|not_applicable",\n'
        '  "applicability_note": "<1 sentence — why this category does/does not fit the in-scope resource types>",\n'
        '  "executive_summary": "<2-4 sentence executive summary for this project>",\n'
        '  "pillar_scores": [ {"name": "<pillar>", "score": <int 0-100>, "rationale": "<1 sentence>"} ],\n'
        '  "findings": [ {"severity": "critical|high|medium|low", "title": "<short>", "detail": "<1-2 sentences>", '
        '"affected_resources": [ {"resource_name": "<name>", "resource_id": "<id>"} ], "affected_count": <int>} ],\n'
        '  "recommendations": [ {"priority": "P1|P2|P3", "action": "<imperative action>", "rationale": "<why, tied to tags/data>", '
        '"effort": "Low|Medium|High", "business_impact": "<impact>", "affected_resources": [ {"resource_name": "<name>", "resource_id": "<id>"} ]} ],\n'
        '  "tag_driven_insights": [ "<insight derived specifically from RTO/RPO/Criticality/DR_Tier tags>" ],\n'
        '  "key_risks": [ "<residual risk or data gap>" ]\n'
        "}\n"
        "Limits: at most 8 findings, 8 recommendations, 6 pillar_scores, 5 affected_resources per item "
        "(use affected_count for the rest). Order findings and recommendations by business priority."
    )


def _build_project_context_block(project: Dict[str, Any]) -> str:
    """Render the user-supplied project-level metadata as authoritative business context.

    These fields are set by the user when creating the project (Focus Area, Criticality,
    Environment, Business Unit, Owner, and optional DR targets). They frame the WHOLE project
    and ground the assessment even for resources that are not yet individually tagged.
    """
    _ctx = [
        ("Focus area",    project.get("focus_area")),
        ("Criticality",   project.get("criticality")),
        ("Environment",   project.get("environment")),
        ("Business unit", project.get("business_unit")),
        ("Owner",         project.get("owner")),
        ("Target RTO",    project.get("rto_target")),
        ("Target RPO",    project.get("rpo_target")),
        ("DR tier",       project.get("dr_tier")),
    ]
    lines = [f"  - {label}: {val}" for label, val in _ctx if val]
    if not lines:
        return ""
    return (
        "PROJECT BUSINESS CONTEXT (user-supplied; authoritative business intent — apply to ALL "
        "resources in this project unless a resource's own custom_tags override it):\n"
        + "\n".join(lines)
        + "\n\n"
    )


def _build_user_prompt(project: Dict[str, Any], cat: Dict[str, Any], tag_summary: str, resources_json: str, resource_count: int, resources_full: Optional[List[Dict[str, Any]]] = None, cat_key: str = "") -> str:
    name = project.get("name", "Untitled project")
    desc = (project.get("description") or "").strip()
    cat_key = (cat_key or "").lower()
    qatar_block = ""
    playbook_block = ""
    if cat_key in ("bcdr", "backup", "resilience") and resources_full:
        ci = {
            "customer_name": project.get("name"),
            "primary_region": project.get("primary_region"),
            "secondary_region": project.get("secondary_region") or project.get("target_region"),
        }
        qatar_block = build_qatar_grounding_block(resources_full, ci)
        playbook_block = build_service_playbook_prompt_block(resources_full)
    return (
        f"PROJECT: {name}\n"
        f"{('DESCRIPTION: ' + desc) if desc else ''}\n"
        f"RESOURCES IN PROJECT: {resource_count}\n\n"
        + _build_project_context_block(project)
        + qatar_block
        + playbook_block
        + f"ASSESSMENT CATEGORY: {cat['label']}\n"
        f"FOCUS: {cat['focus']}\n\n"
        + (f"CATEGORY-SPECIFIC OUTPUT REQUIREMENTS:\n{cat['emphasis']}\n\n" if cat.get('emphasis') else "")
        + f"SCORING PILLARS (weighted) — score each 0-100 and let the weighted blend drive overall_score. "
        f"Score a pillar ONLY if it applies to at least one resource below; OMIT any pillar that applies to "
        f"none of these resource types and renormalise the remaining weights:\n"
        + "\n".join(f"  - {p['name']} (weight {p['weight']})" for p in cat["pillars"])
        + "\n\n"
        f"{tag_summary}\n\n"
        f"PROJECT RESOURCES (JSON — analyse ONLY these):\n{resources_json}\n"
    )


def assess_project(project: Dict[str, Any], resources: List[Any], category: str) -> Dict[str, Any]:
    """
    Run a tag-grounded AI assessment for a project's resource subset in the given category.

    Args:
        project:   the project dict (id, name, description, resource_ids, …)
        resources: the resource objects/dicts BELONGING TO THIS PROJECT (already subset by caller)
        category:  one of CATEGORY_FOCUS keys

    Returns a uniform result dict (see schema in _build_system_prompt) plus run metadata.
    Raises RuntimeError if no AI provider is configured.
    """
    cat_key = (category or "").lower().strip()
    cat = CATEGORY_FOCUS.get(cat_key) or CATEGORY_FOCUS[_DEFAULT_CATEGORY]
    if cat_key not in CATEGORY_FOCUS:
        logger.warning(
            "Project assessment requested unknown category %r — falling back to generic '%s' review. "
            "Known categories: %s",
            category, _DEFAULT_CATEGORY, list(CATEGORY_FOCUS.keys()),
        )
        cat_key = _DEFAULT_CATEGORY

    # Confirm a provider is available up front for a clean error.
    client, model, provider = _get_ai_client_for_analysis()
    if not client:
        raise RuntimeError(
            "No AI provider configured. Set AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_KEY (or ANTHROPIC_API_KEY) in Settings."
        )

    # 1. Compress + enrich with the user's resource-level custom tags (RTO/RPO/Criticality/…).
    resource_dicts = [r if isinstance(r, dict) else getattr(r, "__dict__", {}) for r in (resources or [])]
    compressed = [_compress_resource(r) for r in resource_dicts]
    _enrich_with_custom_tags(compressed)

    # 1b. Merge the user's Phase 1 BCDR planning inputs (criticality, DR tier, RTO/RPO, target
    # region, desired SKU, business owner, financial loss/hr, app dependencies, data class,
    # compliance) into each resource's custom_tags so they GROUND the assessment, and pull in any
    # supporting documents the user uploaded in Phase 1. Phase 1 is authoritative business intent.
    attach_block = ""
    try:
        import services.bcdr_metadata_service as _bcdr
        attach_block = _bcdr.build_planning_grounding(compressed)
    except Exception as exc:
        logger.warning("BCDR Phase 1 enrichment skipped: %s", exc)

    tagged_count = sum(1 for r in compressed if r.get("custom_tags"))
    tag_summary = _build_tag_summary(compressed)
    resources_json = _serialize_for_ai(compressed)

    # 2. Build prompts and call the model (reuses the shared retry/backoff client).
    system_prompt = _build_system_prompt(cat, cat_key=cat_key)
    user_prompt = _build_user_prompt(project, cat, tag_summary, resources_json, len(compressed),
                                      resources_full=resource_dicts, cat_key=cat_key) + attach_block
    raw = _call_ai(system_prompt, user_prompt, max_tokens=MAX_TOKENS_PROJECT_ASSESSMENT)

    # 3. Parse robustly (handles token-cap truncation gracefully).
    result = _safe_json_parse(raw)

    # 4. Normalise + resolve affected resources to canonical objects for the UI.
    lookup = _build_resource_lookup(resource_dicts)
    for coll in ("findings", "recommendations"):
        items = result.get(coll)
        if isinstance(items, list):
            for it in items:
                if isinstance(it, dict) and isinstance(it.get("affected_resources"), list):
                    it["affected_resources"] = _resolve_affected_resources(it["affected_resources"], lookup)

    overall = result.get("overall_score")
    # Normalise the applicability signal. The model may flag the WHOLE category as not applicable
    # to the in-scope resource types (e.g. Update Management over only an action group). In that
    # case we must NOT show a misleading 0%/Critical — the score is N/A by design.
    applicability = str(result.get("applicability") or "").strip().lower()
    pillars_out = result.get("pillar_scores")
    has_pillars = isinstance(pillars_out, list) and len(pillars_out) > 0
    not_applicable = (
        applicability == "not_applicable"
        or (applicability != "applicable" and not has_pillars and overall in (None, 0, "0"))
    )

    if not_applicable:
        result["applicability"] = "not_applicable"
        result["overall_score"] = None
        result["score_label"] = "Not Applicable"
    else:
        if not isinstance(overall, (int, float)):
            overall = _coerce_score(result)  # fall back to the shared score extractor
        if not isinstance(overall, (int, float)):
            overall = 50
        overall = max(0, min(100, int(round(overall))))
        result["overall_score"] = overall
        result["score_label"] = _score_label(overall)
        if applicability not in ("applicable", "partial"):
            result["applicability"] = "partial" if has_pillars and len(pillars_out) < len(cat["pillars"]) else "applicable"

    # 5. Attach run metadata.
    result["category"] = cat_key
    result["category_label"] = cat["label"]
    result["model"] = model or "unknown"
    result["provider"] = provider or "unknown"
    result["resource_count"] = len(compressed)
    result["tagged_count"] = tagged_count
    result["tag_coverage_pct"] = (round(100 * tagged_count / len(compressed)) if compressed else 0)
    result["generated_at"] = datetime.now(timezone.utc).isoformat()

    logger.info(
        "Project assessment complete | project=%s category=%s resources=%d tagged=%d score=%s model=%s",
        project.get("name", "?"), cat_key, len(compressed), tagged_count,
        ("N/A" if result.get("overall_score") is None else result.get("overall_score")), model,
    )
    return result
