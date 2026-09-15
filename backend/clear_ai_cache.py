import sqlite3, os
db_path = os.path.join("data", "scans.db")
db = sqlite3.connect(db_path)
cur = db.execute("DELETE FROM ai_analyses WHERE analysis_type IN ('ai_cloud_maturity', 'ai_security_posture', 'ai_innovation', 'ai_migration')")
print(f"Deleted {cur.rowcount} stale cache entries")
db.commit()
db.close()
