"""Cost change attribution.

Every other view in the product answers "what does it cost". None answers "why did it
change". This decomposes the movement between two equal windows into four mutually
exclusive buckets — resources that appeared, grew, shrank or went away — which sum
exactly to the total delta, so the waterfall always reconciles:

    previous + new + increased + decreased + retired == current

Everything comes from resource-grain warehouse rows. Nothing is modelled or estimated.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

try:
    from services.finops_dashboard_service import _conn, _DB_AVAILABLE, _today  # type: ignore
except Exception:  # pragma: no cover - import shape differs when run as a script
    from finops_dashboard_service import _conn, _DB_AVAILABLE, _today  # type: ignore

# The dimension the user attributes by. Values are column names, but callers never reach
# the SQL directly: the key is looked up in this map, so an unknown key cannot be injected.
DIMENSIONS: Dict[str, Tuple[str, str]] = {
    "resource": ("resource_id", "Resource"),
    "resource_group": ("resource_group", "Resource group"),
    "service": ("service_name", "Service"),
    "resource_type": ("resource_type", "Resource type"),
    "subscription": ("subscription_id", "Subscription"),
    "location": ("location", "Region"),
}

BUCKETS = [
    ("new", "New", "Did not exist in the previous window"),
    ("increased", "Increased", "Existed in both windows and cost more"),
    ("decreased", "Decreased", "Existed in both windows and cost less"),
    ("retired", "Retired", "Existed in the previous window and no longer costs anything"),
]


def _norm(s: Any) -> str:
    return (str(s or "")).strip().lower()


def _window(d_from: date, d_to: date, dim_col: str,
            subscription_ids: Optional[List[str]],
            resource_group: str) -> Dict[str, Dict[str, Any]]:
    """{normalised key -> {cost, label, meta}} for one window."""
    sql = (f"SELECT {dim_col}, resource_name, resource_group, resource_type, "
           "       service_name, location, subscription_id, SUM(cost_usd) "
           "FROM finops_daily_resource_costs "
           "WHERE snapshot_date >= ? AND snapshot_date <= ?")
    params: List[Any] = [str(d_from), str(d_to)]
    if subscription_ids:
        sql += f" AND subscription_id IN ({','.join('?' * len(subscription_ids))})"
        params.extend(subscription_ids)
    if resource_group:
        sql += " AND LOWER(resource_group) = ?"
        params.append(resource_group.lower())
    sql += f" GROUP BY {dim_col}, resource_name, resource_group, resource_type, " \
           "service_name, location, subscription_id"

    out: Dict[str, Dict[str, Any]] = {}
    with _conn() as con:
        for dim, rname, rg, rtype, svc, loc, sub, cost in con.execute(sql, params).fetchall():
            key = _norm(dim)
            if not key:
                continue
            e = out.setdefault(key, {
                "cost_usd": 0.0,
                # For the resource dimension the id is opaque, so show the name.
                "label": (rname or dim) if dim_col == "resource_id" else (dim or "(none)"),
                "resource_name": rname or "",
                "resource_group": rg or "",
                "resource_type": rtype or "",
                "service_name": svc or "",
                "location": loc or "",
                "subscription_id": sub or "",
            })
            e["cost_usd"] += float(cost or 0)
    return out


def cost_change_attribution(days: int = 30,
                            dimension: str = "resource",
                            subscription_ids: Optional[List[str]] = None,
                            resource_group: str = "",
                            top: int = 25) -> Dict[str, Any]:
    if not _DB_AVAILABLE:
        return {"available": False, "reason": "No cost warehouse on this deployment."}

    dim_col, dim_label = DIMENSIONS.get(dimension, DIMENSIONS["resource"])
    days = max(1, min(int(days or 30), 180))
    d_to = _today()
    d_from = d_to - timedelta(days=days - 1)
    p_to = d_from - timedelta(days=1)
    p_from = p_to - timedelta(days=days - 1)

    try:
        cur = _window(d_from, d_to, dim_col, subscription_ids, resource_group)
        prev = _window(p_from, p_to, dim_col, subscription_ids, resource_group)
    except Exception as e:
        logger.warning("cost attribution query failed: %s", e)
        return {"available": False, "reason": "Cost warehouse query failed."}

    if not cur and not prev:
        return {"available": False,
                "reason": f"No cost rows in either window ({p_from} to {d_to})."}

    cur_total = sum(v["cost_usd"] for v in cur.values())
    prev_total = sum(v["cost_usd"] for v in prev.values())

    # A rounding-scale threshold: below a cent is noise, not a movement.
    EPS = 0.01
    groups: Dict[str, List[Dict[str, Any]]] = {b[0]: [] for b in BUCKETS}
    unchanged = 0
    # Movements under a cent are not worth listing, but discarding them entirely would
    # leave the waterfall short of the current total once a few hundred of them add up.
    unchanged_raw = 0.0

    for key in set(cur) | set(prev):
        c = cur.get(key, {}).get("cost_usd", 0.0)
        p = prev.get(key, {}).get("cost_usd", 0.0)
        delta = c - p
        meta = cur.get(key) or prev.get(key) or {}
        row = {k: meta.get(k, "") for k in
               ("label", "resource_name", "resource_group", "resource_type",
                "service_name", "location", "subscription_id")}
        row.update({"prev_usd": round(p, 2), "cur_usd": round(c, 2),
                    "delta_usd": round(delta, 2),
                    # Bucket totals sum this, not delta_usd: adding hundreds of values that
                    # have each already been rounded drifts the waterfall off the total.
                    "_raw": delta,
                    "delta_pct": round(delta / p * 100, 1) if p > EPS else None})

        if p <= EPS and c > EPS:
            groups["new"].append(row)
        elif c <= EPS and p > EPS:
            groups["retired"].append(row)
        elif delta > EPS:
            groups["increased"].append(row)
        elif delta < -EPS:
            groups["decreased"].append(row)
        else:
            unchanged += 1
            unchanged_raw += delta

    buckets = []
    for key, label, desc in BUCKETS:
        rows = sorted(groups[key], key=lambda r: -abs(r["_raw"]))
        raw = sum(r["_raw"] for r in rows)
        buckets.append({
            "key": key, "label": label, "description": desc,
            "delta_usd": round(raw, 2),
            "_raw": raw,
            "count": len(rows),
            "items": [{k: v for k, v in r.items() if k != "_raw"} for r in rows[:top]],
            "truncated": len(rows) > top,
        })

    # The waterfall is only credible if it lands exactly on the current total.
    running = prev_total
    waterfall = [{"label": f"{p_from} → {p_to}", "kind": "total",
                  "value": round(prev_total, 2), "start": 0.0, "end": round(prev_total, 2)}]
    for b in buckets:
        start, running = running, running + b["_raw"]
        waterfall.append({"label": b["label"], "kind": "delta",
                          "value": b["delta_usd"],
                          "start": round(min(start, running), 2),
                          "end": round(max(start, running), 2),
                          "base": round(min(start, running), 2),
                          "span": round(abs(b["_raw"]), 2)})
    if abs(unchanged_raw) >= 0.005:
        start, running = running, running + unchanged_raw
        waterfall.append({"label": "Flat", "kind": "delta",
                          "value": round(unchanged_raw, 2),
                          "start": round(min(start, running), 2),
                          "end": round(max(start, running), 2),
                          "base": round(min(start, running), 2),
                          "span": round(abs(unchanged_raw), 2)})
    waterfall.append({"label": f"{d_from} → {d_to}", "kind": "total",
                      "value": round(cur_total, 2), "start": 0.0, "end": round(cur_total, 2)})

    reconciles = abs(sum(b["_raw"] for b in buckets) + unchanged_raw
                     - (cur_total - prev_total)) < 0.01
    for b in buckets:
        b.pop("_raw", None)

    movers = [{k: v for k, v in r.items() if k != "_raw"} for r in sorted(
        [r for g in groups.values() for r in g],
        key=lambda r: -abs(r["_raw"]))[:top]]

    delta = cur_total - prev_total
    return {
        "available": True,
        "dimension": dimension, "dimension_label": dim_label,
        "period_days": days,
        "current_from": str(d_from), "current_to": str(d_to),
        "previous_from": str(p_from), "previous_to": str(p_to),
        "current_total_usd": round(cur_total, 2),
        "previous_total_usd": round(prev_total, 2),
        "delta_usd": round(delta, 2),
        "delta_pct": round(delta / prev_total * 100, 1) if prev_total > EPS else None,
        "unchanged_count": unchanged,
        "unchanged_delta_usd": round(unchanged_raw, 2),
        "buckets": buckets,
        "waterfall": waterfall,
        "top_movers": movers,
        # Exposed so the UI can state it rather than the user having to trust it.
        "reconciles": reconciles,
        "dimensions": [{"key": k, "label": v[1]} for k, v in DIMENSIONS.items()],
    }
