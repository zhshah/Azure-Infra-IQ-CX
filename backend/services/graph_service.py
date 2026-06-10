"""
Microsoft Graph service — Entra ID (Azure AD) directory posture.

Uses the existing Azure credential to obtain a Graph token and read directory
objects that ARM / Resource Graph cannot see: app registrations and their
credential expiry, users / guests, and service principals.

Requires the credential (service principal or signed-in user) to hold Graph
*read* permissions such as Directory.Read.All / Application.Read.All. If those
are missing, every call degrades gracefully to {available: False, note: ...}
so the UI can show a clear, actionable message instead of failing.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from services.azure_auth import get_credential

logger = logging.getLogger(__name__)

_GRAPH = "https://graph.microsoft.com/v1.0"
_SCOPE = "https://graph.microsoft.com/.default"

_token_cache: Dict[str, Any] = {"token": None, "exp": 0}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _token() -> Optional[str]:
    if _token_cache["token"] and time.time() < _token_cache["exp"] - 60:
        return _token_cache["token"]
    try:
        cred = get_credential()
        tok = cred.get_token(_SCOPE)
        _token_cache["token"] = tok.token
        _token_cache["exp"] = tok.expires_on
        return tok.token
    except Exception as exc:
        logger.warning("graph: token acquisition failed: %s", exc)
        return None


def is_available() -> bool:
    return _token() is not None


def _get(path: str, params: Optional[dict] = None, headers: Optional[dict] = None,
         timeout: float = 30.0) -> Optional[dict]:
    tok = _token()
    if not tok:
        return None
    h = {"Authorization": f"Bearer {tok}"}
    if headers:
        h.update(headers)
    url = path if path.startswith("http") else f"{_GRAPH}{path}"
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(url, params=params, headers=h)
        if resp.status_code == 403:
            logger.info("graph: 403 (insufficient permissions) for %s", path)
            return {"_forbidden": True}
        if resp.status_code >= 400:
            logger.warning("graph: %s -> HTTP %s", path, resp.status_code)
            return None
        return resp.json()
    except Exception as exc:
        logger.warning("graph: GET %s failed: %s", path, exc)
        return None


def _get_all(path: str, params: Optional[dict] = None, max_items: int = 2000,
             headers: Optional[dict] = None) -> Any:
    """Follow @odata.nextLink paging. Returns list, or {"_forbidden": True}, or None."""
    out: List[dict] = []
    data = _get(path, params, headers)
    if data is None:
        return None
    if data.get("_forbidden"):
        return {"_forbidden": True}
    while True:
        out.extend(data.get("value", []) or [])
        nxt = data.get("@odata.nextLink")
        if not nxt or len(out) >= max_items:
            break
        data = _get(nxt, None, headers)
        if not data or data.get("_forbidden"):
            break
    return out[:max_items]


def _count(path: str, filt: Optional[str] = None) -> Optional[int]:
    params = {"$count": "true", "$top": "1"}
    if filt:
        params["$filter"] = filt
    data = _get(path, params, headers={"ConsistencyLevel": "eventual"})
    if not data or data.get("_forbidden"):
        return None
    return data.get("@odata.count")


def _classify_cred(end: Optional[str]) -> tuple:
    """Return (status, days_until) for a credential endDateTime ISO string."""
    if not end:
        return ("unknown", None)
    try:
        dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return ("unknown", None)
    days = (dt - _now()).days
    if days < 0:
        return ("expired", days)
    if days <= 30:
        return ("expiring-30", days)
    if days <= 90:
        return ("expiring-90", days)
    return ("valid", days)


def get_app_registrations(max_apps: int = 1500) -> Dict[str, Any]:
    """App registrations with secret/certificate expiry analysis."""
    params = {
        "$select": "id,appId,displayName,createdDateTime,signInAudience,passwordCredentials,keyCredentials",
        "$top": "999",
    }
    apps = _get_all("/applications", params, max_items=max_apps)
    if apps is None:
        return {"available": False, "note": "Microsoft Graph not reachable or no token.", "items": []}
    if isinstance(apps, dict) and apps.get("_forbidden"):
        return {"available": False, "items": [],
                "note": "Graph permission Application.Read.All / Directory.Read.All is required to read app registrations."}

    items: List[Dict[str, Any]] = []
    expired = expiring_30 = expiring_90 = no_creds = 0
    now = _now()
    for app in apps:
        creds = []
        soonest_days = None
        worst = "valid"
        rank = {"expired": 0, "expiring-30": 1, "expiring-90": 2, "valid": 3, "unknown": 4}
        for kind, arr in (("secret", app.get("passwordCredentials") or []),
                          ("certificate", app.get("keyCredentials") or [])):
            for c in arr:
                status, days = _classify_cred(c.get("endDateTime"))
                creds.append({"type": kind, "display_name": c.get("displayName") or "",
                              "end": c.get("endDateTime"), "status": status, "days_until": days})
                if days is not None and (soonest_days is None or days < soonest_days):
                    soonest_days = days
                if rank.get(status, 5) < rank.get(worst, 5):
                    worst = status
        if not creds:
            worst = "none"
            no_creds += 1
        elif worst == "expired":
            expired += 1
        elif worst == "expiring-30":
            expiring_30 += 1
        elif worst == "expiring-90":
            expiring_90 += 1
        items.append({
            "app_id": app.get("appId", ""),
            "object_id": app.get("id", ""),
            "display_name": app.get("displayName", "") or "(unnamed)",
            "sign_in_audience": app.get("signInAudience", ""),
            "created_on": app.get("createdDateTime", ""),
            "secret_count": len(app.get("passwordCredentials") or []),
            "cert_count": len(app.get("keyCredentials") or []),
            "credential_status": worst,
            "soonest_expiry_days": soonest_days,
            "credentials": creds[:12],
        })

    rank2 = {"expired": 0, "expiring-30": 1, "expiring-90": 2, "none": 3, "valid": 4, "unknown": 5}
    items.sort(key=lambda x: (rank2.get(x["credential_status"], 6),
                              x["soonest_expiry_days"] if x["soonest_expiry_days"] is not None else 99999))
    return {
        "available": True,
        "total": len(items),
        "expired": expired,
        "expiring_30": expiring_30,
        "expiring_90": expiring_90,
        "no_credentials": no_creds,
        "items": items,
        "generated_at": now.isoformat(),
    }


def get_directory_overview() -> Dict[str, Any]:
    """High-level directory counts (users, guests, apps, service principals)."""
    if not is_available():
        return {"available": False, "note": "Microsoft Graph not reachable or no token."}
    total_users = _count("/users")
    if total_users is None:
        return {"available": False,
                "note": "Graph permission Directory.Read.All / User.Read.All is required to read the directory."}
    guests = _count("/users", "userType eq 'Guest'")
    disabled = _count("/users", "accountEnabled eq false")
    apps = _count("/applications")
    sps = _count("/servicePrincipals")
    return {
        "available": True,
        "total_users": total_users,
        "guest_users": guests,
        "member_users": (total_users - guests) if (total_users is not None and guests is not None) else None,
        "disabled_users": disabled,
        "app_registrations": apps,
        "service_principals": sps,
        "generated_at": _now().isoformat(),
    }


def get_guest_users(max_items: int = 500) -> Dict[str, Any]:
    """Guest (external) user accounts."""
    params = {"$select": "id,displayName,userPrincipalName,mail,accountEnabled,createdDateTime,externalUserState",
              "$filter": "userType eq 'Guest'", "$top": "999"}
    rows = _get_all("/users", params, max_items=max_items, headers={"ConsistencyLevel": "eventual"})
    if rows is None:
        return {"available": False, "items": [], "note": "Microsoft Graph not reachable."}
    if isinstance(rows, dict) and rows.get("_forbidden"):
        return {"available": False, "items": [],
                "note": "Graph permission User.Read.All / Directory.Read.All is required to read users."}
    items = [{
        "display_name": u.get("displayName", "") or "",
        "upn": u.get("userPrincipalName", "") or u.get("mail", "") or "",
        "enabled": bool(u.get("accountEnabled")),
        "state": u.get("externalUserState", "") or "",
        "created_on": u.get("createdDateTime", "") or "",
    } for u in rows]
    return {"available": True, "total": len(items), "items": items, "generated_at": _now().isoformat()}
