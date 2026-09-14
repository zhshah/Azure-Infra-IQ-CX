"""
Migration 008: per-resource tags on the daily resource cost grain

Tags were only stored aggregated by tag key/value per month, so a resource's own
tags were not queryable: "show me every resource tagged env=prod and its daily
cost" had no answer. The export already carries the tags for every charge, so this
adds a column to keep them at the resource/day grain that the UI searches.

The column is nullable and additive - existing rows and readers are unaffected.

Usage:
    cd backend
    python migrations/008_resource_tags.py

This migration is IDEMPOTENT - safe to run multiple times.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from services.database import get_raw_connection, is_azure_sql, get_db_provider


def run_migration():
    print(f"Adding per-resource tags for provider: {get_db_provider()}")
    print("=" * 60)

    conn = get_raw_connection()
    if is_azure_sql():
        conn.autocommit = True
    cursor = conn.cursor()

    if is_azure_sql():
        statements = [
            ("tags column", """
                IF NOT EXISTS (SELECT 1 FROM sys.columns
                               WHERE object_id = OBJECT_ID('dbo.finops_daily_resource_costs')
                                 AND name = 'tags')
                ALTER TABLE dbo.finops_daily_resource_costs ADD tags nvarchar(2000) NULL
            """),
            ("tag search index", """
                IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_frc_sub_date')
                CREATE INDEX idx_frc_sub_date
                    ON dbo.finops_daily_resource_costs (subscription_id, snapshot_date)
                    INCLUDE (resource_id, resource_group, resource_type, location, cost_usd)
            """),
        ]
    else:
        statements = [
            ("tags column", "ALTER TABLE finops_daily_resource_costs ADD COLUMN tags TEXT"),
            ("tag search index",
             "CREATE INDEX IF NOT EXISTS idx_frc_sub_date "
             "ON finops_daily_resource_costs (subscription_id, snapshot_date)"),
        ]

    for label, sql in statements:
        try:
            cursor.execute(sql)
            print(f"  OK {label}")
        except Exception as exc:
            message = str(exc).lower()
            if "duplicate" in message or "already exists" in message:
                print(f"  -- {label} (already present)")
            else:
                print(f"  FAIL {label}: {exc}")

    if not is_azure_sql():
        conn.commit()
    conn.close()
    print("\nPer-resource tag migration complete")


if __name__ == "__main__":
    run_migration()
