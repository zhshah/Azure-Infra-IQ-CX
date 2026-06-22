"""
BCDR Planning & Assessment Service — produces a CONSULTANT-GRADE Business Continuity /
Disaster Recovery planning document for a SAVED PROJECT (a user-named subset of resources).

This is the engine behind the "BCDR Plan" tab of the Saved Project Workspace. Unlike the
single-category project assessment (project_assessment_service), this produces ONE unified,
enterprise-standard planning document with four consultant sections — exactly what a senior
Azure resiliency consultant would hand a customer after careful planning on real data:

  1. Critical Services Identification   — application/infra tiers, key dependencies, BCDR gaps
  2. BCDR & Workload Prioritization     — current vs target RTO/RPO, suitable DR approaches, priority
  3. Infrastructure Modernization       — migration candidates (7R disposition) + target architecture
  4. FinOps & Cost Visibility           — cost observations, optimization levers, Infra IQ reporting

Design notes
------------
* 100% additive and reuses the SAME proven AI plumbing as every other analysis in the app
  (model client, resource compression, custom-tag enrichment, robust JSON parsing, resource
  attribution / anti-hallucination). Output quality and grounding therefore match the rest of
  the product and we never duplicate model wiring.
* Grounding: every resource is enriched with its user-defined custom_tags (Criticality, DR_Tier,
  RPO, RTO, Environment, Owner, DataClass, …) and real signals (has_backup, zone_status,
  is_sql_replica, has_private_endpoint, cost, utilisation). The prompt forces the model to
  reference ONLY the supplied resources/tags and never invent identifiers.
* The user also supplies project-level business intent (data classification, compliance regime,
  default RTO/RPO/criticality, preferred DR strategy, budget sensitivity, notes) which frames the
  WHOLE plan — so the output reflects real customer requirements, not generic best practice.
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

logger = logging.getLogger(__name__)

# A BCDR plan is a large, structured document → give the model generous head-room.
MAX_TOKENS_BCDR_PLAN = 16000

CATEGORY_KEY = "bcdr_plan"
CATEGORY_LABEL = "BCDR Planning & Assessment"

# Nested locations (dot-paths into the result) that carry an "affected_resources" list we
# resolve back to canonical resource objects for the UI / exports.
_AFFECTED_PATHS = [
    ("critical_services", "bcdr_gaps"),
    ("workload_prioritization", "workloads"),
    ("modernization", "candidates"),
    ("finops", "optimization_levers"),
]


def _score_label(score) -> str:
    if score is None:
        return "Not Assessed"
    if score >= 85:
        return "Resilient"
    if score >= 70:
        return "Established"
    if score >= 50:
        return "Developing"
    if score >= 30:
        return "At Risk"
    return "Critical Exposure"


def _posture_label(score) -> str:
    """CAF/WAF-aligned maturity posture for the cover/executive view."""
    if score is None:
        return "Not Assessed"
    if score >= 85:
        return "Mission-Ready"
    if score >= 70:
        return "Resilient"
    if score >= 50:
        return "Established"
    if score >= 30:
        return "Foundational"
    return "Initial"


def _build_inputs_context(project: Dict[str, Any], inputs: Optional[Dict[str, Any]]) -> str:
    """Render user-supplied business intent (authoritative) for the whole plan.

    Merges the project's saved metadata (set at creation) with the per-run inputs the user
    enters on the BCDR Plan tab. Per-run inputs win when both are present.
    """
    inp = {k: v for k, v in (inputs or {}).items() if v not in (None, "", [])}

    def pick(*keys):
        for k in keys:
            v = inp.get(k)
            if v not in (None, "", []):
                return v
        for k in keys:
            v = project.get(k)
            if v not in (None, "", []):
                return v
        return None

    rows = [
        ("Industry / sector",         pick("industry")),
        ("Critical business services", pick("critical_services")),
        ("Cost of downtime ($/hr)",   pick("downtime_cost")),
        ("Max tolerable downtime",    pick("mtd")),
        ("Data classification",       pick("data_classification")),
        ("Compliance / regulatory",   pick("compliance")),
        ("Data residency",            pick("data_residency")),
        ("Default target RTO",        pick("default_rto", "rto_target")),
        ("Default target RPO",        pick("default_rpo", "rpo_target")),
        ("Default criticality",       pick("default_criticality", "criticality")),
        ("Preferred DR strategy",     pick("dr_strategy", "dr_tier")),
        ("Primary region",            pick("primary_region")),
        ("Secondary / DR region",     pick("secondary_region")),
        ("Target-region SKU strategy", pick("target_sku_strategy")),
        ("Current DR maturity",       pick("current_dr")),
        ("DR test frequency",         pick("dr_test_frequency")),
        ("Operational coverage",      pick("ops_model")),
        ("Peak / blackout windows",   pick("peak_windows")),
        ("Budget sensitivity",        pick("budget_sensitivity")),
        ("Business uptime / SLA",     pick("uptime_sla")),
        ("Zero-data-loss workloads",  pick("zero_data_loss")),
        ("Network topology",          pick("network_topology")),
        ("Hybrid connectivity",       pick("connectivity")),
        ("Identity model",            pick("identity_model")),
        ("Backup retention",          pick("backup_retention")),
        ("Environment",               pick("environment")),
        ("Business unit",             pick("business_unit")),
        ("Owner",                     pick("owner")),
        ("Additional context",        pick("notes")),
    ]
    lines = [f"  - {label}: {val}" for label, val in rows if val]
    if not lines:
        return ""
    return (
        "CUSTOMER BUSINESS REQUIREMENTS (user-supplied; AUTHORITATIVE — these are the real "
        "continuity targets and constraints. Apply them to ALL resources unless a resource's own "
        "custom_tags state a more specific value, which then wins for that resource):\n"
        + "\n".join(lines)
        + "\n\n"
    )


def _build_dependency_context(resource_dicts: List[Dict[str, Any]]):
    """Build REAL dependency + SPOF + cluster grounding from the dependency graph.

    Returns (prompt_text, summary_dict). Best-effort and OFFLINE (use_resource_graph=False) so it
    is fast and never blocks plan generation — on any failure returns ("", {}) and the model falls
    back to inferring relationships from the resource JSON.
    """
    try:
        from services.dependency_service import build_dependency_graph
        graph = build_dependency_graph(resource_dicts, use_resource_graph=False)
    except Exception as exc:
        logger.warning("BCDR dependency grounding unavailable: %s", exc)
        return "", {}
    if not graph or not getattr(graph, "nodes", None):
        return "", {}
    name_by_id = {n.resource_id: (n.name or n.resource_id.split("/")[-1]) for n in graph.nodes}
    edge_lines = []
    for e in graph.edges[:30]:
        src = name_by_id.get(e.source_id, e.source_id.split("/")[-1])
        tgt = name_by_id.get(e.target_id, e.target_id.split("/")[-1])
        rel = getattr(e.relationship_type, "value", str(e.relationship_type))
        edge_lines.append(f"  - {src} --{rel}--> {tgt}")
    spof_lines = []
    for sp in graph.spof[:15]:
        spof_lines.append(f"  - {sp.resource_name} ({(sp.resource_type or '').split('/')[-1]}): "
                          f"{sp.dependents_count} dependents — {sp.reason}")
    cluster_lines = []
    for c in graph.clusters[:10]:
        nm = c.suggested_workload_name or c.name
        span = f", spans {', '.join(c.regions)}" if c.cross_region else ""
        cluster_lines.append(f"  - {nm}: {c.resource_count} resources{span}")
    summary = {
        "node_count": graph.node_count, "edge_count": graph.edge_count,
        "cluster_count": graph.cluster_count, "spof_count": len(graph.spof),
        "spof": [{"resource_name": s.resource_name, "resource_type": s.resource_type,
                  "dependents_count": s.dependents_count, "reason": s.reason} for s in graph.spof[:15]],
    }
    parts = []
    if edge_lines:
        parts.append("DISCOVERED DEPENDENCIES (REAL, from resource topology — use these to populate "
                     "key_dependencies; do NOT invent relationships that are not here or implied by the resources):\n"
                     + "\n".join(edge_lines))
    if spof_lines:
        parts.append("SINGLE POINTS OF FAILURE (REAL, computed — raise EACH as a BCDR gap unless it is already "
                     "redundant/zone-redundant):\n" + "\n".join(spof_lines))
    if cluster_lines:
        parts.append("WORKLOAD CLUSTERS (connected resource groups — use to define the application / infrastructure "
                     "tiers in Critical Services Identification):\n" + "\n".join(cluster_lines))
    text = ("\n\n".join(parts) + "\n\n") if parts else ""
    return text, summary


def _build_system_prompt() -> str:
    return (
        "You are a senior Azure Business Continuity & Disaster Recovery (BCDR) and cloud resiliency "
        "consultant producing an ENTERPRISE-GRADE BCDR Planning & Assessment document for a customer. "
        "Your output is the deliverable a customer receives after a paid engagement: precise, grounded, "
        "and immediately actionable — never generic.\n\n"
        "You ground EVERY statement in the Azure Well-Architected Reliability pillar, the Cloud Adoption "
        "Framework (CAF), Azure Business Continuity guidance, the Azure Migration 7R framework, and FinOps "
        "Foundation principles — but you express them through the CUSTOMER'S ACTUAL resources, tags and "
        "stated RTO/RPO/criticality targets, not as a checklist.\n\n"
        "HARD RULES:\n"
        "- Reference ONLY the resources supplied below. NEVER invent resource names or IDs.\n"
        "- Compare each resource's REAL posture (has_backup, zone_status, is_sql_replica, "
        "has_private_endpoint, sku, util, cost) against its tagged/stated RTO, RPO, Criticality and "
        "DR_Tier, and state the SPECIFIC gap and the SPECIFIC Azure pattern that closes it (zone-redundant "
        "/ availability-zone SKU, geo-replication, SQL Auto-Failover Groups, Azure Site Recovery for VMs, "
        "GRS/GZRS or Object Replication for storage, paired/secondary region). Never write 'improve DR'.\n"
        "- Tier services by business criticality (Mission Critical / Business Critical / Important / Standard) "
        "using the supplied Criticality tags and stated defaults; for each tier explain WHY.\n"
        "- When a DISCOVERED DEPENDENCIES / SINGLE POINTS OF FAILURE / WORKLOAD CLUSTERS block is supplied, treat it "
        "as the REAL topology: use the dependencies for key_dependencies, derive the application/infrastructure tiers "
        "from the clusters, and raise EACH single point of failure as a BCDR gap (mapped to the affected resource) "
        "unless it is already redundant.\n"
        "- For modernization use the 7R dispositions (Rehost, Refactor, Rearchitect, Rebuild, Replace, Retain, "
        "Retire) and give a CONCRETE Azure target architecture per candidate.\n"
        "- For FinOps, ground observations in cost_mtd / estimated_monthly_savings / ri_covered / util and "
        "describe how Azure Infra IQ reports it (cost trend, anomaly detection, tag & subscription breakdown, "
        "savings tracking, rightsizing).\n"
        "- Control-plane / stateless types (NSGs, public IPs, DNS zones, action groups, RBAC) are protected by "
        "IaC redeploy + resource lock, NOT backup/geo-redundancy — classify them accordingly, do not score them "
        "as DR gaps.\n"
        "- If a signal needed to judge a resource is ABSENT, treat it as UNKNOWN: record it as a data gap in "
        "key_risks and lower confidence — do NOT manufacture a finding from missing data.\n\n"
        + RESOURCE_ATTRIBUTION_INSTRUCTION
        + "\n\nReturn ONLY compact JSON (no markdown fences) with EXACTLY this shape:\n"
        "{\n"
        '  "overall_resilience_score": <int 0-100 — weighted resilience posture of the in-scope estate>,\n'
        '  "posture_label": "<Initial|Foundational|Established|Resilient|Mission-Ready>",\n'
        '  "maturity_summary": "<1-2 sentences, CAF/WAF-aligned, on current resilience maturity>",\n'
        '  "executive_summary": "<3-5 sentence executive summary written for customer leadership>",\n'
        '  "pillar_scores": [ {"name": "Recovery Readiness (RTO/RPO)|Geo-redundancy & Failover|Backup Coverage|DR Testing & Runbooks", "score": <int 0-100>, "rationale": "<1 sentence>"} ],\n'
        '  "critical_services": {\n'
        '    "summary": "<2-3 sentences>",\n'
        '    "tiers": [ {"tier": "Mission Critical|Business Critical|Important|Standard", "count": <int>, "rationale": "<why these belong here>", "resources": [ {"resource_name": "<name>", "resource_id": "<id>"} ]} ],\n'
        '    "key_dependencies": [ {"from": "<resource/service>", "to": "<resource/service>", "type": "data|network|identity|platform", "risk": "<single-point-of-failure / cascade risk>"} ],\n'
        '    "bcdr_gaps": [ {"severity": "critical|high|medium|low", "title": "<short>", "detail": "<1-2 sentences, specific>", "affected_resources": [ {"resource_name": "<name>", "resource_id": "<id>"} ], "affected_count": <int>} ]\n'
        "  },\n"
        '  "workload_prioritization": {\n'
        '    "summary": "<2-3 sentences>",\n'
        '    "workloads": [ {"workload": "<name>", "criticality": "<tier>", "current_rto": "<estimate from posture>", "current_rpo": "<estimate from posture>", "target_rto": "<from tags/inputs>", "target_rpo": "<from tags/inputs>", "gap": "<the delta in plain words>", "recommended_dr_approach": "<concrete Azure DR pattern + residual RTO/RPO it achieves>", "priority": "P1|P2|P3", "affected_resources": [ {"resource_name": "<name>", "resource_id": "<id>"} ]} ]\n'
        "  },\n"
        '  "modernization": {\n'
        '    "summary": "<2-3 sentences>",\n'
        '    "candidates": [ {"workload": "<name>", "current_state": "<1 sentence>", "disposition": "Rehost|Refactor|Rearchitect|Rebuild|Replace|Retain|Retire", "target_architecture": "<concrete Azure target that also improves resilience>", "benefit": "<resilience/cost/ops benefit>", "effort": "Low|Medium|High", "affected_resources": [ {"resource_name": "<name>", "resource_id": "<id>"} ]} ]\n'
        "  },\n"
        '  "finops": {\n'
        '    "summary": "<2-3 sentences>",\n'
        '    "cost_observations": [ "<observation grounded in cost_mtd / util / ri_covered>" ],\n'
        '    "optimization_levers": [ {"lever": "Rightsize|Reserved Instances / Savings Plan|Dev/Test shutdown|Storage tiering|Orphan cleanup|License optimization", "action": "<imperative, specific>", "est_monthly_saving": "<$ value or qualitative>", "affected_resources": [ {"resource_name": "<name>", "resource_id": "<id>"} ]} ],\n'
        '    "reporting_capabilities": [ "<how Azure Infra IQ surfaces this for ongoing FinOps visibility>" ]\n'
        "  },\n"
        '  "roadmap": [ {"phase": "<e.g. Phase 1 — Stabilize (0-30 days)>", "workstream": "BCDR|Modernization|FinOps|Governance", "outcomes": [ "<concrete outcome>" ]} ],\n'
        '  "key_risks": [ "<residual risk or explicit data gap>" ],\n'
        '  "assumptions": [ "<assumption made where data was incomplete>" ]\n'
        "}\n"
        "Limits: at most 4 tiers, 10 key_dependencies, 10 bcdr_gaps, 14 workloads, 12 modernization "
        "candidates, 10 cost_observations, 10 optimization_levers, 5 roadmap phases, 5 affected_resources "
        "per item (use affected_count for the rest). Order everything by business priority — highest "
        "criticality and widest RTO/RPO gap first."
    )


def _build_user_prompt(project: Dict[str, Any], inputs: Optional[Dict[str, Any]],
                       tag_summary: str, resources_json: str, resource_count: int,
                       dep_context: str = "") -> str:
    name = project.get("name", "Untitled project")
    desc = (project.get("description") or "").strip()
    return (
        f"PROJECT / WORKLOAD: {name}\n"
        f"{('DESCRIPTION: ' + desc) if desc else ''}\n"
        f"RESOURCES IN SCOPE: {resource_count}\n\n"
        + _build_inputs_context(project, inputs)
        + "DELIVERABLE: A complete BCDR Planning & Assessment document with the four sections "
        "(Critical Services Identification, BCDR & Workload Prioritization, Infrastructure "
        "Modernization, FinOps & Cost Visibility), a resilience posture score, an executive summary, "
        "and a phased roadmap.\n\n"
        + (dep_context or "")
        + f"{tag_summary}\n\n"
        + f"IN-SCOPE RESOURCES (JSON — analyse ONLY these):\n{resources_json}\n"
    )


def _resolve_nested_affected(result: Dict[str, Any], lookup: Dict[str, Any]) -> None:
    """Resolve affected_resources lists at every known nested path back to canonical objects."""
    for parent, child in _AFFECTED_PATHS:
        section = result.get(parent)
        items = section.get(child) if isinstance(section, dict) else None
        if isinstance(items, list):
            for it in items:
                if isinstance(it, dict) and isinstance(it.get("affected_resources"), list):
                    it["affected_resources"] = _resolve_affected_resources(it["affected_resources"], lookup)
    # critical_services.tiers[].resources are resource references too.
    cs = result.get("critical_services")
    if isinstance(cs, dict) and isinstance(cs.get("tiers"), list):
        for t in cs["tiers"]:
            if isinstance(t, dict) and isinstance(t.get("resources"), list):
                t["resources"] = _resolve_affected_resources(t["resources"], lookup)


def generate_bcdr_plan(
    project: Dict[str, Any],
    resources: List[Any],
    inputs: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Produce a consultant-grade BCDR Planning & Assessment document for a project's resources.

    Args:
        project:   the project dict (id, name, description, resource_ids, metadata …)
        resources: the resource objects/dicts BELONGING TO THIS PROJECT (already subset by caller)
        inputs:    optional user-supplied business intent for this run (data_classification,
                   compliance, default_rto/rpo/criticality, dr_strategy, budget_sensitivity, notes)

    Returns a uniform result dict (see schema in _build_system_prompt) plus run metadata.
    Raises RuntimeError if no AI provider is configured.
    """
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

    # 1a. Merge the Phase 1 BCDR planning inputs + uploaded supporting documents so the plan is
    # grounded on the customer's authoritative business intent (same source as the categorization
    # table in the BCDR Planning tab).
    planning_block = ""
    try:
        import services.bcdr_metadata_service as _bcdr
        planning_block = _bcdr.build_planning_grounding(compressed)
    except Exception as exc:
        logger.warning("BCDR plan Phase 1 enrichment skipped: %s", exc)

    tagged_count = sum(1 for r in compressed if r.get("custom_tags"))
    tag_summary = _build_tag_summary(compressed)
    resources_json = _serialize_for_ai(compressed)

    # 1b. Build REAL dependency + SPOF + cluster grounding from the dependency graph (offline).
    dep_context, dep_summary = _build_dependency_context(resource_dicts)

    # 2. Build prompts and call the model (reuses the shared retry/backoff client).
    system_prompt = _build_system_prompt()
    user_prompt = _build_user_prompt(project, inputs, tag_summary, resources_json, len(compressed), dep_context) + planning_block
    raw = _call_ai(system_prompt, user_prompt, max_tokens=MAX_TOKENS_BCDR_PLAN)

    # 3. Parse robustly (handles token-cap truncation gracefully).
    result = _safe_json_parse(raw)

    # 4. Resolve affected resources to canonical objects for the UI/exports.
    lookup = _build_resource_lookup(resource_dicts)
    _resolve_nested_affected(result, lookup)

    # 5. Normalise the resilience score + labels.
    overall = result.get("overall_resilience_score")
    if not isinstance(overall, (int, float)):
        overall = _coerce_score(result)
    if not isinstance(overall, (int, float)):
        overall = 50
    overall = max(0, min(100, int(round(overall))))
    result["overall_resilience_score"] = overall
    # Mirror to overall_score/score_label so it persists + renders through shared plumbing.
    result["overall_score"] = overall
    result["score_label"] = _score_label(overall)
    result["posture_label"] = result.get("posture_label") or _posture_label(overall)

    # 6. Attach run metadata.
    result["category"] = CATEGORY_KEY
    result["category_label"] = CATEGORY_LABEL
    result["model"] = model or "unknown"
    result["provider"] = provider or "unknown"
    result["resource_count"] = len(compressed)
    result["tagged_count"] = tagged_count
    result["tag_coverage_pct"] = (round(100 * tagged_count / len(compressed)) if compressed else 0)
    result["dependency_summary"] = dep_summary
    result["inputs"] = {k: v for k, v in (inputs or {}).items() if v not in (None, "", [])}
    result["generated_at"] = datetime.now(timezone.utc).isoformat()

    logger.info(
        "BCDR plan complete | project=%s resources=%d tagged=%d score=%s model=%s",
        project.get("name", "?"), len(compressed), tagged_count, overall, model,
    )
    return result
