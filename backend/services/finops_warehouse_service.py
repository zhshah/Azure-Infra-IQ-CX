"""
FinOps Warehouse Service — Nightly ETL + Query Layer

This service is responsible for:
1. Running a nightly ETL job that downloads ALL cost data from Azure Cost
   Management into Azure SQL.  The job runs at midnight UTC and is also
   triggered once on first startup if the warehouse is empty.

2. Providing fast read-only query functions that the API routes use to serve
   the FinOps Warehouse dashboard.  All reads come from the database —
   zero live Azure API calls, zero throttling.

ETL flow per subscription:
    a) Daily resource-level costs  → finops_daily_resource_costs  (30 days)
    b) Daily subscription rollup   → finops_daily_subscription_costs (30 days)
    c) Monthly service breakdown   → finops_monthly_service_costs  (12 months)
    d) Monthly tag breakdown       → finops_monthly_tag_costs      (3 months)
    e) Anomaly detection           → finops_anomalies
    f) Update ETL run metadata     → finops_etl_runs

All writes use the existing upsert helpers so re-runs are safe.
"""
from __future__ import annotations

import hashlib
import logging
import time
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── Lazy imports — keep startup fast ─────────────────────────────────────────

try:
    from services.database import (
        get_connection,
        is_azure_sql,
        upsert_conflict_sql,
        upsert_sql,
        limit_sql,
    )
    _DB_AVAILABLE = True
except ImportError:
    _DB_AVAILABLE = False
    logger.warning("FinOps Warehouse: database module not available")

try:
    from services.finops_data_service import (
        query_cost,
        query_cost_multi_subscription,
        normalise_cost_rows,
        resolve_time_range,
        get_subscription_ids,
    )
    _FINOPS_DATA_AVAILABLE = True
except ImportError:
    _FINOPS_DATA_AVAILABLE = False
    logger.warning("FinOps Warehouse: finops_data_service not available")

# ── Constants ─────────────────────────────────────────────────────────────────

DAILY_RESOURCE_DAYS = 30   # how many days of resource-level daily grain to keep
MONTHLY_SERVICE_MONTHS = 12  # how many months of monthly service grain to keep
MONTHLY_TAG_MONTHS = 3       # how many months of monthly tag grain to keep

# Tag keys we track (matching what Cost Management actually has)
TRACKED_TAG_KEYS = [
    "Environment", "environment", "env",
    "BusinessUnit", "businessunit", "business_unit",
    "Project", "project",
    "Application", "application", "app",
    "CostCenter", "costcenter", "cost_center",
    "Owner", "owner",
    "Team", "team",
]

ANOMALY_SPIKE_THRESHOLDS = {
    "medium": 50.0,    # 50% above 7-day avg
    "high": 100.0,     # 100% above 7-day avg
    "critical": 200.0, # 200% above 7-day avg
}

ANOMALY_MIN_COST_USD = 5.0  # ignore spikes on resources costing < $5/day avg

# ── DB context helper ─────────────────────────────────────────────────────────

@contextmanager
def _conn():
    with get_connection() as con:
        yield con


# ── ETL run tracking ──────────────────────────────────────────────────────────

def _start_etl_run(triggered_by: str = "scheduler") -> str:
    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    try:
        with _conn() as con:
            con.execute(
                """INSERT INTO finops_etl_runs
                   (run_id, started_at, status, triggered_by)
                   VALUES (?, ?, 'running', ?)""",
                (run_id, now, triggered_by),
            )
    except Exception as e:
        logger.error("ETL: failed to record run start: %s", e)
    return run_id


def _finish_etl_run(run_id: str, counters: dict, error: Optional[str] = None) -> None:
    now = datetime.now(timezone.utc).isoformat()
    status = "failed" if error else "completed"
    try:
        with _conn() as con:
            con.execute(
                """UPDATE finops_etl_runs
                   SET completed_at=?, status=?,
                       subscriptions_count=?, rows_resource_costs=?,
                       rows_sub_costs=?, rows_service_costs=?,
                       rows_tag_costs=?, rows_anomalies=?,
                       error_message=?
                   WHERE run_id=?""",
                (
                    now, status,
                    counters.get("subscriptions", 0),
                    counters.get("resource_costs", 0),
                    counters.get("sub_costs", 0),
                    counters.get("service_costs", 0),
                    counters.get("tag_costs", 0),
                    counters.get("anomalies", 0),
                    error,
                    run_id,
                ),
            )
    except Exception as e:
        logger.error("ETL: failed to record run finish: %s", e)


# ── Main ETL orchestrator ──────────────────────────────────────────────────────

def run_full_etl(
    subscription_ids: Optional[List[str]] = None,
    triggered_by: str = "scheduler",
) -> Dict[str, Any]:
    """
    Run the full nightly ETL job.

    Downloads cost data for all subscriptions and persists to Azure SQL.
    Runs sequentially per subscription to avoid Azure Cost Management 429s.

    Returns a summary dict with run_id, status, and row counts.
    """
    if not _DB_AVAILABLE or not _FINOPS_DATA_AVAILABLE:
        return {"status": "error", "message": "Required services not available"}

    if subscription_ids is None:
        subscription_ids = get_subscription_ids()

    if not subscription_ids:
        return {"status": "error", "message": "No subscription IDs configured"}

    run_id = _start_etl_run(triggered_by)
    logger.info("ETL run %s started for %d subscriptions", run_id, len(subscription_ids))

    counters: Dict[str, int] = {
        "subscriptions": len(subscription_ids),
        "resource_costs": 0,
        "sub_costs": 0,
        "service_costs": 0,
        "tag_costs": 0,
        "anomalies": 0,
    }

    try:
        today = datetime.now(timezone.utc).date()

        for idx, sub_id in enumerate(subscription_ids, 1):
            logger.info("ETL: processing subscription %d/%d: %s", idx, len(subscription_ids), sub_id[:8] + "…")
            try:
                # a) Daily resource costs (last 30 days)
                n = _collect_daily_resource_costs(sub_id, today, run_id)
                counters["resource_costs"] += n
                logger.info("ETL: %s → %d resource cost rows", sub_id[:8], n)

                # b) Daily subscription rollup
                n = _collect_daily_subscription_costs(sub_id, today, run_id)
                counters["sub_costs"] += n

                # c) Monthly service breakdown (last 12 months)
                n = _collect_monthly_service_costs(sub_id, today, run_id)
                counters["service_costs"] += n

                # d) Monthly tag breakdown (last 3 months)
                n = _collect_monthly_tag_costs(sub_id, today, run_id)
                counters["tag_costs"] += n

                # Brief pause between subscriptions to be a good API citizen
                time.sleep(2)

            except Exception as sub_err:
                logger.error("ETL: subscription %s failed: %s", sub_id, sub_err)
                # Continue with next subscription — partial data is better than none

        # e) Anomaly detection runs across all freshly-loaded daily data
        n = _detect_anomalies(today, run_id)
        counters["anomalies"] = n
        logger.info("ETL: %d anomalies detected", n)

        # f) Purge old data beyond retention window
        _purge_old_data(today)

        _finish_etl_run(run_id, counters)
        logger.info("ETL run %s completed: %s", run_id, counters)
        return {"status": "completed", "run_id": run_id, **counters}

    except Exception as e:
        logger.exception("ETL run %s failed: %s", run_id, e)
        _finish_etl_run(run_id, counters, error=str(e))
        return {"status": "failed", "run_id": run_id, "message": str(e), **counters}


# ── ETL step: daily resource costs ───────────────────────────────────────────

def _collect_daily_resource_costs(sub_id: str, today: date, run_id: str) -> int:
    """
    Query daily cost per resource for the last DAILY_RESOURCE_DAYS days
    and bulk-upsert into finops_daily_resource_costs.
    """
    from_date = today - timedelta(days=DAILY_RESOURCE_DAYS - 1)
    scope = f"/subscriptions/{sub_id}"

    rows = query_cost(
        scope=scope,
        from_date=from_date,
        to_date=today,
        granularity="Daily",
        group_by=["ResourceId", "ResourceGroupName", "ResourceType",
                  "ServiceName", "ServiceFamily", "MeterCategory", "ResourceLocation"],
        cost_type="ActualCost",
        use_cache=False,
    )

    if not rows:
        return 0

    col_map = _build_col_map(rows[0] if rows else {})
    inserted = 0

    # Batch into groups of 200 for efficient DB writes
    batch: List[tuple] = []
    for row in rows:
        snapshot_date = _extract_date(row, col_map)
        if not snapshot_date:
            continue

        resource_id    = str(row.get(col_map.get("ResourceId", ""), "") or "").strip().lower()
        resource_name  = _parse_resource_name(resource_id)
        resource_group = str(row.get(col_map.get("ResourceGroupName", ""), "") or "").strip().lower()
        resource_type  = str(row.get(col_map.get("ResourceType", ""), "") or "").strip().lower()
        location       = str(row.get(col_map.get("ResourceLocation", ""), "") or "").strip().lower()
        service_name   = str(row.get(col_map.get("ServiceName", ""), "") or "")
        service_family = str(row.get(col_map.get("ServiceFamily", ""), "") or "")
        meter_category = str(row.get(col_map.get("MeterCategory", ""), "") or "")
        cost_usd       = float(row.get(col_map.get("Cost", ""), 0) or 0)

        batch.append((
            snapshot_date, sub_id, resource_id, resource_name,
            resource_group, resource_type, location,
            service_name, service_family, meter_category,
            cost_usd, "USD", run_id,
        ))

        if len(batch) >= 200:
            inserted += _upsert_resource_cost_batch(batch)
            batch = []

    if batch:
        inserted += _upsert_resource_cost_batch(batch)

    return inserted


def _upsert_resource_cost_batch(batch: List[tuple]) -> int:
    cols = [
        "snapshot_date", "subscription_id", "resource_id", "resource_name",
        "resource_group", "resource_type", "location",
        "service_name", "service_family", "meter_category",
        "cost_usd", "currency", "etl_run_id",
    ]
    pk_cols = ["snapshot_date", "subscription_id", "resource_id"]
    update_cols = [c for c in cols if c not in pk_cols]

    sql = upsert_conflict_sql("finops_daily_resource_costs", cols, pk_cols, update_cols)

    try:
        with _conn() as con:
            for row_params in batch:
                con.execute(sql, row_params)
        return len(batch)
    except Exception as e:
        logger.error("ETL: resource cost batch upsert failed: %s", e)
        return 0


# ── ETL step: daily subscription rollup ──────────────────────────────────────

def _collect_daily_subscription_costs(sub_id: str, today: date, run_id: str) -> int:
    from_date = today - timedelta(days=DAILY_RESOURCE_DAYS - 1)
    scope = f"/subscriptions/{sub_id}"

    rows = query_cost(
        scope=scope,
        from_date=from_date,
        to_date=today,
        granularity="Daily",
        group_by=["SubscriptionId"],
        cost_type="ActualCost",
        use_cache=False,
    )

    if not rows:
        return 0

    col_map = _build_col_map(rows[0] if rows else {})
    norm = normalise_cost_rows(rows, ["SubscriptionId"])
    inserted = 0

    cols = ["snapshot_date", "subscription_id", "subscription_name", "cost_usd", "currency", "resource_count", "etl_run_id"]
    pk_cols = ["snapshot_date", "subscription_id"]
    update_cols = [c for c in cols if c not in pk_cols]
    sql = upsert_conflict_sql("finops_daily_subscription_costs", cols, pk_cols, update_cols)

    try:
        with _conn() as con:
            for row in norm:
                snapshot_date = str(row.get("date", ""))[:10]
                if not snapshot_date:
                    continue
                cost = float(row.get("cost_usd", 0) or 0)
                sub_name = row.get("dimensions", {}).get("SubscriptionId", sub_id)
                con.execute(sql, (snapshot_date, sub_id, sub_name, cost, "USD", 0, run_id))
                inserted += 1
    except Exception as e:
        logger.error("ETL: subscription rollup upsert failed: %s", e)

    return inserted


# ── ETL step: monthly service breakdown ──────────────────────────────────────

def _collect_monthly_service_costs(sub_id: str, today: date, run_id: str) -> int:
    # 12 months back from start of current month
    from_date = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    for _ in range(MONTHLY_SERVICE_MONTHS - 1):
        from_date = (from_date - timedelta(days=1)).replace(day=1)

    scope = f"/subscriptions/{sub_id}"

    rows = query_cost(
        scope=scope,
        from_date=from_date,
        to_date=today,
        granularity="Monthly",
        group_by=["ServiceFamily", "ServiceName", "MeterCategory"],
        cost_type="ActualCost",
        use_cache=False,
    )

    if not rows:
        return 0

    norm = normalise_cost_rows(rows, ["ServiceFamily", "ServiceName", "MeterCategory"])
    inserted = 0

    cols = ["billing_month", "subscription_id", "service_family", "service_name", "meter_category", "cost_usd", "currency", "resource_count", "etl_run_id"]
    pk_cols = ["billing_month", "subscription_id", "service_family", "service_name", "meter_category"]
    update_cols = [c for c in cols if c not in pk_cols]
    sql = upsert_conflict_sql("finops_monthly_service_costs", cols, pk_cols, update_cols)

    try:
        with _conn() as con:
            for row in norm:
                billing_month = str(row.get("date", ""))[:7]  # "YYYY-MM"
                if not billing_month:
                    continue
                dims = row.get("dimensions", {})
                cost = float(row.get("cost_usd", 0) or 0)
                con.execute(sql, (
                    billing_month, sub_id,
                    dims.get("ServiceFamily", ""),
                    dims.get("ServiceName", ""),
                    dims.get("MeterCategory", ""),
                    cost, "USD", 0, run_id,
                ))
                inserted += 1
    except Exception as e:
        logger.error("ETL: service breakdown upsert failed: %s", e)

    return inserted


# ── ETL step: monthly tag breakdown ──────────────────────────────────────────

def _collect_monthly_tag_costs(sub_id: str, today: date, run_id: str) -> int:
    from_date = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    for _ in range(MONTHLY_TAG_MONTHS - 1):
        from_date = (from_date - timedelta(days=1)).replace(day=1)

    scope = f"/subscriptions/{sub_id}"
    inserted = 0

    cols = ["billing_month", "subscription_id", "tag_key", "tag_value", "cost_usd", "currency", "resource_count", "etl_run_id"]
    pk_cols = ["billing_month", "subscription_id", "tag_key", "tag_value"]
    update_cols = [c for c in cols if c not in pk_cols]
    sql = upsert_conflict_sql("finops_monthly_tag_costs", cols, pk_cols, update_cols)

    for tag_key in ["Environment", "BusinessUnit", "Project", "Application", "CostCenter"]:
        try:
            rows = query_cost(
                scope=scope,
                from_date=from_date,
                to_date=today,
                granularity="Monthly",
                group_by=[f"TagKey:{tag_key}"],
                cost_type="ActualCost",
                use_cache=False,
            )
            if not rows:
                continue

            norm = normalise_cost_rows(rows, [f"TagKey:{tag_key}"])

            with _conn() as con:
                for row in norm:
                    billing_month = str(row.get("date", ""))[:7]
                    if not billing_month:
                        continue
                    tag_val = row.get("dimensions", {}).get(f"TagKey:{tag_key}", "") or "untagged"
                    cost = float(row.get("cost_usd", 0) or 0)
                    con.execute(sql, (billing_month, sub_id, tag_key, tag_val, cost, "USD", 0, run_id))
                    inserted += 1

            time.sleep(1)  # brief pause between tag queries

        except Exception as e:
            logger.warning("ETL: tag query for %s failed: %s", tag_key, e)

    return inserted


# ── ETL step: anomaly detection ───────────────────────────────────────────────

def _detect_anomalies(today: date, run_id: str) -> int:
    """
    Detect cost spikes by comparing the last 3 days' resource costs
    against each resource's 7-day rolling average.
    """
    if not _DB_AVAILABLE:
        return 0

    # Date windows
    window_end = today - timedelta(days=1)   # yesterday (most complete day)
    window_start = window_end - timedelta(days=2)  # 3 days
    baseline_start = today - timedelta(days=10)    # 7-day baseline (days -10 to -3)
    baseline_end = today - timedelta(days=3)

    try:
        with _conn() as con:
            # Get average cost per resource over baseline period
            baseline_sql = """
                SELECT subscription_id, resource_id, resource_name, resource_group,
                       resource_type, AVG(cost_usd) as avg_cost
                FROM finops_daily_resource_costs
                WHERE snapshot_date >= ? AND snapshot_date <= ?
                  AND cost_usd > ?
                GROUP BY subscription_id, resource_id, resource_name, resource_group, resource_type
            """
            baseline_rows = con.execute(
                baseline_sql,
                (str(baseline_start), str(baseline_end), ANOMALY_MIN_COST_USD)
            ).fetchall()

            if not baseline_rows:
                return 0

            # Index baseline by resource_id
            baseline_map: Dict[str, dict] = {}
            for row in baseline_rows:
                baseline_map[str(row[1])] = {
                    "subscription_id": row[0],
                    "resource_id": row[1],
                    "resource_name": row[2],
                    "resource_group": row[3],
                    "resource_type": row[4],
                    "avg_cost": float(row[5]),
                }

            # Get recent costs for same resources
            resource_ids = list(baseline_map.keys())
            if not resource_ids:
                return 0

            # Query recent data — use IN with batches
            recent_sql = """
                SELECT resource_id, snapshot_date, cost_usd
                FROM finops_daily_resource_costs
                WHERE snapshot_date >= ? AND snapshot_date <= ?
            """
            recent_rows = con.execute(
                recent_sql, (str(window_start), str(window_end))
            ).fetchall()

            # Group by resource_id, get max recent cost
            recent_map: Dict[str, float] = {}
            for row in recent_rows:
                rid = str(row[0])
                cost = float(row[2])
                recent_map[rid] = max(recent_map.get(rid, 0.0), cost)

            # Find spikes
            anomalies_inserted = 0
            anomaly_cols = [
                "anomaly_id", "detected_date", "subscription_id", "resource_id",
                "resource_name", "resource_group", "resource_type",
                "cost_latest", "cost_7d_avg", "spike_pct", "severity", "status", "etl_run_id",
            ]
            anomaly_pk = ["anomaly_id"]
            anomaly_update = [c for c in anomaly_cols if c not in anomaly_pk]
            anomaly_sql = upsert_conflict_sql("finops_anomalies", anomaly_cols, anomaly_pk, anomaly_update)

            for rid, baseline in baseline_map.items():
                recent_cost = recent_map.get(rid)
                if recent_cost is None:
                    continue

                avg = baseline["avg_cost"]
                if avg <= 0:
                    continue

                spike_pct = ((recent_cost - avg) / avg) * 100.0
                if spike_pct < ANOMALY_SPIKE_THRESHOLDS["medium"]:
                    continue

                severity = "medium"
                if spike_pct >= ANOMALY_SPIKE_THRESHOLDS["critical"]:
                    severity = "critical"
                elif spike_pct >= ANOMALY_SPIKE_THRESHOLDS["high"]:
                    severity = "high"

                anomaly_id = hashlib.md5(
                    f"{str(today)}:{rid}".encode()
                ).hexdigest()

                con.execute(anomaly_sql, (
                    anomaly_id, str(today),
                    baseline["subscription_id"], rid,
                    baseline["resource_name"], baseline["resource_group"],
                    baseline["resource_type"],
                    recent_cost, avg, spike_pct, severity, "open", run_id,
                ))
                anomalies_inserted += 1

        return anomalies_inserted

    except Exception as e:
        logger.error("ETL: anomaly detection failed: %s", e)
        return 0


# ── ETL step: purge old data ──────────────────────────────────────────────────

def _purge_old_data(today: date) -> None:
    resource_cutoff = str(today - timedelta(days=DAILY_RESOURCE_DAYS + 2))
    billing_cutoff_monthly = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    for _ in range(MONTHLY_SERVICE_MONTHS):
        billing_cutoff_monthly = (billing_cutoff_monthly - timedelta(days=1)).replace(day=1)
    billing_cutoff_str = str(billing_cutoff_monthly)[:7]

    tag_cutoff = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    for _ in range(MONTHLY_TAG_MONTHS):
        tag_cutoff = (tag_cutoff - timedelta(days=1)).replace(day=1)
    tag_cutoff_str = str(tag_cutoff)[:7]

    anomaly_cutoff = str(today - timedelta(days=90))

    try:
        with _conn() as con:
            con.execute("DELETE FROM finops_daily_resource_costs WHERE snapshot_date < ?", (resource_cutoff,))
            con.execute("DELETE FROM finops_daily_subscription_costs WHERE snapshot_date < ?", (resource_cutoff,))
            con.execute("DELETE FROM finops_monthly_service_costs WHERE billing_month < ?", (billing_cutoff_str,))
            con.execute("DELETE FROM finops_monthly_tag_costs WHERE billing_month < ?", (tag_cutoff_str,))
            con.execute("DELETE FROM finops_anomalies WHERE detected_date < ?", (anomaly_cutoff,))
            con.execute("DELETE FROM finops_etl_runs WHERE started_at < ? AND status != 'running'",
                        (str(today - timedelta(days=90)),))
    except Exception as e:
        logger.warning("ETL: purge failed (non-critical): %s", e)


# ── Read-only query functions (for API routes) ────────────────────────────────

def get_last_run_status() -> Dict[str, Any]:
    """Return metadata about the most recent ETL run."""
    if not _DB_AVAILABLE:
        return {"status": "unavailable", "message": "Database not connected"}
    try:
        with _conn() as con:
            row = con.execute(
                """SELECT run_id, started_at, completed_at, status,
                          subscriptions_count, rows_resource_costs,
                          rows_sub_costs, rows_service_costs,
                          rows_tag_costs, rows_anomalies, error_message, triggered_by
                   FROM finops_etl_runs
                   ORDER BY started_at DESC"""
            ).fetchone()

        if not row:
            return {"status": "never_run", "message": "No ETL runs found — trigger a collection to get started"}

        completed_at = row[2]
        age_hours: Optional[float] = None
        if completed_at:
            try:
                ct = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
                age_hours = round((datetime.now(timezone.utc) - ct).total_seconds() / 3600, 1)
            except Exception:
                pass

        return {
            "run_id": row[0],
            "started_at": row[1],
            "completed_at": row[2],
            "status": row[3],
            "subscriptions_count": row[4],
            "rows_resource_costs": row[5],
            "rows_sub_costs": row[6],
            "rows_service_costs": row[7],
            "rows_tag_costs": row[8],
            "rows_anomalies": row[9],
            "error_message": row[10],
            "triggered_by": row[11],
            "data_age_hours": age_hours,
        }
    except Exception as e:
        logger.error("get_last_run_status error: %s", e)
        return {"status": "error", "message": str(e)}


def is_etl_running() -> bool:
    """Check if an ETL run is currently in progress."""
    if not _DB_AVAILABLE:
        return False
    try:
        with _conn() as con:
            row = con.execute(
                "SELECT 1 FROM finops_etl_runs WHERE status='running'"
            ).fetchone()
        return row is not None
    except Exception:
        return False


def has_warehouse_data() -> bool:
    """Return True if the warehouse actually has cost ROWS.

    Checks for real cost data — NOT merely a 'completed' ETL run. The very first
    ETL after a fresh deploy can complete with zero rows (Cost Management 429, or
    the managed identity's Cost Management Reader role not yet propagated at boot).
    Keying off the completed-run count would then wrongly report 'has data' and the
    startup re-collection would never fire, leaving the warehouse permanently empty.
    """
    if not _DB_AVAILABLE:
        return False
    try:
        with _conn() as con:
            row = con.execute(
                "SELECT COUNT(*) FROM finops_daily_resource_costs"
            ).fetchone()
        return (row[0] if row else 0) > 0
    except Exception:
        return False


def get_warehouse_dashboard(
    subscription_ids: Optional[List[str]] = None,
    resource_group: Optional[str] = None,
    days: int = 30,
) -> Dict[str, Any]:
    """
    Return all data needed for the FinOps Warehouse dashboard in a single call.
    All reads come from the database — no Azure API calls.
    """
    if not _DB_AVAILABLE:
        return {"error": "Database not available"}

    today = datetime.now(timezone.utc).date()
    from_date = str(today - timedelta(days=days - 1))
    current_month = str(today)[:7]
    prev_month = str((today.replace(day=1) - timedelta(days=1)))[:7]

    sub_filter = _sub_filter_clause(subscription_ids)
    rg_filter = f" AND resource_group = '{resource_group}'" if resource_group else ""

    try:
        with _conn() as con:
            # ── KPIs ──────────────────────────────────────────────────────
            total_mtd = _query_scalar(con,
                f"""SELECT COALESCE(SUM(cost_usd), 0)
                    FROM finops_daily_resource_costs
                    WHERE snapshot_date >= '{today.replace(day=1)}'
                    {sub_filter}{rg_filter}""")

            total_30d = _query_scalar(con,
                f"""SELECT COALESCE(SUM(cost_usd), 0)
                    FROM finops_daily_resource_costs
                    WHERE snapshot_date >= '{from_date}'
                    {sub_filter}{rg_filter}""")

            total_prev_month = _query_scalar(con,
                f"""SELECT COALESCE(SUM(cost_usd), 0)
                    FROM finops_monthly_service_costs
                    WHERE billing_month = '{prev_month}'
                    {sub_filter}""")

            anomaly_count = _query_scalar(con,
                "SELECT COUNT(*) FROM finops_anomalies WHERE status='open'")

            critical_anomalies = _query_scalar(con,
                "SELECT COUNT(*) FROM finops_anomalies WHERE status='open' AND severity='critical'")

            # ── Daily trend ───────────────────────────────────────────────
            trend_rows = con.execute(
                f"""SELECT snapshot_date, COALESCE(SUM(cost_usd), 0)
                    FROM finops_daily_subscription_costs
                    WHERE snapshot_date >= '{from_date}'
                    {sub_filter.replace('resource_group', 'subscription_id')}
                    GROUP BY snapshot_date
                    ORDER BY snapshot_date"""
            ).fetchall()
            daily_trend = [{"date": r[0], "cost": round(float(r[1]), 2)} for r in trend_rows]

            # ── By subscription ───────────────────────────────────────────
            sub_rows = con.execute(
                f"""SELECT subscription_id, COALESCE(SUM(cost_usd), 0) as total
                    FROM finops_daily_resource_costs
                    WHERE snapshot_date >= '{from_date}'
                    {sub_filter}{rg_filter}
                    GROUP BY subscription_id
                    ORDER BY total DESC"""
            ).fetchall()
            by_subscription = [{"subscription_id": r[0], "cost": round(float(r[1]), 2)} for r in sub_rows]

            # ── By service family ─────────────────────────────────────────
            svc_rows = con.execute(
                f"""SELECT service_family, COALESCE(SUM(cost_usd), 0) as total
                    FROM finops_daily_resource_costs
                    WHERE snapshot_date >= '{from_date}'
                      AND service_family != ''
                    {sub_filter}{rg_filter}
                    GROUP BY service_family
                    ORDER BY total DESC"""
            ).fetchall()
            by_service = [{"service_family": r[0], "cost": round(float(r[1]), 2)} for r in svc_rows]

            # ── Top 10 resources ──────────────────────────────────────────
            top_rows = con.execute(
                f"""SELECT resource_name, resource_type, resource_group,
                           subscription_id, COALESCE(SUM(cost_usd), 0) as total
                    FROM finops_daily_resource_costs
                    WHERE snapshot_date >= '{from_date}'
                    {sub_filter}{rg_filter}
                    GROUP BY resource_name, resource_type, resource_group, subscription_id
                    ORDER BY total DESC"""
            ).fetchmany(10)
            top_resources = [
                {
                    "resource_name": r[0], "resource_type": r[1],
                    "resource_group": r[2], "subscription_id": r[3],
                    "cost": round(float(r[4]), 2),
                }
                for r in top_rows
            ]

            # ── Tag costs (Environment tag) ───────────────────────────────
            env_rows = con.execute(
                f"""SELECT tag_value, COALESCE(SUM(cost_usd), 0) as total
                    FROM finops_monthly_tag_costs
                    WHERE billing_month >= '{(today - timedelta(days=90)).strftime("%Y-%m")}'
                      AND tag_key IN ('Environment', 'environment', 'env')
                    {sub_filter}
                    GROUP BY tag_value
                    ORDER BY total DESC"""
            ).fetchall()
            by_environment = [{"environment": r[0], "cost": round(float(r[1]), 2)} for r in env_rows]

            # ── Monthly service trend (last 6 months) ─────────────────────
            six_months_ago = str((today.replace(day=1) - timedelta(days=1)).replace(day=1))[:7]
            for _ in range(5):
                d = datetime.strptime(six_months_ago + "-01", "%Y-%m-%d").date()
                six_months_ago = str((d - timedelta(days=1)).replace(day=1))[:7]

            monthly_rows = con.execute(
                f"""SELECT billing_month, service_family, COALESCE(SUM(cost_usd), 0) as total
                    FROM finops_monthly_service_costs
                    WHERE billing_month >= '{six_months_ago}'
                    {sub_filter}
                    GROUP BY billing_month, service_family
                    ORDER BY billing_month, total DESC"""
            ).fetchall()
            monthly_trend: Dict[str, Dict[str, float]] = {}
            for r in monthly_rows:
                month = r[0]
                svc = r[1] or "Other"
                monthly_trend.setdefault(month, {})[svc] = round(float(r[2]), 2)
            monthly_service_trend = [
                {"month": k, **v} for k, v in sorted(monthly_trend.items())
            ]

            # ── Open anomalies ────────────────────────────────────────────
            anom_rows = con.execute(
                """SELECT anomaly_id, detected_date, resource_name, resource_group,
                          resource_type, cost_latest, cost_7d_avg, spike_pct, severity
                   FROM finops_anomalies
                   WHERE status='open'
                   ORDER BY spike_pct DESC"""
            ).fetchmany(20)
            anomalies = [
                {
                    "anomaly_id": r[0], "detected_date": r[1],
                    "resource_name": r[2], "resource_group": r[3],
                    "resource_type": r[4],
                    "cost_latest": round(float(r[5]), 2),
                    "cost_7d_avg": round(float(r[6]), 2),
                    "spike_pct": round(float(r[7]), 1),
                    "severity": r[8],
                }
                for r in anom_rows
            ]

        mom_delta = total_mtd - total_prev_month
        mom_pct = (mom_delta / total_prev_month * 100) if total_prev_month else 0.0

        return {
            "kpis": {
                "total_mtd": round(total_mtd, 2),
                "total_30d": round(total_30d, 2),
                "mom_delta": round(mom_delta, 2),
                "mom_pct": round(mom_pct, 1),
                "anomaly_count": anomaly_count,
                "critical_anomalies": critical_anomalies,
            },
            "daily_trend": daily_trend,
            "by_subscription": by_subscription,
            "by_service": by_service,
            "top_resources": top_resources,
            "by_environment": by_environment,
            "monthly_service_trend": monthly_service_trend,
            "anomalies": anomalies,
        }

    except Exception as e:
        logger.error("get_warehouse_dashboard error: %s", e)
        return {"error": str(e)}


def get_resource_costs(
    subscription_ids: Optional[List[str]] = None,
    resource_group: Optional[str] = None,
    resource_type: Optional[str] = None,
    service_family: Optional[str] = None,
    days: int = 30,
    page: int = 1,
    page_size: int = 50,
    sort_by: str = "cost",
    sort_dir: str = "desc",
) -> Dict[str, Any]:
    """Return paginated, filterable resource-level cost table from the warehouse."""
    if not _DB_AVAILABLE:
        return {"items": [], "total": 0, "page": page, "page_size": page_size}

    today = datetime.now(timezone.utc).date()
    from_date = str(today - timedelta(days=days - 1))
    sub_filter = _sub_filter_clause(subscription_ids)

    filters = [f"snapshot_date >= '{from_date}'"]
    if resource_group:
        filters.append(f"resource_group = '{resource_group.replace(chr(39), '')}'")
    if resource_type:
        filters.append(f"resource_type LIKE '%{resource_type.replace(chr(39), '')}%'")
    if service_family:
        filters.append(f"service_family = '{service_family.replace(chr(39), '')}'")
    if subscription_ids:
        quoted = ",".join(f"'{s}'" for s in subscription_ids)
        filters.append(f"subscription_id IN ({quoted})")

    where = " AND ".join(filters)
    valid_sort = {"cost": "total_cost", "name": "resource_name", "group": "resource_group"}
    order_col = valid_sort.get(sort_by, "total_cost")
    order_dir = "DESC" if sort_dir.lower() == "desc" else "ASC"
    offset = (page - 1) * page_size

    try:
        with _conn() as con:
            count_row = con.execute(
                f"""SELECT COUNT(DISTINCT resource_id)
                    FROM finops_daily_resource_costs
                    WHERE {where}"""
            ).fetchone()
            total = count_row[0] if count_row else 0

            if is_azure_sql():
                data_sql = f"""
                    SELECT resource_id, resource_name, resource_group, resource_type,
                           subscription_id, service_family, location,
                           SUM(cost_usd) as total_cost,
                           MIN(snapshot_date) as first_seen,
                           MAX(snapshot_date) as last_seen
                    FROM finops_daily_resource_costs
                    WHERE {where}
                    GROUP BY resource_id, resource_name, resource_group, resource_type,
                             subscription_id, service_family, location
                    ORDER BY {order_col} {order_dir}
                    OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY
                """
            else:
                data_sql = f"""
                    SELECT resource_id, resource_name, resource_group, resource_type,
                           subscription_id, service_family, location,
                           SUM(cost_usd) as total_cost,
                           MIN(snapshot_date) as first_seen,
                           MAX(snapshot_date) as last_seen
                    FROM finops_daily_resource_costs
                    WHERE {where}
                    GROUP BY resource_id, resource_name, resource_group, resource_type,
                             subscription_id, service_family, location
                    ORDER BY {order_col} {order_dir}
                    LIMIT {page_size} OFFSET {offset}
                """

            rows = con.execute(data_sql).fetchall()

        items = [
            {
                "resource_id": r[0], "resource_name": r[1],
                "resource_group": r[2], "resource_type": r[3],
                "subscription_id": r[4], "service_family": r[5],
                "location": r[6], "cost": round(float(r[7]), 2),
                "first_seen": r[8], "last_seen": r[9],
            }
            for r in rows
        ]
        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, (total + page_size - 1) // page_size),
        }
    except Exception as e:
        logger.error("get_resource_costs error: %s", e)
        return {"items": [], "total": 0, "page": page, "page_size": page_size, "error": str(e)}


def get_anomalies(
    severity: Optional[str] = None,
    status: str = "open",
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """Return detected anomalies from the warehouse."""
    if not _DB_AVAILABLE:
        return []
    try:
        filters = []
        if status:
            filters.append(f"status = '{status}'")
        if severity:
            filters.append(f"severity = '{severity}'")
        where = " AND ".join(filters) if filters else "1=1"

        with _conn() as con:
            rows = con.execute(
                f"""SELECT anomaly_id, detected_date, subscription_id,
                           resource_name, resource_group, resource_type,
                           cost_latest, cost_7d_avg, spike_pct, severity, status
                    FROM finops_anomalies
                    WHERE {where}
                    ORDER BY spike_pct DESC"""
            ).fetchmany(limit)

        return [
            {
                "anomaly_id": r[0], "detected_date": r[1], "subscription_id": r[2],
                "resource_name": r[3], "resource_group": r[4], "resource_type": r[5],
                "cost_latest": round(float(r[6]), 2), "cost_7d_avg": round(float(r[7]), 2),
                "spike_pct": round(float(r[8]), 1), "severity": r[9], "status": r[10],
            }
            for r in rows
        ]
    except Exception as e:
        logger.error("get_anomalies error: %s", e)
        return []


def get_tag_breakdown(
    tag_key: str = "Environment",
    subscription_ids: Optional[List[str]] = None,
    months: int = 3,
) -> List[Dict[str, Any]]:
    """Return monthly cost breakdown by tag value for a given tag key."""
    if not _DB_AVAILABLE:
        return []
    today = datetime.now(timezone.utc).date()
    from_month = str((today.replace(day=1) - timedelta(days=1)).replace(day=1))[:7]
    for _ in range(months - 1):
        d = datetime.strptime(from_month + "-01", "%Y-%m-%d").date()
        from_month = str((d - timedelta(days=1)).replace(day=1))[:7]

    sub_filter = _sub_filter_clause(subscription_ids)
    try:
        with _conn() as con:
            rows = con.execute(
                f"""SELECT billing_month, tag_value, SUM(cost_usd)
                    FROM finops_monthly_tag_costs
                    WHERE tag_key = ? AND billing_month >= ?
                    {sub_filter}
                    GROUP BY billing_month, tag_value
                    ORDER BY billing_month, SUM(cost_usd) DESC""",
                (tag_key, from_month),
            ).fetchall()
        return [{"billing_month": r[0], "tag_value": r[1] or "untagged", "cost": round(float(r[2]), 2)} for r in rows]
    except Exception as e:
        logger.error("get_tag_breakdown error: %s", e)
        return []


def get_service_breakdown(
    subscription_ids: Optional[List[str]] = None,
    months: int = 6,
) -> List[Dict[str, Any]]:
    """Return monthly cost by service family for the last N months."""
    if not _DB_AVAILABLE:
        return []
    today = datetime.now(timezone.utc).date()
    from_month = str(today)[:7]
    for _ in range(months - 1):
        d = datetime.strptime(from_month + "-01", "%Y-%m-%d").date()
        from_month = str((d - timedelta(days=1)).replace(day=1))[:7]

    sub_filter = _sub_filter_clause(subscription_ids)
    try:
        with _conn() as con:
            rows = con.execute(
                f"""SELECT billing_month, service_family, SUM(cost_usd)
                    FROM finops_monthly_service_costs
                    WHERE billing_month >= ? AND service_family != ''
                    {sub_filter}
                    GROUP BY billing_month, service_family
                    ORDER BY billing_month, SUM(cost_usd) DESC""",
                (from_month,),
            ).fetchall()
        return [{"billing_month": r[0], "service_family": r[1], "cost": round(float(r[2]), 2)} for r in rows]
    except Exception as e:
        logger.error("get_service_breakdown error: %s", e)
        return []


# ── Internal helpers ──────────────────────────────────────────────────────────

def _build_col_map(row: dict) -> Dict[str, str]:
    """Map canonical dimension names to actual column names in a Cost Mgmt row."""
    col_map: Dict[str, str] = {}
    for key in row.keys():
        key_lower = key.lower()
        if "resourceid" in key_lower or key_lower == "resourceid":
            col_map["ResourceId"] = key
        elif "resourcegroupname" in key_lower or key_lower == "resourcegroupname":
            col_map["ResourceGroupName"] = key
        elif "resourcetype" in key_lower or key_lower == "resourcetype":
            col_map["ResourceType"] = key
        elif "servicename" in key_lower or key_lower == "servicename":
            col_map["ServiceName"] = key
        elif "servicefamily" in key_lower or key_lower == "servicefamily":
            col_map["ServiceFamily"] = key
        elif "metercategory" in key_lower or key_lower == "metercategory":
            col_map["MeterCategory"] = key
        elif "resourcelocation" in key_lower or key_lower == "resourcelocation":
            col_map["ResourceLocation"] = key
        elif "subscriptionid" in key_lower or key_lower == "subscriptionid":
            col_map["SubscriptionId"] = key
        elif key_lower in ("cost", "pretaxcost", "totalcost"):
            col_map["Cost"] = key
        elif "usagedatetime" in key_lower or "date" in key_lower or "billingperiod" in key_lower:
            col_map["Date"] = key
    return col_map


def _extract_date(row: dict, col_map: Dict[str, str]) -> Optional[str]:
    date_key = col_map.get("Date", "")
    if not date_key:
        # Try common patterns
        for k in row.keys():
            if "date" in k.lower() or "period" in k.lower():
                date_key = k
                break
    if not date_key:
        return None
    val = row.get(date_key)
    if val is None:
        return None
    s = str(val)
    # Azure returns dates as "2026-06-04T00:00:00" or "2026-06-04" or integer 20260604
    if len(s) >= 8 and s[:4].isdigit():
        return s[:10]
    return None


def _parse_resource_name(resource_id: str) -> str:
    """Extract the resource name from an ARM resource ID."""
    if not resource_id:
        return ""
    parts = resource_id.rstrip("/").split("/")
    return parts[-1] if parts else resource_id


def _sub_filter_clause(subscription_ids: Optional[List[str]]) -> str:
    if not subscription_ids:
        return ""
    quoted = ",".join(f"'{s}'" for s in subscription_ids)
    return f" AND subscription_id IN ({quoted})"


def _query_scalar(con, sql: str) -> float:
    try:
        row = con.execute(sql).fetchone()
        return float(row[0]) if row and row[0] is not None else 0.0
    except Exception:
        return 0.0
