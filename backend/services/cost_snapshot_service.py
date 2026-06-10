"""
Cost snapshot service
======================

Builds and persists a periodic *cost bundle* snapshot so the dashboard home
"30-DAY SPEND TREND" and the FinOps views can render instantly from the database
instead of issuing live Azure Cost Management queries on every page load.

Why this exists
---------------
Cost Management is heavily tenant-shared 429-throttled, so live cost pulls are
slow and frequently degrade to $0. A background job (see ``_cost_snapshot_loop``
in ``main.py``) calls :func:`capture_and_save` on a daily cadence; the read path
hydrates ``total_daily_cm`` / ``total_daily_pm`` (and seeds the FinOps warm cache)
from the latest persisted snapshot whenever live data is empty.

The bundle is built **sequentially** (one Cost Management call group at a time)
to stay gentle on the shared 429 budget.

CLI
---
Can also be run directly by an external scheduler (cron / Azure Container Apps
Job / Windows Task Scheduler)::

    python -m services.cost_snapshot_service
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from services.cost_service import get_total_daily_costs, get_subscription_ids
import services.persistence_service as persistence_svc

logger = logging.getLogger(__name__)


def _subscription_key(sub_ids: List[str]) -> str:
    """Stable key for the set of subscriptions a snapshot covers."""
    return ",".join(sorted(s for s in (sub_ids or []) if s))


def _new_bundle(sub_ids: List[str]) -> Dict[str, Any]:
    """Empty bundle skeleton with a fresh capture timestamp."""
    return {
        "captured_at": datetime.now(tz=timezone.utc).isoformat(),
        "subscription_key": _subscription_key(sub_ids),
        "total_daily_cm": [],
        "total_daily_pm": [],
        "finops_kpi": None,
    }


def _capture_total_daily(bundle: Dict[str, Any], sub_ids: List[str]) -> None:
    """Populate the tenant total-daily series (feeds home SpendTrend) in place."""
    try:
        cm, pm = get_total_daily_costs(sub_ids)
        bundle["total_daily_cm"] = cm
        bundle["total_daily_pm"] = pm
        logger.info(
            "Cost snapshot: total-daily captured (%d cm days, %d pm days)",
            len(cm), len(pm),
        )
    except Exception as exc:
        logger.warning("Cost snapshot: total-daily fetch failed: %s", exc)


def _capture_finops_kpi(bundle: Dict[str, Any], sub_ids: List[str]) -> None:
    """Populate the FinOps KPI summary (feeds FinOps cost_trend_30d / dates) in place."""
    try:
        import services.finops_service as finops_svc
        kpi = finops_svc.get_finops_kpi(sub_ids)
        bundle["finops_kpi"] = (
            kpi.model_dump(mode="json") if hasattr(kpi, "model_dump") else dict(kpi)
        )
        logger.info("Cost snapshot: FinOps KPI captured")
    except Exception as exc:
        logger.warning("Cost snapshot: FinOps KPI fetch failed: %s", exc)


def build_cost_snapshot(subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Build the full cost bundle dict (does NOT persist).

    Bundle shape::

        {
          "captured_at": ISO8601,
          "subscription_key": "sub1,sub2",
          "total_daily_cm": [float, ...],   # current month, one per day
          "total_daily_pm": [float, ...],   # previous month, one per day
          "finops_kpi": {...} | None,       # serialised FinOpsKPI (cost_trend_30d, etc.)
        }
    """
    sub_ids = subscription_ids or get_subscription_ids()
    bundle = _new_bundle(sub_ids)
    if not sub_ids:
        logger.warning("Cost snapshot: no subscription IDs configured — empty bundle")
        return bundle
    _capture_total_daily(bundle, sub_ids)
    _capture_finops_kpi(bundle, sub_ids)
    return bundle


def capture_and_save(subscription_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Capture the cost bundle and persist it — in two stages so the critical home
    SpendTrend data lands fast even when Cost Management is heavily 429-throttled.

    Stage 1 (fast, ~seconds–1 min): capture the tenant total-daily series and
    **persist immediately**. This is what feeds the home "30-DAY SPEND TREND",
    so it must never be held hostage by the slower enrichment below.

    Stage 2 (best-effort, can take minutes under throttle): enrich with the
    FinOps KPI summary and re-persist. If this step is slow or fails, Stage 1's
    row is already safely in the database.
    """
    started = datetime.now(tz=timezone.utc)
    sub_ids = subscription_ids or get_subscription_ids()
    bundle = _new_bundle(sub_ids)

    if not sub_ids:
        logger.warning("Cost snapshot: no subscription IDs configured — nothing to capture")
        return {"ok": False, "error": "no subscription IDs configured"}

    # ── Stage 1: core total-daily → persist immediately ──────────────────────
    _capture_total_daily(bundle, sub_ids)
    persisted = False
    try:
        persistence_svc.save_cost_snapshot(bundle, subscription_key=bundle.get("subscription_key", ""))
        persisted = True
        logger.info(
            "Cost snapshot: core persisted (captured %s, %d cm days, %d pm days)",
            bundle["captured_at"], len(bundle.get("total_daily_cm", [])),
            len(bundle.get("total_daily_pm", [])),
        )
    except Exception as exc:
        logger.warning("Cost snapshot: core persist failed: %s", exc)

    # ── Stage 2: best-effort FinOps KPI enrichment → re-persist ──────────────
    _capture_finops_kpi(bundle, sub_ids)
    if bundle.get("finops_kpi") is not None:
        try:
            persistence_svc.save_cost_snapshot(bundle, subscription_key=bundle.get("subscription_key", ""))
            persisted = True
            logger.info("Cost snapshot: enriched with FinOps KPI and re-persisted")
        except Exception as exc:
            logger.warning("Cost snapshot: enriched persist failed: %s", exc)

    elapsed = (datetime.now(tz=timezone.utc) - started).total_seconds()
    if not persisted:
        return {"ok": False, "error": "persist failed", "elapsed_seconds": round(elapsed, 1)}
    return {
        "ok": True,
        "captured_at": bundle["captured_at"],
        "cm_days": len(bundle.get("total_daily_cm", [])),
        "pm_days": len(bundle.get("total_daily_pm", [])),
        "has_finops_kpi": bundle.get("finops_kpi") is not None,
        "elapsed_seconds": round(elapsed, 1),
    }


if __name__ == "__main__":
    import json as _json

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    result = capture_and_save()
    print(_json.dumps(result, indent=2, default=str))
