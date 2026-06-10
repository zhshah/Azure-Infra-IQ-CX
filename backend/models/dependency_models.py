"""
Dependency graph data models for Azure Infrastructure Intelligence Platform.

Represents resources as nodes and their relationships as edges in a directed graph.
Supports blast-radius analysis, cluster detection, and single-point-of-failure identification.
"""
from __future__ import annotations

from enum import Enum
from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class RelationshipType(str, Enum):
    PARENT_OF       = "parent_of"        # e.g. SQL Server → Database
    ATTACHED_TO     = "attached_to"      # e.g. Disk → VM, NIC → VM
    ROUTES_TO       = "routes_to"        # e.g. LB → Backend VMs
    CONSUMES        = "consumes"         # e.g. Web App → SQL DB (connection string)
    PROTECTS        = "protects"         # e.g. Backup Vault → VM
    REPLICATES_TO   = "replicates_to"    # e.g. SQL Primary → Geo Replica
    AUTHENTICATES   = "authenticates"    # e.g. Managed Identity → Key Vault
    PEERS_WITH      = "peers_with"       # e.g. VNet peering (bidirectional)
    CONTAINS        = "contains"         # e.g. VNet → Subnet, Subnet → NIC
    MONITORS        = "monitors"         # e.g. App Insights → Web App
    HOSTS           = "hosts"            # e.g. App Service Plan → Web App
    SECURES         = "secures"          # e.g. NSG → Subnet/NIC
    CONNECTS_VIA    = "connects_via"     # e.g. VM → Private Endpoint → Storage


class EdgeDirection(str, Enum):
    UPSTREAM      = "upstream"       # source depends on target
    DOWNSTREAM    = "downstream"     # target depends on source
    BIDIRECTIONAL = "bidirectional"  # mutual (e.g. VNet peering)


class EdgeStrength(str, Enum):
    HARD     = "hard"      # removal breaks functionality
    SOFT     = "soft"      # degraded but functional
    INFERRED = "inferred"  # guessed from naming/tags


class DiscoveryMethod(str, Enum):
    API             = "api"              # Azure REST/SDK
    RESOURCE_GRAPH  = "resource_graph"   # ARG KQL query
    PROPERTY_PARSE  = "property_parse"   # parsed from resource properties
    AI_INFERRED     = "ai_inferred"      # Claude suggestion


class DependencyEdge(BaseModel):
    source_id:         str
    target_id:         str
    relationship_type: RelationshipType
    direction:         EdgeDirection = EdgeDirection.DOWNSTREAM
    strength:          EdgeStrength = EdgeStrength.HARD
    discovered_by:     DiscoveryMethod = DiscoveryMethod.API
    label:             Optional[str] = None  # human-readable description


class DependencyNode(BaseModel):
    resource_id:    str
    resource_type:  str
    name:           str
    resource_group: str
    location:       str
    subscription_id: str = ""
    sku:            Optional[str] = None
    tags:           Dict[str, str] = Field(default_factory=dict)
    cost_monthly:   float = 0.0
    # Graph metrics (populated by analysis)
    in_degree:      int = 0   # how many depend on this
    out_degree:     int = 0   # how many this depends on


class DependencyCluster(BaseModel):
    id:                    str
    name:                  str
    resources:             List[str] = Field(default_factory=list)  # resource IDs
    resource_count:        int = 0
    is_island:             bool = False   # single isolated resource
    cross_region:          bool = False   # spans multiple regions
    regions:               List[str] = Field(default_factory=list)
    resource_types:        List[str] = Field(default_factory=list)
    total_monthly_cost:    float = 0.0
    suggested_workload_name: Optional[str] = None


class BlastRadius(BaseModel):
    resource_id:           str
    resource_name:         str
    directly_affected:     List[str] = Field(default_factory=list)
    transitively_affected: List[str] = Field(default_factory=list)
    affected_count:        int = 0
    estimated_cost_impact: float = 0.0


class SPOFResource(BaseModel):
    resource_id:      str
    resource_name:    str
    resource_type:    str
    dependents_count: int = 0
    reason:           str = ""


class DependencyGraph(BaseModel):
    nodes:    List[DependencyNode]    = Field(default_factory=list)
    edges:    List[DependencyEdge]    = Field(default_factory=list)
    clusters: List[DependencyCluster] = Field(default_factory=list)
    spof:     List[SPOFResource]      = Field(default_factory=list)
    node_count: int = 0
    edge_count: int = 0
    cluster_count: int = 0


class DependencyGraphSummary(BaseModel):
    node_count:    int = 0
    edge_count:    int = 0
    cluster_count: int = 0
    spof_count:    int = 0
    island_count:  int = 0
    cross_region_clusters: int = 0
    relationship_breakdown: Dict[str, int] = Field(default_factory=dict)
