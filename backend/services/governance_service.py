"""
Governance service — Azure Policy compliance posture via Azure Resource Graph.

Reads policy compliance states (policyresources / microsoft.policyinsights/policystates),
policy assignments, and exemptions to surface compliant vs non-compliant resources,
the worst-offending policies, and assignment/exemption counts. ARG-based — resilient,
degrades gracefully.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from services.resource_graph_service import query_resource_graph

logger = logging.getLogger(__name__)

_STATES_KQL = """
policyresources
| where type =~ 'microsoft.policyinsights/policystates'
| extend p = properties
| project complianceState = tostring(p.complianceState),
          policyAssignmentName = tostring(p.policyAssignmentName),
          policyAssignmentId = tolower(tostring(p.policyAssignmentId)),
          policyDefinitionName = tostring(p.policyDefinitionName),
          policyDefinitionId = tolower(tostring(p.policyDefinitionId)),
          policyDefinitionAction = tostring(p.policyDefinitionAction),
          policySetDefinitionId = tolower(tostring(p.policySetDefinitionId)),
          resourceId = tostring(p.resourceId),
          resourceType = tostring(p.resourceType),
          resourceGroup = tostring(p.resourceGroup),
          subscriptionId
"""

_ASSIGNMENTS_KQL = """
policyresources
| where type =~ 'microsoft.authorization/policyassignments'
| extend p = properties
| project name, id = tolower(id), displayName = tostring(p.displayName), scope = tostring(p.scope),
          policyDefinitionId = tolower(tostring(p.policyDefinitionId)),
          enforcementMode = tostring(p.enforcementMode), subscriptionId
"""

# Policy + initiative (set) definitions — for display names, category and type.
_DEFINITIONS_KQL = """
policyresources
| where type in~ ('microsoft.authorization/policydefinitions','microsoft.authorization/policysetdefinitions')
| extend p = properties
| project name, id = tolower(id), displayName = tostring(p.displayName),
          category = tostring(p.metadata.category), policyType = tostring(p.policyType),
          isInitiative = (type =~ 'microsoft.authorization/policysetdefinitions')
"""

_EXEMPTIONS_KQL = """
policyresources
| where type =~ 'microsoft.authorization/policyexemptions'
| extend p = properties
| project name, displayName = tostring(p.displayName),
          exemptionCategory = tostring(p.exemptionCategory),
          expiresOn = tostring(p.expiresOn), subscriptionId
"""


def _name_from_id(rid: str) -> str:
    return (rid or "").rstrip("/").split("/")[-1]


_PA_MARKER = "/providers/microsoft.authorization/policyassignments/"


def _scope_from_assignment_id(aid: str) -> str:
    if not aid:
        return ""
    low = aid.lower()
    if _PA_MARKER in low:
        return aid[: low.index(_PA_MARKER)]
    return ""


def _scope_level(scope: str) -> str:
    s = (scope or "").lower()
    if not s:
        return "—"
    if "/managementgroups/" in s:
        return "Management Group"
    if "/resourcegroups/" in s:
        return "Resource Group"
    if s.startswith("/subscriptions/") and s.count("/") <= 2:
        return "Subscription"
    if s.startswith("/subscriptions/"):
        return "Resource"
    return "Tenant"


def _scope_name(scope: str) -> str:
    return (scope or "").rstrip("/").split("/")[-1] or "—"


_CACHE: Dict[str, Any] = {"data": None, "ts": 0.0}
_TTL_SECONDS = 300


def get_policy_compliance(subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Policy compliance rollup: compliant vs non-compliant resources + worst policies.
    Cached in-memory for 5 minutes (the policystates scan is large and slow)."""
    import time as _time
    if _CACHE["data"] is not None and (_time.time() - _CACHE["ts"]) < _TTL_SECONDS:
        return _CACHE["data"]
    try:
        states = query_resource_graph(_STATES_KQL, subscription_ids, max_results=50000)
    except Exception as exc:
        logger.warning("governance: policy states query failed: %s", exc)
        states = []
    try:
        assignments = query_resource_graph(_ASSIGNMENTS_KQL, subscription_ids, max_results=20000)
    except Exception as exc:
        logger.warning("governance: policy assignments query failed: %s", exc)
        assignments = []
    try:
        definitions = query_resource_graph(_DEFINITIONS_KQL, subscription_ids, max_results=50000)
    except Exception as exc:
        logger.warning("governance: policy definitions query failed: %s", exc)
        definitions = []
    try:
        exemptions = query_resource_graph(_EXEMPTIONS_KQL, subscription_ids, max_results=20000)
    except Exception as exc:
        logger.warning("governance: policy exemptions query failed: %s", exc)
        exemptions = []

    # ── Lookups: resolve GUID policy/assignment names to human-readable details ──
    def_by_id: Dict[str, Dict[str, Any]] = {}
    def_by_name: Dict[str, Dict[str, Any]] = {}
    for d in definitions:
        entry = {
            "display_name": d.get("displayName") or "",
            "category": d.get("category") or "",
            "policy_type": d.get("policyType") or "",
            "is_initiative": bool(d.get("isInitiative")),
        }
        if d.get("id"):
            def_by_id[d["id"]] = entry
        if d.get("name"):
            def_by_name[str(d["name"]).lower()] = entry

    assign_by_id: Dict[str, Dict[str, Any]] = {}
    assign_by_name: Dict[str, Dict[str, Any]] = {}
    for a in assignments:
        entry = {
            "display_name": a.get("displayName") or "",
            "scope": a.get("scope") or "",
            "policy_definition_id": a.get("policyDefinitionId") or "",
            "enforcement": a.get("enforcementMode") or "",
        }
        if a.get("id"):
            assign_by_id[a["id"]] = entry
        if a.get("name"):
            assign_by_name[str(a["name"]).lower()] = entry

    def _resolve(s: Dict[str, Any]):
        aid = s.get("policyAssignmentId") or ""
        aname = (s.get("policyAssignmentName") or "").lower()
        did = s.get("policyDefinitionId") or ""
        dname = (s.get("policyDefinitionName") or "").lower()
        sid = s.get("policySetDefinitionId") or ""
        a = assign_by_id.get(aid) or assign_by_name.get(aname) or {}
        d = def_by_id.get(did) or def_by_name.get(dname) or {}
        sd = def_by_id.get(sid) or {}  # parent initiative (set) definition, if any
        if not d and a.get("policy_definition_id"):
            d = def_by_id.get(a["policy_definition_id"], {})
        display = (d.get("display_name") or a.get("display_name") or sd.get("display_name")
                   or s.get("policyDefinitionName") or s.get("policyAssignmentName") or "(unknown policy)")
        category = d.get("category") or sd.get("category") or ("Regulatory Compliance" if sd else "—")
        effect = s.get("policyDefinitionAction") or a.get("enforcement") or "—"
        scope = a.get("scope") or _scope_from_assignment_id(aid)
        return display, category, effect, scope

    compliant = 0
    non_compliant = 0
    other = 0
    by_policy: Dict[str, Dict[str, Any]] = {}   # rich per-policy non-compliant rollup
    nc_items: List[Dict[str, Any]] = []
    seen_resources = set()

    for s in states:
        cs = (s.get("complianceState") or "").lower()
        rid = s.get("resourceId", "")
        if cs == "compliant":
            compliant += 1
        elif cs == "noncompliant":
            non_compliant += 1
            display, category, effect, scope = _resolve(s)
            scope_level = _scope_level(scope)
            scope_name = _scope_name(scope)
            key = s.get("policyDefinitionId") or s.get("policyDefinitionName") or display
            e = by_policy.get(key)
            if not e:
                e = {"policy": display, "category": category, "effect": effect,
                     "scope": scope_name, "scope_level": scope_level, "non_compliant": 0}
                by_policy[key] = e
            e["non_compliant"] += 1
            if len(nc_items) < 2000:
                nc_items.append({
                    "resource_id": rid,
                    "resource_name": _name_from_id(rid),
                    "resource_type": s.get("resourceType", ""),
                    "resource_group": s.get("resourceGroup", ""),
                    "policy": display,
                    "category": category,
                    "effect": effect,
                    "scope_level": scope_level,
                    "scope": scope_name,
                    "assignment": s.get("policyAssignmentName", ""),
                    "action": effect,
                    "subscription_id": s.get("subscriptionId", ""),
                })
            seen_resources.add(rid)
        else:
            other += 1

    total = compliant + non_compliant + other
    compliance_pct = round(compliant / total * 100, 1) if total else 0.0
    top_policies = sorted(by_policy.values(), key=lambda x: -x["non_compliant"])[:50]

    result = {
        "compliance_pct": compliance_pct,
        "compliant": compliant,
        "non_compliant": non_compliant,
        "other": other,
        "total_evaluations": total,
        "non_compliant_resources": len(seen_resources),
        "policy_assignments": len(assignments),
        "policy_exemptions": len(exemptions),
        "top_non_compliant_policies": top_policies,
        "non_compliant_items": nc_items,
        "exemptions": [{
            "name": e.get("displayName") or e.get("name", ""),
            "category": e.get("exemptionCategory", ""),
            "expires_on": e.get("expiresOn", ""),
            "subscription_id": e.get("subscriptionId", ""),
        } for e in exemptions[:200]],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    _CACHE["data"] = result
    _CACHE["ts"] = _time.time()
    return result
