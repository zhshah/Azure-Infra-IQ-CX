"""
FinOps Meter Service — meter-grain cost + usage quantity.

The ServiceName / MeterCategory grain cannot answer four of the management
dashboard's questions, because the distinguishing detail lives in the Azure
meter NAME:

    * Storage cost split by access tier   — "Hot LRS Data Stored" vs "Cool …" vs "Archive …"
    * Data egress cost                    — "Data Transfer Out", "… Egress"
    * Inter-region transfer cost          — "Inter-Region Egress …"
    * Cost per GB ingested                — "Data Ingestion" + UsageQuantity in GB

This service collects the meter grain (cost AND usage quantity) into
`finops_daily_meter_costs`, tags each row with a stable `classification`, and
exposes read helpers the dashboard endpoints use.

Collection is additive: it does not alter any existing warehouse table or query.
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
    logger.warning("FinOps Meter: database unavailable: %s", e)

try:
    from services.finops_data_service import (
        query_cost,
        normalise_cost_rows,
        get_subscription_ids,
    )
    _DATA_AVAILABLE = True
except Exception as e:  # pragma: no cover
    _DATA_AVAILABLE = False
    logger.warning("FinOps Meter: finops_data_service unavailable: %s", e)


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, "") or default))
    except (TypeError, ValueError):
        return default


# Meter grain is the only source of usage QUANTITY (storage tiers, egress GB, $/GB
# ingested), so a short window silently disables those panels. One range query per
# subscription regardless of width.
METER_HISTORY_DAYS = _env_int("FINOPS_METER_HISTORY_DAYS", 395)
METER_HISTORY_DAYS_INITIAL = 14

# Cost Management grouping used for the meter grain. ServiceName is included so a
# meter can be attributed to the service that emitted it.
_METER_GROUP_BY = ["ServiceName", "MeterCategory", "MeterSubCategory", "MeterName"]


# ── Classification ────────────────────────────────────────────────────────────
# Buckets the management dashboard reports on. Order matters: the first rule that
# matches wins, so the more specific rules are listed first.

CLASS_STORAGE_HOT = "storage_tier_hot"
CLASS_STORAGE_COOL = "storage_tier_cool"
CLASS_STORAGE_COLD = "storage_tier_cold"
CLASS_STORAGE_ARCHIVE = "storage_tier_archive"
CLASS_STORAGE_DISK = "storage_disk"
CLASS_STORAGE_SNAPSHOT = "storage_snapshot"
CLASS_STORAGE_OTHER = "storage_other"
CLASS_INTER_REGION = "network_inter_region"
CLASS_EGRESS = "network_egress"
CLASS_NETWORK_OTHER = "network_other"
CLASS_LOG_INGESTION = "monitor_ingestion"
CLASS_LOG_RETENTION = "monitor_retention"
CLASS_SECURITY = "security"
CLASS_OTHER = "other"

STORAGE_TIER_CLASSES = (
    CLASS_STORAGE_HOT, CLASS_STORAGE_COOL, CLASS_STORAGE_COLD, CLASS_STORAGE_ARCHIVE,
)
STORAGE_CLASSES = STORAGE_TIER_CLASSES + (
    CLASS_STORAGE_DISK, CLASS_STORAGE_SNAPSHOT, CLASS_STORAGE_OTHER,
)
NETWORK_CLASSES = (CLASS_INTER_REGION, CLASS_EGRESS, CLASS_NETWORK_OTHER)

_TIER_LABEL = {
    CLASS_STORAGE_HOT: "Hot",
    CLASS_STORAGE_COOL: "Cool",
    CLASS_STORAGE_COLD: "Cold",
    CLASS_STORAGE_ARCHIVE: "Archive",
    CLASS_STORAGE_DISK: "Managed disks (untiered)",
    CLASS_STORAGE_SNAPSHOT: "Snapshots",
    CLASS_STORAGE_OTHER: "Other storage",
}

_SECURITY_HINTS = ("defender", "sentinel", "security center", "microsoft defender")

# Access tiers must match as WHOLE WORDS. Substring matching silently
# misclassified "LRS Snapshots" as Hot, because "snaps-hot-s" contains "hot".
_TIER_PATTERNS = (
    (CLASS_STORAGE_ARCHIVE, re.compile(r"\barchive\b", re.I)),
    (CLASS_STORAGE_COOL,    re.compile(r"\bcool\b", re.I)),
    (CLASS_STORAGE_COLD,    re.compile(r"\bcold\b", re.I)),
    (CLASS_STORAGE_HOT,     re.compile(r"\bhot\b", re.I)),
)
_SNAPSHOT_RE = re.compile(r"\bsnapshots?\b", re.I)
_DISK_RE = re.compile(r"\bdisks?\b|\bprovisioned\s+(storage|iops|throughput)\b", re.I)


def classify_meter(service_name: str, meter_category: str,
                   meter_subcategory: str, meter_name: str) -> str:
    """Map an Azure meter to a management-dashboard bucket."""
    svc = (service_name or "").lower()
    cat = (meter_category or "").lower()
    sub = (meter_subcategory or "").lower()
    name = (meter_name or "").lower()
    blob = f"{cat} {sub} {name}"

    # Inter-region must be tested before the generic egress rule — an inter-region
    # meter is also an egress meter, and the specific bucket is the useful one.
    if "inter-region" in blob or "inter region" in blob or "intra-region" in blob \
            or "intra region" in blob or "inter continent" in blob or "intra continent" in blob:
        return CLASS_INTER_REGION

    if cat == "bandwidth" or "data transfer" in blob or "egress" in blob:
        if "inbound" in blob or "ingress" in blob or re.search(r"\b(in|inbound)\b", name):
            return CLASS_NETWORK_OTHER
        return CLASS_EGRESS

    if cat == "storage" or "storage" in svc:
        # Snapshots and managed disks carry no access tier; classify them first so a
        # tier keyword inside another word cannot claim them.
        if _SNAPSHOT_RE.search(blob):
            return CLASS_STORAGE_SNAPSHOT
        for cls, pat in _TIER_PATTERNS:
            if pat.search(blob):
                return cls
        if _DISK_RE.search(blob):
            return CLASS_STORAGE_DISK
        return CLASS_STORAGE_OTHER

    if any(h in blob or h in svc for h in _SECURITY_HINTS):
        return CLASS_SECURITY

    if "log analytics" in blob or "azure monitor" in blob or "sentinel" in blob \
            or "log analytics" in svc or "insight and analytics" in svc:
        if "retention" in blob:
            return CLASS_LOG_RETENTION
        return CLASS_LOG_INGESTION

    if "virtual network" in blob or "load balancer" in blob or "gateway" in blob \
            or "firewall" in blob or "bastion" in blob or "dns" in blob:
        return CLASS_NETWORK_OTHER

    return CLASS_OTHER


def tier_label(classification: str) -> str:
    return _TIER_LABEL.get(classification, classification)


# ── DB helper ─────────────────────────────────────────────────────────────────

@contextmanager
def _conn():
    with get_connection() as con:
        yield con


def _norm_date(v: Any) -> str:
    s = str(v or "").strip()
    if not s:
        return ""
    digits = s.replace("-", "")
    if len(digits) >= 8 and digits[:8].isdigit():
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"
    return s[:10]


def _upsert_batch(sql: str, batch: List[tuple]) -> int:
    """Write a batch in one round-trip.

    A 90-day meter pull is tens of thousands of rows; one INSERT per row against
    Azure SQL takes minutes. executemany (with fast_executemany on pyodbc) turns
    that into a handful of round-trips."""
    if not batch:
        return 0
    try:
        with _conn() as con:
            cur = con.cursor()
            try:
                cur.fast_executemany = True   # pyodbc only
            except AttributeError:
                pass
            cur.executemany(sql, batch)
        return len(batch)
    except Exception as e:
        logger.warning("meter batch upsert failed (%s) — retrying row by row", e)
        written = 0
        try:
            with _conn() as con:
                for params in batch:
                    try:
                        con.execute(sql, params)
                        written += 1
                    except Exception:
                        pass
        except Exception as inner:
            logger.error("meter row-by-row fallback failed: %s", inner)
        return written


# ── Collection ────────────────────────────────────────────────────────────────

def collect_meter_costs(sub_id: str, today: date, run_id: str,
                        days: int = METER_HISTORY_DAYS) -> int:
    """Collect daily cost + usage quantity at the meter grain for one subscription."""
    if not (_DB_AVAILABLE and _DATA_AVAILABLE):
        return 0

    from_date = today - timedelta(days=days - 1)
    scope = f"/subscriptions/{sub_id}"
    try:
        rows = query_cost(scope=scope, from_date=from_date, to_date=today,
                          granularity="Daily", group_by=_METER_GROUP_BY,
                          use_cache=False, include_quantity=True)
    except Exception as e:
        logger.warning("Meter ETL: query failed for %s: %s", sub_id[:8], e)
        return 0
    if not rows:
        return 0

    norm = normalise_cost_rows(rows, _METER_GROUP_BY, subscription_id=sub_id)
    cols = ["id", "snapshot_date", "subscription_id", "service_name", "meter_category",
            "meter_subcategory", "meter_name", "classification", "cost_usd",
            "quantity", "unit", "currency", "etl_run_id"]
    sql = upsert_conflict_sql("finops_daily_meter_costs", cols, ["id"],
                              [c for c in cols if c != "id"])

    total = 0
    batch: List[tuple] = []
    for r in norm:
        sd = _norm_date(r.get("date", ""))
        if not sd:
            continue
        d = r.get("dimensions", {}) or {}
        svc = str(d.get("ServiceName", "") or "")
        cat = str(d.get("MeterCategory", "") or "")
        sub = str(d.get("MeterSubCategory", "") or "")
        mtr = str(d.get("MeterName", "") or "")
        if not (cat or mtr):
            continue
        cls = classify_meter(svc, cat, sub, mtr)
        rid = hashlib.sha256(
            f"{sd}|{sub_id}|{cat}|{sub}|{mtr}".encode("utf-8")).hexdigest()
        batch.append((rid, sd, sub_id, svc, cat, sub, mtr, cls,
                      float(r.get("cost_usd", 0) or 0),
                      float(r.get("quantity", 0) or 0),
                      "", "USD", run_id))
        if len(batch) >= 500:
            total += _upsert_batch(sql, batch)
            batch = []
    total += _upsert_batch(sql, batch)
    return total


def collect_all(subscription_ids: Optional[List[str]] = None,
                run_id: str = "", days: int = METER_HISTORY_DAYS) -> int:
    """Collect the meter grain across subscriptions (serial, rate-limit friendly)."""
    if not (_DB_AVAILABLE and _DATA_AVAILABLE):
        return 0
    subs = subscription_ids or get_subscription_ids()
    today = datetime.now(timezone.utc).date()
    total = 0
    for i, sub_id in enumerate(subs):
        try:
            total += collect_meter_costs(sub_id, today, run_id, days=days)
        except Exception as e:
            logger.warning("Meter ETL: subscription %s failed: %s", sub_id[:8], e)
        if i < len(subs) - 1:
            time.sleep(1.5)
    return total


def purge_old(today: Optional[date] = None, keep_days: int = METER_HISTORY_DAYS) -> None:
    if not _DB_AVAILABLE:
        return
    today = today or datetime.now(timezone.utc).date()
    cutoff = str(today - timedelta(days=keep_days))
    try:
        with _conn() as con:
            con.execute("DELETE FROM finops_daily_meter_costs WHERE snapshot_date < ?", (cutoff,))
    except Exception as e:
        logger.warning("Meter ETL: purge failed: %s", e)


def has_data() -> bool:
    if not _DB_AVAILABLE:
        return False
    try:
        with _conn() as con:
            cur = con.execute("SELECT COUNT(*) FROM finops_daily_meter_costs")
            row = cur.fetchone()
            return bool(row and row[0])
    except Exception:
        return False


# ── Read helpers ──────────────────────────────────────────────────────────────

def _window(days: int) -> Tuple[str, str]:
    today = datetime.now(timezone.utc).date()
    return str(today - timedelta(days=max(1, days) - 1)), str(today)


def _sub_clause(subscription_ids: Optional[List[str]]) -> str:
    subs = [s for s in (subscription_ids or []) if s]
    if not subs:
        return ""
    quoted = ",".join("'" + s.replace("'", "''") + "'" for s in subs)
    return f" AND subscription_id IN ({quoted})"


def get_storage_tier_costs(days: int = 30,
                           subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Storage cost split by access tier, plus untiered disk and snapshot spend.

    Managed disks and snapshots have no access tier, so they are reported as their
    own lines rather than being folded into a tier."""
    if not _DB_AVAILABLE:
        return {"available": False, "tiers": [], "total_usd": 0.0}
    d_from, d_to = _window(days)
    in_list = ",".join("'" + c + "'" for c in STORAGE_CLASSES)
    sql = (
        "SELECT classification, SUM(cost_usd), SUM(quantity) "
        "FROM finops_daily_meter_costs "
        f"WHERE snapshot_date >= ? AND snapshot_date <= ? AND classification IN ({in_list})"
        f"{_sub_clause(subscription_ids)} GROUP BY classification"
    )
    tiers: List[Dict[str, Any]] = []
    try:
        with _conn() as con:
            for row in con.execute(sql, (d_from, d_to)).fetchall():
                tiers.append({
                    "classification": row[0],
                    "tier": tier_label(row[0]),
                    "is_access_tier": row[0] in STORAGE_TIER_CLASSES,
                    "cost_usd": round(float(row[1] or 0), 2),
                    "quantity": round(float(row[2] or 0), 2),
                })
    except Exception as e:
        logger.warning("storage tier query failed: %s", e)
        return {"available": False, "tiers": [], "total_usd": 0.0}
    total = round(sum(t["cost_usd"] for t in tiers), 2)
    tiered_total = round(sum(t["cost_usd"] for t in tiers if t["is_access_tier"]), 2)
    for t in tiers:
        t["cost_pct"] = round(t["cost_usd"] / total * 100, 1) if total else 0.0
    tiers.sort(key=lambda t: -t["cost_usd"])
    return {"available": bool(tiers), "tiers": tiers, "total_usd": total,
            "tiered_total_usd": tiered_total,
            "snapshot_usd": next((t["cost_usd"] for t in tiers
                                  if t["classification"] == CLASS_STORAGE_SNAPSHOT), 0.0),
            "disk_usd": next((t["cost_usd"] for t in tiers
                              if t["classification"] == CLASS_STORAGE_DISK), 0.0),
            "period_days": days, "date_from": d_from, "date_to": d_to}


def get_network_costs(days: int = 30,
                      subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Network spend split into egress / inter-region / other, plus top meters."""
    if not _DB_AVAILABLE:
        return {"available": False}
    d_from, d_to = _window(days)
    in_list = ",".join("'" + c + "'" for c in NETWORK_CLASSES)
    base = (
        "FROM finops_daily_meter_costs "
        f"WHERE snapshot_date >= ? AND snapshot_date <= ? AND classification IN ({in_list})"
        f"{_sub_clause(subscription_ids)}"
    )
    buckets: Dict[str, Dict[str, float]] = {}
    top: List[Dict[str, Any]] = []
    try:
        with _conn() as con:
            for row in con.execute(
                    f"SELECT classification, SUM(cost_usd), SUM(quantity) {base} GROUP BY classification",
                    (d_from, d_to)).fetchall():
                buckets[row[0]] = {"cost_usd": round(float(row[1] or 0), 2),
                                   "quantity_gb": round(float(row[2] or 0), 2)}
            for row in con.execute(
                    f"SELECT meter_name, classification, SUM(cost_usd), SUM(quantity) {base} "
                    "GROUP BY meter_name, classification ORDER BY SUM(cost_usd) DESC",
                    (d_from, d_to)).fetchmany(15):
                top.append({"meter_name": row[0], "classification": row[1],
                            "cost_usd": round(float(row[2] or 0), 2),
                            "quantity_gb": round(float(row[3] or 0), 2)})
    except Exception as e:
        logger.warning("network cost query failed: %s", e)
        return {"available": False}
    egress = buckets.get(CLASS_EGRESS, {}).get("cost_usd", 0.0)
    inter = buckets.get(CLASS_INTER_REGION, {}).get("cost_usd", 0.0)
    other = buckets.get(CLASS_NETWORK_OTHER, {}).get("cost_usd", 0.0)
    return {
        "available": bool(buckets),
        "total_usd": round(egress + inter + other, 2),
        "egress_usd": egress,
        "egress_gb": buckets.get(CLASS_EGRESS, {}).get("quantity_gb", 0.0),
        "inter_region_usd": inter,
        "inter_region_gb": buckets.get(CLASS_INTER_REGION, {}).get("quantity_gb", 0.0),
        "other_network_usd": other,
        "top_meters": top,
        "period_days": days, "date_from": d_from, "date_to": d_to,
    }


def get_ingestion_costs(days: int = 30,
                        subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Log Analytics / Sentinel ingestion cost, GB ingested and derived $/GB."""
    if not _DB_AVAILABLE:
        return {"available": False}
    d_from, d_to = _window(days)
    sql = (
        "SELECT classification, SUM(cost_usd), SUM(quantity) "
        "FROM finops_daily_meter_costs "
        "WHERE snapshot_date >= ? AND snapshot_date <= ? "
        f"AND classification IN ('{CLASS_LOG_INGESTION}','{CLASS_LOG_RETENTION}')"
        f"{_sub_clause(subscription_ids)} GROUP BY classification"
    )
    ing_cost = ing_gb = ret_cost = 0.0
    try:
        with _conn() as con:
            for row in con.execute(sql, (d_from, d_to)).fetchall():
                if row[0] == CLASS_LOG_INGESTION:
                    ing_cost = round(float(row[1] or 0), 2)
                    ing_gb = round(float(row[2] or 0), 2)
                else:
                    ret_cost = round(float(row[1] or 0), 2)
    except Exception as e:
        logger.warning("ingestion cost query failed: %s", e)
        return {"available": False}
    return {
        "available": ing_cost > 0 or ing_gb > 0,
        "ingestion_cost_usd": ing_cost,
        "ingested_gb": ing_gb,
        "cost_per_gb_usd": round(ing_cost / ing_gb, 4) if ing_gb else 0.0,
        "retention_cost_usd": ret_cost,
        "total_usd": round(ing_cost + ret_cost, 2),
        "period_days": days, "date_from": d_from, "date_to": d_to,
    }


def get_security_costs(days: int = 30,
                       subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Defender / Sentinel / security-service spend, broken down by service."""
    if not _DB_AVAILABLE:
        return {"available": False, "by_service": [], "total_usd": 0.0}
    d_from, d_to = _window(days)
    sql = (
        "SELECT service_name, meter_category, SUM(cost_usd) "
        "FROM finops_daily_meter_costs "
        "WHERE snapshot_date >= ? AND snapshot_date <= ? "
        f"AND classification = '{CLASS_SECURITY}'{_sub_clause(subscription_ids)} "
        "GROUP BY service_name, meter_category ORDER BY SUM(cost_usd) DESC"
    )
    items: List[Dict[str, Any]] = []
    try:
        with _conn() as con:
            for row in con.execute(sql, (d_from, d_to)).fetchall():
                items.append({"service": row[0] or row[1] or "(unknown)",
                              "meter_category": row[1] or "",
                              "cost_usd": round(float(row[2] or 0), 2)})
    except Exception as e:
        logger.warning("security cost query failed: %s", e)
        return {"available": False, "by_service": [], "total_usd": 0.0}
    total = round(sum(i["cost_usd"] for i in items), 2)
    for i in items:
        i["cost_pct"] = round(i["cost_usd"] / total * 100, 1) if total else 0.0
    return {"available": bool(items), "by_service": items, "total_usd": total,
            "period_days": days, "date_from": d_from, "date_to": d_to}
