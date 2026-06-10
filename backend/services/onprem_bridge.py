"""
On-Premises Resource Bridge
=============================
Transforms on-prem server data into formats consumed by other modules:
- BCDR: backup coverage, DR readiness, RPO/RTO estimation
- Security: gap analysis (firewall, AV, updates, certificates)
- Migration: Azure sizing, compatibility assessment
- AI Analysis: cross-platform context (Azure + on-prem combined)

This bridge is the single source of truth for cross-module on-prem data.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN BRIDGE — Get unified on-prem data
# ═══════════════════════════════════════════════════════════════════════════════

def get_all_servers() -> List[dict]:
    """Get all on-prem servers from DB with parsed payloads."""
    try:
        from services.onprem_service import _conn
        db = _conn()
        rows = db.execute(
            "SELECT server_id, hostname, batch_id, collected_at, workload_type, payload FROM onprem_servers"
        ).fetchall()
        db.close()

        servers = []
        for row in rows:
            payload = json.loads(row[5]) if row[5] else {}
            payload["server_id"] = row[0]
            payload["hostname"] = row[1]
            payload["batch_id"] = row[2]
            payload["collected_at"] = row[3]
            payload["workload_type"] = row[4]
            servers.append(payload)
        return servers
    except Exception as e:
        logger.error("Failed to get servers from DB: %s", e)
        return []


def get_server_count() -> int:
    """Quick count of on-prem servers."""
    try:
        from services.onprem_service import _conn
        db = _conn()
        count = db.execute("SELECT COUNT(*) FROM onprem_servers").fetchone()[0]
        db.close()
        return count
    except Exception:
        return 0


# ═══════════════════════════════════════════════════════════════════════════════
# BCDR MODULE BRIDGE
# ═══════════════════════════════════════════════════════════════════════════════

def get_bcdr_assessment() -> dict:
    """
    Generate BCDR assessment data for on-prem servers.
    Returns backup coverage, DR readiness, and recommendations.
    """
    servers = get_all_servers()
    if not servers:
        return {"total_servers": 0, "assessed": 0, "gaps": [], "summary": {}}

    gaps = []
    backup_configured = 0
    clustered = 0
    critical_workloads = 0

    for srv in servers:
        hostname = srv.get("hostname", "Unknown")
        workload = srv.get("workload_type", "")

        # Classify criticality
        is_critical = workload in ("sql_server", "domain_controller", "exchange", "iis_web")
        if is_critical:
            critical_workloads += 1

        # Check backup indicators
        has_backup = _detect_backup_agent(srv)
        if has_backup:
            backup_configured += 1
        else:
            severity = "critical" if is_critical else "high"
            gaps.append({
                "server": hostname,
                "gap_type": "no_backup",
                "severity": severity,
                "description": f"No backup agent detected on {hostname} ({workload or 'general'})",
                "recommendation": "Deploy Azure Backup agent (MARS) or configure Azure Site Recovery",
            })

        # Check clustering / HA
        if srv.get("is_clustered"):
            clustered += 1
        elif is_critical:
            gaps.append({
                "server": hostname,
                "gap_type": "no_ha",
                "severity": "high",
                "description": f"Critical workload '{workload}' on {hostname} has no clustering/HA",
                "recommendation": "Consider Windows Server Failover Clustering or Azure Site Recovery for DR",
            })

        # Check if server is too old for modern backup
        os_name = srv.get("os_name", "")
        if "2008" in os_name or "2003" in os_name:
            gaps.append({
                "server": hostname,
                "gap_type": "eol_os",
                "severity": "critical",
                "description": f"{hostname} runs {os_name} (end-of-life) — limited DR options",
                "recommendation": "Migrate to supported OS or use Azure Site Recovery with extended support",
            })

        # Event log errors indicating reliability issues (new from scanner)
        for evt in (srv.get("event_log_summary") or []):
            if evt.get("level") == "Critical" and evt.get("count", 0) >= 5:
                gaps.append({
                    "server": hostname,
                    "gap_type": "critical_events",
                    "severity": "high",
                    "description": f"{hostname}: {evt.get('count')} critical events from '{evt.get('source')}' in last 7 days",
                    "recommendation": "Investigate critical events to prevent potential outage — review event logs for root cause",
                })

        # File shares without backup (new from scanner)
        shares = srv.get("file_shares") or []
        if shares and not has_backup:
            total_share_gb = sum(s.get("size_gb", 0) for s in shares)
            if total_share_gb > 10:
                gaps.append({
                    "server": hostname,
                    "gap_type": "unprotected_shares",
                    "severity": "high",
                    "description": f"{hostname}: {len(shares)} file shares ({total_share_gb:.0f} GB) with no backup agent",
                    "recommendation": "Configure Azure Backup for file shares or replicate to Azure Files",
                })

    summary = {
        "total_servers": len(servers),
        "backup_configured": backup_configured,
        "backup_coverage_pct": round(backup_configured / len(servers) * 100, 1) if servers else 0,
        "clustered": clustered,
        "critical_workloads": critical_workloads,
        "critical_without_backup": sum(1 for g in gaps if g["gap_type"] == "no_backup" and g["severity"] == "critical"),
        "gap_count": len(gaps),
    }

    return {
        "total_servers": len(servers),
        "assessed": len(servers),
        "gaps": gaps,
        "summary": summary,
    }


def _detect_backup_agent(srv: dict) -> bool:
    """Detect backup software from services/applications/backup_agents."""
    # Direct detection from scanner
    if srv.get("backup_solution"):
        return True
    for agent in (srv.get("backup_agents") or []):
        if agent.get("installed"):
            return True

    backup_indicators = [
        "veeam", "backup", "mars", "dpm", "commvault", "arcserve",
        "acronis", "carbonite", "azure recovery", "obengine",
        "vssvc", "wbengine", "spp agent",
    ]
    # Check running services
    for svc in (srv.get("running_services") or []):
        name = (svc.get("name", "") + " " + svc.get("display_name", "")).lower()
        if any(ind in name for ind in backup_indicators):
            return True
    # Check installed apps
    for app in (srv.get("installed_applications") or []):
        name = (app.get("name", "") + " " + app.get("publisher", "")).lower()
        if any(ind in name for ind in backup_indicators):
            return True
    return False


# ═══════════════════════════════════════════════════════════════════════════════
# SECURITY MODULE BRIDGE
# ═══════════════════════════════════════════════════════════════════════════════

def get_security_assessment() -> dict:
    """
    Generate security gap assessment for on-prem servers.
    Returns gaps with severity and remediation recommendations.
    """
    servers = get_all_servers()
    if not servers:
        return {"total_servers": 0, "gaps": [], "summary": {}}

    gaps = []

    for srv in servers:
        hostname = srv.get("hostname", "Unknown")

        # Firewall check
        if srv.get("firewall_enabled") is False:
            gaps.append({
                "server": hostname,
                "gap_type": "firewall_disabled",
                "severity": "critical",
                "description": f"Windows Firewall is disabled on {hostname}",
                "recommendation": "Enable Windows Firewall on all profiles or deploy network-level firewall",
            })

        # Antivirus check
        av_status = srv.get("antivirus_status", "")
        av_product = srv.get("antivirus_product", "")
        if not av_product or av_status == "Disabled":
            gaps.append({
                "server": hostname,
                "gap_type": "no_antivirus",
                "severity": "critical",
                "description": f"No active antivirus on {hostname}" + (f" ({av_product} is {av_status})" if av_product else ""),
                "recommendation": "Enable Windows Defender or deploy enterprise AV (Defender for Endpoint recommended)",
            })

        # Pending updates
        pending = srv.get("pending_updates_count", -1)
        if pending > 20:
            gaps.append({
                "server": hostname,
                "gap_type": "many_pending_updates",
                "severity": "high",
                "description": f"{hostname} has {pending} pending Windows updates",
                "recommendation": "Apply pending updates. Consider Azure Update Manager for patch orchestration",
            })
        elif pending > 5:
            gaps.append({
                "server": hostname,
                "gap_type": "pending_updates",
                "severity": "medium",
                "description": f"{hostname} has {pending} pending Windows updates",
                "recommendation": "Schedule maintenance window for patching",
            })

        # Certificate expiry
        now = datetime.now(timezone.utc)
        for cert in (srv.get("certificates") or []):
            expiry_str = cert.get("expiry_date", "")
            if expiry_str:
                try:
                    expiry = datetime.strptime(expiry_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                    days_until = (expiry - now).days
                    if days_until < 0:
                        gaps.append({
                            "server": hostname,
                            "gap_type": "expired_certificate",
                            "severity": "critical",
                            "description": f"Expired certificate on {hostname}: {cert.get('subject', 'Unknown')} (expired {abs(days_until)} days ago)",
                            "recommendation": "Renew or remove expired certificate immediately",
                        })
                    elif days_until < 30:
                        gaps.append({
                            "server": hostname,
                            "gap_type": "expiring_certificate",
                            "severity": "high",
                            "description": f"Certificate expiring soon on {hostname}: {cert.get('subject', 'Unknown')} ({days_until} days)",
                            "recommendation": "Plan certificate renewal before expiry",
                        })
                except (ValueError, TypeError):
                    pass

        # OS end-of-life
        os_name = srv.get("os_name", "")
        if any(eol in os_name for eol in ["2003", "2008", "2012"]):
            gaps.append({
                "server": hostname,
                "gap_type": "eol_os",
                "severity": "critical" if "2003" in os_name or "2008" in os_name else "high",
                "description": f"{hostname} runs {os_name} (end-of-support or approaching end-of-support)",
                "recommendation": "Plan OS upgrade or migration to Azure with Extended Security Updates (ESU)",
            })

        # Hotfix analysis (new from scanner)
        hotfixes = srv.get("hotfixes") or []
        if hotfixes:
            # Check last hotfix date
            dates = [h.get("installed_on", "") for h in hotfixes if h.get("installed_on")]
            if dates:
                latest = max(dates)
                try:
                    last_patch = datetime.strptime(latest, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                    days_since = (datetime.now(timezone.utc) - last_patch).days
                    if days_since > 90:
                        gaps.append({
                            "server": hostname,
                            "gap_type": "stale_patches",
                            "severity": "high",
                            "description": f"{hostname}: Last hotfix ({latest}) is {days_since} days old — may be missing critical patches",
                            "recommendation": "Review and apply missing security updates via WSUS or Azure Update Manager",
                        })
                except (ValueError, TypeError):
                    pass

        # Open high-risk ports (new from scanner)
        open_ports = srv.get("open_ports") or []
        risky_ports = set(open_ports) & {21, 23, 135, 445, 3389, 1433, 3306, 5432}
        if risky_ports:
            gaps.append({
                "server": hostname,
                "gap_type": "risky_open_ports",
                "severity": "medium",
                "description": f"{hostname}: High-risk ports open: {', '.join(str(p) for p in sorted(risky_ports))}",
                "recommendation": "Review firewall rules. Close unnecessary ports or restrict via NSG if migrating to Azure",
            })

    summary = {
        "total_servers": len(servers),
        "total_gaps": len(gaps),
        "critical_gaps": sum(1 for g in gaps if g["severity"] == "critical"),
        "high_gaps": sum(1 for g in gaps if g["severity"] == "high"),
        "medium_gaps": sum(1 for g in gaps if g["severity"] == "medium"),
        "gap_types": {},
    }
    for g in gaps:
        t = g["gap_type"]
        summary["gap_types"][t] = summary["gap_types"].get(t, 0) + 1

    return {"total_servers": len(servers), "gaps": gaps, "summary": summary}


# ═══════════════════════════════════════════════════════════════════════════════
# MIGRATION MODULE BRIDGE
# ═══════════════════════════════════════════════════════════════════════════════

def get_migration_readiness() -> dict:
    """
    Assess migration readiness for all on-prem servers.
    Provides Azure sizing recommendations and compatibility flags.
    """
    servers = get_all_servers()
    if not servers:
        return {"total_servers": 0, "candidates": [], "summary": {}}

    candidates = []
    for srv in servers:
        hostname = srv.get("hostname", "Unknown")
        memory_gb = srv.get("total_memory_gb", 0)
        cores = srv.get("total_cores", 0) or srv.get("total_logical_processors", 0)
        workload = srv.get("workload_type", "general")
        os_name = srv.get("os_name", "")

        # Determine migration strategy
        strategy = _determine_migration_strategy(srv)

        # Azure VM sizing recommendation
        azure_size = _recommend_azure_size(cores, memory_gb, workload)

        # Compatibility check
        blockers = []
        if "2003" in os_name:
            blockers.append("Windows Server 2003 not supported in Azure IaaS")
        if srv.get("is_clustered") and not srv.get("cluster_name"):
            blockers.append("Cluster dependency detected — needs shared storage planning")

        # File share sizing (new from scanner)
        shares = srv.get("file_shares") or []
        total_share_gb = sum(s.get("size_gb", 0) for s in shares)

        candidates.append({
            "server": hostname,
            "workload_type": workload,
            "os": os_name,
            "cores": cores,
            "memory_gb": memory_gb,
            "storage_gb": srv.get("total_storage_gb", 0),
            "file_shares_count": len(shares),
            "file_shares_gb": round(total_share_gb, 1),
            "strategy": strategy,
            "azure_vm_size": azure_size,
            "blockers": blockers,
            "ready": len(blockers) == 0,
            "is_virtual": srv.get("is_virtual", False),
            "hypervisor": srv.get("hypervisor_type", ""),
        })

    summary = {
        "total_servers": len(servers),
        "ready_count": sum(1 for c in candidates if c["ready"]),
        "blocked_count": sum(1 for c in candidates if not c["ready"]),
        "strategies": {},
    }
    for c in candidates:
        s = c["strategy"]
        summary["strategies"][s] = summary["strategies"].get(s, 0) + 1

    return {"total_servers": len(servers), "candidates": candidates, "summary": summary}


def _determine_migration_strategy(srv: dict) -> str:
    """Determine recommended migration strategy (rehost/replatform/refactor)."""
    workload = srv.get("workload_type", "")
    os_name = srv.get("os_name", "")

    if workload == "sql_server":
        return "replatform"  # Azure SQL / SQL MI
    if workload == "iis_web":
        return "replatform"  # App Service / Container Apps
    if workload == "file_server":
        return "replatform"  # Azure Files
    if workload == "exchange":
        return "refactor"    # Exchange Online
    if workload == "rds":
        return "replatform"  # Azure Virtual Desktop
    if "2008" in os_name or "2003" in os_name:
        return "rehost"  # Lift-and-shift with ESU
    if srv.get("is_virtual"):
        return "rehost"  # VM → Azure VM
    return "rehost"


def _recommend_azure_size(cores: int, memory_gb: float, workload: str) -> str:
    """Simple Azure VM size recommendation based on specs."""
    if not cores or not memory_gb:
        return "Standard_D2s_v5"  # Default small

    # SQL workloads → memory-optimized
    if workload == "sql_server":
        if memory_gb > 128:
            return "Standard_E64s_v5"
        elif memory_gb > 64:
            return "Standard_E32s_v5"
        elif memory_gb > 32:
            return "Standard_E16s_v5"
        else:
            return "Standard_E4s_v5"

    # General workloads → balanced
    if cores <= 2 and memory_gb <= 8:
        return "Standard_D2s_v5"
    elif cores <= 4 and memory_gb <= 16:
        return "Standard_D4s_v5"
    elif cores <= 8 and memory_gb <= 32:
        return "Standard_D8s_v5"
    elif cores <= 16 and memory_gb <= 64:
        return "Standard_D16s_v5"
    else:
        return "Standard_D32s_v5"


# ═══════════════════════════════════════════════════════════════════════════════
# AI CONTEXT BUILDER — Combined Azure + On-Prem context for AI analysis
# ═══════════════════════════════════════════════════════════════════════════════

def get_ai_context() -> dict:
    """
    Build a combined context object for AI analysis prompts.
    Merges on-prem data with Azure resource data for cross-platform insights.
    """
    servers = get_all_servers()
    if not servers:
        return {"has_onprem": False}

    # Summarize for AI (don't send full payloads — too large)
    server_summary = []
    total_cores = 0
    total_memory = 0
    total_storage = 0
    workload_counts = {}
    os_counts = {}

    for srv in servers:
        cores = srv.get("total_cores", 0) or srv.get("total_logical_processors", 0)
        mem = srv.get("total_memory_gb", 0)
        stor = srv.get("total_storage_gb", 0)
        total_cores += cores
        total_memory += mem
        total_storage += stor

        wl = srv.get("workload_type", "general")
        workload_counts[wl] = workload_counts.get(wl, 0) + 1

        os_name = srv.get("os_name", "Unknown")
        os_key = os_name.split("Server")[-1].strip() if "Server" in os_name else os_name
        os_counts[os_key] = os_counts.get(os_key, 0) + 1

        server_summary.append({
            "hostname": srv.get("hostname"),
            "os": os_name,
            "workload": wl,
            "cores": cores,
            "memory_gb": mem,
            "storage_gb": stor,
            "is_virtual": srv.get("is_virtual", False),
        })

    bcdr = get_bcdr_assessment()
    security = get_security_assessment()

    return {
        "has_onprem": True,
        "server_count": len(servers),
        "total_cores": total_cores,
        "total_memory_gb": round(total_memory, 1),
        "total_storage_gb": round(total_storage, 1),
        "workload_distribution": workload_counts,
        "os_distribution": os_counts,
        "servers": server_summary,
        "bcdr_summary": bcdr.get("summary", {}),
        "security_summary": security.get("summary", {}),
        "migration_ready": sum(1 for s in servers if s.get("workload_type") != ""),
    }
