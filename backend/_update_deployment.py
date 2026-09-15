import sqlite3, os
db = os.path.join(os.path.dirname(__file__), 'data', 'cost_optimizer.db')
conn = sqlite3.connect(db)
tables = [r[0] for r in conn.execute("select name from sqlite_master where type='table'").fetchall()]
print("Tables:", tables)
for t in tables:
    if 'setting' in t.lower() or 'config' in t.lower():
        rows = conn.execute(f"select * from [{t}] where value like '%gpt%' or key like '%DEPLOY%' or key like '%deploy%'").fetchall()
        print(f"\n{t} matching rows:", rows)
        conn.execute(f"UPDATE [{t}] SET value='gpt-5.4' WHERE key='AZURE_OPENAI_DEPLOYMENT'")
        print(f"Updated AZURE_OPENAI_DEPLOYMENT in {t}")
conn.commit()
conn.close()
print("\nDone")
