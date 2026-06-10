"""
Native Python WMI Server Scanner
=================================
Built-in agentless scanner that collects comprehensive system data from
Windows servers using pywinrm (WS-Management) as primary transport and
PowerShell subprocess as fallback (DCOM). Collects 22 categories of data:
hardware, OS, storage, network, apps, services, processes, roles/features,
scheduled tasks, event logs, performance, SQL Server, IIS, AD roles,
file shares, security, certificates, virtualization, clustering, backup,
hotfixes, and local users/groups.

All results are compatible with the existing OnPremServer schema and flow
into the same SQLite tables / onprem_bridge used by BCDR, Security, and
Migration modules.
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
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# CONSTANTS
# ═══════════════════════════════════════════════════════════════════════════════

DEFAULT_CONCURRENCY = 10
MAX_CONCURRENCY = 50
DEFAULT_TIMEOUT = 300       # per-server timeout in seconds
MAX_TIMEOUT = 900
WINRM_PORT_HTTP = 5985
WINRM_PORT_HTTPS = 5986

# All available scan modules
ALL_MODULES = [
    "hardware", "os", "storage", "network", "applications", "services",
    "processes", "roles_features", "scheduled_tasks", "event_logs",
    "performance", "sql_server", "iis", "ad_roles", "file_shares",
    "security", "certificates", "virtualization", "clustering",
    "backup", "hotfixes", "local_users",
    # New comprehensive modules
    "frameworks", "network_connections", "registry_config",
    "web_apps", "database_deep", "middleware",
]

# Quick-scan modules (subset for fast reconnaissance)
QUICK_MODULES = ["hardware", "os", "storage", "network", "services", "security",
                 "applications", "frameworks"]

# Migration-focused preset: everything needed for migration assessment
MIGRATION_MODULES = [
    "hardware", "os", "storage", "network", "applications", "services",
    "roles_features", "frameworks", "network_connections", "registry_config",
    "security", "certificates", "sql_server", "iis", "web_apps",
    "database_deep", "middleware", "file_shares", "virtualization",
    "clustering", "backup",
]

# Job tracking
_scan_jobs: Dict[str, dict] = {}
_scan_lock = threading.Lock()

_PS = "powershell.exe"
_PS_ARGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
            "-OutputFormat", "Text", "-Command"]


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_hostname(hostname: str) -> str:
    """Sanitize hostname to prevent injection."""
    cleaned = re.sub(r'[^a-zA-Z0-9.\-_]', '', hostname.strip())
    if not cleaned or len(cleaned) > 255:
        raise ValueError(f"Invalid hostname: {hostname!r}")
    return cleaned


def _is_localhost(hostname: str) -> bool:
    """Check if hostname refers to the local machine."""
    h = hostname.strip().lower()
    if h in ("localhost", "127.0.0.1", "::1", "."):
        return True
    try:
        return h == os.environ.get("COMPUTERNAME", "").lower()
    except Exception:
        return False


def _localize_script(script: str) -> str:
    """Strip -ComputerName and Invoke-Command wrappers for local execution."""
    # Remove -ComputerName '<host>' from CIM/other cmdlets
    script = re.sub(r"\s*-ComputerName\s+'[^']+'\s*", " ", script)
    # Replace  Invoke-Command -ComputerName '...' -ScriptBlock { ... } -EA SilentlyContinue
    # with just the inner block content. Handle optional -EA after closing brace.
    script = re.sub(
        r"Invoke-Command\s+-ComputerName\s+'[^']+'\s+-ScriptBlock\s*\{",
        "& {", script
    )
    # Remove orphaned -EA SilentlyContinue that trailed Invoke-Command closing braces
    # Pattern: '} -EA SilentlyContinue' at end of a line (was outside Invoke-Command)
    script = re.sub(r"\}\s*-EA\s+SilentlyContinue", "}", script)
    return script


# ═══════════════════════════════════════════════════════════════════════════════
# TRANSPORT LAYER — pywinrm primary, PowerShell subprocess fallback
# ═══════════════════════════════════════════════════════════════════════════════

class _WinRMTransport:
    """Execute PowerShell scripts on a remote host via WinRM (pywinrm)."""

    def __init__(self, hostname: str, username: str = None, password: str = None,
                 use_ssl: bool = False, auth: str = "ntlm"):
        self.hostname = hostname
        self.username = username
        self.password = password
        self.use_ssl = use_ssl
        self.auth = auth  # ntlm | kerberos | basic
        self._session = None

    def connect(self) -> bool:
        try:
            import winrm
            port = WINRM_PORT_HTTPS if self.use_ssl else WINRM_PORT_HTTP
            scheme = "https" if self.use_ssl else "http"
            endpoint = f"{scheme}://{self.hostname}:{port}/wsman"

            kwargs: Dict[str, Any] = {"transport": self.auth}
            if self.use_ssl:
                kwargs["server_cert_validation"] = "ignore"

            if self.username and self.password:
                self._session = winrm.Session(
                    endpoint, auth=(self.username, self.password), **kwargs
                )
            else:
                # Use current user's credentials (Kerberos)
                self._session = winrm.Session(
                    endpoint, auth=(None, None), transport="kerberos"
                )

            # Quick validation
            result = self._session.run_ps("$env:COMPUTERNAME")
            return result.status_code == 0
        except Exception as e:
            logger.debug("WinRM connect to %s failed: %s", self.hostname, e)
            return False

    def run_ps(self, script: str) -> Tuple[bool, str, str]:
        """Run PowerShell script, return (success, stdout, stderr)."""
        if not self._session:
            return False, "", "No WinRM session"
        try:
            result = self._session.run_ps(script)
            stdout = result.std_out.decode("utf-8", errors="replace") if result.std_out else ""
            stderr = result.std_err.decode("utf-8", errors="replace") if result.std_err else ""
            return result.status_code == 0, stdout, stderr
        except Exception as e:
            return False, "", str(e)


class _PSSubprocessTransport:
    """Execute PowerShell scripts targeting a remote host via local subprocess + CIM/Invoke-Command."""

    def __init__(self, hostname: str, username: str = None, password: str = None):
        self.hostname = hostname
        self.username = username
        self.password = password

    def connect(self) -> bool:
        """Validate we can reach the host."""
        script = f"Test-Connection -ComputerName '{_safe_hostname(self.hostname)}' -Count 1 -Quiet"
        ok, stdout, _ = self.run_ps(script)
        return ok and "True" in stdout

    def run_ps(self, script: str, timeout: int = DEFAULT_TIMEOUT) -> Tuple[bool, str, str]:
        """Run PowerShell script via subprocess."""
        try:
            # If credentials are provided, wrap with a PSCredential
            cred_prefix = ""
            if self.username and self.password:
                safe_user = self.username.replace("'", "''")
                safe_pass = self.password.replace("'", "''")
                cred_prefix = (
                    f"$_cred = New-Object System.Management.Automation.PSCredential("
                    f"'{safe_user}', (ConvertTo-SecureString '{safe_pass}' -AsPlainText -Force));\n"
                )

            full_script = cred_prefix + script

            proc = subprocess.run(
                [_PS] + _PS_ARGS + [full_script],
                capture_output=True, text=True, timeout=timeout,
                encoding="utf-8", errors="replace",
            )
            stdout = (proc.stdout or "").strip()
            stderr = (proc.stderr or "").strip()
            return proc.returncode == 0, stdout, stderr
        except subprocess.TimeoutExpired:
            return False, "", f"Timed out after {timeout}s"
        except FileNotFoundError:
            return False, "", "powershell.exe not found"
        except Exception as e:
            return False, "", str(e)


# ═══════════════════════════════════════════════════════════════════════════════
# SCAN MODULE SCRIPTS — Each returns a PowerShell fragment
# ═══════════════════════════════════════════════════════════════════════════════

def _ps_hardware(host: str) -> str:
    return f"""
$cs = Get-CimInstance Win32_ComputerSystem -ComputerName '{host}' -EA SilentlyContinue
$bios = Get-CimInstance Win32_BIOS -ComputerName '{host}' -EA SilentlyContinue
$cpus = @(Get-CimInstance Win32_Processor -ComputerName '{host}' -EA SilentlyContinue)
$cpu = $cpus | Select-Object -First 1
$mb = Get-CimInstance Win32_BaseBoard -ComputerName '{host}' -EA SilentlyContinue
$mem = @(Get-CimInstance Win32_PhysicalMemory -ComputerName '{host}' -EA SilentlyContinue)
$gpu = @(Get-CimInstance Win32_VideoController -ComputerName '{host}' -EA SilentlyContinue)
$tpm = Get-CimInstance -Namespace 'root\\cimv2\\Security\\MicrosoftTpm' -ClassName Win32_Tpm -EA SilentlyContinue

$hw = @{{
    manufacturer = if ($cs) {{ $cs.Manufacturer }} else {{ '' }}
    model = if ($cs) {{ $cs.Model }} else {{ '' }}
    domain = if ($cs) {{ $cs.Domain }} else {{ '' }}
    fqdn = if ($cs) {{ "$($cs.Name).$($cs.Domain)" }} else {{ '' }}
    total_logical_processors = if ($cs) {{ $cs.NumberOfLogicalProcessors }} else {{ 0 }}
    total_memory_gb = if ($cs) {{ [math]::Round($cs.TotalPhysicalMemory / 1GB, 2) }} else {{ 0 }}
    serial_number = if ($bios) {{ $bios.SerialNumber }} else {{ '' }}
    bios_version = if ($bios) {{ $bios.SMBIOSBIOSVersion }} else {{ '' }}
    bios_release_date = if ($bios -and $bios.ReleaseDate) {{ $bios.ReleaseDate.ToString('yyyy-MM-dd') }} else {{ '' }}
    cpu_model = if ($cpu) {{ $cpu.Name }} else {{ '' }}
    cpu_speed_ghz = if ($cpu) {{ [math]::Round($cpu.MaxClockSpeed / 1000, 2) }} else {{ 0 }}
    cpu_architecture = if ($cpu) {{ switch($cpu.Architecture) {{ 0{{'x86'}} 5{{'ARM'}} 9{{'x64'}} 12{{'ARM64'}} default{{'Unknown'}} }} }} else {{ '' }}
    total_cores = ($cpus | Measure-Object -Property NumberOfCores -Sum).Sum
    total_sockets = @($cpus).Count
    motherboard = if ($mb) {{ "$($mb.Manufacturer) $($mb.Product)" }} else {{ '' }}
    ram_slots_used = @($mem).Count
    ram_dimms = @($mem | ForEach-Object {{
        @{{ capacity_gb = [math]::Round($_.Capacity / 1GB, 2); speed_mhz = $_.ConfiguredClockSpeed; type = $_.MemoryType; manufacturer = $_.Manufacturer }}
    }})
    gpu_adapters = @($gpu | ForEach-Object {{
        @{{ name = $_.Name; driver_version = $_.DriverVersion; vram_gb = [math]::Round($_.AdapterRAM / 1GB, 2); status = $_.Status }}
    }})
    tpm_present = if ($tpm) {{ $true }} else {{ $false }}
    tpm_version = if ($tpm) {{ $tpm.SpecVersion }} else {{ '' }}
    secure_boot = $(try {{ (Confirm-SecureBootUEFI -EA SilentlyContinue) -eq $true }} catch {{ $false }})
    is_virtual = if ($cs) {{ $cs.Model -match 'Virtual|VMware|KVM|Xen|HyperV|QEMU' }} else {{ $false }}
    hypervisor_type = if ($cs -and $cs.Model -match 'VMware') {{ 'VMware' }} elseif ($cs -and $cs.Model -match 'Virtual') {{ 'Hyper-V' }} elseif ($cs -and $cs.Model -match 'KVM|QEMU') {{ 'KVM' }} else {{ '' }}
    system_type = if ($cs) {{ $cs.SystemType }} else {{ '' }}
    power_plan = $(try {{ (Get-CimInstance -Namespace root\\cimv2\\power -ClassName Win32_PowerPlan -EA SilentlyContinue | Where-Object {{ $_.IsActive }}).ElementName }} catch {{ '' }})
}}
$hw | ConvertTo-Json -Depth 3 -Compress
"""

def _ps_os(host: str) -> str:
    return f"""
$os = Get-CimInstance Win32_OperatingSystem -ComputerName '{host}' -EA SilentlyContinue
$tz = Get-CimInstance Win32_TimeZone -ComputerName '{host}' -EA SilentlyContinue
$pf = Get-CimInstance Win32_PageFileUsage -ComputerName '{host}' -EA SilentlyContinue
$cs = Get-CimInstance Win32_ComputerSystem -ComputerName '{host}' -EA SilentlyContinue
$qfe = @(Get-CimInstance Win32_QuickFixEngineering -ComputerName '{host}' -EA SilentlyContinue | Sort-Object InstalledOn -Descending | Select-Object -First 1)

$o = @{{
    os_name = if ($os) {{ $os.Caption }} else {{ '' }}
    os_version = if ($os) {{ $os.Version }} else {{ '' }}
    os_build = if ($os) {{ $os.BuildNumber }} else {{ '' }}
    os_architecture = if ($os) {{ $os.OSArchitecture }} else {{ '' }}
    os_sku = if ($os) {{ $os.OperatingSystemSKU }} else {{ 0 }}
    os_product_type = if ($os) {{ switch($os.ProductType) {{ 1{{'Workstation'}} 2{{'Domain Controller'}} 3{{'Server'}} default{{'Unknown'}} }} }} else {{ '' }}
    os_language = if ($os) {{ $os.OSLanguage }} else {{ 0 }}
    os_locale = if ($os) {{ $os.Locale }} else {{ '' }}
    install_date = if ($os -and $os.InstallDate) {{ $os.InstallDate.ToString('yyyy-MM-ddTHH:mm:ss') }} else {{ '' }}
    last_boot_time = if ($os -and $os.LastBootUpTime) {{ $os.LastBootUpTime.ToString('yyyy-MM-ddTHH:mm:ss') }} else {{ '' }}
    uptime_days = if ($os -and $os.LastBootUpTime) {{ [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalDays) }} else {{ 0 }}
    timezone = if ($tz) {{ $tz.Caption }} else {{ '' }}
    page_file_gb = if ($pf) {{ [math]::Round(($pf | Measure-Object -Property AllocatedBaseSize -Sum).Sum / 1024, 2) }} else {{ 0 }}
    registered_owner = if ($os) {{ $os.RegisteredUser }} else {{ '' }}
    organization = if ($os) {{ $os.Organization }} else {{ '' }}
    domain_role = if ($cs) {{ switch($cs.DomainRole) {{ 0{{'Standalone Workstation'}} 1{{'Member Workstation'}} 2{{'Standalone Server'}} 3{{'Member Server'}} 4{{'Backup Domain Controller'}} 5{{'Primary Domain Controller'}} default{{'Unknown'}} }} }} else {{ '' }}
    part_of_domain = if ($cs) {{ $cs.PartOfDomain }} else {{ $false }}
    domain = if ($cs) {{ $cs.Domain }} else {{ '' }}
    last_patch_installed = if ($qfe) {{ @{{ id = $qfe[0].HotFixID; date = if($qfe[0].InstalledOn) {{ $qfe[0].InstalledOn.ToString('yyyy-MM-dd') }} else {{ '' }} }} }} else {{ @{{}} }}
    activation_status = $(try {{ (Get-CimInstance SoftwareLicensingProduct -EA SilentlyContinue | Where-Object {{ $_.PartialProductKey -and $_.LicenseStatus -eq 1 }} | Select-Object -First 1).LicenseStatus -eq 1 }} catch {{ $null }})
    windows_update_service = $(try {{ (Get-Service wuauserv -EA SilentlyContinue).Status.ToString() }} catch {{ '' }})
}}
$o | ConvertTo-Json -Depth 2 -Compress
"""

def _ps_storage(host: str) -> str:
    return f"""
$logical = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' -ComputerName '{host}' -EA SilentlyContinue)
$physical = @(Get-CimInstance Win32_DiskDrive -ComputerName '{host}' -EA SilentlyContinue)
$volumes = @(Get-CimInstance Win32_Volume -ComputerName '{host}' -EA SilentlyContinue | Where-Object {{ $_.DriveLetter }})

$s = @{{
    disks = @($logical | ForEach-Object {{
        @{{
            drive_letter = $_.DeviceID
            label = $_.VolumeName
            size_gb = [math]::Round($_.Size / 1GB, 2)
            free_gb = [math]::Round($_.FreeSpace / 1GB, 2)
            used_pct = if ($_.Size -gt 0) {{ [math]::Round(($_.Size - $_.FreeSpace) / $_.Size * 100, 1) }} else {{ 0 }}
            filesystem = $_.FileSystem
            compressed = $_.Compressed
        }}
    }})
    physical_disks = @($physical | ForEach-Object {{
        @{{
            model = $_.Model
            size_gb = [math]::Round($_.Size / 1GB, 2)
            interface_type = $_.InterfaceType
            media_type = $_.MediaType
            partitions = $_.Partitions
            serial = $_.SerialNumber
            firmware = $_.FirmwareRevision
            status = $_.Status
        }}
    }})
    volumes = @($volumes | ForEach-Object {{
        @{{
            drive_letter = $_.DriveLetter
            label = $_.Label
            filesystem = $_.FileSystem
            block_size = $_.BlockSize
            boot_volume = $_.BootVolume
            system_volume = $_.SystemVolume
            compressed = $_.Compressed
            automount = $_.Automount
        }}
    }})
    total_storage_gb = [math]::Round(($logical | Measure-Object -Property Size -Sum).Sum / 1GB, 2)
    total_free_gb = [math]::Round(($logical | Measure-Object -Property FreeSpace -Sum).Sum / 1GB, 2)
    storage_spaces = @(try {{ Get-StoragePool -EA SilentlyContinue | Where-Object {{ $_.FriendlyName -ne 'Primordial' }} | ForEach-Object {{
        @{{ name=$_.FriendlyName; size_gb=[math]::Round($_.Size/1GB,2); allocated_gb=[math]::Round($_.AllocatedSize/1GB,2); health=$_.HealthStatus.ToString() }}
    }} }} catch {{ }})
}}
$s | ConvertTo-Json -Depth 3 -Compress
"""

def _ps_network(host: str) -> str:
    return f"""
$nics = @(Get-CimInstance Win32_NetworkAdapterConfiguration -Filter 'IPEnabled=TRUE' -ComputerName '{host}' -EA SilentlyContinue)
$adapters = @(Get-CimInstance Win32_NetworkAdapter -ComputerName '{host}' -EA SilentlyContinue | Where-Object {{ $_.NetEnabled -eq $true }})

$n = @{{
    network_adapters = @($nics | ForEach-Object {{
        $adapter = $adapters | Where-Object {{ $_.Index -eq $_.Index }} | Select-Object -First 1
        @{{
            name = $_.Description
            ip_address = if ($_.IPAddress) {{ ($_.IPAddress | Where-Object {{ $_ -match '\\d+\\.\\d+' }} | Select-Object -First 1) }} else {{ '' }}
            ipv6_address = if ($_.IPAddress) {{ ($_.IPAddress | Where-Object {{ $_ -match ':' }} | Select-Object -First 1) }} else {{ '' }}
            subnet_mask = if ($_.IPSubnet) {{ $_.IPSubnet[0] }} else {{ '' }}
            default_gateway = if ($_.DefaultIPGateway) {{ $_.DefaultIPGateway[0] }} else {{ '' }}
            dns_servers = @(if ($_.DNSServerSearchOrder) {{ $_.DNSServerSearchOrder }} else {{ @() }})
            dns_suffix = $_.DNSDomain
            mac_address = $_.MACAddress
            speed_mbps = if ($adapter) {{ [math]::Round($adapter.Speed / 1000000) }} else {{ 0 }}
            dhcp_enabled = $_.DHCPEnabled
            dhcp_server = $_.DHCPServer
            wins_primary = $_.WINSPrimaryServer
            wins_secondary = $_.WINSSecondaryServer
        }}
    }})
    ip_addresses = @($nics | ForEach-Object {{ if ($_.IPAddress) {{ $_.IPAddress | Where-Object {{ $_ -match '\\d+\\.\\d+' }} }} }} | Select-Object -Unique)
    mac_addresses = @($nics | ForEach-Object {{ $_.MACAddress }} | Where-Object {{ $_ }} | Select-Object -Unique)
    dns_suffix_search_list = @(try {{ (Get-DnsClientGlobalSetting -EA SilentlyContinue).SuffixSearchList }} catch {{ @() }})
    routes = @(try {{ Get-NetRoute -AddressFamily IPv4 -EA SilentlyContinue | Where-Object {{ $_.NextHop -ne '0.0.0.0' }} | Select-Object -First 20 | ForEach-Object {{
        @{{ destination = $_.DestinationPrefix; next_hop = $_.NextHop; metric = $_.InterfaceMetric; interface_index = $_.InterfaceIndex }}
    }} }} catch {{ @() }})
    proxy_settings = $(try {{ $proxy = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -EA SilentlyContinue; @{{ enabled = [bool]$proxy.ProxyEnable; server = $proxy.ProxyServer; bypass = $proxy.ProxyOverride }} }} catch {{ @{{ enabled = $false }} }})
    teaming = @(try {{ Get-NetLbfoTeam -EA SilentlyContinue | ForEach-Object {{ @{{ name=$_.Name; mode=$_.TeamingMode.ToString(); members=@($_.Members) }} }} }} catch {{ @() }})
}}
$n | ConvertTo-Json -Depth 3 -Compress
"""

def _ps_applications(host: str) -> str:
    return f"""
$apps = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    # ── Registry-based installed applications ──
    $paths = @(
        'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
    )
    $all = @()
    foreach ($p in $paths) {{
        $all += Get-ItemProperty $p -EA SilentlyContinue | Where-Object {{ $_.DisplayName }} |
            Select-Object @{{N='name';E={{$_.DisplayName}}}}, @{{N='version';E={{$_.DisplayVersion}}}},
                          @{{N='publisher';E={{$_.Publisher}}}}, @{{N='install_date';E={{$_.InstallDate}}}},
                          @{{N='size_mb';E={{if ($_.EstimatedSize) {{ [math]::Round($_.EstimatedSize/1024,1) }} else {{ 0 }}}}}},
                          @{{N='install_location';E={{$_.InstallLocation}}}},
                          @{{N='uninstall_string';E={{$_.UninstallString}}}},
                          @{{N='install_source';E={{$_.InstallSource}}}}
    }}
    $installed = @($all | Sort-Object name -Unique)

    # ── Categorize applications for migration analysis ──
    $categories = @{{
        database = @($installed | Where-Object {{ $_.name -match 'SQL Server|MySQL|PostgreSQL|Oracle|MongoDB|MariaDB|Redis|Cassandra|SQLite' }})
        web_server = @($installed | Where-Object {{ $_.name -match 'IIS|Apache|nginx|Tomcat|HTTPD' }})
        middleware = @($installed | Where-Object {{ $_.name -match 'RabbitMQ|Kafka|ActiveMQ|Redis|Memcached|IBM MQ|MSMQ|BizTalk' }})
        monitoring = @($installed | Where-Object {{ $_.name -match 'Zabbix|Nagios|SCOM|Datadog|New Relic|Dynatrace|Splunk|SolarWinds' }})
        backup = @($installed | Where-Object {{ $_.name -match 'Veeam|Commvault|Acronis|NetBackup|Backup Exec|DPM' }})
        antivirus = @($installed | Where-Object {{ $_.name -match 'Norton|McAfee|Symantec|Kaspersky|ESET|Trend Micro|CrowdStrike|Defender' }})
        development = @($installed | Where-Object {{ $_.name -match 'Visual Studio|Eclipse|IntelliJ|VS Code|Git|Docker|Node|Python|JDK' }})
        office = @($installed | Where-Object {{ $_.name -match 'Microsoft Office|Microsoft 365|LibreOffice|Adobe|Acrobat' }})
    }}

    # ── Running executable analysis — what's actually in use ──
    $runningExes = @(Get-Process -EA SilentlyContinue | Where-Object {{ $_.Path }} |
        Select-Object @{{N='name';E={{$_.ProcessName}}}}, @{{N='path';E={{$_.Path}}}},
                      @{{N='company';E={{$_.Company}}}}, @{{N='product';E={{$_.Product}}}},
                      @{{N='file_version';E={{$_.FileVersion}}}},
                      @{{N='memory_mb';E={{[math]::Round($_.WorkingSet64/1MB,1)}}}} |
        Sort-Object name -Unique)

    # ── Windows Store / AppX packages ──
    $storeApps = @(try {{ Get-AppxPackage -EA SilentlyContinue | Where-Object {{ $_.IsFramework -eq $false -and $_.SignatureKind -eq 'Store' }} |
        Select-Object @{{N='name';E={{$_.Name}}}}, @{{N='version';E={{$_.Version}}}},
                      @{{N='publisher';E={{$_.Publisher}}}}, @{{N='install_location';E={{$_.InstallLocation}}}} |
        Select-Object -First 50 }} catch {{ @() }})

    # ── Startup programs ──
    $startup = @()
    $startup += Get-CimInstance Win32_StartupCommand -EA SilentlyContinue | ForEach-Object {{
        @{{ name=$_.Name; command=$_.Command; location=$_.Location; user=$_.User }}
    }}

    @{{
        installed_applications = @($installed | ForEach-Object {{ @{{
            name = $_.name; version = $_.version; publisher = $_.publisher;
            install_date = $_.install_date; size_mb = $_.size_mb;
            install_location = $_.install_location; install_source = $_.install_source
        }} }})
        application_count = $installed.Count
        app_categories = $categories
        running_executables = @($runningExes | ForEach-Object {{ @{{
            name = $_.name; path = $_.path; company = $_.company;
            product = $_.product; file_version = $_.file_version; memory_mb = $_.memory_mb
        }} }})
        store_apps = $storeApps
        startup_programs = $startup
    }}
}} -EA SilentlyContinue

$apps | ConvertTo-Json -Depth 4 -Compress
"""

def _ps_services(host: str) -> str:
    return f"""
$svcs = @(Get-CimInstance Win32_Service -ComputerName '{host}' -EA SilentlyContinue)
$depSvcs = @(Get-CimInstance Win32_DependentService -ComputerName '{host}' -EA SilentlyContinue)

$svcDetails = @($svcs | ForEach-Object {{
    $name = $_.Name
    $deps = @($depSvcs | Where-Object {{ $_.Dependent.Name -eq $name }} | ForEach-Object {{ $_.Antecedent.Name }})
    $dependents = @($depSvcs | Where-Object {{ $_.Antecedent.Name -eq $name }} | ForEach-Object {{ $_.Dependent.Name }})
    @{{
        name = $_.Name
        display_name = $_.DisplayName
        status = $_.State
        start_type = $_.StartMode
        account = $_.StartName
        path = $_.PathName
        pid = $_.ProcessId
        description = $_.Description
        depends_on = $deps
        depended_by = $dependents
        delayed_auto = ($_.StartMode -eq 'Auto' -and $_.DelayedAutoStart)
    }}
}})

# Categorize service accounts for security/migration analysis
$accountTypes = @{{
    local_system = @($svcs | Where-Object {{ $_.StartName -match 'LocalSystem|Local System' }}).Count
    network_service = @($svcs | Where-Object {{ $_.StartName -match 'NetworkService|Network Service' }}).Count
    local_service = @($svcs | Where-Object {{ $_.StartName -match 'LocalService|Local Service' }}).Count
    domain_accounts = @($svcs | Where-Object {{ $_.StartName -match '\\\\' -and $_.StartName -notmatch 'NT AUTHORITY|NT SERVICE' }} | ForEach-Object {{ $_.StartName }} | Sort-Object -Unique)
    managed_service_accounts = @($svcs | Where-Object {{ $_.StartName -match '\\$$' }} | ForEach-Object {{ $_.StartName }} | Sort-Object -Unique)
}}

$s = @{{
    services = $svcDetails
    running_services = @($svcDetails | Where-Object {{ $_.status -eq 'Running' }})
    stopped_auto_services = @($svcDetails | Where-Object {{ $_.status -ne 'Running' -and $_.start_type -eq 'Auto' }})
    total_services = $svcs.Count
    running_count = @($svcs | Where-Object {{ $_.State -eq 'Running' }}).Count
    service_accounts = $accountTypes
    critical_services = @($svcDetails | Where-Object {{ $_.depended_by.Count -ge 3 }} | Select-Object -First 20)
}}
$s | ConvertTo-Json -Depth 4 -Compress
"""

def _ps_processes(host: str) -> str:
    return f"""
$procs = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    Get-CimInstance Win32_Process -EA SilentlyContinue | ForEach-Object {{
        $owner = $(try {{ ($_ | Invoke-CimMethod -MethodName GetOwner -EA SilentlyContinue).User }} catch {{ '' }})
        @{{
            name = $_.Name
            pid = $_.ProcessId
            command_line = ($_.CommandLine -replace '.{{500,}}','...truncated...')
            memory_mb = [math]::Round($_.WorkingSetSize / 1MB, 1)
            cpu_time_sec = [math]::Round(($_.KernelModeTime + $_.UserModeTime) / 10000000, 1)
            owner = $owner
            parent_pid = $_.ParentProcessId
        }}
    }}
}} -EA SilentlyContinue

@{{ processes = @($procs | Sort-Object {{ $_.memory_mb }} -Descending | Select-Object -First 200) }} | ConvertTo-Json -Depth 3 -Compress
"""

def _ps_roles_features(host: str) -> str:
    return f"""
$rf = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    $roles = @(); $features = @(); $roleDetails = @()
    try {{
        $installed = Get-WindowsFeature -EA Stop | Where-Object {{ $_.InstallState -eq 'Installed' }}
        $roleItems = @($installed | Where-Object {{ $_.FeatureType -eq 'Role' }})
        $featureItems = @($installed | Where-Object {{ $_.FeatureType -ne 'Role' }})
        $roles = @($roleItems | ForEach-Object {{ $_.Name }})
        $features = @($featureItems | ForEach-Object {{ $_.Name }})
        $roleDetails = @($roleItems | ForEach-Object {{
            @{{ name=$_.Name; display_name=$_.DisplayName; sub_features=@($installed | Where-Object {{ $_.Path -match "^$($_.Name)\\\\" }} | ForEach-Object {{ $_.Name }}) }}
        }})
    }} catch {{
        try {{
            $installed = Get-WindowsOptionalFeature -Online -EA Stop | Where-Object {{ $_.State -eq 'Enabled' }}
            $features = @($installed | ForEach-Object {{ $_.FeatureName }})
        }} catch {{ }}
    }}

    # ── Detected Server Role Profiles for migration ──
    $roleProfile = @{{
        is_web_server = $roles -contains 'Web-Server' -or $features -contains 'IIS-WebServer'
        is_database_server = $false  # detected separately via SQL/services
        is_domain_controller = $roles -contains 'AD-Domain-Services'
        is_dns_server = $roles -contains 'DNS'
        is_dhcp_server = $roles -contains 'DHCP'
        is_file_server = $roles -contains 'FS-FileServer' -or $features -contains 'FS-FileServer'
        is_print_server = $roles -contains 'Print-Server'
        is_hyper_v_host = $roles -contains 'Hyper-V'
        is_rds_server = $roles -contains 'RDS-RD-Server' -or $features -contains 'Remote-Desktop-Services'
        is_wsus_server = $roles -contains 'UpdateServices'
        is_certificate_authority = $roles -contains 'ADCS-Cert-Authority'
        is_nps_server = $roles -contains 'NPAS'
        is_fax_server = $roles -contains 'Fax'
        is_application_server = $roles -contains 'Application-Server' -or $features -contains 'NET-Framework-45-Core'
    }}

    # ── Check for common app platform features ──
    $platformFeatures = @{{
        dotnet_35 = $features -contains 'NET-Framework-Core' -or $features -contains 'NetFx3'
        dotnet_45_plus = $features -contains 'NET-Framework-45-Core' -or $features -contains 'NET-Framework-45-Features'
        asp_net_45 = $features -contains 'NET-Framework-45-ASPNET' -or $features -contains 'IIS-ASPNET45'
        asp_net_35 = $features -contains 'NET-Framework-45-ASPNET' -or $features -contains 'IIS-ASPNET'
        windows_auth = $features -contains 'Web-Windows-Auth' -or $features -contains 'IIS-WindowsAuthentication'
        websocket = $features -contains 'Web-WebSockets' -or $features -contains 'IIS-WebSockets'
        http_redirect = $features -contains 'Web-Http-Redirect' -or $features -contains 'IIS-HttpRedirect'
        url_rewrite = Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\IIS Extensions\\URL Rewrite' -EA SilentlyContinue
        arr_installed = Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\IIS Extensions\\Application Request Routing' -EA SilentlyContinue
        msmq = $features -contains 'MSMQ' -or $features -contains 'MSMQ-Server'
        telnet_client = $features -contains 'TelnetClient' -or $features -contains 'Telnet-Client'
        tftp_client = $features -contains 'TFTP'
        snmp = $features -contains 'SNMP-Service'
        smb1 = $features -contains 'FS-SMB1' -or $features -contains 'SMB1Protocol'
    }}

    @{{
        server_roles = $roles
        role_details = $roleDetails
        windows_features = $features
        role_count = $roles.Count
        feature_count = $features.Count
        role_profile = $roleProfile
        platform_features = $platformFeatures
    }}
}} -EA SilentlyContinue

$rf | ConvertTo-Json -Depth 3 -Compress
"""

def _ps_scheduled_tasks(host: str) -> str:
    return f"""
$tasks = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    Get-ScheduledTask -EA SilentlyContinue | Where-Object {{ $_.TaskPath -notmatch '\\\\Microsoft\\\\' }} |
    ForEach-Object {{
        $info = $_ | Get-ScheduledTaskInfo -EA SilentlyContinue
        @{{
            name = $_.TaskName
            path = $_.TaskPath
            state = $_.State.ToString()
            author = $_.Author
            last_run = if ($info -and $info.LastRunTime -and $info.LastRunTime.Year -gt 2000) {{ $info.LastRunTime.ToString('yyyy-MM-ddTHH:mm:ss') }} else {{ '' }}
            last_result = if ($info) {{ $info.LastTaskResult }} else {{ -1 }}
            next_run = if ($info -and $info.NextRunTime -and $info.NextRunTime.Year -gt 2000) {{ $info.NextRunTime.ToString('yyyy-MM-ddTHH:mm:ss') }} else {{ '' }}
            action = ($_.Actions | Select-Object -First 1 | ForEach-Object {{ "$($_.Execute) $($_.Arguments)" }})
            run_as = $_.Principal.UserId
        }}
    }}
}} -EA SilentlyContinue

@{{ scheduled_tasks = @($tasks) }} | ConvertTo-Json -Depth 3 -Compress
"""

def _ps_event_logs(host: str) -> str:
    return f"""
$events = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    $since = (Get-Date).AddDays(-7)
    $summary = @()
    foreach ($logName in @('System','Application')) {{
        try {{
            $evts = Get-WinEvent -FilterHashtable @{{ LogName=$logName; Level=@(1,2); StartTime=$since }} -MaxEvents 500 -EA SilentlyContinue
            $grouped = $evts | Group-Object ProviderName | ForEach-Object {{
                @{{
                    log = $logName
                    source = $_.Name
                    count = $_.Count
                    level = ($_.Group | Select-Object -First 1).LevelDisplayName
                    latest_message = ($_.Group | Select-Object -First 1).Message -replace '.{{500,}}','...truncated...'
                    latest_time = ($_.Group | Sort-Object TimeCreated -Descending | Select-Object -First 1).TimeCreated.ToString('yyyy-MM-ddTHH:mm:ss')
                }}
            }}
            $summary += $grouped
        }} catch {{ }}
    }}
    $summary | Sort-Object {{ $_.count }} -Descending | Select-Object -First 50
}} -EA SilentlyContinue

@{{ event_log_summary = @($events) }} | ConvertTo-Json -Depth 3 -Compress
"""

def _ps_performance(host: str) -> str:
    return f"""
$perf = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    $counters = @(
        '\\Processor(_Total)\\% Processor Time',
        '\\Memory\\% Committed Bytes In Use',
        '\\PhysicalDisk(_Total)\\Current Disk Queue Length',
        '\\PhysicalDisk(_Total)\\Disk Bytes/sec',
        '\\Network Interface(*)\\Bytes Total/sec'
    )
    $samples = @()
    try {{
        $samples = (Get-Counter -Counter $counters -SampleInterval 2 -MaxSamples 3 -EA Stop).CounterSamples
    }} catch {{ }}

    $cpu_vals = @($samples | Where-Object {{ $_.Path -match 'Processor Time' }} | ForEach-Object {{ $_.CookedValue }})
    $mem_vals = @($samples | Where-Object {{ $_.Path -match 'Committed Bytes' }} | ForEach-Object {{ $_.CookedValue }})
    $dq_vals = @($samples | Where-Object {{ $_.Path -match 'Queue Length' }} | ForEach-Object {{ $_.CookedValue }})

    @{{
        avg_cpu_pct = if ($cpu_vals.Count) {{ [math]::Round(($cpu_vals | Measure-Object -Average).Average, 1) }} else {{ $null }}
        peak_cpu_pct = if ($cpu_vals.Count) {{ [math]::Round(($cpu_vals | Measure-Object -Maximum).Maximum, 1) }} else {{ $null }}
        avg_memory_pct = if ($mem_vals.Count) {{ [math]::Round(($mem_vals | Measure-Object -Average).Average, 1) }} else {{ $null }}
        peak_memory_pct = if ($mem_vals.Count) {{ [math]::Round(($mem_vals | Measure-Object -Maximum).Maximum, 1) }} else {{ $null }}
        avg_disk_queue = if ($dq_vals.Count) {{ [math]::Round(($dq_vals | Measure-Object -Average).Average, 2) }} else {{ $null }}
    }}
}} -EA SilentlyContinue

$perf | ConvertTo-Json -Depth 2 -Compress
"""

def _ps_sql_server(host: str) -> str:
    return f"""
$sql = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    $instances = @()
    try {{
        $regPath = 'HKLM:\\SOFTWARE\\Microsoft\\Microsoft SQL Server\\Instance Names\\SQL'
        $names = Get-ItemProperty $regPath -EA Stop
        foreach ($prop in ($names.PSObject.Properties | Where-Object {{ $_.Name -notmatch 'PS' }})) {{
            $instName = $prop.Name
            $instId = $prop.Value
            $setupPath = "HKLM:\\SOFTWARE\\Microsoft\\Microsoft SQL Server\\$instId\\Setup"
            $setup = Get-ItemProperty $setupPath -EA SilentlyContinue
            $mssqlPath = "HKLM:\\SOFTWARE\\Microsoft\\Microsoft SQL Server\\$instId\\MSSQLServer\\SuperSocketNetLib\\Tcp\\IPAll"
            $tcp = Get-ItemProperty $mssqlPath -EA SilentlyContinue

            $databases = @(); $serverConfig = @{{}}; $agStatus = @()
            try {{
                $svcName = if ($instName -eq 'MSSQLSERVER') {{ 'MSSQLSERVER' }} else {{ "MSSQL`$$instName" }}
                $svc = Get-Service $svcName -EA SilentlyContinue
                if ($svc -and $svc.Status -eq 'Running') {{
                    $connStr = if ($instName -eq 'MSSQLSERVER') {{ '.' }} else {{ ".\\$instName" }}
                    # Database details
                    $dbs = Invoke-Sqlcmd -ServerInstance $connStr -Query "
                        SELECT d.name, CAST(SUM(mf.size)*8.0/1024 AS DECIMAL(12,2)) as size_mb,
                               d.recovery_model_desc, d.compatibility_level, d.state_desc,
                               d.collation_name, d.is_auto_close_on, d.is_auto_shrink_on,
                               MAX(b.backup_finish_date) as last_backup,
                               d.log_reuse_wait_desc,
                               (SELECT CAST(SUM(size)*8.0/1024 AS DECIMAL(12,2)) FROM sys.master_files WHERE database_id=d.database_id AND type=1) as log_size_mb
                        FROM sys.databases d
                        LEFT JOIN sys.master_files mf ON d.database_id = mf.database_id AND mf.type = 0
                        LEFT JOIN msdb.dbo.backupset b ON d.name = b.database_name
                        GROUP BY d.name, d.recovery_model_desc, d.compatibility_level, d.state_desc,
                                 d.collation_name, d.is_auto_close_on, d.is_auto_shrink_on,
                                 d.log_reuse_wait_desc, d.database_id
                    " -EA SilentlyContinue
                    $databases = @($dbs | ForEach-Object {{
                        @{{
                            name = $_.name; size_mb = [double]$_.size_mb; log_size_mb = if($_.log_size_mb){{[double]$_.log_size_mb}}else{{0}};
                            recovery_model = $_.recovery_model_desc; compat_level = $_.compatibility_level;
                            state = $_.state_desc; collation = $_.collation_name;
                            auto_close = $_.is_auto_close_on; auto_shrink = $_.is_auto_shrink_on;
                            last_backup = if ($_.last_backup) {{ $_.last_backup.ToString('yyyy-MM-ddTHH:mm:ss') }} else {{ '' }};
                            log_reuse_wait = $_.log_reuse_wait_desc
                        }}
                    }})
                    # Server configuration
                    try {{
                        $cfg = Invoke-Sqlcmd -ServerInstance $connStr -Query "
                            SELECT @@VERSION as full_version, SERVERPROPERTY('ProductLevel') as sp_level,
                                   SERVERPROPERTY('Edition') as edition_name, SERVERPROPERTY('Collation') as server_collation,
                                   SERVERPROPERTY('IsClustered') as is_clustered, SERVERPROPERTY('IsHadrEnabled') as is_hadr,
                                   (SELECT value_in_use FROM sys.configurations WHERE name='max server memory (MB)') as max_memory_mb,
                                   (SELECT value_in_use FROM sys.configurations WHERE name='max degree of parallelism') as maxdop
                        " -EA SilentlyContinue
                        if ($cfg) {{
                            $serverConfig = @{{
                                full_version = $cfg.full_version; sp_level = $cfg.sp_level;
                                edition_detail = $cfg.edition_name; server_collation = $cfg.server_collation;
                                is_clustered = [bool]$cfg.is_clustered; is_always_on = [bool]$cfg.is_hadr;
                                max_memory_mb = $cfg.max_memory_mb; maxdop = $cfg.maxdop
                            }}
                        }}
                    }} catch {{ }}
                    # Always On AG status
                    try {{
                        $agStatus = @(Invoke-Sqlcmd -ServerInstance $connStr -Query "
                            SELECT ag.name as ag_name, rs.role_desc, rs.synchronization_health_desc,
                                   dbs.database_name, dbs.synchronization_state_desc
                            FROM sys.dm_hadr_availability_replica_states rs
                            JOIN sys.availability_groups ag ON rs.group_id = ag.group_id
                            LEFT JOIN sys.dm_hadr_database_replica_states dbs ON rs.replica_id = dbs.replica_id
                            WHERE rs.is_local = 1
                        " -EA SilentlyContinue | ForEach-Object {{
                            @{{ ag_name=$_.ag_name; role=$_.role_desc; health=$_.synchronization_health_desc; database=$_.database_name; sync_state=$_.synchronization_state_desc }}
                        }})
                    }} catch {{ }}
                }}
            }} catch {{ }}

            # SQL Agent jobs
            $agentJobs = @()
            try {{
                $svcName = if ($instName -eq 'MSSQLSERVER') {{ 'SQLSERVERAGENT' }} else {{ "SQLAgent`$$instName" }}
                $agentSvc = Get-Service $svcName -EA SilentlyContinue
                if ($agentSvc -and $agentSvc.Status -eq 'Running') {{
                    $connStr = if ($instName -eq 'MSSQLSERVER') {{ '.' }} else {{ ".\\$instName" }}
                    $agentJobs = @(Invoke-Sqlcmd -ServerInstance $connStr -Query "
                        SELECT j.name, j.enabled, h.run_status, h.run_date, h.run_time
                        FROM msdb.dbo.sysjobs j
                        LEFT JOIN (SELECT job_id, run_status, run_date, run_time,
                            ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY run_date DESC, run_time DESC) as rn
                            FROM msdb.dbo.sysjobhistory WHERE step_id=0) h ON j.job_id = h.job_id AND h.rn=1
                    " -EA SilentlyContinue | ForEach-Object {{
                        @{{ name=$_.name; enabled=[bool]$_.enabled; last_status=switch($_.run_status){{0{{'Failed'}}1{{'Succeeded'}}2{{'Retry'}}3{{'Canceled'}}default{{'Unknown'}}}} }}
                    }})
                }}
            }} catch {{ }}

            $instances += @{{
                instance_name = $instName
                version = if ($setup) {{ $setup.Version }} else {{ '' }}
                edition = if ($setup) {{ $setup.Edition }} else {{ '' }}
                tcp_port = if ($tcp) {{ $tcp.TcpPort }} else {{ '1433' }}
                databases = $databases; database_count = $databases.Count
                server_config = $serverConfig; agent_jobs = $agentJobs
                availability_groups = $agStatus
                sql_service_account = $(try {{ (Get-CimInstance Win32_Service -Filter "Name='$svcName'" -EA SilentlyContinue).StartName }} catch {{ '' }})
            }}
        }}
    }} catch {{ }}
    @{{ sql_instances = $instances; sql_instance_count = $instances.Count }}
}} -EA SilentlyContinue

$sql | ConvertTo-Json -Depth 5 -Compress
"""

def _ps_iis(host: str) -> str:
    return f"""
$iis = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    $result = @{{ iis_installed = $false; iis_version = ''; iis_sites = @(); app_pools = @(); virtual_directories = @(); ssl_bindings = @() }}
    try {{
        Import-Module WebAdministration -EA Stop
        $result.iis_installed = $true
        $result.iis_version = $(try {{ (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\InetStp' -EA Stop).VersionString }} catch {{ '' }})

        # ── Sites with full details ──
        $result.iis_sites = @(Get-Website -EA Stop | ForEach-Object {{
            $site = $_
            $apps = @(Get-WebApplication -Site $site.Name -EA SilentlyContinue)
            $vdirs = @(Get-WebVirtualDirectory -Site $site.Name -EA SilentlyContinue)
            @{{
                name = $site.Name
                id = $site.ID
                state = $site.State
                physical_path = $site.PhysicalPath
                bindings = @($site.Bindings.Collection | ForEach-Object {{
                    @{{ protocol=$_.protocol; binding_info=$_.bindingInformation; ssl_flags=$_.sslFlags; cert_hash=$_.certificateHash }}
                }})
                app_pool = $site.ApplicationPool
                applications = @($apps | ForEach-Object {{
                    @{{ path=$_.Path; physical_path=$_.PhysicalPath; app_pool=$_.ApplicationPool; enabled_protocols=$_.EnabledProtocols }}
                }})
                virtual_directories = @($vdirs | ForEach-Object {{
                    @{{ path=$_.Path; physical_path=$_.PhysicalPath }}
                }})
                log_file_directory = $(try {{ (Get-ItemProperty "IIS:\\Sites\\$($site.Name)" -Name logFile -EA SilentlyContinue).directory }} catch {{ '' }})
            }}
        }})

        # ── Application Pools with runtime versions ──
        $result.app_pools = @(Get-ChildItem IIS:\\AppPools -EA SilentlyContinue | ForEach-Object {{
            @{{
                name = $_.Name
                state = $_.State
                managed_runtime = $_.managedRuntimeVersion
                managed_pipeline = $_.managedPipelineMode
                enable_32bit = $_.enable32BitAppOnWin64
                auto_start = $_.autoStart
                identity_type = $_.processModel.identityType
                username = $_.processModel.userName
                idle_timeout_min = $_.processModel.idleTimeout.TotalMinutes
                recycling_time = ($_.recycling.periodicRestart.schedule.Collection | ForEach-Object {{ $_.value.ToString() }}) -join '; '
                recycling_memory_kb = $_.recycling.periodicRestart.privateMemory
            }}
        }})

        # ── SSL Bindings ──
        try {{
            $result.ssl_bindings = @(Get-ChildItem IIS:\\SslBindings -EA SilentlyContinue | ForEach-Object {{
                $cert = Get-ChildItem "Cert:\\LocalMachine\\My\\$($_.Thumbprint)" -EA SilentlyContinue
                @{{
                    ip = $_.IPAddress.ToString()
                    port = $_.Port
                    host_header = $_.Host
                    thumbprint = $_.Thumbprint
                    cert_subject = if($cert){{$cert.Subject}}else{{''}}
                    cert_expiry = if($cert){{$cert.NotAfter.ToString('yyyy-MM-dd')}}else{{''}}
                }}
            }})
        }} catch {{ }}
    }} catch {{ }}
    $result
}} -EA SilentlyContinue

$iis | ConvertTo-Json -Depth 5 -Compress
"""

def _ps_ad_roles(host: str) -> str:
    return f"""
$ad = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    $result = @{{ is_domain_controller = $false; fsmo_roles = @(); dns_zones = @(); dhcp_scopes = @(); ca_templates = @(); replication_status = '' }}
    try {{
        $features = Get-WindowsFeature -EA SilentlyContinue | Where-Object {{ $_.InstallState -eq 'Installed' -and $_.Name -match 'AD-Domain-Services|DNS|DHCP|ADCS' }}
        if ($features | Where-Object {{ $_.Name -eq 'AD-Domain-Services' }}) {{
            $result.is_domain_controller = $true
            try {{
                Import-Module ActiveDirectory -EA Stop
                $forest = Get-ADForest -EA SilentlyContinue
                $domain = Get-ADDomain -EA SilentlyContinue
                $fsmo = @()
                if ($forest) {{ $fsmo += $forest.SchemaMaster, $forest.DomainNamingMaster }}
                if ($domain) {{ $fsmo += $domain.PDCEmulator, $domain.RIDMaster, $domain.InfrastructureMaster }}
                $result.fsmo_roles = @($fsmo | Where-Object {{ $_ -match $env:COMPUTERNAME }})
            }} catch {{ }}
            try {{ $result.replication_status = (repadmin /replsummary 2>&1 | Select-Object -First 10) -join "`n" }} catch {{ }}
        }}
        if ($features | Where-Object {{ $_.Name -eq 'DNS' }}) {{
            try {{ $result.dns_zones = @(Get-DnsServerZone -EA SilentlyContinue | ForEach-Object {{ $_.ZoneName }}) }} catch {{ }}
        }}
        if ($features | Where-Object {{ $_.Name -eq 'DHCP' }}) {{
            try {{ $result.dhcp_scopes = @(Get-DhcpServerv4Scope -EA SilentlyContinue | ForEach-Object {{ "$($_.ScopeId) ($($_.Name)) $($_.StartRange)-$($_.EndRange)" }}) }} catch {{ }}
        }}
    }} catch {{ }}
    $result
}} -EA SilentlyContinue

$ad | ConvertTo-Json -Depth 3 -Compress
"""

def _ps_file_shares(host: str) -> str:
    return f"""
$shares = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    $result = @{{ file_shares = @(); dfs_namespaces = @() }}
    try {{
        $result.file_shares = @(Get-SmbShare -EA SilentlyContinue | Where-Object {{ $_.Name -notmatch '^(ADMIN|IPC|[A-Z])\\$' }} | ForEach-Object {{
            $path = $_.Path
            $size = 0
            if ($path -and (Test-Path $path)) {{
                try {{ $size = [math]::Round((Get-ChildItem $path -Recurse -Force -EA SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1GB, 2) }} catch {{ }}
            }}
            @{{
                name = $_.Name
                path = $path
                description = $_.Description
                share_type = $_.ShareType.ToString()
                size_gb = $size
                current_users = $_.CurrentUsers
            }}
        }})
    }} catch {{ }}
    try {{ $result.dfs_namespaces = @(Get-DfsnRoot -EA SilentlyContinue | ForEach-Object {{ $_.Path }}) }} catch {{ }}
    $result
}} -EA SilentlyContinue

$shares | ConvertTo-Json -Depth 3 -Compress
"""

def _ps_security(host: str) -> str:
    return f"""
$sec = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    $result = @{{
        firewall_enabled = $false; firewall_profiles = @{{}};
        firewall_rules_count = 0; inbound_allow_rules = @();
        antivirus_product = ''; antivirus_status = '';
        pending_updates_count = 0; last_update_date = '';
        local_admins = @(); open_ports = @();
        audit_policy = @(); password_policy = @{{}};
        defender_exclusions = @(); bitlocker_status = @();
        uac_enabled = $true; rdp_enabled = $false;
        smb_signing_required = $false; lsa_protection = $false
    }}

    # ── Firewall ──
    try {{
        $fw = Get-NetFirewallProfile -EA Stop
        $result.firewall_profiles = @{{}}
        foreach ($p in $fw) {{ $result.firewall_profiles[$p.Name] = $p.Enabled }}
        $result.firewall_enabled = ($fw | Where-Object {{ $_.Enabled }} | Measure-Object).Count -gt 0
        $inbound = @(Get-NetFirewallRule -Direction Inbound -Enabled True -Action Allow -EA SilentlyContinue | Select-Object -First 50)
        $result.firewall_rules_count = @(Get-NetFirewallRule -Enabled True -EA SilentlyContinue).Count
        $result.inbound_allow_rules = @($inbound | ForEach-Object {{
            $port = $(try {{ ($_ | Get-NetFirewallPortFilter -EA SilentlyContinue).LocalPort }} catch {{ '*' }})
            @{{ name=$_.DisplayName; protocol=try{{($_ | Get-NetFirewallPortFilter -EA SilentlyContinue).Protocol}}catch{{'*'}}; port=$port; profile=$_.Profile.ToString() }}
        }})
    }} catch {{ }}

    # ── Antivirus ──
    try {{
        $mp = Get-MpComputerStatus -EA Stop
        $result.antivirus_product = 'Windows Defender'
        $result.antivirus_status = if ($mp.RealTimeProtectionEnabled) {{ 'Active' }} else {{ 'Disabled' }}
        $result.last_update_date = if ($mp.AntivirusSignatureLastUpdated) {{ $mp.AntivirusSignatureLastUpdated.ToString('yyyy-MM-ddTHH:mm:ss') }} else {{ '' }}
        # Defender exclusions (important for migration)
        try {{
            $prefs = Get-MpPreference -EA SilentlyContinue
            $result.defender_exclusions = @{{
                paths = @(if($prefs.ExclusionPath){{$prefs.ExclusionPath}}else{{@()}})
                processes = @(if($prefs.ExclusionProcess){{$prefs.ExclusionProcess}}else{{@()}})
                extensions = @(if($prefs.ExclusionExtension){{$prefs.ExclusionExtension}}else{{@()}})
            }}
        }} catch {{ }}
    }} catch {{
        try {{
            $av = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -EA Stop | Select-Object -First 1
            if ($av) {{ $result.antivirus_product = $av.displayName; $result.antivirus_status = 'Installed' }}
        }} catch {{ }}
    }}

    # ── Pending updates ──
    try {{
        $session = New-Object -ComObject Microsoft.Update.Session
        $searcher = $session.CreateUpdateSearcher()
        $pending = $searcher.Search("IsInstalled=0").Updates
        $result.pending_updates_count = $pending.Count
    }} catch {{ }}

    # ── Local admins ──
    try {{ $result.local_admins = @(Get-LocalGroupMember -Group 'Administrators' -EA Stop | ForEach-Object {{ $_.Name }}) }} catch {{ }}

    # ── Open ports (listening) ──
    try {{
        $result.open_ports = @(Get-NetTCPConnection -State Listen -EA SilentlyContinue |
            Group-Object LocalPort | ForEach-Object {{
                $proc = Get-Process -Id ($_.Group | Select-Object -First 1).OwningProcess -EA SilentlyContinue
                @{{ port = [int]$_.Name; process_name = if($proc){{$proc.ProcessName}}else{{'unknown'}}; pid = ($_.Group | Select-Object -First 1).OwningProcess }}
            }} | Sort-Object {{ $_.port }})
    }} catch {{ }}

    # ── Audit Policy ──
    try {{
        $auditpol = auditpol /get /category:* 2>&1 | Where-Object {{ $_ -match '\\s+(Success|Failure|No Auditing|Success and Failure)' }}
        $result.audit_policy = @($auditpol | ForEach-Object {{
            $parts = $_ -split '\\s{{2,}}'
            if ($parts.Count -ge 2) {{ @{{ category = $parts[0].Trim(); setting = $parts[-1].Trim() }} }}
        }} | Where-Object {{ $_ }})
    }} catch {{ }}

    # ── Password Policy ──
    try {{
        $netAccounts = net accounts 2>&1
        $result.password_policy = @{{
            min_password_length = ($netAccounts | Select-String 'Minimum password length' | ForEach-Object {{ ($_ -replace '\\D','').Trim() }})
            max_password_age = ($netAccounts | Select-String 'Maximum password age' | ForEach-Object {{ ($_ -split ':')[-1].Trim() }})
            lockout_threshold = ($netAccounts | Select-String 'Lockout threshold' | ForEach-Object {{ ($_ -split ':')[-1].Trim() }})
        }}
    }} catch {{ }}

    # ── BitLocker ──
    try {{
        $bl = Get-BitLockerVolume -EA SilentlyContinue
        $result.bitlocker_status = @($bl | ForEach-Object {{ @{{ drive=$_.MountPoint; protection=$_.ProtectionStatus.ToString(); encryption=$_.EncryptionPercentage }} }})
    }} catch {{ }}

    # ── UAC, RDP, SMB Signing, LSA ──
    try {{ $result.uac_enabled = [bool](Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name EnableLUA -EA SilentlyContinue).EnableLUA }} catch {{ }}
    try {{ $result.rdp_enabled = -not [bool](Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -EA SilentlyContinue).fDenyTSConnections }} catch {{ }}
    try {{ $result.smb_signing_required = [bool](Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters' -Name RequireSecuritySignature -EA SilentlyContinue).RequireSecuritySignature }} catch {{ }}
    try {{ $result.lsa_protection = [bool](Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -Name RunAsPPL -EA SilentlyContinue).RunAsPPL }} catch {{ }}

    $result
}} -EA SilentlyContinue

$sec | ConvertTo-Json -Depth 4 -Compress
"""

def _ps_certificates(host: str) -> str:
    return f"""
$certs = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    $stores = @('My','Root','CA','WebHosting')
    $all = @()
    foreach ($store in $stores) {{
        try {{
            $all += Get-ChildItem "Cert:\\LocalMachine\\$store" -EA SilentlyContinue | ForEach-Object {{
                @{{
                    subject = $_.Subject
                    issuer = $_.Issuer
                    thumbprint = $_.Thumbprint
                    expiry_date = $_.NotAfter.ToString('yyyy-MM-ddTHH:mm:ss')
                    not_before = $_.NotBefore.ToString('yyyy-MM-ddTHH:mm:ss')
                    has_private_key = $_.HasPrivateKey
                    key_usage = ($_.EnhancedKeyUsageList | ForEach-Object {{ $_.FriendlyName }}) -join ', '
                    store = "LocalMachine\\$store"
                    days_until_expiry = [math]::Round(($_.NotAfter - (Get-Date)).TotalDays)
                }}
            }}
        }} catch {{ }}
    }}
    @{{ certificates = @($all) }}
}} -EA SilentlyContinue

$certs | ConvertTo-Json -Depth 3 -Compress
"""

def _ps_virtualization(host: str) -> str:
    return f"""
$virt = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    $result = @{{ is_virtual = $false; hypervisor_type = ''; vm_host = ''; vm_generation = ''; hyperv_vms = @() }}
    $cs = Get-CimInstance Win32_ComputerSystem -EA SilentlyContinue
    if ($cs) {{
        $result.is_virtual = $cs.Model -match 'Virtual|VMware|KVM|Xen|QEMU'
        if ($cs.Model -match 'VMware') {{ $result.hypervisor_type = 'VMware' }}
        elseif ($cs.Model -match 'Virtual') {{ $result.hypervisor_type = 'Hyper-V' }}
        elseif ($cs.Model -match 'KVM|QEMU') {{ $result.hypervisor_type = 'KVM' }}
    }}
    # If this is a Hyper-V host, list VMs
    try {{
        $vms = Get-VM -EA Stop
        $result.hyperv_vms = @($vms | ForEach-Object {{
            @{{ name=$_.Name; state=$_.State.ToString(); cpu=$_.ProcessorCount; memory_mb=[math]::Round($_.MemoryAssigned/1MB); generation=$_.Generation }}
        }})
    }} catch {{ }}
    $result
}} -EA SilentlyContinue

$virt | ConvertTo-Json -Depth 3 -Compress
"""

def _ps_clustering(host: str) -> str:
    return f"""
$cluster = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    $result = @{{ is_clustered = $false; cluster_name = ''; cluster_nodes = @(); cluster_resources = @(); quorum_type = '' }}
    try {{
        $c = Get-Cluster -EA Stop
        $result.is_clustered = $true
        $result.cluster_name = $c.Name
        $result.cluster_nodes = @(Get-ClusterNode -EA SilentlyContinue | ForEach-Object {{ "$($_.Name) ($($_.State))" }})
        $result.cluster_resources = @(Get-ClusterResource -EA SilentlyContinue | ForEach-Object {{ @{{ name=$_.Name; type=$_.ResourceType.Name; state=$_.State.ToString(); owner=$_.OwnerNode.Name }} }})
        try {{ $result.quorum_type = (Get-ClusterQuorum -EA Stop).QuorumType.ToString() }} catch {{ }}
    }} catch {{ }}
    $result
}} -EA SilentlyContinue

$cluster | ConvertTo-Json -Depth 3 -Compress
"""

def _ps_backup(host: str) -> str:
    return f"""
$backup = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    $result = @{{ backup_solution = ''; last_backup_date = ''; backup_target = ''; vss_writers = @(); backup_agents = @() }}
    # Check for known backup agents
    $agents = @(
        @{{ name='Veeam'; service='VeeamAgent'; reg='HKLM:\\SOFTWARE\\Veeam' }},
        @{{ name='Commvault'; service='GxCVD'; reg='HKLM:\\SOFTWARE\\CommVault' }},
        @{{ name='DPM'; service='DPMRA'; reg='HKLM:\\SOFTWARE\\Microsoft\\Microsoft Data Protection Manager' }},
        @{{ name='Azure Backup'; service='obengine'; reg='HKLM:\\SOFTWARE\\Microsoft\\Windows Azure Backup' }},
        @{{ name='Acronis'; service='AcrSch2Svc'; reg='HKLM:\\SOFTWARE\\Acronis' }},
        @{{ name='Veritas NetBackup'; service='bpcd'; reg='HKLM:\\SOFTWARE\\Veritas' }}
    )
    foreach ($a in $agents) {{
        $svc = Get-Service $a.service -EA SilentlyContinue
        $regExists = Test-Path $a.reg -EA SilentlyContinue
        if ($svc -or $regExists) {{
            $result.backup_agents += @{{ name=$a.name; service_status=if($svc){{$svc.Status.ToString()}}else{{'Not Running'}}; installed=$true }}
            if (-not $result.backup_solution) {{ $result.backup_solution = $a.name }}
        }}
    }}
    # Windows Server Backup
    try {{
        $wbj = Get-WBJob -Previous 1 -EA Stop
        if (-not $result.backup_solution) {{ $result.backup_solution = 'Windows Server Backup' }}
        $result.last_backup_date = $wbj.EndTime.ToString('yyyy-MM-ddTHH:mm:ss')
    }} catch {{ }}
    # VSS writers
    try {{
        $vss = vssadmin list writers 2>&1 | Select-String 'Writer name:' | ForEach-Object {{ ($_ -replace 'Writer name:\\s*','').Trim("'").Trim('"') }}
        $result.vss_writers = @($vss | Select-Object -First 20)
    }} catch {{ }}
    $result
}} -EA SilentlyContinue

$backup | ConvertTo-Json -Depth 3 -Compress
"""

def _ps_hotfixes(host: str) -> str:
    return f"""
$hf = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    @{{ hotfixes = @(Get-HotFix -EA SilentlyContinue | ForEach-Object {{
        @{{
            hotfix_id = $_.HotFixID
            description = $_.Description
            installed_on = if ($_.InstalledOn) {{ $_.InstalledOn.ToString('yyyy-MM-dd') }} else {{ '' }}
            installed_by = $_.InstalledBy
        }}
    }} | Sort-Object {{ $_.installed_on }} -Descending) }}
}} -EA SilentlyContinue

$hf | ConvertTo-Json -Depth 3 -Compress
"""

def _ps_local_users(host: str) -> str:
    return f"""
$users = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    $result = @{{ local_users = @(); local_groups = @() }}
    try {{
        $result.local_users = @(Get-LocalUser -EA Stop | ForEach-Object {{
            @{{
                name = $_.Name
                enabled = $_.Enabled
                last_logon = if ($_.LastLogon) {{ $_.LastLogon.ToString('yyyy-MM-ddTHH:mm:ss') }} else {{ '' }}
                password_expires = if ($_.PasswordExpires) {{ $_.PasswordExpires.ToString('yyyy-MM-ddTHH:mm:ss') }} else {{ '' }}
                password_last_set = if ($_.PasswordLastSet) {{ $_.PasswordLastSet.ToString('yyyy-MM-ddTHH:mm:ss') }} else {{ '' }}
                description = $_.Description
            }}
        }})
    }} catch {{ }}
    try {{
        $result.local_groups = @(Get-LocalGroup -EA Stop | ForEach-Object {{
            $members = @(Get-LocalGroupMember -Group $_.Name -EA SilentlyContinue | ForEach-Object {{ $_.Name }})
            @{{ name = $_.Name; description = $_.Description; members = $members }}
        }})
    }} catch {{ }}
    $result
}} -EA SilentlyContinue

$users | ConvertTo-Json -Depth 3 -Compress
"""


# ═══════════════════════════════════════════════════════════════════════════════
# NEW COMPREHENSIVE DISCOVERY MODULES
# ═══════════════════════════════════════════════════════════════════════════════

def _ps_frameworks(host: str) -> str:
    """Discover all installed runtimes, SDKs, and development frameworks."""
    return f"""
$fw = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    $result = @{{
        dotnet_clr = @(); dotnet_core = @(); dotnet_sdk = @();
        java = @(); python = @(); nodejs = @(); ruby = @(); go = @(); php = @();
        powershell_version = $PSVersionTable.PSVersion.ToString();
        gac_assemblies_count = 0
    }}

    # ── .NET Framework (CLR) versions ──
    try {{
        $ndpPath = 'HKLM:\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP'
        # v2.0, v3.0, v3.5
        foreach ($v in @('v2.0.50727','v3.0','v3.5')) {{
            $reg = Get-ItemProperty "$ndpPath\\$v" -EA SilentlyContinue
            if ($reg -and $reg.Install -eq 1) {{
                $result.dotnet_clr += @{{ version=$v.TrimStart('v'); sp=if($reg.SP){{$reg.SP}}else{{0}}; install_path=$reg.InstallPath }}
            }}
        }}
        # v4.x
        $v4 = Get-ItemProperty "$ndpPath\\v4\\Full" -EA SilentlyContinue
        if ($v4) {{
            $version = switch([int]$v4.Release) {{
                {{ $_ -ge 533320 }} {{ '4.8.1' }}
                {{ $_ -ge 528040 }} {{ '4.8' }}
                {{ $_ -ge 461808 }} {{ '4.7.2' }}
                {{ $_ -ge 461308 }} {{ '4.7.1' }}
                {{ $_ -ge 460798 }} {{ '4.7' }}
                {{ $_ -ge 394802 }} {{ '4.6.2' }}
                {{ $_ -ge 394254 }} {{ '4.6.1' }}
                {{ $_ -ge 393295 }} {{ '4.6' }}
                {{ $_ -ge 379893 }} {{ '4.5.2' }}
                {{ $_ -ge 378675 }} {{ '4.5.1' }}
                {{ $_ -ge 378389 }} {{ '4.5' }}
                default {{ "4.x (release $($v4.Release))" }}
            }}
            $result.dotnet_clr += @{{ version=$version; release_key=$v4.Release; install_path=$v4.InstallPath; target_version=$v4.TargetVersion }}
        }}
    }} catch {{ }}

    # ── .NET Core / .NET 5+ / ASP.NET runtimes ──
    try {{
        $dotnetExe = Get-Command dotnet -EA SilentlyContinue
        if ($dotnetExe) {{
            $runtimes = dotnet --list-runtimes 2>$null
            $result.dotnet_core = @($runtimes | ForEach-Object {{
                if ($_ -match '^(\\S+)\\s+(\\S+)\\s+\\[(.+)\\]') {{ @{{ runtime=$Matches[1]; version=$Matches[2]; path=$Matches[3] }} }}
            }})
            $sdks = dotnet --list-sdks 2>$null
            $result.dotnet_sdk = @($sdks | ForEach-Object {{
                if ($_ -match '^(\\S+)\\s+\\[(.+)\\]') {{ @{{ version=$Matches[1]; path=$Matches[2] }} }}
            }})
        }}
    }} catch {{ }}

    # ── Java (JDK/JRE) ──
    try {{
        $javaPaths = @()
        $javaPaths += Get-ChildItem 'HKLM:\\SOFTWARE\\JavaSoft\\Java Development Kit' -EA SilentlyContinue | ForEach-Object {{ Get-ItemProperty $_.PSPath }}
        $javaPaths += Get-ChildItem 'HKLM:\\SOFTWARE\\JavaSoft\\Java Runtime Environment' -EA SilentlyContinue | ForEach-Object {{ Get-ItemProperty $_.PSPath }}
        $javaPaths += Get-ChildItem 'HKLM:\\SOFTWARE\\JavaSoft\\JDK' -EA SilentlyContinue | ForEach-Object {{ Get-ItemProperty $_.PSPath }}
        foreach ($j in $javaPaths) {{
            if ($j.JavaHome) {{ $result.java += @{{ version=($j.PSChildName); java_home=$j.JavaHome; type=if($j.PSPath -match 'JDK'){{'JDK'}}else{{'JRE'}} }} }}
        }}
        # Also check common install paths
        foreach ($p in @('C:\\Program Files\\Java','C:\\Program Files (x86)\\Java','C:\\Program Files\\Eclipse Adoptium','C:\\Program Files\\Microsoft\\jdk*')) {{
            if (Test-Path $p -EA SilentlyContinue) {{
                Get-ChildItem $p -Directory -EA SilentlyContinue | ForEach-Object {{
                    $ver = $(try {{ & "$($_.FullName)\\bin\\java" -version 2>&1 | Select-Object -First 1 }} catch {{ '' }})
                    if ($ver -and -not ($result.java | Where-Object {{ $_.java_home -eq $_.FullName }})) {{
                        $result.java += @{{ version=$_.Name; java_home=$_.FullName; type=if($_.Name -match 'jdk'){{'JDK'}}else{{'JRE'}}; detected_version="$ver" }}
                    }}
                }}
            }}
        }}
    }} catch {{ }}

    # ── Python ──
    try {{
        $pyVersions = @()
        Get-ChildItem 'HKLM:\\SOFTWARE\\Python\\PythonCore' -EA SilentlyContinue | ForEach-Object {{
            $ip = Get-ItemProperty "$($_.PSPath)\\InstallPath" -EA SilentlyContinue
            if ($ip) {{ $pyVersions += @{{ version=$_.PSChildName; path=$ip.'(default)' }} }}
        }}
        $pyCmds = @('python','python3','py') | ForEach-Object {{ Get-Command $_ -EA SilentlyContinue }}
        foreach ($cmd in $pyCmds) {{
            $ver = $(try {{ & $cmd.Source --version 2>&1 }} catch {{ '' }})
            if ($ver -match 'Python (\\S+)' -and -not ($pyVersions | Where-Object {{ $_.version -eq $Matches[1] }})) {{
                $pyVersions += @{{ version=$Matches[1]; path=$cmd.Source }}
            }}
        }}
        $result.python = $pyVersions
    }} catch {{ }}

    # ── Node.js ──
    try {{
        $node = Get-Command node -EA SilentlyContinue
        if ($node) {{
            $nver = $(try {{ & node --version 2>$null }} catch {{ '' }})
            $npmver = $(try {{ & npm --version 2>$null }} catch {{ '' }})
            $result.nodejs += @{{ version=$nver; npm_version=$npmver; path=$node.Source }}
        }}
    }} catch {{ }}

    # ── Ruby ──
    try {{
        $ruby = Get-Command ruby -EA SilentlyContinue
        if ($ruby) {{ $result.ruby += @{{ version=(try{{ & ruby --version 2>$null }}catch{{''}}); path=$ruby.Source }} }}
    }} catch {{ }}

    # ── Go ──
    try {{
        $go = Get-Command go -EA SilentlyContinue
        if ($go) {{ $result.go += @{{ version=(try{{ & go version 2>$null }}catch{{''}}); path=$go.Source }} }}
    }} catch {{ }}

    # ── PHP ──
    try {{
        $php = Get-Command php -EA SilentlyContinue
        if ($php) {{ $result.php += @{{ version=(try{{ & php --version 2>$null | Select-Object -First 1 }}catch{{''}}); path=$php.Source }} }}
    }} catch {{ }}

    # ── GAC assemblies count ──
    try {{
        $gacPath = "$env:windir\\Microsoft.NET\\assembly\\GAC_MSIL"
        if (Test-Path $gacPath) {{ $result.gac_assemblies_count = @(Get-ChildItem $gacPath -Directory -EA SilentlyContinue).Count }}
    }} catch {{ }}

    $result
}} -EA SilentlyContinue

$fw | ConvertTo-Json -Depth 4 -Compress
"""

def _ps_network_connections(host: str) -> str:
    """Discover active network connections with process mapping."""
    return f"""
$nc = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    $result = @{{ established = @(); listening = @(); dns_cache = @(); arp_table = @() }}

    # ── Established TCP connections ──
    try {{
        $conns = Get-NetTCPConnection -State Established -EA SilentlyContinue | Select-Object -First 200
        $result.established = @($conns | ForEach-Object {{
            $proc = Get-Process -Id $_.OwningProcess -EA SilentlyContinue
            @{{
                local_address = $_.LocalAddress; local_port = $_.LocalPort;
                remote_address = $_.RemoteAddress; remote_port = $_.RemotePort;
                process_name = if($proc){{$proc.ProcessName}}else{{'unknown'}};
                pid = $_.OwningProcess
            }}
        }})
    }} catch {{ }}

    # ── Listening ports with process names ──
    try {{
        $listeners = Get-NetTCPConnection -State Listen -EA SilentlyContinue
        $result.listening = @($listeners | Group-Object LocalPort | ForEach-Object {{
            $first = $_.Group | Select-Object -First 1
            $proc = Get-Process -Id $first.OwningProcess -EA SilentlyContinue
            @{{
                port = [int]$_.Name;
                address = $first.LocalAddress;
                process_name = if($proc){{$proc.ProcessName}}else{{'unknown'}};
                pid = $first.OwningProcess
            }}
        }} | Sort-Object {{ $_.port }})
    }} catch {{ }}

    # ── DNS client cache (recent resolutions) ──
    try {{
        $result.dns_cache = @(Get-DnsClientCache -EA SilentlyContinue | Where-Object {{ $_.Status -eq 'Success' }} |
            Select-Object -First 50 | ForEach-Object {{
                @{{ name=$_.Entry; type=$_.Type; data=$_.Data; ttl=$_.TimeToLive }}
            }})
    }} catch {{ }}

    # ── ARP table (local network neighbors) ──
    try {{
        $result.arp_table = @(Get-NetNeighbor -State Reachable -EA SilentlyContinue | ForEach-Object {{
            @{{ ip=$_.IPAddress; mac=$_.LinkLayerAddress; interface=$_.InterfaceAlias; state=$_.State.ToString() }}
        }})
    }} catch {{ }}

    # ── Connection summary for migration analysis ──
    $result.connection_summary = @{{
        total_established = $result.established.Count
        total_listening = $result.listening.Count
        external_connections = @($result.established | Where-Object {{
            $_.remote_address -notmatch '^(127\\.|10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|192\\.168\\.|::1|fe80)' -and $_.remote_address -ne '0.0.0.0'
        }}).Count
        unique_remote_hosts = @($result.established | ForEach-Object {{ $_.remote_address }} | Sort-Object -Unique).Count
    }}

    $result
}} -EA SilentlyContinue

$nc | ConvertTo-Json -Depth 3 -Compress
"""

def _ps_registry_config(host: str) -> str:
    """Collect migration-relevant registry settings, env vars, ODBC DSNs."""
    return f"""
$reg = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    $result = @{{
        environment_variables = @{{}}; system_path = @();
        odbc_dsn_system = @(); odbc_dsn_user = @();
        com_plus_apps = @(); dcom_apps = @();
        autorun_entries = @(); file_associations = @();
        windows_features_pending = @()
    }}

    # ── System environment variables ──
    try {{
        $sysEnv = [Environment]::GetEnvironmentVariables('Machine')
        $result.environment_variables = @{{}}
        foreach ($key in $sysEnv.Keys) {{
            $result.environment_variables[$key] = $sysEnv[$key]
        }}
    }} catch {{ }}

    # ── System PATH parsed ──
    try {{
        $result.system_path = @($env:PATH -split ';' | Where-Object {{ $_ }} | ForEach-Object {{ $_.Trim() }})
    }} catch {{ }}

    # ── ODBC System DSNs ──
    try {{
        $result.odbc_dsn_system = @(Get-ItemProperty 'HKLM:\\SOFTWARE\\ODBC\\ODBC.INI\\*' -EA SilentlyContinue | ForEach-Object {{
            @{{
                name = $_.PSChildName
                driver = $_.Driver
                server = $_.Server
                database = $_.Database
                description = $_.Description
            }}
        }} | Where-Object {{ $_.name -ne 'ODBC Data Sources' }})
    }} catch {{ }}

    # ── ODBC User DSNs ──
    try {{
        $result.odbc_dsn_user = @(Get-ItemProperty 'HKCU:\\SOFTWARE\\ODBC\\ODBC.INI\\*' -EA SilentlyContinue | ForEach-Object {{
            @{{ name=$_.PSChildName; driver=$_.Driver; server=$_.Server; database=$_.Database }}
        }} | Where-Object {{ $_.name -ne 'ODBC Data Sources' }})
    }} catch {{ }}

    # ── COM+ Applications ──
    try {{
        $comAdmin = New-Object -ComObject COMAdmin.COMAdminCatalog -EA SilentlyContinue
        if ($comAdmin) {{
            $apps = $comAdmin.GetCollection('Applications')
            $apps.Populate()
            $result.com_plus_apps = @($apps | ForEach-Object {{
                @{{ name=$_.Value('Name'); id=$_.Value('ID'); activation=if($_.Value('Activation') -eq 0){{'In-Process'}}else{{'Server'}} }}
            }} | Select-Object -First 50)
        }}
    }} catch {{ }}

    # ── Autorun entries (startup impact) ──
    try {{
        $autorunPaths = @(
            'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
            'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
            'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'
        )
        foreach ($p in $autorunPaths) {{
            $entries = Get-ItemProperty $p -EA SilentlyContinue
            if ($entries) {{
                foreach ($prop in ($entries.PSObject.Properties | Where-Object {{ $_.Name -notmatch '^PS' }})) {{
                    $result.autorun_entries += @{{ name=$prop.Name; command=$prop.Value; location=$p }}
                }}
            }}
        }}
    }} catch {{ }}

    # ── Pending reboot check ──
    try {{
        $pending = @()
        if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired') {{ $pending += 'WindowsUpdate' }}
        if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending') {{ $pending += 'ComponentServicing' }}
        if (Test-Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\PendingFileRenameOperations') {{ $pending += 'FileRename' }}
        $result.pending_reboot = $pending
    }} catch {{ }}

    $result
}} -EA SilentlyContinue

$reg | ConvertTo-Json -Depth 3 -Compress
"""

def _ps_web_apps(host: str) -> str:
    """Deep IIS web application discovery — configs, frameworks, dependencies."""
    return f"""
$wa = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    $result = @{{ web_applications = @(); web_config_analysis = @(); url_rewrite_rules = @() }}
    try {{
        Import-Module WebAdministration -EA Stop
        $sites = Get-Website -EA SilentlyContinue
        foreach ($site in $sites) {{
            $physPath = $site.PhysicalPath
            if (-not $physPath -or -not (Test-Path $physPath -EA SilentlyContinue)) {{ continue }}

            # Analyze web.config
            $webConfig = Join-Path $physPath 'web.config'
            $analysis = @{{ has_web_config = $false; target_framework = ''; connection_strings = @(); app_settings_keys = @(); authentication_mode = ''; custom_errors = ''; modules = @(); handlers = @() }}

            if (Test-Path $webConfig -EA SilentlyContinue) {{
                $analysis.has_web_config = $true
                try {{
                    [xml]$xml = Get-Content $webConfig -EA Stop
                    $cfg = $xml.configuration

                    # Target framework
                    $httpRuntime = $cfg.'system.web'.httpRuntime
                    if ($httpRuntime) {{ $analysis.target_framework = $httpRuntime.targetFramework }}
                    $compilation = $cfg.'system.web'.compilation
                    if ($compilation -and -not $analysis.target_framework) {{ $analysis.target_framework = $compilation.targetFramework }}

                    # Connection strings (names only, not values for security)
                    $analysis.connection_strings = @($cfg.connectionStrings.add | ForEach-Object {{
                        @{{ name=$_.name; provider=$_.providerName }}
                    }})

                    # App settings keys
                    $analysis.app_settings_keys = @($cfg.appSettings.add | ForEach-Object {{ $_.key }} | Select-Object -First 30)

                    # Authentication mode
                    $authNode = $cfg.'system.web'.authentication
                    if ($authNode) {{ $analysis.authentication_mode = $authNode.mode }}

                    # HTTP modules
                    $analysis.modules = @($cfg.'system.webServer'.modules.add | ForEach-Object {{ $_.name }} | Select-Object -First 20)

                    # HTTP handlers
                    $analysis.handlers = @($cfg.'system.webServer'.handlers.add | ForEach-Object {{ @{{ name=$_.name; path=$_.path; verb=$_.verb }} }} | Select-Object -First 20)
                }} catch {{ }}
            }}

            # Detect app type from files
            $appType = 'Unknown'
            if (Test-Path (Join-Path $physPath '*.aspx') -EA SilentlyContinue) {{ $appType = 'ASP.NET WebForms' }}
            if (Test-Path (Join-Path $physPath 'bin\\*.dll') -EA SilentlyContinue) {{
                $dlls = Get-ChildItem (Join-Path $physPath 'bin') -Filter '*.dll' -EA SilentlyContinue
                if ($dlls | Where-Object {{ $_.Name -match 'System.Web.Mvc' }}) {{ $appType = 'ASP.NET MVC' }}
                if ($dlls | Where-Object {{ $_.Name -match 'Microsoft.AspNetCore' }}) {{ $appType = 'ASP.NET Core' }}
            }}
            if (Test-Path (Join-Path $physPath 'package.json') -EA SilentlyContinue) {{ $appType = 'Node.js' }}
            if (Test-Path (Join-Path $physPath 'WEB-INF') -EA SilentlyContinue) {{ $appType = 'Java WAR' }}

            $result.web_applications += @{{
                site_name = $site.Name
                physical_path = $physPath
                app_type = $appType
                config_analysis = $analysis
                bin_assemblies = @(try {{ Get-ChildItem (Join-Path $physPath 'bin') -Filter '*.dll' -EA SilentlyContinue | ForEach-Object {{ $_.Name }} | Select-Object -First 50 }} catch {{ @() }})
                total_files = $(try {{ @(Get-ChildItem $physPath -Recurse -File -EA SilentlyContinue).Count }} catch {{ 0 }})
                total_size_mb = $(try {{ [math]::Round((Get-ChildItem $physPath -Recurse -File -EA SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB, 2) }} catch {{ 0 }})
            }}
        }}
    }} catch {{ }}
    $result
}} -EA SilentlyContinue

$wa | ConvertTo-Json -Depth 5 -Compress
"""

def _ps_database_deep(host: str) -> str:
    """Discover non-SQL Server databases: MySQL, PostgreSQL, MongoDB, Oracle, Redis."""
    return f"""
$db = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    $result = @{{ mysql = @(); postgresql = @(); mongodb = @(); oracle = @(); redis = @(); other_databases = @() }}

    # ── MySQL ──
    try {{
        $mysqlSvc = Get-Service -Name 'MySQL*' -EA SilentlyContinue | Where-Object {{ $_.Status -eq 'Running' }}
        $mysqlCmd = Get-Command mysql -EA SilentlyContinue
        if ($mysqlSvc -or $mysqlCmd) {{
            $version = if($mysqlCmd) {{ try {{ & mysql --version 2>$null }} catch {{ '' }} }} else {{ '' }}
            $result.mysql += @{{
                installed = $true; version = $version;
                service_name = if($mysqlSvc){{$mysqlSvc.Name}}else{{''}};
                service_status = if($mysqlSvc){{$mysqlSvc.Status.ToString()}}else{{'Not Running'}};
                data_dir = $(try {{ (Get-ItemProperty 'HKLM:\\SOFTWARE\\MySQL AB\\*' -EA SilentlyContinue | Select-Object -First 1).DataLocation }} catch {{ '' }})
            }}
        }}
    }} catch {{ }}

    # ── PostgreSQL ──
    try {{
        $pgSvc = Get-Service -Name 'postgresql*' -EA SilentlyContinue | Where-Object {{ $_.Status -eq 'Running' }}
        $pgCmd = Get-Command psql -EA SilentlyContinue
        if ($pgSvc -or $pgCmd) {{
            $version = if($pgCmd) {{ try {{ & psql --version 2>$null }} catch {{ '' }} }} else {{ '' }}
            $result.postgresql += @{{
                installed = $true; version = $version;
                service_name = if($pgSvc){{$pgSvc.Name}}else{{''}};
                service_status = if($pgSvc){{$pgSvc.Status.ToString()}}else{{'Not Running'}};
                data_dir = $(try {{ (Get-ItemProperty 'HKLM:\\SOFTWARE\\PostgreSQL\\Installations\\*' -EA SilentlyContinue | Select-Object -First 1).Data_Directory }} catch {{ '' }})
            }}
        }}
    }} catch {{ }}

    # ── MongoDB ──
    try {{
        $mongoSvc = Get-Service -Name 'MongoDB*' -EA SilentlyContinue
        $mongoCmd = Get-Command mongod -EA SilentlyContinue
        if ($mongoSvc -or $mongoCmd) {{
            $result.mongodb += @{{
                installed = $true;
                service_name = if($mongoSvc){{$mongoSvc.Name}}else{{''}};
                service_status = if($mongoSvc){{$mongoSvc.Status.ToString()}}else{{'Not Running'}};
                version = if($mongoCmd){{ try {{ & mongod --version 2>$null | Select-Object -First 1 }} catch {{ '' }} }}else{{ '' }}
            }}
        }}
    }} catch {{ }}

    # ── Oracle ──
    try {{
        $oracleSvc = Get-Service -Name 'OracleService*' -EA SilentlyContinue
        $oracleHome = $env:ORACLE_HOME
        if ($oracleSvc -or $oracleHome) {{
            $result.oracle += @{{
                installed = $true;
                oracle_home = $oracleHome;
                services = @($oracleSvc | ForEach-Object {{ @{{ name=$_.Name; status=$_.Status.ToString() }} }})
            }}
        }}
    }} catch {{ }}

    # ── Redis ──
    try {{
        $redisSvc = Get-Service -Name 'Redis*' -EA SilentlyContinue
        $redisCmd = Get-Command redis-cli -EA SilentlyContinue
        if ($redisSvc -or $redisCmd) {{
            $result.redis += @{{
                installed = $true;
                service_name = if($redisSvc){{$redisSvc.Name}}else{{''}};
                service_status = if($redisSvc){{$redisSvc.Status.ToString()}}else{{'Not Running'}}
            }}
        }}
    }} catch {{ }}

    # ── Generic detection for other database services ──
    $dbPatterns = @('Elasticsearch','CouchDB','Cassandra','Neo4j','InfluxDB','MariaDB','Firebird','InterBase')
    foreach ($pattern in $dbPatterns) {{
        $svc = Get-Service -Name "*$pattern*" -EA SilentlyContinue
        if ($svc) {{
            $result.other_databases += @{{ name=$pattern; service=$svc.Name; status=$svc.Status.ToString() }}
        }}
    }}

    $result
}} -EA SilentlyContinue

$db | ConvertTo-Json -Depth 3 -Compress
"""

def _ps_middleware(host: str) -> str:
    """Discover middleware, message queues, app servers, caching layers."""
    return f"""
$mw = Invoke-Command -ComputerName '{host}' -ScriptBlock {{
    $result = @{{ app_servers = @(); message_queues = @(); caching = @(); containers = @(); agent_software = @() }}

    # ── Application Servers (Tomcat, JBoss, WebLogic, etc.) ──
    $appServers = @(
        @{{ name='Apache Tomcat'; service='Tomcat*'; paths=@('C:\\Program Files\\Apache Software Foundation\\Tomcat*','C:\\Tomcat*') }},
        @{{ name='JBoss/WildFly'; service='WildFly*'; paths=@('C:\\jboss*','C:\\wildfly*') }},
        @{{ name='WebLogic'; service='*WebLogic*'; paths=@('C:\\Oracle\\Middleware*') }},
        @{{ name='WebSphere'; service='*WebSphere*'; paths=@('C:\\IBM\\WebSphere*') }}
    )
    foreach ($as in $appServers) {{
        $svc = Get-Service -Name $as.service -EA SilentlyContinue
        $pathFound = $false
        foreach ($p in $as.paths) {{ if (Test-Path $p -EA SilentlyContinue) {{ $pathFound = $true; break }} }}
        if ($svc -or $pathFound) {{
            $result.app_servers += @{{ name=$as.name; service=if($svc){{$svc.Name}}else{{''}};
                status=if($svc){{$svc.Status.ToString()}}else{{'Found on disk'}}; detected=$true }}
        }}
    }}

    # ── Message Queues ──
    $mqPatterns = @(
        @{{ name='RabbitMQ'; service='RabbitMQ' }},
        @{{ name='Apache Kafka'; service='kafka*'; alt_check={{ Get-Process -Name '*kafka*' -EA SilentlyContinue }} }},
        @{{ name='IBM MQ'; service='*MQSeries*' }},
        @{{ name='ActiveMQ'; service='*ActiveMQ*' }},
        @{{ name='MSMQ'; service='MSMQ' }},
        @{{ name='Azure Service Bus Relay'; service='ServiceBusGateway*' }}
    )
    foreach ($mq in $mqPatterns) {{
        $svc = Get-Service -Name $mq.service -EA SilentlyContinue
        if ($svc) {{ $result.message_queues += @{{ name=$mq.name; service=$svc.Name; status=$svc.Status.ToString() }} }}
    }}

    # ── Caching Layers ──
    $cachePatterns = @(
        @{{ name='Redis'; service='Redis*' }},
        @{{ name='Memcached'; service='memcached*' }},
        @{{ name='NCache'; service='NCacheSvc*' }},
        @{{ name='AppFabric'; service='AppFabricCachingService*' }}
    )
    foreach ($c in $cachePatterns) {{
        $svc = Get-Service -Name $c.service -EA SilentlyContinue
        if ($svc) {{ $result.caching += @{{ name=$c.name; service=$svc.Name; status=$svc.Status.ToString() }} }}
    }}

    # ── Container Runtimes ──
    $docker = Get-Command docker -EA SilentlyContinue
    if ($docker) {{
        $dver = $(try {{ & docker version --format '{{{{.Server.Version}}}}' 2>$null }} catch {{ '' }})
        $containers = $(try {{ & docker ps --format '{{{{.Names}}}}|{{{{.Image}}}}|{{{{.Status}}}}' 2>$null }} catch {{ @() }})
        $result.containers += @{{
            runtime = 'Docker'; version = $dver;
            running_containers = @($containers | ForEach-Object {{
                $parts = $_ -split '\\|'
                if ($parts.Count -ge 3) {{ @{{ name=$parts[0]; image=$parts[1]; status=$parts[2] }} }}
            }})
        }}
    }}

    # ── Agent Software (monitoring, management) ──
    $agentPatterns = @(
        @{{ name='SCOM Agent'; service='HealthService' }},
        @{{ name='Azure Arc Agent'; service='himds' }},
        @{{ name='Azure Monitor Agent'; service='AzureMonitorAgent' }},
        @{{ name='Log Analytics Agent'; service='MicrosoftMonitoringAgent' }},
        @{{ name='Qualys Agent'; service='QualysAgent' }},
        @{{ name='CrowdStrike Falcon'; service='CSFalconService' }},
        @{{ name='SentinelOne'; service='SentinelAgent' }},
        @{{ name='Puppet Agent'; service='puppet' }},
        @{{ name='Chef Client'; service='chef-client' }},
        @{{ name='Salt Minion'; service='salt-minion' }},
        @{{ name='SNMP'; service='SNMP' }},
        @{{ name='Zabbix Agent'; service='Zabbix Agent*' }},
        @{{ name='Splunk Forwarder'; service='SplunkForwarder' }},
        @{{ name='Datadog Agent'; service='DatadogAgent' }}
    )
    foreach ($a in $agentPatterns) {{
        $svc = Get-Service -Name $a.service -EA SilentlyContinue
        if ($svc) {{ $result.agent_software += @{{ name=$a.name; service=$svc.Name; status=$svc.Status.ToString() }} }}
    }}

    $result
}} -EA SilentlyContinue

$mw | ConvertTo-Json -Depth 4 -Compress
"""


# Module registry mapping module name → PS script generator
_MODULE_SCRIPTS: Dict[str, Callable[[str], str]] = {
    "hardware":        _ps_hardware,
    "os":              _ps_os,
    "storage":         _ps_storage,
    "network":         _ps_network,
    "applications":    _ps_applications,
    "services":        _ps_services,
    "processes":       _ps_processes,
    "roles_features":  _ps_roles_features,
    "scheduled_tasks": _ps_scheduled_tasks,
    "event_logs":      _ps_event_logs,
    "performance":     _ps_performance,
    "sql_server":      _ps_sql_server,
    "iis":             _ps_iis,
    "ad_roles":        _ps_ad_roles,
    "file_shares":     _ps_file_shares,
    "security":        _ps_security,
    "certificates":    _ps_certificates,
    "virtualization":  _ps_virtualization,
    "clustering":      _ps_clustering,
    "backup":          _ps_backup,
    "hotfixes":        _ps_hotfixes,
    "local_users":     _ps_local_users,
    # New comprehensive modules
    "frameworks":           _ps_frameworks,
    "network_connections":  _ps_network_connections,
    "registry_config":      _ps_registry_config,
    "web_apps":             _ps_web_apps,
    "database_deep":        _ps_database_deep,
    "middleware":            _ps_middleware,
}


# ═══════════════════════════════════════════════════════════════════════════════
# WMI SCANNER CLASS
# ═══════════════════════════════════════════════════════════════════════════════

class WMIScanner:
    """
    Agentless server scanner using WinRM (pywinrm) primary + PS subprocess fallback.
    Collects 22 modules of server data and returns OnPremServer-compatible dicts.
    """

    def __init__(self, username: str = None, password: str = None,
                 use_ssl: bool = False, auth: str = "ntlm"):
        self.username = username
        self.password = password
        self.use_ssl = use_ssl
        self.auth = auth

    def scan_server(self, hostname: str, modules: List[str] = None,
                    timeout: int = DEFAULT_TIMEOUT,
                    progress_callback: Callable = None) -> dict:
        """
        Scan a single server for all requested modules.

        Args:
            hostname: Server hostname or IP
            modules: List of module names to scan (default: ALL_MODULES)
            timeout: Max seconds per module
            progress_callback: Called with (hostname, module_name, status) after each module

        Returns:
            OnPremServer-compatible dict with all collected data
        """
        safe_host = _safe_hostname(hostname)
        modules = modules or list(ALL_MODULES)
        start_time = datetime.now(timezone.utc)

        result: Dict[str, Any] = {
            "hostname": safe_host,
            "server_id": str(uuid.uuid4()),
            "success": False,
            "error": "",
            "collected_at": _utcnow(),
            "collection_script_version": "python-wmi-scanner-1.0",
            "scan_modules": modules,
        }

        # Try WinRM transport first, fall back to PS subprocess
        transport = None
        transport_name = "none"

        try:
            winrm_transport = _WinRMTransport(safe_host, self.username, self.password,
                                               self.use_ssl, self.auth)
            if winrm_transport.connect():
                transport = winrm_transport
                transport_name = "winrm"
                logger.info("WinRM connected to %s", safe_host)
        except Exception as e:
            logger.debug("WinRM failed for %s: %s, trying PS subprocess", safe_host, e)

        if transport is None:
            ps_transport = _PSSubprocessTransport(safe_host, self.username, self.password)
            if ps_transport.connect():
                transport = ps_transport
                transport_name = "ps_subprocess"
                logger.info("PS subprocess connected to %s", safe_host)
            else:
                result["error"] = f"Cannot connect to {safe_host} via WinRM or PS subprocess"
                return result

        result["transport"] = transport_name
        modules_collected = 0
        modules_failed = []

        for mod_name in modules:
            if mod_name not in _MODULE_SCRIPTS:
                continue

            if progress_callback:
                try:
                    progress_callback(safe_host, mod_name, "scanning")
                except Exception:
                    pass

            try:
                script = _MODULE_SCRIPTS[mod_name](safe_host)

                # For WinRM, scripts run ON the remote host; for localhost via
                # PS subprocess, CIM -ComputerName fails without WinRM config.
                # In both cases, strip -ComputerName and Invoke-Command wrappers.
                if transport_name == "winrm" or _is_localhost(safe_host):
                    script = _localize_script(script)

                ok, stdout, stderr = transport.run_ps(script)

                if ok and stdout:
                    # Parse JSON from stdout
                    json_start = -1
                    for i, ch in enumerate(stdout):
                        if ch in ('{', '['):
                            json_start = i
                            break
                    if json_start >= 0:
                        try:
                            parsed = json.loads(stdout[json_start:])
                            if isinstance(parsed, dict):
                                result.update(parsed)
                                modules_collected += 1
                            else:
                                modules_failed.append(mod_name)
                        except json.JSONDecodeError:
                            modules_failed.append(mod_name)
                    else:
                        modules_failed.append(mod_name)
                else:
                    modules_failed.append(mod_name)
                    logger.debug("Module %s failed on %s: %s", mod_name, safe_host, stderr[:200])

            except Exception as e:
                modules_failed.append(mod_name)
                logger.debug("Module %s exception on %s: %s", mod_name, safe_host, e)

            if progress_callback:
                try:
                    status = "success" if mod_name not in modules_failed else "failed"
                    progress_callback(safe_host, mod_name, status)
                except Exception:
                    pass

        elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()
        result["collection_duration_sec"] = round(elapsed, 1)
        result["modules_collected"] = modules_collected
        result["modules_failed"] = modules_failed
        result["success"] = modules_collected > 0

        return result

    def scan_batch(self, servers: List[str], modules: List[str] = None,
                   max_concurrent: int = DEFAULT_CONCURRENCY,
                   timeout: int = DEFAULT_TIMEOUT,
                   progress_callback: Callable = None) -> str:
        """
        Start a background scan job for multiple servers.

        Returns:
            job_id string for tracking progress
        """
        modules = modules or list(ALL_MODULES)
        max_concurrent = min(max_concurrent, MAX_CONCURRENCY)

        # Validate servers
        valid_servers = []
        for s in servers:
            try:
                valid_servers.append(_safe_hostname(s))
            except ValueError:
                continue

        if not valid_servers:
            raise ValueError("No valid server names provided")

        job_id = f"scan_{uuid.uuid4().hex[:12]}"

        with _scan_lock:
            _scan_jobs[job_id] = {
                "status": "running",
                "total": len(valid_servers),
                "completed": 0,
                "succeeded": 0,
                "failed": 0,
                "current_server": "",
                "modules": modules,
                "servers_status": {s: {"status": "pending", "modules_done": 0, "error": ""} for s in valid_servers},
                "started_at": _utcnow(),
                "finished_at": None,
                "batch_id": None,
            }

        thread = threading.Thread(
            target=self._run_scan_job,
            args=(job_id, valid_servers, modules, max_concurrent, timeout),
            daemon=True,
        )
        thread.start()

        return job_id

    def _run_scan_job(self, job_id: str, servers: List[str], modules: List[str],
                      max_concurrent: int, timeout: int):
        """Background thread: scan all servers in parallel."""
        collected = []

        def _progress(hostname, mod_name, status):
            with _scan_lock:
                job = _scan_jobs.get(job_id)
                if job and hostname in job["servers_status"]:
                    job["servers_status"][hostname]["status"] = f"scanning:{mod_name}"
                    job["current_server"] = hostname

        try:
            with ThreadPoolExecutor(max_workers=max_concurrent) as pool:
                futures = {}
                for server in servers:
                    with _scan_lock:
                        if _scan_jobs[job_id]["status"] == "cancelled":
                            break
                        _scan_jobs[job_id]["servers_status"][server]["status"] = "queued"

                    future = pool.submit(self.scan_server, server, modules, timeout, _progress)
                    futures[future] = server

                for future in as_completed(futures):
                    server = futures[future]
                    with _scan_lock:
                        if _scan_jobs[job_id]["status"] == "cancelled":
                            for f in futures:
                                f.cancel()
                            break

                    try:
                        result = future.result()
                        with _scan_lock:
                            _scan_jobs[job_id]["completed"] += 1
                            if result.get("success"):
                                _scan_jobs[job_id]["succeeded"] += 1
                                _scan_jobs[job_id]["servers_status"][server] = {
                                    "status": "success", "error": "",
                                    "modules_done": result.get("modules_collected", 0)
                                }
                                collected.append(result)
                            else:
                                _scan_jobs[job_id]["failed"] += 1
                                _scan_jobs[job_id]["servers_status"][server] = {
                                    "status": "failed",
                                    "error": result.get("error", "Unknown error"),
                                    "modules_done": result.get("modules_collected", 0)
                                }
                    except Exception as e:
                        with _scan_lock:
                            _scan_jobs[job_id]["completed"] += 1
                            _scan_jobs[job_id]["failed"] += 1
                            _scan_jobs[job_id]["servers_status"][server] = {
                                "status": "failed", "error": str(e), "modules_done": 0
                            }

            # Store results
            batch_id = None
            if collected:
                batch_id = _store_scan_results(job_id, collected)

            with _scan_lock:
                if _scan_jobs[job_id]["status"] != "cancelled":
                    _scan_jobs[job_id]["status"] = "completed"
                _scan_jobs[job_id]["finished_at"] = _utcnow()
                _scan_jobs[job_id]["batch_id"] = batch_id

        except Exception as e:
            logger.error("Scan job %s failed: %s", job_id, e)
            with _scan_lock:
                _scan_jobs[job_id]["status"] = "error"
                _scan_jobs[job_id]["finished_at"] = _utcnow()


# ═══════════════════════════════════════════════════════════════════════════════
# JOB MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════

def get_scan_status(job_id: str) -> Optional[dict]:
    with _scan_lock:
        job = _scan_jobs.get(job_id)
    return dict(job) if job else None


def cancel_scan(job_id: str) -> dict:
    with _scan_lock:
        job = _scan_jobs.get(job_id)
        if not job:
            return {"error": "Job not found"}
        if job["status"] != "running":
            return {"error": "Job is not running"}
        job["status"] = "cancelled"
    return {"success": True, "message": "Scan cancelled"}


def get_all_scan_jobs() -> List[dict]:
    with _scan_lock:
        return [
            {"job_id": k, "status": v["status"], "total": v["total"],
             "completed": v["completed"], "succeeded": v["succeeded"],
             "failed": v["failed"], "started_at": v["started_at"],
             "finished_at": v.get("finished_at"), "batch_id": v.get("batch_id"),
             "modules": v.get("modules", [])}
            for k, v in _scan_jobs.items()
        ]


# ═══════════════════════════════════════════════════════════════════════════════
# RESULT STORAGE — Same schema as ZIP upload & remote collection
# ═══════════════════════════════════════════════════════════════════════════════

def _store_scan_results(job_id: str, collected: List[dict]) -> Optional[str]:
    """Store scanned server data — deduplicates by hostname (rescan updates existing)."""
    try:
        from services.onprem_service import _classify_server, _conn
        from services.database import upsert_sql

        batch_id = f"scan_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"

        db = _conn()
        try:
            # Ensure tables exist (skip for Azure SQL — schema managed by migrations)
            from services.database import is_azure_sql
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
                        workload_type TEXT DEFAULT '', payload TEXT NOT NULL
                    )
                """)
                db.execute("CREATE INDEX IF NOT EXISTS idx_onprem_host ON onprem_servers (hostname)")
                # Ensure scan history table has correct schema (TEXT id, not INTEGER)
                existing_schema = db.execute(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='onprem_scan_history'"
                ).fetchone()
                if existing_schema and 'id INTEGER' in (existing_schema[0] or ''):
                    db.execute("DROP TABLE onprem_scan_history")
                db.execute("""
                    CREATE TABLE IF NOT EXISTS onprem_scan_history (
                        id TEXT PRIMARY KEY,
                        server_id TEXT NOT NULL, batch_id TEXT NOT NULL,
                        collected_at TEXT NOT NULL, modules_collected INTEGER DEFAULT 0,
                        modules_failed INTEGER DEFAULT 0, duration_sec REAL DEFAULT 0,
                        payload_summary TEXT DEFAULT '{}'
                    )
                """)

            for srv in collected:
                srv["upload_batch_id"] = batch_id
                _classify_server(srv)

                # ── Hostname-based dedup: find existing server ──
                hostname = srv.get("hostname", "").strip()
                from services.database import limit_sql
                existing = db.execute(
                    limit_sql("SELECT server_id, payload FROM onprem_servers WHERE hostname = ?", 1),
                    (hostname,)
                ).fetchone()

                if existing:
                    # Reuse existing server_id — UPDATE the record
                    srv["server_id"] = existing[0]
                    # Merge: old fields preserved, new non-empty fields overwrite
                    try:
                        old_payload = json.loads(existing[1])
                        skip_keys = {"server_id", "scan_count", "first_scanned_at", "last_scanned_at", "upload_batch_id"}
                        for k, v in srv.items():
                            if k in skip_keys:
                                continue
                            if v is not None and v != "" and v != [] and v != {}:
                                old_payload[k] = v
                            elif k not in old_payload:
                                old_payload[k] = v
                        srv.clear()
                        srv.update(old_payload)
                    except Exception:
                        pass
                    srv["scan_count"] = srv.get("scan_count", 0) + 1
                    srv["last_scanned_at"] = _utcnow()
                    srv["first_scanned_at"] = srv.get("first_scanned_at", srv.get("collected_at", _utcnow()))
                else:
                    # New server — assign fresh ID
                    srv["server_id"] = str(uuid.uuid4())
                    srv["scan_count"] = 1
                    srv["first_scanned_at"] = _utcnow()
                    srv["last_scanned_at"] = _utcnow()

            db.execute(
                upsert_sql("onprem_uploads", ["batch_id"],
                           ["uploaded_at", "server_count", "filename", "status", "warnings", "errors"]),
                (batch_id, _utcnow(), len(collected), f"python_scan_{job_id}",
                 "completed", "[]", "[]"),
            )

            for srv in collected:
                db.execute(
                    upsert_sql("onprem_servers", ["server_id"],
                               ["hostname", "batch_id", "collected_at", "workload_type", "payload"]),
                    (srv["server_id"], srv["hostname"], batch_id,
                     srv.get("collected_at", _utcnow()), srv.get("workload_type", ""),
                     json.dumps(srv, default=str)),
                )
                # Save scan history snapshot
                summary = {
                    "modules": srv.get("scan_modules", []),
                    "os": srv.get("os_name", ""),
                    "apps_count": len(srv.get("installed_applications", [])),
                    "services_count": srv.get("total_services", 0),
                }
                mods_failed = srv.get("modules_failed", 0)
                if isinstance(mods_failed, list):
                    mods_failed = len(mods_failed)
                db.execute(
                    "INSERT INTO onprem_scan_history "
                    "(id, server_id, batch_id, collected_at, modules_collected, modules_failed, duration_sec, payload_summary) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (str(uuid.uuid4()), srv["server_id"], batch_id, srv.get("collected_at", _utcnow()),
                     srv.get("modules_collected", 0),
                     mods_failed,
                     srv.get("collection_duration_sec", 0) or 0,
                     json.dumps(summary)),
                )

            db.commit()
            logger.info("Scan results stored: batch=%s, servers=%d", batch_id, len(collected))
            return batch_id
        finally:
            db.close()

    except Exception as e:
        logger.error("Failed to store scan results: %s", e)
        return None


# ═══════════════════════════════════════════════════════════════════════════════
# CREDENTIAL MANAGEMENT — encrypted storage for scan credentials
# ═══════════════════════════════════════════════════════════════════════════════

_CRED_KEY_FILE = Path(__file__).parent.parent / "data" / ".scanner_key"


def _get_fernet():
    """Get or create Fernet encryption key for credential storage."""
    from cryptography.fernet import Fernet

    if _CRED_KEY_FILE.exists():
        key = _CRED_KEY_FILE.read_bytes()
    else:
        key = Fernet.generate_key()
        _CRED_KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
        _CRED_KEY_FILE.write_bytes(key)
        # Restrict permissions on Windows
        try:
            import stat
            os.chmod(str(_CRED_KEY_FILE), stat.S_IRUSR | stat.S_IWUSR)
        except Exception:
            pass
    return Fernet(key)


def save_credential(label: str, username: str, password: str,
                    domain: str = "", auth_type: str = "ntlm",
                    is_default: bool = False) -> str:
    """Save an encrypted scan credential. Returns credential_id."""
    from services.database import get_raw_connection, is_azure_sql

    fernet = _get_fernet()
    cred_id = f"cred_{uuid.uuid4().hex[:12]}"
    encrypted_password = fernet.encrypt(password.encode()).decode()

    conn = get_raw_connection()
    try:
        if not is_azure_sql():
            conn.execute("""
                CREATE TABLE IF NOT EXISTS onprem_credentials (
                    credential_id TEXT PRIMARY KEY,
                    label TEXT NOT NULL,
                    auth_type TEXT DEFAULT 'ntlm',
                    username TEXT NOT NULL,
                    encrypted_password TEXT NOT NULL,
                    domain TEXT DEFAULT '',
                    is_default BOOLEAN DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)

        # If marking as default, unmark all others
        if is_default:
            conn.execute("UPDATE onprem_credentials SET is_default = 0")

        conn.execute(
            "INSERT INTO onprem_credentials (credential_id, label, auth_type, username, encrypted_password, domain, is_default) VALUES (?,?,?,?,?,?,?)",
            (cred_id, label, auth_type, username, encrypted_password, domain, is_default)
        )
        conn.commit()
        return cred_id
    finally:
        conn.close()


def list_credentials() -> List[dict]:
    """List all saved credentials (without secrets)."""
    from services.database import get_raw_connection, is_azure_sql

    conn = get_raw_connection()
    try:
        if not is_azure_sql():
            conn.execute("""
                CREATE TABLE IF NOT EXISTS onprem_credentials (
                    credential_id TEXT PRIMARY KEY,
                    label TEXT NOT NULL,
                    auth_type TEXT DEFAULT 'ntlm',
                    username TEXT NOT NULL,
                    encrypted_password TEXT NOT NULL,
                    domain TEXT DEFAULT '',
                    is_default BOOLEAN DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)
        rows = conn.execute(
            "SELECT credential_id, label, auth_type, username, domain, is_default, created_at FROM onprem_credentials ORDER BY is_default DESC, label"
        ).fetchall()
        return [
            {"credential_id": r[0], "label": r[1], "auth_type": r[2],
             "username": r[3], "domain": r[4], "is_default": bool(r[5]),
             "created_at": r[6]}
            for r in rows
        ]
    finally:
        conn.close()


def get_credential_decrypted(credential_id: str) -> Optional[dict]:
    """Get a credential with decrypted password (internal use only)."""
    from services.database import get_raw_connection

    conn = get_raw_connection()
    try:
        row = conn.execute(
            "SELECT credential_id, label, auth_type, username, encrypted_password, domain FROM onprem_credentials WHERE credential_id = ?",
            (credential_id,)
        ).fetchone()
        if not row:
            return None

        fernet = _get_fernet()
        decrypted_password = fernet.decrypt(row[4].encode()).decode()
        return {
            "credential_id": row[0], "label": row[1], "auth_type": row[2],
            "username": row[3], "password": decrypted_password, "domain": row[5],
        }
    finally:
        conn.close()


def delete_credential(credential_id: str) -> bool:
    """Delete a stored credential."""
    from services.database import get_raw_connection

    conn = get_raw_connection()
    try:
        conn.execute("DELETE FROM onprem_credentials WHERE credential_id = ?", (credential_id,))
        conn.commit()
        return conn.total_changes > 0
    finally:
        conn.close()
