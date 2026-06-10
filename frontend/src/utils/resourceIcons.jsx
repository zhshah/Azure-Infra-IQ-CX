/**
 * Client-side resource type → Azure icon path mapping.
 * Avoids per-type API calls by mapping common Azure resource types to local icon SVGs.
 */

const TYPE_ICON_MAP = {
  // Compute
  'microsoft.compute/virtualmachines':          '/icons/compute/10021-icon-service-Virtual-Machine.svg',
  'microsoft.compute/virtualmachinescalesets':   '/icons/compute/10034-icon-service-VM-Scale-Sets.svg',
  'microsoft.compute/disks':                    '/icons/compute/10032-icon-service-Disks.svg',
  'microsoft.compute/availabilitysets':          '/icons/compute/10025-icon-service-Availability-Sets.svg',
  'microsoft.compute/images':                   '/icons/compute/10024-icon-service-VM-Images.svg',
  'microsoft.compute/snapshots':                '/icons/compute/10026-icon-service-Disks-Snapshots.svg',
  'microsoft.compute/galleries':                '/icons/compute/02864-icon-service-Azure-Compute-Galleries.svg',

  // App Services
  'microsoft.web/sites':                        '/icons/app services/10035-icon-service-App-Services.svg',
  'microsoft.web/serverfarms':                  '/icons/app services/10036-icon-service-App-Service-Plans.svg',
  'microsoft.web/certificates':                 '/icons/app services/10037-icon-service-App-Service-Certificates.svg',
  'microsoft.web/staticSites':                  '/icons/app services/02572-icon-service-Static-Apps.svg',

  // Networking
  'microsoft.network/virtualnetworks':          '/icons/networking/10061-icon-service-Virtual-Networks.svg',
  'microsoft.network/loadbalancers':            '/icons/networking/10062-icon-service-Load-Balancers.svg',
  'microsoft.network/virtualnetworkgateways':   '/icons/networking/10063-icon-service-Virtual-Network-Gateways.svg',
  'microsoft.network/publicipaddresses':        '/icons/networking/10069-icon-service-Public-IP-Addresses.svg',
  'microsoft.network/networksecuritygroups':    '/icons/networking/10067-icon-service-Network-Security-Groups.svg',
  'microsoft.network/networkinterfaces':        '/icons/networking/10080-icon-service-Network-Interfaces.svg',
  'microsoft.network/applicationgateways':      '/icons/networking/10076-icon-service-Application-Gateways.svg',
  'microsoft.network/azurefirewalls':           '/icons/networking/10084-icon-service-Firewalls.svg',
  'microsoft.network/bastionhosts':             '/icons/networking/02422-icon-service-Bastions.svg',
  'microsoft.network/privatednszones':          '/icons/networking/10064-icon-service-DNS-Zones.svg',
  'microsoft.network/dnszones':                 '/icons/networking/10064-icon-service-DNS-Zones.svg',
  'microsoft.network/frontdoors':               '/icons/networking/10073-icon-service-Front-Doors.svg',
  'microsoft.network/trafficmanagerprofiles':   '/icons/networking/10065-icon-service-Traffic-Manager-Profiles.svg',
  'microsoft.network/expressroutecircuits':     '/icons/networking/10079-icon-service-ExpressRoute-Circuits.svg',
  'microsoft.network/routetables':              '/icons/networking/10082-icon-service-Route-Tables.svg',
  'microsoft.network/privateendpoints':         '/icons/networking/10427-icon-service-Private-Link.svg',
  'microsoft.network/natgateways':              '/icons/networking/10310-icon-service-NAT.svg',
  'microsoft.cdn/profiles':                     '/icons/networking/00056-icon-service-CDN-Profiles.svg',

  // Storage
  'microsoft.storage/storageaccounts':          '/icons/storage/10086-icon-service-Storage-Accounts.svg',
  'microsoft.netapp/netappaccounts':            '/icons/storage/10096-icon-service-Azure-NetApp-Files.svg',
  'microsoft.recoveryservices/vaults':          '/icons/storage/00017-icon-service-Recovery-Services-Vaults.svg',
  'microsoft.dataprotection/backupvaults':      '/icons/storage/00017-icon-service-Recovery-Services-Vaults.svg',

  // Databases
  'microsoft.sql/servers':                      '/icons/databases/10132-icon-service-SQL-Server.svg',
  'microsoft.sql/servers/databases':            '/icons/databases/10130-icon-service-SQL-Database.svg',
  'microsoft.sql/managedinstances':             '/icons/databases/10136-icon-service-SQL-Managed-Instance.svg',
  'microsoft.dbformysql/servers':               '/icons/databases/10122-icon-service-Azure-Database-MySQL-Server.svg',
  'microsoft.dbformysql/flexibleservers':       '/icons/databases/10122-icon-service-Azure-Database-MySQL-Server.svg',
  'microsoft.dbforpostgresql/servers':          '/icons/databases/10131-icon-service-Azure-Database-PostgreSQL-Server.svg',
  'microsoft.dbforpostgresql/flexibleservers':  '/icons/databases/10131-icon-service-Azure-Database-PostgreSQL-Server.svg',
  'microsoft.dbformariadb/servers':             '/icons/databases/10123-icon-service-Azure-Database-MariaDB-Server.svg',
  'microsoft.documentdb/databaseaccounts':      '/icons/databases/10121-icon-service-Azure-Cosmos-DB.svg',
  'microsoft.cache/redis':                      '/icons/databases/10137-icon-service-Cache-Redis.svg',
  'microsoft.datafactory/factories':            '/icons/databases/10126-icon-service-Data-Factories.svg',
  'microsoft.synapse/workspaces':               '/icons/databases/00606-icon-service-Azure-Synapse-Analytics.svg',

  // Containers
  'microsoft.containerservice/managedclusters': '/icons/containers/10023-icon-service-Kubernetes-Services.svg',
  'microsoft.containerregistry/registries':     '/icons/containers/10105-icon-service-Container-Registries.svg',
  'microsoft.containerinstance/containergroups': '/icons/containers/10104-icon-service-Container-Instances.svg',
  'microsoft.app/containerapps':                '/icons/containers/10104-icon-service-Container-Instances.svg',

  // AI & Machine Learning
  'microsoft.cognitiveservices/accounts':       '/icons/ai + machine learning/10162-icon-service-Cognitive-Services.svg',
  'microsoft.machinelearningservices/workspaces': '/icons/ai + machine learning/10166-icon-service-Machine-Learning.svg',
  'microsoft.search/searchservices':            '/icons/ai + machine learning/10044-icon-service-Search-Services.svg',

  // Security
  'microsoft.keyvault/vaults':                  '/icons/security/10245-icon-service-Key-Vaults.svg',
  'microsoft.managedidentity/userassignedidentities': '/icons/identity/10227-icon-service-Managed-Identities.svg',

  // Management & Governance
  'microsoft.operationalinsights/workspaces':   '/icons/management + governance/00009-icon-service-Log-Analytics-Workspaces.svg',
  'microsoft.insights/components':              '/icons/management + governance/00012-icon-service-Application-Insights.svg',
  'microsoft.automation/automationaccounts':    '/icons/management + governance/00022-icon-service-Automation-Accounts.svg',
  'microsoft.logic/workflows':                  '/icons/integration/10201-icon-service-Logic-Apps.svg',

  // Integration
  'microsoft.servicebus/namespaces':            '/icons/integration/10204-icon-service-Service-Bus.svg',
  'microsoft.eventhub/namespaces':              '/icons/integration/10150-icon-service-Event-Hubs.svg',
  'microsoft.eventgrid/topics':                 '/icons/integration/10206-icon-service-Event-Grid-Topics.svg',
  'microsoft.signalrservice/signalr':           '/icons/integration/10202-icon-service-SignalR.svg',
  'microsoft.apimanagement/service':            '/icons/integration/10042-icon-service-API-Management-Services.svg',

  // IoT
  'microsoft.devices/iothubs':                  '/icons/iot/10182-icon-service-IoT-Hub.svg',

  // Hybrid
  'microsoft.hybridcompute/machines':           '/icons/management + governance/01710-icon-service-Arc-Machines.svg',

  // Azure VMware Solution
  'microsoft.avs/privateclouds':                '/icons/other/01219-icon-service-Azure-VMware-Solution.svg',
};

// Category fallback icons (when no exact resource type match)
const CATEGORY_ICON_MAP = {
  compute:        '/icons/compute/10021-icon-service-Virtual-Machine.svg',
  storage:        '/icons/storage/10086-icon-service-Storage-Accounts.svg',
  networking:     '/icons/networking/10061-icon-service-Virtual-Networks.svg',
  databases:      '/icons/databases/10130-icon-service-SQL-Database.svg',
  security:       '/icons/security/10241-icon-service-Microsoft-Defender-for-Cloud.svg',
  web:            '/icons/app services/10035-icon-service-App-Services.svg',
  containers:     '/icons/containers/10023-icon-service-Kubernetes-Services.svg',
  ai:             '/icons/ai + machine learning/10162-icon-service-Cognitive-Services.svg',
  management:     '/icons/management + governance/00001-icon-service-Monitor.svg',
  integration:    '/icons/integration/10201-icon-service-Logic-Apps.svg',
  monitor:        '/icons/management + governance/00001-icon-service-Monitor.svg',
};

/**
 * Get icon path for a given Azure resource type.
 * @param {string} resourceType - e.g. "microsoft.compute/virtualmachines"
 * @param {string} [category] - optional fallback category e.g. "compute"
 * @returns {string|null} icon path or null
 */
export function getResourceIcon(resourceType, category) {
  if (!resourceType) return category ? (CATEGORY_ICON_MAP[category.toLowerCase()] || null) : null;
  const key = resourceType.toLowerCase();
  if (TYPE_ICON_MAP[key]) return TYPE_ICON_MAP[key];
  
  // Partial match: check if any key starts with or contains a match
  for (const [mapKey, iconPath] of Object.entries(TYPE_ICON_MAP)) {
    if (key.includes(mapKey.split('/').pop())) return iconPath;
  }
  
  if (category) return CATEGORY_ICON_MAP[category.toLowerCase()] || null;
  return null;
}

/**
 * Inline icon element for use with inline styles (non-Tailwind panels).
 * Returns an img element or null.
 */
export function ResourceIconImg({ resourceType, category, size = 16, style = {} }) {
  const iconPath = getResourceIcon(resourceType, category);
  if (!iconPath) return null;
  return (
    <img
      src={iconPath}
      alt=""
      style={{ width: size, height: size, flexShrink: 0, ...style }}
    />
  );
}

export default getResourceIcon;
