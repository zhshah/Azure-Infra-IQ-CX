"""
FinOps Savings Service — recommendation lifecycle, realized savings and ROI.

Identified savings were already computed on every request and thrown away, so
"what did we actually save?" could never be answered. This service gives a
recommendation a stable identity (`fingerprint`), persists its lifecycle
(open -> accepted -> implemented / dismissed), snapshots the resource's cost at
the moment it is accepted (the baseline), and then measures the resource's
actual cost afterwards.

    realized_usd = max(0, baseline_monthly_cost - actual_monthly_cost)

ROI is then the return on the effort spent implementing:

    implementation_cost = effort_hours * hourly_rate
    roi_pct = (realized_annualized - implementation_cost) / implementation_cost * 100

Everything is additive: no existing savings endpoint changes behaviour.
"""
from __future__ import annotations

import hashlib
import logging
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

try:
    from services.database import get_connection, upsert_conflict_sql
    _DB_AVAILABLE = True
except Exception as e:  # pragma: no cover
    _DB_AVAILABLE = False
    logger.warning("FinOps Savings: database unavailable: %s", e)


STATUS_OPEN = "open"
STATUS_ACCEPTED = "accepted"
STATUS_IMPLEMENTED = "implemented"
STATUS_DISMISSED = "dismissed"
VALID_STATUSES = (STATUS_OPEN, STATUS_ACCEPTED, STATUS_IMPLEMENTED, STATUS_DISMISSED)

# Effort -> engineering hours, used to price implementation for ROI.
EFFORT_HOURS = {"low": 2.0, "medium": 8.0, "high": 24.0}
DEFAULT_HOURLY_RATE_USD = 120.0


@contextmanager
def _conn():
    with get_connection() as con:
        yield con


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> date:
    return datetime.now(timezone.utc).date()


def make_fingerprint(category: str, resource_id: str, action: str = "") -> str:
    """Stable identity for a recommendation across scans."""
    raw = f"{(category or '').lower()}|{(resource_id or '').lower()}|{(action or '').lower()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ── Persistence ───────────────────────────────────────────────────────────────

def persist_recommendations(recommendations: List[Dict[str, Any]]) -> int:
    """Upsert recommendations, preserving any status already set by a human.

    A re-detected recommendation refreshes its economics and `last_seen` but must
    never be reset to 'open' — that would erase the accept/implement decision."""
    if not _DB_AVAILABLE or not recommendations:
        return 0
    now = _now()
    written = 0
    try:
        with _conn() as con:
            existing: Dict[str, str] = {}
            for row in con.execute(
                    "SELECT fingerprint, status FROM finops_recommendations").fetchall():
                existing[row[0]] = row[1]

            for rec in recommendations:
                rid = str(rec.get("resource_id", "") or "")
                category = str(rec.get("category", "") or "")
                action = str(rec.get("action", "") or "")
                fp = rec.get("fingerprint") or make_fingerprint(category, rid, action)
                effort = str(rec.get("effort", "medium") or "medium").lower()
                hours = float(rec.get("effort_hours") or EFFORT_HOURS.get(effort, 8.0))
                savings = float(rec.get("monthly_savings_usd", 0) or 0)

                if fp in existing:
                    con.execute(
                        "UPDATE finops_recommendations SET last_seen=?, monthly_savings_usd=?, "
                        "detail=?, current_sku=?, target_sku=?, confidence=?, effort=?, "
                        "effort_hours=?, source=? WHERE fingerprint=?",
                        (now, savings, str(rec.get("detail", "") or ""),
                         str(rec.get("current_sku", "") or ""), str(rec.get("target_sku", "") or ""),
                         str(rec.get("confidence", "medium") or "medium"), effort, hours,
                         str(rec.get("source", "") or ""), fp))
                else:
                    con.execute(
                        "INSERT INTO finops_recommendations "
                        "(fingerprint, first_seen, last_seen, subscription_id, resource_id, "
                        " resource_name, resource_group, resource_type, category, action, title, "
                        " detail, current_sku, target_sku, monthly_savings_usd, confidence, effort, "
                        " effort_hours, source, status, status_changed_at, status_changed_by, note, "
                        " baseline_cost_usd, baseline_from, baseline_to, implemented_at) "
                        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (fp, now, now,
                         str(rec.get("subscription_id", "") or ""), rid,
                         str(rec.get("resource_name", "") or ""),
                         str(rec.get("resource_group", "") or ""),
                         str(rec.get("resource_type", "") or ""),
                         category, action,
                         str(rec.get("title", "") or ""),
                         str(rec.get("detail", "") or ""),
                         str(rec.get("current_sku", "") or ""),
                         str(rec.get("target_sku", "") or ""),
                         savings,
                         str(rec.get("confidence", "medium") or "medium"),
                         effort, hours,
                         str(rec.get("source", "") or ""),
                         STATUS_OPEN, now, "", "", 0.0, "", "", ""))
                written += 1
    except Exception as e:
        logger.error("recommendation persist failed: %s", e)
    return written


def generate_warehouse_recommendations() -> Dict[str, Any]:
    """Derive recommendations from persisted warehouse facts, not from a model.

    The AI/scan path only produced a handful of items, which left obvious,
    measurable waste — deallocated VMs that still bill for retained disks and
    static IPs — completely absent from the optimizer. Every rule here is
    grounded in two stored facts: the VM's real `power_state` (read from the
    Azure instance view) and its real cost (from Cost Management's per-resource
    grain). Nothing is estimated or inferred.

    Resources that already carry a recommendation are skipped so the same money
    is never counted twice. A recommendation the user DISMISSED is re-detected but
    never revived: `persist_recommendations` updates it in place and preserves the
    dismissed status, so it stays out of the open list permanently."""
    out = {"generated": 0, "skipped_existing": 0, "refreshed_dismissed": 0,
           "candidates": 0, "monthly_usd": 0.0}
    if not _DB_AVAILABLE:
        return out
    recs: List[Dict[str, Any]] = []
    dismissed_ids: set = set()
    try:
        with _conn() as con:
            row = con.execute(
                "SELECT MAX(snapshot_date) FROM finops_resource_utilization").fetchone()
            sd = row[0] if row and row[0] else None
            if not sd:
                return out

            claimed = set()
            for r in con.execute(
                    "SELECT resource_id, status FROM finops_recommendations").fetchall():
                if not r[0]:
                    continue
                rid_l = str(r[0]).lower()
                if r[1] == STATUS_DISMISSED:
                    dismissed_ids.add(rid_l)
                else:
                    claimed.add(rid_l)

            rows = con.execute(
                "SELECT resource_id, resource_name, resource_group, subscription_id, "
                "resource_type, sku, power_state, cost_month_usd, days_idle, is_orphan "
                "FROM finops_resource_utilization "
                "WHERE snapshot_date = ? AND cost_month_usd > 0", (sd,)).fetchall()

            for r in rows:
                rid, name, rg, sub, rtype, sku = (r[0], r[1], r[2], r[3], r[4], r[5])
                power = str(r[6] or "").lower()
                cost = round(float(r[7] or 0), 2)
                idle_days = int(r[8] or 0)
                is_orphan = bool(r[9])
                if cost < 0.50:
                    continue
                out["candidates"] += 1
                if str(rid).lower() in claimed:
                    out["skipped_existing"] += 1
                    continue

                if power in ("deallocated", "stopped"):
                    # A stopped VM bills nothing for compute, so this residual cost
                    # is the disks / static IPs it still holds. Deleting or
                    # snapshot-archiving them removes it in full.
                    conf = "high" if idle_days >= 30 else ("medium" if idle_days >= 7 else "low")
                    recs.append({
                        "resource_id": rid, "resource_name": name, "resource_group": rg,
                        "subscription_id": sub, "resource_type": rtype, "current_sku": sku,
                        "category": "waste", "action": "reclaim_stopped_vm",
                        "title": f"{name} is {power} but still costs {cost:.2f} USD/month",
                        "detail": (
                            f"The VM has been {power} for {idle_days} day(s), so it is not "
                            f"billing for compute. The remaining ${cost:.2f}/month is its "
                            f"retained OS/data disks and any static public IP. Snapshot and "
                            f"delete the disks, or delete the VM outright, to remove this "
                            f"cost. Confirm the VM is not held for DR or a scheduled "
                            f"start/stop window before deleting."),
                        "monthly_savings_usd": cost,
                        "confidence": conf, "effort": "low",
                        "source": "warehouse:power_state+cost_management",
                    })
                elif is_orphan:
                    recs.append({
                        "resource_id": rid, "resource_name": name, "resource_group": rg,
                        "subscription_id": sub, "resource_type": rtype, "current_sku": sku,
                        "category": "waste", "action": "delete_orphan",
                        "title": f"{name} is unattached and costs {cost:.2f} USD/month",
                        "detail": (
                            f"This {rtype} has no parent or attachment and still bills "
                            f"${cost:.2f}/month. Deleting it removes the charge entirely. "
                            f"Verify it is not staged for an upcoming attach."),
                        "monthly_savings_usd": cost,
                        "confidence": "high", "effort": "low",
                        "source": "warehouse:orphan+cost_management",
                    })
    except Exception as e:
        logger.error("warehouse recommendation generation failed: %s", e)
        return out

    if recs:
        written = persist_recommendations(recs)
        # A dismissed resource is still re-detected (so `last_seen` stays truthful)
        # but persist preserves its status — count it separately so the ETL log does
        # not claim it created work the user already rejected.
        revived = sum(1 for r in recs if str(r["resource_id"]).lower() in dismissed_ids)
        out["refreshed_dismissed"] = revived
        out["generated"] = max(0, written - revived)
        out["monthly_usd"] = round(
            sum(r["monthly_savings_usd"] for r in recs
                if str(r["resource_id"]).lower() not in dismissed_ids), 2)
    return out


def _resource_month_cost(con, resource_id: str, d_from: str, d_to: str) -> Optional[float]:
    """Monthly-equivalent cost for a resource over a window, from the warehouse.

    Returns None when the resource has NO rows at all — that means "not tracked",
    which is different from "cost is zero"."""
    try:
        row = con.execute(
            "SELECT SUM(cost_usd), COUNT(DISTINCT snapshot_date) "
            "FROM finops_daily_resource_costs "
            "WHERE resource_id = ? AND snapshot_date >= ? AND snapshot_date <= ?",
            ((resource_id or "").lower(), d_from, d_to)).fetchone()
        if not row or not row[1]:
            return None
        total, days = float(row[0] or 0), int(row[1] or 0)
        return round(total / days * 30.0, 2) if days else 0.0
    except Exception:
        return None


def _resource_was_tracked(con, resource_id: str, before: str) -> bool:
    """True when the resource had per-resource cost rows before the action.

    Per-resource cost collection is throttled and covers only a fraction of the
    estate. Without this check an untracked resource would look decommissioned and
    its whole baseline would be booked as a saving that never happened."""
    try:
        row = con.execute(
            "SELECT COUNT(*) FROM finops_daily_resource_costs "
            "WHERE resource_id = ? AND snapshot_date < ?",
            ((resource_id or "").lower(), before)).fetchone()
        return bool(row and row[0])
    except Exception:
        return False


def set_status(fingerprint: str, status: str, changed_by: str = "",
               note: str = "", baseline_override_usd: Optional[float] = None) -> Dict[str, Any]:
    """Move a recommendation through its lifecycle.

    Accepting or implementing snapshots the resource's trailing 30-day cost as
    the baseline, which is what realized savings is later measured against.
    `baseline_override_usd` is used when the warehouse has no resource-level rows
    for the resource (per-resource cost collection can be throttled)."""
    if not _DB_AVAILABLE:
        return {"ok": False, "error": "database unavailable"}
    status = (status or "").lower()
    if status not in VALID_STATUSES:
        return {"ok": False, "error": f"invalid status '{status}'"}
    now = _now()
    t = _today()
    d_to, d_from = str(t - timedelta(days=1)), str(t - timedelta(days=30))
    try:
        with _conn() as con:
            row = con.execute(
                "SELECT resource_id, baseline_cost_usd FROM finops_recommendations "
                "WHERE fingerprint = ?", (fingerprint,)).fetchone()
            if not row:
                return {"ok": False, "error": "recommendation not found"}
            resource_id, existing_baseline = row[0], float(row[1] or 0)

            baseline = existing_baseline
            baseline_source = "existing"
            if status in (STATUS_ACCEPTED, STATUS_IMPLEMENTED) and existing_baseline <= 0:
                measured = _resource_month_cost(con, resource_id, d_from, d_to)
                if measured:
                    baseline, baseline_source = measured, "warehouse"
                elif baseline_override_usd:
                    baseline, baseline_source = round(float(baseline_override_usd), 2), "scan"
                else:
                    baseline_source = "none"

            implemented_at = now if status == STATUS_IMPLEMENTED else ""
            con.execute(
                "UPDATE finops_recommendations SET status=?, status_changed_at=?, "
                "status_changed_by=?, note=?, baseline_cost_usd=?, baseline_from=?, "
                "baseline_to=?, implemented_at=CASE WHEN ?='' THEN implemented_at ELSE ? END "
                "WHERE fingerprint=?",
                (status, now, changed_by, note, baseline, d_from, d_to,
                 implemented_at, implemented_at, fingerprint))
        return {"ok": True, "fingerprint": fingerprint, "status": status,
                "baseline_cost_usd": baseline,
                "baseline_source": baseline_source}
    except Exception as e:
        logger.error("recommendation status update failed: %s", e)
        return {"ok": False, "error": str(e)}


def list_recommendations(status: Optional[str] = None, category: Optional[str] = None,
                         limit: int = 500) -> Dict[str, Any]:
    if not _DB_AVAILABLE:
        return {"available": False, "recommendations": []}
    where, params = [], []
    if status:
        where.append("status = ?")
        params.append(status.lower())
    if category:
        where.append("category = ?")
        params.append(category)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    items: List[Dict[str, Any]] = []
    try:
        with _conn() as con:
            rows = con.execute(
                "SELECT fingerprint, resource_id, resource_name, resource_group, resource_type, "
                "subscription_id, category, action, title, detail, current_sku, target_sku, "
                "monthly_savings_usd, confidence, effort, effort_hours, source, status, "
                "status_changed_at, status_changed_by, note, baseline_cost_usd, implemented_at, "
                "first_seen, last_seen FROM finops_recommendations"
                + clause + " ORDER BY monthly_savings_usd DESC", tuple(params)).fetchmany(limit)
            for r in rows:
                items.append({
                    "fingerprint": r[0], "resource_id": r[1], "resource_name": r[2],
                    "resource_group": r[3], "resource_type": r[4], "subscription_id": r[5],
                    "category": r[6], "action": r[7], "title": r[8], "detail": r[9],
                    "current_sku": r[10], "target_sku": r[11],
                    "monthly_savings_usd": round(float(r[12] or 0), 2),
                    "confidence": r[13], "effort": r[14],
                    "effort_hours": float(r[15] or 0), "source": r[16], "status": r[17],
                    "status_changed_at": r[18], "status_changed_by": r[19], "note": r[20],
                    "baseline_cost_usd": round(float(r[21] or 0), 2),
                    "implemented_at": r[22], "first_seen": r[23], "last_seen": r[24],
                })
    except Exception as e:
        logger.warning("recommendation list failed: %s", e)
        return {"available": False, "recommendations": []}
    return {"available": True, "recommendations": items, "count": len(items)}


# ── Realized savings measurement ──────────────────────────────────────────────

def measure_realized_savings(run_id: str = "") -> Dict[str, Any]:
    """For every implemented recommendation, compare current cost to the baseline
    and write one ledger row per billing month.

    A recommendation is only measured when the resource was actually tracked in
    the per-resource cost grain. Per-resource collection is throttled and covers a
    fraction of the estate, so an absent row means "not measured", never "deleted".
    """
    if not _DB_AVAILABLE:
        return {"ok": False, "measured": 0}
    t = _today()
    d_to, d_from = str(t - timedelta(days=1)), str(t - timedelta(days=30))
    billing_month = t.strftime("%Y-%m")
    cols = ["id", "fingerprint", "measured_at", "billing_month", "subscription_id",
            "resource_id", "category", "baseline_cost_usd", "actual_cost_usd",
            "realized_usd", "expected_usd", "implementation_cost_usd",
            "measurement_note", "etl_run_id"]
    sql = upsert_conflict_sql("finops_savings_ledger", cols, ["id"],
                              [c for c in cols if c != "id"])
    measured = unmeasurable = 0
    try:
        with _conn() as con:
            rows = con.execute(
                "SELECT fingerprint, subscription_id, resource_id, category, "
                "baseline_cost_usd, monthly_savings_usd, effort_hours, implemented_at "
                "FROM finops_recommendations WHERE status = ? AND baseline_cost_usd > 0",
                (STATUS_IMPLEMENTED,)).fetchall()
            for r in rows:
                fp, sub, rid, cat = r[0], r[1], r[2], r[3]
                baseline = float(r[4] or 0)
                expected = float(r[5] or 0)
                hours = float(r[6] or 0)
                implemented_at = str(r[7] or "")[:10] or d_from

                actual = _resource_month_cost(con, rid, d_from, d_to)
                if actual is None:
                    if not _resource_was_tracked(con, rid, implemented_at):
                        # Never present in the per-resource grain — cannot attribute
                        # any saving to this action without inventing it.
                        unmeasurable += 1
                        continue
                    actual = 0.0
                    note = "tracked before the action, absent after; treated as decommissioned"
                else:
                    note = "measured from per-resource warehouse cost"

                realized = round(max(0.0, baseline - actual), 2)
                key = hashlib.sha256(f"{fp}|{billing_month}".encode("utf-8")).hexdigest()
                con.execute(sql, (
                    key, fp, _now(), billing_month, sub, rid, cat,
                    baseline, actual, realized, expected,
                    round(hours * DEFAULT_HOURLY_RATE_USD, 2), note, run_id))
                measured += 1
    except Exception as e:
        logger.error("realized savings measurement failed: %s", e)
        return {"ok": False, "measured": measured, "error": str(e)}
    if unmeasurable:
        logger.info("Realized savings: %d implemented recommendation(s) not measurable "
                    "(resource absent from the per-resource cost grain)", unmeasurable)
    return {"ok": True, "measured": measured, "unmeasurable": unmeasurable,
            "billing_month": billing_month}


def get_savings_rollup(hourly_rate_usd: float = DEFAULT_HOURLY_RATE_USD) -> Dict[str, Any]:
    """Identified / accepted / potential / realized savings and ROI %."""
    empty = {
        "available": False, "identified_monthly_usd": 0.0, "accepted_monthly_usd": 0.0,
        "potential_monthly_usd": 0.0, "realized_monthly_usd": 0.0,
        "realized_annualized_usd": 0.0, "implementation_cost_usd": 0.0,
        "roi_pct": 0.0, "by_status": {}, "by_category": [], "ledger_months": [],
    }
    if not _DB_AVAILABLE:
        return empty
    try:
        with _conn() as con:
            by_status: Dict[str, Dict[str, float]] = {}
            for r in con.execute(
                    "SELECT status, COUNT(*), SUM(monthly_savings_usd), SUM(effort_hours) "
                    "FROM finops_recommendations GROUP BY status").fetchall():
                by_status[r[0]] = {"count": int(r[1] or 0),
                                   "monthly_savings_usd": round(float(r[2] or 0), 2),
                                   "effort_hours": float(r[3] or 0)}

            by_category = [
                {"category": r[0], "count": int(r[1] or 0),
                 "monthly_savings_usd": round(float(r[2] or 0), 2)}
                for r in con.execute(
                    "SELECT category, COUNT(*), SUM(monthly_savings_usd) "
                    "FROM finops_recommendations WHERE status != ? "
                    "GROUP BY category ORDER BY SUM(monthly_savings_usd) DESC",
                    (STATUS_DISMISSED,)).fetchall()
            ]

            latest_month = None
            row = con.execute("SELECT MAX(billing_month) FROM finops_savings_ledger").fetchone()
            if row and row[0]:
                latest_month = row[0]

            realized = impl_cost = 0.0
            if latest_month:
                lr = con.execute(
                    "SELECT SUM(realized_usd), SUM(implementation_cost_usd) "
                    "FROM finops_savings_ledger WHERE billing_month = ?",
                    (latest_month,)).fetchone()
                if lr:
                    realized = round(float(lr[0] or 0), 2)
                    impl_cost = round(float(lr[1] or 0), 2)

            months = [
                {"billing_month": r[0], "realized_usd": round(float(r[1] or 0), 2),
                 "expected_usd": round(float(r[2] or 0), 2)}
                for r in con.execute(
                    "SELECT billing_month, SUM(realized_usd), SUM(expected_usd) "
                    "FROM finops_savings_ledger GROUP BY billing_month "
                    "ORDER BY billing_month").fetchall()
            ]
    except Exception as e:
        logger.warning("savings rollup failed: %s", e)
        return empty

    identified = sum(v["monthly_savings_usd"] for k, v in by_status.items()
                     if k != STATUS_DISMISSED)
    accepted = by_status.get(STATUS_ACCEPTED, {}).get("monthly_savings_usd", 0.0)
    potential = by_status.get(STATUS_OPEN, {}).get("monthly_savings_usd", 0.0)

    # Fall back to the stored effort estimate when nothing has been measured yet.
    if impl_cost <= 0:
        impl_hours = by_status.get(STATUS_IMPLEMENTED, {}).get("effort_hours", 0.0)
        impl_cost = round(impl_hours * hourly_rate_usd, 2)

    realized_annual = round(realized * 12, 2)
    # Reporting an ROI before anything has been measured would show -100%, which
    # reads as a loss rather than "not measured yet".
    roi_available = bool(months) and impl_cost > 0
    roi = round((realized_annual - impl_cost) / impl_cost * 100, 1) if roi_available else None

    return {
        "available": True,
        "identified_monthly_usd": round(identified, 2),
        "identified_annualized_usd": round(identified * 12, 2),
        "accepted_monthly_usd": round(accepted, 2),
        "potential_monthly_usd": round(potential, 2),
        "realized_monthly_usd": realized,
        "realized_annualized_usd": realized_annual,
        "implementation_cost_usd": impl_cost,
        "hourly_rate_usd": hourly_rate_usd,
        "roi_pct": roi,
        "roi_available": roi_available,
        "capture_rate_pct": round(realized / identified * 100, 1) if identified > 0 else 0.0,
        "by_status": by_status,
        "by_category": by_category,
        "ledger_months": months,
    }
