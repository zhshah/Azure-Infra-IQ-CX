import React, { useState, useEffect } from 'react'
import { X, Settings, Eye, EyeOff, CheckCircle, AlertCircle, Loader, FlaskConical, Info } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'

function Field({ label, type = 'text', value, onChange, placeholder, masked, hint }) {
  const [show, setShow] = useState(false)
  const inputType = masked ? (show ? 'text' : 'password') : type
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-gray-400">{label}</label>
      <div className="relative">
        <input
          type={inputType} value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600 pr-10"
        />
        {masked && (
          <button type="button" onClick={() => setShow(s => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
      {hint && <p className="text-xs text-gray-600">{hint}</p>}
    </div>
  )
}

function NumberField({ label, value, onChange, min, max, step = 1, hint }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-gray-400">{label}</label>
      <input type="number" value={value} min={min} max={max} step={step}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-600"
      />
      {hint && <p className="text-xs text-gray-600">{hint}</p>}
    </div>
  )
}

function Tab({ label, active, onClick }) {
  return (
    <button onClick={onClick} className={clsx(
      'px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors',
      active ? 'text-blue-400 border-blue-500' : 'text-gray-500 border-transparent hover:text-gray-300',
    )}>
      {label}
    </button>
  )
}

function StatusMessage({ type, msg }) {
  if (!msg) return null
  const isError = type === 'error'
  return (
    <div className={clsx(
      'flex items-center gap-2 px-3 py-2 rounded-lg text-sm',
      isError ? 'bg-red-900/30 text-red-400' : 'bg-green-900/30 text-green-400',
    )}>
      {isError ? <AlertCircle size={14} /> : <CheckCircle size={14} />}
      {msg}
    </div>
  )
}

const PROVIDER_OPTIONS = [
  { value: 'azure_openai', label: 'Azure OpenAI', desc: 'Uses your Azure OpenAI resource — credentials stay inside your tenant' },
  { value: 'claude',       label: 'Claude (Anthropic)', desc: 'Use Claude claude-sonnet-4-5 directly via Anthropic API for AI infrastructure analysis' },
  { value: 'azure_ai',     label: 'Claude via Azure AI Foundry', desc: 'Use Claude deployed on Azure AI Foundry (ai-apex-claude) — keeps keys inside Azure' },
  { value: 'none',         label: 'Disabled',     desc: 'Rule-based scoring only, no AI narrative or false-positive detection' },
]

export default function SettingsPanel({ open, onClose, onSaved, subscriptions = [], onDisconnect }) {
  const [tab,              setTab]              = useState('azure')
  const [form,    setForm]    = useState({
    azure_client_id: '', azure_client_secret: '', azure_tenant_id: '',
    azure_subscription_id: '', azure_subscription_ids: '',
    scan_scope_subscription_id: '', scan_scope_resource_group: '',
    ai_provider: 'azure_openai',
    azure_openai_endpoint: '',
    azure_openai_key: '', azure_openai_deployment: 'gpt-4o-mini',
    anthropic_key: '',
    azure_ai_endpoint: '', azure_ai_key: '',
    idle_threshold_pct: 3, no_metrics_age_days: 7,
    cost_floor_usd: 1, ai_cost_threshold_usd: 20,
    cache_ttl_seconds: 1800, demo_mode: false,
    credential_timeout_hours: 0,
    auto_refresh_interval_hours: 0,
    // On-premises LDAP
    onprem_dc_host: '', onprem_dc_port: 389,
    onprem_use_ssl: false, onprem_use_starttls: false,
    onprem_base_dn: '', onprem_bind_user: '', onprem_bind_password: '',
    onprem_auth_method: 'ntlm', onprem_connect_timeout: 10,
    onprem_search_timeout: 30, onprem_winrm_user: '', onprem_winrm_password: '',
    onprem_discovery_interval_hours: 0,
  })
  const [loading,  setLoading]  = useState(false)
  const [testing,  setTesting]  = useState(false)
  const [status,   setStatus]   = useState(null)

  useEffect(() => {
    if (!open) return
    api.getSettings().then(s => {
      setForm(prev => ({
        ...prev,
        azure_client_id:        s.azure_client_id        ?? '',
        azure_tenant_id:        s.azure_tenant_id        ?? '',
        azure_subscription_id:  s.azure_subscription_id  ?? '',
        azure_subscription_ids:     s.azure_subscription_ids     ?? '',
        scan_scope_subscription_id: s.scan_scope_subscription_id ?? '',
        scan_scope_resource_group:  s.scan_scope_resource_group  ?? '',
        ai_provider:                s.ai_provider                ?? 'azure_openai',
        azure_openai_endpoint:  s.azure_openai_endpoint  ?? '',
        azure_openai_deployment:s.azure_openai_deployment ?? 'gpt-4o-mini',
        azure_ai_endpoint:      s.azure_ai_endpoint ?? '',
        idle_threshold_pct:     s.idle_threshold_pct     ?? 3,
        no_metrics_age_days:    s.no_metrics_age_days    ?? 7,
        cost_floor_usd:         s.cost_floor_usd         ?? 1,
        ai_cost_threshold_usd:  s.ai_cost_threshold_usd  ?? 20,
        cache_ttl_seconds:           s.cache_ttl_seconds            ?? 1800,
        demo_mode:                   s.demo_mode                    ?? false,
        credential_timeout_hours:    s.credential_timeout_hours     ?? 0,
        auto_refresh_interval_hours: s.auto_refresh_interval_hours  ?? 0,
        // masked secrets — leave blank
        azure_client_secret: '',
        azure_openai_key:    '',
        anthropic_key:       '',
        azure_ai_key:        '',
        _has_azure_secret:   s.has_azure_secret,
        _has_aoai_key:       s.has_azure_openai_key,
        _has_anthropic_key:  s.has_anthropic_key,
        _has_azure_ai_key:   s.has_azure_ai_key,
        // On-premises
        onprem_dc_host:      s.ONPREM_DC_HOST ?? '',
        onprem_dc_port:      s.ONPREM_DC_PORT ?? 389,
        onprem_use_ssl:      s.ONPREM_USE_SSL ?? false,
        onprem_use_starttls: s.ONPREM_USE_STARTTLS ?? false,
        onprem_base_dn:      s.ONPREM_BASE_DN ?? '',
        onprem_bind_user:    s.ONPREM_BIND_USER ?? '',
        onprem_bind_password: '',
        onprem_auth_method:  s.ONPREM_AUTH_METHOD ?? 'ntlm',
        onprem_connect_timeout: s.ONPREM_CONNECT_TIMEOUT ?? 10,
        onprem_search_timeout:  s.ONPREM_SEARCH_TIMEOUT ?? 30,
        onprem_winrm_user:   s.ONPREM_WINRM_USER ?? '',
        onprem_winrm_password: '',
        onprem_discovery_interval_hours: s.ONPREM_DISCOVERY_INTERVAL_HOURS ?? 0,
        _has_ldap_password:  !!(s.ONPREM_BIND_PASSWORD),
        _has_winrm_password: !!(s.ONPREM_WINRM_PASSWORD),
      }))
    }).catch(() => {})
  }, [open])

  function set(key) { return val => setForm(prev => ({ ...prev, [key]: val })) }

  async function save() {
    setLoading(true); setStatus(null)
    try {
      const body = { ...form }
      if (!body.azure_client_secret) delete body.azure_client_secret
      if (!body.azure_openai_key)    delete body.azure_openai_key
      if (!body.anthropic_key)       delete body.anthropic_key
      if (!body.azure_ai_key)        delete body.azure_ai_key
      // Map form keys to settings keys
      body.AZURE_CLIENT_ID        = body.azure_client_id
      body.AZURE_TENANT_ID        = body.azure_tenant_id
      body.AZURE_SUBSCRIPTION_ID  = body.azure_subscription_id
      body.AZURE_SUBSCRIPTION_IDS       = body.azure_subscription_ids
      body.SCAN_SCOPE_SUBSCRIPTION_ID   = body.scan_scope_subscription_id || ''
      body.SCAN_SCOPE_RESOURCE_GROUP    = body.scan_scope_resource_group  || ''
      if (body.azure_client_secret) body.AZURE_CLIENT_SECRET = body.azure_client_secret
      if (body.azure_openai_key)    body.AZURE_OPENAI_KEY    = body.azure_openai_key
      if (body.anthropic_key)       body.ANTHROPIC_API_KEY   = body.anthropic_key
      if (body.azure_ai_key)        body.AZURE_AI_KEY        = body.azure_ai_key
      body.AZURE_OPENAI_ENDPOINT   = body.azure_openai_endpoint
      body.AZURE_OPENAI_DEPLOYMENT = body.azure_openai_deployment
      body.AZURE_AI_ENDPOINT       = body.azure_ai_endpoint || ''
      body.credential_timeout_hours = body.credential_timeout_hours ?? 0
      // On-Premises LDAP settings
      body.ONPREM_DC_HOST = body.onprem_dc_host || ''
      body.ONPREM_DC_PORT = body.onprem_dc_port || 389
      body.ONPREM_USE_SSL = body.onprem_use_ssl || false
      body.ONPREM_USE_STARTTLS = body.onprem_use_starttls || false
      body.ONPREM_BASE_DN = body.onprem_base_dn || ''
      body.ONPREM_BIND_USER = body.onprem_bind_user || ''
      if (body.onprem_bind_password) body.ONPREM_BIND_PASSWORD = body.onprem_bind_password
      body.ONPREM_AUTH_METHOD = body.onprem_auth_method || 'ntlm'
      body.ONPREM_CONNECT_TIMEOUT = body.onprem_connect_timeout || 10
      body.ONPREM_SEARCH_TIMEOUT = body.onprem_search_timeout || 30
      body.ONPREM_WINRM_USER = body.onprem_winrm_user || ''
      if (body.onprem_winrm_password) body.ONPREM_WINRM_PASSWORD = body.onprem_winrm_password
      body.ONPREM_DISCOVERY_INTERVAL_HOURS = body.onprem_discovery_interval_hours || 0
      await api.saveSettings(body)
      setStatus({ type: 'success', msg: 'Settings saved. Refresh dashboard to apply.' })
      onSaved?.()
    } catch (err) {
      setStatus({ type: 'error', msg: err.message })
    } finally { setLoading(false) }
  }

  async function testAzure() {
    setTesting(true); setStatus(null)
    try {
      const res = await api.testAzure()
      setStatus({ type: 'success', msg: res.message || 'Azure connection OK!' })
    } catch (err) {
      setStatus({ type: 'error', msg: err.message })
    } finally { setTesting(false) }
  }

  async function testAI() {
    setTesting(true); setStatus(null)
    try {
      const body = { ai_provider: form.ai_provider }
      if (form.azure_openai_key)        body.AZURE_OPENAI_KEY        = form.azure_openai_key
      if (form.azure_openai_endpoint)   body.AZURE_OPENAI_ENDPOINT   = form.azure_openai_endpoint
      if (form.azure_openai_deployment) body.AZURE_OPENAI_DEPLOYMENT = form.azure_openai_deployment
      const res = await api.testAI(body)
      setStatus({ type: 'success', msg: res.message || 'AI connection OK!' })
    } catch (err) {
      setStatus({ type: 'error', msg: err.message })
    } finally { setTesting(false) }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-lg bg-gray-900 border-l border-gray-800 flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Settings size={16} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-white">Settings</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800 px-4 overflow-x-auto">
          {[['azure','Azure'], ['ai','AI Provider'], ['onprem','On-Premises'], ['scoring','Scoring'], ['general','General']].map(([k, l]) => (
            <Tab key={k} label={l} active={tab === k} onClick={() => setTab(k)} />
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">

          {/* ── Azure tab ── */}
          {tab === 'azure' && (
            <>
              {/* ── Reconfigure button (shown when connected) ── */}
              {form.azure_subscription_id && (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-green-900/20 border border-green-800/40">
                  <div className="flex items-center gap-2 text-xs text-green-400">
                    <CheckCircle size={13} className="shrink-0" />
                    {(() => {
                      const sub = subscriptions.find(s => s.subscription_id === form.azure_subscription_id)
                      const name = sub?.subscription_name
                      return name
                        ? <span>Connected to <span className="font-medium text-white">{name}</span></span>
                        : <span>Connected to <span className="font-mono">{form.azure_subscription_id.slice(0, 8)}…</span></span>
                    })()}
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      setForm(prev => ({ ...prev, azure_subscription_id: '', azure_client_id: '', azure_tenant_id: '', azure_client_secret: '' }))
                      await api.saveSettings({
                        AZURE_SUBSCRIPTION_ID: '',
                        AZURE_CLIENT_ID: '',
                        AZURE_TENANT_ID: '',
                        AZURE_CLIENT_SECRET: '',
                        persist_to_env: true,
                      }).catch(() => {})
                      if (onDisconnect) { onDisconnect(); return }
                      setStatus({ type: 'success', msg: 'Disconnected. Refresh the page to run the setup wizard again.' })
                    }}
                    className="text-xs text-gray-500 hover:text-red-400 transition-colors underline underline-offset-2"
                  >
                    Disconnect
                  </button>
                </div>
              )}

              {/* ── Service Principal instructions ── */}
              <div className="rounded-lg border border-blue-800/40 bg-blue-950/20 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Info size={13} className="text-blue-400 shrink-0" />
                  <p className="text-xs font-semibold text-blue-300">Required roles on your subscription</p>
                </div>
                <ul className="text-xs text-gray-400 space-y-1 pl-1">
                  <li><strong className="text-gray-300">Reader</strong> — enumerate resources and their properties</li>
                  <li><strong className="text-gray-300">Cost Management Reader</strong> — pull spend and billing data</li>
                  <li><strong className="text-gray-300">Monitoring Reader</strong> — fetch CPU, memory and network metrics</li>
                </ul>
                <p className="text-xs text-gray-600 pt-1">
                  Create a service principal in Azure AD, assign these roles at subscription scope, then paste the credentials below.
                </p>
              </div>
              <Field label="Tenant ID"       value={form.azure_tenant_id}       onChange={set('azure_tenant_id')}       placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
              <Field label="Client ID"       value={form.azure_client_id}       onChange={set('azure_client_id')}       placeholder="App registration client ID" />
              <Field label="Client Secret"   value={form.azure_client_secret}   onChange={set('azure_client_secret')}   placeholder={form._has_azure_secret ? '(already set — leave blank to keep)' : 'Paste new secret'} masked />
              <Field label="Primary Subscription ID" value={form.azure_subscription_id} onChange={set('azure_subscription_id')} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
              <Field
                label="Additional Subscription IDs (optional)"
                value={form.azure_subscription_ids}
                onChange={set('azure_subscription_ids')}
                placeholder="id1, id2, id3 — comma-separated"
                hint="Scan multiple subscriptions in one dashboard. If set, all subscriptions listed here plus the Primary ID will be scanned."
              />
              <button onClick={testAzure} disabled={testing} className="btn-ghost flex items-center gap-2 text-sm">
                {testing && <Loader size={14} className="animate-spin" />} Test Azure Connection
              </button>

              {/* ── Scan Scope ── */}
              <div className="pt-3 border-t border-gray-800">
                <div className="flex items-center gap-2 mb-2">
                  <FlaskConical size={13} className="text-amber-400" />
                  <p className="text-xs font-semibold text-amber-300">Scan Scope (Test Mode)</p>
                  {(form.scan_scope_subscription_id || form.scan_scope_resource_group) && (
                    <span className="ml-auto px-2 py-0.5 rounded-full bg-amber-900/40 border border-amber-700/50 text-xs text-amber-400 font-medium">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-600 mb-3">
                  Limit scans to a specific subscription or resource group. Perfect for validating the tool before scanning everything.
                  Leave blank to scan all subscriptions.
                </p>
                <div className="space-y-3">
                  <Field
                    label="Test Subscription ID (optional)"
                    value={form.scan_scope_subscription_id}
                    onChange={set('scan_scope_subscription_id')}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    hint="Only this subscription will be scanned. Must be in your subscription list above."
                  />
                  <Field
                    label="Test Resource Group (optional)"
                    value={form.scan_scope_resource_group}
                    onChange={set('scan_scope_resource_group')}
                    placeholder="my-test-rg"
                    hint="Only resources in this resource group will be scanned."
                  />
                  {(form.scan_scope_subscription_id || form.scan_scope_resource_group) && (
                    <button
                      type="button"
                      onClick={() => setForm(prev => ({ ...prev, scan_scope_subscription_id: '', scan_scope_resource_group: '' }))}
                      className="text-xs text-amber-600 hover:text-amber-400 underline underline-offset-2 transition-colors"
                    >
                      Clear scope — scan everything
                    </button>
                  )}
                </div>
              </div>

              {/* ── Credential auto-wipe timeout ── */}
              <div className="pt-3 border-t border-gray-800">
                <p className="text-xs font-semibold text-gray-400 mb-1">Credential Timeout</p>
                <p className="text-xs text-gray-600 mb-3">
                  Automatically wipe stored service principal credentials after this many hours of inactivity.
                  Set to <strong className="text-gray-500">0</strong> to disable. Recommended: 8h for shared machines.
                </p>
                <NumberField
                  label="Auto-wipe after (hours, 0 = never)"
                  value={form.credential_timeout_hours}
                  onChange={set('credential_timeout_hours')}
                  min={0} max={168} step={1}
                  hint={form.credential_timeout_hours > 0
                    ? `Credentials will be wiped after ${form.credential_timeout_hours}h of no scan activity.`
                    : 'Credentials persist until manually cleared.'}
                />
              </div>
            </>
          )}

          {/* ── AI Provider tab ── */}
          {tab === 'ai' && (
            <>
              {/* Provider selector */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-400">AI Provider</label>
                <div className="space-y-2">
                  {PROVIDER_OPTIONS.map(opt => (
                    <label key={opt.value} className={clsx(
                      'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                      form.ai_provider === opt.value
                        ? 'border-blue-600 bg-blue-900/20'
                        : 'border-gray-700 bg-gray-800/40 hover:border-gray-600',
                    )}>
                      <input type="radio" name="ai_provider" value={opt.value}
                        checked={form.ai_provider === opt.value}
                        onChange={() => setForm(prev => ({ ...prev, ai_provider: opt.value }))}
                        className="mt-0.5 accent-blue-500"
                      />
                      <div>
                        <p className="text-sm font-medium text-white">{opt.label}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Azure OpenAI fields */}
              {form.ai_provider === 'azure_openai' && (
                <div className="space-y-3 pt-2 border-t border-gray-800">
                  <p className="text-xs text-gray-500">
                    Requires Azure OpenAI resource. Find credentials in <span className="text-blue-400">Azure Portal → OpenAI → Keys and Endpoint</span>.
                  </p>
                  <Field label="Endpoint" value={form.azure_openai_endpoint} onChange={set('azure_openai_endpoint')}
                    placeholder="https://your-resource.openai.azure.com/"
                    hint="Base URL only — e.g. https://my-resource.openai.azure.com/ — do not include /openai/v1" />
                  <Field label="API Key" value={form.azure_openai_key} onChange={set('azure_openai_key')}
                    placeholder={form._has_aoai_key ? '(already set — leave blank to keep)' : 'Paste key'} masked />
                  <Field label="Deployment Name" value={form.azure_openai_deployment} onChange={set('azure_openai_deployment')}
                    placeholder="gpt-4o-mini"
                    hint="The name YOU gave the deployment in Azure OpenAI Studio — not the model name. Find it under Azure Portal → Azure OpenAI → Model deployments." />
                </div>
              )}

              {/* Claude (Anthropic) fields */}
              {form.ai_provider === 'claude' && (
                <div className="space-y-3 pt-2 border-t border-gray-800">
                  <p className="text-xs text-gray-500">
                    Get your API key at <span className="text-blue-400">console.anthropic.com</span>.
                    Uses <strong className="text-gray-300">claude-sonnet-4-5-20250514</strong> by default.
                  </p>
                  <Field label="Anthropic API Key" value={form.anthropic_key} onChange={set('anthropic_key')}
                    placeholder={form._has_anthropic_key ? '(already set — leave blank to keep)' : 'sk-ant-…'} masked />
                </div>
              )}

              {/* Azure AI Foundry (Claude) fields */}
              {form.ai_provider === 'azure_ai' && (
                <div className="space-y-3 pt-2 border-t border-gray-800">
                  <p className="text-xs text-gray-500">
                    Claude deployed via Azure AI Foundry. Find credentials under <span className="text-blue-400">Azure AI Foundry → Deployments</span>.
                  </p>
                  <Field label="Azure AI Endpoint" value={form.azure_ai_endpoint} onChange={set('azure_ai_endpoint')}
                    placeholder="https://your-hub.services.ai.azure.com/"
                    hint="Base endpoint for your Azure AI Foundry project" />
                  <Field label="Azure AI Key" value={form.azure_ai_key} onChange={set('azure_ai_key')}
                    placeholder={form._has_azure_ai_key ? '(already set — leave blank to keep)' : 'Paste key'} masked />
                </div>
              )}

              {/* Cost threshold (shown for all providers) */}
              {form.ai_provider !== 'none' && (
                <NumberField label="Min cost to send to AI (USD/mo)" value={form.ai_cost_threshold_usd}
                  onChange={set('ai_cost_threshold_usd')} min={0} step={5}
                  hint="Only resources above this cost are eligible for AI review." />
              )}

              {form.ai_provider !== 'none' && (
                <button onClick={testAI} disabled={testing} className="btn-ghost flex items-center gap-2 text-sm">
                  {testing && <Loader size={14} className="animate-spin" />} Test AI Connection
                </button>
              )}
            </>
          )}

          {/* ── On-Premises tab ── */}
          {tab === 'onprem' && (
            <>
              <div className="rounded-lg border border-purple-800/40 bg-purple-950/20 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Info size={13} className="text-purple-400 shrink-0" />
                  <p className="text-xs font-semibold text-purple-300">Active Directory / LDAP Configuration</p>
                </div>
                <p className="text-xs text-gray-400">
                  Configure direct LDAP connection to your Domain Controller for automatic server discovery.
                  No PowerShell RSAT or domain-joined machine required.
                </p>
              </div>

              <div className="space-y-3 border border-gray-700/40 rounded-lg p-4">
                <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Domain Controller</h3>
                <Field label="DC Host (IP or FQDN)" value={form.onprem_dc_host} onChange={set('onprem_dc_host')} placeholder="dc01.corp.contoso.com" hint="Domain Controller hostname or IP address" />
                <div className="grid grid-cols-2 gap-3">
                  <NumberField label="Port" value={form.onprem_dc_port} onChange={set('onprem_dc_port')} min={1} max={65535} hint="389=LDAP, 636=LDAPS" />
                  <div className="space-y-2 pt-5">
                    <label className="flex items-center gap-2 text-xs text-gray-400">
                      <input type="checkbox" checked={form.onprem_use_ssl} onChange={e => setForm(p => ({ ...p, onprem_use_ssl: e.target.checked, onprem_dc_port: e.target.checked ? 636 : 389 }))} className="rounded bg-gray-800 border-gray-600" />
                      Use SSL (LDAPS)
                    </label>
                    <label className="flex items-center gap-2 text-xs text-gray-400">
                      <input type="checkbox" checked={form.onprem_use_starttls} onChange={e => setForm(p => ({ ...p, onprem_use_starttls: e.target.checked }))} className="rounded bg-gray-800 border-gray-600" />
                      Use STARTTLS
                    </label>
                  </div>
                </div>
                <Field label="Base DN" value={form.onprem_base_dn} onChange={set('onprem_base_dn')} placeholder="DC=corp,DC=contoso,DC=com" hint="Search base for computer discovery" />
              </div>

              <div className="space-y-3 border border-gray-700/40 rounded-lg p-4">
                <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Bind Credentials</h3>
                <Field label="Username" value={form.onprem_bind_user} onChange={set('onprem_bind_user')} placeholder="DOMAIN\\svc-discovery or user@corp.contoso.com" hint="Service account with Read access to computer objects" />
                <Field label="Password" value={form.onprem_bind_password} onChange={set('onprem_bind_password')} placeholder={form._has_ldap_password ? '••••configured (leave blank to keep)' : 'Enter password'} masked hint="Encrypted at rest using machine-specific key" />
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-400">Authentication Method</label>
                  <select value={form.onprem_auth_method} onChange={e => setForm(p => ({ ...p, onprem_auth_method: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-600">
                    <option value="ntlm">NTLM (DOMAIN\\user format)</option>
                    <option value="simple">Simple Bind (UPN or DN)</option>
                  </select>
                </div>
                <button onClick={async () => {
                  setTesting(true); setStatus(null)
                  try {
                    const config = {
                      dc_host: form.onprem_dc_host, dc_port: form.onprem_dc_port,
                      use_ssl: form.onprem_use_ssl, use_starttls: form.onprem_use_starttls,
                      base_dn: form.onprem_base_dn, bind_user: form.onprem_bind_user,
                      bind_password: form.onprem_bind_password || '##STORED##',
                      auth_method: form.onprem_auth_method,
                    }
                    const res = await fetch('/api/onprem/ldap/test', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(config) }).then(r => r.json())
                    if (res.success) setStatus({ type: 'success', msg: res.message || 'LDAP connection successful!' })
                    else setStatus({ type: 'error', msg: res.error || 'LDAP connection failed' })
                  } catch (err) { setStatus({ type: 'error', msg: err.message }) }
                  finally { setTesting(false) }
                }} disabled={testing || !form.onprem_dc_host}
                  className="w-full py-2 rounded-lg text-xs font-medium bg-purple-600/80 hover:bg-purple-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {testing ? <Loader size={13} className="animate-spin inline mr-1" /> : null}
                  Test LDAP Connection
                </button>
              </div>

              <div className="space-y-3 border border-gray-700/40 rounded-lg p-4">
                <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">WinRM / Collection Credentials</h3>
                <p className="text-xs text-gray-500">Optional — used for remote data collection. If blank, uses the logged-in user context.</p>
                <Field label="WinRM Username" value={form.onprem_winrm_user} onChange={set('onprem_winrm_user')} placeholder="DOMAIN\\admin-user" />
                <Field label="WinRM Password" value={form.onprem_winrm_password} onChange={set('onprem_winrm_password')} placeholder={form._has_winrm_password ? '••••configured' : ''} masked />
              </div>

              <div className="space-y-3 border border-gray-700/40 rounded-lg p-4">
                <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Discovery Engine</h3>
                <NumberField label="Auto-discovery Interval (hours)" value={form.onprem_discovery_interval_hours} onChange={set('onprem_discovery_interval_hours')} min={0} max={168} hint="0 = disabled. Runs LDAP discovery + collection on a schedule." />
                <div className="grid grid-cols-2 gap-3">
                  <NumberField label="Connect Timeout (sec)" value={form.onprem_connect_timeout} onChange={set('onprem_connect_timeout')} min={5} max={60} />
                  <NumberField label="Search Timeout (sec)" value={form.onprem_search_timeout} onChange={set('onprem_search_timeout')} min={10} max={120} />
                </div>
              </div>
            </>
          )}

          {/* ── Scoring tab ── */}
          {tab === 'scoring' && (
            <>
              {/* How scoring works */}
              <div className="rounded-lg border border-gray-700/60 bg-gray-800/30 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Info size={13} className="text-blue-400 shrink-0" />
                  <p className="text-xs font-semibold text-gray-300">How scoring works</p>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Each resource is scored 0–100 based on signals pulled from Azure Monitor, Cost Management, and Advisor.
                  A higher score means the resource is earning its cost; a lower score means it's a waste candidate.
                </p>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-gray-300 font-medium w-28">Fully Used</span>
                    <span className="text-gray-500">Score ≥ 76 — resource is actively earning its cost</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                    <span className="text-gray-300 font-medium w-28">Actively Used</span>
                    <span className="text-gray-500">Score 51–75 — used but has room to optimise</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                    <span className="text-gray-300 font-medium w-28">Likely Waste</span>
                    <span className="text-gray-500">Score 26–50 — low activity, review recommended</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                    <span className="text-gray-300 font-medium w-28">Confirmed Waste</span>
                    <span className="text-gray-500">Score ≤ 25 — negligible activity, safe to act on</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gray-500 shrink-0" />
                    <span className="text-gray-300 font-medium w-28">Unknown</span>
                    <span className="text-gray-500">No metrics returned — Diagnostics not enabled</span>
                  </div>
                </div>
                <p className="text-xs text-gray-600 border-t border-gray-700 pt-2 mt-1">
                  Signals include: average + peak CPU/memory, network activity, request count, days since last use, workload pattern (bursty/declining/inactive), resource locks, and Reserved Instance coverage.
                  Resources with locks or RI coverage are flagged as protected and floored at score 26 regardless of utilisation.
                </p>
              </div>

            </>
          )}

          {/* ── General tab ── */}
          {tab === 'general' && (
            <>
              <div className="rounded-lg border border-gray-700/60 bg-gray-800/30 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Info size={13} className="text-blue-400 shrink-0" />
                  <p className="text-xs font-semibold text-gray-300">About caching</p>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  A full scan queries Azure Monitor, Cost Management, Advisor, and Resource Graph — it can take 30–90 seconds depending on your subscription size.
                  Results are cached in memory so subsequent dashboard loads are instant. The cache is cleared automatically when you change settings or click Refresh.
                </p>
              </div>
              <NumberField label="Cache TTL (seconds)" value={form.cache_ttl_seconds} onChange={set('cache_ttl_seconds')} min={60} max={86400} step={60}
                hint="How long scan results are kept before a forced re-fetch. Default 1800s (30 min). Lower = fresher data but more Azure API calls." />
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-300">Auto-refresh interval</label>
                <select
                  value={form.auto_refresh_interval_hours}
                  onChange={e => set('auto_refresh_interval_hours')(parseInt(e.target.value, 10))}
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-blue-500/60"
                >
                  <option value={0}>Disabled</option>
                  <option value={1}>Every 1 hour</option>
                  <option value={6}>Every 6 hours</option>
                  <option value={12}>Every 12 hours</option>
                  <option value={24}>Every 24 hours</option>
                </select>
                <p className="text-xs text-gray-500">Automatically refresh data in the background so the portal loads instantly. Requires the app to be running.</p>
              </div>
            </>
          )}

          {status && <StatusMessage {...status} />}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-800 flex gap-3 justify-end">
          <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
          <button onClick={save} disabled={loading} className="btn-primary flex items-center gap-2 text-sm">
            {loading && <Loader size={14} className="animate-spin" />}
            Save Settings
          </button>
        </div>
      </div>
    </div>
  )
}
