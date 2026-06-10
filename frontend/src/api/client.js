const BASE = '/api'

// Must match SNAPSHOT_SCHEMA_VERSION in backend/services/persistence_service.py.
// A cached snapshot stamped with a different (or missing) version is rejected so
// the app does a fresh build instead of rendering an incompatible payload.
const SNAPSHOT_SCHEMA_VERSION = 1

async function request(path, options = {}) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
  } catch (networkErr) {
    throw new Error('Backend unavailable — please ensure the server is running')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // If the server returned HTML (e.g. Vite proxy error page), give a clean message
    if (text.trim().startsWith('<')) {
      throw new Error(`Backend unavailable (HTTP ${res.status})`)
    }
    let detail
    try { detail = JSON.parse(text).detail } catch {}
    throw new Error(detail || `HTTP ${res.status}: ${res.statusText}`)
  }

  // Parse response — guard against HTML in a 200 response (e.g. proxy fallback)
  const text = await res.text()
  if (text.trim().startsWith('<')) {
    throw new Error('Backend unavailable — received HTML instead of JSON')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Invalid JSON response from backend')
  }
}

export const api = {
  // Internal helper — exposed so components can call /api/* paths directly
  _request: request,

  // Dashboard — non-streaming fallback
  getDashboard: (refresh = false) =>
    request(`/dashboard${refresh ? '?refresh=true' : ''}`),

  // Return cached dashboard instantly (204 → null if nothing cached yet)
  getCachedDashboard: async () => {
    try {
      const res = await fetch(`${BASE}/dashboard/cached`, {
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.status === 204) return null
      if (!res.ok) return null
      const text = await res.text()
      if (!text || text.trim().startsWith('<')) return null
      const parsed = JSON.parse(text)
      // Ignore snapshots from an incompatible schema version — render a fresh
      // build rather than risk crashing on a missing/renamed field.
      if (!parsed || parsed._snapshot_schema !== SNAPSHOT_SCHEMA_VERSION) return null
      return parsed
    } catch (err) {
      console.error('[getCachedDashboard] Error:', err)
      return null
    }
  },

  // Cache status
  getCacheStatus: () => request('/cache/status'),

  // On-demand live metrics for a single resource (fetched when expanded)
  getResourceMetrics: (id) => request(`/resource/${encodeURIComponent(id)}/metrics`),

  // Settings
  getSettings:           ()          => request('/settings'),
  saveSettings:          (body)      => request('/settings', { method: 'POST', body: JSON.stringify(body) }),
  testAzure:             (body = {}) => request('/settings/test-azure',            { method: 'POST', body: JSON.stringify(body) }),
  testAI:                (body = {}) => request('/settings/test-ai',               { method: 'POST', body: JSON.stringify(body) }),
  exportSettings:        ()          => request('/settings/export'),
  discoverSubscriptions: (authMethod = '') => request(`/settings/discover-subscriptions${authMethod ? `?auth_method=${authMethod}` : ''}`),
  preflight:             ()               => request('/settings/preflight'),
  getAuthMethod:         ()               => request('/settings/auth-method'),
  getResourceGroups:     (subId = '')   => request(`/settings/resource-groups${subId ? `?subscription_id=${subId}` : ''}`),

  // SSE streaming dashboard — accepts optional URLSearchParams.
  // EventSource cannot set headers, so when the app is auth-gated we append the
  // Entra token as ?access_token= (the backend accepts it for the stream route).
  streamDashboard(onEvent, onDone, onError, params = null) {
    const qs  = params && params.toString() ? `?${params.toString()}` : ''
    const baseUrl = `${BASE}/dashboard/stream${qs}`
    let es = null
    let closed = false

    const start = async () => {
      let url = baseUrl
      try {
        const { withToken } = await import('../auth/auth.js')
        url = await withToken(baseUrl)
      } catch {
        // auth module unavailable / not active — use the unauthenticated URL
      }
      if (closed) return
      es = new EventSource(url)

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          if (data.type === 'done') {
            onDone(data.data)
            es.close()
          } else if (data.type === 'error') {
            onError(new Error(data.message))
            es.close()
          } else {
            onEvent(data)
          }
        } catch (err) {
          onError(err)
          es.close()
        }
      }

      es.onerror = () => {
        onError(new Error('SSE connection lost'))
        es.close()
      }
    }

    start()

    return () => { closed = true; if (es) es.close() }
  },

  // Projects — portal-first resource grouping
  getProjects:   ()                  => request('/projects').then(r => Array.isArray(r) ? r : (r?.projects || [])),
  createProject: (body)              => request('/projects', { method: 'POST', body: JSON.stringify(body) }),
  updateProject: (id, body)          => request(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteProject: async (id)          => {
    const res = await fetch(`${BASE}/projects/${id}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`)
  },
  addProjectResources:    (id, ids)  => request(`/projects/${id}/resources`, { method: 'POST', body: JSON.stringify({ resource_ids: ids }) }),
  removeProjectResources: (id, ids)  => request(`/projects/${id}/resources`, { method: 'DELETE', body: JSON.stringify({ resource_ids: ids }) }),

  // Dependencies
  getDependencySummary:  ()          => request('/dependencies/summary'),
  getDependencyClusters: ()          => request('/dependencies/clusters'),
  getDependencySPOF:     ()          => request('/dependencies/spof'),
  getBlastRadius:        (id)        => request(`/dependencies/${encodeURIComponent(id)}/blast-radius`),
  getResourceDeps:       (id)        => request(`/dependencies/${encodeURIComponent(id)}`),

  // Enhanced Backup & DR
  getBackupEnhanced:     (refresh)   => request(`/backup/enhanced${refresh ? '?refresh=true' : ''}`),

  // BCDR Assessment
  getBCDRDashboard:      ()          => request('/bcdr/dashboard'),
  getBCDRAssessments:    (params)    => request(`/bcdr/assessments?${new URLSearchParams(params || {}).toString()}`),
  getBCDRQuickWins:      ()          => request('/bcdr/quick-wins'),
  getBCDRResource:       (id)        => request(`/bcdr/resource/${encodeURIComponent(id)}`),
  refreshBCDR:           ()          => request('/bcdr/refresh', { method: 'POST' }),
  getBCDRBusinessImpact: ()          => request('/bcdr/business-impact'),
  getBCDRRecoverySeq:    ()          => request('/bcdr/recovery-sequence'),

  // Health Score
  getHealthScore:        ()          => request('/health-score'),

  // Custom Tagging
  getTagSchema:          ()          => request('/tags/schema'),
  upsertTagSchema:       (entry)     => request('/tags/schema', { method: 'POST', body: JSON.stringify(entry) }),
  deleteTagSchema:       (key)       => request(`/tags/schema/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  getResourceTags:       (id)        => request(`/tags/resource/${encodeURIComponent(id)}`),
  setResourceTags:       (id, tags)  => request(`/tags/resource/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ tags }) }),
  bulkTagResources:      (ids, tags) => request('/tags/bulk', { method: 'POST', body: JSON.stringify({ resource_ids: ids, tags }) }),
  getAllTags:             (ids)       => request(`/tags/all${ids ? `?resource_ids=${ids.join(',')}` : ''}`),
  getTagStats:           ()          => request('/tags/stats'),
  importTags:            (csv_text)  => request('/tags/import', { method: 'POST', body: JSON.stringify({ csv_text }) }),

  // AI Infrastructure Intelligence
  getAIStatus:           ()          => request('/ai/status'),
  getAIWorkload:         (refresh)   => request(`/ai/workload${refresh ? '?refresh=true' : ''}`),
  getAIResource:         (id)        => request(`/ai/resource/${encodeURIComponent(id)}`),
  getAIDependency:       (id)        => request(`/ai/dependency/${encodeURIComponent(id)}`),
  getAIRoadmap:          (refresh)   => request(`/ai/roadmap${refresh ? '?refresh=true' : ''}`),
  getAIBCDR:             (refresh)   => request(`/ai/bcdr?mode=comprehensive${refresh ? '&refresh=true' : ''}`),
  getAIBCDRResources:    (refresh)   => request(`/ai/bcdr?mode=resources${refresh ? '&refresh=true' : ''}`),
  getAIBCDRAVS:          (refresh)   => request(`/ai/bcdr/avs${refresh ? '?refresh=true' : ''}`),
  getAIBCDRDeep:         (refresh)   => request(`/ai/bcdr/deep${refresh ? '?refresh=true' : ''}`),
  aiSemanticSearch:      (query, top_k = 20) => request('/ai/search', { method: 'POST', body: JSON.stringify({ query, top_k }) }),

  // AI Module Analysis (per-category)
  getAIMaturity:         (refresh)   => request(`/ai/maturity${refresh ? '?refresh=true' : ''}`),
  getAISecurity:         (refresh)   => request(`/ai/security${refresh ? '?refresh=true' : ''}`),
  getAIInnovation:       (refresh)   => request(`/ai/innovation${refresh ? '?refresh=true' : ''}`),
  getAIMigration:        (refresh)   => request(`/ai/migration${refresh ? '?refresh=true' : ''}`),
  getAIBackup:           (refresh)   => request(`/ai/backup${refresh ? '?refresh=true' : ''}`),
  getAIResilience:       (refresh)   => request(`/ai/resilience${refresh ? '?refresh=true' : ''}`),
  getAILicensing:        (refresh)   => request(`/ai/licensing${refresh ? '?refresh=true' : ''}`),
  getAICloudAdoption:    (refresh)   => request(`/ai/cloud-adoption${refresh ? '?refresh=true' : ''}`),

  // Networking
  getNetworkingDashboard: ()         => request('/networking/dashboard'),
  getAINetworking:       (refresh)   => request(`/ai/networking${refresh ? '?refresh=true' : ''}`),

  // BCDR Metadata (Phase 1 Planning)
  getBCDRMetadataAll:    ()          => request('/bcdr/metadata'),
  getBCDRMetadata:       (id)        => request(`/bcdr/metadata/${encodeURIComponent(id)}`),
  saveBCDRMetadata:      (id, meta)  => request(`/bcdr/metadata/${encodeURIComponent(id)}`, { 
    method: 'POST', 
    body: JSON.stringify(meta) 
  }),
  bulkSaveBCDRMetadata:  (updates)   => request('/bcdr/metadata/bulk', { 
    method: 'POST', 
    body: JSON.stringify({ updates }) 
  }),
  deleteBCDRMetadata:    (id)        => request(`/bcdr/metadata/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getBCDRMetadataStats:  ()          => request('/bcdr/metadata/stats'),

  // Resource Snapshots
  getResourceSnapshots:  (id, limit) => request(`/snapshots/${encodeURIComponent(id)}${limit ? `?limit=${limit}` : ''}`),

  // ── APEX Integration (Phase 2 Implementation) ──────────────────────────────
  
  // APEX Agents
  listApexAgents:        ()                 => request('/apex/agents'),
  executeApexAgent:      (projectId, data)  => request(`/apex/projects/${projectId}/execute-agent`, { 
    method: 'POST', 
    body: JSON.stringify(data) 
  }),
  getApexExecutionStatus: (executionId)     => request(`/apex/executions/${executionId}`),
  listProjectExecutions:  (projectId)       => request(`/apex/projects/${projectId}/executions`),
  getApexArtifact:        (artifactId)      => request(`/apex/artifacts/${artifactId}`),
  getExecutionArtifacts:  (executionId)     => request(`/apex/executions/${executionId}/artifacts`),
  
  // MCP Services
  getAzurePricing:        (resourceType, region, sku) => request('/mcp/pricing', {
    method: 'POST',
    body: JSON.stringify({ resource_type: resourceType, region, sku })
  }),
  calculateArchitectureCost: (resources)    => request('/mcp/pricing/architecture', {
    method: 'POST',
    body: JSON.stringify({ resources })
  }),
  generateDiagram:        (architecture, diagramType = 'network') => request('/mcp/diagram/generate', {
    method: 'POST',
    body: JSON.stringify({ architecture, diagram_type: diagramType })
  }),

  // ── On-Premises Data Collection ────────────────────────────────────────────
  getOnPremSummary:        ()                    => request('/onprem/summary'),
  getOnPremServers:        (params = {})         => {
    const qs = new URLSearchParams(params).toString()
    return request(`/onprem/servers${qs ? '?' + qs : ''}`)
  },
  getOnPremServerDetail:   (serverId)            => request(`/onprem/servers/${encodeURIComponent(serverId)}`),
  getOnPremApplications:   ()                    => request('/onprem/applications'),
  getOnPremMigrationCandidates: ()               => request('/onprem/migration-candidates'),
  getOnPremBatches:        ()                    => request('/onprem/batches'),
  deleteOnPremBatch:       (batchId)             => request(`/onprem/batches/${encodeURIComponent(batchId)}`, { method: 'DELETE' }),
  uploadOnPremZip:         (file)                => {
    const formData = new FormData()
    formData.append('file', file)
    return fetch(`/api/onprem/upload`, { method: 'POST', body: formData }).then(r => r.json())
  },
  generateOnPremScript:    (options)             => request('/onprem/generate-script', {
    method: 'POST',
    body: JSON.stringify(options)
  }),
  getOnPremAIAnalysis:     (refresh = false)     => request(`/onprem/ai/analysis${refresh ? '?refresh=true' : ''}`),

  // ── On-Premises Remote Discovery & Collection ──────────────────────────────
  getOnPremPrerequisites:  ()                    => request('/onprem/prerequisites'),
  parseServerList:         (input)               => request('/onprem/parse-servers', {
    method: 'POST', body: JSON.stringify({ input })
  }),
  uploadServerFile:        (file)                => {
    const formData = new FormData()
    formData.append('file', file)
    return fetch(`/api/onprem/parse-server-file`, { method: 'POST', body: formData }).then(r => r.json())
  },
  discoverADComputers:     (opts = {})           => request('/onprem/discover-ad', {
    method: 'POST', body: JSON.stringify(opts)
  }),
  testConnectivity:        (servers)             => request('/onprem/test-connectivity', {
    method: 'POST', body: JSON.stringify({ servers })
  }),
  startRemoteCollection:   (servers, modules, options = {}) => request('/onprem/collect-remote', {
    method: 'POST', body: JSON.stringify({ servers, modules, options })
  }),
  getCollectionStatus:     (jobId)              => request(`/onprem/collect-remote/status/${encodeURIComponent(jobId)}`),
  cancelCollection:        (jobId)              => request(`/onprem/collect-remote/cancel/${encodeURIComponent(jobId)}`, { method: 'POST' }),
  getCollectionJobs:       ()                    => request('/onprem/collection-jobs'),

  // ── On-Premises Scheduled Monitoring ───────────────────────────────────────
  getOnPremSchedule:       ()                    => request('/onprem/schedule'),
  updateOnPremSchedule:    (config)             => request('/onprem/schedule', {
    method: 'PUT', body: JSON.stringify(config)
  }),
  runOnPremScanNow:        (overrides = null)   => request('/onprem/schedule/run-now', {
    method: 'POST', body: JSON.stringify(overrides || {})
  }),
  getOnPremScheduleHistory:()                    => request('/onprem/schedule/history'),

  // ── On-Premises LDAP Integration ──────────────────────────────────────────
  testLdapConnection:      (config)             => request('/onprem/ldap/test', { method: 'POST', body: JSON.stringify(config) }),
  ldapDiscover:            (filters = {})       => request('/onprem/ldap/discover', { method: 'POST', body: JSON.stringify({ filters }) }),
  ldapDiscoverGet:         (params = {})        => {
    const qs = new URLSearchParams(params).toString()
    return request(`/onprem/ldap/discover${qs ? '?' + qs : ''}`)
  },
  ldapGetOUs:              ()                    => request('/onprem/ldap/ous'),
  ldapStatus:              ()                    => request('/onprem/ldap/status'),

  // ── On-Premises Discovery Engine ──────────────────────────────────────────
  getEngineStatus:         ()                    => request('/onprem/engine/status'),
  startEngine:             (interval_hours = 0)  => request('/onprem/engine/start', { method: 'POST', body: JSON.stringify({ interval_hours }) }),
  stopEngine:              ()                    => request('/onprem/engine/stop', { method: 'POST' }),
  triggerEngine:           ()                    => request('/onprem/engine/trigger', { method: 'POST' }),

  // ── On-Premises Cross-Module Bridge ────────────────────────────────────────
  getOnPremBCDR:           ()                    => request('/onprem/bridge/bcdr'),
  getOnPremSecurity:       ()                    => request('/onprem/bridge/security'),
  getOnPremMigration:      ()                    => request('/onprem/bridge/migration'),
  getOnPremContext:        ()                    => request('/onprem/bridge/context'),

  // ── Update Management ──────────────────────────────────────────────────────
  getUpdateSummary:        ()                    => request('/updates/summary'),
  getPatchedMachines:      (days = 30)           => request(`/updates/patched?days=${days}`),
  getUnpatchedMachines:    (days = 30)           => request(`/updates/unpatched?days=${days}`),
  getPendingReboot:        ()                    => request('/updates/pending-reboot'),
  getRebootedMachines:     (days = 30)           => request(`/updates/rebooted?days=${days}`),
  getUpdatesByOS:          ()                    => request('/updates/by-os'),
  getUpdatesBySubscription:()                    => request('/updates/by-subscription'),
  getUpdatesByClassification:()                  => request('/updates/by-classification'),
  getComplianceTrend:      (days = 30)           => request(`/updates/compliance-trend?days=${days}`),
  getDetailedUpdateReport: (filters = {})        => request(`/updates/detailed-report?${new URLSearchParams(Object.entries(filters).filter(([,v]) => v)).toString()}`),
  getUpdateFilters:        ()                    => request('/updates/filters'),
  refreshUpdates:          ()                    => request('/updates/refresh', { method: 'POST' }),
}

