"""
BCDR Metadata Service - Phase 1 Planning

Manages user-defined BCDR categorizations for resources.
Users categorize resources on the Resources page with:
- Criticality (Critical/High/Medium/Low)
- DR Tier (Tier 0/1/2/3)
- RTO Target (< 1 hr / < 4 hrs / < 8 hrs / < 24 hrs / Best Effort)
- RPO Target (< 15 min / < 1 hr / < 4 hrs / < 24 hrs / Best Effort)
- Business Function (e.g., "Production API", "Analytics", "Dev/Test")
- Notes (free text)

This metadata is:
1. Saved to SQLite database
2. Used by AI during BCDR analysis for better recommendations
3. Displayed in affected resources lists
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from services.database import get_raw_connection, is_azure_sql

logger = logging.getLogger(__name__)


# ── Database ──────────────────────────────────────────────────────────────────

def _conn():
    """Get database connection and ensure tables exist."""
    db = get_raw_connection()
    if not is_azure_sql():
        db.execute("""
            CREATE TABLE IF NOT EXISTS resource_bcdr_metadata (
                resource_id         TEXT PRIMARY KEY,
                criticality         TEXT,
                dr_tier             TEXT,
                rto_target          TEXT,
                rpo_target          TEXT,
                business_function   TEXT,
                notes               TEXT,
                created_at          TEXT NOT NULL,
                updated_at          TEXT NOT NULL
            )
        """)
        db.commit()
    return db


# ── CRUD Operations ───────────────────────────────────────────────────────────

def get_bcdr_metadata(resource_id: str) -> Optional[dict]:
    """Get BCDR metadata for a single resource."""
    db = _conn()
    try:
        row = db.execute(
            "SELECT * FROM resource_bcdr_metadata WHERE resource_id = ?",
            (resource_id,)
        ).fetchone()
        
        if not row:
            return None
        
        return {
            "resource_id": row[0],
            "criticality": row[1],
            "dr_tier": row[2],
            "rto_target": row[3],
            "rpo_target": row[4],
            "business_function": row[5],
            "notes": row[6],
            "created_at": row[7],
            "updated_at": row[8]
        }
    finally:
        db.close()


def get_all_bcdr_metadata() -> Dict[str, dict]:
    """Get all BCDR metadata as dict keyed by resource_id."""
    db = _conn()
    try:
        rows = db.execute("SELECT * FROM resource_bcdr_metadata").fetchall()
        
        metadata = {}
        for row in rows:
            metadata[row[0]] = {
                "resource_id": row[0],
                "criticality": row[1],
                "dr_tier": row[2],
                "rto_target": row[3],
                "rpo_target": row[4],
                "business_function": row[5],
                "notes": row[6],
                "created_at": row[7],
                "updated_at": row[8]
            }
        
        return metadata
    finally:
        db.close()


def save_bcdr_metadata(resource_id: str, metadata: dict) -> dict:
    """
    Save or update BCDR metadata for a resource.
    
    Args:
        resource_id: Azure resource ID
        metadata: Dict with keys: criticality, dr_tier, rto_target, rpo_target, business_function, notes
    
    Returns:
        Saved metadata dict
    """
    db = _conn()
    try:
        now = datetime.now(timezone.utc).isoformat()
        
        # Check if exists
        exists = db.execute(
            "SELECT 1 FROM resource_bcdr_metadata WHERE resource_id = ?",
            (resource_id,)
        ).fetchone()
        
        if exists:
            # Update
            db.execute("""
                UPDATE resource_bcdr_metadata
                SET criticality = ?,
                    dr_tier = ?,
                    rto_target = ?,
                    rpo_target = ?,
                    business_function = ?,
                    notes = ?,
                    updated_at = ?
                WHERE resource_id = ?
            """, (
                metadata.get("criticality"),
                metadata.get("dr_tier"),
                metadata.get("rto_target"),
                metadata.get("rpo_target"),
                metadata.get("business_function"),
                metadata.get("notes"),
                now,
                resource_id
            ))
        else:
            # Insert
            db.execute("""
                INSERT INTO resource_bcdr_metadata (
                    resource_id, criticality, dr_tier, rto_target, rpo_target,
                    business_function, notes, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                resource_id,
                metadata.get("criticality"),
                metadata.get("dr_tier"),
                metadata.get("rto_target"),
                metadata.get("rpo_target"),
                metadata.get("business_function"),
                metadata.get("notes"),
                now,
                now
            ))
        
        db.commit()
        
        logger.info(f"Saved BCDR metadata for {resource_id}: {metadata.get('criticality')} / {metadata.get('dr_tier')}")
        
        return get_bcdr_metadata(resource_id)
    
    finally:
        db.close()


def bulk_save_bcdr_metadata(updates: List[Dict[str, Any]]) -> int:
    """
    Bulk save BCDR metadata for multiple resources.
    
    Args:
        updates: List of dicts with 'resource_id' and metadata fields
    
    Returns:
        Number of resources updated
    """
    count = 0
    for item in updates:
        resource_id = item.get("resource_id")
        if not resource_id:
            continue
        
        save_bcdr_metadata(resource_id, item)
        count += 1
    
    return count


def delete_bcdr_metadata(resource_id: str) -> bool:
    """Delete BCDR metadata for a resource."""
    db = _conn()
    try:
        db.execute("DELETE FROM resource_bcdr_metadata WHERE resource_id = ?", (resource_id,))
        db.commit()
        logger.info(f"Deleted BCDR metadata for {resource_id}")
        return True
    finally:
        db.close()


# ── Enrichment ────────────────────────────────────────────────────────────────

def enrich_resources_with_bcdr_metadata(resources: List[dict]) -> List[dict]:
    """
    Enrich resource list with BCDR metadata.
    Adds bcdr_metadata field to each resource.
    """
    metadata_map = get_all_bcdr_metadata()
    
    for resource in resources:
        resource_id = resource.get("resource_id")
        if resource_id and resource_id in metadata_map:
            resource["bcdr_metadata"] = metadata_map[resource_id]
        else:
            resource["bcdr_metadata"] = None
    
    return resources


# ── Statistics ────────────────────────────────────────────────────────────────

def get_bcdr_metadata_stats() -> dict:
    """Get statistics about BCDR metadata coverage."""
    db = _conn()
    try:
        total = db.execute("SELECT COUNT(*) FROM resource_bcdr_metadata").fetchone()[0]
        
        criticality_counts = {}
        for row in db.execute("SELECT criticality, COUNT(*) FROM resource_bcdr_metadata WHERE criticality IS NOT NULL GROUP BY criticality").fetchall():
            criticality_counts[row[0]] = row[1]
        
        dr_tier_counts = {}
        for row in db.execute("SELECT dr_tier, COUNT(*) FROM resource_bcdr_metadata WHERE dr_tier IS NOT NULL GROUP BY dr_tier").fetchall():
            dr_tier_counts[row[0]] = row[1]
        
        return {
            "total_resources_with_metadata": total,
            "by_criticality": criticality_counts,
            "by_dr_tier": dr_tier_counts
        }
    finally:
        db.close()
