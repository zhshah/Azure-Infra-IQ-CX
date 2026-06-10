"""
On-Premises Background Discovery Engine
=========================================
Runs as an asyncio background task alongside the FastAPI event loop.
Periodically:
1. Connects to configured LDAP/AD
2. Discovers new/changed computers
3. Validates connectivity (WinRM/CIM)
4. Collects data from reachable servers
5. Stores results in the shared SQLite DB

Engine status is exposed via API for dashboard widgets.
Data collected feeds into ALL modules: BCDR, Security, Migration, AI Analysis.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# ENGINE STATE
# ═══════════════════════════════════════════════════════════════════════════════

_engine_state: Dict[str, Any] = {
    "status": "stopped",            # stopped | running | discovering | collecting | error
    "last_run": None,               # ISO timestamp
    "last_success": None,           # ISO timestamp of last successful full cycle
    "next_run": None,               # ISO timestamp of next scheduled run
    "interval_hours": 0,            # 0 = disabled
    "servers_discovered": 0,        # from last LDAP cycle
    "servers_reachable": 0,         # from last connectivity check
    "servers_collected": 0,         # from last collection cycle
    "current_phase": "",            # "", "ldap_discovery", "connectivity_check", "data_collection"
    "current_server": "",           # server being collected right now
    "errors": [],                   # last N errors (ring buffer)
    "cycle_count": 0,               # total discovery cycles completed
}

_engine_task: Optional[asyncio.Task] = None
_stop_event: asyncio.Event = None  # initialized in start_engine
_MAX_ERRORS = 50


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═══════════════════════════════════════════════════════════════════════════════

def get_engine_status() -> dict:
    """Get current engine state (for API/frontend)."""
    return _engine_state.copy()


async def start_engine(interval_hours: float = 0) -> dict:
    """
    Start or restart the discovery engine.
    interval_hours: 0 = single run then stop; >0 = repeat every N hours
    """
    global _engine_task, _stop_event

    from services import settings_service as svc

    # Get interval from settings if not provided
    if interval_hours <= 0:
        interval_hours = float(svc.get_value("ONPREM_DISCOVERY_INTERVAL_HOURS", 0))

    if interval_hours <= 0:
        # Single-shot mode
        _engine_state["interval_hours"] = 0
    else:
        _engine_state["interval_hours"] = interval_hours

    # Stop existing engine if running
    if _engine_task and not _engine_task.done():
        await stop_engine()

    _stop_event = asyncio.Event()
    _engine_state["status"] = "running"
    _engine_state["errors"] = []

    _engine_task = asyncio.create_task(_engine_loop(interval_hours))
    logger.info("On-prem discovery engine started (interval=%.1fh)", interval_hours)

    return {"success": True, "message": f"Engine started (interval: {interval_hours}h)"}


async def stop_engine() -> dict:
    """Stop the discovery engine gracefully."""
    global _engine_task

    if _stop_event:
        _stop_event.set()

    if _engine_task and not _engine_task.done():
        _engine_task.cancel()
        try:
            await _engine_task
        except asyncio.CancelledError:
            pass

    _engine_state["status"] = "stopped"
    _engine_state["next_run"] = None
    _engine_state["current_phase"] = ""
    _engine_state["current_server"] = ""
    logger.info("On-prem discovery engine stopped")

    return {"success": True, "message": "Engine stopped"}


async def trigger_now() -> dict:
    """Trigger an immediate discovery cycle (without waiting for interval)."""
    if _engine_state["status"] in ("discovering", "collecting"):
        return {"success": False, "message": "Engine is already running a cycle"}

    # If engine loop is running, it will pick up the next cycle;
    # if not, start a single-shot run
    if not _engine_task or _engine_task.done():
        return await start_engine(interval_hours=0)

    # Signal to skip the wait
    if _stop_event:
        _stop_event.set()
    return {"success": True, "message": "Cycle triggered"}


# ═══════════════════════════════════════════════════════════════════════════════
# ENGINE LOOP
# ═══════════════════════════════════════════════════════════════════════════════

async def _engine_loop(interval_hours: float):
    """Main engine loop — runs discovery cycles at configured interval."""
    try:
        while True:
            await _run_discovery_cycle()
            _engine_state["cycle_count"] += 1

            if interval_hours <= 0:
                # Single-shot mode
                _engine_state["status"] = "stopped"
                break

            # Schedule next run
            next_run = time.time() + (interval_hours * 3600)
            _engine_state["next_run"] = datetime.fromtimestamp(next_run, tz=timezone.utc).isoformat()
            _engine_state["status"] = "running"
            _engine_state["current_phase"] = ""
            _engine_state["current_server"] = ""

            # Wait for interval or stop signal
            try:
                await asyncio.wait_for(_stop_event.wait(), timeout=interval_hours * 3600)
                # Stop event was set
                if _stop_event.is_set():
                    _stop_event.clear()
                    # Check if this was a "trigger now" vs "stop"
                    if _engine_state["status"] == "stopped":
                        break
                    # Otherwise it's a trigger — run again immediately
                    continue
            except asyncio.TimeoutError:
                # Normal timeout — proceed with next cycle
                pass

    except asyncio.CancelledError:
        _engine_state["status"] = "stopped"
        raise
    except Exception as e:
        _engine_state["status"] = "error"
        _add_error(f"Engine loop crashed: {e}")
        logger.error("Discovery engine crashed: %s", e, exc_info=True)


async def _run_discovery_cycle():
    """Execute a single discovery cycle: LDAP → connectivity → collection."""
    from services import ldap_service
    from services import onprem_discovery_service as disc_svc

    _engine_state["last_run"] = _now()

    # ── Phase 1: LDAP Discovery ─────────────────────────────────────────────
    _engine_state["current_phase"] = "ldap_discovery"
    _engine_state["status"] = "discovering"

    servers_to_collect = []

    if ldap_service.is_configured():
        config = ldap_service.get_config_from_settings()
        result = await asyncio.to_thread(
            ldap_service.discover_computers,
            config,
            {"server_os_only": True, "enabled_only": True}
        )

        if result.get("success"):
            _engine_state["servers_discovered"] = result["total"]
            servers_to_collect = [
                c.get("dns_hostname") or c.get("name")
                for c in result.get("computers", [])
                if c.get("dns_hostname") or c.get("name")
            ]
            logger.info("LDAP discovery found %d servers", len(servers_to_collect))
        else:
            _add_error(f"LDAP discovery failed: {result.get('error', 'Unknown')}")
            _engine_state["status"] = "error"
            return
    else:
        # No LDAP — check if there are manually-added servers in DB
        servers_to_collect = _get_known_servers()
        _engine_state["servers_discovered"] = len(servers_to_collect)

    if not servers_to_collect:
        _engine_state["current_phase"] = ""
        _engine_state["status"] = "running"
        logger.info("No servers to collect — skipping cycle")
        return

    # ── Phase 2: Connectivity Check ─────────────────────────────────────────
    _engine_state["current_phase"] = "connectivity_check"

    conn_result = await asyncio.to_thread(disc_svc.test_connectivity, servers_to_collect)
    reachable_servers = [
        r["server"] for r in conn_result.get("results", [])
        if r.get("wmi") or r.get("winrm")
    ]
    _engine_state["servers_reachable"] = len(reachable_servers)

    if not reachable_servers:
        _add_error(f"No servers reachable out of {len(servers_to_collect)} discovered")
        _engine_state["current_phase"] = ""
        _engine_state["status"] = "running"
        return

    # ── Phase 3: Data Collection ────────────────────────────────────────────
    _engine_state["current_phase"] = "data_collection"
    _engine_state["status"] = "collecting"

    # Start collection (this runs in a thread pool via the existing service)
    modules = {
        "hardware": True, "os": True, "disks": True, "network": True,
        "services": True, "applications": True, "sql": True, "iis": True,
        "security": True, "certificates": True, "roles": True,
    }
    job_result = disc_svc.start_collection(reachable_servers, modules, {"max_concurrent": 5})

    if not job_result.get("job_id"):
        _add_error(f"Collection job start failed: {job_result.get('error', 'Unknown')}")
        _engine_state["status"] = "error"
        return

    # Wait for collection to complete
    job_id = job_result["job_id"]
    while True:
        await asyncio.sleep(3)
        status = disc_svc.get_collection_status(job_id)

        _engine_state["current_server"] = status.get("current_server", "")
        _engine_state["servers_collected"] = status.get("succeeded", 0)

        if status.get("status") in ("completed", "error", "cancelled"):
            break

    final_status = disc_svc.get_collection_status(job_id)
    _engine_state["servers_collected"] = final_status.get("succeeded", 0)

    if final_status.get("failed", 0) > 0:
        _add_error(
            f"Collection: {final_status['succeeded']} succeeded, {final_status['failed']} failed"
        )

    # Mark success
    _engine_state["last_success"] = _now()
    _engine_state["current_phase"] = ""
    _engine_state["current_server"] = ""
    _engine_state["status"] = "running"
    logger.info(
        "Discovery cycle complete: discovered=%d, reachable=%d, collected=%d",
        _engine_state["servers_discovered"],
        _engine_state["servers_reachable"],
        _engine_state["servers_collected"],
    )


# ═══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def _get_known_servers() -> List[str]:
    """Get servers from previous collections/manual entries in the DB."""
    try:
        from services.onprem_service import _conn
        db = _conn()
        rows = db.execute("SELECT DISTINCT hostname FROM onprem_servers").fetchall()
        db.close()
        return [r[0] for r in rows if r[0]]
    except Exception:
        return []


def _add_error(msg: str):
    """Add error to the ring buffer."""
    entry = {"time": _now(), "message": msg}
    _engine_state["errors"].append(entry)
    if len(_engine_state["errors"]) > _MAX_ERRORS:
        _engine_state["errors"] = _engine_state["errors"][-_MAX_ERRORS:]
    logger.warning("Engine error: %s", msg)


# ═══════════════════════════════════════════════════════════════════════════════
# AUTO-START ON APP STARTUP
# ═══════════════════════════════════════════════════════════════════════════════

async def auto_start_if_configured():
    """Called from FastAPI startup — starts engine if interval is configured."""
    from services import settings_service as svc
    from services import ldap_service

    interval = float(svc.get_value("ONPREM_DISCOVERY_INTERVAL_HOURS", 0))
    if interval > 0 and ldap_service.is_configured():
        logger.info("Auto-starting on-prem discovery engine (interval=%sh)", interval)
        await start_engine(interval)
