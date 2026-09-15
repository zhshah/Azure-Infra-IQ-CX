"""
Migration 007: Cost Management export ingestion ledger

Bulk cost data is no longer pulled from the Cost Management query API by the web
application. Azure Cost Management writes scheduled exports into ADLS Gen2, and a
background loader reads those files into the FinOps tables. This migration adds the
control tables that make that loader safe to run repeatedly:

  1. finops_export_ledger        — one row per export file actually seen, keyed by
                                   blob path + ETag, so a file is never loaded twice
                                   and a changed file is reloaded as a new version.
  2. finops_export_reconciliation — per publication: source row count and source cost
                                   versus what landed in SQL, so a short load is
                                   detectable instead of silently becoming a gap.

Usage:
    cd backend
    python migrations/007_cost_export_ingestion.py

This migration is IDEMPOTENT - safe to run multiple times.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from services.database import get_raw_connection, is_azure_sql, get_db_provider, create_table_sql

# ── Table DDL ─────────────────────────────────────────────────────────────────

TABLES = [
    # 1. Ingestion ledger. The primary key is a hash of blob path + ETag: the same
    #    file content can therefore only ever be loaded once, while a re-exported
    #    (restated) file arrives as a new row and is reloaded. Azure restates recent
    #    charges, so that second case is normal, not an error.
    """
    CREATE TABLE IF NOT EXISTS finops_export_ledger (
        id                  TEXT PRIMARY KEY,
        blob_path           TEXT NOT NULL,
        etag                TEXT NOT NULL DEFAULT '',
        subscription_id     TEXT NOT NULL DEFAULT '',
        cost_type           TEXT NOT NULL DEFAULT '',
        billing_period      TEXT NOT NULL DEFAULT '',
        export_run          TEXT NOT NULL DEFAULT '',
        manifest_path       TEXT NOT NULL DEFAULT '',
        byte_count          REAL NOT NULL DEFAULT 0,
        source_row_count    INTEGER NOT NULL DEFAULT 0,
        loaded_row_count    INTEGER NOT NULL DEFAULT 0,
        status              TEXT NOT NULL DEFAULT 'pending',
        attempts            INTEGER NOT NULL DEFAULT 0,
        started_at          TEXT NOT NULL DEFAULT '',
        completed_at        TEXT NOT NULL DEFAULT '',
        error_message       TEXT NOT NULL DEFAULT ''
    )
    """,
    # 2. Reconciliation per published (subscription, cost type, billing period).
    #    Publishing without comparing source totals to stored totals is how a
    #    truncated load reaches a dashboard looking like a genuine cost decrease.
    """
    CREATE TABLE IF NOT EXISTS finops_export_reconciliation (
        id                  TEXT PRIMARY KEY,
        subscription_id     TEXT NOT NULL DEFAULT '',
        cost_type           TEXT NOT NULL DEFAULT '',
        billing_period      TEXT NOT NULL DEFAULT '',
        currency            TEXT NOT NULL DEFAULT 'USD',
        source_row_count    INTEGER NOT NULL DEFAULT 0,
        sql_row_count       INTEGER NOT NULL DEFAULT 0,
        source_cost_usd     REAL NOT NULL DEFAULT 0,
        sql_cost_usd        REAL NOT NULL DEFAULT 0,
        difference_usd      REAL NOT NULL DEFAULT 0,
        matched             INTEGER NOT NULL DEFAULT 0,
        reconciled_at       TEXT NOT NULL DEFAULT ''
    )
    """,
]

INDEXES_SQLITE = [
    "CREATE INDEX IF NOT EXISTS idx_fx_ledger_status ON finops_export_ledger (status, billing_period)",
    "CREATE INDEX IF NOT EXISTS idx_fx_ledger_scope ON finops_export_ledger (subscription_id, cost_type, billing_period)",
    "CREATE INDEX IF NOT EXISTS idx_fx_recon_scope ON finops_export_reconciliation (subscription_id, cost_type, billing_period)",
]

INDEXES_AZURESQL = [
    f"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='{name}') {stmt}"
    for name, stmt in [
        ("idx_fx_ledger_status", "CREATE INDEX idx_fx_ledger_status ON finops_export_ledger (status, billing_period)"),
        ("idx_fx_ledger_scope", "CREATE INDEX idx_fx_ledger_scope ON finops_export_ledger (subscription_id, cost_type, billing_period)"),
        ("idx_fx_recon_scope", "CREATE INDEX idx_fx_recon_scope ON finops_export_reconciliation (subscription_id, cost_type, billing_period)"),
    ]
]


def run_migration():
    provider = get_db_provider()
    print(f"Running cost-export ingestion migration for provider: {provider}")
    print("=" * 60)

    conn = get_raw_connection()
    if is_azure_sql():
        conn.autocommit = True
    cursor = conn.cursor()

    import re as _re

    _indexed_by_table = {}
    for idx_sql in INDEXES_SQLITE:
        match = _re.search(r'ON\s+(\w+)\s*\(([^)]+)\)', idx_sql, _re.IGNORECASE)
        if match:
            table = match.group(1).lower()
            columns = {c.strip().lower() for c in match.group(2).split(',')}
            _indexed_by_table.setdefault(table, set()).update(columns)

    created = 0
    for index, ddl in enumerate(TABLES, 1):
        table_name = ddl.strip().split("(")[0].split()[-1]
        try:
            idx_cols = _indexed_by_table.get(table_name.lower(), set())
            sql = create_table_sql(ddl, indexed_cols=idx_cols) if is_azure_sql() else ddl
            cursor.execute(sql)
            created += 1
            print(f"  [{index}/{len(TABLES)}] OK {table_name}")
        except Exception as exc:
            message = str(exc).lower()
            if "already" in message or "exists" in message or "duplicate" in message:
                print(f"  [{index}/{len(TABLES)}] -- {table_name} (already exists)")
            else:
                print(f"  [{index}/{len(TABLES)}] FAIL {table_name}: {exc}")

    indexes = INDEXES_AZURESQL if is_azure_sql() else INDEXES_SQLITE
    print(f"\nCreating {len(indexes)} indexes...")
    ready = 0
    for idx_sql in indexes:
        try:
            cursor.execute(idx_sql)
            ready += 1
        except Exception as exc:
            message = str(exc).lower()
            if "already" in message or "exists" in message or "duplicate" in message:
                ready += 1
            else:
                print(f"  Index warning: {exc}")
    print(f"  {ready}/{len(indexes)} indexes ready")

    if not is_azure_sql():
        conn.commit()
    conn.close()
    print(f"\nCost-export ingestion migration complete - {created} tables processed")


if __name__ == "__main__":
    run_migration()
