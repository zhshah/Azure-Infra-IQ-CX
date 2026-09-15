"""One-off: remove test-pollution rows from the live Azure SQL tables."""
from services.database import get_raw_connection

c = get_raw_connection()
cur = c.cursor()

# Drop the junk snapshot I wrote during validation (tiny payload with resource_id 'x').
cur.execute(
    "DELETE FROM scans WHERE id IN "
    "(SELECT TOP 1 id FROM scans ORDER BY id DESC) "
    "AND LEN(payload) < 200"
)
print("junk scans deleted:", cur.rowcount)

cur.execute("DELETE FROM ai_analyses WHERE analysis_type = 'selftest'")
print("selftest ai rows deleted:", cur.rowcount)

c.commit()

cur.execute("SELECT TOP 1 id, LEN(payload), saved_at FROM scans ORDER BY id DESC")
print("newest scan now:", cur.fetchone())
c.close()
