"""
Migration 003: Azure SQL Database Schema
Creates all 24 tables in Azure SQL Database with proper T-SQL types.
Also works with SQLite (uses CREATE TABLE IF NOT EXISTS).

Usage:
    cd backend
    python migrations/003_azure_sql_schema.py

This migration is IDEMPOTENT — safe to run multiple times.
"""
import os
import sys

# Add parent to path so we can import services
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from services.database import get_connection, is_azure_sql, get_db_provider, create_table_sql


# ── All table DDL (written in SQLite syntax, auto-translated for Azure SQL) ──

TABLES = [
    # 1. scans — full dashboard snapshots
    """
    CREATE TABLE IF NOT EXISTS scans (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        saved_at        TEXT NOT NULL,
        resource_count  INTEGER DEFAULT 0,
        payload         TEXT NOT NULL
    )
    """,

    # 2. resource_metrics — per-resource Azure Monitor cache
    """
    CREATE TABLE IF NOT EXISTS resource_metrics (
        resource_id     TEXT PRIMARY KEY,
        updated_at      TEXT NOT NULL,
        payload         TEXT NOT NULL
    )
    """,

    # 3. resource_custom_tags — user-applied tags
    """
    CREATE TABLE IF NOT EXISTS resource_custom_tags (
        resource_id     TEXT NOT NULL,
        tag_key         TEXT NOT NULL,
        tag_value       TEXT NOT NULL DEFAULT '',
        source          TEXT NOT NULL DEFAULT 'user',
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        PRIMARY KEY (resource_id, tag_key)
    )
    """,

    # 4. custom_tag_schema — tag definitions
    """
    CREATE TABLE IF NOT EXISTS custom_tag_schema (
        tag_key         TEXT PRIMARY KEY,
        display_name    TEXT NOT NULL,
        tag_type        TEXT DEFAULT 'text',
        enum_values     TEXT DEFAULT '[]',
        category        TEXT DEFAULT 'Custom',
        is_required     INTEGER DEFAULT 0,
        color           TEXT DEFAULT '#6b7280',
        created_at      TEXT NOT NULL
    )
    """,

    # 5. resource_snapshots — resource state history
    """
    CREATE TABLE IF NOT EXISTS resource_snapshots (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        resource_id     TEXT NOT NULL,
        captured_at     TEXT NOT NULL,
        sku             TEXT,
        location        TEXT,
        tags            TEXT,
        config          TEXT,
        status          TEXT,
        change_type     TEXT DEFAULT 'snapshot'
    )
    """,

    # 6. ai_analyses — AI analysis cache
    """
    CREATE TABLE IF NOT EXISTS ai_analyses (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        analysis_type   TEXT NOT NULL,
        subject_id      TEXT,
        analyzed_at     TEXT NOT NULL,
        model           TEXT NOT NULL,
        prompt_tokens   INTEGER DEFAULT 0,
        result          TEXT NOT NULL
    )
    """,

    # 7. onprem_uploads — on-premises batch tracking
    """
    CREATE TABLE IF NOT EXISTS onprem_uploads (
        batch_id        TEXT PRIMARY KEY,
        uploaded_at     TEXT NOT NULL,
        server_count    INTEGER DEFAULT 0,
        filename        TEXT DEFAULT '',
        status          TEXT DEFAULT 'completed',
        warnings        TEXT DEFAULT '[]',
        errors          TEXT DEFAULT '[]'
    )
    """,

    # 8. onprem_servers — on-premises server data
    """
    CREATE TABLE IF NOT EXISTS onprem_servers (
        server_id       TEXT PRIMARY KEY,
        hostname        TEXT NOT NULL,
        batch_id        TEXT NOT NULL,
        collected_at    TEXT NOT NULL,
        workload_type   TEXT DEFAULT '',
        payload         TEXT NOT NULL
    )
    """,

    # 9. projects — user-saved resource groups
    """
    CREATE TABLE IF NOT EXISTS projects (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        description     TEXT DEFAULT '',
        resource_ids    TEXT NOT NULL DEFAULT '[]',
        color           TEXT DEFAULT '#3b82f6',
        icon            TEXT DEFAULT '📁',
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
    )
    """,

    # 10. finops_budgets — budget definitions
    """
    CREATE TABLE IF NOT EXISTS finops_budgets (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        source          TEXT DEFAULT 'custom',
        scope_type      TEXT DEFAULT 'subscription',
        scope_id        TEXT DEFAULT '',
        amount_usd      REAL DEFAULT 0,
        period          TEXT DEFAULT 'Monthly',
        start_date      TEXT DEFAULT '',
        alert_thresholds TEXT DEFAULT '[50,75,90,100]',
        owner_email     TEXT DEFAULT '',
        cost_center     TEXT DEFAULT '',
        tag_filters     TEXT DEFAULT '{}',
        created_at      TEXT DEFAULT '',
        updated_at      TEXT DEFAULT ''
    )
    """,

    # 11. budget_alerts_log — alert history
    """
    CREATE TABLE IF NOT EXISTS budget_alerts_log (
        id              TEXT PRIMARY KEY,
        budget_id       TEXT NOT NULL,
        budget_name     TEXT DEFAULT '',
        threshold_pct   REAL,
        triggered_at    TEXT,
        actual_usd      REAL DEFAULT 0,
        budgeted_usd    REAL DEFAULT 0,
        severity        TEXT DEFAULT 'warning'
    )
    """,

    # 12. finops_query_cache — cost API cache
    """
    CREATE TABLE IF NOT EXISTS finops_query_cache (
        cache_key       TEXT PRIMARY KEY,
        data_json       TEXT NOT NULL,
        expires_at      REAL NOT NULL,
        created_at      REAL NOT NULL
    )
    """,

    # 13. resource_bcdr_metadata — BCDR categorization
    """
    CREATE TABLE IF NOT EXISTS resource_bcdr_metadata (
        resource_id     TEXT PRIMARY KEY,
        criticality     TEXT,
        dr_tier         TEXT,
        rto_target      TEXT,
        rpo_target      TEXT,
        business_function TEXT,
        notes           TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
    )
    """,

    # 14. project_resources — M:N mapping (APEX)
    """
    CREATE TABLE IF NOT EXISTS project_resources (
        project_id      TEXT NOT NULL,
        resource_id     TEXT NOT NULL,
        role            TEXT,
        PRIMARY KEY (project_id, resource_id)
    )
    """,

    # 15. agent_executions — APEX agent runs
    """
    CREATE TABLE IF NOT EXISTS agent_executions (
        execution_id    TEXT PRIMARY KEY,
        project_id      TEXT,
        assessment_id   TEXT,
        agent_name      TEXT,
        status          TEXT,
        input_data      TEXT,
        output_data     TEXT,
        artifacts       TEXT,
        error_message   TEXT,
        started_at      TEXT,
        completed_at    TEXT
    )
    """,

    # 16. agent_artifacts — APEX outputs
    """
    CREATE TABLE IF NOT EXISTS agent_artifacts (
        artifact_id     TEXT PRIMARY KEY,
        execution_id    TEXT,
        artifact_type   TEXT,
        file_name       TEXT,
        content         TEXT,
        created_at      TEXT
    )
    """,

    # 17. assessments — assessment workflow
    """
    CREATE TABLE IF NOT EXISTS assessments (
        assessment_id   TEXT PRIMARY KEY,
        assessment_name TEXT NOT NULL,
        assessment_type TEXT NOT NULL,
        service_type    TEXT,
        scope_type      TEXT,
        scope_value     TEXT,
        description     TEXT,
        business_unit   TEXT,
        owner           TEXT,
        status          TEXT DEFAULT 'draft',
        current_step    INTEGER DEFAULT 1,
        created_at      TEXT DEFAULT '',
        updated_at      TEXT DEFAULT '',
        completed_at    TEXT
    )
    """,

    # 18. assessment_resources — scoped resources
    """
    CREATE TABLE IF NOT EXISTS assessment_resources (
        assessment_id   TEXT NOT NULL,
        resource_id     TEXT NOT NULL,
        resource_name   TEXT,
        resource_type   TEXT,
        location        TEXT,
        resource_group  TEXT,
        subscription_id TEXT,
        tags            TEXT,
        selected        INTEGER DEFAULT 1,
        resource_metadata TEXT,
        PRIMARY KEY (assessment_id, resource_id)
    )
    """,

    # 19. assessment_analysis — AI analysis results
    """
    CREATE TABLE IF NOT EXISTS assessment_analysis (
        analysis_id     TEXT PRIMARY KEY,
        assessment_id   TEXT NOT NULL,
        analysis_type   TEXT NOT NULL,
        overall_score   INTEGER,
        findings        TEXT,
        recommendations TEXT,
        critical_gaps   TEXT,
        warnings        TEXT,
        opportunities   TEXT,
        metadata        TEXT,
        created_at      TEXT DEFAULT ''
    )
    """,

    # 20. assessment_apex_workflow — APEX orchestration
    """
    CREATE TABLE IF NOT EXISTS assessment_apex_workflow (
        workflow_id     TEXT PRIMARY KEY,
        assessment_id   TEXT NOT NULL,
        agent_sequence  TEXT NOT NULL,
        current_agent_index INTEGER DEFAULT 0,
        agents_completed TEXT,
        agents_failed   TEXT,
        status          TEXT DEFAULT 'pending',
        started_at      TEXT,
        completed_at    TEXT
    )
    """,

    # 21. assessment_reports — generated reports
    """
    CREATE TABLE IF NOT EXISTS assessment_reports (
        report_id       TEXT PRIMARY KEY,
        assessment_id   TEXT NOT NULL,
        report_type     TEXT DEFAULT 'comprehensive',
        title           TEXT,
        summary         TEXT,
        executive_summary TEXT,
        findings_summary TEXT,
        recommendations_summary TEXT,
        cost_analysis   TEXT,
        architecture_diagrams TEXT,
        iac_artifacts   TEXT,
        documentation   TEXT,
        score_breakdown TEXT,
        generated_at    TEXT DEFAULT ''
    )
    """,

    # 22. bcdr_recommendations (APEX) — not always used
    """
    CREATE TABLE IF NOT EXISTS bcdr_recommendations (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id      TEXT,
        resource_id     TEXT,
        recommendation_type TEXT,
        priority        TEXT,
        description     TEXT,
        estimated_cost  REAL DEFAULT 0,
        created_at      TEXT DEFAULT ''
    )
    """,

    # 23. security_findings — persisted security findings (all sources)
    """
    CREATE TABLE IF NOT EXISTS security_findings (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        finding_id      TEXT NOT NULL,
        scan_id         TEXT NOT NULL,
        source          TEXT NOT NULL DEFAULT 'internal',
        severity        TEXT NOT NULL DEFAULT 'medium',
        title           TEXT NOT NULL,
        description     TEXT DEFAULT '',
        category        TEXT DEFAULT '',
        resource_id     TEXT DEFAULT '',
        resource_name   TEXT DEFAULT '',
        resource_type   TEXT DEFAULT '',
        resource_group  TEXT DEFAULT '',
        subscription_id TEXT DEFAULT '',
        remediation     TEXT DEFAULT '',
        threats         TEXT DEFAULT '',
        status          TEXT DEFAULT 'active',
        monthly_risk_usd REAL DEFAULT 0,
        implementation_effort TEXT DEFAULT '',
        metadata        TEXT DEFAULT '{}',
        detected_at     TEXT NOT NULL,
        resolved_at     TEXT
    )
    """,

    # 24. security_scans — scan history for security findings
    """
    CREATE TABLE IF NOT EXISTS security_scans (
        scan_id         TEXT PRIMARY KEY,
        scan_type       TEXT NOT NULL DEFAULT 'full',
        started_at      TEXT NOT NULL,
        completed_at    TEXT,
        total_findings  INTEGER DEFAULT 0,
        critical_count  INTEGER DEFAULT 0,
        high_count      INTEGER DEFAULT 0,
        medium_count    INTEGER DEFAULT 0,
        low_count       INTEGER DEFAULT 0,
        sources         TEXT DEFAULT '[]',
        status          TEXT DEFAULT 'completed'
    )
    """,

    # 25. onprem_scan_history — scan history for on-premises servers
    """
    CREATE TABLE IF NOT EXISTS onprem_scan_history (
        id              TEXT PRIMARY KEY,
        server_id       TEXT NOT NULL,
        batch_id        TEXT,
        collected_at    TEXT,
        modules_collected INTEGER DEFAULT 0,
        modules_failed  INTEGER DEFAULT 0,
        duration_sec    REAL DEFAULT 0,
        payload_summary TEXT DEFAULT '{}'
    )
    """,

    # 26. cost_snapshots — periodically-captured cost bundle (daily background job)
    """
    CREATE TABLE IF NOT EXISTS cost_snapshots (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        captured_at     TEXT NOT NULL,
        subscription_key TEXT NOT NULL DEFAULT '',
        payload         TEXT NOT NULL
    )
    """,
]

# ── Indexes ──────────────────────────────────────────────────────────────────

INDEXES_SQLITE = [
    "CREATE INDEX IF NOT EXISTS idx_snapshots_resource ON resource_snapshots (resource_id)",
    "CREATE INDEX IF NOT EXISTS idx_snapshots_captured ON resource_snapshots (captured_at)",
    "CREATE INDEX IF NOT EXISTS idx_ai_type_subject ON ai_analyses (analysis_type, subject_id)",
    "CREATE INDEX IF NOT EXISTS idx_onprem_batch ON onprem_servers (batch_id)",
    "CREATE INDEX IF NOT EXISTS idx_onprem_host ON onprem_servers (hostname)",
    "CREATE INDEX IF NOT EXISTS idx_onprem_scanhistory_server ON onprem_scan_history (server_id)",
    "CREATE INDEX IF NOT EXISTS idx_agent_executions_assessment ON agent_executions (assessment_id)",
    "CREATE INDEX IF NOT EXISTS idx_assessments_status ON assessments (status)",
    "CREATE INDEX IF NOT EXISTS idx_assessments_type ON assessments (assessment_type)",
    "CREATE INDEX IF NOT EXISTS idx_assessment_resources_type ON assessment_resources (resource_type)",
    "CREATE INDEX IF NOT EXISTS idx_assessment_analysis_type ON assessment_analysis (analysis_type)",
    "CREATE INDEX IF NOT EXISTS idx_security_findings_scan ON security_findings (scan_id)",
    "CREATE INDEX IF NOT EXISTS idx_security_findings_severity ON security_findings (severity)",
    "CREATE INDEX IF NOT EXISTS idx_security_findings_source ON security_findings (source)",
    "CREATE INDEX IF NOT EXISTS idx_security_findings_resource ON security_findings (resource_id)",
    "CREATE INDEX IF NOT EXISTS idx_security_findings_status ON security_findings (status)",
    "CREATE INDEX IF NOT EXISTS idx_security_findings_finding_id ON security_findings (finding_id)",
    "CREATE INDEX IF NOT EXISTS idx_onprem_scanhistory_server ON onprem_scan_history (server_id)",
    "CREATE INDEX IF NOT EXISTS idx_cost_snapshots_captured ON cost_snapshots (captured_at)",
]

INDEXES_AZURESQL = [
    # Azure SQL uses IF NOT EXISTS differently
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_snapshots_resource') CREATE INDEX idx_snapshots_resource ON resource_snapshots (resource_id)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_snapshots_captured') CREATE INDEX idx_snapshots_captured ON resource_snapshots (captured_at)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_ai_type_subject') CREATE INDEX idx_ai_type_subject ON ai_analyses (analysis_type, subject_id)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_onprem_batch') CREATE INDEX idx_onprem_batch ON onprem_servers (batch_id)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_onprem_host') CREATE INDEX idx_onprem_host ON onprem_servers (hostname)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_agent_executions_assessment') CREATE INDEX idx_agent_executions_assessment ON agent_executions (assessment_id)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_assessments_status') CREATE INDEX idx_assessments_status ON assessments (status)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_assessments_type') CREATE INDEX idx_assessments_type ON assessments (assessment_type)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_assessment_resources_type') CREATE INDEX idx_assessment_resources_type ON assessment_resources (resource_type)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_assessment_analysis_type') CREATE INDEX idx_assessment_analysis_type ON assessment_analysis (analysis_type)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_security_findings_scan') CREATE INDEX idx_security_findings_scan ON security_findings (scan_id)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_security_findings_severity') CREATE INDEX idx_security_findings_severity ON security_findings (severity)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_security_findings_source') CREATE INDEX idx_security_findings_source ON security_findings (source)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_security_findings_resource') CREATE INDEX idx_security_findings_resource ON security_findings (resource_id)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_security_findings_status') CREATE INDEX idx_security_findings_status ON security_findings (status)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_security_findings_finding_id') CREATE INDEX idx_security_findings_finding_id ON security_findings (finding_id)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_onprem_scanhistory_server') CREATE INDEX idx_onprem_scanhistory_server ON onprem_scan_history (server_id)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_cost_snapshots_captured') CREATE INDEX idx_cost_snapshots_captured ON cost_snapshots (captured_at)",
]


def run_migration():
    provider = get_db_provider()
    print(f"Running schema migration for provider: {provider}")
    print("=" * 60)

    # Build a map of table → set of indexed column names (for NVARCHAR(450) sizing)
    import re as _re
    _indexed_by_table = {}
    for idx_sql in INDEXES_SQLITE:
        m = _re.search(r'ON\s+(\w+)\s*\(([^)]+)\)', idx_sql, _re.IGNORECASE)
        if m:
            tbl = m.group(1).lower()
            cols = {c.strip().lower() for c in m.group(2).split(',')}
            _indexed_by_table.setdefault(tbl, set()).update(cols)

    # Use autocommit for DDL to prevent large transaction rollbacks on Basic tier
    from services.database import get_raw_connection
    conn = get_raw_connection()
    if is_azure_sql():
        conn.autocommit = True
    cursor = conn.cursor()

    # Create all tables
    created = 0
    for i, ddl in enumerate(TABLES, 1):
        table_name = ddl.strip().split("(")[0].split()[-1]
        try:
            idx_cols = _indexed_by_table.get(table_name.lower(), set())
            sql = create_table_sql(ddl, indexed_cols=idx_cols) if is_azure_sql() else ddl
            cursor.execute(sql)
            created += 1
            print(f"  [{i:2d}/24] ✓ {table_name}")
        except Exception as e:
            err_str = str(e).lower()
            if "already" in err_str or "exists" in err_str or "duplicate" in err_str:
                print(f"  [{i:2d}/24] ⊘ {table_name} (already exists)")
            else:
                print(f"  [{i:2d}/24] ✗ {table_name}: {e}")

    # Create indexes
    indexes = INDEXES_AZURESQL if is_azure_sql() else INDEXES_SQLITE
    print(f"\nCreating {len(indexes)} indexes…")
    for idx_sql in indexes:
        try:
            cursor.execute(idx_sql)
        except Exception as e:
            if "already" not in str(e).lower() and "exists" not in str(e).lower():
                print(f"  Index warning: {e}")

    if not is_azure_sql():
        conn.commit()
    conn.close()

    # Verify tables were created (Azure SQL only)
    if is_azure_sql():
        verify_conn = get_raw_connection()
        vc = verify_conn.cursor()
        vc.execute("SELECT COUNT(*) FROM sys.tables")
        tbl_count = vc.fetchone()[0]
        verify_conn.close()
        print(f"\n  Verified: {tbl_count} tables in sys.tables")

    print(f"\n✓ Schema migration complete")
    print(f"  Provider: {provider}")
    print(f"  Tables created: {created}")
    print(f"  Indexes: {len(indexes)}")


if __name__ == "__main__":
    run_migration()
