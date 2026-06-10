"""
Azure Resource Graph service — paginated KQL query execution.

Provides a lightweight wrapper around the ResourceGraphClient for running
KQL queries against Azure Resource Graph across multiple subscriptions.
Used by dependency_service.py to discover network topology, subnet associations,
VNet peering, and other relationships not available via standard REST APIs.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from azure.mgmt.resourcegraph import ResourceGraphClient
from azure.mgmt.resourcegraph.models import (
    QueryRequest,
    QueryRequestOptions,
    ResultFormat,
)

from .azure_auth import get_credential, get_subscription_ids

logger = logging.getLogger(__name__)

# ARG returns max 1000 rows per page
_PAGE_SIZE = 1000


def query_resource_graph(
    kql: str,
    subscription_ids: Optional[List[str]] = None,
    max_results: int = 5000,
) -> List[Dict[str, Any]]:
    """
    Execute a KQL query against Azure Resource Graph with automatic pagination.

    Args:
        kql: The KQL query string.
        subscription_ids: Subscriptions to query. Defaults to configured list.
        max_results: Safety cap on total rows returned.

    Returns:
        List of dict rows from the query result.
    """
    credential = get_credential()
    sub_ids = subscription_ids or get_subscription_ids()

    if not sub_ids:
        logger.warning("No subscription IDs configured — skipping Resource Graph query")
        return []

    client = ResourceGraphClient(credential)
    all_rows: List[Dict[str, Any]] = []
    skip_token: Optional[str] = None

    while True:
        options = QueryRequestOptions(
            result_format=ResultFormat.OBJECT_ARRAY,
            top=min(_PAGE_SIZE, max_results - len(all_rows)),
            skip_token=skip_token,
        )
        request = QueryRequest(
            subscriptions=sub_ids,
            query=kql,
            options=options,
        )

        try:
            response = client.resources(request)
        except Exception as exc:
            logger.error("Resource Graph query failed: %s\nKQL: %s", exc, kql[:200])
            break

        rows = response.data or []
        all_rows.extend(rows)

        if len(all_rows) >= max_results:
            logger.info("Resource Graph hit max_results cap (%d)", max_results)
            break

        skip_token = response.skip_token
        if not skip_token:
            break

    logger.info("Resource Graph query returned %d rows", len(all_rows))
    return all_rows


# ── Pre-built KQL queries for dependency discovery ───────────────────────────

def get_vnet_subnet_nic_chain(subscription_ids: Optional[List[str]] = None) -> List[Dict]:
    """VNet → Subnet → NIC → VM chain via Resource Graph."""
    kql = """
    resources
    | where type == "microsoft.network/networkinterfaces"
    | mv-expand ipconfig = properties.ipConfigurations
    | extend subnetId = tostring(ipconfig.properties.subnet.id)
    | extend vmId = tostring(properties.virtualMachine.id)
    | extend nicId = id
    | project nicId, subnetId, vmId, resourceGroup, location, subscriptionId
    """
    return query_resource_graph(kql, subscription_ids)


def get_nsg_associations(subscription_ids: Optional[List[str]] = None) -> List[Dict]:
    """NSG → Subnet and NSG → NIC associations."""
    kql = """
    resources
    | where type == "microsoft.network/networksecuritygroups"
    | extend subnets = properties.subnets
    | extend nics = properties.networkInterfaces
    | mv-expand subnet = subnets
    | extend subnetId = tostring(subnet.id)
    | project nsgId = id, nsgName = name, subnetId, resourceGroup, subscriptionId
    """
    subnet_results = query_resource_graph(kql, subscription_ids)

    kql_nic = """
    resources
    | where type == "microsoft.network/networksecuritygroups"
    | extend nics = properties.networkInterfaces
    | mv-expand nic = nics
    | extend nicId = tostring(nic.id)
    | project nsgId = id, nsgName = name, nicId, resourceGroup, subscriptionId
    """
    nic_results = query_resource_graph(kql_nic, subscription_ids)

    return subnet_results + nic_results


def get_vnet_peerings(subscription_ids: Optional[List[str]] = None) -> List[Dict]:
    """VNet peering relationships (local ↔ remote)."""
    kql = """
    resources
    | where type == "microsoft.network/virtualnetworks"
    | mv-expand peering = properties.virtualNetworkPeerings
    | extend peeringState = tostring(peering.properties.peeringState)
    | extend remoteVnetId = tostring(peering.properties.remoteVirtualNetwork.id)
    | where isnotempty(remoteVnetId)
    | project localVnetId = id, localVnetName = name, remoteVnetId, peeringState,
              resourceGroup, location, subscriptionId
    """
    return query_resource_graph(kql, subscription_ids)


def get_load_balancer_backends(subscription_ids: Optional[List[str]] = None) -> List[Dict]:
    """Load Balancer → Backend Pool → NIC/IP associations."""
    kql = """
    resources
    | where type == "microsoft.network/loadbalancers"
    | mv-expand pool = properties.backendAddressPools
    | mv-expand be = pool.properties.backendIPConfigurations
    | extend backendId = tostring(be.id)
    | project lbId = id, lbName = name, backendId, resourceGroup, subscriptionId
    """
    return query_resource_graph(kql, subscription_ids)


def get_app_gateway_backends(subscription_ids: Optional[List[str]] = None) -> List[Dict]:
    """Application Gateway → Backend Pool associations."""
    kql = """
    resources
    | where type == "microsoft.network/applicationgateways"
    | mv-expand pool = properties.backendAddressPools
    | mv-expand addr = pool.properties.backendAddresses
    | extend fqdn = tostring(addr.fqdn)
    | extend ipAddress = tostring(addr.ipAddress)
    | project agwId = id, agwName = name, fqdn, ipAddress, resourceGroup, subscriptionId
    """
    return query_resource_graph(kql, subscription_ids)


def get_private_endpoints(subscription_ids: Optional[List[str]] = None) -> List[Dict]:
    """Private Endpoint → Target resource connections."""
    kql = """
    resources
    | where type == "microsoft.network/privateendpoints"
    | mv-expand conn = properties.privateLinkServiceConnections
    | extend targetId = tostring(conn.properties.privateLinkServiceId)
    | extend subnetId = tostring(properties.subnet.id)
    | project peId = id, peName = name, targetId, subnetId, resourceGroup, subscriptionId
    """
    return query_resource_graph(kql, subscription_ids)


def get_route_table_associations(subscription_ids: Optional[List[str]] = None) -> List[Dict]:
    """Route Table → Subnet associations."""
    kql = """
    resources
    | where type == "microsoft.network/routetables"
    | mv-expand subnet = properties.subnets
    | extend subnetId = tostring(subnet.id)
    | project rtId = id, rtName = name, subnetId, resourceGroup, subscriptionId
    """
    return query_resource_graph(kql, subscription_ids)


def get_nat_gateway_associations(subscription_ids: Optional[List[str]] = None) -> List[Dict]:
    """NAT Gateway → Subnet associations."""
    kql = """
    resources
    | where type == "microsoft.network/natgateways"
    | mv-expand subnet = properties.subnets
    | extend subnetId = tostring(subnet.id)
    | project natId = id, natName = name, subnetId, resourceGroup, subscriptionId
    """
    return query_resource_graph(kql, subscription_ids)


def get_sql_failover_groups(subscription_ids: Optional[List[str]] = None) -> List[Dict]:
    """SQL Failover Group → Primary + Secondary server links."""
    kql = """
    resources
    | where type == "microsoft.sql/servers/failovergroups"
    | extend primaryServer = tostring(properties.partnerServers[0].id)
    | extend replicationRole = tostring(properties.replicationRole)
    | project fgId = id, fgName = name, primaryServer, replicationRole,
              resourceGroup, subscriptionId
    """
    return query_resource_graph(kql, subscription_ids)


def get_vnet_subnets(subscription_ids: Optional[List[str]] = None) -> List[Dict]:
    """VNet → Subnet containment for building the network topology tree."""
    kql = """
    resources
    | where type == "microsoft.network/virtualnetworks"
    | mv-expand subnet = properties.subnets
    | extend subnetId = tostring(subnet.id)
    | extend subnetName = tostring(subnet.name)
    | extend addressPrefix = tostring(subnet.properties.addressPrefix)
    | project vnetId = id, vnetName = name, subnetId, subnetName, addressPrefix,
              resourceGroup, location, subscriptionId
    """
    return query_resource_graph(kql, subscription_ids)
