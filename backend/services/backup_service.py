"""
backup_service.py — Comprehensive Azure Backup Coverage Analysis.

Analyses the ResourceMetrics list (which already has has_backup flags
stamped from Azure Recovery Services Vault queries during the scan) to
identify backup gaps across ALL Azure resource types that support backup.

Categories covered:
  Vault-required (explicit enrolment needed):
    • Virtual Machines
    • SQL Server in Azure VM          (workload-level backup)
    • AKS Clusters
    • Azure File Shares               (storage account detected)
    • Azure Storage Blobs             (storage account detected)

  Auto-protected (built-in backup; flag for retention / LTR review):
    • Azure SQL Database              (PITR 7–35 days; Basic = 7 days only)
    • Azure SQL Managed Instance      (PITR + optional LTR)
    • Azure Database for PostgreSQL   (PITR + optional vaulted backup)
    • Azure Database for MySQL        (PITR + optional vaulted backup)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List

from models.schemas import (
    ResourceMetrics,
    BackupGap,
    BackupCategoryStats,
    BackupCoverage,
)

logger = logging.getLogger(__name__)

# ── Category metadata ─────────────────────────────────────────────────────────

CATEGORY_META: dict[str, dict] = {
    "vm": {
        "name": "Virtual Machines",
        "icon": "🖥️",
        "protection_type": "vault",
        "severity": "critical",
        "gap_type": "no_backup",
        "backup_solution": "Azure VM Backup (Recovery Services Vault)",
        "description_tpl": (
            '"{name}" is a Virtual Machine with no Azure Backup policy. '
            "Disk corruption, accidental deletion, ransomware, or OS failure would "
            "cause permanent, unrecoverable data loss."
        ),
        "recommendation": (
            "Enroll in a Recovery Services Vault backup policy with daily backup frequency "
            "and a minimum 30-day retention for production workloads. "
            "Use application-consistent snapshots for VMs running databases."
        ),
        "az_link": "https://learn.microsoft.com/azure/backup/backup-azure-vms-introduction",
    },
    "sql_in_vm": {
        "name": "SQL Server in Azure VM",
        "icon": "🗄️",
        "protection_type": "vault",
        "severity": "high",
        "gap_type": "no_backup",
        "backup_solution": "Azure Backup for SQL Server in Azure VM",
        "description_tpl": (
            '"{name}" appears to be running SQL Server on an Azure VM. '
            "Azure VM-level backup protects raw disks, but individual database "
            "backup (log-level RPO of 15 minutes) requires SQL workload backup."
        ),
        "recommendation": (
            "Enable Azure Backup for SQL in Azure VM through the Recovery Services Vault. "
            "This provides transaction-log backup every 15 minutes (RPO), granular "
            "database-level restore, and protection against database corruption."
        ),
        "az_link": "https://learn.microsoft.com/azure/backup/backup-sql-server-database-azure-vms",
    },
    "aks": {
        "name": "AKS Clusters",
        "icon": "☸️",
        "protection_type": "vault",
        "severity": "high",
        "gap_type": "no_backup",
        "backup_solution": "AKS Backup (Backup Vault + Backup Extension)",
        "description_tpl": (
            '"{name}" AKS cluster has no backup. Cluster misconfiguration, '
            "namespace deletion, or persistent volume corruption requires full "
            "redeployment without a backup solution."
        ),
        "recommendation": (
            "Install the Azure Backup Extension on the AKS cluster and configure "
            "a Backup Vault policy. Back up cluster configuration, namespaces, "
            "and persistent volumes with an appropriate schedule and retention."
        ),
        "az_link": "https://learn.microsoft.com/azure/backup/azure-kubernetes-service-backup-overview",
    },
    "storage": {
        "name": "Azure Storage (Files & Blobs)",
        "icon": "💾",
        "protection_type": "vault",
        "severity": "high",
        "gap_type": "no_backup",
        "backup_solution": "Azure Backup for Azure Files + Azure Backup for Blobs",
        "description_tpl": (
            '"{name}" storage account has no backup policy. File shares and '
            "blobs are unprotected against accidental deletion, ransomware, "
            "or data corruption. The 30-day soft-delete window alone is insufficient."
        ),
        "recommendation": (
            "Enable Azure Backup for Azure Files (file shares) in a Recovery Services Vault. "
            "For blobs, enable operational backup (Azure Backup for Blobs) and configure "
            "blob versioning and soft-delete (min 30 days) as a layered defence."
        ),
        "az_link": "https://learn.microsoft.com/azure/backup/blob-backup-overview",
    },
    "sql_db": {
        "name": "Azure SQL Database",
        "icon": "📊",
        "protection_type": "auto",
        "severity": "medium",
        "gap_type": "short_retention",
        "backup_solution": "Extended PITR Retention + Long-Term Retention (LTR)",
        "description_tpl": (
            '"{name}" SQL Database ({sku}) has automatic PITR backup, '
            "but the default retention on this tier is only 7 days — "
            "insufficient for most compliance frameworks (GDPR, ISO 27001, PCI-DSS)."
        ),
        "recommendation": (
            "Increase retention to 28–35 days by upgrading to Standard (S2+) or "
            "General Purpose tier. Configure Long-Term Retention (weekly/monthly/yearly "
            "snapshots, up to 10 years) for databases under compliance obligations."
        ),
        "az_link": "https://learn.microsoft.com/azure/azure-sql/database/long-term-retention-overview",
    },
    "sql_mi": {
        "name": "SQL Managed Instance",
        "icon": "🏛️",
        "protection_type": "auto",
        "severity": "low",
        "gap_type": "ltr_recommended",
        "backup_solution": "SQL MI Long-Term Retention (LTR)",
        "description_tpl": (
            '"{name}" SQL Managed Instance has automatic PITR backup (7–35 days). '
            "For compliance workloads, Long-Term Retention (up to 10 years) "
            "should be explicitly configured."
        ),
        "recommendation": (
            "Configure an LTR policy on the SQL Managed Instance to meet compliance "
            "requirements (GDPR, ISO 27001, PCI-DSS, HIPAA). "
            "Use weekly/monthly/yearly snapshot schedule as required."
        ),
        "az_link": "https://learn.microsoft.com/azure/azure-sql/managed-instance/long-term-backup-retention-configure",
    },
    "postgresql": {
        "name": "PostgreSQL Databases",
        "icon": "🐘",
        "protection_type": "auto",
        "severity": "low",
        "gap_type": "ltr_recommended",
        "backup_solution": "Azure Backup for PostgreSQL (Vaulted Backup)",
        "description_tpl": (
            '"{name}" PostgreSQL server has automatic backups (1–35 days PITR). '
            "For retention beyond 35 days or cross-region restore capability, "
            "Azure Backup for PostgreSQL provides vaulted backup."
        ),
        "recommendation": (
            "Configure Azure Backup for PostgreSQL to extend retention up to 10 years "
            "and enable geo-redundant recovery. Use a Backup Vault policy with "
            "appropriate weekly/monthly schedule."
        ),
        "az_link": "https://learn.microsoft.com/azure/backup/backup-azure-database-postgresql-overview",
    },
    "mysql": {
        "name": "MySQL Databases",
        "icon": "🐬",
        "protection_type": "auto",
        "severity": "low",
        "gap_type": "ltr_recommended",
        "backup_solution": "Azure Backup for MySQL Flexible Server",
        "description_tpl": (
            '"{name}" MySQL server has automatic backups (1–35 days PITR). '
            "For compliance or cross-region recovery, Azure Backup for MySQL "
            "Flexible Server provides additional vaulted protection."
        ),
        "recommendation": (
            "Configure Azure Backup for MySQL Flexible Server for vaulted backup "
            "with up to 10-year retention and geo-redundant recovery. "
            "Align retention with business continuity requirements."
        ),
        "az_link": "https://learn.microsoft.com/azure/backup/backup-azure-mysql-flexible-server-about",
    },
}

# ── SQL in VM heuristics ──────────────────────────────────────────────────────

_SQL_VM_SKU_TERMS  = ("sql2019", "sql2022", "sql2017", "sql2016", "sqlenterprise", "sqlstandard", "sqldeveloper")
_SQL_VM_NAME_TERMS = ("sqlsrv", "mssql", "-sql-", "_sql_")
# Looser name check: whole-word "sql" in resource name
_SQL_VM_NAME_WHOLE = "sql"


def _is_sql_vm(r: ResourceMetrics) -> bool:
    sku  = (r.sku or "").lower()
    name = (r.resource_name or "").lower()
    return (
        any(t in sku  for t in _SQL_VM_SKU_TERMS)
        or any(t in name for t in _SQL_VM_NAME_TERMS)
        or name.startswith("sql")
    )


# ── SQL tier short-retention detection ───────────────────────────────────────

_SHORT_RETENTION_TERMS = ("basic", "/s0", "/s1", "_s0", "_s1", "s0", "s1")


def _has_short_sql_retention(sku: str | None) -> bool:
    if not sku:
        return False
    s = sku.lower().strip()
    return s in ("basic", "s0", "s1") or any(s.startswith(t) for t in ("basic", "s0", "s1"))


# ── Main analysis function ────────────────────────────────────────────────────

_SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}

_SQL_DB_SYSTEM   = frozenset(("master", "tempdb", "model", "msdb"))
_SQL_MI_SYSTEM   = frozenset(("master", "tempdb", "model", "msdb"))


def _sub_from_rid(resource_id: str) -> str:
    parts = resource_id.split("/")
    try:
        idx = next(i for i, p in enumerate(parts) if p.lower() == "subscriptions")
        return parts[idx + 1]
    except (StopIteration, IndexError):
        return ""


def _make_gap(
    r: ResourceMetrics,
    cat_key: str,
    *,
    override_description: str = "",
    override_category: str = "",
    override_icon: str = "",
    override_severity: str = "",
) -> BackupGap:
    meta = CATEGORY_META[cat_key]
    desc = override_description or meta["description_tpl"].format(
        name=r.resource_name,
        sku=r.sku or "unknown tier",
    )
    return BackupGap(
        resource_id=r.resource_id,
        resource_name=r.resource_name,
        resource_type=r.resource_type,
        resource_group=r.resource_group,
        subscription_id=r.subscription_id or _sub_from_rid(r.resource_id),
        backup_category=override_category or meta["name"],
        backup_category_key=cat_key,
        icon=override_icon or meta["icon"],
        severity=override_severity or meta["severity"],
        gap_type=meta["gap_type"],
        backup_solution=meta["backup_solution"],
        description=desc,
        recommendation=meta["recommendation"],
        az_link=meta["az_link"],
        estimated_monthly_cost=r.cost_current_month,
    )


def analyze_backup_coverage(resources: List[ResourceMetrics]) -> BackupCoverage:
    """
    Analyse the resource list and return a comprehensive BackupCoverage object.

    Rules per resource type
    ───────────────────────
    VMs                    → Critical gap if has_backup=False
    SQL in VM (heuristic)  → High gap if has_backup=False; Low informational if VM-only backup
    AKS                    → High gap if has_backup=False
    Storage accounts       → High gap if has_backup=False (covers files + blobs)
    SQL Databases          → Medium gap if Basic/S0/S1 tier (7-day retention); else informational
    SQL Managed Instance   → Low informational (LTR review)
    PostgreSQL / MySQL     → Low informational (LTR review)
    """
    gaps:      list[BackupGap] = []
    cat_stats: dict[str, dict] = {}   # cat_key → {eligible, protected, gap_count}

    def _stats(key: str) -> dict:
        if key not in cat_stats:
            cat_stats[key] = {"eligible": 0, "protected": 0, "gap_count": 0}
        return cat_stats[key]

    for r in resources:
        rtype = (r.resource_type or "").lower()

        # ── 1. Virtual Machines ───────────────────────────────────────────────
        if rtype == "microsoft.compute/virtualmachines":
            is_sql = _is_sql_vm(r)
            cat_key = "sql_in_vm" if is_sql else "vm"
            st = _stats(cat_key)
            st["eligible"] += 1

            if not r.has_backup:
                # No vault protection at all
                st["gap_count"] += 1
                gaps.append(_make_gap(r, cat_key))
            else:
                if is_sql:
                    # VM-level backup exists — workload backup would give better RPO
                    # Add as low-severity informational
                    st["gap_count"] += 1
                    gaps.append(_make_gap(
                        r, "sql_in_vm",
                        override_severity="low",
                        override_description=(
                            f'"{r.resource_name}" appears to run SQL Server and is protected '
                            "by Azure VM Backup (disk-level). Workload-level SQL backup provides "
                            "transaction-log backup every 15 minutes for near-zero RPO."
                        ),
                    ))
                else:
                    st["protected"] += 1

        # ── 2. AKS Clusters ───────────────────────────────────────────────────
        elif rtype == "microsoft.containerservice/managedclusters":
            st = _stats("aks")
            st["eligible"] += 1
            if not r.has_backup:
                st["gap_count"] += 1
                gaps.append(_make_gap(r, "aks"))
            else:
                st["protected"] += 1

        # ── 3. Storage Accounts ───────────────────────────────────────────────
        elif rtype == "microsoft.storage/storageaccounts":
            st = _stats("storage")
            st["eligible"] += 1
            if not r.has_backup:
                st["gap_count"] += 1
                gaps.append(_make_gap(r, "storage"))
            else:
                st["protected"] += 1

        # ── 4. Azure SQL Database ─────────────────────────────────────────────
        elif rtype == "microsoft.sql/servers/databases":
            # Skip system databases and replicas
            if r.resource_name.lower() in _SQL_DB_SYSTEM:
                continue
            if r.is_sql_replica:
                continue
            st = _stats("sql_db")
            st["eligible"] += 1
            if _has_short_sql_retention(r.sku):
                # Only 7-day retention → medium severity gap
                st["gap_count"] += 1
                gaps.append(_make_gap(r, "sql_db"))
            else:
                # Adequate auto-backup for STR; show as LTR informational
                st["gap_count"] += 1
                gaps.append(_make_gap(
                    r, "sql_db",
                    override_severity="low",
                    override_description=(
                        f'"{r.resource_name}" SQL Database has automatic PITR backup. '
                        "No Long-Term Retention (LTR) policy has been detected. "
                        "LTR is required for compliance frameworks (GDPR, PCI-DSS, ISO 27001)."
                    ),
                ))

        # ── 5. SQL Managed Instance ───────────────────────────────────────────
        elif rtype in (
            "microsoft.sql/managedinstances",
            "microsoft.sql/managedinstances/databases",
        ):
            if r.resource_name.lower() in _SQL_MI_SYSTEM:
                continue
            st = _stats("sql_mi")
            st["eligible"] += 1
            st["gap_count"] += 1
            gaps.append(_make_gap(r, "sql_mi"))

        # ── 6. Azure Database for PostgreSQL ──────────────────────────────────
        elif rtype in (
            "microsoft.dbforpostgresql/servers",
            "microsoft.dbforpostgresql/flexibleservers",
        ):
            st = _stats("postgresql")
            st["eligible"] += 1
            st["gap_count"] += 1
            gaps.append(_make_gap(r, "postgresql"))

        # ── 7. Azure Database for MySQL ───────────────────────────────────────
        elif rtype in (
            "microsoft.dbformysql/servers",
            "microsoft.dbformysql/flexibleservers",
        ):
            st = _stats("mysql")
            st["eligible"] += 1
            st["gap_count"] += 1
            gaps.append(_make_gap(r, "mysql"))

    # ── Build BackupCategoryStats list ────────────────────────────────────────
    category_list: list[BackupCategoryStats] = []
    for key, st in cat_stats.items():
        meta      = CATEGORY_META.get(key, {})
        eligible  = st["eligible"]
        protected = st["protected"]
        gaps_n    = st["gap_count"]
        cov_pct   = round((protected / eligible * 100) if eligible > 0 else 0.0, 1)
        category_list.append(
            BackupCategoryStats(
                category=meta.get("name", key),
                category_key=key,
                icon=meta.get("icon", "📦"),
                eligible=eligible,
                protected=protected,
                gaps=gaps_n,
                coverage_pct=cov_pct,
                gap_type=meta.get("gap_type", "no_backup"),
                protection_type=meta.get("protection_type", "vault"),
            )
        )
    category_list.sort(key=lambda c: (c.gaps, c.eligible), reverse=True)

    # ── Sort gaps: Critical → High → Medium → Low, then by cost desc ─────────
    gaps.sort(
        key=lambda g: (
            _SEVERITY_ORDER.get(g.severity, 4),
            -(g.estimated_monthly_cost or 0),
        )
    )

    # ── Overall summary ───────────────────────────────────────────────────────
    total_eligible  = sum(s["eligible"]  for s in cat_stats.values())
    total_protected = sum(s["protected"] for s in cat_stats.values())
    total_gaps_n    = len(gaps)

    crit  = sum(1 for g in gaps if g.severity == "critical")
    high  = sum(1 for g in gaps if g.severity == "high")
    med   = sum(1 for g in gaps if g.severity == "medium")
    low   = sum(1 for g in gaps if g.severity == "low")

    coverage_pct = round(
        (total_protected / total_eligible * 100) if total_eligible > 0 else 100.0,
        1,
    )

    logger.info(
        "Backup coverage analysis: %d eligible, %d protected, %d gaps "
        "(%d critical, %d high, %d medium, %d low)",
        total_eligible, total_protected, total_gaps_n, crit, high, med, low,
    )

    return BackupCoverage(
        total_eligible=total_eligible,
        total_protected=total_protected,
        total_gaps=total_gaps_n,
        coverage_pct=coverage_pct,
        categories=category_list,
        critical_gaps=crit,
        high_gaps=high,
        medium_gaps=med,
        low_gaps=low,
        gaps=gaps,
        generated_at=datetime.now(tz=timezone.utc).isoformat(),
    )
