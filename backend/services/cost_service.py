"""
Pulls actual billed costs from Azure Cost Management for current and previous month,
broken down to individual resource IDs. Supports multiple subscriptions.
"""
from __future__ import annotations

import logging
import os
import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse, parse_qs
from dateutil.relativedelta import relativedelta
from typing import Dict, List, Optional, Tuple

from azure.mgmt.costmanagement import CostManagementClient
from azure.mgmt.costmanagement.models import (
    QueryDefinition,
    QueryTimePeriod,
    QueryDataset,
    QueryAggregation,
    QueryGrouping,
    QueryFilter,
    QueryComparisonExpression,
    TimeframeType,
)

from .azure_auth import get_credential, get_subscription_ids

logger = logging.getLogger(__name__)


def _extract_skiptoken(next_link: str) -> Optional[str]:
    """
    Azure Cost Management next_link is a full URL.
    The SDK's skiptoken parameter wants just the token value, not the whole URL.
    Extract it from the $skiptoken query param, or fall back to the raw value.
    """
    if not next_link:
        return None
    try:
        qs = parse_qs(urlparse(next_link).query)
        return qs.get("$skiptoken", qs.get("skiptoken", [next_link]))[0]
    except Exception:
        return next_link


def _query_with_retry(
    client: "CostManagementClient",
    scope: str,
    parameters: "QueryDefinition",
    max_retries: int = 2,
    initial_delay: float = 6.0,
    **kwargs,
):
    """
    Wraps client.query.usage with automatic retry on Azure Cost Management 429
    (Too Many Requests) responses.  Respects the Retry-After response header when
    present (capped); otherwise uses exponential back-off with ±20 % jitter:
    ~6 s, ~12 s between attempts (max 2 retries).

    Back-off is deliberately bounded so a throttled Cost Management API can never
    hang the live dashboard build for minutes. On exhaustion the caller degrades
    to partial / 2-hour-cached cost figures instead of zeroes.
    """
    delay = initial_delay
    for attempt in range(max_retries + 1):
        try:
            return client.query.usage(scope=scope, parameters=parameters, **kwargs)
        except Exception as exc:
            is_rate_limit = (
                "429" in str(exc)
                or getattr(exc, "status_code", None) == 429
                or "too many requests" in str(exc).lower()
            )
            if is_rate_limit and attempt < max_retries:
                # Respect Retry-After header if the SDK surfaces it
                retry_after = None
                for attr in ("retry_after", "headers"):
                    val = getattr(exc, attr, None)
                    if val:
                        if isinstance(val, (int, float)):
                            retry_after = float(val)
                        elif hasattr(val, "get"):
                            ra = val.get("Retry-After") or val.get("retry-after")
                            if ra:
                                try:
                                    retry_after = float(ra)
                                except (ValueError, TypeError):
                                    pass
                        break

                if retry_after and retry_after > 0:
                    # Cap honoured Retry-After so a large server hint can't stall
                    # the live build — we degrade to cached costs instead.
                    wait = min(retry_after + random.uniform(0, 3), 20)
                    logger.warning(
                        "Cost Management 429 on %s — honouring Retry-After (capped) %.0f s (attempt %d/%d)",
                        scope, wait, attempt + 1, max_retries,
                    )
                else:
                    wait = delay + random.uniform(-delay * 0.2, delay * 0.2)
                    logger.warning(
                        "Cost Management 429 on %s — retrying in %.0f s (attempt %d/%d)",
                        scope, wait, attempt + 1, max_retries,
                    )
                time.sleep(wait)
                delay = min(delay * 2, 20)
                continue
            raise


def _month_range(year: int, month: int) -> Tuple[datetime, datetime]:
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = start + relativedelta(months=1) - relativedelta(days=1)
    end = datetime(end.year, end.month, end.day, 23, 59, 59, tzinfo=timezone.utc)
    return start, end


def _query_costs(
    client: CostManagementClient,
    scope: str,
    start: datetime,
    end: datetime,
) -> Tuple[Dict[str, float], Optional[str]]:
    """Return ({resource_id_lower: cost_usd}, error_str) for the given period."""
    query = QueryDefinition(
        type="ActualCost",
        timeframe=TimeframeType.CUSTOM,
        time_period=QueryTimePeriod(from_property=start, to=end),
        dataset=QueryDataset(
            granularity="None",
            aggregation={"totalCost": QueryAggregation(name="Cost", function="Sum")},
            grouping=[
                QueryGrouping(type="Dimension", name="ResourceId"),
                QueryGrouping(type="Dimension", name="ResourceType"),
                QueryGrouping(type="Dimension", name="ResourceGroupName"),
            ],
        ),
    )

    result: Dict[str, float] = {}
    try:
        response = _query_with_retry(client, scope, query)
        if not response or not response.rows:
            logger.warning("Cost query returned no rows for %s (%s–%s)", scope, start.date(), end.date())
            return result, None

        col_names = [c.name for c in response.columns]
        logger.debug("Cost query columns for %s: %s", scope, col_names)

        # Azure Cost Management may return the aggregation key ("totalCost") or
        # the aggregation name field ("Cost") as the column name depending on the
        # SDK version and billing scope type.  Try both.
        cost_idx: Optional[int] = None
        for candidate in ("Cost", "totalCost", "PreTaxCost"):
            if candidate in col_names:
                cost_idx = col_names.index(candidate)
                break
        if cost_idx is None:
            msg = f"Cost column not found — columns returned: {col_names}"
            logger.error("Cost column not found in response for %s. Columns returned: %s", scope, col_names)
            return result, msg

        rid_idx  = col_names.index("ResourceId")

        for row in response.rows:
            rid  = str(row[rid_idx]).lower().strip()
            cost = float(row[cost_idx])
            if rid:
                result[rid] = result.get(rid, 0.0) + cost
    except Exception as exc:
        msg = type(exc).__name__ + ": " + str(exc)
        logger.error("Cost query failed for %s (%s–%s): %s", scope, start.date(), end.date(), exc)
        return result, msg

    return result, None


# ── In-process cost data cache ─────────────────────────────────────────────────
# When Azure Cost Management returns 429, we fall back to the last successful
# result (if fetched within 2 hours) so the dashboard doesn't show $0 for
# everything. The cache is keyed by a frozenset of subscription IDs.
_cost_cache: Dict[str, dict] = {}   # key → {"current": ..., "previous": ..., "ts": float}
_COST_CACHE_TTL = 7200              # 2 hours — cost data doesn't change minute-to-minute


def get_two_month_costs(
    subscription_ids: Optional[List[str]] = None,
) -> Tuple[Dict[str, float], Dict[str, float], Optional[str]]:
    """
    Returns (current_month_costs, previous_month_costs, error_str) where each cost dict is
    {resource_id_lower: cost_usd}, aggregated across all subscriptions.
    error_str is None on success or a human-readable error string on failure.

    On 429 / transient errors, falls back to the last cached result (up to 2 h old)
    so the dashboard never shows $0 just because Cost Management is rate-limiting.
    """
    credential = get_credential()
    sub_ids    = subscription_ids or get_subscription_ids()
    cache_key  = "|".join(sorted(sub_ids))
    client     = CostManagementClient(credential)

    now = datetime.now(tz=timezone.utc)
    curr_start, curr_end = _month_range(now.year, now.month)
    prev_dt = now - relativedelta(months=1)
    prev_start, prev_end = _month_range(prev_dt.year, prev_dt.month)

    current:  Dict[str, float] = {}
    previous: Dict[str, float] = {}
    first_error: Optional[str] = None

    def _one_sub(sub_id: str):
        scope = f"/subscriptions/{sub_id}"
        logger.info("[%s] Fetching current month costs (%s – %s)", sub_id, curr_start.date(), curr_end.date())
        curr, err_c = _query_costs(client, scope, curr_start, curr_end)
        logger.info("[%s] Fetching previous month costs (%s – %s)", sub_id, prev_start.date(), prev_end.date())
        prev, err_p = _query_costs(client, scope, prev_start, prev_end)
        return curr, prev, (err_c or err_p)

    def _merge(curr, prev, err):
        nonlocal first_error
        if err and not first_error:
            first_error = err
        for rid, cost in curr.items():
            current[rid] = current.get(rid, 0.0) + cost
        for rid, cost in prev.items():
            previous[rid] = previous.get(rid, 0.0) + cost

    try:
        seq_max = int(os.getenv("COST_SEQUENTIAL_MAX", "12"))
    except (TypeError, ValueError):
        seq_max = 12

    if len(sub_ids) <= seq_max:
        # Small / medium tenants — keep the ORIGINAL gentle sequential path with brief
        # spacing between Cost Management calls. Cost Management's rate limit is tenant-
        # shared, so for the common case (a handful of subscriptions) staying sequential
        # avoids 429s entirely — exactly the well-behaved behavior that works today.
        for i, sub_id in enumerate(sub_ids):
            if i > 0:
                time.sleep(3.0)
            scope = f"/subscriptions/{sub_id}"
            logger.info("[%s] Fetching current month costs (%s – %s)", sub_id, curr_start.date(), curr_end.date())
            curr, err = _query_costs(client, scope, curr_start, curr_end)
            if err and not first_error:
                first_error = err
            time.sleep(2.0)
            logger.info("[%s] Fetching previous month costs (%s – %s)", sub_id, prev_start.date(), prev_end.date())
            prev, err = _query_costs(client, scope, prev_start, prev_end)
            if err and not first_error:
                first_error = err
            for rid, cost in curr.items():
                current[rid] = current.get(rid, 0.0) + cost
            for rid, cost in prev.items():
                previous[rid] = previous.get(rid, 0.0) + cost
    else:
        # LARGE tenants (many subscriptions) — the sequential 3 s + 2 s spacing above would
        # take ~N×9 s (e.g. ~8.5 min at 100 subs), the "never finishes / shows empty" symptom
        # at scale. Run a BOUNDED number of subscriptions concurrently instead; the existing
        # _query_with_retry backs off on 429. Concurrency stays low to respect the tenant-
        # shared limit. Tunable via COST_SEQUENTIAL_MAX (threshold) and COST_QUERY_CONCURRENCY.
        try:
            max_workers = max(2, min(int(os.getenv("COST_QUERY_CONCURRENCY", "4")), len(sub_ids)))
        except (TypeError, ValueError):
            max_workers = 4
        logger.info("Cost: %d subscriptions — using bounded concurrency (%d workers)", len(sub_ids), max_workers)
        with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="cost2mo") as pool:
            for fut in as_completed([pool.submit(_one_sub, s) for s in sub_ids]):
                _merge(*fut.result())

    # ── Cache fallback on rate-limit / total failure ───────────────────────────
    if first_error and not current and not previous:
        cached = _cost_cache.get(cache_key)
        if cached and (time.time() - cached["ts"]) < _COST_CACHE_TTL:
            age_min = int((time.time() - cached["ts"]) / 60)
            logger.warning(
                "Cost Management returned an error (%s) — using cached cost data (%d min old). "
                "Dashboard figures may be slightly stale but are NOT zeroed out.",
                first_error, age_min,
            )
            return (
                cached["current"],
                cached["previous"],
                f"Cost data temporarily unavailable (rate limit). Showing figures from {age_min} minutes ago.",
            )
        # No cache available — return the error as-is
        logger.error(
            "Cost query returned NO data across %d subscription(s) and no cache is available. "
            "Check that the service principal has the Cost Management Reader role "
            "at the subscription scope. Common errors appear above.",
            len(sub_ids),
        )
        return current, previous, first_error

    if not current and not previous:
        logger.error(
            "Cost query returned NO data across %d subscription(s). "
            "Check that the service principal has the Cost Management Reader role "
            "at the subscription scope. Common errors appear above.",
            len(sub_ids),
        )
    else:
        logger.info(
            "Cost query complete: %d current, %d previous resources across %d subscription(s)",
            len(current), len(previous), len(sub_ids),
        )
        # Save successful result to cache so we can fall back to it on future 429s
        if current or previous:
            _cost_cache[cache_key] = {"current": current, "previous": previous, "ts": time.time()}

    return current, previous, first_error


def _query_total(
    client: CostManagementClient, scope: str, start: datetime, end: datetime,
) -> Tuple[float, Optional[str]]:
    """
    Ungrouped (granularity None) total ActualCost for the period — the CHEAPEST Cost
    Management query. It keeps succeeding when the heavy per-resource (ResourceId-
    grouped) query is being 429-throttled, so it is used as the headline-figure
    fallback. Returns (total_cost, error_str).
    """
    query = QueryDefinition(
        type="ActualCost",
        timeframe=TimeframeType.CUSTOM,
        time_period=QueryTimePeriod(from_property=start, to=end),
        dataset=QueryDataset(
            granularity="None",
            aggregation={"totalCost": QueryAggregation(name="Cost", function="Sum")},
        ),
    )
    try:
        resp = _query_with_retry(client, scope, query)
        if resp and resp.rows:
            return float(resp.rows[0][0] or 0.0), None
        return 0.0, None
    except Exception as exc:
        logger.warning("Total cost query failed for %s: %s", scope, exc)
        err = "Cost Management rate-limited (429)" if "429" in str(exc) else str(exc)[:160]
        return 0.0, err


def get_subscription_month_totals(
    subscription_ids: Optional[List[str]] = None,
) -> Tuple[Dict[str, Dict[str, float]], Optional[str]]:
    """
    Cheap per-subscription headline totals: current + previous month TOTAL cost
    (ungrouped). Used as a fallback for the home 'Monthly Spend' card and the scope
    badge when the heavy per-resource cost query is 429-throttled to $0 — so real
    spend is never shown as $0. Returns ({sub_id: {"current","previous"}}, error_str).
    """
    credential = get_credential()
    sub_ids    = subscription_ids or get_subscription_ids()
    client     = CostManagementClient(credential)

    now = datetime.now(tz=timezone.utc)
    curr_start, curr_end = _month_range(now.year, now.month)
    prev_dt = now - relativedelta(months=1)
    prev_start, prev_end = _month_range(prev_dt.year, prev_dt.month)

    out: Dict[str, Dict[str, float]] = {}
    first_error: Optional[str] = None
    for i, sub_id in enumerate(sub_ids):
        if i > 0:
            time.sleep(1.5)   # space out to avoid tenant-shared 429s
        scope = f"/subscriptions/{sub_id}"
        c, err = _query_total(client, scope, curr_start, curr_end)
        if err and not first_error:
            first_error = err
        time.sleep(1.0)
        p, err = _query_total(client, scope, prev_start, prev_end)
        if err and not first_error:
            first_error = err
        out[sub_id] = {"current": round(c, 2), "previous": round(p, 2)}

    return out, first_error


def get_reservation_covered_resource_ids(
    subscription_ids: Optional[List[str]] = None,
) -> set:
    """
    Returns a set of lowercase resource IDs that were billed under reservation
    pricing (PricingModel = 'Reservation') in the current month.

    Uses AmortizedCost so the benefit is spread across each covered resource
    rather than appearing as a lump-sum on the reservation order.
    Requires only Cost Management Reader — no Reservations API permission needed.
    """
    from typing import Set
    credential = get_credential()
    sub_ids = subscription_ids or get_subscription_ids()
    client  = CostManagementClient(credential)

    now   = datetime.now(tz=timezone.utc)
    start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    end   = datetime(now.year, now.month, now.day, 23, 59, 59, tzinfo=timezone.utc)

    covered: Set[str] = set()

    for sub_id in sub_ids:
        scope = f"/subscriptions/{sub_id}"
        try:
            query = QueryDefinition(
                type="AmortizedCost",
                timeframe=TimeframeType.CUSTOM,
                time_period=QueryTimePeriod(from_property=start, to=end),
                dataset=QueryDataset(
                    granularity="None",
                    aggregation={"totalCost": QueryAggregation(name="Cost", function="Sum")},
                    grouping=[QueryGrouping(type="Dimension", name="ResourceId")],
                    filter=QueryFilter(
                        dimensions=QueryComparisonExpression(
                            name="PricingModel",
                            operator="In",
                            values=["Reservation"],
                        )
                    ),
                ),
            )
            response = _query_with_retry(client, scope, query)
            if response and response.rows:
                col_names = [c.name for c in response.columns]
                rid_idx   = col_names.index("ResourceId")
                for row in response.rows:
                    rid = str(row[rid_idx]).lower().strip()
                    if rid and rid != "unassigned":
                        covered.add(rid)
        except Exception as exc:
            logger.warning("Reservation billing coverage failed for %s: %s", sub_id, exc)

    logger.info("Found %d reservation-covered resource IDs from billing data", len(covered))
    return covered


def get_monthly_cost_history(
    months: int = 6,
    subscription_ids: Optional[List[str]] = None,
) -> Dict[str, List[float]]:
    """
    Returns {resource_id_lower: [cost_oldest, ..., cost_newest]} covering the last N
    months (including the current partial month). One monthly-granularity query per sub.
    """
    credential = get_credential()
    sub_ids    = subscription_ids or get_subscription_ids()
    client     = CostManagementClient(credential)

    now = datetime.now(tz=timezone.utc)
    # Build ordered month key list: "YYYY-MM", oldest → newest
    month_keys: List[str] = [
        f"{(now - relativedelta(months=i)).year}-{(now - relativedelta(months=i)).month:02d}"
        for i in range(months - 1, -1, -1)
    ]

    oldest = now - relativedelta(months=months - 1)
    start  = datetime(oldest.year, oldest.month, 1, tzinfo=timezone.utc)
    end    = datetime(now.year, now.month, 1, tzinfo=timezone.utc) + relativedelta(months=1) - timedelta(seconds=1)

    query = QueryDefinition(
        type="ActualCost",
        timeframe=TimeframeType.CUSTOM,
        time_period=QueryTimePeriod(from_property=start, to=end),
        dataset=QueryDataset(
            granularity="Monthly",
            aggregation={"totalCost": QueryAggregation(name="Cost", function="Sum")},
            grouping=[QueryGrouping(type="Dimension", name="ResourceId")],
        ),
    )

    monthly_map: Dict[str, Dict[str, float]] = {}

    for sub_id in sub_ids:
        scope = f"/subscriptions/{sub_id}"
        try:
            response = _query_with_retry(client, scope, query)
            if not response or not response.rows:
                continue

            col_names = [c.name for c in response.columns]
            cost_idx  = col_names.index("Cost")
            rid_idx   = col_names.index("ResourceId")
            date_idx  = next(
                (i for i, c in enumerate(response.columns)
                 if "date" in c.name.lower() or "month" in c.name.lower()),
                None,
            )

            MAX_PAGES = 10  # cap monthly history pagination
            page = 0
            while page < MAX_PAGES:
                page += 1
                for row in response.rows:
                    rid      = str(row[rid_idx]).lower().strip()
                    cost     = float(row[cost_idx])
                    # Monthly granularity returns YYYYMMDD as integer (first of month)
                    date_raw = str(int(row[date_idx])) if date_idx is not None else ""
                    month_key = f"{date_raw[:4]}-{date_raw[4:6]}" if len(date_raw) >= 6 else date_raw[:7]
                    if rid and month_key in month_keys:
                        monthly_map.setdefault(rid, {})
                        monthly_map[rid][month_key] = monthly_map[rid].get(month_key, 0.0) + cost

                token = _extract_skiptoken(getattr(response, "next_link", None))
                if not token:
                    break
                if page >= MAX_PAGES:
                    logger.info("[%s] Monthly cost history page cap (%d) reached", sub_id, MAX_PAGES)
                    break
                response = _query_with_retry(client, scope, query, skiptoken=token)

        except Exception as exc:
            logger.warning("[%s] Monthly cost history query failed: %s", sub_id, exc)

    return {
        rid: [month_costs.get(mk, 0.0) for mk in month_keys]
        for rid, month_costs in monthly_map.items()
    }


def get_total_daily_costs(
    subscription_ids: Optional[List[str]] = None,
    days: Optional[int] = None,
) -> Tuple[List[float], List[float]]:
    """
    Returns (curr_month_daily_totals, prev_month_daily_totals) as flat arrays.

    Queries daily costs aggregated by date only — no ResourceId grouping — so the
    response is at most ~62 rows (prev month + current month to today).  This avoids
    the 1 000-row pagination problem that truncates per-resource daily data.

    When ``days`` is given (e.g. 7) the query window is narrowed to just the last
    ``days`` calendar days — a lighter, faster query used for the instant "quick
    paint" of the home spend trend on a fast open. The return shape is unchanged
    (arrays keyed by calendar day); days outside the window are simply 0.
    """
    credential = get_credential()
    sub_ids    = subscription_ids or get_subscription_ids()
    client     = CostManagementClient(credential)

    now   = datetime.now(tz=timezone.utc)
    today = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)

    # Span: last `days` days (quick paint) OR start of previous calendar month → end of today
    if days and days > 0:
        first_of_prev = today - timedelta(days=days - 1)
    else:
        first_of_prev = datetime(now.year, now.month, 1, tzinfo=timezone.utc) - relativedelta(months=1)
    end            = datetime(now.year, now.month, now.day, 23, 59, 59, tzinfo=timezone.utc)

    query = QueryDefinition(
        type="ActualCost",
        timeframe=TimeframeType.CUSTOM,
        time_period=QueryTimePeriod(from_property=first_of_prev, to=end),
        dataset=QueryDataset(
            granularity="Daily",
            aggregation={"totalCost": QueryAggregation(name="Cost", function="Sum")},
            # No grouping → daily grand-total, one row per day (~62 rows max)
        ),
    )

    by_date: Dict[str, float] = {}

    for sub_id in sub_ids:
        scope = f"/subscriptions/{sub_id}"
        try:
            response = _query_with_retry(client, scope, query)
            if not response or not response.rows:
                continue

            col_names = [c.name for c in response.columns]
            cost_idx  = next(
                (col_names.index(c) for c in ("Cost", "totalCost", "PreTaxCost") if c in col_names),
                None,
            )
            date_idx  = next(
                (i for i, c in enumerate(response.columns) if "date" in c.name.lower()),
                None,
            )
            if cost_idx is None or date_idx is None:
                logger.warning("[%s] Total daily cost: unexpected columns %s", sub_id, col_names)
                continue

            for row in response.rows:
                cost     = float(row[cost_idx])
                date_val = str(row[date_idx])
                if len(date_val) == 8 and date_val.isdigit():
                    date_str = f"{date_val[:4]}-{date_val[4:6]}-{date_val[6:8]}"
                else:
                    date_str = date_val[:10]
                if date_str:
                    by_date[date_str] = by_date.get(date_str, 0.0) + cost

        except Exception as exc:
            logger.warning("[%s] Total daily cost query failed: %s", sub_id, exc)

    # Build same shape as _month_daily_arrays but using the aggregated data
    curr = [
        round(by_date.get(f"{now.year}-{now.month:02d}-{day:02d}", 0.0), 4)
        for day in range(1, today.day + 1)
    ]

    first_of_this = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    last_of_prev  = first_of_this - timedelta(days=1)
    pv_year, pv_month, days_in_prev = last_of_prev.year, last_of_prev.month, last_of_prev.day
    prev = [
        round(by_date.get(f"{pv_year}-{pv_month:02d}-{day:02d}", 0.0), 4)
        for day in range(1, days_in_prev + 1)
    ]

    logger.info(
        "Total daily costs: %d days curr, %d days prev, %.2f curr total, %.2f prev total",
        len(curr), len(prev), sum(curr), sum(prev),
    )
    return curr, prev


def get_daily_costs(
    days: int = 60,
    subscription_ids: Optional[List[str]] = None,
) -> Dict[str, list]:
    """
    Returns {resource_id_lower: [(date_str, cost), ...]} for the last N days,
    aggregated across all subscriptions.
    """
    credential = get_credential()
    sub_ids    = subscription_ids or get_subscription_ids()
    client     = CostManagementClient(credential)

    now   = datetime.now(tz=timezone.utc)
    start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc) - timedelta(days=days)
    end   = datetime(now.year, now.month, now.day, 23, 59, 59, tzinfo=timezone.utc)

    query = QueryDefinition(
        type="ActualCost",
        timeframe=TimeframeType.CUSTOM,
        time_period=QueryTimePeriod(from_property=start, to=end),
        dataset=QueryDataset(
            granularity="Daily",
            aggregation={"totalCost": QueryAggregation(name="Cost", function="Sum")},
            grouping=[QueryGrouping(type="Dimension", name="ResourceId")],
        ),
    )

    # Accumulate: {rid: {date_str: cost}}
    daily_map: Dict[str, Dict[str, float]] = {}

    for sub_id in sub_ids:
        scope = f"/subscriptions/{sub_id}"
        try:
            response = _query_with_retry(client, scope, query)
            if not response or not response.rows:
                continue

            col_names = [c.name for c in response.columns]
            cost_idx  = col_names.index("Cost")
            rid_idx   = col_names.index("ResourceId")
            date_idx  = next(
                (i for i, c in enumerate(response.columns) if "date" in c.name.lower()),
                None,
            )

            # Azure Cost Management caps responses at 1 000 rows and paginates via
            # next_link. Without following the link, resources past the cutoff get
            # zero daily data and appear flat on the trend graph.
            MAX_PAGES = 15  # cap at 15,000 rows to prevent multi-minute scans
            page = 0
            while page < MAX_PAGES:
                page += 1
                for row in response.rows:
                    rid      = str(row[rid_idx]).lower().strip()
                    cost     = float(row[cost_idx])
                    date_val = str(row[date_idx]) if date_idx is not None else ""
                    if len(date_val) == 8 and date_val.isdigit():
                        date_str = f"{date_val[:4]}-{date_val[4:6]}-{date_val[6:8]}"
                    else:
                        date_str = date_val[:10]
                    if rid:
                        daily_map.setdefault(rid, {})
                        daily_map[rid][date_str] = daily_map[rid].get(date_str, 0.0) + cost

                token = _extract_skiptoken(getattr(response, "next_link", None))
                if not token:
                    break
                if page >= MAX_PAGES:
                    logger.info("[%s] Daily cost page cap (%d) reached — stopping pagination", sub_id, MAX_PAGES)
                    break
                response = _query_with_retry(client, scope, query, skiptoken=token)

        except Exception as exc:
            logger.warning("[%s] Daily cost query failed: %s", sub_id, exc)

    # Convert to sorted list of tuples
    result: Dict[str, list] = {
        rid: sorted(dates.items())
        for rid, dates in daily_map.items()
    }
    return result
