"""
Database Migration: Add APEX Integration Tables
Adds 6 new tables for Phase 2 implementation workflow
"""

import sqlite3
from pathlib import Path

def migrate_apex_tables(db_path: str = "data/scans.db"):
    """Create APEX integration tables"""
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    print("Creating APEX integration tables...")
    
    # Check if old projects table exists and rename it
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
    if cursor.fetchone():
        print("  ℹ Old 'projects' table found - renaming to 'projects_legacy'...")
        cursor.execute("ALTER TABLE projects RENAME TO projects_legacy")
    
    # Table 1: Projects (BCDR workloads/applications)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS projects (
            project_id TEXT PRIMARY KEY,
            project_name TEXT NOT NULL,
            description TEXT,
            business_unit TEXT,
            criticality TEXT,
            rto_target TEXT,
            rpo_target TEXT,
            environment TEXT,
            dr_tier TEXT,
            owner TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    print("✓ Created 'projects' table")
    
    # Table 2: Project Resources (M:N relationship)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS project_resources (
            project_id TEXT,
            resource_id TEXT,
            role TEXT,
            PRIMARY KEY (project_id, resource_id)
        )
    """)
    print("✓ Created 'project_resources' table")
    
    # Table 3: Agent Executions
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS agent_executions (
            execution_id TEXT PRIMARY KEY,
            project_id TEXT,
            agent_name TEXT,
            status TEXT,
            input_data TEXT,
            output_data TEXT,
            artifacts TEXT,
            error_message TEXT,
            started_at TIMESTAMP,
            completed_at TIMESTAMP
        )
    """)
    print("✓ Created 'agent_executions' table")
    
    # Table 4: Agent Artifacts
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS agent_artifacts (
            artifact_id TEXT PRIMARY KEY,
            execution_id TEXT,
            artifact_type TEXT,
            file_name TEXT,
            content TEXT,
            created_at TIMESTAMP
        )
    """)
    print("✓ Created 'agent_artifacts' table")
    
    # Table 5: BCDR Recommendations
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS bcdr_recommendations (
            recommendation_id TEXT PRIMARY KEY,
            resource_id TEXT,
            project_id TEXT,
            recommendation_type TEXT,
            priority TEXT,
            title TEXT,
            description TEXT,
            cost_impact REAL,
            effort_level TEXT,
            implementation_time TEXT,
            dependencies TEXT,
            status TEXT,
            created_at TIMESTAMP,
            updated_at TIMESTAMP
        )
    """)
    print("✓ Created 'bcdr_recommendations' table")
    
    # Table 6: Modernization Opportunities
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS modernization_opportunities (
            opportunity_id TEXT PRIMARY KEY,
            resource_id TEXT,
            current_service TEXT,
            recommended_service TEXT,
            migration_type TEXT,
            cost_savings REAL,
            effort_estimate TEXT,
            business_case TEXT,
            status TEXT,
            created_at TIMESTAMP
        )
    """)
    print("✓ Created 'modernization_opportunities' table")
    
    conn.commit()
    conn.close()
    
    print("\n✅ All APEX integration tables created successfully!")

if __name__ == "__main__":
    # Get database path
    db_path = Path(__file__).parent.parent / "data" / "scans.db"
    
    # Ensure data directory exists
    db_path.parent.mkdir(exist_ok=True)
    
    # Run migration
    migrate_apex_tables(str(db_path))
