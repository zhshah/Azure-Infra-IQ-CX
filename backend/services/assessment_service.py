"""
Assessment Service
Handles end-to-end workload assessment workflow:
- Service-based assessments (single Azure service type)
- Multi-resource assessments (RG, subscription, custom)
- AI analysis with scoring
- APEX agent orchestration
- Report generation
"""

import json
import sqlite3
import os
import signal
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any
from azure.identity import DefaultAzureCredential
from azure.mgmt.resource import ResourceManagementClient
from azure.mgmt.resourcegraph import ResourceGraphClient
from azure.mgmt.resourcegraph.models import QueryRequest
import anthropic
from openai import AzureOpenAI
from services.database import get_raw_connection, limit_sql, is_azure_sql, upsert_conflict_sql

# Per-agent timeout in seconds (5 minutes default, longer for code-gen agents)
AGENT_TIMEOUT_SECONDS = {
    "02-requirements": 300,
    "03-architect": 300,
    "04-design": 300,
    "04g-governance": 240,
    "05-iac-planner": 300,
    "06b-bicep-codegen": 420,  # code gen needs more time
    "08-as-built": 300,
}
DEFAULT_AGENT_TIMEOUT = 300  # 5 minutes
# Workflow is considered stale if no progress for this many minutes
STALE_WORKFLOW_MINUTES = 30

from services.azure_icon_service import AzureIconService

class AssessmentService:
    
    # Supported Azure service types for service-based assessments
    SUPPORTED_SERVICES = {
        "Microsoft.Web/sites": {
            "name": "Azure App Service",
            "icon": "/icons/compute/10035-icon-service-App-Services.svg",
            "category": "Compute"
        },
        "Microsoft.Compute/virtualMachines": {
            "name": "Virtual Machines",
            "icon": "/icons/compute/10021-icon-service-Virtual-Machine.svg",
            "category": "Compute"
        },
        "Microsoft.Compute/virtualMachineScaleSets": {
            "name": "VM Scale Sets",
            "icon": "/icons/compute/10034-icon-service-VM-Scale-Sets.svg",
            "category": "Compute"
        },
        "Microsoft.ContainerService/managedClusters": {
            "name": "Azure Kubernetes Service",
            "icon": "/icons/compute/10023-icon-service-Kubernetes-Services.svg",
            "category": "Containers"
        },
        "Microsoft.ContainerInstance/containerGroups": {
            "name": "Container Instances",
            "icon": "/icons/containers/10104-icon-service-Container-Instances.svg",
            "category": "Containers"
        },
        "Microsoft.App/containerApps": {
            "name": "Container Apps",
            "icon": "/icons/containers/10104-icon-service-Container-Instances.svg",
            "category": "Containers"
        },
        "Microsoft.Sql/servers/databases": {
            "name": "Azure SQL Database",
            "icon": "/icons/databases/10130-icon-service-SQL-Database.svg",
            "category": "Database"
        },
        "Microsoft.DBforPostgreSQL/flexibleServers": {
            "name": "PostgreSQL Flexible Server",
            "icon": "/icons/databases/10131-icon-service-Azure-Database-PostgreSQL-Server.svg",
            "category": "Database"
        },
        "Microsoft.DBforMySQL/flexibleServers": {
            "name": "MySQL Flexible Server",
            "icon": "/icons/databases/10122-icon-service-Azure-Database-MySQL-Server.svg",
            "category": "Database"
        },
        "Microsoft.Storage/storageAccounts": {
            "name": "Storage Accounts",
            "icon": "/icons/storage/10086-icon-service-Storage-Accounts.svg",
            "category": "Storage"
        },
        "Microsoft.Network/applicationGateways": {
            "name": "Application Gateway",
            "icon": "/icons/networking/10076-icon-service-Application-Gateways.svg",
            "category": "Network"
        },
        "Microsoft.Network/loadBalancers": {
            "name": "Load Balancer",
            "icon": "/icons/networking/10062-icon-service-Load-Balancers.svg",
            "category": "Network"
        },
        "Microsoft.KeyVault/vaults": {
            "name": "Key Vault",
            "icon": "/icons/security/10245-icon-service-Key-Vaults.svg",
            "category": "Security"
        },
        "Microsoft.RecoveryServices/vaults": {
            "name": "Recovery Services Vault",
            "icon": "/icons/storage/00017-icon-service-Recovery-Services-Vaults.svg",
            "category": "BCDR"
        }
    }
    
    # APEX agent sequence for comprehensive assessments
    APEX_AGENT_SEQUENCE = [
        "02-requirements",
        "03-architect",
        "04-design",
        "04g-governance",
        "05-iac-planner",
        "06b-bicep-codegen",
        "08-as-built"
    ]
    
    def __init__(self, db_path: str = None):
        if db_path is None:
            db_path = Path(__file__).parent.parent / "data" / "scans.db"
        self.db_path = str(db_path)
        self.credential = DefaultAzureCredential()

        # Track workflow_ids whose background threads are currently active.
        # Guards against duplicate threads when resume is called while the
        # original thread is still running.
        self._active_workflows: set = set()

        # Ensure DB tables exist (idempotent — safe to call every startup)
        self._ensure_tables()

        # Initialize AI clients
        self._init_ai_clients()
    
    def _ensure_tables(self):
        """Create all required tables if they don't exist (idempotent)."""
        if is_azure_sql():
            return  # Schema managed by migration scripts for Azure SQL
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS assessments (
                    assessment_id TEXT PRIMARY KEY,
                    assessment_name TEXT NOT NULL,
                    assessment_type TEXT NOT NULL,
                    service_type TEXT,
                    scope_type TEXT,
                    scope_value TEXT,
                    description TEXT,
                    business_unit TEXT,
                    owner TEXT,
                    status TEXT DEFAULT 'created',
                    current_step INTEGER DEFAULT 1,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    completed_at TEXT
                );
                CREATE TABLE IF NOT EXISTS assessment_resources (
                    assessment_id TEXT NOT NULL,
                    resource_id TEXT NOT NULL,
                    resource_name TEXT,
                    resource_type TEXT,
                    location TEXT,
                    resource_group TEXT,
                    subscription_id TEXT,
                    tags TEXT,
                    selected BOOLEAN DEFAULT 1,
                    resource_metadata TEXT,
                    PRIMARY KEY (assessment_id, resource_id)
                );
                CREATE TABLE IF NOT EXISTS assessment_analysis (
                    analysis_id TEXT PRIMARY KEY,
                    assessment_id TEXT NOT NULL,
                    analysis_type TEXT NOT NULL,
                    overall_score INTEGER,
                    findings TEXT,
                    recommendations TEXT,
                    critical_gaps TEXT,
                    warnings TEXT,
                    opportunities TEXT,
                    metadata TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS assessment_apex_workflow (
                    workflow_id TEXT PRIMARY KEY,
                    assessment_id TEXT NOT NULL,
                    agent_sequence TEXT NOT NULL,
                    current_agent_index INTEGER DEFAULT 0,
                    agents_completed TEXT DEFAULT '[]',
                    agents_failed TEXT DEFAULT '[]',
                    status TEXT DEFAULT 'pending',
                    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    completed_at TEXT
                );
                CREATE TABLE IF NOT EXISTS agent_executions (
                    execution_id TEXT PRIMARY KEY,
                    assessment_id TEXT,
                    agent_name TEXT,
                    status TEXT DEFAULT 'pending',
                    input_data TEXT,
                    output_data TEXT,
                    artifacts TEXT,
                    error_message TEXT,
                    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    completed_at TEXT
                );
                CREATE TABLE IF NOT EXISTS assessment_reports (
                    report_id TEXT PRIMARY KEY,
                    assessment_id TEXT NOT NULL,
                    executive_summary TEXT,
                    iac_artifacts TEXT,
                    status TEXT DEFAULT 'generated',
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
            """)
            # Add resource_metadata column to existing DBs that predate it
            try:
                conn.execute("ALTER TABLE assessment_resources ADD COLUMN resource_metadata TEXT")
            except Exception:
                pass  # Column already exists
            conn.commit()
        finally:
            conn.close()

    def _init_ai_clients(self):
        """Initialize Anthropic, Azure OpenAI, and GitHub Models clients"""
        self.claude_client = None
        self.azure_openai_client = None
        self.github_models_client = None

        # Try Anthropic (Claude)
        anthropic_key = os.getenv("ANTHROPIC_API_KEY")
        if anthropic_key and anthropic_key.startswith("sk-ant-"):
            try:
                self.claude_client = anthropic.Anthropic(api_key=anthropic_key)
                print("✅ Anthropic Claude client initialized")
            except Exception as e:
                print(f"⚠️ Anthropic client initialization failed: {e}")

        # Try Azure OpenAI
        azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        azure_key = os.getenv("AZURE_OPENAI_KEY")
        azure_deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini")
        if azure_endpoint:
            try:
                self.azure_openai_client = AzureOpenAI(
                    api_version="2024-10-21",
                    azure_endpoint=azure_endpoint,
                    api_key=azure_key,
                )
                print("✅ Azure OpenAI client initialized")
            except Exception as e:
                print(f"⚠️ Azure OpenAI client initialization failed: {e}")

        # Try GitHub Models API (works with GITHUB_TOKEN from VS Code / GitHub Copilot)
        # Supports Claude Sonnet, GPT-4o, and others — no separate API key needed
        if not self.claude_client and not self.azure_openai_client:
            github_token = os.getenv("GITHUB_TOKEN") or os.getenv("GITHUB_MODELS_TOKEN")
            if github_token:
                try:
                    from openai import OpenAI as _OpenAIClient
                    self.github_models_client = _OpenAIClient(
                        base_url="https://models.inference.ai.azure.com",
                        api_key=github_token
                    )
                    print("✅ GitHub Models client initialized (using GITHUB_TOKEN)")
                except Exception as e:
                    print(f"⚠️ GitHub Models init failed: {e}")

        if not self.claude_client and not self.azure_openai_client and not self.github_models_client:
            print("⚠️ No AI client available — agent workflow will use resource-aware fallback templates.")
            print("   To enable real AI analysis, set one of:")
            print("   ANTHROPIC_API_KEY, AZURE_OPENAI_ENDPOINT, or GITHUB_TOKEN")

    def _load_agent_system_prompt(self, agent_name: str) -> str:
        """Load the markdown instruction body from the local .agent.md file.
        
        The .agent.md files have structure:
          ---
          yaml frontmatter
          ---
          # Agent Name
          ... actual instructions ...
        
        We extract the markdown body (after second ---) as the system prompt.
        """
        agents_dir = Path(__file__).parent.parent.parent / "apex-integration" / "agents"
        agent_file = agents_dir / f"{agent_name}.agent.md"
        if not agent_file.exists():
            print(f"⚠️ Agent file not found: {agent_file}")
            return f"You are the {agent_name} Azure infrastructure assessment agent."
        try:
            content = agent_file.read_text(encoding="utf-8")
            # Split on --- to separate frontmatter from instructions body
            parts = content.split("---", 2)
            if len(parts) >= 3:
                instructions = parts[2].strip()
                print(f"✅ Loaded agent instructions from {agent_name}.agent.md ({len(instructions)} chars)")
                return instructions
            return content.strip()
        except Exception as e:
            print(f"⚠️ Could not load agent file {agent_name}.agent.md: {e}")
            return f"You are the {agent_name} Azure infrastructure assessment agent."
    
    def _get_connection(self):
        """Get database connection via abstraction layer"""
        return get_raw_connection()
    
    # ============================================
    # STEP 1: Create Assessment
    # ============================================
    
    def create_assessment(self, 
                         assessment_name: str,
                         assessment_type: str,
                         service_type: Optional[str] = None,
                         scope_type: Optional[str] = None,
                         scope_value: Optional[str] = None,
                         description: Optional[str] = None,
                         business_unit: Optional[str] = None,
                         owner: Optional[str] = None) -> Dict[str, Any]:
        """
        Create a new assessment
        
        Args:
            assessment_name: Name of the assessment
            assessment_type: 'service-based' or 'multi-resource'
            service_type: For service-based, e.g., 'Microsoft.Web/sites'
            scope_type: For multi-resource: 'resource-group', 'subscription', 'custom'
            scope_value: RG name, subscription ID, or resource IDs
            description: Assessment description
            business_unit: Business unit name
            owner: Owner email
        
        Returns:
            Assessment dict with assessment_id
        """
        assessment_id = f"assess-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO assessments (
                assessment_id, assessment_name, assessment_type, service_type,
                scope_type, scope_value, description, business_unit, owner,
                status, current_step
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scoping', 2)
        """, (assessment_id, assessment_name, assessment_type, service_type,
              scope_type, scope_value, description, business_unit, owner))
        
        conn.commit()
        conn.close()
        
        return {
            "assessment_id": assessment_id,
            "assessment_name": assessment_name,
            "assessment_type": assessment_type,
            "status": "scoping",
            "current_step": 2
        }
    
    # ============================================
    # STEP 2: Discover & Scope Resources
    # ============================================
    
    def discover_resources(self, 
                          assessment_id: str,
                          subscription_ids: List[str]) -> List[Dict[str, Any]]:
        """
        Discover resources for assessment based on type and scope
        
        Args:
            assessment_id: Assessment ID
            subscription_ids: List of subscription IDs to scan
        
        Returns:
            List of discovered resources
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # Get assessment details
        cursor.execute("""
            SELECT assessment_type, service_type, scope_type, scope_value
            FROM assessments WHERE assessment_id = ?
        """, (assessment_id,))
        
        row = cursor.fetchone()
        if not row:
            raise ValueError(f"Assessment {assessment_id} not found")
        
        assessment_type, service_type, scope_type, scope_value = row
        conn.close()
        
        # Build query based on assessment type
        if assessment_type == "service-based":
            query = f"Resources | where type =~ '{service_type}'"
        elif scope_type == "resource-group":
            query = f"Resources | where resourceGroup =~ '{scope_value}'"
        elif scope_type == "subscription":
            query = f"Resources | where subscriptionId =~ '{scope_value}'"
        else:
            # Custom multi-resource
            query = "Resources"
        
        # Execute Azure Resource Graph query — fetch rich properties for deep analysis
        rich_query = query + """
| extend sku_name = coalesce(sku.name, properties.sku.name, '')
| extend sku_tier = coalesce(sku.tier, properties.sku.tier, '')
| extend sku_size = coalesce(sku.size, properties.sku.size, '')
| extend sku_capacity = coalesce(sku.capacity, properties.sku.capacity, '')
| extend kind_value = kind
| extend provisioning_state = properties.provisioningState
| project id, name, type, location, resourceGroup, subscriptionId, tags,
          sku_name, sku_tier, sku_size, sku_capacity, kind_value,
          provisioning_state, properties
"""
        graph_client = ResourceGraphClient(self.credential)
        query_request = QueryRequest(
            subscriptions=subscription_ids,
            query=rich_query
        )
        
        response = graph_client.resources(query_request)
        resources = []
        
        for resource in response.data:
            # Extract relevant configuration properties per resource type
            props = resource.get("properties", {}) or {}
            config = self._extract_resource_config(resource.get("type", ""), props)
            
            resources.append({
                "resource_id": resource.get("id"),
                "resource_name": resource.get("name"),
                "resource_type": resource.get("type"),
                "location": resource.get("location"),
                "resource_group": resource.get("resourceGroup"),
                "subscription_id": resource.get("subscriptionId"),
                "tags": json.dumps(resource.get("tags", {})),
                "sku_name": resource.get("sku_name", ""),
                "sku_tier": resource.get("sku_tier", ""),
                "sku_size": resource.get("sku_size", ""),
                "sku_capacity": str(resource.get("sku_capacity", "")),
                "kind": resource.get("kind_value", ""),
                "provisioning_state": resource.get("provisioning_state", ""),
                "config": json.dumps(config),
            })
        
        return resources
    
    def _extract_resource_config(self, resource_type: str, props: Dict) -> Dict[str, Any]:
        """Extract key configuration properties per resource type for deep analysis."""
        rt = (resource_type or "").lower()
        config = {}
        
        if "microsoft.web/sites" in rt:
            config = {
                "state": props.get("state"),
                "https_only": props.get("httpsOnly"),
                "client_cert_enabled": props.get("clientCertEnabled"),
                "min_tls_version": (props.get("siteConfig") or {}).get("minTlsVersion"),
                "ftps_state": (props.get("siteConfig") or {}).get("ftpsState"),
                "always_on": (props.get("siteConfig") or {}).get("alwaysOn"),
                "linux_fx_version": (props.get("siteConfig") or {}).get("linuxFxVersion"),
                "vnet_route_all": (props.get("siteConfig") or {}).get("vnetRouteAllEnabled"),
                "server_farm_id": props.get("serverFarmId"),
                "default_hostname": props.get("defaultHostName"),
                "outbound_ip_addresses": props.get("outboundIpAddresses"),
                "availability_state": props.get("availabilityState"),
            }
        elif "microsoft.compute/virtualmachines" in rt:
            hw = props.get("hardwareProfile") or {}
            os_prof = props.get("osProfile") or {}
            storage = props.get("storageProfile") or {}
            net_prof = props.get("networkProfile") or {}
            config = {
                "vm_size": hw.get("vmSize"),
                "os_type": ((storage.get("osDisk") or {}).get("osType")),
                "os_image": f"{(storage.get('imageReference') or {}).get('publisher','')}/{(storage.get('imageReference') or {}).get('offer','')}/{(storage.get('imageReference') or {}).get('sku','')}",
                "data_disk_count": len(storage.get("dataDisks") or []),
                "nic_count": len((net_prof.get("networkInterfaces") or [])),
                "admin_user": os_prof.get("adminUsername"),
                "computer_name": os_prof.get("computerName"),
                "zones": props.get("zones"),
            }
        elif "microsoft.containerservice/managedclusters" in rt:
            agent_pools = props.get("agentPoolProfiles") or []
            net = props.get("networkProfile") or {}
            config = {
                "kubernetes_version": props.get("kubernetesVersion"),
                "node_pools": [{
                    "name": p.get("name"),
                    "count": p.get("count"),
                    "vm_size": p.get("vmSize"),
                    "mode": p.get("mode"),
                    "os_type": p.get("osType"),
                    "max_pods": p.get("maxPods"),
                    "enable_autoscaling": p.get("enableAutoScaling"),
                    "min_count": p.get("minCount"),
                    "max_count": p.get("maxCount"),
                    "availability_zones": p.get("availabilityZones"),
                } for p in agent_pools[:5]],
                "network_plugin": net.get("networkPlugin"),
                "network_policy": net.get("networkPolicy"),
                "service_cidr": net.get("serviceCidr"),
                "dns_service_ip": net.get("dnsServiceIP"),
                "enable_rbac": props.get("enableRBAC"),
                "aad_profile": bool(props.get("aadProfile")),
                "private_cluster": (props.get("apiServerAccessProfile") or {}).get("enablePrivateCluster"),
            }
        elif "microsoft.app/containerapps" in rt:
            tmpl = props.get("template") or {}
            conf = props.get("configuration") or {}
            containers = (tmpl.get("containers") or [])
            config = {
                "managed_env_id": props.get("managedEnvironmentId"),
                "workload_profile": props.get("workloadProfileName"),
                "containers": [{
                    "name": c.get("name"),
                    "image": c.get("image"),
                    "cpu": (c.get("resources") or {}).get("cpu"),
                    "memory": (c.get("resources") or {}).get("memory"),
                } for c in containers[:5]],
                "scale": tmpl.get("scale"),
                "ingress": {
                    "external": (conf.get("ingress") or {}).get("external"),
                    "target_port": (conf.get("ingress") or {}).get("targetPort"),
                    "transport": (conf.get("ingress") or {}).get("transport"),
                } if conf.get("ingress") else None,
                "dapr": bool(conf.get("dapr", {}).get("enabled")),
                "revisions_mode": (conf.get("activeRevisionsMode")),
                "secrets_count": len(conf.get("secrets") or []),
                "registries": [r.get("server") for r in (conf.get("registries") or [])],
            }
        elif "microsoft.sql/servers/databases" in rt or "microsoft.sql/servers" in rt:
            config = {
                "max_size_gb": round((props.get("maxSizeBytes") or 0) / (1024**3), 1),
                "collation": props.get("collation"),
                "status": props.get("status"),
                "zone_redundant": props.get("zoneRedundant"),
                "read_scale": props.get("readScale"),
                "auto_pause_delay": props.get("autoPauseDelay"),
                "min_capacity": props.get("minCapacity"),
                "backup_storage_redundancy": props.get("requestedBackupStorageRedundancy"),
                "elastic_pool_id": props.get("elasticPoolId"),
            }
        elif "microsoft.dbforpostgresql" in rt or "microsoft.dbformysql" in rt:
            storage_cfg = props.get("storage") or {}
            ha = props.get("highAvailability") or {}
            backup = props.get("backup") or {}
            config = {
                "version": props.get("version"),
                "storage_gb": round((storage_cfg.get("storageSizeGB") or 0), 0),
                "iops": storage_cfg.get("iops"),
                "auto_grow": storage_cfg.get("autoGrow"),
                "ha_mode": ha.get("mode"),
                "ha_state": ha.get("state"),
                "backup_retention_days": backup.get("backupRetentionDays"),
                "geo_redundant_backup": backup.get("geoRedundantBackup"),
                "state": props.get("state"),
                "fqdn": props.get("fullyQualifiedDomainName"),
            }
        elif "microsoft.storage/storageaccounts" in rt:
            net_rules = props.get("networkAcls") or {}
            config = {
                "access_tier": props.get("accessTier"),
                "https_only": props.get("supportsHttpsTrafficOnly"),
                "min_tls_version": props.get("minimumTlsVersion"),
                "allow_blob_public": props.get("allowBlobPublicAccess"),
                "network_default_action": net_rules.get("defaultAction"),
                "encryption_services": list((props.get("encryption") or {}).get("services") or {}).keys() if (props.get("encryption") or {}).get("services") else [],
                "is_hns": props.get("isHnsEnabled"),
                "replication": props.get("primaryEndpoints") and "blob" in str(props.get("primaryEndpoints", {})),
            }
        elif "microsoft.keyvault/vaults" in rt:
            vault_props = props
            net_rules = vault_props.get("networkAcls") or {}
            config = {
                "sku_family": (vault_props.get("sku") or {}).get("family"),
                "enable_soft_delete": vault_props.get("enableSoftDelete"),
                "soft_delete_days": vault_props.get("softDeleteRetentionInDays"),
                "enable_purge_protection": vault_props.get("enablePurgeProtection"),
                "enable_rbac": vault_props.get("enableRbacAuthorization"),
                "network_default_action": net_rules.get("defaultAction"),
                "private_endpoints": len(vault_props.get("privateEndpointConnections") or []),
            }
        elif "microsoft.network/loadbalancers" in rt:
            config = {
                "frontend_configs": len(props.get("frontendIPConfigurations") or []),
                "backend_pools": len(props.get("backendAddressPools") or []),
                "lb_rules": len(props.get("loadBalancingRules") or []),
                "probes": len(props.get("probes") or []),
                "inbound_nat_rules": len(props.get("inboundNatRules") or []),
            }
        elif "microsoft.network/applicationgateways" in rt:
            config = {
                "waf_enabled": bool(props.get("webApplicationFirewallConfiguration")),
                "backend_pools": len(props.get("backendAddressPools") or []),
                "http_listeners": len(props.get("httpListeners") or []),
                "request_routing_rules": len(props.get("requestRoutingRules") or []),
                "ssl_certificates": len(props.get("sslCertificates") or []),
                "autoscale": (props.get("autoscaleConfiguration") or {}),
            }
        elif "microsoft.recoveryservices/vaults" in rt:
            config = {
                "sku_name": (props.get("sku") or {}).get("name"),
                "private_endpoints": len(props.get("privateEndpointConnections") or []),
            }
        else:
            # Generic — capture any useful top-level keys
            for key in ["state", "status", "version", "zoneRedundant", "publicNetworkAccess"]:
                if key in props:
                    config[key] = props[key]
        
        return {k: v for k, v in config.items() if v is not None}
    
    def scope_resources(self, 
                       assessment_id: str,
                       resources: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Add scoped resources to assessment
        
        Args:
            assessment_id: Assessment ID
            resources: List of resource dicts to add
        
        Returns:
            Summary of scoped resources
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # Clear existing resources
        cursor.execute("DELETE FROM assessment_resources WHERE assessment_id = ?", (assessment_id,))
        
        # Insert new resources
        for resource in resources:
            tags_val = resource.get("tags", "{}")
            if isinstance(tags_val, dict):
                tags_val = json.dumps(tags_val)
            # Save ALL extra fields as metadata JSON so AI analysis has full context
            metadata_fields = {
                k: v for k, v in resource.items()
                if k not in ("assessment_id", "resource_id", "resource_name", "resource_type",
                             "location", "resource_group", "subscription_id", "tags", "selected")
            }
            cursor.execute("""
                INSERT INTO assessment_resources (
                    assessment_id, resource_id, resource_name, resource_type,
                    location, resource_group, subscription_id, tags, selected, resource_metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
            """, (
                assessment_id,
                resource.get("resource_id"),
                resource.get("resource_name"),
                resource.get("resource_type"),
                resource.get("location"),
                resource.get("resource_group"),
                resource.get("subscription_id"),
                tags_val,
                json.dumps(metadata_fields)
            ))
        
        # Update assessment status
        cursor.execute("""
            UPDATE assessments 
            SET status = 'scoped', current_step = 3, updated_at = CURRENT_TIMESTAMP
            WHERE assessment_id = ?
        """, (assessment_id,))
        
        conn.commit()
        
        # Get summary
        cursor.execute("""
            SELECT COUNT(*), COUNT(DISTINCT resource_type), COUNT(DISTINCT location)
            FROM assessment_resources WHERE assessment_id = ?
        """, (assessment_id,))
        
        total, unique_types, unique_locations = cursor.fetchone()
        conn.close()
        
        return {
            "assessment_id": assessment_id,
            "total_resources": total,
            "unique_types": unique_types,
            "unique_locations": unique_locations,
            "status": "scoped"
        }
    
    # ============================================
    # STEP 3: AI Analysis with Scoring
    # ============================================
    
    def run_ai_analysis(self, assessment_id: str) -> Dict[str, Any]:
        """
        Run comprehensive AI analysis with scoring
        
        Args:
            assessment_id: Assessment ID
        
        Returns:
            Analysis results with scores
        """
        # Get assessment and resources
        conn = self._get_connection()
        cursor = conn.cursor()
        
        if is_azure_sql():
            cursor.execute("""
                SELECT a.assessment_id, a.assessment_name, a.assessment_type, a.service_type,
                       a.scope_type, a.scope_value, a.description, a.business_unit, a.owner,
                       a.status, a.current_step, a.created_at, a.updated_at, a.completed_at,
                       (SELECT COUNT(*) FROM assessment_resources r WHERE r.assessment_id = a.assessment_id) as resource_count
                FROM assessments a
                WHERE a.assessment_id = ?
            """, (assessment_id,))
        else:
            cursor.execute("""
                SELECT a.*, COUNT(r.resource_id) as resource_count
                FROM assessments a
                LEFT JOIN assessment_resources r ON a.assessment_id = r.assessment_id
                WHERE a.assessment_id = ?
                GROUP BY a.assessment_id
            """, (assessment_id,))
        
        assessment = dict(zip([col[0] for col in cursor.description], cursor.fetchone()))
        
        # Get resources (merge resource_metadata for full AI context)
        cursor.execute("""
            SELECT * FROM assessment_resources WHERE assessment_id = ?
        """, (assessment_id,))
        
        raw_resources = [dict(zip([col[0] for col in cursor.description], row)) for row in cursor.fetchall()]
        resources = []
        for r in raw_resources:
            meta_str = r.pop("resource_metadata", None)
            if meta_str:
                try:
                    meta = json.loads(meta_str)
                    r.update({k: v for k, v in meta.items() if k not in r or r[k] is None})
                except Exception:
                    pass
            resources.append(r)
        
        # Build analysis prompt
        prompt = self._build_analysis_prompt(assessment, resources)
        
        # Execute AI analysis
        if self.claude_client:
            analysis_result = self._analyze_with_claude(prompt)
        elif self.azure_openai_client:
            analysis_result = self._analyze_with_azure_openai(prompt)
        elif self.github_models_client:
            analysis_result = self._analyze_with_github_models(prompt)
        else:
            # Fallback to rule-based analysis
            analysis_result = self._fallback_analysis(resources)
        
        # Store analysis
        analysis_id = f"analysis-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        cursor.execute("""
            INSERT INTO assessment_analysis (
                analysis_id, assessment_id, analysis_type, overall_score,
                findings, recommendations, critical_gaps, warnings, opportunities
            ) VALUES (?, ?, 'comprehensive', ?, ?, ?, ?, ?, ?)
        """, (
            analysis_id,
            assessment_id,
            analysis_result["overall_score"],
            json.dumps(analysis_result["findings"]),
            json.dumps(analysis_result["recommendations"]),
            json.dumps(analysis_result["critical_gaps"]),
            json.dumps(analysis_result["warnings"]),
            json.dumps(analysis_result["opportunities"])
        ))
        
        # Update assessment
        cursor.execute("""
            UPDATE assessments 
            SET status = 'analyzed', current_step = 4, updated_at = CURRENT_TIMESTAMP
            WHERE assessment_id = ?
        """, (assessment_id,))
        
        conn.commit()
        conn.close()
        
        return {
            "analysis_id": analysis_id,
            "assessment_id": assessment_id,
            **analysis_result
        }
    
    def _build_analysis_prompt(self, assessment: Dict, resources: List[Dict]) -> str:
        """Build comprehensive AI analysis prompt with rich resource context."""
        # Build rich resource details (up to 50 resources)
        resource_details = []
        for r in resources[:50]:
            detail = {
                "name": r.get("resource_name", ""),
                "type": r.get("resource_type", ""),
                "location": r.get("location", ""),
                "resource_group": r.get("resource_group", ""),
                "sku": r.get("sku") or r.get("tier", ""),
                "monthly_cost": round(float(r.get("cost_current_month") or r.get("monthly_cost") or 0), 2),
                "utilization_pct": r.get("primary_utilization_pct") or r.get("utilization_pct"),
                "has_backup": r.get("has_backup", False),
                "has_lock": r.get("has_lock", False),
                "score_label": r.get("score_label", "Unknown"),
                "tags": r.get("tags", {}),
            }
            resource_details.append(detail)

        # Enrich with custom tags
        try:
            import services.tagging_service as tag_svc
            all_tags = tag_svc.get_all_custom_tags()
            if all_tags:
                tags_lower = {k.lower(): v for k, v in all_tags.items()}
                for r_detail, r_raw in zip(resource_details, resources[:50]):
                    rid = (r_raw.get("resource_id") or "").lower()
                    if rid in tags_lower:
                        r_detail["custom_tags"] = tags_lower[rid]
        except Exception:
            pass

        # ── Fetch on-prem server context for hybrid assessment ──
        onprem_section = ""
        try:
            from services.onprem_service import get_onprem_ai_context
            onprem_ctx = get_onprem_ai_context()
            if onprem_ctx and onprem_ctx.get("total_servers", 0) > 0:
                onprem_section = f"""

=== ON-PREMISES INFRASTRUCTURE ===
Total On-Prem Servers: {onprem_ctx['total_servers']}
Total Cores: {onprem_ctx['total_cores']}
Total Memory: {onprem_ctx['total_memory_gb']} GB
Total Storage: {onprem_ctx['total_storage_gb']} GB
Server Details:
{_json.dumps(onprem_ctx['servers'][:20], indent=2)}

IMPORTANT: Include on-premises servers in your migration and hybrid cloud recommendations.
Assess each server's migration readiness, recommended Azure landing zone, and migration approach (rehost/refactor/rearchitect).
Flag any servers running end-of-life OS, missing security controls, or running legacy workloads.
"""
        except Exception:
            pass

        # Aggregate stats
        total_cost = sum(float(r.get("cost_current_month") or r.get("monthly_cost") or 0) for r in resources)
        type_counts = {}
        location_counts = {}
        no_backup_count = 0
        for r in resources:
            rt = (r.get("resource_type") or "").split("/")[-1]
            type_counts[rt] = type_counts.get(rt, 0) + 1
            loc = r.get("location", "unknown")
            location_counts[loc] = location_counts.get(loc, 0) + 1
            if not r.get("has_backup"):
                no_backup_count += 1

        import json as _json
        return f"""You are a senior Microsoft Azure infrastructure assessment expert specializing in
BCDR, security, cost optimization, and operational excellence for enterprise workloads.

=== ASSESSMENT CONTEXT ===
Assessment Name: {assessment['assessment_name']}
Assessment Type: {assessment['assessment_type']}
Description: {assessment.get('description', 'N/A')}
Business Unit: {assessment.get('business_unit', 'N/A')}
Total Resources: {assessment['resource_count']}
Total Monthly Cost: ${total_cost:,.2f}

=== ESTATE SUMMARY ===
Resource Types: {_json.dumps(dict(sorted(type_counts.items(), key=lambda x: -x[1])[:15]))}
Locations: {_json.dumps(location_counts)}
Resources Without Backup: {no_backup_count} of {len(resources)}
{onprem_section}
=== QATAR CENTRAL CONSTRAINTS ===
- Zone Redundancy is NOT available in Qatar Central
- Qatar Central has NO paired region — manual DR setup required
- GRS storage NOT available — use Object Replication for cross-region
- DR targets: UAE North (primary), West Europe/North Europe (NIA-certified)
- Qatar PDPPL governs cross-border data transfer

=== RESOURCE DETAILS ({len(resource_details)} of {len(resources)}) ===
{_json.dumps(resource_details, indent=2)}

Provide a comprehensive, actionable assessment. Each finding and recommendation must be:
- Specific to resources in this assessment (cite resource names)
- Include estimated effort and business impact
- Prioritized by risk and impact

Return a JSON object with this EXACT structure:
{{
    "overall_score": 0-100,
    "findings": [
        {{"finding": "specific finding text", "severity": "Critical|High|Medium|Low", "category": "BCDR|Security|Cost|Performance|Governance", "affected_resources": ["name1", "name2"]}}
    ],
    "critical_gaps": [
        {{"gap": "description", "risk": "what could happen", "remediation": "specific steps", "priority": "P1|P2|P3", "affected_count": number}}
    ],
    "warnings": [
        {{"warning": "description", "category": "BCDR|Security|Cost|Performance", "recommendation": "what to do"}}
    ],
    "recommendations": [
        {{"title": "actionable title", "description": "detailed steps", "priority": "P1|P2|P3|P4", "effort": "Low|Medium|High", "impact": "Low|Medium|High", "estimated_savings_monthly": number, "resources": ["name1"]}}
    ],
    "opportunities": [
        {{"title": "opportunity", "description": "details", "type": "cost_savings|modernization|security|resilience", "estimated_value": "description of value"}}
    ]
}}"""
    
    def _analyze_with_claude(self, prompt: str) -> Dict[str, Any]:
        """Analyze using Claude"""
        try:
            response = self.claude_client.messages.create(
                model="claude-opus-4-20250514",
                max_tokens=8000,
                system="You are a senior Azure infrastructure architect and BCDR specialist. "
                       "Provide specific, actionable analysis citing exact resource names. "
                       "Output strict JSON only — no markdown, no prose outside the JSON structure.",
                messages=[{"role": "user", "content": prompt}]
            )
            
            content = response.content[0].text
            # Try to extract JSON
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            
            return json.loads(content)
        except Exception as e:
            print(f"⚠️ Claude analysis failed: {e}")
            return self._fallback_analysis([])
    
    def _analyze_with_azure_openai(self, prompt: str) -> Dict[str, Any]:
        """Analyze using Azure OpenAI"""
        try:
            response = self.azure_openai_client.chat.completions.create(
                model=os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini"),
                messages=[
                    {"role": "system", "content": "You are a senior Azure infrastructure architect and BCDR specialist. "
                       "Provide specific, actionable analysis citing exact resource names. "
                       "Output strict JSON only."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_completion_tokens=6000,
            )
            
            content = response.choices[0].message.content
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            
            return json.loads(content)
        except Exception as e:
            print(f"⚠️ Azure OpenAI analysis failed: {e}")
            return self._fallback_analysis([])

    def _analyze_with_github_models(self, prompt: str) -> Dict[str, Any]:
        """Analyze using GitHub Models API"""
        try:
            response = self.github_models_client.chat.completions.create(
                model="claude-sonnet-4-5",
                messages=[
                    {"role": "system", "content": "You are a senior Azure infrastructure architect and BCDR specialist. "
                       "Provide specific, actionable analysis citing exact resource names. "
                       "Output strict JSON only — no markdown, no prose outside the JSON structure."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=8000,
            )
            content = response.choices[0].message.content
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()
            return json.loads(content)
        except Exception as e:
            print(f"⚠️ GitHub Models analysis failed: {e}")
            return self._fallback_analysis([])

    def _fallback_analysis(self, resources: List[Dict]) -> Dict[str, Any]:
        """Rule-based fallback analysis"""
        return {
            "overall_score": 65,
            "findings": [
                "Assessment completed with basic rule-based analysis",
                f"Total resources analyzed: {len(resources)}"
            ],
            "critical_gaps": [
                "Enable AI analysis by configuring ANTHROPIC_API_KEY or AZURE_OPENAI_ENDPOINT"
            ],
            "warnings": [
                "Running in limited mode without AI analysis"
            ],
            "recommendations": [
                "Configure AI credentials for comprehensive analysis",
                "Review BCDR requirements for all resources",
                "Implement backup policies",
                "Enable security monitoring"
            ],
            "opportunities": [
                "Cost optimization potential identified",
                "Modernization opportunities available"
            ]
        }
    
    # ============================================
    # STEP 4: APEX Sequential Execution
    # ============================================
    
    def start_apex_workflow(self, assessment_id: str) -> Dict[str, Any]:
        """
        Start APEX agent sequential execution
        
        Args:
            assessment_id: Assessment ID
        
        Returns:
            Workflow status
        """
        workflow_id = f"workflow-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # Check if there's already a running workflow for this assessment - reset it
        cursor.execute("""
            UPDATE assessment_apex_workflow SET status = 'cancelled'
            WHERE assessment_id = ? AND status = 'running'
        """, (assessment_id,))
        
        cursor.execute("""
            INSERT INTO assessment_apex_workflow (
                workflow_id, assessment_id, agent_sequence, current_agent_index,
                agents_completed, agents_failed, status, started_at
            ) VALUES (?, ?, ?, 0, '[]', '[]', 'running', CURRENT_TIMESTAMP)
        """, (workflow_id, assessment_id, json.dumps(self.APEX_AGENT_SEQUENCE)))
        
        # Update assessment
        cursor.execute("""
            UPDATE assessments 
            SET status = 'apex-running', current_step = 4, updated_at = CURRENT_TIMESTAMP
            WHERE assessment_id = ?
        """, (assessment_id,))
        
        conn.commit()
        conn.close()
        
        # Kick off background execution
        import threading
        thread = threading.Thread(
            target=self._execute_apex_workflow_sync,
            args=(workflow_id, assessment_id),
            daemon=True
        )
        thread.start()
        
        return {
            "workflow_id": workflow_id,
            "assessment_id": assessment_id,
            "total_agents": len(self.APEX_AGENT_SEQUENCE),
            "status": "running"
        }
    
    def _execute_apex_workflow_sync(self, workflow_id: str, assessment_id: str, 
                                      resume_from_idx: int = 0, 
                                      existing_completed: list = None,
                                      existing_failed: list = None):
        """Execute APEX agents sequentially in a background thread.
        Supports resuming from a specific index with pre-existing completed/failed lists."""
        import time

        # Register this workflow as active so duplicate resume calls are blocked.
        self._active_workflows.add(workflow_id)
        try:
            # Load assessment context
            assessment = self.get_assessment(assessment_id)
            resources = assessment.get("resources", [])
            analysis = assessment.get("analysis", {})
            
            resource_summary = "\n".join([
                f"- {r.get('resource_name','?')} ({r.get('resource_type','?')}) in {r.get('location','?')}"
                for r in resources[:50]
            ])
            
            completed = list(existing_completed) if existing_completed else []
            failed = list(existing_failed) if existing_failed else []
            previous_outputs = {}
            
            # If resuming, load previous outputs from DB for context
            if resume_from_idx > 0:
                conn = self._get_connection()
                cursor = conn.cursor()
                for agent_name in completed:
                    exec_id = f"exec-{workflow_id}-{agent_name}"
                    cursor.execute("SELECT output_data FROM agent_executions WHERE execution_id = ?", (exec_id,))
                    row = cursor.fetchone()
                    if row and row[0]:
                        try:
                            previous_outputs[agent_name] = json.loads(row[0])
                        except:
                            previous_outputs[agent_name] = row[0]
                conn.close()
                print(f"🔄 Loaded {len(previous_outputs)} previous agent outputs for context")
            
            for idx, agent_name in enumerate(self.APEX_AGENT_SEQUENCE):
                # Skip agents before resume point
                if idx < resume_from_idx:
                    continue
                # Update current agent index
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE assessment_apex_workflow 
                    SET current_agent_index = ?
                    WHERE workflow_id = ?
                """, (idx, workflow_id))
                conn.commit()
                conn.close()
                
                execution_id = f"exec-{workflow_id}-{agent_name}"
                
                try:
                    # Record execution start — use upsert so a resume
                    # that re-runs a previously-failed/stuck agent doesn't crash on
                    # the UNIQUE CONSTRAINT for execution_id.
                    conn = self._get_connection()
                    cursor = conn.cursor()
                    _upsert = upsert_conflict_sql(
                        "agent_executions",
                        insert_cols=["execution_id", "assessment_id", "agent_name", "status", "started_at"],
                        pk_cols=["execution_id"],
                        update_cols=["status", "started_at", "output_data", "error_message", "completed_at"],
                        update_exprs={"status": "'running'", "started_at": "CURRENT_TIMESTAMP",
                                      "output_data": "NULL", "error_message": "NULL", "completed_at": "NULL"},
                    )
                    _params = (execution_id, assessment_id, agent_name, 'running', None)
                    cursor.execute(_upsert, _params)
                    conn.commit()
                    conn.close()
                    
                    # Execute agent
                    output = self._execute_single_agent(
                        agent_name, assessment, resources, analysis, 
                        resource_summary, previous_outputs
                    )
                    
                    previous_outputs[agent_name] = output
                    completed.append(agent_name)
                    
                    # Record execution success
                    conn = self._get_connection()
                    cursor = conn.cursor()
                    cursor.execute("""
                        UPDATE agent_executions 
                        SET status = 'completed', output_data = ?, completed_at = CURRENT_TIMESTAMP
                        WHERE execution_id = ?
                    """, (json.dumps(output) if isinstance(output, dict) else str(output), execution_id))
                    
                    cursor.execute("""
                        UPDATE assessment_apex_workflow 
                        SET agents_completed = ?, current_agent_index = ?
                        WHERE workflow_id = ?
                    """, (json.dumps(completed), idx + 1, workflow_id))
                    conn.commit()
                    conn.close()
                    
                except Exception as e:
                    print(f"⚠️ APEX agent {agent_name} failed: {e}")
                    failed.append(agent_name)
                    
                    conn = self._get_connection()
                    cursor = conn.cursor()
                    cursor.execute("""
                        UPDATE agent_executions 
                        SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
                        WHERE execution_id = ?
                    """, (str(e), execution_id))
                    
                    cursor.execute("""
                        UPDATE assessment_apex_workflow 
                        SET agents_failed = ?, current_agent_index = ?
                        WHERE workflow_id = ?
                    """, (json.dumps(failed), idx + 1, workflow_id))
                    conn.commit()
                    conn.close()
                
                # Small pause between agents
                time.sleep(1)
            
            # Mark workflow complete
            final_status = "completed" if len(failed) == 0 else "completed_with_errors"
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE assessment_apex_workflow 
                SET status = ?, agents_completed = ?, agents_failed = ?, 
                    current_agent_index = ?, completed_at = CURRENT_TIMESTAMP
                WHERE workflow_id = ?
            """, (final_status, json.dumps(completed), json.dumps(failed), 
                  len(self.APEX_AGENT_SEQUENCE), workflow_id))
            
            cursor.execute("""
                UPDATE assessments 
                SET status = 'completed', current_step = 5, updated_at = CURRENT_TIMESTAMP
                WHERE assessment_id = ?
            """, (assessment_id,))
            conn.commit()
            conn.close()
            
            print(f"✅ APEX workflow {workflow_id} completed: {len(completed)} succeeded, {len(failed)} failed")
            
        except Exception as e:
            print(f"❌ APEX workflow {workflow_id} crashed: {e}")
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE assessment_apex_workflow 
                SET status = 'failed', completed_at = CURRENT_TIMESTAMP
                WHERE workflow_id = ?
            """, (workflow_id,))
            cursor.execute("""
                UPDATE assessments SET status = 'failed' WHERE assessment_id = ?
            """, (assessment_id,))
            conn.commit()
            conn.close()
        finally:
            # Always deregister so a future resume can create a new thread.
            self._active_workflows.discard(workflow_id)
    
    def _execute_single_agent(self, agent_name: str, assessment: Dict, 
                               resources: List[Dict], analysis: Optional[Dict],
                               resource_summary: str, previous_outputs: Dict) -> Dict:
        """Execute a single APEX agent with rich resource context and chained output"""
        
        # Build detailed resource inventory with config, SKU, dependencies
        resource_inventory = self._build_rich_resource_inventory(resources)
        # Detect inter-dependencies between resources
        dependency_map = self._detect_resource_dependencies(resources)
        # Build solution context (treating all resources as one workload)
        solution_context = self._build_solution_context(assessment, resources, analysis)
        
        # Serialize previous outputs with generous limits for context chaining
        prev_context = ""
        for prev_agent, prev_output in previous_outputs.items():
            serialized = json.dumps(prev_output, default=str)
            # Give more context to important upstream agents
            limit = 6000 if prev_agent in ("02-requirements", "03-architect", "05-iac-planner") else 4000
            prev_context += f"\n\n=== OUTPUT FROM {prev_agent.upper()} ===\n{serialized[:limit]}"
        
        # Common context block shared by all agents
        common_context = f"""
=== ASSESSMENT CONTEXT ===
Assessment Name: {assessment.get('assessment_name', 'N/A')}
Assessment Type: {assessment.get('assessment_type', 'N/A')}
Description: {assessment.get('description', 'N/A')}
Business Unit: {assessment.get('business_unit', 'N/A')}
Total Resources: {len(resources)}

=== SOLUTION CONTEXT ===
{json.dumps(solution_context, indent=2)}

=== RESOURCE INVENTORY (Detailed) ===
{resource_inventory}

=== RESOURCE DEPENDENCIES ===
{json.dumps(dependency_map, indent=2)}
"""
        if analysis:
            findings_json = analysis.get("findings", "[]")
            if isinstance(findings_json, str):
                try:
                    findings_list = json.loads(findings_json)
                except:
                    findings_list = [findings_json]
            else:
                findings_list = findings_json
            
            recs_json = analysis.get("recommendations", "[]")
            if isinstance(recs_json, str):
                try:
                    recs_list = json.loads(recs_json)
                except:
                    recs_list = [recs_json]
            else:
                recs_list = recs_json
            
            common_context += f"""
=== AI ANALYSIS RESULTS (Score: {analysis.get('overall_score', 'N/A')}/100) ===
Critical Gaps: {analysis.get('critical_gaps', '[]')}
Key Findings: {json.dumps(findings_list[:10], default=str)}
Top Recommendations: {json.dumps(recs_list[:10], default=str)}
"""
        
        # ─── PRIMARY EXECUTION: Load actual .agent.md from apex-integration/agents/ ───
        # The APEX agent files define each agent's persona, tools, and instructions.
        # We use the .agent.md markdown body as the AI system prompt so those definitions
        # are actually used — the resource context becomes the user message.
        agent_system_prompt = self._load_agent_system_prompt(agent_name)

        output_guidance = {
            "02-requirements": (
                "Return JSON: {project_name, business_context{description,environment,criticality}, "
                "functional_requirements[{id,title,description,source_resources,priority}], "
                "non_functional_requirements{availability,performance,scalability,security,disaster_recovery}, "
                "infrastructure_requirements[], dependency_requirements[], compliance_requirements[], constraints{}}"
            ),
            "03-architect": (
                "Return JSON: {architecture_pattern, architecture_summary, "
                "waf_assessment{reliability,security,cost_optimization,operational_excellence,performance_efficiency "
                "each with score(1-10)+current_state+gaps[]+recommendations[]}, "
                "components[{name,type,current_sku,recommended_sku,purpose,tier,configuration_review}], "
                "network_design{topology,vnets,private_endpoints,connectivity}, data_flow[], "
                "sku_recommendations[], reliability_design, security_design, cost_estimate}"
            ),
            "04-design": (
                "Return JSON: {compute_design[], storage_design[], database_design[], "
                "network_security[], identity[], monitoring[], "
                "mermaid_architecture_diagram (full mermaid graph showing ALL selected resources with labels)}"
            ),
            "04g-governance": (
                "Return JSON: {policies[], naming_convention{pattern,current_compliance,non_compliant_resources[]}, "
                "tagging_strategy[{tag_key,required,current_coverage}], cost_controls[], "
                "compliance_controls[], rbac_recommendations[]}"
            ),
            "05-iac-planner": (
                "Return JSON: {iac_tool, deployment_strategy{approach,phases[{phase,name,resources[],dependencies}]}, "
                "modules[{name,path,avm_module,resources[],parameters[],dependencies[]}], "
                "parameters[{name,type,default_value,source_resources[]}], "
                "parameter_files[], pipeline_stages[], environments[]}"
            ),
            "06b-bicep-codegen": (
                "Return JSON: {main_template (complete Bicep code string), "
                "modules[{name,path,content (complete Bicep module code),resources_deployed[]}], "
                "parameter_file (full .bicepparam content), deployment_script (PowerShell), "
                "avm_modules_used[], resource_count}"
            ),
            "08-as-built": (
                "Return JSON: {summary, solution_overview{architecture_pattern,total_resources,regions[],resource_groups[]}, "
                "resource_inventory[ALL selected resources with name,type,sku,location,key_config{}], "
                "architecture_description, configurations[], "
                "operations{monitoring_setup[],alerting_rules[],scaling_procedures[]}, "
                "dr_procedures{backup_config[],failover_steps[],rpo_rto_current{}}, "
                "security_posture{identity_management[],network_security[],data_protection[]}, "
                "cost_analysis{monthly_breakdown[],optimization_opportunities[]}}"
            ),
        }

        user_message = (
            f'WORKLOAD ASSESSMENT: "{assessment.get("assessment_name", "Assessment")}"\n'
            f'Assessment Type: {assessment.get("assessment_type", "N/A")} | '
            f'Total Selected Resources: {len(resources)} | '
            f'Business Unit: {assessment.get("business_unit", "N/A")}\n\n'
            f'{common_context}\n\n'
            f'AGENT TASK — {agent_name.upper()}:\n'
            f'{output_guidance.get(agent_name, "Produce a comprehensive JSON analysis.")}\n\n'
            f'CRITICAL RULES:\n'
            f'- Use the EXACT resource names from the inventory above — cover ALL {len(resources)} resources\n'
            f'- Do NOT substitute generic names like "App Service" or "Azure SQL"\n'
            f'- Every component/module/requirement must map to an actual resource in the inventory\n'
            f'- Return ONLY valid JSON — no markdown fences, no explanatory text outside the JSON\n'
            f'{prev_context}'
        )

        # Execute: Claude → Azure OpenAI → GitHub Models → resource-aware fallback
        if self.claude_client:
            return self._run_agent_with_claude(agent_name, user_message, agent_system_prompt, _assessment=assessment)
        elif self.azure_openai_client:
            return self._run_agent_with_openai(agent_name, user_message, agent_system_prompt, _assessment=assessment)
        elif self.github_models_client:
            return self._run_agent_with_github_models(agent_name, user_message, agent_system_prompt, _assessment=assessment)
        else:
            print(f"⚠️  No AI client available — resource-aware fallback for {agent_name}")
            return self._run_agent_fallback(agent_name, assessment)
    
    def _build_rich_resource_inventory(self, resources: List[Dict]) -> str:
        """Build a detailed resource inventory string for agent prompts."""
        lines = []
        for idx, r in enumerate(resources[:40]):
            name = r.get("resource_name", "?")
            rtype = r.get("resource_type", "?")
            loc = r.get("location", "?")
            rg = r.get("resource_group", "?")
            sku = r.get("sku_name") or r.get("sku") or r.get("sku_tier") or ""
            kind = r.get("kind", "")
            state = r.get("provisioning_state", "")
            
            # Parse config if available
            config_str = ""
            config_raw = r.get("config", "{}")
            if isinstance(config_raw, str):
                try:
                    config = json.loads(config_raw)
                except:
                    config = {}
            else:
                config = config_raw or {}
            
            if config:
                config_items = []
                for k, v in list(config.items())[:8]:
                    if v and v != "" and v != "None":
                        config_items.append(f"{k}={v}")
                if config_items:
                    config_str = " | Config: " + ", ".join(config_items)
            
            tags_raw = r.get("tags", "{}")
            if isinstance(tags_raw, str):
                try:
                    tags = json.loads(tags_raw)
                except:
                    tags = {}
            else:
                tags = tags_raw or {}
            tag_str = ""
            if tags:
                tag_items = [f"{k}={v}" for k, v in list(tags.items())[:5]]
                tag_str = " | Tags: " + ", ".join(tag_items)
            
            line = f"  [{idx+1}] {name} ({rtype})"
            if sku:
                line += f" SKU:{sku}"
            if kind:
                line += f" Kind:{kind}"
            line += f" | Location:{loc} | RG:{rg}"
            if state:
                line += f" | State:{state}"
            line += config_str + tag_str
            lines.append(line)
        
        if len(resources) > 40:
            lines.append(f"  ... and {len(resources) - 40} more resources")
        
        return "\n".join(lines)
    
    def _detect_resource_dependencies(self, resources: List[Dict]) -> Dict[str, Any]:
        """Detect inter-resource dependencies from resource IDs and config."""
        dependencies = []
        resource_map = {}
        
        for r in resources:
            name = r.get("resource_name", "")
            rtype = (r.get("resource_type") or "").lower()
            resource_map[name] = r
            
            # Parse config for references to other resources
            config_raw = r.get("config", "{}")
            if isinstance(config_raw, str):
                try:
                    config = json.loads(config_raw)
                except:
                    config = {}
            else:
                config = config_raw or {}
            
            # Check for server_farm_id (App Service → App Service Plan)
            if config.get("server_farm_id"):
                plan_name = config["server_farm_id"].split("/")[-1]
                dependencies.append({
                    "from": name, "to": plan_name,
                    "type": "hosting", "description": f"{name} is hosted on App Service Plan {plan_name}"
                })
            
            # Check for managed_env_id (Container App → Container Apps Environment)
            if config.get("managed_env_id"):
                env_name = config["managed_env_id"].split("/")[-1]
                dependencies.append({
                    "from": name, "to": env_name,
                    "type": "hosting", "description": f"{name} runs in Container Apps Environment {env_name}"
                })
            
            # Check for registries (Container App → Container Registry)
            for reg in (config.get("registries") or []):
                if reg:
                    dependencies.append({
                        "from": name, "to": reg,
                        "type": "image_source", "description": f"{name} pulls images from {reg}"
                    })
            
            # Check for elastic_pool_id (SQL DB → Elastic Pool)
            if config.get("elastic_pool_id"):
                pool_name = config["elastic_pool_id"].split("/")[-1]
                dependencies.append({
                    "from": name, "to": pool_name,
                    "type": "data", "description": f"{name} is part of elastic pool {pool_name}"
                })
        
        # Detect same-RG co-location patterns
        rg_groups = {}
        for r in resources:
            rg = r.get("resource_group", "")
            if rg not in rg_groups:
                rg_groups[rg] = []
            rg_groups[rg].append(r.get("resource_name", ""))
        
        return {
            "explicit_dependencies": dependencies,
            "resource_group_colocation": {rg: names for rg, names in rg_groups.items() if len(names) > 1},
            "total_dependencies_detected": len(dependencies)
        }
    
    def _build_solution_context(self, assessment: Dict, resources: List[Dict], analysis: Optional[Dict]) -> Dict:
        """Build high-level solution context treating all resources as one workload."""
        type_counts = {}
        locations = set()
        rgs = set()
        skus = []
        
        for r in resources:
            rt = (r.get("resource_type") or "").split("/")[-1]
            type_counts[rt] = type_counts.get(rt, 0) + 1
            locations.add(r.get("location", "unknown"))
            rgs.add(r.get("resource_group", "unknown"))
            sku = r.get("sku_name") or r.get("sku_tier") or ""
            if sku:
                skus.append(f"{r.get('resource_name','?')}:{sku}")
        
        # Detect workload pattern
        has_web = any("web" in (r.get("resource_type") or "").lower() or "app" in (r.get("resource_type") or "").lower() for r in resources)
        has_db = any("sql" in (r.get("resource_type") or "").lower() or "postgres" in (r.get("resource_type") or "").lower() or "cosmos" in (r.get("resource_type") or "").lower() for r in resources)
        has_container = any("container" in (r.get("resource_type") or "").lower() or "kubernetes" in (r.get("resource_type") or "").lower() for r in resources)
        has_storage = any("storage" in (r.get("resource_type") or "").lower() for r in resources)
        has_networking = any("network" in (r.get("resource_type") or "").lower() or "loadbalancer" in (r.get("resource_type") or "").lower() for r in resources)
        
        if has_container and has_db:
            pattern = "Containerized microservices with data tier"
        elif has_web and has_db:
            pattern = "N-tier web application with data tier"
        elif has_container:
            pattern = "Containerized workload"
        elif has_web:
            pattern = "Web application workload"
        else:
            pattern = "Mixed Azure workload"
        
        return {
            "workload_pattern": pattern,
            "resource_type_breakdown": dict(sorted(type_counts.items(), key=lambda x: -x[1])),
            "locations": list(locations),
            "resource_groups": list(rgs),
            "sku_summary": skus[:20],
            "has_web_tier": has_web,
            "has_data_tier": has_db,
            "has_container_tier": has_container,
            "has_storage": has_storage,
            "has_networking": has_networking,
            "qatar_central_constraints": any("qatar" in loc.lower() for loc in locations),
        }
    
    def _run_agent_with_claude(self, agent_name: str, prompt: str, system_prompt: str = None, _assessment: Dict = None) -> Dict:
        """Run agent using Claude with timeout protection and high token limits."""
        timeout_sec = AGENT_TIMEOUT_SECONDS.get(agent_name, DEFAULT_AGENT_TIMEOUT)

        def _call_claude():
            token_limits = {
                "02-requirements": 8000,
                "03-architect": 10000,
                "04-design": 10000,
                "04g-governance": 6000,
                "05-iac-planner": 8000,
                "06b-bicep-codegen": 12000,
                "08-as-built": 10000,
            }
            max_tokens = token_limits.get(agent_name, 8000)
            effective_system = system_prompt or (
                "You are a Principal Azure Solutions Architect generating detailed, production-quality "
                "infrastructure assessments. Base ALL analysis on the actual resource configurations provided. "
                "Output strict JSON only — no markdown wrapping, no prose outside the JSON structure. "
                "Every recommendation must reference specific resource names from the inventory."
            )
            return self.claude_client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=max_tokens,
                timeout=timeout_sec,
                system=effective_system,
                messages=[{"role": "user", "content": prompt}]
            )
        
        try:
            # Use ThreadPoolExecutor for hard timeout enforcement
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(_call_claude)
                response = future.result(timeout=timeout_sec + 30)  # extra 30s grace
            
            content = response.content[0].text
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()
            try:
                return json.loads(content)
            except json.JSONDecodeError:
                return {"agent": agent_name, "output": content[:2000], "format": "text"}
        except FuturesTimeoutError:
            print(f"⏱️ Claude agent {agent_name} TIMED OUT after {timeout_sec}s — using fallback")
            return self._run_agent_fallback(agent_name, _assessment or {})
        except Exception as e:
            print(f"⚠️ Claude agent {agent_name} error: {e}")
            return self._run_agent_fallback(agent_name, _assessment or {})

    def _run_agent_with_openai(self, agent_name: str, prompt: str, system_prompt: str = None, _assessment: Dict = None) -> Dict:
        """Run agent using Azure OpenAI with timeout protection and high token limits."""
        timeout_sec = AGENT_TIMEOUT_SECONDS.get(agent_name, DEFAULT_AGENT_TIMEOUT)

        def _call_openai():
            token_limits = {
                "02-requirements": 6000,
                "03-architect": 8000,
                "04-design": 8000,
                "04g-governance": 4000,
                "05-iac-planner": 6000,
                "06b-bicep-codegen": 8000,
                "08-as-built": 8000,
            }
            max_tokens = token_limits.get(agent_name, 6000)
            effective_system = system_prompt or (
                "You are a Principal Azure Solutions Architect generating detailed, "
                "production-quality infrastructure assessments. Base ALL analysis on actual resource configurations. "
                "Output strict JSON only. Reference specific resource names in every recommendation."
            )
            return self.azure_openai_client.chat.completions.create(
                model=os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini"),
                messages=[
                    {"role": "system", "content": effective_system},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_completion_tokens=max_tokens,
            )
        
        try:
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(_call_openai)
                response = future.result(timeout=timeout_sec + 30)
            
            content = response.choices[0].message.content
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()
            try:
                return json.loads(content)
            except json.JSONDecodeError:
                return {"agent": agent_name, "output": content[:2000], "format": "text"}
        except FuturesTimeoutError:
            print(f"⏱️ OpenAI agent {agent_name} TIMED OUT after {timeout_sec}s — using fallback")
            return self._run_agent_fallback(agent_name, _assessment or {})
        except Exception as e:
            print(f"⚠️ OpenAI agent {agent_name} error: {e}")
            return self._run_agent_fallback(agent_name, _assessment or {})

    def _run_agent_with_github_models(self, agent_name: str, prompt: str, system_prompt: str = None, _assessment: Dict = None) -> Dict:
        """Run agent using GitHub Models API (GITHUB_TOKEN — no extra API key needed)."""
        timeout_sec = AGENT_TIMEOUT_SECONDS.get(agent_name, DEFAULT_AGENT_TIMEOUT)
        # GitHub Models supports Claude Sonnet 4.5 and other frontier models
        GITHUB_MODEL = "claude-sonnet-4-5"
        token_limits = {
            "02-requirements": 8000, "03-architect": 10000, "04-design": 10000,
            "04g-governance": 6000, "05-iac-planner": 8000,
            "06b-bicep-codegen": 12000, "08-as-built": 10000,
        }
        max_tokens = token_limits.get(agent_name, 8000)
        effective_system = system_prompt or (
            "You are a Principal Azure Solutions Architect generating detailed, production-quality "
            "infrastructure assessments. Base ALL analysis on the actual resource configurations provided. "
            "Output strict JSON only — no markdown wrapping, no prose outside the JSON structure. "
            "Every recommendation must reference specific resource names from the inventory."
        )

        def _call_github():
            return self.github_models_client.chat.completions.create(
                model=GITHUB_MODEL,
                messages=[
                    {"role": "system", "content": effective_system},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=max_tokens,
            )

        try:
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(_call_github)
                response = future.result(timeout=timeout_sec + 30)

            content = response.choices[0].message.content
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()
            try:
                return json.loads(content)
            except json.JSONDecodeError:
                return {"agent": agent_name, "output": content[:2000], "format": "text"}
        except FuturesTimeoutError:
            print(f"⏱️ GitHub Models agent {agent_name} TIMED OUT — using fallback")
            return self._run_agent_fallback(agent_name, _assessment or {})
        except Exception as e:
            print(f"⚠️ GitHub Models agent {agent_name} error: {e} — trying fallback")
            return self._run_agent_fallback(agent_name, _assessment or {})

    def _run_agent_fallback(self, agent_name: str, assessment: Dict) -> Dict:
        """Fallback output when no AI is available — uses ACTUAL selected resources"""
        resources = assessment.get("resources", [])
        resource_names = [r.get("resource_name", r.get("name", "unknown")) for r in resources[:30]]
        resource_list = [
            {"name": r.get("resource_name", "?"), "type": r.get("resource_type", "?"), "location": r.get("location", "?")}
            for r in resources[:30]
        ]
        assessment_name = assessment.get("assessment_name", "Assessment")
        total = len(resources)

        templates = {
            "02-requirements": {
                "requirements": [
                    f"High availability for {total} selected resources",
                    "RPO < 1 hour for critical workloads",
                    "RTO < 4 hours for production services",
                    "Data encryption at rest and in transit",
                    f"Disaster recovery coverage for all {total} scoped resources"
                ],
                "nfr": ["99.9% uptime SLA", "< 200ms latency for user-facing services"],
                "bcdr_targets": {"rpo": "1 hour", "rto": "4 hours"},
                "compliance": ["Azure Security Benchmark"],
                "in_scope_resources": resource_list
            },
            "03-architect": {
                "architecture_pattern": "N-tier with availability zones",
                "components": resource_list,
                "resource_names": resource_names,
                "network_design": {"topology": "Hub-spoke", "zones": "Multi-AZ"},
                "data_flow": [f"Covering {total} resources in assessment: {assessment_name}"]
            },
            "04-design": {
                "compute_design": [f"Review and right-size: {', '.join(resource_names[:10])}"],
                "storage_design": ["Enable GRS replication", "Enable soft delete"],
                "network_security": ["NSG per subnet", "Azure Firewall for egress"],
                "identity": ["Managed Identity", "RBAC least privilege"],
                "monitoring": ["Application Insights", "Azure Monitor alerts"],
                "resources_covered": resource_list
            },
            "04g-governance": {
                "policies": ["Require tags", "Allowed locations", "Require encryption"],
                "naming_convention": "{resource}-{workload}-{env}-{region}-{instance}",
                "tagging_strategy": ["Environment", "CostCenter", "Owner", "Application"],
                "cost_controls": ["Budget alerts", "Auto-shutdown dev resources"],
                "compliance_controls": ["Azure Security Benchmark", "CIS"],
                "resources_in_scope": resource_names
            },
            "05-iac-planner": {
                "iac_tool": "bicep",
                "modules": list(set([
                    r.get("resource_type", "").split("/")[-1].lower().replace(" ", "-")
                    for r in resources[:20] if r.get("resource_type")
                ])) or ["networking", "compute", "database", "monitoring", "security"],
                "resources_to_deploy": resource_list,
                "parameters": ["environment", "location", "sku_tier"],
                "pipeline_stages": ["validate", "preview", "deploy", "smoke-test"],
                "environments": ["dev", "staging", "production"]
            },
            "06b-bicep-codegen": {
                "main_template": f"main.bicep — covering {total} resources",
                "modules": [
                    f"modules/{r.get('resource_type','').split('/')[-1].lower()}.bicep"
                    for r in resources[:10] if r.get("resource_type")
                ] or ["modules/vnet.bicep", "modules/app.bicep", "modules/db.bicep"],
                "resources_defined": resource_names,
                "parameters": ["param location string", "param environment string", "param sku string"],
                "outputs": ["appUrl", "resourceGroupId"]
            },
            "08-as-built": {
                "summary": f"Infrastructure assessment for {assessment_name} covering {total} resources",
                "resource_inventory": resource_list,
                "configurations": ["Backup policies active", "Monitoring enabled", "Alerts configured"],
                "operations": ["Runbook: Scale out procedure", "Runbook: Failover procedure"],
                "dr_procedures": ["1. Initiate failover", "2. Verify data integrity", "3. Update DNS", "4. Validate services"]
            }
        }
        return templates.get(agent_name, {
            "agent": agent_name,
            "status": "completed",
            "resources_analyzed": resource_names,
            "output": f"Agent output for {assessment_name} ({total} resources)"
        })
    
    def get_apex_workflow_status(self, workflow_id: str) -> Dict[str, Any]:
        """Get APEX workflow execution status"""
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT * FROM assessment_apex_workflow WHERE workflow_id = ?
        """, (workflow_id,))
        
        workflow = dict(zip([col[0] for col in cursor.description], cursor.fetchone()))
        conn.close()
        
        return {
            "workflow_id": workflow_id,
            "status": workflow["status"],
            "current_agent_index": workflow["current_agent_index"],
            "agents_completed": json.loads(workflow["agents_completed"]),
            "agents_failed": json.loads(workflow["agents_failed"]),
            "agent_sequence": json.loads(workflow["agent_sequence"]),
            "total_agents": len(json.loads(workflow["agent_sequence"]))
        }
    
    def get_latest_apex_workflow(self, assessment_id: str) -> Optional[Dict[str, Any]]:
        """Get the latest APEX workflow for an assessment, with realtime stale detection."""
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute(limit_sql("""
            SELECT * FROM assessment_apex_workflow 
            WHERE assessment_id = ? 
            ORDER BY started_at DESC""", 1), (assessment_id,))
        
        row = cursor.fetchone()
        if not row:
            conn.close()
            return None
        
        workflow = dict(zip([col[0] for col in cursor.description], row))
        
        # Realtime stale detection: if running but no progress for STALE_WORKFLOW_MINUTES
        status = workflow["status"]
        if status == "running":
            started = workflow.get("started_at", "")
            try:
                started_dt = datetime.strptime(started, "%Y-%m-%d %H:%M:%S")
            except (ValueError, TypeError):
                started_dt = datetime.now()
            if datetime.now() - started_dt > timedelta(minutes=STALE_WORKFLOW_MINUTES):
                status = "stale"
                cursor.execute("UPDATE assessment_apex_workflow SET status = 'stale' WHERE workflow_id = ?",
                               (workflow["workflow_id"],))
                cursor.execute("""
                    UPDATE agent_executions SET status = 'timeout', 
                        error_message = 'Agent timed out - workflow stale',
                        completed_at = CURRENT_TIMESTAMP
                    WHERE assessment_id = ? AND status = 'running'
                """, (assessment_id,))
                conn.commit()
        
        conn.close()
        return {
            "workflow_id": workflow["workflow_id"],
            "assessment_id": assessment_id,
            "status": status,
            "current_agent_index": workflow["current_agent_index"],
            "agents_completed": json.loads(workflow["agents_completed"]),
            "agents_failed": json.loads(workflow["agents_failed"]),
            "agent_sequence": json.loads(workflow["agent_sequence"]),
            "total_agents": len(json.loads(workflow["agent_sequence"]))
        }
    
    def resume_apex_workflow(self, assessment_id: str) -> Dict[str, Any]:
        """
        Resume a stale/interrupted APEX workflow that was interrupted (e.g., server restart, timeout).
        Picks up from where it left off based on completed agents.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute(limit_sql("""
            SELECT * FROM assessment_apex_workflow 
            WHERE assessment_id = ? AND status IN ('running', 'stale')
            ORDER BY started_at DESC""", 1), (assessment_id,))
        
        row = cursor.fetchone()
        if not row:
            conn.close()
            raise ValueError("No running workflow found to resume")
        
        workflow = dict(zip([col[0] for col in cursor.description], row))
        workflow_id = workflow["workflow_id"]
        completed = json.loads(workflow["agents_completed"])
        failed = json.loads(workflow["agents_failed"])
        sequence = json.loads(workflow["agent_sequence"])
        
        # Figure out resume index: skip already completed/failed agents
        processed = set(completed + failed)
        resume_idx = 0
        for i, agent in enumerate(sequence):
            if agent not in processed:
                resume_idx = i
                break
        else:
            # All agents already processed — mark complete
            final_status = "completed" if len(failed) == 0 else "completed_with_errors"
            cursor.execute("""
                UPDATE assessment_apex_workflow 
                SET status = ?, current_agent_index = ?, completed_at = CURRENT_TIMESTAMP
                WHERE workflow_id = ?
            """, (final_status, len(sequence), workflow_id))
            cursor.execute("""
                UPDATE assessments 
                SET status = 'completed', current_step = 5, updated_at = CURRENT_TIMESTAMP
                WHERE assessment_id = ?
            """, (assessment_id,))
            conn.commit()
            conn.close()
            return self.get_apex_workflow_status(workflow_id)
        
        # Also check if the agent at resume_idx has a "running" execution that never finished
        stuck_exec_id = f"exec-{workflow_id}-{sequence[resume_idx]}"
        cursor.execute("""
            SELECT status FROM agent_executions WHERE execution_id = ?
        """, (stuck_exec_id,))
        stuck_row = cursor.fetchone()
        if stuck_row and stuck_row[0] == 'running':
            # Delete the stuck execution row entirely so the resume thread's INSERT
            # (which uses ON CONFLICT ... DO UPDATE) starts with a clean slate.
            cursor.execute("""
                DELETE FROM agent_executions WHERE execution_id = ?
            """, (stuck_exec_id,))
            conn.commit()
        
        conn.close()
        
        print(f"🔄 Resuming APEX workflow {workflow_id} from agent index {resume_idx} ({sequence[resume_idx]})")
        print(f"   Already completed: {completed}")
        print(f"   Already failed: {failed}")
        
        # Reset status back to 'running' so the frontend shows correct state
        conn2 = self._get_connection()
        conn2.execute("""
            UPDATE assessment_apex_workflow SET status = 'running', current_agent_index = ?
            WHERE workflow_id = ?
        """, (resume_idx, workflow_id))
        conn2.commit()
        conn2.close()
        
        # Guard: if the workflow thread is already running in this process, don't
        # spawn a duplicate thread — just return the current status.
        if workflow_id in self._active_workflows:
            print(f"[Resume] Skipped — workflow {workflow_id} is already active in this process")
            return self.get_apex_workflow_status(workflow_id)

        # Kick off background thread to continue from resume_idx
        import threading
        thread = threading.Thread(
            target=self._execute_apex_workflow_sync,
            args=(workflow_id, assessment_id),
            kwargs={"resume_from_idx": resume_idx, "existing_completed": completed, "existing_failed": failed},
            daemon=True
        )
        thread.start()
        
        return self.get_apex_workflow_status(workflow_id)
    
    def detect_and_recover_stale_workflows(self) -> List[Dict]:
        """
        Detect workflows stuck in 'running' state for longer than STALE_WORKFLOW_MINUTES.
        Marks them as 'stale' so the frontend can offer resume.
        Called at server startup and via a periodic check endpoint.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # Find workflows that have been running for too long
        stale_cutoff = (datetime.now() - timedelta(minutes=STALE_WORKFLOW_MINUTES)).strftime("%Y-%m-%d %H:%M:%S")
        
        cursor.execute("""
            SELECT workflow_id, assessment_id, agents_completed, agents_failed, 
                   current_agent_index, agent_sequence, started_at
            FROM assessment_apex_workflow
            WHERE status = 'running' AND started_at < ?
        """, (stale_cutoff,))
        
        stale_workflows = []
        for row in cursor.fetchall():
            cols = [col[0] for col in cursor.description]
            wf = dict(zip(cols, row))
            workflow_id = wf["workflow_id"]
            
            # Mark as stale
            cursor.execute("""
                UPDATE assessment_apex_workflow SET status = 'stale'
                WHERE workflow_id = ?
            """, (workflow_id,))
            
            # Mark any stuck agent executions
            cursor.execute("""
                UPDATE agent_executions SET status = 'timeout', 
                    error_message = 'Agent timed out - workflow stale',
                    completed_at = CURRENT_TIMESTAMP
                WHERE assessment_id = ? AND status = 'running'
            """, (wf["assessment_id"],))
            
            stale_workflows.append({
                "workflow_id": workflow_id,
                "assessment_id": wf["assessment_id"],
                "stale_since": wf["started_at"],
                "agents_completed": json.loads(wf["agents_completed"]) if wf["agents_completed"] else [],
            })
            print(f"⚠️ Marked workflow {workflow_id} as stale (running since {wf['started_at']})")
        
        conn.commit()
        conn.close()
        return stale_workflows

    # ============================================
    # STEP 5: Generate Report
    # ============================================
    
    def generate_report(self, assessment_id: str) -> Dict[str, Any]:
        """
        Generate comprehensive assessment report
        
        Args:
            assessment_id: Assessment ID
        
        Returns:
            Report with all artifacts
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # Get assessment
        cursor.execute("SELECT * FROM assessments WHERE assessment_id = ?", (assessment_id,))
        assessment = dict(zip([col[0] for col in cursor.description], cursor.fetchone()))
        
        # Get analysis
        cursor.execute(limit_sql("""
            SELECT * FROM assessment_analysis 
            WHERE assessment_id = ? 
            ORDER BY created_at DESC""", 1), (assessment_id,))
        
        analysis_row = cursor.fetchone()
        if analysis_row:
            analysis = dict(zip([col[0] for col in cursor.description], analysis_row))
        else:
            analysis = None
        
        # Get artifacts from agent executions
        cursor.execute("""
            SELECT execution_id, agent_name, status, output_data, artifacts, started_at
            FROM agent_executions 
            WHERE assessment_id = ?
            ORDER BY started_at ASC
        """, (assessment_id,))
        
        executions = [dict(zip([col[0] for col in cursor.description], row)) for row in cursor.fetchall()]
        
        # Generate report
        report_id = f"report-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        # Build executive summary
        exec_summary = self._build_executive_summary(assessment, analysis, executions)
        
        report_data = {
            "report_id": report_id,
            "assessment": assessment,
            "analysis": analysis,
            "executions": executions,
            "executive_summary": exec_summary,
            "generated_at": datetime.now().isoformat()
        }
        
        cursor.execute("""
            INSERT INTO assessment_reports (
                report_id, assessment_id, title, executive_summary,
                score_breakdown, iac_artifacts, architecture_diagrams
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            report_id,
            assessment_id,
            f"{assessment['assessment_name']} - Assessment Report",
            exec_summary,
            json.dumps({"overall": analysis["overall_score"]}) if analysis else "{}",
            json.dumps([e for e in executions if e["agent_name"] in ["06b-bicep-codegen", "06t-terraform-codegen"]]),
            json.dumps([e for e in executions if "diagram" in (e.get("artifacts") or "").lower()])
        ))
        
        # Update assessment
        cursor.execute("""
            UPDATE assessments 
            SET status = 'completed', current_step = 5, completed_at = CURRENT_TIMESTAMP
            WHERE assessment_id = ?
        """, (assessment_id,))
        
        conn.commit()
        conn.close()
        
        return report_data
    
    def _build_executive_summary(self, assessment: Dict, analysis: Optional[Dict], executions: List[Dict]) -> str:
        """Build executive summary"""
        score = analysis["overall_score"] if analysis else "N/A"
        # Safe first-finding extraction — handles empty arrays and malformed JSON
        first_finding = "Analysis in progress"
        if analysis and analysis.get("findings"):
            try:
                findings_list = json.loads(analysis["findings"]) if isinstance(analysis["findings"], str) else analysis["findings"]
                if findings_list:
                    first_item = findings_list[0]
                    first_finding = first_item.get("finding", str(first_item)) if isinstance(first_item, dict) else str(first_item)
            except Exception:
                pass

        return f"""# {assessment['assessment_name']} - Executive Summary

**Assessment Type**: {assessment['assessment_type']}
**Overall Score**: {score}/100
**Status**: {assessment['status']}
**Completed**: {assessment.get('completed_at', 'In Progress')}

## Key Findings
{first_finding}

## Agent Workflow Executed
{len(executions)} agents completed successfully

## Next Steps
Review detailed recommendations and implement suggested improvements.
"""
    
    # ============================================
    # List & Get Methods
    # ============================================
    
    def list_assessments(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        """List all assessments"""
        conn = self._get_connection()
        cursor = conn.cursor()
        
        if is_azure_sql():
            # Azure SQL requires all non-aggregated columns in GROUP BY
            if status:
                cursor.execute("""
                    SELECT a.assessment_id, a.assessment_name, a.assessment_type, a.service_type,
                           a.scope_type, a.scope_value, a.description, a.business_unit, a.owner,
                           a.status, a.current_step, a.created_at, a.updated_at, a.completed_at,
                           (SELECT COUNT(*) FROM assessment_resources r WHERE r.assessment_id = a.assessment_id) as resource_count
                    FROM assessments a
                    WHERE a.status = ?
                    ORDER BY a.created_at DESC
                """, (status,))
            else:
                cursor.execute("""
                    SELECT a.assessment_id, a.assessment_name, a.assessment_type, a.service_type,
                           a.scope_type, a.scope_value, a.description, a.business_unit, a.owner,
                           a.status, a.current_step, a.created_at, a.updated_at, a.completed_at,
                           (SELECT COUNT(*) FROM assessment_resources r WHERE r.assessment_id = a.assessment_id) as resource_count
                    FROM assessments a
                    ORDER BY a.created_at DESC
                """)
        else:
            if status:
                cursor.execute("""
                    SELECT a.*, COUNT(r.resource_id) as resource_count
                    FROM assessments a
                    LEFT JOIN assessment_resources r ON a.assessment_id = r.assessment_id
                    WHERE a.status = ?
                    GROUP BY a.assessment_id
                    ORDER BY a.created_at DESC
                """, (status,))
            else:
                cursor.execute("""
                    SELECT a.*, COUNT(r.resource_id) as resource_count
                    FROM assessments a
                    LEFT JOIN assessment_resources r ON a.assessment_id = r.assessment_id
                    GROUP BY a.assessment_id
                    ORDER BY a.created_at DESC
                """)
        
        assessments = [dict(zip([col[0] for col in cursor.description], row)) for row in cursor.fetchall()]
        conn.close()
        
        return assessments
    
    def get_assessment(self, assessment_id: str) -> Dict[str, Any]:
        """Get assessment details"""
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("SELECT * FROM assessments WHERE assessment_id = ?", (assessment_id,))
        assessment = dict(zip([col[0] for col in cursor.description], cursor.fetchone()))
        
        cursor.execute("SELECT * FROM assessment_resources WHERE assessment_id = ?", (assessment_id,))
        raw_resources = [dict(zip([col[0] for col in cursor.description], row)) for row in cursor.fetchall()]
        # Merge resource_metadata JSON back into each resource dict for full AI context
        resources = []
        for r in raw_resources:
            meta_str = r.pop("resource_metadata", None)
            if meta_str:
                try:
                    meta = json.loads(meta_str)
                    r.update({k: v for k, v in meta.items() if k not in r or r[k] is None})
                except Exception:
                    pass
            resources.append(r)
        
        cursor.execute(limit_sql("SELECT * FROM assessment_analysis WHERE assessment_id = ? ORDER BY created_at DESC", 1), (assessment_id,))
        analysis_row = cursor.fetchone()
        analysis = dict(zip([col[0] for col in cursor.description], analysis_row)) if analysis_row else None
        
        conn.close()
        
        return {
            **assessment,
            "resources": resources,
            "analysis": analysis
        }
    
    def get_supported_services(self) -> List[Dict[str, Any]]:
        """Get list of supported service types"""
        return [
            {"type": k, **v}
            for k, v in self.SUPPORTED_SERVICES.items()
        ]
