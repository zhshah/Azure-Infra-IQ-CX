/**
 * IdentityView — Identity & Access (Microsoft Entra ID + Azure RBAC).
 * Tabs: Overview, Role Assignments (IAM), App Registrations, Users & Guests, AI Analysis.
 * Every data section has filtering + CSV export. AI = /api/ai/entra.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, KeyRound, Users, AppWindow, Brain, ListChecks, AlertTriangle } from 'lucide-react';
import { getJSON, card, KPI, TabBar, Spinner, ErrorBox, ViewHeader, DataGrid, useSubscriptions } from './mgmt/MgmtWidgets';
import { GenericAIAnalysis } from './AIModuleReports';
import { asText } from '../utils/safeText';

const SEV = { high: '#ef4444', medium: '#f59e0b', low: '#eab308', info: '#38bdf8' };
const CRED_COLOR = { expired: '#ef4444', 'expiring-30': '#f97316', 'expiring-90': '#eab308', valid: '#22c55e', none: '#64748b', unknown: '#64748b' };
const CRED_LABEL = { expired: 'Expired', 'expiring-30': 'Expiring ≤30d', 'expiring-90': 'Expiring ≤90d', valid: 'Valid', none: 'No credentials', unknown: 'Unknown' };

function Finding({ f }) {
  const c = SEV[f.severity] || '#64748b';
  return (
    <div style={{ background: '#0f172a', border: `1px solid ${c}44`, borderLeft: `3px solid ${c}`, borderRadius: 8, padding: '10px 14px', marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
        <span style={{ background: c + '22', color: c, borderRadius: 4, padding: '1px 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>{f.severity}</span>
        <span style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600 }}>{f.title}</span>
      </div>
      {f.detail && <p style={{ color: '#94a3b8', fontSize: 12, margin: '2px 0' }}>{asText(f.detail)}</p>}
      {f.recommendation && <p style={{ color: '#22c55e', fontSize: 12, margin: '2px 0' }}>✅ {asText(f.recommendation)}</p>}
    </div>
  );
}

function BarList({ title, data, color = '#38bdf8' }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return (
    <div style={{ ...card, flex: '1 1 280px' }}>
      <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{title}</div>
      {entries.map(([k, v]) => (
        <div key={k} style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>
            <span>{k}</span><span style={{ color: '#e2e8f0' }}>{v}</span>
          </div>
          <div style={{ height: 7, background: '#1e293b', borderRadius: 5, overflow: 'hidden' }}>
            <div style={{ width: `${Math.round((v / max) * 100)}%`, height: '100%', background: color }} />
          </div>
        </div>
      ))}
      {entries.length === 0 && <div style={{ color: '#64748b', fontSize: 12 }}>No data.</div>}
    </div>
  );
}

function GraphGate({ note }) {
  return (
    <div style={{ ...card, textAlign: 'center', padding: 28 }}>
      <KeyRound size={28} style={{ color: '#475569', marginBottom: 8 }} />
      <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>Microsoft Graph access required</div>
      <p style={{ color: '#94a3b8', fontSize: 12, maxWidth: 560, margin: '8px auto 0', lineHeight: 1.5 }}>
        {note || 'This section reads the Entra ID directory via Microsoft Graph.'} Grant the application / service
        principal these Microsoft Graph <b>application</b> permissions (with admin consent), then Refresh:
      </p>
      <div style={{ display: 'inline-flex', gap: 8, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        {['Directory.Read.All', 'Application.Read.All', 'User.Read.All'].map((p) => (
          <span key={p} style={{ background: '#0b1220', border: '1px solid #1e293b', borderRadius: 6, padding: '4px 10px', color: '#93c5fd', fontSize: 12, fontFamily: 'monospace' }}>{p}</span>
        ))}
      </div>
    </div>
  );
}

function IdentityView() {
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [guests, setGuests] = useState(null);
  const subMap = useSubscriptions();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await getJSON('/api/identity/posture')); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (tab === 'users' && guests === null) {
      getJSON('/api/identity/guests').then(setGuests).catch(() => setGuests({ available: false, items: [] }));
    }
  }, [tab, guests]);

  const d = data || {};
  const sm = d.summary || {};
  const apps = d.app_registrations || {};
  const graphOk = d.graph_available;
  const scoreColor = (s) => (s >= 80 ? '#22c55e' : s >= 60 ? '#eab308' : '#ef4444');

  const tabs = [
    { key: 'overview', label: 'Overview', Icon: ShieldCheck },
    { key: 'iam', label: 'Role Assignments (IAM)', Icon: ListChecks },
    { key: 'apps', label: 'App Registrations', Icon: AppWindow },
    { key: 'users', label: 'Users & Guests', Icon: Users },
    { key: 'ai', label: 'AI Analysis', Icon: Brain },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ViewHeader title="Identity & Access" subtitle="Microsoft Entra ID + Azure RBAC — over-permissioning, privileged & Owner sprawl, app-registration credential expiry, guests, and least-privilege best practices" onRefresh={load} loading={loading} />
      <TabBar tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'ai' && <GenericAIAnalysis endpoint="/api/ai/entra" title="Identity & Access AI Assessment" />}
      {tab !== 'ai' && error && <ErrorBox error={error} onRetry={load} />}
      {tab !== 'ai' && loading && !data && <Spinner label="Analyzing identity & access posture…" />}

      {/* OVERVIEW */}
      {tab === 'overview' && data && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <KPI label="Posture Score" value={`${d.score ?? 0}`} sub="100 = least-privilege" color={scoreColor(d.score ?? 0)} Icon={ShieldCheck} />
            <KPI label="Role Assignments" value={sm.total_assignments ?? 0} sub={`${sm.privileged_assignments ?? 0} privileged`} color="#38bdf8" />
            <KPI label="Owner Grants" value={sm.owner_assignments ?? 0} sub="standing access" color={(sm.owner_assignments ?? 0) > 5 ? '#f59e0b' : '#22c55e'} />
            <KPI label="Privileged SPs" value={sm.sp_privileged ?? 0} sub="app identities" color={(sm.sp_privileged ?? 0) > 0 ? '#ef4444' : '#22c55e'} />
            <KPI label="App Registrations" value={graphOk ? (sm.app_registrations ?? 0) : '—'} sub={graphOk ? `${sm.apps_expired ?? 0} expired` : 'Graph access needed'} color={(sm.apps_expired ?? 0) > 0 ? '#ef4444' : '#a78bfa'} Icon={AppWindow} />
            <KPI label="Guest Accounts" value={graphOk ? (sm.guest_users ?? 0) : '—'} sub={graphOk ? 'external' : 'Graph access needed'} color="#a78bfa" Icon={Users} />
          </div>

          <div style={{ ...card }}>
            <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={15} style={{ color: '#f59e0b' }} /> Best-practice findings ({(d.findings || []).length})
            </div>
            {(d.findings || []).length === 0 && <div style={{ color: '#22c55e', fontSize: 13 }}>No issues detected.</div>}
            {(d.findings || []).map((f, i) => <Finding key={i} f={f} />)}
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <BarList title="Assignments by principal type" data={d.by_principal_type} color="#38bdf8" />
            <BarList title="Assignments by scope level" data={d.by_scope_level} color="#a78bfa" />
            <BarList title="Top roles" data={d.by_role} color="#22c55e" />
          </div>
        </>
      )}

      {/* IAM */}
      {tab === 'iam' && data && (
        <DataGrid
          title="Role Assignments"
          rows={d.role_assignments || []}
          subMap={subMap}
          subField="subscription_id"
          searchFields={['role_name', 'principal_type', 'scope_level', 'principal_id', 'scope']}
          csvName="role-assignments.csv"
          maxHeight="64vh"
          facets={[
            { field: 'role_name', label: 'Role' },
            { field: 'principal_type', label: 'Principal' },
            { field: 'scope_level', label: 'Scope' },
            { field: 'is_privileged', label: 'Privilege', normalize: (v) => (v ? 'Privileged' : 'Standard') },
          ]}
          columns={[
            { key: 'role_name', label: 'Role', render: (v, row) => <span style={{ color: row.is_privileged ? '#f87171' : '#cbd5e1', fontWeight: row.is_privileged ? 700 : 400 }}>{v}</span> },
            { key: 'principal_type', label: 'Principal Type' },
            { key: 'principal_id', label: 'Principal', render: (v) => (v ? v.slice(0, 8) + '…' : '—') },
            { key: 'scope_level', label: 'Scope' },
            { key: 'is_privileged', label: 'Privileged', csv: (v) => (v ? 'Yes' : 'No'), render: (v) => (v ? <span style={{ color: '#ef4444', fontWeight: 700 }}>● privileged</span> : <span style={{ color: '#475569' }}>—</span>) },
            { key: 'subscription_id', label: 'Subscription' },
          ]}
        />
      )}

      {/* APP REGISTRATIONS */}
      {tab === 'apps' && data && (
        graphOk && apps.available ? (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <KPI label="App Registrations" value={apps.total ?? 0} color="#a78bfa" Icon={AppWindow} />
              <KPI label="Expired" value={apps.expired ?? 0} sub="broken auth" color={(apps.expired ?? 0) > 0 ? '#ef4444' : '#22c55e'} />
              <KPI label="Expiring ≤30d" value={apps.expiring_30 ?? 0} color={(apps.expiring_30 ?? 0) > 0 ? '#f97316' : '#22c55e'} />
              <KPI label="No Credentials" value={apps.no_credentials ?? 0} color="#64748b" />
            </div>
            <DataGrid
              title="App Registrations"
              rows={apps.items || []}
              searchFields={['display_name', 'app_id', 'sign_in_audience', 'credential_status']}
              csvName="app-registrations.csv"
              filters={['search']}
              maxHeight="58vh"
              facets={[{ field: 'credential_status', label: 'Status', normalize: (v) => CRED_LABEL[v] || v }]}
              columns={[
                { key: 'display_name', label: 'Application' },
                { key: 'secret_count', label: 'Secrets' },
                { key: 'cert_count', label: 'Certs' },
                { key: 'credential_status', label: 'Status', csv: (v) => CRED_LABEL[v] || v, render: (v) => <span style={{ color: CRED_COLOR[v] || '#64748b', fontWeight: 700 }}>{CRED_LABEL[v] || v}</span> },
                { key: 'soonest_expiry_days', label: 'Soonest expiry', render: (v) => (v == null ? '—' : v < 0 ? <span style={{ color: '#ef4444', fontWeight: 700 }}>{Math.abs(v)}d ago</span> : <span style={{ color: v <= 30 ? '#f97316' : '#cbd5e1' }}>in {v}d</span>) },
                { key: 'sign_in_audience', label: 'Audience' },
              ]}
            />
          </>
        ) : <GraphGate note={apps.note} />
      )}

      {/* USERS & GUESTS */}
      {tab === 'users' && (
        guests === null ? <Spinner label="Loading guest accounts…" /> : (
          guests.available ? (
            <DataGrid
              title="Guest (external) accounts"
              rows={guests.items || []}
              searchFields={['display_name', 'upn', 'state']}
              csvName="guest-users.csv"
              filters={['search']}
              maxHeight="64vh"
              facets={[
                { field: 'enabled', label: 'State', normalize: (v) => (v ? 'Enabled' : 'Disabled') },
                { field: 'state', label: 'Invite' },
              ]}
              columns={[
                { key: 'display_name', label: 'Display Name' },
                { key: 'upn', label: 'User / Email' },
                { key: 'enabled', label: 'Enabled', csv: (v) => (v ? 'Yes' : 'No'), render: (v) => (v ? <span style={{ color: '#22c55e' }}>✓</span> : <span style={{ color: '#ef4444' }}>✗</span>) },
                { key: 'state', label: 'Invite State', render: (v) => v || '—' },
                { key: 'created_on', label: 'Created', render: (v) => (v || '').slice(0, 10) || '—' },
              ]}
            />
          ) : <GraphGate note={guests.note} />
        )
      )}
    </div>
  );
}

export default IdentityView;
