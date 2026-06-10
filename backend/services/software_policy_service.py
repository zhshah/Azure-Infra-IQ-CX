"""
Software policy / governance service (on-premise & Arc Windows machines)
========================================================================

Adds software-governance to the existing WMI/registry software inventory the
on-prem scanner already collects (onprem_scanner_service._ps_applications).

This is the genuinely useful idea from scrosalem/software-scanner — comparing
installed software against an allow/block/required policy to flag unauthorized
or missing software — implemented natively on our richer inventory (no DCOM,
no Win32_Product, no activation.ps1) and AI-enhanced.

Policy is persisted to backend/data/software_policy.json.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

_DATA_DIR = Path(__file__).parent.parent / "data"
_POLICY_PATH = _DATA_DIR / "software_policy.json"

_DEFAULT_POLICY: Dict[str, List[str]] = {
    # Software every managed Windows machine SHOULD have.
    "required": [
        "Microsoft Defender",
        "Azure Connected Machine Agent",
        "Azure Monitor Agent",
    ],
    # Software that must NOT be present (security / licensing risk).
    "blocked": [
        "uTorrent", "BitTorrent", "qBittorrent", "AnyDesk", "TeamViewer",
        "LogMeIn", "Hola", "KMSPico", "CCleaner",
    ],
    # If non-empty, anything NOT in allowed/required (and not infrastructure) is unauthorized.
    "allowed": [],
}


def _ensure_dir() -> None:
    try:
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass


def get_policy() -> Dict[str, List[str]]:
    try:
        if _POLICY_PATH.exists():
            data = json.loads(_POLICY_PATH.read_text(encoding="utf-8"))
            return {
                "required": list(data.get("required", _DEFAULT_POLICY["required"])),
                "blocked": list(data.get("blocked", _DEFAULT_POLICY["blocked"])),
                "allowed": list(data.get("allowed", [])),
            }
    except Exception as exc:
        logger.warning("software policy read failed: %s", exc)
    return dict(_DEFAULT_POLICY)


def set_policy(policy: Dict[str, Any]) -> Dict[str, List[str]]:
    _ensure_dir()
    clean = {
        "required": [str(x).strip() for x in (policy.get("required") or []) if str(x).strip()],
        "blocked": [str(x).strip() for x in (policy.get("blocked") or []) if str(x).strip()],
        "allowed": [str(x).strip() for x in (policy.get("allowed") or []) if str(x).strip()],
    }
    try:
        _POLICY_PATH.write_text(json.dumps(clean, indent=2), encoding="utf-8")
    except Exception as exc:
        logger.warning("software policy write failed: %s", exc)
    return clean


def _name_of(item: Any) -> str:
    if isinstance(item, dict):
        return str(item.get("name") or item.get("DisplayName") or item.get("display_name") or "")
    return str(item or "")


def _matches(installed_name: str, pattern: str) -> bool:
    return pattern.lower() in installed_name.lower()


def evaluate(inventory: List[Any], policy: Dict[str, List[str]] | None = None) -> Dict[str, Any]:
    """
    Compare an installed-software inventory against policy.

    inventory: list of installed apps (dicts with 'name'/'version'/'publisher' or strings).
    Returns unauthorized / blocked / missing-required findings + a compliance score.
    """
    policy = policy or get_policy()
    required = policy.get("required", [])
    blocked = policy.get("blocked", [])
    allowed = policy.get("allowed", [])

    names = [(_name_of(i), i) for i in (inventory or [])]
    names = [(n, i) for (n, i) in names if n]

    blocked_found: List[Dict[str, Any]] = []
    unauthorized: List[Dict[str, Any]] = []
    for n, item in names:
        bl = next((b for b in blocked if _matches(n, b)), None)
        if bl:
            blocked_found.append({"name": n, "matched_rule": bl,
                                  "version": item.get("version") if isinstance(item, dict) else "",
                                  "publisher": item.get("publisher") if isinstance(item, dict) else ""})
            continue
        if allowed:
            ok = any(_matches(n, a) for a in allowed) or any(_matches(n, r) for r in required)
            if not ok:
                unauthorized.append({"name": n,
                                     "version": item.get("version") if isinstance(item, dict) else "",
                                     "publisher": item.get("publisher") if isinstance(item, dict) else ""})

    missing_required: List[str] = []
    for r in required:
        if not any(_matches(n, r) for n, _ in names):
            missing_required.append(r)

    # Compliance score: start at 100, subtract penalties, clamp.
    score = 100
    score -= 15 * len(blocked_found)
    score -= 8 * len(missing_required)
    score -= 3 * len(unauthorized)
    score = max(0, min(100, score))

    return {
        "total_installed": len(names),
        "compliance_score": score,
        "blocked_found": blocked_found,
        "unauthorized": unauthorized,
        "missing_required": missing_required,
        "compliant": score >= 80 and not blocked_found and not missing_required,
        "policy": policy,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# SOFTWARE CLASSIFICATION — category / risk / license / end-of-life heuristics
# These run with zero AI cost and give the estate immediate, explainable signal.
# ═══════════════════════════════════════════════════════════════════════════════

import re as _re


def _kw_match(hay: str, keyword: str) -> bool:
    """Word-ish boundary match so e.g. 'redis' doesn't hit 'redistributable'."""
    kw = (keyword or "").strip()
    if not kw:
        return False
    return _re.search(r"(?<![a-z0-9])" + _re.escape(kw) + r"(?![a-z0-9])", hay) is not None


# (category, base_risk, license_hint, [keywords])
_CATEGORY_RULES: List[tuple] = [
    ("remote-access",   "high",   "varies",     ["teamviewer", "anydesk", "logmein", "ultravnc", "tightvnc", "realvnc", "tigervnc", "vnc ", "ammyy", "dwservice", "splashtop", "gotomypc", "remotepc", "chrome remote desktop", "supremo", "radmin"]),
    ("p2p-file-sharing","high",   "free",       ["utorrent", "bittorrent", "qbittorrent", "vuze", "frostwire", "limewire", "emule", "transmission", "deluge"]),
    ("crypto-mining",   "high",   "free",       ["xmrig", "nicehash", "ethminer", "cgminer", "ccminer", "miner", "metamask", "exodus wallet"]),
    ("piracy-unwanted", "high",   "free",       ["kmspico", "kms activator", "keygen", "crack", "hola ", "cracked", "autokms"]),
    ("security-agent",  "low",    "commercial", ["defender", "crowdstrike", "sentinelone", "carbon black", "mcafee", "symantec endpoint", "sophos", "trend micro", "qualys", "tenable", "nessus", "rapid7", "cylance", "eset"]),
    ("azure-agent",     "low",    "free",       ["connected machine agent", "azure monitor agent", "microsoftmonitoringagent", "microsoft monitoring agent", "log analytics", "dependency agent", "guest configuration", "azure arc", "azurearc"]),
    ("backup-dr",       "low",    "commercial", ["veeam", "commvault", "veritas", "backup exec", "acronis", "rubrik", "cohesity", "azure recovery services", "azure backup"]),
    ("virtualization",  "low",    "commercial", ["vmware", "virtualbox", "citrix", "hyper-v", "xenapp", "xendesktop"]),
    ("database",        "medium", "varies",     ["sql server", "mysql", "mariadb", "postgresql", "postgres", "oracle database", "oracle client", "mongodb", "redis", "db2", "sqlite", "cassandra"]),
    ("web-server",      "medium", "varies",     ["internet information services", " iis", "apache tomcat", "apache http", "apache2", "nginx", "jboss", "wildfly", "websphere", "weblogic", "node.js"]),
    ("runtime",         "low",    "free",       [".net framework", ".net core", ".net runtime", "java ", "jre", "jdk", "openjdk", "python ", "node.js", "php ", "ruby", "perl", "visual c++", "redistributable", "silverlight", "adobe air"]),
    ("browser",         "low",    "free",       ["google chrome", "mozilla firefox", "microsoft edge", "opera", "brave", "internet explorer"]),
    ("dev-tool",        "low",    "varies",     ["visual studio", "vs code", "git ", "github", "docker", "postman", "management studio", "ssms", "powershell", "putty", "winscp", "azure cli", "azure data studio"]),
    ("productivity",    "low",    "varies",     ["microsoft office", "word", "excel", "powerpoint", "outlook", "microsoft teams", "onedrive", "sharepoint", "acrobat", "adobe reader", "7-zip", "winrar", "notepad++", "zoom", "slack"]),
    ("utility",         "low",    "varies",     ["ccleaner", "wireshark", "filezilla", "vlc", "greenshot", "sysinternals"]),
]

# Vendors whose products almost always require paid licensing (audit / true-up risk)
_COMMERCIAL_VENDORS = [
    "microsoft sql server", "oracle", "vmware", "citrix", "veeam", "commvault",
    "sap", "ibm", "autodesk", "adobe acrobat", "adobe creative", "tableau",
    "veritas", "red hat", "splunk", "atlassian", "sentinelone", "crowdstrike",
]

# End-of-life / unsupported markers (Windows-server estate reality)
_EOL_MARKERS = {
    "end-of-life": [
        "java 6", "java 7", "java(tm) se 6", "java(tm) se 7", "jre 6", "jre 7", "1.6.0_", "1.7.0_",
        "python 2", "sql server 2008", "sql server 2012", "sql server 2014",
        ".net framework 2.0", ".net framework 3.0", ".net framework 3.5",
        "windows server 2008", "windows server 2012", "internet explorer",
        "adobe flash", "silverlight", "visual studio 2010", "visual studio 2012",
        "office 2010", "office 2013", "windows 7", "exchange 2010", "exchange 2013",
        "apache tomcat 7", "apache tomcat 8.0", "php 5", "php 7.0", "php 7.1", "nodejs 12", "node.js 12",
    ],
    "approaching-eol": [
        "sql server 2016", "sql server 2017", "java 8", "1.8.0_", "windows server 2016",
        "office 2016", ".net framework 4.5", "apache tomcat 8.5", "php 7.4", "nodejs 14", "node.js 14",
        "python 3.7", "python 3.8",
    ],
}


def _categorize(name: str, publisher: str = "") -> Dict[str, str]:
    """Classify a piece of software → category, risk, license guess (no AI)."""
    hay = f"{name} {publisher}".lower()
    category, risk, lic_hint = "other", "low", "unknown"
    for cat, base_risk, lic, keywords in _CATEGORY_RULES:
        if any(_kw_match(hay, k) for k in keywords):
            category, risk, lic_hint = cat, base_risk, lic
            break
    # License refinement
    license_type = lic_hint
    if any(v in hay for v in _COMMERCIAL_VENDORS):
        license_type = "commercial"
    elif lic_hint == "varies":
        license_type = "unknown"
    return {"category": category, "risk": risk, "license": license_type}


def _detect_eol(name: str) -> str:
    low = (name or "").lower()
    for marker in _EOL_MARKERS["end-of-life"]:
        if marker in low:
            return "end-of-life"
    for marker in _EOL_MARKERS["approaching-eol"]:
        if marker in low:
            return "approaching-eol"
    return "unknown"


# ═══════════════════════════════════════════════════════════════════════════════
# FLEET GOVERNANCE — runs over the REAL on-prem/Arc software inventory
# ═══════════════════════════════════════════════════════════════════════════════

def _app_fields(app: Any) -> tuple:
    if isinstance(app, dict):
        return (str(app.get("name") or app.get("DisplayName") or "").strip(),
                str(app.get("version") or app.get("DisplayVersion") or "").strip(),
                str(app.get("publisher") or app.get("Publisher") or "").strip())
    return (str(app or "").strip(), "", "")


def get_fleet_governance(policy: Dict[str, List[str]] | None = None, max_catalog: int = 600) -> Dict[str, Any]:
    """
    Evaluate the entire on-prem/Arc software estate against policy and build a
    de-duplicated, categorized software catalog with risk / license / EOL signal.
    Reads the real inventory the scanner already collected (installed_applications).
    """
    policy = policy or get_policy()
    try:
        from services.onprem_service import get_all_servers
        servers = get_all_servers() or []
    except Exception as exc:
        logger.warning("fleet governance: inventory read failed: %s", exc)
        servers = []

    catalog: Dict[str, Dict[str, Any]] = {}
    per_server: List[Dict[str, Any]] = []
    scores: List[int] = []
    blocked_incidents = 0
    missing_gaps = 0
    servers_with_sw = 0

    blocked = policy.get("blocked", [])
    required = policy.get("required", [])

    for s in servers:
        host = str(s.get("hostname") or s.get("server_id") or "").strip()
        apps = s.get("installed_applications") or []
        os_name = s.get("os_name") or s.get("os") or ""
        if not apps:
            per_server.append({"hostname": host, "os": os_name, "app_count": 0,
                               "compliance_score": None, "compliant": None,
                               "blocked": [], "missing_required": [], "unauthorized": 0,
                               "no_data": True})
            continue

        servers_with_sw += 1
        ev = evaluate(apps, policy)
        scores.append(ev["compliance_score"])
        blocked_incidents += len(ev["blocked_found"])
        missing_gaps += len(ev["missing_required"])
        per_server.append({
            "hostname": host, "os": os_name, "app_count": ev["total_installed"],
            "compliance_score": ev["compliance_score"], "compliant": ev["compliant"],
            "blocked": [b["name"] for b in ev["blocked_found"]],
            "missing_required": ev["missing_required"],
            "unauthorized": len(ev["unauthorized"]),
            "no_data": False,
        })

        for app in apps:
            name, version, publisher = _app_fields(app)
            if not name:
                continue
            key = name.lower()
            entry = catalog.get(key)
            if not entry:
                meta = _categorize(name, publisher)
                entry = {
                    "name": name, "publisher": publisher,
                    "category": meta["category"], "risk": meta["risk"], "license": meta["license"],
                    "eol_status": _detect_eol(f"{name} {version}"),
                    "install_count": 0, "servers": [], "versions": set(),
                    "is_blocked": any(_matches(name, b) for b in blocked),
                    "is_required": any(_matches(name, r) for r in required),
                }
                catalog[key] = entry
            entry["install_count"] += 1
            if host and host not in entry["servers"]:
                entry["servers"].append(host)
            if version:
                entry["versions"].add(version)

    # finalize catalog
    cat_list = []
    for e in catalog.values():
        e["versions"] = sorted(e["versions"])[:8]
        e["server_count"] = len(e["servers"])
        e["servers"] = e["servers"][:50]
        cat_list.append(e)
    # rank: blocked first, then high risk, then EOL, then install count
    risk_rank = {"high": 0, "medium": 1, "low": 2}
    cat_list.sort(key=lambda e: (
        not e["is_blocked"], risk_rank.get(e["risk"], 3),
        0 if e["eol_status"] == "end-of-life" else 1 if e["eol_status"] == "approaching-eol" else 2,
        -e["install_count"],
    ))
    cat_list = cat_list[:max_catalog]

    # category + signal rollups
    category_breakdown: Dict[str, int] = {}
    high_risk = eol = approaching = commercial = blocked_unique = 0
    for e in cat_list:
        category_breakdown[e["category"]] = category_breakdown.get(e["category"], 0) + 1
        if e["risk"] == "high":
            high_risk += 1
        if e["eol_status"] == "end-of-life":
            eol += 1
        elif e["eol_status"] == "approaching-eol":
            approaching += 1
        if e["license"] == "commercial":
            commercial += 1
        if e["is_blocked"]:
            blocked_unique += 1

    per_server.sort(key=lambda x: (x["compliance_score"] is None, x["compliance_score"] if x["compliance_score"] is not None else 999))
    avg = round(sum(scores) / len(scores)) if scores else 0
    compliant = sum(1 for p in per_server if p["compliant"] is True)

    return {
        "has_data": servers_with_sw > 0,
        "summary": {
            "servers_total": len(servers),
            "servers_with_software": servers_with_sw,
            "avg_compliance": avg,
            "compliant_servers": compliant,
            "noncompliant_servers": servers_with_sw - compliant,
            "blocked_incidents": blocked_incidents,
            "missing_required_gaps": missing_gaps,
            "unique_software": len(catalog),
            "high_risk_apps": high_risk,
            "eol_apps": eol,
            "approaching_eol_apps": approaching,
            "commercial_apps": commercial,
            "blocked_software_types": blocked_unique,
        },
        "category_breakdown": category_breakdown,
        "catalog": cat_list,
        "per_server": per_server,
        "policy": policy,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# POLICY TEMPLATES — one-click starting points for common governance goals
# ═══════════════════════════════════════════════════════════════════════════════

_REMOTE_ACCESS = ["TeamViewer", "AnyDesk", "LogMeIn", "UltraVNC", "TightVNC", "RealVNC", "Ammyy", "Splashtop", "GoToMyPC", "RemotePC", "Chrome Remote Desktop"]
_P2P = ["uTorrent", "BitTorrent", "qBittorrent", "Vuze", "FrostWire", "LimeWire", "eMule"]
_UNWANTED = ["KMSPico", "Hola", "CCleaner", "AutoKMS", "Keygen"]
_AZURE_AGENTS = ["Azure Connected Machine Agent", "Azure Monitor Agent", "Dependency Agent"]

POLICY_TEMPLATES: List[Dict[str, Any]] = [
    {
        "key": "security-baseline",
        "label": "Security baseline",
        "description": "Block remote-access, P2P, crypto and piracy tools; require endpoint protection and Azure agents.",
        "policy": {
            "required": ["Microsoft Defender"] + _AZURE_AGENTS,
            "blocked": _REMOTE_ACCESS + _P2P + _UNWANTED + ["XMRig", "NiceHash"],
            "allowed": [],
        },
    },
    {
        "key": "no-shadow-remote-access",
        "label": "No shadow-IT remote access",
        "description": "Flag any unsanctioned remote-control tool — a top data-exfiltration and ransomware entry point.",
        "policy": {"required": [], "blocked": _REMOTE_ACCESS, "allowed": []},
    },
    {
        "key": "azure-ready",
        "label": "Azure-ready agents",
        "description": "Require the Arc + Azure Monitor agents so every server is governable and observable in Azure.",
        "policy": {"required": _AZURE_AGENTS + ["Microsoft Defender"], "blocked": [], "allowed": []},
    },
    {
        "key": "license-audit",
        "label": "License audit watch",
        "description": "Block consumer-grade tools and surface commercial software for true-up / licensing review.",
        "policy": {"required": [], "blocked": _P2P + _UNWANTED, "allowed": []},
    },
]


def get_policy_templates() -> List[Dict[str, Any]]:
    return POLICY_TEMPLATES


def get_software_intelligence(software: List[Any], force_refresh: bool = False, from_fleet: bool = False) -> Dict[str, Any]:
    """
    AI software intelligence: for the supplied installed software (or the whole
    fleet when from_fleet=True), assess EOL / support status, security risk,
    license type, and Azure migration target. Reuses the FinOps AI plumbing + cache.
    """
    try:
        import services.finops_ai_service as ai
    except Exception:
        return {"summary": "AI service unavailable", "items": [], "provider": "none"}

    if from_fleet or not software:
        try:
            gov = get_fleet_governance()
            # prioritize risky / EOL / commercial software for the (capped) AI pass
            software = [{"name": c["name"]} for c in gov.get("catalog", [])]
        except Exception:
            software = software or []

    names = sorted({_name_of(i) for i in (software or []) if _name_of(i)})[:60]
    if not names:
        return {"summary": "No software supplied.", "items": [], "provider": ai._provider_name()}

    system = (
        "You are a Windows software modernization and security analyst. For the "
        "given list of installed Windows software, return STRICT JSON only:\n"
        '{ "summary": "2-3 sentence fleet read",\n'
        '  "items": [{"name":"", "eol_status":"supported|approaching-eol|end-of-life|unknown",'
        ' "security_risk":"low|medium|high", "license_note":"", '
        '"azure_target":"e.g. Azure SQL MI / App Service / Container Apps / keep", '
        '"recommendation":""}] }\n'
        "Focus on databases, web/app servers, runtimes, and risky/legacy software. Max 25 items."
    )
    user = "Installed software:\n" + "\n".join(f"- {n}" for n in names)

    data = {"software": names}
    # Reuse the cached insights pathway by calling the chat directly for a custom schema.
    cache_key = None
    try:
        import services.cache_service as cache
        import hashlib
        fp = hashlib.sha256(json.dumps(names, sort_keys=True).encode()).hexdigest()[:16]
        cache_key = f"onprem:swai:{fp}"
        if not force_refresh:
            cached = cache.get_json(cache_key)
            if cached:
                cached["cached"] = True
                return cached
    except Exception:
        pass

    try:
        raw = ai._chat_completion(system, user, max_tokens=1800)
    except Exception as exc:
        return {"summary": f"AI analysis unavailable: {exc}", "items": [], "provider": ai._provider_name()}

    parsed = ai._parse_json(raw or "") or {}
    result = {
        "summary": str(parsed.get("summary", ""))[:1200],
        "items": [
            {
                "name": str(it.get("name", ""))[:120],
                "eol_status": str(it.get("eol_status", "unknown")).lower(),
                "security_risk": str(it.get("security_risk", "low")).lower(),
                "license_note": str(it.get("license_note", ""))[:200],
                "azure_target": str(it.get("azure_target", ""))[:160],
                "recommendation": str(it.get("recommendation", ""))[:300],
            }
            for it in (parsed.get("items") or []) if isinstance(it, dict)
        ][:25],
        "provider": ai._provider_name(),
        "cached": False,
    }
    if cache_key:
        try:
            import services.cache_service as cache
            cache.set_json(cache_key, result, ttl_seconds=86400)
        except Exception:
            pass
    return result
