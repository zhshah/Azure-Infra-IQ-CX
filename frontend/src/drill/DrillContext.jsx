/**
 * DrillContext — app-wide "drill to the resources behind a number" plumbing.
 *
 * Wrap the app once in <DrillProvider>. Anywhere below, call:
 *     const { openResourceDrill } = useDrill()
 *     openResourceDrill('VMs without backup', vmsWithoutBackup)
 * to slide open the ResourceListDrawer with that exact set; each row opens the
 * full ResourceDetailDrawer. This makes every count/KPI/finding number explorable
 * without prop-drilling a drawer through dozens of category components.
 */
import React, { createContext, useContext, useState, useCallback } from 'react'
import ResourceListDrawer from '../components/ResourceListDrawer'
import ResourceDetailDrawer from '../components/ResourceDetailDrawer'

const DrillCtx = createContext({
  openResourceDrill: () => {},
  openResourceDetail: () => {},
})

export const useDrill = () => useContext(DrillCtx)

export function DrillProvider({ children }) {
  const [list, setList] = useState(null)       // { title, subtitle, resources }
  const [detail, setDetail] = useState(null)   // { resourceId, resourceName }

  // Open the resource list for a card/finding. Accepts ResourceMetrics-like dicts OR
  // structured affected_resources objects (resource_id/resource_name/...). Silently
  // no-ops on an empty set so a "0" card simply doesn't open anything.
  const openResourceDrill = useCallback((title, resources, opts = {}) => {
    const arr = (Array.isArray(resources) ? resources : []).filter(Boolean)
    if (!arr.length) return
    setList({
      title,
      subtitle: opts.subtitle || `${arr.length} resource${arr.length !== 1 ? 's' : ''}`,
      resources: arr,
    })
  }, [])

  const openResourceDetail = useCallback((r) => {
    const id = r?.resource_id || r?.id
    if (!id) return
    setDetail({ resourceId: id, resourceName: r?.resource_name || r?.name || String(id).split('/').pop() })
  }, [])

  return (
    <DrillCtx.Provider value={{ openResourceDrill, openResourceDetail }}>
      {children}
      {list && (
        <ResourceListDrawer
          title={list.title}
          subtitle={list.subtitle}
          resources={list.resources}
          onClose={() => setList(null)}
          onRowClick={openResourceDetail}
        />
      )}
      {detail && (
        <ResourceDetailDrawer
          resourceId={detail.resourceId}
          resourceName={detail.resourceName}
          onClose={() => setDetail(null)}
        />
      )}
    </DrillCtx.Provider>
  )
}
