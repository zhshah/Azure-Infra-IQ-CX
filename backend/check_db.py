import sqlite3
import os

print(f"CWD: {os.getcwd()}")
db_path = "data/scans.db"
print(f"DB Path: {os.path.abspath(db_path)}")
print(f"DB Exists: {os.path.exists(db_path)}")

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
tables = cursor.fetchall()
print(f"\nTables: {[t[0] for t in tables]}")

if "projects" in [t[0] for t in tables]:
    cursor.execute("PRAGMA table_info(projects)")
    columns = cursor.fetchall()
    print(f"\nprojects table columns:")
    for col in columns:
        print(f"  {col[1]}: {col[2]}")

conn.close()
