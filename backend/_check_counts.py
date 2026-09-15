import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
from services.database import get_connection

with get_connection() as conn:
    c = conn.cursor()
    # Try multiple approaches to find tables
    c.execute("SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_SCHEMA, TABLE_NAME")
    all_tables = c.fetchall()
    print(f"ALL tables in INFORMATION_SCHEMA ({len(all_tables)}):")
    for r in all_tables:
        print(f"  {r[0]}.{r[1]} ({r[2]})")
    
    # Also try sys.tables
    c.execute("SELECT name FROM sys.tables ORDER BY name")
    sys_tables = [r[0] for r in c.fetchall()]
    print(f"\nsys.tables ({len(sys_tables)}):")
    for t in sys_tables:
        c.execute(f"SELECT COUNT(*) FROM [{t}]")
        cnt = c.fetchone()[0]
        print(f"  {t:35s} {cnt} rows")
