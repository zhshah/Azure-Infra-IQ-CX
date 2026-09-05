"""
FinOps AI service
=================

Generates AI-driven cost analysis + recommendations for every FinOps view and
for exports / the compliance scorecard. Reuses the tool's configured AI provider
(Azure OpenAI or Claude via settings_service) and caches results in Redis per
(view + data fingerprint) so the UI is fast while still allowing on-demand fresh
generations.

Returns a stable shape:
    {
      "summary": str,
      "key_findings": [str, ...],
      "recommendations": [{"title","detail","impact","est_monthly_savings"}...],
      "risk_flags": [str, ...],
      "projected_savings_usd": float,
      "provider": str,
      "generated_at": iso8601,
      "cached": bool,
    }
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_CACHE_TTL = 1800  # fallback only — the live value comes from ai_cache_ttl_hours


def ai_cache_ttl_seconds() -> int:
    """Global AI answer-cache lifetime. 0 disables caching (every run spends tokens).

    Safe to set generously: the cache key embeds a fingerprint of the view's data,
    filters, scope, context and question, so a cached answer is only ever returned
    for an identical question over identical numbers.
    """
    try:
        import services.settings_service as _s
        hours = float(_s.get_value("ai_cache_ttl_hours", 12.0))
    except Exception:
        hours = 12.0
    return max(0, int(hours * 3600))


def _reasoning_effort() -> str:
    """Reasoning depth for gpt-5.x / o-series. Single source of truth in settings."""
    try:
        import services.settings_service as _s
        return _s.get_reasoning_effort()
    except Exception:
        import os as _os
        return _os.getenv("AI_REASONING_EFFORT", "high")

_SYSTEM_PROMPT = (
    "You are a senior Microsoft Azure FinOps analyst. You receive a JSON summary "
    "of one view of an Azure cost-management dashboard. Produce concise, decision-"
    "grade analysis aligned to the FinOps Framework (Understand Usage & Cost, "
    "Quantify Business Value, Optimize, Manage). "
    "Respond with STRICT JSON only, no markdown, with this exact schema:\n"
    "{\n"
    '  "answer": "direct answer to the user question, or \\"\\" when none was asked",\n'
    '  "summary": "2-3 sentence executive read of the numbers",\n'
    '  "key_findings": ["short factual finding", ...],\n'
    '  "recommendations": [{"title":"", "detail":"", "impact":"high|medium|low", "est_monthly_savings": 0}],\n'
    '  "risk_flags": ["short risk or anomaly", ...],\n'
    '  "projected_savings_usd": 0\n'
    "}\n"
    "Be specific to the data. Quantify savings when possible. Max 5 findings, 5 "
    "recommendations, 4 risk flags. "
    "\n\nWHAT THE PAYLOAD CONTAINS:\n"
    "The top-level JSON is THE VIEW THE USER IS LOOKING AT — it is the subject of your "
    "analysis. A `_grounding` object may also be present carrying estate-wide context: "
    "`cost_basis` (the authoritative warehouse spend total, its window and scope), "
    "warehouse breakdowns (`cost_by_service` / `cost_by_resource_group` / "
    "`cost_by_subscription` / `cost_by_region`), `resource_inventory` (complete counts and "
    "tag coverage) and `resource_level_costs` (real resource names, SKUs, utilisation, tags "
    "and waste candidates).\n"
    "\nMONEY DISCIPLINE — these rules override everything else. Violating them makes the "
    "output worthless:\n"
    "1. NEVER invent, estimate, extrapolate or 'reasonably assume' a dollar figure. Every $ "
    "you write must appear verbatim in the payload or be a simple sum/difference of figures "
    "that share the SAME window, scope and cost basis. If a number you want is not supplied, "
    "write that it is not available — do not guess.\n"
    "2. The VIEW's own figures describe the user's current selection (its period, filter and "
    "grouping). `_grounding.cost_basis` is estate-wide over its own stated window. They are "
    "DIFFERENT scopes. Never blend, add or reconcile them into one number, and never use one "
    "to contradict the other. When you cite a figure, say which it is (e.g. 'in the selected "
    "30-day window' vs 'estate-wide, last 30 days').\n"
    "3. `resource_level_costs` is DELIBERATELY INCOMPLETE (Cost Management throttles "
    "per-resource queries; its `coverage_pct` states how little it covers). Use it ONLY to "
    "name and rank resources. NEVER sum it, never call it estate spend, and never present a "
    "saving as validated when it rests on those partial costs — say the saving needs "
    "resource-level billing reconciliation first.\n"
    "4. Do NOT annualise by multiplying an hourly figure by 8760, and do NOT project a short "
    "window (a few days) onto a month or year. If the window is short, say it is "
    "unrepresentative instead of scaling it.\n"
    "5. `projected_savings_usd` and every `est_monthly_savings` must be a REALISTIC MONTHLY "
    "figure traceable to supplied savings/waste data. If the payload contains no savings "
    "figures, return 0 — never a placeholder or an aspirational percentage of spend.\n"
    "6. Percentages must be computed from supplied numbers and stated with their base "
    "(e.g. '63% of the $3,297 30-day total'). Never state a percentage you cannot derive.\n"
    "\nUse `_grounding` to make the analysis concrete: cite real resource names, resource "
    "groups, regions, tag key=values and SKUs from it rather than giving generic advice. "
    "If the view's data is empty or insufficient, say so plainly instead of filling the gap "
    "with plausible-sounding numbers."
)

# Per-view focus directives so each FinOps tab produces DISTINCT, purpose-built
# analysis (not the same generic text everywhere). Injected into the user prompt.
_VIEW_FOCUS = {
    "overview": "FOCUS: An executive month-to-date read — spend trajectory vs forecast & last month, the 2-3 biggest cost drivers by name, and the single most valuable next action. Keep it board-level.\n",
    "dashboard": "FOCUS: Explain the cost breakdown the user is viewing — which groups dominate, notable shifts, and where to look next. Be specific to the grouped numbers.\n",
    "analyze": "FOCUS: Interpret this specific scope+period+dimension slice — concentration (is spend dominated by a few groups?), trend within the window, and what to drill into next.\n",
    "cost-insights": "FOCUS: Read this filtered cost estate through its dimensions — where spend concentrates (service/region/RG), the resilience posture of that spend (zone-redundant vs locally-redundant; GRS/LRS/ZRS storage), the biggest waste (idle/orphaned $) and the highest-value modernization moves (name the resource, current→target, $ saving). Be specific and grounded in the numbers.\n",
    "recommendation-studio": "FOCUS: Turn the concrete candidate actions into a prioritized, phased plan (quick wins first, then the rest). Reference each action's real resource + dollar impact; do NOT invent generic advice.\n",
    "anomalies": "FOCUS: For EACH anomaly, give the most likely root cause citing the resource groups / services and dollar deltas that moved; distinguish real change from noise; recommend an investigation step.\n",
    "cost-lens": "FOCUS: Quantify the risk-linked spend (unprotected / exposed / ungoverned) and give governance actions ranked by exposed dollars.\n",
    "savings": "FOCUS: Consolidate the savings opportunities by category, quantify realistic monthly savings, and sequence them by effort vs impact.\n",
    "commitments": "FOCUS: Assess reservation/savings-plan coverage & utilization; recommend commitment purchases with break-even and risk.\n",
    "budgets": "FOCUS: Assess budget health & burn-rate; flag which budgets will breach and what to do before they do.\n",
    "forecast": "FOCUS: Interpret the forecast vs budget/last period, call out the trend direction and drivers, and the confidence caveats.\n",
    "tag-analytics": "FOCUS: Assess tag/allocation coverage, the untagged spend at risk, and a concrete tagging remediation plan.\n",
    "chargeback": "FOCUS: Explain the allocation result per cost center, fairness of the shared-cost split, and any unallocated spend to resolve.\n",
    "unit-economics": "FOCUS: Interpret cost-per-unit vs target and MoM, whether efficiency is improving, and levers to reduce unit cost.\n",
    "executive-report": "FOCUS: A CFO-ready narrative — spend, trajectory, top risks and the prioritized savings roadmap with dollar figures.\n",
    "allocation": "FOCUS: Assess how cleanly cost is allocated across this dimension — concentration, the unallocated/unattributed spend, and the accountability gaps to close.\n",
    "cost-explorer": "FOCUS: Interpret this explorer slice (group-by + range + actual/amortized) — the dominant contributors, the trend across the points, and the next dimension to pivot into.\n",
    "cost-pulse": "FOCUS: Interpret the window the user has scrubbed to. Say what the selected period and grouping reveal that a default 30-day view would hide — concentration (does a handful of groups carry the spend?), the shape of the daily curve (steady burn vs spikes; name the peak date and how many times the daily average it was), and the direction of travel between the first and second half of the window. Name the top contributors and their share. If the window is short, warn that a few days can be unrepresentative; if long, note which contributors only dominate at that horizon. Close with the single dimension or period the user should pivot to next, and why.\n",
    "studio": "FOCUS: A narrative over the assembled dashboard widgets — connect spend, savings, commitments and anomalies into one story with the top 3 prioritized moves.\n",
    "alerts": "FOCUS: Triage the active budget & cost alerts — which are most urgent by dollars/threshold, likely cause, and the immediate response for each.\n",
    "compliance": "FOCUS: Assess FinOps maturity/governance posture — the biggest gaps, their spend-at-risk, and a prioritized remediation roadmap.\n",
    "warehouse": "FOCUS: Interpret the warehouse-backed estate view — top services/subscriptions/resources, anomalies present, and where the concentrated spend & waste sit.\n",
    "log-analytics-tables": "FOCUS: Interpret Log Analytics / Sentinel ingestion cost — which workspaces and which TABLES drive the bill, GB ingested vs retention, and whether the commitment tier matches actual ingestion. Recommend concrete levers: table-level basic/auxiliary plans for noisy low-value tables, retention trims, collection-rule filtering, and the right commitment tier. Only quantify a saving when the payload supplies the GB and rate to derive it.\n",
}



def _normalise_aoai_endpoint(endpoint: str) -> str:
    return re.sub(r"/openai/.*$", "", endpoint.rstrip("/")) + "/"


def _chat_completion(system: str, user: str, max_tokens: int = 1400) -> Optional[str]:
    """Provider-agnostic single chat call. Returns text or None."""
    import services.settings_service as svc
    provider = svc.get_value("ai_provider", "none")

    # This path does not go through ai_infra_service._call_ai, so it needs its own copy
    # of the data-availability map or the FinOps narratives would be the only ones
    # unable to tell "not collected" from zero.
    try:
        from services.data_availability_service import ai_grounding_block as _avail
        _block = _avail()
        if _block:
            system = f"{system}\n\n{_block}"
    except Exception:
        pass

    if provider == "azure_openai":
        endpoint = svc.get_value("AZURE_OPENAI_ENDPOINT", "")
        api_key = svc.get_value("AZURE_OPENAI_KEY", "")
        deployment = svc.get_value("AZURE_OPENAI_DEPLOYMENT", "gpt-5.6-sol")
        if not endpoint or not api_key:
            return None
        from openai import AzureOpenAI
        client = AzureOpenAI(
            azure_endpoint=_normalise_aoai_endpoint(endpoint),
            api_key=api_key,
            api_version="2024-12-01-preview",
        )
        low_name = (deployment or "").lower()
        is_reasoning = any(k in low_name for k in ("gpt-5", "gpt5", "o1", "o3", "o4"))
        kwargs = dict(
            model=deployment,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        if is_reasoning:
            # Reasoning models (gpt-5.x / o-series) spend part of the budget on hidden
            # reasoning — a small cap returns an EMPTY answer — and reject a custom
            # temperature. Give headroom + low effort, send no temperature.
            kwargs["max_completion_tokens"] = max(int(max_tokens) + 16000, 24000)
            kwargs["reasoning_effort"] = _reasoning_effort()
        else:
            kwargs["max_completion_tokens"] = int(max_tokens)
        try:
            resp = client.chat.completions.create(**kwargs)
        except Exception as e:
            _es = str(e).lower()
            _changed = False
            if "reasoning_effort" in _es and "reasoning_effort" in kwargs:
                kwargs.pop("reasoning_effort", None); _changed = True
            if ("max_completion_tokens" in _es or "unsupported_parameter" in _es) and "max_completion_tokens" in kwargs:
                kwargs["max_tokens"] = kwargs.pop("max_completion_tokens"); kwargs.pop("reasoning_effort", None)
                if not is_reasoning:
                    kwargs["temperature"] = 0.2
                _changed = True
            elif "temperature" in _es and "temperature" in kwargs:
                kwargs.pop("temperature", None); _changed = True
            if not _changed:
                raise
            resp = client.chat.completions.create(**kwargs)
        text = (getattr(resp.choices[0].message, "content", None) or "").strip()
        # Reasoning model starved its visible output → retry once with a bigger budget.
        if not text and is_reasoning:
            kwargs["max_completion_tokens"] = max(int(max_tokens) * 4, 32000)
            kwargs["reasoning_effort"] = _reasoning_effort()
            try:
                resp = client.chat.completions.create(**kwargs)
            except Exception:
                kwargs.pop("reasoning_effort", None)
                resp = client.chat.completions.create(**kwargs)
            text = (getattr(resp.choices[0].message, "content", None) or "").strip()
        return text or None

    if provider == "claude":
        api_key = svc.get_value("ANTHROPIC_API_KEY", "")
        if not api_key:
            return None
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        resp = client.messages.create(
            model=svc.get_value("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022"),
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return resp.content[0].text if resp.content else None

    return None


def _provider_name() -> str:
    try:
        import services.ai_service as ai
        return ai.get_active_provider()
    except Exception:
        return "none"


def _parse_json(raw: str) -> Optional[Dict[str, Any]]:
    if not raw:
        return None
    txt = raw.strip()
    # strip code fences if the model added them
    if txt.startswith("```"):
        txt = re.sub(r"^```[a-zA-Z]*\n?", "", txt)
        txt = re.sub(r"\n?```$", "", txt)
    try:
        return json.loads(txt)
    except Exception:
        m = re.search(r"\{.*\}", txt, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return None
    return None


def _fingerprint(view: str, data: Any, filters: Any, scope: str = "", context: Any = None,
                 question: str = "") -> str:
    blob = json.dumps({"v": view, "d": data, "f": filters, "s": scope, "c": context or {},
                       "q": question}, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:20]


def _empty(reason: str) -> Dict[str, Any]:
    return {
        "summary": reason,
        "key_findings": [],
        "recommendations": [],
        "risk_flags": [],
        "projected_savings_usd": 0,
        "provider": _provider_name(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
    }


def get_finops_insights(
    view: str,
    data: Dict[str, Any],
    filters: Optional[Dict[str, Any]] = None,
    force_refresh: bool = False,
    scope: Optional[str] = None,
    context: Optional[Dict[str, Any]] = None,
    question: Optional[str] = None,
) -> Dict[str, Any]:
    """Generate (or return cached) AI insights for a FinOps view.

    When `scope` is supplied (a free-text focus area such as "Storage in West
    Europe" or "Reservation coverage"), the analysis is narrowed to that area and
    cached separately so users can keep both the broad and the scoped analyses.

    `context` is an optional dict of end-user business context (industry, org
    size, primary goal, free-text notes, …) used to ground the recommendations.
    """
    provider = _provider_name()
    if provider == "none":
        return _empty("AI provider not configured. Set an Azure OpenAI or Claude key in Settings to enable AI cost analysis.")

    scope = (scope or "").strip()[:300]
    question = (question or "").strip()[:600]
    context = context if isinstance(context, dict) else {}
    fp = _fingerprint(view, data, filters or {}, scope, context, question)
    cache_key = f"finops:ai:{view}:{fp}"

    # Warm cache
    if not force_refresh and ai_cache_ttl_seconds() > 0:
        try:
            import services.cache_service as cache
            cached = cache.get_json(cache_key)
            if cached:
                cached["cached"] = True
                return cached
        except Exception:
            pass

    scope_block = ""
    if scope:
        scope_block = (
            f"\nSCOPE — Focus this analysis specifically on: {scope}\n"
            "Prioritise findings, recommendations and savings that relate to this focus area. "
            "Treat it as the lens for the whole analysis; mention unrelated parts of the data only "
            "briefly if they materially affect the focus area.\n"
        )

    context_block = ""
    ctx_items = [
        (str(k).replace("_", " ").strip(), str(v).strip())
        for k, v in context.items()
        if v not in (None, "", "—") and str(v).strip()
    ]
    if ctx_items:
        ctx_lines = "\n".join(f"- {k.title()}: {v[:240]}" for k, v in ctx_items[:12])
        context_block = (
            "\nBUSINESS CONTEXT — Ground your analysis in the following customer context. "
            "Tailor the findings, recommendations, benchmarks, prioritisation and tone to it "
            "(e.g. reflect the industry, organisation size and stated primary goal):\n"
            f"{ctx_lines}\n"
        )

    question_block = ""
    if question:
        question_block = (
            f"\nUSER QUESTION — The user asked: \"{question}\"\n"
            "Answer it directly and specifically in the `answer` field, in 2-6 sentences, using ONLY "
            "the supplied data. Cite concrete resource names, services and dollar figures. If the data "
            "cannot answer it, say exactly what is missing instead of guessing. Still populate the other "
            "fields, but bias every one of them toward the question.\n"
        )

    # Serialise the view payload and the grounding SEPARATELY so a large grounding block can
    # never truncate the view's own numbers (they are the subject of the analysis).
    _view_data = {k: v for k, v in (data or {}).items() if k != "_grounding"} if isinstance(data, dict) else data
    _grounding = (data or {}).get("_grounding") if isinstance(data, dict) else None
    grounding_block = ""
    if _grounding:
        grounding_block = (
            "\nESTATE GROUNDING (_grounding) — authoritative context, a DIFFERENT scope from the "
            "view above. Obey the MONEY DISCIPLINE rules when using it:\n"
            f"{json.dumps(_grounding, default=str)[:9000]}\n"
        )

    user = (
        f"FinOps view: {view}\n"
        f"{_VIEW_FOCUS.get(view, '')}"
        f"Active filters: {json.dumps(filters or {}, default=str)}\n"
        f"{scope_block}"
        f"{context_block}"
        f"{question_block}"
        f"\nTHE VIEW THE USER IS LOOKING AT (analyse THIS):\n{json.dumps(_view_data, default=str)[:9000]}\n"
        f"{grounding_block}"
    )

    try:
        raw = _chat_completion(_SYSTEM_PROMPT, user)
    except Exception as exc:
        logger.warning("FinOps AI insight call failed: %s", exc)
        return _empty(f"AI analysis temporarily unavailable: {exc}")

    parsed = _parse_json(raw or "")
    if not parsed:
        return _empty("AI returned an unparseable response. Try 'Refresh analysis'.")

    # Echo what the analysis was grounded on so the UI can prove it's real.
    grounded_on = None
    try:
        _g = (data or {}).get("_grounding") if isinstance(data, dict) else None
        if isinstance(_g, dict):
            _basis = _g.get("cost_basis") or {}
            _inv = _g.get("resource_inventory") or {}
            grounded_on = {
                "resources": _inv.get("resource_count"),
                "spend_usd": _basis.get("authoritative_spend_usd"),
                "tagged_pct": _inv.get("tagged_pct"),
                "cost_window": _basis.get("window"),
                "cost_source": _basis.get("source"),
            }
    except Exception:
        grounded_on = None

    result = {
        "summary": str(parsed.get("summary", ""))[:1200],
        "answer": str(parsed.get("answer", ""))[:1600] or None,
        "key_findings": [str(x)[:300] for x in (parsed.get("key_findings") or [])][:6],
        "recommendations": [
            {
                "title": str(r.get("title", ""))[:160],
                "detail": str(r.get("detail", ""))[:400],
                "impact": str(r.get("impact", "medium")).lower(),
                "est_monthly_savings": _safe_float(r.get("est_monthly_savings")),
            }
            for r in (parsed.get("recommendations") or [])
            if isinstance(r, dict)
        ][:6],
        "risk_flags": [str(x)[:300] for x in (parsed.get("risk_flags") or [])][:5],
        "projected_savings_usd": _safe_float(parsed.get("projected_savings_usd")),
        "provider": provider,
        "grounded_on": grounded_on,
        "scope": scope or None,        "question": question or None,        "context": {k: v for k, v in context.items() if v not in (None, "", "—")} or None,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
    }

    try:
        import services.cache_service as cache
        _ttl = ai_cache_ttl_seconds()
        if _ttl > 0:
            cache.set_json(cache_key, result, ttl_seconds=_ttl)
    except Exception:
        pass

    return result


def _safe_float(v, default=0.0) -> float:
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return default
