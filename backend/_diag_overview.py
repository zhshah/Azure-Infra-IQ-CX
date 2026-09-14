import json
from services.persistence_service import load_latest_dashboard
d = load_latest_dashboard() or {}
k = d.get("kpi") or {}
print("kpi keys:", list(k.keys())[:20])
for f in ["total_cost_current_month","total_cost_previous_month","mom_cost_delta_pct","total_potential_savings","subscription_count","total_resources"]:
    print(" ", f, "=", k.get(f))
print("tag_compliance_pct:", d.get("tag_compliance_pct"), "total_untagged:", d.get("total_untagged"))
print("subscriptions:", len(d.get("subscriptions") or []))
print("total_daily_cm len:", len(d.get("total_daily_cm") or []), "pm:", len(d.get("total_daily_pm") or []))
print("last_refreshed:", d.get("last_refreshed"))
