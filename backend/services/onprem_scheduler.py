"""
On-Premises Scheduled Monitoring
================================
A lightweight scheduler that periodically re-scans the customer's on-premises
servers using the existing remote-collection engine. Customers can:

  * choose WHAT to scan        -> per-module toggles (hardware, os, sql, iis, ...)
  * choose HOW MANY at once    -> max_concurrent (parallel device fan-out)
  * choose WHEN                 -> daily at a wall-clock time, every N hours, or
                                  purely on-demand ("Scan now")
  * choose WHICH servers        -> the whole inventory, or a hand-picked subset

The schedule is persisted to a small JSON file so it survives restarts. A single
asyncio background task evaluates the schedule every tick and triggers a
collection job (via onprem_discovery_service.start_collection) when one is due.
Runs never overlap: a new scheduled run is skipped while a previous job is still
running.
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# PERSISTENCE
# ═══════════════════════════════════════════════════════════════════════════════

_CONFIG_PATH = Path(__file__).resolve().parent.parent / "data" / "onprem_schedule.json"
_lock = threading.Lock()
_MAX_HISTORY = 30

_ALL_MODULES = [
    "hardware", "os", "disks", "network", "services",
    "applications", "sql", "iis", "security", "certificates", "roles",
]

DEFAULT_CONFIG: Dict[str, Any] = {
    "enabled": False,
    "mode": "daily",                 # "daily" | "interval" | "manual"
    "time_of_day": "02:00",          # HH:MM local wall-clock (mode=daily)
    "interval_hours": 24,            # mode=interval
    "target": "all",                 # "all" | "selected"
    "servers": [],                   # explicit hostnames (target=selected)
    "modules": {m: True for m in _ALL_MODULES},
    "max_concurrent": 5,             # parallel devices scanned simultaneously
    "timeout_per_server": 180,       # seconds per device
    # ── runtime / persisted status ──
    "anchor": None,                  # ISO local when schedule was last saved (daily gating)
    "last_run": None,                # ISO local of last trigger
    "last_status": None,             # running | completed | error | skipped | cancelled
    "last_job_id": None,
    "last_trigger": None,            # "scheduled" | "manual"
    "last_summary": None,            # {total, succeeded, failed}
    "history": [],                   # recent runs (newest first)
}

# Bounds (mirror the collection engine caps)
_MAX_CONCURRENT_CAP = 20
_MIN_INTERVAL_HOURS = 1


def _now() -> datetime:
    return datetime.now()


def _now_iso() -> str:
    return _now().isoformat(timespec="seconds")


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None


def _load_config() -> Dict[str, Any]:
    """Load schedule config from disk, merged over defaults."""
    cfg = dict(DEFAULT_CONFIG)
    cfg["modules"] = dict(DEFAULT_CONFIG["modules"])
    try:
        if _CONFIG_PATH.exists():
            with open(_CONFIG_PATH, "r", encoding="utf-8") as fh:
                stored = json.load(fh)
            if isinstance(stored, dict):
                modules = stored.pop("modules", None)
                cfg.update(stored)
                if isinstance(modules, dict):
                    cfg["modules"] = {m: bool(modules.get(m, True)) for m in _ALL_MODULES}
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("onprem_scheduler: could not read config (%s) — using defaults", exc)
    return cfg


def _save_config(cfg: Dict[str, Any]) -> None:
    try:
        _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(_CONFIG_PATH, "w", encoding="utf-8") as fh:
            json.dump(cfg, fh, indent=2)
    except OSError as exc:
        logger.warning("onprem_scheduler: could not persist config: %s", exc)


# ═══════════════════════════════════════════════════════════════════════════════
# VALIDATION / NORMALISATION
# ═══════════════════════════════════════════════════════════════════════════════

def _coerce_config(updates: Dict[str, Any], base: Dict[str, Any]) -> Dict[str, Any]:
    """Validate + clamp user-supplied schedule fields onto a base config."""
    cfg = dict(base)

    if "enabled" in updates:
        cfg["enabled"] = bool(updates["enabled"])

    if "mode" in updates and updates["mode"] in ("daily", "interval", "manual"):
        cfg["mode"] = updates["mode"]

    if "time_of_day" in updates:
        t = str(updates["time_of_day"]).strip()
        try:
            hh, mm = t.split(":")
            hh, mm = int(hh), int(mm)
            if 0 <= hh < 24 and 0 <= mm < 60:
                cfg["time_of_day"] = f"{hh:02d}:{mm:02d}"
        except (ValueError, AttributeError):
            pass

    if "interval_hours" in updates:
        try:
            cfg["interval_hours"] = max(_MIN_INTERVAL_HOURS, int(updates["interval_hours"]))
        except (ValueError, TypeError):
            pass

    if "target" in updates and updates["target"] in ("all", "selected"):
        cfg["target"] = updates["target"]

    if "servers" in updates and isinstance(updates["servers"], list):
        cfg["servers"] = [str(s).strip() for s in updates["servers"] if str(s).strip()][:500]

    if "modules" in updates and isinstance(updates["modules"], dict):
        cfg["modules"] = {m: bool(updates["modules"].get(m, base["modules"].get(m, True))) for m in _ALL_MODULES}

    if "max_concurrent" in updates:
        try:
            cfg["max_concurrent"] = max(1, min(_MAX_CONCURRENT_CAP, int(updates["max_concurrent"])))
        except (ValueError, TypeError):
            pass

    if "timeout_per_server" in updates:
        try:
            cfg["timeout_per_server"] = max(30, min(600, int(updates["timeout_per_server"])))
        except (ValueError, TypeError):
            pass

    return cfg


# ═══════════════════════════════════════════════════════════════════════════════
# SCHEDULE MATH
# ═══════════════════════════════════════════════════════════════════════════════

def _parse_hhmm(s: str) -> tuple[int, int]:
    try:
        hh, mm = s.split(":")
        return int(hh), int(mm)
    except (ValueError, AttributeError):
        return 2, 0


def _compute_next_run(cfg: Dict[str, Any]) -> Optional[datetime]:
    """Return the next datetime the schedule should fire, or None if it won't."""
    if not cfg.get("enabled") or cfg.get("mode") == "manual":
        return None
    now = _now()
    last = _parse_iso(cfg.get("last_run"))

    if cfg["mode"] == "interval":
        base = last or now
        nxt = base + timedelta(hours=max(_MIN_INTERVAL_HOURS, int(cfg.get("interval_hours", 24))))
        return max(nxt, now) if nxt < now else nxt

    # daily
    hh, mm = _parse_hhmm(cfg.get("time_of_day", "02:00"))
    today_run = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    anchor = _parse_iso(cfg.get("anchor"))
    upcoming_today = (now < today_run) and (anchor is None or today_run >= anchor) and (not last or last < today_run)
    return today_run if upcoming_today else today_run + timedelta(days=1)


def _is_due(cfg: Dict[str, Any]) -> bool:
    """Has the schedule's fire time arrived (and not yet been run for this slot)?"""
    if not cfg.get("enabled") or cfg.get("mode") == "manual":
        return False
    now = _now()
    last = _parse_iso(cfg.get("last_run"))

    if cfg["mode"] == "interval":
        if not last:
            return True
        return now >= last + timedelta(hours=max(_MIN_INTERVAL_HOURS, int(cfg.get("interval_hours", 24))))

    # daily — fire once on/after the configured time each day, but never "catch up"
    # a slot that predates when the schedule was saved (use "Scan now" for that).
    hh, mm = _parse_hhmm(cfg.get("time_of_day", "02:00"))
    today_run = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if now < today_run:
        return False
    anchor = _parse_iso(cfg.get("anchor"))
    if anchor and today_run < anchor:
        return False
    return (last is None) or (last < today_run)


# ═══════════════════════════════════════════════════════════════════════════════
# TARGET RESOLUTION
# ═══════════════════════════════════════════════════════════════════════════════

def _resolve_targets(cfg: Dict[str, Any]) -> List[str]:
    """Resolve the list of hostnames to scan for this run."""
    if cfg.get("target") == "selected":
        return [s for s in cfg.get("servers", []) if s]
    # target == all -> current inventory
    try:
        from services.onprem_service import get_all_servers
        servers = get_all_servers() or []
        hosts = []
        for s in servers:
            h = (s.get("hostname") or s.get("name") or "").strip() if isinstance(s, dict) else str(s).strip()
            if h:
                hosts.append(h)
        # de-dupe, preserve order
        seen, out = set(), []
        for h in hosts:
            k = h.lower()
            if k not in seen:
                seen.add(k)
                out.append(h)
        return out
    except Exception as exc:
        logger.warning("onprem_scheduler: could not resolve inventory targets: %s", exc)
        return []


def _job_is_running(job_id: Optional[str]) -> bool:
    if not job_id:
        return False
    try:
        from services.onprem_discovery_service import get_collection_status
        return get_collection_status(job_id).get("status") == "running"
    except Exception:
        return False


# ═══════════════════════════════════════════════════════════════════════════════
# RUN EXECUTION
# ═══════════════════════════════════════════════════════════════════════════════

def _execute_run(trigger: str = "scheduled", overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Resolve targets and kick off a collection job. Returns a small result dict."""
    with _lock:
        cfg = _load_config()
        # Guard against overlapping runs
        if _job_is_running(cfg.get("last_job_id")):
            return {"started": False, "reason": "A scan is already running", "job_id": cfg.get("last_job_id")}

        run_cfg = _coerce_config(overrides or {}, cfg) if overrides else cfg
        targets = _resolve_targets(run_cfg)
        ts = _now_iso()

        if not targets:
            cfg["last_run"] = ts
            cfg["last_status"] = "skipped"
            cfg["last_trigger"] = trigger
            cfg["last_job_id"] = None
            cfg["last_summary"] = {"total": 0, "succeeded": 0, "failed": 0}
            _push_history(cfg, {"at": ts, "trigger": trigger, "status": "skipped",
                                "total": 0, "job_id": None, "reason": "no targets"})
            _save_config(cfg)
            return {"started": False, "reason": "No servers to scan (inventory empty or none selected)"}

        from services.onprem_discovery_service import start_collection
        options = {
            "max_concurrent": run_cfg.get("max_concurrent", 5),
            "timeout_per_server": run_cfg.get("timeout_per_server", 180),
        }
        result = start_collection(targets, run_cfg.get("modules", {}), options)
        job_id = result.get("job_id")

        cfg["last_run"] = ts
        cfg["last_status"] = "running" if job_id else "error"
        cfg["last_trigger"] = trigger
        cfg["last_job_id"] = job_id
        cfg["last_summary"] = {"total": result.get("total_servers", len(targets)), "succeeded": 0, "failed": 0}
        _push_history(cfg, {"at": ts, "trigger": trigger, "status": cfg["last_status"],
                            "total": result.get("total_servers", len(targets)), "job_id": job_id})
        _save_config(cfg)

        return {"started": bool(job_id), "job_id": job_id,
                "total_servers": result.get("total_servers", len(targets)),
                "error": result.get("error")}


def _push_history(cfg: Dict[str, Any], entry: Dict[str, Any]) -> None:
    hist = cfg.get("history") or []
    hist.insert(0, entry)
    cfg["history"] = hist[:_MAX_HISTORY]


def _reconcile_last(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Refresh last_status/summary from the live job (jobs live in-memory)."""
    job_id = cfg.get("last_job_id")
    if not job_id or cfg.get("last_status") not in ("running", None):
        return cfg
    try:
        from services.onprem_discovery_service import get_collection_status
        st = get_collection_status(job_id)
        status = st.get("status")
        if status == "unknown":
            # Job no longer tracked (e.g. backend restarted mid-run) — don't show
            # a perpetual "running".
            cfg["last_status"] = "interrupted"
            if cfg.get("history"):
                cfg["history"][0]["status"] = "interrupted"
        elif status:
            cfg["last_status"] = status
            cfg["last_summary"] = {
                "total": st.get("total", 0),
                "succeeded": st.get("succeeded", 0),
                "failed": st.get("failed", 0),
            }
            if cfg.get("history"):
                cfg["history"][0]["status"] = status
                cfg["history"][0]["succeeded"] = st.get("succeeded", 0)
                cfg["history"][0]["failed"] = st.get("failed", 0)
    except Exception:
        pass
    return cfg


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC API (used by FastAPI endpoints)
# ═══════════════════════════════════════════════════════════════════════════════

def get_schedule() -> Dict[str, Any]:
    """Return the full schedule config + live status (next/last run, running)."""
    with _lock:
        cfg = _reconcile_last(_load_config())
        _save_config(cfg)
    out = dict(cfg)
    nxt = _compute_next_run(cfg)
    out["next_run"] = nxt.isoformat(timespec="seconds") if nxt else None
    out["is_running"] = _job_is_running(cfg.get("last_job_id"))
    out["inventory_count"] = len(_resolve_targets({"target": "all"}))
    out["max_concurrent_cap"] = _MAX_CONCURRENT_CAP
    out["available_modules"] = _ALL_MODULES
    return out


def update_schedule(updates: Dict[str, Any]) -> Dict[str, Any]:
    """Validate + persist schedule changes. Loop picks them up on next tick."""
    with _lock:
        cfg = _load_config()
        cfg = _coerce_config(updates, cfg)
        cfg["anchor"] = _now_iso()
        _save_config(cfg)
    logger.info("onprem_scheduler: schedule updated (enabled=%s mode=%s)", cfg.get("enabled"), cfg.get("mode"))
    return get_schedule()


def run_now(overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Trigger an immediate scan using the saved config (optionally overridden)."""
    res = _execute_run(trigger="manual", overrides=overrides)
    res["schedule"] = get_schedule()
    return res


def get_history() -> Dict[str, Any]:
    with _lock:
        cfg = _reconcile_last(_load_config())
        _save_config(cfg)
    return {"history": cfg.get("history", []), "last_run": cfg.get("last_run"),
            "last_status": cfg.get("last_status")}


# ═══════════════════════════════════════════════════════════════════════════════
# BACKGROUND LOOP
# ═══════════════════════════════════════════════════════════════════════════════

_loop_task: Optional[asyncio.Task] = None
_stop_event: Optional[asyncio.Event] = None
_TICK_SECONDS = 30


async def _interruptible_sleep(seconds: float) -> None:
    if _stop_event is None:
        await asyncio.sleep(seconds)
        return
    try:
        await asyncio.wait_for(_stop_event.wait(), timeout=seconds)
    except asyncio.TimeoutError:
        pass


async def _scheduler_loop() -> None:
    logger.info("onprem_scheduler: loop started (tick=%ss)", _TICK_SECONDS)
    while _stop_event is None or not _stop_event.is_set():
        try:
            cfg = _load_config()
            if cfg.get("enabled") and cfg.get("mode") in ("daily", "interval"):
                if _is_due(cfg) and not _job_is_running(cfg.get("last_job_id")):
                    logger.info("onprem_scheduler: schedule due — starting scan")
                    await asyncio.to_thread(_execute_run, "scheduled", None)
        except Exception as exc:
            logger.warning("onprem_scheduler: loop tick failed: %s", exc)
        await _interruptible_sleep(_TICK_SECONDS)
    logger.info("onprem_scheduler: loop stopped")


def start_scheduler() -> None:
    """Start the background scheduler loop (idempotent)."""
    global _loop_task, _stop_event
    if _loop_task and not _loop_task.done():
        return
    _stop_event = asyncio.Event()
    _loop_task = asyncio.create_task(_scheduler_loop())


async def stop_scheduler() -> None:
    global _loop_task
    if _stop_event:
        _stop_event.set()
    if _loop_task:
        try:
            await asyncio.wait_for(_loop_task, timeout=5)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            _loop_task.cancel()
    _loop_task = None
