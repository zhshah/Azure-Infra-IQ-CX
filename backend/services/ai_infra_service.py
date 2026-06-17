"""
Azure Infrastructure Intelligence Service — Claude-Powered Agentic Analysis

This service replaces hard-coded rules with Claude-driven reasoning for:
  1. Holistic workload analysis   — full inventory assessment
  2. BCDR intelligence            — AI-generated DR strategies per workload
  3. Dependency impact analysis   — understand blast radius & coupling
  4. Optimization prioritization  — ranked action plan across all resources
  5. Resource deep-dive           — per-resource AI assessment

Architecture
------------
• Uses Claude Sonnet 4.5 via Anthropic SDK (direct key or Azure AI Foundry)
• Results are cached in SQLite ai_analyses table (24h TTL by default)
• Streaming mode supported for long analyses
• All prompts inject full resource context: config, costs, metrics, BCDR, deps

Provider selection (checked in order):
  1. ANTHROPIC_API_KEY env var  → direct Anthropic API
  2. AZURE_AI_ENDPOINT + AZURE_AI_KEY env vars  → Azure AI Foundry
  3. Falls back to existing ai_service provider (AZURE_OPENAI)
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Dict, Generator, List, Optional

logger = logging.getLogger(__name__)

# ── Model config ──────────────────────────────────────────────────────────────

CLAUDE_MODEL_PRIMARY   = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-5-20250514")
CLAUDE_MODEL_FAST      = os.getenv("CLAUDE_MODEL_FAST", "claude-haiku-4-5-20251001")
MAX_TOKENS_ANALYSIS    = 8192
MAX_TOKENS_NETWORKING  = 16000
MAX_TOKENS_SUMMARY     = 4096
MAX_RESOURCES_FULL_CTX = 150   # send full detail for up to N resources; summarize above this


# ── Client factory ────────────────────────────────────────────────────────────

def _get_ai_client_for_analysis():
    """
    Get AI client for comprehensive analysis.
    Returns (client, model_name, provider_type).
    
    Respects the user's ai_provider setting from settings_service.
    Falls back to priority: Anthropic > Azure OpenAI if no explicit setting.
    """
    import services.settings_service as _settings_svc
    
    # Check user's explicit provider choice
    configured_provider = _settings_svc.get_value("ai_provider", "")
    
    # If user explicitly chose azure_openai, skip Anthropic entirely
    if configured_provider != "azure_openai":
        # Try Anthropic
        try:
            import anthropic
            api_key = os.getenv("ANTHROPIC_API_KEY", "") or _settings_svc.get_value("ANTHROPIC_API_KEY", "")
            az_endpoint = os.getenv("AZURE_AI_ENDPOINT", "") or _settings_svc.get_value("AZURE_AI_ENDPOINT", "")
            az_key = os.getenv("AZURE_AI_KEY", "") or _settings_svc.get_value("AZURE_AI_KEY", "")

            if api_key and api_key != "your_anthropic_api_key_here":
                return anthropic.Anthropic(api_key=api_key), CLAUDE_MODEL_PRIMARY, "anthropic"

            if az_endpoint and az_key:
                client = anthropic.Anthropic(
                    base_url=az_endpoint.rstrip("/"),
                    api_key=az_key,
                    default_headers={"api-key": az_key},
                )
                return client, os.getenv("AZURE_AI_DEPLOYMENT", CLAUDE_MODEL_PRIMARY), "anthropic"
        except Exception as e:
            logger.debug("Anthropic not available: %s", e)
    
    # Fallback to Azure OpenAI
    try:
        from openai import AzureOpenAI
        import services.settings_service as _settings_svc
        endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "") or _settings_svc.get_value("AZURE_OPENAI_ENDPOINT", "")
        key = os.getenv("AZURE_OPENAI_KEY", "") or _settings_svc.get_value("AZURE_OPENAI_KEY", "")
        deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT", "") or _settings_svc.get_value("AZURE_OPENAI_DEPLOYMENT", "gpt-4o")
        
        if endpoint and key:
            client = AzureOpenAI(
                azure_endpoint=endpoint,
                api_key=key,
                api_version="2024-08-01-preview"
            )
            return client, deployment, "azure_openai"
    except Exception as e:
        logger.debug("Azure OpenAI not available: %s", e)
    
    return None, None, None


def _get_anthropic_client():
    """Return an Anthropic client using direct API key or Azure AI Foundry.
    Returns (None, None) if user explicitly chose azure_openai provider."""
    import services.settings_service as _settings_svc
    
    # Respect user's explicit provider choice
    configured_provider = _settings_svc.get_value("ai_provider", "")
    if configured_provider == "azure_openai":
        return None, None
    
    import anthropic
    api_key   = os.getenv("ANTHROPIC_API_KEY", "") or _settings_svc.get_value("ANTHROPIC_API_KEY", "")
    az_endpoint = os.getenv("AZURE_AI_ENDPOINT", "") or _settings_svc.get_value("AZURE_AI_ENDPOINT", "")
    az_key    = os.getenv("AZURE_AI_KEY", "") or _settings_svc.get_value("AZURE_AI_KEY", "")

    if api_key and api_key != "your_anthropic_api_key_here":
        return anthropic.Anthropic(api_key=api_key), CLAUDE_MODEL_PRIMARY

    if az_endpoint and az_key:
        # Azure AI Foundry — Claude deployed via Azure
        client = anthropic.Anthropic(
            base_url=az_endpoint.rstrip("/"),
            api_key=az_key,
            default_headers={"api-key": az_key},
        )
        return client, os.getenv("AZURE_AI_DEPLOYMENT", CLAUDE_MODEL_PRIMARY)

    return None, None


def is_available() -> bool:
    client, _, _ = _get_ai_client_for_analysis()
    return client is not None


def get_provider_info() -> dict:
    """Return provider type and model name."""
    client, model, provider = _get_ai_client_for_analysis()
    return {
        "available": client is not None,
        "model": model or "unavailable",
        "provider": provider or "none",
    }


def get_model_name() -> str:
    _, model, _ = _get_ai_client_for_analysis()
    return model or "unavailable"


def _call_ai(system_prompt: str, user_prompt: str, max_tokens: int = MAX_TOKENS_ANALYSIS) -> str:
    """
    Unified AI call that works with both Anthropic and Azure OpenAI.
    Returns the raw text response.
    Raises Exception on failure or if no provider configured.
    Retries up to 3 times with exponential backoff on 429 / rate-limit errors.
    """
    import time as _time
    client, model, provider = _get_ai_client_for_analysis()
    if not client:
        raise RuntimeError("No AI provider configured. Set AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_KEY or ANTHROPIC_API_KEY.")

    _MAX_RETRIES = 3
    _BACKOFF_BASE = 15  # seconds: 15, 30, 60

    def _is_rate_limit(exc) -> bool:
        msg = str(exc).lower()
        return "429" in msg or "too many requests" in msg or "rate limit" in msg or "rate_limit" in msg

    def _retry_after(exc) -> float:
        """Parse Retry-After header value from exception if present."""
        try:
            headers = getattr(exc, "response", None) and getattr(exc.response, "headers", {})
            if headers:
                val = headers.get("retry-after") or headers.get("Retry-After")
                if val:
                    return float(val)
        except Exception:
            pass
        return 0.0

    for attempt in range(_MAX_RETRIES + 1):
        t0 = _time.time()
        try:
            if provider == "anthropic":
                response = client.messages.create(
                    model=model,
                    max_tokens=max_tokens,
                    system=system_prompt,
                    messages=[{"role": "user", "content": user_prompt}],
                )
                text = response.content[0].text.strip()
                elapsed = _time.time() - t0
                usage = getattr(response, "usage", None)
                logger.info(
                    "AI call completed | provider=%s model=%s latency=%.1fs prompt_tokens=%s completion_tokens=%s",
                    provider, model, elapsed,
                    getattr(usage, "input_tokens", "?"),
                    getattr(usage, "output_tokens", "?"),
                )
                return text
            else:  # azure_openai
                response = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    max_completion_tokens=max_tokens,
                    temperature=0.3,
                    response_format={"type": "json_object"},
                )
                text = response.choices[0].message.content.strip()
                elapsed = _time.time() - t0
                usage = getattr(response, "usage", None)
                logger.info(
                    "AI call completed | provider=%s model=%s latency=%.1fs prompt_tokens=%s completion_tokens=%s total_tokens=%s",
                    provider, model, elapsed,
                    getattr(usage, "prompt_tokens", "?"),
                    getattr(usage, "completion_tokens", "?"),
                    getattr(usage, "total_tokens", "?"),
                )
                return text
        except Exception as exc:
            if _is_rate_limit(exc) and attempt < _MAX_RETRIES:
                wait = _retry_after(exc) or (_BACKOFF_BASE * (2 ** attempt))
                logger.warning(
                    "AI rate-limited (429) on attempt %d/%d — waiting %.0fs before retry | provider=%s",
                    attempt + 1, _MAX_RETRIES, wait, provider,
                )
                _time.sleep(wait)
                continue
            raise


# ── Custom tag enrichment ─────────────────────────────────────────────────────

def _enrich_with_custom_tags(compressed: List[dict]) -> List[dict]:
    """
    Merge user-defined custom tags (from SQLite) into compressed resource dicts.
    Adds a 'custom_tags' field to each resource that has custom tags.
    Returns the same list (mutated in-place for efficiency).
    """
    import services.tagging_service as tag_svc
    all_tags = tag_svc.get_all_custom_tags()
    if not all_tags:
        return compressed
    # Build lowercase lookup for case-insensitive matching
    tags_lower = {k.lower(): v for k, v in all_tags.items()}
    matched = 0
    for r in compressed:
        full_id = r.get("_full_id", "").lower()
        rid = r.get("id", "").lower()
        # 1. Try exact match on full ID (preferred — no ambiguity)
        if full_id and full_id in tags_lower:
            r["custom_tags"] = tags_lower[full_id]
            matched += 1
            continue
        # 2. Try matching by resource name (unambiguous within same type+rg)
        rname = r.get("name", "").lower()
        for fid, tags in tags_lower.items():
            if rname and fid.endswith("/" + rname):
                r["custom_tags"] = tags
                matched += 1
                break
    if all_tags:
        logger.debug("Custom tag enrichment: %d/%d resources matched (%d tags in DB)",
                     matched, len(compressed), len(all_tags))
    return compressed


def _build_tag_summary(compressed: List[dict]) -> str:
    """
    Build a tag context summary for AI prompt preambles.
    Shows criticality distribution and tag coverage statistics.
    """
    criticality_counts: Dict[str, int] = {}
    dr_tier_counts: Dict[str, int] = {}
    environment_counts: Dict[str, int] = {}
    tagged_count = 0
    total = len(compressed)

    for r in compressed:
        ct = r.get("custom_tags", {})
        if ct:
            tagged_count += 1
        crit = ct.get("Criticality", "")
        if crit:
            criticality_counts[crit] = criticality_counts.get(crit, 0) + 1
        dr = ct.get("DR_Tier", "")
        if dr:
            dr_tier_counts[dr] = dr_tier_counts.get(dr, 0) + 1
        env = ct.get("Environment", "") or r.get("tags", {}).get("Environment", "") or r.get("tags", {}).get("environment", "")
        if env:
            environment_counts[env] = environment_counts.get(env, 0) + 1

    lines = ["CUSTOM TAG CONTEXT (user-defined business metadata):"]
    if not tagged_count:
        lines.append(f"- No custom tags applied yet ({total} resources untagged — treat all as Standard criticality)")
        return "\n".join(lines)

    lines.append(f"- Tagged resources: {tagged_count}/{total} ({100*tagged_count//total}% coverage)")
    if criticality_counts:
        lines.append(f"- Criticality distribution: {json.dumps(criticality_counts)}")
        untagged_crit = total - sum(criticality_counts.values())
        if untagged_crit > 0:
            lines.append(f"- Resources WITHOUT criticality tag: {untagged_crit} (recommend tagging for accurate prioritization)")
    if dr_tier_counts:
        lines.append(f"- DR_Tier distribution: {json.dumps(dr_tier_counts)}")
    if environment_counts:
        lines.append(f"- Environment distribution: {json.dumps(environment_counts)}")
    lines.append("")
    lines.append("HOW TO USE THESE TAGS (stay within the CURRENT assessment domain):")
    lines.append("- Use custom_tags only to PRIORITISE within this analysis — rank higher-Criticality resources first.")
    lines.append("- Mission Critical / Business Critical → highest priority; Standard → normal; Non-Critical / Dev-Test → lowest.")
    lines.append("- RPO / RTO / DR_Tier are recovery targets — use them ONLY when the current category is BCDR, backup, or resilience. Do NOT raise backup / DR / RPO / RTO points in a security, network, cost, identity, or other non-recovery analysis.")
    return "\n".join(lines)


def _serialize_for_ai(compressed: List[dict], indent: int = 2) -> str:
    """Serialize compressed resources to JSON, stripping internal-only keys."""
    cleaned = [{k: v for k, v in r.items() if not k.startswith("_")} for r in compressed]
    return json.dumps(cleaned, indent=indent)


# ── Resource context builders ─────────────────────────────────────────────────

def _compress_resource(r: dict) -> dict:
    """Build a compact but rich resource context dict for AI prompts."""
    ctx = {
        "_full_id":    r.get("resource_id", ""),        # kept for tag matching, stripped before AI
        "id":          r.get("resource_id", "")[-40:],   # trim long ARM IDs
        "name":        r.get("resource_name", ""),
        "type":        r.get("resource_type", "").split("/")[-1],
        "type_full":   r.get("resource_type", ""),
        "rg":          r.get("resource_group", ""),
        "location":    r.get("location", ""),
        "sub":         r.get("subscription_id", "")[-8:],
        "sku":         r.get("sku"),
        "cost_mtd":    round(r.get("cost_current_month", 0), 2),
        "cost_prev":   round(r.get("cost_previous_month", 0), 2),
        "score":       round(r.get("final_score", 50), 1),
        "score_label": r.get("score_label", "Unknown"),
        "cpu_pct":     r.get("avg_cpu_pct"),
        "mem_pct":     r.get("avg_memory_pct"),
        "util_pct":    r.get("primary_utilization_pct"),
        "peak_util":   r.get("peak_utilization_pct"),
        "trend":       r.get("trend", "stable"),
        "workload_pattern": r.get("workload_pattern"),
        "days_idle":   r.get("days_idle"),
        "days_since_active": r.get("days_since_active"),
        "tags":        r.get("tags", {}),
        "is_orphan":   r.get("is_orphan", False),
        "orphan_reason": r.get("orphan_reason"),
        "has_backup":  r.get("has_backup", False),
        "has_lock":    r.get("has_lock", False),
        "has_private_endpoint": r.get("has_private_endpoint", False),
        "power_state": r.get("power_state"),
        "category":    r.get("resource_category", "other"),
        "zone_status": r.get("zone_status"),         # from BCDR assessment
        "data_confidence": r.get("data_confidence"),
        "ri_covered":  r.get("ri_covered", False),
        "recently_deployed": r.get("recently_deployed", False),
        "auto_shutdown": r.get("auto_shutdown", False),
        "estimated_monthly_savings": r.get("estimated_monthly_savings"),
        "advisor_recs": [
            {"impact": a.get("impact"), "description": a.get("short_description")}
            for a in r.get("advisor_recommendations", [])[:3]
        ],
        # Universal signals — included only when they carry meaning (falsy → dropped below)
        "is_infrastructure": r.get("is_infrastructure") or None,
        "telemetry_source":  r.get("telemetry_source"),   # how much real telemetry backs this resource
        "idle_confirmed":    r.get("idle_confirmed") or None,
        "last_active_date":  r.get("last_active_date"),
        "missing_tags":      (r.get("missing_tags") or None),
        "rbac_assignments":  (r.get("rbac_assignment_count") or None),
    }

    # Attach ONLY the type-specific configuration cluster relevant to THIS resource's type, so the
    # model grounds on real config for the type and never sees irrelevant flags that could be
    # mistaken for gaps (e.g. health_check / backup on a control-plane resource like an action group).
    rtype = (r.get("resource_type") or "").lower()
    if r.get("app_kind") or "/sites" in rtype or "serverfarms" in rtype:
        ctx.update({
            "app_kind":             r.get("app_kind"),
            "runtime_stack":        r.get("runtime_stack"),
            "health_check_enabled": r.get("health_check_enabled"),
            "ssl_expiry":           r.get("ssl_expiry_date"),
            "slot_count":           r.get("slot_count") or None,
            "custom_domains":       r.get("custom_domain_count") or None,
        })
    if "storageaccounts" in rtype or r.get("resource_category") == "storage":
        ctx.update({
            "storage_lifecycle_policy":     r.get("storage_has_lifecycle_policy"),
            "storage_last_access_tracking": r.get("storage_last_access_tracking"),
        })
    if "databases" in rtype or "sql" in rtype or "cosmos" in rtype or r.get("resource_category") == "data":
        ctx["is_sql_replica"] = r.get("is_sql_replica")
    if "cognitiveservices" in rtype or "openai" in rtype or r.get("resource_category") == "ai":
        ctx.update({
            "billing_type":  r.get("billing_type"),
            "total_tokens":  r.get("total_tokens"),
            "blocked_calls": r.get("blocked_calls") or None,
        })

    # Remove None values to keep context compact (keep _full_id for tag matching)
    return {k: v for k, v in ctx.items() if v is not None}


def _build_workload_summary(resources: List[dict]) -> dict:
    """Build aggregate statistics for the prompt preamble."""
    total          = len(resources)
    by_type:  dict = {}
    by_loc:   dict = {}
    total_cost     = 0.0
    waste_count    = 0
    no_backup      = 0
    no_metrics     = 0
    qatar_count    = 0

    for r in resources:
        t = r.get("resource_type", "").split("/")[-1]
        by_type[t]  = by_type.get(t, 0) + 1
        loc = r.get("location", "unknown")
        by_loc[loc] = by_loc.get(loc, 0) + 1
        total_cost  += r.get("cost_current_month", 0)
        if r.get("final_score", 100) < 40:
            waste_count += 1
        if not r.get("has_backup"):
            no_backup += 1
        if r.get("primary_utilization_pct") is None:
            no_metrics += 1
        if "qatar" in loc.lower():
            qatar_count += 1

    top_types = sorted(by_type.items(), key=lambda x: -x[1])[:10]
    return {
        "total_resources":  total,
        "total_monthly_cost": round(total_cost, 2),
        "waste_candidates": waste_count,
        "pct_no_backup":    round(no_backup / max(total, 1) * 100, 1),
        "pct_no_metrics":   round(no_metrics / max(total, 1) * 100, 1),
        "qatar_central_resources": qatar_count,
        "top_resource_types": dict(top_types),
        "locations": by_loc,
    }


# ── System prompts ────────────────────────────────────────────────────────────

_SYS_WORKLOAD = """You are an expert Microsoft Azure cloud architect and FinOps consultant,
working as an advisor for a Microsoft Qatar Solution Engineer.

You receive a complete Azure infrastructure inventory with cost, utilization,
advisor recommendations, and BCDR zone-redundancy data.

Your role is to provide:
1. An executive-level assessment of the workload's health, risk, and optimization potential
2. Specific, actionable recommendations ranked by business impact and effort
3. BCDR readiness gaps with Qatar Central specific constraints (no zone redundancy,
   no paired region — DR to UAE North, West Europe, or North Europe)
4. Cost optimization opportunities with effort/impact matrix

CRITICAL CONSTRAINTS for Qatar Central:
- Zone Redundancy is NOT available in Qatar Central (capacity restricted)
- Qatar Central has NO Azure paired region
- GRS storage is NOT available in Qatar Central — use Object Replication instead
- AKS Backup is NOT available in Qatar Central — use Velero
- Recovery Services Vault in Qatar Central requires Microsoft Engineering engagement
- DR targets: UAE North (primary), West Europe or North Europe (both NIA-certified)

Output strict JSON only — no prose, no markdown. Match the schema exactly.

CUSTOM TAG AWARENESS:
When resources include a "custom_tags" field, use these business metadata tags to:
- Prioritize recommendations by Criticality (Mission Critical > Business Critical > Standard > Non-Critical > Dev-Test)
- Validate BCDR posture against user-defined RPO/RTO/DR_Tier targets
- Weight security and availability recommendations higher for critical resources
- Flag mismatches between resource criticality and its current protection level
- Group findings by Environment and Application tags when available"""

_SYS_BCDR = """You are a Microsoft Azure BCDR and resiliency architect specializing in
Gulf region constraints (Qatar Central, UAE North).

You receive Azure resource details and must produce a 19-column SA-level BCDR analysis
covering: criticality, zone redundancy context, BCDR strategy, DR region choice,
DR method, RPO/RTO targets, implementation effort, cost impact, priority,
quick-win status, compliance notes, dependencies, and current gaps.

=== QATAR CENTRAL CONSTRAINTS (MANDATORY) ===
- No zone redundancy available (capacity blocked by Microsoft)
- No paired region — manual cross-region DR required
- GRS/GZRS/RA-GRS NOT available → use Object Replication for block blobs, AzCopy/ADF for Files
- AKS Native Backup NOT available → use Velero with Azure Blob backend in DR region
- Key Vault does NOT sync across non-paired regions → custom Azure Function sync required
- Primary DR regions: West Europe or North Europe (both NIA-certified: Certificate ID 10018)
- NIA/NCSA Certification covers: Qatar Central (Doha), West Europe (Amsterdam), North Europe (Dublin)
- All BCDR strategies must be achievable without relying on platform-native ZR features

=== AZURE BACKUP — REGION OF CHOICE (RoC) — PREVIEW ===
Qatar Central has no paired region, so standard Cross-Region Restore (CRR) is unavailable.
Microsoft Engineering introduced "Region of Choice" (RoC) to back up to an alternate region:
- RoC procedure: Stop-and-retain backup in source vault → Create new Recovery Services Vault
  in target region → Re-enable protection from scratch in RoC vault
- Target vault regions ONLY: Sweden Central (SDC) or Switzerland North (SZN)
- Supported workloads: IaaS VM (General Purpose), SQL in VM, SAP HANA in VM, Azure Files,
  Blob, ADLS, AKS (max 100 nodes/1TB disks), PostgreSQL Flexible Server (max 1TB)
- NOT supported: ADE (Azure Disk Encryption) VMs
- CVM + CMK backed by AKV: must migrate to mHSM for cross-region restore
- Multi-protection NOT supported (cannot back up to both source and RoC vault)
- IMPORTANT: Sweden Central and Switzerland North are NOT covered by NIA/NCSA certificate.
  If NIA-only regions required, backup vaults must be in West Europe or North Europe.
- Customers can use local snapshot tier for fast recovery (data in customer tenant)
- Vaulted restores from RoC region add latency (copy from Microsoft tenant to customer tenant)

=== PER-SERVICE DR STRATEGIES (from Microsoft Qatar BCDR Plan) ===
- ACR: Premium SKU → manually add replica to DR region (single endpoint, both regions)
- ASR: Recovery Services Vault in DR region + pre-created VNets; manually select target
- AKS: No native backup in QC → IaC-based DR + Velero + geo-replicated ACR + Azure Front Door
- Key Vault: Custom sync mechanism (Azure Function/Logic App) to secondary vault
- ACI: Redeployment strategy via IaC (Bicep/Terraform) — ephemeral workload
- Virtual WAN: Standard tier → secondary hub in DR region (global mesh)
- Entra Domain Services: Replica Sets (up to 5 regions)
- Automation: Link both regional accounts to same Git/Azure DevOps repo
- Sentinel: Dual-ingestion to both Qatar and DR workspace
- Storage: Object Replication (block blobs) + AzCopy/ADF (Files) to DR region
- ANF: Cross-Region Replication (CRR) — manually break peering for DR activation
- VPN/ER: Secondary gateway in DR region with BGP for automatic failover
- SQL DB: Auto-Failover Groups with listener endpoint; geo-restore as fallback
- SQL MI: Instance Failover Groups; minimum 9hr provisioning time
- MySQL Flexible: Geo-redundant backup + cross-region read replicas
- PostgreSQL Flexible: Geo-redundant backup + cross-region read replicas
- Cosmos DB: Multi-region replication with automatic failover
- Synapse: Geo-restore from daily backups + optional paused standby pool
- Fabric: DR at capacity level; OneLake replication; manual workspace artifact redeploy
- Databricks: Active-passive workspace + Git sync; data on geo-redundant ADLS
- ADF: Git integration + CI/CD; Azure provides automatic failover
- ADX: Active-active or active-passive clusters + Continuous Export to GRS storage
- Cognitive Search: Secondary service + synchronized indexes; Traffic Manager failover

=== QATAR COMPLIANCE ===
- Qatar PDPPL governs cross-border data transfer for all Qatar organizations
- Cross-border replication requires DPO review and approval
- Customer must conduct data classification workshop before any cross-region data movement
- West Europe and North Europe officially approved for Qatar government and regulated sectors

CUSTOM TAG AWARENESS:
When resources include "custom_tags", use them to:
- Set sa_criticality from Criticality tag (Mission Critical→Critical, Business Critical→High, Standard→Medium, Non-Critical/Dev-Test→Low)
- Validate sa_rpo/sa_rto against user-defined RPO/RTO tag values — flag gaps
- Use DR_Tier tag to determine appropriate sa_bcdr_strategy depth
- Resources tagged Environment=Production require stricter DR than Dev-Test
- Flag resources with high Criticality but no backup/DR as P1 gaps

Output strict JSON array, no prose, no markdown."""

_SYS_DEPENDENCY = """You are an Azure cloud architect specializing in dependency analysis
and blast-radius assessment for enterprise workloads.

Given a resource and its dependency context (upstream/downstream), you analyze:
1. What services depend on this resource (would break if it goes down)
2. What this resource depends on (its own single-points-of-failure)
3. Blast radius — estimated number of affected users/services if this resource fails
4. SPOF classification and remediation options
5. Recommended resilience improvements

Be specific, cite exact resource names and dependency paths.
Output strict JSON only."""

_SYS_OPTIMIZATION = """You are a senior Azure FinOps architect producing a prioritized
optimization roadmap.

For each resource, provide: action, priority, effort (1-5), impact (cost $), 
explanation, and specific implementation steps.

Prioritize by: impact × confidence / effort.
Group quick wins (low effort, high impact) separately.

CUSTOM TAG AWARENESS:
When resources have "custom_tags", use them to:
- Never recommend deletion/downsizing for Mission Critical resources without strong justification
- Prioritize cost optimization for Dev-Test and Non-Critical resources
- Use Environment tag to suggest Reserved Instances only for Production workloads
- Flag over-provisioned resources that are tagged as Non-Critical as easy wins

Output strict JSON — array of recommendations sorted by priority score descending."""

_SYS_RESOURCE_DEEPDIVE = """You are an expert Microsoft Azure cloud architect performing a
deep-dive analysis of a single Azure resource.

Your analysis must be:
1. Specific — cite actual metric values, costs, and resource properties
2. Actionable — include Azure CLI commands, PowerShell snippets, or portal steps
3. Contextual — consider the resource's dependencies, region constraints, and workload pattern
4. Honest — if data is missing or insufficient, say so and recommend how to get it

For Qatar Central resources, apply these constraints:
- No zone redundancy available
- No paired region — manual DR to UAE North, West Europe, or North Europe
- GRS/GZRS not available for storage

CUSTOM TAG AWARENESS:
If the resource has "custom_tags", use them to contextualize your analysis:
- Match recommendations to the resource's Criticality level
- Validate current state against RPO/RTO/DR_Tier targets if tagged
- Suggest missing custom tags (Criticality, Environment, Application) if not present

Output strict JSON only — no prose, no markdown."""


# ── Analysis functions ────────────────────────────────────────────────────────

def analyze_workload(
    resources: List[dict],
    dep_summary: Optional[dict] = None,
    bcdr_summary: Optional[dict] = None,
    custom_tags: Optional[dict] = None,
    force_refresh: bool = False,
) -> dict:
    """
    Holistic workload analysis — the main agentic intelligence endpoint.
    Returns structured JSON with executive summary, risk assessment, and recommendations.
    Cached for 24h unless force_refresh=True.
    """
    import services.tagging_service as tag_svc

    if not force_refresh:
        cached = tag_svc.get_latest_ai_analysis("workload", None, max_age_hours=6)
        if cached:
            logger.info("Returning cached workload analysis (age < 6h)")
            return {**cached["result"], "_cached": True, "_cached_at": cached["analyzed_at"]}

    client, model, provider = _get_ai_client_for_analysis()
    if not client:
        return {"error": "No AI provider configured. Set AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_KEY or ANTHROPIC_API_KEY.", "available": False}

    summary = _build_workload_summary(resources)
    # Send full context for up to 150 resources, summarize the rest
    sample  = resources[:MAX_RESOURCES_FULL_CTX]
    compressed = [_compress_resource(r) for r in sample]

    # Enrich with custom tags
    _enrich_with_custom_tags(compressed)
    tag_context = _build_tag_summary(compressed)

    prompt = f"""Analyse this Azure infrastructure inventory:

WORKLOAD SUMMARY:
{json.dumps(summary, indent=2)}

{tag_context}

BCDR CONTEXT:
{json.dumps(bcdr_summary or {}, indent=2)}

DEPENDENCY GRAPH SUMMARY:
{json.dumps(dep_summary or {}, indent=2)}

RESOURCES ({len(compressed)} of {len(resources)} shown, sorted by cost desc):
{_serialize_for_ai(compressed, indent=2)}

Return a JSON object matching EXACTLY this schema:
{{
  "executive_summary": "2-3 sentence executive summary of the workload health",
  "overall_risk_score": 0-100,
  "overall_health": "Critical|At Risk|Fair|Good|Excellent",
  "total_monthly_cost": number,
  "estimated_monthly_savings": number,
  "key_findings": [
    {{"finding": "...", "severity": "Critical|High|Medium|Low", "category": "Cost|BCDR|Security|Performance|Governance"}}
  ],
  "bcdr_readiness": {{
    "score": 0-100,
    "gaps": ["..."],
    "qatar_specific_issues": ["..."],
    "immediate_actions": ["..."]
  }},
  "optimization_opportunities": [
    {{
      "resource_name": "...",
      "resource_type": "...",
      "action": "delete|downsize|reserve|enable_backup|add_redundancy|monitor",
      "priority": "P1|P2|P3|P4",
      "monthly_savings": number,
      "effort": "Low|Medium|High",
      "explanation": "...",
      "steps": ["step 1", "step 2"]
    }}
  ],
  "quick_wins": [
    {{
      "title": "...",
      "description": "...",
      "estimated_impact": "...",
      "effort": "Low",
      "resources_affected": ["resource_name1"]
    }}
  ],
  "workload_patterns": {{
    "description": "...",
    "idle_resources": number,
    "underutilized": number,
    "well_utilized": number
  }},
  "recommended_next_steps": ["step 1 (who / what / when)", "step 2"]
}}"""

    try:
        raw = _call_ai(_SYS_WORKLOAD, prompt, MAX_TOKENS_ANALYSIS)
        # Strip markdown fences
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if "```" in raw:
                raw = raw.rsplit("```", 1)[0]
        result = json.loads(raw.strip())
        result["model"]        = model
        result["resource_count"] = len(resources)
        result["available"]    = True

        # Cache result
        tag_svc.save_ai_analysis(
            "workload", None, model, result,
            prompt_tokens=0,
        )
        return result

    except json.JSONDecodeError as e:
        logger.error("AI workload analysis JSON parse error: %s", e)
        return {"error": f"JSON parse error: {e}", "raw": raw[:500], "available": True}
    except Exception as e:
        logger.error("AI workload analysis failed: %s", e)
        return {"error": str(e), "available": True}


def _enrich_with_resource_details(result: dict, resources: List[dict], subscriptions: Optional[List[str]] = None) -> dict:
    """
    Post-process AI response to inject actual resource lists into gaps and recommendations.
    
    Analyzes the AI-identified gaps/recommendations and matches them with actual resources
    to provide detailed resource breakdowns.
    
    Also includes user-defined BCDR metadata (Phase 1 planning) in resource cards.
    """
    
    # Helper: Get resources without backup
    no_backup_resources = [r for r in resources if not r.get("has_backup")]
    
    # Helper: Get resources in Qatar Central (no zones)
    qatar_resources = [r for r in resources if r.get("location", "").lower() == "qatarcentral"]
    
    # Helper: Get resources in West Europe
    westeu_resources = [r for r in resources if r.get("location", "").lower() == "westeurope"]
    
    # Helper: All resources (for RTO/RPO and zone redundancy gaps)
    all_resources = resources
    
    def _build_resource_card(r: dict) -> dict:
        """Build enriched resource card with user metadata."""
        card = {
            "id": r.get("resource_id", ""),
            "name": r.get("resource_name", r.get("resource_id", "").split("/")[-1]),
            "type": r.get("resource_type", "unknown"),
            "location": r.get("location", "unknown"),
            "has_backup": r.get("has_backup", False),
            "zone_redundant": r.get("zone_redundant", False),
            "score": r.get("final_score", 0)
        }
        
        # Include user BCDR metadata if available
        user_meta = r.get("user_bcdr_metadata")
        if user_meta:
            card["user_metadata"] = {
                "criticality": user_meta.get("criticality"),
                "dr_tier": user_meta.get("dr_tier"),
                "rto_target": user_meta.get("rto_target"),
                "rpo_target": user_meta.get("rpo_target"),
                "business_function": user_meta.get("business_function"),
                "notes": user_meta.get("notes")
            }
        
        return card
    
    # Enrich critical_gaps with actual resource lists
    if "critical_gaps" in result:
        for gap in result["critical_gaps"]:
            gap_id = gap.get("gap_id", "")
            resource_list = []
            
            # Map gap to actual resources
            if "backup" in gap.get("title", "").lower() or gap_id == "GAP-001":
                resource_list = [_build_resource_card(r) for r in no_backup_resources[:50]]
            elif "qatar" in gap.get("title", "").lower() or "single point" in gap.get("title", "").lower() or gap_id == "GAP-002":
                resource_list = [_build_resource_card(r) for r in qatar_resources[:50]]
            elif "west europe" in gap.get("title", "").lower() or "concentration" in gap.get("title", "").lower() or gap_id == "GAP-003":
                resource_list = [_build_resource_card(r) for r in westeu_resources[:50]]
            elif "rto" in gap.get("title", "").lower() or "rpo" in gap.get("title", "").lower() or gap_id == "GAP-004":
                resource_list = [_build_resource_card(r) for r in all_resources[:50]]
            elif "zone" in gap.get("title", "").lower() or "redundancy" in gap.get("title", "").lower() or gap_id == "GAP-005":
                non_zone_resources = [r for r in resources if not r.get("zone_redundant", False)]
                resource_list = [_build_resource_card(r) for r in non_zone_resources[:50]]
            
            gap["resource_details"] = resource_list
            gap["total_affected"] = gap.get("affected_resources_count", len(resource_list))
            gap["showing_count"] = len(resource_list)
    
    # Enrich recommendations with actual resource lists
    if "recommendations" in result:
        for rec in result["recommendations"]:
            rec_id = rec.get("rec_id", "")
            resource_list = []
            
            # Map recommendation to actual resources
            if "backup" in rec.get("title", "").lower() or rec.get("category") == "Backup" or rec_id == "REC-001":
                resource_list = [_build_resource_card(r) for r in no_backup_resources[:50]]
            elif "dr" in rec.get("title", "").lower() or rec.get("category") == "DR" or rec_id == "REC-002":
                critical_resources = [r for r in resources if r.get("final_score", 100) < 40]
                resource_list = [_build_resource_card(r) for r in critical_resources[:50]]
            elif "zone" in rec.get("title", "").lower() or "redundancy" in rec.get("title", "").lower() or rec_id == "REC-003":
                non_zone_resources = [r for r in resources if not r.get("zone_redundant", False)]
                resource_list = [_build_resource_card(r) for r in non_zone_resources[:50]]
            
            rec["resource_details"] = resource_list
            rec["total_affected"] = len([r for r in resources if any(rt in r.get("resource_type", "") for rt in rec.get("affected_resources", []))] or resource_list)
            rec["showing_count"] = len(resource_list)
    
    return result


def analyze_environment_bcdr(
    resources: List[dict],
    subscriptions: Optional[List[str]] = None,
    force_refresh: bool = False,
) -> dict:
    """
    Comprehensive AI-powered BCDR analysis of the entire Azure environment.
    
    Integrates with Phase 1 BCDR Planning:
    - Reads user-defined categorizations from database
    - Uses criticality, DR tier, RTO/RPO targets set by user
    - Generates recommendations aligned with business priorities
    
    Returns a full report with:
    - Executive summary
    - Overall BCDR score (0-100)
    - Critical gaps and risks
    - Recommendations by priority
    - Cost estimates
    - Implementation roadmap
    """
    import services.tagging_service as tag_svc
    
    # Load user-defined BCDR metadata (Phase 1)
    try:
        import services.bcdr_metadata_service as bcdr_meta_svc
        metadata_map = bcdr_meta_svc.get_all_bcdr_metadata()
        logger.info(f"Loaded BCDR metadata for {len(metadata_map)} resources")
    except Exception as e:
        logger.warning(f"Could not load BCDR metadata: {e}")
        metadata_map = {}
    
    if not force_refresh:
        cached = tag_svc.get_latest_ai_analysis("bcdr_environment", None, max_age_hours=24)
        if cached:
            return cached["result"]
    
    client, model, provider = _get_ai_client_for_analysis()
    if not client:
        return {
            "error": "AI provider not configured. Please add ANTHROPIC_API_KEY or use existing Azure OpenAI configuration.",
            "available": False
        }
    
    # Enrich resources with user metadata
    for resource in resources:
        resource_id = resource.get("resource_id")
        if resource_id and resource_id in metadata_map:
            resource["user_bcdr_metadata"] = metadata_map[resource_id]
        else:
            resource["user_bcdr_metadata"] = None
    
    # Build environment context
    total_resources = len(resources)
    regions = {}
    resource_types = {}
    backup_coverage = {"protected": 0, "unprotected": 0}
    zone_support = {"zone_redundant": 0, "regional_only": 0}
    user_categorized = {"total": len(metadata_map), "by_criticality": {}, "by_dr_tier": {}}
    
    for r in resources:
        loc = r.get("location", "unknown")
        regions[loc] = regions.get(loc, 0) + 1
        
        rt = r.get("resource_type", "").split("/")[-1]
        resource_types[rt] = resource_types.get(rt, 0) + 1
        
        if r.get("has_backup"):
            backup_coverage["protected"] += 1
        else:
            backup_coverage["unprotected"] += 1
            
        if r.get("zone_redundant"):
            zone_support["zone_redundant"] += 1
        else:
            zone_support["regional_only"] += 1
    
    # Sample critical resources for detailed analysis (limit tokens)
    critical_resources = [r for r in resources if r.get("final_score", 100) < 60 or not r.get("has_backup")]
    sample_resources = critical_resources[:50] if len(critical_resources) > 50 else critical_resources
    
    compressed_sample = [_compress_resource(r) for r in sample_resources]
    _enrich_with_custom_tags(compressed_sample)
    tag_context = _build_tag_summary(compressed_sample)
    
    prompt_content = f"""You are an Azure Solutions Architect conducting a comprehensive BCDR (Business Continuity and Disaster Recovery) assessment.

ENVIRONMENT OVERVIEW:
- Total Resources: {total_resources}
- Regions: {json.dumps(regions, indent=2)}
- Resource Types: {json.dumps(dict(list(resource_types.items())[:15]), indent=2)}
- Backup Coverage: {backup_coverage['protected']} protected, {backup_coverage['unprotected']} unprotected
- Zone Redundancy: {zone_support['zone_redundant']} zone-redundant, {zone_support['regional_only']} regional-only

{tag_context}

CRITICAL RESOURCES SAMPLE ({len(compressed_sample)} of {len(critical_resources)} high-risk):
{_serialize_for_ai(compressed_sample, indent=2)}

Perform a comprehensive BCDR analysis and return a JSON report with this EXACT structure:

{{
  "executive_summary": {{
    "overall_bcdr_score": <0-100 integer>,
    "score_breakdown": {{
      "backup_coverage": <0-100>,
      "zone_redundancy": <0-100>,
      "regional_distribution": <0-100>,
      "dr_readiness": <0-100>
    }},
    "risk_level": "Critical|High|Medium|Low",
    "total_resources_analyzed": {total_resources},
    "critical_gaps_count": <integer>,
    "estimated_annual_cost": "$X - $Y",
    "key_findings": ["finding 1", "finding 2", "finding 3"]
  }},
  
  "critical_gaps": [
    {{
      "gap_id": "GAP-001",
      "title": "brief title",
      "severity": "Critical|High|Medium|Low",
      "affected_resources_count": <integer>,
      "description": "detailed description",
      "business_impact": "impact description",
      "recommended_action": "specific action",
      "estimated_cost": "$X/month or $X one-time",
      "implementation_effort": "Low|Medium|High",
      "priority": "P1|P2|P3|P4"
    }}
  ],
  
  "regional_analysis": {{
    "primary_regions": ["region1", "region2"],
    "single_region_risk": "High|Medium|Low",
    "recommended_dr_regions": ["region1", "region2"],
    "cross_region_dependencies": "description",
    "availability_zone_status": "summary"
  }},
  
  "recommendations": [
    {{
      "rec_id": "REC-001",
      "category": "Backup|DR|Redundancy|Architecture",
      "title": "recommendation title",
      "description": "detailed recommendation",
      "priority": "P1|P2|P3|P4",
      "affected_resources": ["type: count", "type: count"],
      "implementation_steps": ["step 1", "step 2", "step 3"],
      "estimated_cost": "$X/month",
      "effort": "Low|Medium|High",
      "expected_rto_improvement": "from X to Y",
      "expected_rpo_improvement": "from X to Y",
      "quick_win": true|false
    }}
  ],
  
  "implementation_roadmap": {{
    "phase_1_immediate": {{
      "timeline": "0-30 days",
      "actions": ["action 1", "action 2"],
      "estimated_cost": "$X"
    }},
    "phase_2_short_term": {{
      "timeline": "1-3 months",
      "actions": ["action 1", "action 2"],
      "estimated_cost": "$X"
    }},
    "phase_3_long_term": {{
      "timeline": "3-12 months",
      "actions": ["action 1", "action 2"],
      "estimated_cost": "$X"
    }}
  }},
  
  "cost_benefit_analysis": {{
    "current_annual_risk_exposure": "$X - $Y",
    "recommended_investment": "$X/year",
    "roi_timeframe": "X months",
    "risk_reduction_percentage": "X%"
  }},
  
  "compliance_considerations": [
    "consideration 1",
    "consideration 2"
  ],
  
  "next_steps": [
    "step 1 (who / what / when)",
    "step 2 (who / what / when)"
  ]
}}

Focus on:
1. Qatar Central has NO availability zones and NO paired region - critical single point of failure
2. Backup gaps - identify resources without Azure Backup
3. Cross-region DR strategy: Primary DR → West Europe or North Europe (NIA-certified)
4. Azure Backup Region of Choice (RoC) preview: back up to Sweden Central or Switzerland North vaults
   - RoC supported workloads: IaaS VM, SQL in VM, SAP HANA in VM, Azure Files, Blob, ADLS, AKS, PostgreSQL
   - RoC NOT supported: ADE VMs. CVM+CMK needs mHSM migration
   - SDC/SZN are NOT NIA-certified — if NIA compliance required, use West/North Europe vaults instead
5. Per-service DR strategies (Qatar BCDR Plan):
   - ACR: Premium geo-replication to DR region
   - AKS: Velero backup + IaC rebuild + geo-replicated ACR + Azure Front Door
   - Key Vault: Custom Azure Function sync to DR vault (no native cross-region sync)
   - Storage: No GRS → Object Replication (block blobs) + AzCopy/ADF for Files
   - ANF: Cross-Region Replication (manual break)
   - SQL: Auto-Failover Groups; SQL MI needs 9hr provisioning
   - Cosmos DB: Multi-region replication (automatic failover)
   - PostgreSQL/MySQL Flex: Geo-redundant backup + read replicas
   - Databricks: Active-passive workspace + Git sync
   - ADF: Git integration + CI/CD (Azure provides auto-failover)
6. RTO/RPO targets - estimate current vs target
7. Cost-effective quick wins
8. Priority-based implementation roadmap
9. Qatar PDPPL compliance - cross-border data transfer requires DPO review"""

    try:
        logger.info("Starting comprehensive BCDR analysis with %s (%s resources)", provider, total_resources)
        
        if provider == "anthropic":
            response = client.messages.create(
                model      = model,
                max_tokens = MAX_TOKENS_ANALYSIS,
                system     = "You are an expert Azure Solutions Architect specializing in BCDR planning and resilience engineering.",
                messages   = [{"role": "user", "content": prompt_content}],
            )
            raw = response.content[0].text.strip()
        else:  # azure_openai
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "You are an expert Azure Solutions Architect specializing in BCDR planning and resilience engineering."},
                    {"role": "user", "content": prompt_content}
                ],
                max_completion_tokens=MAX_TOKENS_ANALYSIS,
                temperature=0.3,
                response_format={"type": "json_object"}
            )
            raw = response.choices[0].message.content.strip()
        
        # Strip markdown fences
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if "```" in raw:
                raw = raw.rsplit("```", 1)[0]
        
        result = json.loads(raw.strip())
        result["model"] = model
        result["provider"] = provider
        result["analysis_timestamp"] = datetime.now(timezone.utc).isoformat()
        result["available"] = True
        
        # POST-PROCESS: Inject actual resource lists into gaps and recommendations
        result = _enrich_with_resource_details(result, resources, subscriptions)
        
        # Cache result with token tracking
        if provider == "anthropic":
            prompt_tokens = getattr(response.usage, "input_tokens", 0)
        else:
            prompt_tokens = getattr(response.usage, "prompt_tokens", 0)
        
        tag_svc.save_ai_analysis(
            "bcdr_environment", None, model, result,
            prompt_tokens=prompt_tokens,
        )
        
        logger.info("BCDR analysis complete - Score: %d/100, Gaps: %d, Recommendations: %d",
                    result.get("executive_summary", {}).get("overall_bcdr_score", 0),
                    len(result.get("critical_gaps", [])),
                    len(result.get("recommendations", [])))
        return result
        
    except json.JSONDecodeError as e:
        logger.error("BCDR analysis JSON parse error: %s", e)
        return {
            "error": f"Failed to parse AI response: {e}",
            "raw_preview": raw[:500] if 'raw' in locals() else "",
            "available": True
        }
    except Exception as e:
        logger.error("BCDR analysis failed: %s", e, exc_info=True)
        return {
            "error": str(e),
            "available": True
        }


def analyze_resource_bcdr(
    resources: List[dict],
    zone_assessments: Optional[List[dict]] = None,
    force_refresh: bool = False,
) -> List[dict]:
    """
    AI-generated BCDR recommendations for each resource.
    Returns list of 19-column SA analysis dicts, augmented with AI insights.
    """
    import services.tagging_service as tag_svc

    if not force_refresh:
        cached = tag_svc.get_latest_ai_analysis("bcdr_ai", None, max_age_hours=12)
        if cached:
            return cached["result"].get("items", [])

    client, model, provider = _get_ai_client_for_analysis()
    if not client:
        logger.warning("AI provider not configured - returning empty BCDR analysis")
        return []

    # Filter to highest-risk resources for AI analysis (limit token usage)
    high_risk = [r for r in resources if r.get("final_score", 100) < 60 or
                 not r.get("has_backup") or r.get("location", "").lower().startswith("qatar")]
    sample = high_risk[:80] if len(high_risk) > 80 else high_risk

    compressed_bcdr = [_compress_resource(r) for r in sample]
    _enrich_with_custom_tags(compressed_bcdr)
    tag_context = _build_tag_summary(compressed_bcdr)

    prompt = f"""Perform a 19-column SA-level BCDR analysis for these {len(sample)} Azure resources.

{tag_context}

RESOURCES:
{_serialize_for_ai(compressed_bcdr, indent=2)}

For each resource return a JSON object with ALL 19 SA columns:
{{
  "resource_id": "...",
  "resource_name": "...",
  "resource_type": "...",
  "location": "...",
  "sa_criticality": "Critical|High|Medium|Low",
  "sa_zr_context": "zone redundancy context...",
  "sa_bcdr_strategy": "Active-Active|Active-Passive|Warm Standby|Cold Standby|Backup-Restore|None Required",
  "sa_dr_region_choice": "UAE North|West Europe|North Europe|Same Region|N/A",
  "sa_dr_method": "specific DR method...",
  "sa_rpo": "< 15 min|< 1 hr|< 4 hrs|< 24 hrs|Best Effort",
  "sa_rto": "< 1 hr|< 4 hrs|< 8 hrs|< 24 hrs|Best Effort",
  "sa_bcdr_guidance_summary": "concise guidance...",
  "sa_action_required": "specific action...",
  "sa_implementation_effort": "Low|Medium|High",
  "sa_cost_impact": "Low|Medium|High — estimated $X/month",
  "sa_priority": "P1|P2|P3|P4",
  "sa_quick_win": "Yes|No",
  "sa_compliance_note": "compliance/regulatory note...",
  "sa_dependencies": "resource dependencies...",
  "sa_current_gap_summary": "current gap...",
  "sa_physical_zone_placement": "zone placement info...",
  "sa_zone_transition_path": "transition path...",
  "ai_generated": true,
  "ai_confidence": "high|medium|low"
}}

Return a JSON object: {{"items": [array of above objects]}}"""

    try:
        raw = _call_ai(_SYS_BCDR, prompt, MAX_TOKENS_ANALYSIS)
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if "```" in raw:
                raw = raw.rsplit("```", 1)[0]
        result = json.loads(raw.strip())
        tag_svc.save_ai_analysis("bcdr_ai", None, model, result, prompt_tokens=0)
        return result.get("items", [])
    except Exception as e:
        logger.error("AI BCDR analysis failed: %s", e)
        return []


def analyze_single_resource(
    resource: dict,
    dependencies: Optional[dict] = None,
    custom_tags: Optional[dict] = None,
) -> dict:
    """Deep-dive AI analysis for a single resource."""
    client, model, provider = _get_ai_client_for_analysis()
    if not client:
        return {"error": "No AI provider configured.", "available": False}

    ctx = _compress_resource(resource)
    if custom_tags:
        ctx["custom_tags"] = custom_tags
    else:
        # Auto-fetch custom tags for this resource
        _enrich_with_custom_tags([ctx])

    prompt = f"""Perform a comprehensive deep-dive analysis of this Azure resource.
Consider the resource's cost efficiency, utilization patterns, security posture,
BCDR readiness, and operational health.

RESOURCE DETAILS:
{json.dumps({k: v for k, v in ctx.items() if not k.startswith('_')}, indent=2)}

DEPENDENCY CONTEXT:
{json.dumps(dependencies or {}, indent=2)}

ANALYSIS GUIDELINES:
- If the resource is in Qatar Central, apply Qatar-specific constraints (no zone redundancy, no paired region, GRS not available)
- If utilization data is missing, note the monitoring gap and recommend enabling diagnostics
- If cost is >$0 but score is low, provide specific rightsizing or deletion guidance with CLI commands
- If no backup is detected, flag it as a BCDR gap with specific remediation
- Provide Azure CLI or PowerShell commands where applicable
- Tag recommendations should include environment, criticality, application, and cost-center

Return a JSON object:
{{
  "summary": "2-3 sentence executive assessment of this resource's health and value",
  "health_score": 0-100,
  "cost_assessment": "specific assessment of cost efficiency with numbers",
  "utilization_assessment": "specific assessment with actual metrics if available",
  "risk_factors": ["specific risk with context"],
  "bcdr_assessment": {{
    "is_protected": true/false,
    "current_gaps": ["specific gap"],
    "recommended_strategy": "detailed strategy",
    "rpo_target": "e.g. 1 hour",
    "rto_target": "e.g. 4 hours"
  }},
  "optimization_actions": [
    {{"action": "specific action", "priority": "P1|P2|P3|P4", "savings": monthly_usd_number, "effort": "Low|Medium|High", "steps": ["az cli command or step"], "rationale": "why this matters"}}
  ],
  "dependencies_analysis": {{
    "upstream_risks": ["what this resource depends on"],
    "downstream_impacts": ["what breaks if this goes down"],
    "spof_risk": "None|Low|Medium|High|Critical"
  }},
  "custom_tag_recommendations": [
    {{"tag_key": "Application", "suggested_value": "...", "reason": "..."}}
  ],
  "security_posture": {{
    "encryption_at_rest": true/false,
    "encryption_in_transit": true/false,
    "network_exposure": "public|private|hybrid",
    "identity_protection": "description",
    "recommendations": ["specific security action"]
  }},
  "next_steps": ["step 1 (owner / timeline)", "step 2"]
}}"""

    try:
        raw = _call_ai(_SYS_RESOURCE_DEEPDIVE, prompt, MAX_TOKENS_SUMMARY)
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if "```" in raw:
                raw = raw.rsplit("```", 1)[0]
        result = json.loads(raw.strip())
        result["model"]     = model
        result["available"] = True
        return result
    except Exception as e:
        logger.error("Single resource AI analysis failed: %s", e)
        return {"error": str(e), "available": True}


def analyze_dependency_impact(
    resource: dict,
    blast_radius: dict,
    dep_graph_summary: Optional[dict] = None,
) -> dict:
    """AI analysis of dependency impact and SPOF classification."""
    client, model, provider = _get_ai_client_for_analysis()
    if not client:
        return {"error": "No AI provider configured.", "available": False}

    ctx = _compress_resource(resource)
    _enrich_with_custom_tags([ctx])

    prompt = f"""Analyse the dependency impact for this Azure resource:

RESOURCE:
{json.dumps({k: v for k, v in ctx.items() if not k.startswith('_')}, indent=2)}

BLAST RADIUS DATA:
{json.dumps(blast_radius, indent=2)}

DEPENDENCY GRAPH SUMMARY:
{json.dumps(dep_graph_summary or {}, indent=2)}

Return a JSON object:
{{
  "spof_classification": "None|Low|Medium|High|Critical",
  "blast_radius_summary": "string describing impact if this resource fails",
  "affected_services": ["list of affected service names"],
  "failure_scenarios": [
    {{"scenario": "...", "probability": "Low|Medium|High", "impact": "...", "mitigation": "..."}}
  ],
  "resilience_improvements": [
    {{"action": "...", "priority": "P1|P2|P3|P4", "effort": "Low|Medium|High", "description": "..."}}
  ],
  "dependency_health_score": 0-100,
  "recommendations": ["recommendation 1", "recommendation 2"]
}}"""

    try:
        raw = _call_ai(_SYS_DEPENDENCY, prompt, 2048)
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if "```" in raw:
                raw = raw.rsplit("```", 1)[0]
        result = json.loads(raw.strip())
        result["available"] = True
        return result
    except Exception as e:
        logger.error("Dependency impact analysis failed: %s", e)
        return {"error": str(e), "available": True}


def generate_optimization_roadmap(
    resources: List[dict],
    force_refresh: bool = False,
) -> dict:
    """
    AI-generated prioritized optimization roadmap across all resources.
    Returns sorted action list with effort/impact matrix.
    """
    import services.tagging_service as tag_svc

    if not force_refresh:
        cached = tag_svc.get_latest_ai_analysis("optimization_roadmap", None, max_age_hours=6)
        if cached:
            return {**cached["result"], "_cached": True}

    client, model, provider = _get_ai_client_for_analysis()
    if not client:
        return {"error": "No AI provider configured.", "items": []}

    # Focus on waste candidates and high-cost resources
    candidates = sorted(
        [r for r in resources if r.get("cost_current_month", 0) > 5 or r.get("final_score", 100) < 60],
        key=lambda r: -(r.get("cost_current_month", 0) * (1 - r.get("final_score", 50) / 100)),
    )[:100]

    compressed_opt = [_compress_resource(r) for r in candidates]
    _enrich_with_custom_tags(compressed_opt)
    tag_context = _build_tag_summary(compressed_opt)

    prompt = f"""Create a prioritized Azure optimization roadmap for {len(candidates)} resources.

Total current monthly spend: ${sum(r.get('cost_current_month', 0) for r in candidates):,.0f}

{tag_context}

RESOURCES:
{_serialize_for_ai(compressed_opt, indent=2)}

Return a JSON object:
{{
  "total_identified_savings": number,
  "confidence_level": "High|Medium|Low",
  "quick_wins": [
    {{
      "title": "...",
      "resources": ["name1", "name2"],
      "action": "delete|downsize|reserve|enable_backup|add_tag",
      "monthly_savings": number,
      "effort_hours": number,
      "steps": ["step 1", "step 2", "step 3"]
    }}
  ],
  "strategic_actions": [
    {{
      "title": "...",
      "category": "Cost|BCDR|Performance|Governance",
      "resources": ["name1"],
      "priority": "P1|P2|P3|P4",
      "monthly_savings": number,
      "one_time_effort": "Low|Medium|High",
      "description": "...",
      "steps": ["step 1"]
    }}
  ],
  "governance_gaps": [
    {{"gap": "...", "affected_count": number, "fix": "..."}}
  ],
  "30_day_plan": ["action 1 (week 1)", "action 2 (week 2)"],
  "90_day_plan": ["initiative 1", "initiative 2"]
}}"""

    try:
        raw = _call_ai(_SYS_OPTIMIZATION, prompt, MAX_TOKENS_ANALYSIS)
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if "```" in raw:
                raw = raw.rsplit("```", 1)[0]
        result = json.loads(raw.strip())
        result["model"]    = model
        result["available"] = True
        tag_svc.save_ai_analysis("optimization_roadmap", None, model, result, prompt_tokens=0)
        return result
    except Exception as e:
        logger.error("Optimization roadmap failed: %s", e)
        return {"error": str(e), "items": [], "available": True}


# ── Cloud Adoption & Modernization AI Analysis ─────────────────────────────────

_SYS_CLOUD_ADOPTION = """You are a senior Azure cloud architect specializing in cloud migration and modernization strategy.
Your expertise includes IaaS-to-PaaS migrations, cloud-native architecture patterns, and operational cost reduction.

You analyze customer Azure environments to identify:
1. Resources that can be migrated from IaaS to PaaS for reduced overhead and better SLAs
2. Self-managed services that have Azure-managed equivalents (e.g., self-hosted DB → Azure SQL/Cosmos)
3. Resources without cloud-native monitoring, security, or DR that should adopt managed services
4. Opportunities to consolidate fragmented workloads using platform services
5. Modernization paths that reduce operational complexity and improve reliability

Always be specific: cite exact resource names, resource groups, and provide Azure CLI/PowerShell commands.
Frame recommendations in terms of CUSTOMER VALUE: reduced operational overhead, improved SLAs,
automated patching, better security posture, and total cost of ownership reduction.

CUSTOM TAG AWARENESS:
When resources have "custom_tags", use MigrationStatus tag to identify planned migrations,
Environment tag to prioritize Production modernization, and Criticality to assess migration risk.

Output strict JSON only, no markdown."""


def analyze_cloud_adoption(
    resources: List[dict],
    acr_opportunities: dict = None,
    force_refresh: bool = False,
) -> dict:
    """
    AI-generated cloud adoption & modernization analysis.
    Provides migration paths, IaaS→PaaS recommendations, and modernization roadmap.
    """
    import services.tagging_service as tag_svc

    if not force_refresh:
        cached = tag_svc.get_latest_ai_analysis("cloud_adoption", None, max_age_hours=6)
        if cached:
            return {**cached["result"], "_cached": True}

    client, model, provider = _get_ai_client_for_analysis()
    if not client:
        return {"error": "No AI provider configured.", "available": False}

    # Focus on IaaS resources and those without managed service adoption
    iaas_types = [
        "microsoft.compute/virtualmachines",
        "microsoft.compute/virtualmachinescalesets",
        "microsoft.web/serverfarms",
        "microsoft.network/applicationgateways",
        "microsoft.network/loadbalancers",
    ]
    all_compressed = [_compress_resource(r) for r in resources[:80]]
    _enrich_with_custom_tags(all_compressed)
    tag_context = _build_tag_summary(all_compressed)

    # Build adoption summary from acr_opportunities
    adoption_context = ""
    if acr_opportunities:
        cats = acr_opportunities.get("categories", [])
        adoption_context = f"""
CURRENT SERVICE ADOPTION STATUS:
{json.dumps([{"service": c.get("category"), "coverage_pct": c.get("coverage_pct"), "gaps": c.get("gaps"), "impact": c.get("acr_impact")} for c in cats], indent=2)}
Total adoption gaps: {acr_opportunities.get("total_gaps", 0)}
"""

    # Count by type
    type_counts = {}
    for r in resources:
        rt = r.get("resource_type", "unknown").lower()
        type_counts[rt] = type_counts.get(rt, 0) + 1

    iaas_count = sum(type_counts.get(t, 0) for t in iaas_types)
    total_cost = sum(r.get("cost_current_month", 0) for r in resources)
    iaas_cost = sum(r.get("cost_current_month", 0) for r in resources if r.get("resource_type", "").lower() in iaas_types)

    prompt = f"""Analyze this Azure environment for cloud adoption and modernization opportunities.

ESTATE OVERVIEW:
- Total resources: {len(resources)}
- Total monthly cost: ${total_cost:,.0f}
- IaaS resources (VMs, VMSS, ASPs, LBs, AGWs): {iaas_count} costing ${iaas_cost:,.0f}/mo
- Resource types: {json.dumps(dict(sorted(type_counts.items(), key=lambda x: -x[1])[:20]))}
{adoption_context}

{tag_context}

RESOURCE DETAILS (top 80 by cost/score):
{_serialize_for_ai(all_compressed, indent=2)}

Analyze and return a JSON object:
{{
  "adoption_score": number (0-100, how well the estate uses managed/PaaS services),
  "maturity_level": "Beginner|Intermediate|Advanced|Cloud-Native",
  "executive_summary": "2-3 sentence overview of the estate's cloud maturity and key opportunities",
  "iaas_to_paas_opportunities": [
    {{
      "current_service": "resource name or pattern",
      "current_type": "VM|VMSS|App Gateway|etc",
      "recommended_target": "Azure Container Apps|Azure SQL|AKS|App Service|etc",
      "migration_approach": "Rehost|Refactor|Rearchitect|Replace",
      "estimated_monthly_savings": number,
      "operational_reduction": "High|Medium|Low",
      "effort_weeks": number,
      "benefits": ["benefit 1", "benefit 2"],
      "risks": ["risk 1"],
      "steps": ["step 1", "step 2", "step 3"]
    }}
  ],
  "modernization_recommendations": [
    {{
      "category": "Monitoring|Security|DR|Networking|Identity|Automation",
      "title": "short title",
      "description": "what to do and why",
      "affected_resources": ["name1", "name2"],
      "priority": "P1|P2|P3",
      "monthly_value": number,
      "implementation_complexity": "Low|Medium|High"
    }}
  ],
  "migration_waves": [
    {{
      "wave": 1,
      "timeframe": "Week 1-4",
      "theme": "Quick Wins & Monitoring",
      "actions": ["action 1", "action 2"],
      "expected_savings": number
    }}
  ],
  "cost_comparison": {{
    "current_monthly_iaas": number,
    "projected_monthly_paas": number,
    "projected_savings_pct": number,
    "operational_hours_saved_monthly": number
  }},
  "cloud_native_gaps": [
    {{
      "gap": "description of gap",
      "impact": "what the customer is missing",
      "recommendation": "specific Azure service to adopt",
      "affected_count": number
    }}
  ]
}}"""

    try:
        raw = _call_ai(_SYS_CLOUD_ADOPTION, prompt, MAX_TOKENS_ANALYSIS)
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if "```" in raw:
                raw = raw.rsplit("```", 1)[0]
        result = json.loads(raw.strip())
        result["model"] = model
        result["available"] = True
        result["analysis_timestamp"] = datetime.now(timezone.utc).isoformat()
        tag_svc.save_ai_analysis("cloud_adoption", None, model, result, prompt_tokens=0)
        return result
    except Exception as e:
        logger.error("Cloud adoption analysis failed: %s", e)
        return {"error": str(e), "available": True}


# ── AI Licensing & Reservation Analysis ───────────────────────────────────────

MAX_TOKENS_LICENSING = 12000

_SYS_LICENSING = """You are a Principal Azure FinOps Architect specializing in licensing optimization,
reservation planning, and commercial cost management for enterprise Azure estates.

Your analysis must be deeply specific — reference actual resource names, SKUs, regions, and spend figures.
Do NOT produce generic advice. Every recommendation must include the resource, the action, and the expected saving.

You score the estate across 6 dimensions (0-100 each):
1. Reservation Coverage — what % of eligible spend is covered by RI/Savings Plans
2. AHUB Utilisation — are hybrid benefit licences being maximized
3. BYOL Optimization — are existing on-prem licences being leveraged where portable
4. Commitment Strategy — is the mix of 1yr/3yr/Savings Plan optimal for workload patterns
5. Licence Waste — are there over-provisioned licences, idle RI, or expired commitments
6. Commercial Readiness — EA renewal prep, CSP optimization, procurement timing

You provide:
- Specific findings with resource names and dollar impact
- A prioritized purchase plan for reservations
- BYOL conversion candidates with vendor-specific steps
- Licence consolidation opportunities
- EA/CSP renewal negotiation recommendations
- Risk assessment for commitment decisions

CUSTOM TAG AWARENESS:
When custom tags are provided, use Environment and Criticality to recommend reservations
only for stable Production workloads, and flag Dev-Test resources as poor RI candidates.
"""


def analyze_licensing_ai(
    licensing_opps: list,
    reservation_analysis: dict,
    resources: Optional[List[dict]] = None,
    force_refresh: bool = False,
) -> dict:
    """
    AI-powered comprehensive licensing & reservation analysis.
    Returns scoring, findings, purchase plan, and strategic recommendations.
    """
    import services.tagging_service as tag_svc

    if not force_refresh:
        cached = tag_svc.get_latest_ai_analysis("licensing", None, max_age_hours=12)
        if cached:
            return {**cached["result"], "_cached": True, "_cached_at": cached["analyzed_at"]}

    client, model, provider = _get_ai_client_for_analysis()
    if not client:
        return {
            "error": "AI provider not configured. Please add ANTHROPIC_API_KEY or AZURE_OPENAI_ENDPOINT.",
            "available": False,
        }

    # Build context for AI
    res_summary = reservation_analysis.get("summary", {})
    type_breakdown = reservation_analysis.get("type_breakdown", [])
    purchase_plan = reservation_analysis.get("purchase_plan", [])[:15]

    # Summarize licensing opportunities
    opp_summary = {}
    for opp in licensing_opps:
        ot = opp.get("opportunity_type") if isinstance(opp, dict) else opp.opportunity_type
        if ot not in opp_summary:
            opp_summary[ot] = {"count": 0, "total_saving": 0.0, "examples": []}
        saving = opp.get("estimated_monthly_saving", 0) if isinstance(opp, dict) else opp.estimated_monthly_saving
        opp_summary[ot]["count"] += 1
        opp_summary[ot]["total_saving"] += saving
        if len(opp_summary[ot]["examples"]) < 3:
            name = opp.get("resource_name", "") if isinstance(opp, dict) else opp.resource_name
            desc = opp.get("description", "") if isinstance(opp, dict) else opp.description
            opp_summary[ot]["examples"].append({"name": name, "saving": saving, "desc": desc[:200]})

    # Resource estate summary for context
    estate_summary = {}
    total_monthly_spend = 0.0
    tag_context_licensing = ""
    if resources:
        # Enrich subset with custom tags for context
        compressed_licensing = [_compress_resource(r) for r in resources[:80]]
        _enrich_with_custom_tags(compressed_licensing)
        tag_context_licensing = _build_tag_summary(compressed_licensing)

        for r in resources[:200]:
            rtype = r.get("resource_type", "") if isinstance(r, dict) else r.resource_type
            cost = r.get("cost_current_month", 0) if isinstance(r, dict) else r.cost_current_month
            if rtype not in estate_summary:
                estate_summary[rtype] = {"count": 0, "total_cost": 0.0}
            estate_summary[rtype]["count"] += 1
            estate_summary[rtype]["total_cost"] += cost
            total_monthly_spend += cost

    prompt = f"""Analyze this enterprise Azure estate's licensing and reservation posture. Be deeply specific with resource names and dollar amounts.

{tag_context_licensing}

Think step by step:
1. Assess reservation coverage gaps and prioritize purchases
2. Identify BYOL conversion opportunities
3. Evaluate hybrid benefit utilization
4. Plan optimal commitment strategy (1yr vs 3yr vs Savings Plan)
5. Find licence waste and over-provisioning
6. Build EA/CSP renewal recommendations

=== RESERVATION COVERAGE SUMMARY ===
{json.dumps(res_summary, indent=2)}

=== RESERVATION COVERAGE BY TYPE ===
{json.dumps(type_breakdown, indent=2)}

=== TOP RESERVATION PURCHASE CANDIDATES ===
{json.dumps(purchase_plan, indent=2)}

=== LICENSING OPPORTUNITIES DETECTED ===
{json.dumps(opp_summary, indent=2, default=str)}

=== ESTATE OVERVIEW ===
Total Monthly Spend: ${total_monthly_spend:.2f}
Resource Types ({len(estate_summary)}): {json.dumps(estate_summary, indent=2, default=str)}

=== REQUIRED JSON OUTPUT ===
Return ONLY valid JSON matching this schema:
{{
  "overall_score": <0-100>,
  "overall_grade": "<A/B/C/D/F>",
  "score_breakdown": {{
    "reservation_coverage": <0-100>,
    "ahub_utilisation": <0-100>,
    "byol_optimization": <0-100>,
    "commitment_strategy": <0-100>,
    "licence_waste": <0-100>,
    "commercial_readiness": <0-100>
  }},
  "executive_summary": "<2-3 sentence overview with dollar figures>",
  "findings": [
    {{
      "severity": "critical|high|medium|low",
      "category": "reservation|ahub|byol|savings_plan|waste|commercial",
      "title": "<specific finding title>",
      "description": "<detailed finding with resource names and $ impact>",
      "monthly_impact": <number>,
      "resources_affected": ["<resource names>"],
      "remediation": "<specific steps>"
    }}
  ],
  "reservation_strategy": {{
    "immediate_purchases": [
      {{
        "resource_type": "<type>",
        "term": "1yr|3yr",
        "quantity": <number>,
        "monthly_saving": <number>,
        "rationale": "<why this term>"
      }}
    ],
    "savings_plan_recommendation": {{
      "hourly_commitment": <number>,
      "monthly_saving": <number>,
      "coverage_increase_pct": <number>,
      "rationale": "<explanation>"
    }},
    "avoid_reserving": ["<resources that are too volatile for commitment>"]
  }},
  "byol_assessment": {{
    "total_byol_potential_monthly": <number>,
    "candidates": [
      {{
        "resource_name": "<name>",
        "licence_type": "<VMware|RHEL|SLES|Oracle|Windows>",
        "monthly_saving": <number>,
        "prerequisites": "<what's needed>",
        "complexity": "low|medium|high"
      }}
    ]
  }},
  "waste_findings": [
    {{
      "type": "unused_ri|over_provisioned|expired_commitment|duplicate_licence",
      "description": "<specific waste with $ amount>",
      "monthly_waste": <number>,
      "action": "<how to fix>"
    }}
  ],
  "ea_renewal_recommendations": [
    "<specific negotiation point or action>"
  ],
  "top_actions": [
    {{
      "priority": 1,
      "action": "<specific action>",
      "monthly_saving": <number>,
      "effort": "low|medium|high",
      "timeline": "<when to do it>"
    }}
  ]
}}

CRITICAL INSTRUCTIONS:
1. Every finding MUST reference specific resource names from the data
2. Minimum 5 findings, minimum 3 top actions
3. Include actual dollar amounts — do NOT say "significant savings"
4. reservation_strategy.immediate_purchases must list specific types from the data
5. Score reservation_coverage based on the actual coverage_pct provided
6. If coverage_pct < 30%, grade should be D or F
7. Factor total_monthly_spend into recommendations — larger estates need more structured commitment
8. byol_assessment should only include candidates that appear in the LICENSING OPPORTUNITIES data
"""

    try:
        raw = _call_ai(_SYS_LICENSING, prompt, MAX_TOKENS_LICENSING)
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if "```" in raw:
                raw = raw.rsplit("```", 1)[0]
        result = json.loads(raw.strip())
        result["model"] = model
        result["available"] = True
        result["analysis_timestamp"] = datetime.now(timezone.utc).isoformat()
        tag_svc.save_ai_analysis("licensing", None, model, result, prompt_tokens=0)
        return result
    except Exception as e:
        logger.error("Licensing AI analysis failed: %s", e)
        return {"error": str(e), "available": True}


# ── Streaming analysis ────────────────────────────────────────────────────────

def stream_workload_analysis(resources: List[dict], dep_summary: dict, bcdr_summary: dict):
    """
    Generator that yields SSE-formatted chunks of the workload analysis.
    Use with FastAPI StreamingResponse.
    """
    client, model, provider = _get_ai_client_for_analysis()
    if not client:
        yield 'data: {"type":"error","message":"No AI provider configured. Set AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_KEY or ANTHROPIC_API_KEY."}\n\n'
        return

    summary    = _build_workload_summary(resources)
    compressed = [_compress_resource(r) for r in resources[:MAX_RESOURCES_FULL_CTX]]
    _enrich_with_custom_tags(compressed)
    tag_context = _build_tag_summary(compressed)

    prompt = f"""Analyse this Azure infrastructure:

SUMMARY: {json.dumps(summary)}
{tag_context}
BCDR: {json.dumps(bcdr_summary or {})}
DEPENDENCIES: {json.dumps(dep_summary or {})}
RESOURCES: {_serialize_for_ai(compressed)}

Return thorough JSON analysis with executive_summary, overall_risk_score,
key_findings, bcdr_readiness, optimization_opportunities, quick_wins,
recommended_next_steps. Be specific about Qatar Central constraints."""

    yield f'data: {json.dumps({"type":"start","model":model,"resource_count":len(resources)})}\n\n'

    try:
        if provider == "anthropic":
            buffer = ""
            with client.messages.stream(
                model      = model,
                max_tokens = MAX_TOKENS_ANALYSIS,
                system     = _SYS_WORKLOAD,
                messages   = [{"role": "user", "content": prompt}],
            ) as stream:
                for text in stream.text_stream:
                    buffer += text
                    yield f'data: {json.dumps({"type":"chunk","text":text})}\n\n'
        else:
            # Azure OpenAI - no native streaming parse, do full call
            raw_text = _call_ai(_SYS_WORKLOAD, prompt, MAX_TOKENS_ANALYSIS)
            buffer = raw_text
            yield f'data: {json.dumps({"type":"chunk","text":raw_text})}\n\n'

        # Parse final result
        raw = buffer.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if "```" in raw:
                raw = raw.rsplit("```", 1)[0]
        try:
            result = json.loads(raw.strip())
            result["model"] = model
            # Cache it
            import services.tagging_service as tag_svc
            tag_svc.save_ai_analysis("workload", None, model, result)
            yield f'data: {json.dumps({"type":"done","data":result})}\n\n'
        except json.JSONDecodeError:
            yield f'data: {json.dumps({"type":"done","data":{"raw":buffer[:2000],"model":model}})}\n\n'

    except Exception as e:
        logger.error("Stream analysis failed: %s", e)
        yield f'data: {json.dumps({"type":"error","message":str(e)})}\n\n'


# ── Semantic search helper ────────────────────────────────────────────────────

def semantic_search_resources(query: str, resources: List[dict], top_k: int = 20) -> List[dict]:
    """
    AI-powered semantic resource search.
    Uses Claude to identify resources matching a natural language query.
    Falls back to text matching if AI unavailable.
    """
    client, model, provider = _get_ai_client_for_analysis()

    if not client:
        # Fallback: simple text search
        q = query.lower()
        return [
            r for r in resources
            if q in r.get("resource_name", "").lower()
            or q in r.get("resource_type", "").lower()
            or q in r.get("resource_group", "").lower()
            or q in str(r.get("tags", {})).lower()
        ][:top_k]

    compressed = [_compress_resource(r) for r in resources]
    prompt = f"""Given this natural language query: "{query}"

Find the most relevant Azure resources from this list.
Match based on: resource name, type, purpose (inferred from name/tags), location, cost, health.

RESOURCES:
{_serialize_for_ai(compressed, indent=2)}

Return a JSON object: {{"matches": [list of resource "id" values in order of relevance], "explanation": "why these were selected"}}
Return at most {top_k} matches."""

    try:
        raw = _call_ai("You are a helpful Azure resource search assistant. Return JSON only.", prompt, 1024)
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if "```" in raw:
                raw = raw.rsplit("```", 1)[0]
        result    = json.loads(raw.strip())
        match_ids = set(result.get("matches", []))
        # Map short IDs back to full resources
        matched = [r for r in resources if r.get("resource_id", "")[-40:] in match_ids]
        return matched[:top_k]
    except Exception as e:
        logger.warning("Semantic search failed: %s — falling back to text search", e)
        q = query.lower()
        return [
            r for r in resources
            if q in r.get("resource_name", "").lower()
            or q in r.get("resource_type", "").lower()
        ][:top_k]


# ── AI Networking Analysis ────────────────────────────────────────────────────

_SYS_NETWORKING = """You are a **Principal Azure Network Architect** conducting an enterprise network assessment for a customer engagement.

Your analysis MUST be:
- **Specific**: Reference actual VNet names, firewall names, regions, IP addresses, SKU tiers from the data. NEVER give generic advice like "consider deploying a firewall" — instead say "VNet 'hub-weu-01' in westeurope has no Azure Firewall despite hosting GatewaySubnet and 5 spoke peerings, leaving all east-west traffic unfiltered."
- **Analytical**: Explain the WHY behind each finding. Don't just list issues — explain the business impact, blast radius, and attack surface implications.
- **Quantified**: Estimate blast radius ("if firewall fw-hub-01 fails, 8 spokes lose internet egress"), cost impact ("VpnGw3 at ~$1,095/mo is oversized for <500Mbps throughput — VpnGw2 saves ~$450/mo"), and risk probability.
- **Actionable**: Every finding must have concrete remediation steps with Azure CLI commands, portal paths, or Bicep/Terraform snippets where appropriate.
- **Enterprise-context-aware**: Consider real-world patterns — hub-spoke with forced tunneling, NVA sandwich topologies, ER+VPN coexistence, DNS private resolver chains, Azure Route Server for BGP, micro-segmentation via NSG+ASG.

DEPTH REQUIREMENTS:
1. For EACH hub VNet: assess firewall SKU vs workload (Standard for basic filtering, Premium for IDPS/TLS), gateway sizing vs ER bandwidth, NVA role and HA config
2. For EACH spoke: verify UDR 0.0.0.0/0 → hub firewall IP, gateway transit config, forwarded traffic enabled, NSG coverage per subnet
3. For multi-region: assess global peering latency impact, DNS resolution strategy, active-active vs active-passive DR, data sovereignty
4. For routing: identify every route table, check for missing default routes, asymmetric paths, BGP propagation conflicts
5. For security: map the kill chain — external exposure (PIPs without NSG) → lateral movement (flat network) → data exfiltration (no egress filtering)

Score 0-100 where: 90+ = enterprise-ready, 70-89 = good with gaps, 50-69 = significant issues, <50 = major redesign needed.

CUSTOM TAG AWARENESS:
When custom tags are provided, use Criticality to prioritize network security findings
for Mission Critical workloads, and use Application/WorkloadName tags to group network
segmentation recommendations by application boundary.

Output strict JSON only. No markdown fences. No prose outside JSON values."""


def analyze_networking_ai(
    networking_summary: dict,
    resources: Optional[List[dict]] = None,
    force_refresh: bool = False,
    topology: Optional[dict] = None,
) -> dict:
    """
    AI-powered deep analysis of the networking estate.
    Takes the output of networking_service.build_networking_dashboard() plus raw resources.
    Returns comprehensive assessment with scoring, findings, and ACR opportunities.
    """
    import services.tagging_service as tag_svc

    if not force_refresh:
        cached = tag_svc.get_latest_ai_analysis("networking", None, max_age_hours=12)
        if cached:
            return {**cached["result"], "_cached": True, "_cached_at": cached["analyzed_at"]}

    client, model, provider = _get_ai_client_for_analysis()
    if not client:
        return {
            "error": "AI provider not configured. Please add ANTHROPIC_API_KEY or AZURE_OPENAI_ENDPOINT.",
            "available": False,
        }

    # Build compact context for the AI
    kpi = networking_summary.get("kpi", {})
    sec = networking_summary.get("security_posture", {})
    arch = networking_summary.get("architecture_review", {})
    issues = networking_summary.get("design_issues", [])
    acr_opps = networking_summary.get("acr_opportunities", [])
    pip_analysis = networking_summary.get("public_ip_analysis", {})
    nsg_analysis = networking_summary.get("nsg_analysis", {})
    topo = topology or {}

    # Build custom tag context from networking resources
    net_tag_context = ""
    if resources:
        net_compressed = [_compress_resource(r) for r in resources[:60]]
        _enrich_with_custom_tags(net_compressed)
        net_tag_context = _build_tag_summary(net_compressed)

    # Build topology context sections
    topo_sections = ""
    if topo and not topo.get("error"):
        topo_sections = f"""

=== DEEP TOPOLOGY ANALYSIS (from Azure Resource Graph) ===

TOPOLOGY TYPE: {topo.get('topology_type', 'Unknown')}
MULTI-REGION: {topo.get('multi_region', False)}
HUB REGIONS: {json.dumps(topo.get('hub_regions', []))}

HUB VNETS ({len(topo.get('hubs', []))}):
{json.dumps(topo.get('hubs', []), indent=2)}

SPOKE VNETS ({len(topo.get('spokes', []))}):
{json.dumps(topo.get('spokes', []), indent=2)}

STANDALONE/ISOLATED VNETS ({len(topo.get('standalone_vnets', []))}):
{json.dumps(topo.get('standalone_vnets', []), indent=2)}

GLOBAL VNET PEERINGS (cross-region hub-to-hub):
{json.dumps(topo.get('global_peerings', []), indent=2)}

PEERING HEALTH: {json.dumps(topo.get('peering_health', {}), indent=2)}

AZURE FIREWALLS:
{json.dumps(topo.get('firewall_details', []), indent=2)}

FIREWALL POLICIES:
{json.dumps(topo.get('fw_policies', []), indent=2)}

VPN/EXPRESSROUTE GATEWAYS:
{json.dumps(topo.get('gateway_details', []), indent=2)}

EXPRESSROUTE CIRCUITS:
{json.dumps(topo.get('er_circuits', []), indent=2)}

NVA APPLIANCES (IP-forwarding enabled):
{json.dumps(topo.get('nva_appliances', []), indent=2)}

ROUTE TABLE ANALYSIS:
{json.dumps(topo.get('route_analysis', {}), indent=2)}

DETECTED CONNECTIVITY GAPS:
{json.dumps(topo.get('connectivity_gaps', []), indent=2)}

=== END TOPOLOGY ===
"""

    prompt = f"""You are conducting a network assessment for an enterprise Azure customer. Analyze ALL the data below thoroughly.
Think step by step: (1) understand the topology shape, (2) identify security exposure, (3) evaluate architecture maturity, (4) find cost waste, (5) map attack surface, (6) build prioritized remediation plan.

{net_tag_context}

=== CUSTOMER NETWORKING DATA ===

NETWORKING KPI:
{json.dumps(kpi, indent=2)}

SECURITY POSTURE:
{json.dumps(sec, indent=2)}

ARCHITECTURE (basic detection):
{json.dumps(arch, indent=2)}

PUBLIC IP ANALYSIS:
{json.dumps(pip_analysis, indent=2)}

NSG ANALYSIS:
{json.dumps(nsg_analysis, indent=2)}

DETECTED DESIGN ISSUES ({len(issues)}):
{json.dumps(issues[:20], indent=2)}

COMPONENT INVENTORY:
{json.dumps(networking_summary.get("component_inventory", {}), indent=2)}

REGIONAL DISTRIBUTION:
{json.dumps(networking_summary.get("regional_distribution", {}), indent=2)}

ACR OPPORTUNITIES ALREADY IDENTIFIED ({len(acr_opps)}):
{json.dumps(acr_opps[:10], indent=2)}

HIGH-RISK RESOURCES:
{json.dumps(networking_summary.get("high_risk_resources", [])[:10], indent=2)}

COST BREAKDOWN:
{json.dumps(networking_summary.get("cost_breakdown", {}), indent=2)}
{topo_sections}

Return a JSON object with this EXACT structure:

{{
  "overall_network_score": <0-100 integer>,
  "score_breakdown": {{
    "architecture_design": <0-100>,
    "security_posture": <0-100>,
    "redundancy_resilience": <0-100>,
    "monitoring_observability": <0-100>,
    "cost_efficiency": <0-100>,
    "zero_trust_readiness": <0-100>,
    "hub_spoke_design": <0-100>,
    "routing_hygiene": <0-100>
  }},
  "risk_level": "Critical|High|Medium|Low",
  "executive_summary": "3-4 sentence summary referencing actual topology type, hub/spoke counts, key risks",

  "topology_assessment": {{
    "detected_pattern": "Multi-Region Hub-Spoke|Single Hub-Spoke|Virtual WAN|Flat|...",
    "design_quality": "Poor|Fair|Good|Excellent",
    "hub_analysis": [
      {{
        "hub_name": "<actual hub VNet name>",
        "region": "<region>",
        "role": "Primary Regional Hub|Secondary Hub|Transit Hub",
        "spoke_count": <number>,
        "firewall_assessment": "description of firewall config quality, SKU appropriateness, policy status",
        "gateway_assessment": "description of VPN/ER gateway config, SKU sizing, redundancy",
        "nva_assessment": "description of NVA presence and role if any",
        "strengths": ["str1"],
        "issues": ["issue1"],
        "recommendations": ["rec1"]
      }}
    ],
    "spoke_assessment": {{
      "total_spokes": <number>,
      "properly_connected": <number>,
      "using_remote_gateway": <number>,
      "forced_tunnel_compliant": <number>,
      "issues": ["spokes not using gateway transit", "spokes without UDR to firewall"]
    }},
    "multi_region_assessment": {{
      "is_multi_region": true|false,
      "regions": ["region1", "region2"],
      "global_peering_status": "Connected|Missing|Partial",
      "cross_region_routing": "description of how traffic flows between regions",
      "dns_resolution_strategy": "assessment or recommendation",
      "failover_capability": "None|Partial|Full",
      "latency_considerations": "cross-region latency analysis",
      "recommendations": ["rec1", "rec2"]
    }},
    "routing_assessment": {{
      "forced_tunneling": "All traffic routed through firewall|Partial|Not configured",
      "default_route_coverage": "X of Y spoke route tables have 0.0.0.0/0 → firewall",
      "bgp_propagation": "assessment of BGP settings",
      "black_hole_risks": ["any routes to None or missing next-hops"],
      "asymmetric_routing_risk": "Low|Medium|High",
      "recommendations": ["rec1"]
    }},
    "blast_radius_analysis": {{
      "single_points_of_failure": ["if hub-fw-1 goes down, 5 spokes lose connectivity"],
      "max_blast_radius": "description of worst-case failure scenario",
      "mitigation_recommendations": ["rec1"]
    }},
    "connectivity_gaps": [
      {{
        "gap_type": "type",
        "severity": "Critical|High|Medium|Low",
        "affected_resource": "<name>",
        "description": "detailed gap description",
        "remediation": "specific fix"
      }}
    ]
  }},

  "architecture_assessment": {{
    "topology_type": "Hub-Spoke|Virtual WAN|Flat|Mesh|Custom",
    "design_quality": "Poor|Fair|Good|Excellent",
    "strengths": ["strength 1", "strength 2"],
    "weaknesses": ["weakness 1", "weakness 2"],
    "scalability_rating": "Low|Medium|High",
    "dr_readiness": "None|Basic|Good|Excellent"
  }},

  "security_findings": [
    {{
      "finding_id": "SEC-001",
      "title": "brief title",
      "severity": "Critical|High|Medium|Low",
      "category": "Access Control|Encryption|Segmentation|DDoS|WAF|Monitoring|Firewall|Routing",
      "description": "detailed finding referencing actual resource names",
      "business_impact": "impact description",
      "remediation": "specific fix steps with CLI/portal guidance",
      "effort": "Low|Medium|High",
      "acr_opportunity": true|false
    }}
  ],

  "performance_insights": [
    {{
      "title": "...",
      "severity": "High|Medium|Low",
      "description": "...",
      "recommendation": "..."
    }}
  ],

  "cost_optimization": {{
    "total_networking_spend": <number>,
    "estimated_waste": <number>,
    "optimization_actions": [
      {{
        "title": "...",
        "monthly_savings": <number>,
        "effort": "Low|Medium|High",
        "action": "..."
      }}
    ]
  }},

  "acr_opportunities": [
    {{
      "service": "Azure Firewall Premium|DDoS Protection|Front Door|Private Link|Bastion|WAF|vWAN|Traffic Analytics|ExpressRoute|Route Server|Azure DNS Private Resolver",
      "priority": "High|Medium|Low",
      "estimated_monthly_acr": <number>,
      "business_justification": "...",
      "implementation_complexity": "Low|Medium|High",
      "quick_win": true|false
    }}
  ],

  "zero_trust_assessment": {{
    "score": <0-100>,
    "maturity_level": "Initial|Developing|Defined|Managed|Optimized",
    "gaps": ["gap 1", "gap 2"],
    "next_steps": ["step 1", "step 2"]
  }},

  "compliance_status": {{
    "encryption_in_transit": "Full|Partial|None",
    "network_segmentation": "Strong|Moderate|Weak|None",
    "least_privilege_access": "Implemented|Partial|Not Implemented",
    "logging_monitoring": "Comprehensive|Partial|Minimal|None"
  }},

  "recommendations": [
    {{
      "rec_id": "NET-001",
      "title": "...",
      "priority": "P1|P2|P3|P4",
      "category": "Security|Performance|Cost|Architecture|Compliance|Hub-Spoke|Multi-Region",
      "description": "referencing actual hub/spoke names and regions",
      "estimated_monthly_acr": <number or 0>,
      "implementation_steps": ["step 1", "step 2"],
      "quick_win": true|false
    }}
  ],

  "30_day_plan": ["action 1 — specific to this topology", "action 2", "action 3"],
  "90_day_plan": ["initiative 1 — strategic for this architecture", "initiative 2"]
}}

CRITICAL INSTRUCTIONS FOR HIGH-QUALITY OUTPUT:
1. Reference ACTUAL resource names, IPs, regions, and SKUs from the data above — never generic placeholders
2. For hub-spoke: evaluate EACH hub individually — firewall SKU appropriateness, gateway HA config, spoke UDR coverage
3. For multi-region: assess global peering state, cross-hub DNS strategy, failover paths, ER circuit redundancy
4. For firewalls: analyze SKU tier (Standard lacks IDPS/TLS — recommend Premium if needed), threat intel mode, policy hierarchy
5. For gateways: check active-active, BGP, SKU vs actual ER bandwidth, VPN+ER coexistence
6. Blast radius: "If [specific firewall] fails, [X] spokes in [region] lose [specific capability]"
7. Security findings must map attack chain: exposure → lateral movement → data exfiltration
8. Each recommendation must have: specific resource, concrete action, estimated effort, expected outcome
9. Cost optimization: quote actual SKU costs (e.g., "Firewall Premium ~$1,752/mo vs Standard ~$912/mo")
10. ACR opportunities: estimate monthly revenue with justification specific to THIS environment's gaps
11. 30-day plan: immediate security fixes and quick wins with specific resource names
12. 90-day plan: strategic architecture improvements with migration approach
13. MINIMUM 5 security findings, 5 recommendations, 3 ACR opportunities — be thorough
14. If topology data shows a flat/simple network, focus on WHAT they're missing and the risk of their current design
15. Executive summary must mention specific numbers: VNet count, firewall count, peering state, top risk"""

    try:
        logger.info("Starting AI networking analysis with %s", provider)

        if provider == "anthropic":
            response = client.messages.create(
                model=model,
                max_tokens=MAX_TOKENS_NETWORKING,
                system=_SYS_NETWORKING,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = response.content[0].text.strip()
        else:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": _SYS_NETWORKING},
                    {"role": "user", "content": prompt},
                ],
                max_completion_tokens=MAX_TOKENS_NETWORKING,
                temperature=0.2,
                response_format={"type": "json_object"},
            )
            raw = response.choices[0].message.content.strip()

        # Strip markdown fences
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if "```" in raw:
                raw = raw.rsplit("```", 1)[0]

        result = json.loads(raw.strip())
        result["model"] = model
        result["provider"] = provider
        result["analysis_timestamp"] = datetime.now(timezone.utc).isoformat()
        result["available"] = True

        # Cache
        tag_svc.save_ai_analysis("networking", None, model, result, prompt_tokens=0)

        logger.info(
            "Networking AI analysis complete — Score: %d/100, Findings: %d, ACR opps: %d",
            result.get("overall_network_score", 0),
            len(result.get("security_findings", [])),
            len(result.get("acr_opportunities", [])),
        )
        return result

    except json.JSONDecodeError as e:
        logger.error("Networking AI analysis JSON parse error: %s", e)
        return {"error": f"Failed to parse AI response: {e}", "available": True}
    except Exception as e:
        logger.error("Networking AI analysis failed: %s", e, exc_info=True)
        return {"error": str(e), "available": True}
