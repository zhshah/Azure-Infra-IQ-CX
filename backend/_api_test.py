"""Quick API verification against Azure SQL backend."""
import requests

tests = [
    ("Dashboard", "http://localhost:8001/api/cache/status"),
    ("Assessments", "http://localhost:8001/api/assessments"),
    ("OnPrem", "http://localhost:8001/api/onprem/inventory"),
    ("Security", "http://localhost:8001/api/security/enhanced"),
    ("Tags Schema", "http://localhost:8001/api/tags/schema"),
    ("Scans", "http://localhost:8001/api/scans/list"),
    ("Projects", "http://localhost:8001/api/projects"),
    ("Budgets", "http://localhost:8001/api/finops/budgets"),
]

for name, url in tests:
    try:
        r = requests.get(url, timeout=30)
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, list):
                print(f"  OK  {name}: {len(data)} items (list)")
            elif isinstance(data, dict):
                if "assessments" in data:
                    print(f"  OK  {name}: {len(data['assessments'])} assessments")
                elif "servers" in data:
                    print(f"  OK  {name}: {len(data['servers'])} servers")
                elif "projects" in data:
                    print(f"  OK  {name}: {len(data['projects'])} projects")
                elif "budgets" in data:
                    print(f"  OK  {name}: {len(data['budgets'])} budgets")
                else:
                    keys = list(data.keys())[:6]
                    print(f"  OK  {name}: keys={keys}")
            else:
                print(f"  OK  {name}: type={type(data).__name__}")
        else:
            print(f"  FAIL {name}: HTTP {r.status_code} - {r.text[:200]}")
    except Exception as e:
        print(f"  ERR  {name}: {e}")
