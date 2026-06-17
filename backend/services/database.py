"""
Database abstraction layer — supports SQLite (default) and Azure SQL Database.

Usage
-----
    from services.database import get_connection, get_db_provider

    # Context manager (recommended for short-lived operations)
    with get_connection() as conn:
        conn.execute("SELECT * FROM scans WHERE id = ?", (scan_id,))
        rows = conn.fetchall()

    # Direct connection (for long-lived operations)
    conn = get_connection(as_context=False)
    try:
        conn.execute(...)
        conn.commit()
    finally:
        conn.close()

Configuration
-------------
Set via environment variables:
    DATABASE_PROVIDER=sqlite              (default — no config needed)
    DATABASE_PROVIDER=azuresql            (requires connection string below)
    AZURE_SQL_CONNECTION_STRING=Driver={ODBC Driver 18 for SQL Server};Server=tcp:myserver.database.windows.net,1433;Database=mydb;Uid=myuser;Pwd=mypass;Encrypt=yes;TrustServerCertificate=no;Connection Timeout=30;
"""
from __future__ import annotations

import logging
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

_DB_PROVIDER: str = os.environ.get("DATABASE_PROVIDER", "sqlite").lower().strip()

# SQLite path (used when provider=sqlite)
_DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).parent.parent / "data"))
_SQLITE_PATH = _DATA_DIR / "scans.db"

# Azure SQL (used when provider=azuresql)
_AZURE_SQL_CONN_STR: str = os.environ.get("AZURE_SQL_CONNECTION_STRING", "")

# Module-level flag for quick checks
_pyodbc_available: bool = False
try:
    import pyodbc
    _pyodbc_available = True
except ImportError:
    pass


def get_db_provider() -> str:
    """Return the active database provider: 'sqlite' or 'azuresql'."""
    return _DB_PROVIDER


def is_azure_sql() -> bool:
    """Return True if the active provider is Azure SQL Database."""
    return _DB_PROVIDER == "azuresql"


# ── SQLite helpers ────────────────────────────────────────────────────────────

def _sqlite_connect() -> sqlite3.Connection:
    """Open a SQLite connection with WAL mode for concurrency."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_SQLITE_PATH), check_same_thread=False, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


# ── Azure SQL helpers ─────────────────────────────────────────────────────────

_azuresql_pool_initialized: bool = False


def _azuresql_connect():
    """Open a pyodbc connection to Azure SQL Database."""
    global _azuresql_pool_initialized
    if not _pyodbc_available:
        raise RuntimeError(
            "pyodbc is not installed. Run: pip install pyodbc\n"
            "Also install the ODBC Driver 18 for SQL Server."
        )
    if not _AZURE_SQL_CONN_STR:
        raise RuntimeError(
            "AZURE_SQL_CONNECTION_STRING is not set. Example:\n"
            "Driver={ODBC Driver 18 for SQL Server};Server=tcp:myserver.database.windows.net,1433;"
            "Database=mydb;Uid=myuser;Pwd=mypass;Encrypt=yes;TrustServerCertificate=no;"
        )
    if not _azuresql_pool_initialized:
        # Enable pyodbc connection pooling (process-wide, one-time)
        pyodbc.pooling = True
        _azuresql_pool_initialized = True

    conn = pyodbc.connect(_AZURE_SQL_CONN_STR, timeout=30)
    conn.autocommit = False
    return conn


# ── Unified connection factory ────────────────────────────────────────────────

@contextmanager
def get_connection():
    """
    Get a database connection as a context manager.
    Auto-commits on success, rolls back on exception, always closes.
    """
    if _DB_PROVIDER == "azuresql":
        conn = _azuresql_connect()
    else:
        conn = _sqlite_connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        conn.close()


def get_raw_connection():
    """
    Get a raw database connection (caller manages commit/close).
    Use this for long-lived operations or when you need explicit control.
    """
    if _DB_PROVIDER == "azuresql":
        return _azuresql_connect()
    else:
        return _sqlite_connect()


# ── SQL dialect helpers ───────────────────────────────────────────────────────

def upsert_sql(table: str, pk_cols: list, value_cols: list) -> str:
    """
    Generate an upsert statement compatible with both SQLite and Azure SQL.

    SQLite uses INSERT OR REPLACE.
    Azure SQL uses MERGE.
    """
    all_cols = pk_cols + value_cols
    placeholders = ", ".join("?" for _ in all_cols)
    col_names = ", ".join(all_cols)

    if _DB_PROVIDER == "azuresql":
        # MERGE statement for Azure SQL
        pk_match = " AND ".join(f"target.{c} = source.{c}" for c in pk_cols)
        update_set = ", ".join(f"target.{c} = source.{c}" for c in value_cols) if value_cols else "target.{} = source.{}".format(pk_cols[0], pk_cols[0])
        source_cols = ", ".join(f"? AS {c}" for c in all_cols)

        return (
            f"MERGE {table} AS target "
            f"USING (SELECT {source_cols}) AS source "
            f"ON ({pk_match}) "
            f"WHEN MATCHED THEN UPDATE SET {update_set} "
            f"WHEN NOT MATCHED THEN INSERT ({col_names}) VALUES ({', '.join('source.' + c for c in all_cols)});"
        )
    else:
        # SQLite INSERT OR REPLACE
        return f"INSERT OR REPLACE INTO {table} ({col_names}) VALUES ({placeholders})"


def insert_ignore_sql(table: str, columns: list) -> str:
    """
    Generate INSERT-if-not-exists statement compatible with both databases.
    """
    col_names = ", ".join(columns)
    placeholders = ", ".join("?" for _ in columns)

    if _DB_PROVIDER == "azuresql":
        # Use WHERE NOT EXISTS for Azure SQL
        pk = columns[0]  # assumes first column is the PK
        return (
            f"IF NOT EXISTS (SELECT 1 FROM {table} WHERE {pk} = ?) "
            f"INSERT INTO {table} ({col_names}) VALUES ({placeholders})"
        )
    else:
        return f"INSERT OR IGNORE INTO {table} ({col_names}) VALUES ({placeholders})"


def limit_sql(query: str, n: int) -> str:
    """
    Apply a row limit to a SELECT query for both databases.
    For SQLite: appends LIMIT N
    For Azure SQL: uses TOP N (must be placed after SELECT)
    """
    if _DB_PROVIDER == "azuresql":
        # Replace 'SELECT ' with 'SELECT TOP N '
        if query.strip().upper().startswith("SELECT "):
            return query.replace("SELECT ", f"SELECT TOP {n} ", 1)
        return query  # can't transform; return as-is
    else:
        return f"{query} LIMIT {n}"


def upsert_conflict_sql(table: str, insert_cols: list, pk_cols: list,
                         update_cols: list, update_exprs: Optional[dict] = None) -> str:
    """
    Generate an upsert (INSERT ... ON CONFLICT DO UPDATE) compatible with both dialects.

    Args:
        table: Table name
        insert_cols: All columns in the INSERT (order matters for ? params)
        pk_cols: Primary key / conflict columns
        update_cols: Columns to update on conflict (using 'excluded.' values in SQLite,
                     source values in Azure SQL MERGE)
        update_exprs: Optional dict of {col: sql_expression} for update columns
                      that should use a literal SQL expression instead of the
                      incoming value (e.g. {'started_at': 'CURRENT_TIMESTAMP'}).
                      If not given, updates use the inserted value.

    Returns SQL string with ? placeholders. Pass the parameter list ONCE —
    the ? markers appear only in the USING SELECT clause (one per insert_col).
    """
    col_names = ", ".join(insert_cols)
    placeholders = ", ".join("?" for _ in insert_cols)
    update_exprs = update_exprs or {}

    if _DB_PROVIDER == "azuresql":
        # MERGE statement
        source_cols = ", ".join(f"? AS [{c}]" for c in insert_cols)
        pk_match = " AND ".join(f"target.[{c}] = source.[{c}]" for c in pk_cols)

        update_parts = []
        for c in update_cols:
            if c in update_exprs:
                update_parts.append(f"target.[{c}] = {update_exprs[c]}")
            else:
                update_parts.append(f"target.[{c}] = source.[{c}]")
        update_set = ", ".join(update_parts)

        insert_values = ", ".join(f"source.[{c}]" for c in insert_cols)

        return (
            f"MERGE [{table}] AS target "
            f"USING (SELECT {source_cols}) AS source "
            f"ON ({pk_match}) "
            f"WHEN MATCHED THEN UPDATE SET {update_set} "
            f"WHEN NOT MATCHED THEN INSERT ({col_names}) VALUES ({insert_values});"
        )
    else:
        # SQLite ON CONFLICT ... DO UPDATE
        conflict_cols = ", ".join(pk_cols)
        update_parts = []
        for c in update_cols:
            if c in update_exprs:
                update_parts.append(f"{c} = {update_exprs[c]}")
            else:
                update_parts.append(f"{c} = excluded.{c}")
        update_set = ", ".join(update_parts)

        return (
            f"INSERT INTO {table} ({col_names}) VALUES ({placeholders}) "
            f"ON CONFLICT({conflict_cols}) DO UPDATE SET {update_set}"
        )


def now_utc_sql() -> str:
    """Return the SQL expression for current UTC timestamp."""
    if _DB_PROVIDER == "azuresql":
        return "GETUTCDATE()"
    else:
        return "datetime('now')"


def table_exists_sql(table_name: str) -> str:
    """Return a query that checks if a table exists."""
    if _DB_PROVIDER == "azuresql":
        return (
            f"SELECT 1 FROM INFORMATION_SCHEMA.TABLES "
            f"WHERE TABLE_NAME = '{table_name}'"
        )
    else:
        return (
            f"SELECT 1 FROM sqlite_master "
            f"WHERE type='table' AND name='{table_name}'"
        )


# ── Schema creation helpers ──────────────────────────────────────────────────

def create_table_sql(sqlite_ddl: str, indexed_cols: Optional[set] = None) -> str:
    """
    Convert a SQLite CREATE TABLE statement to the appropriate dialect.
    For SQLite: returns as-is.
    For Azure SQL: translates types and syntax.

    indexed_cols: optional set of column names that will be indexed (need NVARCHAR(450)).
    """
    if _DB_PROVIDER != "azuresql":
        return sqlite_ddl

    import re

    sql = sqlite_ddl
    _indexed = set(c.lower() for c in (indexed_cols or []))

    # Type translations
    sql = sql.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "INT IDENTITY(1,1) PRIMARY KEY")
    sql = sql.replace("AUTOINCREMENT", "")  # catch any remaining

    # BOOLEAN → BIT
    sql = re.sub(r'\bBOOLEAN\b', 'BIT', sql, flags=re.IGNORECASE)

    # REAL → FLOAT
    sql = re.sub(r'\bREAL\b', 'FLOAT', sql, flags=re.IGNORECASE)

    # ── Smart TEXT → NVARCHAR conversion ──────────────────────────────────
    # Columns used as PKs or in indexes need NVARCHAR(450), not MAX.
    key_cols = set(_indexed)

    # Single-column TEXT PRIMARY KEY: "col TEXT PRIMARY KEY"
    for m in re.finditer(r'(\w+)\s+TEXT\s+(?:NOT\s+NULL\s+)?PRIMARY\s+KEY', sql, re.IGNORECASE):
        key_cols.add(m.group(1).lower())

    # Composite PRIMARY KEY (col1, col2, ...)
    pk_match = re.search(r'PRIMARY\s+KEY\s*\(([^)]+)\)', sql, re.IGNORECASE)
    if pk_match:
        for col in pk_match.group(1).split(','):
            key_cols.add(col.strip().lower())

    # Parse all column definitions: "col_name TEXT ..."
    # Build a list of (col_name, start_of_TEXT, end_of_TEXT) tuples
    replacements = []
    for m in re.finditer(r'(\w+)\s+(TEXT)\b', sql, re.IGNORECASE):
        col_name = m.group(1).lower()
        if col_name in ('create', 'table', 'if', 'not', 'exists', 'primary', 'key',
                         'default', 'select', 'from', 'where', 'insert', 'into', 'set'):
            continue  # skip SQL keywords
        nvarchar = 'NVARCHAR(450)' if col_name in key_cols else 'NVARCHAR(MAX)'
        replacements.append((m.start(2), m.end(2), nvarchar))

    # Apply replacements in reverse order to preserve positions
    for start, end, nvarchar in reversed(replacements):
        sql = sql[:start] + nvarchar + sql[end:]

    # TIMESTAMP DEFAULT CURRENT_TIMESTAMP → DATETIME2 DEFAULT GETUTCDATE()
    sql = sql.replace("TIMESTAMP DEFAULT CURRENT_TIMESTAMP", "DATETIME2 DEFAULT GETUTCDATE()")
    sql = sql.replace("DEFAULT CURRENT_TIMESTAMP", "DEFAULT GETUTCDATE()")

    # datetime('now') → GETUTCDATE()
    sql = sql.replace("datetime('now')", "GETUTCDATE()")

    # CREATE TABLE IF NOT EXISTS → check + CREATE TABLE
    if "IF NOT EXISTS" in sql.upper():
        # Extract table name for the existence check
        match = re.search(r'CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)', sql, re.IGNORECASE)
        if match:
            tbl = match.group(1)
            sql = sql.replace(f"IF NOT EXISTS {tbl}", tbl, 1).replace(f"IF NOT EXISTS", "", 1)
            sql = (
                f"IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '{tbl}') "
                f"BEGIN {sql} END"
            )

    return sql


# ── Init function ─────────────────────────────────────────────────────────────

_initialized = False


def init_db():
    """
    Initialize the database (create tables if needed).
    Called once at startup. For SQLite, tables are created via individual
    service _conn() calls. For Azure SQL, this ensures basic connectivity.
    """
    global _initialized
    if _initialized:
        return

    if _DB_PROVIDER == "azuresql":
        if not _pyodbc_available:
            logger.error("DATABASE_PROVIDER=azuresql but pyodbc is not installed")
            raise RuntimeError("pyodbc is required for Azure SQL. Run: pip install pyodbc")
        if not _AZURE_SQL_CONN_STR:
            logger.error("DATABASE_PROVIDER=azuresql but AZURE_SQL_CONNECTION_STRING is not set")
            raise RuntimeError("AZURE_SQL_CONNECTION_STRING must be set for Azure SQL")
        # Test connectivity
        try:
            conn = _azuresql_connect()
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            conn.close()
            logger.info("Azure SQL Database connection verified ✓")
        except Exception as e:
            logger.error("Azure SQL Database connection failed: %s", e)
            raise
    else:
        # SQLite — just ensure the data directory exists
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        logger.info("SQLite database at %s", _SQLITE_PATH)

    _initialized = True


def get_db_info() -> dict:
    """Return current database configuration info (safe for logging/API)."""
    if _DB_PROVIDER == "azuresql":
        # Mask the connection string (don't expose passwords)
        masked = _AZURE_SQL_CONN_STR
        if "Pwd=" in masked:
            import re
            masked = re.sub(r'Pwd=[^;]*', 'Pwd=***', masked)
        if "Password=" in masked:
            import re
            masked = re.sub(r'Password=[^;]*', 'Password=***', masked)
        return {
            "provider": "azuresql",
            "connection": masked,
            "pyodbc_available": _pyodbc_available,
        }
    else:
        return {
            "provider": "sqlite",
            "path": str(_SQLITE_PATH),
            "exists": _SQLITE_PATH.exists(),
        }
