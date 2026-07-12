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

_CACHE_TTL = 1800  # 30 min warm cache per (view, fingerprint)

_SYSTEM_PROMPT = (
    "You are a senior Microsoft Azure FinOps analyst. You receive a JSON summary "
    "of one view of an Azure cost-management dashboard. Produce concise, decision-"
    "grade analysis aligned to the FinOps Framework (Understand Usage & Cost, "
    "Quantify Business Value, Optimize, Manage). "
    "Respond with STRICT JSON only, no markdown, with this exact schema:\n"
    "{\n"
    '  "summary": "2-3 sentence executive read of the numbers",\n'
    '  "key_findings": ["short factual finding", ...],\n'
    '  "recommendations": [{"title":"", "detail":"", "impact":"high|medium|low", "est_monthly_savings": 0}],\n'
    '  "risk_flags": ["short risk or anomaly", ...],\n'
    '  "projected_savings_usd": 0\n'
    "}\n"
    "Be specific to the data. Quantify savings when possible. Max 5 findings, 5 "
    "recommendations, 4 risk flags. "
    "IMPORTANT: the data may include a `_grounding` object with AUTHORITATIVE, real "
    "resource-level facts from the customer's live Azure estate - estate totals, the "
    "top resources by cost (name/type/resource group/region/sku/utilisation/tags), cost "
    "breakdowns by service/resource group/subscription/region/TAG (cost_by_tag) plus tag "
    "coverage (tagged_pct), and concrete waste "
    "candidates (orphaned / oversized resources with current + recommended SKU). "
    "Treat `_grounding` as ground truth: cite specific resource names, resource groups, "
    "tag key=values and dollar figures from it, base recommendations on those real "
    "resources rather than generic advice, and use cost_by_tag + tagged_pct to assess "
    "cost allocation / showback and untagged spend at risk."
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
    "studio": "FOCUS: A narrative over the assembled dashboard widgets — connect spend, savings, commitments and anomalies into one story with the top 3 prioritized moves.\n",
    "alerts": "FOCUS: Triage the active budget & cost alerts — which are most urgent by dollars/threshold, likely cause, and the immediate response for each.\n",
    "compliance": "FOCUS: Assess FinOps maturity/governance posture — the biggest gaps, their spend-at-risk, and a prioritized remediation roadmap.\n",
    "warehouse": "FOCUS: Interpret the warehouse-backed estate view — top services/subscriptions/resources, anomalies present, and where the concentrated spend & waste sit.\n",
}



def _normalise_aoai_endpoint(endpoint: str) -> str:
    return re.sub(r"/openai/.*$", "", endpoint.rstrip("/")) + "/"


def _chat_completion(system: str, user: str, max_tokens: int = 1400) -> Optional[str]:
    """Provider-agnostic single chat call. Returns text or None."""
    import services.settings_service as svc
    provider = svc.get_value("ai_provider", "none")

    if provider == "azure_openai":
        endpoint = svc.get_value("AZURE_OPENAI_ENDPOINT", "")
        api_key = svc.get_value("AZURE_OPENAI_KEY", "")
        deployment = svc.get_value("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini")
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
            kwargs["max_completion_tokens"] = max(int(max_tokens) + 6000, 8000)
            kwargs["reasoning_effort"] = "low"
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
            kwargs["max_completion_tokens"] = max(int(max_tokens) * 3, 16000)
            kwargs["reasoning_effort"] = "low"
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


def _fingerprint(view: str, data: Any, filters: Any, scope: str = "", context: Any = None) -> str:
    blob = json.dumps({"v": view, "d": data, "f": filters, "s": scope, "c": context or {}}, sort_keys=True, default=str)
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
    context = context if isinstance(context, dict) else {}
    fp = _fingerprint(view, data, filters or {}, scope, context)
    cache_key = f"finops:ai:{view}:{fp}"

    # Warm cache
    if not force_refresh:
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

    user = (
        f"FinOps view: {view}\n"
        f"{_VIEW_FOCUS.get(view, '')}"
        f"Active filters: {json.dumps(filters or {}, default=str)}\n"
        f"{scope_block}"
        f"{context_block}"
        f"\nData summary (JSON):\n{json.dumps(data, default=str)[:14000]}"
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
        _e = (_g or {}).get("estate") if isinstance(_g, dict) else None
        if isinstance(_e, dict):
            grounded_on = {
                "resources": _e.get("resource_count"),
                "spend_usd": _e.get("spend_this_month_usd"),
                "tagged_pct": _e.get("tagged_pct"),
            }
    except Exception:
        grounded_on = None

    result = {
        "summary": str(parsed.get("summary", ""))[:1200],
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
        "scope": scope or None,
        "context": {k: v for k, v in context.items() if v not in (None, "", "—")} or None,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
    }

    try:
        import services.cache_service as cache
        cache.set_json(cache_key, result, ttl_seconds=_CACHE_TTL)
    except Exception:
        pass

    return result


def _safe_float(v, default=0.0) -> float:
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return default
