import sqlite3, json, os
db_path = "data/scans.db"
if os.path.exists(db_path):
    db = sqlite3.connect(db_path)
    cur = db.cursor()
    
    # Check schema of assessment_apex_workflow
    cur.execute("PRAGMA table_info(assessment_apex_workflow)")
    print("=== assessment_apex_workflow SCHEMA ===")
    for c in cur.fetchall(): print(f"  {c[1]} ({c[2]})")
    
    # Try selection with correct columns
    print("\n=== APEX WORKFLOWS (Content) ===")
    cur.execute("SELECT * FROM assessment_apex_workflow LIMIT 5")
    rows = cur.fetchall()
    col_names = [c[1] for c in cur.execute("PRAGMA table_info(assessment_apex_workflow)").fetchall()]
    for r in rows:
        print(json.dumps(dict(zip(col_names, r)), indent=2, default=str))
        
    db.close()
