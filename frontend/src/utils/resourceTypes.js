// Friendly Azure resource-type labels + icon helpers.
// Azure resource types look like "microsoft.compute/virtualmachines"; the last
// path segment is lowercase and concatenated (e.g. "virtualmachines"), so a
// generic title-case can't produce "Virtual Machines" — we keep a curated map
// with a sensible camelCase/title-case fallback for anything not listed.

export const RESOURCE_TYPE_LABELS = {
  virtualmachines:            'Virtual Machines',
  virtualmachinescalesets:    'VM Scale Sets',
  disks:                      'Managed Disks',
  snapshots:                  'Disk Snapshots',
  images:                     'VM Images',
  galleries:                  'Compute Galleries',
  availabilitysets:           'Availability Sets',
  storageaccounts:            'Storage Accounts',
  fileshares:                 'File Shares',
  servers:                    'SQL Servers',
  sqlservers:                 'SQL Servers',
  databases:                  'SQL Databases',
  sqldatabases:               'SQL Databases',
  managedinstances:          'SQL Managed Instances',
  flexibleservers:            'Flexible Servers (PostgreSQL/MySQL)',
  databaseaccounts:           'Cosmos DB',
  rediscaches:                'Redis Cache',
  redis:                      'Redis Cache',
  redisenterprise:            'Azure Managed Redis',
  sites:                      'App Service / Functions',
  webapps:                    'Web Apps',
  functionapps:               'Function Apps',
  serverfarms:                'App Service Plans',
  staticsites:                'Static Web Apps',
  containerapps:              'Container Apps',
  managedenvironments:        'Container Apps Environments',
  containergroups:            'Container Instances',
  containerregistries:        'Container Registries',
  registries:                 'Container Registries',
  managedclusters:            'Kubernetes (AKS)',
  clusters:                   'Clusters',
  publicipaddresses:          'Public IP Addresses',
  networkinterfaces:          'Network Interfaces',
  networksecuritygroups:      'Network Security Groups',
  virtualnetworks:            'Virtual Networks',
  loadbalancers:              'Load Balancers',
  applicationgateways:        'Application Gateways',
  azurefirewalls:             'Azure Firewalls',
  natgateways:                'NAT Gateways',
  bastionhosts:               'Azure Bastion',
  privateendpoints:           'Private Endpoints',
  privatednszones:            'Private DNS Zones',
  dnszones:                   'DNS Zones',
  virtualnetworkgateways:     'VPN / ExpressRoute Gateways',
  routetables:                'Route Tables',
  trafficmanagerprofiles:     'Traffic Manager',
  frontdoors:                 'Front Door',
  vaults:                     'Key Vaults',
  accounts:                   'Cognitive / AI Services',
  workspaces:                 'Workspaces (Log Analytics / ML)',
  components:                 'Application Insights',
  searchservices:             'Azure AI Search',
  openai:                     'Azure OpenAI',
  cognitiveservices:          'Cognitive Services',
  namespaces:                 'Service Bus / Event Hubs',
  eventhubnamespaces:         'Event Hubs',
  topics:                     'Event Grid Topics',
  systemtopics:               'Event Grid System Topics',
  workflows:                  'Logic Apps',
  automationaccounts:         'Automation Accounts',
  datafactories:              'Data Factories',
  cdnprofiles:                'CDN Profiles',
  sqlpools:                   'Synapse SQL Pools',
  machines:                   'Arc-enabled Servers',
  connections:                'API Connections',
  actiongroups:               'Action Groups',
  managedidentities:          'Managed Identities',
  userassignedidentities:     'User-assigned Identities',
  agents:                     'Foundry Agents',
}

// Path-aware overrides (match on the full lowercased type or its suffix).
const PATH_OVERRIDES = [
  ['microsoft.recoveryservices/vaults',                 'Recovery Services Vaults'],
  ['microsoft.dataprotection/backupvaults',             'Backup Vaults'],
  ['microsoft.compute/virtualmachines/extensions',      'VM Extensions'],
  ['microsoft.hybridcompute/machines',                  'Arc-enabled Servers'],
  ['microsoft.hybridcompute/machines/extensions',       'Arc VM Extensions'],
  ['microsoft.operationalinsights/workspaces',          'Log Analytics Workspaces'],
  ['microsoft.machinelearningservices/workspaces',      'ML / AI Foundry Workspaces'],
  ['microsoft.cognitiveservices/accounts',              'Azure AI / Cognitive Services'],
  ['microsoft.cognitiveservices/accounts/projects',     'AI Foundry Projects'],
  ['microsoft.sql/servers',                             'SQL Servers'],
  ['microsoft.sql/servers/databases',                   'SQL Databases'],
  ['microsoft.web/sites',                               'App Service / Functions'],
  ['microsoft.web/serverfarms',                         'App Service Plans'],
  ['microsoft.web/connections',                         'API Connections'],
  ['microsoft.documentdb/databaseaccounts',             'Cosmos DB'],
  ['microsoft.cache/redisenterprise',                   'Azure Managed Redis'],
  ['microsoft.cache/redis',                             'Redis Cache'],
  ['microsoft.containerservice/managedclusters',        'Kubernetes (AKS)'],
]

/**
 * Human-friendly label for an Azure resource type string.
 * @param {string} resourceType e.g. "microsoft.compute/virtualmachines"
 * @returns {string} e.g. "Virtual Machines"
 */
export function prettyResourceType(resourceType) {
  if (!resourceType) return '\u2014'
  const lower = String(resourceType).toLowerCase()
  for (const [needle, label] of PATH_OVERRIDES) {
    if (lower === needle || lower.endsWith(needle)) return label
  }
  const last = lower.split('/').pop()
  if (RESOURCE_TYPE_LABELS[last]) return RESOURCE_TYPE_LABELS[last]
  // Fallback: split camelCase, capitalise each word.
  return last
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (s) => s.toUpperCase())
}

/** Backend icon URL for a resource type (served by /api/icons/{type}). */
export function resourceTypeIconUrl(resourceType) {
  if (!resourceType) return null
  return `/api/icons/${String(resourceType).toLowerCase()}`
}
