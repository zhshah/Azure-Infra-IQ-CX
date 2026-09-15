"""
Tag-driven chargeback.

The previous report was hard-wired to a `CostCenter` tag, which answers nothing when
that tag covers a fraction of the estate. Here the customer picks any tag key that
actually carries cost, every distinct value becomes a cost centre automatically, and
the spend that carries NO value for that key is reported as its own first-class
bucket — on this estate `CostCenter` reaches 7.9% of spend, so "what cannot be charged
back" is the number that drives behaviour.

Tag keys are matched case-insensitively on purpose: real estates contain both
`CostCenter` and `costCenter`, and treating them as different keys splits one cost
centre in two and silently understates both.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

try:
    from services.database import get_connection
    _DB = True
except Exception:  # pragma: no cover - database optional at import time
    _DB = False

UNALLOCATED = "Unallocated"


def _conn():
    return get_connection()


def _sub_clause(subscription_ids: Optional[List[str]]) -> str:
    if not subscription_ids:
        return ""
    ids = ",".join("'" + str(s).replace("'", "''") + "'" for s in subscription_ids if s)
    return f" AND subscription_id IN ({ids})" if ids else ""


def _load_rows(days: int, subscription_ids: Optional[List[str]]) -> List[tuple]:
    """(tags_json, cost, resource_id, resource_name, resource_group, resource_type, subscription_id)."""
    sql = (
        "SELECT tags, COALESCE(cost_usd, 0), resource_id, resource_name, resource_group, "
        "resource_type, subscription_id "
        "FROM finops_daily_resource_costs "
        "WHERE snapshot_date >= DATEADD(day, -?, CAST(GETUTCDATE() AS date))"
        + _sub_clause(subscription_ids)
    )
    try:
        with _conn() as con:
            return con.execute(sql, (int(days),)).fetchall()
    except Exception as e:
        logger.warning("chargeback: cost rows unavailable: %s", e)
        return []


def _tags_of(raw: Any) -> Dict[str, str]:
    if not raw:
        return {}
    try:
        d = json.loads(raw) if isinstance(raw, str) else raw
        return {str(k): str(v) for k, v in d.items()} if isinstance(d, dict) else {}
    except Exception:
        return {}


def list_tag_keys(days: int = 30,
                  subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Every tag key that carries cost, with how much of total spend it can allocate.

    Coverage is the point: a key on 4% of spend cannot drive a chargeback model, and the
    picker should make that obvious before the customer selects it.
    """
    rows = _load_rows(days, subscription_ids)
    if not rows:
        return {"available": False, "keys": [], "total_cost_usd": 0.0}

    total = 0.0
    agg: Dict[str, Dict[str, Any]] = {}
    for raw, cost, *_ in rows:
        c = float(cost or 0)
        total += c
        for k, v in _tags_of(raw).items():
            if not str(v).strip():
                continue
            lk = k.lower()
            e = agg.setdefault(lk, {"display": k, "cost": 0.0, "values": set(), "variants": set()})
            e["cost"] += c
            e["values"].add(str(v))
            e["variants"].add(k)

    keys = []
    for lk, e in agg.items():
        variants = sorted(e["variants"])
        keys.append({
            "key": lk,
            # Prefer the CamelCase spelling when an estate mixes cases.
            "display_key": sorted(variants, key=lambda s: (s.islower(), s))[0],
            "variants": variants,
            "cost_usd": round(e["cost"], 2),
            "coverage_pct": round(e["cost"] / total * 100, 1) if total else 0.0,
            "distinct_values": len(e["values"]),
        })
    keys.sort(key=lambda k: -k["cost_usd"])
    return {"available": True, "keys": keys, "total_cost_usd": round(total, 2), "days": days}


def chargeback_by_tag(tag_key: str, days: int = 30,
                      subscription_ids: Optional[List[str]] = None,
                      top: int = 50) -> Dict[str, Any]:
    """Allocate spend across the values of one tag key, plus what it cannot allocate."""
    key_l = (tag_key or "").strip().lower()
    if not key_l:
        return {"available": False, "reason": "no tag key supplied"}
    rows = _load_rows(days, subscription_ids)
    if not rows:
        return {"available": False, "reason": "no cost rows in the warehouse"}

    centres: Dict[str, Dict[str, Any]] = {}
    unalloc = {"cost": 0.0, "resources": {}}
    total = 0.0

    for raw, cost, rid, rname, rg, rtype, sub in rows:
        c = float(cost or 0)
        total += c
        tags = {k.lower(): v for k, v in _tags_of(raw).items()}
        val = str(tags.get(key_l, "") or "").strip()
        bucket = centres.setdefault(val, {"cost": 0.0, "resources": {}}) if val else unalloc
        bucket["cost"] += c
        # Same resource appears once per day; fold to one row carrying the period total.
        r = bucket["resources"].setdefault(
            rid or rname, {"resource_id": rid, "resource_name": rname, "resource_group": rg,
                           "resource_type": rtype, "subscription_id": sub, "cost_usd": 0.0})
        r["cost_usd"] += c

    def _pack(name: str, b: Dict[str, Any]) -> Dict[str, Any]:
        res = sorted(b["resources"].values(), key=lambda x: -x["cost_usd"])
        for x in res:
            x["cost_usd"] = round(x["cost_usd"], 2)
        return {
            "name": name,
            "cost_usd": round(b["cost"], 2),
            "share_pct": round(b["cost"] / total * 100, 1) if total else 0.0,
            "resource_count": len(res),
            "resources": res[:top],
        }

    allocated = [_pack(n, b) for n, b in centres.items()]
    allocated.sort(key=lambda x: -x["cost_usd"])
    alloc_cost = sum(x["cost_usd"] for x in allocated)

    return {
        "available": True,
        "tag_key": tag_key,
        "days": days,
        "total_cost_usd": round(total, 2),
        "allocated_cost_usd": round(alloc_cost, 2),
        "unallocated_cost_usd": round(unalloc["cost"], 2),
        "coverage_pct": round(alloc_cost / total * 100, 1) if total else 0.0,
        "cost_centres": allocated,
        "unallocated": _pack(UNALLOCATED, unalloc),
        "centre_count": len(allocated),
    }
