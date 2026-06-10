"""
FinOps Data Service — Core Azure Cost Management API layer.

All FinOps data is fetched LIVE from Azure Cost Management APIs using the exact
same API that Azure Portal Cost Analysis uses.  Numbers will be byte-for-byte
identical to what users see in portal.azure.com/cost-management.

Query pattern mirrors existing cost_service.py (same client, same retry logic,
same pagination helper, same per-subscription scope approach).
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from contextlib import contextmanager
from datetime import datetime, date, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── Azure SDK imports ──────────────────────────────────────────────────────────
try:
    from azure.mgmt.costmanagement import CostManagementClient
    from azure.mgmt.costmanagement.models import (
        QueryDefinition,
        QueryDataset,
        QueryGrouping,
        QueryAggregation,
        QueryTimePeriod,
        ForecastDefinition,
        ForecastDataset,
        TimeframeType,
    )
    _COST_SDK = True
except ImportError:
    _COST_SDK = False
    logger.warning("azure-mgmt-costmanagement not installed — FinOps data service unavailable")

# ── Credential helper ─────────────────────────────────────────────────────────
from .azure_auth import get_credential, get_subscription_ids as _azure_get_subscription_ids

# ── Database cache (same scans.db) ─────────────────────────────────────────────
from services.database import get_connection as _db_conn, upsert_sql, is_azure_sql

FINOPS_CACHE_TTL_MINUTES = 15   # refresh live data every 15 minutes

# ── Supported Azure Cost Management grouping dimensions ───────────────────────
# These are the exact dimension names the Azure portal uses in Cost Analysis.
VALID_DIMENSIONS = {
    "SubscriptionId",
    "ResourceGroupName",
    "ResourceType",
    "ServiceName",
    "ServiceFamily",
    "MeterCategory",
    "MeterSubCategory",
    "Product",
    "ResourceLocation",
    "ChargeType",
    "BillingMonth",
    "ReservationName",
    "PricingModel",
}


@contextmanager
def _conn():
    """Short-lived database connection via abstraction layer."""
    with _db_conn() as con:
        yield con


def _ensure_tables() -> None:
    if is_azure_sql():
        return  # Tables created by migration scripts for Azure SQL
    with _conn() as con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS finops_query_cache (
                cache_key   TEXT PRIMARY KEY,
                data_json   TEXT NOT NULL,
                expires_at  REAL NOT NULL,
                created_at  REAL NOT NULL
            )
        """)


_ensure_tables()


# ── Cache helpers ──────────────────────────────────────────────────────────────

def _make_cache_key(scope: str, params: dict) -> str:
    raw = json.dumps({"scope": scope, **params}, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()


def _get_cached(cache_key: str) -> Optional[Any]:
    try:
        with _conn() as con:
            row = con.execute(
                "SELECT data_json, expires_at FROM finops_query_cache WHERE cache_key=?",
                (cache_key,)
            ).fetchone()
            if row and row[1] > time.time():
                return json.loads(row[0])
    except Exception as e:
        logger.debug("FinOps cache read error: %s", e)
    return None


def _set_cached(cache_key: str, data: Any, ttl_minutes: int = FINOPS_CACHE_TTL_MINUTES) -> None:
    try:
        with _conn() as con:
            expires = time.time() + ttl_minutes * 60
            con.execute(
                upsert_sql("finops_query_cache", ["cache_key"], ["data_json", "expires_at", "created_at"]),
                (cache_key, json.dumps(data), expires, time.time())
            )
    except Exception as e:
        logger.debug("FinOps cache write error: %s", e)


def clear_finops_cache() -> int:
    """Remove all expired FinOps cache entries. Returns count removed."""
    try:
        with _conn() as con:
            cur = con.execute("DELETE FROM finops_query_cache WHERE expires_at <= ?", (time.time(),))
            return cur.rowcount
    except Exception:
        return 0


# ── Date range helpers ─────────────────────────────────────────────────────────

def resolve_time_range(time_range: str, date_from: Optional[str] = None, date_to: Optional[str] = None) -> Tuple[date, date]:
    """
    Convert a time_range preset or custom dates to (from_date, to_date).
    Mirrors the same presets shown in Azure Portal Cost Analysis.
    """
    today = datetime.now(tz=timezone.utc).date()

    if time_range == "custom" and date_from and date_to:
        return (
            date.fromisoformat(date_from),
            date.fromisoformat(date_to),
        )

    presets: Dict[str, Tuple[date, date]] = {
        "last_7d":    (today - timedelta(days=6),  today),
        "last_14d":   (today - timedelta(days=13), today),
        "last_30d":   (today - timedelta(days=29), today),
        "last_60d":   (today - timedelta(days=59), today),
        "last_90d":   (today - timedelta(days=89), today),
        "last_3mo":   (today - timedelta(days=89), today),
        "last_6mo":   (today - timedelta(days=179), today),
        "last_12mo":  (today - timedelta(days=364), today),
        "mtd":        (today.replace(day=1), today),
        "last_month": (
            (today.replace(day=1) - timedelta(days=1)).replace(day=1),
            today.replace(day=1) - timedelta(days=1),
        ),
        "ytd":        (today.replace(month=1, day=1), today),
    }
    return presets.get(time_range, presets["last_30d"])


# ── Core query wrapper ─────────────────────────────────────────────────────────

def _extract_skiptoken(next_link: Optional[str]) -> Optional[str]:
    """Extract $skiptoken from Azure Cost Management next_link URL."""
    if not next_link:
        return None
    if "$skiptoken=" in next_link:
        return next_link.split("$skiptoken=")[-1].split("&")[0]
    return None


def query_cost(
    scope: str,
    from_date: date,
    to_date: date,
    granularity: str = "None",
    group_by: Optional[List[str]] = None,
    cost_type: str = "ActualCost",
    extra_filters: Optional[dict] = None,
    use_cache: bool = True,
) -> List[Dict[str, Any]]:
    """
    Execute an Azure Cost Management query against `scope`.

    Returns a list of row dicts.  Column names are determined from the Azure
    response and normalized.  Handles pagination via skiptoken and retries 429.

    Mirrors the exact query pattern in cost_service.py.
    """
    if not _COST_SDK:
        return []

    cache_key = _make_cache_key(scope, {
        "from": str(from_date), "to": str(to_date),
        "gran": granularity, "grp": group_by or [],
        "type": cost_type,
    })
    if use_cache:
        cached = _get_cached(cache_key)
        if cached is not None:
            return cached

    try:
        credential = get_credential()
    except Exception as e:
        logger.warning("FinOps: could not get Azure credential: %s", e)
        return []

    client = CostManagementClient(credential)

    # Build grouping
    grouping = []
    for dim in (group_by or []):
        if dim.startswith("TagKey:"):
            tag_name = dim[len("TagKey:"):]
            grouping.append(QueryGrouping(type="TagKey", name=tag_name))
        elif dim in VALID_DIMENSIONS or dim.startswith("Tag"):
            grouping.append(QueryGrouping(type="Dimension", name=dim))

    query_def = QueryDefinition(
        type=cost_type,
        timeframe=TimeframeType.CUSTOM,
        time_period=QueryTimePeriod(
            from_property=datetime.combine(from_date, datetime.min.time()),
            to=datetime.combine(to_date, datetime.max.time().replace(microsecond=0)),
        ),
        dataset=QueryDataset(
            granularity=granularity if granularity != "None" else None,
            aggregation={"totalCost": QueryAggregation(name="Cost", function="Sum")},
            grouping=grouping if grouping else None,
        ),
    )

    rows: List[Dict[str, Any]] = []
    skiptoken: Optional[str] = None
    retry_delays = [5, 15, 30, 60]
    retry_idx = 0

    while True:
        try:
            response = client.query.usage(
                scope=scope,
                parameters=query_def,
                **({"skiptoken": skiptoken} if skiptoken else {}),
            )
            col_names = [c.name for c in response.columns]

            for row in (response.rows or []):
                row_dict: Dict[str, Any] = {}
                for i, val in enumerate(row):
                    row_dict[col_names[i] if i < len(col_names) else f"col_{i}"] = val
                rows.append(row_dict)

            skiptoken = _extract_skiptoken(response.next_link)
            if not skiptoken:
                break

        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "TooManyRequests" in err_str:
                if retry_idx < len(retry_delays):
                    wait = retry_delays[retry_idx]
                    retry_idx += 1
                    logger.warning("FinOps: 429 rate limit on %s — waiting %ds", scope, wait)
                    time.sleep(wait)
                    continue
                else:
                    logger.error("FinOps: sustained 429 on %s — giving up", scope)
                    break
            elif "403" in err_str or "Forbidden" in err_str or "NotFound" in err_str:
                logger.warning("FinOps: scope %s not accessible: %s", scope, e)
                break
            else:
                logger.error("FinOps: query_cost error on %s: %s", scope, e)
                break

    if use_cache:
        _set_cached(cache_key, rows)
    return rows


def query_cost_multi_subscription(
    subscription_ids: List[str],
    from_date: date,
    to_date: date,
    granularity: str = "None",
    group_by: Optional[List[str]] = None,
    cost_type: str = "ActualCost",
    use_cache: bool = True,
) -> List[Dict[str, Any]]:
    """
    Run query_cost across multiple subscriptions (serial with 3 s delay between
    subscriptions — same pattern as cost_service.py to stay within rate limits).
    Merges all rows and injects a SubscriptionId column when not already present.
    """
    all_rows: List[Dict[str, Any]] = []
    for i, sub_id in enumerate(subscription_ids):
        scope = f"/subscriptions/{sub_id}"
        rows  = query_cost(scope, from_date, to_date, granularity, group_by, cost_type, use_cache=use_cache)
        # Inject SubscriptionId for cross-subscription aggregation
        for r in rows:
            if "SubscriptionId" not in r:
                r["SubscriptionId"] = sub_id
        all_rows.extend(rows)
        if i < len(subscription_ids) - 1:
            time.sleep(3)   # respect Azure rate limits between subscriptions
    return all_rows


# ── Forecast query ─────────────────────────────────────────────────────────────

def query_forecast(
    scope: str,
    from_date: date,
    to_date: date,
    granularity: str = "Daily",
    cost_type: str = "ActualCost",
    use_cache: bool = True,
) -> List[Dict[str, Any]]:
    """
    Call CostManagementClient.forecast.usage() — Azure's own ML-based forecast.
    Same forecast Azure Portal shows in Cost Analysis.

    Falls back gracefully (returns empty list) if billing account type doesn't
    support the Forecast API (some subscription types return 403).
    """
    if not _COST_SDK:
        return []

    cache_key = _make_cache_key(scope, {
        "op": "forecast",
        "from": str(from_date), "to": str(to_date),
        "gran": granularity, "type": cost_type,
    })
    if use_cache:
        cached = _get_cached(cache_key)
        if cached is not None:
            return cached

    try:
        credential = get_credential()
    except Exception as e:
        logger.warning("FinOps forecast: could not get Azure credential: %s", e)
        return []

    client = CostManagementClient(credential)

    try:
        forecast_def = ForecastDefinition(
            type=cost_type,
            timeframe=TimeframeType.CUSTOM,
            time_period=QueryTimePeriod(
                from_property=datetime.combine(from_date, datetime.min.time()),
                to=datetime.combine(to_date, datetime.max.time().replace(microsecond=0)),
            ),
            dataset=ForecastDataset(
                granularity=granularity,
                aggregation={"totalCost": QueryAggregation(name="Cost", function="Sum")},
            ),
            include_actual_cost=True,
            include_fresh_partial_cost=False,
        )
        response = client.forecast.usage(scope=scope, parameters=forecast_def)
        col_names = [c.name for c in response.columns]
        rows = []
        for row in (response.rows or []):
            row_dict: Dict[str, Any] = {}
            for i, val in enumerate(row):
                row_dict[col_names[i] if i < len(col_names) else f"col_{i}"] = val
            rows.append(row_dict)

        if use_cache:
            _set_cached(cache_key, rows)
        return rows

    except Exception as e:
        err_str = str(e)
        if "403" in err_str or "Forbidden" in err_str or "BudgetDisabled" in err_str:
            logger.info("FinOps forecast: scope %s does not support Forecast API (403) — will use linear fallback", scope)
        else:
            logger.warning("FinOps forecast: query failed for %s: %s", scope, e)
        return []


# ── Linear regression fallback forecast ───────────────────────────────────────

def linear_regression_forecast(
    daily_costs: List[float],
    horizon_days: int = 90,
) -> List[float]:
    """
    Simple least-squares linear trend extrapolation used as fallback when Azure
    Forecast API is not available.  Returns `horizon_days` projected daily costs.
    """
    n = len(daily_costs)
    if n < 3:
        avg = sum(daily_costs) / n if n else 0.0
        return [max(0.0, avg)] * horizon_days

    x = list(range(n))
    mean_x = sum(x) / n
    mean_y = sum(daily_costs) / n

    num   = sum((xi - mean_x) * (yi - mean_y) for xi, yi in zip(x, daily_costs))
    denom = sum((xi - mean_x) ** 2 for xi in x)
    slope = num / denom if denom else 0.0
    intercept = mean_y - slope * mean_x

    return [max(0.0, intercept + slope * (n + i)) for i in range(horizon_days)]


# ── Subscription metadata helper ──────────────────────────────────────────────

def get_subscription_ids() -> List[str]:
    """Return all configured subscription IDs from azure_auth settings."""
    try:
        return _azure_get_subscription_ids()
    except Exception:
        return []


def get_subscription_names() -> Dict[str, str]:
    """
    Return a dict of {subscription_id: display_name}.
    Uses azure-mgmt-resource SubscriptionClient (already in requirements.txt).
    """
    try:
        from azure.mgmt.resource import SubscriptionClient
        credential = get_credential()
        client = SubscriptionClient(credential)
        return {
            s.subscription_id: s.display_name
            for s in client.subscriptions.list()
        }
    except Exception as e:
        logger.debug("Could not fetch subscription names: %s", e)
        return {}


# ── Row → structured dict normaliser ─────────────────────────────────────────

def normalise_cost_rows(
    rows: List[Dict[str, Any]],
    group_by: List[str],
    subscription_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Normalize raw Azure API rows into a consistent dict structure:
    {
      "date": "2026-04-01" | None,
      "cost_usd": 123.45,
      "dimensions": { "SubscriptionId": "...", "ResourceGroupName": "...", ... },
      "subscription_id": "...",
    }
    """
    out = []
    for row in rows:
        # Cost — try common column name variants
        cost = 0.0
        for key in ("Cost", "totalCost", "PreTaxCost", "CostUSD"):
            if key in row and row[key] is not None:
                cost = float(row[key])
                break

        # Date — present when granularity = Daily or Monthly
        date_str: Optional[str] = None
        for key in ("UsageDate", "BillingMonth", "BillingDay", "Date"):
            if key in row and row[key] is not None:
                raw_date = str(row[key])
                # Azure returns dates as int (20260401) or ISO string
                if raw_date.isdigit() and len(raw_date) == 8:
                    date_str = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:]}"
                else:
                    date_str = raw_date[:10]
                break

        # Dimension values
        dims: Dict[str, str] = {}
        for dim in group_by:
            col_name = dim if not dim.startswith("TagKey:") else dim[len("TagKey:"):]
            if col_name in row:
                dims[dim] = str(row[col_name]) if row[col_name] is not None else ""
            else:
                dims[dim] = ""

        out.append({
            "date": date_str,
            "cost_usd": cost,
            "dimensions": dims,
            "subscription_id": str(row.get("SubscriptionId", subscription_id or "")),
        })
    return out
