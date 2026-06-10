"""
Complete migration for remaining tables: security_findings (partial) and security_scans.
Uses batch inserts with fast_executemany for speed on Basic tier.
"""
import os, sys, sqlite3, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
from services.database import get_raw_connection

SQLITE_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "scans.db")

def migrate_remaining():
    sqlite_conn = sqlite3.connect(SQLITE_PATH)
    
    # --- security_scans (6 rows) ---
    print("=== security_scans ===")
    az = get_raw_connection()
    az.autocommit = False
    sc = sqlite_conn.cursor()
    sc.execute("PRAGMA table_info(security_scans)")
    cols = [r[1] for r in sc.fetchall()]
    
    # Get Azure SQL columns
    ac = az.cursor()
    ac.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='security_scans' ORDER BY ORDINAL_POSITION")
    az_cols = [r[0] for r in ac.fetchall()]
    common = [c for c in cols if c in az_cols]
    
    col_list = ", ".join(f"[{c}]" for c in common)
    placeholders = ", ".join("?" for _ in common)
    
    sc.execute(f"SELECT {col_list} FROM security_scans")
    rows = sc.fetchall()
    print(f"  Source rows: {len(rows)}")
    
    ac.execute("SELECT COUNT(*) FROM security_scans")
    existing = ac.fetchone()[0]
    print(f"  Already in Azure SQL: {existing}")
    
    if existing == 0 and rows:
        ac.fast_executemany = True
        ac.executemany(f"INSERT INTO security_scans ({col_list}) VALUES ({placeholders})", rows)
        az.commit()
        print(f"  Inserted {len(rows)} rows")
    else:
        print("  Skipped (already migrated or empty)")
    az.close()
    
    # --- security_findings (partial - need remaining rows) ---
    print("\n=== security_findings ===")
    az = get_raw_connection()
    az.autocommit = False
    ac = az.cursor()
    
    sc.execute("PRAGMA table_info(security_findings)")
    cols = [r[1] for r in sc.fetchall()]
    ac.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='security_findings' ORDER BY ORDINAL_POSITION")
    az_cols = [r[0] for r in ac.fetchall()]
    common = [c for c in cols if c in az_cols]
    
    col_list = ", ".join(f"[{c}]" for c in common)
    placeholders = ", ".join("?" for _ in common)
    
    # Check how many we already have
    ac.execute("SELECT COUNT(*) FROM security_findings")
    existing = ac.fetchone()[0]
    print(f"  Already in Azure SQL: {existing}")
    
    sc.execute(f"SELECT COUNT(*) FROM security_findings")
    total = sc.fetchone()[0]
    print(f"  Total in SQLite: {total}")
    
    if existing >= total:
        print("  Already complete!")
        az.close()
        sqlite_conn.close()
        return
    
    # Get existing IDs to skip duplicates  
    ac.execute("SELECT id FROM security_findings")
    existing_ids = {r[0] for r in ac.fetchall()}
    print(f"  Existing IDs count: {len(existing_ids)}")
    
    # Get id column index
    id_idx = common.index("id") if "id" in common else None
    
    # Read all source rows, filter out existing
    sc.execute(f"SELECT {col_list} FROM security_findings")
    all_rows = sc.fetchall()
    
    if id_idx is not None:
        new_rows = [r for r in all_rows if r[id_idx] not in existing_ids]
    else:
        new_rows = all_rows[existing:]  # fallback: skip first N
    
    print(f"  New rows to insert: {len(new_rows)}")
    
    if new_rows:
        # Enable IDENTITY_INSERT for the id column
        ac.execute("SET IDENTITY_INSERT security_findings ON")
        
        # Insert in batches of 200 using fast_executemany
        batch_size = 200
        inserted = 0
        for i in range(0, len(new_rows), batch_size):
            batch = new_rows[i:i+batch_size]
            try:
                ac.fast_executemany = True
                ac.executemany(f"INSERT INTO security_findings ({col_list}) VALUES ({placeholders})", batch)
                az.commit()
                inserted += len(batch)
                print(f"    Batch {i//batch_size + 1}: {len(batch)} rows (total: {inserted})")
            except Exception as e:
                print(f"    Batch {i//batch_size + 1} error: {e}")
                az.rollback()
                # Fallback: insert one by one
                for row in batch:
                    try:
                        ac.execute(f"INSERT INTO security_findings ({col_list}) VALUES ({placeholders})", row)
                        az.commit()
                        inserted += 1
                    except Exception:
                        pass  # skip duplicates
        
        try:
            ac.execute("SET IDENTITY_INSERT security_findings OFF")
            az.commit()
        except Exception:
            pass
        print(f"  Total inserted: {inserted}")
    
    az.close()
    sqlite_conn.close()
    print("\nDone!")

if __name__ == "__main__":
    migrate_remaining()
