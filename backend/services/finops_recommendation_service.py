"""
FinOps Recommendation Service — scope-driven, grounded, personalized action engine.

The user sets a CONTEXT (subscription + resource group + optional tags/region/type),
picks GOALS (reduce spend / clean up waste / right-size / optimize commitments /
improve tag compliance), sets CONSTRAINTS (exclude prod, region limits, minimum $
impact), and a PRIORITY lens (cost / effort / risk / balanced). This service then:

  1. Scopes the live resource estate to that context (dashboard cache — instant,
     immune to Cost Management throttling).
  2. Extracts DETERMINISTIC candidate actions from the real per-resource signals the
     scan already computed (is_orphan, rightsize_sku, final_score, missing_tags,
     ri_eligible, advisor_recommendations) — each with a $ impact (run-rate fallback),
     effort, risk, confidence, the ready-to-run Azure CLI command, and a portal link.
  3. Applies the user's goals + constraints and ranks by the chosen priority lens.

The AI layer (finops_ai_service) then turns these concrete, grounded actions into a
personalized phased roadmap — so the narrative cites REAL resources and dollars, not
generic advice.

PURE function over a dashboard dict (like finops_advanced_service) — no Azure calls.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fnum(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _resources(dash: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not isinstance(dash, dict):
        return []
    res = dash.get("resources")
    return res if isinstance(res, list) else []


def _sub_names(dash: Optional[Dict[str, Any]]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for s in (dash.get("subscriptions") or []) if isinstance(dash, dict) else []:
        if isinstance(s, dict):
            sid = s.get("subscription_id") or s.get("id") or ""
            if sid:
                out[sid] = s.get("subscription_name") or s.get("name") or sid
    return out


# ── Run-rate cost (throttle-safe) ───────────────────────────────────────────────
def _run_rate(r: Dict[str, Any]) -> float:
    """Best monthly cost estimate for a resource. Prefer the scan's savings estimate,
    then current-month spend, then last full month (Cost Management 429-throttles the
    per-resource current-month query to $0 on large/rate-limited tenants)."""
    est = _fnum(r.get("estimated_monthly_savings"))
    if est > 0:
        return est
    cur = _fnum(r.get("cost_current_month"))
    if cur > 0:
        return cur
    return _fnum(r.get("cost_previous_month"))


def _resource_cost(r: Dict[str, Any]) -> float:
    cur = _fnum(r.get("cost_current_month"))
    return cur if cur > 0 else _fnum(r.get("cost_previous_month"))


# ── Scope matching ──────────────────────────────────────────────────────────────
def _aslist(v: Any) -> List[str]:
    if not v:
        return []
    if isinstance(v, list):
        return [str(x).lower() for x in v if x]
    return [str(v).lower()]


def _scope_filter(resources: List[Dict[str, Any]], filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    f = filters or {}
    sub_f = _aslist(f.get("subscription_id") or f.get("subscriptions"))
    rg_f = _aslist(f.get("resource_group") or f.get("resource_groups"))
    reg_f = _aslist(f.get("region") or f.get("regions") or f.get("location"))
    type_f = _aslist(f.get("resource_type") or f.get("resource_types"))
    tag_f: List[tuple] = []
    tf = f.get("tags")
    if isinstance(tf, list):
        tag_f = [(str(t.get("key", "")).lower(), str(t.get("value", "")).lower())
                 for t in tf if isinstance(t, dict) and t.get("key")]
    elif isinstance(tf, dict):
        for k, v in tf.items():
            for vv in (v if isinstance(v, list) else [v]):
                tag_f.append((str(k).lower(), str(vv).lower()))

    def _match(r: Dict[str, Any]) -> bool:
        if sub_f and str(r.get("subscription_id", "") or "").lower() not in sub_f:
            return False
        if rg_f and str(r.get("resource_group", "") or "").lower() not in rg_f:
            return False
        if reg_f and str(r.get("location", "") or "").lower() not in reg_f:
            return False
        if type_f and str(r.get("resource_type", "") or "").lower() not in type_f:
            return False
        if tag_f:
            tags = {str(k).lower(): str(v).lower() for k, v in (r.get("tags") or {}).items()}
            for tk, tv in tag_f:
                if tk not in tags or (tv and tags[tk] != tv):
                    return False
        return True

    sel = [r for r in resources if _match(r)]
    return sel


# ── Goal → category mapping ──────────────────────────────────────────────────────
# Categories emitted by the extractor and which user goal(s) select them.
_GOAL_CATEGORIES = {
    "reduce_spend":   {"waste_cleanup", "rightsizing", "commitments", "advisor"},
    "waste_cleanup":  {"waste_cleanup"},
    "rightsizing":    {"rightsizing"},
    "commitments":    {"commitments"},
    "tag_compliance": {"tag_compliance"},
    "sustainability": {"waste_cleanup", "rightsizing"},
}

_EFFORT_RANK = {"low": 0, "medium": 1, "high": 2}
_RISK_RANK = {"low": 0, "medium": 1, "high": 2}
_CONF_WEIGHT = {"high": 1.0, "medium": 0.7, "low": 0.4}


def _env_of(r: Dict[str, Any]) -> str:
    tags = {str(k).lower().replace("-", "").replace("_", ""): str(v).lower()
            for k, v in (r.get("tags") or {}).items()}
    for key in ("environment", "env"):
        if key in tags:
            return tags[key]
    return ""


def _extract_actions(sel: List[Dict[str, Any]], sub_names: Dict[str, str]) -> List[Dict[str, Any]]:
    """Deterministic candidate actions from real per-resource scan signals."""
    actions: List[Dict[str, Any]] = []

    def _base(r: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "resource_id": r.get("resource_id", "") or "",
            "resource_name": r.get("resource_name", "") or "",
            "resource_type": (r.get("resource_type", "") or ""),
            "resource_group": r.get("resource_group", "") or "",
            "subscription": sub_names.get(r.get("subscription_id", "") or "", r.get("subscription_id", "") or ""),
            "region": r.get("location", "") or "",
            "portal_url": r.get("portal_url", "") or "",
        }

    for r in sel:
        rid = r.get("resource_id", "") or ""
        # 1) Orphaned resources → delete
        if r.get("is_orphan"):
            actions.append({**_base(r), "id": f"orphan::{rid}", "category": "waste_cleanup",
                "action_type": "delete", "title": f"Delete orphaned {(r.get('resource_type','') or '').split('/')[-1]}",
                "rationale": r.get("orphan_reason") or r.get("recommendation") or "Unattached / unused resource with no dependents.",
                "monthly_impact_usd": round(_run_rate(r), 2), "effort": "low", "risk": "low",
                "confidence": "high", "cli": r.get("cli_delete_cmd", "") or ""})
            continue
        # 2) Right-size candidates
        if r.get("rightsize_sku"):
            impact = _fnum(r.get("estimated_monthly_savings"))
            if impact <= 0:
                impact = _resource_cost(r) * (_fnum(r.get("rightsize_savings_pct")) / 100.0)
            actions.append({**_base(r), "id": f"rightsize::{rid}", "category": "rightsizing",
                "action_type": "resize", "title": f"Right-size to {r.get('rightsize_sku')}",
                "rationale": r.get("recommendation") or f"Low utilization ({r.get('primary_utilization_pct')}%); downsize from {r.get('sku') or 'current SKU'}.",
                "monthly_impact_usd": round(impact, 2), "effort": "medium", "risk": "medium",
                "confidence": "high", "cli": r.get("cli_resize_cmd", "") or "",
                "current_sku": r.get("sku"), "recommended_sku": r.get("rightsize_sku")})
            continue
        # 3) Idle / underutilized (low score, not orphan/rightsize)
        score = _fnum(r.get("final_score"))
        if score and score < 25:
            actions.append({**_base(r), "id": f"idle::{rid}", "category": "waste_cleanup",
                "action_type": "review", "title": "Review idle / underutilized resource",
                "rationale": r.get("recommendation") or f"Health score {int(score)}/100 with little/no activity — deallocate or decommission.",
                "monthly_impact_usd": round(_run_rate(r), 2), "effort": "low", "risk": "medium",
                "confidence": "medium", "cli": r.get("cli_delete_cmd", "") or ""})
        # 4) Reservation / commitment opportunity
        if r.get("ri_eligible"):
            ri = max(_fnum(r.get("ri_3yr_monthly_savings")), _fnum(r.get("ri_1yr_monthly_savings")))
            if ri > 0:
                actions.append({**_base(r), "id": f"ri::{rid}", "category": "commitments",
                    "action_type": "commit", "title": "Purchase reservation / savings plan",
                    "rationale": f"Steady-state resource eligible for a 1-yr/3-yr commitment (est. ${round(ri,2)}/mo saving).",
                    "monthly_impact_usd": round(ri, 2), "effort": "low", "risk": "low", "confidence": "medium", "cli": ""})
        # 5) Tag governance
        missing = r.get("missing_tags") or []
        if missing:
            actions.append({**_base(r), "id": f"tag::{rid}", "category": "tag_compliance",
                "action_type": "tag", "title": f"Add missing tags: {', '.join(missing[:4])}",
                "rationale": "Required governance tags absent — blocks accurate allocation/chargeback.",
                "monthly_impact_usd": 0.0, "effort": "low", "risk": "low", "confidence": "high",
                "cli": (f"az resource tag --ids {rid} --tags " + " ".join(f"{t}=<value>" for t in missing[:6])) if rid else ""})
        # 6) Azure Advisor cost recommendations
        for a in (r.get("advisor_recommendations") or []):
            if isinstance(a, dict) and str(a.get("category", "")).lower() == "cost" and _fnum(a.get("potential_savings")) > 0:
                actions.append({**_base(r), "id": f"advisor::{rid}::{hash(a.get('short_description','')) & 0xffff}",
                    "category": "advisor", "action_type": "advisor",
                    "title": (a.get("short_description") or "Azure Advisor cost recommendation")[:120],
                    "rationale": f"Azure Advisor ({a.get('impact','')} impact) cost recommendation.",
                    "monthly_impact_usd": round(_fnum(a.get("potential_savings")), 2),
                    "effort": "medium", "risk": "low", "confidence": "high", "cli": ""})
    return actions


def _apply_constraints(actions: List[Dict[str, Any]], sel: List[Dict[str, Any]],
                       constraints: Dict[str, Any]) -> List[Dict[str, Any]]:
    c = constraints or {}
    excl_env = {str(x).lower() for x in _aslist(c.get("exclude_environments"))}
    allowed_regions = {str(x).lower() for x in _aslist(c.get("allowed_regions"))}
    min_impact = _fnum(c.get("min_impact_usd"))
    # Map resource_id → env for exclusion.
    env_by_id = {r.get("resource_id", ""): _env_of(r) for r in sel}
    out = []
    for a in actions:
        if excl_env and env_by_id.get(a.get("resource_id", ""), "") in excl_env:
            continue
        if allowed_regions and str(a.get("region", "")).lower() not in allowed_regions:
            continue
        # Tag-compliance actions have $0 impact by nature; don't drop them on min_impact.
        if min_impact > 0 and a.get("category") != "tag_compliance" and a.get("monthly_impact_usd", 0) < min_impact:
            continue
        out.append(a)
    return out


def _rank(actions: List[Dict[str, Any]], priority: str) -> List[Dict[str, Any]]:
    p = (priority or "balanced").lower()
    if p == "cost":
        return sorted(actions, key=lambda a: -a.get("monthly_impact_usd", 0))
    if p == "effort":
        return sorted(actions, key=lambda a: (_EFFORT_RANK.get(a.get("effort"), 1), -a.get("monthly_impact_usd", 0)))
    if p == "risk":
        return sorted(actions, key=lambda a: (_RISK_RANK.get(a.get("risk"), 1), -a.get("monthly_impact_usd", 0)))
    # balanced — reward $ impact & confidence, penalize effort & risk.
    def _score(a: Dict[str, Any]) -> float:
        impact = a.get("monthly_impact_usd", 0) or 0
        conf = _CONF_WEIGHT.get(a.get("confidence"), 0.7)
        effort = _EFFORT_RANK.get(a.get("effort"), 1) + 1
        risk = _RISK_RANK.get(a.get("risk"), 1) + 1
        return (impact + 1) * conf / (effort * (risk ** 0.5))
    return sorted(actions, key=_score, reverse=True)


def build_recommendations(
    dash: Optional[Dict[str, Any]],
    filters: Optional[Dict[str, Any]] = None,
    goals: Optional[List[str]] = None,
    constraints: Optional[Dict[str, Any]] = None,
    priority: str = "balanced",
    limit: int = 100,
) -> Dict[str, Any]:
    """Return prioritized, grounded, deterministic recommendations for the scoped
    estate. The AI narrative is generated separately by the endpoint using this
    output as ground truth."""
    resources = _resources(dash)
    if not resources:
        return {"actions": [], "action_count": 0, "category_summary": {},
                "projected_monthly_savings_usd": 0.0, "projected_annual_savings_usd": 0.0,
                "context": {"resource_count": 0, "in_scope_spend_usd": 0.0},
                "data_source": "cache_unavailable", "generated_at": _now_iso()}

    sub_names = _sub_names(dash)
    sel = _scope_filter(resources, filters or {})
    scoped = bool(sel) and len(sel) != len(resources)
    if not sel:
        sel = resources  # no scope match → whole estate (fail-open)

    actions = _extract_actions(sel, sub_names)

    # Goal filtering.
    goals = [str(g).lower() for g in (goals or []) if g]
    if goals:
        allowed: set = set()
        for g in goals:
            allowed |= _GOAL_CATEGORIES.get(g, set())
        if allowed:
            actions = [a for a in actions if a.get("category") in allowed]

    actions = _apply_constraints(actions, sel, constraints or {})
    actions = _rank(actions, priority)

    # Category summary (over ALL matched actions, before the display limit).
    cat_summary: Dict[str, Dict[str, Any]] = {}
    for a in actions:
        c = a.get("category", "other")
        e = cat_summary.setdefault(c, {"count": 0, "monthly_impact_usd": 0.0})
        e["count"] += 1
        e["monthly_impact_usd"] = round(e["monthly_impact_usd"] + (a.get("monthly_impact_usd", 0) or 0), 2)

    monthly = round(sum(a.get("monthly_impact_usd", 0) or 0 for a in actions), 2)
    in_scope_spend = round(sum(_resource_cost(r) for r in sel), 2)

    return {
        "actions": actions[:limit],
        "action_count": len(actions),
        "category_summary": cat_summary,
        "projected_monthly_savings_usd": monthly,
        "projected_annual_savings_usd": round(monthly * 12, 2),
        "context": {
            "scoped": scoped,
            "resource_count": len(sel),
            "in_scope_spend_usd": in_scope_spend,
            "goals": goals,
            "priority": (priority or "balanced").lower(),
            "constraints": constraints or {},
        },
        "data_source": "dashboard_cache",
        "generated_at": _now_iso(),
    }
