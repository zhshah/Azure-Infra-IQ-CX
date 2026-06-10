"""
FOCUS normalization service
============================

Maps this tool's Azure Cost Management / warehouse cost rows into the
**FinOps Open Cost and Usage Specification (FOCUS) 1.2** column set so the data
is portable and standards-compliant (the same schema the Microsoft FinOps
toolkit / FinOps Hubs emit).

Source of truth: the warehouse table ``finops_daily_resource_costs`` (resource-
level daily grain) — fast, offline Azure SQL reads, no live Cost Management
throttling. Each warehouse row becomes one FOCUS charge record.

Reference: https://focus.finops.org/  (FOCUS v1.2)
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── FOCUS 1.2 column order (core + a few x_ provider extensions) ──────────────
FOCUS_COLUMNS: List[str] = [
    "BillingAccountId", "BillingAccountName",
    "BillingPeriodStart", "BillingPeriodEnd",
    "ChargePeriodStart", "ChargePeriodEnd",
    "BilledCost", "EffectiveCost", "ListCost", "ContractedCost",
    "BillingCurrency",
    "ServiceName", "ServiceCategory",
    "ChargeCategory", "ChargeClass", "ChargeDescription",
    "ProviderName", "PublisherName", "InvoiceIssuerName",
    "ResourceId", "ResourceName", "ResourceType",
    "RegionId", "RegionName",
    "SubAccountId", "SubAccountName",
    "SkuId", "PricingQuantity", "ConsumedQuantity", "ConsumedUnit",
    "CommitmentDiscountId", "CommitmentDiscountType",
    "Tags",
    # provider-specific extensions (FOCUS allows x_ prefixed columns)
    "x_ResourceGroupName", "x_ServiceFamily", "x_MeterCategory",
]

# ── Azure ServiceFamily / ServiceName → FOCUS ServiceCategory ─────────────────
_CATEGORY_BY_FAMILY = {
    "compute": "Compute",
    "storage": "Storage",
    "networking": "Networking",
    "network": "Networking",
    "databases": "Databases",
    "database": "Databases",
    "web": "Web",
    "analytics": "Analytics",
    "ai + machine learning": "AI and Machine Learning",
    "ai and machine learning": "AI and Machine Learning",
    "ai+machine learning": "AI and Machine Learning",
    "internet of things": "Internet of Things",
    "iot": "Internet of Things",
    "security": "Security",
    "management and governance": "Management and Governance",
    "management + governance": "Management and Governance",
    "containers": "Compute",
    "integration": "Integration",
    "identity": "Identity",
    "developer tools": "Developer Tools",
    "mixed reality": "Multicloud",
    "migration": "Management and Governance",
    "monitor": "Management and Governance",
}

_KEYWORD_CATEGORY = [
    ("sql", "Databases"), ("cosmos", "Databases"), ("database", "Databases"),
    ("redis", "Databases"), ("postgres", "Databases"), ("mysql", "Databases"),
    ("storage", "Storage"), ("backup", "Storage"), ("disk", "Storage"),
    ("virtual machine", "Compute"), ("compute", "Compute"), ("container", "Compute"),
    ("kubernetes", "Compute"), ("app service", "Web"), ("function", "Compute"),
    ("network", "Networking"), ("bandwidth", "Networking"), ("dns", "Networking"),
    ("bastion", "Networking"), ("gateway", "Networking"), ("firewall", "Networking"),
    ("cognitive", "AI and Machine Learning"), ("openai", "AI and Machine Learning"),
    ("machine learning", "AI and Machine Learning"), ("search", "AI and Machine Learning"),
    ("foundry", "AI and Machine Learning"),
    ("defender", "Security"), ("sentinel", "Security"), ("key vault", "Security"),
    ("monitor", "Management and Governance"), ("log analytics", "Management and Governance"),
    ("advisor", "Management and Governance"), ("arc", "Management and Governance"),
    ("event", "Integration"), ("service bus", "Integration"), ("logic app", "Integration"),
    ("signalr", "Integration"), ("api management", "Integration"),
]


def service_category(service_family: str, service_name: str = "", meter_category: str = "") -> str:
    """Best-effort map to a FOCUS ServiceCategory."""
    fam = (service_family or "").strip().lower()
    if fam in _CATEGORY_BY_FAMILY:
        return _CATEGORY_BY_FAMILY[fam]
    hay = f"{service_name} {meter_category} {service_family}".lower()
    for kw, cat in _KEYWORD_CATEGORY:
        if kw in hay:
            return cat
    return "Other"


def _month_bounds(d: datetime) -> tuple[str, str]:
    start = d.replace(day=1)
    if start.month == 12:
        nxt = start.replace(year=start.year + 1, month=1)
    else:
        nxt = start.replace(month=start.month + 1)
    return start.strftime("%Y-%m-%dT00:00:00Z"), nxt.strftime("%Y-%m-%dT00:00:00Z")


def _to_dt(date_str: str) -> Optional[datetime]:
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            return datetime.strptime(date_str[:19] if "T" in date_str else date_str[:10], fmt)
        except (ValueError, TypeError):
            continue
    return None


def _sub_names() -> Dict[str, str]:
    """Best-effort subscription_id -> name map from the warehouse."""
    names: Dict[str, str] = {}
    try:
        from services.database import get_connection
        with get_connection() as con:
            con.execute(
                "SELECT DISTINCT subscription_id, subscription_name "
                "FROM finops_daily_subscription_costs"
            )
            for row in con.fetchall() or []:
                sid = row[0] if not isinstance(row, dict) else row.get("subscription_id")
                nm = row[1] if not isinstance(row, dict) else row.get("subscription_name")
                if sid:
                    names[str(sid)] = str(nm or sid)
    except Exception as exc:
        logger.debug("FOCUS: subscription name lookup failed: %s", exc)
    return names


def get_focus_records(
    subscription_ids: Optional[List[str]] = None,
    days: int = 30,
    limit: int = 5000,
) -> List[Dict[str, Any]]:
    """
    Read resource-level rows from the warehouse and return FOCUS 1.2 records.
    Returns an empty list (not an error) when the warehouse has no data.
    """
    try:
        from services.database import get_connection
    except Exception as exc:
        logger.warning("FOCUS: database unavailable: %s", exc)
        return []

    today = datetime.now(timezone.utc)
    from_date = (today - timedelta(days=max(days - 1, 0))).strftime("%Y-%m-%d")
    sub_names = _sub_names()

    where = ["snapshot_date >= ?"]
    params: List[Any] = [from_date]
    if subscription_ids:
        placeholders = ",".join("?" for _ in subscription_ids)
        where.append(f"subscription_id IN ({placeholders})")
        params.extend(subscription_ids)
    where_sql = " AND ".join(where)

    sql = (
        "SELECT snapshot_date, subscription_id, resource_id, resource_name, "
        "resource_group, resource_type, location, service_name, service_family, "
        "meter_category, cost_usd, currency "
        f"FROM finops_daily_resource_costs WHERE {where_sql} "
        "ORDER BY snapshot_date DESC, cost_usd DESC"
    )

    rows: List[Any] = []
    try:
        with get_connection() as con:
            con.execute(sql, params)
            rows = con.fetchall() or []
    except Exception as exc:
        logger.warning("FOCUS: warehouse query failed: %s", exc)
        return []

    def _col(row, idx, key):
        if isinstance(row, dict):
            return row.get(key)
        return row[idx]

    records: List[Dict[str, Any]] = []
    for row in rows[:limit]:
        snap = str(_col(row, 0, "snapshot_date") or "")
        sub_id = str(_col(row, 1, "subscription_id") or "")
        res_id = str(_col(row, 2, "resource_id") or "")
        res_name = str(_col(row, 3, "resource_name") or "")
        res_group = str(_col(row, 4, "resource_group") or "")
        res_type = str(_col(row, 5, "resource_type") or "")
        location = str(_col(row, 6, "location") or "")
        svc_name = str(_col(row, 7, "service_name") or "")
        svc_family = str(_col(row, 8, "service_family") or "")
        meter = str(_col(row, 9, "meter_category") or "")
        try:
            cost = float(_col(row, 10, "cost_usd") or 0)
        except (TypeError, ValueError):
            cost = 0.0
        currency = str(_col(row, 11, "currency") or "USD")

        cp_start_dt = _to_dt(snap) or today
        cp_end = (cp_start_dt + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00Z")
        bp_start, bp_end = _month_bounds(cp_start_dt)

        records.append({
            "BillingAccountId": "",
            "BillingAccountName": "",
            "BillingPeriodStart": bp_start,
            "BillingPeriodEnd": bp_end,
            "ChargePeriodStart": cp_start_dt.strftime("%Y-%m-%dT00:00:00Z"),
            "ChargePeriodEnd": cp_end,
            "BilledCost": round(cost, 4),
            "EffectiveCost": round(cost, 4),
            "ListCost": round(cost, 4),
            "ContractedCost": round(cost, 4),
            "BillingCurrency": currency,
            "ServiceName": svc_name or svc_family or "Azure",
            "ServiceCategory": service_category(svc_family, svc_name, meter),
            "ChargeCategory": "Usage",
            "ChargeClass": "",
            "ChargeDescription": meter or svc_name,
            "ProviderName": "Microsoft",
            "PublisherName": "Microsoft",
            "InvoiceIssuerName": "Microsoft",
            "ResourceId": res_id,
            "ResourceName": res_name,
            "ResourceType": res_type,
            "RegionId": location,
            "RegionName": location,
            "SubAccountId": sub_id,
            "SubAccountName": sub_names.get(sub_id, sub_id),
            "SkuId": "",
            "PricingQuantity": "",
            "ConsumedQuantity": "",
            "ConsumedUnit": "",
            "CommitmentDiscountId": "",
            "CommitmentDiscountType": "",
            "Tags": "",
            "x_ResourceGroupName": res_group,
            "x_ServiceFamily": svc_family,
            "x_MeterCategory": meter,
        })

    return records


def focus_summary(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Compliance/coverage summary for a FOCUS dataset."""
    total = sum(r.get("BilledCost", 0) for r in records)
    by_category: Dict[str, float] = {}
    for r in records:
        by_category[r["ServiceCategory"]] = by_category.get(r["ServiceCategory"], 0) + r.get("BilledCost", 0)
    return {
        "focus_version": "1.2",
        "record_count": len(records),
        "total_billed_cost": round(total, 2),
        "currency": records[0]["BillingCurrency"] if records else "USD",
        "columns": FOCUS_COLUMNS,
        "by_service_category": [
            {"category": k, "cost": round(v, 2)}
            for k, v in sorted(by_category.items(), key=lambda x: -x[1])
        ],
    }
