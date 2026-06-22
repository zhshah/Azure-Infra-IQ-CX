"""
Microsoft 365 Security Operations aggregator.

Ports the approach of the open-source Vigil365 project (sameerk27/vigil365) into our
Python/FastAPI stack: it uses Microsoft Graph (app-only client-credentials) to pull
security signals from Defender XDR, Entra ID Protection, Intune and Conditional Access
and aggregates them into a single dashboard payload.

Design notes (matching Vigil365's maturity model):
- READ-ONLY. Every Graph call is a GET against a *.Read.All-scoped endpoint. Nothing is
  ever modified in the tenant.
- GRACEFUL DEGRADATION. Each signal is fetched independently; if a permission or license
  is missing (403 / 404) or no credentials are configured, that card falls back to a
  representative SAMPLE so the dashboard still renders — and the card is tagged
  source="sample" so the UI can show a clear "Sample data" badge. When the app
  registration is granted the listed Graph permissions, the same cards light up "live".

Graph permissions used (Application): SecurityIncident.Read.All, SecurityAlert.Read.All,
IdentityRiskyUser.Read.All, IdentityRiskEvent.Read.All, DeviceManagementManagedDevices.Read.All,
Policy.Read.All, Reports.Read.All, AuditLog.Read.All, SecurityEvents.Read.All.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

GRAPH = "https://graph.microsoft.com/v1.0"
_SCOPE = "https://graph.microsoft.com/.default"

# Module-level token cache (process lifetime; Graph app tokens last ~1h).
_token_cache: Dict[str, Any] = {"token": None, "exp": 0.0}


# ── Credentials ───────────────────────────────────────────────────────────────
def _creds() -> Tuple[str, str, str]:
    """Resolve tenant/client/secret from runtime settings or environment."""
    tid = cid = sec = ""
    try:
        from services.settings_service import settings_service as _ss  # type: ignore
        tid = _ss.get_value("AZURE_TENANT_ID", "") or ""
        cid = _ss.get_value("AZURE_CLIENT_ID", "") or ""
        sec = _ss.get_value("AZURE_CLIENT_SECRET", "") or ""
    except Exception:
        pass
    tid = tid or os.getenv("AZURE_TENANT_ID", "")
    cid = cid or os.getenv("AZURE_CLIENT_ID", "")
    sec = sec or os.getenv("AZURE_CLIENT_SECRET", "")
    return tid.strip(), cid.strip(), sec.strip()


def _get_token() -> Optional[str]:
    """App-only Graph token via client credentials. Cached until ~5 min before expiry."""
    now = time.time()
    if _token_cache["token"] and now < _token_cache["exp"] - 300:
        return _token_cache["token"]
    tid, cid, sec = _creds()
    if not (tid and cid and sec):
        return None
    try:
        from azure.identity import ClientSecretCredential
        cred = ClientSecretCredential(tenant_id=tid, client_id=cid, client_secret=sec)
        tok = cred.get_token(_SCOPE)
        _token_cache["token"] = tok.token
        _token_cache["exp"] = float(tok.expires_on)
        return tok.token
    except Exception as exc:
        logger.info("M365: could not acquire Graph token: %s", exc)
        return None


def _graph_get(path: str, token: str, params: Optional[dict] = None) -> dict:
    """GET {GRAPH}{path}. Raises on non-2xx so callers fall back to sample."""
    import httpx
    url = path if path.startswith("http") else f"{GRAPH}{path}"
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    with httpx.Client(timeout=20) as client:
        r = client.get(url, headers=headers, params=params or {})
        r.raise_for_status()
        return r.json()


def _sev(s: Any) -> str:
    s = str(s or "").lower()
    if s in ("high", "critical"):
        return "high" if s == "high" else "critical"
    if s == "medium":
        return "medium"
    if s in ("low", "informational", "info"):
        return "low"
    return s or "unknown"


def _iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat()


# ── Collectors (each returns (data, source)) ──────────────────────────────────
def _secure_score(token: Optional[str]) -> Tuple[dict, str]:
    if token:
        try:
            js = _graph_get("/security/secureScores", token, {"$top": 8})
            rows = sorted(js.get("value", []), key=lambda x: x.get("createdDateTime", ""))
            if rows:
                cur = rows[-1]
                current = float(cur.get("currentScore", 0))
                mx = float(cur.get("maxScore", 0)) or 1.0
                trend = [round(float(r.get("currentScore", 0))) for r in rows[-7:]]
                return ({"current": round(current), "max": round(mx),
                         "percent": round(100 * current / mx), "trend": trend}, "live")
        except Exception as exc:
            logger.info("M365 secure_score live failed: %s", exc)
    return ({"current": 412, "max": 600, "percent": 69,
             "trend": [58, 60, 63, 62, 66, 67, 69]}, "sample")


def _risky_users(token: Optional[str]) -> Tuple[list, str]:
    if token:
        try:
            js = _graph_get("/identityProtection/riskyUsers", token,
                            {"$top": 50, "$orderby": "riskLastUpdatedDateTime desc"})
            out = [{
                "user": u.get("userDisplayName") or u.get("userPrincipalName"),
                "upn": u.get("userPrincipalName"),
                "risk_level": _sev(u.get("riskLevel")),
                "risk_state": u.get("riskState"),
                "updated": u.get("riskLastUpdatedDateTime"),
            } for u in js.get("value", [])]
            return out, "live"
        except Exception as exc:
            logger.info("M365 risky_users live failed: %s", exc)
    now = datetime.now(timezone.utc)
    sample = [
        {"user": "Adele Vance", "upn": "adelev@contoso.com", "risk_level": "high", "risk_state": "atRisk", "updated": _iso(now - timedelta(hours=3))},
        {"user": "Lee Gu", "upn": "leeg@contoso.com", "risk_level": "high", "risk_state": "atRisk", "updated": _iso(now - timedelta(hours=9))},
        {"user": "Isaiah Langer", "upn": "isaiahl@contoso.com", "risk_level": "medium", "risk_state": "atRisk", "updated": _iso(now - timedelta(hours=14))},
        {"user": "Pradeep Gupta", "upn": "pradeepg@contoso.com", "risk_level": "medium", "risk_state": "confirmedSafe", "updated": _iso(now - timedelta(days=1))},
        {"user": "Diego Siciliani", "upn": "diegos@contoso.com", "risk_level": "low", "risk_state": "atRisk", "updated": _iso(now - timedelta(days=2))},
    ]
    return sample, "sample"


def _risk_detections(token: Optional[str]) -> Tuple[list, str]:
    if token:
        try:
            js = _graph_get("/identityProtection/riskDetections", token,
                            {"$top": 50, "$orderby": "detectedDateTime desc"})
            out = [{
                "type": d.get("riskEventType"),
                "risk_level": _sev(d.get("riskLevel")),
                "activity": d.get("activity"),
                "upn": d.get("userPrincipalName"),
                "ip": d.get("ipAddress"),
                "location": ", ".join(filter(None, [(d.get("location") or {}).get("city"), (d.get("location") or {}).get("countryOrRegion")])) or None,
                "detected": d.get("detectedDateTime"),
            } for d in js.get("value", [])]
            return out, "live"
        except Exception as exc:
            logger.info("M365 risk_detections live failed: %s", exc)
    now = datetime.now(timezone.utc)
    sample = [
        {"type": "unfamiliarFeatures", "risk_level": "high", "activity": "signin", "upn": "adelev@contoso.com", "ip": "185.220.101.43", "location": "Amsterdam, NL", "detected": _iso(now - timedelta(hours=3))},
        {"type": "anonymizedIPAddress", "risk_level": "high", "activity": "signin", "upn": "leeg@contoso.com", "ip": "104.244.76.187", "location": "Unknown (Tor)", "detected": _iso(now - timedelta(hours=9))},
        {"type": "impossibleTravel", "risk_level": "medium", "activity": "signin", "upn": "isaiahl@contoso.com", "ip": "20.51.200.10", "location": "Doha, QA", "detected": _iso(now - timedelta(hours=14))},
        {"type": "maliciousIPAddress", "risk_level": "high", "activity": "signin", "upn": "alland@contoso.com", "ip": "45.137.21.9", "location": "Sofia, BG", "detected": _iso(now - timedelta(hours=20))},
        {"type": "passwordSpray", "risk_level": "medium", "activity": "signin", "upn": "(multiple)", "ip": "193.27.228.12", "location": "Moscow, RU", "detected": _iso(now - timedelta(days=1))},
    ]
    return sample, "sample"


def _mfa_coverage(token: Optional[str]) -> Tuple[dict, str]:
    if token:
        try:
            js = _graph_get("/reports/authenticationMethods/userRegistrationDetails", token, {"$top": 999})
            rows = js.get("value", [])
            total = len(rows) or 1
            registered = sum(1 for r in rows if r.get("isMfaRegistered"))
            capable = sum(1 for r in rows if r.get("isMfaCapable"))
            return ({"total": total, "registered": registered, "capable": capable,
                     "pct": round(100 * registered / total)}, "live")
        except Exception as exc:
            logger.info("M365 mfa live failed: %s", exc)
    return ({"total": 248, "registered": 214, "capable": 226, "pct": 86}, "sample")


def _devices(token: Optional[str]) -> Tuple[dict, str]:
    if token:
        try:
            js = _graph_get("/deviceManagement/managedDevices", token,
                            {"$top": 200, "$select": "deviceName,operatingSystem,complianceState,lastSyncDateTime,userPrincipalName,managedDeviceOwnerType"})
            rows = js.get("value", [])
            total = len(rows)
            by_os: Dict[str, int] = {}
            noncompliant = []
            compliant = 0
            stale_cutoff = datetime.now(timezone.utc) - timedelta(days=14)
            stale = 0
            for d in rows:
                osn = d.get("operatingSystem") or "Other"
                by_os[osn] = by_os.get(osn, 0) + 1
                state = str(d.get("complianceState") or "").lower()
                if state == "compliant":
                    compliant += 1
                else:
                    noncompliant.append({"device": d.get("deviceName"), "os": osn,
                                         "state": d.get("complianceState"), "user": d.get("userPrincipalName"),
                                         "last_sync": d.get("lastSyncDateTime")})
                ls = d.get("lastSyncDateTime")
                try:
                    if ls and datetime.fromisoformat(ls.replace("Z", "+00:00")) < stale_cutoff:
                        stale += 1
                except Exception:
                    pass
            return ({"total": total, "compliant": compliant, "noncompliant": len(noncompliant),
                     "stale": stale, "by_os": by_os, "noncompliant_list": noncompliant[:25]}, "live")
        except Exception as exc:
            logger.info("M365 devices live failed: %s", exc)
    now = datetime.now(timezone.utc)
    nc = [
        {"device": "DESKTOP-7F3KQ2", "os": "Windows", "state": "noncompliant", "user": "isaiahl@contoso.com", "last_sync": _iso(now - timedelta(hours=6))},
        {"device": "LAPTOP-MKTG-04", "os": "Windows", "state": "noncompliant", "user": "diegos@contoso.com", "last_sync": _iso(now - timedelta(days=1))},
        {"device": "iPhone-CEO", "os": "iOS", "state": "noncompliant", "user": "miriamg@contoso.com", "last_sync": _iso(now - timedelta(days=3))},
        {"device": "MacBook-Design-2", "os": "macOS", "state": "noncompliant", "user": "lidiah@contoso.com", "last_sync": _iso(now - timedelta(days=9))},
        {"device": "ANDROID-FIELD-12", "os": "Android", "state": "noncompliant", "user": "joniw@contoso.com", "last_sync": _iso(now - timedelta(days=21))},
    ]
    return ({"total": 312, "compliant": 287, "noncompliant": 25, "stale": 11,
             "by_os": {"Windows": 201, "iOS": 64, "macOS": 28, "Android": 19}, "noncompliant_list": nc}, "sample")


def _incidents(token: Optional[str]) -> Tuple[dict, str]:
    if token:
        try:
            js = _graph_get("/security/incidents", token, {"$top": 50})
            rows = js.get("value", [])
            by_sev: Dict[str, int] = {}
            by_status: Dict[str, int] = {}
            lst = []
            for i in rows:
                sv = _sev(i.get("severity"))
                st = str(i.get("status") or "unknown")
                by_sev[sv] = by_sev.get(sv, 0) + 1
                by_status[st] = by_status.get(st, 0) + 1
                lst.append({"title": i.get("displayName"), "severity": sv, "status": st,
                            "created": i.get("createdDateTime"), "assigned": i.get("assignedTo")})
            return ({"by_severity": by_sev, "by_status": by_status, "list": lst[:25]}, "live")
        except Exception as exc:
            logger.info("M365 incidents live failed: %s", exc)
    now = datetime.now(timezone.utc)
    lst = [
        {"title": "Multi-stage incident involving Initial access & Credential access", "severity": "high", "status": "active", "created": _iso(now - timedelta(hours=2)), "assigned": "SOC Tier 2"},
        {"title": "Suspicious inbox forwarding rule created", "severity": "high", "status": "active", "created": _iso(now - timedelta(hours=7)), "assigned": None},
        {"title": "Possible AiTM phishing — token theft", "severity": "high", "status": "inProgress", "created": _iso(now - timedelta(hours=11)), "assigned": "SOC Tier 1"},
        {"title": "Anomalous Graph API enumeration", "severity": "medium", "status": "active", "created": _iso(now - timedelta(hours=18)), "assigned": None},
        {"title": "Mass file download from SharePoint", "severity": "medium", "status": "resolved", "created": _iso(now - timedelta(days=1)), "assigned": "SOC Tier 2"},
        {"title": "Malware detected — EICAR test file", "severity": "low", "status": "resolved", "created": _iso(now - timedelta(days=2)), "assigned": "Auto"},
    ]
    return ({"by_severity": {"high": 3, "medium": 2, "low": 1}, "by_status": {"active": 3, "inProgress": 1, "resolved": 2}, "list": lst}, "sample")


def _alerts(token: Optional[str]) -> Tuple[dict, str]:
    if token:
        try:
            js = _graph_get("/security/alerts_v2", token, {"$top": 50})
            rows = js.get("value", [])
            by_sev: Dict[str, int] = {}
            lst = []
            for a in rows:
                sv = _sev(a.get("severity"))
                by_sev[sv] = by_sev.get(sv, 0) + 1
                lst.append({"title": a.get("title"), "severity": sv, "status": a.get("status"),
                            "category": a.get("category"), "service": a.get("serviceSource"),
                            "created": a.get("createdDateTime")})
            return ({"by_severity": by_sev, "list": lst[:30]}, "live")
        except Exception as exc:
            logger.info("M365 alerts live failed: %s", exc)
    now = datetime.now(timezone.utc)
    lst = [
        {"title": "Sign-in from a malicious IP address", "severity": "high", "status": "newAlert", "category": "InitialAccess", "service": "azureAdIdentityProtection", "created": _iso(now - timedelta(hours=1))},
        {"title": "Email messages containing malicious URL removed after delivery", "severity": "high", "status": "newAlert", "category": "Phishing", "service": "microsoftDefenderForOffice365", "created": _iso(now - timedelta(hours=4))},
        {"title": "Suspicious PowerShell command line", "severity": "medium", "status": "inProgress", "category": "Execution", "service": "microsoftDefenderForEndpoint", "created": _iso(now - timedelta(hours=8))},
        {"title": "Unusual addition of credentials to an OAuth app", "severity": "high", "status": "newAlert", "category": "Persistence", "service": "microsoftDefenderForCloudApps", "created": _iso(now - timedelta(hours=12))},
        {"title": "User reported phish message", "severity": "low", "status": "newAlert", "category": "Phishing", "service": "microsoftDefenderForOffice365", "created": _iso(now - timedelta(days=1))},
    ]
    return ({"by_severity": {"high": 3, "medium": 1, "low": 1}, "list": lst}, "sample")


def _conditional_access(token: Optional[str]) -> Tuple[dict, str]:
    if token:
        try:
            js = _graph_get("/identity/conditionalAccess/policies", token, {"$select": "displayName,state"})
            rows = js.get("value", [])
            counts = {"enabled": 0, "report_only": 0, "disabled": 0}
            pols = []
            for p in rows:
                st = str(p.get("state") or "")
                key = "enabled" if st == "enabled" else "report_only" if st == "enabledForReportingButNotEnforced" else "disabled"
                counts[key] += 1
                pols.append({"name": p.get("displayName"), "state": key})
            return ({**counts, "total": len(rows), "policies": pols[:30]}, "live")
        except Exception as exc:
            logger.info("M365 conditional_access live failed: %s", exc)
    pols = [
        {"name": "MFA for all users", "state": "enabled"},
        {"name": "Block legacy authentication", "state": "enabled"},
        {"name": "Require compliant device for admins", "state": "enabled"},
        {"name": "Require MFA for risky sign-ins", "state": "enabled"},
        {"name": "Block access from outside Qatar (GCC)", "state": "report_only"},
        {"name": "Require app protection policy (mobile)", "state": "report_only"},
        {"name": "Legacy — per-app MFA (deprecated)", "state": "disabled"},
    ]
    return ({"enabled": 4, "report_only": 2, "disabled": 1, "total": 7, "policies": pols}, "sample")


# ── Orchestrator ──────────────────────────────────────────────────────────────
def get_m365_security_dashboard() -> Dict[str, Any]:
    token = _get_token()
    tid, _cid, _sec = _creds()

    secure, s_score = _secure_score(token)
    risky, s_risky = _risky_users(token)
    detections, s_det = _risk_detections(token)
    mfa, s_mfa = _mfa_coverage(token)
    devices, s_dev = _devices(token)
    incidents, s_inc = _incidents(token)
    alerts, s_alr = _alerts(token)
    ca, s_ca = _conditional_access(token)

    high_alerts = (alerts.get("by_severity", {}).get("high", 0)
                   + alerts.get("by_severity", {}).get("critical", 0))
    open_incidents = sum(v for k, v in incidents.get("by_status", {}).items()
                         if str(k).lower() in ("active", "inprogress", "new", "unknown"))
    risky_high = sum(1 for u in risky if u.get("risk_level") in ("high", "critical") and str(u.get("risk_state", "")).lower() == "atrisk")

    sources = {"secure_score": s_score, "identity": s_risky, "risk_detections": s_det,
               "mfa": s_mfa, "devices": s_dev, "incidents": s_inc, "alerts": s_alr,
               "conditional_access": s_ca}
    live_any = any(v == "live" for v in sources.values())
    all_sample = all(v == "sample" for v in sources.values())

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "graph_connected": bool(token),
        "tenant_id": tid or None,
        "all_sample": all_sample,
        "live_any": live_any,
        "secure_score": {**secure, "source": s_score},
        "kpis": {
            "secure_score_pct": secure.get("percent", 0),
            "risky_users": len([u for u in risky if str(u.get("risk_state", "")).lower() == "atrisk"]),
            "risky_users_high": risky_high,
            "risk_detections": len(detections),
            "open_incidents": open_incidents,
            "high_alerts": high_alerts,
            "noncompliant_devices": devices.get("noncompliant", 0),
            "mfa_coverage_pct": mfa.get("pct", 0),
            "ca_enabled": ca.get("enabled", 0),
        },
        "identity": {"risky_users": risky, "risk_detections": detections, "mfa": mfa,
                     "source": s_risky},
        "devices": {**devices, "source": s_dev},
        "incidents": {**incidents, "source": s_inc},
        "alerts": {**alerts, "source": s_alr},
        "conditional_access": {**ca, "source": s_ca},
        "sources": sources,
    }
