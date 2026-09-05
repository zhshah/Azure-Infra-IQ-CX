"""
Data availability — one honest answer to "does this module actually have data, and
where does that data come from?"

Two consumers:
  * the UI, via GET /api/data/availability, so a panel can say "collection failed:
    sign-in expired" instead of the misleading "no data collected yet";
  * every AI prompt, via ``ai_grounding_block()``, so a module analysis knows which
    datasets are populated, how fresh they are, and which are simply absent — and
    therefore never speculates about a number nobody collected.

The DATASETS map below is the single source of truth for both.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from services.database import get_connection, is_azure_sql

logger = logging.getLogger(__name__)

# Where a given dataset ultimately comes from. This distinction matters: a warehouse
# table is only as fresh as the last ETL, whereas a live dataset is fetched per request
# and fails loudly instead of going stale.
SOURCE_WAREHOUSE = "azure_sql_warehouse"   # nightly ETL → Azure SQL
SOURCE_SCAN = "scan_cache"                 # resource scan → Azure SQL + in-process cache
SOURCE_LIVE = "live_azure_api"             # queried from Azure on every request
SOURCE_USER = "user_input"                 # entered in the product, not from Azure

# dataset key → what it is, where it lives, and which product modules read it.
DATASETS: Dict[str, Dict[str, Any]] = {
    # ── Cost warehouse (nightly ETL) ─────────────────────────────────────────
    "finops_daily_dimension_costs": {
        "label": "Daily cost by dimension",
        "source": SOURCE_WAREHOUSE, "table": "finops_daily_dimension_costs",
        "date_column": "snapshot_date", "grain": "daily",
        "modules": ["Cost Pulse", "Cost Analysis / Analyze", "Cost Studio",
                    "Executive Report", "FinOps Overview"],
        "why": "The authoritative estate spend spine — every headline total and trend.",
    },
    "finops_daily_resource_costs": {
        "label": "Daily cost per resource",
        "source": SOURCE_WAREHOUSE, "table": "finops_daily_resource_costs",
        "date_column": "snapshot_date", "grain": "daily",
        "modules": ["Cost Insights", "Optimization", "Savings", "Cost at risk"],
        "why": "Per-resource attribution. Rate-limited by Azure, so coverage is partial by design.",
    },
    "finops_daily_subscription_costs": {
        "label": "Daily cost per subscription",
        "source": SOURCE_WAREHOUSE, "table": "finops_daily_subscription_costs",
        "date_column": "snapshot_date", "grain": "daily",
        "modules": ["FinOps Overview", "Management Review", "Executive Report"],
        "why": "Per-subscription rollup for showback.",
    },
    "finops_monthly_service_costs": {
        "label": "Monthly cost by service",
        "source": SOURCE_WAREHOUSE, "table": "finops_monthly_service_costs",
        "date_column": "billing_month", "grain": "monthly",
        "modules": ["Cost Analysis", "Executive Report", "Service categories"],
        "why": "Month-over-month and year-on-year service trend.",
    },
    "finops_monthly_tag_costs": {
        "label": "Monthly cost by tag",
        "source": SOURCE_WAREHOUSE, "table": "finops_monthly_tag_costs",
        "date_column": "billing_month", "grain": "monthly",
        "modules": ["Allocation & Showback", "Chargeback", "Tag analytics"],
        "why": "Cost allocation by tag. Empty when the estate is untagged.",
    },
    "finops_daily_meter_costs": {
        "label": "Daily cost + usage by meter",
        "source": SOURCE_WAREHOUSE, "table": "finops_daily_meter_costs",
        "date_column": "snapshot_date", "grain": "daily",
        "modules": ["Management Review — service categories, storage tiers, network, "
                    "security & monitoring"],
        "why": "The only grain carrying usage QUANTITY — storage tiers, egress GB, $/GB ingested.",
    },
    "finops_resource_utilization": {
        "label": "Daily resource utilisation",
        "source": SOURCE_WAREHOUSE, "table": "finops_resource_utilization",
        "date_column": "snapshot_date", "grain": "daily",
        "modules": ["Management Review — VM cost & utilisation", "Rightsizing", "Idle resources"],
        "why": "CPU/memory/power-state history behind underutilisation findings.",
    },
    "finops_storage_capacity": {
        "label": "Storage capacity history",
        "source": SOURCE_WAREHOUSE, "table": "finops_storage_capacity",
        "date_column": "snapshot_date", "grain": "daily",
        "modules": ["Management Review — storage growth"],
        "why": "GB/month growth trend.",
    },
    "finops_la_table_costs": {
        "label": "Log Analytics cost per table",
        "source": SOURCE_WAREHOUSE, "table": "finops_la_table_costs",
        "date_column": "snapshot_date", "grain": "daily",
        "modules": ["Sentinel & Log Analytics", "Security & monitoring cost"],
        "why": "Per-table ingestion cost; needs a readable workspace.",
    },
    "finops_mgmt_group_costs": {
        "label": "Management group cost rollup",
        "source": SOURCE_WAREHOUSE, "table": "finops_mgmt_group_costs",
        "date_column": "billing_month", "grain": "monthly",
        "modules": ["Governance & Allocation", "Subscription & Management Group report"],
        "why": "Needs Management Group Reader; empty otherwise.",
    },
    "finops_recommendations": {
        "label": "Optimisation recommendations",
        "source": SOURCE_WAREHOUSE, "table": "finops_recommendations",
        "date_column": "last_seen", "grain": "event",
        "modules": ["Optimization", "Savings Ledger"],
        "why": "Recommendation lifecycle (open → accepted → implemented).",
    },
    "finops_savings_ledger": {
        "label": "Realised savings ledger",
        "source": SOURCE_WAREHOUSE, "table": "finops_savings_ledger",
        "date_column": "measured_at", "grain": "event",
        "modules": ["Savings, Realization & ROI"],
        "why": "Only fills AFTER a recommendation is marked implemented — empty is normal early on.",
    },
    "finops_anomalies": {
        "label": "Cost anomalies",
        "source": SOURCE_WAREHOUSE, "table": "finops_anomalies",
        "date_column": "detected_date", "grain": "event",
        "modules": ["Anomaly Intelligence", "Anomaly & Cost-Spike report"],
        "why": "Spikes >50% over the 7-day average on resources above $5/day. Empty means none qualified.",
    },
    "finops_budgets": {
        "label": "Budgets",
        "source": SOURCE_WAREHOUSE, "table": "finops_budgets",
        "date_column": None, "grain": "config",
        "modules": ["Budgets & Alerts", "Budget & Forecast report"],
        "why": "Synced from Azure Budgets plus any defined in-product.",
    },

    # ── Resource scan ────────────────────────────────────────────────────────
    "scans": {
        "label": "Estate scan snapshots",
        "source": SOURCE_SCAN, "table": "scans",
        "date_column": "saved_at", "grain": "event",
        "modules": ["Overview", "Resources", "every module that lists resources"],
        "why": "The full dashboard payload — inventory, scores, orphans, gaps.",
    },
    "resource_metrics": {
        "label": "Per-resource metrics",
        "source": SOURCE_SCAN, "table": "resource_metrics",
        "date_column": "updated_at", "grain": "event",
        "modules": ["Resource 360", "VM Performance", "Rightsizing"],
        "why": "Cached CPU/memory/disk/network per resource.",
    },
    "resource_snapshots": {
        "label": "Resource change history",
        "source": SOURCE_SCAN, "table": "resource_snapshots",
        "date_column": "captured_at", "grain": "event",
        "modules": ["Change tracking", "Drift detection"],
        "why": "Point-in-time SKU/tag/config per resource for diffing.",
    },
    "security_findings": {
        "label": "Security findings",
        "source": SOURCE_SCAN, "table": "security_findings",
        "date_column": None, "grain": "event",
        "modules": ["Security", "Well-Architected", "Compliance"],
        "why": "Defender / posture findings cache.",
    },

    # ── Entered in the product ───────────────────────────────────────────────
    "resource_bcdr_metadata": {
        "label": "BCDR classification",
        "source": SOURCE_USER, "table": "resource_bcdr_metadata",
        "date_column": None, "grain": "config",
        "modules": ["BCDR Planning", "Business Impact Analysis", "Resilience"],
        "why": "Criticality / RTO / RPO the customer entered. Authoritative over any inference.",
    },
    "resource_custom_tags": {
        "label": "Custom tags",
        "source": SOURCE_USER, "table": "resource_custom_tags",
        "date_column": None, "grain": "config",
        "modules": ["Tags", "Allocation", "Governance"],
        "why": "In-product tags layered over Azure tags.",
    },
    "onprem_servers": {
        "label": "On-premises inventory",
        "source": SOURCE_USER, "table": "onprem_servers",
        "date_column": "collected_at", "grain": "event",
        "modules": ["On-Premises", "Migration"],
        "why": "Uploaded or agent-collected servers. Empty unless on-prem discovery was run.",
    },
    "projects": {
        "label": "Projects",
        "source": SOURCE_USER, "table": "projects",
        "date_column": None, "grain": "config",
        "modules": ["Projects", "Assessments"],
        "why": "Workload groupings.",
    },
    "assessments": {
        "label": "Assessments",
        "source": SOURCE_USER, "table": "assessments",
        "date_column": None, "grain": "config",
        "modules": ["Assessments"],
        "why": "Saved assessment runs.",
    },
    "ai_analyses": {
        "label": "AI analysis cache",
        "source": SOURCE_WAREHOUSE, "table": "ai_analyses",
        "date_column": "analyzed_at", "grain": "event",
        "modules": ["every AI panel"],
        "why": "Cached model answers keyed by a fingerprint of the question and the data.",
    },
}

# Datasets that are legitimately empty until something happens, so an empty table is
# reported as "not applicable yet" rather than as a gap to chase.
_EMPTY_IS_NORMAL = {
    "finops_savings_ledger": "no recommendation has been marked implemented yet",
    "finops_anomalies": "no spend spike crossed the detection threshold",
    "onprem_servers": "on-premises discovery has not been run",
    "assessments": "no assessment has been saved yet",
    "resource_snapshots": "change tracking needs at least two scans",
    "finops_monthly_tag_costs": "no tracked tag keys are present on billed resources",
    "finops_mgmt_group_costs": "needs Management Group Reader on the tenant root",
}

# Modules whose data is NEVER in SQL — always fetched from Azure per request. Listing
# them explicitly stops the AI hunting for a table that was never meant to exist.
LIVE_ONLY_MODULES: Dict[str, str] = {
    "Advisor": "Azure Advisor REST API",
    "Service Health": "Azure Resource Health / Service Health API",
    "Quota & Capacity": "Azure Quota API",
    "Update Management": "Azure Update Manager / Resource Graph",
    "Monitoring": "Azure Monitor + Log Analytics queries",
    "Networking": "Azure Resource Graph",
    "M365 Security": "Microsoft Graph (needs app permissions, not az login)",
    "Identity & Access": "Microsoft Entra / Graph",
    "Reservations & Commitments": "Azure Reservations + Cost Management",
}


def _age_hours(ts: Any) -> Optional[float]:
    if not ts:
        return None
    try:
        s = str(ts).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s[:32])
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return round((datetime.now(timezone.utc) - dt).total_seconds() / 3600.0, 1)
    except Exception:
        return None


def _last_etl(cur) -> Dict[str, Any]:
    sql = ("SELECT TOP 1 started_at, completed_at, status, triggered_by, error_message "
           "FROM finops_etl_runs ORDER BY started_at DESC") if is_azure_sql() else (
          "SELECT started_at, completed_at, status, triggered_by, error_message "
          "FROM finops_etl_runs ORDER BY started_at DESC LIMIT 1")
    try:
        cur.execute(sql)
        r = cur.fetchone()
        if not r:
            return {"status": "never_run"}
        return {
            "started_at": str(r[0]), "completed_at": str(r[1]) if r[1] else None,
            "status": str(r[2]), "triggered_by": str(r[3]) if r[3] else None,
            "error_message": str(r[4]) if r[4] else None,
            "age_hours": _age_hours(r[0]),
        }
    except Exception as exc:
        return {"status": "unknown", "error_message": str(exc)[:200]}


def get_availability() -> Dict[str, Any]:
    """Census every dataset: rows, coverage window, freshness and a verdict."""
    out: Dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "datasets": {},
        "live_only_modules": LIVE_ONLY_MODULES,
    }
    try:
        with get_connection() as con:
            cur = con.cursor()
            out["last_etl"] = _last_etl(cur)

            for key, meta in DATASETS.items():
                entry: Dict[str, Any] = {
                    "label": meta["label"], "source": meta["source"], "table": meta["table"],
                    "grain": meta["grain"], "modules": meta["modules"], "why": meta["why"],
                    "rows": 0, "earliest": None, "latest": None, "age_hours": None,
                }
                try:
                    cur.execute(f"SELECT COUNT(*) FROM {meta['table']}")
                    entry["rows"] = int(cur.fetchone()[0] or 0)
                except Exception as exc:
                    entry["status"] = "missing"
                    entry["detail"] = f"table not present: {str(exc)[:120]}"
                    out["datasets"][key] = entry
                    continue

                dcol = meta.get("date_column")
                if dcol and entry["rows"]:
                    try:
                        cur.execute(f"SELECT MIN({dcol}), MAX({dcol}) FROM {meta['table']}")
                        lo, hi = cur.fetchone()
                        entry["earliest"] = str(lo)[:19] if lo else None
                        entry["latest"] = str(hi)[:19] if hi else None
                        entry["age_hours"] = _age_hours(hi)
                    except Exception:
                        pass

                if entry["rows"] == 0:
                    if key in _EMPTY_IS_NORMAL:
                        entry["status"] = "not_applicable"
                        entry["detail"] = _EMPTY_IS_NORMAL[key]
                    else:
                        entry["status"] = "empty"
                        entry["detail"] = "no rows collected"
                else:
                    entry["status"] = "ok"
                out["datasets"][key] = entry
    except Exception as exc:
        logger.error("Data availability census failed: %s", exc)
        out["error"] = str(exc)[:300]
        return out

    # A failed ETL explains every empty warehouse table at once — say it plainly rather
    # than letting each panel invent its own "no data collected yet".
    etl = out.get("last_etl") or {}
    if etl.get("status") in ("failed", "partial") and etl.get("error_message"):
        for entry in out["datasets"].values():
            if entry["source"] == SOURCE_WAREHOUSE and entry["status"] in ("empty", "stale"):
                entry["status"] = "collection_failed"
                entry["detail"] = etl["error_message"][:300]

    ds = out["datasets"].values()
    out["summary"] = {
        "total": len(out["datasets"]),
        "ok": sum(1 for d in ds if d["status"] == "ok"),
        "empty": sum(1 for d in ds if d["status"] == "empty"),
        "not_applicable": sum(1 for d in ds if d["status"] == "not_applicable"),
        "collection_failed": sum(1 for d in ds if d["status"] == "collection_failed"),
        "missing": sum(1 for d in ds if d["status"] == "missing"),
    }
    return out


_BLOCK_CACHE: Dict[str, Any] = {"at": 0.0, "text": ""}
_BLOCK_TTL_SECONDS = 300


def ai_grounding_block(max_chars: int = 2200) -> str:
    """Compact availability map for an AI system prompt.

    Tells the model which datasets are populated and over what window, which are empty
    and why, and which modules are live-only — so it looks in the right place and says
    "not collected" instead of inventing a figure. Memoised because it queries every
    warehouse table and sits on the hot path of every AI call.
    """
    import time as _time
    now = _time.time()
    if _BLOCK_CACHE["text"] and (now - _BLOCK_CACHE["at"]) < _BLOCK_TTL_SECONDS:
        return _BLOCK_CACHE["text"]
    try:
        av = get_availability()
    except Exception:
        return ""
    ds = av.get("datasets") or {}
    if not ds:
        return ""

    have, absent = [], []
    for d in ds.values():
        if d["status"] == "ok":
            span = f"{d['earliest'][:10]}..{d['latest'][:10]}" if d.get("earliest") and d.get("latest") else "current"
            have.append(f"{d['label']} ({d['rows']} rows, {span})")
        elif d["status"] in ("empty", "not_applicable", "collection_failed", "missing"):
            absent.append(f"{d['label']} — {d.get('detail', d['status'])}")

    etl = av.get("last_etl") or {}
    lines = ["## DATA AVAILABILITY (what has actually been collected)"]
    if etl.get("status") in ("failed", "partial"):
        lines.append(
            f"!! The last collection run {etl['status'].upper()}: {str(etl.get('error_message'))[:200]} "
            "Any figure below may be stale or missing for that reason — say so rather than "
            "presenting an absence as a zero."
        )
    if have:
        lines.append("AVAILABLE: " + "; ".join(have))
    if absent:
        lines.append("NOT AVAILABLE: " + "; ".join(absent))
    lines.append(
        "LIVE-ONLY (never stored, read from Azure per request; if a call failed the data is "
        "absent, not zero): " + ", ".join(f"{k} via {v}" for k, v in LIVE_ONLY_MODULES.items())
    )
    lines.append(
        "RULE: only reason about datasets listed AVAILABLE, and only inside their stated "
        "window. For anything listed NOT AVAILABLE, state plainly that it has not been "
        "collected and why — never infer, model or substitute a value, and never report "
        "an uncollected metric as zero."
    )
    block = "\n".join(lines)
    block = block[:max_chars]
    _BLOCK_CACHE["text"] = block
    _BLOCK_CACHE["at"] = now
    return block
