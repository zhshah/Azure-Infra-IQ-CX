"""
Migration 006: FinOps Management Dashboard tables

Adds the storage that the management cost & usage dashboard reads:

  1. finops_daily_meter_costs      — daily cost + usage QUANTITY by meter
                                     (storage access tier, data egress, inter-region,
                                     Log Analytics GB ingested, $/GB analytics)
  2. finops_resource_utilization   — point-in-time CPU/memory/util + power state per
                                     resource, snapshotted daily so VM cost-vs-utilisation
                                     and idle-VM cost are answerable historically
  3. finops_storage_capacity       — storage capacity in GB per account/disk per day
                                     (GB/month growth rate)
  4. finops_recommendations        — persisted optimisation recommendations with an
                                     accept/implement lifecycle (enables Realized Savings)
  5. finops_savings_ledger         — realized-savings ledger: baseline vs post-action cost
                                     per implemented recommendation (enables ROI %)
  6. finops_mgmt_group_costs       — management-group cost rollup (incl. nested descendants)
  7. finops_la_table_costs         — per-TABLE Log Analytics / Sentinel billable GB and
                                     allocated cost (answers "which table costs the most",
                                     which Cost Management cannot)

Usage:
    cd backend
    python migrations/006_finops_dashboard_v2.py

This migration is IDEMPOTENT — safe to run multiple times.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from services.database import get_raw_connection, is_azure_sql, get_db_provider, create_table_sql

# ── Table DDL ─────────────────────────────────────────────────────────────────

TABLES = [
    # 1. finops_daily_meter_costs — daily cost AND usage quantity by meter.
    #    This is the grain that unlocks storage access tier (Hot/Cool/Archive),
    #    data egress, inter-region transfer and $/GB-ingested reporting, none of
    #    which are derivable from the ServiceName/MeterCategory grain alone.
    #    Hashed single-column PK avoids the Azure SQL composite index width limit.
    """
    CREATE TABLE IF NOT EXISTS finops_daily_meter_costs (
        id                  TEXT PRIMARY KEY,
        snapshot_date       TEXT NOT NULL,
        subscription_id     TEXT NOT NULL DEFAULT '',
        service_name        TEXT NOT NULL DEFAULT '',
        meter_category      TEXT NOT NULL DEFAULT '',
        meter_subcategory   TEXT NOT NULL DEFAULT '',
        meter_name          TEXT NOT NULL DEFAULT '',
        classification      TEXT NOT NULL DEFAULT '',
        cost_usd            REAL NOT NULL DEFAULT 0,
        quantity            REAL NOT NULL DEFAULT 0,
        unit                TEXT NOT NULL DEFAULT '',
        currency            TEXT NOT NULL DEFAULT 'USD',
        etl_run_id          TEXT NOT NULL DEFAULT ''
    )
    """,

    # 2. finops_resource_utilization — daily utilisation + power-state snapshot.
    #    Persisting this makes "cost vs utilisation", "% underutilised VMs",
    #    "running vs stopped" and "cost of idle VMs" historical rather than
    #    point-in-time-only.
    """
    CREATE TABLE IF NOT EXISTS finops_resource_utilization (
        id                  TEXT PRIMARY KEY,
        snapshot_date       TEXT NOT NULL,
        subscription_id     TEXT NOT NULL DEFAULT '',
        resource_id         TEXT NOT NULL DEFAULT '',
        resource_name       TEXT NOT NULL DEFAULT '',
        resource_group      TEXT NOT NULL DEFAULT '',
        resource_type       TEXT NOT NULL DEFAULT '',
        location            TEXT NOT NULL DEFAULT '',
        sku                 TEXT NOT NULL DEFAULT '',
        power_state         TEXT NOT NULL DEFAULT '',
        avg_cpu_pct         REAL,
        avg_memory_pct      REAL,
        utilization_pct     REAL,
        is_idle             INTEGER NOT NULL DEFAULT 0,
        is_orphan           INTEGER NOT NULL DEFAULT 0,
        days_idle           INTEGER NOT NULL DEFAULT 0,
        cost_month_usd      REAL NOT NULL DEFAULT 0,
        environment         TEXT NOT NULL DEFAULT '',
        etl_run_id          TEXT NOT NULL DEFAULT ''
    )
    """,

    # 3. finops_storage_capacity — capacity in GB per storage resource per day so
    #    growth rate (GB/month) is a real measured trend, not an estimate.
    """
    CREATE TABLE IF NOT EXISTS finops_storage_capacity (
        id                  TEXT PRIMARY KEY,
        snapshot_date       TEXT NOT NULL,
        subscription_id     TEXT NOT NULL DEFAULT '',
        resource_id         TEXT NOT NULL DEFAULT '',
        resource_name       TEXT NOT NULL DEFAULT '',
        resource_group      TEXT NOT NULL DEFAULT '',
        resource_type       TEXT NOT NULL DEFAULT '',
        access_tier         TEXT NOT NULL DEFAULT '',
        redundancy          TEXT NOT NULL DEFAULT '',
        capacity_gb         REAL NOT NULL DEFAULT 0,
        cost_month_usd      REAL NOT NULL DEFAULT 0,
        etl_run_id          TEXT NOT NULL DEFAULT ''
    )
    """,

    # 4. finops_recommendations — persisted recommendation lifecycle.
    #    fingerprint is a stable hash of (category, resource_id, action) so the same
    #    finding keeps its identity across scans and its status survives re-detection.
    """
    CREATE TABLE IF NOT EXISTS finops_recommendations (
        fingerprint         TEXT PRIMARY KEY,
        first_seen          TEXT NOT NULL,
        last_seen           TEXT NOT NULL,
        subscription_id     TEXT NOT NULL DEFAULT '',
        resource_id         TEXT NOT NULL DEFAULT '',
        resource_name       TEXT NOT NULL DEFAULT '',
        resource_group      TEXT NOT NULL DEFAULT '',
        resource_type       TEXT NOT NULL DEFAULT '',
        category            TEXT NOT NULL DEFAULT '',
        action              TEXT NOT NULL DEFAULT '',
        title               TEXT NOT NULL DEFAULT '',
        detail              TEXT NOT NULL DEFAULT '',
        current_sku         TEXT NOT NULL DEFAULT '',
        target_sku          TEXT NOT NULL DEFAULT '',
        monthly_savings_usd REAL NOT NULL DEFAULT 0,
        confidence          TEXT NOT NULL DEFAULT 'medium',
        effort              TEXT NOT NULL DEFAULT 'medium',
        effort_hours        REAL NOT NULL DEFAULT 0,
        source              TEXT NOT NULL DEFAULT '',
        status              TEXT NOT NULL DEFAULT 'open',
        status_changed_at   TEXT NOT NULL DEFAULT '',
        status_changed_by   TEXT NOT NULL DEFAULT '',
        note                TEXT NOT NULL DEFAULT '',
        baseline_cost_usd   REAL NOT NULL DEFAULT 0,
        baseline_from       TEXT NOT NULL DEFAULT '',
        baseline_to         TEXT NOT NULL DEFAULT '',
        implemented_at      TEXT NOT NULL DEFAULT ''
    )
    """,

    # 5. finops_savings_ledger — one row per measurement of an implemented
    #    recommendation: baseline monthly cost vs measured post-action monthly cost.
    #    realized_usd = baseline - actual (floored at 0). Drives Realized Savings + ROI.
    """
    CREATE TABLE IF NOT EXISTS finops_savings_ledger (
        id                  TEXT PRIMARY KEY,
        fingerprint         TEXT NOT NULL DEFAULT '',
        measured_at         TEXT NOT NULL,
        billing_month       TEXT NOT NULL DEFAULT '',
        subscription_id     TEXT NOT NULL DEFAULT '',
        resource_id         TEXT NOT NULL DEFAULT '',
        category            TEXT NOT NULL DEFAULT '',
        baseline_cost_usd   REAL NOT NULL DEFAULT 0,
        actual_cost_usd     REAL NOT NULL DEFAULT 0,
        realized_usd        REAL NOT NULL DEFAULT 0,
        expected_usd        REAL NOT NULL DEFAULT 0,
        implementation_cost_usd REAL NOT NULL DEFAULT 0,
        measurement_note    TEXT NOT NULL DEFAULT '',
        etl_run_id          TEXT NOT NULL DEFAULT ''
    )
    """,

    # 6. finops_mgmt_group_costs — management-group cost rollup, including the
    #    aggregated cost of every descendant subscription in the MG subtree.
    """
    CREATE TABLE IF NOT EXISTS finops_mgmt_group_costs (
        id                  TEXT PRIMARY KEY,
        billing_month       TEXT NOT NULL,
        mg_id               TEXT NOT NULL DEFAULT '',
        mg_name             TEXT NOT NULL DEFAULT '',
        parent_mg_id        TEXT NOT NULL DEFAULT '',
        depth               INTEGER NOT NULL DEFAULT 0,
        direct_cost_usd     REAL NOT NULL DEFAULT 0,
        rollup_cost_usd     REAL NOT NULL DEFAULT 0,
        subscription_count  INTEGER NOT NULL DEFAULT 0,
        currency            TEXT NOT NULL DEFAULT 'USD',
        etl_run_id          TEXT NOT NULL DEFAULT ''
    )
    """,

    # 7. finops_la_table_costs — per-table ingestion volume and allocated cost for
    #    Log Analytics / Sentinel workspaces. Volume comes from each workspace's own
    #    Usage table; cost is the workspace's real spend apportioned by billable-GB
    #    share, with cost_basis recording how it was derived. Hashed PK keeps the key
    #    narrow (workspace_id is a full ARM resource id).
    """
    CREATE TABLE IF NOT EXISTS finops_la_table_costs (
        id                  TEXT PRIMARY KEY,
        snapshot_date       TEXT NOT NULL,
        subscription_id     TEXT NOT NULL DEFAULT '',
        workspace_id        TEXT NOT NULL DEFAULT '',
        workspace_name      TEXT NOT NULL DEFAULT '',
        resource_group      TEXT NOT NULL DEFAULT '',
        table_name          TEXT NOT NULL DEFAULT '',
        billable_gb         REAL NOT NULL DEFAULT 0,
        non_billable_gb     REAL NOT NULL DEFAULT 0,
        allocated_cost_usd  REAL NOT NULL DEFAULT 0,
        cost_basis          TEXT NOT NULL DEFAULT '',
        is_sentinel         INTEGER NOT NULL DEFAULT 0,
        etl_run_id          TEXT NOT NULL DEFAULT ''
    )
    """,
]

INDEXES_SQLITE = [
    "CREATE INDEX IF NOT EXISTS idx_fm_meter_date ON finops_daily_meter_costs (snapshot_date)",
    "CREATE INDEX IF NOT EXISTS idx_fm_meter_class ON finops_daily_meter_costs (classification, snapshot_date)",
    "CREATE INDEX IF NOT EXISTS idx_fm_meter_sub ON finops_daily_meter_costs (subscription_id, snapshot_date)",
    "CREATE INDEX IF NOT EXISTS idx_fm_util_date ON finops_resource_utilization (snapshot_date)",
    "CREATE INDEX IF NOT EXISTS idx_fm_util_type ON finops_resource_utilization (resource_type, snapshot_date)",
    "CREATE INDEX IF NOT EXISTS idx_fm_util_sub ON finops_resource_utilization (subscription_id, snapshot_date)",
    "CREATE INDEX IF NOT EXISTS idx_fm_cap_date ON finops_storage_capacity (snapshot_date)",
    "CREATE INDEX IF NOT EXISTS idx_fm_cap_tier ON finops_storage_capacity (access_tier, snapshot_date)",
    "CREATE INDEX IF NOT EXISTS idx_fm_reco_status ON finops_recommendations (status, category)",
    "CREATE INDEX IF NOT EXISTS idx_fm_reco_res ON finops_recommendations (resource_id)",
    "CREATE INDEX IF NOT EXISTS idx_fm_ledger_fp ON finops_savings_ledger (fingerprint, billing_month)",
    "CREATE INDEX IF NOT EXISTS idx_fm_ledger_month ON finops_savings_ledger (billing_month)",
    "CREATE INDEX IF NOT EXISTS idx_fm_mg_month ON finops_mgmt_group_costs (billing_month)",
    "CREATE INDEX IF NOT EXISTS idx_fm_la_date ON finops_la_table_costs (snapshot_date)",
    "CREATE INDEX IF NOT EXISTS idx_fm_la_sub ON finops_la_table_costs (subscription_id, snapshot_date)",
]

INDEXES_AZURESQL = [
    f"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='{name}') {stmt}"
    for name, stmt in [
        ("idx_fm_meter_date", "CREATE INDEX idx_fm_meter_date ON finops_daily_meter_costs (snapshot_date)"),
        ("idx_fm_meter_class", "CREATE INDEX idx_fm_meter_class ON finops_daily_meter_costs (classification, snapshot_date)"),
        ("idx_fm_meter_sub", "CREATE INDEX idx_fm_meter_sub ON finops_daily_meter_costs (subscription_id, snapshot_date)"),
        ("idx_fm_util_date", "CREATE INDEX idx_fm_util_date ON finops_resource_utilization (snapshot_date)"),
        ("idx_fm_util_type", "CREATE INDEX idx_fm_util_type ON finops_resource_utilization (resource_type, snapshot_date)"),
        ("idx_fm_util_sub", "CREATE INDEX idx_fm_util_sub ON finops_resource_utilization (subscription_id, snapshot_date)"),
        ("idx_fm_cap_date", "CREATE INDEX idx_fm_cap_date ON finops_storage_capacity (snapshot_date)"),
        ("idx_fm_cap_tier", "CREATE INDEX idx_fm_cap_tier ON finops_storage_capacity (access_tier, snapshot_date)"),
        ("idx_fm_reco_status", "CREATE INDEX idx_fm_reco_status ON finops_recommendations (status, category)"),
        ("idx_fm_reco_res", "CREATE INDEX idx_fm_reco_res ON finops_recommendations (resource_id)"),
        ("idx_fm_ledger_fp", "CREATE INDEX idx_fm_ledger_fp ON finops_savings_ledger (fingerprint, billing_month)"),
        ("idx_fm_ledger_month", "CREATE INDEX idx_fm_ledger_month ON finops_savings_ledger (billing_month)"),
        ("idx_fm_la_date", "CREATE INDEX idx_fm_la_date ON finops_la_table_costs (snapshot_date)"),
        ("idx_fm_la_sub", "CREATE INDEX idx_fm_la_sub ON finops_la_table_costs (subscription_id, snapshot_date)"),
        ("idx_fm_mg_month", "CREATE INDEX idx_fm_mg_month ON finops_mgmt_group_costs (billing_month)"),
    ]
]


def normalize_legacy_dates(cursor):
    """Rewrite YYYYMMDD snapshot_date values to dashed ISO.

    The resource-cost collector stored Azure's integer UsageDate verbatim. Range
    queries compare strings, and '20260804' sorts ABOVE any dashed date, so every
    such row silently disappears from date-filtered results — the table looks
    partly empty while the rows are still there.

    A plain UPDATE cannot fix this: where the same day was also collected in the
    dashed format, normalising collides with the existing primary key, the whole
    statement rolls back, and nothing gets repaired. So drop the superseded
    YYYYMMDD duplicates first, then normalise what remains.
    """
    fixed = 0
    azure = is_azure_sql()
    dashed = (
        "SUBSTRING(a.snapshot_date,1,4) + '-' + SUBSTRING(a.snapshot_date,5,2) + '-' "
        "+ SUBSTRING(a.snapshot_date,7,2)"
        if azure else
        "substr(a.snapshot_date,1,4) || '-' || substr(a.snapshot_date,5,2) || '-' "
        "|| substr(a.snapshot_date,7,2)"
    )
    length_fn = "LEN" if azure else "length"
    malformed = f"{length_fn}(a.snapshot_date) = 8 AND a.snapshot_date NOT LIKE '%-%'"

    # 1. Where both formats exist for the same day+subscription+resource, keep the
    #    LARGER observation on the surviving ISO row. Cost Management restates a day
    #    as late usage lands, and a partial collection can be lower; taking the max
    #    means the repair can never discard spend that was actually observed.
    merge_sql = (
        f"UPDATE b SET cost_usd = a.cost_usd "
        f"FROM finops_daily_resource_costs b "
        f"JOIN finops_daily_resource_costs a "
        f"  ON b.snapshot_date = {dashed} "
        f" AND b.subscription_id = a.subscription_id "
        f" AND b.resource_id = a.resource_id "
        f"WHERE {malformed} AND a.cost_usd > b.cost_usd"
        if azure else
        f"UPDATE finops_daily_resource_costs AS b SET cost_usd = ("
        f"  SELECT MAX(a.cost_usd) FROM finops_daily_resource_costs a"
        f"  WHERE {malformed} AND {dashed} = b.snapshot_date"
        f"    AND a.subscription_id = b.subscription_id AND a.resource_id = b.resource_id) "
        f"WHERE EXISTS ("
        f"  SELECT 1 FROM finops_daily_resource_costs a"
        f"  WHERE {malformed} AND {dashed} = b.snapshot_date"
        f"    AND a.subscription_id = b.subscription_id AND a.resource_id = b.resource_id"
        f"    AND a.cost_usd > b.cost_usd)"
    )
    try:
        cursor.execute(merge_sql)
        merged = cursor.rowcount if cursor.rowcount and cursor.rowcount > 0 else 0
        if merged:
            print(f"  merged {merged} row(s) where the legacy copy held more spend")
    except Exception as e:
        print(f"  duplicate merge skipped: {e}")

    # 2. Remove the now-redundant legacy duplicates.
    delete_sql = (
        f"DELETE a FROM finops_daily_resource_costs a WHERE {malformed} AND EXISTS ("
        f"  SELECT 1 FROM finops_daily_resource_costs b"
        f"  WHERE b.snapshot_date = {dashed}"
        f"    AND b.subscription_id = a.subscription_id"
        f"    AND b.resource_id = a.resource_id)"
        if azure else
        f"DELETE FROM finops_daily_resource_costs WHERE rowid IN ("
        f"  SELECT a.rowid FROM finops_daily_resource_costs a WHERE {malformed} AND EXISTS ("
        f"    SELECT 1 FROM finops_daily_resource_costs b"
        f"    WHERE b.snapshot_date = {dashed}"
        f"      AND b.subscription_id = a.subscription_id"
        f"      AND b.resource_id = a.resource_id))"
    )
    try:
        cursor.execute(delete_sql)
        removed = cursor.rowcount if cursor.rowcount and cursor.rowcount > 0 else 0
        if removed:
            print(f"  removed {removed} superseded YYYYMMDD duplicate row(s)")
    except Exception as e:
        print(f"  duplicate cleanup skipped: {e}")

    # 3. Normalise the survivors.
    update_sql = (
        f"UPDATE a SET snapshot_date = {dashed} "
        f"FROM finops_daily_resource_costs a WHERE {malformed}"
        if azure else
        f"UPDATE finops_daily_resource_costs SET snapshot_date = "
        f"substr(snapshot_date,1,4) || '-' || substr(snapshot_date,5,2) || '-' "
        f"|| substr(snapshot_date,7,2) "
        f"WHERE length(snapshot_date) = 8 AND snapshot_date NOT LIKE '%-%'"
    )
    try:
        cursor.execute(update_sql)
        fixed = cursor.rowcount if cursor.rowcount and cursor.rowcount > 0 else 0
        if fixed:
            print(f"  normalised {fixed} legacy YYYYMMDD date(s)")
    except Exception as e:
        print(f"  date normalization skipped: {e}")
    return fixed


def run_migration():
    provider = get_db_provider()
    print(f"Running FinOps Dashboard v2 schema migration for provider: {provider}")
    print("=" * 60)

    conn = get_raw_connection()
    if is_azure_sql():
        conn.autocommit = True
    cursor = conn.cursor()

    import re as _re

    _indexed_by_table = {}
    for idx_sql in INDEXES_SQLITE:
        m = _re.search(r'ON\s+(\w+)\s*\(([^)]+)\)', idx_sql, _re.IGNORECASE)
        if m:
            tbl = m.group(1).lower()
            cols = {c.strip().lower() for c in m.group(2).split(',')}
            _indexed_by_table.setdefault(tbl, set()).update(cols)

    created = 0
    for i, ddl in enumerate(TABLES, 1):
        table_name = ddl.strip().split("(")[0].split()[-1]
        try:
            idx_cols = _indexed_by_table.get(table_name.lower(), set())
            sql = create_table_sql(ddl, indexed_cols=idx_cols) if is_azure_sql() else ddl
            cursor.execute(sql)
            created += 1
            print(f"  [{i}/{len(TABLES)}] OK {table_name}")
        except Exception as e:
            err = str(e).lower()
            if "already" in err or "exists" in err or "duplicate" in err:
                print(f"  [{i}/{len(TABLES)}] -- {table_name} (already exists)")
            else:
                print(f"  [{i}/{len(TABLES)}] FAIL {table_name}: {e}")

    indexes = INDEXES_AZURESQL if is_azure_sql() else INDEXES_SQLITE
    print(f"\nCreating {len(indexes)} indexes...")
    ok_idx = 0
    for idx_sql in indexes:
        try:
            cursor.execute(idx_sql)
            ok_idx += 1
        except Exception as e:
            err = str(e).lower()
            if "already" in err or "exists" in err or "duplicate" in err:
                ok_idx += 1
            else:
                print(f"  Index warning: {e}")

    print(f"  {ok_idx}/{len(indexes)} indexes ready")

    fixed = normalize_legacy_dates(cursor)
    if fixed:
        print(f"\nNormalized {fixed} legacy YYYYMMDD snapshot_date values to dashed ISO")

    if not is_azure_sql():
        conn.commit()
    conn.close()
    print(f"\nFinOps Dashboard v2 migration complete - {created} tables processed")


if __name__ == "__main__":
    run_migration()
