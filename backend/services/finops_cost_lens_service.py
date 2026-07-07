"""
FinOps Cross-domain Cost Lens — the differentiator that ties SPEND to the tool's
other domains (resiliency, security, governance) using the signals the scan already
computed on every resource. Answers questions the Azure Portal cannot, e.g.:

  • "How much are we spending on resources with NO backup?"
  • "What's the monthly cost sitting behind resources with no delete-lock?"
  • "How much spend is on data resources exposed without a private endpoint?"
  • "What's the cost of untagged / ungoverned resources?"

PURE function over the dashboard cache dict — run-rate cost (throttle-immune).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fnum(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _run_rate(r: Dict[str, Any]) -> float:
    cur = _fnum(r.get("cost_current_month"))
    return cur if cur > 0 else _fnum(r.get("cost_previous_month"))


# Resource-type families that SHOULD be backed up (to avoid flagging e.g. NSGs).
_BACKUP_ELIGIBLE = ("virtualmachines", "disks", "sqldatabases", "servers/databases",
                    "fileshares", "storageaccounts", "flexibleservers")
# Data resources where a missing private endpoint is a real exposure.
_DATA_TYPES = ("storageaccounts", "sqlservers", "servers", "vaults", "namespaces",
               "registries", "cosmosdb", "databaseaccounts", "flexibleservers", "redis")


def _is_type(r: Dict[str, Any], needles) -> bool:
    t = (r.get("resource_type", "") or "").lower()
    return any(n in t for n in needles)


def _bucket(resources: List[Dict[str, Any]], predicate, label: str, key: str,
            recommendation: str) -> Dict[str, Any]:
    hits = [r for r in resources if predicate(r)]
    hits_cost = sorted(hits, key=_run_rate, reverse=True)
    monthly = sum(_run_rate(r) for r in hits)
    return {
        "key": key,
        "label": label,
        "resource_count": len(hits),
        "monthly_usd": round(monthly, 2),
        "recommendation": recommendation,
        # Internal: every matched resource id (used to de-duplicate exposure across
        # overlapping buckets). Stripped before returning to the client.
        "_ids": [(r.get("resource_id", "") or "", _run_rate(r)) for r in hits],
        "resources": [{
            "resource_name": r.get("resource_name", "") or "",
            "resource_type": (r.get("resource_type", "") or "").split("/")[-1],
            "resource_group": r.get("resource_group", "") or "",
            "monthly_usd": round(_run_rate(r), 2),
            "portal_url": r.get("portal_url", "") or "",
        } for r in hits_cost[:12]],
    }


_LENSES = {
    "resiliency": lambda res: [
        _bucket(res, lambda r: _is_type(r, _BACKUP_ELIGIBLE) and not r.get("has_backup") and _run_rate(r) > 0,
                "Unprotected spend (no backup)", "no_backup",
                "Enable Azure Backup / a backup policy on these workloads."),
        _bucket(res, lambda r: not r.get("has_lock") and _run_rate(r) > 0,
                "No delete-lock", "no_lock",
                "Add a CanNotDelete lock to protect production resources from accidental deletion."),
        _bucket(res, lambda r: r.get("is_orphan"),
                "Orphaned resources", "orphaned",
                "Delete or reattach orphaned resources — they cost money and add risk."),
        _bucket(res, lambda r: (r.get("final_score") is not None and _fnum(r.get("final_score")) < 25 and not r.get("is_orphan")),
                "Idle / low-health spend", "idle",
                "Deallocate or decommission idle resources; confirm ownership first."),
    ],
    "security": lambda res: [
        _bucket(res, lambda r: _is_type(r, _DATA_TYPES) and not r.get("has_private_endpoint") and _run_rate(r) > 0,
                "Data resources without a private endpoint", "no_private_endpoint",
                "Add Private Endpoints and disable public network access on data services."),
        _bucket(res, lambda r: _fnum(r.get("rbac_assignment_count")) >= 5,
                "Broad direct RBAC (≥5 assignments)", "broad_rbac",
                "Review direct role assignments; prefer group-based, least-privilege access."),
        _bucket(res, lambda r: not r.get("has_lock") and _is_type(r, _DATA_TYPES) and _run_rate(r) > 0,
                "Unlocked data resources", "unlocked_data",
                "Lock critical data stores to prevent accidental/malicious deletion."),
    ],
    "governance": lambda res: [
        _bucket(res, lambda r: bool(r.get("missing_tags")),
                "Untagged / non-compliant spend", "untagged",
                "Apply required tags (owner/environment/cost-center) for accurate allocation."),
        _bucket(res, lambda r: not r.get("ri_covered") and _run_rate(r) > 0 and _is_type(r, ("virtualmachines", "flexibleservers", "servers/databases")),
                "On-demand (no reservation coverage)", "no_ri",
                "Evaluate reservations / savings plans for steady-state compute & databases."),
    ],
}

LENS_META = {
    "resiliency": {"label": "Resiliency", "desc": "Spend exposed to reliability risk"},
    "security":   {"label": "Security",   "desc": "Spend with security posture gaps"},
    "governance": {"label": "Governance", "desc": "Ungoverned / unoptimized spend"},
}


def compute_lens(dash: Optional[Dict[str, Any]], lens: str = "resiliency") -> Dict[str, Any]:
    resources = dash.get("resources", []) if isinstance(dash, dict) else []
    resources = [r for r in (resources or []) if isinstance(r, dict)]
    lens = lens if lens in _LENSES else "resiliency"
    total_spend = round(sum(_run_rate(r) for r in resources), 2)
    buckets = _LENSES[lens](resources)
    # De-duplicate exposure: a resource can appear in several buckets (e.g. no backup
    # AND no lock). Count each resource's spend once for the headline exposure.
    uniq: Dict[str, float] = {}
    for b in buckets:
        for rid, cost in b.pop("_ids", []):
            if rid:
                uniq[rid] = cost
            else:
                uniq[f"_anon_{len(uniq)}"] = cost
    exposed = round(sum(uniq.values()), 2)
    return {
        "lens": lens,
        "lens_label": LENS_META[lens]["label"],
        "lens_desc": LENS_META[lens]["desc"],
        "buckets": buckets,
        "total_spend_usd": total_spend,
        "exposed_spend_usd": exposed,
        "exposed_pct": round(exposed / total_spend * 100, 1) if total_spend > 0 else 0.0,
        "resource_count": len(resources),
        "available_lenses": list(_LENSES.keys()),
        "data_source": "dashboard_cache",
        "generated_at": _now_iso(),
    }
