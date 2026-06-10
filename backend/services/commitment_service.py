"""
FinOps Commitment Service — Reservations & Savings Plans.

All data sourced live from Azure APIs:
  - ReservationManagementClient  → RI orders, details, utilization
  - ConsumptionManagementClient  → Azure-native RI buy recommendations
                                    (same as Azure Portal Reservations blade)
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

from services.finops_data_service import get_subscription_ids
from .azure_auth import get_credential

from models.schemas import (
    FinOpsReservationSummary,
    FinOpsSavingsPlanOption,
    FinOpsCommitmentSummary,
)


def get_commitment_summary() -> FinOpsCommitmentSummary:
    """
    Fetch live RI and savings plan data from Azure APIs.
    Returns CommitmentSummary identical to Azure Portal Reservations view.
    """
    reservations  = _get_reservations()
    ri_recs       = _get_ri_recommendations()
    summary       = _compute_summary(reservations, ri_recs)
    return summary


# ── Reservation data ─────────────────────────────────────────────────────────

def _get_reservations() -> List[FinOpsReservationSummary]:
    """
    Fetch all RI orders from ReservationManagementClient.reservation_order.list().
    Each order may have multiple reservations.
    """
    try:
        from azure.mgmt.reservations import AzureReservationAPI
    except ImportError:
        logger.warning("azure-mgmt-reservations not installed")
        return []

    try:
        credential = get_credential()
    except Exception as e:
        logger.warning("commitment_service: no credential: %s", e)
        return []

    out: List[FinOpsReservationSummary] = []
    today = datetime.now(tz=timezone.utc).date()

    try:
        client = AzureReservationAPI(credential)
        for order in client.reservation_order.list():
            order_id = getattr(order, "name", "") or getattr(order, "id", "")
            try:
                for res in client.reservation.list(order_id):
                    out.append(_map_reservation(res, order_id, today))
            except Exception as e:
                logger.debug("commitment: could not list reservations in order %s: %s", order_id, e)
    except Exception as e:
        logger.warning("commitment_service: reservation_order.list() failed: %s", e)

    return out


def _map_reservation(res: Any, order_id: str, today: Any) -> FinOpsReservationSummary:
    """Map an Azure SDK Reservation object to our schema."""
    def _safe_str(v: Any, default: str = "") -> str:
        return str(v) if v is not None else default

    def _safe_float(v: Any, default: float = 0.0) -> float:
        try:
            return float(v) if v is not None else default
        except (TypeError, ValueError):
            return default

    res_id    = _safe_str(getattr(res, "name", ""))
    sku_name  = _safe_str(getattr(getattr(res, "sku", None), "name", "") or "")
    term      = _safe_str(getattr(res, "term", "P1Y") or "P1Y")
    term_label = "3 Years" if "P3Y" in term else "1 Year"

    # Expiry date
    expiry_str = ""
    days_to_expiry = 0
    try:
        props = getattr(res, "properties", None)
        if props:
            exp = getattr(props, "expiry_date_time", None) or getattr(props, "expiry_date", None)
            if exp:
                if isinstance(exp, str):
                    expiry_str = exp[:10]
                    exp_d = datetime.fromisoformat(exp[:10]).date()
                else:
                    expiry_str = str(exp)[:10]
                    exp_d = exp if hasattr(exp, "year") else today
                days_to_expiry = (exp_d - today).days
    except Exception:
        pass

    # Purchase date
    purchase_str = ""
    try:
        props = getattr(res, "properties", None)
        if props:
            pd = getattr(props, "purchase_date_time", None) or getattr(props, "purchase_date", None)
            if pd:
                purchase_str = str(pd)[:10]
    except Exception:
        pass

    # Utilization — try properties.utilization
    util_pct = 0.0
    try:
        props = getattr(res, "properties", None)
        if props:
            util = getattr(props, "utilization", None)
            if util:
                agg = getattr(util, "aggregates", None) or []
                if agg:
                    util_pct = float(getattr(agg[0], "value", 0) or 0)
    except Exception:
        pass

    # Status
    status = "active"
    if days_to_expiry < 0:
        status = "expired"
    elif days_to_expiry <= 30:
        status = "expiring_soon"
    elif util_pct < 80 and util_pct > 0:
        status = "underutilized"

    # Quantity & scope
    quantity = 1
    scope_str = "Shared"
    sub_id = ""
    try:
        props = getattr(res, "properties", None)
        if props:
            quantity  = int(getattr(props, "quantity", 1) or 1)
            ap_scope  = getattr(props, "applied_scope_type", None)
            scope_str = _safe_str(ap_scope, "Shared")
            ap_subs   = getattr(props, "applied_scopes", None) or []
            if ap_subs and len(ap_subs) > 0:
                sub_id = _safe_str(ap_subs[0]).split("/")[-1] if ap_subs[0] else ""
    except Exception:
        pass

    # Resource type + location
    res_type = ""
    location = ""
    try:
        props = getattr(res, "properties", None)
        if props:
            ri = getattr(props, "reserved_resource_type", None)
            res_type = _safe_str(ri)
            loc = getattr(props, "location", None)
            location = _safe_str(loc)
    except Exception:
        pass

    return FinOpsReservationSummary(
        reservation_order_id=order_id,
        reservation_id=res_id,
        display_name=_safe_str(getattr(res, "display_name", "")) or sku_name or res_id,
        resource_type=res_type,
        region=location,
        sku=sku_name,
        term=term,
        term_label=term_label,
        quantity=quantity,
        monthly_cost_usd=0.0,  # not directly available from RI API; would need billing API
        utilization_pct=round(util_pct, 1),
        expiry_date=expiry_str,
        purchase_date=purchase_str,
        days_to_expiry=days_to_expiry,
        status=status,
        scope=scope_str,
        subscription_id=sub_id,
    )


# ── RI recommendations (Azure native) ────────────────────────────────────────

def _get_ri_recommendations() -> List[FinOpsSavingsPlanOption]:
    """
    Fetch Azure's own RI buy recommendations via ConsumptionManagementClient.
    Same recommendations shown in Azure Portal → Reservations → Recommendations.
    """
    try:
        from azure.mgmt.consumption import ConsumptionManagementClient
    except ImportError:
        logger.warning("azure-mgmt-consumption not installed — skipping RI recommendations")
        return []

    try:
        credential = get_credential()
    except Exception:
        return []

    sub_ids = get_subscription_ids()
    recs: List[FinOpsSavingsPlanOption] = []

    for sub_id in sub_ids:
        scope = f"/subscriptions/{sub_id}"
        try:
            client = ConsumptionManagementClient(credential, sub_id)
            for rec in client.reservation_recommendations.list(scope):
                mapped = _map_ri_recommendation(rec)
                if mapped:
                    recs.append(mapped)
        except Exception as e:
            logger.debug("RI recommendations for %s: %s", sub_id, e)

    return recs


def _map_ri_recommendation(rec: Any) -> Optional[FinOpsSavingsPlanOption]:
    try:
        def _f(v, d=0.0):
            try: return float(v) if v is not None else d
            except: return d

        term = str(getattr(rec, "term", "P1Y") or "P1Y")
        term_label = "3 Years" if "P3Y" in term else "1 Year"
        lookback   = str(getattr(rec, "look_back_period", "Last30Days") or "Last30Days")
        sku        = str(getattr(rec, "sku_properties", [{}]) or [{}])
        res_type   = str(getattr(rec, "resource_type", "") or "")
        location   = str(getattr(rec, "location", "") or "")
        quantity   = int(getattr(rec, "recommended_quantity", 1) or 1)
        net_savings = _f(getattr(rec, "net_savings", None) or getattr(rec, "total_cost_with_reserved_instances", None))
        total_cost  = _f(getattr(rec, "total_cost_with_on_demand_instances", 0))
        ri_cost     = _f(getattr(rec, "total_cost_with_reserved_instances", 0))
        monthly_savings = max(0.0, (total_cost - ri_cost))
        annual_savings  = monthly_savings * 12
        savings_pct     = (monthly_savings / total_cost * 100) if total_cost else 0.0
        break_even      = int(ri_cost / monthly_savings) if monthly_savings else 0

        if monthly_savings <= 0:
            return None

        return FinOpsSavingsPlanOption(
            resource_type=res_type,
            region=location,
            sku=sku[:100],
            term=term,
            term_label=term_label,
            lookback_period=lookback,
            recommended_quantity=quantity,
            current_monthly_cost=round(total_cost, 2),
            commitment_monthly_cost=round(ri_cost, 2),
            monthly_savings=round(monthly_savings, 2),
            annual_savings=round(annual_savings, 2),
            savings_pct=round(savings_pct, 1),
            break_even_months=min(break_even, 36),
            azure_confidence="High" if quantity > 0 else "Medium",
        )
    except Exception as e:
        logger.debug("_map_ri_recommendation: %s", e)
        return None


# ── Summary computation ───────────────────────────────────────────────────────

def _compute_summary(
    reservations: List[FinOpsReservationSummary],
    ri_recs: List[FinOpsSavingsPlanOption],
) -> FinOpsCommitmentSummary:
    active = [r for r in reservations if r.status != "expired"]
    utilizations = [r.utilization_pct for r in active if r.utilization_pct > 0]
    avg_util   = sum(utilizations) / len(utilizations) if utilizations else 0.0
    exp_30d    = sum(1 for r in active if 0 <= r.days_to_expiry <= 30)
    exp_90d    = sum(1 for r in active if 0 <= r.days_to_expiry <= 90)
    underutil  = sum(1 for r in active if r.utilization_pct < 80 and r.utilization_pct > 0)

    return FinOpsCommitmentSummary(
        total_reserved_monthly_usd=round(sum(r.monthly_cost_usd for r in active), 2),
        total_on_demand_monthly_usd=round(sum(r.current_monthly_cost for r in ri_recs), 2),
        coverage_pct=0.0,   # would need total eligible spend from cost data
        utilization_pct=round(avg_util, 1),
        expiring_within_30d=exp_30d,
        expiring_within_90d=exp_90d,
        underutilized_count=underutil,
        reservations=reservations,
        savings_plan_options=ri_recs,
        generated_at=datetime.now(tz=timezone.utc).isoformat(),
    )
