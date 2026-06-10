"""
cache_service.py — Optional Redis L2 cache + distributed lock coordinator.

Design goals
------------
* GRACEFUL DEGRADATION: when ``REDIS_URL`` is unset or the Redis server is
  unreachable, every function becomes a safe no-op. ``get_json`` returns None,
  ``set_json`` returns False, and ``acquire_lock`` returns the sentinel token
  ``"LOCAL"`` so callers fall back to their existing in-process guard. This
  means local / single-process runs behave EXACTLY as before — Redis is purely
  additive.
* SHARED L2 in front of the durable Azure SQL snapshots: restart-proof warm
  dashboard, faster cold opens, and (critically) a distributed lock so only one
  replica runs the 429-throttled cost / metrics background jobs instead of every
  replica running its own and multiplying throttling.

The client is synchronous on purpose: all call sites are short, blocking
key/value operations (small JSON blobs + SET NX locks) invoked from code paths
that are already doing blocking I/O. A short socket timeout means a dead Redis
degrades within ~2s instead of hanging the request.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import uuid
from typing import Any, Optional

logger = logging.getLogger(__name__)

try:  # redis>=5 — optional dependency
    import redis as _redis
except Exception:  # pragma: no cover - package not installed
    _redis = None  # type: ignore

import services.settings_service as settings_svc

_client = None
_client_lock = threading.Lock()
_enabled = False
_last_error: Optional[str] = None
_warned = False
_active_url: Optional[str] = None


def _get_url() -> str:
    """Resolve the Redis connection string from settings first, then env."""
    try:
        url = (settings_svc.get_value("REDIS_URL", "") or "").strip()
    except Exception:
        url = ""
    if not url:
        url = (os.getenv("REDIS_URL", "") or "").strip()
    return url


def _client_or_none():
    """Return a live Redis client or None. Lazily (re)connects; rebuilds the
    client if the configured URL changes; never raises."""
    global _client, _enabled, _last_error, _warned, _active_url

    url = _get_url()
    if not url:
        if _client is not None:
            try:
                _client.close()
            except Exception:
                pass
            _client = None
            _active_url = None
        _enabled = False
        return None

    # URL changed at runtime (e.g. user pasted a connection string in Settings)
    if _client is not None and url != _active_url:
        try:
            _client.close()
        except Exception:
            pass
        _client = None

    if _client is not None:
        return _client

    if _redis is None:
        if not _warned:
            logger.warning("cache_service: 'redis' package not installed — caching disabled")
            _warned = True
        return None

    with _client_lock:
        if _client is not None:
            return _client
        try:
            c = _redis.Redis.from_url(
                url,
                socket_connect_timeout=2,
                socket_timeout=2,
                retry_on_timeout=False,
                decode_responses=True,
            )
            c.ping()
            _client = c
            _active_url = url
            _enabled = True
            _last_error = None
            _warned = False
            logger.info("cache_service: connected to Redis \u2713")
            return _client
        except Exception as exc:
            _last_error = str(exc)
            _enabled = False
            if not _warned:
                logger.warning("cache_service: Redis unavailable (%s) — running without cache", exc)
                _warned = True
            return None


def is_enabled() -> bool:
    """True when a live Redis connection is available."""
    return _client_or_none() is not None


# ── Key/value JSON cache ──────────────────────────────────────────────────────
def get_json(key: str) -> Optional[Any]:
    c = _client_or_none()
    if not c:
        return None
    try:
        raw = c.get(key)
        return json.loads(raw) if raw else None
    except Exception as exc:
        logger.debug("cache_service.get_json(%s) failed: %s", key, exc)
        return None


def set_json(key: str, value: Any, ttl_seconds: Optional[int] = None) -> bool:
    c = _client_or_none()
    if not c:
        return False
    try:
        payload = json.dumps(value, default=str)
        if ttl_seconds and ttl_seconds > 0:
            c.set(key, payload, ex=int(ttl_seconds))
        else:
            c.set(key, payload)
        return True
    except Exception as exc:
        logger.debug("cache_service.set_json(%s) failed: %s", key, exc)
        return False


def delete(key: str) -> bool:
    c = _client_or_none()
    if not c:
        return False
    try:
        c.delete(key)
        return True
    except Exception:
        return False


# ── Distributed lock ──────────────────────────────────────────────────────────
# Release uses a compare-and-delete Lua script so a worker only ever releases a
# lock it still owns (prevents deleting a lock that has since expired and been
# re-acquired by another worker).
_RELEASE_LUA = (
    "if redis.call('get', KEYS[1]) == ARGV[1] then "
    "return redis.call('del', KEYS[1]) else return 0 end"
)


def acquire_lock(name: str, ttl_seconds: int = 3600) -> Optional[str]:
    """Try to acquire a cross-replica lock.

    Returns:
        * a unique token string on success,
        * ``None`` when another worker already holds the lock,
        * the sentinel ``"LOCAL"`` when Redis is unavailable (the caller's
          existing in-process guard then governs single-process behavior).
    """
    c = _client_or_none()
    if not c:
        return "LOCAL"
    token = uuid.uuid4().hex
    try:
        ok = c.set(name, token, nx=True, ex=int(ttl_seconds))
        return token if ok else None
    except Exception as exc:
        logger.debug("cache_service.acquire_lock(%s) failed: %s", name, exc)
        return "LOCAL"


def release_lock(name: str, token: Optional[str]) -> None:
    if not token or token == "LOCAL":
        return
    c = _client_or_none()
    if not c:
        return
    try:
        c.eval(_RELEASE_LUA, 1, name, token)
    except Exception as exc:
        logger.debug("cache_service.release_lock(%s) failed: %s", name, exc)


def status() -> dict:
    """Lightweight health snapshot for /api surfaces (no secrets)."""
    enabled = is_enabled()
    info: dict[str, Any] = {
        "enabled": enabled,
        "url_configured": bool(_get_url()),
        "last_error": _last_error,
    }
    if enabled and _client is not None:
        try:
            srv = _client.info(section="server")
            info["redis_version"] = srv.get("redis_version")
        except Exception:
            pass
    return info
