/**
 * MonitoringView — Azure Monitor observability for the whole estate.
 * Tabs: Dashboard, Coverage, Health, Alerts, Performance, AI Analysis.
 * Data: /api/monitor/* (Resource Graph + Azure Monitor + Log Analytics).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Activity, Server, Gauge, Bell, Cpu, Brain, RefreshCw, Download } from 'lucide-react';
import { MonitoringAIAnalysis } from './AIModuleReports';
import { DataGrid, useSubscriptions } from './mgmt/MgmtWidgets';

const API = import.meta.env.VITE_API_URL || '';

async function getJSON(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path.replace('/api/monitor/', '')} → HTTP ${res.status}`);
  return res.json();
}

function downloadCSV(filename, rows) {
  if (!rows || !rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const SEV_COLOR = { Sev0: '#ef4444', Sev1: '#f97316', Sev2: '#eab308', Sev3: '#38bdf8', Sev4: 'var(--c-64748b)' };
const SEV_LABEL = { Sev0: 'Critical', Sev1: 'Error', Sev2: 'Warning', Sev3: 'Info', Sev4: 'Verbose' };
const HEALTH_COLOR = { Available: '#22c55e', Degraded: '#eab308', Unavailable: '#ef4444', Unknown: 'var(--c-64748b)' };

const card = { background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 12, padding: 16 };
const th = { textAlign: 'left', padding: '8px 10px', color: 'var(--c-64748b)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid var(--c-1e293b)', position: 'sticky', top: 0, background: 'var(--c-0b1220)' };
const td = { padding: '8px 10px', color: 'var(--c-cbd5e1)', fontSize: 12, borderBottom: '1px solid var(--c-111a2e)' };

function KPI({ label, value, sub, color = '#38bdf8', Icon }) {
  return (
    <div style={{ flex: '1 1 160px', minWidth: 160, ...card }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: 'var(--c-64748b)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
        {Icon && <Icon size={16} style={{ color }} />}
      </div>
      <div style={{ color, fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ color: 'var(--c-64748b)', fontSize: 11, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Bar({ label, value, total, color }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--c-94a3b8)', marginBottom: 3 }}>
        <span>{label}</span>
        <span style={{ color: 'var(--c-e2e8f0)' }}>{value}{total ? ` / ${total}` : ''}{total ? ` · ${pct}%` : ''}</span>
      </div>
      <div style={{ height: 8, background: 'var(--c-1e293b)', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 6 }} />
      </div>
    </div>
  );
}

function MonitoringView() {
  const [tab, setTab] = useState('dashboard');
  const [overview, setOverview] = useState(null);
  const [coverage, setCoverage] = useState([]);
  const [health, setHealth] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [perf, setPerf] = useState(null);
  const [perfLoading, setPerfLoading] = useState(false);
  const subMap = useSubscriptions();

  const loadCore = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, cov, hl, al] = await Promise.all([
        getJSON('/api/monitor/overview'),
        getJSON('/api/monitor/coverage'),
        getJSON('/api/monitor/health'),
        getJSON('/api/monitor/alerts'),
      ]);
      setOverview(ov);
      setCoverage(cov.items || []);
      setHealth(hl.items || []);
      setAlerts(al.items || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPerf = useCallback(async () => {
    setPerfLoading(true);
    try {
      const [m, la] = await Promise.all([
        getJSON('/api/monitor/metrics?limit=40'),
        getJSON('/api/monitor/laperf?hours=48'),
      ]);
      setPerf({ metrics: m.items || [], la });
    } catch (e) {
      setPerf({ metrics: [], la: { available: false, note: e.message } });
    } finally {
      setPerfLoading(false);
    }
  }, []);

  useEffect(() => { loadCore(); }, [loadCore]);
  useEffect(() => {
    if (tab === 'performance' && perf === null && !perfLoading) loadPerf();
  }, [tab, perf, perfLoading, loadPerf]);

  const tabs = [
    { key: 'dashboard', label: 'Dashboard', Icon: Activity },
    { key: 'coverage', label: 'Coverage', Icon: Server },
    { key: 'health', label: 'Health', Icon: Gauge },
    { key: 'alerts', label: 'Alerts', Icon: Bell },
    { key: 'performance', label: 'Performance', Icon: Cpu },
    { key: 'ai', label: 'AI Analysis', Icon: Brain },
  ];

  const ov = overview || {};
  const hroll = ov.health || {};
  const aroll = ov.alerts || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ color: 'var(--c-e2e8f0)', fontSize: 20, fontWeight: 700, margin: 0 }}>Monitoring</h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: '2px 0 0' }}>
            Azure Monitor · performance &amp; health for native, Arc, and on-premises resources
          </p>
        </div>
        <button onClick={loadCore} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--c-1e293b)', color: 'var(--c-cbd5e1)', border: '1px solid var(--c-334155)', borderRadius: 8, padding: '7px 12px', fontSize: 12, cursor: loading ? 'default' : 'pointer' }}>
          <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Refresh
        </button>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--c-1e293b)', flexWrap: 'wrap' }}>
        {tabs.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', fontSize: 13, fontWeight: 600,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: tab === key ? '#38bdf8' : 'var(--c-94a3b8)',
            borderBottom: tab === key ? '2px solid #38bdf8' : '2px solid transparent',
          }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ ...card, borderColor: '#dc2626', color: 'var(--c-fca5a5)', fontSize: 13 }}>
          Failed to load monitoring data: {error}
          <button onClick={loadCore} style={{ marginLeft: 12, background: '#1e40af', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {loading && !overview && (
        <div style={{ ...card, textAlign: 'center', color: 'var(--c-94a3b8)', padding: 40 }}>
          <div style={{ width: 40, height: 40, border: '3px solid var(--c-1e293b)', borderTopColor: '#38bdf8', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 14px' }} />
          Loading Azure Monitor data…
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {/* DASHBOARD */}
      {tab === 'dashboard' && overview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <KPI label="Machines" value={ov.total_machines ?? 0} sub={`${ov.azure_vms ?? 0} VM · ${ov.arc_machines ?? 0} Arc`} color="#38bdf8" Icon={Server} />
            <KPI label="Agent Coverage" value={`${ov.coverage_pct ?? 0}%`} sub={`${ov.agent_covered ?? 0} covered · ${ov.uncovered ?? 0} blind`} color={(ov.coverage_pct ?? 0) >= 80 ? '#22c55e' : (ov.coverage_pct ?? 0) >= 50 ? '#eab308' : '#ef4444'} Icon={Activity} />
            <KPI label="Unhealthy" value={ov.unhealthy ?? 0} sub={`${ov.health_tracked ?? 0} health records`} color={(ov.unhealthy ?? 0) > 0 ? '#ef4444' : '#22c55e'} Icon={Gauge} />
            <KPI label="Alerts Fired" value={ov.alerts_fired ?? 0} sub={`${ov.alerts_critical ?? 0} critical`} color={(ov.alerts_critical ?? 0) > 0 ? '#ef4444' : '#f97316'} Icon={Bell} />
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ ...card, flex: '1 1 320px' }}>
              <div style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Resource Health</div>
              {['Available', 'Degraded', 'Unavailable', 'Unknown'].map((s) => (
                <Bar key={s} label={s} value={hroll[s] || 0} total={ov.health_tracked || 0} color={HEALTH_COLOR[s]} />
              ))}
            </div>
            <div style={{ ...card, flex: '1 1 320px' }}>
              <div style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Alerts by Severity</div>
              {['Sev0', 'Sev1', 'Sev2', 'Sev3', 'Sev4'].map((s) => (
                <Bar key={s} label={`${s} · ${SEV_LABEL[s]}`} value={aroll[s] || 0} total={(ov.alerts_fired || 0) || Object.values(aroll).reduce((a, b) => a + b, 0)} color={SEV_COLOR[s]} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* COVERAGE */}
      {tab === 'coverage' && (
        <DataGrid
          title="Monitoring Agent Coverage"
          rows={coverage}
          subMap={subMap}
          subField="subscription_id"
          rgField="resource_group"
          searchFields={['machine_name', 'os_type', 'resource_group', 'agent_type', 'power_state']}
          csvName="monitoring-coverage.csv"
          maxHeight="62vh"
          facets={[
            { field: 'machine_type', label: 'Type' },
            { field: 'os_type', label: 'OS', normalize: (v) => (v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : '') },
            { field: 'power_state', label: 'Power state' },
            { field: 'location', label: 'Location' },
            { field: 'agent_installed', label: 'Agent', normalize: (v) => (v ? 'Has agent' : 'No agent') },
          ]}
          columns={[
            { key: 'machine_name', label: 'Machine' },
            { key: 'machine_type', label: 'Type' },
            { key: 'os_type', label: 'OS', render: (v) => v || '—' },
            { key: 'power_state', label: 'Power', render: (v) => v || '—' },
            { key: 'location', label: 'Location', render: (v) => v || '—' },
            { key: 'resource_group', label: 'Resource Group' },
            { key: 'subscription_id', label: 'Subscription' },
            { key: 'agent_installed', label: 'Agent', render: (v, row) => (v ? `✓ ${row.agent_type}` : '✗ No agent'), tdStyle: (v) => ({ color: v ? '#22c55e' : '#ef4444', fontWeight: 600 }) },
          ]}
        />
      )}

      {/* HEALTH */}
      {tab === 'health' && (
        <DataGrid
          title="Resource Health"
          rows={health}
          subMap={subMap}
          subField="subscription_id"
          rgField="resource_group"
          searchFields={['resource_name', 'resource_type', 'availability_state', 'summary', 'resource_group']}
          csvName="resource-health.csv"
          maxHeight="62vh"
          facets={[
            { field: 'resource_type', label: 'Type', normalize: (v) => ((v || '').split('/').pop() || '') },
            { field: 'availability_state', label: 'State' },
          ]}
          columns={[
            { key: 'resource_name', label: 'Resource' },
            { key: 'resource_type', label: 'Type', render: (v) => (v || '').split('/').pop() || '—' },
            { key: 'availability_state', label: 'State', tdStyle: (v) => ({ color: HEALTH_COLOR[v] || 'var(--c-94a3b8)', fontWeight: 600 }) },
            { key: 'resource_group', label: 'Resource Group' },
            { key: 'subscription_id', label: 'Subscription' },
            { key: 'summary', label: 'Summary', render: (v) => v || '—' },
          ]}
        />
      )}

      {/* ALERTS */}
      {tab === 'alerts' && (
        <DataGrid
          title="Azure Monitor Alerts"
          rows={alerts}
          subMap={subMap}
          subField="subscription_id"
          searchFields={['name', 'target_resource_name', 'severity', 'severity_label', 'state', 'signal_type']}
          csvName="monitor-alerts.csv"
          filters={['sub', 'search']}
          maxHeight="62vh"
          facets={[
            { field: 'severity_label', label: 'Severity' },
            { field: 'state', label: 'State', normalize: (v) => (v || '') },
            { field: 'signal_type', label: 'Signal' },
          ]}
          columns={[
            { key: 'severity', label: 'Severity', csv: (v, row) => `${v} ${row.severity_label}`, render: (v, row) => (<span><span style={{ color: SEV_COLOR[v] || 'var(--c-94a3b8)', fontWeight: 700 }}>{v}</span> <span style={{ color: 'var(--c-64748b)' }}>{row.severity_label}</span></span>) },
            { key: 'name', label: 'Alert' },
            { key: 'target_resource_name', label: 'Target', render: (v) => v || '—' },
            { key: 'state', label: 'State', render: (v, row) => v || row.monitor_condition || '—' },
            { key: 'signal_type', label: 'Signal', render: (v) => v || '—' },
            { key: 'fired_time', label: 'Fired', render: (v) => (v || '').replace('T', ' ').slice(0, 16) || '—' },
            { key: 'subscription_id', label: 'Subscription' },
          ]}
        />
      )}

      {/* PERFORMANCE (lazy) */}
      {tab === 'performance' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {perfLoading && (
            <div style={{ ...card, textAlign: 'center', color: 'var(--c-94a3b8)', padding: 30 }}>
              <div style={{ width: 36, height: 36, border: '3px solid var(--c-1e293b)', borderTopColor: '#38bdf8', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
              Pulling Azure Monitor metrics + Log Analytics performance… (this can take up to a minute)
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          )}
          {perf && (
            <>
              <DataGrid
                title="Platform Metrics (Azure Monitor · 30-day avg)"
                rows={perf.metrics}
                subMap={subMap}
                subField="subscription_id"
                rgField="resource_group"
                searchFields={['resource_name', 'resource_type', 'resource_group', 'power_state', 'location']}
                csvName="platform-metrics.csv"
                maxHeight="40vh"
                facets={[
                  { field: 'resource_type', label: 'Type', normalize: (v) => ((v || '').split('/').pop() || '') },
                  { field: 'power_state', label: 'State' },
                ]}
                columns={[
                  { key: 'resource_name', label: 'Resource' },
                  { key: 'resource_type', label: 'Type', render: (v) => (v || '').split('/').pop() },
                  { key: 'power_state', label: 'State', render: (v) => v || '—' },
                  { key: 'cpu', label: 'CPU %', render: (v) => (v ?? '—') },
                  { key: 'memory', label: 'Mem %', render: (v) => (v ?? '—') },
                  { key: 'disk', label: 'Disk', render: (v) => (v ?? '—') },
                  { key: 'network', label: 'Network', render: (v) => (v ?? '—') },
                  { key: 'primary_utilization', label: 'Primary', render: (v, row) => (v != null ? `${v} (${row.primary_label})` : '—') },
                  { key: 'peak_utilization', label: 'Peak %', render: (v) => (v ?? '—') },
                  { key: 'subscription_id', label: 'Subscription' },
                ]}
              />
              <div style={{ ...card, padding: 0 }}>
                <div style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 600, padding: 12 }}>
                  Log Analytics — Arc / On-Prem agents {perf.la?.available ? `(${perf.la.workspaces} workspace${perf.la.workspaces === 1 ? '' : 's'}, ${perf.la.heartbeats?.length || 0} machines reporting)` : ''}
                </div>
                {!perf.la?.available && <div style={{ color: 'var(--c-94a3b8)', fontSize: 12, padding: '0 12px 12px' }}>{perf.la?.note || 'No Log Analytics performance data available.'}</div>}
                {perf.la?.available && (
                  <div style={{ overflow: 'auto', maxHeight: '34vh' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr><th style={th}>Computer</th><th style={th}>OS</th><th style={th}>Last Seen</th><th style={th}>Workspace</th></tr></thead>
                      <tbody>
                        {(perf.la.heartbeats || []).map((h, i) => (
                          <tr key={i}>
                            <td style={td}>{h.computer}</td>
                            <td style={td}>{h.os_type || '—'}</td>
                            <td style={td}>{h.last_seen}</td>
                            <td style={td}>{h.workspace}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* AI ANALYSIS */}
      {tab === 'ai' && <MonitoringAIAnalysis />}
    </div>
  );
}

export default MonitoringView;
