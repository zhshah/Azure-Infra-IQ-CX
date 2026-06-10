"""
Migration 005: FinOps Warehouse Schema
Creates 6 new tables for the nightly cost data warehouse.

These tables are populated by the nightly ETL job in finops_warehouse_service.py
and are read by the FinOps Warehouse dashboard endpoints.

Usage:
    cd backend
    python migrations/005_finops_warehouse.py

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
    # 1. finops_etl_runs — history of nightly ETL job runs
    """
    CREATE TABLE IF NOT EXISTS finops_etl_runs (
        run_id              TEXT PRIMARY KEY,
        started_at          TEXT NOT NULL,
        completed_at        TEXT,
        status              TEXT NOT NULL DEFAULT 'running',
        subscriptions_count INTEGER DEFAULT 0,
        rows_resource_costs INTEGER DEFAULT 0,
        rows_sub_costs      INTEGER DEFAULT 0,
        rows_service_costs  INTEGER DEFAULT 0,
        rows_tag_costs      INTEGER DEFAULT 0,
        rows_anomalies      INTEGER DEFAULT 0,
        error_message       TEXT,
        triggered_by        TEXT DEFAULT 'scheduler'
    )
    """,

    # 2. finops_daily_resource_costs — per-resource daily cost grain (30 days rolling)
    """
    CREATE TABLE IF NOT EXISTS finops_daily_resource_costs (
        snapshot_date       TEXT NOT NULL,
        subscription_id     TEXT NOT NULL,
        resource_id         TEXT NOT NULL DEFAULT '',
        resource_name       TEXT NOT NULL DEFAULT '',
        resource_group      TEXT NOT NULL DEFAULT '',
        resource_type       TEXT NOT NULL DEFAULT '',
        location            TEXT NOT NULL DEFAULT '',
        service_name        TEXT NOT NULL DEFAULT '',
        service_family      TEXT NOT NULL DEFAULT '',
        meter_category      TEXT NOT NULL DEFAULT '',
        cost_usd            REAL NOT NULL DEFAULT 0,
        currency            TEXT NOT NULL DEFAULT 'USD',
        etl_run_id          TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (snapshot_date, subscription_id, resource_id)
    )
    """,

    # 3. finops_daily_subscription_costs — daily rollup per subscription (30 days)
    """
    CREATE TABLE IF NOT EXISTS finops_daily_subscription_costs (
        snapshot_date       TEXT NOT NULL,
        subscription_id     TEXT NOT NULL,
        subscription_name   TEXT NOT NULL DEFAULT '',
        cost_usd            REAL NOT NULL DEFAULT 0,
        currency            TEXT NOT NULL DEFAULT 'USD',
        resource_count      INTEGER DEFAULT 0,
        etl_run_id          TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (snapshot_date, subscription_id)
    )
    """,

    # 4. finops_monthly_service_costs — monthly rollup by service family/name (12 months)
    """
    CREATE TABLE IF NOT EXISTS finops_monthly_service_costs (
        billing_month       TEXT NOT NULL,
        subscription_id     TEXT NOT NULL,
        service_family      TEXT NOT NULL DEFAULT '',
        service_name        TEXT NOT NULL DEFAULT '',
        meter_category      TEXT NOT NULL DEFAULT '',
        cost_usd            REAL NOT NULL DEFAULT 0,
        currency            TEXT NOT NULL DEFAULT 'USD',
        resource_count      INTEGER DEFAULT 0,
        etl_run_id          TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (billing_month, subscription_id, service_family, service_name, meter_category)
    )
    """,

    # 5. finops_monthly_tag_costs — monthly rollup by tag key/value (3 months)
    """
    CREATE TABLE IF NOT EXISTS finops_monthly_tag_costs (
        billing_month       TEXT NOT NULL,
        subscription_id     TEXT NOT NULL,
        tag_key             TEXT NOT NULL DEFAULT '',
        tag_value           TEXT NOT NULL DEFAULT '',
        cost_usd            REAL NOT NULL DEFAULT 0,
        currency            TEXT NOT NULL DEFAULT 'USD',
        resource_count      INTEGER DEFAULT 0,
        etl_run_id          TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (billing_month, subscription_id, tag_key, tag_value)
    )
    """,

    # 6. finops_anomalies — detected cost spikes vs 7-day rolling average
    """
    CREATE TABLE IF NOT EXISTS finops_anomalies (
        anomaly_id          TEXT PRIMARY KEY,
        detected_date       TEXT NOT NULL,
        subscription_id     TEXT NOT NULL DEFAULT '',
        resource_id         TEXT NOT NULL DEFAULT '',
        resource_name       TEXT NOT NULL DEFAULT '',
        resource_group      TEXT NOT NULL DEFAULT '',
        resource_type       TEXT NOT NULL DEFAULT '',
        cost_latest         REAL NOT NULL DEFAULT 0,
        cost_7d_avg         REAL NOT NULL DEFAULT 0,
        spike_pct           REAL NOT NULL DEFAULT 0,
        severity            TEXT NOT NULL DEFAULT 'medium',
        status              TEXT NOT NULL DEFAULT 'open',
        etl_run_id          TEXT NOT NULL DEFAULT ''
    )
    """,
]

# ── Indexes ───────────────────────────────────────────────────────────────────

INDEXES_SQLITE = [
    "CREATE INDEX IF NOT EXISTS idx_fw_daily_res_sub ON finops_daily_resource_costs (subscription_id, snapshot_date)",
    "CREATE INDEX IF NOT EXISTS idx_fw_daily_res_rg ON finops_daily_resource_costs (resource_group, snapshot_date)",
    "CREATE INDEX IF NOT EXISTS idx_fw_daily_res_type ON finops_daily_resource_costs (resource_type)",
    "CREATE INDEX IF NOT EXISTS idx_fw_daily_res_svc ON finops_daily_resource_costs (service_family, snapshot_date)",
    "CREATE INDEX IF NOT EXISTS idx_fw_daily_sub_date ON finops_daily_subscription_costs (snapshot_date)",
    "CREATE INDEX IF NOT EXISTS idx_fw_monthly_svc_month ON finops_monthly_service_costs (billing_month, subscription_id)",
    "CREATE INDEX IF NOT EXISTS idx_fw_monthly_tag_key ON finops_monthly_tag_costs (tag_key, billing_month)",
    "CREATE INDEX IF NOT EXISTS idx_fw_anomalies_date ON finops_anomalies (detected_date)",
    "CREATE INDEX IF NOT EXISTS idx_fw_anomalies_sev ON finops_anomalies (severity, status)",
    "CREATE INDEX IF NOT EXISTS idx_fw_etl_status ON finops_etl_runs (status, started_at)",
]

INDEXES_AZURESQL = [
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_fw_daily_res_sub') CREATE INDEX idx_fw_daily_res_sub ON finops_daily_resource_costs (subscription_id, snapshot_date)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_fw_daily_res_rg') CREATE INDEX idx_fw_daily_res_rg ON finops_daily_resource_costs (resource_group, snapshot_date)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_fw_daily_res_type') CREATE INDEX idx_fw_daily_res_type ON finops_daily_resource_costs (resource_type)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_fw_daily_res_svc') CREATE INDEX idx_fw_daily_res_svc ON finops_daily_resource_costs (service_family, snapshot_date)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_fw_daily_sub_date') CREATE INDEX idx_fw_daily_sub_date ON finops_daily_subscription_costs (snapshot_date)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_fw_monthly_svc_month') CREATE INDEX idx_fw_monthly_svc_month ON finops_monthly_service_costs (billing_month, subscription_id)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_fw_monthly_tag_key') CREATE INDEX idx_fw_monthly_tag_key ON finops_monthly_tag_costs (tag_key, billing_month)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_fw_anomalies_date') CREATE INDEX idx_fw_anomalies_date ON finops_anomalies (detected_date)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_fw_anomalies_sev') CREATE INDEX idx_fw_anomalies_sev ON finops_anomalies (severity, status)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_fw_etl_status') CREATE INDEX idx_fw_etl_status ON finops_etl_runs (status, started_at)",
]


def run_migration():
    provider = get_db_provider()
    print(f"Running FinOps Warehouse schema migration for provider: {provider}")
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
            print(f"  [{i}/6] ✓ {table_name}")
        except Exception as e:
            err = str(e).lower()
            if "already" in err or "exists" in err or "duplicate" in err:
                print(f"  [{i}/6] ⊘ {table_name} (already exists)")
            else:
                print(f"  [{i}/6] ✗ {table_name}: {e}")

    indexes = INDEXES_AZURESQL if is_azure_sql() else INDEXES_SQLITE
    print(f"\nCreating {len(indexes)} indexes…")
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

    if not is_azure_sql():
        conn.commit()
    conn.close()
    print(f"\n✓ FinOps Warehouse migration complete — {created} tables processed")


if __name__ == "__main__":
    run_migration()
