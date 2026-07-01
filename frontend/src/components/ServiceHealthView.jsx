/** ServiceHealthView — Azure Service Health events, lifecycle radar + AI analysis. */
import React, { useState, useEffect, useCallback } from 'react';
import { Activity, Brain, CalendarClock, AlertOctagon, ShieldAlert, Sparkles, Clock } from 'lucide-react';
import { getJSON, card, KPI, TabBar, Spinner, ErrorBox, ViewHeader, DataGrid, useSubscriptions } from './mgmt/MgmtWidgets';
import { ServiceHealthAIAnalysis, LifecycleAIAnalysis } from './AIModuleReports';

const STATUS_COLOR = { active: '#ef4444', resolved: '#22c55e' };
const CAT_COLOR = { retirement: '#ef4444', deprecation: '#f97316', upgrade: '#38bdf8', maintenance: '#eab308', security: '#a855f7', certificate: '#a855f7' };
const CAT_LABEL = { retirement: 'Retirement', deprecation: 'Deprecation', upgrade: 'Forced upgrade', maintenance: 'Planned maintenance', security: 'Security', certificate: 'Certificate / TLS' };
const PRIO_COLOR = { high: '#ef4444', medium: '#f59e0b', low: 'var(--c-64748b)' };

function Pill({ text, color }) {
  if (!text) return <span>—</span>;
  return <span style={{ color, background: (color || 'var(--c-64748b)') + '22', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{text}</span>;
}

function deadlineText(row) {
  const d = row.days_until;
  const date = row.deadline ? row.deadline : '';
  if (d == null) return date ? date : 'No date';
  if (d < 0) return `OVERDUE · ${date}`;
  if (d === 0) return `Today · ${date}`;
  return `in ${d}d · ${date}`;
}

function TimelineChart({ timeline = [], overdue = 0, noDate = 0 }) {
  const bars = [];
  if (overdue) bars.push({ label: 'Overdue', count: overdue, color: '#ef4444' });
  timeline.forEach((t) => bars.push({ label: t.label, count: t.count, color: '#38bdf8' }));
  if (noDate) bars.push({ label: 'No date', count: noDate, color: 'var(--c-64748b)' });
  if (!bars.length) return <div style={{ color: 'var(--c-64748b)', fontSize: 12 }}>No dated items to plot.</div>;
  const max = Math.max(1, ...bars.map((b) => b.count));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 170, paddingTop: 6, overflowX: 'auto' }}>
      {bars.map((b, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', flex: '1 1 0', minWidth: 46 }}>
          <div style={{ color: 'var(--c-e2e8f0)', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>{b.count}</div>
          <div title={`${b.label}: ${b.count}`} style={{ width: '100%', maxWidth: 46, height: `${Math.round((b.count / max) * 120) + 6}px`, background: b.color, borderRadius: '5px 5px 0 0' }} />
          <div style={{ color: 'var(--c-94a3b8)', fontSize: 10, marginTop: 6, textAlign: 'center', lineHeight: 1.2 }}>{b.label}</div>
        </div>
      ))}
    </div>
  );
}

function LifecycleRadar() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAI, setShowAI] = useState(false);
  const subMap = useSubscriptions();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await getJSON('/api/operations/lifecycle-radar')); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <Spinner label="Scanning Service Health advisories + Advisor for retirements…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;
  const d = data || {};
  const s = d.summary || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* What this is */}
      <div style={{ ...card, borderColor: 'var(--c-1e3a5f)' }}>
        <div style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <CalendarClock size={16} style={{ color: 'var(--c-38bdf8)' }} /> Retirements &amp; Deprecations radar
        </div>
        <p style={{ color: 'var(--c-94a3b8)', fontSize: 12, margin: 0, lineHeight: 1.55 }}>
          Forward-looking view of what Azure is retiring, deprecating or force-upgrading — fused from <b>Service Health</b> advisories,
          <b> planned maintenance</b> and <b>Advisor</b> recommendations, then correlated to <b>your own inventory</b> so you see exactly
          how many resources are exposed and by when. Act before a SKU/size/service is pulled out from under a workload.
        </p>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KPI label="Retirements" value={s.retirements ?? 0} sub="services / SKUs ending" color={(s.retirements ?? 0) > 0 ? '#ef4444' : '#22c55e'} Icon={AlertOctagon} />
        <KPI label="Deprecations" value={s.deprecations ?? 0} sub="losing support" color={(s.deprecations ?? 0) > 0 ? '#f97316' : '#22c55e'} />
        <KPI label="Due ≤ 90 days" value={s.due_90 ?? 0} sub={`${s.due_30 ?? 0} within 30d`} color={(s.due_90 ?? 0) > 0 ? '#eab308' : '#22c55e'} Icon={Clock} />
        <KPI label="Overdue" value={s.overdue ?? 0} sub="deadline passed" color={(s.overdue ?? 0) > 0 ? '#ef4444' : '#22c55e'} />
        <KPI label="Your resources exposed" value={s.exposed_resources ?? 0} sub="across all items" color="#38bdf8" Icon={ShieldAlert} />
        <KPI label="High priority" value={s.high_priority ?? 0} sub="act first" color={(s.high_priority ?? 0) > 0 ? '#ef4444' : '#22c55e'} />
      </div>

      {/* Timeline + categories */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ ...card, flex: '2 1 420px' }}>
          <div style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Upcoming timeline</div>
          <TimelineChart timeline={d.timeline} overdue={s.overdue} noDate={s.no_date} />
        </div>
        <div style={{ ...card, flex: '1 1 240px' }}>
          <div style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>By category</div>
          {Object.entries(d.by_category || {}).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
            <div key={c} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Pill text={CAT_LABEL[c] || c} color={CAT_COLOR[c]} />
              <span style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 700 }}>{n}</span>
            </div>
          ))}
          {Object.keys(d.by_category || {}).length === 0 && <div style={{ color: 'var(--c-64748b)', fontSize: 12 }}>No items.</div>}
        </div>
      </div>

      {/* Radar table */}
      <DataGrid
        title="Lifecycle items"
        rows={d.items || []}
        subMap={subMap}
        subField="subscription_id"
        searchFields={['title', 'detail', 'category', 'source']}
        csvName="retirements-deprecations.csv"
        filters={['sub', 'search']}
        maxHeight="52vh"
        facets={[
          { field: 'category', label: 'Category', normalize: (v) => CAT_LABEL[v] || v },
          { field: 'source', label: 'Source' },
          { field: 'priority', label: 'Priority' },
        ]}
        columns={[
          { key: 'category', label: 'Category', csv: (v) => CAT_LABEL[v] || v, render: (v) => <Pill text={CAT_LABEL[v] || v} color={CAT_COLOR[v]} /> },
          { key: 'source', label: 'Source' },
          { key: 'title', label: 'What changes' },
          { key: 'deadline', label: 'Deadline', csv: (v, row) => deadlineText(row), render: (v, row) => <span style={{ color: row.days_until != null && row.days_until < 0 ? '#ef4444' : row.days_until != null && row.days_until <= 90 ? '#eab308' : 'var(--c-cbd5e1)', fontWeight: 600 }}>{deadlineText(row)}</span> },
          { key: 'exposed_count', label: 'Exposed', render: (v, row) => (v ? <span title={(row.exposed_resources || []).map((r) => r.resource_name).join(', ')} style={{ color: '#38bdf8', fontWeight: 700 }}>{v} resource{v === 1 ? '' : 's'}</span> : <span style={{ color: 'var(--c-475569)' }}>—</span>) },
          { key: 'priority', label: 'Priority', render: (v) => <Pill text={v} color={PRIO_COLOR[v]} /> },
        ]}
      />

      {/* AI briefing (on demand) */}
      <div style={{ ...card }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}><Sparkles size={15} style={{ color: 'var(--c-c4b5fd)' }} /> AI briefing</div>
            <p style={{ color: 'var(--c-94a3b8)', fontSize: 12, margin: '2px 0 0', maxWidth: 620 }}>
              Let AI read the radar + your inventory and produce a prioritized plan: what to migrate/upgrade, by when, the risk of inaction and the benefit of acting early.
            </p>
          </div>
          {!showAI && (
            <button onClick={() => setShowAI(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--c-3730a3)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              <Brain size={14} /> Generate AI briefing
            </button>
          )}
        </div>
        {showAI && <div style={{ marginTop: 14 }}><LifecycleAIAnalysis /></div>}
      </div>
    </div>
  );
}

function ServiceHealthView() {
  const [tab, setTab] = useState('radar');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const subMap = useSubscriptions();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getJSON('/api/operations/service-health'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const d = data || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ViewHeader title="Service Health" subtitle="Azure Service Health — retirements, deprecations, issues, planned maintenance & advisories affecting your subscriptions" onRefresh={load} loading={loading} />
      <TabBar
        tabs={[
          { key: 'radar', label: 'Retirements & Deprecations', Icon: CalendarClock },
          { key: 'overview', label: 'Events', Icon: Activity },
          { key: 'ai', label: 'AI Analysis', Icon: Brain },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'radar' && <LifecycleRadar />}
      {tab === 'ai' && <ServiceHealthAIAnalysis />}
      {tab === 'overview' && error && <ErrorBox error={error} onRetry={load} />}
      {tab === 'overview' && loading && !data && <Spinner label="Loading Service Health…" />}
      {tab === 'overview' && data && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <KPI label="Active Events" value={d.active_events ?? 0} sub={`${d.total_events ?? 0} total`} color={(d.active_events ?? 0) > 0 ? '#ef4444' : '#22c55e'} Icon={Activity} />
            <KPI label="Service Issues" value={d.service_issues ?? 0} color="#ef4444" />
            <KPI label="Planned Maintenance" value={d.planned_maintenance ?? 0} color="#eab308" />
            <KPI label="Advisories" value={(d.health_advisories ?? 0) + (d.security_advisories ?? 0)} sub={`${d.security_advisories ?? 0} security`} color="#38bdf8" />
          </div>
          <DataGrid
            title="Events"
            rows={d.items || []}
            subMap={subMap}
            subField="subscription_id"
            searchFields={['event_type_label', 'status', 'title', 'summary', 'tracking_id']}
            csvName="service-health.csv"
            filters={['sub', 'search']}
            maxHeight="64vh"
            facets={[{ field: 'event_type_label', label: 'Type' }, { field: 'status', label: 'Status' }]}
            columns={[
              { key: 'event_type_label', label: 'Type' },
              { key: 'status', label: 'Status', tdStyle: (v) => ({ color: STATUS_COLOR[(v || '').toLowerCase()] || 'var(--c-94a3b8)', fontWeight: 600 }) },
              { key: 'title', label: 'Title' },
              { key: 'last_update', label: 'Last Update', render: (v) => (v || '').replace('T', ' ').slice(0, 16) || '—' },
              { key: 'subscription_id', label: 'Subscription' },
            ]}
          />
        </>
      )}
    </div>
  );
}

export default ServiceHealthView;
