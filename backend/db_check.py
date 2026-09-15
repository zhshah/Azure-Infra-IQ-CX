import sqlite3, json, os
db_path = "data/scans.db"
if not os.path.exists(db_path):
    print(f"DB not found at {db_path}")
else:
    db = sqlite3.connect(db_path)
    cur = db.cursor()
    cur.execute("PRAGMA table_info(projects)")
    cols = cur.fetchall()
    print("=== PROJECTS TABLE SCHEMA ===")
    for c in cols: print(f"  {c[1]} ({c[2]})")
    cur.execute("SELECT COUNT(*) FROM projects")
    print(f"\nTotal rows: {cur.fetchone()[0]}")
    cur.execute("SELECT * FROM projects LIMIT 3")
    rows = cur.fetchall()
    col_names = [c[1] for c in cols]
    print("\n=== SAMPLE DATA ===")
    for r in rows:
        d = dict(zip(col_names, r))
        print(json.dumps(d, indent=2, default=str))
    cur.execute("PRAGMA table_info(assessments)")
    acols = cur.fetchall()
    print("\n=== ASSESSMENTS TABLE SCHEMA ===")
    for c in acols: print(f"  {c[1]} ({c[2]})")
    try:
        cur.execute("PRAGMA table_info(project_resources)")
        pcols = cur.fetchall()
        print("\n=== PROJECT_RESOURCES TABLE ===")
        for c in pcols: print(f"  {c[1]} ({c[2]})")
        cur.execute("SELECT COUNT(*) FROM project_resources")
        print(f"Total rows: {cur.fetchone()[0]}")
    except: print("\nNo project_resources table")
    try:
        cur.execute("PRAGMA table_info(assessment_apex_workflow)")
        wcols = cur.fetchall()
        print("\n=== ASSESSMENT_APEX_WORKFLOW TABLE ===")
        for c in wcols: print(f"  {c[1]} ({c[2]})")
    except: print("\nNo assessment_apex_workflow table")
    db.close()
