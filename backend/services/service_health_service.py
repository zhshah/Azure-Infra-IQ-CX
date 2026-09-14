"""
Service Health service — Azure Service Health events via Azure Resource Graph.

Reads servicehealthresources (microsoft.resourcehealth/events): active service
issues, planned maintenance, health advisories, and security advisories that
affect the subscriptions in scope. ARG-based — resilient, degrades gracefully.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from services.resource_graph_service import query_resource_graph

logger = logging.getLogger(__name__)

_EVENTS_KQL = """
servicehealthresources
| where type =~ 'microsoft.resourcehealth/events'
| extend p = properties
| project eventType = tostring(p.EventType),
          status = tostring(p.Status),
          title = tostring(p.Title),
          summary = tostring(p.Summary),
          trackingId = tostring(p.TrackingId),
          level = tostring(p.Level),
          impactStartTime = tostring(p.ImpactStartTime),
          impactMitigationTime = tostring(p.ImpactMitigationTime),
          lastUpdateTime = tostring(p.LastUpdateTime),
          subscriptionId
"""

_TYPE_LABEL = {
    "ServiceIssue": "Service Issue",
    "PlannedMaintenance": "Planned Maintenance",
    "HealthAdvisory": "Health Advisory",
    "SecurityAdvisory": "Security Advisory",
    "RCA": "Root Cause Analysis",
}


def get_service_health(subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Service Health events rollup (active issues, maintenance, advisories)."""
    try:
        rows = query_resource_graph(_EVENTS_KQL, subscription_ids, max_results=20000)
    except Exception as exc:
        logger.warning("service_health: query failed: %s", exc)
        rows = []

    by_type: Dict[str, int] = {}
    active = 0
    items: List[Dict[str, Any]] = []
    for r in rows:
        et = r.get("eventType") or "Other"
        status = r.get("status") or ""
        by_type[et] = by_type.get(et, 0) + 1
        if status.lower() == "active":
            active += 1
        items.append({
            "event_type": et,
            "event_type_label": _TYPE_LABEL.get(et, et),
            "status": status,
            "title": r.get("title", "") or "",
            "summary": (r.get("summary", "") or "")[:400],
            "tracking_id": r.get("trackingId", ""),
            "level": r.get("level", ""),
            "impact_start": r.get("impactStartTime", ""),
            "impact_mitigation": r.get("impactMitigationTime", ""),
            "last_update": r.get("lastUpdateTime", ""),
            "subscription_id": r.get("subscriptionId", ""),
        })

    def _sort_key(x):
        return (0 if x["status"].lower() == "active" else 1, x.get("last_update") or "")
    items.sort(key=_sort_key)

    return {
        "total_events": len(rows),
        "active_events": active,
        "service_issues": by_type.get("ServiceIssue", 0),
        "planned_maintenance": by_type.get("PlannedMaintenance", 0),
        "health_advisories": by_type.get("HealthAdvisory", 0),
        "security_advisories": by_type.get("SecurityAdvisory", 0),
        "by_type": by_type,
        "items": items[:1000],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# RETIREMENTS & DEPRECATIONS RADAR
# Fuses Service Health advisories + planned maintenance + Advisor recommendations
# into a forward-looking view of what Azure is retiring/deprecating/upgrading,
# WHEN it lands, and HOW MANY of the customer's own resources are exposed.
# ═══════════════════════════════════════════════════════════════════════════════

import re as _re

_MONTHS = {}
for _i, _m in enumerate(["january", "february", "march", "april", "may", "june", "july",
                         "august", "september", "october", "november", "december"], 1):
    _MONTHS[_m] = _i
    _MONTHS[_m[:3]] = _i

# (category, [keywords]) — order matters (first match wins)
_LIFECYCLE_RULES = [
    ("retirement",  ["retire", "retirement", "end of life", "end-of-life", " eol", "sunset",
                     "decommission", "will be removed", "being removed", "no longer be available"]),
    ("deprecation", ["deprecat", "no longer supported", "out of support", "end of support",
                     "end-of-support", "unsupported", "legacy", "classic ", "older version"]),
    ("upgrade",     ["upgrade", "latest version", "newer generation", "migrate to", "new version",
                     "newer sku", "next generation", "supported version", "newer version"]),
    ("certificate", ["certificate", "tls 1.0", "tls 1.1", "ssl ", "cipher", "root ca", "ca certificate"]),
]

# Curated inventory exposure matchers: token in the advisory text -> resource predicate.
_EXPOSURE_MATCHERS = [
    ("redis",               lambda t, s: "cache/redis" in t),
    ("public ip",           lambda t, s: "publicipaddresses" in t),
    ("load balancer",       lambda t, s: "loadbalancers" in t),
    ("application gateway", lambda t, s: "applicationgateways" in t),
    ("kubernetes",          lambda t, s: "managedclusters" in t),
    ("aks",                 lambda t, s: "managedclusters" in t),
    ("sql managed",         lambda t, s: "sql/managedinstances" in t),
    ("sql ",                lambda t, s: "sql/servers" in t or "sql/managedinstances" in t),
    ("postgres",            lambda t, s: "dbforpostgresql" in t),
    ("mysql",               lambda t, s: "dbformysql" in t),
    ("storage",             lambda t, s: "storageaccounts" in t),
    ("app service",         lambda t, s: "/sites" in t or "serverfarms" in t),
    ("function",            lambda t, s: "/sites" in t),
    ("virtual machine",     lambda t, s: "/virtualmachines" in t),
    ("classic",             lambda t, s: "classic" in t),
    ("basic",               lambda t, s: s == "basic"),
    ("container registry",  lambda t, s: "containerregistries" in t),
    ("cosmos",              lambda t, s: "documentdb" in t or "cosmos" in t),
    ("api management",      lambda t, s: "apimanagement" in t),
    ("data factory",        lambda t, s: "datafactor" in t),
    ("synapse",             lambda t, s: "synapse" in t),
]


def _classify_lifecycle(text: str) -> Optional[str]:
    low = (text or "").lower()
    for cat, kws in _LIFECYCLE_RULES:
        if any(k in low for k in kws):
            return cat
    return None


def _extract_deadline(text: str) -> str:
    """Best-effort: earliest upcoming date mentioned in the text (ISO date) or ''."""
    if not text:
        return ""
    cands = []
    for m in _re.finditer(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b", text):
        try:
            cands.append(datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=timezone.utc))
        except ValueError:
            pass
    for m in _re.finditer(r"\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(20\d{2})\b", text):
        mo = _MONTHS.get(m.group(2).lower())
        if mo:
            try:
                cands.append(datetime(int(m.group(3)), mo, int(m.group(1)), tzinfo=timezone.utc))
            except ValueError:
                pass
    for m in _re.finditer(r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(20\d{2})\b", text):
        mo = _MONTHS.get(m.group(1).lower())
        if mo:
            try:
                cands.append(datetime(int(m.group(3)), mo, int(m.group(2)), tzinfo=timezone.utc))
            except ValueError:
                pass
    if not cands:
        for m in _re.finditer(r"\b([A-Za-z]{3,9})\s+(20\d{2})\b", text):  # "August 2025"
            mo = _MONTHS.get(m.group(1).lower())
            if mo:
                try:
                    cands.append(datetime(int(m.group(2)), mo, 1, tzinfo=timezone.utc))
                except ValueError:
                    pass
    if not cands:
        return ""
    now = datetime.now(timezone.utc)
    future = [c for c in cands if c >= now - timedelta(days=2)]
    chosen = min(future) if future else max(cands)
    return chosen.date().isoformat()


def _norm_date(s: str) -> str:
    if not s:
        return ""
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date().isoformat()
    except (ValueError, TypeError):
        return _extract_deadline(s)


def _exposure(title: str, summary: str, inv_index: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Count how many of the customer's own resources a retirement/deprecation hits."""
    low = f"{title} {summary}".lower()
    preds = [pred for token, pred in _EXPOSURE_MATCHERS if token in low]
    if not preds or not inv_index:
        return {"exposed_count": 0, "exposed_resources": []}
    matched = []
    for r in inv_index:
        t, sku = r["type"], r["sku"]
        if any(p(t, sku) for p in preds):
            matched.append(r)
    return {
        "exposed_count": len(matched),
        "exposed_resources": [
            {"resource_name": r["name"], "resource_id": r["id"], "resource_type": r["type_label"],
             "resource_group": r["rg"], "subscription_id": r["sub"]}
            for r in matched[:25]
        ],
    }


def get_lifecycle_radar(subscription_ids: Optional[List[str]] = None,
                        resources: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Forward-looking radar of Azure retirements / deprecations / upgrades that
    affect the in-scope subscriptions, with deadlines, inventory exposure, and a
    bucketed timeline for charting."""
    sh = get_service_health(subscription_ids)
    try:
        from services.advisor_service import get_advisor_overview
        adv = get_advisor_overview(subscription_ids)
    except Exception as exc:
        logger.warning("lifecycle radar: advisor fetch failed: %s", exc)
        adv = {"items": []}

    # Inventory index for exposure correlation
    inv_index: List[Dict[str, Any]] = []
    for r in (resources or []):
        rt = str(r.get("resource_type") or r.get("type") or "").lower()
        inv_index.append({
            "name": r.get("resource_name") or r.get("name") or "",
            "id": r.get("resource_id") or r.get("id") or "",
            "type": rt,
            "type_label": rt.split("/")[-1] if rt else "",
            "sku": str(r.get("sku") or r.get("sku_name") or "").lower(),
            "rg": r.get("resource_group") or "",
            "sub": r.get("subscription_id") or "",
        })

    now = datetime.now(timezone.utc)
    radar: List[Dict[str, Any]] = []

    # ── Service Health events (advisories + planned maintenance) ──
    for e in sh.get("items", []):
        et = e.get("event_type") or ""
        title = e.get("title", "") or ""
        summary = e.get("summary", "") or ""
        cat = _classify_lifecycle(f"{title} {summary}")
        if et == "PlannedMaintenance" and not cat:
            cat = "maintenance"
        if not cat and et in ("SecurityAdvisory",):
            cat = "security"
        if not cat:
            continue
        deadline = _norm_date(e.get("impact_start", "")) or _extract_deadline(f"{title} {summary}")
        exp = _exposure(title, summary, inv_index)
        radar.append({
            "source": "Service Health",
            "category": cat,
            "title": title or e.get("event_type_label", "Service Health event"),
            "detail": summary,
            "deadline": deadline,
            "status": e.get("status", ""),
            "tracking_id": e.get("tracking_id", ""),
            "subscription_id": e.get("subscription_id", ""),
            "resource_name": "",
            "exposed_count": exp["exposed_count"],
            "exposed_resources": exp["exposed_resources"],
        })

    # ── Advisor recommendations (upgrade / deprecation / retirement flavored) ──
    for a in adv.get("items", []):
        problem = a.get("problem", "") or ""
        solution = a.get("solution", "") or ""
        cat = _classify_lifecycle(f"{problem} {solution}")
        if not cat:
            continue
        deadline = _extract_deadline(f"{problem} {solution}")
        rid = a.get("resource_id", "") or ""
        rtype = rid.split("/providers/")[-1].split("/")[0:2]
        radar.append({
            "source": "Advisor",
            "category": cat,
            "title": problem or solution[:80],
            "detail": solution,
            "deadline": deadline,
            "status": a.get("impact", ""),
            "tracking_id": "",
            "subscription_id": a.get("subscription_id", ""),
            "resource_name": a.get("resource_name", ""),
            "exposed_count": 1 if rid else 0,
            "exposed_resources": ([{"resource_name": a.get("resource_name", ""), "resource_id": rid,
                                    "resource_type": "/".join(rtype) if rid else "",
                                    "resource_group": "", "subscription_id": a.get("subscription_id", "")}] if rid else []),
        })

    # ── Priority + days-until ──
    for it in radar:
        days = None
        if it["deadline"]:
            try:
                d = datetime.fromisoformat(it["deadline"]).replace(tzinfo=timezone.utc)
                days = (d - now).days
            except ValueError:
                days = None
        it["days_until"] = days
        urgent = days is not None and days <= 90
        soon = days is not None and days <= 180
        if it["category"] in ("retirement", "deprecation", "security") and (urgent or it["exposed_count"] >= 5):
            it["priority"] = "high"
        elif urgent or soon or it["exposed_count"] >= 1:
            it["priority"] = "medium"
        else:
            it["priority"] = "low"

    # Drop planned maintenance that has already occurred (forward-looking radar);
    # keep overdue retirements/deprecations — a passed deadline there is URGENT.
    radar = [it for it in radar
             if not (it["category"] == "maintenance" and it["days_until"] is not None and it["days_until"] < 0)]

    # Sort: has-deadline soonest first, then priority, then exposure
    prio_rank = {"high": 0, "medium": 1, "low": 2}
    radar.sort(key=lambda x: (
        x["days_until"] if x["days_until"] is not None else 99999,
        prio_rank.get(x["priority"], 3),
        -x["exposed_count"],
    ))

    # ── Timeline buckets (YYYY-MM) for charting ──
    buckets: Dict[str, int] = {}
    overdue = no_date = 0
    for it in radar:
        if it["days_until"] is None:
            no_date += 1
        elif it["days_until"] < 0:
            overdue += 1
        else:
            key = it["deadline"][:7]  # YYYY-MM
            buckets[key] = buckets.get(key, 0) + 1
    timeline = []
    for key in sorted(buckets):
        y, m = key.split("-")
        timeline.append({"bucket": key, "label": f"{['', 'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][int(m)]} {y}", "count": buckets[key]})

    by_category: Dict[str, int] = {}
    by_source: Dict[str, int] = {}
    exposed_total = 0
    for it in radar:
        by_category[it["category"]] = by_category.get(it["category"], 0) + 1
        by_source[it["source"]] = by_source.get(it["source"], 0) + 1
        exposed_total += it["exposed_count"]

    def _due_within(n):
        return sum(1 for it in radar if it["days_until"] is not None and 0 <= it["days_until"] <= n)

    return {
        "summary": {
            "total": len(radar),
            "retirements": by_category.get("retirement", 0),
            "deprecations": by_category.get("deprecation", 0),
            "upgrades": by_category.get("upgrade", 0),
            "maintenance": by_category.get("maintenance", 0),
            "security": by_category.get("security", 0) + by_category.get("certificate", 0),
            "due_30": _due_within(30),
            "due_90": _due_within(90),
            "due_180": _due_within(180),
            "overdue": overdue,
            "no_date": no_date,
            "high_priority": sum(1 for it in radar if it["priority"] == "high"),
            "exposed_resources": exposed_total,
        },
        "by_category": by_category,
        "by_source": by_source,
        "timeline": timeline,
        "items": radar[:600],
        "generated_at": now.isoformat(),
    }
