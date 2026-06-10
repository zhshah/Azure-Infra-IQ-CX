"""
Azure Update Management Service
Queries Azure Resource Graph for patch assessment and installation results
across both Azure VMs and Azure Arc-enabled machines.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional, Tuple

from models.schemas import (
    MachineUpdateStatus, UpdateManagementSummary,
    UpdatesByCategory, ComplianceDataPoint,
    PendingPatchDetail, DetailedMachineUpdate,
    UpdateFilterOptions,
)

logger = logging.getLogger(__name__)

# ── KQL Queries ──────────────────────────────────────────────────────────────

_PATCH_ASSESSMENT_KQL = """
patchassessmentresults
| where type =~ "microsoft.compute/virtualmachines/patchassessmentresults"
    or type =~ "microsoft.hybridcompute/machines/patchassessmentresults"
| extend vmId = tolower(tostring(properties.vmId))
| extend vmName = tostring(properties.vmName)
| extend osType = tostring(properties.osType)
| extend status = tostring(properties.status)
| extend startDateTime = todatetime(properties.startDateTime)
| extend lastModified = todatetime(properties.lastModifiedDateTime)
| extend criticalCount = toint(properties.availablePatchCountByClassification.critical)
| extend securityCount = toint(properties.availablePatchCountByClassification.security)
| extend otherCount = toint(properties.availablePatchCountByClassification.other)
| extend definitionCount = toint(properties.availablePatchCountByClassification.definition)
| extend updateRollupCount = toint(properties.availablePatchCountByClassification.updateRollup)
| extend rebootPending = tostring(properties.rebootPending)
| extend machineType = iff(type contains "hybridcompute", "Arc", "AzureVM")
| extend resourceGroup = tostring(split(vmId, "/")[4])
| extend subscriptionId = tostring(split(vmId, "/")[2])
| extend location = tostring(properties.location)
| project vmId, vmName, osType, status, startDateTime, lastModified,
          criticalCount, securityCount, otherCount, definitionCount, updateRollupCount,
          rebootPending, machineType, resourceGroup, subscriptionId, location
| order by lastModified desc
"""

_PATCH_INSTALLATION_KQL = """
patchinstallationresults
| where type =~ "microsoft.compute/virtualmachines/patchinstallationresults"
    or type =~ "microsoft.hybridcompute/machines/patchinstallationresults"
| extend vmId = tolower(tostring(properties.vmId))
| extend vmName = tostring(properties.vmName)
| extend osType = tostring(properties.osType)
| extend status = tostring(properties.status)
| extend startDateTime = todatetime(properties.startDateTime)
| extend lastModified = todatetime(properties.lastModifiedDateTime)
| extend installedPatchCount = toint(properties.installedPatchCount)
| extend failedPatchCount = toint(properties.failedPatchCount)
| extend pendingPatchCount = toint(properties.pendingPatchCount)
| extend notSelectedPatchCount = toint(properties.notSelectedPatchCount)
| extend excludedPatchCount = toint(properties.excludedPatchCount)
| extend rebootStatus = tostring(properties.rebootStatus)
| extend maintenanceWindowExceeded = tobool(properties.maintenanceWindowExceeded)
| extend machineType = iff(type contains "hybridcompute", "Arc", "AzureVM")
| extend resourceGroup = tostring(split(vmId, "/")[4])
| extend subscriptionId = tostring(split(vmId, "/")[2])
| project vmId, vmName, osType, status, startDateTime, lastModified,
          installedPatchCount, failedPatchCount, pendingPatchCount,
          notSelectedPatchCount, excludedPatchCount, rebootStatus,
          maintenanceWindowExceeded, machineType, resourceGroup, subscriptionId
| order by lastModified desc
"""

_PENDING_PATCHES_DETAIL_KQL = """
patchassessmentresults
| where type =~ "microsoft.compute/virtualmachines/patchassessmentresults"
    or type =~ "microsoft.hybridcompute/machines/patchassessmentresults"
| mv-expand patch = properties.availablePatches
| extend vmId = tolower(tostring(properties.vmId))
| extend patchName = tostring(patch.patchName)
| extend classification = tostring(patch.classifications[0])
| extend kbId = tostring(patch.kbId)
| extend severity = tostring(patch.msrcSeverity)
| extend publishedDate = tostring(patch.publishedDate)
| extend rebootRequired = tobool(patch.rebootBehavior =~ "NeverReboots")
| project vmId, patchName, classification, kbId, severity, publishedDate, rebootRequired
| order by severity asc, classification asc
"""

_VM_LIST_KQL = """
resources
| where type =~ "microsoft.compute/virtualmachines"
    or type =~ "microsoft.hybridcompute/machines"
| extend osType = iff(type contains "hybridcompute",
    tostring(properties.osType),
    tostring(properties.storageProfile.osDisk.osType))
| extend machineType = iff(type contains "hybridcompute", "Arc", "AzureVM")
| extend powerState = iff(type contains "hybridcompute",
    tostring(properties.status),
    tostring(properties.extended.instanceView.powerState.code))
| extend vmSize = iff(type contains "hybridcompute",
    "",
    tostring(properties.hardwareProfile.vmSize))
| extend zonesStr = tostring(zones)
| project id=tolower(id), name, resourceGroup, subscriptionId, location,
          osType, machineType, powerState, vmSize, tags, zonesStr
"""


# ── Cache ────────────────────────────────────────────────────────────────────

_cache: Dict[str, Any] = {
    "assessments": None,
    "installations": None,
    "machines": None,
    "last_refresh": None,
    "ttl_minutes": 15,
}


def _is_cache_valid() -> bool:
    if _cache["last_refresh"] is None:
        return False
    elapsed = (datetime.now(timezone.utc) - _cache["last_refresh"]).total_seconds()
    return elapsed < _cache["ttl_minutes"] * 60


async def refresh_cache() -> None:
    """Refresh all update management data from Azure Resource Graph."""
    from services.resource_graph_service import query_resource_graph
    from services.settings_service import get_subscription_ids

    sub_ids = get_subscription_ids()
    if not sub_ids:
        logger.warning("update_management: no subscription IDs configured")
        return

    logger.info("update_management: refreshing data from Resource Graph...")

    try:
        _cache["machines"] = query_resource_graph(_VM_LIST_KQL, sub_ids, max_results=10000)
        logger.info(f"update_management: found {len(_cache['machines'])} machines")
    except Exception as e:
        logger.warning(f"update_management: VM list query failed: {e}")
        _cache["machines"] = []

    try:
        _cache["assessments"] = query_resource_graph(_PATCH_ASSESSMENT_KQL, sub_ids, max_results=10000)
        logger.info(f"update_management: found {len(_cache['assessments'])} assessment results")
    except Exception as e:
        logger.warning(f"update_management: assessment query failed: {e}")
        _cache["assessments"] = []

    try:
        _cache["installations"] = query_resource_graph(_PATCH_INSTALLATION_KQL, sub_ids, max_results=10000)
        logger.info(f"update_management: found {len(_cache['installations'])} installation results")
    except Exception as e:
        logger.warning(f"update_management: installation query failed: {e}")
        _cache["installations"] = []

    _cache["last_refresh"] = datetime.now(timezone.utc)
    logger.info("update_management: cache refresh complete")


async def _ensure_cache() -> None:
    if not _is_cache_valid():
        await refresh_cache()


# ── Helper Functions ─────────────────────────────────────────────────────────

def _parse_datetime(val: Any) -> Optional[datetime]:
    """Parse various datetime formats from Resource Graph."""
    if not val:
        return None
    if isinstance(val, datetime):
        return val.replace(tzinfo=timezone.utc) if val.tzinfo is None else val
    s = str(val).strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(s, fmt)
            return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
        except ValueError:
            continue
    return None


def _days_ago(dt: Optional[datetime]) -> int:
    if not dt:
        return 9999
    return max(0, (datetime.now(timezone.utc) - dt).days)


def _build_machine_status(assessment: Dict, installation: Optional[Dict] = None) -> MachineUpdateStatus:
    """Build a MachineUpdateStatus from assessment + optional installation data."""
    now = datetime.now(timezone.utc)
    last_assess = _parse_datetime(assessment.get("lastModified") or assessment.get("startDateTime"))
    
    critical = int(assessment.get("criticalCount") or 0)
    security = int(assessment.get("securityCount") or 0)
    other = int(assessment.get("otherCount") or 0) + int(assessment.get("definitionCount") or 0) + int(assessment.get("updateRollupCount") or 0)
    
    # Get installation info
    last_patch_time = ""
    installed = 0
    failed = 0
    reboot_status = str(assessment.get("rebootPending") or "")
    
    if installation:
        inst_time = _parse_datetime(installation.get("lastModified") or installation.get("startDateTime"))
        if inst_time:
            last_patch_time = inst_time.isoformat()
        installed = int(installation.get("installedPatchCount") or 0)
        failed = int(installation.get("failedPatchCount") or 0)
        reboot_status = str(installation.get("rebootStatus") or reboot_status)

    patch_time = _parse_datetime(last_patch_time) if last_patch_time else last_assess
    days_since = _days_ago(patch_time)

    return MachineUpdateStatus(
        vm_id=str(assessment.get("vmId") or ""),
        vm_name=str(assessment.get("vmName") or ""),
        resource_group=str(assessment.get("resourceGroup") or ""),
        subscription_id=str(assessment.get("subscriptionId") or ""),
        os_type=str(assessment.get("osType") or "Unknown"),
        machine_type=str(assessment.get("machineType") or "AzureVM"),
        last_assessment_time=last_assess.isoformat() if last_assess else "",
        last_patch_time=last_patch_time,
        patch_status=str(installation.get("status") or assessment.get("status") or "Unknown") if installation else str(assessment.get("status") or "Unknown"),
        critical_pending=critical,
        security_pending=security,
        other_pending=other,
        total_pending=critical + security + other,
        installed_count=installed,
        failed_count=failed,
        reboot_status=reboot_status if reboot_status and reboot_status != "None" else "NotRequired",
        days_since_patch=days_since,
        location=str(assessment.get("location") or ""),
    )


def _build_all_machine_statuses() -> List[MachineUpdateStatus]:
    """Combine assessments + installations into unified machine list.
    
    Also surfaces VMs that exist in the subscription but have NO assessment data
    yet (e.g. Update Manager not configured). These are shown with
    patch_status='assessment_pending' and assessment_available=False.
    """
    assessments = _cache.get("assessments") or []
    installations = _cache.get("installations") or []

    # Index installations by vmId (latest per VM)
    install_by_vm: Dict[str, Dict] = {}
    for inst in installations:
        vm_id = str(inst.get("vmId") or "").lower()
        if vm_id and (vm_id not in install_by_vm):
            install_by_vm[vm_id] = inst

    # Build statuses from assessments
    seen_vms: set = set()
    results: List[MachineUpdateStatus] = []
    for assess in assessments:
        vm_id = str(assess.get("vmId") or "").lower()
        if not vm_id or vm_id in seen_vms:
            continue
        seen_vms.add(vm_id)
        inst = install_by_vm.get(vm_id)
        results.append(_build_machine_status(assess, inst))

    # Add VMs from the VM list that have NO assessment data
    for vm in (_cache.get("machines") or []):
        vm_id = str(vm.get("id") or "").lower()
        if not vm_id or vm_id in seen_vms:
            continue
        seen_vms.add(vm_id)
        # Parse tags
        raw_tags = vm.get("tags") or {}
        if isinstance(raw_tags, str):
            try:
                import json as _json
                raw_tags = _json.loads(raw_tags)
            except Exception:
                raw_tags = {}
        # Parse zones
        zones_raw = vm.get("zonesStr") or vm.get("zones") or ""
        if isinstance(zones_raw, str):
            import re as _re
            zones_list = _re.findall(r'"([^"]+)"', zones_raw)
        elif isinstance(zones_raw, list):
            zones_list = [str(z) for z in zones_raw]
        else:
            zones_list = []

        results.append(MachineUpdateStatus(
            vm_id=vm_id,
            vm_name=str(vm.get("name") or ""),
            resource_group=str(vm.get("resourceGroup") or ""),
            subscription_id=str(vm.get("subscriptionId") or ""),
            os_type=str(vm.get("osType") or "Unknown"),
            machine_type=str(vm.get("machineType") or "AzureVM"),
            location=str(vm.get("location") or ""),
            patch_status="assessment_pending",
            assessment_available=False,
            sku=str(vm.get("vmSize") or ""),
            tags=raw_tags,
            zones=zones_list,
        ))

    return results


# ── Public API Functions ─────────────────────────────────────────────────────

async def get_update_summary() -> UpdateManagementSummary:
    """Get high-level KPIs for the Update Management dashboard."""
    await _ensure_cache()
    machines = _build_all_machine_statuses()
    
    if not machines:
        return UpdateManagementSummary(assessment_time=datetime.now(timezone.utc).isoformat())

    azure_vms = [m for m in machines if m.machine_type == "AzureVM"]
    arc_machines = [m for m in machines if m.machine_type == "Arc"]
    windows = [m for m in machines if m.os_type.lower() == "windows"]
    linux = [m for m in machines if m.os_type.lower() == "linux"]
    without_assessment = [m for m in machines if not m.assessment_available]

    # Only count machines WITH assessment data for patching compliance metrics
    assessed = [m for m in machines if m.assessment_available]
    patched_30d = [m for m in assessed if m.days_since_patch <= 30]
    not_patched_30d = [m for m in assessed if m.days_since_patch > 30]
    pending_reboot = [m for m in machines if m.reboot_status in ("Required", "Started")]
    rebooted_30d = [m for m in machines if m.reboot_status == "Completed"]
    
    total = len(machines)
    assessed_total = len(assessed)
    compliance = (len(patched_30d) / assessed_total * 100) if assessed_total > 0 else 0.0
    
    total_critical = sum(m.critical_pending for m in machines)
    total_security = sum(m.security_pending for m in machines)
    total_other = sum(m.other_pending for m in machines)
    
    avg_days = sum(m.days_since_patch for m in assessed) / assessed_total if assessed_total > 0 else 0.0

    return UpdateManagementSummary(
        total_machines=total,
        azure_vms=len(azure_vms),
        arc_machines=len(arc_machines),
        patched_last_30d=len(patched_30d),
        not_patched_30d=len(not_patched_30d),
        pending_reboot=len(pending_reboot),
        rebooted_last_30d=len(rebooted_30d),
        compliance_pct=round(compliance, 1),
        critical_pending=total_critical,
        security_pending=total_security,
        other_pending=total_other,
        total_pending_patches=total_critical + total_security + total_other,
        avg_days_since_patch=round(avg_days, 1),
        windows_machines=len(windows),
        linux_machines=len(linux),
        machines_without_assessment=len(without_assessment),
        assessment_time=_cache.get("last_refresh", datetime.now(timezone.utc)).isoformat(),
    )


async def get_patched_machines(days: int = 30) -> List[MachineUpdateStatus]:
    """Get machines that were patched within the given number of days."""
    await _ensure_cache()
    machines = _build_all_machine_statuses()
    return sorted(
        [m for m in machines if m.days_since_patch <= days],
        key=lambda m: m.days_since_patch
    )


async def get_unpatched_machines(days: int = 30) -> List[MachineUpdateStatus]:
    """Get machines NOT patched within the given number of days."""
    await _ensure_cache()
    machines = _build_all_machine_statuses()
    return sorted(
        [m for m in machines if m.days_since_patch > days],
        key=lambda m: -m.days_since_patch
    )


async def get_pending_reboot() -> List[MachineUpdateStatus]:
    """Get machines pending reboot after patch installation."""
    await _ensure_cache()
    machines = _build_all_machine_statuses()
    return [m for m in machines if m.reboot_status in ("Required", "Started")]


async def get_rebooted_machines(days: int = 30) -> List[MachineUpdateStatus]:
    """Get machines that completed reboot after patching within given days."""
    await _ensure_cache()
    machines = _build_all_machine_statuses()
    return [m for m in machines if m.reboot_status == "Completed" and m.days_since_patch <= days]


async def get_updates_by_os() -> List[UpdatesByCategory]:
    """Group update stats by OS type (Windows/Linux)."""
    await _ensure_cache()
    machines = _build_all_machine_statuses()
    
    groups: Dict[str, List[MachineUpdateStatus]] = {}
    for m in machines:
        os = m.os_type if m.os_type else "Unknown"
        groups.setdefault(os, []).append(m)
    
    results = []
    for os_type, group in sorted(groups.items()):
        total = len(group)
        patched = len([m for m in group if m.days_since_patch <= 30])
        results.append(UpdatesByCategory(
            category=os_type,
            total=total,
            patched=patched,
            unpatched=total - patched,
            pending_reboot=len([m for m in group if m.reboot_status in ("Required", "Started")]),
            compliance_pct=round(patched / total * 100, 1) if total > 0 else 0.0,
        ))
    return results


async def get_updates_by_subscription() -> List[UpdatesByCategory]:
    """Group update stats by subscription."""
    await _ensure_cache()
    machines = _build_all_machine_statuses()
    
    groups: Dict[str, List[MachineUpdateStatus]] = {}
    for m in machines:
        sub = m.subscription_id or "Unknown"
        groups.setdefault(sub, []).append(m)
    
    results = []
    for sub_id, group in sorted(groups.items()):
        total = len(group)
        patched = len([m for m in group if m.days_since_patch <= 30])
        results.append(UpdatesByCategory(
            category=sub_id,
            total=total,
            patched=patched,
            unpatched=total - patched,
            pending_reboot=len([m for m in group if m.reboot_status in ("Required", "Started")]),
            compliance_pct=round(patched / total * 100, 1) if total > 0 else 0.0,
        ))
    return results


async def get_updates_by_classification() -> Dict[str, int]:
    """Get pending update counts grouped by classification."""
    await _ensure_cache()
    machines = _build_all_machine_statuses()
    return {
        "Critical": sum(m.critical_pending for m in machines),
        "Security": sum(m.security_pending for m in machines),
        "Other": sum(m.other_pending for m in machines),
    }


async def get_compliance_trend(days: int = 30) -> List[ComplianceDataPoint]:
    """Generate a compliance trend over the given number of days.
    Uses installation history to compute per-day compliance snapshots."""
    await _ensure_cache()
    installations = _cache.get("installations") or []
    machines = _cache.get("machines") or []
    total_machines = len(machines) if machines else 1

    now = datetime.now(timezone.utc)
    
    # Build daily patch counts from installations
    daily_patches: Dict[str, int] = {}
    for inst in installations:
        dt = _parse_datetime(inst.get("lastModified") or inst.get("startDateTime"))
        if dt and (now - dt).days <= days:
            day_key = dt.strftime("%Y-%m-%d")
            daily_patches[day_key] = daily_patches.get(day_key, 0) + 1

    # Generate trend data points
    results = []
    cumulative_patched = 0
    for i in range(days, -1, -1):
        day = now - timedelta(days=i)
        day_key = day.strftime("%Y-%m-%d")
        patched_today = daily_patches.get(day_key, 0)
        cumulative_patched = min(total_machines, cumulative_patched + patched_today)
        compliance = round(cumulative_patched / total_machines * 100, 1) if total_machines > 0 else 0
        results.append(ComplianceDataPoint(
            date=day_key,
            compliance_pct=compliance,
            patched_count=cumulative_patched,
            total_count=total_machines,
        ))

    return results


async def get_detailed_report(
    subscription_id: Optional[str] = None,
    resource_group: Optional[str] = None,
    os_type: Optional[str] = None,
    machine_type: Optional[str] = None,
) -> List[MachineUpdateStatus]:
    """Get full detailed machine update report with optional filters."""
    await _ensure_cache()
    machines = _build_all_machine_statuses()

    # Apply filters
    if subscription_id:
        machines = [m for m in machines if m.subscription_id == subscription_id]
    if resource_group:
        machines = [m for m in machines if m.resource_group.lower() == resource_group.lower()]
    if os_type:
        machines = [m for m in machines if m.os_type.lower() == os_type.lower()]
    if machine_type:
        machines = [m for m in machines if m.machine_type.lower() == machine_type.lower()]

    return sorted(machines, key=lambda m: (-m.total_pending, -m.days_since_patch))


async def get_filter_options() -> UpdateFilterOptions:
    """Get available filter values for the frontend dropdown."""
    await _ensure_cache()
    machines = _build_all_machine_statuses()
    
    subs = {}
    rgs = set()
    os_types = set()
    machine_types = set()
    locations = set()

    for m in machines:
        if m.subscription_id:
            subs[m.subscription_id] = m.subscription_id
        if m.resource_group:
            rgs.add(m.resource_group)
        if m.os_type:
            os_types.add(m.os_type)
        if m.machine_type:
            machine_types.add(m.machine_type)
        if m.location:
            locations.add(m.location)

    return UpdateFilterOptions(
        subscriptions=[{"id": k, "name": v} for k, v in sorted(subs.items())],
        resource_groups=sorted(rgs),
        os_types=sorted(os_types),
        machine_types=sorted(machine_types),
        locations=sorted(locations),
    )
