"""
Azure Service Icon Mapping Service
Maps Azure resource types to their corresponding icon file paths.
Icons are sourced from Microsoft's official Azure icon library.

All lookups are CASE-INSENSITIVE because Azure Resource Graph returns
lowercase resource types while the canonical form uses PascalCase.
"""

from typing import Dict, Optional

class AzureIconService:
    """Service for mapping Azure resource types to icon file paths"""
    
    # Comprehensive mapping: key = LOWERCASE resource type, value = (folder, filename)
    _ICON_MAP: Dict[str, tuple] = {
        # ── Compute ──────────────────────────────────────────────────
        "microsoft.compute/virtualmachines":                 ("compute", "10021-icon-service-Virtual-Machine.svg"),
        "microsoft.compute/virtualmachines/extensions":      ("compute", "10021-icon-service-Virtual-Machine.svg"),
        "microsoft.compute/virtualmachinescalesets":          ("compute", "10034-icon-service-VM-Scale-Sets.svg"),
        "microsoft.compute/availabilitysets":                 ("compute", "10025-icon-service-Availability-Sets.svg"),
        "microsoft.compute/disks":                           ("compute", "10032-icon-service-Disks.svg"),
        "microsoft.compute/snapshots":                       ("compute", "10026-icon-service-Disks-Snapshots.svg"),
        "microsoft.compute/images":                          ("compute", "10033-icon-service-Images.svg"),
        "microsoft.compute/galleries":                       ("compute", "02864-icon-service-Azure-Compute-Galleries.svg"),
        "microsoft.compute/restorepointcollections":         ("compute", "02818-icon-service-Restore-Points-Collections.svg"),
        "microsoft.compute/diskencryptionsets":               ("compute", "00398-icon-service-Disk-Encryption-Sets.svg"),
        "microsoft.compute/proximityplacementgroups":        ("networking", "10365-icon-service-Proximity-Placement-Groups.svg"),
        "microsoft.compute/hostgroups":                      ("compute", "10346-icon-service-Host-Groups.svg"),
        "microsoft.compute/hosts":                           ("compute", "10347-icon-service-Hosts.svg"),
        "microsoft.batch/batchaccounts":                     ("compute", "10031-icon-service-Batch-Accounts.svg"),
        "microsoft.servicefabric/clusters":                  ("compute", "10036-icon-service-Service-Fabric-Clusters.svg"),
        "microsoft.classiccompute/virtualmachines":          ("compute", "10028-icon-service-Virtual-Machines-(Classic).svg"),
        
        # ── App Services / Web ───────────────────────────────────────
        "microsoft.web/sites":                               ("web", "10035-icon-service-App-Services.svg"),
        "microsoft.web/serverfarms":                         ("web", "00046-icon-service-App-Service-Plans.svg"),
        "microsoft.web/certificates":                        ("web", "00049-icon-service-App-Service-Certificates.svg"),
        "microsoft.web/connections":                         ("web", "10048-icon-service-API-Connections.svg"),
        "microsoft.web/customapis":                          ("web", "10048-icon-service-API-Connections.svg"),
        "microsoft.web/hostingenvironments":                 ("web", "10047-icon-service-App-Service-Environments.svg"),
        "microsoft.web/staticsites":                         ("web", "01007-icon-service-Static-Apps.svg"),
        "microsoft.web/functionapps":                        ("compute", "10029-icon-service-Function-Apps.svg"),
        "microsoft.certificateregistration/certificateorders": ("web", "00049-icon-service-App-Service-Certificates.svg"),
        "microsoft.domainregistration/domains":              ("web", "00050-icon-service-App-Service-Domains.svg"),
        
        # ── Containers ───────────────────────────────────────────────
        "microsoft.containerservice/managedclusters":        ("containers", "10023-icon-service-Kubernetes-Services.svg"),
        "microsoft.containerinstance/containergroups":        ("containers", "10104-icon-service-Container-Instances.svg"),
        "microsoft.containerregistry/registries":            ("containers", "10105-icon-service-Container-Registries.svg"),
        "microsoft.app/containerapps":                       ("containers", "10104-icon-service-Container-Instances.svg"),
        "microsoft.app/managedenvironments":                 ("containers", "10104-icon-service-Container-Instances.svg"),
        
        # ── Databases ────────────────────────────────────────────────
        "microsoft.sql/servers":                             ("databases", "10132-icon-service-SQL-Server.svg"),
        "microsoft.sql/servers/databases":                   ("databases", "10130-icon-service-SQL-Database.svg"),
        "microsoft.sql/managedinstances":                    ("databases", "10136-icon-service-SQL-Managed-Instance.svg"),
        "microsoft.sql/managedinstances/databases":          ("databases", "10135-icon-service-Managed-Database.svg"),
        "microsoft.sql/servers/elasticpools":                ("databases", "10134-icon-service-SQL-Elastic-Pools.svg"),
        "microsoft.sql/virtualclusters":                     ("databases", "10127-icon-service-Virtual-Clusters.svg"),
        "microsoft.dbforpostgresql/servers":                 ("databases", "10131-icon-service-Azure-Database-PostgreSQL-Server.svg"),
        "microsoft.dbforpostgresql/flexibleservers":         ("databases", "10131-icon-service-Azure-Database-PostgreSQL-Server.svg"),
        "microsoft.dbformysql/servers":                      ("databases", "10122-icon-service-Azure-Database-MySQL-Server.svg"),
        "microsoft.dbformysql/flexibleservers":              ("databases", "10122-icon-service-Azure-Database-MySQL-Server.svg"),
        "microsoft.dbformariadb/servers":                    ("databases", "10123-icon-service-Azure-Database-MariaDB-Server.svg"),
        "microsoft.documentdb/databaseaccounts":             ("databases", "10121-icon-service-Azure-Cosmos-DB.svg"),
        "microsoft.cache/redis":                             ("databases", "10137-icon-service-Cache-Redis.svg"),
        "microsoft.cache/redisenterprise":                   ("databases", "10137-icon-service-Cache-Redis.svg"),
        "microsoft.synapse/workspaces":                      ("databases", "00606-icon-service-Azure-Synapse-Analytics.svg"),
        "microsoft.datafactory/factories":                   ("databases", "10126-icon-service-Data-Factories.svg"),
        "microsoft.kusto/clusters":                          ("databases", "10145-icon-service-Azure-Data-Explorer-Clusters.svg"),
        
        # ── Storage ──────────────────────────────────────────────────
        "microsoft.storage/storageaccounts":                 ("storage", "10086-icon-service-Storage-Accounts.svg"),
        "microsoft.classicstorage/storageaccounts":          ("storage", "10087-icon-service-Storage-Accounts-(Classic).svg"),
        "microsoft.datalakestore/accounts":                  ("storage", "10090-icon-service-Data-Lake-Storage-Gen1.svg"),
        "microsoft.netapp/netappaccounts":                   ("storage", "10096-icon-service-Azure-NetApp-Files.svg"),
        "microsoft.storagesync/storagesyncservices":         ("storage", "10093-icon-service-Storage-Sync-Services.svg"),
        "microsoft.recoveryservices/vaults":                 ("storage", "00017-icon-service-Recovery-Services-Vaults.svg"),
        "microsoft.dataprotection/backupvaults":             ("storage", "00017-icon-service-Recovery-Services-Vaults.svg"),
        "microsoft.databox/jobs":                            ("storage", "10094-icon-service-Data-Box.svg"),
        "microsoft.importexport/jobs":                       ("storage", "10100-icon-service-Import-Export-Jobs.svg"),
        
        # ── Networking ───────────────────────────────────────────────
        "microsoft.network/virtualnetworks":                 ("networking", "10061-icon-service-Virtual-Networks.svg"),
        "microsoft.network/virtualnetworks/subnets":         ("networking", "02742-icon-service-Subnet.svg"),
        "microsoft.network/loadbalancers":                   ("networking", "10062-icon-service-Load-Balancers.svg"),
        "microsoft.network/applicationgateways":             ("networking", "10076-icon-service-Application-Gateways.svg"),
        "microsoft.network/networksecuritygroups":           ("networking", "10067-icon-service-Network-Security-Groups.svg"),
        "microsoft.network/publicipaddresses":               ("networking", "10069-icon-service-Public-IP-Addresses.svg"),
        "microsoft.network/publicipprefixes":                ("networking", "10372-icon-service-Public-IP-Prefixes.svg"),
        "microsoft.network/networkinterfaces":               ("networking", "10080-icon-service-Network-Interfaces.svg"),
        "microsoft.network/routetables":                     ("networking", "10082-icon-service-Route-Tables.svg"),
        "microsoft.network/virtualnetworkgateways":          ("networking", "10063-icon-service-Virtual-Network-Gateways.svg"),
        "microsoft.network/vpngateways":                     ("networking", "10063-icon-service-Virtual-Network-Gateways.svg"),
        "microsoft.network/localnetworkgateways":            ("networking", "10077-icon-service-Local-Network-Gateways.svg"),
        "microsoft.network/connections":                     ("networking", "10081-icon-service-Connections.svg"),
        "microsoft.network/expressroutecircuits":            ("networking", "10079-icon-service-ExpressRoute-Circuits.svg"),
        "microsoft.network/expressroutegateways":            ("networking", "10079-icon-service-ExpressRoute-Circuits.svg"),
        "microsoft.network/trafficmanagerprofiles":          ("networking", "10065-icon-service-Traffic-Manager-Profiles.svg"),
        "microsoft.network/frontdoors":                      ("networking", "10073-icon-service-Front-Door-and-CDN-Profiles.svg"),
        "microsoft.cdn/profiles":                            ("networking", "00056-icon-service-CDN-Profiles.svg"),
        "microsoft.network/azurefirewalls":                  ("networking", "10084-icon-service-Firewalls.svg"),
        "microsoft.network/firewallpolicies":                ("networking", "00272-icon-service-Azure-Firewall-Policy.svg"),
        "microsoft.network/bastionhosts":                    ("networking", "02422-icon-service-Bastions.svg"),
        "microsoft.network/natgateways":                     ("networking", "10310-icon-service-NAT.svg"),
        "microsoft.network/privatedns zones":                 ("networking", "10064-icon-service-DNS-Zones.svg"),  # edge-case typo guard
        "microsoft.network/privatednszones":                 ("networking", "10064-icon-service-DNS-Zones.svg"),
        "microsoft.network/privatednszones/virtualnetworklinks": ("networking", "10064-icon-service-DNS-Zones.svg"),
        "microsoft.network/dnszones":                        ("networking", "10064-icon-service-DNS-Zones.svg"),
        "microsoft.network/ddosprotectionplans":             ("networking", "10072-icon-service-DDoS-Protection-Plans.svg"),
        "microsoft.network/privateendpoints":                ("networking", "00427-icon-service-Private-Link.svg"),
        "microsoft.network/privatelinkservices":             ("networking", "02209-icon-service-Private-Link-Services.svg"),
        "microsoft.network/networkwatchers":                 ("networking", "10066-icon-service-Network-Watcher.svg"),
        "microsoft.network/networkwatchers/flowlogs":        ("networking", "10066-icon-service-Network-Watcher.svg"),
        "microsoft.network/virtualwans":                     ("networking", "10353-icon-service-Virtual-WANs.svg"),
        "microsoft.network/virtualhubs":                     ("networking", "00860-icon-service-Virtual-WAN-Hub.svg"),
        "microsoft.network/p2svpngateways":                  ("networking", "10063-icon-service-Virtual-Network-Gateways.svg"),
        "microsoft.network/routefilters":                    ("networking", "10071-icon-service-Route-Filters.svg"),
        "microsoft.network/serviceendpointpolicies":         ("networking", "10085-icon-service-Service-Endpoint-Policies.svg"),
        "microsoft.network/ipgroups":                        ("networking", "00701-icon-service-IP-Groups.svg"),
        "microsoft.network/networkintentpolicies":           ("networking", "10085-icon-service-Service-Endpoint-Policies.svg"),
        "microsoft.network/applicationgatewaywebapplicationfirewallpolicies": ("networking", "10362-icon-service-Web-Application-Firewall-Policies(WAF).svg"),
        "microsoft.network/frontdoorwebapplicationfirewallpolicies":          ("networking", "10362-icon-service-Web-Application-Firewall-Policies(WAF).svg"),
        "microsoft.network/dnsprivateresolver":              ("networking", "02882-icon-service-DNS-Private-Resolver.svg"),
        
        # ── Security & Identity ──────────────────────────────────────
        "microsoft.keyvault/vaults":                         ("security", "10245-icon-service-Key-Vaults.svg"),
        "microsoft.keyvault/managedhsms":                    ("security", "10245-icon-service-Key-Vaults.svg"),
        "microsoft.security/securitysolutions":              ("security", "10241-icon-service-Microsoft-Defender-for-Cloud.svg"),
        "microsoft.security/pricings":                       ("security", "10241-icon-service-Microsoft-Defender-for-Cloud.svg"),
        "microsoft.managedidentity/userassignedidentities":  ("identity", "10221-icon-service-Managed-Identities.svg"),
        "microsoft.authorization/roleassignments":           ("security", "10245-icon-service-Key-Vaults.svg"),
        "microsoft.network/applicationsecuritygroups":       ("security", "10244-icon-service-Application-Security-Groups.svg"),
        
        # ── Management & Governance ──────────────────────────────────
        "microsoft.insights/components":                     ("management + governance", "00012-icon-service-Application-Insights.svg"),
        "microsoft.insights/actiongroups":                   ("management + governance", "00002-icon-service-Alerts.svg"),
        "microsoft.insights/activitylogalerts":              ("management + governance", "00002-icon-service-Alerts.svg"),
        "microsoft.insights/metricalerts":                   ("management + governance", "00020-icon-service-Metrics.svg"),
        "microsoft.insights/scheduledqueryrules":            ("management + governance", "00002-icon-service-Alerts.svg"),
        "microsoft.insights/datacollectionrules":            ("management + governance", "00009-icon-service-Log-Analytics-Workspaces.svg"),
        "microsoft.insights/datacollectionendpoints":        ("management + governance", "00009-icon-service-Log-Analytics-Workspaces.svg"),
        "microsoft.operationalinsights/workspaces":          ("management + governance", "00009-icon-service-Log-Analytics-Workspaces.svg"),
        "microsoft.operationsmanagement/solutions":          ("management + governance", "00021-icon-service-Solutions.svg"),
        "microsoft.automation/automationaccounts":           ("management + governance", "00022-icon-service-Automation-Accounts.svg"),
        "microsoft.advisor/recommendations":                 ("management + governance", "00003-icon-service-Advisor.svg"),
        "microsoft.portal/dashboards":                       ("general", "10015-icon-service-Dashboard.svg"),
        "microsoft.monitor/accounts":                        ("management + governance", "00001-icon-service-Monitor.svg"),
        "microsoft.costmanagement/exports":                  ("management + governance", "00004-icon-service-Cost-Management-and-Billing.svg"),
        "microsoft.policyinsights/remediations":             ("management + governance", "10316-icon-service-Policy.svg"),
        "microsoft.resources/templatespecs":                 ("general", "10009-icon-service-Templates.svg"),
        
        # ── AI & Machine Learning ────────────────────────────────────
        "microsoft.cognitiveservices/accounts":              ("ai + machine learning", "10162-icon-service-Cognitive-Services.svg"),
        "microsoft.cognitiveservices/accounts/projects":     ("ai + machine learning", "03513-icon-service-AI-Studio.svg"),
        "microsoft.machinelearningservices/workspaces":      ("ai + machine learning", "10166-icon-service-Machine-Learning.svg"),
        "microsoft.search/searchservices":                   ("ai + machine learning", "10044-icon-service-Cognitive-Search.svg"),
        "microsoft.botservice/botservices":                  ("ai + machine learning", "10165-icon-service-Bot-Services.svg"),
        "microsoft.openai/accounts":                         ("ai + machine learning", "03438-icon-service-Azure-OpenAI.svg"),
        
        # ── Integration ──────────────────────────────────────────────
        "microsoft.logic/workflows":                         ("integration", "02631-icon-service-Logic-Apps.svg"),
        "microsoft.apimanagement/service":                   ("web", "10042-icon-service-API-Management-Services.svg"),
        "microsoft.eventgrid/topics":                        ("integration", "10206-icon-service-Event-Grid-Topics.svg"),
        "microsoft.eventgrid/domains":                       ("integration", "10215-icon-service-Event-Grid-Domains.svg"),
        "microsoft.eventgrid/systemtopics":                  ("integration", "02073-icon-service-System-Topic.svg"),
        "microsoft.eventgrid/eventsubscriptions":            ("integration", "10221-icon-service-Event-Grid-Subscriptions.svg"),
        "microsoft.relay/namespaces":                        ("integration", "10209-icon-service-Relays.svg"),
        "microsoft.servicebus/namespaces":                   ("integration", "10836-icon-service-Azure-Service-Bus.svg"),
        "microsoft.eventhub/namespaces":                     ("integration", "10836-icon-service-Azure-Service-Bus.svg"),
        "microsoft.signalrservice/signalr":                  ("web", "10052-icon-service-SignalR.svg"),
        "microsoft.appconfiguration/configurationstores":    ("integration", "10219-icon-service-App-Configuration.svg"),
        
        # ── IoT ──────────────────────────────────────────────────────
        "microsoft.devices/iothubs":                         ("iot", "10053-icon-service-IoT-Hub.svg"),
        "microsoft.timeseriesinsights/environments":         ("iot", "02393-icon-service-Time-Series-Insights-Environments.svg"),
        
        # ── DevOps ───────────────────────────────────────────────────
        "microsoft.devtestlab/schedules":                    ("general", "10833-icon-service-Scheduler.svg"),
        "microsoft.devtestlab/labs":                         ("general", "10833-icon-service-Scheduler.svg"),
        
        # ── Hybrid & Arc ─────────────────────────────────────────────
        "microsoft.hybridcompute/machines":                  ("management + governance", "01710-icon-service-Arc-Machines.svg"),
        "microsoft.hybridcompute/machines/extensions":       ("management + governance", "01710-icon-service-Arc-Machines.svg"),
        "microsoft.hybridcompute/machines/licenseprofiles":  ("management + governance", "01710-icon-service-Arc-Machines.svg"),
        "microsoft.hybridcompute/licenses":                  ("management + governance", "01710-icon-service-Arc-Machines.svg"),
        "microsoft.azurearcdata/sqlserverinstances":         ("databases", "10132-icon-service-SQL-Server.svg"),
        "microsoft.azurearcdata/sqlserverinstances/databases":  ("databases", "10130-icon-service-SQL-Database.svg"),
        "microsoft.azurearcdata/sqlserverinstances/availabilitygroups": ("databases", "10132-icon-service-SQL-Server.svg"),
        "microsoft.azurearcdata/sqlserverlicenses":          ("databases", "10132-icon-service-SQL-Server.svg"),
        "microsoft.azurearcdata/sqlserveresulicenses":       ("databases", "10132-icon-service-SQL-Server.svg"),
        "microsoft.azurestackhci/virtualharddisks":          ("storage", "10086-icon-service-Storage-Accounts.svg"),
        "microsoft.azurestackhci/networkinterfaces":         ("networking", "10080-icon-service-Network-Interfaces.svg"),
        
        # ── Analytics ────────────────────────────────────────────────
        "microsoft.streamanalytics/streamingjobs":           ("general", "10834-icon-service-Search.svg"),
        "microsoft.databricks/workspaces":                   ("general", "10787-icon-service-Code.svg"),
        "microsoft.purview/accounts":                        ("general", "10834-icon-service-Search.svg"),
    }
    
    # Build a lookup by lower-cased key at class load time
    _LOOKUP: Dict[str, tuple] = {}

    @classmethod
    def _ensure_lookup(cls):
        """Build the case-insensitive lookup dict once."""
        if cls._LOOKUP:
            return
        for key, val in cls._ICON_MAP.items():
            cls._LOOKUP[key.lower()] = val
    
    # Provider → folder fallback (for unknown subtypes)
    _PROVIDER_FOLDER = {
        "microsoft.compute":                "compute",
        "microsoft.web":                    "web",
        "microsoft.containerservice":       "containers",
        "microsoft.containerinstance":       "containers",
        "microsoft.containerregistry":       "containers",
        "microsoft.app":                    "containers",
        "microsoft.sql":                    "databases",
        "microsoft.dbforpostgresql":         "databases",
        "microsoft.dbformysql":              "databases",
        "microsoft.dbformariadb":            "databases",
        "microsoft.documentdb":              "databases",
        "microsoft.cache":                   "databases",
        "microsoft.synapse":                 "databases",
        "microsoft.datafactory":             "databases",
        "microsoft.kusto":                   "databases",
        "microsoft.storage":                 "storage",
        "microsoft.datalakestore":           "storage",
        "microsoft.netapp":                  "storage",
        "microsoft.storagesync":             "storage",
        "microsoft.recoveryservices":        "storage",
        "microsoft.dataprotection":          "storage",
        "microsoft.network":                 "networking",
        "microsoft.cdn":                     "networking",
        "microsoft.keyvault":                "security",
        "microsoft.security":                "security",
        "microsoft.managedidentity":         "identity",
        "microsoft.insights":                "management + governance",
        "microsoft.operationalinsights":     "management + governance",
        "microsoft.operationsmanagement":    "management + governance",
        "microsoft.automation":              "management + governance",
        "microsoft.monitor":                 "management + governance",
        "microsoft.advisor":                 "management + governance",
        "microsoft.cognitiveservices":        "ai + machine learning",
        "microsoft.machinelearningservices":  "ai + machine learning",
        "microsoft.search":                  "ai + machine learning",
        "microsoft.logic":                   "integration",
        "microsoft.apimanagement":           "integration",
        "microsoft.eventgrid":               "integration",
        "microsoft.servicebus":              "integration",
        "microsoft.eventhub":                "integration",
        "microsoft.relay":                   "integration",
        "microsoft.devices":                 "iot",
        "microsoft.hybridcompute":           "management + governance",
        "microsoft.azurearcdata":            "databases",
        "microsoft.certificateregistration": "web",
        "microsoft.devtestlab":              "general",
    }
    
    @staticmethod
    def get_icon_path(resource_type: str, category: Optional[str] = None) -> str:
        """
        Get the icon URL path for a given Azure resource type.
        Case-insensitive — works with lowercase types from Azure Resource Graph.
        """
        AzureIconService._ensure_lookup()
        
        key = resource_type.lower().strip()
        
        # Direct match
        hit = AzureIconService._LOOKUP.get(key)
        if hit:
            folder, filename = hit
            return f"/icons/{folder}/{filename}"
        
        # Provider-level fallback: try to find any match sharing the same provider
        provider = key.split("/")[0] if "/" in key else key
        folder = AzureIconService._PROVIDER_FOLDER.get(provider)
        if folder:
            return f"/icons/{folder}/generic.svg"
        
        # Ultimate fallback
        return "/icons/general/10001-icon-service-All-Resources.svg"
    
    @staticmethod
    def _get_folder_for_resource_type(resource_type: str) -> str:
        """Determine the folder based on resource type provider."""
        provider = resource_type.lower().split("/")[0] if "/" in resource_type else resource_type.lower()
        return AzureIconService._PROVIDER_FOLDER.get(provider, "general")
    
    # Display names (case-insensitive lookup)
    _DISPLAY_NAMES = {
        "microsoft.web/sites": "Azure App Service",
        "microsoft.web/serverfarms": "App Service Plan",
        "microsoft.web/connections": "API Connection",
        "microsoft.web/staticsites": "Static Web App",
        "microsoft.compute/virtualmachines": "Virtual Machine",
        "microsoft.compute/virtualmachinescalesets": "VM Scale Set",
        "microsoft.compute/disks": "Managed Disk",
        "microsoft.compute/snapshots": "Disk Snapshot",
        "microsoft.compute/images": "VM Image",
        "microsoft.compute/restorepointcollections": "Restore Point Collection",
        "microsoft.containerservice/managedclusters": "AKS Cluster",
        "microsoft.containerinstance/containergroups": "Container Instance",
        "microsoft.containerregistry/registries": "Container Registry",
        "microsoft.app/containerapps": "Container App",
        "microsoft.app/managedenvironments": "Container App Environment",
        "microsoft.sql/servers": "SQL Server",
        "microsoft.sql/servers/databases": "SQL Database",
        "microsoft.sql/managedinstances": "SQL Managed Instance",
        "microsoft.sql/virtualclusters": "SQL Virtual Cluster",
        "microsoft.dbforpostgresql/flexibleservers": "PostgreSQL Flexible Server",
        "microsoft.dbformysql/flexibleservers": "MySQL Flexible Server",
        "microsoft.documentdb/databaseaccounts": "Cosmos DB Account",
        "microsoft.cache/redis": "Azure Cache for Redis",
        "microsoft.storage/storageaccounts": "Storage Account",
        "microsoft.recoveryservices/vaults": "Recovery Services Vault",
        "microsoft.dataprotection/backupvaults": "Backup Vault",
        "microsoft.network/virtualnetworks": "Virtual Network",
        "microsoft.network/networksecuritygroups": "Network Security Group",
        "microsoft.network/publicipaddresses": "Public IP Address",
        "microsoft.network/networkinterfaces": "Network Interface",
        "microsoft.network/loadbalancers": "Load Balancer",
        "microsoft.network/applicationgateways": "Application Gateway",
        "microsoft.network/azurefirewalls": "Azure Firewall",
        "microsoft.network/bastionhosts": "Azure Bastion",
        "microsoft.network/natgateways": "NAT Gateway",
        "microsoft.network/routetables": "Route Table",
        "microsoft.network/privateendpoints": "Private Endpoint",
        "microsoft.network/privatednszones": "Private DNS Zone",
        "microsoft.network/dnszones": "DNS Zone",
        "microsoft.network/virtualnetworkgateways": "VNet Gateway",
        "microsoft.network/connections": "VPN/ER Connection",
        "microsoft.network/expressroutecircuits": "ExpressRoute Circuit",
        "microsoft.network/frontdoors": "Front Door",
        "microsoft.network/networkwatchers": "Network Watcher",
        "microsoft.network/virtualwans": "Virtual WAN",
        "microsoft.network/virtualhubs": "Virtual WAN Hub",
        "microsoft.keyvault/vaults": "Key Vault",
        "microsoft.insights/components": "Application Insights",
        "microsoft.insights/actiongroups": "Action Group",
        "microsoft.operationalinsights/workspaces": "Log Analytics Workspace",
        "microsoft.cognitiveservices/accounts": "Cognitive Services",
        "microsoft.cognitiveservices/accounts/projects": "AI Studio Project",
        "microsoft.machinelearningservices/workspaces": "ML Workspace",
        "microsoft.search/searchservices": "AI Search Service",
        "microsoft.logic/workflows": "Logic App",
        "microsoft.eventgrid/systemtopics": "Event Grid System Topic",
        "microsoft.hybridcompute/machines": "Arc-enabled Server",
        "microsoft.azurearcdata/sqlserverinstances": "Arc SQL Server",
        "microsoft.monitor/accounts": "Azure Monitor Account",
        "microsoft.devtestlab/schedules": "DevTest Schedule",
    }
    
    # Categories (case-insensitive lookup)
    _CATEGORIES = {
        "microsoft.web": "Compute",
        "microsoft.compute": "Compute",
        "microsoft.batch": "Compute",
        "microsoft.containerservice": "Containers",
        "microsoft.containerinstance": "Containers",
        "microsoft.containerregistry": "Containers",
        "microsoft.app": "Containers",
        "microsoft.sql": "Database",
        "microsoft.dbforpostgresql": "Database",
        "microsoft.dbformysql": "Database",
        "microsoft.dbformariadb": "Database",
        "microsoft.documentdb": "Database",
        "microsoft.cache": "Database",
        "microsoft.synapse": "Database",
        "microsoft.datafactory": "Database",
        "microsoft.kusto": "Database",
        "microsoft.storage": "Storage",
        "microsoft.recoveryservices": "BCDR",
        "microsoft.dataprotection": "BCDR",
        "microsoft.network": "Network",
        "microsoft.cdn": "Network",
        "microsoft.keyvault": "Security",
        "microsoft.security": "Security",
        "microsoft.managedidentity": "Security",
        "microsoft.insights": "Management",
        "microsoft.operationalinsights": "Management",
        "microsoft.operationsmanagement": "Management",
        "microsoft.automation": "Management",
        "microsoft.monitor": "Management",
        "microsoft.cognitiveservices": "AI",
        "microsoft.machinelearningservices": "AI",
        "microsoft.search": "AI",
        "microsoft.logic": "Integration",
        "microsoft.eventgrid": "Integration",
        "microsoft.servicebus": "Integration",
        "microsoft.eventhub": "Integration",
        "microsoft.devices": "IoT",
        "microsoft.hybridcompute": "Hybrid",
        "microsoft.azurearcdata": "Hybrid",
        "microsoft.azurestackhci": "Hybrid",
    }
    
    @staticmethod
    def get_service_metadata(resource_type: str) -> Dict[str, str]:
        """Get icon path, display name, and category for a resource type."""
        key = resource_type.lower().strip()
        
        # Display name
        display = AzureIconService._DISPLAY_NAMES.get(key)
        if not display:
            # Fallback: prettify the last segment
            last = key.rsplit("/", 1)[-1]
            display = last.replace("_", " ").title()
        
        # Category from provider
        provider = key.split("/")[0] if "/" in key else key
        category = AzureIconService._CATEGORIES.get(provider, "Other")
        
        return {
            "icon_path": AzureIconService.get_icon_path(resource_type),
            "display_name": display,
            "category": category,
        }
