"""
In-memory settings store. Values are loaded from .env on startup and can
be updated at runtime from the GUI. Azure SDK credential cache is reset
automatically whenever Azure credentials change.
"""
from __future__ import annotations

import os
import stat
import time
from pathlib import Path
from typing import Any, Dict

# Load from SETTINGS_DIR volume first (Docker), then fall back to backend/.env (local)
def _load_env_file() -> None:
    settings_dir = os.getenv("SETTINGS_DIR", "")
    candidates = []
    if settings_dir:
        candidates.append(Path(settings_dir) / ".env")
    candidates.append(Path(__file__).parent.parent / ".env")
    for path in candidates:
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())
            break

_load_env_file()

_settings: Dict[str, Any] = {
    # Azure
    "AZURE_CLIENT_ID":        os.getenv("AZURE_CLIENT_ID",        ""),
    "AZURE_CLIENT_SECRET":    os.getenv("AZURE_CLIENT_SECRET",    ""),
    "AZURE_TENANT_ID":        os.getenv("AZURE_TENANT_ID",        ""),
    "AZURE_SUBSCRIPTION_ID":  os.getenv("AZURE_SUBSCRIPTION_ID",  ""),
    # Multi-subscription: comma-separated list; if set, overrides AZURE_SUBSCRIPTION_ID list
    "AZURE_SUBSCRIPTION_IDS": os.getenv("AZURE_SUBSCRIPTION_IDS", ""),
    # Scan scope — optional, limits scans to a specific subscription/RG for testing
    "SCAN_SCOPE_SUBSCRIPTION_ID": os.getenv("SCAN_SCOPE_SUBSCRIPTION_ID", ""),
    "SCAN_SCOPE_RESOURCE_GROUP":  os.getenv("SCAN_SCOPE_RESOURCE_GROUP",  ""),
    # AI — provider selection
    "ai_provider":             os.getenv("AI_PROVIDER", "none"),  # "claude" | "azure_openai" | "none"
    # Claude (Anthropic)
    "ANTHROPIC_API_KEY":       os.getenv("ANTHROPIC_API_KEY", ""),
    # Azure OpenAI
    "AZURE_OPENAI_ENDPOINT":   os.getenv("AZURE_OPENAI_ENDPOINT",   ""),
    "AZURE_OPENAI_KEY":        os.getenv("AZURE_OPENAI_KEY",        ""),
    "AZURE_OPENAI_DEPLOYMENT": os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o"),
    # Scoring thresholds
    "idle_threshold_pct":      float(os.getenv("IDLE_THRESHOLD_PCT",    "3.0")),
    "no_metrics_age_days":     int(os.getenv("NO_METRICS_AGE_DAYS",     "7")),
    "cost_floor_usd":          float(os.getenv("COST_FLOOR_USD",        "0.0")),
    "ai_cost_threshold_usd":   float(os.getenv("AI_COST_THRESHOLD_USD", "20.0")),
    "cache_ttl_seconds":       int(os.getenv("CACHE_TTL_SECONDS",       "1800")),
    # Security
    "credential_timeout_hours": int(os.getenv("CREDENTIAL_TIMEOUT_HOURS", "0")),
    # Feature flags
    "demo_mode": False,
    # Auto-refresh — 0 = disabled; otherwise run a background scan every N hours.
    # Default 6h: proactively keeps the dashboard snapshot fresh with a light scan
    # without hitting Azure Cost Management often enough to risk 429 throttling.
    "auto_refresh_interval_hours": int(os.getenv("AUTO_REFRESH_INTERVAL_HOURS", "6")),
    # Optional shared L2 cache + distributed lock (Azure Managed Redis / Redis).
    # Empty = disabled (app degrades gracefully to in-process caching).
    "REDIS_URL":               os.getenv("REDIS_URL", ""),
    # ── On-Premises / LDAP Configuration ──
    "ONPREM_DC_HOST":          os.getenv("ONPREM_DC_HOST", ""),
    "ONPREM_DC_PORT":          int(os.getenv("ONPREM_DC_PORT", "389")),
    "ONPREM_USE_SSL":          os.getenv("ONPREM_USE_SSL", "").lower() in ("true", "1", "yes"),
    "ONPREM_USE_STARTTLS":     os.getenv("ONPREM_USE_STARTTLS", "").lower() in ("true", "1", "yes"),
    "ONPREM_BASE_DN":          os.getenv("ONPREM_BASE_DN", ""),
    "ONPREM_BIND_USER":        os.getenv("ONPREM_BIND_USER", ""),
    "ONPREM_BIND_PASSWORD":    os.getenv("ONPREM_BIND_PASSWORD", ""),
    "ONPREM_AUTH_METHOD":      os.getenv("ONPREM_AUTH_METHOD", "ntlm"),
    "ONPREM_CONNECT_TIMEOUT":  int(os.getenv("ONPREM_CONNECT_TIMEOUT", "10")),
    "ONPREM_SEARCH_TIMEOUT":   int(os.getenv("ONPREM_SEARCH_TIMEOUT", "30")),
    # WinRM credentials (for remote collection) — if empty, uses current user context
    "ONPREM_WINRM_USER":       os.getenv("ONPREM_WINRM_USER", ""),
    "ONPREM_WINRM_PASSWORD":   os.getenv("ONPREM_WINRM_PASSWORD", ""),
    # Discovery engine interval (hours, 0=disabled)
    "ONPREM_DISCOVERY_INTERVAL_HOURS": float(os.getenv("ONPREM_DISCOVERY_INTERVAL_HOURS", "0")),
}

# Tracks the last time credentials were successfully used for a scan.
# Used by the credential timeout / auto-wipe feature.
_cred_last_used: float = time.time()

# Keys that hold secrets — candidates for auto-wipe
_SECRET_KEYS = {"AZURE_CLIENT_SECRET", "ANTHROPIC_API_KEY", "AZURE_OPENAI_KEY"}

# On-prem secrets — encrypted via credential_store, NOT auto-wiped
_ONPREM_SECRET_KEYS = {"ONPREM_BIND_PASSWORD", "ONPREM_WINRM_PASSWORD"}

_AZURE_KEYS = {"AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID", "AZURE_SUBSCRIPTION_ID", "AZURE_SUBSCRIPTION_IDS"}

_ONPREM_KEYS = {
    "ONPREM_DC_HOST", "ONPREM_DC_PORT", "ONPREM_USE_SSL", "ONPREM_USE_STARTTLS",
    "ONPREM_BASE_DN", "ONPREM_BIND_USER", "ONPREM_BIND_PASSWORD", "ONPREM_AUTH_METHOD",
    "ONPREM_CONNECT_TIMEOUT", "ONPREM_SEARCH_TIMEOUT", "ONPREM_WINRM_USER",
    "ONPREM_WINRM_PASSWORD", "ONPREM_DISCOVERY_INTERVAL_HOURS",
}


def get() -> Dict[str, Any]:
    return _settings.copy()


# Wildcard tokens that mean "discover every subscription the credential can access".
_AUTO_SUB_TOKENS = {"auto", "all", "*"}

# Short-lived cache for discovered subscription IDs so we don't call ARM on every
# request (get_subscription_ids is hit frequently across the scan).
_sub_discovery_cache: Dict[str, Any] = {"ids": None, "ts": 0.0}
_SUB_DISCOVERY_TTL = 600  # seconds (10 min)


def _discover_all_subscription_ids() -> list[str]:
    """Enumerate all enabled subscriptions the active credential can access (managed
    identity in a container, `az login` user locally). Cached for a few minutes and
    keeps the last good result on a transient failure."""
    now = time.time()
    cached = _sub_discovery_cache.get("ids")
    if cached is not None and (now - _sub_discovery_cache.get("ts", 0.0)) < _SUB_DISCOVERY_TTL:
        return cached
    try:
        from services.azure_auth import discover_subscriptions  # lazy: avoids circular import
        ids = [s["subscription_id"] for s in discover_subscriptions() if s.get("subscription_id")]
        _sub_discovery_cache["ids"] = ids
        _sub_discovery_cache["ts"] = now
        return ids
    except Exception:
        return cached or []  # keep last good (or empty) on transient failure


def invalidate_subscription_discovery_cache() -> None:
    """Force the next get_subscription_ids() to re-enumerate (e.g. after credentials change)."""
    _sub_discovery_cache["ids"] = None
    _sub_discovery_cache["ts"] = 0.0


def get_subscription_ids() -> list[str]:
    """
    Return the list of subscription IDs to scan.

    Behaviour mirrors the LOCAL server (where the logged-in user's subscriptions are
    shown automatically):

    - If AZURE_SUBSCRIPTION_IDS is an explicit comma-separated list (and not a wildcard),
      use exactly that list — lets an operator pin a subset.
    - If it is empty or a wildcard ("auto" / "all" / "*"), DYNAMICALLY discover every
      subscription the active credential can access. In a container this reflects exactly
      the subscriptions the managed identity has been granted Reader on — no hard-coded
      list — so granting the identity another subscription makes it appear automatically.
    - Fall back to the single AZURE_SUBSCRIPTION_ID only if discovery yields nothing.
    """
    multi = _settings.get("AZURE_SUBSCRIPTION_IDS", "").strip()
    if multi and multi.lower() not in _AUTO_SUB_TOKENS:
        return [s.strip() for s in multi.split(",") if s.strip()]
    discovered = _discover_all_subscription_ids()
    if discovered:
        return discovered
    primary = _settings.get("AZURE_SUBSCRIPTION_ID", "").strip()
    return [primary] if primary else []


def get_value(key: str, default=None):
    return _settings.get(key, default)


def update(updates: Dict[str, Any], persist: bool = False) -> None:
    global _settings

    # Encrypt on-prem passwords before storing
    for key in _ONPREM_SECRET_KEYS:
        if key in updates and updates[key]:
            from services.credential_store import encrypt, is_encrypted
            val = updates[key]
            if not is_encrypted(val):
                updates[key] = encrypt(val)

    _settings.update(updates)

    # Sync to os.environ so the Azure SDK picks up new creds immediately
    for key in list(_AZURE_KEYS) + ["ANTHROPIC_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_KEY", "AZURE_OPENAI_DEPLOYMENT"]:
        if key in updates and updates[key]:
            os.environ[key] = str(updates[key])

    if any(k in updates for k in _AZURE_KEYS):
        from .azure_auth import reset_credential
        reset_credential()
        invalidate_subscription_discovery_cache()  # creds changed → re-enumerate subs

    if persist:
        _write_env_file()


def safe_export() -> Dict[str, Any]:
    """Return settings with secrets masked for the frontend."""
    s = _settings.copy()
    for field in ("AZURE_CLIENT_SECRET", "ANTHROPIC_API_KEY", "AZURE_OPENAI_KEY",
                  "ONPREM_BIND_PASSWORD", "ONPREM_WINRM_PASSWORD", "REDIS_URL"):
        v = s.get(field, "")
        # Encrypted values start with 'enc:' — just show masked
        if v and (v.startswith("enc:") or len(v) > 4):
            s[field] = "••••configured"
        elif v:
            s[field] = "••••"
        else:
            s[field] = ""
    return s


def touch_credential_use() -> None:
    """Record that credentials were successfully used right now."""
    global _cred_last_used
    _cred_last_used = time.time()


def wipe_secrets() -> None:
    """
    Zero out stored secrets in memory, os.environ, and .env.
    Only wipes service principal / API keys — leaves subscription ID and
    tenant ID intact so the user knows which account to re-authenticate.
    """
    global _settings
    for key in _SECRET_KEYS:
        _settings[key] = ""
        os.environ.pop(key, None)
    from .azure_auth import reset_credential
    reset_credential()
    _write_env_file()


def check_and_wipe_if_expired() -> bool:
    """
    If a credential timeout is configured and credentials have not been used
    within the timeout window, wipe all secrets and return True.
    Only triggers when service principal credentials are stored (AZURE_CLIENT_SECRET set).
    Returns False when credentials are still valid or no timeout is configured.
    """
    timeout_hours = float(_settings.get("credential_timeout_hours", 0))
    if timeout_hours <= 0:
        return False
    # Only auto-wipe when a service principal secret is stored
    if not _settings.get("AZURE_CLIENT_SECRET", ""):
        return False
    elapsed_hours = (time.time() - _cred_last_used) / 3600
    if elapsed_hours >= timeout_hours:
        wipe_secrets()
        return True
    return False


def _get_env_path() -> Path:
    """
    Resolve the .env file path.
    SETTINGS_DIR env var allows Docker deployments to persist settings
    to a mounted volume (e.g. SETTINGS_DIR=/app/config).
    Defaults to the backend directory (existing local behaviour).
    """
    settings_dir = os.getenv("SETTINGS_DIR", "")
    if settings_dir:
        p = Path(settings_dir)
        p.mkdir(parents=True, exist_ok=True)
        return p / ".env"
    return Path(__file__).parent.parent / ".env"


def _write_env_file() -> None:
    env_path = _get_env_path()
    existing: Dict[str, str] = {}
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                existing[k.strip()] = v.strip()

    persist_keys = list(_AZURE_KEYS) + list(_ONPREM_KEYS) + ["ANTHROPIC_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_KEY", "AZURE_OPENAI_DEPLOYMENT", "ai_provider", "AZURE_SUBSCRIPTION_IDS", "SCAN_SCOPE_SUBSCRIPTION_ID", "SCAN_SCOPE_RESOURCE_GROUP", "credential_timeout_hours"]
    for key in persist_keys:
        val = _settings.get(key, "")
        if val:
            existing[key] = val
        else:
            existing.pop(key, None)  # remove cleared keys from .env

    env_path.write_text(
        "\n".join(f"{k}={v}" for k, v in existing.items()) + "\n",
        encoding="utf-8",
    )
    # Restrict file to owner-only read/write (no effect on Windows, harmless)
    try:
        os.chmod(env_path, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass
