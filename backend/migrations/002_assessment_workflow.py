"""
Assessment Workflow Migration
Creates tables for service-based and multi-resource assessments
"""

import sqlite3
from pathlib import Path

def migrate():
    db_path = Path(__file__).parent.parent / "data" / "scans.db"
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    print("🔄 Starting Assessment Workflow Migration...")
    
    # 1. Assessments table (main assessment metadata)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS assessments (
            assessment_id TEXT PRIMARY KEY,
            assessment_name TEXT NOT NULL,
            assessment_type TEXT NOT NULL,  -- 'service-based' or 'multi-resource'
            service_type TEXT,  -- For service-based: 'Microsoft.Web/sites', 'Microsoft.Compute/virtualMachines', etc.
            scope_type TEXT,  -- For multi-resource: 'resource-group', 'subscription', 'custom'
            scope_value TEXT,  -- RG name, subscription ID, or comma-separated resource IDs
            description TEXT,
            business_unit TEXT,
            owner TEXT,
            status TEXT DEFAULT 'draft',  -- draft, scoping, analyzing, apex-running, completed, failed
            current_step INTEGER DEFAULT 1,  -- 1=type, 2=scope, 3=analysis, 4=apex, 5=report
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            completed_at TEXT
        )
    """)
    
    # 2. Assessment Resources (scoped resources for the assessment)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS assessment_resources (
            assessment_id TEXT NOT NULL,
            resource_id TEXT NOT NULL,
            resource_name TEXT,
            resource_type TEXT,
            location TEXT,
            resource_group TEXT,
            subscription_id TEXT,
            tags TEXT,  -- JSON
            selected BOOLEAN DEFAULT 1,
            resource_metadata TEXT,  -- JSON: full dashboard resource fields (sku, cost, backup, etc.)
            PRIMARY KEY (assessment_id, resource_id),
            FOREIGN KEY (assessment_id) REFERENCES assessments(assessment_id)
        )
    """)
    
    # 3. Assessment Analysis (AI analysis results with scoring)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS assessment_analysis (
            analysis_id TEXT PRIMARY KEY,
            assessment_id TEXT NOT NULL,
            analysis_type TEXT NOT NULL,  -- 'bcdr', 'cost', 'security', 'performance', 'compliance'
            overall_score INTEGER,  -- 0-100
            findings TEXT,  -- JSON array of findings
            recommendations TEXT,  -- JSON array of recommendations
            critical_gaps TEXT,  -- JSON array
            warnings TEXT,  -- JSON array
            opportunities TEXT,  -- JSON array
            metadata TEXT,  -- JSON with additional context
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (assessment_id) REFERENCES assessments(assessment_id)
        )
    """)
    
    # 4. Assessment APEX Workflow (tracks APEX agent execution)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS assessment_apex_workflow (
            workflow_id TEXT PRIMARY KEY,
            assessment_id TEXT NOT NULL,
            agent_sequence TEXT NOT NULL,  -- JSON array of agent names in order
            current_agent_index INTEGER DEFAULT 0,
            agents_completed TEXT,  -- JSON array of completed agent names
            agents_failed TEXT,  -- JSON array of failed agent names
            status TEXT DEFAULT 'pending',  -- pending, running, completed, failed
            started_at TEXT,
            completed_at TEXT,
            FOREIGN KEY (assessment_id) REFERENCES assessments(assessment_id)
        )
    """)
    
    # 5. Update agent_executions to link with assessments
    try:
        cursor.execute("""
            ALTER TABLE agent_executions 
            ADD COLUMN assessment_id TEXT
        """)
        print("✅ Added assessment_id to agent_executions")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e).lower():
            print("⚠️  assessment_id column already exists in agent_executions")
        else:
            raise
    
    # 6. Assessment Reports (final generated reports)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS assessment_reports (
            report_id TEXT PRIMARY KEY,
            assessment_id TEXT NOT NULL,
            report_type TEXT DEFAULT 'comprehensive',
            title TEXT,
            summary TEXT,
            executive_summary TEXT,
            findings_summary TEXT,
            recommendations_summary TEXT,
            cost_analysis TEXT,  -- JSON
            architecture_diagrams TEXT,  -- JSON array of diagram artifacts
            iac_artifacts TEXT,  -- JSON array of Bicep/Terraform files
            documentation TEXT,  -- Markdown content
            score_breakdown TEXT,  -- JSON with scores by category
            generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (assessment_id) REFERENCES assessments(assessment_id)
        )
    """)
    
    # Create indexes for performance
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_assessments_status ON assessments(status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_assessments_type ON assessments(assessment_type)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_assessment_resources_type ON assessment_resources(resource_type)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_assessment_analysis_type ON assessment_analysis(analysis_type)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_agent_executions_assessment ON agent_executions(assessment_id)")
    
    conn.commit()
    conn.close()
    
    print("✅ Assessment Workflow Migration Completed!")
    print("   - assessments table created")
    print("   - assessment_resources table created")
    print("   - assessment_analysis table created")
    print("   - assessment_apex_workflow table created")
    print("   - assessment_reports table created")
    print("   - Indexes created")

if __name__ == "__main__":
    migrate()
