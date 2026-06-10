"""
Migration 004: Data Migration from SQLite to Azure SQL Database
Reads all rows from each SQLite table and inserts them into the corresponding Azure SQL table.

Usage:
    cd backend
    python migrations/004_data_migration.py

This migration is SAFE to re-run — it uses INSERT and skips rows that already exist.
"""
import os
import sys
import sqlite3
import json
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from services.database import get_connection, get_raw_connection, is_azure_sql, get_db_provider

# SQLite source path
SQLITE_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "scans.db")

# Tables to migrate (in dependency order — no FK constraints, but good practice)
TABLES_TO_MIGRATE = [
    "scans",
    "resource_metrics",
    "resource_custom_tags",
    "custom_tag_schema",
    "resource_snapshots",
    "ai_analyses",
    "onprem_uploads",
    "onprem_servers",
    "onprem_scan_history",
    "projects",
    "finops_budgets",
    "budget_alerts_log",
    "finops_query_cache",
    "resource_bcdr_metadata",
    "project_resources",
    "agent_executions",
    "agent_artifacts",
    "assessments",
    "assessment_resources",
    "assessment_analysis",
    "assessment_apex_workflow",
    "assessment_reports",
    "bcdr_recommendations",
    "security_findings",
    "security_scans",
]

# Tables that exist only in SQLite (skip — not in Azure SQL schema)
SKIP_TABLES = {"sqlite_sequence", "modernization_opportunities", "onprem_credentials", "projects_legacy"}


def get_sqlite_tables():
    """Get list of tables in SQLite that have data."""
    conn = sqlite3.connect(SQLITE_PATH)
    c = conn.cursor()
    c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = [r[0] for r in c.fetchall()]
    conn.close()
    return tables


def get_azuresql_columns(conn, table_name):
    """Get column info from Azure SQL for a table."""
    c = conn.cursor()
    c.execute(
        "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
        (table_name,)
    )
    return [(r[0], r[1]) for r in c.fetchall()]


def migrate_table(sqlite_conn, azuresql_conn, table_name):
    """Migrate all rows from a SQLite table to Azure SQL."""
    src = sqlite_conn.cursor()

    # Get column names from SQLite
    src.execute(f"PRAGMA table_info([{table_name}])")
    sqlite_cols = [(r[1], r[2]) for r in src.fetchall()]  # (name, type)
    sqlite_col_names = [c[0] for c in sqlite_cols]

    # Get column names from Azure SQL
    azuresql_cols = get_azuresql_columns(azuresql_conn, table_name)
    azuresql_col_names = [c[0] for c in azuresql_cols]
    azuresql_col_types = {c[0].lower(): c[1].lower() for c in azuresql_cols}

    if not azuresql_col_names:
        return 0, f"Table not found in Azure SQL"

    # Find common columns (intersection)
    common_cols = [c for c in sqlite_col_names if c in azuresql_col_names]
    if not common_cols:
        return 0, f"No common columns"

    # Check for IDENTITY columns (auto-increment) — skip those in INSERT
    dst = azuresql_conn.cursor()
    dst.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_NAME = ? AND COLUMNPROPERTY(OBJECT_ID(?), COLUMN_NAME, 'IsIdentity') = 1",
        (table_name, table_name)
    )
    identity_cols = {r[0] for r in dst.fetchall()}

    # Find NOT NULL columns (to skip rows with NULL required values)
    dst.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_NAME = ? AND IS_NULLABLE = 'NO'",
        (table_name,)
    )
    notnull_cols = {r[0] for r in dst.fetchall()}

    # For tables with IDENTITY columns, we need SET IDENTITY_INSERT ON
    has_identity = bool(identity_cols & set(common_cols))
    insert_cols = common_cols  # Include identity cols (we'll use IDENTITY_INSERT)

    # Map column names to their index in insert_cols
    col_idx = {c: i for i, c in enumerate(insert_cols)}

    # Read all source rows
    col_list = ", ".join(f"[{c}]" for c in insert_cols)
    src.execute(f"SELECT {col_list} FROM [{table_name}]")
    rows = src.fetchall()

    if not rows:
        return 0, "empty"

    # Build INSERT statement
    placeholders = ", ".join("?" for _ in insert_cols)
    insert_sql = f"INSERT INTO [{table_name}] ({col_list}) VALUES ({placeholders})"

    # Insert rows one at a time with commit every N rows to avoid connection drops
    commit_every = 50
    inserted = 0
    skipped = 0
    errors = 0

    if has_identity:
        dst.execute(f"SET IDENTITY_INSERT [{table_name}] ON")

    for row_idx, row in enumerate(rows):
        # Skip rows with NULL values in NOT NULL columns
        skip_row = False
        for nn_col in notnull_cols:
            if nn_col in col_idx and row[col_idx[nn_col]] is None:
                skipped += 1
                skip_row = True
                break
        if skip_row:
            continue

        # Convert values for Azure SQL compatibility
        values = []
        for j, val in enumerate(row):
            col_name = insert_cols[j]
            col_type = azuresql_col_types.get(col_name.lower(), "")

            if val is None:
                values.append(None)
            elif col_type == "float" and isinstance(val, str):
                try:
                    values.append(float(val))
                except (ValueError, TypeError):
                    values.append(0.0)
            elif col_type == "int" and isinstance(val, str):
                try:
                    values.append(int(val))
                except (ValueError, TypeError):
                    values.append(0)
            elif col_type == "bit" and isinstance(val, (int, bool)):
                values.append(1 if val else 0)
            else:
                values.append(val)

        try:
            dst.execute(insert_sql, values)
            inserted += 1
        except Exception as e:
            err = str(e).lower()
            if "duplicate" in err or "unique" in err or "primary" in err or "violation" in err:
                skipped += 1
            else:
                errors += 1
                if errors <= 3:
                    print(f"    Error inserting row: {e}")

        # Periodic commit to keep connection alive on Basic tier
        if inserted % commit_every == 0 and inserted > 0:
            azuresql_conn.commit()

    if has_identity:
        try:
            dst.execute(f"SET IDENTITY_INSERT [{table_name}] OFF")
        except Exception:
            pass

    azuresql_conn.commit()

    status = f"{inserted} inserted"
    if skipped:
        status += f", {skipped} skipped"
    if errors:
        status += f", {errors} errors"
    return inserted, status


def run_data_migration():
    if not is_azure_sql():
        print("ERROR: DATABASE_PROVIDER is not set to 'azuresql'")
        print("Set DATABASE_PROVIDER=azuresql and AZURE_SQL_CONNECTION_STRING in .env")
        sys.exit(1)

    if not os.path.exists(SQLITE_PATH):
        print(f"ERROR: SQLite database not found at {SQLITE_PATH}")
        sys.exit(1)

    print(f"Data Migration: SQLite → Azure SQL Database")
    print(f"Source: {SQLITE_PATH}")
    print(f"Target: {get_db_provider()}")
    print("=" * 60)

    sqlite_conn = sqlite3.connect(SQLITE_PATH)
    sqlite_tables = get_sqlite_tables()

    total_rows = 0
    start = time.time()

    for table_name in TABLES_TO_MIGRATE:
        if table_name not in sqlite_tables:
            print(f"  {table_name:30s} → skipped (not in SQLite)")
            continue

        # Check row count in SQLite
        sc = sqlite_conn.cursor()
        sc.execute(f"SELECT COUNT(*) FROM [{table_name}]")
        src_count = sc.fetchone()[0]

        if src_count == 0:
            print(f"  {table_name:30s} → empty")
            continue

        # Use a fresh raw connection per table to avoid transaction rollback issues
        try:
            azuresql_conn = get_raw_connection()
            azuresql_conn.autocommit = False  # We want manual commits for batch inserts
            count, status = migrate_table(sqlite_conn, azuresql_conn, table_name)
            azuresql_conn.commit()
            azuresql_conn.close()
            total_rows += count
            print(f"  {table_name:30s} → {status} (of {src_count} source rows)")
        except Exception as e:
            print(f"  {table_name:30s} → FAILED: {e}")

    # Report any SQLite-only tables
    for t in sqlite_tables:
        if t not in TABLES_TO_MIGRATE and t not in SKIP_TABLES:
            print(f"  {t:30s} → skipped (SQLite-only)")

    sqlite_conn.close()
    elapsed = time.time() - start

    print("=" * 60)
    print(f"✓ Data migration complete")
    print(f"  Total rows migrated: {total_rows}")
    print(f"  Duration: {elapsed:.1f}s")


if __name__ == "__main__":
    run_data_migration()
