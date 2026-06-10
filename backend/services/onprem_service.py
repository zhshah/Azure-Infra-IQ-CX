"""
On-Premises Data Service — ingestion, storage, retrieval, and classification
of on-premises server inventory collected via PowerShell scripts.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Re-use existing DB path from persistence_service
from services.database import get_raw_connection, upsert_sql, is_azure_sql


def _conn():
    db = get_raw_connection()
    return db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ═══════════════════════════════════════════════════════════════════════════════
# WORKLOAD CLASSIFICATION
# ═══════════════════════════════════════════════════════════════════════════════

def _classify_server(server: dict) -> dict:
    """Auto-classify workload type and migration target based on collected data."""
    sql_instances = server.get("sql_instances", [])
    iis_sites = server.get("iis_sites", [])
    roles = [r.get("name", "").lower() if isinstance(r, dict) else str(r).lower()
             for r in server.get("roles_features", server.get("server_roles", []))]
    services = [s.get("name", "").lower() for s in server.get("running_services", [])]
    features = [f.lower() for f in server.get("windows_features", [])]
    hostname = server.get("hostname", "").lower()
    role_profiles = server.get("role_profiles", [])
    app_cats = server.get("app_categories", {})
    installed_apps = server.get("installed_applications", [])

    workload_type = "General"
    migration_target = "Azure VM"
    migration_candidate = True
    complexity = "Low"
    server_roles_detected = []

    # ── Use role_profiles from enhanced scan if available ──
    if role_profiles:
        profile_map = {
            "web_server": ("Web Server", "App Service", "Medium"),
            "database_server": ("Database Server", "Azure SQL MI", "High"),
            "domain_controller": ("Domain Controller", "Azure AD DS", "High"),
            "file_server": ("File Server", "Azure Files", "Low"),
            "dns_server": ("DNS Server", "Azure VM", "Medium"),
            "dhcp_server": ("DHCP Server", "Azure VM", "Medium"),
            "print_server": ("Print Server", "Azure VM", "Low"),
            "hyper_v_host": ("Hyper-V Host", "Azure VMware Solution", "High"),
            "rdsh_server": ("RDS Server", "Azure Virtual Desktop", "Medium"),
            "certificate_authority": ("Certificate Authority", "Azure VM", "High"),
            "wsus_server": ("WSUS Server", "Azure Update Manager", "Medium"),
            "exchange_server": ("Exchange Server", "Exchange Online", "High"),
            "sharepoint_server": ("SharePoint Server", "SharePoint Online", "High"),
        }
        for rp in role_profiles:
            rp_key = rp.lower().replace(" ", "_").replace("-", "_")
            if rp_key in profile_map:
                wt, mt, cx = profile_map[rp_key]
                server_roles_detected.append(wt)
                if wt != "General":
                    workload_type = wt
                    migration_target = mt
                    complexity = cx

    # ── Fallback to legacy classification ──
    if workload_type == "General":
        # SQL Server
        if sql_instances:
            workload_type = "Database Server"
            migration_target = "Azure SQL MI"
            complexity = "High" if any(
                len(inst.get("databases", [])) > 10 or inst.get("edition", "").lower() == "enterprise"
                for inst in sql_instances
            ) else "Medium"
            server_roles_detected.append("Database Server")

        # IIS / Web Server
        elif iis_sites:
            workload_type = "Web Server"
            migration_target = "App Service"
            complexity = "Medium" if len(iis_sites) > 3 else "Low"
            server_roles_detected.append("Web Server")

        # Domain Controller
        elif "ad-domain-services" in roles or "active directory domain services" in " ".join(roles) or \
             any("ntds" in s for s in services):
            workload_type = "Domain Controller"
            migration_target = "Azure AD DS"
            migration_candidate = False
            complexity = "High"
            server_roles_detected.append("Domain Controller")

        # File Server
        elif "file-services" in roles or "fileserver" in " ".join(roles) or \
             "file and storage services" in " ".join(roles):
            workload_type = "File Server"
            migration_target = "Azure Files"
            complexity = "Low"
            server_roles_detected.append("File Server")

        # DHCP / DNS
        elif "dhcp" in roles or "dns" in roles:
            workload_type = "Infrastructure Server"
            migration_target = "Azure VM"
            complexity = "Medium"
            server_roles_detected.append("Infrastructure Server")

        # Print Server
        elif "print-services" in roles or "print" in " ".join(roles):
            workload_type = "Print Server"
            migration_target = "Azure VM"
            complexity = "Low"
            server_roles_detected.append("Print Server")

        # Hyper-V Host
        elif "hyper-v" in " ".join(roles) or "hyper-v" in " ".join(features):
            workload_type = "Hyper-V Host"
            migration_target = "Azure VMware Solution"
            complexity = "High"
            server_roles_detected.append("Hyper-V Host")

    # ── App-category-based detection ──
    if isinstance(app_cats, dict):
        db_apps = app_cats.get("database", [])
        if isinstance(db_apps, list) and len(db_apps) > 0 and "Database Server" not in server_roles_detected:
            server_roles_detected.append("Database Host")
        web_apps = app_cats.get("web_server", [])
        if isinstance(web_apps, list) and len(web_apps) > 0 and "Web Server" not in server_roles_detected:
            server_roles_detected.append("Web Application Host")

    # Check for clustering → increases complexity
    if server.get("is_clustered"):
        complexity = "High"

    # Multi-role servers are inherently more complex
    if len(server_roles_detected) > 1:
        complexity = "High" if complexity != "High" else complexity

    server["workload_type"] = workload_type
    server["migration_target"] = migration_target
    server["migration_candidate"] = migration_candidate
    server["complexity"] = complexity
    server["server_roles_detected"] = server_roles_detected
    return server


# ═══════════════════════════════════════════════════════════════════════════════
# CSV PARSING — reads the output of our PowerShell collection script
# ═══════════════════════════════════════════════════════════════════════════════

def _parse_csv_safe(content: str) -> List[Dict[str, str]]:
    """Parse CSV content safely, handling encoding issues."""
    try:
        reader = csv.DictReader(io.StringIO(content))
        return [dict(row) for row in reader]
    except Exception as e:
        logger.warning("CSV parse error: %s", e)
        return []


def _safe_int(val, default=0):
    try:
        return int(float(val)) if val else default
    except (ValueError, TypeError):
        return default


def _safe_float(val, default=0.0):
    try:
        return float(val) if val else default
    except (ValueError, TypeError):
        return default


def _safe_bool(val, default=False):
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.lower() in ("true", "yes", "1", "enabled")
    return default


def _parse_server_csv(rows: List[Dict]) -> Dict[str, dict]:
    """Parse the main server inventory CSV into server dicts keyed by hostname."""
    servers = {}
    for row in rows:
        hostname = (row.get("Hostname") or row.get("hostname") or row.get("ComputerName") or "").strip()
        if not hostname:
            continue
        servers[hostname] = {
            "server_id": str(uuid.uuid4()),
            "hostname": hostname,
            "fqdn": row.get("FQDN", row.get("fqdn", "")),
            "domain": row.get("Domain", row.get("domain", "")),
            "manufacturer": row.get("Manufacturer", row.get("manufacturer", "")),
            "model": row.get("Model", row.get("model", "")),
            "serial_number": row.get("SerialNumber", row.get("serial_number", "")),
            "bios_version": row.get("BIOSVersion", row.get("bios_version", "")),
            "total_cores": _safe_int(row.get("TotalCores", row.get("total_cores"))),
            "total_logical_processors": _safe_int(row.get("LogicalProcessors", row.get("total_logical_processors"))),
            "total_memory_gb": _safe_float(row.get("TotalMemoryGB", row.get("total_memory_gb"))),
            "cpu_model": row.get("CPUModel", row.get("cpu_model", "")),
            "cpu_speed_ghz": _safe_float(row.get("CPUSpeedGHz", row.get("cpu_speed_ghz"))),
            "os_name": row.get("OSName", row.get("os_name", "")),
            "os_version": row.get("OSVersion", row.get("os_version", "")),
            "os_build": row.get("OSBuild", row.get("os_build", "")),
            "os_architecture": row.get("OSArchitecture", row.get("os_architecture", "")),
            "install_date": row.get("InstallDate", row.get("install_date", "")),
            "last_boot_time": row.get("LastBootTime", row.get("last_boot_time", "")),
            "uptime_days": _safe_int(row.get("UptimeDays", row.get("uptime_days"))),
            "is_virtual": _safe_bool(row.get("IsVirtual", row.get("is_virtual"))),
            "hypervisor_type": row.get("HypervisorType", row.get("hypervisor_type", "")),
            "vm_host": row.get("VMHost", row.get("vm_host", "")),
            "is_clustered": _safe_bool(row.get("IsClustered", row.get("is_clustered"))),
            "cluster_name": row.get("ClusterName", row.get("cluster_name", "")),
            "firewall_enabled": _safe_bool(row.get("FirewallEnabled", row.get("firewall_enabled"))),
            "antivirus_product": row.get("AntivirusProduct", row.get("antivirus_product", "")),
            "antivirus_status": row.get("AntivirusStatus", row.get("antivirus_status", "")),
            "pending_updates_count": _safe_int(row.get("PendingUpdates", row.get("pending_updates_count"))),
            "last_update_date": row.get("LastUpdateDate", row.get("last_update_date", "")),
            "backup_solution": row.get("BackupSolution", row.get("backup_solution", "")),
            "last_backup_date": row.get("LastBackupDate", row.get("last_backup_date", "")),
            "monitoring_agent": row.get("MonitoringAgent", row.get("monitoring_agent", "")),
            "avg_cpu_pct": _safe_float(row.get("AvgCPU", row.get("avg_cpu_pct"))) or None,
            "avg_memory_pct": _safe_float(row.get("AvgMemory", row.get("avg_memory_pct"))) or None,
            "peak_cpu_pct": _safe_float(row.get("PeakCPU", row.get("peak_cpu_pct"))) or None,
            "peak_memory_pct": _safe_float(row.get("PeakMemory", row.get("peak_memory_pct"))) or None,
            "total_storage_gb": _safe_float(row.get("TotalStorageGB", row.get("total_storage_gb"))),
            "total_free_gb": _safe_float(row.get("TotalFreeGB", row.get("total_free_gb"))),
            "collected_at": row.get("CollectedAt", row.get("collected_at", _now())),
            # Initialize lists
            "ip_addresses": [],
            "mac_addresses": [],
            "disks": [],
            "network_adapters": [],
            "installed_applications": [],
            "running_services": [],
            "stopped_services": [],
            "server_roles": [],
            "windows_features": [],
            "sql_instances": [],
            "iis_sites": [],
            "local_admins": [],
            "open_ports": [],
            "certificates": [],
            "cluster_nodes": [],
            "firewall_profiles": {},
        }
        # Parse comma-separated IPs
        ips = row.get("IPAddresses", row.get("ip_addresses", ""))
        if ips:
            servers[hostname]["ip_addresses"] = [ip.strip() for ip in ips.split(",") if ip.strip()]
        roles = row.get("ServerRoles", row.get("server_roles", ""))
        if roles:
            servers[hostname]["server_roles"] = [r.strip() for r in roles.split(",") if r.strip()]
    return servers


def _enrich_from_csv(servers: Dict[str, dict], csv_name: str, rows: List[Dict]):
    """Enrich server dicts with data from secondary CSVs (disks, apps, services, etc.)."""
    name_lower = csv_name.lower()

    for row in rows:
        hostname = (row.get("Hostname") or row.get("hostname") or row.get("ComputerName") or "").strip()
        if not hostname or hostname not in servers:
            continue
        srv = servers[hostname]

        if "disk" in name_lower or "storage" in name_lower:
            srv["disks"].append({
                "drive_letter": row.get("DriveLetter", row.get("drive_letter", "")),
                "label": row.get("Label", row.get("label", "")),
                "size_gb": _safe_float(row.get("SizeGB", row.get("size_gb"))),
                "free_gb": _safe_float(row.get("FreeGB", row.get("free_gb"))),
                "used_pct": _safe_float(row.get("UsedPct", row.get("used_pct"))),
                "disk_type": row.get("DiskType", row.get("disk_type", "")),
                "filesystem": row.get("FileSystem", row.get("filesystem", "")),
            })

        elif "network" in name_lower or "adapter" in name_lower:
            srv["network_adapters"].append({
                "name": row.get("AdapterName", row.get("name", "")),
                "ip_address": row.get("IPAddress", row.get("ip_address", "")),
                "subnet_mask": row.get("SubnetMask", row.get("subnet_mask", "")),
                "default_gateway": row.get("DefaultGateway", row.get("default_gateway", "")),
                "dns_servers": [d.strip() for d in (row.get("DNSServers", row.get("dns_servers", "")) or "").split(",") if d.strip()],
                "speed_mbps": _safe_int(row.get("SpeedMbps", row.get("speed_mbps"))),
                "mac_address": row.get("MACAddress", row.get("mac_address", "")),
                "status": row.get("Status", row.get("status", "")),
            })

        elif "application" in name_lower or "software" in name_lower:
            srv["installed_applications"].append({
                "name": row.get("Name", row.get("name", "")),
                "version": row.get("Version", row.get("version", "")),
                "publisher": row.get("Publisher", row.get("publisher", "")),
                "install_date": row.get("InstallDate", row.get("install_date", "")),
            })

        elif "service" in name_lower:
            svc_data = {
                "name": row.get("Name", row.get("name", "")),
                "display_name": row.get("DisplayName", row.get("display_name", "")),
                "status": row.get("Status", row.get("status", "")),
                "start_type": row.get("StartType", row.get("start_type", "")),
                "account": row.get("Account", row.get("account", "")),
            }
            if svc_data["status"].lower() == "running":
                srv["running_services"].append(svc_data)
            else:
                srv["stopped_services"].append(svc_data)

        elif "sql" in name_lower and "database" not in name_lower:
            # SQL Instance
            srv["sql_instances"].append({
                "instance_name": row.get("InstanceName", row.get("instance_name", "")),
                "version": row.get("Version", row.get("version", "")),
                "edition": row.get("Edition", row.get("edition", "")),
                "service_pack": row.get("ServicePack", row.get("service_pack", "")),
                "collation": row.get("Collation", row.get("collation", "")),
                "tcp_port": _safe_int(row.get("TCPPort", row.get("tcp_port")), 1433),
                "max_memory_mb": _safe_int(row.get("MaxMemoryMB", row.get("max_memory_mb"))),
                "max_dop": _safe_int(row.get("MaxDOP", row.get("max_dop"))),
                "databases": [],
            })

        elif "sql" in name_lower and "database" in name_lower:
            # SQL Database — append to last instance
            db_data = {
                "name": row.get("DatabaseName", row.get("name", "")),
                "size_mb": _safe_float(row.get("SizeMB", row.get("size_mb"))),
                "recovery_model": row.get("RecoveryModel", row.get("recovery_model", "")),
                "compat_level": _safe_int(row.get("CompatLevel", row.get("compat_level"))),
                "state": row.get("State", row.get("state", "ONLINE")),
                "last_backup": row.get("LastBackup", row.get("last_backup", "")),
            }
            inst_name = row.get("InstanceName", row.get("instance_name", ""))
            for inst in srv["sql_instances"]:
                if inst["instance_name"] == inst_name:
                    inst["databases"].append(db_data)
                    break
            else:
                # Instance not yet seen — create stub
                srv["sql_instances"].append({
                    "instance_name": inst_name,
                    "version": "", "edition": "", "service_pack": "",
                    "collation": "", "tcp_port": 1433, "max_memory_mb": 0, "max_dop": 0,
                    "databases": [db_data],
                })

        elif "iis" in name_lower or "website" in name_lower:
            srv["iis_sites"].append({
                "name": row.get("SiteName", row.get("name", "")),
                "bindings": row.get("Bindings", row.get("bindings", "")),
                "physical_path": row.get("PhysicalPath", row.get("physical_path", "")),
                "state": row.get("State", row.get("state", "")),
                "app_pool": row.get("AppPool", row.get("app_pool", "")),
            })

        elif "certificate" in name_lower or "cert" in name_lower:
            srv["certificates"].append({
                "subject": row.get("Subject", row.get("subject", "")),
                "issuer": row.get("Issuer", row.get("issuer", "")),
                "thumbprint": row.get("Thumbprint", row.get("thumbprint", "")),
                "expiry_date": row.get("ExpiryDate", row.get("expiry_date", "")),
                "store": row.get("Store", row.get("store", "")),
            })


# ═══════════════════════════════════════════════════════════════════════════════
# ZIP INGESTION
# ═══════════════════════════════════════════════════════════════════════════════

def ingest_upload(zip_bytes: bytes, filename: str = "upload.zip") -> dict:
    """
    Extract ZIP, parse all CSVs, classify servers, store in SQLite.
    Returns: { batch_id, server_count, servers: [...], warnings, errors }
    """
    batch_id = f"batch_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    warnings = []
    errors = []
    servers: Dict[str, dict] = {}

    # 1. Extract ZIP
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile:
        return {"batch_id": batch_id, "server_count": 0, "servers": [],
                "warnings": [], "errors": ["Invalid ZIP file"]}

    csv_files = [n for n in zf.namelist() if n.lower().endswith(".csv") and not n.startswith("__MACOSX")]

    if not csv_files:
        return {"batch_id": batch_id, "server_count": 0, "servers": [],
                "warnings": [], "errors": ["No CSV files found in ZIP"]}

    # 2. Find and parse the main server inventory CSV first
    main_csv = None
    for name in csv_files:
        nl = name.lower()
        if "server" in nl and ("inventory" in nl or "main" in nl or "summary" in nl):
            main_csv = name
            break
    if not main_csv:
        # Fallback: pick the first CSV that looks like a server list
        for name in csv_files:
            nl = name.lower()
            if "server" in nl or "host" in nl or "machine" in nl:
                main_csv = name
                break
    if not main_csv:
        # Last resort: use the first CSV
        main_csv = csv_files[0]
        warnings.append(f"No server inventory CSV detected; using '{main_csv}' as primary")

    try:
        content = zf.read(main_csv).decode("utf-8-sig", errors="replace")
        rows = _parse_csv_safe(content)
        servers = _parse_server_csv(rows)
        if not servers:
            errors.append(f"No server records found in '{main_csv}'. Ensure 'Hostname' column exists.")
    except Exception as e:
        errors.append(f"Failed to parse '{main_csv}': {e}")

    # 3. Parse secondary CSVs to enrich server data
    for csv_name in csv_files:
        if csv_name == main_csv:
            continue
        try:
            content = zf.read(csv_name).decode("utf-8-sig", errors="replace")
            rows = _parse_csv_safe(content)
            if rows:
                _enrich_from_csv(servers, csv_name, rows)
        except Exception as e:
            warnings.append(f"Failed to parse '{csv_name}': {e}")

    # 4. Check for JSON manifest
    manifest_files = [n for n in zf.namelist() if n.lower().endswith(".json") and "manifest" in n.lower()]
    if manifest_files:
        try:
            manifest = json.loads(zf.read(manifest_files[0]).decode("utf-8-sig"))
            # Apply manifest metadata
            for srv in servers.values():
                srv["collection_script_version"] = manifest.get("script_version", "")
        except Exception:
            pass

    zf.close()

    # 5. Classify each server
    for hostname in servers:
        servers[hostname] = _classify_server(servers[hostname])
        servers[hostname]["upload_batch_id"] = batch_id

    # 6. Store in SQLite
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

        status = "completed" if not errors else ("partial" if servers else "failed")
        db.execute(
            upsert_sql("onprem_uploads", ["batch_id"], ["uploaded_at", "server_count", "filename", "status", "warnings", "errors"]),
            (batch_id, _now(), len(servers), filename, status, json.dumps(warnings), json.dumps(errors)),
        )

        for srv in servers.values():
            db.execute(
                upsert_sql("onprem_servers", ["server_id"], ["hostname", "batch_id", "collected_at", "workload_type", "payload"]),
                (srv["server_id"], srv["hostname"], batch_id,
                 srv.get("collected_at", _now()), srv.get("workload_type", ""),
                 json.dumps(srv, default=str)),
            )

        db.commit()
    except Exception as e:
        logger.error("Failed to store on-prem data: %s", e)
        errors.append(f"Database error: {e}")
    finally:
        db.close()

    logger.info("On-prem upload complete: batch=%s, servers=%d, warnings=%d, errors=%d",
                batch_id, len(servers), len(warnings), len(errors))

    return {
        "batch_id": batch_id,
        "server_count": len(servers),
        "servers": [{"hostname": s["hostname"], "workload_type": s.get("workload_type", ""),
                      "os_name": s.get("os_name", ""), "migration_target": s.get("migration_target", "")}
                     for s in servers.values()],
        "warnings": warnings,
        "errors": errors,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# RETRIEVAL
# ═══════════════════════════════════════════════════════════════════════════════

def get_inventory_summary() -> dict:
    """Aggregate stats across all on-prem servers."""
    db = _conn()
    try:
        rows = db.execute("SELECT payload FROM onprem_servers").fetchall()
        uploads = db.execute(
            "SELECT batch_id, uploaded_at, server_count, filename, status, warnings, errors "
            "FROM onprem_uploads ORDER BY uploaded_at DESC"
        ).fetchall()
    finally:
        db.close()

    servers = [json.loads(r[0]) for r in rows]

    os_breakdown: Dict[str, int] = {}
    workload_breakdown: Dict[str, int] = {}
    total_cores = 0
    total_memory = 0.0
    total_storage = 0.0
    sql_count = 0
    iis_count = 0
    app_count = 0
    physical = 0
    virtual = 0
    migration_cands = 0
    security_issues = 0

    for s in servers:
        os_name = s.get("os_name", "Unknown")
        # Simplify OS name for grouping
        os_key = os_name
        if "2022" in os_name:
            os_key = "Windows Server 2022"
        elif "2019" in os_name:
            os_key = "Windows Server 2019"
        elif "2016" in os_name:
            os_key = "Windows Server 2016"
        elif "2012" in os_name:
            os_key = "Windows Server 2012"
        elif "Linux" in os_name or "Ubuntu" in os_name or "CentOS" in os_name or "Red Hat" in os_name:
            os_key = os_name.split()[0] if os_name else "Linux"
        os_breakdown[os_key] = os_breakdown.get(os_key, 0) + 1

        wt = s.get("workload_type", "General")
        workload_breakdown[wt] = workload_breakdown.get(wt, 0) + 1

        total_cores += s.get("total_cores", 0) or 0
        total_memory += s.get("total_memory_gb", 0) or 0
        total_storage += s.get("total_storage_gb", 0) or 0
        sql_count += len(s.get("sql_instances", []))
        iis_count += len(s.get("iis_sites", []))
        app_count += len(s.get("installed_applications", []))

        if s.get("is_virtual"):
            virtual += 1
        else:
            physical += 1

        if s.get("migration_candidate"):
            migration_cands += 1

        # Security issues: missing AV, pending updates, firewall off
        issues = 0
        if not s.get("antivirus_product"):
            issues += 1
        if s.get("pending_updates_count", 0) > 10:
            issues += 1
        if not s.get("firewall_enabled"):
            issues += 1
        if issues:
            security_issues += 1

    upload_batches = [{
        "batch_id": u[0], "uploaded_at": u[1], "server_count": u[2],
        "filename": u[3], "status": u[4],
        "warnings": json.loads(u[5]) if u[5] else [],
        "errors": json.loads(u[6]) if u[6] else [],
    } for u in uploads]

    return {
        "total_servers": len(servers),
        "total_cores": total_cores,
        "total_memory_gb": round(total_memory, 1),
        "total_storage_gb": round(total_storage, 1),
        "os_breakdown": os_breakdown,
        "workload_breakdown": workload_breakdown,
        "migration_candidates": migration_cands,
        "physical_servers": physical,
        "virtual_servers": virtual,
        "sql_instances_count": sql_count,
        "iis_sites_count": iis_count,
        "total_applications": app_count,
        "security_issues": security_issues,
        "upload_batches": upload_batches,
        "last_upload": upload_batches[0]["uploaded_at"] if upload_batches else "",
    }


def get_all_servers(batch_id: Optional[str] = None, workload_type: Optional[str] = None) -> List[dict]:
    """Get all servers, optionally filtered by batch or workload type."""
    db = _conn()
    try:
        query = "SELECT payload FROM onprem_servers WHERE 1=1"
        params = []
        if batch_id:
            query += " AND batch_id = ?"
            params.append(batch_id)
        if workload_type:
            query += " AND workload_type = ?"
            params.append(workload_type)
        query += " ORDER BY hostname"
        rows = db.execute(query, params).fetchall()
    finally:
        db.close()
    return [json.loads(r[0]) for r in rows]


def get_server_detail(server_id: str) -> Optional[dict]:
    """Get full server record by ID."""
    db = _conn()
    try:
        row = db.execute("SELECT payload FROM onprem_servers WHERE server_id = ?", (server_id,)).fetchone()
    finally:
        db.close()
    return json.loads(row[0]) if row else None


def get_application_inventory() -> dict:
    """Cross-server application matrix."""
    db = _conn()
    try:
        rows = db.execute("SELECT hostname, payload FROM onprem_servers").fetchall()
    finally:
        db.close()

    app_matrix: Dict[str, List[str]] = {}  # app_name → [hostnames]
    for hostname, payload_str in rows:
        srv = json.loads(payload_str)
        for app in srv.get("installed_applications", []):
            name = app.get("name", "")
            if name:
                app_matrix.setdefault(name, []).append(hostname)

    # Sort by install count
    sorted_apps = sorted(app_matrix.items(), key=lambda x: len(x[1]), reverse=True)
    return {
        "total_unique_apps": len(sorted_apps),
        "applications": [
            {"name": name, "server_count": len(hosts), "servers": hosts}
            for name, hosts in sorted_apps[:200]  # top 200
        ],
    }


def get_migration_candidates() -> List[dict]:
    """Get servers flagged as migration candidates with their recommended targets."""
    db = _conn()
    try:
        rows = db.execute(
            "SELECT payload FROM onprem_servers WHERE workload_type != '' ORDER BY hostname"
        ).fetchall()
    finally:
        db.close()

    candidates = []
    for r in rows:
        srv = json.loads(r[0])
        if srv.get("migration_candidate"):
            candidates.append({
                "server_id": srv.get("server_id"),
                "hostname": srv.get("hostname"),
                "os_name": srv.get("os_name"),
                "workload_type": srv.get("workload_type"),
                "migration_target": srv.get("migration_target"),
                "complexity": srv.get("complexity"),
                "total_cores": srv.get("total_cores"),
                "total_memory_gb": srv.get("total_memory_gb"),
                "total_storage_gb": srv.get("total_storage_gb"),
                "sql_instances": len(srv.get("sql_instances", [])),
                "iis_sites": len(srv.get("iis_sites", [])),
            })
    return candidates


def delete_batch(batch_id: str) -> dict:
    """Delete an upload batch and its server data."""
    db = _conn()
    try:
        count = db.execute("SELECT COUNT(*) FROM onprem_servers WHERE batch_id = ?", (batch_id,)).fetchone()[0]
        db.execute("DELETE FROM onprem_servers WHERE batch_id = ?", (batch_id,))
        db.execute("DELETE FROM onprem_uploads WHERE batch_id = ?", (batch_id,))
        db.commit()
    finally:
        db.close()
    return {"deleted_servers": count, "batch_id": batch_id}


def get_upload_batches() -> List[dict]:
    """List all upload batches."""
    db = _conn()
    try:
        rows = db.execute(
            "SELECT batch_id, uploaded_at, server_count, filename, status, warnings, errors "
            "FROM onprem_uploads ORDER BY uploaded_at DESC"
        ).fetchall()
    finally:
        db.close()
    return [{
        "batch_id": r[0], "uploaded_at": r[1], "server_count": r[2],
        "filename": r[3], "status": r[4],
        "warnings": json.loads(r[5]) if r[5] else [],
        "errors": json.loads(r[6]) if r[6] else [],
    } for r in rows]


# ═══════════════════════════════════════════════════════════════════════════════
# ENHANCED INVENTORY — rich querying with multi-criteria filtering
# ═══════════════════════════════════════════════════════════════════════════════

def get_inventory_filtered(
    workload_type: Optional[str] = None,
    os_filter: Optional[str] = None,
    complexity: Optional[str] = None,
    search: Optional[str] = None,
    has_sql: Optional[bool] = None,
    has_iis: Optional[bool] = None,
    migration_target: Optional[str] = None,
    sort_by: str = "hostname",
    sort_dir: str = "asc",
) -> dict:
    """Advanced server inventory query with multi-criteria filtering."""
    db = _conn()
    try:
        rows = db.execute("SELECT payload FROM onprem_servers ORDER BY hostname").fetchall()
    finally:
        db.close()

    servers = [json.loads(r[0]) for r in rows]
    filtered = []

    for s in servers:
        if workload_type and s.get("workload_type", "").lower() != workload_type.lower():
            continue
        if os_filter and os_filter.lower() not in (s.get("os_name") or "").lower():
            continue
        if complexity and s.get("complexity", "").lower() != complexity.lower():
            continue
        if has_sql is True and not s.get("sql_instances"):
            continue
        if has_sql is False and s.get("sql_instances"):
            continue
        if has_iis is True and not s.get("iis_sites"):
            continue
        if has_iis is False and s.get("iis_sites"):
            continue
        if migration_target and s.get("migration_target", "").lower() != migration_target.lower():
            continue
        if search:
            search_lower = search.lower()
            searchable = " ".join([
                s.get("hostname", ""), s.get("os_name", ""),
                s.get("workload_type", ""), s.get("domain", ""),
                " ".join(a.get("name", "") for a in s.get("installed_applications", [])[:20]),
            ]).lower()
            if search_lower not in searchable:
                continue

        # Build a summary row (lighter than full payload)
        filtered.append({
            "server_id": s.get("server_id"),
            "hostname": s.get("hostname"),
            "os_name": s.get("os_name", ""),
            "os_version": s.get("os_version", ""),
            "workload_type": s.get("workload_type", "General"),
            "migration_target": s.get("migration_target", "Azure VM"),
            "complexity": s.get("complexity", "Low"),
            "total_cores": s.get("total_cores", 0),
            "total_memory_gb": s.get("total_memory_gb", 0),
            "total_storage_gb": s.get("total_storage_gb", 0),
            "is_virtual": s.get("is_virtual", False),
            "domain": s.get("domain", ""),
            "ip_addresses": s.get("ip_addresses", [])[:3],
            "sql_instance_count": len(s.get("sql_instances", [])),
            "iis_site_count": len(s.get("iis_sites", [])),
            "app_count": len(s.get("installed_applications", [])),
            "running_services_count": len(s.get("running_services", [])),
            "server_roles_detected": s.get("server_roles_detected", []),
            "scan_count": s.get("scan_count", 1),
            "last_scanned_at": s.get("last_scanned_at", s.get("collected_at", "")),
            "firewall_enabled": s.get("firewall_enabled", False),
            "antivirus_product": s.get("antivirus_product", ""),
            "pending_updates_count": s.get("pending_updates_count", 0),
            "migration_candidate": s.get("migration_candidate", True),
        })

    # Sort
    reverse = sort_dir.lower() == "desc"
    sort_key = sort_by if sort_by in ("hostname", "os_name", "workload_type",
                                       "complexity", "total_cores", "total_memory_gb",
                                       "total_storage_gb", "app_count") else "hostname"
    filtered.sort(key=lambda x: x.get(sort_key, "") or "", reverse=reverse)

    # Compute facets for filter UI
    all_workloads = set()
    all_os = set()
    all_complexities = set()
    all_targets = set()
    for s in servers:
        all_workloads.add(s.get("workload_type", "General"))
        os_n = s.get("os_name", "")
        if os_n:
            all_os.add(os_n)
        all_complexities.add(s.get("complexity", "Low"))
        all_targets.add(s.get("migration_target", "Azure VM"))

    return {
        "servers": filtered,
        "total": len(filtered),
        "total_unfiltered": len(servers),
        "facets": {
            "workload_types": sorted(all_workloads),
            "os_versions": sorted(all_os),
            "complexities": sorted(all_complexities),
            "migration_targets": sorted(all_targets),
        },
    }


def get_server_scan_history(server_id: str) -> List[dict]:
    """Get scan history for a specific server."""
    db = _conn()
    try:
        rows = db.execute(
            "SELECT batch_id, collected_at, modules_collected, modules_failed, "
            "duration_sec, payload_summary FROM onprem_scan_history "
            "WHERE server_id = ? ORDER BY collected_at DESC",
            (server_id,)
        ).fetchall()
    except Exception:
        return []
    finally:
        db.close()

    return [{
        "batch_id": r[0], "collected_at": r[1],
        "modules_collected": r[2],
        "modules_failed": r[3] if isinstance(r[3], (int, float)) else (json.loads(r[3]) if r[3] else 0),
        "duration_sec": r[4],
        "payload_summary": json.loads(r[5]) if isinstance(r[5], str) and r[5] else (r[5] or {}),
    } for r in rows]


def get_role_summary() -> dict:
    """Aggregate servers by detected roles — for migration planning dashboard."""
    db = _conn()
    try:
        rows = db.execute("SELECT payload FROM onprem_servers").fetchall()
    finally:
        db.close()

    servers = [json.loads(r[0]) for r in rows]

    role_groups = {}
    target_groups = {}
    complexity_groups = {"Low": 0, "Medium": 0, "High": 0}
    frameworks_found = {}
    db_engines_found = {}

    for s in servers:
        wt = s.get("workload_type", "General")
        role_groups.setdefault(wt, []).append(s.get("hostname"))

        mt = s.get("migration_target", "Azure VM")
        target_groups.setdefault(mt, []).append(s.get("hostname"))

        cx = s.get("complexity", "Low")
        complexity_groups[cx] = complexity_groups.get(cx, 0) + 1

        # Collect frameworks
        for fw in s.get("frameworks_runtimes", []):
            fw_name = fw.get("name", "") if isinstance(fw, dict) else str(fw)
            if fw_name:
                frameworks_found.setdefault(fw_name, 0)
                frameworks_found[fw_name] += 1

        # Collect DB engines
        for inst in s.get("sql_instances", []):
            edition = inst.get("edition", "")
            version = inst.get("version", "")
            key = f"SQL Server {edition} {version}".strip()
            db_engines_found.setdefault(key, 0)
            db_engines_found[key] += 1
        for dbi in s.get("database_deep", []):
            eng = dbi.get("engine", "")
            if eng:
                db_engines_found.setdefault(eng, 0)
                db_engines_found[eng] += 1

    return {
        "role_groups": {k: {"count": len(v), "servers": v} for k, v in role_groups.items()},
        "target_groups": {k: {"count": len(v), "servers": v} for k, v in target_groups.items()},
        "complexity_breakdown": complexity_groups,
        "frameworks": sorted(frameworks_found.items(), key=lambda x: x[1], reverse=True),
        "database_engines": sorted(db_engines_found.items(), key=lambda x: x[1], reverse=True),
    }


def generate_onprem_security_findings() -> List[dict]:
    """Generate security findings from on-prem server data for the security module."""
    db = _conn()
    try:
        rows = db.execute("SELECT payload FROM onprem_servers").fetchall()
    finally:
        db.close()

    findings = []
    for r in rows:
        srv = json.loads(r[0])
        hostname = srv.get("hostname", "unknown")
        server_id = srv.get("server_id", "")

        # 1. Firewall disabled
        if not srv.get("firewall_enabled"):
            findings.append({
                "source": "onprem-scan",
                "severity": "high",
                "title": f"Windows Firewall disabled on {hostname}",
                "description": f"Windows Firewall is not enabled on {hostname}. This exposes the server to network-level attacks.",
                "category": "Network Security",
                "resource_id": server_id,
                "resource_name": hostname,
                "resource_type": "On-Premises Server",
                "remediation": "Enable Windows Firewall via Group Policy or local configuration. Configure inbound rules for required services only.",
                "threats": "lateral-movement,network-attack",
                "implementation_effort": "Low",
                "monthly_risk_usd": 50,
            })

        # 2. No antivirus
        if not srv.get("antivirus_product"):
            findings.append({
                "source": "onprem-scan",
                "severity": "critical",
                "title": f"No antivirus protection on {hostname}",
                "description": f"No antivirus/EDR product detected on {hostname}. The server is vulnerable to malware and ransomware.",
                "category": "Endpoint Protection",
                "resource_id": server_id,
                "resource_name": hostname,
                "resource_type": "On-Premises Server",
                "remediation": "Deploy Microsoft Defender for Endpoint or equivalent EDR solution. Enable real-time scanning and cloud-delivered protection.",
                "threats": "malware,ransomware",
                "implementation_effort": "Medium",
                "monthly_risk_usd": 200,
            })

        # 3. Excessive pending updates
        pending = srv.get("pending_updates_count", 0) or 0
        if pending > 10:
            findings.append({
                "source": "onprem-scan",
                "severity": "high",
                "title": f"{pending} pending updates on {hostname}",
                "description": f"{hostname} has {pending} pending Windows updates. Unpatched systems are primary targets for exploitation.",
                "category": "Patch Management",
                "resource_id": server_id,
                "resource_name": hostname,
                "resource_type": "On-Premises Server",
                "remediation": "Schedule maintenance window and apply all pending updates. Configure WSUS or Azure Update Management for automated patching.",
                "threats": "vulnerability-exploitation,zero-day",
                "implementation_effort": "Medium",
                "monthly_risk_usd": 100,
            })

        # 4. No backup solution
        if not srv.get("backup_solution"):
            findings.append({
                "source": "onprem-scan",
                "severity": "medium",
                "title": f"No backup solution detected on {hostname}",
                "description": f"No backup agent or solution detected on {hostname}. Data loss risk from ransomware, hardware failure, or accidental deletion.",
                "category": "Data Protection",
                "resource_id": server_id,
                "resource_name": hostname,
                "resource_type": "On-Premises Server",
                "remediation": "Deploy Azure Backup agent or equivalent backup solution. Implement 3-2-1 backup strategy.",
                "threats": "data-loss,ransomware-recovery",
                "implementation_effort": "Medium",
                "monthly_risk_usd": 150,
            })

        # 5. Weak password policy
        pw = srv.get("password_policy", {})
        if isinstance(pw, dict):
            min_len = pw.get("minimum_password_length", 0) or 0
            if isinstance(min_len, (int, float)) and min_len < 8:
                findings.append({
                    "source": "onprem-scan",
                    "severity": "high",
                    "title": f"Weak password policy on {hostname} (min length: {min_len})",
                    "description": f"Password policy on {hostname} requires only {min_len} characters. NIST recommends minimum 8 characters.",
                    "category": "Identity & Access",
                    "resource_id": server_id,
                    "resource_name": hostname,
                    "resource_type": "On-Premises Server",
                    "remediation": "Update Group Policy to require minimum 12-character passwords. Enable complexity requirements and account lockout.",
                    "threats": "brute-force,credential-theft",
                    "implementation_effort": "Low",
                    "monthly_risk_usd": 75,
                })

        # 6. SSL/TLS certificates expiring soon
        for cert in srv.get("certificates", []):
            expiry = cert.get("expiry_date") or cert.get("not_after", "")
            if expiry:
                try:
                    from datetime import datetime, timezone
                    exp_dt = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
                    days_left = (exp_dt - datetime.now(timezone.utc)).days
                    if days_left < 30:
                        findings.append({
                            "source": "onprem-scan",
                            "severity": "medium" if days_left > 0 else "critical",
                            "title": f"Certificate expiring in {days_left} days on {hostname}",
                            "description": f"Certificate '{cert.get('subject', '')}' on {hostname} expires in {days_left} days.",
                            "category": "Certificate Management",
                            "resource_id": server_id,
                            "resource_name": hostname,
                            "resource_type": "On-Premises Server",
                            "remediation": "Renew the certificate before expiry. Consider Azure Key Vault for centralized certificate management.",
                            "threats": "service-disruption,man-in-the-middle",
                            "implementation_effort": "Low",
                            "monthly_risk_usd": 50,
                        })
                except Exception:
                    pass

        # 7. Open high-risk ports
        high_risk_ports = {3389: "RDP", 23: "Telnet", 21: "FTP", 445: "SMB", 1433: "SQL Server"}
        for conn_info in srv.get("network_connections", []):
            port = conn_info.get("local_port") or conn_info.get("port")
            if isinstance(port, (int, float)) and int(port) in high_risk_ports:
                svc_name = high_risk_ports[int(port)]
                findings.append({
                    "source": "onprem-scan",
                    "severity": "medium",
                    "title": f"{svc_name} port {int(port)} open on {hostname}",
                    "description": f"High-risk port {int(port)} ({svc_name}) is listening on {hostname}.",
                    "category": "Network Security",
                    "resource_id": server_id,
                    "resource_name": hostname,
                    "resource_type": "On-Premises Server",
                    "remediation": f"Restrict {svc_name} access via firewall rules. Use VPN/bastion for remote access instead of direct exposure.",
                    "threats": "unauthorized-access,lateral-movement",
                    "implementation_effort": "Low",
                    "monthly_risk_usd": 30,
                })
                break  # Only report once per server for open ports

        # 8. Old OS version
        os_name = (srv.get("os_name") or "").lower()
        if any(old in os_name for old in ["2008", "2003", "windows 7", "windows xp"]):
            findings.append({
                "source": "onprem-scan",
                "severity": "critical",
                "title": f"End-of-life OS on {hostname}",
                "description": f"{hostname} is running {srv.get('os_name')}, which is no longer supported with security updates.",
                "category": "Lifecycle Management",
                "resource_id": server_id,
                "resource_name": hostname,
                "resource_type": "On-Premises Server",
                "remediation": "Plan immediate migration to a supported OS. Consider Azure Extended Security Updates (ESU) as interim protection.",
                "threats": "unpatched-vulnerabilities,compliance-violation",
                "implementation_effort": "High",
                "monthly_risk_usd": 300,
            })

    return findings


def get_onprem_ai_context() -> dict:
    """Build comprehensive on-prem context for AI assessment analysis."""
    db = _conn()
    try:
        rows = db.execute("SELECT payload FROM onprem_servers").fetchall()
    finally:
        db.close()

    servers = [json.loads(r[0]) for r in rows]
    if not servers:
        return {}

    # Build a concise summary for AI consumption
    server_summaries = []
    for s in servers:
        summary = {
            "hostname": s.get("hostname"),
            "os": s.get("os_name", ""),
            "workload_type": s.get("workload_type", "General"),
            "migration_target": s.get("migration_target", "Azure VM"),
            "complexity": s.get("complexity", "Low"),
            "cores": s.get("total_cores", 0),
            "memory_gb": s.get("total_memory_gb", 0),
            "storage_gb": s.get("total_storage_gb", 0),
            "is_virtual": s.get("is_virtual", False),
            "sql_instances": len(s.get("sql_instances", [])),
            "iis_sites": len(s.get("iis_sites", [])),
            "app_count": len(s.get("installed_applications", [])),
            "server_roles": s.get("server_roles_detected", []),
            "firewall_enabled": s.get("firewall_enabled", False),
            "antivirus": s.get("antivirus_product", ""),
            "pending_updates": s.get("pending_updates_count", 0),
            "frameworks": [f.get("name", "") if isinstance(f, dict) else str(f)
                           for f in s.get("frameworks_runtimes", [])],
        }
        server_summaries.append(summary)

    # Summary statistics
    total_cores = sum(s.get("cores", 0) for s in server_summaries)
    total_mem = sum(s.get("memory_gb", 0) for s in server_summaries)
    total_storage = sum(s.get("storage_gb", 0) for s in server_summaries)

    return {
        "total_servers": len(server_summaries),
        "total_cores": total_cores,
        "total_memory_gb": round(total_mem, 1),
        "total_storage_gb": round(total_storage, 1),
        "servers": server_summaries,
    }
