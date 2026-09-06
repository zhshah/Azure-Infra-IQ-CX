"""
FinOps Management Dashboard Service.

Serves the management cost & usage review: executive landing, subscription /
management-group rollup, resource-group economics, service categories, VM cost
vs utilisation, storage growth, PaaS-by-environment and savings/ROI.

Reads the warehouse tables created by migration 006 plus the existing FinOps
warehouse. Everything here is additive — no existing service or endpoint changes
behaviour because of this module.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import time
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

try:
    from services.database import get_connection, upsert_conflict_sql
    _DB_AVAILABLE = True
except Exception as e:  # pragma: no cover
    _DB_AVAILABLE = False
    logger.warning("FinOps Dashboard: database unavailable: %s", e)


UTILIZATION_HISTORY_DAYS = 120
CAPACITY_HISTORY_DAYS = 180

# A VM at or below this average CPU is treated as underutilised.
UNDERUTILIZED_CPU_PCT = 20.0
VM_TYPES = ("microsoft.compute/virtualmachines", "microsoft.compute/virtualmachinescalesets")


# ── Environment classification ────────────────────────────────────────────────
# Normalises the free-text Environment tag (and, failing that, the resource-group
# name) into Production / Non-Production / Unclassified so prod-vs-non-prod cost
# is answerable even when tagging is inconsistent.

_PROD_PAT = re.compile(
    r"^(prod|prd|production|live|pd)$|(^|[^a-z])(prod|prd|production|live)([^a-z]|$)", re.I)
_NONPROD_PAT = re.compile(
    r"^(dev|development|test|tst|qa|uat|stg|stage|staging|sandbox|sbx|demo|poc|lab|nonprod|non-prod|np|preprod|pre-prod)$"
    r"|(^|[^a-z])(dev|development|test|qa|uat|staging|stage|sandbox|demo|poc|lab|nonprod|non-prod|preprod|pre-prod)([^a-z]|$)",
    re.I)

ENV_PROD = "Production"
ENV_NONPROD = "Non-Production"
ENV_UNKNOWN = "Unclassified"


def classify_environment(tag_value: Optional[str] = None,
                         resource_group: Optional[str] = None,
                         resource_name: Optional[str] = None) -> str:
    """Normalise an environment signal to Production / Non-Production / Unclassified.

    Non-production is tested first: a name like 'prod-test' is a test system."""
    for candidate in (tag_value, resource_group, resource_name):
        s = str(candidate or "").strip()
        if not s:
            continue
        if _NONPROD_PAT.search(s):
            return ENV_NONPROD
        if _PROD_PAT.search(s):
            return ENV_PROD
    return ENV_UNKNOWN


def _tag_lookup(tags: Any, *keys: str) -> str:
    if not isinstance(tags, dict):
        return ""
    lowered = {str(k).lower(): v for k, v in tags.items()}
    for k in keys:
        v = lowered.get(k.lower())
        if v:
            return str(v)
    return ""


# ── DB helpers ────────────────────────────────────────────────────────────────

@contextmanager
def _conn():
    with get_connection() as con:
        yield con


def _sub_clause(subscription_ids: Optional[List[str]], col: str = "subscription_id") -> str:
    subs = [s for s in (subscription_ids or []) if s]
    if not subs:
        return ""
    quoted = ",".join("'" + s.replace("'", "''") + "'" for s in subs)
    return f" AND {col} IN ({quoted})"


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _latest_snapshot_date(table: str) -> Optional[str]:
    try:
        with _conn() as con:
            row = con.execute(f"SELECT MAX(snapshot_date) FROM {table}").fetchone()
            return row[0] if row and row[0] else None
    except Exception:
        return None


# ── Snapshot collectors ───────────────────────────────────────────────────────

def get_dimension_breakdown(dimension: str, days: int = 30,
                            subscription_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Cost grouped by a stored dimension (resource_group, location, service_name...).

    The warehouse dashboard only exposes subscription/service/environment grains, so
    a ResourceGroup or Location request used to be answered with service data — the
    right heading over the wrong numbers. This reads the dimension table directly."""
    if not _DB_AVAILABLE or not dimension:
        return []
    d_from = str(_today() - timedelta(days=max(1, days)))
    sql = ("SELECT dim_value, SUM(cost_usd) FROM finops_daily_dimension_costs "
           "WHERE dimension = ? AND snapshot_date >= ?"
           f"{_sub_clause(subscription_ids)} "
           "GROUP BY dim_value ORDER BY SUM(cost_usd) DESC")
    try:
        with _conn() as con:
            return [{"label": (r[0] or "(unassigned)"), "name": (r[0] or "(unassigned)"),
                     "cost": round(float(r[1] or 0), 2)}
                    for r in con.execute(sql, (dimension, d_from)).fetchall()
                    if float(r[1] or 0) > 0]
    except Exception as e:
        logger.warning("dimension breakdown (%s) failed: %s", dimension, e)
        return []


# Five round-trips to Azure SQL (~1.9s) on every call, and this is on the hot path of
# both /api/finops/summary and /api/metrics/summary. The warehouse is refreshed by the
# ETL at most hourly, so re-reading it per request buys nothing.
_SPEND_TTL_SECONDS = int(os.getenv("FINOPS_AUTH_SPEND_CACHE_SECONDS", "600") or 600)
_spend_cache: Dict[str, Any] = {"data": None, "ts": 0.0, "day": None}


def get_authoritative_spend(force_refresh: bool = False) -> Dict[str, float]:
    """Month-to-date and last-month spend from the SUBSCRIPTION-level warehouse.

    Subscription-scope totals come back from Cost Management in a single call and are
    complete. The scan's own total is a sum of per-resource attribution, which is
    routinely throttled — it reported $24 for a month that actually cost $690. Use
    this as the truth whenever the scan's figure is materially lower."""
    out = {"mtd_usd": 0.0, "last_month_usd": 0.0, "prior_month_to_date_usd": 0.0,
           "prior_month_to_date_days": 0, "elapsed_days": 0, "prior_month_days": 0,
           "rolling_30d_usd": 0.0, "days_recorded": 0}
    if not _DB_AVAILABLE:
        return out
    today = _today()
    # Bust the cache on a date rollover as well as on the TTL, so month-to-date and the
    # elapsed-day comparison never serve yesterday's window.
    if (not force_refresh and _SPEND_TTL_SECONDS > 0
            and _spend_cache["data"] is not None
            and _spend_cache["day"] == today
            and (time.monotonic() - _spend_cache["ts"]) < _SPEND_TTL_SECONDS):
        return _spend_cache["data"]
    m_start = today.replace(day=1)
    prev_end = m_start - timedelta(days=1)
    prev_start = prev_end.replace(day=1)
    try:
        with _conn() as con:
            row = con.execute(
                "SELECT SUM(cost_usd), COUNT(DISTINCT snapshot_date) "
                "FROM finops_daily_subscription_costs WHERE snapshot_date >= ?",
                (str(m_start),)).fetchone()
            if row:
                out["mtd_usd"] = round(float(row[0] or 0), 2)
                out["days_recorded"] = int(row[1] or 0)
            row = con.execute(
                "SELECT SUM(cost_usd) FROM finops_daily_subscription_costs "
                "WHERE snapshot_date >= ? AND snapshot_date <= ?",
                (str(prev_start), str(prev_end))).fetchone()
            if row:
                out["last_month_usd"] = round(float(row[0] or 0), 2)
            # Same elapsed day-count in the prior month, so a part-month is never
            # compared against a full month (which always fakes a large decrease).
            try:
                prior_cutoff = prev_start.replace(day=min(today.day, prev_end.day))
            except ValueError:
                prior_cutoff = prev_end
            row = con.execute(
                "SELECT SUM(cost_usd), COUNT(DISTINCT snapshot_date) "
                "FROM finops_daily_subscription_costs "
                "WHERE snapshot_date >= ? AND snapshot_date <= ?",
                (str(prev_start), str(prior_cutoff))).fetchone()
            if row:
                out["prior_month_to_date_usd"] = round(float(row[0] or 0), 2)
                out["prior_month_to_date_days"] = int(row[1] or 0)
            out["elapsed_days"] = today.day
            out["prior_month_days"] = prev_end.day
            row = con.execute(
                "SELECT SUM(cost_usd) FROM finops_daily_subscription_costs "
                "WHERE snapshot_date >= ?",
                (str(today - timedelta(days=30)),)).fetchone()
            if row:
                out["rolling_30d_usd"] = round(float(row[0] or 0), 2)
    except Exception as e:
        logger.warning("authoritative spend lookup failed: %s", e)
        return out
    _spend_cache.update({"data": out, "ts": time.monotonic(), "day": today})
    return out


def get_idle_resource_map() -> Dict[str, Dict[str, Any]]:
    """{resource_id_lower: {power_state, days_idle, cost_month_usd}} for resources the
    latest utilisation snapshot flagged idle.

    The dashboard's `final_score` deliberately does NOT punish a deallocated VM for 0%
    CPU (being off is its expected state), so a score threshold alone never surfaces
    stopped-but-billing machines. This exposes the same is_idle signal that drives the
    savings recommendations, so both views agree."""
    out: Dict[str, Dict[str, Any]] = {}
    if not _DB_AVAILABLE:
        return out
    try:
        with _conn() as con:
            sd = _latest_snapshot_date("finops_resource_utilization")
            if not sd:
                return out
            for row in con.execute(
                    "SELECT resource_id, power_state, days_idle, cost_month_usd, avg_cpu_pct "
                    "FROM finops_resource_utilization "
                    "WHERE snapshot_date = ? AND is_idle = 1", (sd,)).fetchall():
                out[str(row[0]).lower()] = {
                    "power_state": row[1] or "",
                    "days_idle": int(row[2] or 0),
                    "cost_month_usd": round(float(row[3] or 0), 2),
                    "avg_cpu_pct": float(row[4]) if row[4] is not None else None,
                }
    except Exception as e:
        logger.warning("idle resource lookup failed: %s", e)
    return out


def _warehouse_resource_costs(days: int = 30) -> Dict[str, float]:
    """{resource_id_lower: monthly-equivalent cost} from the per-resource warehouse.

    The scan's own `cost_current_month` is frequently 0 because per-resource cost
    attribution is throttled, which would make the VM / environment / resource-group
    panels read $0. Cost Management's stored per-resource grain is authoritative."""
    out: Dict[str, float] = {}
    if not _DB_AVAILABLE:
        return out
    d_from = str(_today() - timedelta(days=days))
    try:
        with _conn() as con:
            for row in con.execute(
                    "SELECT resource_id, SUM(cost_usd), COUNT(DISTINCT snapshot_date) "
                    "FROM finops_daily_resource_costs WHERE snapshot_date >= ? AND resource_id <> '' "
                    "GROUP BY resource_id", (d_from,)).fetchall():
                total, ndays = float(row[1] or 0), int(row[2] or 0)
                if ndays:
                    out[str(row[0]).lower()] = round(total / ndays * 30.0, 4)
    except Exception as e:
        logger.warning("warehouse resource cost lookup failed: %s", e)
    return out


def snapshot_utilization(resources: List[Any], run_id: str = "") -> int:
    """Persist today's per-resource utilisation + power state + cost.

    Called after a scan so cost-vs-utilisation, idle-VM cost and running/stopped
    counts become a historical series rather than a point-in-time read."""
    if not _DB_AVAILABLE or not resources:
        return 0
    sd = str(_today())
    wh_cost = _warehouse_resource_costs()
    cols = ["id", "snapshot_date", "subscription_id", "resource_id", "resource_name",
            "resource_group", "resource_type", "location", "sku", "power_state",
            "avg_cpu_pct", "avg_memory_pct", "utilization_pct", "is_idle", "is_orphan",
            "days_idle", "cost_month_usd", "environment", "etl_run_id"]
    sql = upsert_conflict_sql("finops_resource_utilization", cols, ["id"],
                              [c for c in cols if c != "id"])
    written = 0
    try:
        with _conn() as con:
            for r in resources:
                rid = str(getattr(r, "resource_id", "") or "")
                if not rid:
                    continue
                tags = getattr(r, "tags", None) or {}
                rg = str(getattr(r, "resource_group", "") or "")
                name = str(getattr(r, "resource_name", "") or "")
                env = classify_environment(_tag_lookup(tags, "environment", "env"), rg, name)
                days_idle = int(getattr(r, "days_since_active", 0) or 0)
                power = str(getattr(r, "power_state", "") or "")
                util = getattr(r, "primary_utilization_pct", None)
                is_idle = 1 if (power == "deallocated" or days_idle >= 30
                                or (util is not None and float(util) < 5)) else 0
                cost = float(getattr(r, "cost_current_month", 0) or 0)
                if cost <= 0:
                    cost = wh_cost.get(rid.lower(), 0.0)
                key = hashlib.sha256(f"{sd}|{rid}".encode("utf-8")).hexdigest()
                con.execute(sql, (
                    key, sd,
                    str(getattr(r, "subscription_id", "") or ""),
                    rid, name, rg,
                    str(getattr(r, "resource_type", "") or "").lower(),
                    str(getattr(r, "location", "") or ""),
                    str(getattr(r, "sku", "") or ""),
                    power,
                    getattr(r, "avg_cpu_pct", None),
                    getattr(r, "avg_memory_pct", None),
                    util,
                    is_idle,
                    1 if getattr(r, "is_orphan", False) else 0,
                    days_idle,
                    cost,
                    env, run_id,
                ))
                written += 1
    except Exception as e:
        logger.error("utilisation snapshot failed: %s", e)
    return written


def snapshot_storage_capacity(resources: List[Any], run_id: str = "") -> int:
    """Persist today's storage capacity in GB so GB/month growth is measurable."""
    if not _DB_AVAILABLE or not resources:
        return 0
    sd = str(_today())
    wh_cost = _warehouse_resource_costs()
    cols = ["id", "snapshot_date", "subscription_id", "resource_id", "resource_name",
            "resource_group", "resource_type", "access_tier", "redundancy",
            "capacity_gb", "cost_month_usd", "etl_run_id"]
    sql = upsert_conflict_sql("finops_storage_capacity", cols, ["id"],
                              [c for c in cols if c != "id"])
    written = 0
    try:
        with _conn() as con:
            for r in resources:
                rtype = str(getattr(r, "resource_type", "") or "").lower()
                if not ("storage" in rtype or "disk" in rtype):
                    continue
                rid = str(getattr(r, "resource_id", "") or "")
                if not rid:
                    continue
                sku = str(getattr(r, "sku", "") or "")
                redundancy = ""
                for tag in ("GZRS", "GRS", "ZRS", "LRS", "RAGRS"):
                    if tag.lower() in sku.lower():
                        redundancy = tag
                        break
                tags = getattr(r, "tags", None) or {}
                key = hashlib.sha256(f"{sd}|{rid}".encode("utf-8")).hexdigest()
                cost = float(getattr(r, "cost_current_month", 0) or 0)
                if cost <= 0:
                    cost = wh_cost.get(rid.lower(), 0.0)
                con.execute(sql, (
                    key, sd,
                    str(getattr(r, "subscription_id", "") or ""),
                    rid,
                    str(getattr(r, "resource_name", "") or ""),
                    str(getattr(r, "resource_group", "") or ""),
                    rtype,
                    _tag_lookup(tags, "accessTier", "access_tier"),
                    redundancy,
                    float(getattr(r, "storage_capacity_gb", 0) or 0),
                    cost,
                    run_id,
                ))
                written += 1
    except Exception as e:
        logger.error("storage capacity snapshot failed: %s", e)
    return written


def purge_old(keep_util_days: int = UTILIZATION_HISTORY_DAYS,
              keep_cap_days: int = CAPACITY_HISTORY_DAYS) -> None:
    if not _DB_AVAILABLE:
        return
    t = _today()
    try:
        with _conn() as con:
            con.execute("DELETE FROM finops_resource_utilization WHERE snapshot_date < ?",
                        (str(t - timedelta(days=keep_util_days)),))
            con.execute("DELETE FROM finops_storage_capacity WHERE snapshot_date < ?",
                        (str(t - timedelta(days=keep_cap_days)),))
    except Exception as e:
        logger.warning("dashboard purge failed: %s", e)


# ── VM cost & utilisation ─────────────────────────────────────────────────────

def get_vm_cost_utilization(subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Total VM spend, running vs stopped, idle cost, avg CPU/memory, % underutilised
    and the VM -> size -> cost -> utilisation table (latest snapshot)."""
    empty = {"available": False, "total_vm_cost_usd": 0.0, "vm_count": 0,
             "running_count": 0, "stopped_count": 0, "idle_cost_usd": 0.0,
             "avg_cpu_pct": None, "avg_memory_pct": None,
             "underutilized_count": 0, "underutilized_pct": 0.0,
             "memory_coverage_pct": 0.0, "vms": []}
    if not _DB_AVAILABLE:
        return empty
    sd = _latest_snapshot_date("finops_resource_utilization")
    if not sd:
        return empty
    type_list = ",".join("'" + t + "'" for t in VM_TYPES)
    sql = (
        "SELECT resource_id, resource_name, resource_group, subscription_id, location, sku, "
        "power_state, avg_cpu_pct, avg_memory_pct, utilization_pct, is_idle, cost_month_usd, environment "
        "FROM finops_resource_utilization "
        f"WHERE snapshot_date = ? AND resource_type IN ({type_list})"
        f"{_sub_clause(subscription_ids)}"
    )
    vms: List[Dict[str, Any]] = []
    try:
        with _conn() as con:
            for row in con.execute(sql, (sd,)).fetchall():
                vms.append({
                    "resource_id": row[0], "resource_name": row[1], "resource_group": row[2],
                    "subscription_id": row[3], "location": row[4], "sku": row[5],
                    "power_state": row[6] or "unknown",
                    "avg_cpu_pct": float(row[7]) if row[7] is not None else None,
                    "avg_memory_pct": float(row[8]) if row[8] is not None else None,
                    "utilization_pct": float(row[9]) if row[9] is not None else None,
                    "is_idle": bool(row[10]),
                    "cost_month_usd": round(float(row[11] or 0), 2),
                    "environment": row[12] or ENV_UNKNOWN,
                })
    except Exception as e:
        logger.warning("VM utilisation query failed: %s", e)
        return empty
    if not vms:
        return empty

    running = [v for v in vms if v["power_state"] == "running"]
    stopped = [v for v in vms if v["power_state"] in ("deallocated", "stopped")]
    idle_cost = round(sum(v["cost_month_usd"] for v in vms if v["is_idle"]), 2)
    # Averages are taken over RUNNING VMs only. A deallocated VM emits no live
    # metrics — any CPU value on it is a leftover average from before it was
    # powered off, so folding those into a fleet average reports phantom load
    # (e.g. "11.6% avg CPU" for a fleet where every VM is off).
    cpus = [v["avg_cpu_pct"] for v in running if v["avg_cpu_pct"] is not None]
    mems = [v["avg_memory_pct"] for v in running if v["avg_memory_pct"] is not None]
    under = [v for v in running if v["avg_cpu_pct"] is not None
             and v["avg_cpu_pct"] <= UNDERUTILIZED_CPU_PCT]
    vms.sort(key=lambda v: -v["cost_month_usd"])
    return {
        "available": True,
        "snapshot_date": sd,
        "total_vm_cost_usd": round(sum(v["cost_month_usd"] for v in vms), 2),
        "vm_count": len(vms),
        "running_count": len(running),
        "stopped_count": len(stopped),
        "running_cost_usd": round(sum(v["cost_month_usd"] for v in running), 2),
        "stopped_cost_usd": round(sum(v["cost_month_usd"] for v in stopped), 2),
        "idle_cost_usd": idle_cost,
        "avg_cpu_pct": round(sum(cpus) / len(cpus), 1) if cpus else None,
        "avg_memory_pct": round(sum(mems) / len(mems), 1) if mems else None,
        # Coverage is expressed against the running fleet, which is the only
        # population that can produce a metric.
        "memory_coverage_pct": round(len(mems) / len(running) * 100, 1) if running else 0.0,
        "metrics_basis": "running_vms_only",
        "metrics_sample_count": len(running),
        "metrics_note": (
            f"All {len(vms)} VMs are powered off, so there is no live CPU or memory to "
            "average. Cost shown is what stopped VMs still accrue (disks, public IPs, "
            "reservations)." if running == [] and vms else
            (f"Averages cover the {len(running)} running VM(s); "
             f"{len(stopped)} stopped VM(s) are excluded because they emit no metrics."
             if stopped else "")
        ),
        "underutilized_count": len(under),
        "underutilized_pct": round(len(under) / len(running) * 100, 1) if running else 0.0,
        "underutilized_cost_usd": round(sum(v["cost_month_usd"] for v in under), 2),
        "vms": vms,
    }


# ── Storage growth ────────────────────────────────────────────────────────────

def get_storage_growth(days: int = 60,
                       subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Total capacity trend and derived GB/month growth rate."""
    empty = {"available": False, "series": [], "growth_gb_per_month": 0.0,
             "current_gb": 0.0, "growth_pct": 0.0}
    if not _DB_AVAILABLE:
        return empty
    d_from = str(_today() - timedelta(days=max(2, days) - 1))
    sql = (
        "SELECT snapshot_date, SUM(capacity_gb), SUM(cost_month_usd) "
        "FROM finops_storage_capacity WHERE snapshot_date >= ?"
        f"{_sub_clause(subscription_ids)} GROUP BY snapshot_date ORDER BY snapshot_date"
    )
    series: List[Dict[str, Any]] = []
    try:
        with _conn() as con:
            for row in con.execute(sql, (d_from,)).fetchall():
                series.append({"date": row[0],
                               "capacity_gb": round(float(row[1] or 0), 2),
                               "cost_usd": round(float(row[2] or 0), 2)})
    except Exception as e:
        logger.warning("storage growth query failed: %s", e)
        return empty
    if len(series) < 2:
        # Capacity is a point-in-time reading, so a growth rate cannot be derived
        # from a single snapshot. Say exactly how many exist rather than implying
        # the collector failed — this resolves itself after the next daily run.
        have = len(series)
        note = ("Capacity trend needs at least 2 daily snapshots to compute a growth "
                f"rate — {have} collected so far. The next scheduled scan will produce "
                "the second point.") if have else (
                "No storage capacity snapshots have been collected yet. Run a scan to "
                "record the first capacity reading.")
        return {**empty, "series": series,
                "current_gb": series[-1]["capacity_gb"] if series else 0.0,
                "snapshot_count": have,
                "note": note}
    first, last = series[0], series[-1]
    try:
        span_days = max(1, (datetime.strptime(last["date"], "%Y-%m-%d").date()
                            - datetime.strptime(first["date"], "%Y-%m-%d").date()).days)
    except Exception:
        span_days = max(1, len(series) - 1)
    delta = last["capacity_gb"] - first["capacity_gb"]
    return {
        "available": True,
        "series": series,
        "current_gb": last["capacity_gb"],
        "growth_gb_per_month": round(delta / span_days * 30.0, 2),
        "growth_pct": round(delta / first["capacity_gb"] * 100, 1) if first["capacity_gb"] else 0.0,
        "span_days": span_days,
    }


# ── Environment (Prod vs Non-Prod) ────────────────────────────────────────────

def get_environment_costs(subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Cost split by normalised environment, with a resource-group breakdown."""
    empty = {"available": False, "environments": [], "by_resource_group": [], "total_usd": 0.0}
    if not _DB_AVAILABLE:
        return empty
    sd = _latest_snapshot_date("finops_resource_utilization")
    if not sd:
        return empty
    try:
        with _conn() as con:
            env_rows = con.execute(
                "SELECT environment, SUM(cost_month_usd), COUNT(*) "
                "FROM finops_resource_utilization WHERE snapshot_date = ?"
                f"{_sub_clause(subscription_ids)} GROUP BY environment", (sd,)).fetchall()
            rg_rows = con.execute(
                "SELECT resource_group, environment, SUM(cost_month_usd), COUNT(*) "
                "FROM finops_resource_utilization WHERE snapshot_date = ?"
                f"{_sub_clause(subscription_ids)} "
                "GROUP BY resource_group, environment ORDER BY SUM(cost_month_usd) DESC",
                (sd,)).fetchall()
    except Exception as e:
        logger.warning("environment cost query failed: %s", e)
        return empty
    envs = [{"environment": r[0] or ENV_UNKNOWN,
             "cost_usd": round(float(r[1] or 0), 2),
             "resource_count": int(r[2] or 0)} for r in env_rows]
    total = round(sum(e["cost_usd"] for e in envs), 2)
    for e in envs:
        e["cost_pct"] = round(e["cost_usd"] / total * 100, 1) if total else 0.0
    envs.sort(key=lambda e: -e["cost_usd"])
    rgs = [{"resource_group": r[0] or "(none)", "environment": r[1] or ENV_UNKNOWN,
            "cost_usd": round(float(r[2] or 0), 2), "resource_count": int(r[3] or 0)}
           for r in rg_rows]
    return {"available": bool(envs), "snapshot_date": sd, "environments": envs,
            "by_resource_group": rgs[:100], "total_usd": total}


# ── Resource-group economics ──────────────────────────────────────────────────

def get_resource_group_economics(subscription_ids: Optional[List[str]] = None,
                                 limit: int = 25) -> Dict[str, Any]:
    """Per-RG cost, resource count, cost-per-resource density and environment."""
    empty = {"available": False, "resource_groups": [], "total_usd": 0.0, "rg_count": 0}
    if not _DB_AVAILABLE:
        return empty
    sd = _latest_snapshot_date("finops_resource_utilization")
    if not sd:
        return empty
    sql = (
        "SELECT resource_group, subscription_id, SUM(cost_month_usd), COUNT(*), "
        "SUM(CASE WHEN is_idle = 1 THEN cost_month_usd ELSE 0 END) "
        "FROM finops_resource_utilization WHERE snapshot_date = ?"
        f"{_sub_clause(subscription_ids)} "
        "GROUP BY resource_group, subscription_id ORDER BY SUM(cost_month_usd) DESC"
    )
    rows: List[Dict[str, Any]] = []
    try:
        with _conn() as con:
            for r in con.execute(sql, (sd,)).fetchall():
                cost = round(float(r[2] or 0), 2)
                cnt = int(r[3] or 0)
                rows.append({
                    "resource_group": r[0] or "(none)",
                    "subscription_id": r[1] or "",
                    "cost_usd": cost,
                    "resource_count": cnt,
                    "cost_per_resource_usd": round(cost / cnt, 2) if cnt else 0.0,
                    "idle_cost_usd": round(float(r[4] or 0), 2),
                    "environment": classify_environment(None, r[0]),
                })
    except Exception as e:
        logger.warning("resource group economics query failed: %s", e)
        return empty
    total = round(sum(r["cost_usd"] for r in rows), 2)
    for r in rows:
        r["cost_pct"] = round(r["cost_usd"] / total * 100, 1) if total else 0.0
    return {"available": bool(rows), "snapshot_date": sd,
            "resource_groups": rows[:limit], "all_count": len(rows),
            "rg_count": len(rows), "total_usd": total}


# ── Management-group cost rollup ──────────────────────────────────────────────

def store_mgmt_group_costs(nodes: List[Dict[str, Any]], billing_month: str,
                           run_id: str = "") -> int:
    """Persist an MG cost rollup. `nodes` carry id/name/parent/depth/direct/rollup."""
    if not _DB_AVAILABLE or not nodes:
        return 0
    cols = ["id", "billing_month", "mg_id", "mg_name", "parent_mg_id", "depth",
            "direct_cost_usd", "rollup_cost_usd", "subscription_count", "currency", "etl_run_id"]
    sql = upsert_conflict_sql("finops_mgmt_group_costs", cols, ["id"],
                              [c for c in cols if c != "id"])
    written = 0
    try:
        with _conn() as con:
            for n in nodes:
                key = hashlib.sha256(
                    f"{billing_month}|{n.get('mg_id','')}".encode("utf-8")).hexdigest()
                con.execute(sql, (
                    key, billing_month, n.get("mg_id", ""), n.get("mg_name", ""),
                    n.get("parent_mg_id", ""), int(n.get("depth", 0) or 0),
                    float(n.get("direct_cost_usd", 0) or 0),
                    float(n.get("rollup_cost_usd", 0) or 0),
                    int(n.get("subscription_count", 0) or 0),
                    "USD", run_id,
                ))
                written += 1
    except Exception as e:
        logger.error("mgmt group cost upsert failed: %s", e)
    return written


def build_mgmt_group_rollup(mgmt_groups: List[Dict[str, Any]],
                            sub_costs: Dict[str, float]) -> List[Dict[str, Any]]:
    """Aggregate subscription cost up an MG tree.

    `mgmt_groups` items: {id, name, level/depth, parent_id, subscription_ids}
    where subscription_ids already includes every descendant subscription.
    `sub_costs` maps subscription_id -> cost. Direct cost counts only the
    subscriptions not already claimed by a deeper (child) MG."""
    nodes: List[Dict[str, Any]] = []
    by_depth = sorted(mgmt_groups, key=lambda g: -int(g.get("level", g.get("depth", 0)) or 0))
    claimed: Dict[str, str] = {}
    for g in by_depth:
        for sid in (g.get("subscription_ids") or []):
            claimed.setdefault(sid, g.get("id", ""))
    for g in mgmt_groups:
        gid = g.get("id", "")
        subs = [s for s in (g.get("subscription_ids") or [])]
        rollup = sum(float(sub_costs.get(s, 0) or 0) for s in subs)
        direct = sum(float(sub_costs.get(s, 0) or 0) for s in subs if claimed.get(s) == gid)
        nodes.append({
            "mg_id": gid,
            "mg_name": g.get("name", "") or gid,
            "parent_mg_id": g.get("parent_id", "") or "",
            "depth": int(g.get("level", g.get("depth", 0)) or 0),
            "direct_cost_usd": round(direct, 2),
            "rollup_cost_usd": round(rollup, 2),
            "subscription_count": len(subs),
        })
    nodes.sort(key=lambda n: -n["rollup_cost_usd"])
    return nodes


def get_mgmt_group_costs(billing_month: Optional[str] = None) -> Dict[str, Any]:
    empty = {"available": False, "management_groups": [], "billing_month": billing_month or ""}
    if not _DB_AVAILABLE:
        return empty
    try:
        with _conn() as con:
            if not billing_month:
                row = con.execute("SELECT MAX(billing_month) FROM finops_mgmt_group_costs").fetchone()
                billing_month = row[0] if row and row[0] else None
            if not billing_month:
                return empty
            rows = con.execute(
                "SELECT mg_id, mg_name, parent_mg_id, depth, direct_cost_usd, rollup_cost_usd, "
                "subscription_count FROM finops_mgmt_group_costs WHERE billing_month = ? "
                "ORDER BY rollup_cost_usd DESC", (billing_month,)).fetchall()
    except Exception as e:
        logger.warning("mgmt group cost query failed: %s", e)
        return empty
    items = [{"mg_id": r[0], "mg_name": r[1], "parent_mg_id": r[2], "depth": int(r[3] or 0),
              "direct_cost_usd": round(float(r[4] or 0), 2),
              "rollup_cost_usd": round(float(r[5] or 0), 2),
              "subscription_count": int(r[6] or 0)} for r in rows]
    total = round(sum(i["direct_cost_usd"] for i in items), 2)
    for i in items:
        i["cost_pct"] = round(i["rollup_cost_usd"] / total * 100, 1) if total else 0.0
    return {"available": bool(items), "billing_month": billing_month,
            "management_groups": items, "total_usd": total}


def find_orphan_subscriptions(all_subscriptions: List[Dict[str, Any]],
                              mg_subscription_ids: List[str],
                              sub_costs: Dict[str, float],
                              hierarchy_known: Optional[bool] = None,
                              mg_placement: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Subscriptions needing governance attention:
       unassigned (no management group), zero-spend, and disabled-but-billing.

    `hierarchy_known` guards the unassigned check: when the management-group tree
    could not be read, every subscription would otherwise look unassigned. In that
    case the unassigned finding is suppressed rather than reported as fact."""
    if hierarchy_known is None:
        hierarchy_known = bool(mg_subscription_ids)
    assigned = {s for s in (mg_subscription_ids or []) if s}
    placement = {k: v for k, v in (mg_placement or {}).items() if k}
    unassigned, zero_spend, disabled_with_cost = [], [], []
    for s in (all_subscriptions or []):
        sid = str(s.get("subscription_id") or s.get("id") or "")
        if not sid:
            continue
        name = (s.get("subscription_name") or s.get("display_name")
                or s.get("name") or sid)
        state = str(s.get("state") or "").lower()
        cost = float(sub_costs.get(sid, 0) or 0)
        entry = {"subscription_id": sid, "name": name, "state": s.get("state") or "Enabled",
                 "cost_usd": round(cost, 2),
                 "management_group": placement.get(sid, "")}
        # Every Azure subscription belongs to SOME management group — one that was
        # never placed sits directly under the tenant root. Reporting that as
        # "unassigned" is factually wrong; the real governance gap is that it is
        # not in a landing-zone MG where policy and RBAC are applied.
        if hierarchy_known and sid not in assigned:
            unassigned.append({**entry, "management_group": placement.get(sid, "Tenant Root Group")})
        if cost <= 0.01:
            zero_spend.append(entry)
        if state and state != "enabled" and cost > 0.01:
            disabled_with_cost.append(entry)
    return {
        "available": True,
        "hierarchy_known": hierarchy_known,
        "unassigned_count": len(unassigned) if hierarchy_known else None,
        "unassigned": unassigned,
        "zero_spend_count": len(zero_spend),
        "zero_spend": zero_spend,
        "disabled_with_cost_count": len(disabled_with_cost),
        "disabled_with_cost": disabled_with_cost,
        "total_subscriptions": len(all_subscriptions or []),
    }


# ── Service categories (customer-facing taxonomy) ─────────────────────────────
# The customer names five categories explicitly. FOCUS categories are too coarse
# (they collapse VMs into "Compute" and split Log Analytics from Sentinel), so
# the dashboard uses this taxonomy.

# Hints are matched against "ServiceName MeterCategory ResourceType". Order matters:
# the first category whose hint appears wins, so specific hints precede broad ones.
SERVICE_CATEGORIES: List[Tuple[str, Tuple[str, ...]]] = [
    ("Log Analytics / Sentinel", ("log analytics", "sentinel", "azure monitor", "application insights",
                                  "insight and analytics", "operational insights")),
    ("Security", ("defender", "security center", "key vault", "microsoft security")),
    ("Virtual Machines", ("virtual machine", "virtual machines", "scale set", "vm image",
                          "azure compute", "reserved vm")),
    ("Azure SQL / Cosmos DB", ("sql", "cosmos", "database", "mysql", "postgres", "mariadb",
                               "redis cache", "azure cache")),
    ("Storage Accounts", ("storage", "blob", "azure files", "backup", "data lake", "managed disk",
                          "netapp", "hpc cache", "storsimple")),
    ("Firewall / Load Balancer", ("firewall", "load balancer", "application gateway", "front door",
                                  "traffic manager", "vpn", "expressroute", "bandwidth",
                                  "virtual network", "nat gateway", "bastion", "dns",
                                  "private link", "network watcher", "content delivery")),
    ("AI / Machine Learning", ("cognitive", "openai", "machine learning", "foundry",
                               "ai services", "azure ai", "bot service", "search service",
                               "cognitive search")),
    ("Containers / Kubernetes", ("kubernetes", "container", "aks", "registry")),
    ("App / Web Services", ("app service", "web app", "function", "logic app", "api management",
                            "event grid", "event hub", "service bus", "signalr", "notification hub",
                            "app configuration")),
    ("Management & Governance", ("azure arc", "update manager", "automation", "policy",
                                 "cost management", "advisor", "site recovery", "migrate")),
]


def categorize_service(service_name: str, meter_category: str = "",
                       resource_type: str = "") -> str:
    blob = f"{service_name} {meter_category} {resource_type}".lower()
    for label, hints in SERVICE_CATEGORIES:
        if any(h in blob for h in hints):
            return label
    return "Other"


def get_service_category_costs(days: int = 30,
                               subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """% spend by the customer-facing service category taxonomy."""
    empty = {"available": False, "categories": [], "total_usd": 0.0}
    if not _DB_AVAILABLE:
        return empty
    d_from = str(_today() - timedelta(days=max(1, days) - 1))
    rows: List[Tuple[str, str, float]] = []
    try:
        with _conn() as con:
            for r in con.execute(
                    "SELECT service_name, meter_category, SUM(cost_usd) "
                    "FROM finops_daily_meter_costs WHERE snapshot_date >= ?"
                    f"{_sub_clause(subscription_ids)} GROUP BY service_name, meter_category",
                    (d_from,)).fetchall():
                rows.append((r[0] or "", r[1] or "", float(r[2] or 0)))
    except Exception as e:
        logger.warning("service category query failed: %s", e)
        return empty
    if not rows:
        return empty
    agg: Dict[str, float] = {}
    for svc, cat, cost in rows:
        agg[categorize_service(svc, cat)] = agg.get(categorize_service(svc, cat), 0.0) + cost
    total = round(sum(agg.values()), 2)
    cats = [{"category": k, "cost_usd": round(v, 2),
             "cost_pct": round(v / total * 100, 1) if total else 0.0}
            for k, v in sorted(agg.items(), key=lambda x: -x[1])]
    return {"available": True, "categories": cats, "total_usd": total,
            "period_days": days, "date_from": d_from}
