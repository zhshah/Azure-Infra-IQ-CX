"""
Identity & Access service — RBAC posture via Azure Resource Graph.

Surfaces role assignments across the estate (authorizationresources), classifies
them by principal type and privilege level, and highlights high-privilege grants
(Owner / User Access Administrator / RBAC Administrator) and broad-scope grants.
ARG-based — resilient, no warehouse dependency. Degrades gracefully.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from services.resource_graph_service import query_resource_graph

logger = logging.getLogger(__name__)

# Well-known built-in role definition GUIDs (role definitions are not fully
# enumerable via ARG, so we map the important ones by their stable GUIDs).
_BUILTIN_ROLES = {
    "8e3af657-a8ff-443c-a75c-2fe8c4bcb635": "Owner",
    "b24988ac-6180-42a0-ab88-20f7382dd24c": "Contributor",
    "acdd72a7-3385-48ef-bd42-f606fba81ae7": "Reader",
    "18d7d88d-d35e-4fb5-a5c3-7773c20a72d9": "User Access Administrator",
    "f58310d9-a9f6-439a-9e8d-f62e7b41a168": "Role Based Access Control Administrator",
    "b1be1c3e-b65d-4f19-8427-f6fa0d97feb9": "Key Vault Administrator",
    "00482a5a-887f-4fb3-b363-3b7fe8e74483": "Key Vault Administrator (legacy)",
    "fb1c8493-542b-48eb-b624-b4c8fea62acd": "Security Admin",
}
_PRIVILEGED = {"Owner", "User Access Administrator", "Role Based Access Control Administrator", "Contributor"}

_ASSIGNMENTS_KQL = """
authorizationresources
| where type =~ 'microsoft.authorization/roleassignments'
| extend p = properties
| project roleDefinitionId = tostring(p.roleDefinitionId),
          principalId = tostring(p.principalId),
          principalType = tostring(p.principalType),
          scope = tostring(p.scope),
          createdOn = tostring(p.createdOn),
          subscriptionId
"""

_ROLEDEFS_KQL = """
authorizationresources
| where type =~ 'microsoft.authorization/roledefinitions'
| extend p = properties
| project defId = tolower(tostring(id)), roleName = tostring(p.roleName), roleType = tostring(p.type)
"""


def _role_guid(role_def_id: str) -> str:
    return (role_def_id or "").rstrip("/").split("/")[-1].lower()


def _scope_level(scope: str) -> str:
    s = (scope or "").lower()
    if "/providers/microsoft.management/managementgroups/" in s:
        return "Management Group"
    if "/resourcegroups/" in s and "/providers/" in s:
        return "Resource"
    if "/resourcegroups/" in s:
        return "Resource Group"
    if s.startswith("/subscriptions/"):
        return "Subscription"
    return "Other"


def get_access_overview(subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """RBAC posture: assignment counts, principal-type mix, privileged grants."""
    try:
        assignments = query_resource_graph(_ASSIGNMENTS_KQL, subscription_ids, max_results=20000)
    except Exception as exc:
        logger.warning("identity: role assignments query failed: %s", exc)
        assignments = []
    try:
        defs = query_resource_graph(_ROLEDEFS_KQL, subscription_ids, max_results=20000)
    except Exception as exc:
        logger.warning("identity: role definitions query failed: %s", exc)
        defs = []

    custom_names = {}
    for d in defs:
        custom_names[_role_guid(d.get("defId", ""))] = d.get("roleName", "")

    by_principal: Dict[str, int] = {}
    by_role: Dict[str, int] = {}
    by_scope_level: Dict[str, int] = {}
    items: List[Dict[str, Any]] = []
    privileged: List[Dict[str, Any]] = []

    for a in assignments:
        guid = _role_guid(a.get("roleDefinitionId", ""))
        role_name = _BUILTIN_ROLES.get(guid) or custom_names.get(guid) or "Custom/Other"
        ptype = a.get("principalType") or "Unknown"
        scope_lvl = _scope_level(a.get("scope", ""))
        by_principal[ptype] = by_principal.get(ptype, 0) + 1
        by_role[role_name] = by_role.get(role_name, 0) + 1
        by_scope_level[scope_lvl] = by_scope_level.get(scope_lvl, 0) + 1
        item = {
            "role_name": role_name,
            "principal_type": ptype,
            "principal_id": a.get("principalId", ""),
            "scope": a.get("scope", ""),
            "scope_level": scope_lvl,
            "subscription_id": a.get("subscriptionId", ""),
            "created_on": a.get("createdOn", ""),
            "is_privileged": role_name in _PRIVILEGED,
        }
        items.append(item)
        if role_name in _PRIVILEGED:
            privileged.append(item)

    privileged.sort(key=lambda x: (x["scope_level"] != "Management Group", x["scope_level"] != "Subscription"))
    items.sort(key=lambda x: (not x["is_privileged"], x["role_name"]))

    return {
        "total_assignments": len(assignments),
        "privileged_assignments": len(privileged),
        "owner_assignments": by_role.get("Owner", 0),
        "guest_or_external": by_principal.get("User", 0),  # full guest detection needs Microsoft Graph
        "service_principals": by_principal.get("ServicePrincipal", 0),
        "managed_identities": by_principal.get("ServicePrincipal", 0),
        "by_principal_type": by_principal,
        "by_role": dict(sorted(by_role.items(), key=lambda kv: -kv[1])),
        "by_scope_level": by_scope_level,
        "items": items[:1000],
        "privileged": privileged[:500],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def get_identity_posture(subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Unified Identity & Access posture: RBAC over-permissioning + Entra ID
    directory (app-registration credential expiry, users/guests via Microsoft
    Graph) + best-practice findings and a posture score."""
    rbac = get_access_overview(subscription_ids)
    items = rbac.get("items", [])

    try:
        from services import graph_service
        apps = graph_service.get_app_registrations()
    except Exception as exc:
        logger.warning("identity: app registrations fetch failed: %s", exc)
        apps = {"available": False, "items": [], "note": str(exc)}
    try:
        from services import graph_service as _g
        directory = _g.get_directory_overview()
    except Exception as exc:
        logger.warning("identity: directory overview failed: %s", exc)
        directory = {"available": False, "note": str(exc)}

    findings: List[Dict[str, Any]] = []

    def add(sev: str, title: str, detail: str, rec: str, count: Optional[int] = None) -> None:
        findings.append({"severity": sev, "title": title, "detail": detail,
                         "recommendation": rec, "count": count})

    # ── RBAC over-permissioning ──
    mg_priv = [i for i in items if i["is_privileged"] and i["scope_level"] == "Management Group"]
    if mg_priv:
        add("high", f"{len(mg_priv)} privileged role assignment(s) at Management Group scope",
            "Owner / User Access Administrator / RBAC Administrator / Contributor granted at management-group scope "
            "inherits down to every child subscription and resource — a very large blast radius.",
            "Re-scope to the specific subscriptions / resource groups that genuinely need access and use Privileged "
            "Identity Management (PIM) for just-in-time elevation instead of standing access.", len(mg_priv))

    owners = rbac.get("owner_assignments", 0)
    if owners > 5:
        add("medium", f"{owners} standing Owner role assignments",
            "A high number of permanent Owner grants increases the impact if any one identity is phished or leaked.",
            "Keep Owners to a minimal break-glass set, move daily work to Contributor + specific data-plane roles, "
            "and enable PIM so Owner is time-bound and approved.", owners)

    sub_owner = [i for i in items if i["role_name"] == "Owner" and i["scope_level"] == "Subscription"]
    if len(sub_owner) > 3:
        add("medium", f"{len(sub_owner)} Owner assignments at subscription scope",
            "Subscription-level Owner grants full control of every resource in the subscription.",
            "Down-scope to resource-group Owner/Contributor where possible and review each grant's business need.", len(sub_owner))

    sp_priv = [i for i in items if i["is_privileged"] and i["principal_type"] == "ServicePrincipal"]
    if sp_priv:
        add("high", f"{len(sp_priv)} service principal(s) / app identities with privileged roles",
            "Automation identities holding Owner or Contributor are a prime target for lateral movement and "
            "supply-chain attacks because their credentials often live in pipelines and config.",
            "Scope each automation identity to exactly the resources it manages, avoid Owner, and rotate + monitor "
            "its credentials. Prefer managed identities over app secrets.", len(sp_priv))

    total = rbac.get("total_assignments", 0)
    priv = rbac.get("privileged_assignments", 0)
    if total and priv / total > 0.3:
        add("medium", f"{round(priv / total * 100)}% of role assignments are highly privileged",
            f"{priv} of {total} assignments grant Owner/Contributor/UAA/RBAC-Admin — least-privilege is not being applied.",
            "Replace broad roles with the most specific built-in role for each job (e.g. 'Storage Blob Data Reader' "
            "instead of Contributor) and review assignments quarterly.", priv)

    # ── App registration / credential hygiene (Entra ID via Graph) ──
    if apps.get("available"):
        if apps.get("expired"):
            add("high", f"{apps['expired']} app registration(s) with EXPIRED credentials",
                "Expired client secrets / certificates cause authentication outages and signal apps whose lifecycle "
                "is not being managed.",
                "Rotate or remove expired credentials, move to certificate-based auth, and automate rotation with alerting.",
                apps["expired"])
        if apps.get("expiring_30"):
            add("medium", f"{apps['expiring_30']} app registration(s) expiring within 30 days",
                "These credentials will break authentication imminently.",
                "Rotate the secrets / certificates now and configure expiry alerts (e.g. via Azure Monitor / Logic App).",
                apps["expiring_30"])
        if apps.get("expiring_90"):
            add("low", f"{apps['expiring_90']} app registration(s) expiring within 90 days",
                "Upcoming credential expiries to plan rotation for.",
                "Schedule rotation ahead of the deadline to avoid last-minute outages.", apps["expiring_90"])
    else:
        add("info", "Entra ID directory data is not available",
            apps.get("note", "Microsoft Graph access is not configured."),
            "Grant the application's service principal Microsoft Graph read permissions (Directory.Read.All + "
            "Application.Read.All) so app-registration expiry, users and guest analysis can be surfaced.")

    if directory.get("available") and directory.get("guest_users"):
        add("info", f"{directory['guest_users']} guest (external) account(s) in the directory",
            "Guest accounts extend your identity boundary to external organisations.",
            "Review guests regularly with Access Reviews, remove stale guests, and restrict what guests can see.",
            directory["guest_users"])

    sev_weight = {"high": 15, "medium": 8, "low": 3, "info": 0}
    score = max(0, 100 - sum(sev_weight.get(f["severity"], 0) for f in findings))
    sev_order = {"high": 0, "medium": 1, "low": 2, "info": 3}
    findings.sort(key=lambda f: sev_order.get(f["severity"], 4))

    return {
        "score": score,
        "summary": {
            "total_assignments": rbac.get("total_assignments", 0),
            "privileged_assignments": rbac.get("privileged_assignments", 0),
            "owner_assignments": owners,
            "service_principals": rbac.get("service_principals", 0),
            "mg_privileged": len(mg_priv),
            "sp_privileged": len(sp_priv),
            "app_registrations": apps.get("total") if apps.get("available") else None,
            "apps_expired": apps.get("expired") if apps.get("available") else None,
            "apps_expiring_30": apps.get("expiring_30") if apps.get("available") else None,
            "total_users": directory.get("total_users") if directory.get("available") else None,
            "guest_users": directory.get("guest_users") if directory.get("available") else None,
            "high_findings": sum(1 for f in findings if f["severity"] == "high"),
        },
        "findings": findings,
        "role_assignments": items,
        "privileged": rbac.get("privileged", []),
        "app_registrations": apps,
        "directory": directory,
        "by_principal_type": rbac.get("by_principal_type", {}),
        "by_scope_level": rbac.get("by_scope_level", {}),
        "by_role": rbac.get("by_role", {}),
        "graph_available": bool(apps.get("available")),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
