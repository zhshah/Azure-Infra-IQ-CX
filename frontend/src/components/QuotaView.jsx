/** QuotaView — Azure compute quota usage vs limits per region + capacity radar + AI. */
import React, { useState, useEffect, useCallback } from 'react';
import { Gauge, Brain, Ban, AlertTriangle, MapPin, TicketCheck } from 'lucide-react';
import { getJSON, card, KPI, TabBar, Spinner, ErrorBox, ViewHeader, DataGrid, useSubscriptions } from './mgmt/MgmtWidgets';
import { QuotaAIAnalysis } from './AIModuleReports';

const barColor = (pct) => (pct >= 90 ? '#ef4444' : pct >= 75 ? '#eab308' : '#22c55e');
const CAT_LABEL = { regional_vcpu: 'Regional vCPU total', vm_family: 'VM family', instances: 'Instances', vcpu_other: 'vCPU' };

function RegionBar({ r, subName }) {
  const pct = r.vcpu_pct || 0;
  return (
    <div style={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
          <MapPin size={13} style={{ color: 'var(--c-38bdf8)' }} /> {r.region}
          {r.is_strategic && <span style={{ background: 'var(--c-3730a3)', color: 'var(--c-c7d2fe)', borderRadius: 5, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>capacity-restricted</span>}
        </span>
        <span style={{ color: 'var(--c-64748b)', fontSize: 11 }}>{subName}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 8, background: 'var(--c-1e293b)', borderRadius: 5, overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: barColor(pct) }} />
        </div>
        <span style={{ color: barColor(pct), fontSize: 12, fontWeight: 700, minWidth: 96, textAlign: 'right' }}>
          {r.vcpu_used} / {r.vcpu_limit || '—'} vCPU
        </span>
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 11, flexWrap: 'wrap' }}>
        {r.blocked_families > 0 && <span style={{ color: '#ef4444' }}>⛔ {r.blocked_families} blocked famil{r.blocked_families === 1 ? 'y' : 'ies'}</span>}
        {r.near_limit > 0 && <span style={{ color: '#eab308' }}>⚠ {r.near_limit} near limit</span>}
        {r.blocked_families === 0 && r.near_limit === 0 && <span style={{ color: '#22c55e' }}>✓ healthy headroom</span>}
      </div>
    </div>
  );
}

function QuotaView() {
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const subMap = useSubscriptions();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getJSON('/api/operations/quota'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const d = data || {};
  const subName = (v) => (v ? (subMap[v.toLowerCase()] || v.slice(0, 8)) : '—');
  const regions = d.regions_summary || [];
  const blocked = d.blocked || [];
  // group blocked families by region for the action callout
  const blockedByRegion = {};
  blocked.forEach((b) => { (blockedByRegion[b.region] ||= []).push(b); });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ViewHeader title="Quota & Capacity" subtitle="Compute vCPU / VM-family quota vs limits per region — including capacity-restricted regions (e.g. Qatar Central) where families must be quota-whitelisted before you can deploy" onRefresh={load} loading={loading} />
      <TabBar tabs={[{ key: 'overview', label: 'Overview', Icon: Gauge }, { key: 'ai', label: 'AI Analysis', Icon: Brain }]} active={tab} onChange={setTab} />
      {tab === 'ai' && <QuotaAIAnalysis />}
      {tab === 'overview' && error && <ErrorBox error={error} onRetry={load} />}
      {tab === 'overview' && loading && !data && <Spinner label="Querying compute quota across regions…" />}
      {tab === 'overview' && data && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <KPI label="Regions Tracked" value={d.regions ?? 0} sub={`${d.subscriptions ?? 0} subscription(s)`} color="#38bdf8" Icon={Gauge} />
            <KPI label="Blocked Families" value={d.blocked_count ?? 0} sub="0 quota — request needed" color={(d.blocked_count ?? 0) > 0 ? '#ef4444' : '#22c55e'} Icon={Ban} />
            <KPI label="Near Limit (≥80%)" value={d.near_limit_count ?? 0} sub="will throttle scaling" color={(d.near_limit_count ?? 0) > 0 ? '#eab308' : '#22c55e'} Icon={AlertTriangle} />
            <KPI label="vCPU Headroom" value={d.vcpu_headroom ?? 0} sub={`${d.total_vcpu_used ?? 0} used / ${d.total_vcpu_limit ?? 0} limit`} color="#a78bfa" />
          </div>

          {d.note && (d.items || []).length === 0 && (
            <div style={{ ...card, color: 'var(--c-94a3b8)', fontSize: 13 }}>{d.note}</div>
          )}

          {/* Action required — blocked families that need a quota request (Qatar workflow) */}
          {blocked.length > 0 && (
            <div style={{ ...card, border: '1px solid var(--c-7f1d1d)', background: 'linear-gradient(180deg,#1a0e0e,var(--c-0f172a))' }}>
              <div style={{ color: 'var(--c-fca5a5)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <TicketCheck size={16} /> Quota request needed — {blocked.length} blocked famil{blocked.length === 1 ? 'y' : 'ies'}
              </div>
              <p style={{ color: 'var(--c-94a3b8)', fontSize: 12, margin: '0 0 12px' }}>
                These VM families have a limit of <b>0</b> in capacity-restricted regions — you must raise an Azure support ticket to whitelist quota before any resource can be created here.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 10 }}>
                {Object.entries(blockedByRegion).slice(0, 8).map(([region, fams]) => (
                  <div key={region} style={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 8, padding: 10 }}>
                    <div style={{ color: 'var(--c-e2e8f0)', fontSize: 12, fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <MapPin size={12} style={{ color: 'var(--c-f87171)' }} /> {region} <span style={{ color: 'var(--c-64748b)', fontWeight: 400 }}>· {fams.length}</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {fams.slice(0, 12).map((f, i) => (
                        <span key={i} title={f.quota} style={{ background: '#7f1d1d33', color: 'var(--c-fca5a5)', border: '1px solid var(--c-7f1d1d)', borderRadius: 5, padding: '2px 7px', fontSize: 10, fontWeight: 600 }}>{f.family || f.quota}</span>
                      ))}
                      {fams.length > 12 && <span style={{ color: 'var(--c-64748b)', fontSize: 10 }}>+{fams.length - 12} more</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-region vCPU capacity */}
          {regions.length > 0 && (
            <div style={{ ...card }}>
              <div style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Per-region vCPU capacity</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 10 }}>
                {regions.slice(0, 12).map((r, i) => <RegionBar key={i} r={r} subName={subName(r.subscription_id)} />)}
              </div>
            </div>
          )}

          {/* Full quota table */}
          {(d.items || []).length > 0 && (
            <DataGrid
              title="Quota Usage"
              rows={d.items || []}
              subMap={subMap}
              subField="subscription_id"
              searchFields={['region', 'quota', 'family']}
              csvName="quota-usage.csv"
              filters={['sub', 'search']}
              maxHeight="56vh"
              facets={[
                { field: 'region', label: 'Region' },
                { field: 'category', label: 'Type', normalize: (v) => CAT_LABEL[v] || v },
                { field: 'blocked', label: 'Status', normalize: (v) => (v ? 'Blocked (request needed)' : 'Available') },
              ]}
              columns={[
                { key: 'region', label: 'Region' },
                { key: 'quota', label: 'Quota' },
                { key: 'current', label: 'Used / Limit', render: (v, row) => `${v} / ${row.limit}` },
                { key: 'usage_pct', label: 'Usage %', render: (v, row) => (
                  row.blocked
                    ? <span style={{ color: '#ef4444', fontWeight: 700 }}>BLOCKED · request quota</span>
                    : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 80, height: 7, background: 'var(--c-1e293b)', borderRadius: 5, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(100, v)}%`, height: '100%', background: barColor(v) }} />
                        </div>
                        <span style={{ color: barColor(v), fontWeight: 600 }}>{v}%</span>
                      </div>
                    )
                ) },
                { key: 'headroom', label: 'Headroom', render: (v, row) => (row.blocked ? '0' : v) },
                { key: 'subscription_id', label: 'Subscription' },
              ]}
            />
          )}
        </>
      )}
    </div>
  );
}

export default QuotaView;
