"""
Migrate data from SQLite to Azure SQL Database.

This tool reads all rows from each table in the local SQLite database
and inserts them into the Azure SQL Database. It is designed to be run
once as a one-time data migration.

Prerequisites:
  1. Azure SQL Database is reachable and schema exists (run 003_azure_sql_schema.py first)
  2. Environment variables set:
     - DATABASE_PROVIDER=azuresql
     - AZURE_SQL_CONNECTION_STRING=...

Usage:
    cd backend
    python migrations/migrate_sqlite_to_azuresql.py [--dry-run] [--batch-size 500]
"""
import argparse
import os
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


def get_sqlite_path() -> str:
    data_dir = Path(os.environ.get("DATA_DIR", Path(__file__).parent.parent / "data"))
    return str(data_dir / "scans.db")


def get_azuresql_connection():
    import pyodbc
    conn_str = os.environ.get("AZURE_SQL_CONNECTION_STRING", "")
    if not conn_str:
        raise RuntimeError("AZURE_SQL_CONNECTION_STRING not set")
    return pyodbc.connect(conn_str, timeout=30)


TABLES = [
    "scans",
    "resource_metrics",
    "resource_custom_tags",
    "custom_tag_schema",
    "resource_snapshots",
    "ai_analyses",
    "onprem_uploads",
    "onprem_servers",
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
]

# Tables with IDENTITY columns (skip the PK in INSERT)
IDENTITY_TABLES = {
    "scans": "id",
    "resource_snapshots": "id",
    "ai_analyses": "id",
    "bcdr_recommendations": "id",
}


def migrate(dry_run: bool = False, batch_size: int = 500):
    sqlite_path = get_sqlite_path()
    if not Path(sqlite_path).exists():
        print(f"✗ SQLite database not found: {sqlite_path}")
        return

    src = sqlite3.connect(sqlite_path)
    src.row_factory = sqlite3.Row
    print(f"Source: SQLite @ {sqlite_path}")

    if dry_run:
        print("Mode: DRY RUN (no data will be written)\n")
        dst = None
    else:
        dst = get_azuresql_connection()
        dst.autocommit = False
        # Mask connection string for display
        conn_str = os.environ.get("AZURE_SQL_CONNECTION_STRING", "")
        import re
        masked = re.sub(r'(Pwd|Password)=[^;]*', r'\1=***', conn_str)
        print(f"Destination: Azure SQL @ {masked}\n")

    total_rows = 0
    total_skipped = 0
    total_errors = 0
    start_time = time.time()

    for table in TABLES:
        # Check if table exists in SQLite
        check = src.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            (table,)
        ).fetchone()
        if not check:
            print(f"  ⊘ {table:30s} — not in SQLite (skipped)")
            continue

        # Get all rows
        rows = src.execute(f"SELECT * FROM {table}").fetchall()  # nosec - table name from hardcoded list
        if not rows:
            print(f"  ⊘ {table:30s} — 0 rows (empty)")
            continue

        # Get column names
        all_columns = [desc[0] for desc in rows[0].keys()] if hasattr(rows[0], 'keys') else []
        if not all_columns:
            cursor_desc = src.execute(f"SELECT * FROM {table} LIMIT 1")  # nosec
            all_columns = [d[0] for d in cursor_desc.description]

        # For IDENTITY tables, skip the auto-increment column
        identity_col = IDENTITY_TABLES.get(table)
        if identity_col and identity_col in all_columns:
            columns = [c for c in all_columns if c != identity_col]
        else:
            columns = all_columns

        col_names = ", ".join(columns)
        placeholders = ", ".join("?" for _ in columns)
        insert_sql = f"INSERT INTO {table} ({col_names}) VALUES ({placeholders})"

        migrated = 0
        skipped = 0
        errors = 0

        if not dry_run and identity_col:
            try:
                dst.execute(f"SET IDENTITY_INSERT {table} OFF")
            except Exception:
                pass

        # Process in batches
        for batch_start in range(0, len(rows), batch_size):
            batch = rows[batch_start:batch_start + batch_size]

            for row in batch:
                row_dict = dict(row)
                values = tuple(row_dict.get(c) for c in columns)

                if dry_run:
                    migrated += 1
                    continue

                try:
                    dst.execute(insert_sql, values)
                    migrated += 1
                except Exception as e:
                    err_str = str(e).lower()
                    if "duplicate" in err_str or "unique" in err_str or "violation" in err_str or "primary" in err_str:
                        skipped += 1
                    else:
                        errors += 1
                        if errors <= 3:
                            print(f"    Error in {table}: {e}")

            if not dry_run:
                try:
                    dst.commit()
                except Exception as e:
                    print(f"    Commit error in {table}: {e}")
                    errors += len(batch)

        status = "✓" if errors == 0 else "⚠"
        skip_info = f" ({skipped} duplicates skipped)" if skipped else ""
        err_info = f" ({errors} errors)" if errors else ""
        print(f"  {status} {table:30s} — {migrated} rows{skip_info}{err_info}")

        total_rows += migrated
        total_skipped += skipped
        total_errors += errors

    elapsed = time.time() - start_time
    src.close()
    if dst:
        dst.close()

    print(f"\n{'DRY RUN ' if dry_run else ''}Migration complete")
    print(f"  Total rows: {total_rows}")
    print(f"  Duplicates skipped: {total_skipped}")
    print(f"  Errors: {total_errors}")
    print(f"  Time: {elapsed:.1f}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate SQLite to Azure SQL")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--batch-size", type=int, default=500, help="Rows per commit")
    args = parser.parse_args()
    migrate(dry_run=args.dry_run, batch_size=args.batch_size)
