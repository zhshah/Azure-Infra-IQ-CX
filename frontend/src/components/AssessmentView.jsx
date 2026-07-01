/**
 * AssessmentView — reusable view for the AI Assessment modules (WAF, CAF, SQL
 * Modernization, App Service, VM Performance, Entra ID & Permissions).
 *
 * Renders an Overview tab (KPIs + enterprise DataGrid of the relevant estate,
 * when a dataConfig is supplied) and an AI Assessment tab (deep AI analysis with
 * impacted-workload drill-down + CSV export of affected resources).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Brain } from 'lucide-react';
import { getJSON, KPI, TabBar, Spinner, ErrorBox, ViewHeader, DataGrid, useSubscriptions } from './mgmt/MgmtWidgets';
import { GenericAIAnalysis } from './AIModuleReports';

export default function AssessmentView({ title, subtitle, Icon, aiEndpoint, aiTitle, dataConfig }) {
  const hasData = !!dataConfig;
  const [tab, setTab] = useState(hasData ? 'overview' : 'ai');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(hasData);
  const [error, setError] = useState(null);
  const subMap = useSubscriptions();

  const load = useCallback(async () => {
    if (!hasData) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getJSON(dataConfig.endpoint));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [hasData, dataConfig]);

  useEffect(() => { load(); }, [load]);

  const tabs = hasData
    ? [{ key: 'overview', label: 'Overview', Icon }, { key: 'ai', label: 'AI Assessment', Icon: Brain }]
    : [{ key: 'ai', label: 'AI Assessment', Icon: Brain }];

  const kpis = hasData && data ? (dataConfig.kpis?.(data) || []) : [];
  const rows = hasData && data ? (dataConfig.items?.(data) || []) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ViewHeader title={title} subtitle={subtitle} onRefresh={hasData ? load : undefined} loading={loading} />
      <TabBar tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'ai' && <GenericAIAnalysis endpoint={aiEndpoint} title={aiTitle || `${title} AI Assessment`} />}

      {tab === 'overview' && hasData && (
        <>
          {error && <ErrorBox error={error} onRetry={load} />}
          {loading && !data && <Spinner label="Loading estate…" />}
          {data && (
            <>
              {kpis.length > 0 && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {kpis.map((k, i) => <KPI key={i} {...k} />)}
                </div>
              )}
              {rows.length > 0 ? (
                <DataGrid
                  rows={rows}
                  columns={dataConfig.columns}
                  subField={dataConfig.subField}
                  rgField={dataConfig.rgField}
                  searchFields={dataConfig.searchFields}
                  subMap={subMap}
                  csvName={dataConfig.csvName}
                  title={dataConfig.gridTitle}
                />
              ) : (
                <div style={{ color: 'var(--c-64748b)', fontSize: 13, padding: '16px 0' }}>
                  {dataConfig.emptyNote || 'No matching resources discovered in the current scope.'}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
