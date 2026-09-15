import json
from services.persistence_service import load_latest_dashboard
d = load_latest_dashboard() or {}
res = d.get("resources", [])
print("dashboard resources:", len(res))
# savings summary
from services.finops_service import get_savings_summary
sv = get_savings_summary(d)
print("savings total:", sv.total_identified_usd, "count:", sv.opportunity_count, "by_cat:", dict(sv.by_category))
# resource optimization pieces
orphans = [r for r in res if r.get("is_orphan")]
rightsize = [r for r in res if r.get("rightsize_sku")]
lowscore = [r for r in res if (r.get("final_score") or 100) < 25]
print("orphans:", len(orphans), "rightsize:", len(rightsize), "lowscore:", len(lowscore))
# advisor recs
adv = [a for r in res for a in (r.get("advisor_recommendations") or []) if str(a.get("category","")).lower()=="cost"]
print("advisor cost recs:", len(adv))
# run-rate cost presence
cur = sum(1 for r in res if (r.get("cost_current_month") or 0) > 0)
prev = sum(1 for r in res if (r.get("cost_previous_month") or 0) > 0)
print("resources with cost_current>0:", cur, "cost_previous>0:", prev)
print("kpi total_potential_savings:", (d.get("kpi") or {}).get("total_potential_savings"))
