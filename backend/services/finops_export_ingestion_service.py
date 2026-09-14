"""
Load Azure Cost Management exports from ADLS Gen2 into the FinOps warehouse.

Why this exists
---------------
Pulling bulk cost data through the Cost Management query API from inside the web
application was never reliable at this data size: the query API paginates, throttles
and restates, and a partial answer is indistinguishable from "no cost". Microsoft's
guidance for recurring unaggregated cost data is to use scheduled Exports, which drop
complete files into storage.

So extraction is now Azure's job. This module only does ingestion:

    ADLS Gen2 export files -> validate -> aggregate -> one SQL transaction -> reconcile

Single source of truth
----------------------
Every FinOps table is derived from the SAME export rows in the SAME transaction:

    finops_daily_resource_costs      per day / subscription / resource
    finops_daily_dimension_costs     per day / subscription / dimension / cost type
    finops_daily_subscription_costs  per day / subscription
    finops_daily_meter_costs         per day / subscription / meter
    finops_monthly_service_costs     per month / subscription / service
    finops_monthly_tag_costs         per month / subscription / tag

That is what makes the views agree. They cannot disagree, because there is no second
collection path that could fill one table and miss another.

Safety properties
-----------------
* Idempotent    - the ledger is keyed on blob path + ETag, so a file loads once.
                  A restated file arrives with a new ETag and is reloaded.
* Atomic        - a billing period is replaced inside one transaction. Readers see
                  either the whole previous period or the whole new one.
* Reconciled    - the manifest's row count and the file's cost total are compared
                  with what reached SQL; a short load is recorded, not published.
* Recent first  - the newest billing period is always loaded before older history.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import os
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from services.database import get_connection

logger = logging.getLogger(__name__)

CONTAINER = os.getenv("FINOPS_EXPORT_CONTAINER", "cost-exports")
ACCOUNT = os.getenv("FINOPS_EXPORT_ACCOUNT", "")
# A cost difference below this is floating-point noise, not a missing charge.
TOLERANCE_USD = 0.01


def _deployment_tag() -> str:
    """Short id that makes this deployment's export names its own.

    Cost Management exports live on the SUBSCRIPTION, so two Infra IQ deployments
    scanning the same subscription would otherwise share one export object and each
    rewrite its destination to their own storage — last writer wins, and the loser's
    container silently stays empty. Keying on the storage account keeps them apart.
    """
    return hashlib.sha256((ACCOUNT or "default").encode("utf-8")).hexdigest()[:6]


def _export_name(cost_type: str, subscription_id: str, period: Optional[str] = None) -> str:
    kind = f"hist-{period}" if period else "daily"
    return (f"infraiq-{cost_type.lower()}-{kind}-"
            f"{subscription_id.split('-')[0]}-{_deployment_tag()}")


_BLOB_AVAILABLE = True
try:  # pragma: no cover - import guard
    from azure.storage.blob import BlobServiceClient
except Exception as exc:  # pragma: no cover - import guard
    BlobServiceClient = None  # type: ignore[assignment]
    _BLOB_AVAILABLE = False
    logger.warning("azure-storage-blob unavailable, export ingestion disabled: %s", exc)


def is_configured() -> bool:
    return bool(ACCOUNT) and _BLOB_AVAILABLE


def _credential():
    from services.azure_auth import get_credential  # local import keeps startup cheap

    return get_credential()


def _service_client():
    if not is_configured():
        raise RuntimeError("Cost export storage account is not configured")
    return BlobServiceClient(f"https://{ACCOUNT}.blob.core.windows.net", credential=_credential())


# ── Export layout ─────────────────────────────────────────────────────────────
# <costtype>/<subscriptionId>/<exportName>/<yyyyMMdd-yyyyMMdd>/<runStamp>/<guid>/_manifest.json
_MANIFEST_PATTERN = re.compile(
    r"^(?P<cost_type>[^/]+)/(?P<subscription_id>[^/]+)/(?P<export>[^/]+)/"
    r"(?P<period>\d{8}-\d{8})/(?P<run>[^/]+)/(?P<guid>[^/]+)/_manifest\.json$"
)

# finops_daily_dimension_costs stores the cost basis as 'actual' / 'amortized'; every
# reader filters on those exact values, so a nicer-looking label here would silently
# return empty charts.
_COST_TYPE_LABEL = {"actualcost": "actual", "amortizedcost": "amortized"}


def _digest(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def _to_float(value: Any) -> float:
    try:
        text = str(value).strip()
        return float(text) if text else 0.0
    except (TypeError, ValueError):
        return 0.0


def _iso_date(value: Any) -> str:
    """Normalise Azure's several date spellings to YYYY-MM-DD.

    Dates are compared as strings everywhere in this schema, and '20260804' sorts
    above any dashed date, so a mixed format silently hides rows from range filters.
    """
    text = str(value or "").strip()
    if not text:
        return ""
    if re.fullmatch(r"\d{8}", text):
        return f"{text[0:4]}-{text[4:6]}-{text[6:8]}"
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(text[:len(fmt) + 2] if "T" in fmt else text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).strftime("%Y-%m-%d")
    except ValueError:
        return text[:10]


def _pick(row: Dict[str, str], *names: str) -> str:
    """Export column casing varies by schema version, so match case-insensitively."""
    for name in names:
        if name in row and row[name] not in (None, ""):
            return str(row[name]).strip()
    lowered = {key.lower(): value for key, value in row.items() if value not in (None, "")}
    for name in names:
        value = lowered.get(name.lower())
        if value:
            return str(value).strip()
    return ""


def _parse_tags(raw: str) -> List[Tuple[str, str]]:
    """Tags arrive either as a JSON object or as bare `"k": "v"` pairs."""
    text = (raw or "").strip()
    if not text:
        return []
    for candidate in (text, "{" + text + "}"):
        try:
            parsed = json.loads(candidate)
        except (ValueError, TypeError):
            continue
        if isinstance(parsed, dict):
            return [(str(k), str(v)) for k, v in parsed.items() if str(k)]
    return []


# ── Export provisioning ───────────────────────────────────────────────────────
# Exports are per subscription, so a subscription added later would silently have no
# cost data at all. Rather than relying on someone re-running a setup script, the app
# reconciles the export definitions against the subscriptions it tracks on every pass.

EXPORT_API_VERSION = "2023-08-01"
STORAGE_RESOURCE_ID = os.getenv("FINOPS_EXPORT_STORAGE_ID", "")
_COST_TYPES = ("ActualCost", "AmortizedCost")


def _export_definition(cost_type: str, subscription_id: str) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    return {
        "properties": {
            "format": "Csv",
            "deliveryInfo": {"destination": {
                "resourceId": STORAGE_RESOURCE_ID,
                "container": CONTAINER,
                "rootFolderPath": f"{cost_type.lower()}/{subscription_id}",
            }},
            # Month-to-date, because Azure restates charges inside the open period.
            "definition": {"type": cost_type, "timeframe": "MonthToDate",
                           "dataSet": {"granularity": "Daily"}},
            "partitionData": True,
            "dataOverwriteBehavior": "OverwritePreviousReport",
            "schedule": {
                "status": "Active", "recurrence": "Daily",
                "recurrencePeriod": {
                    "from": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "to": now.replace(year=now.year + 3).strftime("%Y-%m-%dT%H:%M:%SZ"),
                },
            },
        }
    }


def ensure_exports(subscription_ids: List[str]) -> Dict[str, Any]:
    """Create or update the daily exports for every tracked subscription.

    Idempotent: an unchanged definition is simply rewritten. A subscription the
    identity cannot manage is reported rather than raised, so one inaccessible
    scope cannot stop the rest from being provisioned.
    """
    if not is_configured() or not STORAGE_RESOURCE_ID:
        return {"provisioned": [], "skipped": "storage id or account not configured"}

    import requests

    token = _credential().get_token("https://management.azure.com/.default").token
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    created, failed, triggered = [], [], []
    for subscription_id in subscription_ids:
        for cost_type in _COST_TYPES:
            name = _export_name(cost_type, subscription_id)
            base = (f"https://management.azure.com/subscriptions/{subscription_id}"
                    f"/providers/Microsoft.CostManagement/exports/{name}")
            url = f"{base}?api-version={EXPORT_API_VERSION}"
            try:
                existed = requests.get(url, headers=headers, timeout=60).status_code < 300
                response = requests.put(url, headers=headers,
                                        json=_export_definition(cost_type, subscription_id), timeout=90)
                if response.status_code < 300:
                    created.append(name)
                    # A brand-new daily export does not execute until its next scheduled
                    # occurrence, which can be ~24h away — a fresh deployment would sit
                    # with empty FinOps views until then. Kick the first run off now.
                    # Existing exports are left alone so routine passes cost nothing.
                    if not existed:
                        run = requests.post(f"{base}/run?api-version={EXPORT_API_VERSION}",
                                            headers=headers, timeout=90)
                        if run.status_code < 300:
                            triggered.append(name)
                        else:
                            logger.warning("Could not start first run of %s: %s %s",
                                           name, run.status_code, run.text[:200])
                else:
                    failed.append({"export": name, "status": response.status_code,
                                   "detail": response.text[:200]})
            except Exception as exc:
                failed.append({"export": name, "status": "exception", "detail": str(exc)[:200]})
    if failed:
        logger.warning("Cost export provisioning incomplete: %s", failed[:3])
    if triggered:
        logger.info("First run started for %d new cost export(s)", len(triggered))
    return {"provisioned": created, "failed": failed, "first_run_started": triggered}


def _months_needing_history(subscription_id: str, months: int) -> List[tuple]:
    """Past months this subscription has no stored cost for, newest first.

    The recurring export only covers the open month, so on a fresh deployment
    history would never arrive. Months already loaded are skipped, which stops
    this from re-triggering an export on every pass.
    """
    today = datetime.now(timezone.utc).date()
    wanted = []
    for offset in range(1, months + 1):
        anchor = (today.replace(day=1) - timedelta(days=1))
        for _ in range(offset - 1):
            anchor = anchor.replace(day=1) - timedelta(days=1)
        start = anchor.replace(day=1)
        end = anchor
        wanted.append((start, end))
    missing = []
    try:
        with get_connection() as connection:
            cursor = connection.cursor()
            for start, end in wanted:
                row = cursor.execute(
                    "SELECT COUNT(*) FROM finops_daily_resource_costs "
                    "WHERE subscription_id = ? AND snapshot_date LIKE ?",
                    (subscription_id, f"{start.strftime('%Y-%m')}%"),
                ).fetchone()
                if not int(row[0] or 0):
                    missing.append((start, end))
    except Exception as exc:
        logger.warning("Cannot determine missing history months: %s", exc)
        return []
    return missing


def ensure_history_exports(subscription_ids: List[str], months: Optional[int] = None) -> List[str]:
    """Run one-off exports for past months that are not in the warehouse yet."""
    months = months if months is not None else int(os.getenv("FINOPS_EXPORT_HISTORY_MONTHS", "2") or 0)
    if not months or not STORAGE_RESOURCE_ID:
        return []

    import requests

    token = _credential().get_token("https://management.azure.com/.default").token
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    triggered = []
    for subscription_id in subscription_ids:
        for start, end in _months_needing_history(subscription_id, months):
            for cost_type in _COST_TYPES:
                name = _export_name(cost_type, subscription_id, start.strftime('%Y%m'))
                body = _export_definition(cost_type, subscription_id)
                body["properties"]["schedule"] = {"status": "Inactive"}
                body["properties"]["definition"].update({
                    "timeframe": "Custom",
                    "timePeriod": {"from": f"{start}T00:00:00Z", "to": f"{end}T23:59:59Z"},
                })
                base = (f"https://management.azure.com/subscriptions/{subscription_id}"
                        f"/providers/Microsoft.CostManagement/exports/{name}")
                try:
                    put = requests.put(f"{base}?api-version={EXPORT_API_VERSION}",
                                       headers=headers, json=body, timeout=90)
                    if put.status_code >= 300:
                        continue
                    requests.post(f"{base}/run?api-version={EXPORT_API_VERSION}",
                                  headers=headers, timeout=90)
                    triggered.append(name)
                except Exception as exc:
                    logger.warning("History export %s failed: %s", name, exc)
    if triggered:
        logger.info("Requested %d historical cost export(s): %s", len(triggered), triggered[:4])
    return triggered


def _tracked_subscriptions() -> List[str]:
    try:
        from services.azure_auth import get_subscription_ids

        return list(get_subscription_ids() or [])
    except Exception as exc:
        logger.warning("Cannot determine tracked subscriptions for export provisioning: %s", exc)
        return []


# ── Discovery ─────────────────────────────────────────────────────────────────

def discover_manifests() -> List[Dict[str, Any]]:
    """List every export manifest currently in the landing container, newest period first."""
    client = _service_client().get_container_client(CONTAINER)
    manifests: List[Dict[str, Any]] = []
    for blob in client.list_blobs():
        match = _MANIFEST_PATTERN.match(blob.name)
        if not match:
            continue
        fields = match.groupdict()
        manifests.append({
            "manifest_path": blob.name,
            "cost_type": _COST_TYPE_LABEL.get(fields["cost_type"].lower(), fields["cost_type"]),
            "subscription_id": fields["subscription_id"],
            "billing_period": fields["period"],
            "export_run": fields["run"],
            "etag": str(blob.etag or "").strip('"'),
            "last_modified": blob.last_modified.isoformat() if blob.last_modified else "",
        })
    # Newest billing period first, then newest run: recent cost is always published
    # before history, even when a large backfill is waiting in the same container.
    manifests.sort(key=lambda item: (item["billing_period"], item["export_run"]), reverse=True)
    return manifests


def latest_manifests(manifests: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Keep only the newest run for each subscription / cost type / billing period.

    A re-run leaves the earlier run's folder in place, and every run is a COMPLETE
    restatement of its period. Loading an older folder afterwards would replace the
    period with stale figures, so superseded runs are dropped rather than ingested.
    """
    newest: Dict[tuple, Dict[str, Any]] = {}
    for manifest in manifests:
        key = (manifest["cost_type"], manifest["subscription_id"], manifest["billing_period"])
        current = newest.get(key)
        if current is None or manifest["export_run"] > current["export_run"]:
            newest[key] = manifest
    return sorted(newest.values(),
                  key=lambda item: (item["billing_period"], item["export_run"]), reverse=True)


def _read_manifest(container, manifest_path: str) -> Dict[str, Any]:
    payload = container.get_blob_client(manifest_path).download_blob().readall()
    return json.loads(payload.decode("utf-8-sig"))


def _read_csv_rows(container, blob_name: str) -> Iterable[Dict[str, str]]:
    payload = container.get_blob_client(blob_name).download_blob().readall()
    text = payload.decode("utf-8-sig", errors="replace")
    yield from csv.DictReader(io.StringIO(text))


# ── Aggregation ───────────────────────────────────────────────────────────────

class _Aggregates:
    """Every FinOps grain, accumulated from one pass over the export rows.

    Grouping keys are case-folded. Azure emits the same resource id, service and
    tag key in more than one casing, while the SQL collation is case-insensitive,
    so case-sensitive Python keys would produce rows that collide on insert. The
    first spelling seen is kept for display.
    """

    def __init__(self) -> None:
        self.resource: Dict[tuple, Dict[str, Any]] = {}
        self.dimension: Dict[tuple, Dict[str, Any]] = {}
        self.subscription: Dict[tuple, Dict[str, Any]] = {}
        self.meter: Dict[tuple, Dict[str, Any]] = {}
        self.service: Dict[tuple, Dict[str, Any]] = {}
        self.tag: Dict[tuple, Dict[str, Any]] = {}
        self.rows = 0
        self.total_usd = 0.0
        self.currency = "USD"
        self.dates: set = set()

    def add(self, row: Dict[str, str], subscription_id: str) -> None:
        usage_date = _iso_date(_pick(row, "date", "UsageDate", "usageDate"))
        if not usage_date:
            return
        month = usage_date[:7]
        cost = _to_float(_pick(row, "costInUsd", "CostInUsd", "costInBillingCurrency", "cost", "PreTaxCost"))
        quantity = _to_float(_pick(row, "quantity", "Quantity"))
        currency = _pick(row, "billingCurrency", "BillingCurrency", "currency") or "USD"

        resource_id = _pick(row, "ResourceId", "resourceId", "instanceId")
        resource_group = _pick(row, "resourceGroupName", "ResourceGroup", "resourceGroup")
        location = _pick(row, "resourceLocation", "location", "ResourceLocation")
        service_name = _pick(row, "consumedService", "ServiceName", "meterCategory")
        service_family = _pick(row, "serviceFamily", "ServiceFamily")
        meter_category = _pick(row, "meterCategory", "MeterCategory")
        meter_subcategory = _pick(row, "meterSubCategory", "MeterSubCategory")
        meter_name = _pick(row, "meterName", "MeterName")
        unit = _pick(row, "unitOfMeasure", "UnitOfMeasure")
        subscription_name = _pick(row, "subscriptionName", "SubscriptionName")
        resource_name = resource_id.rsplit("/", 1)[-1] if resource_id else ""
        resource_type = "/".join(resource_id.split("/")[6:8]) if resource_id.count("/") >= 7 else ""
        tags = _parse_tags(_pick(row, "tags", "Tags"))

        self.rows += 1
        self.total_usd += cost
        self.currency = currency or self.currency
        self.dates.add(usage_date)

        entry = self.resource.get((usage_date, resource_id.casefold()))
        if entry is None:
            self.resource[(usage_date, resource_id.casefold())] = {
                "date": usage_date, "resource_id": resource_id, "cost": cost,
                "resource_name": resource_name, "resource_group": resource_group,
                "resource_type": resource_type, "location": location, "service_name": service_name,
                "service_family": service_family, "meter_category": meter_category,
                "currency": currency, "tags": dict(tags),
            }
        else:
            # Several meters bill the same resource on the same day; they must SUM.
            entry["cost"] += cost
            entry["tags"].update(tags)

        for dimension, value in (
            ("resource_group", resource_group), ("service_name", service_name),
            ("service_family", service_family), ("meter_category", meter_category),
            ("location", location),
        ):
            dimension_entry = self.dimension.setdefault(
                (usage_date, dimension, value.casefold()),
                {"date": usage_date, "dimension": dimension, "value": value, "cost": 0.0},
            )
            dimension_entry["cost"] += cost

        sub_entry = self.subscription.setdefault(
            (usage_date,), {"date": usage_date, "cost": 0.0, "name": subscription_name,
                            "resources": set(), "currency": currency},
        )
        sub_entry["cost"] += cost
        if subscription_name:
            sub_entry["name"] = subscription_name
        if resource_id:
            sub_entry["resources"].add(resource_id.casefold())

        meter_entry = self.meter.setdefault(
            (usage_date, service_name.casefold(), meter_category.casefold(),
             meter_subcategory.casefold(), meter_name.casefold()),
            {"date": usage_date, "service_name": service_name, "meter_category": meter_category,
             "meter_subcategory": meter_subcategory, "meter_name": meter_name,
             "cost": 0.0, "quantity": 0.0, "unit": unit, "currency": currency},
        )
        meter_entry["cost"] += cost
        meter_entry["quantity"] += quantity

        service_entry = self.service.setdefault(
            (month, service_family.casefold(), service_name.casefold(), meter_category.casefold()),
            {"month": month, "service_family": service_family, "service_name": service_name,
             "meter_category": meter_category, "cost": 0.0, "resources": set(), "currency": currency},
        )
        service_entry["cost"] += cost
        if resource_id:
            service_entry["resources"].add(resource_id.casefold())

        for tag_key, tag_value in tags:
            tag_entry = self.tag.setdefault(
                (month, tag_key.casefold(), tag_value.casefold()),
                {"month": month, "tag_key": tag_key, "tag_value": tag_value,
                 "cost": 0.0, "resources": set(), "currency": currency},
            )
            tag_entry["cost"] += cost
            if resource_id:
                tag_entry["resources"].add(resource_id.casefold())


# ── Publication ───────────────────────────────────────────────────────────────

def _publish(aggregates: _Aggregates, subscription_id: str, cost_type: str,
             months: List[str], run_id: str) -> Dict[str, int]:
    """Replace this subscription's data for the covered months, in one transaction.

    The whole export is a complete restatement of its billing period, so the period
    is replaced rather than merged: that is what keeps SQL identical to Azure after
    charges are restated, and it cannot leave orphaned rows behind.
    """
    written: Dict[str, int] = {}
    with get_connection() as connection:
        cursor = connection.cursor()
        try:
            cursor.fast_executemany = True     # one round trip per batch, not per row
        except AttributeError:
            pass
        dates = sorted(aggregates.dates)

        def clear(table: str, column: str, values: List[str]) -> None:
            if not values:
                return
            for chunk_start in range(0, len(values), 200):
                chunk = values[chunk_start:chunk_start + 200]
                placeholders = ",".join("?" for _ in chunk)
                cursor.execute(
                    f"DELETE FROM {table} WHERE subscription_id = ? AND {column} IN ({placeholders})",
                    [subscription_id, *chunk],
                )

        def insert(sql: str, rows: List[tuple]) -> int:
            # A grain can legitimately be empty (a subscription with no tagged
            # resources), and pyodbc rejects executemany on an empty sequence.
            if rows:
                cursor.executemany(sql, rows)
            return len(rows)

        # Actual and amortized costs share the daily/resource grain, so only the
        # actual export owns those tables; otherwise the two exports would overwrite
        # each other and the totals would flip depending on which ran last.
        owns_daily = cost_type == "actual"

        if owns_daily:
            clear("finops_daily_resource_costs", "snapshot_date", dates)
            rows = [
                (entry["date"], subscription_id, entry["resource_id"], entry["resource_name"],
                 entry["resource_group"], entry["resource_type"], entry["location"], entry["service_name"],
                 entry["service_family"], entry["meter_category"], round(entry["cost"], 10),
                 entry["currency"], run_id,
                 json.dumps(entry["tags"], sort_keys=True)[:2000] if entry["tags"] else None)
                for entry in aggregates.resource.values()
            ]
            written["resource_costs"] = insert(
                "INSERT INTO finops_daily_resource_costs (snapshot_date, subscription_id, resource_id, "
                "resource_name, resource_group, resource_type, location, service_name, service_family, "
                "meter_category, cost_usd, currency, etl_run_id, tags) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)

            clear("finops_daily_subscription_costs", "snapshot_date", dates)
            rows = [
                (entry["date"], subscription_id, entry["name"], round(entry["cost"], 10),
                 entry["currency"], len(entry["resources"]), run_id)
                for entry in aggregates.subscription.values()
            ]
            written["sub_costs"] = insert(
                "INSERT INTO finops_daily_subscription_costs (snapshot_date, subscription_id, "
                "subscription_name, cost_usd, currency, resource_count, etl_run_id) VALUES (?,?,?,?,?,?,?)", rows)

            clear("finops_daily_meter_costs", "snapshot_date", dates)
            rows = [
                (_digest(entry["date"], subscription_id, entry["service_name"], entry["meter_category"],
                         entry["meter_subcategory"], entry["meter_name"]),
                 entry["date"], subscription_id, entry["service_name"], entry["meter_category"],
                 entry["meter_subcategory"], entry["meter_name"], "",
                 round(entry["cost"], 10), round(entry["quantity"], 10), entry["unit"],
                 entry["currency"], run_id)
                for entry in aggregates.meter.values()
            ]
            written["meter_costs"] = insert(
                "INSERT INTO finops_daily_meter_costs (id, snapshot_date, subscription_id, service_name, "
                "meter_category, meter_subcategory, meter_name, classification, cost_usd, quantity, unit, "
                "currency, etl_run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)

            clear("finops_monthly_service_costs", "billing_month", months)
            rows = [
                (entry["month"], subscription_id, entry["service_family"], entry["service_name"],
                 entry["meter_category"], round(entry["cost"], 10), entry["currency"],
                 len(entry["resources"]), run_id)
                for entry in aggregates.service.values()
            ]
            written["service_costs"] = insert(
                "INSERT INTO finops_monthly_service_costs (billing_month, subscription_id, service_family, "
                "service_name, meter_category, cost_usd, currency, resource_count, etl_run_id) "
                "VALUES (?,?,?,?,?,?,?,?,?)", rows)

            clear("finops_monthly_tag_costs", "billing_month", months)
            rows = [
                (entry["month"], subscription_id, entry["tag_key"], entry["tag_value"],
                 round(entry["cost"], 10), entry["currency"], len(entry["resources"]), run_id)
                for entry in aggregates.tag.values()
            ]
            written["tag_costs"] = insert(
                "INSERT INTO finops_monthly_tag_costs (billing_month, subscription_id, tag_key, tag_value, "
                "cost_usd, currency, resource_count, etl_run_id) VALUES (?,?,?,?,?,?,?,?)", rows)

        # The dimension grain is per cost type, so each export owns only its own rows.
        for chunk_start in range(0, len(dates), 200):
            chunk = dates[chunk_start:chunk_start + 200]
            placeholders = ",".join("?" for _ in chunk)
            cursor.execute(
                f"DELETE FROM finops_daily_dimension_costs WHERE subscription_id = ? AND cost_type = ? "
                f"AND snapshot_date IN ({placeholders})",
                [subscription_id, cost_type, *chunk],
            )
        rows = [
            (_digest(entry["date"], subscription_id, entry["dimension"], entry["value"].casefold(), cost_type),
             entry["date"], subscription_id, entry["dimension"], entry["value"], cost_type,
             round(entry["cost"], 10), aggregates.currency, run_id)
            for entry in aggregates.dimension.values()
        ]
        written["dimension_costs"] = insert(
            "INSERT INTO finops_daily_dimension_costs (id, snapshot_date, subscription_id, dimension, "
            "dim_value, cost_type, cost_usd, currency, etl_run_id) VALUES (?,?,?,?,?,?,?,?,?)", rows)
    return written


def _reconcile(subscription_id: str, cost_type: str, billing_period: str,
               aggregates: _Aggregates) -> Dict[str, Any]:
    """Compare the file's totals with what is now stored, and record the result."""
    dates = sorted(aggregates.dates)
    with get_connection() as connection:
        cursor = connection.cursor()
        if cost_type == "actual" and dates:
            placeholders = ",".join("?" for _ in dates)
            row = cursor.execute(
                f"SELECT COUNT(*), COALESCE(SUM(cost_usd),0) FROM finops_daily_resource_costs "
                f"WHERE subscription_id = ? AND snapshot_date IN ({placeholders})",
                [subscription_id, *dates],
            ).fetchone()
        else:
            placeholders = ",".join("?" for _ in dates) if dates else "''"
            row = cursor.execute(
                f"SELECT COUNT(*), COALESCE(SUM(cost_usd),0) FROM finops_daily_dimension_costs "
                f"WHERE subscription_id = ? AND cost_type = ? AND dimension = 'service_name' "
                f"AND snapshot_date IN ({placeholders})",
                [subscription_id, cost_type, *dates],
            ).fetchone()
        sql_rows, sql_cost = int(row[0] or 0), float(row[1] or 0.0)
        difference = sql_cost - aggregates.total_usd
        matched = abs(difference) <= TOLERANCE_USD
        cursor.execute(
            "DELETE FROM finops_export_reconciliation WHERE subscription_id=? AND cost_type=? AND billing_period=?",
            (subscription_id, cost_type, billing_period),
        )
        cursor.execute(
            "INSERT INTO finops_export_reconciliation (id, subscription_id, cost_type, billing_period, "
            "currency, source_row_count, sql_row_count, source_cost_usd, sql_cost_usd, difference_usd, "
            "matched, reconciled_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (_digest(subscription_id, cost_type, billing_period), subscription_id, cost_type, billing_period,
             aggregates.currency, aggregates.rows, sql_rows, round(aggregates.total_usd, 10),
             round(sql_cost, 10), round(difference, 10), 1 if matched else 0,
             datetime.now(timezone.utc).isoformat()),
        )
    return {"matched": matched, "source_cost_usd": aggregates.total_usd,
            "sql_cost_usd": sql_cost, "difference_usd": difference, "sql_rows": sql_rows}


# ── Ledger ────────────────────────────────────────────────────────────────────

def _ledger_status(entry_id: str) -> Optional[str]:
    with get_connection() as connection:
        row = connection.cursor().execute(
            "SELECT status FROM finops_export_ledger WHERE id = ?", (entry_id,)
        ).fetchone()
    return str(row[0]) if row else None


def _ledger_write(entry_id: str, manifest: Dict[str, Any], status: str, **fields: Any) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with get_connection() as connection:
        cursor = connection.cursor()
        exists = cursor.execute("SELECT 1 FROM finops_export_ledger WHERE id = ?", (entry_id,)).fetchone()
        if exists:
            cursor.execute(
                "UPDATE finops_export_ledger SET status=?, loaded_row_count=?, source_row_count=?, "
                "completed_at=?, error_message=?, attempts = attempts + 1 WHERE id=?",
                (status, int(fields.get("loaded_row_count", 0)), int(fields.get("source_row_count", 0)),
                 now if status in ("loaded", "failed", "reconcile_failed") else "",
                 str(fields.get("error", ""))[:3900], entry_id),
            )
        else:
            cursor.execute(
                "INSERT INTO finops_export_ledger (id, blob_path, etag, subscription_id, cost_type, "
                "billing_period, export_run, manifest_path, byte_count, source_row_count, loaded_row_count, "
                "status, attempts, started_at, completed_at, error_message) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (entry_id, manifest["manifest_path"], manifest["etag"], manifest["subscription_id"],
                 manifest["cost_type"], manifest["billing_period"], manifest["export_run"],
                 manifest["manifest_path"], float(fields.get("byte_count", 0)),
                 int(fields.get("source_row_count", 0)), int(fields.get("loaded_row_count", 0)),
                 status, 1, now,
                 now if status in ("loaded", "failed", "reconcile_failed") else "",
                 str(fields.get("error", ""))[:3900]),
            )


# ── Entry point ───────────────────────────────────────────────────────────────

def ingest_available_exports(max_manifests: int = 24) -> Dict[str, Any]:
    """Load every export file that has not already been loaded.

    Returns a summary the ingestion UI can show. Files that fail are recorded and
    retried on the next pass; they never block the remaining files.
    """
    if not is_configured():
        return {"status": "disabled", "reason": "FINOPS_EXPORT_ACCOUNT is not set"}

    started = datetime.now(timezone.utc)
    run_id = f"export-{started.strftime('%Y%m%d%H%M%S')}"
    container = _service_client().get_container_client(CONTAINER)

    # Reconcile export definitions first, so a subscription added since the last pass
    # starts producing files instead of silently having no cost data.
    provisioning = {}
    if os.getenv("FINOPS_EXPORT_AUTOPROVISION", "1") != "0":
        subscriptions = _tracked_subscriptions()
        if subscriptions:
            provisioning = ensure_exports(subscriptions)
            # Recent cost comes from the recurring export; history is requested only
            # for months the warehouse is still missing.
            provisioning["history_requested"] = ensure_history_exports(subscriptions)

    processed, skipped, failed = [], 0, []
    totals: Dict[str, int] = defaultdict(int)

    for manifest_info in latest_manifests(discover_manifests())[:max_manifests]:
        entry_id = _digest(manifest_info["manifest_path"], manifest_info["etag"])
        if _ledger_status(entry_id) == "loaded":
            skipped += 1
            continue
        try:
            manifest = _read_manifest(container, manifest_info["manifest_path"])
            blobs = manifest.get("blobs") or []
            expected_rows = int(manifest.get("dataRowCount") or 0)

            aggregates = _Aggregates()
            for blob in blobs:
                for row in _read_csv_rows(container, blob["blobName"]):
                    aggregates.add(row, manifest_info["subscription_id"])

            if expected_rows and aggregates.rows != expected_rows:
                raise ValueError(
                    f"Export declares {expected_rows} rows but {aggregates.rows} were read; "
                    "refusing to publish a short read"
                )
            if not aggregates.rows:
                _ledger_write(entry_id, manifest_info, "empty", source_row_count=0,
                              byte_count=manifest.get("byteCount", 0))
                continue

            months = sorted({date[:7] for date in aggregates.dates})
            written = _publish(aggregates, manifest_info["subscription_id"],
                               manifest_info["cost_type"], months, run_id)
            reconciliation = _reconcile(manifest_info["subscription_id"], manifest_info["cost_type"],
                                        manifest_info["billing_period"], aggregates)

            status = "loaded" if reconciliation["matched"] else "reconcile_failed"
            _ledger_write(entry_id, manifest_info, status,
                          source_row_count=aggregates.rows,
                          loaded_row_count=sum(written.values()),
                          byte_count=manifest.get("byteCount", 0),
                          error="" if reconciliation["matched"] else
                                f"Stored total differs from the export by {reconciliation['difference_usd']:.6f} USD")
            for key, value in written.items():
                totals[key] += value
            processed.append({
                "subscription_id": manifest_info["subscription_id"],
                "cost_type": manifest_info["cost_type"],
                "billing_period": manifest_info["billing_period"],
                "source_rows": aggregates.rows, "written": written,
                "reconciled": reconciliation["matched"],
                "source_cost_usd": round(aggregates.total_usd, 6),
            })
            logger.info("Export loaded: %s %s %s — %d source rows, reconciled=%s",
                        manifest_info["subscription_id"][:8], manifest_info["cost_type"],
                        manifest_info["billing_period"], aggregates.rows, reconciliation["matched"])
        except Exception as exc:
            logger.error("Export ingestion failed for %s: %s", manifest_info["manifest_path"], exc)
            _ledger_write(entry_id, manifest_info, "failed", error=str(exc))
            failed.append({"manifest": manifest_info["manifest_path"], "error": str(exc)})

    return {
        "status": "completed" if not failed else "partial",
        "run_id": run_id,
        "export_provisioning": provisioning,
        "processed": processed,
        "skipped_already_loaded": skipped,
        "failed": failed,
        "rows_written": dict(totals),
        "duration_seconds": round((datetime.now(timezone.utc) - started).total_seconds(), 3),
    }


def get_ingestion_status() -> Dict[str, Any]:
    """Ledger and reconciliation summary for the FinOps ingestion view."""
    if not is_configured():
        return {"configured": False, "account": "", "container": CONTAINER}
    with get_connection() as connection:
        cursor = connection.cursor()
        ledger = [
            {"subscription_id": row[0], "cost_type": row[1], "billing_period": row[2],
             "status": row[3], "source_rows": int(row[4] or 0), "completed_at": row[5],
             "error": row[6]}
            for row in cursor.execute(
                "SELECT subscription_id, cost_type, billing_period, status, source_row_count, "
                "completed_at, error_message FROM finops_export_ledger ORDER BY billing_period DESC, "
                "subscription_id, cost_type"
            ).fetchall()
        ]
        reconciliation = [
            {"subscription_id": row[0], "cost_type": row[1], "billing_period": row[2],
             "source_cost_usd": float(row[3] or 0), "sql_cost_usd": float(row[4] or 0),
             "difference_usd": float(row[5] or 0), "matched": bool(row[6])}
            for row in cursor.execute(
                "SELECT subscription_id, cost_type, billing_period, source_cost_usd, sql_cost_usd, "
                "difference_usd, matched FROM finops_export_reconciliation "
                "ORDER BY billing_period DESC, subscription_id, cost_type"
            ).fetchall()
        ]
    return {
        "configured": True, "account": ACCOUNT, "container": CONTAINER,
        "ledger": ledger, "reconciliation": reconciliation,
        "files_loaded": sum(1 for item in ledger if item["status"] == "loaded"),
        "files_failed": sum(1 for item in ledger if item["status"] in ("failed", "reconcile_failed")),
    }

