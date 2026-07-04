"""
FinOps Advanced service — powers the advanced FinOps capabilities:

  1. Cost drill-down to resources  (filter_cost_resources)
       Given a Cost-Explorer style slice (dimension + value + optional filters),
       return the underlying resources with their individual monthly cost so a
       chart bar / table row can drill straight to "what's behind this number".

  2. Cost dependencies / workload roll-up  (workload_rollup)
       Roll cost up into WORKLOADS using one of three lenses:
         - "dependency": connected-component clusters from the dependency graph
                         (a VM + its disks + NIC + public IP + backup as one app),
         - "resource_group": group by resource group,
         - "tag": group by the value of a chosen tag key (e.g. application / cost-center).
       Each workload carries a per-resource-type cost breakdown + top members.

  3. Period-over-period comparison  (period_compare)
       Compare the current month vs the previous month by any dimension using the
       cost_current_month / cost_previous_month already attached to every resource
       in the dashboard cache — instant, no extra Cost Management calls.

All functions are PURE (operate on plain dicts) so they are unit-testable and can
run against either the live dashboard cache or stored/synthetic data. They never
call Azure directly — the caller passes the dashboard dict (and, for workloads, the
dependency-graph dict).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


# ── Dimension → resource-field mapping ──────────────────────────────────────────
# Maps the Cost-Explorer / Azure Cost Management dimension names the frontend uses
# to the fields present on a cached resource dict. Billing-only dimensions
# (ServiceFamily / MeterCategory) are not attributes of a resource, so drill-to-
# resource falls back to resource_type for those.
_DIM_FIELD = {
    "subscriptionid":      "subscription_id",
    "subscription":        "subscription_id",
    "resourcegroupname":   "resource_group",
    "resourcegroup":       "resource_group",
    "resourcetype":        "resource_type",
    "resourcelocation":    "location",
    "location":            "location",
    "resourceid":          "resource_id",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resources(dash: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Return the resource list from a dashboard dict, defensively."""
    if not isinstance(dash, dict):
        return []
    res = dash.get("resources")
    return res if isinstance(res, list) else []


def _sub_name_map(dash: Optional[Dict[str, Any]]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not isinstance(dash, dict):
        return out
    for s in (dash.get("subscriptions") or []):
        if isinstance(s, dict):
            sid = s.get("subscription_id") or s.get("id") or ""
            nm = s.get("subscription_name") or s.get("name") or ""
            if sid:
                out[sid] = nm or sid
    return out


def _fnum(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _res_out(r: Dict[str, Any], sub_names: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Canonical resource dict for the drill-down drawer / tables."""
    sid = r.get("subscription_id", "") or ""
    return {
        "resource_id":         r.get("resource_id", "") or r.get("id", ""),
        "resource_name":       r.get("resource_name", "") or r.get("name", ""),
        "resource_type":       r.get("resource_type", "") or r.get("type", ""),
        "resource_group":      r.get("resource_group", "") or "",
        "location":            r.get("location", "") or "",
        "subscription_id":     sid,
        "subscription_name":   (sub_names or {}).get(sid, "") or r.get("subscription_name", "") or sid,
        "cost_current_month":  round(_fnum(r.get("cost_current_month")), 2),
        "cost_previous_month": round(_fnum(r.get("cost_previous_month")), 2),
        "cost_delta_pct":      _fnum(r.get("cost_delta_pct")),
        "final_score":         r.get("final_score"),
        "has_backup":          bool(r.get("has_backup")),
        "has_lock":            bool(r.get("has_lock")),
        "power_state":         r.get("power_state", "") or "",
        "sku":                 r.get("sku", "") or "",
        "primary_utilization_pct": r.get("primary_utilization_pct"),
        "tags":                r.get("tags") or {},
    }


def _tag_get(r: Dict[str, Any], key: str) -> str:
    """Case-insensitive tag lookup (returns '' if absent)."""
    tags = r.get("tags") or {}
    if not isinstance(tags, dict):
        return ""
    if key in tags:
        return str(tags.get(key) or "")
    lk = key.lower()
    for k, v in tags.items():
        if str(k).lower() == lk:
            return str(v or "")
    return ""


# ═══════════════════════════════════════════════════════════════════════════════
#  1. Cost drill-down to resources
# ═══════════════════════════════════════════════════════════════════════════════

def filter_cost_resources(
    dash: Optional[Dict[str, Any]],
    *,
    subscription_id: Optional[str] = None,
    resource_group: Optional[str] = None,
    resource_type: Optional[str] = None,
    region: Optional[str] = None,
    tag_key: Optional[str] = None,
    tag_value: Optional[str] = None,
    environment: Optional[str] = None,
    search: Optional[str] = None,
    min_cost: Optional[float] = None,
    max_cost: Optional[float] = None,
    limit: int = 500,
) -> Dict[str, Any]:
    """Return the resources behind a cost slice, sorted by monthly cost desc."""
    sub_names = _sub_name_map(dash)
    rows: List[Dict[str, Any]] = []
    for r in _resources(dash):
        if not isinstance(r, dict):
            continue
        if subscription_id and (r.get("subscription_id", "") != subscription_id):
            continue
        if resource_group and ((r.get("resource_group", "") or "").lower() != resource_group.lower()):
            continue
        if resource_type and ((r.get("resource_type", "") or "").lower() != resource_type.lower()):
            continue
        if region and ((r.get("location", "") or "").lower() != region.lower()):
            continue
        if tag_key:
            tv = _tag_get(r, tag_key)
            if tag_value is not None:
                # "(untagged)" sentinel matches empty tag values
                if tag_value in ("", "(untagged)", "untagged"):
                    if tv:
                        continue
                elif tv.lower() != tag_value.lower():
                    continue
            elif not tv:
                continue
        if environment:
            ev = _tag_get(r, "Environment") or _tag_get(r, "env")
            if ev.lower() != environment.lower():
                continue
        if search:
            s = search.lower()
            hay = f"{r.get('resource_name','')} {r.get('resource_type','')} {r.get('resource_group','')}".lower()
            if s not in hay:
                continue
        cost = _fnum(r.get("cost_current_month"))
        if min_cost is not None and cost < min_cost:
            continue
        if max_cost is not None and cost > max_cost:
            continue
        rows.append(_res_out(r, sub_names))

    rows.sort(key=lambda x: x["cost_current_month"], reverse=True)
    total = round(sum(x["cost_current_month"] for x in rows), 2)
    prev_total = round(sum(x["cost_previous_month"] for x in rows), 2)
    return {
        "resources":     rows[: max(1, min(limit, 5000))],
        "count":         len(rows),
        "total_cost":    total,
        "prev_total_cost": prev_total,
        "delta_usd":     round(total - prev_total, 2),
        "generated_at":  _now_iso(),
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  2. Cost dependencies / workload roll-up
# ═══════════════════════════════════════════════════════════════════════════════

def _short_type(rt: str) -> str:
    return (rt or "").split("/")[-1] or (rt or "")


def _member_out(r: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "resource_id":        r.get("resource_id", "") or r.get("id", ""),
        "resource_name":      r.get("resource_name", "") or r.get("name", ""),
        "resource_type":      r.get("resource_type", "") or r.get("type", ""),
        "resource_group":     r.get("resource_group", "") or "",
        "location":           r.get("location", "") or "",
        "subscription_id":    r.get("subscription_id", "") or "",
        "cost_current_month": round(_fnum(r.get("cost_current_month")), 2),
        "cost_previous_month": round(_fnum(r.get("cost_previous_month")), 2),
    }


def _breakdown_by_type(members: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    agg: Dict[str, Dict[str, Any]] = {}
    for m in members:
        st = _short_type(m.get("resource_type", ""))
        b = agg.setdefault(st, {"type": st, "cost": 0.0, "count": 0})
        b["cost"] += _fnum(m.get("cost_current_month"))
        b["count"] += 1
    out = sorted(agg.values(), key=lambda x: -x["cost"])
    for b in out:
        b["cost"] = round(b["cost"], 2)
    return out


def workload_rollup(
    dash: Optional[Dict[str, Any]],
    graph: Optional[Dict[str, Any]] = None,
    *,
    group_by: str = "dependency",
    tag_key: Optional[str] = None,
    subscription_id: Optional[str] = None,
    region: Optional[str] = None,
    limit: int = 200,
    members_per_workload: int = 200,
) -> Dict[str, Any]:
    """
    Roll cost up into workloads.

    group_by:
      - "dependency"     → connected-component clusters from the dependency graph.
      - "resource_group" → group by resource group.
      - "tag"            → group by the value of `tag_key`.

    Optional scope filters (subscription_id / region) restrict the resources that
    count toward each workload, so the view reflects the selected scope.
    """
    resources = _resources(dash)
    if subscription_id:
        resources = [r for r in resources if isinstance(r, dict) and r.get("subscription_id", "") == subscription_id]
    if region:
        rl = region.lower()
        resources = [r for r in resources if isinstance(r, dict) and (r.get("location", "") or "").lower() == rl]
    by_id = {(r.get("resource_id", "") or r.get("id", "")).lower(): r for r in resources if isinstance(r, dict)}
    workloads: List[Dict[str, Any]] = []
    total_cost = 0.0

    if group_by == "dependency":
        clusters = (graph or {}).get("clusters") if isinstance(graph, dict) else None
        for c in (clusters or []):
            member_ids = [str(m).lower() for m in (c.get("resources") or [])]
            members = [_member_out(by_id[mid]) for mid in member_ids if mid in by_id]
            if not members:
                continue  # cluster has no members in the selected scope
            members.sort(key=lambda x: -x["cost_current_month"])
            cost = round(sum(m["cost_current_month"] for m in members), 2)
            prev = round(sum(m["cost_previous_month"] for m in members), 2)
            regions = sorted({m["location"] for m in members if m["location"]})
            types = sorted({_short_type(m["resource_type"]) for m in members if m["resource_type"]})
            total_cost += cost
            workloads.append({
                "id":            c.get("id", ""),
                "name":          c.get("suggested_workload_name") or c.get("name") or "Workload",
                "cost":          cost,
                "prev_cost":     prev,
                "delta_usd":     round(cost - prev, 2),
                "resource_count": len(members),
                "resource_types": types or (c.get("resource_types") or []),
                "regions":       regions or (c.get("regions") or []),
                "is_island":     len(members) == 1,
                "cross_region":  len(regions) > 1,
                "breakdown":     _breakdown_by_type(members),
                "members":       members[: max(1, members_per_workload)],
            })
    else:
        # Group by resource_group or a tag value.
        groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for r in resources:
            if not isinstance(r, dict):
                continue
            if group_by == "tag":
                key = _tag_get(r, tag_key or "") or "(untagged)"
            else:  # resource_group
                key = r.get("resource_group", "") or "(none)"
            groups[key].append(r)
        for key, members_raw in groups.items():
            members = [_member_out(m) for m in members_raw]
            members.sort(key=lambda x: -x["cost_current_month"])
            cost = round(sum(m["cost_current_month"] for m in members), 2)
            prev = round(sum(m["cost_previous_month"] for m in members), 2)
            total_cost += cost
            regions = sorted({m["location"] for m in members if m["location"]})
            types = sorted({_short_type(m["resource_type"]) for m in members if m["resource_type"]})
            workloads.append({
                "id":            key,
                "name":          key,
                "cost":          cost,
                "prev_cost":     prev,
                "delta_usd":     round(cost - prev, 2),
                "resource_count": len(members),
                "resource_types": types,
                "regions":       regions,
                "is_island":     len(members) == 1,
                "cross_region":  len(regions) > 1,
                "breakdown":     _breakdown_by_type(members),
                "members":       members[: max(1, members_per_workload)],
            })

    workloads.sort(key=lambda w: -w["cost"])
    total_cost = round(total_cost, 2)
    untagged_cost = 0.0
    if group_by == "tag":
        untagged_cost = round(sum(w["cost"] for w in workloads if w["name"] == "(untagged)"), 2)

    return {
        "mode":           group_by,
        "tag_key":        tag_key if group_by == "tag" else None,
        "workloads":      workloads[: max(1, min(limit, 1000))],
        "workload_count": len(workloads),
        "total_cost":     total_cost,
        "untagged_cost":  untagged_cost,
        "generated_at":   _now_iso(),
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  3. Period-over-period comparison
# ═══════════════════════════════════════════════════════════════════════════════

def _compare_key(r: Dict[str, Any], dimension: str, tag_key: Optional[str], sub_names: Dict[str, str]):
    """Return (raw_key, display_label) for a resource under the given dimension.
    raw_key is what the drill-down filter needs (e.g. the subscription GUID); the
    label is what the UI shows (e.g. the subscription name)."""
    dl = (dimension or "").lower()
    if dl.startswith("tag") and tag_key:
        v = _tag_get(r, tag_key) or "(untagged)"
        return v, v
    field = _DIM_FIELD.get(dl, "resource_group")
    val = r.get(field, "") or ""
    if field == "subscription_id":
        return (val or "(unknown)"), (sub_names.get(val, val) or val or "(unknown)")
    if field == "resource_type":
        return (val or "(unknown)"), (val or "(unknown)")
    return (val or "(none)"), (val or "(none)")


def period_compare(
    dash: Optional[Dict[str, Any]],
    *,
    dimension: str = "ResourceGroupName",
    tag_key: Optional[str] = None,
    limit: int = 100,
) -> Dict[str, Any]:
    """
    Current month (MTD) vs previous month, grouped by `dimension`, using the
    cost_current_month / cost_previous_month already on each cached resource.

    A `projection_factor` is included so the UI can optionally project the partial
    current month to a full month for a like-for-like comparison.
    """
    sub_names = _sub_name_map(dash)
    agg: Dict[str, Dict[str, Any]] = {}
    for r in _resources(dash):
        if not isinstance(r, dict):
            continue
        key, label = _compare_key(r, dimension, tag_key, sub_names)
        a = agg.setdefault(key, {"key": key, "value": label, "current": 0.0, "prior": 0.0, "resource_count": 0})
        a["current"] += _fnum(r.get("cost_current_month"))
        a["prior"] += _fnum(r.get("cost_previous_month"))
        a["resource_count"] += 1

    rows: List[Dict[str, Any]] = []
    for a in agg.values():
        cur = round(a["current"], 2)
        pri = round(a["prior"], 2)
        delta = round(cur - pri, 2)
        pct = round((delta / pri * 100.0), 1) if pri > 0 else (100.0 if cur > 0 else 0.0)
        rows.append({
            "key":            a["key"],
            "value":          a["value"],
            "current":        cur,
            "prior":          pri,
            "delta_usd":      delta,
            "delta_pct":      pct,
            "direction":      "up" if delta > 0 else ("down" if delta < 0 else "flat"),
            "resource_count": a["resource_count"],
        })
    rows.sort(key=lambda x: -abs(x["delta_usd"]))

    # Day-based projection factor for the current (partial) month.
    now = datetime.now(timezone.utc)
    import calendar as _cal
    days_in_month = _cal.monthrange(now.year, now.month)[1]
    day_of_month = max(1, now.day)
    projection_factor = round(days_in_month / day_of_month, 4)

    total_current = round(sum(r["current"] for r in rows), 2)
    total_prior = round(sum(r["prior"] for r in rows), 2)
    return {
        "dimension":         dimension,
        "tag_key":           tag_key,
        "rows":              rows[: max(1, min(limit, 1000))],
        "row_count":         len(rows),
        "total_current":     total_current,
        "total_prior":       total_prior,
        "total_delta_usd":   round(total_current - total_prior, 2),
        "total_delta_pct":   round(((total_current - total_prior) / total_prior * 100.0), 1) if total_prior > 0 else 0.0,
        "projection_factor": projection_factor,
        "projected_current": round(total_current * projection_factor, 2),
        "day_of_month":      day_of_month,
        "days_in_month":     days_in_month,
        "generated_at":      _now_iso(),
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  4. Chargeback / showback allocation engine
# ═══════════════════════════════════════════════════════════════════════════════

def _rule_matches(r: Dict[str, Any], rule: Dict[str, Any]) -> bool:
    """True if a cached resource matches a single allocation rule."""
    rtype = (rule.get("type") or "").lower()
    val = str(rule.get("match_value") or "").strip()
    if not val:
        return False
    v = val.lower()
    if rtype == "tag":
        key = rule.get("match_key") or ""
        return bool(key) and _tag_get(r, key).strip().lower() == v
    if rtype in ("subscription", "subscriptionid"):
        return str(r.get("subscription_id") or "").lower() == v
    if rtype in ("resource_group", "resourcegroupname", "resourcegroup"):
        return str(r.get("resource_group") or "").strip().lower() == v
    if rtype in ("resource_type", "resourcetype"):
        return str(r.get("resource_type") or "").strip().lower() == v
    if rtype in ("region", "location", "resourcelocation"):
        return str(r.get("location") or "").strip().lower() == v
    return False


def compute_chargeback(dash: Optional[Dict[str, Any]], model: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Real chargeback/showback engine. Allocates 100% of the period's spend to
    user-defined cost centers via ordered rules (first match wins), distributes the
    shared/unmatched pool by a chosen method, and applies an optional overhead markup.

    model = {
      "cost_centers": [{"id","name","owner","weight","headcount"}],
      "rules":        [{"id","type","match_key","match_value","cost_center_id"}],
      "shared_allocation": "proportional"|"even"|"weighted"|"headcount"|"none",
      "markup_pct":   float,
      "cost_field":   "current"|"previous",
    }
    """
    model = model or {}
    ccs_in = [c for c in (model.get("cost_centers") or []) if isinstance(c, dict)]
    rules = [r for r in (model.get("rules") or []) if isinstance(r, dict)]
    method = (model.get("shared_allocation") or "proportional").lower()
    try:
        markup_pct = float(model.get("markup_pct") or 0.0)
    except (TypeError, ValueError):
        markup_pct = 0.0
    cost_field = "cost_previous_month" if (model.get("cost_field") == "previous") else "cost_current_month"

    # Cost-center accumulators (preserve declared order).
    cc: Dict[str, Dict[str, Any]] = {}
    order: List[str] = []
    for c in ccs_in:
        cid = str(c.get("id") or c.get("name") or "").strip()
        if not cid or cid in cc:
            continue
        order.append(cid)
        cc[cid] = {
            "id": cid, "name": c.get("name") or cid, "owner": c.get("owner") or "",
            "weight": _fnum(c.get("weight")), "headcount": _fnum(c.get("headcount")),
            "direct_usd": 0.0, "allocated_shared_usd": 0.0, "resource_count": 0,
        }

    shared_pool = 0.0
    shared_count = 0
    matched_count = 0
    total_spend = 0.0

    for r in _resources(dash):
        if not isinstance(r, dict):
            continue
        cost = _fnum(r.get(cost_field))
        total_spend += cost
        target = None
        for rule in rules:  # first match wins
            cid = str(rule.get("cost_center_id") or "").strip()
            if cid and cid in cc and _rule_matches(r, rule):
                target = cid
                break
        if target is not None:
            cc[target]["direct_usd"] += cost
            cc[target]["resource_count"] += 1
            matched_count += 1
        else:
            shared_pool += cost
            shared_count += 1

    total_direct = sum(c["direct_usd"] for c in cc.values())

    # Distribute the shared/unmatched pool across cost centers.
    distributed = 0.0
    if shared_pool > 0 and order and method != "none":
        if method == "proportional" and total_direct > 0:
            weights = {cid: cc[cid]["direct_usd"] / total_direct for cid in order}
        elif method == "weighted" and sum(cc[c]["weight"] for c in order) > 0:
            wsum = sum(cc[c]["weight"] for c in order)
            weights = {cid: cc[cid]["weight"] / wsum for cid in order}
        elif method == "headcount" and sum(cc[c]["headcount"] for c in order) > 0:
            hsum = sum(cc[c]["headcount"] for c in order)
            weights = {cid: cc[cid]["headcount"] / hsum for cid in order}
        else:  # even — also the fallback when the chosen basis is all-zero
            weights = {cid: 1.0 / len(order) for cid in order}
        for cid in order:
            share = shared_pool * weights[cid]
            cc[cid]["allocated_shared_usd"] = round(share, 2)
            distributed += share

    unallocated = round(shared_pool - distributed, 2)

    # Build cost-center rows with markup + % of total.
    grand_subtotal = total_direct + distributed
    grand_markup = 0.0
    rows: List[Dict[str, Any]] = []
    for cid in order:
        c = cc[cid]
        subtotal = c["direct_usd"] + c["allocated_shared_usd"]
        markup_usd = subtotal * markup_pct / 100.0
        grand_markup += markup_usd
        rows.append({
            "id": cid, "name": c["name"], "owner": c["owner"],
            "direct_usd": round(c["direct_usd"], 2),
            "allocated_shared_usd": round(c["allocated_shared_usd"], 2),
            "subtotal_usd": round(subtotal, 2),
            "markup_usd": round(markup_usd, 2),
            "total_usd": round(subtotal + markup_usd, 2),
            "resource_count": c["resource_count"],
        })

    chargeback_total = grand_subtotal + grand_markup
    for row in rows:
        row["pct_of_total"] = round(row["total_usd"] / chargeback_total * 100.0, 1) if chargeback_total > 0 else 0.0
    rows.sort(key=lambda x: -x["total_usd"])

    return {
        "cost_centers":            rows,
        "total_spend_usd":         round(total_spend, 2),
        "total_direct_usd":        round(total_direct, 2),
        "shared_pool_usd":         round(shared_pool, 2),
        "shared_distributed_usd":  round(distributed, 2),
        "unallocated_usd":         unallocated,
        "markup_pct":              round(markup_pct, 2),
        "markup_total_usd":        round(grand_markup, 2),
        "chargeback_total_usd":    round(chargeback_total, 2),
        "shared_allocation_method": method,
        "cost_field":              "previous" if cost_field == "cost_previous_month" else "current",
        "matched_resource_count":  matched_count,
        "unmatched_resource_count": shared_count,
        "total_resource_count":    matched_count + shared_count,
        "cost_center_count":       len(order),
        "coverage_pct":            round(total_direct / total_spend * 100.0, 1) if total_spend > 0 else 0.0,
        "reconciled":              abs((grand_subtotal + unallocated) - total_spend) < 0.5,
        "generated_at":            _now_iso(),
    }


# ══════════════════════════════════════════════════════════════════════════════
#  5. Unit economics / business value
# ══════════════════════════════════════════════════════════════════════════════

def compute_unit_economics(dash: Optional[Dict[str, Any]], model: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Cost-per-unit / business-value engine. Sums the (optionally scoped) current and
    previous month cost from the resource cache, then divides by user-defined value
    drivers (customers, transactions, revenue, …) to yield cost-per-unit, its MoM
    change, and variance vs an optional target — the 'understanding the value' pillar
    that the Azure portal has no equivalent for.

    model = {
      "scope":   {"subscription_id","resource_group","tag_key","tag_value"},
      "drivers": [{"id","name","unit","value","previous_value","target_cpu"}],
    }
    """
    model = model or {}
    scope = model.get("scope") or {}
    sub = str(scope.get("subscription_id") or "").strip()
    rg = str(scope.get("resource_group") or "").strip().lower()
    tag_key = scope.get("tag_key") or ""
    tag_val = str(scope.get("tag_value") or "").strip().lower()
    drivers_in = [d for d in (model.get("drivers") or []) if isinstance(d, dict)]

    cur = 0.0
    prev = 0.0
    count = 0
    for r in _resources(dash):
        if not isinstance(r, dict):
            continue
        if sub and str(r.get("subscription_id") or "") != sub:
            continue
        if rg and str(r.get("resource_group") or "").strip().lower() != rg:
            continue
        if tag_key and _tag_get(r, tag_key).strip().lower() != tag_val:
            continue
        cur += _fnum(r.get("cost_current_month"))
        prev += _fnum(r.get("cost_previous_month"))
        count += 1

    drivers_out: List[Dict[str, Any]] = []
    for d in drivers_in:
        val = _fnum(d.get("value"))
        pval = _fnum(d.get("previous_value")) or val
        target = _fnum(d.get("target_cpu"))
        cpu = (cur / val) if val > 0 else 0.0
        cpu_prev = (prev / pval) if pval > 0 else 0.0
        mom = ((cpu - cpu_prev) / cpu_prev * 100.0) if cpu_prev > 0 else 0.0
        vs_target = ((cpu - target) / target * 100.0) if target > 0 else 0.0
        drivers_out.append({
            "id": d.get("id") or "", "name": d.get("name") or "", "unit": d.get("unit") or "unit",
            "value": round(val, 4), "previous_value": round(pval, 4),
            "cost_per_unit": round(cpu, 4), "cost_per_unit_prev": round(cpu_prev, 4),
            "mom_pct": round(mom, 1), "target_cpu": round(target, 4),
            "vs_target_pct": round(vs_target, 1),
            "status": ("over" if cpu > target else "under") if target > 0 else "none",
        })

    return {
        "scope_current_usd":  round(cur, 2),
        "scope_previous_usd": round(prev, 2),
        "scope_mom_pct":      round(((cur - prev) / prev * 100.0), 1) if prev > 0 else 0.0,
        "resource_count":     count,
        "drivers":            drivers_out,
        "generated_at":       _now_iso(),
    }
