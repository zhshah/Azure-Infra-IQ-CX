/** GovernanceView — Azure Policy compliance + Identity/RBAC posture + AI. */
import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, KeyRound, Brain, Download } from 'lucide-react';
import { getJSON, downloadCSV, card, th, td, KPI, Bar, TabBar, Spinner, ErrorBox, ViewHeader, DataGrid, useSubscriptions } from './mgmt/MgmtWidgets';
import { GovernanceAIAnalysis } from './AIModuleReports';

function GovernanceView() {
  const [tab, setTab] = useState('policy');
  const [policy, setPolicy] = useState(null);
  const [identity, setIdentity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const subMap = useSubscriptions();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, i] = await Promise.all([getJSON('/api/governance/policy'), getJSON('/api/identity/access')]);
      setPolicy(p);
      setIdentity(i);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const tabs = [
    { key: 'policy', label: 'Policy Compliance', Icon: ShieldCheck },
    { key: 'identity', label: 'Identity & Access', Icon: KeyRound },
    { key: 'ai', label: 'AI Analysis', Icon: Brain },
  ];
  const p = policy || {};
  const ide = identity || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ViewHeader title="Governance" subtitle="Azure Policy compliance & identity (RBAC) posture across the estate" onRefresh={load} loading={loading} />
      <TabBar tabs={tabs} active={tab} onChange={setTab} />
      {error && <ErrorBox error={error} onRetry={load} />}
      {loading && !policy && <Spinner label="Loading governance data…" />}

      {tab === 'policy' && policy && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <KPI label="Compliance" value={`${p.compliance_pct ?? 0}%`} sub={`${p.compliant ?? 0} compliant`} color={(p.compliance_pct ?? 0) >= 80 ? '#22c55e' : (p.compliance_pct ?? 0) >= 50 ? '#eab308' : '#ef4444'} Icon={ShieldCheck} />
            <KPI label="Non-Compliant Resources" value={p.non_compliant_resources ?? 0} sub={`${p.non_compliant ?? 0} evaluations`} color="#ef4444" />
            <KPI label="Policy Assignments" value={p.policy_assignments ?? 0} color="#38bdf8" />
            <KPI label="Exemptions" value={p.policy_exemptions ?? 0} color="#f97316" />
          </div>
          <DataGrid
            title="Top Non-Compliant Policies"
            rows={p.top_non_compliant_policies || []}
            searchFields={['policy', 'category', 'effect', 'scope', 'scope_level']}
            csvName="policy-top-noncompliant.csv"
            filters={['search']}
            maxHeight="32vh"
            columns={[
              { key: 'policy', label: 'Policy', tdStyle: () => ({ color: 'var(--c-e2e8f0)', fontWeight: 600 }) },
              { key: 'category', label: 'Category', render: (v) => v || '—' },
              { key: 'effect', label: 'Effect', render: (v) => v || '—' },
              { key: 'scope_level', label: 'Assigned At', render: (v) => v || '—' },
              { key: 'scope', label: 'Scope', render: (v) => subMap[(v || '').toLowerCase()] || v || '—' },
              { key: 'non_compliant', label: 'Non-Compliant', tdStyle: () => ({ color: '#ef4444', fontWeight: 600 }) },
            ]}
          />
          <DataGrid
            title="Non-Compliant Resources"
            rows={p.non_compliant_items || []}
            subMap={subMap}
            subField="subscription_id"
            rgField="resource_group"
            searchFields={['resource_name', 'resource_type', 'policy', 'category', 'effect']}
            csvName="policy-noncompliant.csv"
            filters={['sub', 'rg', 'search']}
            maxHeight="40vh"
            columns={[
              { key: 'resource_name', label: 'Resource' },
              { key: 'resource_type', label: 'Type', render: (v) => (v || '').split('/').pop() || '—' },
              { key: 'policy', label: 'Policy' },
              { key: 'category', label: 'Category', render: (v) => v || '—' },
              { key: 'effect', label: 'Effect', render: (v) => v || '—' },
              { key: 'scope_level', label: 'Assigned At', render: (v) => v || '—' },
              { key: 'resource_group', label: 'Resource Group', render: (v) => v || '—' },
              { key: 'subscription_id', label: 'Subscription' },
            ]}
          />
        </div>
      )}

      {tab === 'identity' && identity && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderColor: 'var(--c-1e3a5f)' }}>
            <span style={{ color: 'var(--c-94a3b8)', fontSize: 12 }}>
              This is a summary. Open the full <b style={{ color: 'var(--c-e2e8f0)' }}>Identity &amp; Access</b> workspace for app-registration expiry, over-permissioning findings, guests and AI analysis.
            </span>
            <button onClick={() => window.dispatchEvent(new CustomEvent('navigate', { detail: 'entra' }))}
              style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Open Identity &amp; Access →
            </button>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <KPI label="Role Assignments" value={ide.total_assignments ?? 0} color="#38bdf8" Icon={KeyRound} />
            <KPI label="Privileged" value={ide.privileged_assignments ?? 0} sub={`${ide.owner_assignments ?? 0} Owners`} color="#ef4444" />
            <KPI label="Service Principals" value={ide.service_principals ?? 0} color="#a78bfa" />
            <KPI label="Users" value={ide.guest_or_external ?? 0} color="#22c55e" />
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ ...card, flex: '1 1 320px' }}>
              <div style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>By Principal Type</div>
              {Object.entries(ide.by_principal_type || {}).map(([k, v]) => (
                <Bar key={k} label={k} value={v} total={ide.total_assignments || 0} color="#38bdf8" />
              ))}
            </div>
            <div style={{ ...card, flex: '1 1 320px' }}>
              <div style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Top Roles</div>
              {Object.entries(ide.by_role || {}).slice(0, 8).map(([k, v]) => (
                <Bar key={k} label={k} value={v} total={ide.total_assignments || 0} color={['Owner', 'User Access Administrator', 'Role Based Access Control Administrator', 'Contributor'].includes(k) ? '#ef4444' : 'var(--c-64748b)'} />
              ))}
            </div>
          </div>
          <DataGrid
            title="Role Assignments"
            rows={ide.items || []}
            subMap={subMap}
            subField="subscription_id"
            searchFields={['role_name', 'principal_type', 'scope_level', 'principal_id']}
            csvName="rbac-assignments.csv"
            filters={['sub', 'search']}
            maxHeight="40vh"
            columns={[
              { key: 'role_name', label: 'Role', tdStyle: (v, row) => ({ color: row.is_privileged ? '#ef4444' : 'var(--c-cbd5e1)', fontWeight: row.is_privileged ? 600 : 400 }) },
              { key: 'principal_type', label: 'Principal Type' },
              { key: 'scope_level', label: 'Scope Level' },
              { key: 'is_privileged', label: 'Privileged', render: (v) => (v ? 'Yes' : '—'), tdStyle: (v) => ({ color: v ? '#ef4444' : 'var(--c-64748b)' }) },
              { key: 'subscription_id', label: 'Subscription' },
            ]}
          />
        </div>
      )}

      {tab === 'ai' && <GovernanceAIAnalysis />}
    </div>
  );
}

export default GovernanceView;
