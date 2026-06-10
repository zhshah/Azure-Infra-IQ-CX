"""
Remote On-Premises Discovery & Collection Service
==================================================
Enables direct data collection from Windows servers without requiring
customers to run and sign scripts manually. Features:

- Smart server list parsing (comma, semicolon, space, newline, pipe, tab)
- Active Directory computer discovery via PowerShell RSAT module
- WinRM/WMI connectivity testing with latency measurement
- Remote data collection via CIM/WMI with DCOM fallback
- Background job management with per-server progress tracking
- Results stored in same DB format as ZIP upload (full interop with Inventory/AI tabs)
"""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# CONSTANTS
# ═══════════════════════════════════════════════════════════════════════════════

_POWERSHELL = "powershell.exe"
_PS_ARGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-OutputFormat", "Text", "-Command"]
_DEFAULT_TIMEOUT = 180  # seconds per server
_MAX_SCRIPT_TIMEOUT = 600  # max total script timeout

# ═══════════════════════════════════════════════════════════════════════════════
# JOB MANAGEMENT — in-memory tracking for background collection jobs
# ═══════════════════════════════════════════════════════════════════════════════

_jobs: Dict[str, dict] = {}
_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ═══════════════════════════════════════════════════════════════════════════════
# SERVER LIST PARSING — handles any delimiter customers might use
# ═══════════════════════════════════════════════════════════════════════════════

_HOSTNAME_RE = re.compile(r'^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)*$')
_IP_RE = re.compile(r'^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$')


def _clean_server_name(raw: str) -> str:
    """Clean a server name from common input mistakes."""
    s = raw.strip().strip('"').strip("'").strip()

    # Remove UNC path prefix (\\server\share → server)
    if s.startswith('\\\\'):
        s = s.lstrip('\\').split('\\')[0]

    # Remove port number (server:3389 → server)
    if ':' in s and not s.startswith('['):
        s = s.split(':')[0]

    # Remove protocol prefix
    for prefix in ('http://', 'https://', 'rdp://', 'ssh://'):
        if s.lower().startswith(prefix):
            s = s[len(prefix):].split('/')[0]

    # Remove trailing dot
    s = s.rstrip('.')
    return s


def _is_valid_server_name(name: str) -> bool:
    """Check if a string is a plausible hostname or IP address."""
    if not name or len(name) > 255:
        return False

    # Check IP address
    ip_match = _IP_RE.match(name)
    if ip_match:
        return all(0 <= int(g) <= 255 for g in ip_match.groups())

    # Check hostname (with optional FQDN)
    return bool(_HOSTNAME_RE.match(name))


def parse_server_list(raw_input: str) -> dict:
    """
    Smart-parse server names from any delimited input.
    Handles: comma, semicolon, newline, tab, pipe separators.
    Falls back to space-splitting if no other delimiters found.
    
    Returns: { servers: [...], invalid: [...], duplicates_removed: int, total_parsed: int }
    """
    if not raw_input or not raw_input.strip():
        return {"servers": [], "invalid": [], "duplicates_removed": 0, "total_parsed": 0}

    # First split on line-level delimiters (newline, semicolon, pipe)
    tokens = re.split(r'[\n\r;|]+', raw_input)

    # Then split each token on commas and tabs
    expanded = []
    for token in tokens:
        parts = re.split(r'[,\t]+', token)
        expanded.extend(parts)

    # If we still have single-token entries that look like space-separated lists, split on spaces
    final_tokens = []
    for token in expanded:
        stripped = token.strip()
        if not stripped:
            continue
        # If token contains spaces and no dots (not likely FQDN), split on spaces
        if ' ' in stripped:
            # Check if this could be a single FQDN with description (e.g., "server1 - Production")
            # Split on spaces and validate each part
            space_parts = stripped.split()
            valid_parts = [p for p in space_parts if _is_valid_server_name(_clean_server_name(p))]
            if len(valid_parts) > 1:
                final_tokens.extend(space_parts)
            elif valid_parts:
                final_tokens.append(valid_parts[0])
            else:
                final_tokens.append(stripped)
        else:
            final_tokens.append(stripped)

    # Clean, validate, and deduplicate
    servers = []
    invalid = []
    seen = set()
    dupes = 0

    for token in final_tokens:
        cleaned = _clean_server_name(token)
        if not cleaned or cleaned.startswith('#'):
            continue

        if _is_valid_server_name(cleaned):
            lower = cleaned.lower()
            if lower in seen:
                dupes += 1
            else:
                seen.add(lower)
                servers.append(cleaned)
        else:
            invalid.append(token.strip())

    return {
        "servers": servers,
        "invalid": invalid,
        "duplicates_removed": dupes,
        "total_parsed": len(servers) + len(invalid) + dupes,
    }


def parse_server_file(content: bytes, filename: str = "servers.txt") -> dict:
    """Parse a text file containing server names (one per line or delimited)."""
    # Try UTF-8 with BOM, then UTF-8, then latin-1
    text = None
    for encoding in ('utf-8-sig', 'utf-8', 'latin-1'):
        try:
            text = content.decode(encoding)
            break
        except (UnicodeDecodeError, ValueError):
            continue

    if text is None:
        return {"servers": [], "invalid": [], "duplicates_removed": 0, "total_parsed": 0,
                "error": "Could not decode file. Ensure it is a plain text file."}

    return parse_server_list(text)


# ═══════════════════════════════════════════════════════════════════════════════
# POWERSHELL EXECUTION HELPER
# ═══════════════════════════════════════════════════════════════════════════════

def _run_powershell(script: str, timeout: int = 120) -> dict:
    """
    Run a PowerShell script and return parsed results.
    Returns: { success: bool, stdout: str, stderr: str, returncode: int, parsed: any }
    """
    try:
        env = os.environ.copy()
        env['POWERSHELL_TELEMETRY_OPTOUT'] = '1'

        proc = subprocess.run(
            [_POWERSHELL] + _PS_ARGS + [script],
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
            encoding='utf-8',
            errors='replace',
        )

        stdout = proc.stdout.strip() if proc.stdout else ""
        stderr = proc.stderr.strip() if proc.stderr else ""

        # Try to parse JSON from stdout
        parsed = None
        if stdout:
            # Find JSON in output (skip any warning lines before it)
            json_start = -1
            for i, ch in enumerate(stdout):
                if ch in ('{', '['):
                    json_start = i
                    break
            if json_start >= 0:
                try:
                    parsed = json.loads(stdout[json_start:])
                except json.JSONDecodeError:
                    pass

        return {
            "success": proc.returncode == 0,
            "stdout": stdout,
            "stderr": stderr,
            "returncode": proc.returncode,
            "parsed": parsed,
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "stdout": "", "stderr": f"Timed out after {timeout}s", "returncode": -1, "parsed": None}
    except FileNotFoundError:
        return {"success": False, "stdout": "", "stderr": "PowerShell not found. This feature requires Windows PowerShell.", "returncode": -1, "parsed": None}
    except Exception as e:
        return {"success": False, "stdout": "", "stderr": str(e), "returncode": -1, "parsed": None}


def _sanitize_hostname(hostname: str) -> str:
    """Sanitize hostname for safe use in PowerShell commands. Prevents injection."""
    # Only allow valid hostname characters
    cleaned = re.sub(r'[^a-zA-Z0-9.\-_]', '', hostname)
    if not cleaned or len(cleaned) > 255:
        raise ValueError(f"Invalid hostname: {hostname}")
    return cleaned


# ═══════════════════════════════════════════════════════════════════════════════
# PREREQUISITES CHECK
# ═══════════════════════════════════════════════════════════════════════════════

def check_prerequisites() -> dict:
    """Check if this machine can perform remote discovery & collection."""
    script = r"""
$result = @{
    powershell_version = $PSVersionTable.PSVersion.ToString()
    is_domain_joined = $false
    domain_name = ''
    ad_module_available = $false
    hostname = $env:COMPUTERNAME
    username = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    is_admin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Check domain membership
try {
    $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
    $result.is_domain_joined = ($cs.PartOfDomain -eq $true)
    $result.domain_name = $cs.Domain
} catch {}

# Check AD module
try {
    $result.ad_module_available = [bool](Get-Module -ListAvailable -Name ActiveDirectory -ErrorAction SilentlyContinue)
} catch {}

$result | ConvertTo-Json -Compress
"""
    ps_result = _run_powershell(script, timeout=15)
    if ps_result["parsed"]:
        return {"success": True, **ps_result["parsed"]}
    return {
        "success": False,
        "error": ps_result["stderr"] or "Failed to check prerequisites",
        "powershell_version": "Unknown",
        "is_domain_joined": False,
        "ad_module_available": False,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# ACTIVE DIRECTORY DISCOVERY
# ═══════════════════════════════════════════════════════════════════════════════

def discover_ad_computers(ou_filter: str = "", name_filter: str = "", os_filter: str = "") -> dict:
    """
    Discover domain-joined computers via Active Directory.
    
    Args:
        ou_filter: Limit to a specific OU (DistinguishedName substring)
        name_filter: Wildcard filter for computer names (e.g., "SRV*")
        os_filter: Filter by OS name substring (e.g., "Server")
    
    Returns: { success, computers: [...], domain, total, error, hint }
    """
    # Build AD filter
    filter_parts = []
    if name_filter:
        safe_name = re.sub(r'[^a-zA-Z0-9*\-_]', '', name_filter)
        filter_parts.append(f"Name -like '{safe_name}'")
    if os_filter:
        safe_os = re.sub(r'[^a-zA-Z0-9* \-_.]', '', os_filter)
        filter_parts.append(f"OperatingSystem -like '*{safe_os}*'")

    ad_filter = " -and ".join(filter_parts) if filter_parts else "*"

    # Build SearchBase parameter
    search_base_param = ""
    if ou_filter:
        safe_ou = ou_filter.replace("'", "''")
        search_base_param = f"-SearchBase '{safe_ou}'"

    script = f"""
$ErrorActionPreference = 'Stop'
try {{
    Import-Module ActiveDirectory -ErrorAction Stop
    $computers = Get-ADComputer -Filter {{ {ad_filter} }} {search_base_param} -Properties Name, DNSHostName, OperatingSystem, OperatingSystemVersion, Enabled, LastLogonDate, IPv4Address, DistinguishedName, Description, WhenCreated -ErrorAction Stop

    $domain = (Get-ADDomain -ErrorAction Stop).DNSRoot
    
    $result = @{{
        success = $true
        domain = $domain
        total = @($computers).Count
        computers = @($computers | ForEach-Object {{
            @{{
                name = $_.Name
                dns_hostname = $_.DNSHostName
                os = $_.OperatingSystem
                os_version = $_.OperatingSystemVersion
                enabled = $_.Enabled
                last_logon = if ($_.LastLogonDate) {{ $_.LastLogonDate.ToString('yyyy-MM-ddTHH:mm:ss') }} else {{ '' }}
                ip_address = $_.IPv4Address
                ou = ($_.DistinguishedName -replace '^CN=[^,]+,', '')
                description = $_.Description
                created = if ($_.WhenCreated) {{ $_.WhenCreated.ToString('yyyy-MM-ddTHH:mm:ss') }} else {{ '' }}
            }}
        }})
    }}
}} catch {{
    $hint = ''
    if ($_.Exception.Message -match 'not recognized|could not be loaded|not installed') {{
        $hint = 'Active Directory PowerShell module (RSAT) is not installed. Install via: Add-WindowsCapability -Online -Name Rsat.ActiveDirectory.DS-LDS.Tools~~~~0.0.1.0'
    }} elseif ($_.Exception.Message -match 'Unable to contact|cannot contact') {{
        $hint = 'Cannot reach a domain controller. Ensure this machine is domain-joined and has network access to AD.'
    }} elseif ($_.Exception.Message -match 'Access is denied|insufficient') {{
        $hint = 'Access denied. Ensure you have read permissions on the AD objects.'
    }}
    $result = @{{
        success = $false
        error = $_.Exception.Message
        hint = $hint
        computers = @()
        total = 0
    }}
}}
$result | ConvertTo-Json -Depth 4 -Compress
"""
    ps_result = _run_powershell(script, timeout=60)

    if ps_result["parsed"]:
        return ps_result["parsed"]

    return {
        "success": False,
        "error": ps_result["stderr"] or "Failed to query Active Directory",
        "hint": "Ensure PowerShell and the ActiveDirectory module are available.",
        "computers": [],
        "total": 0,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# CONNECTIVITY TESTING
# ═══════════════════════════════════════════════════════════════════════════════

def test_connectivity(servers: List[str]) -> dict:
    """
    Test WinRM and WMI connectivity to a list of servers.
    Returns per-server status: { results: [{ server, ping, winrm, wmi, error, latency_ms }] }
    """
    if not servers:
        return {"results": [], "total": 0, "reachable": 0, "winrm_ready": 0}

    # Sanitize and limit
    safe_servers = []
    for s in servers[:200]:  # Cap at 200 to prevent abuse
        try:
            safe_servers.append(_sanitize_hostname(s))
        except ValueError:
            pass

    if not safe_servers:
        return {"results": [], "total": 0, "reachable": 0, "winrm_ready": 0}

    # Build PowerShell array
    server_array = ",".join(f"'{s}'" for s in safe_servers)

    script = f"""
$servers = @({server_array})
$results = @()
foreach ($server in $servers) {{
    $r = @{{ server = $server; ping = $false; winrm = $false; wmi = $false; error = ''; latency_ms = -1 }}
    
    # Ping test
    try {{
        $p = Test-Connection -ComputerName $server -Count 1 -ErrorAction Stop
        $r.ping = $true
        $r.latency_ms = [int]$p.ResponseTime
    }} catch {{
        $r.error = "Unreachable: $($_.Exception.Message)"
        $results += $r
        continue
    }}
    
    # WinRM test
    try {{
        Test-WSMan -ComputerName $server -ErrorAction Stop | Out-Null
        $r.winrm = $true
    }} catch {{
        $r.error = "WinRM: $($_.Exception.Message -replace '\\r?\\n',' ')"
    }}
    
    # WMI/CIM test
    try {{
        Get-CimInstance -ComputerName $server -ClassName Win32_OperatingSystem -ErrorAction Stop | Out-Null
        $r.wmi = $true
    }} catch {{
        if (-not $r.error) {{
            $r.error = "CIM: $($_.Exception.Message -replace '\\r?\\n',' ')"
        }}
    }}
    
    $results += $r
}}

$summary = @{{
    results = $results
    total = $results.Count
    reachable = @($results | Where-Object {{ $_.ping }}).Count
    winrm_ready = @($results | Where-Object {{ $_.winrm }}).Count
    wmi_ready = @($results | Where-Object {{ $_.wmi }}).Count
}}
$summary | ConvertTo-Json -Depth 3 -Compress
"""
    # Timeout: ~5 seconds per server for connectivity test
    timeout = max(30, len(safe_servers) * 6)
    ps_result = _run_powershell(script, timeout=min(timeout, _MAX_SCRIPT_TIMEOUT))

    if ps_result["parsed"]:
        return ps_result["parsed"]

    return {
        "results": [],
        "total": len(safe_servers),
        "reachable": 0,
        "winrm_ready": 0,
        "error": ps_result["stderr"] or "Connectivity test failed",
    }


# ═══════════════════════════════════════════════════════════════════════════════
# REMOTE COLLECTION — Background Job Management
# ═══════════════════════════════════════════════════════════════════════════════

def start_collection(servers: List[str], modules: dict, options: dict = None) -> dict:
    """
    Start a background collection job.
    
    Args:
        servers: List of hostnames/IPs to collect from
        modules: Dict of module toggles (hardware, os, apps, services, sql, iis, security, certs)
        options: { max_concurrent, timeout_per_server }
    
    Returns: { job_id, total_servers, status }
    """
    options = options or {}
    max_concurrent = min(options.get("max_concurrent", 5), 20)
    timeout = min(options.get("timeout_per_server", _DEFAULT_TIMEOUT), _MAX_SCRIPT_TIMEOUT)

    # Validate and sanitize servers
    valid_servers = []
    for s in servers:
        try:
            valid_servers.append(_sanitize_hostname(s))
        except ValueError:
            continue

    if not valid_servers:
        return {"job_id": None, "error": "No valid server names provided", "total_servers": 0}

    job_id = f"collect_{uuid.uuid4().hex[:12]}"

    with _lock:
        _jobs[job_id] = {
            "status": "running",
            "total": len(valid_servers),
            "completed": 0,
            "succeeded": 0,
            "failed": 0,
            "current_server": "",
            "servers_status": {s: {"status": "pending", "error": ""} for s in valid_servers},
            "started_at": _now(),
            "finished_at": None,
            "batch_id": None,
        }

    # Start background thread
    thread = threading.Thread(
        target=_run_collection_job,
        args=(job_id, valid_servers, modules, max_concurrent, timeout),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id, "total_servers": len(valid_servers), "status": "running"}


def get_collection_status(job_id: str) -> dict:
    """Get the current status of a collection job."""
    with _lock:
        job = _jobs.get(job_id)
    if not job:
        return {"error": "Job not found", "status": "unknown"}
    return dict(job)


def cancel_collection(job_id: str) -> dict:
    """Cancel a running collection job."""
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return {"error": "Job not found"}
        if job["status"] != "running":
            return {"error": "Job is not running"}
        job["status"] = "cancelled"
    return {"success": True, "message": "Collection cancelled"}


def get_all_jobs() -> List[dict]:
    """Get all collection jobs (for history)."""
    with _lock:
        return [{"job_id": k, "status": v["status"], "total": v["total"],
                 "completed": v["completed"], "succeeded": v["succeeded"],
                 "failed": v["failed"], "started_at": v["started_at"],
                 "finished_at": v.get("finished_at"), "batch_id": v.get("batch_id")}
                for k, v in _jobs.items()]


# ═══════════════════════════════════════════════════════════════════════════════
# COLLECTION JOB EXECUTION (runs in background thread)
# ═══════════════════════════════════════════════════════════════════════════════

def _run_collection_job(job_id: str, servers: List[str], modules: dict, max_concurrent: int, timeout: int):
    """Run collection across all servers with concurrent execution."""
    collected_servers = []

    try:
        with ThreadPoolExecutor(max_workers=max_concurrent) as pool:
            futures = {}
            for server in servers:
                # Check if cancelled
                with _lock:
                    if _jobs[job_id]["status"] == "cancelled":
                        break
                    _jobs[job_id]["servers_status"][server]["status"] = "queued"

                future = pool.submit(_collect_single_server, server, modules, timeout)
                futures[future] = server

            for future in as_completed(futures):
                server = futures[future]

                # Check if cancelled
                with _lock:
                    if _jobs[job_id]["status"] == "cancelled":
                        # Cancel remaining futures
                        for f in futures:
                            f.cancel()
                        break

                try:
                    result = future.result()
                    with _lock:
                        _jobs[job_id]["completed"] += 1
                        if result.get("success"):
                            _jobs[job_id]["succeeded"] += 1
                            _jobs[job_id]["servers_status"][server] = {"status": "success", "error": ""}
                            collected_servers.append(result)
                        else:
                            _jobs[job_id]["failed"] += 1
                            _jobs[job_id]["servers_status"][server] = {
                                "status": "failed",
                                "error": result.get("error", "Unknown error")
                            }
                except Exception as e:
                    with _lock:
                        _jobs[job_id]["completed"] += 1
                        _jobs[job_id]["failed"] += 1
                        _jobs[job_id]["servers_status"][server] = {
                            "status": "failed", "error": str(e)
                        }

        # Store results in DB (same format as ZIP upload)
        batch_id = None
        if collected_servers:
            batch_id = _store_collection_results(job_id, collected_servers)

        with _lock:
            if _jobs[job_id]["status"] != "cancelled":
                _jobs[job_id]["status"] = "completed"
            _jobs[job_id]["finished_at"] = _now()
            _jobs[job_id]["batch_id"] = batch_id

    except Exception as e:
        logger.error("Collection job %s failed: %s", job_id, e)
        with _lock:
            _jobs[job_id]["status"] = "error"
            _jobs[job_id]["finished_at"] = _now()


def _store_collection_results(job_id: str, collected_servers: List[dict]) -> str:
    """Store collected server data in SQLite (same schema as ZIP upload)."""
    from services.onprem_service import _classify_server, _conn, _now as svc_now
    from services.database import upsert_sql, is_azure_sql

    batch_id = f"remote_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"

    db = _conn()
    try:
        # Ensure tables exist (skip for Azure SQL — schema managed by migrations)
        if not is_azure_sql():
            db.execute("""
                CREATE TABLE IF NOT EXISTS onprem_uploads (
                    batch_id TEXT PRIMARY KEY, uploaded_at TEXT NOT NULL,
                    server_count INTEGER DEFAULT 0, filename TEXT DEFAULT '',
                    status TEXT DEFAULT 'completed', warnings TEXT DEFAULT '[]', errors TEXT DEFAULT '[]'
                )
            """)
            db.execute("""
                CREATE TABLE IF NOT EXISTS onprem_servers (
                    server_id TEXT PRIMARY KEY, hostname TEXT NOT NULL,
                    batch_id TEXT NOT NULL, collected_at TEXT NOT NULL,
                    workload_type TEXT DEFAULT '', payload TEXT NOT NULL,
                    FOREIGN KEY (batch_id) REFERENCES onprem_uploads(batch_id) ON DELETE CASCADE
                )
            """)

        # Classify each server and apply hostname-based dedup
        for srv in collected_servers:
            srv["upload_batch_id"] = batch_id
            hostname = srv.get("hostname", "").strip().lower()

            # Hostname dedup: look up existing server by hostname
            existing = None
            if hostname:
                row = db.execute(
                    "SELECT server_id, payload FROM onprem_servers WHERE LOWER(hostname) = ?",
                    (hostname,)
                ).fetchone()
                if row:
                    existing = row

            if existing:
                # Reuse existing server_id, merge payloads (old fields preserved, new fields overwrite)
                srv["server_id"] = existing[0]
                try:
                    old_payload = json.loads(existing[1]) if existing[1] else {}
                except Exception:
                    old_payload = {}
                scan_count = old_payload.get("scan_count", 1) + 1
                first_scanned = old_payload.get("first_scanned_at", old_payload.get("collected_at", srv.get("collected_at", _now())))

                # Merge: start with old payload, overlay new data (skip empty/None values from partial scans)
                merged = dict(old_payload)
                skip_keys = {"server_id", "scan_count", "first_scanned_at", "last_scanned_at", "upload_batch_id"}
                for k, v in srv.items():
                    if k in skip_keys:
                        continue
                    # Only overwrite if the new value is non-empty (partial scan protection)
                    if v is not None and v != "" and v != [] and v != {}:
                        merged[k] = v
                    elif k not in merged:
                        merged[k] = v
                srv.clear()
                srv.update(merged)

                srv["scan_count"] = scan_count
                srv["first_scanned_at"] = first_scanned
                srv["last_scanned_at"] = srv.get("collected_at", _now())
                srv["upload_batch_id"] = batch_id
                logger.info("Hostname dedup: reusing server_id %s for %s (scan #%d)", srv["server_id"], hostname, scan_count)
            else:
                if "server_id" not in srv:
                    srv["server_id"] = str(uuid.uuid4())
                srv["scan_count"] = 1
                srv["first_scanned_at"] = srv.get("collected_at", _now())
                srv["last_scanned_at"] = srv.get("collected_at", _now())

            _classify_server(srv)

        # Insert batch
        db.execute(
            upsert_sql("onprem_uploads", ["batch_id"], ["uploaded_at", "server_count", "filename", "status", "warnings", "errors"]),
            (batch_id, _now(), len(collected_servers), f"remote_collection_{job_id}",
             "completed", "[]", "[]"),
        )

        # Insert/update servers
        for srv in collected_servers:
            db.execute(
                upsert_sql("onprem_servers", ["server_id"], ["hostname", "batch_id", "collected_at", "workload_type", "payload"]),
                (srv["server_id"], srv["hostname"], batch_id,
                 srv.get("collected_at", _now()), srv.get("workload_type", ""),
                 json.dumps(srv, default=str)),
            )

            # Record scan history
            try:
                # Recreate table if schema mismatch (id was INTEGER in old schema)
                if not is_azure_sql():
                    existing_schema = db.execute(
                        "SELECT sql FROM sqlite_master WHERE type='table' AND name='onprem_scan_history'"
                    ).fetchone()
                    if existing_schema and 'id INTEGER' in (existing_schema[0] or ''):
                        db.execute("DROP TABLE onprem_scan_history")
                    db.execute("""
                        CREATE TABLE IF NOT EXISTS onprem_scan_history (
                            id TEXT PRIMARY KEY, server_id TEXT NOT NULL, batch_id TEXT,
                            collected_at TEXT, modules_collected INTEGER DEFAULT 0,
                            modules_failed INTEGER DEFAULT 0, duration_sec REAL DEFAULT 0,
                            payload_summary TEXT DEFAULT '{}'
                        )
                    """)
                mods_failed = srv.get("modules_failed", 0)
                if isinstance(mods_failed, list):
                    mods_failed = len(mods_failed)
                duration = srv.get("scan_duration_sec") or srv.get("duration_sec") or 0.0
                if not isinstance(duration, (int, float)):
                    duration = 0.0
                mods_collected = srv.get("modules_collected", 0)
                if not isinstance(mods_collected, int):
                    mods_collected = 0
                db.execute("""
                    INSERT INTO onprem_scan_history (id, server_id, batch_id, collected_at, modules_collected, modules_failed, duration_sec, payload_summary)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    str(uuid.uuid4()), srv["server_id"], batch_id,
                    srv.get("collected_at", _now()),
                    mods_collected,
                    mods_failed,
                    duration,
                    json.dumps({"scan_count": srv.get("scan_count", 1), "source": "remote_collection"}, default=str)
                ))
            except Exception as e:
                logger.warning("Could not record scan history: %s", e)

        db.commit()
        logger.info("Remote collection stored: batch=%s, servers=%d", batch_id, len(collected_servers))
        return batch_id

    except Exception as e:
        logger.error("Failed to store remote collection: %s", e)
        return None
    finally:
        db.close()


# ═══════════════════════════════════════════════════════════════════════════════
# SINGLE SERVER COLLECTION — runs PowerShell to collect via WMI/CIM
# ═══════════════════════════════════════════════════════════════════════════════

def _collect_single_server(hostname: str, modules: dict, timeout: int = 180) -> dict:
    """
    Collect data from a single remote server.
    Primary: Python WMI Scanner (pywinrm) — works cross-platform.
    Fallback: PowerShell subprocess (CIM/WMI) — requires local PowerShell.
    """
    with _lock:
        for job in _jobs.values():
            if hostname in job.get("servers_status", {}):
                job["servers_status"][hostname]["status"] = "collecting"
                job["current_server"] = hostname
                break

    # ── Try Python-native scanner first ─────────────────────────────────
    try:
        from services.onprem_scanner_service import WMIScanner
        # Convert module dict (old format) to module list (new format)
        mod_list = [k for k, v in modules.items() if v] if isinstance(modules, dict) else list(modules)
        # Map old names to new names
        name_map = {"disks": "storage", "hardware": "hardware", "os": "os",
                     "network": "network", "services": "services", "applications": "applications",
                     "sql": "sql_server", "iis": "iis", "security": "security",
                     "certificates": "certificates", "roles": "roles_features"}
        mapped = [name_map.get(m, m) for m in mod_list]

        scanner = WMIScanner()  # Uses current user credentials by default
        result = scanner.scan_server(hostname, modules=mapped, timeout=timeout)
        if result.get("success"):
            logger.info("Python scanner succeeded for %s (%d modules)", hostname, result.get("modules_collected", 0))
            return result
        logger.debug("Python scanner failed for %s: %s — falling back to PS", hostname, result.get("error"))
    except ImportError:
        logger.debug("pywinrm not installed — using PowerShell fallback for %s", hostname)
    except Exception as e:
        logger.debug("Python scanner error for %s: %s — falling back to PS", hostname, e)

    # ── Fallback: original PowerShell subprocess ────────────────────────
    script = _build_collection_script(hostname, modules)
    ps_result = _run_powershell(script, timeout=timeout)

    if ps_result["parsed"]:
        result = ps_result["parsed"]
        # Ensure required fields
        result.setdefault("hostname", hostname)
        result.setdefault("server_id", str(uuid.uuid4()))
        result.setdefault("collected_at", _now())

        # Python-side validation: don't trust success flag if no real data
        if result.get("success") and not result.get("os_name"):
            result["success"] = False
            result["error"] = result.get("error") or "No OS data collected — server may be unreachable or access denied"

        return result

    # PowerShell returned non-zero or no JSON — definite failure
    error_msg = ps_result["stderr"][:500] if ps_result["stderr"] else "No data returned from PowerShell"
    return {
        "hostname": hostname,
        "success": False,
        "error": error_msg,
        "collected_at": _now(),
    }


def _build_collection_script(hostname: str, modules: dict) -> str:
    """Build a comprehensive PowerShell script for remote data collection."""
    safe_host = _sanitize_hostname(hostname)

    # Determine which modules to collect
    collect_hardware = modules.get("hardware", True)
    collect_os = modules.get("os", True)
    collect_disks = modules.get("disks", True) or modules.get("hardware", True)
    collect_network = modules.get("network", True) or modules.get("hardware", True)
    collect_services = modules.get("services", True)
    collect_apps = modules.get("applications", True)
    collect_sql = modules.get("sql", True)
    collect_iis = modules.get("iis", True)
    collect_security = modules.get("security", True)
    collect_certs = modules.get("certificates", True)
    collect_roles = modules.get("roles", True) or modules.get("security", True)

    parts = []

    # Script header with connectivity validation + CIM helper function
    parts.append(f"""
$ErrorActionPreference = 'Stop'
$server = '{safe_host}'
$result = @{{
    hostname = $server
    server_id = [guid]::NewGuid().ToString()
    success = $false
    error = ''
    collected_at = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')
    fqdn = ''
    domain = ''
}}

# ── STEP 1: Validate connectivity BEFORE attempting collection ──────────
try {{
    $ping = Test-Connection -ComputerName $server -Count 2 -Quiet -ErrorAction Stop
    if (-not $ping) {{
        $result.error = "Server unreachable: ping failed for '$server'"
        $result | ConvertTo-Json -Depth 5 -Compress
        exit 1
    }}
}} catch {{
    $result.error = "Server unreachable: $($_.Exception.Message)"
    $result | ConvertTo-Json -Depth 5 -Compress
    exit 1
}}

# ── STEP 2: Validate CIM/WMI access ────────────────────────────────────
$cimSession = $null
try {{
    # Try WSMAN first (preferred)
    $cimSession = New-CimSession -ComputerName $server -ErrorAction Stop
}} catch {{
    try {{
        # Fallback to DCOM
        $opt = New-CimSessionOption -Protocol Dcom
        $cimSession = New-CimSession -ComputerName $server -SessionOption $opt -ErrorAction Stop
    }} catch {{
        $result.error = "Cannot establish CIM/WMI session to '$server': $($_.Exception.Message)"
        $result | ConvertTo-Json -Depth 5 -Compress
        exit 1
    }}
}}

# Quick verification — can we actually read basic data?
try {{
    $osCheck = Get-CimInstance -CimSession $cimSession -ClassName Win32_OperatingSystem -ErrorAction Stop
    if (-not $osCheck) {{
        $result.error = "Connected to '$server' but cannot read OS data (permission denied or WMI broken)"
        $result | ConvertTo-Json -Depth 5 -Compress
        exit 1
    }}
}} catch {{
    $result.error = "CIM session to '$server' failed verification: $($_.Exception.Message)"
    Remove-CimSession $cimSession -ErrorAction SilentlyContinue
    $result | ConvertTo-Json -Depth 5 -Compress
    exit 1
}}

# ── Connectivity validated — proceed with full collection ───────────────
$ErrorActionPreference = 'Continue'

# Helper: CIM query using established session
function Get-CimSafe {{
    param([string]$Class, [string]$Filter)
    try {{
        $params = @{{ CimSession = $cimSession; ClassName = $Class; ErrorAction = 'Stop' }}
        if ($Filter) {{ $params.Filter = $Filter }}
        Get-CimInstance @params
    }} catch {{
        $null
    }}
}}

# Helper: Safe Invoke-Command
function Invoke-Safe {{
    param([scriptblock]$ScriptBlock)
    try {{
        Invoke-Command -ComputerName $server -ScriptBlock $ScriptBlock -ErrorAction Stop
    }} catch {{
        $null
    }}
}}

try {{
""")

    # Hardware module
    if collect_hardware:
        parts.append("""
    # ── Hardware ──────────────────────────────────────────────────────────
    $cs = Get-CimSafe 'Win32_ComputerSystem'
    $bios = Get-CimSafe 'Win32_BIOS'
    $cpus = @(Get-CimSafe 'Win32_Processor')
    $cpu = $cpus | Select-Object -First 1
    
    if ($cs) {
        $result.manufacturer = $cs.Manufacturer
        $result.model = $cs.Model
        $result.domain = $cs.Domain
        $result.fqdn = "$($cs.Name).$($cs.Domain)"
        $result.total_logical_processors = $cs.NumberOfLogicalProcessors
        $result.total_memory_gb = [math]::Round($cs.TotalPhysicalMemory / 1GB, 2)
        $result.is_virtual = $cs.Model -match 'Virtual|VMware|KVM|Xen|HyperV|QEMU'
        $result.hypervisor_type = if ($cs.Model -match 'VMware') { 'VMware' } elseif ($cs.Model -match 'Virtual') { 'Hyper-V' } elseif ($cs.Model -match 'KVM|QEMU') { 'KVM' } elseif ($cs.Model -match 'Xen') { 'Xen' } else { '' }
    }
    if ($bios) {
        $result.serial_number = $bios.SerialNumber
        $result.bios_version = $bios.SMBIOSBIOSVersion
    }
    if ($cpu) {
        $result.cpu_model = $cpu.Name
        $result.cpu_speed_ghz = [math]::Round($cpu.MaxClockSpeed / 1000, 2)
        $result.total_cores = ($cpus | Measure-Object -Property NumberOfCores -Sum).Sum
    }
""")

    # OS module
    if collect_os:
        parts.append("""
    # ── Operating System ──────────────────────────────────────────────────
    $os = Get-CimSafe 'Win32_OperatingSystem'
    if ($os) {
        $result.os_name = $os.Caption
        $result.os_version = $os.Version
        $result.os_build = $os.BuildNumber
        $result.os_architecture = $os.OSArchitecture
        $result.install_date = if ($os.InstallDate) { $os.InstallDate.ToString('yyyy-MM-ddTHH:mm:ss') } else { '' }
        $result.last_boot_time = if ($os.LastBootUpTime) { $os.LastBootUpTime.ToString('yyyy-MM-ddTHH:mm:ss') } else { '' }
        $result.uptime_days = if ($os.LastBootUpTime) { [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalDays) } else { 0 }
    }
""")

    # Disks module
    if collect_disks:
        parts.append("""
    # ── Disks ─────────────────────────────────────────────────────────────
    $disks = @(Get-CimSafe 'Win32_LogicalDisk' 'DriveType=3')
    $result.disks = @($disks | ForEach-Object {
        @{
            drive_letter = $_.DeviceID
            label = $_.VolumeName
            size_gb = [math]::Round($_.Size / 1GB, 2)
            free_gb = [math]::Round($_.FreeSpace / 1GB, 2)
            used_pct = if ($_.Size -gt 0) { [math]::Round(($_.Size - $_.FreeSpace) / $_.Size * 100, 1) } else { 0 }
            filesystem = $_.FileSystem
        }
    })
    $result.total_storage_gb = [math]::Round(($disks | Measure-Object -Property Size -Sum).Sum / 1GB, 2)
    $result.total_free_gb = [math]::Round(($disks | Measure-Object -Property FreeSpace -Sum).Sum / 1GB, 2)
""")

    # Network module
    if collect_network:
        parts.append("""
    # ── Network ───────────────────────────────────────────────────────────
    $adapters = @(Get-CimSafe 'Win32_NetworkAdapterConfiguration' 'IPEnabled=TRUE')
    $result.network_adapters = @($adapters | ForEach-Object {
        @{
            name = $_.Description
            ip_address = ($_.IPAddress | Select-Object -First 1)
            subnet_mask = ($_.IPSubnet | Select-Object -First 1)
            default_gateway = ($_.DefaultIPGateway | Select-Object -First 1)
            dns_servers = ($_.DNSServerSearchOrder -join ',')
            mac_address = $_.MACAddress
        }
    })
    $result.ip_addresses = @($adapters | ForEach-Object { $_.IPAddress } | Where-Object { $_ -and $_ -ne '::1' -and $_ -notmatch ':' })
""")

    # Services module
    if collect_services:
        parts.append("""
    # ── Services ──────────────────────────────────────────────────────────
    $services = @(Get-CimSafe 'Win32_Service')
    $result.running_services = @($services | Where-Object { $_.State -eq 'Running' } | ForEach-Object {
        @{ name = $_.Name; display_name = $_.DisplayName; status = 'Running'; start_type = $_.StartMode; account = $_.StartName }
    })
    $result.stopped_services = @($services | Where-Object { $_.State -ne 'Running' -and $_.StartMode -eq 'Auto' } | ForEach-Object {
        @{ name = $_.Name; display_name = $_.DisplayName; status = $_.State; start_type = $_.StartMode; account = $_.StartName }
    })
""")

    # Applications module (via registry — much faster than Win32_Product)
    if collect_apps:
        parts.append("""
    # ── Applications (Registry-based, fast) ───────────────────────────────
    $apps = Invoke-Safe {
        $paths = @(
            'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
            'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
        )
        Get-ItemProperty $paths -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -and $_.DisplayName.Trim() } |
            Select-Object DisplayName, DisplayVersion, Publisher, InstallDate |
            Sort-Object DisplayName -Unique
    }
    if ($apps) {
        $result.installed_applications = @($apps | ForEach-Object {
            @{ name = $_.DisplayName; version = $_.DisplayVersion; publisher = $_.Publisher; install_date = $_.InstallDate }
        })
    } else {
        $result.installed_applications = @()
    }
""")

    # SQL module
    if collect_sql:
        parts.append("""
    # ── SQL Server Detection ──────────────────────────────────────────────
    $sqlServices = @($services | Where-Object { $_.Name -match 'MSSQL\\$|^MSSQLSERVER$' -and $_.State -eq 'Running' })
    if ($sqlServices.Count -gt 0) {
        $sqlInstances = Invoke-Safe {
            $instances = @()
            $regPath = 'HKLM:\\SOFTWARE\\Microsoft\\Microsoft SQL Server\\Instance Names\\SQL'
            if (Test-Path $regPath) {
                $props = Get-ItemProperty $regPath -ErrorAction SilentlyContinue
                $props.PSObject.Properties | Where-Object { $_.Name -notin @('PSPath','PSParentPath','PSChildName','PSDrive','PSProvider') } | ForEach-Object {
                    $instName = $_.Name
                    $instPath = $_.Value
                    $verPath = "HKLM:\\SOFTWARE\\Microsoft\\Microsoft SQL Server\\$instPath\\MSSQLServer\\CurrentVersion"
                    $setupPath = "HKLM:\\SOFTWARE\\Microsoft\\Microsoft SQL Server\\$instPath\\Setup"
                    $ver = (Get-ItemProperty $verPath -ErrorAction SilentlyContinue).CurrentVersion
                    $edition = (Get-ItemProperty $setupPath -ErrorAction SilentlyContinue).Edition
                    $instances += @{ instance_name = $instName; version = $ver; edition = $edition; databases = @() }
                }
            }
            $instances
        }
        $result.sql_instances = if ($sqlInstances) { @($sqlInstances) } else { @(@{ instance_name = 'Detected'; version = 'Unknown'; edition = ''; databases = @() }) }
    } else {
        $result.sql_instances = @()
    }
""")

    # IIS module
    if collect_iis:
        parts.append("""
    # ── IIS Detection ─────────────────────────────────────────────────────
    $iisService = $services | Where-Object { $_.Name -eq 'W3SVC' -and $_.State -eq 'Running' }
    if ($iisService) {
        $sites = Invoke-Safe {
            Import-Module WebAdministration -ErrorAction Stop
            Get-Website | Select-Object Name, State, PhysicalPath, @{N='Bindings';E={($_.Bindings.Collection | ForEach-Object { $_.BindingInformation }) -join '; '}}
        }
        if ($sites) {
            $result.iis_sites = @($sites | ForEach-Object {
                @{ name = $_.Name; state = $_.State; physical_path = $_.PhysicalPath; bindings = $_.Bindings; app_pool = '' }
            })
        } else {
            $result.iis_sites = @(@{ name = 'IIS Detected (details unavailable)'; state = 'Running'; physical_path = ''; bindings = ''; app_pool = '' })
        }
    } else {
        $result.iis_sites = @()
    }
""")

    # Security module
    if collect_security:
        parts.append("""
    # ── Security ──────────────────────────────────────────────────────────
    $fwResult = Invoke-Safe {
        $profiles = Get-NetFirewallProfile -ErrorAction SilentlyContinue
        @{
            enabled = ($profiles | Where-Object { $_.Enabled }).Count -gt 0
            profiles = @($profiles | ForEach-Object { @{ name = $_.Name; enabled = [bool]$_.Enabled } })
        }
    }
    if ($fwResult) {
        $result.firewall_enabled = $fwResult.enabled
        $result.firewall_profiles = $fwResult.profiles
    } else {
        $result.firewall_enabled = $null
        $result.firewall_profiles = @()
    }
    
    # Antivirus (Windows Security Center — works on clients, not always on servers)
    $av = Invoke-Safe {
        try {
            $avProduct = Get-CimInstance -Namespace 'root/SecurityCenter2' -ClassName AntiVirusProduct -ErrorAction Stop | Select-Object -First 1
            @{ product = $avProduct.displayName; status = 'Active' }
        } catch {
            # Try Windows Defender directly
            try {
                $defender = Get-MpComputerStatus -ErrorAction Stop
                @{ product = 'Windows Defender'; status = if ($defender.RealTimeProtectionEnabled) { 'Active' } else { 'Disabled' } }
            } catch { @{ product = ''; status = 'Unknown' } }
        }
    }
    if ($av) {
        $result.antivirus_product = $av.product
        $result.antivirus_status = $av.status
    }
    
    # Pending updates count
    $updates = Invoke-Safe {
        try {
            $searcher = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher()
            $pending = $searcher.Search('IsInstalled=0').Updates
            @{ count = $pending.Count; last_check = '' }
        } catch { @{ count = -1; last_check = '' } }
    }
    if ($updates) {
        $result.pending_updates_count = $updates.count
    }
""")

    # Server Roles module
    if collect_roles:
        parts.append("""
    # ── Server Roles & Features ───────────────────────────────────────────
    $roles = Invoke-Safe {
        try {
            $features = Get-WindowsFeature -ErrorAction Stop | Where-Object { $_.Installed }
            @{
                roles = @($features | Where-Object { $_.FeatureType -eq 'Role' } | Select-Object -ExpandProperty Name)
                features = @($features | Where-Object { $_.FeatureType -ne 'Role' } | Select-Object -ExpandProperty Name)
            }
        } catch {
            @{ roles = @(); features = @() }
        }
    }
    if ($roles) {
        $result.server_roles = $roles.roles
        $result.windows_features = $roles.features
    } else {
        $result.server_roles = @()
        $result.windows_features = @()
    }
    
    # Check clustering
    $result.is_clustered = $false
    $result.cluster_name = ''
    if ($roles -and $roles.features -contains 'Failover-Clustering') {
        $cluster = Invoke-Safe { try { (Get-Cluster -ErrorAction Stop).Name } catch { '' } }
        if ($cluster) {
            $result.is_clustered = $true
            $result.cluster_name = $cluster
        }
    }
""")

    # Certificates module
    if collect_certs:
        parts.append("""
    # ── Certificates ──────────────────────────────────────────────────────
    $certs = Invoke-Safe {
        Get-ChildItem Cert:\\LocalMachine\\My -ErrorAction SilentlyContinue | ForEach-Object {
            @{
                subject = $_.Subject
                issuer = $_.Issuer
                thumbprint = $_.Thumbprint
                expiry_date = $_.NotAfter.ToString('yyyy-MM-dd')
                store = 'LocalMachine\\My'
            }
        }
    }
    $result.certificates = if ($certs) { @($certs) } else { @() }
""")

    # Footer — mark success only after data collection, cleanup CIM session
    parts.append("""
    # ── If we got here, collection succeeded ──────────────────────────────
    $result.success = $true
} catch {
    $result.success = $false
    $result.error = $_.Exception.Message
}

# Cleanup CIM session
if ($cimSession) {
    Remove-CimSession $cimSession -ErrorAction SilentlyContinue
}

# Ensure arrays are initialized for classification
if (-not $result.ContainsKey('disks')) { $result.disks = @() }
if (-not $result.ContainsKey('network_adapters')) { $result.network_adapters = @() }
if (-not $result.ContainsKey('running_services')) { $result.running_services = @() }
if (-not $result.ContainsKey('stopped_services')) { $result.stopped_services = @() }
if (-not $result.ContainsKey('installed_applications')) { $result.installed_applications = @() }
if (-not $result.ContainsKey('sql_instances')) { $result.sql_instances = @() }
if (-not $result.ContainsKey('iis_sites')) { $result.iis_sites = @() }
if (-not $result.ContainsKey('server_roles')) { $result.server_roles = @() }
if (-not $result.ContainsKey('windows_features')) { $result.windows_features = @() }
if (-not $result.ContainsKey('certificates')) { $result.certificates = @() }
if (-not $result.ContainsKey('ip_addresses')) { $result.ip_addresses = @() }

# Final validation — don't report success if no OS data was collected
if ($result.success -and -not $result.os_name) {
    $result.success = $false
    $result.error = "Collection completed but no OS data was retrieved — likely a permissions issue"
}

$result | ConvertTo-Json -Depth 5 -Compress
""")

    return "\n".join(parts)
