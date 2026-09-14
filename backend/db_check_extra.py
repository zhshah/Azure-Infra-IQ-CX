import sqlite3, json, os
db_path = "data/scans.db"
if not os.path.exists(db_path):
    print(f"DB not found at {db_path}")
else:
    db = sqlite3.connect(db_path)
    cur = db.cursor()
    
    cur.execute("SELECT assessment_id, assessment_name, status, assessment_type FROM assessments ORDER BY created_at DESC LIMIT 5")
    rows = cur.fetchall()
    print("=== RECENT ASSESSMENTS ===")
    for r in rows: print(f"  {r[0]}: {r[1]} (status={r[2]}, type={r[3]})")
    
    # Check for all tables to see what exists
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = cur.fetchall()
    print("\n=== ALL TABLES ===")
    for t in tables: print(f"  {t[0]}")
    
    # Try to check assessment_apex_workflow if it exists
    if ("assessment_apex_workflow",) in tables:
        print("\n=== APEX WORKFLOWS ===")
        cur.execute("SELECT id, assessment_id, status, total_agents, completed_agents FROM assessment_apex_workflow ORDER BY created_at DESC LIMIT 5")
        rows = cur.fetchall()
        for r in rows: print(f"  {r[0]}: assessment={r[1]} status={r[2]} total={r[3]} completed={r[4]}")
    
    db.close()
