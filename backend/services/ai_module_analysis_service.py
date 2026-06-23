"""
AI Module Analysis Service - Provides AI-powered deep analysis for each platform module.

Modules covered:
  1. Cloud Maturity    - AI analysis of maturity gaps + recommendations
  2. Security          - AI security posture analysis  
  3. Innovation        - AI innovation opportunity analysis
  4. Migration         - AI migration/modernization analysis with Arc data
  5. Backup            - AI backup state analysis + recommendations
  6. Resilience        - AI resilience analysis of entire estate
  7. BCDR AVS          - Azure VMware Solution DR analysis

Pattern: Each method accepts resources + Arc data, builds a rich prompt,
calls AI (Claude/GPT-4o), returns structured JSON with detailed recommendations.
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Import shared AI infrastructure
from services.ai_infra_service import (
    _get_ai_client_for_analysis,
    _compress_resource,
    _build_workload_summary,
    _call_ai,
    _enrich_with_custom_tags,
    _build_tag_summary,
    MAX_TOKENS_ANALYSIS,
)

MAX_TOKENS_MODULE = 8000  # cap module-analysis output (prompt bounds array sizes; parser recovers any truncation)


# ── Resource attribution ──────────────────────────────────────────────────────

RESOURCE_ATTRIBUTION_INSTRUCTION = """
RESOURCE ATTRIBUTION REQUIREMENT (MANDATORY):
For EVERY finding, gap, or recommendation that references specific Azure resources, include
an "affected_resources" array of structured objects - NOT plain strings:
  "affected_resources": [
    {
      "resource_id": "<exact value of the 'id' field from the resource data below>",
      "resource_name": "<exact value of the 'name' field>",
      "resource_group": "<exact value of the 'rg' field>",
      "subscription_id": "<exact value of the 'sub' field>",
      "resource_type": "<exact value of the 'type_full' field>",
      "cost_usd": <exact value of 'cost_mtd', or 0 if not shown>
    }
  ]
Use field values EXACTLY as they appear in the resource data. Never invent identifiers.
List the MOST IMPORTANT affected resources — AT MOST 5 per finding. If more resources are
affected, list the 5 highest-impact ones and add "affected_count": <total number affected>.

OUTPUT SIZE LIMITS (MANDATORY — keeps the response fast and the JSON valid/parseable):
- At most 6 items in any top-level array (categories / dimensions / opportunities / findings groups / recommendations / top_risks).
- At most 4 findings or opportunities per category or dimension.
- At most 5 objects in any "affected_resources" array (use "affected_count" for the remainder).
- Keep every string to 1-2 concise sentences. Output compact JSON only — no markdown fences, no comments.

STAY WITHIN THE REQUESTED DOMAIN (MANDATORY):
- Assess ONLY the category/domain stated in your role above. Do NOT introduce findings, scores, or
  recommendations that belong to a different domain — e.g. do NOT raise backup, disaster-recovery,
  RPO/RTO, geo-replication, cost, or patching items unless THAT is the category being assessed.
- Judge each resource only against controls RELEVANT to its resource_type. Never flag a capability that
  does not apply to the type (e.g. backup / geo-replication / RTO-RPO for control-plane or stateless
  resources such as action groups, alert rules, NSGs, route tables, public IPs, DNS zones, RBAC/policy
  assignments). If a control does not apply, it is "not applicable", not a gap.
- Ground every finding in a value PRESENT in the resource data (a field or custom_tag). If you cannot cite
  a present value, omit the item. If data needed to judge a resource is missing, note it as a data gap —
  never invent a finding from absent data.

WHOLE-DOMAIN NOT APPLICABLE (MANDATORY — never fabricate a failing score):
- If the assessed domain does NOT apply to ANY in-scope resource (e.g. a patch/update review whose only
  resources are action groups/alert rules, or a backup review over only NSGs/route tables/DNS zones), this
  is NOT a low score. Set any overall score field to null, add "applicability": "not_applicable" with a
  one-line "applicability_note" explaining the type mismatch, and say so plainly in the first sentence of
  the summary. Still offer type-appropriate recommendations. If the domain applies to SOME resources but
  not others, use "applicability": "partial" and score only the resources it applies to. Otherwise use
  "applicability": "applicable". NEVER report 0 / Critical for a domain that simply does not apply.

CUSTOM TAGS — PRIORITISATION ONLY:
- Use custom_tags (Criticality, Environment, Owner, …) to ORDER findings WITHIN this domain: list
  Mission Critical / Business Critical resources first; deprioritise Non-Critical / Dev-Test.
- DR_Tier / RPO / RTO are recovery targets — apply them ONLY when this analysis is about BCDR, backup, or
  resilience. In any other category, do not surface them.

ADVANCED, DECISION-READY OUTPUT (MANDATORY — this is what makes the analysis genuinely useful, not generic):
- Be SPECIFIC and EVIDENCE-LED: every finding and recommendation must reference the ACTUAL configuration
  value(s) it is based on for the cited resource — a real field or custom_tag, e.g. "has_private_endpoint=false
  on <name>", "power_state='deallocated' with days_idle=158 on <name>", "ri_covered=false on <name>",
  "zone_status='single-zone' on <name>". Do NOT restate generic best practices without tying them to a
  resource's own data.
- Give CONCRETE, type-appropriate ACTIONS — never vague verbs. Replace "review / consider / assess / look
  into / ensure" with the exact change to make for THAT resource type (e.g. "enable a private endpoint and
  set public network access = Disabled", "attach a Recovery Services Vault policy with 30-day retention",
  "move to a zone-redundant SKU", "delete the orphaned disk", "purchase a 1-year reservation").
- QUANTIFY whenever the data allows: dollars (cost_mtd / estimated savings), counts (N of M resources),
  percentages, days idle, RPO/RTO/retention deltas. Lead with the headline number where one exists.
- Map each material finding to the relevant standard/control for THIS domain when applicable (MCSB / NIST /
  CIS for security, the Azure Well-Architected pillar, a FinOps capability, Azure Backup / Update Manager,
  etc.) — briefly, as grounding, not filler.
- RANK findings and recommendations by impact (highest business / $ / risk first) and state the "so what"
  (business impact or risk removed) for each — never a flat, unordered list.
"""


def _compute_data_confidence(resources: list, arc_data: dict = None, extras: dict = None) -> dict:
    """Compute a data confidence summary indicating what data was available for analysis."""
    signals = []
    gaps = []
    resource_count = len(resources) if resources else 0
    if resource_count == 0:
        gaps.append("No Azure resources found")
    else:
        signals.append(f"{resource_count} resources")
    # Cost data
    has_cost = any(r.get("cost_mtd") or r.get("cost_30d") for r in resources) if resources else False
    if has_cost:
        signals.append("Cost data available")
    else:
        gaps.append("No cost data - cost-based recommendations may be limited")
    # Tags
    has_tags = any(r.get("custom_tags") for r in resources) if resources else False
    if has_tags:
        signals.append("Custom tags enriched")
    else:
        gaps.append("No custom tags - priority/criticality context missing")
    # Arc
    arc_count = arc_data.get("total_machines", 0) if arc_data else 0
    if arc_count > 0:
        signals.append(f"{arc_count} Arc machines")
    else:
        gaps.append("No Arc/hybrid data")
    # Extras (defender, backup coverage, etc.)
    if extras:
        for k, v in extras.items():
            if v:
                signals.append(k)
            else:
                gaps.append(f"No {k}")
    # Score: 0-100 based on how many signal types are present
    score = min(100, int((len(signals) / max(1, len(signals) + len(gaps))) * 100))
    level = "high" if score >= 75 else "medium" if score >= 50 else "low"
    return {"score": score, "level": level, "signals": signals, "gaps": gaps}


def _build_resource_lookup(resources: list) -> dict:
    """Build a dict mapping resource name / id suffix -> full resource dict.
    Used by post-processors to resolve AI-cited names/ids to full objects."""
    lookup: dict = {}
    for r in resources:
        raw = r if isinstance(r, dict) else r.__dict__
        name = raw.get("resource_name", "").lower()
        if name:
            lookup[name] = raw
        rid = raw.get("resource_id", "")
        if rid:
            lookup[rid[-40:].lower()] = raw
            lookup[rid.lower()] = raw
    return lookup


def _resolve_affected_resources(items: list, lookup: dict) -> list:
    """Normalise affected_resources entries to full structured objects.

    Accepts either strings (resource names) or partial dicts from AI output and
    resolves them against the original resources list so every entry carries the
    canonical resource_id, resource_group, subscription_id, resource_type and cost.
    """
    resolved: list = []
    for item in items:
        if isinstance(item, str):
            r = lookup.get(item.lower())
            if not r:
                for key, val in lookup.items():
                    if item.lower() in key or key in item.lower():
                        r = val
                        break
            if r:
                resolved.append({
                    "resource_id": r.get("resource_id", ""),
                    "resource_name": r.get("resource_name", item),
                    "resource_group": r.get("resource_group", ""),
                    "subscription_id": r.get("subscription_id", ""),
                    "resource_type": r.get("resource_type", ""),
                    "cost_usd": round(r.get("cost_current_month", 0), 2),
                })
            else:
                resolved.append({
                    "resource_name": item,
                    "resource_id": "",
                    "resource_group": "",
                    "subscription_id": "",
                    "resource_type": "",
                    "cost_usd": 0,
                })
        elif isinstance(item, dict):
            r_name = item.get("resource_name", "")
            r = lookup.get(r_name.lower()) if r_name else None
            # Fuzzy-match on name or AI-provided id suffix when exact lookup fails
            if not r:
                probe = (r_name or item.get("resource_id", "")).lower()
                if probe:
                    for key, val in lookup.items():
                        if probe in key or key in probe:
                            r = val
                            break
            if r:
                # Canonical resource values from the original inventory always win —
                # the AI frequently abbreviates/truncates resource_id & subscription_id.
                resolved.append({
                    "resource_id": r.get("resource_id", "") or item.get("resource_id", ""),
                    "resource_name": r.get("resource_name", "") or r_name,
                    "resource_group": r.get("resource_group", "") or item.get("resource_group", ""),
                    "subscription_id": r.get("subscription_id", "") or item.get("subscription_id", ""),
                    "resource_type": r.get("resource_type", "") or item.get("resource_type", ""),
                    "cost_usd": round(r.get("cost_current_month", 0), 2),
                })
            else:
                resolved.append({
                    "resource_id": item.get("resource_id", ""),
                    "resource_name": r_name,
                    "resource_group": item.get("resource_group", ""),
                    "subscription_id": item.get("subscription_id", ""),
                    "resource_type": item.get("resource_type", ""),
                    "cost_usd": item.get("cost_usd", 0),
                })
    return resolved


def _enrich_findings(findings: list, lookup: dict) -> list:
    """Walk a findings list and resolve all affected_resources entries in-place."""
    for f in findings:
        if isinstance(f, dict) and "affected_resources" in f:
            f["affected_resources"] = _resolve_affected_resources(f["affected_resources"], lookup)
    return findings


# ── Response normalizers ──────────────────────────────────────────────────────
# These transform AI responses into the exact schema the frontend expects.

def _normalize_maturity_response(result: dict) -> dict:
    """Normalize AI maturity response -> frontend expected schema."""
    # Frontend expects: overall_score, overall_label, executive_summary, dimension_scores[]
    oa = result.get("overall_assessment", {})
    out = {
        "overall_score": oa.get("score") or result.get("overall_score", 0),
        "overall_label": oa.get("current_maturity_level") or result.get("overall_label", ""),
        "executive_summary": oa.get("executive_summary") or result.get("executive_summary", ""),
        "key_strengths": oa.get("key_strengths", result.get("key_strengths", [])),
        "critical_gaps": oa.get("critical_gaps", result.get("critical_gaps", [])),
    }
    # Map dimensions -> dimension_scores
    dims = result.get("dimensions", result.get("dimension_scores", []))
    dim_scores = []
    for d in dims:
        score = d.get("score", 0)
        grade = d.get("grade") or ("A" if score >= 85 else "B" if score >= 70 else "C" if score >= 55 else "D" if score >= 40 else "F")
        dim_scores.append({
            "name": d.get("name", ""),
            "score": score,
            "grade": grade,
            "assessment": d.get("assessment", ""),
            "findings": d.get("findings", []),
            "recommendations": d.get("recommendations", []),
        })
    out["dimension_scores"] = dim_scores
    out["dimensions"] = dim_scores  # Alias for compatibility with CloudMaturityPanel
    # Cross-cutting insights: flatten from findings
    cross = []
    for d in dims:
        for f in d.get("findings", []):
            if isinstance(f, dict) and f.get("type") == "opportunity":
                cross.append(f)
    out["cross_cutting_insights"] = result.get("cross_cutting_insights", cross[:5])
    # Strategic recommendations
    roadmap = result.get("transformation_roadmap", {})
    strategic = result.get("strategic_recommendations", [])
    if not strategic and roadmap:
        for action in roadmap.get("immediate_actions", [])[:3]:
            strategic.append({"title": action, "description": action, "priority": "P1"})
        for action in roadmap.get("30_day_goals", [])[:3]:
            strategic.append({"title": action, "description": action, "priority": "P2"})
    out["strategic_recommendations"] = strategic
    out["transformation_roadmap"] = roadmap
    out["arc_specific_recommendations"] = result.get("arc_specific_recommendations", [])
    return out


def _normalize_security_response(result: dict) -> dict:
    """Normalize AI security response -> frontend expected schema."""
    # Frontend expects: posture_score, risk_level, critical_findings[], category_analysis[], compliance_gaps[], recommendations[]
    out = {
        "posture_score": result.get("security_score") or result.get("posture_score", 0),
        "risk_level": result.get("risk_level", "Unknown"),
        "executive_summary": result.get("executive_summary", ""),
    }
    # Critical findings: extract from categories or top_risks
    categories = result.get("categories", [])
    critical_findings = []
    category_analysis = []
    for cat in categories:
        category_analysis.append({
            "category": cat.get("name", ""),
            "score": cat.get("score", 0),
            "finding_count": cat.get("finding_count", len(cat.get("findings", []))),
            "findings": cat.get("findings", []),
        })
        for f in cat.get("findings", []):
            if isinstance(f, dict) and f.get("severity") in ("critical", "high"):
                critical_findings.append(f)
    # Also pull from top_risks
    for risk in result.get("top_risks", []):
        critical_findings.append({
            "severity": "critical" if risk.get("likelihood") == "High" else "high",
            "title": risk.get("title", ""),
            "detail": risk.get("description", ""),
            "remediation": risk.get("remediation_priority", ""),
        })
    out["critical_findings"] = result.get("critical_findings", critical_findings)
    out["category_analysis"] = result.get("category_analysis", category_analysis)
    # Compliance gaps
    comp = result.get("compliance_status", {})
    compliance_gaps = []
    for gap in comp.get("gaps", []):
        if isinstance(gap, str):
            compliance_gaps.append({"framework": "General", "gap": gap, "remediation": ""})
        else:
            compliance_gaps.append(gap)
    out["compliance_gaps"] = result.get("compliance_gaps", compliance_gaps)
    out["recommendations"] = result.get("recommendations", [])
    return out


def _normalize_innovation_response(result: dict) -> dict:
    """Normalize AI innovation response -> frontend expected schema."""
    # Frontend expects: innovation_score, maturity_label, gap_analysis[], quick_wins[], strategic_recommendations[], adoption_roadmap
    out = {
        "innovation_score": result.get("innovation_score", 0),
        "maturity_label": result.get("innovation_maturity") or result.get("maturity_label", ""),
        "executive_summary": result.get("executive_summary", ""),
    }
    # Map opportunity_categories -> gap_analysis
    cats = result.get("opportunity_categories", [])
    gap_analysis = []
    for cat in cats:
        for opp in cat.get("opportunities", []):
            gap_analysis.append({
                "category": cat.get("category", ""),
                "priority": "P1" if opp.get("roi_potential") == "High" else "P2" if opp.get("roi_potential") == "Medium" else "P3",
                "current_state": cat.get("current_adoption", ""),
                "target_state": opp.get("title", ""),
                "gap_description": opp.get("description", ""),
                "azure_services": opp.get("azure_services", []),
                "effort": opp.get("effort", ""),
                "timeline": opp.get("timeline", ""),
                "business_value": opp.get("business_value", ""),
            })
        # If no opportunities listed, add the category itself as a gap
        if not cat.get("opportunities") and cat.get("readiness_score", 100) < 50:
            gap_analysis.append({
                "category": cat.get("category", ""),
                "priority": "P2",
                "current_state": cat.get("current_adoption", "Not adopted"),
                "target_state": "Adopt " + cat.get("category", ""),
                "gap_description": f"No adoption in {cat.get('category', '')}",
                "azure_services": [],
            })
    out["gap_analysis"] = result.get("gap_analysis", gap_analysis)
    out["quick_wins"] = result.get("quick_wins", [])
    # Strategic recommendations from strategic_initiatives
    strategic = result.get("strategic_recommendations", [])
    if not strategic:
        for init in result.get("strategic_initiatives", []):
            strategic.append({
                "title": init.get("title", ""),
                "description": init.get("description", ""),
                "priority": "P2",
                "azure_services": init.get("components", []),
                "estimated_timeline": f"{init.get('timeline_months', '?')} months",
            })
    out["strategic_recommendations"] = strategic
    # Adoption roadmap
    out["adoption_roadmap"] = result.get("adoption_roadmap", {
        "phase1": {"timeline": "0-30 days", "actions": [w.get("title", "") for w in result.get("quick_wins", [])[:3]]},
        "phase2": {"timeline": "1-3 months", "actions": [i.get("title", "") for i in result.get("strategic_initiatives", [])[:3]]},
        "phase3": {"timeline": "3-6 months", "actions": result.get("data_driven_insights", [])[:3] if isinstance(result.get("data_driven_insights", [None])[0] if result.get("data_driven_insights") else None, str) else [d.get("innovation_potential", "") for d in result.get("data_driven_insights", [])[:3]]},
    })
    return out


def _normalize_migration_response(result: dict) -> dict:
    """Normalize AI migration response -> frontend expected schema."""
    # Frontend expects: migration_readiness_score, total_workloads, workload_analysis[], dc_migration_analysis, executive_summary, strategic_recommendations[]
    out = {
        "migration_readiness_score": result.get("migration_readiness_score", 0),
        "executive_summary": result.get("executive_summary", ""),
        "total_workloads": result.get("total_migration_candidates", 0) + result.get("total_modernization_candidates", 0),
    }
    # Workload analysis from migration_categories candidates
    workload_analysis = []
    for cat in result.get("migration_categories", []):
        for cand in cat.get("candidates", []):
            workload_analysis.append({
                "workload_name": cand.get("resource_name", ""),
                "name": cand.get("resource_name", ""),
                "current_state": cand.get("current_config", cand.get("resource_type", "")),
                "target_state": cand.get("target_service", ""),
                "migration_approach": cand.get("migration_approach", ""),
                "complexity": cand.get("complexity", "Medium"),
                "estimated_effort": f"{cand.get('migration_steps', [{}]).__len__()} phases",
                "risks": cand.get("risks", []),
                "benefits": cand.get("benefits", []),
            })
    out["workload_analysis"] = result.get("workload_analysis", workload_analysis)
    # DC Migration Analysis (from Arc data)
    waves = result.get("migration_waves", {})
    arc_candidates = [c for cat in result.get("migration_categories", []) for c in cat.get("candidates", []) if c.get("source") in ("arc", "on-premises")]
    out["dc_migration_analysis"] = result.get("dc_migration_analysis", {
        "arc_machines_count": len(arc_candidates),
        "sql_instances": sum(1 for c in arc_candidates if "sql" in c.get("target_service", "").lower()),
        "migration_waves": [
            {"name": waves.get("wave_1", {}).get("label", "Wave 1"), "priority": "P1", "workloads": waves.get("wave_1", {}).get("key_actions", []), "description": waves.get("wave_1", {}).get("description", "")},
            {"name": waves.get("wave_2", {}).get("label", "Wave 2"), "priority": "P2", "workloads": waves.get("wave_2", {}).get("key_actions", []), "description": waves.get("wave_2", {}).get("description", "")},
            {"name": waves.get("wave_3", {}).get("label", "Wave 3"), "priority": "P3", "workloads": waves.get("wave_3", {}).get("key_actions", []), "description": waves.get("wave_3", {}).get("description", "")},
        ],
    })
    # Strategic recommendations
    strategic = result.get("strategic_recommendations", [])
    if not strategic:
        for path in result.get("modernization_paths", []):
            strategic.append({
                "title": f"{path.get('from', '')} -> {path.get('to', '')}",
                "description": path.get("rationale", ""),
                "priority": "P2",
                "resources_affected": path.get("resources_affected", 0),
            })
    out["strategic_recommendations"] = strategic
    out["migration_categories"] = result.get("migration_categories", [])
    out["migration_waves"] = waves
    out["modernization_paths"] = result.get("modernization_paths", [])
    out["tools_and_services"] = result.get("tools_and_services", [])
    return out


# ── Caching helpers ───────────────────────────────────────────────────────────

# In-memory AI-result cache — keeps the app fast even when the database (e.g.
# Azure SQL) is unreachable, so repeated requests within a session are instant.
_MEM_CACHE: Dict[str, tuple] = {}


def _get_cached(analysis_type: str, max_age_hours: int = 12) -> Optional[dict]:
    """Check the in-memory cache first (DB-independent), then the database."""
    entry = _MEM_CACHE.get(analysis_type)
    if entry:
        ts, cached_result = entry
        if (time.time() - ts) < max_age_hours * 3600:
            return cached_result
    try:
        from services.tagging_service import get_latest_ai_analysis
        cached = get_latest_ai_analysis(analysis_type, None, max_age_hours=max_age_hours)
        if cached and isinstance(cached, dict):
            # get_latest_ai_analysis returns {"result": {...}, "analyzed_at": ..., "model": ...}
            result = cached.get("result") if "result" in cached else cached
            if isinstance(result, dict):
                _MEM_CACHE[analysis_type] = (time.time(), result)
                try:
                    _register_ai_summary(analysis_type, None, result)
                except Exception:
                    pass
            return result
        return None
    except Exception:
        return None


def _get_cached_any_scope(base: str, max_age_hours: int = 12) -> Optional[dict]:
    """Scope-tolerant cache read for the home-page summary: returns the freshest
    persisted analysis for a module whether it was saved under the bare module
    key or a scope-fingerprinted variant ("base:<hash>"). Only used where any
    scope is acceptable (the home dashboard) — the per-module analyze functions
    keep using exact-key _get_cached so each scope stays isolated."""
    entry = _MEM_CACHE.get(base)
    if entry:
        ts, cached_result = entry
        if (time.time() - ts) < max_age_hours * 3600:
            return cached_result
    try:
        from services.tagging_service import get_latest_ai_analysis_any_scope
        cached = get_latest_ai_analysis_any_scope(base, max_age_hours=max_age_hours)
        if cached and isinstance(cached, dict):
            result = cached.get("result") if "result" in cached else cached
            if isinstance(result, dict):
                _MEM_CACHE[base] = (time.time(), result)
                try:
                    _register_ai_summary(base, None, result)
                except Exception:
                    pass
                return result
        return None
    except Exception:
        return None


def _save_cache(analysis_type: str, model: str, result: dict):
    """Cache the analysis result. Writes the in-memory cache immediately (so the
    next request is instant even when the database is down) and persists to the
    database in a background daemon thread so a slow/unreachable DB (e.g. an Azure
    SQL 'Login timeout expired' with retries) can NEVER block the AI response."""
    import threading
    try:
        _MEM_CACHE[analysis_type] = (time.time(), result)
        _register_ai_summary(analysis_type, model, result)
    except Exception:
        pass

    def _do_save():
        try:
            from services.tagging_service import save_ai_analysis
            save_ai_analysis(analysis_type, None, model, result)
        except Exception as e:
            logger.warning("Failed to persist %s analysis to DB: %s", analysis_type, e)

    try:
        threading.Thread(target=_do_save, daemon=True, name=f"ai-cache-{analysis_type}").start()
    except Exception as e:
        logger.warning("Could not start cache-save thread for %s: %s", analysis_type, e)


# ── AI Insights registry (powers the home-page AI dashboard) ──────────────────
# Canonical module registry: normalized cache-key base -> presentation metadata.
# `key` is the stable id used by the frontend; `view` is the SPA navigation key;
# `endpoint` is the per-category AI endpoint used to (re)generate the analysis.
AI_MODULE_REGISTRY = {
    "ai_security_posture": {"key": "security",       "label": "Security",          "view": "security",       "endpoint": "/api/ai/security"},
    "ai_cloud_maturity":   {"key": "maturity",        "label": "Cloud Maturity",    "view": "maturity",       "endpoint": "/api/ai/maturity"},
    "ai_innovation":       {"key": "innovation",      "label": "Innovation",        "view": "innovation",     "endpoint": "/api/ai/innovation"},
    "ai_migration":        {"key": "migration",       "label": "Migration",         "view": "migration",      "endpoint": "/api/ai/migration"},
    "ai_backup":           {"key": "backup",          "label": "Backup & DR",       "view": "backup",         "endpoint": "/api/ai/backup"},
    "ai_resilience":       {"key": "resilience",      "label": "Resilience",        "view": "resilience",     "endpoint": "/api/ai/resilience"},
    "ai_monitoring":       {"key": "monitoring",      "label": "Monitoring",        "view": "monitoring",     "endpoint": "/api/ai/monitoring"},
    "ai_governance":       {"key": "governance",      "label": "Governance",        "view": "governance",     "endpoint": "/api/ai/governance"},
    "ai_advisor":          {"key": "advisor",         "label": "Advisor",           "view": "advisor",        "endpoint": "/api/ai/advisor"},
    "ai_service_health":   {"key": "service_health",  "label": "Service Health",    "view": "service-health", "endpoint": "/api/ai/service-health"},
    "ai_lifecycle":        {"key": "lifecycle",       "label": "Retirements & Deprecations", "view": "service-health", "endpoint": "/api/ai/lifecycle"},
    "ai_quota":            {"key": "quota",           "label": "Quota & Capacity",  "view": "quota",          "endpoint": "/api/ai/quota"},
    "ai_waf":              {"key": "waf",             "label": "Well-Architected",  "view": "waf",            "endpoint": "/api/ai/waf"},
    "ai_caf":              {"key": "caf",             "label": "Cloud Adoption (CAF)", "view": "caf",         "endpoint": "/api/ai/caf"},
    "ai_sql_modernization":{"key": "sql_modernization","label": "SQL Modernization", "view": "sql-modernization", "endpoint": "/api/ai/sql-modernization"},
    "ai_appservice":       {"key": "appservice",      "label": "App Service",       "view": "appservice",     "endpoint": "/api/ai/appservice"},
    "ai_vm_performance":   {"key": "vm_performance",  "label": "VM Performance",    "view": "vm-performance", "endpoint": "/api/ai/vm-performance"},
    "ai_entra":            {"key": "entra",           "label": "Entra ID & Permissions", "view": "entra",     "endpoint": "/api/ai/entra"},
}

# module base key -> latest compact summary (kept warm by _get_cached/_save_cache)
_AI_SUMMARY: Dict[str, dict] = {}


def _first_nonempty(*vals):
    for v in vals:
        if v not in (None, "", [], {}):
            return v
    return None


# Known score / recommendation / category field names across the different
# module schemas (maturity, security, innovation, resilience, generic, …).
_SCORE_KEYS = ("score", "overall_score", "posture_score", "security_score",
               "innovation_score", "resilience_score", "backup_score",
               "maturity_score", "health_score", "readiness_score")
_REC_KEYS = ("top_recommendations", "recommendations", "strategic_recommendations",
             "prioritized_recommendations", "quick_wins", "immediate_actions")


def _get_categories(result: dict) -> list:
    return (result.get("categories") or result.get("dimension_scores") or
            result.get("dimensions") or result.get("category_analysis") or
            result.get("gap_analysis") or [])


def _coerce_score(result: dict):
    oa = result.get("overall_assessment") or {}
    s = _first_nonempty(*[result.get(k) for k in _SCORE_KEYS], oa.get("score"))
    if s is None:
        for k, v in result.items():
            if isinstance(k, str) and k.endswith("_score") and isinstance(v, (int, float)):
                s = v
                break
    try:
        return int(round(float(s))) if s is not None else None
    except Exception:
        return None


def _extract_top_recommendation(result: dict):
    def _txt(r):
        if isinstance(r, dict):
            return (r.get("title") or r.get("recommendation") or r.get("description")
                    or r.get("action") or r.get("text"))
        return str(r) if r else None
    for key in _REC_KEYS:
        recs = result.get(key)
        if recs:
            return _txt(recs[0])
    rm = result.get("transformation_roadmap") or result.get("adoption_roadmap") or {}
    for k in ("immediate_actions", "30_day_goals"):
        if rm.get(k):
            return _txt(rm[k][0])
    for c in _get_categories(result):
        for f in (c.get("findings") or []):
            if isinstance(f, dict) and f.get("recommendation"):
                return f["recommendation"]
    return None


def _count_findings(result: dict):
    n = 0
    for c in _get_categories(result):
        n += len(c.get("findings") or [])
    n += len(result.get("critical_findings") or [])
    return n


def _summarize_result(result: dict) -> dict:
    """Reduce a full AI module result to a compact, schema-tolerant summary."""
    if not isinstance(result, dict) or result.get("error"):
        return {}
    oa = result.get("overall_assessment") or {}
    summary = (result.get("executive_summary") or oa.get("executive_summary")
               or result.get("summary") or "")
    return {
        "score": _coerce_score(result),
        "risk_level": _first_nonempty(result.get("risk_level"), result.get("overall_label"),
                                      result.get("maturity_label"), oa.get("current_maturity_level")),
        "category_count": len(_get_categories(result)),
        "finding_count": _count_findings(result),
        "top_recommendation": _extract_top_recommendation(result),
        "executive_summary": (summary[:280] + "…") if len(summary) > 280 else summary,
        "generated_at": (result.get("_meta") or {}).get("generated_at"),
        "model": (result.get("_meta") or {}).get("model"),
        "partial": bool(result.get("_partial")),
    }


def _register_ai_summary(analysis_type: str, model: str, result: dict):
    """Record the latest compact summary for a module so the home dashboard can
    surface it without ever re-running an (expensive) AI analysis."""
    base = (analysis_type or "").split(":", 1)[0]
    if base not in AI_MODULE_REGISTRY:
        return
    s = _summarize_result(result)
    if not s:
        return
    s["_registered_at"] = time.time()
    _AI_SUMMARY[base] = s


def get_ai_insights_summary() -> dict:
    """Aggregate the latest AI analysis summary for every known module for the
    home-page AI dashboard. Reads the in-session registry first, then best-effort
    persisted cache for modules not analyzed yet. Never triggers a new AI call."""
    modules = []
    analyzed = 0
    scores = []
    high_risk = 0
    for base, meta in AI_MODULE_REGISTRY.items():
        s = _AI_SUMMARY.get(base)
        if not s:
            try:
                cached = _get_cached(base, max_age_hours=24 * 30)
                if not cached:
                    # Per-module analyses are persisted under a scope-fingerprinted
                    # key (e.g. "ai_security_posture:<hash>"); the bare-key lookup
                    # above misses them after a restart. Fall back to the freshest
                    # scoped variant so the home cards survive a process restart.
                    cached = _get_cached_any_scope(base, max_age_hours=24 * 30)
                if cached:
                    s = _summarize_result(cached)
            except Exception:
                s = None
        entry = {**meta, "available": bool(s)}
        if s:
            entry.update({k: v for k, v in s.items() if not k.startswith("_")})
            analyzed += 1
            if s.get("score") is not None:
                scores.append(s["score"])
            if (s.get("risk_level") or "").lower() in ("high", "critical"):
                high_risk += 1
        modules.append(entry)
    estate_score = int(round(sum(scores) / len(scores))) if scores else None
    return {
        "modules": modules,
        "estate_health": {
            "score": estate_score,
            "analyzed_count": analyzed,
            "total_count": len(AI_MODULE_REGISTRY),
            "high_risk_count": high_risk,
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def analyze_executive_briefing_ai(force_refresh: bool = False) -> dict:
    """Cross-category AI synthesis: reads the latest per-module AI summaries and
    produces ONE CIO-level executive briefing (top cross-cutting risks + a unified
    prioritized roadmap). A meta-analysis over the other AI modules — cheap input,
    a single AI call — surfacing the highest-leverage actions across the estate.

    Peek-safe: without force_refresh it returns a cached briefing or a lightweight
    "not generated" stub and NEVER spends an AI call (so loading the home page is
    free); generation only happens when force_refresh=True (the Generate button)."""
    if not force_refresh:
        cached = _get_cached("ai_executive_briefing", max_age_hours=6)
        if cached:
            return cached

    insights = get_ai_insights_summary()
    available = [m for m in insights["modules"] if m.get("available")]
    if len(available) < 2:
        return {
            "error": "Need at least 2 analyzed categories to synthesize an executive briefing.",
            "available": False,
            "analyzed_count": len(available),
        }

    if not force_refresh:
        # Peek-only: don't auto-spend an AI call on page load.
        return {"available": False, "not_generated": True, "analyzed_count": len(available)}

    lines = []
    for m in available:
        lines.append(
            f"- {m['label']} (key={m['key']}): score={m.get('score')}, risk={m.get('risk_level')}, "
            f"categories={m.get('category_count')}, findings={m.get('finding_count')}; "
            f"summary={(m.get('executive_summary') or '')[:240]}; "
            f"top_action={(m.get('top_recommendation') or '')[:160]}"
        )
    modules_block = "\n".join(lines)

    system_prompt = (
        "You are the Chief Cloud Strategist briefing a CIO. You receive per-domain AI "
        "assessment summaries for an Azure + hybrid (Arc / on-prem) estate and must SYNTHESIZE "
        "them into one decisive executive briefing. Identify cross-cutting themes and the few "
        "actions with the highest leverage ACROSS domains (not a restatement of each domain). "
        "Be specific, business-oriented and prioritized. Reference Microsoft CAF/WAF where "
        "relevant. Return ONLY valid JSON.\n\n"
        "Output limits: top_cross_cutting_risks <=5; each roadmap bucket <=5; themes <=6; "
        "keep every string concise (<=240 chars)."
    )
    user_prompt = f"""Per-domain AI assessment summaries (one line each):
{modules_block}

Synthesize a single executive briefing. Return JSON exactly:
{{
  "headline": "<one punchy sentence on overall estate posture>",
  "estate_posture": "<3-4 sentence CIO-level narrative synthesizing ACROSS domains>",
  "estate_health_score": <0-100 overall; weight resilience, security and backup heavily>,
  "confidence": "high|medium|low",
  "top_cross_cutting_risks": [
    {{"title": "<risk>", "detail": "<why it matters; cite the domains involved>", "categories": ["security","monitoring"], "severity": "critical|high|medium"}}
  ],
  "unified_roadmap": {{
    "now": ["<0-30 day, highest-leverage action>"],
    "next": ["<30-90 day action>"],
    "later": ["<90+ day strategic initiative>"]
  }},
  "biggest_opportunity": "<the single highest-value opportunity across the estate>",
  "themes": [{{"theme": "<e.g. Resilience>", "status": "weak|moderate|strong", "note": "<short>"}}]
}}"""
    try:
        raw = _call_ai(system_prompt, user_prompt, max_tokens=4000)
        result = _safe_json_parse(raw)
        result["_meta"] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": get_provider_info().get("model", "unknown"),
            "categories_analyzed": [m["key"] for m in available],
            "analyzed_count": len(available),
        }
        _save_cache("ai_executive_briefing", result["_meta"]["model"], result)
        return result
    except Exception as e:
        logger.error("Executive briefing AI synthesis failed: %s", e)
        return {"error": str(e), "available": False}


# ── Resource context builders ─────────────────────────────────────────────────

def _build_arc_context(arc_data: dict) -> str:
    """Build detailed Arc machine context for AI prompts."""
    if not arc_data or not arc_data.get("has_data"):
        return "No Azure Arc machines detected in this environment."

    machines = arc_data.get("machines", [])
    sql_instances = arc_data.get("sql_instances", [])
    sql_databases = arc_data.get("sql_databases", [])
    
    lines = [
        f"## Azure Arc Hybrid Infrastructure",
        f"Total Arc Machines: {arc_data.get('total_machines', 0)}",
        f"Connected: {arc_data.get('connected', 0)}, Disconnected: {arc_data.get('disconnected', 0)}",
        f"Windows: {arc_data.get('windows_count', 0)}, Linux: {arc_data.get('linux_count', 0)}",
        f"SQL Server Instances: {arc_data.get('total_sql_instances', 0)}",
        f"SQL Databases: {arc_data.get('total_databases', 0)}",
        f"Availability Groups: {arc_data.get('total_availability_groups', 0)}",
        "",
        "### Coverage:",
        f"  Monitoring: {arc_data.get('coverage', {}).get('monitoring_pct', 0):.0f}%",
        f"  Security: {arc_data.get('coverage', {}).get('security_pct', 0):.0f}%",
        f"  Patching: {arc_data.get('coverage', {}).get('patching_pct', 0):.0f}%",
        f"  Change Tracking: {arc_data.get('coverage', {}).get('change_tracking_pct', 0):.0f}%",
        "",
    ]
    
    # Add machine details (limit to 30 for token management)
    if machines:
        lines.append("### Machine Details:")
        for m in machines[:30]:
            os_info = f"{m.get('osName', m.get('osType', 'Unknown'))} {m.get('osVersion', '')}"
            hw_info = f"{m.get('cores', '?')} cores, {m.get('totalMemoryGB', '?')} GB RAM"
            status = m.get('status', 'unknown')
            extensions = m.get('extensions', [])
            ext_names = [e.get('extensionName', '') for e in extensions] if extensions else []
            sql_info = f", SQL: {m.get('sql_edition', '')}" if m.get('has_sql') else ""
            lines.append(
                f"  - {m.get('name', '?')} | {os_info} | {hw_info} | Status: {status} | "
                f"Extensions: {', '.join(ext_names[:5]) or 'None'}{sql_info}"
            )
        lines.append("")
    
    # Add SQL details
    if sql_instances:
        lines.append("### SQL Server Instances (On-Premises via Arc):")
        for sql in sql_instances[:20]:
            lines.append(
                f"  - {sql.get('instanceName', '?')} | Version: {sql.get('version', '?')} | "
                f"Edition: {sql.get('edition', '?')} | vCores: {sql.get('vCore', '?')} | "
                f"License: {sql.get('licenseType', '?')}"
            )
        lines.append("")
    
    if sql_databases:
        lines.append("### SQL Databases (On-Premises via Arc):")
        for db in sql_databases[:30]:
            size_gb = round(db.get('sizeMB', 0) / 1024, 1) if db.get('sizeMB') else '?'
            lines.append(
                f"  - {db.get('name', '?')} | Size: {size_gb} GB | "
                f"Recovery: {db.get('recoveryMode', '?')} | "
                f"Compat Level: {db.get('compatLevel', '?')} | "
                f"Backup: {db.get('backupStatus', '?')}"
            )
        lines.append("")
    
    # BCDR risks
    bcdr = arc_data.get("bcdr", {})
    if bcdr:
        lines.append("### Arc BCDR Status:")
        lines.append(f"  BCDR Score: {bcdr.get('overall_score', 0)}/100")
        lines.append(f"  DB Backup Coverage: {bcdr.get('db_backup_pct', 0):.0f}%")
        lines.append(f"  AG Protection: {bcdr.get('ag_coverage_pct', 0):.0f}%")
        risks = bcdr.get("risks", [])
        if risks:
            lines.append("  Risks:")
            for risk in risks[:10]:
                lines.append(f"    - [{risk.get('severity', '?')}] {risk.get('description', '?')}")
    
    return "\n".join(lines)


def _build_resource_context(resources: list, max_resources: int = 150) -> str:
    """Build compressed resource list for prompts - includes custom tags enrichment."""
    if not resources:
        return "No Azure resources found."
    # Cap input size so the AI prompt stays small enough for fast generation.
    # A representative sample of up to 90 resources is plenty for pattern analysis.
    max_resources = min(max_resources, 90)

    summary = _build_workload_summary([r if isinstance(r, dict) else r.__dict__ for r in resources])
    
    # Compress resources for context
    resource_dicts = [r if isinstance(r, dict) else r.__dict__ for r in resources]
    compressed = [_compress_resource(r) for r in resource_dicts[:max_resources]]

    # Enrich with custom tags (Criticality, DR_Tier, RPO, RTO, Environment, etc.)
    compressed = _enrich_with_custom_tags(compressed)

    # Build tag context summary for the AI prompt preamble
    tag_summary = _build_tag_summary(compressed)
    
    return json.dumps({
        "summary": summary,
        "tag_context": tag_summary,
        "resources": compressed,
        "total_resources_in_estate": len(resources),
        "resources_shown": len(compressed),
    }, default=str)


# Category-specific resource type allowlists
# Resources NOT in Arc (microsoft.hybridcompute) are filtered OUT of Arc-specific categories
_CATEGORY_RESOURCE_FILTERS: dict = {
    "security": {
        # All resource types are relevant to security
        "exclude_types": [],
        "include_types": [],  # empty = include all
    },
    "maturity": {
        "exclude_types": [],
        "include_types": [],
    },
    "innovation": {
        # Focus on compute, databases, AI, integration - not Arc machines
        "exclude_types": ["microsoft.hybridcompute/machines"],
        "include_types": [],
    },
    "migration": {
        # Migration is most relevant for compute + databases + Arc machines
        "exclude_types": [],
        "include_types": [
            "microsoft.compute/virtualmachines",
            "microsoft.compute/virtualmachinescalesets",
            "microsoft.sql/servers",
            "microsoft.sql/servers/databases",
            "microsoft.dbformysql/servers",
            "microsoft.dbforpostgresql/servers",
            "microsoft.hybridcompute/machines",
            "microsoft.web/sites",
            "microsoft.containerservice/managedclusters",
            "microsoft.servicebus/namespaces",
            "microsoft.eventhub/namespaces",
            "microsoft.storage/storageaccounts",
        ],
    },
    "backup": {
        # Backup is most relevant for VMs, databases, storage, Arc machines
        "exclude_types": [],
        "include_types": [
            "microsoft.compute/virtualmachines",
            "microsoft.sql/servers/databases",
            "microsoft.dbformysql/servers",
            "microsoft.dbforpostgresql/servers",
            "microsoft.storage/storageaccounts",
            "microsoft.hybridcompute/machines",
            "microsoft.web/sites",
            "microsoft.keyvault/vaults",
            "microsoft.documentdb/databaseaccounts",
            "microsoft.recoveryservices/vaults",
        ],
    },
    "resilience": {
        # Resilience is relevant for all compute, networking, databases
        "exclude_types": [
            "microsoft.hybridcompute/machines",  # Arc excluded - those are on-prem
            "microsoft.hybridcompute/machines/extensions",
        ],
        "include_types": [],
    },
    "networking": {
        "exclude_types": ["microsoft.hybridcompute/machines"],
        "include_types": [
            "microsoft.network/virtualnetworks",
            "microsoft.network/networksecuritygroups",
            "microsoft.network/applicationgateways",
            "microsoft.network/loadbalancers",
            "microsoft.network/expressroutecircuits",
            "microsoft.network/privatednszones",
            "microsoft.network/dnszones",
            "microsoft.network/frontdoors",
            "microsoft.network/azurefirewalls",
            "microsoft.network/virtualnetworkgateways",
            "microsoft.network/publicipaddresses",
            "microsoft.network/bastionhosts",
            "microsoft.cdn/profiles",
            "microsoft.compute/virtualmachines",  # VMs for NSG/peering analysis
            "microsoft.containerservice/managedclusters",
        ],
    },
    "onprem": {
        # On-prem analysis ONLY uses Arc machines + uploaded data - exclude Azure-native
        "exclude_types": [],
        "include_types": ["microsoft.hybridcompute/machines"],
    },
}


def _filter_resources_for_category(resources: list, category: str) -> list:
    """
    Filter the global resource list to only include types relevant to a specific
    analysis category. Prevents Arc inventory from appearing in all AI categories.

    Args:
        resources: Full list of resource dicts/objects
        category: One of security, maturity, innovation, migration, backup, resilience, networking, onprem
    Returns:
        Filtered list (same type as input)
    """
    cfg = _CATEGORY_RESOURCE_FILTERS.get(category)
    if not cfg:
        return resources  # Unknown category - pass all through

    include_types = {t.lower() for t in cfg.get("include_types", [])}
    exclude_types = {t.lower() for t in cfg.get("exclude_types", [])}

    # If no restrictions at all, return all
    if not include_types and not exclude_types:
        return resources

    filtered = []
    for r in resources:
        raw = r if isinstance(r, dict) else r.__dict__
        rtype = (raw.get("resource_type") or raw.get("type", "")).lower()

        # Exclude wins over include
        if exclude_types and rtype in exclude_types:
            continue

        # If include_types specified, only accept matching types
        if include_types:
            # Also accept if any include token is a prefix/suffix match
            match = any(rtype == t or rtype.startswith(t) for t in include_types)
            if not match:
                continue

        filtered.append(r)

    logger.debug(
        "_filter_resources_for_category(%s): %d -> %d resources",
        category, len(resources), len(filtered)
    )
    return filtered if filtered else resources  # Fallback to all if filter removes everything


# ── Per-category input scoping for analyze_generic_ai ─────────────────────────
# Ensures each generic category's AI sees ONLY data relevant to it. Without this,
# every category (identity, advisor, governance, quota…) was fed the full resource
# inventory + Azure Arc context, so Arc bled into unrelated analyses and the output
# looked copy-pasted. Keys per module:
#   arc    — include the Azure Arc / hybrid context block
#   estate — include the (scoped) Azure resource inventory + estate-stats block
#   types  — restrict the inventory to these resource-type prefixes (estate only)
#   label  — what this category analyzes (prompt wording + UI progress)
_GENERIC_AI_SCOPE: dict = {
    "entra":             {"arc": False, "estate": False, "types": [], "label": "Microsoft Entra ID identity — role assignments, app registrations, guests and directory posture"},
    "governance":        {"arc": False, "estate": False, "types": [], "label": "Azure Policy compliance and RBAC governance posture"},
    "advisor":           {"arc": False, "estate": False, "types": [], "label": "Azure Advisor recommendations"},
    "quota":             {"arc": False, "estate": False, "types": [], "label": "compute quota and regional capacity"},
    "lifecycle":         {"arc": False, "estate": False, "types": [], "label": "Azure retirements, deprecations and the resources they expose"},
    "service_health":    {"arc": False, "estate": False, "types": [], "label": "Azure Service Health events and the workloads they affect"},
    "appservice":        {"arc": False, "estate": True,  "types": ["microsoft.web/"], "label": "App Service plans and web/function apps"},
    "sql_modernization": {"arc": True,  "estate": True,  "types": ["microsoft.sql/", "microsoft.dbformysql", "microsoft.dbforpostgresql", "microsoft.dbformariadb", "microsoft.azurearcdata/", "microsoft.sqlvirtualmachine/"], "label": "the SQL estate (Azure SQL, PaaS databases, SQL-on-VM and Arc SQL)"},
    "vm_performance":    {"arc": True,  "estate": True,  "types": ["microsoft.compute/virtualmachines", "microsoft.compute/virtualmachinescalesets", "microsoft.hybridcompute/machines"], "label": "virtual machine performance and right-sizing"},
    "waf":               {"arc": True,  "estate": True,  "types": [], "label": "the full Azure estate across the five Well-Architected pillars"},
    "caf":               {"arc": True,  "estate": True,  "types": [], "label": "the full Azure estate against the Cloud Adoption Framework"},
}


def _generic_ai_scope(module_key: str) -> dict:
    """Resolve the input-scoping config for a generic AI module key."""
    if module_key in _GENERIC_AI_SCOPE:
        return _GENERIC_AI_SCOPE[module_key]
    if module_key.split("_")[0] == "advisor":  # advisor_cost, advisor_security, …
        return _GENERIC_AI_SCOPE["advisor"]
    return {"arc": True, "estate": True, "types": [], "label": "the Azure estate"}


def _scope_inventory(resources: list, cfg: dict, module_key: str) -> list:
    """Return the resource subset this category should analyze (or [] when the
    category's primary input is its own signals, not the inventory)."""
    if not cfg.get("estate"):
        return []
    types = [t.lower() for t in (cfg.get("types") or [])]
    if types:
        out = []
        for r in resources:
            raw = r if isinstance(r, dict) else r.__dict__
            rtype = (raw.get("resource_type") or raw.get("type", "")).lower()
            if any(rtype.startswith(t) for t in types):
                out.append(r)
        if out:
            return out
    return _filter_resources_for_category(resources, module_key)


# ── Estate context layer (statistics + on-prem + fingerprint cache) ───────────
# These helpers ground every category's AI analysis in REAL pre-computed numbers
# from all three estate sources (Azure-native, Arc-hybrid, on-prem scanned) so the
# output is deep, statistical and distinct per category instead of generic.

_ONPREM_CTX_CACHE: dict = {"loaded": False, "data": None, "ts": 0.0}
_ONPREM_CTX_TTL = 60.0  # seconds — short so fresh scans are picked up automatically


def _load_onprem_ctx() -> dict:
    """Load on-prem scan context (Azure SQL onprem_servers), memoized with a short TTL.

    Returns the dict from onprem_service.get_onprem_ai_context() or {} on failure /
    when no servers have been scanned. The TTL keeps repeated category analyses in one
    request burst cheap while still reflecting a newly uploaded scan within a minute.
    """
    import time as _time
    now = _time.time()
    if _ONPREM_CTX_CACHE["loaded"] and (now - _ONPREM_CTX_CACHE.get("ts", 0)) < _ONPREM_CTX_TTL:
        return _ONPREM_CTX_CACHE["data"] or {}
    data = {}
    try:
        from services.onprem_service import get_onprem_ai_context
        data = get_onprem_ai_context() or {}
    except Exception as e:
        logger.debug("On-prem context unavailable: %s", e)
        data = {}
    _ONPREM_CTX_CACHE["loaded"] = True
    _ONPREM_CTX_CACHE["data"] = data
    _ONPREM_CTX_CACHE["ts"] = now
    return data


def reset_onprem_ctx_cache():
    """Invalidate the memoized on-prem context (call after a new scan upload)."""
    _ONPREM_CTX_CACHE["loaded"] = False
    _ONPREM_CTX_CACHE["data"] = None
    _ONPREM_CTX_CACHE["ts"] = 0.0


def _build_onprem_estate_text(onprem: dict, max_servers: int = 40) -> str:
    """Human-readable on-prem block for prompts, mirroring _build_arc_context."""
    if not onprem or not onprem.get("total_servers"):
        return "## On-Premises Discovered Servers\nNo on-premises servers have been scanned into the inventory."
    lines = [
        "## On-Premises Discovered Servers (from on-prem scanning, stored in Azure SQL)",
        f"Total Servers: {onprem.get('total_servers', 0)}",
        f"Total Cores: {onprem.get('total_cores', 0)} | "
        f"Total Memory: {onprem.get('total_memory_gb', 0)} GB | "
        f"Total Storage: {onprem.get('total_storage_gb', 0)} GB",
        "",
        "### Server Details:",
    ]
    for s in (onprem.get("servers") or [])[:max_servers]:
        lines.append(
            f"  - {s.get('hostname', '?')} | {s.get('os', '?')} | "
            f"{s.get('cores', '?')} cores, {s.get('memory_gb', '?')} GB RAM, "
            f"{s.get('storage_gb', '?')} GB disk | "
            f"workload: {s.get('workload_type', '?')} | "
            f"target: {s.get('migration_target', '?')} | "
            f"complexity: {s.get('complexity', '?')} | "
            f"{'virtual' if s.get('is_virtual') else 'physical'} | "
            f"SQL:{s.get('sql_instances', 0)} IIS:{s.get('iis_sites', 0)} apps:{s.get('app_count', 0)} | "
            f"FW:{'on' if s.get('firewall_enabled') else 'off'} AV:{s.get('antivirus', '?')} "
            f"patches-pending:{s.get('pending_updates', '?')}"
        )
    return "\n".join(lines)


def _rget(r, *keys, default=None):
    """Safe getter across dict / pydantic model resources."""
    raw = r if isinstance(r, dict) else getattr(r, "__dict__", {})
    for k in keys:
        if k in raw and raw[k] not in (None, ""):
            return raw[k]
    return default


def compute_category_statistics(category: str, resources: list, arc_data: dict = None, onprem: dict = None) -> dict:
    """Compute REAL, category-relevant statistics from the filtered estate slice +
    Arc + on-prem so the AI grounds its scores and findings on exact numbers.
    Only uses fields that actually exist on the inventory — never invents values."""
    arc_data = arc_data or {}
    onprem = onprem or {}
    rs = resources or []

    def _type(r):
        return (_rget(r, "resource_type", "type", default="") or "").lower()

    # ── Common stats (every category) ─────────────────────────────────────
    total = len(rs)
    total_cost = round(sum(float(_rget(r, "cost_current_month", "cost_mtd", default=0) or 0) for r in rs), 2)
    by_type: dict = {}
    by_sub: dict = {}
    by_location: dict = {}
    untagged = 0
    backup_protected = 0
    locked = 0
    private_endpoint = 0
    ri_covered = 0
    orphaned = 0
    idle = 0
    for r in rs:
        t = _type(r)
        by_type[t] = by_type.get(t, 0) + 1
        sub = _rget(r, "subscription_id", default="") or "unknown"
        by_sub[sub] = by_sub.get(sub, 0) + 1
        loc = _rget(r, "location", default="") or "unknown"
        by_location[loc] = by_location.get(loc, 0) + 1
        if _rget(r, "missing_tags", default=None):
            untagged += 1
        if _rget(r, "has_backup", default=False):
            backup_protected += 1
        if _rget(r, "has_lock", default=False):
            locked += 1
        if _rget(r, "has_private_endpoint", default=False):
            private_endpoint += 1
        if _rget(r, "ri_covered", default=False):
            ri_covered += 1
        if _rget(r, "is_orphan", default=False):
            orphaned += 1
        if _rget(r, "idle_confirmed", default=False):
            idle += 1

    top_types = dict(sorted(by_type.items(), key=lambda kv: -kv[1])[:12])
    stats: dict = {
        "category": category,
        "azure_resource_count": total,
        "azure_total_cost_mtd": total_cost,
        "subscriptions_in_scope": len(by_sub),
        "regions_in_use": len(by_location),
        "top_resource_types": top_types,
        "untagged_count": untagged,
        "tag_compliance_pct": round((total - untagged) / total * 100, 1) if total else 0.0,
        "backup_protected_count": backup_protected,
        "locked_count": locked,
        "private_endpoint_count": private_endpoint,
        "ri_covered_count": ri_covered,
        "orphaned_count": orphaned,
        "idle_count": idle,
        "arc_machines": arc_data.get("total_machines", 0),
        "arc_sql_instances": arc_data.get("total_sql_instances", 0),
        "onprem_servers": onprem.get("total_servers", 0),
        "onprem_cores": onprem.get("total_cores", 0),
        "onprem_memory_gb": onprem.get("total_memory_gb", 0),
    }

    def _count_types(*prefixes):
        return sum(1 for r in rs if any(_type(r).startswith(p) for p in prefixes))

    # ── Category-specific stats ───────────────────────────────────────────
    if category == "security":
        stats["public_ip_count"] = _count_types("microsoft.network/publicipaddresses")
        stats["nsg_count"] = _count_types("microsoft.network/networksecuritygroups")
        stats["key_vault_count"] = _count_types("microsoft.keyvault/vaults")
        stats["storage_account_count"] = _count_types("microsoft.storage/storageaccounts")
        stats["sql_server_count"] = _count_types("microsoft.sql/servers")
        stats["resources_with_private_endpoint"] = private_endpoint
        stats["resources_without_lock"] = total - locked
        stats["app_services_count"] = _count_types("microsoft.web/sites")
    elif category == "backup":
        eligible = [r for r in rs if any(_type(r).startswith(p) for p in (
            "microsoft.compute/virtualmachines", "microsoft.sql/servers/databases",
            "microsoft.dbformysql", "microsoft.dbforpostgresql",
            "microsoft.documentdb/databaseaccounts", "microsoft.hybridcompute/machines"))]
        protected = sum(1 for r in eligible if _rget(r, "has_backup", default=False))
        stats["backup_eligible_count"] = len(eligible)
        stats["backup_protected_count"] = protected
        stats["backup_coverage_pct"] = round(protected / len(eligible) * 100, 1) if eligible else 0.0
        stats["unprotected_count"] = len(eligible) - protected
        stats["recovery_vault_count"] = _count_types("microsoft.recoveryservices/vaults")
    elif category == "resilience":
        vms = [r for r in rs if _type(r).startswith("microsoft.compute/virtualmachines")]
        stats["vm_count"] = len(vms)
        stats["running_vm_count"] = sum(1 for r in vms if (_rget(r, "power_state", default="") or "").lower() == "running")
        stats["sql_replica_count"] = sum(1 for r in rs if _rget(r, "is_sql_replica", default=False))
        stats["backup_protected_count"] = backup_protected
        stats["storage_account_count"] = _count_types("microsoft.storage/storageaccounts")
        stats["load_balancer_count"] = _count_types("microsoft.network/loadbalancers", "microsoft.network/applicationgateways")
    elif category == "migration":
        stats["vm_count"] = _count_types("microsoft.compute/virtualmachines", "microsoft.compute/virtualmachinescalesets")
        stats["sql_count"] = _count_types("microsoft.sql/servers", "microsoft.sql/servers/databases")
        stats["app_service_count"] = _count_types("microsoft.web/sites")
        stats["aks_count"] = _count_types("microsoft.containerservice/managedclusters")
        # On-prem migration candidates by complexity / target
        comp: dict = {}
        targ: dict = {}
        for s in (onprem.get("servers") or []):
            comp[s.get("complexity", "unknown")] = comp.get(s.get("complexity", "unknown"), 0) + 1
            targ[s.get("migration_target", "unknown")] = targ.get(s.get("migration_target", "unknown"), 0) + 1
        stats["onprem_by_complexity"] = comp
        stats["onprem_by_target"] = targ
    elif category == "maturity":
        cats: dict = {}
        for r in rs:
            c = _rget(r, "resource_category", default="other") or "other"
            cats[c] = cats.get(c, 0) + 1
        paas = sum(v for k, v in cats.items() if k in ("data", "ai", "other"))
        iaas = cats.get("compute", 0) + cats.get("infrastructure", 0)
        stats["resource_category_breakdown"] = cats
        stats["paas_vs_iaas"] = {"paas_like": paas, "iaas_like": iaas}
        stats["ai_service_count"] = cats.get("ai", 0)
        stats["auto_shutdown_vms"] = sum(1 for r in rs if _rget(r, "auto_shutdown", default=False))
    elif category == "innovation":
        stats["ai_service_count"] = sum(1 for r in rs if (_rget(r, "resource_category", default="") or "") == "ai")
        stats["aks_count"] = _count_types("microsoft.containerservice/managedclusters")
        stats["function_app_count"] = sum(1 for r in rs if (_rget(r, "app_kind", default="") or "") == "function")
        stats["app_service_count"] = _count_types("microsoft.web/sites")
        stats["cosmos_count"] = _count_types("microsoft.documentdb/databaseaccounts")
    elif category in ("bcdr", "bcdr_avs", "bcdr_deep"):
        stats["backup_protected_count"] = backup_protected
        stats["unprotected_count"] = total - backup_protected
        stats["sql_replica_count"] = sum(1 for r in rs if _rget(r, "is_sql_replica", default=False))
        stats["private_endpoint_count"] = private_endpoint
    elif category == "onprem":
        comp = {}
        targ = {}
        roles = {}
        for s in (onprem.get("servers") or []):
            comp[s.get("complexity", "unknown")] = comp.get(s.get("complexity", "unknown"), 0) + 1
            targ[s.get("migration_target", "unknown")] = targ.get(s.get("migration_target", "unknown"), 0) + 1
            if s.get("sql_instances"):
                roles["sql"] = roles.get("sql", 0) + 1
            if s.get("iis_sites"):
                roles["web"] = roles.get("web", 0) + 1
        stats["onprem_by_complexity"] = comp
        stats["onprem_by_target"] = targ
        stats["onprem_roles"] = roles

    return stats


def build_estate_breakdown(resources: list, arc_data: dict = None, onprem: dict = None) -> dict:
    """Three-source estate breakdown for UI chips + grounding."""
    arc_data = arc_data or {}
    onprem = onprem or {}
    rs = resources or []
    azure_native = [r for r in rs if not (_rget(r, "resource_type", "type", default="") or "").lower().startswith("microsoft.hybridcompute")]
    return {
        "azure": {
            "count": len(azure_native),
            "cost_mtd": round(sum(float(_rget(r, "cost_current_month", "cost_mtd", default=0) or 0) for r in azure_native), 2),
        },
        "arc": {
            "machines": arc_data.get("total_machines", 0),
            "sql_instances": arc_data.get("total_sql_instances", 0),
        },
        "onprem": {
            "servers": onprem.get("total_servers", 0),
            "cores": onprem.get("total_cores", 0),
            "memory_gb": onprem.get("total_memory_gb", 0),
        },
    }


def _inventory_fingerprint(category: str, resources: list, arc_data: dict = None, onprem: dict = None) -> str:
    """Short hash of the estate slice so cache auto-invalidates when inventory changes."""
    import hashlib
    arc_data = arc_data or {}
    onprem = onprem or {}
    ids = sorted((_rget(r, "resource_id", "id", default="") or "") for r in (resources or []))
    parts = [
        category,
        str(len(ids)),
        str(arc_data.get("total_machines", 0)),
        str(onprem.get("total_servers", 0)),
    ]
    hostnames = sorted((s.get("hostname", "") for s in (onprem.get("servers") or [])))
    h = hashlib.sha1(("|".join(parts) + "||" + "|".join(ids) + "||" + "|".join(hostnames)).encode("utf-8"))
    return h.hexdigest()[:12]


def _estate_context_block(category: str, resources: list, arc_data: dict = None, onprem: dict = None):
    """Build the combined prompt block (statistics + on-prem) and return
    (block_text, stats, breakdown) for injection + result merge."""
    stats = compute_category_statistics(category, resources, arc_data, onprem)
    breakdown = build_estate_breakdown(resources, arc_data, onprem)
    onprem_block = _build_onprem_estate_text(onprem)
    block = (
        "\n\n## Pre-computed Estate Statistics — GROUND your scores and findings on these "
        "EXACT numbers; do NOT invent counts:\n"
        + json.dumps(stats, default=str)
        + "\n\n## Estate Source Breakdown (Azure-native / Arc-hybrid / On-prem-discovered):\n"
        + json.dumps(breakdown, default=str)
        + "\n\n" + onprem_block
        + "\n\n## Output organisation requirement:\n"
        "Organise findings so the reader can see which ESTATE each belongs to "
        "(Azure-native, Arc-hybrid, or On-prem-discovered). Base every score strictly on the "
        "pre-computed statistics above. Cite the relevant Microsoft framework (CAF / WAF / "
        "Microsoft Cloud Security Benchmark / Azure Migrate) and a Microsoft Learn URL per "
        "recommendation, and keep affected_resources populated for every Azure finding."
    )
    return block, stats, breakdown


def _attach_estate_meta(result: dict, stats: dict, breakdown: dict, resources: list,
                        arc_data: dict = None, onprem: dict = None):
    """Merge statistics / estate_breakdown / data_sources into the analysis result."""
    if not isinstance(result, dict):
        return result
    arc_data = arc_data or {}
    onprem = onprem or {}
    result["statistics"] = stats
    result["estate_breakdown"] = breakdown
    meta = result.get("_meta")
    if not isinstance(meta, dict):
        meta = {}
        result["_meta"] = meta
    meta["data_sources"] = {
        "azure_resources": breakdown.get("azure", {}).get("count", 0),
        "arc_machines": breakdown.get("arc", {}).get("machines", 0),
        "onprem_servers": breakdown.get("onprem", {}).get("servers", 0),
    }
    return result


def _safe_json_parse(raw: str) -> dict:
    """Parse AI JSON robustly. Strips code fences, then — when the response was
    truncated at the token cap — recovers the largest valid object by cutting
    back to the last complete element (dropping any dangling key / partial value)
    and re-balancing braces/brackets. Returns a (possibly partial) dict tagged
    with "_partial": True rather than raising whenever anything is recoverable."""
    if not raw or not raw.strip():
        raise ValueError("Empty AI response")
    s = raw.strip()
    # Strip markdown fences
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s
        if "```" in s:
            s = s.rsplit("```", 1)[0]
    s = s.strip()
    # Trim to the first opening brace
    start = s.find("{")
    if start > 0:
        s = s[start:]
    # Fast path — already valid
    try:
        return json.loads(s)
    except Exception:
        pass

    import re as _re

    def _balance(text: str) -> str:
        """Close any open string / array / object so the prefix can parse."""
        text = _re.sub(r",\s*([}\]])", r"\1", text).rstrip().rstrip(",")
        st: list = []
        in_s = False
        es = False
        for ch in text:
            if es:
                es = False
                continue
            if ch == "\\" and in_s:
                es = True
                continue
            if ch == '"':
                in_s = not in_s
                continue
            if in_s:
                continue
            if ch in "{[":
                st.append(ch)
            elif ch == "}" and st and st[-1] == "{":
                st.pop()
            elif ch == "]" and st and st[-1] == "[":
                st.pop()
        if in_s:
            text += '"'
        for opener in reversed(st):
            text += "}" if opener == "{" else "]"
        return _re.sub(r",\s*([}\]])", r"\1", text)

    # Second path — balance the whole thing as-is.
    try:
        return json.loads(_balance(s))
    except Exception:
        pass

    # Recovery — collect "safe cut points": indices just after a complete element
    # at depth >= 1 (a closer '}'/']' , a string element in an array, or the
    # position of a separating comma). Truncating there drops a dangling key or
    # partial value left behind by token-cap truncation.
    cut_points: list = []
    stack2: list = []
    in_str = False
    esc = False
    for i, ch in enumerate(s):
        if esc:
            esc = False
            continue
        if in_str:
            if ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
                if stack2 and stack2[-1] == "[":
                    cut_points.append(i + 1)
            continue
        if ch == '"':
            in_str = True
            continue
        if ch in "{[":
            stack2.append(ch)
        elif ch in "}]":
            if stack2:
                stack2.pop()
            if stack2:
                cut_points.append(i + 1)
        elif ch == "," and stack2:
            cut_points.append(i)

    # Try the latest safe boundaries first (truncation is at the end), capped so
    # a pathological input can't blow up the loop.
    for cut in list(reversed(cut_points))[:150]:
        try:
            obj = json.loads(_balance(s[:cut]))
            if isinstance(obj, dict):
                obj.setdefault("_partial", True)
                return obj
        except Exception:
            continue
    raise ValueError("Unable to parse AI JSON")


# ═══════════════════════════════════════════════════════════════════════════════
# 1. CLOUD MATURITY AI ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_cloud_maturity_ai(resources: list, arc_data: dict = None, force_refresh: bool = False) -> dict:
    """
    AI-powered cloud maturity analysis across Azure + Arc estate.
    Returns detailed recommendations for improving cloud maturity.
    """
    filtered_resources = _filter_resources_for_category(resources, "maturity")
    onprem = _load_onprem_ctx()
    fp = _inventory_fingerprint("maturity", filtered_resources, arc_data, onprem)
    cache_key = f"ai_cloud_maturity:{fp}"
    if not force_refresh:
        cached = _get_cached(cache_key, max_age_hours=12)
        if cached:
            return cached

    resource_ctx = _build_resource_context(filtered_resources)
    arc_ctx = _build_arc_context(arc_data) if arc_data else "No Arc data available."
    _estate_block, _stats, _breakdown = _estate_context_block("maturity", filtered_resources, arc_data, onprem)
    arc_ctx = arc_ctx + _estate_block

    system_prompt = """You are a senior Microsoft Cloud Architect specializing in cloud maturity assessments 
and digital transformation strategy. You evaluate both Azure-native and hybrid (Arc) environments 
to provide actionable maturity improvement recommendations.

Reference frameworks: Microsoft Cloud Adoption Framework (CAF), Azure Well-Architected Framework (WAF) 
five pillars (Reliability, Security, Cost Optimization, Operational Excellence, Performance Efficiency).
Cite specific WAF recommendations and CAF phases where applicable.
Include relevant Azure CLI / PowerShell commands for remediation steps.
Reference Microsoft Learn documentation URLs where helpful.

""" + RESOURCE_ATTRIBUTION_INSTRUCTION + """
You must return ONLY valid JSON matching the exact schema requested."""

    user_prompt = f"""Analyze this Azure environment for cloud maturity and provide detailed AI-powered recommendations.

## Azure Estate Data:
{resource_ctx}

## Azure Arc / Hybrid Infrastructure:
{arc_ctx}

## Analysis Requirements:
1. Evaluate maturity across ALL 5 dimensions: IaaS Modernization, AI & Innovation, DevOps & Automation, Security & Governance, Operational Excellence
2. For EACH dimension, provide specific resource-level findings (not just counts)
3. Identify specific resources that need attention
4. Provide actionable recommendations with implementation steps
5. Consider both Azure-native resources AND Arc/on-premises machines
6. Prioritize recommendations by business impact

Return JSON with this exact structure:
{{
  "overall_assessment": {{
    "current_maturity_level": "Traditional IT|Cloud Aware|Cloud Ready|Cloud Smart|Cloud Native",
    "score": <0-100>,
    "executive_summary": "<3-5 sentence detailed assessment>",
    "key_strengths": ["<specific strength with evidence>", ...],
    "critical_gaps": ["<specific gap with affected resources>", ...]
  }},
  "dimensions": [
    {{
      "name": "<dimension name>",
      "score": <0-100>,
      "assessment": "<detailed 2-3 sentence assessment with specifics>",
      "findings": [
        {{
          "type": "gap|strength|opportunity",
          "severity": "critical|high|medium|low",
          "title": "<specific finding>",
          "detail": "<detailed explanation with resource names>",
          "affected_resources": [
            {{"resource_id": "<id field>", "resource_name": "<name field>", "resource_group": "<rg field>", "subscription_id": "<sub field>", "resource_type": "<type_full field>", "cost_usd": <cost_mtd or 0>}}
          ],
          "recommendation": "<specific action to take>",
          "effort": "Low|Medium|High",
          "impact": "High|Medium|Low"
        }}
      ],
      "recommendations": [
        {{
          "title": "<actionable recommendation>",
          "description": "<detailed implementation guidance>",
          "priority": "P1|P2|P3",
          "azure_services": ["<service to adopt>", ...],
          "estimated_timeline": "<e.g., 2-4 weeks>"
        }}
      ]
    }}
  ],
  "transformation_roadmap": {{
    "immediate_actions": ["<action with specific resources>", ...],
    "30_day_goals": ["<goal>", ...],
    "90_day_goals": ["<goal>", ...],
    "strategic_initiatives": ["<long-term initiative>", ...]
  }},
  "arc_specific_recommendations": [
    {{
      "category": "migration|modernization|optimization|security",
      "title": "<recommendation>",
      "detail": "<detailed explanation>",
      "affected_machines": ["<machine names>", ...],
      "target_service": "<Azure service target>",
      "business_value": "<value statement>"
    }}
  ]
}}"""

    try:
        raw = _call_ai(system_prompt, user_prompt, max_tokens=MAX_TOKENS_MODULE)
        result = _safe_json_parse(raw)
        result = _normalize_maturity_response(result)
        # Enrich affected_resources with full resource objects
        lookup = _build_resource_lookup(resources)
        for dim in result.get("dimension_scores", []):
            _enrich_findings(dim.get("findings", []), lookup)
        result["_meta"] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": get_provider_info().get("model", "unknown"),
            "resource_count": len(resources),
            "arc_machines": arc_data.get("total_machines", 0) if arc_data else 0,
            "data_confidence": _compute_data_confidence(filtered_resources, arc_data),
        }
        _attach_estate_meta(result, _stats, _breakdown, filtered_resources, arc_data, onprem)
        _save_cache(cache_key, result["_meta"]["model"], result)
        return result
    except Exception as e:
        logger.error("Cloud maturity AI analysis failed: %s", e)
        return {"error": str(e), "available": False}


# ═══════════════════════════════════════════════════════════════════════════════
# 2. SECURITY AI ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_security_ai(resources: list, arc_data: dict = None, defender_data: dict = None, force_refresh: bool = False) -> dict:
    """
    AI-powered security posture analysis across Azure + Arc estate.
    """
    if not force_refresh:
        cached = _get_cached("ai_security_posture", max_age_hours=12)
        if cached:
            return cached

    filtered_resources = _filter_resources_for_category(resources, "security")
    onprem = _load_onprem_ctx()
    fp = _inventory_fingerprint("security", filtered_resources, arc_data, onprem)
    cache_key = f"ai_security_posture:{fp}"
    if not force_refresh:
        cached = _get_cached(cache_key, max_age_hours=12)
        if cached:
            return cached

    resource_ctx = _build_resource_context(filtered_resources)
    arc_ctx = _build_arc_context(arc_data) if arc_data else "No Arc data available."
    _estate_block, _stats, _breakdown = _estate_context_block("security", filtered_resources, arc_data, onprem)
    arc_ctx = arc_ctx + _estate_block
    
    # Build Defender context
    defender_ctx = "No Defender for Cloud data available."
    if defender_data:
        findings = defender_data.get("findings", [])
        alerts = defender_data.get("alerts", [])
        plans = defender_data.get("plans_summary", {})
        secure_score = defender_data.get("secure_score", {})
        compliance = defender_data.get("regulatory_compliance", [])
        
        defender_lines = [
            "## Microsoft Defender for Cloud Data:",
            f"Secure Score: {secure_score.get('percentage', 0):.0f}% ({secure_score.get('current', 0)}/{secure_score.get('max', 0)})",
            f"Total Security Findings: {len(findings)}",
            f"Active Alerts: {len(alerts)}",
            f"Defender Plans Enabled: {plans.get('coverage_pct', 0):.0f}%",
            "",
        ]
        
        # Top findings by severity
        critical_findings = [f for f in findings if f.get("severity") == "High"][:15]
        if critical_findings:
            defender_lines.append("### Critical/High Findings:")
            for f in critical_findings:
                defender_lines.append(
                    f"  - [{f.get('severity')}] {f.get('title', f.get('description', '?'))} | "
                    f"Resource: {f.get('resource_name', '?')} | Category: {f.get('category', '?')}"
                )
            defender_lines.append("")
        
        # Alerts
        if alerts[:10]:
            defender_lines.append("### Active Security Alerts:")
            for a in alerts[:10]:
                defender_lines.append(
                    f"  - [{a.get('severity')}] {a.get('title', '?')} | "
                    f"Entity: {a.get('compromised_entity', '?')} | "
                    f"Tactics: {', '.join(a.get('tactics', []))}"
                )
            defender_lines.append("")
        
        # Compliance
        if compliance:
            defender_lines.append("### Regulatory Compliance:")
            for std in compliance[:5]:
                defender_lines.append(
                    f"  - {std.get('name', '?')}: {std.get('passed', 0)} passed, "
                    f"{std.get('failed', 0)} failed, {std.get('skipped', 0)} skipped"
                )
            defender_lines.append("")
        
        defender_ctx = "\n".join(defender_lines)

    system_prompt = """You are a senior Microsoft Azure Security Architect and CISO advisor.
You analyze entire Azure estates including hybrid infrastructure (Azure Arc) for security gaps,
compliance issues, and provide prioritized remediation recommendations.

Reference frameworks: Microsoft Cloud Security Benchmark (MCSB), NIST CSF 2.0, CIS Azure Benchmarks,
Azure Well-Architected Framework Security Pillar, Zero Trust principles.
For each finding, provide the specific Azure CLI / PowerShell remediation command.
Reference MITRE ATT&CK tactics and techniques for threat analysis.
Include relevant Microsoft Learn documentation URLs.

""" + RESOURCE_ATTRIBUTION_INSTRUCTION + """
You must return ONLY valid JSON matching the exact schema requested."""

    user_prompt = f"""Perform a comprehensive security posture analysis of this Azure environment.

## Azure Estate:
{resource_ctx}

## Azure Arc / Hybrid Infrastructure:
{arc_ctx}

{defender_ctx}

## Analysis Requirements:
1. Analyze security across ALL categories: Identity & Access, Network Security, Data Protection, Threat Protection, Compliance, Arc/Hybrid Security
2. Provide SPECIFIC findings with resource names - not generic advice
3. Identify critical vulnerabilities and attack vectors
4. Consider both cloud-native and hybrid/Arc machines
5. Provide remediation steps with Azure service recommendations
6. Assess regulatory compliance (NIA, PDPPL for Qatar-based resources)

Return JSON:
{{
  "security_score": <0-100>,
  "risk_level": "Critical|High|Medium|Low",
  "executive_summary": "<detailed 3-5 sentence security assessment>",
  "categories": [
    {{
      "name": "<Identity & Access|Network Security|Data Protection|Threat Protection|Compliance|Arc Hybrid Security>",
      "score": <0-100>,
      "finding_count": <int>,
      "critical_count": <int>,
      "findings": [
        {{
          "severity": "critical|high|medium|low",
          "title": "<specific finding>",
          "detail": "<detailed description with resource names>",
          "affected_resources": [
            {{"resource_id": "<id field>", "resource_name": "<name field>", "resource_group": "<rg field>", "subscription_id": "<sub field>", "resource_type": "<type_full field>", "cost_usd": <cost_mtd or 0>}}
          ],
          "attack_vector": "<how this could be exploited>",
          "remediation": "<specific steps to fix>",
          "azure_service": "<recommended Azure service>",
          "effort": "Low|Medium|High",
          "compliance_impact": ["<regulation affected>", ...]
        }}
      ]
    }}
  ],
  "top_risks": [
    {{
      "rank": <1-5>,
      "title": "<risk title>",
      "description": "<detailed risk description>",
      "blast_radius": "<what could be affected>",
      "likelihood": "High|Medium|Low",
      "remediation_priority": "Immediate|This Week|This Month"
    }}
  ],
  "compliance_status": {{
    "frameworks_assessed": ["<framework>", ...],
    "overall_compliance_pct": <0-100>,
    "gaps": ["<compliance gap with detail>", ...]
  }},
  "recommendations": [
    {{
      "priority": "P1|P2|P3",
      "title": "<recommendation>",
      "description": "<detailed implementation guidance>",
      "resources_affected": <count>,
      "risk_reduction": "High|Medium|Low",
      "estimated_effort": "<timeline>"
    }}
  ]
}}"""

    try:
        raw = _call_ai(system_prompt, user_prompt, max_tokens=MAX_TOKENS_MODULE)
        result = _safe_json_parse(raw)
        result = _normalize_security_response(result)
        # Enrich affected_resources with full resource objects
        lookup = _build_resource_lookup(resources)
        for cat in result.get("category_analysis", []):
            _enrich_findings(cat.get("findings", []), lookup)
        _enrich_findings(result.get("critical_findings", []), lookup)
        result["_meta"] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": get_provider_info().get("model", "unknown"),
            "resource_count": len(resources),
            "arc_machines": arc_data.get("total_machines", 0) if arc_data else 0,
            "data_confidence": _compute_data_confidence(filtered_resources, arc_data, {"Defender data": bool(defender_data)}),
        }
        _attach_estate_meta(result, _stats, _breakdown, filtered_resources, arc_data, onprem)
        _save_cache(cache_key, result["_meta"]["model"], result)
        return result
    except Exception as e:
        logger.error("Security AI analysis failed: %s", e)
        return {"error": str(e), "available": False}


# ═══════════════════════════════════════════════════════════════════════════════
# 3. INNOVATION AI ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_innovation_ai(resources: list, arc_data: dict = None, force_refresh: bool = False) -> dict:
    """
    AI-powered innovation opportunity analysis.
    Identifies what Azure capabilities can transform the business.
    """
    if not force_refresh:
        cached = _get_cached("ai_innovation", max_age_hours=12)
        if cached:
            return cached

    filtered_resources = _filter_resources_for_category(resources, "innovation")
    onprem = _load_onprem_ctx()
    fp = _inventory_fingerprint("innovation", filtered_resources, arc_data, onprem)
    cache_key = f"ai_innovation:{fp}"
    if not force_refresh:
        cached = _get_cached(cache_key, max_age_hours=12)
        if cached:
            return cached

    resource_ctx = _build_resource_context(filtered_resources, max_resources=150)
    arc_ctx = _build_arc_context(arc_data) if arc_data else "No Arc data."
    _estate_block, _stats, _breakdown = _estate_context_block("innovation", filtered_resources, arc_data, onprem)
    arc_ctx = arc_ctx + _estate_block

    system_prompt = """You are a senior Microsoft Azure Innovation and Digital Transformation Consultant.
You analyze Azure estates to identify innovation opportunities, modernization paths, and 
new capabilities that can drive business value. You think creatively about how existing 
infrastructure can be enhanced with AI, automation, and modern cloud services.

Reference frameworks: Azure Well-Architected Framework, Microsoft Cloud Adoption Framework Innovation methodology.
Include Azure CLI / PowerShell commands for implementing recommendations.
Reference Microsoft Learn documentation and Azure Architecture Center patterns.
Consider Azure AI services, GitHub Copilot, Azure OpenAI, and automation opportunities.

""" + RESOURCE_ATTRIBUTION_INSTRUCTION + """
You must return ONLY valid JSON matching the exact schema requested."""

    user_prompt = f"""Analyze this Azure environment and identify ALL innovation opportunities.
Think broadly about what modern Azure capabilities can transform this estate.

## Azure Estate Data:
{resource_ctx}

## Azure Arc / Hybrid Infrastructure:
{arc_ctx}

## Analysis Requirements:
1. Analyze EVERY aspect of the estate for innovation potential
2. Consider: AI/ML, IoT, Edge Computing, Serverless, Containers, Data Analytics, DevOps, Security AI, Sustainability
3. For EACH opportunity, explain the business value and how existing resources connect
4. Identify quick wins AND strategic initiatives
5. Consider Arc machines as candidates for hybrid AI/edge scenarios
6. Think about data-driven innovation from existing databases and storage
7. Propose specific Azure services with use cases relevant to THIS environment
8. Be creative and detailed - this is about bringing innovation ideas to life

Return JSON:
{{
  "innovation_score": <0-100>,
  "innovation_maturity": "Foundational|Emerging|Advancing|Leading",
  "executive_summary": "<detailed 4-6 sentence innovation assessment explaining current state and potential>",
  "opportunity_categories": [
    {{
      "category": "<AI & ML|Containers & Microservices|Data & Analytics|IoT & Edge|Serverless & Event-Driven|DevOps & Platform Engineering|Security Intelligence|Sustainability & GreenOps|App Modernization|Low-Code & Citizen Dev>",
      "readiness_score": <0-100>,
      "current_adoption": "<description of what's already in place>",
      "opportunities": [
        {{
          "title": "<specific innovation opportunity>",
          "description": "<detailed 2-3 sentence description of the opportunity>",
          "business_value": "<quantified or qualified business impact>",
          "implementation_approach": "<how to implement using existing resources>",
          "azure_services": ["<specific Azure service>", ...],
          "prerequisites": ["<what's needed first>", ...],
          "existing_resources_leveraged": ["<resource names that enable this>", ...],
          "effort": "Low|Medium|High",
          "timeline": "<e.g., 2-4 weeks>",
          "roi_potential": "High|Medium|Low"
        }}
      ]
    }}
  ],
  "quick_wins": [
    {{
      "title": "<innovation quick win>",
      "description": "<what to do and expected outcome>",
      "azure_service": "<primary service>",
      "effort_days": <int>,
      "business_impact": "<expected impact>"
    }}
  ],
  "strategic_initiatives": [
    {{
      "title": "<major strategic initiative>",
      "description": "<detailed multi-sentence description>",
      "components": ["<Azure service>", ...],
      "timeline_months": <int>,
      "expected_outcomes": ["<outcome>", ...],
      "dependencies": ["<dependency>", ...]
    }}
  ],
  "arc_innovation_opportunities": [
    {{
      "title": "<hybrid/edge innovation>",
      "description": "<how Arc machines enable this>",
      "target_machines": ["<machine names>", ...],
      "azure_services": ["<service>", ...],
      "use_case": "<specific business use case>"
    }}
  ],
  "data_driven_insights": [
    {{
      "data_source": "<existing data resource>",
      "innovation_potential": "<what can be built on this data>",
      "proposed_solution": "<Azure services to use>",
      "business_outcome": "<expected business result>"
    }}
  ]
}}"""

    try:
        raw = _call_ai(system_prompt, user_prompt, max_tokens=MAX_TOKENS_MODULE)
        result = _safe_json_parse(raw)
        result = _normalize_innovation_response(result)
        # Resolve resource names to full resource objects in gap_analysis
        lookup = _build_resource_lookup(resources)
        for gap in result.get("gap_analysis", []):
            if "affected_resources" in gap:
                gap["affected_resources"] = _resolve_affected_resources(gap["affected_resources"], lookup)
        result["_meta"] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": get_provider_info().get("model", "unknown"),
            "resource_count": len(resources),
            "arc_machines": arc_data.get("total_machines", 0) if arc_data else 0,
            "data_confidence": _compute_data_confidence(filtered_resources, arc_data),
        }
        _attach_estate_meta(result, _stats, _breakdown, filtered_resources, arc_data, onprem)
        _save_cache(cache_key, result["_meta"]["model"], result)
        return result
    except Exception as e:
        logger.error("Innovation AI analysis failed: %s", e)
        return {"error": str(e), "available": False}


# ═══════════════════════════════════════════════════════════════════════════════
# 4. MIGRATION & MODERNIZATION AI ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_migration_ai(resources: list, arc_data: dict = None, force_refresh: bool = False) -> dict:
    """
    AI-powered migration and modernization analysis.
    Covers: Data center migration, IaaS->PaaS, SQL modernization, Storage migration,
    VMware to AVS, and general modernization paths.
    """
    if not force_refresh:
        cached = _get_cached("ai_migration", max_age_hours=12)
        if cached:
            return cached

    filtered_resources = _filter_resources_for_category(resources, "migration")
    onprem = _load_onprem_ctx()
    fp = _inventory_fingerprint("migration", filtered_resources, arc_data, onprem)
    cache_key = f"ai_migration:{fp}"
    if not force_refresh:
        cached = _get_cached(cache_key, max_age_hours=12)
        if cached:
            return cached

    resource_ctx = _build_resource_context(filtered_resources, max_resources=80)
    arc_ctx = _build_arc_context(arc_data) if arc_data else "No Arc data."
    _estate_block, _stats, _breakdown = _estate_context_block("migration", filtered_resources, arc_data, onprem)
    arc_ctx = arc_ctx + _estate_block

    system_prompt = """You are a senior Microsoft Azure Migration & Modernization Architect.
You specialize in:
- Data center migrations (on-premises to Azure)
- IaaS to PaaS modernization (VMs to App Service, AKS, Container Apps)
- SQL Server to Azure SQL Database / Azure SQL Managed Instance
- File Server to Azure Files / Azure NetApp Files
- VMware to Azure VMware Solution (AVS)
- Application modernization and re-platforming

You analyze both Azure-native resources (identify modernization paths) AND 
on-premises Arc-managed machines (identify migration candidates).

Reference frameworks: Azure Cloud Adoption Framework Migrate methodology, Azure Migrate tools,
Azure Well-Architected Framework Cost Optimization and Performance Efficiency pillars.
Provide Azure CLI / PowerShell commands for assessment and migration steps.
Reference Azure Migrate, Azure Database Migration Service, and App Service Migration Assistant.

""" + RESOURCE_ATTRIBUTION_INSTRUCTION + """
You must return ONLY valid JSON matching the exact schema requested."""

    user_prompt = f"""Perform a comprehensive migration and modernization analysis of this environment.

## Azure Estate (Cloud Resources):
{resource_ctx}

## On-Premises / Hybrid Infrastructure (Azure Arc):
{arc_ctx}

## Analysis Requirements:
1. MIGRATION: Identify ALL on-premises workloads (via Arc) that can be migrated to Azure
2. MODERNIZATION: Identify Azure IaaS resources that can be modernized to PaaS
3. SQL MIGRATION: Identify SQL Servers (both Arc and Azure VMs) -> Azure SQL DB or Managed Instance
4. STORAGE: Identify file servers -> Azure NetApp Files / Azure Files
5. VMWARE: If VMware/Hyper-V workloads detected, plan migration to Azure VMware Solution
6. For EACH candidate, provide detailed assessment with complexity, effort, benefits, and steps
7. Group by migration wave (Wave 1=Quick Wins, Wave 2=Standard, Wave 3=Complex)
8. Provide SPECIFIC resource names and target services
9. Consider dependencies between resources

Return JSON:
{{
  "migration_readiness_score": <0-100>,
  "executive_summary": "<detailed 4-6 sentence assessment of migration potential>",
  "total_migration_candidates": <int>,
  "total_modernization_candidates": <int>,
  "estimated_annual_savings": <float USD>,
  "migration_categories": [
    {{
      "category": "<Data Center Migration|SQL Modernization|App Modernization|Storage Migration|VMware Migration|Container Migration>",
      "candidate_count": <int>,
      "total_current_cost": <float monthly>,
      "estimated_savings_pct": <float>,
      "complexity_breakdown": {{"low": <int>, "medium": <int>, "high": <int>}},
      "candidates": [
        {{
          "resource_name": "<name>",
          "resource_type": "<current type>",
          "source": "azure|arc|on-premises",
          "current_config": "<current configuration details>",
          "target_service": "<Azure target>",
          "target_sku": "<recommended SKU>",
          "complexity": "Low|Medium|High",
          "migration_approach": "Rehost|Replatform|Refactor|Rebuild",
          "monthly_cost_current": <float>,
          "monthly_cost_target": <float>,
          "savings_pct": <float>,
          "benefits": ["<benefit>", ...],
          "risks": ["<risk>", ...],
          "prerequisites": ["<prereq>", ...],
          "migration_steps": [
            {{
              "phase": "Assess|Prepare|Migrate|Validate|Optimize",
              "title": "<step title>",
              "detail": "<detailed description>",
              "tools": ["<Azure tool/service>", ...],
              "duration": "<e.g., 1-2 days>"
            }}
          ],
          "dependencies": ["<dependent resource>", ...],
          "wave": <1|2|3>
        }}
      ]
    }}
  ],
  "migration_waves": {{
    "wave_1": {{
      "label": "Quick Wins (0-30 days)",
      "candidate_count": <int>,
      "description": "<what gets migrated first>",
      "key_actions": ["<action>", ...]
    }},
    "wave_2": {{
      "label": "Standard (30-90 days)",
      "candidate_count": <int>,
      "description": "<what gets migrated second>",
      "key_actions": ["<action>", ...]
    }},
    "wave_3": {{
      "label": "Complex (90-180 days)",
      "candidate_count": <int>,
      "description": "<complex migrations>",
      "key_actions": ["<action>", ...]
    }}
  }},
  "modernization_paths": [
    {{
      "from": "<current service/pattern>",
      "to": "<target service>",
      "resources_affected": <int>,
      "rationale": "<why this modernization>",
      "business_value": "<expected outcome>"
    }}
  ],
  "tools_and_services": [
    {{
      "tool": "<Azure Migrate|DMA|DMS|ASR|Azure NetApp Files|etc>",
      "purpose": "<what it does in this migration>",
      "applicable_to": ["<resource category>", ...]
    }}
  ],
  "risks_and_mitigations": [
    {{
      "risk": "<migration risk>",
      "impact": "High|Medium|Low",
      "mitigation": "<how to mitigate>"
    }}
  ]
}}"""

    try:
        raw = _call_ai(system_prompt, user_prompt, max_tokens=MAX_TOKENS_MODULE)
        result = _safe_json_parse(raw)
        result = _normalize_migration_response(result)
        # Enrich each migration candidate with full resource_id from input list
        lookup = _build_resource_lookup(resources)
        for cat in result.get("migration_categories", []):
            for cand in cat.get("candidates", []):
                rname = cand.get("resource_name", "").lower()
                r = lookup.get(rname)
                if r:
                    cand.setdefault("resource_id", r.get("resource_id", ""))
                    cand.setdefault("resource_group", r.get("resource_group", ""))
                    cand.setdefault("subscription_id", r.get("subscription_id", ""))
        result["_meta"] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": get_provider_info().get("model", "unknown"),
            "resource_count": len(resources),
            "arc_machines": arc_data.get("total_machines", 0) if arc_data else 0,
            "data_confidence": _compute_data_confidence(filtered_resources, arc_data),
        }
        _attach_estate_meta(result, _stats, _breakdown, filtered_resources, arc_data, onprem)
        _save_cache(cache_key, result["_meta"]["model"], result)
        return result
    except Exception as e:
        logger.error("Migration AI analysis failed: %s", e)
        return {"error": str(e), "available": False}


# ═══════════════════════════════════════════════════════════════════════════════
# 5. BACKUP AI ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_backup_ai(resources: list, arc_data: dict = None, backup_coverage: dict = None, force_refresh: bool = False) -> dict:
    """
    AI-powered backup state analysis with recommendations.
    Considers all Azure Backup supported services.
    """
    if not force_refresh:
        cached = _get_cached("ai_backup", max_age_hours=12)
        if cached:
            return cached

    filtered_resources = _filter_resources_for_category(resources, "backup")
    onprem = _load_onprem_ctx()
    fp = _inventory_fingerprint("backup", filtered_resources, arc_data, onprem)
    cache_key = f"ai_backup:{fp}"
    if not force_refresh:
        cached = _get_cached(cache_key, max_age_hours=12)
        if cached:
            return cached

    resource_ctx = _build_resource_context(filtered_resources, max_resources=150)
    arc_ctx = _build_arc_context(arc_data) if arc_data else "No Arc data."
    _estate_block, _stats, _breakdown = _estate_context_block("backup", filtered_resources, arc_data, onprem)
    arc_ctx = arc_ctx + _estate_block
    backup_ctx = "No backup coverage data available."
    if backup_coverage:
        bc = backup_coverage if isinstance(backup_coverage, dict) else backup_coverage.__dict__
        backup_lines = [
            "## Current Backup State:",
            f"Total Eligible Resources: {bc.get('total_eligible', 0)}",
            f"Total Protected: {bc.get('total_protected', 0)}",
            f"Total Gaps: {bc.get('total_gaps', 0)}",
            f"Coverage: {bc.get('coverage_pct', 0):.0f}%",
            "",
        ]
        categories = bc.get("categories", [])
        if categories:
            backup_lines.append("### Category Breakdown:")
            for cat in categories:
                c = cat if isinstance(cat, dict) else cat.__dict__
                backup_lines.append(
                    f"  - {c.get('category', '?')}: {c.get('protected', 0)}/{c.get('total', 0)} protected "
                    f"({c.get('gap_count', 0)} gaps, severity: {c.get('severity', '?')})"
                )
        
        gaps = bc.get("gaps", [])
        if gaps:
            backup_lines.append(f"\n### Unprotected Resources ({len(gaps)} gaps):")
            for g in gaps[:30]:
                gd = g if isinstance(g, dict) else g.__dict__
                backup_lines.append(
                    f"  - [{gd.get('severity', '?')}] {gd.get('resource_name', '?')} ({gd.get('resource_type', '?')}) "
                    f"| Category: {gd.get('category', '?')} | RG: {gd.get('resource_group', '?')}"
                )
        
        backup_ctx = "\n".join(backup_lines)

    system_prompt = """You are a senior Microsoft Azure Backup & Data Protection Architect.
You are an expert on Azure Backup, Azure Site Recovery, and all data protection services in Azure.

You know ALL services supported by Azure Backup:
- Azure VMs (Windows/Linux)
- SQL Server in Azure VMs (workload-level)
- SAP HANA in Azure VMs
- Azure Files (file shares)
- Azure Blobs (operational + vaulted)
- Azure Disks (snapshot-based)
- Azure Database for PostgreSQL (Flexible Server)
- Azure Database for MySQL (Flexible Server)  
- AKS clusters (with Backup extension)
- Azure Cosmos DB (continuous + periodic)
- Azure SQL Database (built-in PITR + LTR)
- Azure SQL Managed Instance (built-in PITR + LTR)
- Azure Stack HCI VMs

And Azure Backup Vault vs Recovery Services Vault differences.

Reference frameworks: Azure Well-Architected Framework Reliability pillar, Azure Business Continuity Center.
Provide Azure CLI / PowerShell commands for backup configuration and policy enforcement.
Reference Azure Backup compliance: ISO 27001, SOC 2, HIPAA, FedRAMP.
Include Azure Policy definitions for enforcing backup standards.

""" + RESOURCE_ATTRIBUTION_INSTRUCTION + """
You must return ONLY valid JSON matching the exact schema requested."""

    user_prompt = f"""Analyze the backup and data protection state of this Azure environment comprehensively.

## Azure Estate:
{resource_ctx}

## Arc / On-Premises:
{arc_ctx}

## Current Backup Coverage:
{backup_ctx}

## Analysis Requirements:
1. Identify ALL resources that should have backup but don't (check EVERY supported service type)
2. Assess backup configuration quality (retention, redundancy, cross-region, soft-delete)
3. Identify backup misconfigurations and risks
4. Consider Arc machines that need backup coverage
5. Provide specific recommendations for EACH unprotected resource
6. Include Azure Backup cost estimates where possible
7. Assess RPO/RTO implications of current backup state
8. Check for: LRS->GRS upgrade opportunities, missing CRR, soft-delete disabled, short retention

Return JSON:
{{
  "backup_health_score": <0-100>,
  "risk_level": "Critical|High|Medium|Low",
  "executive_summary": "<detailed 4-6 sentence backup assessment>",
  "coverage_analysis": {{
    "total_resources_needing_backup": <int>,
    "currently_protected": <int>,
    "unprotected": <int>,
    "misconfigured": <int>,
    "coverage_pct": <float>
  }},
  "service_coverage": [
    {{
      "service_type": "<Azure VMs|SQL in VM|SAP HANA|Azure Files|Azure Blobs|Azure Disks|PostgreSQL|MySQL|AKS|Cosmos DB|Azure SQL DB|SQL MI|Arc Machines>",
      "total_resources": <int>,
      "protected": <int>,
      "gaps": <int>,
      "backup_solution": "<recommended backup approach>",
      "vault_type": "Recovery Services Vault|Backup Vault|Built-in",
      "findings": [
        {{
          "resource_name": "<name from resource data>",
          "resource_id": "<id field from resource data>",
          "resource_group": "<rg field from resource data>",
          "subscription_id": "<sub field from resource data>",
          "issue": "<what's wrong>",
          "severity": "critical|high|medium|low",
          "recommendation": "<specific fix>",
          "estimated_monthly_cost": <float or null>
        }}
      ]
    }}
  ],
  "configuration_issues": [
    {{
      "category": "Retention|Redundancy|Cross-Region|Soft-Delete|Encryption|Scheduling",
      "severity": "critical|high|medium|low",
      "title": "<issue title>",
      "detail": "<detailed description with resource names>",
      "affected_resources": [
        {{"resource_id": "<id field>", "resource_name": "<name field>", "resource_group": "<rg field>", "subscription_id": "<sub field>", "resource_type": "<type_full field>", "cost_usd": <cost_mtd or 0>}}
      ],
      "remediation": "<how to fix>",
      "impact_if_ignored": "<consequence>"
    }}
  ],
  "recommendations": [
    {{
      "priority": "P1|P2|P3",
      "title": "<recommendation>",
      "description": "<detailed guidance>",
      "resources_affected": <int>,
      "estimated_monthly_cost": <float>,
      "rpo_improvement": "<current RPO -> new RPO>",
      "implementation_steps": ["<step>", ...]
    }}
  ],
  "cost_analysis": {{
    "current_backup_spend_estimate": <float monthly>,
    "additional_spend_for_full_coverage": <float monthly>,
    "potential_data_loss_risk_usd": <float per incident estimate>
  }}
}}"""

    try:
        raw = _call_ai(system_prompt, user_prompt, max_tokens=MAX_TOKENS_MODULE)
        result = _safe_json_parse(raw)
        # Enrich backup findings and config issues with full resource objects
        lookup = _build_resource_lookup(resources)
        for svc in result.get("service_coverage", []):
            for finding in svc.get("findings", []):
                if isinstance(finding, dict) and finding.get("resource_name"):
                    r = lookup.get(finding["resource_name"].lower())
                    if r:
                        finding.setdefault("resource_id", r.get("resource_id", ""))
                        finding.setdefault("resource_group", r.get("resource_group", ""))
                        finding.setdefault("subscription_id", r.get("subscription_id", ""))
                        finding.setdefault("resource_type", r.get("resource_type", ""))
        _enrich_findings(result.get("configuration_issues", []), lookup)
        result["_meta"] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": get_provider_info().get("model", "unknown"),
            "resource_count": len(resources),
            "data_confidence": _compute_data_confidence(filtered_resources, arc_data, {"Backup coverage data": bool(backup_coverage)}),
        }
        _attach_estate_meta(result, _stats, _breakdown, filtered_resources, arc_data, onprem)
        _save_cache(cache_key, result["_meta"]["model"], result)
        return result
    except Exception as e:
        logger.error("Backup AI analysis failed: %s", e)
        return {"error": str(e), "available": False}


# ═══════════════════════════════════════════════════════════════════════════════
# 6. RESILIENCE AI ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_generic_ai(module_key: str, role: str, focus: str, resources: list,
                       arc_data: dict = None, context_data: dict = None,
                       force_refresh: bool = False, scope: str = None) -> dict:
    """Generic AI analysis for governance / identity / advisor style modules.

    Input is SCOPED per category (`_GENERIC_AI_SCOPE`) so each blade only sees data
    relevant to it — no Azure Arc / full-inventory bleed into identity, advisor,
    governance, quota, etc. An optional user-directed `scope` focuses the analysis.
    Returns score / risk_level / categories / recommendations."""
    import json as _json
    context_data = context_data or {}
    scope = (scope or "").strip()
    cfg = _generic_ai_scope(module_key)

    scope_suffix = ""
    if scope:
        import hashlib as _hl
        scope_suffix = ":scope-" + _hl.sha256(scope.encode("utf-8", "ignore")).hexdigest()[:8]

    if not force_refresh and not scope:
        cached = _get_cached(f"ai_{module_key}", max_age_hours=12)
        if cached:
            return cached

    # Scope the resource inventory to ONLY what this category should analyze.
    onprem = _load_onprem_ctx() if cfg.get("estate") else {}
    filtered_resources = _scope_inventory(resources, cfg, module_key)
    use_arc = bool(cfg.get("arc") and arc_data)

    fp = _inventory_fingerprint(module_key, filtered_resources or [], arc_data if use_arc else None, onprem)
    cache_key = f"ai_{module_key}:{fp}{scope_suffix}"
    if not force_refresh:
        cached = _get_cached(cache_key, max_age_hours=12)
        if cached:
            return cached

    # Build ONLY the context blocks relevant to this category.
    if cfg.get("estate") and filtered_resources:
        resource_ctx = _build_resource_context(filtered_resources, max_resources=100)
        _estate_block, _stats, _breakdown = _estate_context_block(
            module_key, filtered_resources, arc_data if use_arc else None, onprem)
    else:
        resource_ctx, _estate_block, _stats, _breakdown = "", "", {}, {}

    arc_ctx = (_build_arc_context(arc_data) + _estate_block) if use_arc else ""

    ctx_lines = [f"## {module_key.replace('_', ' ').title()} signals (the data to analyze):"]
    for k, v in context_data.items():
        try:
            s = _json.dumps(v, default=str)[:2500] if isinstance(v, (list, dict)) else str(v)
        except Exception:
            s = str(v)[:500]
        ctx_lines.append(f"- {k}: {s}")
    ctx = "\n".join(ctx_lines)

    scope_block = ""
    if scope:
        scope_block = ("\n## ANALYSIS FOCUS (user-directed — prioritise this):\n"
                       f"Focus this analysis specifically on: {scope[:500]}\n"
                       "Center the findings, categories and recommendations on this focus. You may briefly flag "
                       "other critical issues, but keep the deep-dive on what the user asked for.\n")

    system_prompt = f"""You are a senior {role}.
You analyze {cfg.get('label', 'the Azure estate')} for {focus}.
Use ONLY the data provided below. Do NOT invent or reference resources, Azure Arc machines, on-premises servers or services that are not present in the input — base every finding on the actual data given.
Provide specific, actionable findings and remediation with Azure CLI / PowerShell and Azure Policy where relevant.

""" + RESOURCE_ATTRIBUTION_INSTRUCTION + """
You must return ONLY valid JSON matching the exact schema requested."""

    estate_section = f"\n## Azure resources in scope ({cfg.get('label', 'this category')}):\n{resource_ctx}\n" if resource_ctx else ""
    arc_section = f"\n## Arc / Hybrid:\n{arc_ctx}\n" if arc_ctx else ""

    user_prompt = f"""Analyze the following for {focus}.
{scope_block}{estate_section}{arc_section}
{ctx}

Return JSON:
{{
  "score": <0-100>,
  "risk_level": "Critical|High|Medium|Low",
  "executive_summary": "<3-5 sentence assessment>",
  "categories": [
    {{"name": "<category>", "score": <0-100>, "assessment": "<text>",
      "findings": [
        {{"severity": "critical|high|medium|low", "title": "<finding>", "detail": "<detail with resource names>",
          "affected_resources": [{{"resource_id": "<id field>", "resource_name": "<name field>", "resource_group": "<rg field>", "subscription_id": "<sub field>", "resource_type": "<type_full field>", "cost_usd": <cost_mtd or 0>}}],
          "remediation": "<fix>", "azure_service": "<service>"}}
      ]}}
  ],
  "top_recommendations": [
    {{"priority": "P1|P2|P3", "title": "<rec>", "description": "<guidance>", "resources_affected": <count>, "estimated_effort": "<timeline>"}}
  ]
}}"""

    try:
        raw = _call_ai(system_prompt, user_prompt, max_tokens=MAX_TOKENS_MODULE)
        result = _safe_json_parse(raw)
        lookup = _build_resource_lookup(resources)
        for cat in result.get("categories", []):
            _enrich_findings(cat.get("findings", []), lookup)
        result["_meta"] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": get_provider_info().get("model", "unknown"),
            "resource_count": len(filtered_resources) if cfg.get("estate") else 0,
            "scoped_to": cfg.get("label"),
            "focus": scope or None,
        }
        _attach_estate_meta(result, _stats, _breakdown, filtered_resources, arc_data if use_arc else None, onprem)
        _save_cache(cache_key, result["_meta"]["model"], result)
        return result
    except Exception as e:
        logger.error("%s AI analysis failed: %s", module_key, e)
        return {"error": str(e), "available": False}


def analyze_monitoring_ai(resources: list, arc_data: dict = None, monitoring_data: dict = None,
                          force_refresh: bool = False) -> dict:
    """
    AI-powered monitoring & observability analysis (Azure Monitor coverage,
    resource health, alerting maturity) across native Azure, Arc, and on-prem.
    """
    monitoring_data = monitoring_data or {}
    if not force_refresh:
        cached = _get_cached("ai_monitoring", max_age_hours=12)
        if cached:
            return cached

    filtered_resources = _filter_resources_for_category(resources, "monitoring")
    onprem = _load_onprem_ctx()
    fp = _inventory_fingerprint("monitoring", filtered_resources, arc_data, onprem)
    cache_key = f"ai_monitoring:{fp}"
    if not force_refresh:
        cached = _get_cached(cache_key, max_age_hours=12)
        if cached:
            return cached

    resource_ctx = _build_resource_context(filtered_resources, max_resources=120)
    arc_ctx = _build_arc_context(arc_data) if arc_data else "No Arc data."
    _estate_block, _stats, _breakdown = _estate_context_block("monitoring", filtered_resources, arc_data, onprem)
    arc_ctx = arc_ctx + _estate_block

    ov = monitoring_data.get("overview", {}) or {}
    uncovered = monitoring_data.get("uncovered_machines", []) or []
    alerts = monitoring_data.get("alerts", []) or []
    mon_lines = [
        "## Azure Monitor Signals (live):",
        f"Machines: {ov.get('total_machines', 0)} (AzureVM {ov.get('azure_vms', 0)}, Arc {ov.get('arc_machines', 0)})",
        f"Monitoring agent coverage: {ov.get('coverage_pct', 0)}% ({ov.get('agent_covered', 0)}/{ov.get('total_machines', 0)}); uncovered {ov.get('uncovered', 0)}",
        f"Resource health rollup: {ov.get('health', {})}; unhealthy {ov.get('unhealthy', 0)}",
        f"Fired alerts: {ov.get('alerts_fired', 0)} (critical {ov.get('alerts_critical', 0)}); by severity {ov.get('alerts', {})}",
        "",
    ]
    if uncovered:
        mon_lines.append("### Machines WITHOUT a monitoring agent (sample):")
        for m in uncovered[:20]:
            mon_lines.append(f"  - {m.get('machine_name', '?')} [{m.get('machine_type', '?')}] rg={m.get('resource_group', '?')} os={m.get('os_type', '?')}")
        mon_lines.append("")
    if alerts:
        mon_lines.append("### Recent fired alerts (sample):")
        for a in alerts[:15]:
            mon_lines.append(f"  - [{a.get('severity_label', a.get('severity', '?'))}] {a.get('name', '?')} on {a.get('target_resource_name', '?')}")
        mon_lines.append("")
    mon_ctx = "\n".join(mon_lines)

    system_prompt = """You are a senior Microsoft Azure Observability and Monitoring architect.
You analyze entire Azure estates (native Azure, Azure Arc-enabled servers, and on-premises machines)
for monitoring coverage, performance health, alerting maturity, and observability gaps.
You are an expert on: Azure Monitor, Azure Monitor Agent (AMA), Log Analytics, Data Collection Rules,
VM Insights, Container Insights, Application Insights, Resource Health, Service Health, metric & log
alerts, action groups, workbooks, and the Azure Well-Architected Operational Excellence pillar.
Provide Azure CLI / PowerShell commands and Azure Policy definitions for enforcing monitoring at scale.

""" + RESOURCE_ATTRIBUTION_INSTRUCTION + """
You must return ONLY valid JSON matching the exact schema requested."""

    user_prompt = f"""Perform a comprehensive monitoring & observability analysis of this Azure environment.

## Azure Estate:
{resource_ctx}

## Arc / Hybrid:
{arc_ctx}

{mon_ctx}

## Analysis Requirements:
1. Assess monitoring AGENT coverage across native VMs, Arc machines, and on-prem (gaps = operational blind spots)
2. Evaluate resource HEALTH and unhealthy/degraded resources
3. Assess ALERTING maturity (are critical resources covered by alerts? noise? missing action groups?)
4. Identify observability gaps: no diagnostics, no Log Analytics, no VM/Container Insights, no App Insights
5. Recommend a target-state observability architecture (AMA + DCRs + workspace design)
6. Prioritize by risk to operations and time-to-detect / time-to-respond

Return JSON:
{{
  "monitoring_score": <0-100>,
  "risk_level": "Critical|High|Medium|Low",
  "executive_summary": "<detailed 3-5 sentence observability assessment>",
  "categories": [
    {{
      "name": "<Agent Coverage|Resource Health|Alerting & Response|Logs & Diagnostics|App & Workload Insights|Hybrid & On-Prem Monitoring>",
      "score": <0-100>,
      "assessment": "<assessment>",
      "findings": [
        {{
          "severity": "critical|high|medium|low",
          "title": "<finding>",
          "detail": "<description with resource/machine names>",
          "affected_resources": [
            {{"resource_id": "<id field>", "resource_name": "<name field>", "resource_group": "<rg field>", "subscription_id": "<sub field>", "resource_type": "<type_full field>", "cost_usd": <cost_mtd or 0>}}
          ],
          "remediation": "<how to fix>",
          "azure_service": "<service to implement>",
          "effort": "Low|Medium|High"
        }}
      ]
    }}
  ],
  "top_recommendations": [
    {{
      "priority": "P1|P2|P3",
      "title": "<recommendation>",
      "description": "<implementation guidance>",
      "resources_affected": <count>,
      "operational_benefit": "<faster detection/response, fewer blind spots>",
      "estimated_effort": "<timeline>"
    }}
  ],
  "coverage_summary": {{
    "agent_coverage_pct": <0-100>,
    "machines_uncovered": <int>,
    "unhealthy_resources": <int>,
    "critical_alerts": <int>
  }}
}}"""

    try:
        raw = _call_ai(system_prompt, user_prompt, max_tokens=MAX_TOKENS_MODULE)
        result = _safe_json_parse(raw)
        lookup = _build_resource_lookup(resources)
        for cat in result.get("categories", []):
            _enrich_findings(cat.get("findings", []), lookup)
        result["_meta"] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": get_provider_info().get("model", "unknown"),
            "resource_count": len(resources),
            "arc_machines": arc_data.get("total_machines", 0) if arc_data else 0,
            "data_confidence": _compute_data_confidence(filtered_resources, arc_data, {"Monitoring signals": bool(monitoring_data)}),
        }
        _attach_estate_meta(result, _stats, _breakdown, filtered_resources, arc_data, onprem)
        _save_cache(cache_key, result["_meta"]["model"], result)
        return result
    except Exception as e:
        logger.error("Monitoring AI analysis failed: %s", e)
        return {"error": str(e), "available": False}


def analyze_resilience_ai(resources: list, arc_data: dict = None, force_refresh: bool = False) -> dict:
    """
    AI-powered resilience and high-availability analysis of entire Azure estate.
    """
    if not force_refresh:
        cached = _get_cached("ai_resilience", max_age_hours=12)
        if cached:
            return cached

    filtered_resources = _filter_resources_for_category(resources, "resilience")
    onprem = _load_onprem_ctx()
    fp = _inventory_fingerprint("resilience", filtered_resources, arc_data, onprem)
    cache_key = f"ai_resilience:{fp}"
    if not force_refresh:
        cached = _get_cached(cache_key, max_age_hours=12)
        if cached:
            return cached

    resource_ctx = _build_resource_context(filtered_resources, max_resources=150)
    arc_ctx = _build_arc_context(arc_data) if arc_data else "No Arc data."
    _estate_block, _stats, _breakdown = _estate_context_block("resilience", filtered_resources, arc_data, onprem)
    arc_ctx = arc_ctx + _estate_block

    system_prompt = """You are a senior Microsoft Azure Reliability Engineer and SRE specialist.
You analyze entire Azure estates for resilience, high-availability, and fault tolerance.
You are an expert on:
- Availability Zones (AZ) and zone-redundant deployments
- Multi-region architectures and failover strategies
- Load balancing (Azure Front Door, Application Gateway, Load Balancer, Traffic Manager)
- Auto-scaling and elastic compute
- Database HA (geo-replication, failover groups, always-on AGs)
- Storage redundancy (LRS, ZRS, GRS, GZRS, RA-GRS)
- Service SLAs and composite SLA calculations
- Chaos engineering and fault injection testing
- Azure Site Recovery and DR orchestration

IMPORTANT: Qatar Central currently has NO Availability Zones. Plan accordingly.

Reference frameworks: Azure Well-Architected Framework Reliability pillar, Azure Reliability Guides per service.
Provide Azure CLI / PowerShell commands for implementing HA configurations.
Reference composite SLA calculation methodology from Microsoft SLA documentation.
Include Azure Policy definitions for enforcing reliability standards.

""" + RESOURCE_ATTRIBUTION_INSTRUCTION + """
You must return ONLY valid JSON matching the exact schema requested."""

    user_prompt = f"""Perform a comprehensive resilience and high-availability analysis of this Azure environment.

## Azure Estate:
{resource_ctx}

## Arc / Hybrid:
{arc_ctx}

## Analysis Requirements:
1. Assess EVERY resource for resilience risks (single points of failure)
2. Evaluate zone redundancy, region redundancy, and failover capabilities
3. Check storage redundancy levels (LRS is risky for production)
4. Identify resources without HA configuration
5. Calculate estimated composite SLAs for critical paths
6. Consider Qatar Central's lack of Availability Zones
7. Assess auto-scaling readiness
8. Identify blast radius of component failures
9. Check for proper load balancing and traffic distribution
10. Provide detailed recommendations with specific Azure services

Return JSON:
{{
  "resilience_score": <0-100>,
  "risk_level": "Critical|High|Medium|Low",
  "executive_summary": "<detailed 4-6 sentence resilience assessment>",
  "single_points_of_failure": [
    {{
      "resource_name": "<name field from resource data>",
      "resource_id": "<id field from resource data>",
      "resource_group": "<rg field from resource data>",
      "subscription_id": "<sub field from resource data>",
      "resource_type": "<type_full field from resource data>",
      "risk": "<what happens if it fails>",
      "blast_radius": "<affected services/users>",
      "severity": "critical|high|medium|low",
      "remediation": "<how to add redundancy>",
      "target_architecture": "<HA pattern to implement>",
      "estimated_downtime_risk_hrs": <float>
    }}
  ],
  "resilience_categories": [
    {{
      "category": "<Compute HA|Database HA|Storage Redundancy|Network Resilience|Application Tier|Region Strategy|Auto-Scaling|Monitoring & Alerting>",
      "score": <0-100>,
      "assessment": "<detailed assessment>",
      "findings": [
        {{
          "severity": "critical|high|medium|low",
          "title": "<finding>",
          "detail": "<detailed description with resources>",
          "affected_resources": [
            {{"resource_id": "<id field>", "resource_name": "<name field>", "resource_group": "<rg field>", "subscription_id": "<sub field>", "resource_type": "<type_full field>", "cost_usd": <cost_mtd or 0>}}
          ],
          "current_state": "<what exists now>",
          "target_state": "<what should exist>",
          "remediation": "<how to fix>",
          "azure_service": "<service to implement>",
          "sla_impact": "<how this affects overall SLA>"
        }}
      ]
    }}
  ],
  "sla_analysis": {{
    "estimated_composite_sla": "<e.g., 99.5%>",
    "weakest_links": ["<resource with lowest SLA>", ...],
    "sla_improvement_opportunities": [
      {{
        "change": "<what to change>",
        "current_sla": "<current>",
        "target_sla": "<after change>",
        "effort": "Low|Medium|High"
      }}
    ]
  }},
  "recommendations": [
    {{
      "priority": "P1|P2|P3",
      "title": "<recommendation>",
      "description": "<detailed implementation guidance>",
      "category": "<category>",
      "resources_affected": <int>,
      "expected_improvement": "<what improves>",
      "azure_services": ["<service>", ...],
      "estimated_effort": "<timeline>",
      "estimated_monthly_cost": <float or null>
    }}
  ],
  "disaster_recovery_readiness": {{
    "dr_score": <0-100>,
    "has_multi_region": <bool>,
    "has_failover_plan": <bool>,
    "rto_assessment": "<estimated RTO based on current config>",
    "rpo_assessment": "<estimated RPO based on current config>",
    "gaps": ["<DR gap>", ...]
  }}
}}"""

    try:
        raw = _call_ai(system_prompt, user_prompt, max_tokens=MAX_TOKENS_MODULE)
        result = _safe_json_parse(raw)
        # Enrich resilience findings and SPOF entries with full resource objects
        lookup = _build_resource_lookup(resources)
        for cat in result.get("resilience_categories", []):
            _enrich_findings(cat.get("findings", []), lookup)
        for spof in result.get("single_points_of_failure", []):
            if isinstance(spof, dict) and spof.get("resource_name"):
                r = lookup.get(spof["resource_name"].lower())
                if r:
                    spof.setdefault("resource_id", r.get("resource_id", ""))
                    spof.setdefault("resource_group", r.get("resource_group", ""))
                    spof.setdefault("subscription_id", r.get("subscription_id", ""))
        result["_meta"] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": get_provider_info().get("model", "unknown"),
            "resource_count": len(resources),
            "data_confidence": _compute_data_confidence(filtered_resources, arc_data),
        }
        _attach_estate_meta(result, _stats, _breakdown, filtered_resources, arc_data, onprem)
        _save_cache(cache_key, result["_meta"]["model"], result)
        return result
    except Exception as e:
        logger.error("Resilience AI analysis failed: %s", e)
        return {"error": str(e), "available": False}


# ═══════════════════════════════════════════════════════════════════════════════
# 7. BCDR AVS (Azure VMware Solution) ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_bcdr_avs(resources: list, arc_data: dict = None, force_refresh: bool = False) -> dict:
    """
    AI-powered Azure VMware Solution DR analysis.
    Focuses on:
    - Finding AVS workloads
    - Cross-zonal DR (AV36p -> AV64 in different AZ within Qatar Central)
    - Cross-regional DR
    - Missing DR warnings for sales opportunities
    """
    if not force_refresh:
        cached = _get_cached("ai_bcdr_avs", max_age_hours=12)
        if cached:
            return cached

    onprem = _load_onprem_ctx()
    fp = _inventory_fingerprint("bcdr_avs", resources, arc_data, onprem)
    cache_key = f"ai_bcdr_avs:{fp}"
    if not force_refresh:
        cached = _get_cached(cache_key, max_age_hours=12)
        if cached:
            return cached

    filtered_resources = resources
    resource_ctx = _build_resource_context(resources, max_resources=150)
    arc_ctx = _build_arc_context(arc_data) if arc_data else "No Arc data."
    _estate_block, _stats, _breakdown = _estate_context_block("bcdr_avs", filtered_resources, arc_data, onprem)
    arc_ctx = arc_ctx + _estate_block

    # Find AVS-related resources
    avs_resources = []
    resource_dicts = [r if isinstance(r, dict) else r.__dict__ for r in resources]
    for r in resource_dicts:
        rtype = r.get("resource_type", "").lower()
        rname = r.get("resource_name", "").lower()
        if "vmware" in rtype or "avs" in rname or "vmware" in rname or "microsoft.avs" in rtype:
            avs_resources.append(r)
    
    avs_ctx = ""
    if avs_resources:
        avs_ctx = f"\n## AVS Resources Found ({len(avs_resources)}):\n"
        for r in avs_resources:
            avs_ctx += f"  - {r.get('resource_name')} | Type: {r.get('resource_type')} | Location: {r.get('location')} | SKU: {r.get('sku')}\n"

    system_prompt = """You are a senior Microsoft Azure VMware Solution (AVS) architect specializing in 
Disaster Recovery planning for AVS private clouds.

You have deep expertise in:
- AVS SKUs: AV36P (current gen), AV64 (high-performance)
- Cross-zonal DR within a region (if AZs available)
- Cross-regional DR between Azure regions
- VMware HCX for workload mobility
- VMware SRM (Site Recovery Manager) for DR automation
- Azure Site Recovery for AVS
- vSAN stretched clusters
- Qatar Central region specifics (customers primarily use AV36P)

KEY CONTEXT FOR QATAR:
- Most customers in Qatar Central have existing AVS private clouds with AV36P SKU in one AZ
- AV64 SKU is deployed in another AZ in Qatar Central
- OPPORTUNITY: Cross-zonal DR from AV36P (AZ1) to AV64 (AZ2) within Qatar Central
- ALTERNATIVE: Cross-regional DR to another region (UAE North, etc.)
- SALES ANGLE: Any AVS private cloud WITHOUT DR configured is a sales opportunity

""" + RESOURCE_ATTRIBUTION_INSTRUCTION + """
You must return ONLY valid JSON matching the exact schema requested."""

    user_prompt = f"""Analyze this Azure environment for AVS DR opportunities and generate a comprehensive assessment.

## Azure Estate:
{resource_ctx}

{avs_ctx}

## Arc / On-Premises (potential VMware migration candidates):
{arc_ctx}

## Analysis Requirements:
1. Identify ALL AVS private clouds and their current DR status
2. Identify on-premises VMware workloads (via Arc) that could migrate to AVS
3. For each AVS workload WITHOUT DR, flag as WARNING/OPPORTUNITY
4. Present TWO DR options for each:
   a) Cross-Zonal DR: AV36P (existing AZ) -> AV64 (different AZ) within Qatar Central
   b) Cross-Regional DR: Qatar Central -> secondary region
5. Provide sizing recommendations and cost estimates
6. Include VMware HCX and SRM setup guidance
7. Highlight the SALES OPPORTUNITY for customers without DR
8. Consider Hyper-V workloads as potential AVS migration candidates too

Return JSON:
{{
  "avs_dr_score": <0-100>,
  "executive_summary": "<detailed assessment of AVS DR posture and opportunities>",
  "avs_workloads": [
    {{
      "name": "<private cloud name>",
      "location": "<region>",
      "sku": "<AV36P|AV64|etc>",
      "availability_zone": "<AZ if known>",
      "node_count": <int or null>,
      "has_dr": <bool>,
      "dr_type": "<cross-zonal|cross-regional|none>",
      "warning": "<[!] No DR configured - data loss risk|[OK] DR active>",
      "estimated_workload_vms": <int estimate>
    }}
  ],
  "dr_opportunities": [
    {{
      "source_workload": "<AVS private cloud or Arc VMware host>",
      "risk_without_dr": "<business risk statement>",
      "option_1_cross_zonal": {{
        "strategy": "Cross-Zonal DR within Qatar Central",
        "source_sku": "AV36P",
        "source_az": "<AZ>",
        "target_sku": "AV64",
        "target_az": "<different AZ>",
        "technology": "VMware SRM + vSAN + HCX",
        "rto": "<target RTO>",
        "rpo": "<target RPO>",
        "benefits": ["<benefit>", ...],
        "estimated_monthly_cost": <float>,
        "implementation_steps": ["<step>", ...],
        "timeline": "<implementation timeline>"
      }},
      "option_2_cross_regional": {{
        "strategy": "Cross-Regional DR",
        "source_region": "Qatar Central",
        "target_region": "<recommended DR region>",
        "target_sku": "<recommended SKU>",
        "technology": "VMware HCX + SRM / Azure Site Recovery",
        "rto": "<target RTO>",
        "rpo": "<target RPO>",
        "benefits": ["<benefit>", ...],
        "estimated_monthly_cost": <float>,
        "implementation_steps": ["<step>", ...],
        "timeline": "<implementation timeline>"
      }},
      "recommendation": "<which option is recommended and why>"
    }}
  ],
  "vmware_migration_candidates": [
    {{
      "source": "<Arc machine or on-premises host>",
      "current_platform": "VMware|Hyper-V|Physical",
      "estimated_vms": <int>,
      "migration_target": "Azure VMware Solution",
      "approach": "HCX migration|Cold migration|Azure Migrate",
      "complexity": "Low|Medium|High",
      "benefits": ["<benefit>", ...]
    }}
  ],
  "sales_opportunities": [
    {{
      "customer_workload": "<workload description>",
      "current_risk": "<what's at risk without DR>",
      "proposed_solution": "<DR solution>",
      "estimated_acr_monthly": <float>,
      "pitch": "<1-2 sentence sales pitch>",
      "urgency": "High|Medium|Low"
    }}
  ],
  "implementation_roadmap": {{
    "phase_1_immediate": ["<action>", ...],
    "phase_2_short_term": ["<action>", ...],
    "phase_3_long_term": ["<action>", ...],
    "total_estimated_investment": <float monthly>
  }}
}}"""

    try:
        raw = _call_ai(system_prompt, user_prompt, max_tokens=MAX_TOKENS_MODULE)
        result = _safe_json_parse(raw)
        result["_meta"] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": get_provider_info().get("model", "unknown"),
            "resource_count": len(resources),
            "avs_resources_found": len(avs_resources),
            "data_confidence": _compute_data_confidence(resources, arc_data),
        }
        _attach_estate_meta(result, _stats, _breakdown, filtered_resources, arc_data, onprem)
        _save_cache(cache_key, result["_meta"]["model"], result)
        return result
    except Exception as e:
        logger.error("BCDR AVS AI analysis failed: %s", e)
        return {"error": str(e), "available": False}


# ═══════════════════════════════════════════════════════════════════════════════
# 8. DEEP BCDR AI ANALYSIS (Enhanced - covers entire estate)
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_bcdr_deep(resources: list, arc_data: dict = None, force_refresh: bool = False) -> dict:
    """
    Deep AI-powered BCDR analysis covering the ENTIRE Azure estate.
    Service-wise, subscription-wise, and provides comprehensive DR strategies.
    This is the premium BCDR analysis with maximum detail.
    """
    if not force_refresh:
        cached = _get_cached("ai_bcdr_deep", max_age_hours=12)
        if cached:
            return cached

    onprem = _load_onprem_ctx()
    fp = _inventory_fingerprint("bcdr_deep", resources, arc_data, onprem)
    cache_key = f"ai_bcdr_deep:{fp}"
    if not force_refresh:
        cached = _get_cached(cache_key, max_age_hours=12)
        if cached:
            return cached

    filtered_resources = resources
    resource_ctx = _build_resource_context(resources, max_resources=150)
    arc_ctx = _build_arc_context(arc_data) if arc_data else "No Arc data."
    _estate_block, _stats, _breakdown = _estate_context_block("bcdr_deep", filtered_resources, arc_data, onprem)
    arc_ctx = arc_ctx + _estate_block

    system_prompt = """You are an elite Microsoft Azure BCDR (Business Continuity & Disaster Recovery) consultant.
You provide the most comprehensive, detailed, and actionable BCDR analysis possible.

Your analysis must cover:
- EVERY Azure service type in the estate with its specific DR capabilities
- Subscription-level DR strategies
- Resource-group-level DR groupings
- Cross-region and cross-zone strategies
- RTO/RPO targets per service tier
- Cost of DR vs cost of downtime
- Compliance requirements (Qatar NIA, PDPPL, etc.)
- Qatar Central specific constraints (no paired region, limited AZs)

This is the PRIMARY solution offering - quality must be outstanding.

Reference frameworks: Azure Well-Architected Framework Reliability pillar, ISO 22301 Business Continuity,
Azure Business Continuity Center, Microsoft Service Trust Portal.
Provide Azure CLI / PowerShell commands for DR configuration.
Reference Azure Site Recovery runbooks, Azure Backup policies, and geo-replication setup.
Include compliance mapping: Qatar NIA, ISO 27001, SOC 2, HIPAA where applicable.

""" + RESOURCE_ATTRIBUTION_INSTRUCTION + """
You must return ONLY valid JSON matching the exact schema requested."""

    user_prompt = f"""Perform the DEEPEST possible BCDR analysis of this entire Azure environment.
Take your time. Be thorough. Cover every service. Provide maximum detail.

## Complete Azure Estate:
{resource_ctx}

## On-Premises / Hybrid (Arc):
{arc_ctx}

## Key Context:
- Qatar Central: No paired region, limited AZ support
- This analysis is the primary deliverable for customer meetings
- Output must be detailed enough to create a BCDR implementation plan
- Consider both technical and business continuity perspectives

## Analysis Requirements:
1. Assess EVERY resource type for BCDR readiness
2. Group findings by: Subscription, Resource Group, Service Type
3. For each service type, explain its native DR capabilities and what's configured vs missing
4. Provide specific RTO/RPO assessments per workload
5. Calculate business impact of outages
6. Create a prioritized implementation plan with phases
7. Include cost-benefit analysis
8. Cover compliance requirements

Return JSON:
{{
  "bcdr_score": <0-100>,
  "risk_level": "Critical|High|Medium|Low",
  "executive_summary": "<detailed 5-8 sentence comprehensive BCDR assessment>",
  "business_impact_assessment": {{
    "total_at_risk_monthly_cost": <float>,
    "estimated_annual_downtime_risk_hours": <float>,
    "financial_impact_per_hour": <float estimate>,
    "critical_workloads_without_dr": <int>,
    "data_loss_risk_resources": <int>
  }},
  "service_wise_analysis": [
    {{
      "service_type": "<e.g., Virtual Machines|Azure SQL|Storage Accounts|App Service|AKS|etc>",
      "resource_count": <int>,
      "monthly_cost": <float>,
      "dr_readiness": "Protected|Partially Protected|Not Protected",
      "native_dr_capabilities": "<what Azure offers for this service>",
      "current_configuration": "<what's actually configured>",
      "gaps": ["<specific gap>", ...],
      "rto_current": "<current estimated RTO>",
      "rpo_current": "<current estimated RPO>",
      "rto_target": "<recommended RTO>",
      "rpo_target": "<recommended RPO>",
      "recommendations": [
        {{
          "action": "<specific action>",
          "priority": "P1|P2|P3",
          "effort": "Low|Medium|High",
          "monthly_cost": <float>,
          "rto_after": "<RTO after implementation>",
          "rpo_after": "<RPO after implementation>"
        }}
      ]
    }}
  ],
  "subscription_analysis": [
    {{
      "subscription_id_suffix": "<last 8 chars>",
      "resource_count": <int>,
      "dr_readiness_pct": <float>,
      "critical_gaps": ["<gap>", ...],
      "recommended_strategy": "<DR strategy for this sub>"
    }}
  ],
  "critical_gaps": [
    {{
      "rank": <1-N>,
      "severity": "critical|high",
      "title": "<gap title>",
      "detail": "<detailed description>",
      "affected_resources": ["<resource>", ...],
      "business_impact": "<what happens if this isn't fixed>",
      "remediation": "<how to fix>",
      "estimated_cost": <float monthly>,
      "timeline": "<implementation time>"
    }}
  ],
  "dr_strategies": {{
    "primary_strategy": "<recommended overall DR strategy>",
    "backup_strategy": "<secondary/backup approach>",
    "failover_regions": ["<region>", ...],
    "technologies": ["<Azure service/tool>", ...]
  }},
  "implementation_roadmap": {{
    "immediate_actions": [
      {{
        "action": "<action>",
        "resources": ["<resource>", ...],
        "cost": <float>,
        "risk_reduction": "High|Medium"
      }}
    ],
    "short_term_30_days": [
      {{
        "action": "<action>",
        "description": "<detail>",
        "cost": <float>
      }}
    ],
    "medium_term_90_days": [
      {{
        "action": "<action>",
        "description": "<detail>",
        "cost": <float>
      }}
    ],
    "long_term_180_days": [
      {{
        "action": "<action>",
        "description": "<detail>",
        "cost": <float>
      }}
    ]
  }},
  "cost_benefit_analysis": {{
    "total_dr_implementation_cost_monthly": <float>,
    "total_risk_without_dr_monthly": <float>,
    "roi_percentage": <float>,
    "payback_period_months": <float>,
    "recommendation": "<invest or accept risk>"
  }},
  "compliance_assessment": {{
    "frameworks": ["<applicable framework>", ...],
    "compliant_areas": ["<area>", ...],
    "non_compliant_areas": ["<area with detail>", ...],
    "remediation_required": ["<what must change for compliance>", ...]
  }}
}}"""

    try:
        raw = _call_ai(system_prompt, user_prompt, max_tokens=16000)
        result = _safe_json_parse(raw)
        # Enrich deep BCDR critical_gaps and service_wise affected_resources
        lookup = _build_resource_lookup(resources)
        for gap in result.get("critical_gaps", []):
            if isinstance(gap, dict) and "affected_resources" in gap:
                gap["affected_resources"] = _resolve_affected_resources(gap["affected_resources"], lookup)
        result["_meta"] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": get_provider_info().get("model", "unknown"),
            "resource_count": len(resources),
            "arc_machines": arc_data.get("total_machines", 0) if arc_data else 0,
            "data_confidence": _compute_data_confidence(resources, arc_data),
        }
        _attach_estate_meta(result, _stats, _breakdown, filtered_resources, arc_data, onprem)
        _save_cache(cache_key, result["_meta"]["model"], result)
        return result
    except Exception as e:
        logger.error("Deep BCDR AI analysis failed: %s", e)
        return {"error": str(e), "available": False}


# ── Helper ────────────────────────────────────────────────────────────────────

def get_provider_info() -> dict:
    """Get AI provider info."""
    from services.ai_infra_service import get_provider_info as _gpi
    return _gpi()


# ═══════════════════════════════════════════════════════════════════════════════
# ON-PREMISES AI ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

def _build_onprem_context(servers: list, summary: dict) -> str:
    """Build context string from on-premises server data for AI prompts."""
    lines = [
        f"ON-PREMISES INVENTORY SUMMARY:",
        f"  Total Servers: {summary.get('total_servers', 0)}",
        f"  Total Cores: {summary.get('total_cores', 0)}",
        f"  Total Memory: {summary.get('total_memory_gb', 0)} GB",
        f"  Total Storage: {summary.get('total_storage_gb', 0)} GB",
        f"  Physical: {summary.get('physical_servers', 0)} | Virtual: {summary.get('virtual_servers', 0)}",
        f"  Migration Candidates: {summary.get('migration_candidates', 0)}",
        f"  SQL Instances: {summary.get('sql_instances_count', 0)}",
        f"  IIS Sites: {summary.get('iis_sites_count', 0)}",
        f"  Security Issues: {summary.get('security_issues', 0)}",
        "",
        "OS BREAKDOWN: " + ", ".join(f"{k}: {v}" for k, v in summary.get("os_breakdown", {}).items()),
        "WORKLOAD TYPES: " + ", ".join(f"{k}: {v}" for k, v in summary.get("workload_breakdown", {}).items()),
        "",
        "SERVER DETAILS:",
    ]

    # Include up to 50 servers in detail
    for srv in servers[:50]:
        sql_info = f", SQL: {len(srv.get('sql_instances', []))} instances" if srv.get("sql_instances") else ""
        iis_info = f", IIS: {len(srv.get('iis_sites', []))} sites" if srv.get("iis_sites") else ""
        sec_issues = []
        if not srv.get("antivirus_product"):
            sec_issues.append("No AV")
        if not srv.get("firewall_enabled"):
            sec_issues.append("FW off")
        if srv.get("pending_updates_count", 0) > 10:
            sec_issues.append(f"{srv['pending_updates_count']} pending updates")
        sec_str = f", SECURITY: {'; '.join(sec_issues)}" if sec_issues else ""

        lines.append(
            f"  - {srv.get('hostname', '?')} | {srv.get('os_name', '?')} | "
            f"{srv.get('total_cores', 0)}c/{srv.get('total_memory_gb', 0)}GB RAM/"
            f"{srv.get('total_storage_gb', 0)}GB disk | "
            f"Type: {srv.get('workload_type', '?')} | Target: {srv.get('migration_target', '?')} | "
            f"Complexity: {srv.get('complexity', '?')}"
            f"{sql_info}{iis_info}{sec_str}"
        )

    if len(servers) > 50:
        lines.append(f"  ... and {len(servers) - 50} more servers")

    return "\n".join(lines)


def analyze_onprem_ai(servers: list, summary: dict, force_refresh: bool = False) -> dict:
    """Comprehensive AI analysis of on-premises infrastructure."""
    cache_key = "ai_onprem_analysis"

    if not force_refresh:
        cached = _get_cached(cache_key)
        if cached:
            return cached

    context = _build_onprem_context(servers, summary)

    prompt = f"""You are an Azure solutions architect specializing in hybrid cloud and migration planning.
Analyze this on-premises server inventory and provide a comprehensive assessment.

{context}

Respond with a JSON object containing:
{{
    "executive_summary": "2-3 paragraph overview of the on-premises estate",
    "overall_readiness_score": 0-100,
    "overall_grade": "A/B/C/D/F",

    "migration_assessment": {{
        "total_candidates": <int>,
        "by_target": {{
            "Azure VM": <count>,
            "Azure SQL MI": <count>,
            "App Service": <count>,
            "Azure Files": <count>,
            "Other": <count>
        }},
        "by_complexity": {{
            "Low": <count>,
            "Medium": <count>,
            "High": <count>
        }},
        "migration_waves": [
            {{
                "wave": 1,
                "name": "Quick Wins",
                "description": "...",
                "server_count": <int>,
                "criteria": "...",
                "estimated_duration_weeks": <int>
            }}
        ],
        "blockers": ["list of migration blockers identified"],
        "prerequisites": ["list of prerequisites before migration"]
    }},

    "security_posture": {{
        "risk_level": "Low/Medium/High/Critical",
        "findings": [
            {{
                "severity": "Critical/High/Medium/Low",
                "title": "...",
                "description": "...",
                "affected_servers": <count>,
                "remediation": "..."
            }}
        ]
    }},

    "modernization_opportunities": [
        {{
            "title": "...",
            "description": "...",
            "affected_servers": <count>,
            "target_service": "Azure service name",
            "estimated_savings_pct": <0-100>,
            "effort": "Low/Medium/High",
            "priority": "P1/P2/P3"
        }}
    ],

    "bcdr_assessment": {{
        "current_state": "summary of current backup/DR posture",
        "gaps": ["list of BCDR gaps"],
        "recommendations": [
            {{
                "title": "...",
                "description": "...",
                "priority": "P1/P2/P3",
                "azure_service": "..."
            }}
        ]
    }},

    "cost_estimation": {{
        "methodology": "brief description",
        "estimated_monthly_azure": "range estimate",
        "optimization_tips": ["list of cost optimization suggestions"]
    }},

    "top_recommendations": [
        {{
            "priority": 1,
            "title": "...",
            "description": "...",
            "impact": "High/Medium/Low",
            "effort": "Low/Medium/High"
        }}
    ]
}}

Be specific, actionable, and reference actual server data where possible."""

    system_prompt = "You are an expert Azure migration and hybrid cloud architect. Return valid JSON only."

    try:
        raw = _call_ai(
            system_prompt,
            prompt,
            max_tokens=MAX_TOKENS_MODULE,
        )
        if not raw:
            return {"error": "AI service unavailable", "available": False}

        result = _safe_json_parse(raw)
        result["_meta"] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": get_provider_info().get("model", "unknown"),
            "server_count": len(servers),
        }
        _save_cache(cache_key, result["_meta"]["model"], result)
        return result
    except Exception as e:
        logger.error("On-prem AI analysis failed: %s", e)
        return {"error": str(e), "available": False}
