"""
Entra ID (Microsoft Azure AD) sign-in gate for the web UI.

The single-page app signs the user in with MSAL (authorization-code + PKCE, no
client secret) and sends the resulting Entra token as a Bearer token on every
``/api`` call — and as ``?access_token=`` on the SSE stream, because the browser
``EventSource`` API cannot set request headers. This module validates that token
against the tenant's published signing keys (JWKS).

Auth is ENABLED only when ``ENTRA_CLIENT_ID`` + ``ENTRA_TENANT_ID`` are configured
(the deployment scripts set these as App Service / Container App settings). With no
configuration the app runs open, so local development and the in-app setup wizard
are completely unaffected.

Set ``AUTH_REQUIRED=false`` to force-disable the gate even when a client id is
present (useful for a temporary break-glass), or ``AUTH_REQUIRED=true`` to require
it explicitly.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

CLIENT_ID: str = os.environ.get("ENTRA_CLIENT_ID", "").strip()
TENANT_ID: str = os.environ.get("ENTRA_TENANT_ID", "").strip()

# Delegated scope the SPA requests. User.Read lets us show the signed-in user's
# name and is consented by default on most tenants (no exposed API scope needed).
_SCOPES = ["User.Read"]

# JWKS clients are cached per tenant (constructing one fetches signing keys).
_jwk_clients: dict = {}


# NOTE: configuration is read from the environment LAZILY (at call time), not at
# import time. main.py imports this module before load_dotenv() runs, so reading
# at import time would miss values provided via a local .env file. Reading on each
# call also lets you toggle AUTH_REQUIRED without code changes.
def _client_id() -> str:
    return os.environ.get("ENTRA_CLIENT_ID", "").strip()


def _tenant_id() -> str:
    return os.environ.get("ENTRA_TENANT_ID", "").strip()


def _auth_required() -> bool:
    flag = os.environ.get("AUTH_REQUIRED", "").strip().lower()
    if flag in ("0", "false", "no", "off"):
        return False
    if flag in ("1", "true", "yes", "on"):
        return True
    # Default: gate the app whenever a login app registration has been configured.
    return bool(_client_id() and _tenant_id())


def _get_jwk_client(tenant_id: str):
    """Construct (and cache per tenant) the JWKS client so repeated calls are cheap.

    The signing keys are cached for 24h (lifespan) so steady-state validation does
    ZERO network I/O, and the one-time discovery fetch is bounded by a short timeout
    so a stalled egress to login.microsoftonline.com can never block the auth
    middleware (and therefore the whole event loop) indefinitely — that hang is what
    wedged every /api call on "Connecting to backend…".
    """
    if not tenant_id:
        return None
    client = _jwk_clients.get(tenant_id)
    if client is None:
        from jwt import PyJWKClient
        uri = f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys"
        try:
            client = PyJWKClient(uri, cache_keys=True, lifespan=86400, timeout=5)
        except TypeError:
            # Older PyJWT without the lifespan/timeout kwargs — degrade gracefully.
            client = PyJWKClient(uri)
        _jwk_clients[tenant_id] = client
    return client


def is_enabled() -> bool:
    """True when the sign-in gate should be enforced."""
    return _auth_required() and bool(_client_id()) and bool(_tenant_id())


def public_config() -> dict:
    """Runtime config the SPA fetches at boot to initialise MSAL.

    Returned by the PUBLIC ``/api/auth/config`` endpoint (never gated) so the
    login page can load before the user has a token.
    """
    cid = _client_id()
    tid = _tenant_id()
    return {
        "authRequired": is_enabled(),
        "clientId": cid,
        "tenantId": tid,
        "authority": f"https://login.microsoftonline.com/{tid}" if tid else "",
        "scopes": _SCOPES,
    }


def validate_bearer(token: Optional[str]) -> Optional[dict]:
    """Validate an Entra-issued JWT. Returns the claims dict, or None if invalid.

    Verifies the RS256 signature against the tenant JWKS, the audience (the login
    app registration) and the issuer (the tenant). Any failure degrades to None so
    the caller returns 401.
    """
    if not token or not is_enabled():
        return None
    cid = _client_id()
    tid = _tenant_id()
    allowed_audiences = [a for a in (cid, f"api://{cid}") if cid]
    allowed_issuers = [
        f"https://login.microsoftonline.com/{tid}/v2.0",
        f"https://sts.windows.net/{tid}/",
    ]
    try:
        import jwt  # PyJWT
        client = _get_jwk_client(tid)
        if client is None:
            return None
        signing_key = client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=allowed_audiences,
            options={"verify_aud": True, "verify_exp": True},
        )
        if claims.get("iss", "") not in allowed_issuers:
            logger.warning("auth: token rejected - unexpected issuer %s", claims.get("iss"))
            return None
        return claims
    except Exception as exc:  # noqa: BLE001 - any failure means "not authenticated"
        logger.warning("auth: token validation failed: %s", exc)
        return None


def principal_from_claims(claims: dict) -> dict:
    """Extract a small, safe user descriptor from validated claims."""
    return {
        "name": claims.get("name") or claims.get("preferred_username") or "",
        "username": claims.get("preferred_username") or claims.get("upn") or "",
        "oid": claims.get("oid") or claims.get("sub") or "",
    }


# ── ZureMap embed session cookie ──────────────────────────────────────────────
# The embedded "Architecture Map" engine is served same-origin under /zuremap/*
# and reverse-proxied by the backend. The iframe cannot send our Entra Bearer
# header, so those proxied routes are gated by a short-lived HMAC-signed cookie the
# SPA obtains from POST /api/zuremap/session (which itself passes the Bearer gate).
# Stateless — any replica validates with the shared ZUREMAP_SESSION_KEY — so it is
# correct with more than one replica.
import hmac as _hmac
import hashlib as _hashlib
import time as _time
import secrets as _secrets

_ZM_KEY: Optional[bytes] = None


def _zm_session_key() -> bytes:
    global _ZM_KEY
    if _ZM_KEY is None:
        k = os.environ.get("ZUREMAP_SESSION_KEY", "").strip()
        _ZM_KEY = k.encode("utf-8") if k else _secrets.token_bytes(32)
    return _ZM_KEY


def make_zuremap_cookie(ttl_seconds: int = 28800) -> str:
    """Issue a signed '<exp>.<hmac>' value that gates the /zuremap proxy (default 8h)."""
    exp = str(int(_time.time()) + ttl_seconds)
    sig = _hmac.new(_zm_session_key(), exp.encode("utf-8"), _hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


def check_zuremap_cookie(value: Optional[str]) -> bool:
    """True when a /zuremap session cookie is correctly signed and not expired."""
    if not value or "." not in value:
        return False
    try:
        exp, sig = value.rsplit(".", 1)
        expected = _hmac.new(_zm_session_key(), exp.encode("utf-8"), _hashlib.sha256).hexdigest()
        return _hmac.compare_digest(sig, expected) and int(exp) > int(_time.time())
    except Exception:
        return False
