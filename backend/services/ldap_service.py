"""
Enterprise LDAP/Active Directory Service
=========================================
Direct LDAP integration for on-premises AD discovery.
Uses Python `ldap3` library — no dependency on PowerShell RSAT or domain-joined machine.

Features:
- Connect to any AD Domain Controller via LDAP/LDAPS
- Discover all computer objects with full attributes
- Browse OU structure
- Supports explicit bind credentials (domain\\user or UPN)
- SSL/STARTTLS support
- Search filters (name, OS, OU, enabled/disabled)
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

try:
    from ldap3 import (
        Connection,
        Server,
        ALL,
        SUBTREE,
        LEVEL,
        NTLM,
        SIMPLE,
        Tls,
        ALL_ATTRIBUTES,
        ALL_OPERATIONAL_ATTRIBUTES,
    )
    from ldap3.core.exceptions import (
        LDAPException,
        LDAPBindError,
        LDAPSocketOpenError,
        LDAPInvalidFilterError,
    )
    import ssl as _ssl

    LDAP_AVAILABLE = True
except ImportError:
    LDAP_AVAILABLE = False
    logger.warning("ldap3 not installed — AD integration unavailable")


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION SCHEMA
# ═══════════════════════════════════════════════════════════════════════════════

class LDAPConfig:
    """LDAP connection configuration."""

    def __init__(self, config: dict):
        self.dc_host: str = config.get("dc_host", "").strip()
        self.dc_port: int = int(config.get("dc_port", 389))
        self.use_ssl: bool = config.get("use_ssl", False)
        self.use_starttls: bool = config.get("use_starttls", False)
        self.base_dn: str = config.get("base_dn", "").strip()
        self.bind_user: str = config.get("bind_user", "").strip()
        self.bind_password: str = config.get("bind_password", "").strip()
        self.auth_method: str = config.get("auth_method", "ntlm")  # ntlm, simple
        self.connect_timeout: int = int(config.get("connect_timeout", 10))
        self.search_timeout: int = int(config.get("search_timeout", 30))

    def validate(self) -> List[str]:
        """Return list of validation errors. Empty = valid."""
        errors = []
        if not self.dc_host:
            errors.append("Domain Controller hostname/IP is required")
        if self.dc_port < 1 or self.dc_port > 65535:
            errors.append("Port must be between 1 and 65535")
        if not self.base_dn:
            errors.append("Base DN is required (e.g., DC=corp,DC=contoso,DC=com)")
        if not self.bind_user:
            errors.append("Bind username is required (e.g., DOMAIN\\user or user@domain.com)")
        if not self.bind_password:
            errors.append("Bind password is required")
        return errors


# ═══════════════════════════════════════════════════════════════════════════════
# CONNECTION
# ═══════════════════════════════════════════════════════════════════════════════

def _create_connection(config: LDAPConfig) -> "Connection":
    """Create an LDAP connection with the given config."""
    if not LDAP_AVAILABLE:
        raise RuntimeError("ldap3 library not installed. Run: pip install ldap3")

    # TLS configuration
    tls_config = None
    if config.use_ssl or config.use_starttls:
        tls_config = Tls(
            validate=_ssl.CERT_NONE,  # Accept self-signed certs (common in enterprise AD)
            version=_ssl.PROTOCOL_TLSv1_2,
        )

    server = Server(
        config.dc_host,
        port=config.dc_port,
        use_ssl=config.use_ssl,
        get_info=ALL,
        connect_timeout=config.connect_timeout,
        tls=tls_config,
    )

    # Determine authentication method
    if config.auth_method == "ntlm":
        # NTLM auth — bind_user should be DOMAIN\\user
        user = config.bind_user
        if "@" in user and "\\" not in user:
            # Convert UPN to NTLM format: user@domain.com → DOMAIN\\user
            parts = user.split("@")
            domain = parts[1].split(".")[0].upper()
            user = f"{domain}\\{parts[0]}"
        conn = Connection(
            server,
            user=user,
            password=config.bind_password,
            authentication=NTLM,
            receive_timeout=config.search_timeout,
            raise_exceptions=True,
        )
    else:
        # Simple bind — bind_user should be full DN or UPN
        conn = Connection(
            server,
            user=config.bind_user,
            password=config.bind_password,
            authentication=SIMPLE,
            receive_timeout=config.search_timeout,
            raise_exceptions=True,
        )

    return conn


# ═══════════════════════════════════════════════════════════════════════════════
# TEST CONNECTION
# ═══════════════════════════════════════════════════════════════════════════════

def test_connection(config: dict) -> dict:
    """
    Test LDAP connectivity and authentication.
    Returns: { success, message, domain_info, error }
    """
    cfg = LDAPConfig(config)
    errors = cfg.validate()
    if errors:
        return {"success": False, "error": "; ".join(errors), "message": "", "domain_info": None}

    try:
        conn = _create_connection(cfg)
        if cfg.use_starttls and not cfg.use_ssl:
            conn.start_tls()
        conn.bind()

        # Get domain info from server
        domain_info = {}
        if conn.server.info:
            si = conn.server.info
            domain_info = {
                "dns_host_name": str(getattr(si, "other", {}).get("dnsHostName", [""])[0]) if hasattr(si, "other") else "",
                "default_naming_context": str(getattr(si, "other", {}).get("defaultNamingContext", [""])[0]) if hasattr(si, "other") else "",
                "schema_naming_context": str(getattr(si, "other", {}).get("schemaNamingContext", [""])[0]) if hasattr(si, "other") else "",
                "forest_functionality_level": str(getattr(si, "other", {}).get("forestFunctionality", [""])[0]) if hasattr(si, "other") else "",
                "domain_functionality_level": str(getattr(si, "other", {}).get("domainFunctionality", [""])[0]) if hasattr(si, "other") else "",
            }

        # Quick search test — count computer objects
        conn.search(
            search_base=cfg.base_dn,
            search_filter="(objectClass=computer)",
            search_scope=SUBTREE,
            attributes=["cn"],
            size_limit=1,
        )

        conn.unbind()

        return {
            "success": True,
            "message": f"Connected successfully to {cfg.dc_host}:{cfg.dc_port}",
            "domain_info": domain_info,
            "error": None,
        }

    except LDAPBindError as e:
        msg = str(e)
        hint = "Check username format (DOMAIN\\user or user@domain.com) and password."
        if "invalidCredentials" in msg:
            hint = "Invalid credentials. Verify username and password."
        elif "data 52e" in msg:
            hint = "Invalid credentials (AD error 52e). Username or password is incorrect."
        elif "data 775" in msg:
            hint = "Account locked out (AD error 775). Wait or contact AD admin."
        elif "data 533" in msg:
            hint = "Account disabled (AD error 533). Enable the account in AD."
        return {"success": False, "error": f"Authentication failed: {hint}", "message": "", "domain_info": None}

    except LDAPSocketOpenError as e:
        return {
            "success": False,
            "error": f"Cannot connect to {cfg.dc_host}:{cfg.dc_port} — {str(e)}. Check hostname, port, and network connectivity.",
            "message": "",
            "domain_info": None,
        }

    except LDAPException as e:
        return {"success": False, "error": f"LDAP error: {str(e)}", "message": "", "domain_info": None}

    except Exception as e:
        return {"success": False, "error": f"Connection failed: {str(e)}", "message": "", "domain_info": None}


# ═══════════════════════════════════════════════════════════════════════════════
# DISCOVER COMPUTERS
# ═══════════════════════════════════════════════════════════════════════════════

_COMPUTER_ATTRIBUTES = [
    "cn", "name", "dNSHostName", "operatingSystem", "operatingSystemVersion",
    "operatingSystemServicePack", "description", "distinguishedName",
    "whenCreated", "whenChanged", "lastLogonTimestamp", "logonCount",
    "userAccountControl", "managedBy", "location", "servicePrincipalName",
    "memberOf", "iPv4Address",
]


def discover_computers(config: dict, filters: dict = None) -> dict:
    """
    Discover domain-joined computers from Active Directory.

    Args:
        config: LDAP connection config
        filters: {
            name_filter: str — wildcard for CN (e.g., "SRV*")
            os_filter: str — substring match on OS (e.g., "Server")
            ou_filter: str — specific OU DN to search (overrides base_dn)
            enabled_only: bool — only return enabled accounts (default True)
            server_os_only: bool — only return Server OS (default False)
        }

    Returns: { success, computers: [...], total, domain, error }
    """
    cfg = LDAPConfig(config)
    errors = cfg.validate()
    if errors:
        return {"success": False, "error": "; ".join(errors), "computers": [], "total": 0}

    filters = filters or {}
    name_filter = filters.get("name_filter", "").strip()
    os_filter = filters.get("os_filter", "").strip()
    ou_filter = filters.get("ou_filter", "").strip()
    enabled_only = filters.get("enabled_only", True)
    server_os_only = filters.get("server_os_only", False)

    # Build LDAP filter
    filter_parts = ["(objectClass=computer)"]

    if name_filter:
        # Sanitize — prevent LDAP injection
        safe_name = _sanitize_ldap_value(name_filter)
        filter_parts.append(f"(cn={safe_name})")

    if os_filter:
        safe_os = _sanitize_ldap_value(os_filter)
        filter_parts.append(f"(operatingSystem=*{safe_os}*)")
    elif server_os_only:
        filter_parts.append("(operatingSystem=*Server*)")

    if enabled_only:
        # userAccountControl bit 2 = ACCOUNTDISABLE
        filter_parts.append("(!(userAccountControl:1.2.840.113556.1.4.803:=2))")

    ldap_filter = f"(&{''.join(filter_parts)})"
    search_base = ou_filter if ou_filter else cfg.base_dn

    try:
        conn = _create_connection(cfg)
        if cfg.use_starttls and not cfg.use_ssl:
            conn.start_tls()
        conn.bind()

        # Paged search to handle large directories
        computers = []
        entry_generator = conn.extend.standard.paged_search(
            search_base=search_base,
            search_filter=ldap_filter,
            search_scope=SUBTREE,
            attributes=_COMPUTER_ATTRIBUTES,
            paged_size=500,
            generator=True,
        )

        for entry in entry_generator:
            if entry.get("type") != "searchResEntry":
                continue
            attrs = entry.get("attributes", {})
            dn = entry.get("dn", "")

            # Parse userAccountControl flags
            uac = int(attrs.get("userAccountControl", 0) or 0)
            is_enabled = not (uac & 0x0002)  # ACCOUNTDISABLE bit

            # Parse last logon timestamp (Windows FILETIME → ISO)
            last_logon = ""
            lt = attrs.get("lastLogonTimestamp")
            if lt:
                try:
                    from datetime import datetime, timedelta, timezone
                    # Windows FILETIME: 100-nanosecond intervals since 1601-01-01
                    ts = int(str(lt)) if not isinstance(lt, int) else lt
                    if ts > 0:
                        dt = datetime(1601, 1, 1, tzinfo=timezone.utc) + timedelta(microseconds=ts // 10)
                        last_logon = dt.isoformat()
                except (ValueError, OverflowError):
                    pass

            # Parse whenCreated
            created = ""
            wc = attrs.get("whenCreated")
            if wc:
                try:
                    created = wc.isoformat() if hasattr(wc, "isoformat") else str(wc)
                except Exception:
                    created = str(wc) if wc else ""

            # Extract OU from DN
            ou_parts = dn.split(",")
            ou = ",".join(p for p in ou_parts[1:] if p.startswith("OU=") or p.startswith("DC="))

            computers.append({
                "name": str(attrs.get("cn", attrs.get("name", ""))),
                "dns_hostname": str(attrs.get("dNSHostName", "")),
                "os": str(attrs.get("operatingSystem", "")),
                "os_version": str(attrs.get("operatingSystemVersion", "")),
                "description": str(attrs.get("description", [""])[0]) if isinstance(attrs.get("description"), list) else str(attrs.get("description", "")),
                "enabled": is_enabled,
                "last_logon": last_logon,
                "ip_address": str(attrs.get("iPv4Address", "")),
                "ou": ou,
                "dn": dn,
                "created": created,
                "logon_count": int(attrs.get("logonCount", 0) or 0),
                "location": str(attrs.get("location", "")),
            })

        conn.unbind()

        logger.info("LDAP discovery: found %d computers matching filter '%s'", len(computers), ldap_filter)
        return {
            "success": True,
            "computers": computers,
            "total": len(computers),
            "domain": cfg.dc_host,
            "search_base": search_base,
            "filter_used": ldap_filter,
            "error": None,
        }

    except LDAPBindError:
        return {"success": False, "error": "Authentication failed. Check credentials.", "computers": [], "total": 0}
    except LDAPSocketOpenError:
        return {"success": False, "error": f"Cannot reach {cfg.dc_host}:{cfg.dc_port}", "computers": [], "total": 0}
    except LDAPInvalidFilterError as e:
        return {"success": False, "error": f"Invalid filter: {e}", "computers": [], "total": 0}
    except LDAPException as e:
        return {"success": False, "error": f"LDAP error: {e}", "computers": [], "total": 0}
    except Exception as e:
        logger.error("LDAP discovery failed: %s", e)
        return {"success": False, "error": f"Discovery failed: {e}", "computers": [], "total": 0}


# ═══════════════════════════════════════════════════════════════════════════════
# BROWSE OU STRUCTURE
# ═══════════════════════════════════════════════════════════════════════════════

def discover_ous(config: dict) -> dict:
    """
    Discover the OU tree structure in Active Directory.
    Returns: { success, ous: [{ dn, name, path, computer_count }], error }
    """
    cfg = LDAPConfig(config)
    errors = cfg.validate()
    if errors:
        return {"success": False, "error": "; ".join(errors), "ous": []}

    try:
        conn = _create_connection(cfg)
        if cfg.use_starttls and not cfg.use_ssl:
            conn.start_tls()
        conn.bind()

        ous = []

        # Search for all OUs
        conn.search(
            search_base=cfg.base_dn,
            search_filter="(objectClass=organizationalUnit)",
            search_scope=SUBTREE,
            attributes=["ou", "distinguishedName", "description"],
        )

        for entry in conn.entries:
            dn = str(entry.entry_dn)
            name = str(entry.ou) if hasattr(entry, "ou") else dn.split(",")[0].replace("OU=", "")

            # Count computers in this OU (non-recursive for performance)
            conn.search(
                search_base=dn,
                search_filter="(objectClass=computer)",
                search_scope=LEVEL,
                attributes=["cn"],
                size_limit=0,
            )
            computer_count = len(conn.entries)

            ous.append({
                "dn": dn,
                "name": name,
                "description": str(entry.description) if hasattr(entry, "description") else "",
                "computer_count": computer_count,
            })

        conn.unbind()
        return {"success": True, "ous": ous, "error": None}

    except LDAPBindError:
        return {"success": False, "error": "Authentication failed.", "ous": []}
    except Exception as e:
        return {"success": False, "error": f"OU discovery failed: {e}", "ous": []}


# ═══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def _sanitize_ldap_value(value: str) -> str:
    """
    Escape special characters to prevent LDAP injection.
    RFC 4515 defines: *, (, ), \\, NUL must be escaped.
    """
    # Keep * for wildcards but escape everything else
    result = value.replace("\\", "\\5c")
    result = result.replace("(", "\\28")
    result = result.replace(")", "\\29")
    result = result.replace("\x00", "\\00")
    return result


def get_config_from_settings() -> dict:
    """Load LDAP config from the settings service (encrypted passwords decrypted)."""
    from services import settings_service as svc
    from services.credential_store import decrypt

    return {
        "dc_host": svc.get_value("ONPREM_DC_HOST", ""),
        "dc_port": int(svc.get_value("ONPREM_DC_PORT", 389)),
        "use_ssl": svc.get_value("ONPREM_USE_SSL", False),
        "use_starttls": svc.get_value("ONPREM_USE_STARTTLS", False),
        "base_dn": svc.get_value("ONPREM_BASE_DN", ""),
        "bind_user": svc.get_value("ONPREM_BIND_USER", ""),
        "bind_password": decrypt(svc.get_value("ONPREM_BIND_PASSWORD", "")),
        "auth_method": svc.get_value("ONPREM_AUTH_METHOD", "ntlm"),
        "connect_timeout": int(svc.get_value("ONPREM_CONNECT_TIMEOUT", 10)),
        "search_timeout": int(svc.get_value("ONPREM_SEARCH_TIMEOUT", 30)),
    }


def is_configured() -> bool:
    """Check if LDAP is configured (minimum: host + base_dn + user + password)."""
    from services import settings_service as svc
    return bool(
        svc.get_value("ONPREM_DC_HOST", "") and
        svc.get_value("ONPREM_BASE_DN", "") and
        svc.get_value("ONPREM_BIND_USER", "") and
        svc.get_value("ONPREM_BIND_PASSWORD", "")
    )
