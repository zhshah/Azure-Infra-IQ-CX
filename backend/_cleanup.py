"""Drop all tables from Azure SQL to start fresh after failed migration."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()
from services.database import get_connection

with get_connection() as conn:
    c = conn.cursor()
    c.execute("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME")
    tables = [r[0] for r in c.fetchall()]
    print(f"Existing tables ({len(tables)}): {tables}")
    for t in tables:
        c.execute(f"DROP TABLE [{t}]")
        print(f"  Dropped {t}")
    conn.commit()
    print("All tables dropped - clean slate")
