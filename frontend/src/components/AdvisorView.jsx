/** AdvisorView — Azure Advisor recommendations by category + AI prioritization. */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Lightbulb, Brain, Download } from 'lucide-react';
import { getJSON, downloadCSV, card, th, td, KPI, Bar, TabBar, Spinner, ErrorBox, ViewHeader, DataGrid, useSubscriptions } from './mgmt/MgmtWidgets';
import { AdvisorAIAnalysis } from './AIModuleReports';

const IMPACT_COLOR = { High: '#ef4444', Medium: '#f97316', Low: '#64748b' };
const CAT_COLOR = { Cost: '#22c55e', Performance: '#38bdf8', HighAvailability: '#a78bfa', Security: '#ef4444', OperationalExcellence: '#eab308' };
const CAT_LABEL = { Cost: 'Cost', Performance: 'Performance', HighAvailability: 'Reliability', Security: 'Security', OperationalExcellence: 'Operational Excellence' };
const catLabel = (c) => (c === 'all' ? 'All' : (CAT_LABEL[c] || c));

function AdvisorView() {
  const [tab, setTab] = useState('recommendations');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [catFilter, setCatFilter] = useState('all');
  const subMap = useSubscriptions();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getJSON('/api/advisor'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const d = data || {};
  const filtered = useMemo(() => {
    const items = d.items || [];
    return catFilter === 'all' ? items : items.filter((x) => x.category === catFilter);
  }, [d.items, catFilter]);

  const tabs = [
    { key: 'recommendations', label: 'Recommendations', Icon: Lightbulb },
    { key: 'ai', label: 'AI Analysis', Icon: Brain },
  ];
  const cats = Object.keys(d.by_category || {});
  const fHigh = useMemo(() => filtered.filter((x) => x.impact === 'High').length, [filtered]);

  // Shared recommendation-type filter — drives BOTH the table and the AI analysis.
  const FilterBar = data ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ color: '#94a3b8', fontSize: 12, marginRight: 2 }}>Recommendation type:</span>
      {['all', ...cats].map((c) => {
        const active = catFilter === c;
        const color = c === 'all' ? '#38bdf8' : (CAT_COLOR[c] || '#64748b');
        const count = c === 'all' ? (d.total || 0) : (d.by_category?.[c] || 0);
        return (
          <button key={c} onClick={() => setCatFilter(c)} style={{
            fontSize: 12, padding: '5px 12px', borderRadius: 16, cursor: 'pointer',
            background: active ? color + '22' : '#0f172a', color: active ? color : '#94a3b8',
            border: `1px solid ${active ? color : '#1e293b'}`, fontWeight: active ? 700 : 500,
          }}>{catLabel(c)} <span style={{ opacity: 0.7 }}>({count})</span></button>
        );
      })}
    </div>
  ) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ViewHeader title="Advisor" subtitle="Azure Advisor — cost, performance, reliability, security & operational recommendations" onRefresh={load} loading={loading} />
      <TabBar tabs={tabs} active={tab} onChange={setTab} />
      {FilterBar}
      {error && <ErrorBox error={error} onRetry={load} />}
      {loading && !data && <Spinner label="Loading Advisor recommendations…" />}

      {tab === 'recommendations' && data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <KPI label={catFilter === 'all' ? 'Recommendations' : `${catLabel(catFilter)} Recommendations`} value={catFilter === 'all' ? (d.total ?? 0) : filtered.length} color="#38bdf8" Icon={Lightbulb} />
            <KPI label="High Impact" value={catFilter === 'all' ? (d.high_impact ?? 0) : fHigh} color="#ef4444" />
            <KPI label="Categories" value={cats.length} color="#a78bfa" />
          </div>
          <div style={{ ...card }}>
            <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>By Category</div>
            {Object.entries(d.by_category || {}).map(([k, v]) => (
              <Bar key={k} label={catLabel(k)} value={v} total={d.total || 0} color={CAT_COLOR[k] || '#64748b'} />
            ))}
          </div>
          <DataGrid
            title={catFilter === 'all' ? 'Recommendations' : `${catLabel(catFilter)} Recommendations`}
            rows={filtered}
            subMap={subMap}
            subField="subscription_id"
            searchFields={['problem', 'solution', 'resource_name', 'category_label', 'impact']}
            csvName="advisor-recommendations.csv"
            filters={['sub', 'search']}
            maxHeight="52vh"
            columns={[
              { key: 'impact', label: 'Impact', tdStyle: (v) => ({ color: IMPACT_COLOR[v] || '#94a3b8', fontWeight: 600 }) },
              { key: 'category_label', label: 'Category' },
              { key: 'problem', label: 'Problem' },
              { key: 'resource_name', label: 'Resource', render: (v) => v || '—' },
              { key: 'subscription_id', label: 'Subscription' },
            ]}
          />
        </div>
      )}

      {tab === 'ai' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {catFilter !== 'all' && (
            <div style={{ fontSize: 12, color: '#38bdf8', background: '#0c4a6e22', border: '1px solid #0c4a6e', borderRadius: 8, padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Brain size={14} /> AI analysis is scoped to <b>{catLabel(catFilter)}</b> recommendations ({d.by_category?.[catFilter] || 0}). Change the type above to re-scope the analysis.
            </div>
          )}
          <AdvisorAIAnalysis key={catFilter} category={catFilter} />
        </div>
      )}
    </div>
  );
}

export default AdvisorView;
