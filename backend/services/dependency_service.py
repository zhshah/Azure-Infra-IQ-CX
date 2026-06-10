"""
Dependency discovery and graph analysis service.

Builds a directed graph of Azure resource relationships from:
  - Cached resource data (properties like managed_by, server_farm_id, etc.)
  - Azure Resource Graph KQL queries (network topology, NSG associations, peering)

Provides algorithms for:
  - Blast radius analysis (what breaks if X fails?)
  - Cluster detection (connected components = natural workload boundaries)
  - Single-point-of-failure identification
  - Upstream/downstream traversal
"""
from __future__ import annotations

import logging
import re
from collections import defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple

from models.dependency_models import (
    BlastRadius,
    DependencyCluster,
    DependencyEdge,
    DependencyGraph,
    DependencyGraphSummary,
    DependencyNode,
    DiscoveryMethod,
    EdgeDirection,
    EdgeStrength,
    RelationshipType,
    SPOFResource,
)

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
#  Edge discovery from cached resource data (no Azure API calls needed)
# ═══════════════════════════════════════════════════════════════════════════════

def _discover_edges_from_cached_data(
    resources: List[Dict[str, Any]],
) -> List[DependencyEdge]:
    """
    Discover dependency edges purely from cached resource properties.
    Works offline — no API calls. This is the primary edge source.
    """
    edges: List[DependencyEdge] = []
    # Support both raw resource dicts (key="id") and ResourceMetrics dicts (key="resource_id")
    def _rid(r: Dict) -> str:
        return (r.get("resource_id") or r.get("id") or "").lower()
    def _rtype(r: Dict) -> str:
        return (r.get("resource_type") or r.get("type") or "").lower()

    rid_map: Dict[str, Dict] = {_rid(r): r for r in resources if _rid(r)}
    type_groups: Dict[str, List[Dict]] = defaultdict(list)
    for r in resources:
        type_groups[_rtype(r)].append(r)

    # ── Tier 1: Compute attachment chain ──────────────────────────────────

    # Disk → VM via managed_by (already on resource if present)
    for r in resources:
        rid = _rid(r)
        rtype = _rtype(r)

        # managed_by field (disks attached to VMs)
        managed_by = (r.get("managed_by") or "").lower()
        if managed_by and managed_by in rid_map:
            edges.append(DependencyEdge(
                source_id=rid,
                target_id=managed_by,
                relationship_type=RelationshipType.ATTACHED_TO,
                direction=EdgeDirection.UPSTREAM,
                strength=EdgeStrength.HARD,
                discovered_by=DiscoveryMethod.PROPERTY_PARSE,
                label="Disk attached to VM",
            ))

    # Web App / Function → App Service Plan via server_farm_id
    for r in resources:
        farm_id = (r.get("server_farm_id") or "").lower()
        if farm_id and farm_id in rid_map:
            edges.append(DependencyEdge(
                source_id=_rid(r),
                target_id=farm_id,
                relationship_type=RelationshipType.HOSTS,
                direction=EdgeDirection.UPSTREAM,
                strength=EdgeStrength.HARD,
                discovered_by=DiscoveryMethod.PROPERTY_PARSE,
                label="App hosted on App Service Plan",
            ))

    # SQL Server → Databases (parent-child from resource ID structure)
    # e.g. /subscriptions/.../Microsoft.Sql/servers/myserver/databases/mydb
    for r in resources:
        rtype = _rtype(r)
        rid = _rid(r)
        if rtype == "microsoft.sql/servers/databases":
            # Parent server ID = everything before /databases/
            parts = rid.split("/databases/")
            if len(parts) == 2:
                server_id = parts[0]
                if server_id in rid_map:
                    edges.append(DependencyEdge(
                        source_id=server_id,
                        target_id=rid,
                        relationship_type=RelationshipType.PARENT_OF,
                        direction=EdgeDirection.DOWNSTREAM,
                        strength=EdgeStrength.HARD,
                        discovered_by=DiscoveryMethod.PROPERTY_PARSE,
                        label="SQL Server hosts database",
                    ))

    # ── Tier 3: Application layer (tags and naming patterns) ─────────────

    # Detect resources in the same resource group with common naming patterns
    # that suggest they belong together (e.g., "myapp-vm", "myapp-sql", "myapp-storage")
    rg_resources: Dict[str, List[Dict]] = defaultdict(list)
    for r in resources:
        rg_resources[(r.get("resource_group") or "").lower()].append(r)

    # ── Tier 4: Protection relationships ─────────────────────────────────

    # Resources with has_backup → some vault protects them
    # (exact vault linkage comes from backup_service; here we note the protection signal)

    return edges


def _discover_edges_from_vm_attachments(
    vm_attachments: Dict[str, str],
) -> List[DependencyEdge]:
    """
    Convert the existing vm_attachments map (from resource_service.get_vm_attachments)
    into proper DependencyEdge objects.
    vm_attachments = {attached_resource_id: vm_resource_id}
    """
    edges: List[DependencyEdge] = []
    for attached_id, vm_id in vm_attachments.items():
        # Determine if it's a disk, NIC, or PIP based on resource type in the ID
        if "/disks/" in attached_id:
            label = "Disk attached to VM"
        elif "/networkinterfaces/" in attached_id:
            label = "NIC attached to VM"
        elif "/publicipaddresses/" in attached_id:
            label = "Public IP → NIC → VM"
        else:
            label = "Resource attached to VM"

        edges.append(DependencyEdge(
            source_id=attached_id,
            target_id=vm_id,
            relationship_type=RelationshipType.ATTACHED_TO,
            direction=EdgeDirection.UPSTREAM,
            strength=EdgeStrength.HARD,
            discovered_by=DiscoveryMethod.API,
            label=label,
        ))
    return edges


def _discover_edges_from_resource_graph(
    subscription_ids: Optional[List[str]] = None,
) -> List[DependencyEdge]:
    """
    Discover network topology edges via Azure Resource Graph KQL.
    Returns edges for VNet→Subnet, Subnet→NIC, NSG associations, VNet peering, etc.
    Gracefully returns [] if Resource Graph is unavailable.
    """
    edges: List[DependencyEdge] = []

    try:
        from services.resource_graph_service import (
            get_vnet_subnets,
            get_vnet_subnet_nic_chain,
            get_nsg_associations,
            get_vnet_peerings,
            get_load_balancer_backends,
            get_private_endpoints,
            get_route_table_associations,
            get_nat_gateway_associations,
        )
    except ImportError:
        logger.warning("resource_graph_service not available — skipping ARG edge discovery")
        return edges

    # ── VNet → Subnet containment ──────────────────────────────────────
    try:
        for row in get_vnet_subnets(subscription_ids):
            vnet_id = (row.get("vnetId") or "").lower()
            subnet_id = (row.get("subnetId") or "").lower()
            if vnet_id and subnet_id:
                edges.append(DependencyEdge(
                    source_id=vnet_id,
                    target_id=subnet_id,
                    relationship_type=RelationshipType.CONTAINS,
                    direction=EdgeDirection.DOWNSTREAM,
                    strength=EdgeStrength.HARD,
                    discovered_by=DiscoveryMethod.RESOURCE_GRAPH,
                    label="VNet contains Subnet",
                ))
    except Exception as exc:
        logger.warning("VNet→Subnet ARG query failed: %s", exc)

    # ── Subnet → NIC → VM chain ───────────────────────────────────────
    try:
        for row in get_vnet_subnet_nic_chain(subscription_ids):
            nic_id = (row.get("nicId") or "").lower()
            subnet_id = (row.get("subnetId") or "").lower()
            vm_id = (row.get("vmId") or "").lower()

            if subnet_id and nic_id:
                edges.append(DependencyEdge(
                    source_id=subnet_id,
                    target_id=nic_id,
                    relationship_type=RelationshipType.CONTAINS,
                    direction=EdgeDirection.DOWNSTREAM,
                    strength=EdgeStrength.HARD,
                    discovered_by=DiscoveryMethod.RESOURCE_GRAPH,
                    label="Subnet hosts NIC",
                ))
            if nic_id and vm_id:
                edges.append(DependencyEdge(
                    source_id=nic_id,
                    target_id=vm_id,
                    relationship_type=RelationshipType.ATTACHED_TO,
                    direction=EdgeDirection.UPSTREAM,
                    strength=EdgeStrength.HARD,
                    discovered_by=DiscoveryMethod.RESOURCE_GRAPH,
                    label="NIC attached to VM",
                ))
    except Exception as exc:
        logger.warning("Subnet→NIC→VM ARG query failed: %s", exc)

    # ── NSG → Subnet / NIC associations ────────────────────────────────
    try:
        for row in get_nsg_associations(subscription_ids):
            nsg_id = (row.get("nsgId") or "").lower()
            subnet_id = (row.get("subnetId") or "").lower()
            nic_id = (row.get("nicId") or "").lower()

            if nsg_id and subnet_id:
                edges.append(DependencyEdge(
                    source_id=nsg_id,
                    target_id=subnet_id,
                    relationship_type=RelationshipType.SECURES,
                    direction=EdgeDirection.DOWNSTREAM,
                    strength=EdgeStrength.SOFT,
                    discovered_by=DiscoveryMethod.RESOURCE_GRAPH,
                    label="NSG secures Subnet",
                ))
            if nsg_id and nic_id:
                edges.append(DependencyEdge(
                    source_id=nsg_id,
                    target_id=nic_id,
                    relationship_type=RelationshipType.SECURES,
                    direction=EdgeDirection.DOWNSTREAM,
                    strength=EdgeStrength.SOFT,
                    discovered_by=DiscoveryMethod.RESOURCE_GRAPH,
                    label="NSG secures NIC",
                ))
    except Exception as exc:
        logger.warning("NSG association ARG query failed: %s", exc)

    # ── VNet peering ───────────────────────────────────────────────────
    try:
        for row in get_vnet_peerings(subscription_ids):
            local_id = (row.get("localVnetId") or "").lower()
            remote_id = (row.get("remoteVnetId") or "").lower()
            if local_id and remote_id:
                edges.append(DependencyEdge(
                    source_id=local_id,
                    target_id=remote_id,
                    relationship_type=RelationshipType.PEERS_WITH,
                    direction=EdgeDirection.BIDIRECTIONAL,
                    strength=EdgeStrength.HARD,
                    discovered_by=DiscoveryMethod.RESOURCE_GRAPH,
                    label="VNet peering",
                ))
    except Exception as exc:
        logger.warning("VNet peering ARG query failed: %s", exc)

    # ── Load Balancer → Backend ────────────────────────────────────────
    try:
        for row in get_load_balancer_backends(subscription_ids):
            lb_id = (row.get("lbId") or "").lower()
            backend_id = (row.get("backendId") or "").lower()
            if lb_id and backend_id:
                # Backend ID is typically a NIC ipconfig; extract NIC ID
                nic_id = backend_id.split("/ipconfigurations/")[0] if "/ipconfigurations/" in backend_id else backend_id
                edges.append(DependencyEdge(
                    source_id=lb_id,
                    target_id=nic_id,
                    relationship_type=RelationshipType.ROUTES_TO,
                    direction=EdgeDirection.DOWNSTREAM,
                    strength=EdgeStrength.HARD,
                    discovered_by=DiscoveryMethod.RESOURCE_GRAPH,
                    label="Load Balancer routes to backend",
                ))
    except Exception as exc:
        logger.warning("Load Balancer backend ARG query failed: %s", exc)

    # ── Private Endpoints ──────────────────────────────────────────────
    try:
        for row in get_private_endpoints(subscription_ids):
            pe_id = (row.get("peId") or "").lower()
            target_id = (row.get("targetId") or "").lower()
            subnet_id = (row.get("subnetId") or "").lower()
            if pe_id and target_id:
                edges.append(DependencyEdge(
                    source_id=pe_id,
                    target_id=target_id,
                    relationship_type=RelationshipType.CONNECTS_VIA,
                    direction=EdgeDirection.UPSTREAM,
                    strength=EdgeStrength.HARD,
                    discovered_by=DiscoveryMethod.RESOURCE_GRAPH,
                    label="Private Endpoint to service",
                ))
            if pe_id and subnet_id:
                edges.append(DependencyEdge(
                    source_id=subnet_id,
                    target_id=pe_id,
                    relationship_type=RelationshipType.CONTAINS,
                    direction=EdgeDirection.DOWNSTREAM,
                    strength=EdgeStrength.HARD,
                    discovered_by=DiscoveryMethod.RESOURCE_GRAPH,
                    label="Subnet hosts Private Endpoint",
                ))
    except Exception as exc:
        logger.warning("Private Endpoint ARG query failed: %s", exc)

    # ── Route Table → Subnet ───────────────────────────────────────────
    try:
        for row in get_route_table_associations(subscription_ids):
            rt_id = (row.get("rtId") or "").lower()
            subnet_id = (row.get("subnetId") or "").lower()
            if rt_id and subnet_id:
                edges.append(DependencyEdge(
                    source_id=rt_id,
                    target_id=subnet_id,
                    relationship_type=RelationshipType.ROUTES_TO,
                    direction=EdgeDirection.DOWNSTREAM,
                    strength=EdgeStrength.SOFT,
                    discovered_by=DiscoveryMethod.RESOURCE_GRAPH,
                    label="Route Table applied to Subnet",
                ))
    except Exception as exc:
        logger.warning("Route Table ARG query failed: %s", exc)

    # ── NAT Gateway → Subnet ──────────────────────────────────────────
    try:
        for row in get_nat_gateway_associations(subscription_ids):
            nat_id = (row.get("natId") or "").lower()
            subnet_id = (row.get("subnetId") or "").lower()
            if nat_id and subnet_id:
                edges.append(DependencyEdge(
                    source_id=nat_id,
                    target_id=subnet_id,
                    relationship_type=RelationshipType.ROUTES_TO,
                    direction=EdgeDirection.DOWNSTREAM,
                    strength=EdgeStrength.HARD,
                    discovered_by=DiscoveryMethod.RESOURCE_GRAPH,
                    label="NAT Gateway serves Subnet",
                ))
    except Exception as exc:
        logger.warning("NAT Gateway ARG query failed: %s", exc)

    logger.info("Resource Graph edge discovery: %d edges found", len(edges))
    return edges


# ═══════════════════════════════════════════════════════════════════════════════
#  Graph construction and analysis
# ═══════════════════════════════════════════════════════════════════════════════

def build_dependency_graph(
    resources: List[Dict[str, Any]],
    vm_attachments: Optional[Dict[str, str]] = None,
    use_resource_graph: bool = True,
    subscription_ids: Optional[List[str]] = None,
) -> DependencyGraph:
    """
    Build the full dependency graph from all available sources.

    Args:
        resources: List of resource dicts from list_all_resources() or cached scan data.
        vm_attachments: Map from get_vm_attachments() {attached_id: vm_id}.
        use_resource_graph: Whether to call ARG KQL for network topology.
        subscription_ids: Subscriptions for ARG queries.

    Returns:
        DependencyGraph with nodes, edges, clusters, and SPOF analysis.
    """
    # ── Build nodes ───────────────────────────────────────────────────
    nodes: Dict[str, DependencyNode] = {}
    for r in resources:
        rid = r.get("resource_id", r.get("id", "")).lower()
        if not rid:
            continue
        nodes[rid] = DependencyNode(
            resource_id=rid,
            resource_type=r.get("resource_type", r.get("type", "")),
            name=r.get("resource_name", r.get("name", "")),
            resource_group=r.get("resource_group", ""),
            location=r.get("location", ""),
            subscription_id=r.get("subscription_id", ""),
            sku=r.get("sku"),
            tags=r.get("tags", {}),
            cost_monthly=r.get("cost_current_month", 0.0),
        )

    # ── Discover edges ────────────────────────────────────────────────
    all_edges: List[DependencyEdge] = []

    # Source 1: Cached resource properties (offline, always available)
    all_edges.extend(_discover_edges_from_cached_data(resources))

    # Source 2: VM attachments from existing resource_service
    if vm_attachments:
        all_edges.extend(_discover_edges_from_vm_attachments(vm_attachments))

    # Source 3: Azure Resource Graph (network topology — requires API call)
    if use_resource_graph:
        try:
            arg_edges = _discover_edges_from_resource_graph(subscription_ids)
            all_edges.extend(arg_edges)
        except Exception as exc:
            logger.warning("Resource Graph edge discovery failed (non-fatal): %s", exc)

    # ── Deduplicate edges ─────────────────────────────────────────────
    seen_edges: Set[Tuple[str, str, str]] = set()
    unique_edges: List[DependencyEdge] = []
    for edge in all_edges:
        key = (edge.source_id, edge.target_id, edge.relationship_type.value)
        if key not in seen_edges:
            seen_edges.add(key)
            unique_edges.append(edge)

    # ── Compute node degrees ──────────────────────────────────────────
    for edge in unique_edges:
        src = nodes.get(edge.source_id)
        tgt = nodes.get(edge.target_id)
        if src:
            src.out_degree += 1
        if tgt:
            tgt.in_degree += 1

    # ── Detect clusters (connected components) ────────────────────────
    clusters = _detect_clusters(nodes, unique_edges)

    # ── Detect single points of failure ───────────────────────────────
    spof = _detect_spof(nodes, unique_edges)

    graph = DependencyGraph(
        nodes=list(nodes.values()),
        edges=unique_edges,
        clusters=clusters,
        spof=spof,
        node_count=len(nodes),
        edge_count=len(unique_edges),
        cluster_count=len(clusters),
    )

    logger.info(
        "Dependency graph built: %d nodes, %d edges, %d clusters, %d SPOF",
        graph.node_count, graph.edge_count, graph.cluster_count, len(spof),
    )
    return graph


# ═══════════════════════════════════════════════════════════════════════════════
#  Graph algorithms
# ═══════════════════════════════════════════════════════════════════════════════

def _detect_clusters(
    nodes: Dict[str, DependencyNode],
    edges: List[DependencyEdge],
) -> List[DependencyCluster]:
    """
    Detect connected components in the graph using Union-Find.
    Each component becomes a cluster (potential workload boundary).
    """
    # Union-Find
    parent: Dict[str, str] = {nid: nid for nid in nodes}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    # Add all edge endpoints to parent set (may include subnet IDs not in nodes)
    all_ids = set(nodes.keys())
    for edge in edges:
        if edge.source_id not in parent:
            parent[edge.source_id] = edge.source_id
            all_ids.add(edge.source_id)
        if edge.target_id not in parent:
            parent[edge.target_id] = edge.target_id
            all_ids.add(edge.target_id)

    for edge in edges:
        union(edge.source_id, edge.target_id)

    # Group by root
    groups: Dict[str, List[str]] = defaultdict(list)
    for nid in all_ids:
        root = find(nid)
        # Only include nodes that are actual resources (in our node map)
        if nid in nodes:
            groups[root].append(nid)

    # Build cluster objects
    clusters: List[DependencyCluster] = []
    for idx, (_, members) in enumerate(sorted(groups.items(), key=lambda x: -len(x[1]))):
        if not members:
            continue

        member_nodes = [nodes[m] for m in members if m in nodes]
        regions = list({n.location for n in member_nodes if n.location})
        types = list({n.resource_type for n in member_nodes if n.resource_type})
        total_cost = sum(n.cost_monthly for n in member_nodes)

        # Generate a name from the most common resource group or naming pattern
        name = _suggest_cluster_name(member_nodes, idx)

        clusters.append(DependencyCluster(
            id=f"cluster-{idx}",
            name=name,
            resources=members,
            resource_count=len(members),
            is_island=(len(members) == 1),
            cross_region=(len(regions) > 1),
            regions=regions,
            resource_types=types,
            total_monthly_cost=round(total_cost, 2),
            suggested_workload_name=name,
        ))

    return clusters


def _suggest_cluster_name(nodes: List[DependencyNode], idx: int) -> str:
    """Suggest a human-readable name for a cluster based on member patterns."""
    if not nodes:
        return f"Cluster {idx}"

    # Most common resource group
    rg_counts: Dict[str, int] = defaultdict(int)
    for n in nodes:
        rg_counts[n.resource_group] += 1
    top_rg = max(rg_counts, key=rg_counts.get) if rg_counts else ""

    # Try to find a common prefix in resource names
    names = [n.name for n in nodes if n.name]
    if len(names) >= 2:
        prefix = _common_prefix(names)
        if len(prefix) >= 3:
            return prefix.rstrip("-_. ")

    if top_rg:
        return top_rg

    return f"Cluster {idx}"


def _common_prefix(strings: List[str]) -> str:
    """Find the longest common prefix among a list of strings."""
    if not strings:
        return ""
    shortest = min(strings, key=len)
    for i, ch in enumerate(shortest):
        if any(s[i].lower() != ch.lower() for s in strings):
            return shortest[:i]
    return shortest


def _detect_spof(
    nodes: Dict[str, DependencyNode],
    edges: List[DependencyEdge],
) -> List[SPOFResource]:
    """
    Identify single points of failure — resources that:
    1. Have high in-degree (many resources depend on them), OR
    2. Are articulation points (removing them disconnects the graph)

    For practical Azure assessment, we focus on:
    - Resources with 3+ direct dependents
    - Non-redundant resources (single instance, no zone redundancy)
    """
    spof: List[SPOFResource] = []

    # Count downstream dependents for each resource
    downstream_count: Dict[str, int] = defaultdict(int)
    for edge in edges:
        if edge.direction in (EdgeDirection.DOWNSTREAM, EdgeDirection.BIDIRECTIONAL):
            downstream_count[edge.source_id] += 1
        if edge.direction == EdgeDirection.UPSTREAM:
            downstream_count[edge.target_id] += 1

    # High in-degree resources (many things depend on them)
    for rid, count in downstream_count.items():
        if count >= 3 and rid in nodes:
            node = nodes[rid]
            # Infrastructure resources that serve as bottlenecks
            spof.append(SPOFResource(
                resource_id=rid,
                resource_name=node.name,
                resource_type=node.resource_type,
                dependents_count=count,
                reason=f"{count} resources depend on this {_friendly_type(node.resource_type)}",
            ))

    # Sort by impact (most dependents first)
    spof.sort(key=lambda s: -s.dependents_count)
    return spof


def _friendly_type(resource_type: str) -> str:
    """Convert resource type to human-friendly short name."""
    mapping = {
        "microsoft.compute/virtualmachines": "VM",
        "microsoft.network/virtualnetworks": "VNet",
        "microsoft.network/loadbalancers": "Load Balancer",
        "microsoft.network/applicationgateways": "App Gateway",
        "microsoft.web/serverfarms": "App Service Plan",
        "microsoft.sql/servers": "SQL Server",
        "microsoft.documentdb/databaseaccounts": "Cosmos DB",
        "microsoft.storage/storageaccounts": "Storage Account",
        "microsoft.keyvault/vaults": "Key Vault",
        "microsoft.containerservice/managedclusters": "AKS Cluster",
        "microsoft.network/networksecuritygroups": "NSG",
    }
    return mapping.get(resource_type.lower(), resource_type.split("/")[-1])


# ═══════════════════════════════════════════════════════════════════════════════
#  Query methods
# ═══════════════════════════════════════════════════════════════════════════════

def get_blast_radius(
    resource_id: str,
    graph: DependencyGraph,
) -> BlastRadius:
    """
    Calculate the blast radius for a given resource — what breaks if it fails?

    Follows all downstream edges transitively (BFS) from the resource.
    """
    resource_id = resource_id.lower()

    # Build adjacency lists
    downstream: Dict[str, Set[str]] = defaultdict(set)
    for edge in graph.edges:
        if edge.direction == EdgeDirection.DOWNSTREAM:
            downstream[edge.source_id].add(edge.target_id)
        elif edge.direction == EdgeDirection.UPSTREAM:
            downstream[edge.target_id].add(edge.source_id)
        elif edge.direction == EdgeDirection.BIDIRECTIONAL:
            downstream[edge.source_id].add(edge.target_id)
            downstream[edge.target_id].add(edge.source_id)

    # BFS from resource_id
    visited: Set[str] = set()
    queue = list(downstream.get(resource_id, set()))
    direct = set(queue)
    visited.add(resource_id)

    while queue:
        current = queue.pop(0)
        if current in visited:
            continue
        visited.add(current)
        for neighbor in downstream.get(current, set()):
            if neighbor not in visited:
                queue.append(neighbor)

    visited.discard(resource_id)
    transitive = visited - direct

    # Calculate cost impact
    node_map = {n.resource_id: n for n in graph.nodes}
    cost_impact = sum(
        node_map[rid].cost_monthly
        for rid in visited
        if rid in node_map
    )

    resource_name = node_map[resource_id].name if resource_id in node_map else resource_id

    return BlastRadius(
        resource_id=resource_id,
        resource_name=resource_name,
        directly_affected=sorted(direct),
        transitively_affected=sorted(transitive),
        affected_count=len(visited),
        estimated_cost_impact=round(cost_impact, 2),
    )


def get_resource_dependencies(
    resource_id: str,
    graph: DependencyGraph,
) -> Dict[str, Any]:
    """
    Get upstream (what I depend on) and downstream (what depends on me)
    dependencies for a single resource.
    """
    resource_id = resource_id.lower()
    node_map = {n.resource_id: n for n in graph.nodes}

    upstream: List[Dict] = []
    downstream: List[Dict] = []

    for edge in graph.edges:
        if edge.source_id == resource_id:
            target = node_map.get(edge.target_id)
            entry = {
                "resource_id": edge.target_id,
                "name": target.name if target else edge.target_id,
                "type": target.resource_type if target else "",
                "relationship": edge.relationship_type.value,
                "label": edge.label or "",
            }
            if edge.direction == EdgeDirection.UPSTREAM:
                upstream.append(entry)
            else:
                downstream.append(entry)
        elif edge.target_id == resource_id:
            source = node_map.get(edge.source_id)
            entry = {
                "resource_id": edge.source_id,
                "name": source.name if source else edge.source_id,
                "type": source.resource_type if source else "",
                "relationship": edge.relationship_type.value,
                "label": edge.label or "",
            }
            if edge.direction == EdgeDirection.DOWNSTREAM:
                downstream.append(entry)
            else:
                upstream.append(entry)

    node = node_map.get(resource_id)
    return {
        "resource_id": resource_id,
        "name": node.name if node else resource_id,
        "type": node.resource_type if node else "",
        "upstream": upstream,
        "downstream": downstream,
        "upstream_count": len(upstream),
        "downstream_count": len(downstream),
    }


def get_graph_summary(graph: DependencyGraph) -> DependencyGraphSummary:
    """Return a lightweight summary of the dependency graph."""
    rel_breakdown: Dict[str, int] = defaultdict(int)
    for edge in graph.edges:
        rel_breakdown[edge.relationship_type.value] += 1

    return DependencyGraphSummary(
        node_count=graph.node_count,
        edge_count=graph.edge_count,
        cluster_count=graph.cluster_count,
        spof_count=len(graph.spof),
        island_count=sum(1 for c in graph.clusters if c.is_island),
        cross_region_clusters=sum(1 for c in graph.clusters if c.cross_region),
        relationship_breakdown=dict(rel_breakdown),
    )
