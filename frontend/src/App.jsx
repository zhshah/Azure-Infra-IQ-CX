import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { RefreshCw, AlertCircle, AlertTriangle, Settings, FlaskConical, Brain, X, Lock, Loader, Clock, LayoutGrid, List, ChevronLeft, ChevronRight, ChevronDown, Shield, Zap, Rocket, DollarSign, Lightbulb, Globe, Target, Search, BarChart2, Monitor, Database, HardDrive, Microscope, Cloud, CloudSun, Hammer, TrendingUp, ClipboardList, Map as MapIcon, Bot, Network, Tag, Compass, Download } from 'lucide-react'
import clsx from 'clsx'
import { DataTable, KPICard as SharedKPI, SeverityBadge } from './components/shared/ModuleWidgets'

// ── Sidebar navigation items with Azure icon paths ─────────────────────────
const NAV_SECTIONS = [
  { heading: 'Dashboard', items: [
    { key: 'overview', label: 'Overview', icon: '/icons/general/10015-icon-service-Dashboard.svg' },
  ]},
  { heading: 'Analysis', items: [
    { key: 'maturity',   label: 'Maturity',   icon: '/icons/management + governance/00003-icon-service-Advisor.svg' },
    { key: 'security',   label: 'Security',   icon: '/icons/security/10241-icon-service-Microsoft-Defender-for-Cloud.svg' },
    { key: 'innovation', label: 'Innovation', icon: '/icons/general/10008-icon-service-Marketplace.svg' },
    { key: 'migration',  label: 'Migration',  icon: '/icons/migrate/10281-icon-service-Azure-Migrate.svg' },
  ]},
  { heading: 'Protection', items: [
    { key: 'backup',      label: 'Backup & DR',  icon: '/icons/storage/00017-icon-service-Recovery-Services-Vaults.svg' },
    { key: 'resilience',  label: 'Resilience',    icon: '/icons/azure stack/10109-icon-service-Capacity.svg' },
    { key: 'bcdr',        label: 'BCDR',           icon: '/icons/management + governance/00017-icon-service-Recovery-Services-Vaults.svg' },
  ]},
  { heading: 'Optimization', items: [
    { key: 'growth',    label: 'Cloud Adoption',  icon: '/icons/migrate/10281-icon-service-Azure-Migrate.svg' },
    { key: 'licensing', label: 'Licensing & Reservation', icon: '/icons/general/10003-icon-service-Reservations.svg' },
  ]},
  { heading: 'Governance', items: [
    { key: 'governance', label: 'Governance', icon: '/icons/management + governance/00003-icon-service-Advisor.svg' },
    { key: 'advisor',    label: 'Advisor',    icon: '/icons/management + governance/00003-icon-service-Advisor.svg' },
  ]},
  { heading: 'AI Assessments', items: [
    { key: 'waf',              label: 'Well-Architected',        icon: '/icons/management + governance/00003-icon-service-Advisor.svg' },
    { key: 'caf',              label: 'Cloud Adoption (CAF)',    icon: '/icons/migrate/10281-icon-service-Azure-Migrate.svg' },
    { key: 'sql-modernization', label: 'SQL Modernization',      icon: '/icons/databases/10130-icon-service-SQL-Database.svg' },
    { key: 'appservice',       label: 'App Service',             icon: '/icons/compute/10035-icon-service-App-Services.svg' },
    { key: 'vm-performance',    label: 'VM Performance',          icon: '/icons/compute/10021-icon-service-Virtual-Machine.svg' },
    { key: 'entra',            label: 'Identity & Access',  icon: '/icons/security/10241-icon-service-Microsoft-Defender-for-Cloud.svg' },
  ]},
  { heading: 'Infrastructure', items: [
    { key: 'resources',  label: 'Resources',     icon: '/icons/general/10001-icon-service-All-Resources.svg' },
    { key: 'infra',      label: 'Infrastructure', icon: '/icons/management + governance/00001-icon-service-Monitor.svg' },
    { key: 'networking', label: 'Networking',     icon: '/icons/networking/10061-icon-service-Virtual-Networks.svg' },
    { key: 'architecture-map', label: 'Architecture Map', icon: '/icons/networking/10061-icon-service-Virtual-Networks.svg' },
    { key: 'onpremise',  label: 'Hybrid & Arc',  icon: '/icons/management + governance/00756-icon-service-Azure-Arc.svg' },
    { key: 'onprem_collection', label: 'On-Premises', icon: '/icons/compute/10021-icon-service-Virtual-Machine.svg' },
    { key: 'software-governance', label: 'Software Governance', icon: '/icons/security/10241-icon-service-Microsoft-Defender-for-Cloud.svg' },
  ]},
  { heading: 'Operations', items: [
    { key: 'monitoring', label: 'Monitoring', icon: '/icons/management + governance/00001-icon-service-Monitor.svg' },
    { key: 'updates', label: 'Update Management', icon: '/icons/management + governance/00001-icon-service-Monitor.svg' },
    { key: 'service-health', label: 'Service Health', icon: '/icons/management + governance/00001-icon-service-Monitor.svg' },
    { key: 'quota', label: 'Quota & Capacity', icon: '/icons/general/10003-icon-service-Reservations.svg' },
  ]},
  { heading: 'Management', items: [
    { key: 'assessments', label: 'Assessments', icon: '/icons/general/10349-icon-service-Resource-Explorer.svg' },
    { key: 'projects',    label: 'Projects',    icon: '/icons/general/10007-icon-service-Resource-Groups.svg' },
    { key: 'tags',        label: 'Tags',        icon: '/icons/general/10014-icon-service-Tag.svg' },
  ]},
  { heading: 'FinOps', collapsible: true, items: [
    { key: 'finops-overview',   label: '⚡ FinOps Overview',    icon: '/icons/management + governance/00001-icon-service-Monitor.svg' },
    { key: 'finops',          label: 'FinOps Dashboard',    icon: '/icons/management + governance/00001-icon-service-Monitor.svg' },
    { key: 'cost-explorer',   label: 'Cost Explorer',       icon: '/icons/general/10015-icon-service-Dashboard.svg' },
    { key: 'finops-budgets',  label: 'Budget Manager',      icon: '/icons/general/10003-icon-service-Reservations.svg' },
    { key: 'finops-forecast', label: 'Forecast',            icon: '/icons/general/10008-icon-service-Marketplace.svg' },
    { key: 'finops-alloc',    label: 'Cost Allocation',     icon: '/icons/general/10007-icon-service-Resource-Groups.svg' },
    { key: 'finops-chargeback', label: 'Chargeback',        icon: '/icons/general/10014-icon-service-Tag.svg' },
    { key: 'finops-commit',   label: 'Commitments & RI',   icon: '/icons/general/10349-icon-service-Resource-Explorer.svg' },
    { key: 'finops-savings',  label: 'Savings Optimizer',   icon: '/icons/migrate/10281-icon-service-Azure-Migrate.svg' },
    { key: 'finops-tags',     label: 'Tag Cost Analytics',  icon: '/icons/general/10001-icon-service-All-Resources.svg' },
    { key: 'finops-alerts',   label: 'FinOps Alerts',       icon: '/icons/security/10241-icon-service-Microsoft-Defender-for-Cloud.svg' },
    { key: 'finops-warehouse', label: 'Cost Warehouse',   icon: '/icons/databases/00036-icon-service-SQL-Data-Warehouses.svg' },
    { key: 'finops-compliance', label: '✅ FinOps Compliance', icon: '/icons/management + governance/00003-icon-service-Advisor.svg' },
  ]},
  // Keep 'About' LAST so it always sits at the bottom of the left-hand menu.
  { heading: 'About', items: [
    { key: 'about',          label: 'About',     icon: '/icons/general/10013-icon-service-Help-and-Support.svg' },
    { key: 'about-features', label: 'Features',  icon: '/icons/general/10008-icon-service-Marketplace.svg' },
    { key: 'about-faqs',     label: 'FAQs',      icon: '/icons/management + governance/00003-icon-service-Advisor.svg' },
  ]},
]

function SidebarNav({ view, onNavigate, collapsed, onToggle, badges }) {
  // Collapsible sections (e.g. FinOps) start EXPANDED so every blade is open by default.
  const [expandedSections, setExpandedSections] = React.useState(() => {
    const init = {}
    NAV_SECTIONS.forEach(s => { if (s.collapsible) init[s.heading] = true })
    return init
  })
  const [hoveredItem, setHoveredItem] = React.useState(null)

  // Auto-expand section containing active view
  React.useEffect(() => {
    NAV_SECTIONS.forEach(section => {
      if (section.collapsible && section.items.some(i => i.key === view)) {
        setExpandedSections(prev => ({ ...prev, [section.heading]: true }))
      }
    })
  }, [view])

  const toggleSection = (heading) => {
    setExpandedSections(prev => ({ ...prev, [heading]: !prev[heading] }))
  }

  const sidebarW = collapsed ? 60 : 240

  return (
    <aside style={{
      width: sidebarW, minWidth: sidebarW,
      height: '100vh', position: 'sticky', top: 0, zIndex: 30,
      background: '#0c1220',
      borderRight: '1px solid rgba(30, 41, 59, 0.6)',
      display: 'flex', flexDirection: 'column',
      transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      overflowX: 'hidden',
    }}>
      {/* Logo area — height matches header exactly (52px) */}
      <div style={{
        height: 52, minHeight: 52, maxHeight: 52,
        padding: collapsed ? '0 8px' : '0 16px',
        borderBottom: '1px solid rgba(30, 41, 59, 0.6)',
        display: 'flex', alignItems: 'center',
        gap: 12,
      }}>
        {/* Azure logo mark */}
        <div style={{
          width: 32, height: 32, flexShrink: 0,
          borderRadius: 8,
          background: 'linear-gradient(135deg, #0078d4 0%, #00b7c3 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0, 120, 212, 0.3)',
        }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M7.5 2L2 14h4l1-2.5h4L12 14h4L10.5 2h-3zm1.5 3l1.5 4.5h-3L9 5z" fill="white" fillOpacity="0.95"/>
          </svg>
        </div>
        {!collapsed && (
          <div style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <div style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.01em' }}>Azure Infra IQ</div>
            <div style={{ color: '#64748b', fontSize: 10, fontWeight: 500, letterSpacing: '0.02em' }}>AI-Powered Insights</div>
          </div>
        )}
      </div>

      {/* Navigation sections */}
      <div className="sidebar-scroll" style={{
        flex: 1, padding: '12px 0 8px', overflowY: 'auto',
        scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent',
      }}>
        {NAV_SECTIONS.map((section, si) => {
          const isCollapsible = section.collapsible
          const isExpanded = !isCollapsible || expandedSections[section.heading]
          const hasActiveChild = section.items.some(i => i.key === view)

          return (
            <div key={section.heading} style={{ marginBottom: 2 }}>
              {/* Section divider line (after first section) */}
              {si > 0 && !collapsed && (
                <div style={{ height: 1, background: 'rgba(30, 41, 59, 0.4)', margin: '8px 16px 8px' }} />
              )}
              {si > 0 && collapsed && <div style={{ height: 1, background: 'rgba(30, 41, 59, 0.4)', margin: '6px 10px' }} />}

              {!collapsed && (
                <div
                  onClick={isCollapsible ? () => toggleSection(section.heading) : undefined}
                  style={{
                    color: hasActiveChild ? '#94a3b8' : '#475569',
                    fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                    letterSpacing: '0.06em', padding: '8px 18px 6px',
                    cursor: isCollapsible ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    userSelect: 'none',
                    transition: 'color 0.15s',
                  }}
                >
                  <span>{section.heading}</span>
                  {isCollapsible && (
                    <ChevronDown size={11} style={{
                      transition: 'transform 0.2s',
                      transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                      opacity: 0.6,
                    }} />
                  )}
                </div>
              )}
              {(isExpanded || collapsed) && section.items.map(item => {
                const active = view === item.key
                const hovered = hoveredItem === item.key
                return (
                  <button
                    key={item.key}
                    onClick={() => onNavigate(item.key)}
                    onMouseEnter={() => setHoveredItem(item.key)}
                    onMouseLeave={() => setHoveredItem(null)}
                    title={collapsed ? item.label : undefined}
                    className="nav-item-transition"
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center',
                      gap: 10,
                      padding: collapsed ? '9px 0' : '8px 18px',
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      background: active
                        ? 'rgba(0, 120, 212, 0.12)'
                        : hovered ? 'rgba(30, 41, 59, 0.5)' : 'transparent',
                      border: 'none',
                      borderLeft: collapsed ? 'none' : (active ? '3px solid #0078d4' : '3px solid transparent'),
                      borderRadius: collapsed ? 8 : 0,
                      margin: collapsed ? '1px 8px' : 0,
                      cursor: 'pointer',
                      color: active ? '#e2e8f0' : hovered ? '#cbd5e1' : '#94a3b8',
                    }}
                  >
                    <img src={item.icon} alt="" style={{
                      width: 18, height: 18, flexShrink: 0,
                      opacity: active ? 1 : hovered ? 0.85 : 0.55,
                      transition: 'opacity 0.15s',
                    }} />
                    {!collapsed && (
                      <span style={{
                        fontSize: 13, fontWeight: active ? 600 : 400,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                        textAlign: 'left',
                      }}>
                        {item.label}
                      </span>
                    )}
                    {!collapsed && badges?.[item.key] > 0 && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, lineHeight: 1,
                        padding: '2px 6px', borderRadius: 10, minWidth: 18, textAlign: 'center',
                        background: badges[item.key + '_color'] || (badges[item.key] > 5 ? '#ef4444' : '#f97316'),
                        color: '#ffffff',
                      }}>
                        {badges[item.key]}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        style={{
          height: 40, padding: '0 12px',
          background: 'transparent',
          border: 'none', borderTop: '1px solid rgba(30, 41, 59, 0.5)',
          cursor: 'pointer', color: '#475569',
          display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-end',
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
        onMouseLeave={e => e.currentTarget.style.color = '#475569'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
      </button>
    </aside>
  )
}

// Errors that almost always mean "this tab is running an outdated bundle after a
// redeploy" — a hooks/#310 mismatch or a stale lazy-chunk that 404s. For these we
// self-heal by reloading ONCE (time-guarded against loops) to pull the fresh build.
const _RECOVERABLE_ERR = /(Minified React error #31\d)|(Rendered (more|fewer) hooks)|(Loading chunk \S+ failed)|(error loading dynamically imported module)|(Failed to fetch dynamically imported module)/i

function _hardReload() {
  // index.html is served no-cache, so a reload already fetches the new bundle.
  // The cache-bust param is belt-and-suspenders against any intermediary cache.
  try {
    const u = new URL(window.location.href)
    u.searchParams.set('_v', Date.now().toString(36))
    window.location.replace(u.toString())
  } catch {
    window.location.reload()
  }
}

// Reload at most once per minute for a recoverable error, so a genuinely-broken
// CURRENT build shows the fallback UI instead of reloading forever.
function _maybeSelfHeal(error) {
  try {
    const msg = String(error?.message || error || '')
    const last = Number(sessionStorage.getItem('eb-auto-reload-ts') || 0)
    if (_RECOVERABLE_ERR.test(msg) && Date.now() - last > 60_000) {
      sessionStorage.setItem('eb-auto-reload-ts', String(Date.now()))
      _hardReload()
      return true
    }
  } catch { /* sessionStorage blocked — ignore */ }
  return false
}

// Root boundary — full-screen fallback. Wraps the entire app so a render error
// never leaves a blank page.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Uncaught render error:', error, info?.componentStack)
    _maybeSelfHeal(error)
  }
  render() {
    if (this.state.error) return (
      <div className="fixed inset-0 bg-gray-950 flex flex-col items-center justify-center gap-4 p-8">
        <AlertCircle size={32} className="text-red-400" />
        <p className="text-red-400 font-semibold">Something went wrong</p>
        <pre className="text-gray-500 text-xs max-w-lg text-center whitespace-pre-wrap">{this.state.error?.message}</pre>
        <pre className="text-gray-600 text-xs max-w-2xl text-left whitespace-pre-wrap mt-2 overflow-auto max-h-60">{this.state.error?.stack}</pre>
        <button onClick={_hardReload} className="text-xs text-blue-400 underline">Reload</button>
      </div>
    )
    return this.props.children
  }
}

// View-scoped boundary — isolates a single module/view so one broken pane never
// wedges the whole portal. Resets automatically when the user navigates (resetKey
// changes) and offers an inline "Back to Overview" escape hatch.
class ViewErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  componentDidCatch(error, info) {
    console.error('[ViewErrorBoundary] Render error in view:', this.props.resetKey, error, info?.componentStack)
    _maybeSelfHeal(error)
  }
  componentDidUpdate(prev) {
    // Clear the error when the user switches to a different view.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }
  render() {
    if (this.state.error) return (
      <div style={{ background: '#1a0e0e', border: '1px solid #7f1d1d', borderRadius: 10, padding: 20, margin: 16, color: '#fca5a5', display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 720 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={18} />
          <span style={{ fontWeight: 600 }}>This section hit an error and was isolated so the rest of the portal keeps working.</span>
        </div>
        <pre style={{ color: '#ef4444', fontSize: 12, whiteSpace: 'pre-wrap' }}>{this.state.error?.message}</pre>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => this.setState({ error: null })} style={{ fontSize: 12, color: '#60a5fa', background: 'none', border: '1px solid #1d4ed8', borderRadius: 6, padding: '5px 12px', cursor: 'pointer' }}>↺ Try again</button>
          <button onClick={() => { this.setState({ error: null }); this.props.onReset?.() }} style={{ fontSize: 12, color: '#94a3b8', background: 'none', border: '1px solid #334155', borderRadius: 6, padding: '5px 12px', cursor: 'pointer' }}>← Back to Overview</button>
        </div>
      </div>
    )
    return this.props.children
  }
}

import { api } from './api/client'
import VersionWatcher    from './components/VersionWatcher'
import SoftwareGovernancePanel from './components/SoftwareGovernancePanel'
import MonitoringView    from './components/MonitoringView'
import GovernanceView    from './components/GovernanceView'
import AdvisorView       from './components/AdvisorView'
import ServiceHealthView from './components/ServiceHealthView'
import IdentityView     from './components/IdentityView'
import QuotaView         from './components/QuotaView'
import KPICards          from './components/KPICards'
import ScoreDonut        from './components/ScoreDonut'
import CostByTypeBar     from './components/CostByTypeBar'
import ResourceTable     from './components/ResourceTable'
import OrphanPanel       from './components/OrphanPanel'
import SavingsPanel      from './components/SavingsPanel'
import ProgressOverlay   from './components/ProgressOverlay'
import SettingsPanel     from './components/SettingsPanel'
import WasteQuadrant     from './components/WasteQuadrant'
import ResourceDetailsModal from './components/ResourceDetailsModal'
import SavingsWaterfall  from './components/SavingsWaterfall'
import RightSizePanel    from './components/RightSizePanel'
import WasteByRG        from './components/WasteByRG'
import WasteByCategory  from './components/WasteByCategory'
import TagManagementModule from './components/TagManagementModule'
import TagCompliance    from './components/TagCompliance'
import FilterBar         from './components/FilterBar'
import AIInsightPanel    from './components/AIInsightPanel'
import AIInsightsDashboard from './components/AIInsightsDashboard'
import AssessmentView      from './components/AssessmentView'
import BenchmarkPanel    from './components/BenchmarkPanel'
import DrillDownDrawer   from './components/DrillDownDrawer'
import HealthScoreWidget from './components/HealthScoreWidget'
import SetupWizard       from './components/SetupWizard'
import ResourceMap       from './components/ResourceMap'
import AIResourcesPanel  from './components/AIResourcesPanel'
import AppServicePanel   from './components/AppServicePanel'
import StoragePanel      from './components/StoragePanel'
import SpendTrend        from './components/SpendTrend'
import ReservationsPanel from './components/ReservationsPanel'
import HeaderAccount      from './auth/HeaderAccount'
const ExportPDFButton = React.lazy(() => import('./components/ExportPDFButton'))
const ArchitectureMapView = React.lazy(() => import('./components/ArchitectureMapView'))
import WAFScorecard           from './components/WAFScorecard'
import SecurityPanel          from './components/SecurityPanel'
import ModernizationPanel     from './components/ModernizationPanel'
import MigrationDashboard    from './components/MigrationDashboard'
import InnovationGapPanel     from './components/InnovationGapPanel'
import CloudMaturityPanel     from './components/CloudMaturityPanel'
import LicensingPanel         from './components/LicensingPanel'
import ResiliencePanel        from './components/ResiliencePanel'
import BackupResiliencePanel  from './components/BackupResiliencePanel'
import CloudAdoptionPanel     from './components/CloudAdoptionPanel'
import ProjectSwitcher        from './components/ProjectSwitcher'
import ProjectsPanel          from './components/ProjectsPanel'
import ProjectsModule         from './components/ProjectsModule'
import AssessmentModule       from './components/AssessmentModule'
import BCDRDashboard          from './components/bcdr/BCDRDashboard'
import BCDRAssessmentTable    from './components/bcdr/BCDRAssessmentTable'
import NetworkingDashboard    from './components/networking/NetworkingDashboard'
import NetworkingAIAnalysis   from './components/networking/NetworkingAIAnalysis'
import { MaturityAIAnalysis, SecurityAIAnalysis, InnovationAIAnalysis, MigrationAIAnalysis, BackupAIAnalysis, ResilienceAIAnalysis, DeepBCDRAnalysis } from './components/AIModuleReports'
import { buildSubNameMap, subNameRenderer, scoreBadgeRenderer, severityBadgeRenderer, costRenderer, boolBadgeRenderer } from './utils/subscriptionNames.jsx'
import AVSDRPanel from './components/AVSDRPanel'
import SaveProjectModal        from './components/SaveProjectModal'
import InfraAIPanel           from './components/infra/InfraAIPanel'
import DependencyGraphView    from './components/infra/DependencyGraphView'
import InfrastructureDashboard from './components/infra/InfrastructureDashboard'
import TagManager             from './components/TagManager'
import ArcDashboard           from './components/arc/ArcDashboard'
import ArcResourceExplorer    from './components/arc/ArcResourceExplorer'
import ArcSQL                 from './components/arc/ArcSQL'
import ArcBCDR                from './components/arc/ArcBCDR'
import ArcAIAnalysis          from './components/arc/ArcAIAnalysis'
import OnPremCollectionView   from './components/OnPremCollectionView'
import UpdateManagementView   from './components/updates/UpdateManagementView'

// ── FinOps Module ─────────────────────────────────────────────────────────────
import FinOpsOverview    from './finops/FinOpsOverview'
import FinOpsDashboard    from './finops/FinOpsDashboard'
import CostExplorer       from './finops/CostExplorer'
import BudgetManager      from './finops/BudgetManager'
import ForecastPanel      from './finops/ForecastPanel'
import AllocationView     from './finops/AllocationView'
import ChargebackPanel    from './finops/ChargebackPanel'
import CommitmentTracker  from './finops/CommitmentTracker'
import SavingsSummary     from './finops/SavingsSummary'
import TagAnalytics       from './finops/TagAnalytics'
import FinOpsAlerts       from './finops/FinOpsAlerts'
import FinOpsWarehouse    from './finops/FinOpsWarehouse'
import FinOpsComplianceView from './finops/FinOpsComplianceView'

// ── About / Features / FAQs ─────────────────────────────────────────────────
import About                 from './components/About'

function ErrorView({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <div className="p-4 rounded-full bg-red-900/20">
        <AlertCircle size={32} className="text-red-400" />
      </div>
      <div className="text-center max-w-md">
        <p className="text-red-400 font-semibold text-lg">Failed to load data</p>
        <p className="text-gray-500 text-sm mt-2 font-mono">{message}</p>
      </div>
      <button onClick={onRetry} className="btn-primary">Retry</button>
    </div>
  )
}


const PROVIDER_LABEL = {
  azure_openai: 'Azure OpenAI',
  none:         'AI Off',
}
function providerLabel(p) { return PROVIDER_LABEL[p] ?? 'AI Off' }

function AIStatusBadge({ provider, onOpenSettings }) {
  const active = provider && provider !== 'none'
  return (
    <button
      onClick={onOpenSettings}
      title={active ? `Global Settings — AI scoring active (${providerLabel(provider)})` : 'Global Settings — enable AI for better scoring'}
      className={clsx(
        'flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs font-medium transition-colors',
        active
          ? 'bg-green-900/30 border-green-700/50 text-green-400 hover:bg-green-900/50'
          : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300',
      )}
    >
      <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', active ? 'bg-green-400 animate-pulse' : 'bg-gray-600')} />
      <Brain size={11} />
      <span className="hidden lg:inline">Global Settings</span>
    </button>
  )
}

function AIDisabledBanner({ onOpenSettings, onDismiss }) {
  return (
    <div className="bg-amber-900/20 border-b border-amber-700/30 px-6 py-2.5">
      <div className="max-w-screen-2xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 text-sm">
          <Brain size={14} className="text-amber-400 shrink-0" />
          <span className="text-amber-300">
            <strong>Enable AI for better scoring and assurance results.</strong>
            {' '}AI catches false positives, explains findings in plain English, and adds confidence levels rules alone can't provide.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={onOpenSettings}
            className="px-3 py-1 rounded-lg bg-amber-600/80 hover:bg-amber-600 text-white text-xs font-medium transition-colors">
            Enable AI
          </button>
          <button onClick={onDismiss} className="text-amber-600 hover:text-amber-400 transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

function DemoBanner({ onExitDemo }) {
  return (
    <div className="bg-indigo-900/30 border-b border-indigo-700/40 px-6 py-2 text-xs text-indigo-300">
      <div className="max-w-screen-2xl mx-auto flex items-center justify-between gap-4">
        <span>
          <FlaskConical size={12} className="inline mr-1.5 mb-0.5" />
          <strong>Demo Mode</strong> — showing synthetic data. Add your Azure credentials in Settings to connect to your real subscription.
        </span>
        <button
          onClick={onExitDemo}
          className="shrink-0 px-2.5 py-1 rounded-md bg-indigo-700/60 hover:bg-indigo-600/70 text-indigo-200 hover:text-white text-xs font-medium transition-colors border border-indigo-600/50"
        >
          Exit Demo →
        </button>
      </div>
    </div>
  )
}

function CostDataWarningBanner({ warning }) {
  const [dismissed, setDismissed] = useState(false)
  if (!warning || dismissed) return null

  // Treat 429 / throttle errors as transient warnings, not hard failures
  const isRateLimit = /rate limit|temporarily unavailable|minutes ago|429|too many requests/i.test(warning)
  const shortMsg = isRateLimit
    ? 'Cost Management API is being rate-limited. Figures may be from a previous scan — re-run when ready.'
    : 'Cost figures may be incomplete — ensure the service principal has the Cost Management Reader role.'

  return (
    <div className={`border-b px-6 py-2.5 ${isRateLimit ? 'bg-amber-900/30 border-amber-700/30' : 'bg-red-950/60 border-red-700/40'}`}>
      <div className="max-w-screen-2xl mx-auto flex items-center gap-2.5 text-sm">
        <AlertCircle size={15} className={`shrink-0 ${isRateLimit ? 'text-amber-400' : 'text-red-400'}`} />
        <span className={`flex-1 ${isRateLimit ? 'text-amber-300' : 'text-red-300'}`}>
          {isRateLimit ? '' : ''}<strong>{isRateLimit ? 'Cost data:' : 'Cost data unavailable:'}</strong> {shortMsg}
        </span>
        <button
          onClick={() => setDismissed(true)}
          className={`shrink-0 ml-2 opacity-60 hover:opacity-100 transition-opacity ${isRateLimit ? 'text-amber-300' : 'text-red-300'}`}
          title="Dismiss"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}

function PartialMonthBanner({ kpi }) {
  if (!kpi || kpi.billing_basis !== 'previous_month') return null
  return (
    <div className="bg-amber-900/20 border-b border-amber-700/30 px-6 py-2 text-xs text-amber-300">
      <div className="max-w-screen-2xl mx-auto flex items-center gap-2">
        <span>{React.createElement(Zap, { size: 13 })}</span>
        <span>
          <strong>Early-month data:</strong> Only {kpi.billing_days_current} day{kpi.billing_days_current !== 1 ? 's' : ''} of billing recorded this month.
          Savings estimates are based on last month's spend for accuracy.
        </span>
      </div>
    </div>
  )
}

// ── UX1: Read-only trust badge (inline in header) ──────────────────────────────
function ReadOnlyBadge() {
  return (
    <div
      title="Read-only — no changes are made to your Azure environment"
      className="flex items-center gap-1.5 px-2 py-1 rounded-full border border-green-800/40 bg-green-900/20 text-xs text-green-400 cursor-default select-none"
    >
      <Lock size={10} />
      <span className="hidden lg:inline">Read-only</span>
    </div>
  )
}

function BuyMeCoffeeButton() {
  return null
}

// ── UX0: Waste summary banner ──────────────────────────────────────────────────

function fmtBannerAmount(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}

function WasteSummaryBanner({ data, resources }) {
  if (!data) return null
  // When filters are active, compute from filtered resources; otherwise use pre-aggregated kpi
  const activeResources = resources ?? data.resources ?? []
  const totalWaste = activeResources.reduce((s, r) => s + (r.estimated_monthly_savings ?? 0), 0) || (data.kpi?.total_estimated_savings ?? 0)
  const totalSpend = activeResources.reduce((s, r) => s + (r.cost_current_month ?? 0), 0) || (data.kpi?.total_cost_current_month ?? 0)
  if (totalWaste <= 0) return null

  const wastePct = totalSpend > 0 ? Math.round((totalWaste / totalSpend) * 100) : 0

  // Top waste resource group
  const rgMap = {}
  for (const r of activeResources) {
    const rg = r.resource_group || '(unassigned)'
    rgMap[rg] = (rgMap[rg] ?? 0) + (r.estimated_monthly_savings ?? 0)
  }
  const topRG = Object.entries(rgMap).sort((a, b) => b[1] - a[1])[0]

  return (
    <div className="bg-gradient-to-r from-red-950/60 via-orange-950/40 to-transparent border border-orange-800/30 rounded-xl px-5 py-4">
      <div className="flex items-center justify-between gap-6 flex-wrap">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white tabular-nums">{fmtBannerAmount(totalWaste)}</span>
            <span className="text-base text-orange-400 font-medium">/mo potential savings</span>
          </div>
          <p className="text-sm text-gray-400 mt-0.5">
            <span className="text-orange-300 font-semibold">{wastePct}% of your total bill</span>
            {' '}could be eliminated
          </p>
        </div>
        {topRG && topRG[1] > 0 && (
          <div className="shrink-0 text-right">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Top waste source</p>
            <p className="text-sm font-semibold text-orange-300 truncate max-w-[260px]">{topRG[0]}</p>
            <p className="text-xs text-gray-500 mt-0.5">{fmtBannerAmount(topRG[1])} in savings</p>
          </div>
        )}
      </div>
    </div>
  )
}

function ScopeBanner({ data, onOpenSettings }) {
  if (!data?.scan_scope_active) return null
  const parts = []
  if (data.active_subscription_id) parts.push(`subscription ${data.active_subscription_id.slice(0, 8)}…`)
  if (data.active_resource_group)  parts.push(`resource group "${data.active_resource_group}"`)
  return (
    <div className="bg-amber-900/20 border-b border-amber-700/30 px-6 py-2">
      <div className="max-w-screen-2xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs text-amber-300">
          <FlaskConical size={13} className="text-amber-400 shrink-0" />
          <span>
            <strong>Test Scope Active</strong> — scanning only {parts.join(' + ')}.
            {' '}Results represent a subset of your environment.
          </span>
        </div>
        <button
          onClick={onOpenSettings}
          className="shrink-0 text-xs text-amber-500 hover:text-amber-300 underline underline-offset-2 transition-colors"
        >
          Change scope
        </button>
      </div>
    </div>
  )
}

// ── Cross-Module Navigation Links ──────────────────────────────────────────
function CrossModuleLinks({ links, onNavigate }) {
  if (!links?.length) return null
  return (
    <div style={{
      display: 'flex', gap: 8, flexWrap: 'wrap',
      padding: '12px 16px', marginTop: 16,
      background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10,
    }}>
      <span style={{ color: '#475569', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', alignSelf: 'center', marginRight: 4 }}>
        Explore further
      </span>
      {links.map(l => (
        <button key={l.key} onClick={() => onNavigate(l.key)} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '5px 12px', borderRadius: 6,
          background: `${l.color || '#3b82f6'}15`, border: `1px solid ${l.color || '#3b82f6'}30`,
          color: l.color || '#3b82f6', fontSize: 11, fontWeight: 600,
          cursor: 'pointer', transition: 'all 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = `${l.color || '#3b82f6'}25` }}
        onMouseLeave={e => { e.currentTarget.style.background = `${l.color || '#3b82f6'}15` }}
        >
          {l.icon && <img src={l.icon} alt="" style={{ width: 14, height: 14 }} />}
          {l.label}
        </button>
      ))}
    </div>
  )
}

// ── Top Recommendations Widget ─────────────────────────────────────────────
function TopRecommendations({ data, resources, onNavigate }) {
  const recs = useMemo(() => {
    const items = []
    // Orphan resources
    const orphans = data?.orphans ?? []
    if (orphans.length > 0) {
      const orphanCost = orphans.reduce((s, o) => s + (o.monthly_cost ?? 0), 0)
      items.push({
        category: 'Orphan Resources',
        count: orphans.length,
        savings: orphanCost,
        severity: 'high',
        nav: 'overview', icon: '/icons/general/10001-icon-service-All-Resources.svg',
        desc: `${orphans.length} unused resources wasting $${Math.round(orphanCost).toLocaleString()}/mo`,
      })
    }
    // Right-sizing
    const rightsize = data?.rightsize_opportunities ?? []
    if (rightsize.length > 0) {
      const rsCost = rightsize.reduce((s, r) => s + (r.monthly_savings ?? 0), 0)
      items.push({
        category: 'Right-Sizing',
        count: rightsize.length,
        savings: rsCost,
        severity: 'medium',
        nav: 'overview', icon: '/icons/compute/10021-icon-service-Virtual-Machine.svg',
        desc: `${rightsize.length} VMs can be downsized saving $${Math.round(rsCost).toLocaleString()}/mo`,
      })
    }
    // Licensing & Reservations
    const lopps = data?.licensing_opportunities ?? []
    if (lopps.length > 0) {
      const licSave = lopps.reduce((s, o) => s + (o.estimated_monthly_saving ?? 0), 0)
      items.push({
        category: 'Licensing & Reservations',
        count: lopps.length,
        savings: licSave,
        severity: licSave > 500 ? 'high' : 'medium',
        nav: 'licensing', icon: '/icons/general/10003-icon-service-Reservations.svg',
        desc: `${lopps.length} licensing optimizations saving $${Math.round(licSave).toLocaleString()}/mo`,
      })
    }
    // Security gaps
    const gaps = data?.security_gaps ?? []
    const critSec = gaps.filter(g => g.severity === 'critical').length
    if (critSec > 0) {
      items.push({
        category: 'Critical Security Gaps',
        count: critSec,
        savings: 0,
        severity: 'critical',
        nav: 'security', icon: '/icons/security/10241-icon-service-Microsoft-Defender-for-Cloud.svg',
        desc: `${critSec} critical security findings require immediate attention`,
      })
    }
    // BCDR gaps
    const bc = data?.backup_coverage
    if (bc && bc.critical_gaps > 0) {
      items.push({
        category: 'Backup Coverage Gaps',
        count: bc.critical_gaps,
        savings: 0,
        severity: 'critical',
        nav: 'backup', icon: '/icons/storage/00017-icon-service-Recovery-Services-Vaults.svg',
        desc: `${bc.critical_gaps} critical resources without backup protection`,
      })
    }
    // Sort: critical first, then by savings descending
    const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 }
    return items.sort((a, b) => (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3) || b.savings - a.savings).slice(0, 5)
  }, [data])

  if (!recs.length) return null
  const totalSavings = recs.reduce((s, r) => s + r.savings, 0)
  const sevColors = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e' }

  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ color: '#475569', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Top Recommendations
        </div>
        {totalSavings > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#22c55e15', border: '1px solid #22c55e30', borderRadius: 8, padding: '3px 10px' }}>
            <DollarSign size={12} style={{ color: '#22c55e' }} />
            <span style={{ color: '#22c55e', fontSize: 12, fontWeight: 700 }}>${Math.round(totalSavings).toLocaleString()}/mo potential savings</span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {recs.map((r, i) => (
          <button key={i} onClick={() => onNavigate(r.nav)} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10,
            padding: '10px 14px', cursor: 'pointer', textAlign: 'left',
            borderLeft: `3px solid ${sevColors[r.severity] || '#3b82f6'}`,
            transition: 'all 0.15s', width: '100%',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#1e293b' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#0f172a' }}
          >
            <img src={r.icon} alt="" style={{ width: 20, height: 20, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600 }}>{r.category}</span>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 6,
                  background: `${sevColors[r.severity]}20`, color: sevColors[r.severity],
                  textTransform: 'uppercase',
                }}>{r.severity}</span>
              </div>
              <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>{r.desc}</div>
            </div>
            {r.savings > 0 && (
              <div style={{ color: '#22c55e', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                ${Math.round(r.savings).toLocaleString()}/mo
              </div>
            )}
            <ChevronRight size={14} style={{ color: '#475569', flexShrink: 0 }} />
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Estate Overview Widget ─────────────────────────────────────────────────
function EstateOverview({ resources, backupCoverage, onNavigate }) {
  const rs = resources || []
  const typeCount = (pattern) => rs.filter(r => (r.resource_type || '').toLowerCase().includes(pattern)).length

  const widgets = [
    {
      title: 'Compute',
      icon: '/icons/compute/03543-icon-service-AKS-Automatic.svg',
      stats: [
        { label: 'Virtual Machines', value: typeCount('virtualmachines'), exclude: 'extensions' },
        { label: 'App Services', value: typeCount('microsoft.web/sites') },
        { label: 'Containers', value: typeCount('containerapps') + typeCount('containerinstances') },
        { label: 'AKS', value: typeCount('managedclusters') },
      ].filter(s => s.value > 0),
      color: '#3b82f6',
      nav: 'infra',
    },
    {
      title: 'Networking',
      icon: '/icons/networking/10061-icon-service-Virtual-Networks.svg',
      stats: [
        { label: 'Virtual Networks', value: typeCount('virtualnetworks') },
        { label: 'NSGs', value: typeCount('networksecuritygroups') },
        { label: 'Load Balancers', value: typeCount('loadbalancers') },
        { label: 'Public IPs', value: typeCount('publicipaddresses') },
        { label: 'Firewalls', value: rs.filter(r => (r.resource_type || '').toLowerCase() === 'microsoft.network/azurefirewalls').length },
      ].filter(s => s.value > 0),
      color: '#22d3ee',
      nav: 'networking',
    },
    {
      title: 'Data & Storage',
      icon: '/icons/databases/10130-icon-service-SQL-Database.svg',
      stats: [
        { label: 'SQL Databases', value: typeCount('sql/servers') },
        { label: 'Cosmos DB', value: typeCount('databaseaccounts') },
        { label: 'Storage Accounts', value: typeCount('storageaccounts') },
        { label: 'Key Vaults', value: typeCount('keyvault') },
      ].filter(s => s.value > 0),
      color: '#a78bfa',
      nav: 'resources',
    },
    {
      title: 'BCDR & Recovery',
      icon: '/icons/storage/00017-icon-service-Recovery-Services-Vaults.svg',
      stats: [
        { label: 'Coverage', value: backupCoverage ? `${Math.round(backupCoverage.coverage_pct)}%` : '—' },
        { label: 'Critical Gaps', value: backupCoverage?.critical_gaps || 0 },
        { label: 'RSV Vaults', value: typeCount('recoveryservices/vaults') },
        { label: 'Total Gaps', value: backupCoverage?.total_gaps || 0 },
      ],
      color: backupCoverage?.critical_gaps > 0 ? '#ef4444' : '#22c55e',
      nav: 'backup',
    },
    {
      title: 'Security & Identity',
      icon: '/icons/security/10241-icon-service-Microsoft-Defender-for-Cloud.svg',
      stats: [
        { label: 'Key Vaults', value: typeCount('keyvault/vaults') },
        { label: 'Managed IDs', value: typeCount('managedidentit') },
        { label: 'Arc Machines', value: typeCount('hybridcompute/machines') },
      ].filter(s => s.value > 0),
      color: '#f59e0b',
      nav: 'security',
    },
  ]

  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ color: '#475569', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
        Azure Estate at a Glance
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {widgets.map(w => (
          <button key={w.title} onClick={() => onNavigate(w.nav)} style={{
            background: '#0f172a', border: `1px solid ${w.color}20`, borderRadius: 12,
            padding: '14px 16px', cursor: 'pointer', textAlign: 'left',
            borderTop: `3px solid ${w.color}`, transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#1e293b'; e.currentTarget.style.borderColor = `${w.color}60` }}
          onMouseLeave={e => { e.currentTarget.style.background = '#0f172a'; e.currentTarget.style.borderColor = `${w.color}20`; e.currentTarget.style.borderTop = `3px solid ${w.color}` }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <img src={w.icon} alt="" style={{ width: 22, height: 22 }} />
              <span style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 700 }}>{w.title}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {w.stats.slice(0, 4).map(s => (
                <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#64748b', fontSize: 10 }}>{s.label}</span>
                  <span style={{ color: typeof s.value === 'string' ? w.color : '#e2e8f0', fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.value}</span>
                </div>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Strategic Navigator ────────────────────────────────────────────────────────
function StrategicNav({ data, onNavigate }) {
  const cm      = data?.cloud_maturity
  const gaps    = data?.security_gaps   ?? []
  const igaps   = data?.innovation_gaps ?? []
  const mopps   = data?.modernization_opportunities ?? []
  const lopps   = data?.licensing_opportunities ?? []
  const bc      = data?.backup_coverage ?? null
  const acr     = data?.acr_opportunities ?? null

  const critSec   = gaps.filter(g => g.severity === 'critical').length
  const highSec   = gaps.filter(g => g.severity === 'high').length
  const highInn   = igaps.filter(g => g.business_impact === 'High').length
  const wave1     = mopps.filter(o => o.migration_wave === 1).length
  const adopted   = (data?.service_adoption_scores ?? []).filter(s => s.adopted).length
  const totalSave = lopps.reduce((s, o) => s + (o.estimated_monthly_saving ?? 0), 0)

  const secAccent = critSec > 0 ? '#ef4444' : highSec > 0 ? '#f97316' : '#22c55e'
  const matAccent = cm ? (cm.overall_score >= 65 ? '#22c55e' : cm.overall_score >= 40 ? '#eab308' : '#ef4444') : '#64748b'

  const cards = [
    {
      key: 'maturity',    Icon: Compass,
      title: 'Cloud Maturity',
      primary: cm?.overall_label ?? '—',
      secondary: cm ? `${cm.overall_score}/100 · Grade ${cm.overall_grade}` : 'Not yet assessed',
      accent: matAccent, cta: 'View journey →',
    },
    {
      key: 'security',    Icon: Shield,
      title: 'Security',
      primary: critSec > 0 ? `${critSec} Critical` : highSec > 0 ? `${highSec} High` : `${gaps.length} Gaps`,
      secondary: `${gaps.length} total · ${critSec} critical`,
      accent: secAccent, cta: 'View risks →',
    },
    {
      key: 'innovation',  Icon: Lightbulb,
      title: 'Innovation',
      primary: `${igaps.length} Gaps`,
      secondary: `${adopted} of 8 adopted · ${highInn} high-impact`,
      accent: '#3b82f6', cta: 'Explore gaps →',
    },
    {
      key: 'migration',   Icon: Rocket,
      title: 'Migration',
      primary: `${wave1} Quick Wins`,
      secondary: `${mopps.length} total opportunities`,
      accent: '#8b5cf6', cta: 'View roadmap →',
    },
    {
      key: 'licensing',   Icon: DollarSign,
      title: 'Licensing & Reservation',
      primary: `$${Math.round(totalSave).toLocaleString()}/mo`,
      secondary: `${lopps.length} opportunities · $${Math.round(totalSave * 12).toLocaleString()}/yr`,
      accent: '#22c55e', cta: 'Optimise now →',
    },
    {
      key: 'backup',      Icon: Shield,
      title: 'Backup',
      primary: bc ? `${Math.round(bc.coverage_pct)}%` : '—',
      secondary: bc ? `${bc.critical_gaps + bc.high_gaps} critical/high · ${bc.total_gaps} total gaps` : 'Not yet assessed',
      accent: bc && bc.critical_gaps > 0 ? '#ef4444' : bc && bc.high_gaps > 0 ? '#f97316' : '#22c55e',
      cta: 'Check coverage →',
    },
    {
      key: 'growth',      Icon: Cloud,
      title: 'Cloud Adoption',
      primary: acr ? `${acr.total_gaps} opportunities` : '—',
      secondary: acr ? `${acr.critical_count + acr.high_count} high priority · $${Math.round(acr.estimated_total_monthly_acr).toLocaleString()}/mo savings potential` : 'Not yet assessed',
      accent: acr && acr.critical_count > 0 ? '#ef4444' : acr && acr.high_count > 0 ? '#f97316' : '#3b82f6',
      cta: 'Explore adoption →',
    },
  ]

  return (
    <div className="space-y-2">
      <div style={{ color: '#475569', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Strategic Analysis — click any card to deep-dive
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {cards.map(c => (
          <button
            key={c.key}
            onClick={() => onNavigate(c.key)}
            className="text-left"
            style={{
              background: '#0f172a', border: `1px solid ${c.accent}25`,
              borderRadius: 12, padding: '14px 16px',
              cursor: 'pointer', transition: 'all 0.15s',
              borderLeft: `3px solid ${c.accent}`,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#1e293b'; e.currentTarget.style.borderColor = c.accent }}
            onMouseLeave={e => { e.currentTarget.style.background = '#0f172a'; e.currentTarget.style.borderColor = `${c.accent}25`; e.currentTarget.style.borderLeft = `3px solid ${c.accent}` }}
          >
            <div style={{ marginBottom: 4 }}>{React.createElement(c.Icon, { size: 20, style: { color: c.accent } })}</div>
            <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>{c.title}</div>
            <div style={{ color: '#f1f5f9', fontSize: 16, fontWeight: 700, marginBottom: 2 }}>{c.primary}</div>
            <div style={{ color: '#475569', fontSize: 10, marginBottom: 6 }}>{c.secondary}</div>
            <div style={{ color: c.accent, fontSize: 10, fontWeight: 600 }}>{c.cta}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Module View Toggle (Cards vs List) ─────────────────────────────────────────
function ModuleViewToggle({ listMode, onToggle, label }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">{label}</h2>
      <div className="flex items-center gap-1 bg-gray-900/60 border border-gray-800 rounded-lg p-0.5">
        <button
          onClick={() => onToggle(false)}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
            !listMode ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200',
          )}
        >
          <LayoutGrid size={12} /> Cards
        </button>
        <button
          onClick={() => onToggle(true)}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
            listMode ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200',
          )}
        >
          <List size={12} /> List
        </button>
      </div>
    </div>
  )
}

// ── Maturity Hero ──────────────────────────────────────────────────────────────
function MaturityHero({ cm }) {
  if (!cm) return null
  const STAGES = ['Traditional IT', 'Cloud Aware', 'Cloud Ready', 'Cloud Smart', 'Cloud Native']
  const COLORS  = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e']
  const STAGE_ICONS = [Hammer, CloudSun, Cloud, CloudSun, Cloud]
  const idx     = Math.max(0, STAGES.indexOf(cm.overall_label))
  const color   = COLORS[idx]
  const next    = STAGES[idx + 1]

  return (
    <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 16, padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Cloud Maturity Index</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ color: '#f1f5f9', fontSize: 48, fontWeight: 800, lineHeight: 1 }}>{cm.overall_score}</span>
            <span style={{ color: '#475569', fontSize: 20 }}>/100</span>
            <span style={{ background: `${color}15`, color, fontSize: 14, fontWeight: 700, padding: '4px 14px', borderRadius: 20, border: `1px solid ${color}40` }}>
              {cm.overall_label}
            </span>
          </div>
          {next && <div style={{ color: '#64748b', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>{React.createElement(Target, { size: 12, style: { color: '#64748b' } })} Next milestone: <span style={{ color: '#94a3b8', fontWeight: 600 }}>{next}</span> — improve your lowest-scoring pillars to advance</div>}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#475569', fontSize: 10, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Grade</div>
          <div style={{ width: 60, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 14, background: `${color}12`, border: `2px solid ${color}35`, fontSize: 26, fontWeight: 800, color }}>
            {cm.overall_grade}
          </div>
        </div>
      </div>

      {/* Transformation journey */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: '#475569', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Transformation Journey</div>
        <div style={{ display: 'flex', alignItems: 'center', overflowX: 'auto', paddingBottom: 4 }}>
          {STAGES.map((stage, i) => {
            const active = i === idx
            const past   = i < idx
            const sc     = COLORS[i]
            return (
              <React.Fragment key={stage}>
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                  padding: '10px 14px', borderRadius: 10, minWidth: 90, flexShrink: 0,
                  background: active ? `${sc}12` : 'transparent',
                  border: active ? `1px solid ${sc}35` : '1px solid transparent',
                }}>
                  <span style={{ fontSize: 20 }}>{React.createElement(STAGE_ICONS[i], { size: 20, style: { color: active ? sc : past ? '#475569' : '#334155' } })}</span>
                  <span style={{ fontSize: 10, fontWeight: active ? 700 : 500, color: active ? sc : past ? '#475569' : '#334155', textAlign: 'center', lineHeight: 1.3 }}>{stage}</span>
                  {active && <span style={{ fontSize: 8, fontWeight: 700, color: sc, textTransform: 'uppercase', letterSpacing: '0.3px' }}>YOU ARE HERE</span>}
                </div>
                {i < STAGES.length - 1 && (
                  <div style={{ flex: 1, height: 2, minWidth: 12, background: i < idx ? COLORS[i] : '#1e293b', flexShrink: 0 }} />
                )}
              </React.Fragment>
            )
          })}
        </div>
      </div>

      {/* Priority improvements */}
      {cm.dimensions?.length > 0 && (
        <div style={{ borderTop: '1px solid #1e293b', paddingTop: 16 }}>
          <div style={{ color: '#475569', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Priority Improvements</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[...cm.dimensions].sort((a, b) => a.score - b.score).slice(0, 3).map((d, i) => (
              <div key={d.key} style={{ background: '#1e293b', borderRadius: 8, padding: '8px 12px', border: '1px solid #334155' }}>
                <span style={{ color: '#64748b', fontSize: 12 }}>#{i + 1} </span>
                <span style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600 }}>{d.name}</span>
                <span style={{ color: '#64748b', fontSize: 11 }}> — {d.score}%</span>
                {d.gaps?.[0] && <div style={{ color: '#f97316', fontSize: 10, marginTop: 3, display: 'flex', alignItems: 'center', gap: 3 }}>{React.createElement(AlertTriangle, { size: 10 })} {d.gaps[0]}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Security Hero ──────────────────────────────────────────────────────────────
function SecurityHero({ gaps, waf }) {
  const bySev = { critical: 0, high: 0, medium: 0, low: 0 }
  gaps.forEach(g => { if (bySev[g.severity] !== undefined) bySev[g.severity]++ })
  const urgency = bySev.critical > 0 ? { label: 'Immediate Action Required', color: '#ef4444' }
                : bySev.high     > 0 ? { label: 'High Priority Issues Found', color: '#f97316' }
                : gaps.length    > 0 ? { label: 'Review Recommended', color: '#eab308' }
                :                      { label: 'No Gaps Detected', color: '#22c55e' }
  const topTypes = [...gaps.reduce((m, g) => { m.set(g.gap_type, (m.get(g.gap_type) || 0) + 1); return m }, new Map())]
    .sort((a, b) => b[1] - a[1]).slice(0, 3)

  return (
    <div style={{ background: '#0f172a', border: `1px solid ${urgency.color}25`, borderRadius: 16, padding: '24px', borderLeft: `4px solid ${urgency.color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Security & Governance — Defender for Cloud + Advisor + Arc</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ color: '#f1f5f9', fontSize: 42, fontWeight: 800, lineHeight: 1 }}>{gaps.length}</span>
            <span style={{ color: '#475569', fontSize: 18 }}>coverage gaps</span>
            <span style={{ background: `${urgency.color}15`, color: urgency.color, fontSize: 12, fontWeight: 700, padding: '3px 12px', borderRadius: 20, border: `1px solid ${urgency.color}35` }}>
              {urgency.label}
            </span>
          </div>
          <div style={{ color: '#475569', fontSize: 11 }}>
            Additional findings from Microsoft Defender for Cloud, Azure Advisor Security, and Azure Arc will load below
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          { sev: 'critical', label: 'Critical', color: '#ef4444', count: bySev.critical },
          { sev: 'high',     label: 'High',     color: '#f97316', count: bySev.high     },
          { sev: 'medium',   label: 'Medium',   color: '#eab308', count: bySev.medium   },
          { sev: 'low',      label: 'Low',      color: '#64748b', count: bySev.low      },
        ].map(s => (
          <div key={s.sev} style={{ background: `${s.color}10`, border: `1px solid ${s.color}25`, borderRadius: 10, padding: '10px 18px', textAlign: 'center', minWidth: 70 }}>
            <div style={{ color: s.color, fontSize: 24, fontWeight: 800 }}>{s.count}</div>
            <div style={{ color: '#64748b', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>{s.label}</div>
          </div>
        ))}
        {topTypes.length > 0 && (
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: '10px 14px', flex: 1, minWidth: 160 }}>
            <div style={{ color: '#64748b', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>Most Common Gap Types</div>
            {topTypes.map(([t, c]) => (
              <div key={t} style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>
                • {t.replace(/_/g, ' ')} <span style={{ color: '#475569' }}>({c})</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Innovation Hero ────────────────────────────────────────────────────────────
function InnovationHero({ gaps, scores }) {
  const high    = gaps.filter(g => g.business_impact === 'High').length
  const adopted = scores.filter(s => s.adopted).length
  const partial = scores.filter(s => s.partial && !s.adopted).length
  const total   = scores.length || 8

  return (
    <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 16, padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Innovation Gap Analysis</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ color: '#f1f5f9', fontSize: 48, fontWeight: 800, lineHeight: 1 }}>{gaps.length}</span>
            <span style={{ color: '#475569', fontSize: 20 }}>capability gaps</span>
          </div>
          <div style={{ color: '#64748b', fontSize: 12 }}>
            {adopted} of {total} Azure capability domains adopted
            {partial > 0 && ` · ${partial} partially`}
            {high > 0 && ` · ${high} high-impact gaps not yet addressed`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { label: 'Not Adopted', count: total - adopted - partial, color: '#ef4444' },
            { label: 'Partial',     count: partial,                    color: '#eab308' },
            { label: 'Adopted',     count: adopted,                    color: '#22c55e' },
          ].map(s => (
            <div key={s.label} style={{ background: `${s.color}10`, border: `1px solid ${s.color}25`, borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
              <div style={{ color: s.color, fontSize: 22, fontWeight: 800 }}>{s.count}</div>
              <div style={{ color: '#64748b', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', lineHeight: 1.4 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
      {high > 0 && (
        <div style={{ borderTop: '1px solid #1e293b', paddingTop: 14 }}>
          <div style={{ color: '#475569', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>High-Impact Opportunities</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {gaps.filter(g => g.business_impact === 'High').map(g => (
              <span key={g.category_key} style={{ background: '#4c1d9520', color: '#a78bfa', fontSize: 11, padding: '4px 10px', borderRadius: 20, border: '1px solid #7c3aed30', fontWeight: 600 }}>
                {g.icon} {g.category}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Migration Hero ─────────────────────────────────────────────────────────────
function MigrationHero({ opps }) {
  const w1 = opps.filter(o => o.migration_wave === 1)
  const w2 = opps.filter(o => o.migration_wave === 2)
  const w3 = opps.filter(o => o.migration_wave === 3)
  const totalDays   = opps.reduce((s, o) => s + (o.estimated_effort_days ?? 0), 0)
  const totalSaving = opps.reduce((s, o) => s + (o.estimated_monthly_saving_usd ?? 0), 0)

  return (
    <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 16, padding: '24px' }}>
      <div style={{ color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 16 }}>IaaS → PaaS Migration Roadmap</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        {[
          { label: 'Wave 1', sub: 'Quick Wins (≤ 2 wks)', count: w1.length, color: '#22c55e', desc: 'Start immediately' },
          { label: 'Wave 2', sub: 'Strategic (2–8 wks)',   count: w2.length, color: '#eab308', desc: 'Plan & execute'    },
          { label: 'Wave 3', sub: 'Transform (> 8 wks)',   count: w3.length, color: '#f97316', desc: 'Architect & build' },
        ].map(w => (
          <div key={w.label} style={{ flex: 1, minWidth: 110, background: `${w.color}08`, border: `1px solid ${w.color}25`, borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ color: w.color, fontSize: 13, fontWeight: 700 }}>{w.label}</span>
              <span style={{ color: '#f1f5f9', fontSize: 26, fontWeight: 800 }}>{w.count}</span>
            </div>
            <div style={{ color: '#64748b', fontSize: 10 }}>{w.sub}</div>
            <div style={{ color: w.color, fontSize: 10, fontWeight: 600, marginTop: 4 }}>{w.desc}</div>
          </div>
        ))}
        <div style={{ flex: 1, minWidth: 110, background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ color: '#475569', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Est. Effort</div>
          <div style={{ color: '#f1f5f9', fontSize: 24, fontWeight: 800 }}>{totalDays}d</div>
          {totalSaving > 0 && <div style={{ color: '#22c55e', fontSize: 11, fontWeight: 600, marginTop: 4 }}>${Math.round(totalSaving).toLocaleString()}/mo savings</div>}
        </div>
      </div>
      {w1.length > 0 && (
        <div style={{ borderTop: '1px solid #1e293b', paddingTop: 14 }}>
          <div style={{ color: '#475569', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Wave 1 — Ready Now</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {w1.slice(0, 6).map((o, i) => (
              <span key={i} style={{ background: '#05280f20', color: '#86efac', fontSize: 11, padding: '3px 10px', borderRadius: 20, border: '1px solid #16a34a30' }}>
                {o.resource_name ?? o.resource_type}
              </span>
            ))}
            {w1.length > 6 && <span style={{ color: '#475569', fontSize: 11, alignSelf: 'center' }}>+{w1.length - 6} more</span>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Licensing Hero ─────────────────────────────────────────────────────────────
function LicensingHero({ opps }) {
  const monthly  = opps.reduce((s, o) => s + (o.estimated_monthly_saving ?? 0), 0)
  const annual   = monthly * 12
  const year3    = monthly * 36
  const highConf = opps.filter(o => o.confidence === 'high').length
  const byType   = opps.reduce((m, o) => { m[o.opportunity_type] = (m[o.opportunity_type] || 0) + 1; return m }, {})

  const TYPE_META = {
    reserved_instance: { label: 'Reserved Instance', color: '#22c55e' },
    savings_plan:      { label: 'Savings Plan',       color: '#84cc16' },
    ahub_sql:          { label: 'AHUB SQL',            color: '#38bdf8' },
    ahub_windows:      { label: 'AHUB Windows',        color: '#60a5fa' },
    spot_eligible:     { label: 'Spot / Burstable',    color: '#a78bfa' },
    byol_vmware:       { label: 'BYOL VMware',         color: '#f59e0b' },
    byol_rhel:         { label: 'BYOL RHEL',           color: '#ef4444' },
    byol_sles:         { label: 'BYOL SUSE',           color: '#10b981' },
    byol_oracle:       { label: 'BYOL Oracle',         color: '#dc2626' },
  }

  return (
    <div style={{ background: '#0f172a', border: '1px solid #16a34a25', borderRadius: 16, padding: '24px', borderLeft: '4px solid #22c55e' }}>
      <div style={{ color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 16 }}>Licensing, Reservation & Commercial Optimization</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        {[
          { label: 'Monthly Potential', value: `$${Math.round(monthly).toLocaleString()}`,  sub: 'estimated saving',    color: '#22c55e' },
          { label: 'Annual Potential',  value: `$${Math.round(annual).toLocaleString()}`,   sub: '12-month projection', color: '#84cc16' },
          { label: '3-Year Potential',  value: `$${Math.round(year3).toLocaleString()}`,    sub: 'EA renewal view',     color: '#eab308' },
          { label: 'Opportunities',     value: String(opps.length),                         sub: `${highConf} high confidence`, color: '#3b82f6' },
        ].map(m => (
          <div key={m.label} style={{ flex: 1, minWidth: 110, background: `${m.color}08`, border: `1px solid ${m.color}20`, borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ color: '#64748b', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>{m.label}</div>
            <div style={{ color: m.color, fontSize: 22, fontWeight: 800 }}>{m.value}</div>
            <div style={{ color: '#475569', fontSize: 10, marginTop: 2 }}>{m.sub}</div>
          </div>
        ))}
      </div>
      {Object.keys(byType).length > 0 && (
        <div style={{ borderTop: '1px solid #1e293b', paddingTop: 14 }}>
          <div style={{ color: '#475569', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Opportunity Breakdown</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(byType).map(([type, count]) => {
              const meta = TYPE_META[type] || { label: type, color: '#64748b' }
              return (
                <span key={type} style={{ background: `${meta.color}12`, color: meta.color, fontSize: 11, padding: '4px 10px', borderRadius: 20, border: `1px solid ${meta.color}30`, fontWeight: 600 }}>
                  {meta.label}: {count}
                </span>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Hybrid & Arc View ────────────────────────────────────────────────────────

function HybridArcView() {
  const [tab, setTab] = React.useState('dashboard')
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-gray-800 pb-3">
        <div className="flex items-center gap-1">
          {[
            { key: 'dashboard',  label: 'Dashboard', Icon: BarChart2 },
            { key: 'resources',  label: 'Resources', Icon: Monitor },
            { key: 'sql',        label: 'SQL Servers', Icon: Database },
            { key: 'bcdr',       label: 'BCDR', Icon: HardDrive },
            { key: 'ai',         label: 'AI Analysis', Icon: Brain },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
                tab === t.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200',
              )}
            >
              <t.Icon size={13} />
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-600 bg-gray-800/60 px-2.5 py-1 rounded-full border border-gray-700/50">
          Azure Arc Enabled
        </span>
      </div>
      {tab === 'dashboard' && <ArcDashboard />}
      {tab === 'resources' && <ArcResourceExplorer />}
      {tab === 'sql'       && <ArcSQL />}
      {tab === 'bcdr'      && <ArcBCDR />}
      {tab === 'ai'        && <ArcAIAnalysis />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function AppInner() {
  const [data,          setData]          = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [refreshing,    setRefreshing]    = useState(false)
  const [error,         setError]         = useState(null)
  const [settingsOpen,          setSettingsOpen]          = useState(false)
  const [isDemoMode,            setIsDemoMode]            = useState(false)
  const [aiProvider,            setAiProvider]            = useState('none')
  const [aiBannerHidden,        setAiBannerHidden]        = useState(
    () => sessionStorage.getItem('ai-banner-dismissed') === '1'
  )
  const [selectedSubscription,  setSelectedSubscription]  = useState('')
  const [selectedResourceGroup, setSelectedResourceGroup] = useState('')
  const [selectedLocation,      setSelectedLocation]      = useState('')
  const [selectedResourceType,  setSelectedResourceType]  = useState('')
  const [selectedTagKey,        setSelectedTagKey]        = useState('')
  const [selectedTagValue,      setSelectedTagValue]      = useState('')

  // ── Project management state ──────────────────────────────────────────────
  const [projects,             setProjects]             = useState([])
  const [activeProjectId,      setActiveProjectId]      = useState(null)
  const [selectedResourceIds,  setSelectedResourceIds]  = useState(new Set())
  const [saveProjectModalOpen, setSaveProjectModalOpen] = useState(false)
  const [drillDownType,  setDrillDownType]  = useState(null)
  const [tableFilter,    setTableFilter]    = useState(null)
  const [appSettings,    setAppSettings]    = useState(null)
  const [launched,       setLaunched]       = useState(false)
  const [view,           setView]           = useState('overview')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [moduleListMode, setModuleListMode] = useState(false)  // toggle cards vs list view in module sections
  const [infraView,      setInfraView]      = useState('map')
  const [cacheStatus,    setCacheStatus]    = useState(null)   // {last_refreshed, next_refresh, is_refreshing}
  const [loadingFromCache, setLoadingFromCache] = useState(false)
  const launchedFromCache = useRef(false)

  // SSE progress state
  const [progressSteps, setProgressSteps] = useState([])
  const [progressPct,   setProgressPct]   = useState(0)
  const [progressMsg,   setProgressMsg]   = useState('')

  const sseCleanup = useRef(null)
  const loadWatchdog = useRef(null)

  const load = useCallback(async (forceRefresh = false, rgFilter = selectedResourceGroup) => {
    // Clean up any existing SSE connection
    if (sseCleanup.current) {
      sseCleanup.current()
      sseCleanup.current = null
    }

    setError(null)
    setProgressSteps([])
    setProgressPct(0)
    setProgressMsg('')

    if (forceRefresh) setRefreshing(true)
    else setLoading(true)

    // Watchdog: if the SSE stream stalls and never reports done/error (e.g. a slow
    // live build with no cached data, or the warehouse DB unreachable), clear the
    // spinner after 3 minutes so the UI never shows "Refreshing…" forever.
    if (loadWatchdog.current) clearTimeout(loadWatchdog.current)
    loadWatchdog.current = setTimeout(() => {
      setRefreshing(false)
      setLoading(false)
      loadWatchdog.current = null
    }, 180000)

    // Build query params
    const params = new URLSearchParams()
    if (forceRefresh) params.set('refresh', 'true')
    // Always send resource_group when the user has touched the dropdown —
    // empty string signals "All" (clears scope override); null/undefined means "not specified".
    if (rgFilter !== null && rgFilter !== undefined) params.set('resource_group', rgFilter)

    // Try SSE stream first
    const cleanup = api.streamDashboard(
      // onEvent — progress update
      (event) => {
        if (event.type === 'progress') {
          setProgressPct(event.pct ?? 0)
          setProgressMsg(event.message ?? '')
          if (event.step) {
            setProgressSteps(prev => prev.includes(event.step) ? prev : [...prev, event.step])
          }
        }
      },
      // onDone — full dashboard payload
      (dashboardData) => {
        setData(dashboardData)
        setIsDemoMode(dashboardData.demo_mode ?? false)
        setAiProvider(dashboardData.ai_provider ?? 'none')
        // Always sync scope back — including empty string when "All" was selected,
        // so the dropdown resets correctly instead of sticking on the previous RG.
        setSelectedResourceGroup(dashboardData.active_resource_group ?? '')
        if (dashboardData.active_subscription_id) setSelectedSubscription(dashboardData.active_subscription_id)
        setLoading(false)
        setRefreshing(false)
        setProgressPct(100)
        sseCleanup.current = null
        if (loadWatchdog.current) { clearTimeout(loadWatchdog.current); loadWatchdog.current = null }
      },
      // onError — fall back to regular endpoint
      async (err) => {
        console.warn('SSE failed, falling back to REST:', err.message)
        try {
          const result = await api.getDashboard(forceRefresh)
          setData(result)
          setIsDemoMode(result.demo_mode ?? false)
          setAiProvider(result.ai_provider ?? 'none')
        } catch (fetchErr) {
          setError(fetchErr.message)
        } finally {
          setLoading(false)
          setRefreshing(false)
          sseCleanup.current = null
          if (loadWatchdog.current) { clearTimeout(loadWatchdog.current); loadWatchdog.current = null }
        }
      },
      params,
    )

    sseCleanup.current = cleanup
  }, [])

  // Load settings once on startup.
  // - If cached data exists  → load it instantly, skip wizard entirely, no scan
  // - If credentials exist but no cache → auto-start scan immediately, skip wizard
  // - If no credentials at all → show wizard (first-time setup only)
  useEffect(() => {
    let _settingsCancelled = false
    let _settingsAttempt = 0
    const _loadSettings = () => {
      api.getSettings()
      .then(s => {
        if (_settingsCancelled) return
        setAppSettings(s)
        // `auth_ready` is true when the backend can reach Azure via a service principal
        // OR a managed identity (Container Apps / App Service / AKS). Using it here makes
        // managed-identity deployments auto-load the dashboard (or auto-scan) exactly like
        // a local service-principal run, instead of showing the manual "Ready to scan" wizard.
        const hasCredentials = s.auth_ready || (s.azure_tenant_id && (s.has_azure_secret || s.azure_client_id))
        const isDemo = s.demo_mode
        if (hasCredentials || isDemo) {
          setLoadingFromCache(true)
          api.getCachedDashboard()
            .then(cached => {
              if (cached) {
                // Has saved data — show dashboard instantly, no scan needed
                setData(cached)
                setIsDemoMode(cached.demo_mode ?? false)
                setAiProvider(cached.ai_provider ?? 'none')
                if (cached.active_subscription_id) setSelectedSubscription(cached.active_subscription_id)
                setSelectedResourceGroup(cached.active_resource_group ?? '')
                setLoading(false)
                launchedFromCache.current = true
                setLaunched(true)
                // Stale-while-revalidate: the snapshot paints instantly above.
                // If it's older than 30 min, kick off a live refresh in the
                // background — the dashboard stays fully interactive (data is
                // already on screen) and updates in place when the scan finishes.
                // Recent snapshots are left untouched so a transient cost-API
                // throttle can't clobber good figures with $0 on open.
                const asOfRaw = cached.data_as_of || cached.last_refreshed
                const ageMin = asOfRaw ? (Date.now() - new Date(asOfRaw).getTime()) / 60000 : Infinity
                if (ageMin > 30) {
                  setTimeout(() => load(true), 600)
                }
              } else {
                // Credentials configured but no saved data — auto-start scan, skip wizard
                setLaunched(true)
              }
            })
            .catch(() => {
              // Backend error — still auto-launch so scan runs
              setLaunched(true)
            })
            .finally(() => setLoadingFromCache(false))
        }
        // else: no credentials → wizard stays visible for first-time setup
      })
      .catch(() => {
        if (_settingsCancelled) return
        // Backend not reachable yet (transient overload / restart / token refresh).
        // Do NOT fall back to the manual service-principal setup wizard — that
        // "manual fetch" screen must never appear in a managed-identity deployment.
        // Keep the "Connecting…" state and retry with capped backoff; the wizard
        // only appears when /api/settings SUCCEEDS and reports no credentials.
        _settingsAttempt += 1
        setTimeout(_loadSettings, Math.min(1500 * _settingsAttempt, 8000))
      })
    }
    _loadSettings()
    return () => { _settingsCancelled = true }
  }, [])

  // Start scan only after user explicitly clicks Launch (not when loaded from cache)
  useEffect(() => {
    if (!launched) return
    if (launchedFromCache.current) {
      launchedFromCache.current = false  // reset so manual refresh still works
      return
    }
    load()
    return () => { if (sseCleanup.current) sseCleanup.current() }
  }, [launched, load])

  const handleSettingsSaved = useCallback(() => {
    setSettingsOpen(false)
    setTimeout(() => load(true), 300)
  }, [load])

  // All filter changes are purely client-side — no server re-fetch
  const handleResourceGroupChange = useCallback((rg) => {
    setSelectedResourceGroup(rg)
  }, [])

  const handleSubscriptionChange = useCallback((sub) => {
    setSelectedSubscription(sub)
    // Reset RG filter when switching subscription
    setSelectedResourceGroup('')
  }, [])

  // Poll /api/cache/status every 60s when dashboard is active
  React.useEffect(() => {
    if (!launched) return
    function pollCache() {
      api.getCacheStatus().then(s => setCacheStatus(s)).catch(() => {})
    }
    pollCache()
    const id = setInterval(pollCache, 60_000)
    return () => clearInterval(id)
  }, [launched])

  // Listen for cross-component 'navigate' events (e.g. from DependencyGraphView)
  React.useEffect(() => {
    const handler = (e) => { if (e.detail) setView(e.detail) }
    window.addEventListener('navigate', handler)
    return () => window.removeEventListener('navigate', handler)
  }, [])

  // When auto-refresh completes in background, reload data silently
  // IMPORTANT: Do NOT call load() here — it sets loading=true and shows the
  // full-screen ProgressOverlay, which interrupts the user's current view.
  // Instead, quietly fetch cached data in the background and merge it in.
  React.useEffect(() => {
    if (!cacheStatus || !launched) return
    if (!cacheStatus.is_refreshing && data) {
      const cacheTs = cacheStatus.last_refreshed ? new Date(cacheStatus.last_refreshed).getTime() : 0
      const dataTs  = data.last_refreshed ? new Date(data.last_refreshed).getTime() : 0
      if (cacheTs > dataTs + 5000) {
        // Cache is newer than what we're displaying — silently reload without UI disruption
        api.getCachedDashboard()
          .then(cached => {
            if (cached) {
              setData(cached)
              setIsDemoMode(cached.demo_mode ?? false)
              setAiProvider(cached.ai_provider ?? 'none')
            }
          })
          .catch(() => {})
      }
    }
  }, [cacheStatus])

  const handleTableFilter = useCallback((filter) => {
    setTableFilter(filter)
    setTimeout(() => {
      document.getElementById('resource-table-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }, [])

  const handleResourceDetailClick = useCallback((r) => {
    if (!r?.resource_name) return
    setView('dashboard')
    setTimeout(() => {
      setTableFilter({ field: 'resource_name', value: r.resource_name, label: r.resource_name })
      setTimeout(() => {
        document.getElementById('resource-table-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }, 50)
  }, [])

  const handleWasteQuadrantClick = useCallback((dot) => {
    // Filter table to that resource by name
    if (!dot?.name) return
    setTableFilter({ field: 'resource_name', value: dot.name, label: dot.name })
    setTimeout(() => {
      document.getElementById('resource-table-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }, [])

  // Client-side filtered resource list (applied on top of SSE/cached data)
  // Load projects from backend on mount
  useEffect(() => {
    api.getProjects().then(setProjects).catch(() => {})
  }, [])

  // Active project resource ID set (for fast lookup)
  const activeProjectResourceSet = useMemo(() => {
    if (!activeProjectId) return null
    const p = projects.find(proj => proj.id === activeProjectId)
    return p ? new Set(p.resource_ids) : null
  }, [activeProjectId, projects])

  const filteredResources = useMemo(() => {
    if (!data?.resources) return []
    let rs = data.resources
    // Project filter (highest priority — narrows to project resources)
    if (activeProjectResourceSet) {
      rs = rs.filter(r => activeProjectResourceSet.has((r.resource_id || r.id || '').toLowerCase()))
    }
    if (selectedSubscription) rs = rs.filter(r => r.subscription_id === selectedSubscription)
    if (selectedResourceGroup) rs = rs.filter(r => r.resource_group?.toLowerCase() === selectedResourceGroup.toLowerCase())
    if (selectedLocation)     rs = rs.filter(r => r.location === selectedLocation)
    if (selectedResourceType) rs = rs.filter(r => r.resource_type === selectedResourceType)
    if (selectedTagKey) {
      rs = rs.filter(r => {
        const v = (r.tags || {})[selectedTagKey]
        if (!v) return false
        if (selectedTagValue) return v === selectedTagValue
        return true
      })
    }
    return rs
  }, [data?.resources, activeProjectResourceSet, selectedSubscription, selectedResourceGroup, selectedLocation, selectedResourceType, selectedTagKey, selectedTagValue])

  const isFiltered = !!(activeProjectId || selectedSubscription || selectedResourceGroup || selectedLocation || selectedResourceType || selectedTagKey)

  // ── Derived aggregates from filtered resources (live-update panels) ──────────

  // Score distribution for ScoreDonut
  const filteredScoreDist = useMemo(() => {
    if (!isFiltered || !data?.score_distribution) return data?.score_distribution ?? []
    const COLORS = {
      'Not Used': '#ef4444', 'Rarely Used': '#f97316',
      'Actively Used': '#eab308', 'Fully Used': '#22c55e', 'Unknown': '#6b7280',
    }
    const counts = {}; const costs = {}
    for (const r of filteredResources) {
      const lbl = r.score_label ?? 'Unknown'
      counts[lbl] = (counts[lbl] ?? 0) + 1
      costs[lbl]  = (costs[lbl]  ?? 0) + (r.monthly_cost ?? r.cost_current_month ?? 0)
    }
    return Object.entries(counts).map(([label, count]) => ({
      label, count, total_cost: costs[label] ?? 0,
      color: COLORS[label] ?? '#6b7280',
    }))
  }, [filteredResources, isFiltered, data?.score_distribution])

  // Resource type summary for CostByTypeBar
  const filteredTypeSummary = useMemo(() => {
    if (!isFiltered || !data?.resource_type_summary) return data?.resource_type_summary ?? []
    const map = {}
    for (const r of filteredResources) {
      const t = r.resource_type ?? 'unknown'
      if (!map[t]) map[t] = { resource_type: t, display_name: t.split('/').pop(), count: 0, cost_current_month: 0, cost_previous_month: 0, avg_score: 0, _score_sum: 0, advisor_rec_count: 0 }
      map[t].count++
      map[t].cost_current_month  += r.cost_current_month  ?? 0
      map[t].cost_previous_month += r.cost_previous_month ?? 0
      map[t]._score_sum += r.final_score ?? 0
      map[t].advisor_rec_count += r.advisor_recommendations?.length ?? 0
    }
    return Object.values(map).map(e => ({ ...e, avg_score: e.count ? e._score_sum / e.count : 0 }))
      .sort((a, b) => b.cost_current_month - a.cost_current_month)
  }, [filteredResources, isFiltered, data?.resource_type_summary])

  // Orphans filtered by selected subscription/RG
  const filteredOrphans = useMemo(() => {
    if (!data?.orphans) return []
    if (!isFiltered) return data.orphans
    return data.orphans.filter(o => {
      if (selectedSubscription && o.subscription_id && o.subscription_id !== selectedSubscription) return false
      if (selectedResourceGroup && o.resource_group && o.resource_group.toLowerCase() !== selectedResourceGroup.toLowerCase()) return false
      return true
    })
  }, [data?.orphans, isFiltered, selectedSubscription, selectedResourceGroup])

  // Savings recommendations filtered
  const filteredSavingsRecs = useMemo(() => {
    if (!data?.savings_recommendations) return []
    if (!isFiltered) return data.savings_recommendations
    return data.savings_recommendations.filter(r => {
      if (selectedSubscription && r.subscription_id && r.subscription_id !== selectedSubscription) return false
      if (selectedResourceGroup && r.resource_group && r.resource_group.toLowerCase() !== selectedResourceGroup.toLowerCase()) return false
      return true
    })
  }, [data?.savings_recommendations, isFiltered, selectedSubscription, selectedResourceGroup])

  // Rightsize opportunities filtered
  const filteredRightsize = useMemo(() => {
    if (!data?.rightsize_opportunities) return []
    if (!isFiltered) return data.rightsize_opportunities
    return data.rightsize_opportunities.filter(r => {
      if (selectedSubscription && r.subscription_id && r.subscription_id !== selectedSubscription) return false
      if (selectedResourceGroup && r.resource_group && r.resource_group.toLowerCase() !== selectedResourceGroup.toLowerCase()) return false
      return true
    })
  }, [data?.rightsize_opportunities, isFiltered, selectedSubscription, selectedResourceGroup])

  // ── Subscription/filter-scoped data for the PDF export ───────────────────────
  // The "Export PDF" button must mirror EXACTLY what the home page shows: when a
  // single subscription (or any filter) is active, the report is scoped to that
  // view; with "All subscriptions" it exports the whole estate. The home page
  // already derives filtered arrays — here we also recompute the KPI / tag /
  // carbon figures from the filtered set so the report's headline numbers match
  // the on-screen, subscription-scoped dashboard (never all-subs numbers under a
  // single-sub heading).
  const pdfData = useMemo(() => {
    if (!data) return data
    if (!isFiltered) return data

    const rs        = filteredResources
    const curr      = rs.reduce((acc, r) => acc + (r.cost_current_month ?? 0), 0)
    const prev      = rs.reduce((acc, r) => acc + (r.cost_previous_month ?? 0), 0)
    const scorable  = rs.filter(r => r.score_label && r.score_label !== 'Unknown')
    const activeUse = scorable.filter(r => r.score_label === 'Actively Used' || r.score_label === 'Fully Used')
    const carbon    = rs.reduce((acc, r) => acc + (r.carbon_kg_per_month ?? 0), 0)
    const tagged    = rs.filter(r => !(r.missing_tags?.length))
    const advisor   = rs.reduce((acc, r) => acc + (r.advisor_recommendations?.length ?? 0), 0)

    const scopedKpi = {
      ...data.kpi,
      total_resources:           rs.length,
      total_cost_current_month:  curr,
      total_cost_previous_month: prev,
      mom_cost_delta:            curr - prev,
      mom_cost_delta_pct:        prev > 0 ? ((curr - prev) / prev) * 100 : 0,
      total_potential_savings:   filteredSavingsRecs.reduce((acc, r) => acc + (r.estimated_monthly_savings ?? 0), 0),
      orphan_count:              filteredOrphans.length,
      orphan_cost:               filteredOrphans.reduce((acc, r) => acc + (r.monthly_cost ?? 0), 0),
      health_score_pct:          scorable.length ? (activeUse.length / scorable.length) * 100 : 0,
      advisor_total_recs:        advisor,
    }

    const subId = selectedSubscription || ''
    const bySub = (arr) => (subId && Array.isArray(arr))
      ? arr.filter(x => !x.subscription_id || x.subscription_id === subId)
      : arr

    return {
      ...data,
      kpi:                         scopedKpi,
      resources:                   filteredResources,
      orphans:                     filteredOrphans,
      savings_recommendations:     filteredSavingsRecs,
      rightsize_opportunities:     filteredRightsize,
      score_distribution:          filteredScoreDist,
      resource_type_summary:       filteredTypeSummary,
      total_carbon_kg:             carbon,
      tag_compliance_pct:          rs.length ? (tagged.length / rs.length) * 100 : (data.tag_compliance_pct ?? 0),
      total_untagged:              rs.length - tagged.length,
      security_gaps:               bySub(data.security_gaps),
      modernization_opportunities: bySub(data.modernization_opportunities),
      licensing_opportunities:     bySub(data.licensing_opportunities),
      active_subscription_id:      subId,
      active_resource_group:       selectedResourceGroup || '',
    }
  }, [data, isFiltered, filteredResources, filteredOrphans, filteredSavingsRecs, filteredRightsize,
      filteredScoreDist, filteredTypeSummary, selectedSubscription, selectedResourceGroup])

  // Compute sidebar badge counts from dashboard data
  const sidebarBadges = useMemo(() => {
    if (!data) return {}
    const gaps = data.security_gaps ?? []
    const critSec = gaps.filter(g => g.severity === 'critical').length
    const highSec = gaps.filter(g => g.severity === 'high').length
    const bc = data.backup_coverage
    const bcdrCrit = (bc?.critical_gaps ?? 0) + (bc?.high_gaps ?? 0)
    const lopps = data.licensing_opportunities ?? []
    const orphans = data.orphans ?? []
    return {
      security: critSec + highSec,
      security_color: critSec > 0 ? '#ef4444' : '#f97316',
      backup: bcdrCrit,
      backup_color: bc?.critical_gaps > 0 ? '#ef4444' : '#f97316',
      licensing: lopps.length > 0 ? lopps.length : 0,
      licensing_color: '#22c55e',
      resources: orphans.length > 0 ? orphans.length : 0,
      resources_color: '#f97316',
    }
  }, [data])

  // Show connect page until user hits Start Scan
  if (!launched) {
    if (appSettings === null || loadingFromCache) return (
      <div className="fixed inset-0 bg-gray-950 flex flex-col items-center justify-center gap-4">
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          background: 'linear-gradient(135deg, #0078d4 0%, #00b7c3 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(0, 120, 212, 0.3)',
        }}>
          <Loader size={24} className="text-white animate-spin" />
        </div>
        <p className="text-xs text-gray-500 font-medium">Connecting to backend…</p>
      </div>
    )
    return (
      <SetupWizard
        settings={appSettings}
        onLaunch={(rg) => {
          if (rg) setSelectedResourceGroup(rg)
          setLaunched(true)
        }}
      />
    )
  }

  const isStreaming = (loading || refreshing) && progressPct < 100

  // Only take over the full screen on the very first load (no data yet).
  // Refreshes keep the dashboard visible with an inline progress indicator,
  // so the portal never blocks once it has live data on screen.
  if (isStreaming && !data) {
    return (
      <ProgressOverlay
        steps={progressSteps}
        currentPct={progressPct}
        currentMessage={progressMsg}
      />
    )
  }

  if (error && !data) return <ErrorView message={error} onRetry={() => load()} />

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#080c14' }}>
      <SidebarNav
        view={view}
        onNavigate={(v) => { setView(v); setModuleListMode(false) }}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(c => !c)}
        badges={sidebarBadges}
      />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={handleSettingsSaved} subscriptions={data?.subscriptions || []} onDisconnect={() => { setSettingsOpen(false); setLaunched(false) }} />

      <DrillDownDrawer
        type={drillDownType}
        resources={filteredResources}
        savingsRecs={filteredSavingsRecs}
        onClose={() => setDrillDownType(null)}
        onApplyTableFilter={(filter) => {
          handleTableFilter(filter)
        }}
      />

      {isDemoMode && (
        <DemoBanner onExitDemo={async () => {
          await api.saveSettings({ demo_mode: false })
          setIsDemoMode(false)
          setSettingsOpen(true)
        }} />
      )}
      {!isDemoMode && data?.scan_scope_active && (
        <ScopeBanner data={data} onOpenSettings={() => setSettingsOpen(true)} />
      )}
      {!isDemoMode && aiProvider === 'none' && !aiBannerHidden && (
        <AIDisabledBanner
          onOpenSettings={() => setSettingsOpen(true)}
          onDismiss={() => {
            setAiBannerHidden(true)
            sessionStorage.setItem('ai-banner-dismissed', '1')
          }}
        />
      )}

      <FilterBar
        subscriptions={data?.subscriptions ?? []}
        resourceGroups={data?.resource_groups ?? []}
        resources={data?.resources ?? []}
        selectedSubscription={selectedSubscription}
        selectedResourceGroup={selectedResourceGroup}
        selectedLocation={selectedLocation}
        selectedResourceType={selectedResourceType}
        selectedTagKey={selectedTagKey}
        selectedTagValue={selectedTagValue}
        onSubscriptionChange={handleSubscriptionChange}
        onResourceGroupChange={handleResourceGroupChange}
        onLocationChange={setSelectedLocation}
        onResourceTypeChange={setSelectedResourceType}
        onTagKeyChange={setSelectedTagKey}
        onTagValueChange={setSelectedTagValue}
        filteredCount={filteredResources.length}
        totalCount={data?.resources?.length ?? 0}
        onSaveProject={() => setSaveProjectModalOpen(true)}
        activeProjectName={projects.find(p => p.id === activeProjectId)?.name}
      />

      {/* Header — enterprise top bar aligned with sidebar (52px) */}
      <header style={{
        height: 52, minHeight: 52,
        position: 'sticky', top: 0, zIndex: 20,
        background: '#0c1220',
        borderBottom: '1px solid rgba(30, 41, 59, 0.6)',
        padding: '0 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        backdropFilter: 'blur(12px)',
        gap: 12,
      }}>
        <div className="flex items-center gap-3 shrink-0">
          <h1 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.01em', lineHeight: 1, margin: 0 }}>Azure Infra IQ</h1>
          <span style={{
            fontSize: 10, fontWeight: 600, color: '#0078d4',
            background: 'rgba(0, 120, 212, 0.12)',
            padding: '3px 8px', borderRadius: 6,
            border: '1px solid rgba(0, 120, 212, 0.2)',
            letterSpacing: '0.03em',
          }}>Enterprise</span>
          {isDemoMode && <span style={{
            fontSize: 10, fontWeight: 600, color: '#f59e0b',
            background: 'rgba(245, 158, 11, 0.1)',
            padding: '3px 8px', borderRadius: 6,
            border: '1px solid rgba(245, 158, 11, 0.2)',
          }}>Demo</span>}
          <ProjectSwitcher
            projects={projects}
            activeProjectId={activeProjectId}
            onSelectProject={setActiveProjectId}
            onCreateClick={() => setSaveProjectModalOpen(true)}
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {error && (
            <span style={{
              fontSize: 11, fontWeight: 500, color: '#f97316',
              background: 'rgba(249, 115, 22, 0.1)',
              padding: '4px 10px', borderRadius: 6,
              border: '1px solid rgba(249, 115, 22, 0.2)',
            }}>
              △ Cached
            </span>
          )}
          <ReadOnlyBadge />
          <AIStatusBadge provider={aiProvider} onOpenSettings={() => setSettingsOpen(true)} />
          <React.Suspense fallback={null}><ExportPDFButton data={pdfData} /></React.Suspense>
          <button
            onClick={() => setSettingsOpen(true)}
            style={{
              width: 32, height: 32,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 8, border: '1px solid rgba(30, 41, 59, 0.6)',
              background: 'rgba(30, 41, 59, 0.3)',
              color: '#64748b', cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(30, 41, 59, 0.6)'; e.currentTarget.style.color = '#94a3b8' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(30, 41, 59, 0.3)'; e.currentTarget.style.color = '#64748b' }}
            title="Settings"
          >
            <Settings size={15} />
          </button>
          {data?.last_refreshed && !refreshing && (
            <span className="hidden sm:flex items-center gap-1.5" style={{ fontSize: 11, color: '#64748b' }} title={new Date(data.last_refreshed).toLocaleString()}>
              <Clock size={12} className={clsx(
                cacheStatus?.is_refreshing ? 'text-blue-400 animate-pulse' : ''
              )} style={{ color: cacheStatus?.is_refreshing ? '#3b82f6' : '#475569' }} />
              {cacheStatus?.is_refreshing
                ? <span style={{ color: '#3b82f6' }}>Refreshing…</span>
                : new Date(data.last_refreshed).toLocaleTimeString()
              }
            </span>
          )}
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 8, border: 'none',
              fontSize: 12, fontWeight: 600,
              background: '#0078d4', color: '#ffffff',
              cursor: refreshing ? 'not-allowed' : 'pointer',
              opacity: refreshing ? 0.6 : 1,
              transition: 'all 0.15s',
              boxShadow: '0 1px 4px rgba(0, 120, 212, 0.25)',
            }}
            onMouseEnter={e => { if (!refreshing) e.currentTarget.style.background = '#2b88d8' }}
            onMouseLeave={e => { if (!refreshing) e.currentTarget.style.background = '#0078d4' }}
          >
            <RefreshCw size={13} className={clsx(refreshing && 'animate-spin')} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          {/* Signed-in user — profile photo + name/email + Logout (renders nothing in open/local mode) */}
          <div style={{ width: 1, height: 22, background: 'rgba(30, 41, 59, 0.8)', margin: '0 2px' }} />
          <HeaderAccount />
        </div>
      </header>

      {/* Main content */}
      <main style={{ padding: '24px 28px', flex: 1, overflowX: 'hidden' }} className="space-y-6">
      <ViewErrorBoundary resetKey={view} onReset={() => { setView('overview'); setModuleListMode(false) }}>

        {/* Health Score Widget — shown on maturity/overview */}
        {view === 'maturity' && data && <HealthScoreWidget />}

        {/* ── Maturity view ── */}
        {view === 'maturity' && (
          <MaturityView data={data} filteredResources={filteredResources} moduleListMode={moduleListMode} setModuleListMode={setModuleListMode} tableFilter={tableFilter} setTableFilter={setTableFilter} projects={projects} setProjects={setProjects} setSelectedResourceIds={setSelectedResourceIds} setSaveProjectModalOpen={setSaveProjectModalOpen} />
        )}

        {/* ── Security view ── */}
        {view === 'security' && (<>
          <SecurityView data={data} filteredResources={filteredResources} moduleListMode={moduleListMode} setModuleListMode={setModuleListMode} tableFilter={tableFilter} setTableFilter={setTableFilter} projects={projects} setProjects={setProjects} setSelectedResourceIds={setSelectedResourceIds} setSaveProjectModalOpen={setSaveProjectModalOpen} />
          <CrossModuleLinks onNavigate={setView} links={[
            { key: 'backup', label: 'Review Backup Coverage', color: '#22c55e', icon: '/icons/storage/00017-icon-service-Recovery-Services-Vaults.svg' },
            { key: 'bcdr', label: 'BCDR Assessment', color: '#3b82f6', icon: '/icons/migrate/10351-icon-service-Azure-Migrate.svg' },
            { key: 'zuremap', label: 'Architecture Map', color: '#8b5cf6', icon: '/icons/general/10021-icon-service-Resource-Explorer.svg' },
          ]} />
        </>)}

        {/* ── Innovation view ── */}
        {view === 'innovation' && (
          <InnovationView data={data} filteredResources={filteredResources} moduleListMode={moduleListMode} setModuleListMode={setModuleListMode} tableFilter={tableFilter} setTableFilter={setTableFilter} projects={projects} setProjects={setProjects} setSelectedResourceIds={setSelectedResourceIds} setSaveProjectModalOpen={setSaveProjectModalOpen} />
        )}

        {/* ── Migration view ── */}
        {view === 'migration' && (
          <MigrationView data={data} filteredResources={filteredResources} moduleListMode={moduleListMode} setModuleListMode={setModuleListMode} tableFilter={tableFilter} setTableFilter={setTableFilter} projects={projects} setProjects={setProjects} setSelectedResourceIds={setSelectedResourceIds} setSaveProjectModalOpen={setSaveProjectModalOpen} />
        )}

        {/* ── Licensing view ── */}
        {view === 'licensing' && (<>
          <LicensingViewEnhanced data={data} filteredResources={filteredResources} moduleListMode={moduleListMode} setModuleListMode={setModuleListMode} tableFilter={tableFilter} setTableFilter={setTableFilter} projects={projects} setProjects={setProjects} setSelectedResourceIds={setSelectedResourceIds} setSaveProjectModalOpen={setSaveProjectModalOpen} />
          <CrossModuleLinks onNavigate={setView} links={[
            { key: 'finops', label: 'FinOps Dashboard', color: '#eab308', icon: '/icons/general/10003-icon-service-Reservations.svg' },
            { key: 'overview', label: 'Cost Overview', color: '#3b82f6', icon: '/icons/general/10015-icon-service-Dashboard.svg' },
          ]} />
        </>)}

        {/* ── Backup Resilience view ── */}
        {view === 'backup' && (<>
          <BackupView data={data} filteredResources={filteredResources} moduleListMode={moduleListMode} setModuleListMode={setModuleListMode} tableFilter={tableFilter} setTableFilter={setTableFilter} projects={projects} setProjects={setProjects} setSelectedResourceIds={setSelectedResourceIds} setSaveProjectModalOpen={setSaveProjectModalOpen} />
          <CrossModuleLinks onNavigate={setView} links={[
            { key: 'bcdr', label: 'BCDR Assessment', color: '#3b82f6', icon: '/icons/migrate/10351-icon-service-Azure-Migrate.svg' },
            { key: 'security', label: 'Security Posture', color: '#ef4444', icon: '/icons/security/10241-icon-service-Microsoft-Defender-for-Cloud.svg' },
            { key: 'zuremap', label: 'Architecture Map', color: '#8b5cf6', icon: '/icons/general/10021-icon-service-Resource-Explorer.svg' },
          ]} />
        </>)}

        {/* ── ACR Growth Opportunities view ── */}
        {view === 'growth' && (
          <div className="space-y-6">
            <ModuleViewToggle label="Cloud Adoption & Modernization" listMode={moduleListMode} onToggle={setModuleListMode} />
            {moduleListMode ? (
              <ResourceTable resources={filteredResources} externalFilter={tableFilter} onClearExternalFilter={() => setTableFilter(null)} aiEnabled={data?.ai_enabled ?? false} projects={projects} onSaveSelectedAsProject={({ mode, ids, projectId }) => { setSelectedResourceIds(new Set(ids)); if (mode === 'new') setSaveProjectModalOpen(true); else api.addProjectResources(projectId, ids).then(() => api.getProjects().then(setProjects)) }} />
            ) : (
              <CloudAdoptionPanel acrOpportunities={data?.acr_opportunities} />
            )}
          </div>
        )}

        {/* ── Projects & Workloads view (APEX-Enabled) ── */}
        {view === 'projects' && (
          <ProjectsModule
            resources={data?.resources ?? []}
          />
        )}

        {/* ── Assessments view (Workload Assessment as a Service) ── */}
        {view === 'assessments' && (
          <AssessmentModule />
        )}

        {/* ── Tag Management ── */}
        {view === 'tags' && (
          <TagManagementModule />
        )}

        {/* ── FinOps Module ── */}
        {view === 'finops-overview' && <FinOpsOverview />}
        {view === 'finops' && <FinOpsDashboard />}
        {view === 'cost-explorer' && <CostExplorer />}
        {view === 'finops-budgets' && <BudgetManager />}
        {view === 'finops-forecast' && <ForecastPanel />}
        {view === 'finops-alloc' && <AllocationView />}
        {view === 'finops-chargeback' && <ChargebackPanel />}
        {view === 'finops-commit' && <CommitmentTracker />}
        {view === 'finops-savings' && <SavingsSummary />}
        {view === 'finops-tags' && <TagAnalytics />}
        {view === 'finops-alerts' && <FinOpsAlerts />}
        {view === 'finops-warehouse' && <FinOpsWarehouse />}
        {view === 'finops-compliance' && <FinOpsComplianceView />}

        {/* ── About / Features / FAQs ── */}
        {view === 'about' && <About tab="about" />}
        {view === 'about-features' && <About tab="features" />}
        {view === 'about-faqs' && <About tab="faqs" />}

        {/* ── BCDR Assessment ── */}
        {view === 'bcdr' && (<>
          <BCDRView />
          <CrossModuleLinks onNavigate={setView} links={[
            { key: 'backup', label: 'Backup Coverage', color: '#22c55e', icon: '/icons/storage/00017-icon-service-Recovery-Services-Vaults.svg' },
            { key: 'security', label: 'Security Posture', color: '#ef4444', icon: '/icons/security/10241-icon-service-Microsoft-Defender-for-Cloud.svg' },
            { key: 'zuremap', label: 'Architecture Map', color: '#8b5cf6', icon: '/icons/general/10021-icon-service-Resource-Explorer.svg' },
          ]} />
        </>)}

        {/* ── Infrastructure Intelligence (AI + Tags + Dependency) ── */}
        {view === 'infra' && (
          <InfrastructureView resources={data?.resources ?? []} onOpenSettings={() => setSettingsOpen(true)} />
        )}

        {/* ── Hybrid & Arc ── */}
        {view === 'onpremise' && (
          <HybridArcView />
        )}

        {/* ── On-Premises Data Collection ── */}
        {view === 'onprem_collection' && (
          <OnPremCollectionView />
        )}

        {view === 'software-governance' && <SoftwareGovernancePanel />}

        {/* ── Architecture Map (ZureMap) ── */}
        {view === 'architecture-map' && (
          <React.Suspense fallback={<div className="card p-12 text-center text-gray-400">Loading Architecture Map...</div>}>
            <ArchitectureMapView />
          </React.Suspense>
        )}

        {/* ── Monitoring ── */}
        {view === 'monitoring' && (
          <MonitoringView />
        )}

        {/* ── Governance / Advisor / Service Health / Quota ── */}
        {view === 'governance' && (<GovernanceView />)}
        {view === 'advisor' && (<AdvisorView />)}
        {view === 'service-health' && (<ServiceHealthView />)}
        {view === 'quota' && (<QuotaView />)}

        {/* ── AI Assessments (revenue-generating deep AI) ── */}
        {view === 'waf' && (
          <AssessmentView title="Well-Architected (WAF) Assessment" Icon={Target}
            subtitle="Deep AI assessment across all five WAF pillars — with impacted workloads you can drill into & export"
            aiEndpoint="/api/ai/waf" aiTitle="Well-Architected Framework AI Assessment" />
        )}
        {view === 'caf' && (
          <AssessmentView title="Cloud Adoption Framework (CAF) Assessment" Icon={Compass}
            subtitle="AI maturity assessment across CAF methodologies with prioritized next steps"
            aiEndpoint="/api/ai/caf" aiTitle="Cloud Adoption Framework AI Assessment" />
        )}
        {view === 'vm-performance' && (
          <AssessmentView title="VM Performance & Right-Sizing" Icon={Monitor}
            subtitle="Azure Monitor-based VM utilisation, idle/over-used detection and SKU recommendations"
            aiEndpoint="/api/ai/vm-performance" aiTitle="VM Performance AI Assessment" />
        )}
        {view === 'sql-modernization' && (
          <AssessmentView title="SQL Modernization" Icon={Database}
            subtitle="On-prem / Arc / IaaS SQL → Azure SQL Database or Managed Instance — grow Azure consumption"
            aiEndpoint="/api/ai/sql-modernization" aiTitle="SQL Modernization AI Assessment"
            dataConfig={{
              endpoint: '/api/assess/sql',
              kpis: (d) => [
                { label: 'SQL Resources', value: d.total_sql_resources ?? 0, color: '#38bdf8', Icon: Database },
                { label: 'IaaS SQL VMs', value: d.iaas_sql_vms ?? 0, color: '#f97316' },
                { label: 'Arc SQL', value: d.arc_sql_instances ?? 0, color: '#a855f7' },
                { label: 'Azure SQL DBs', value: d.azure_sql_databases ?? 0, color: '#22c55e' },
                { label: 'Managed Instances', value: d.managed_instances ?? 0, color: '#22c55e' },
                { label: 'On-prem SQL', value: d.onprem_sql_count ?? 0, color: '#eab308' },
                { label: 'SQL VM Candidates', value: d.sql_vm_candidate_count ?? 0, color: '#06b6d4' },
              ],
              items: (d) => [...(d.items || []), ...(d.sql_vm_candidates || []), ...(d.onprem_sql || [])],
              columns: [
                { key: 'resource_name', label: 'Name' },
                { key: 'kind', label: 'Kind' },
                { key: 'resource_type', label: 'Type', render: (v) => (v || '').split('/').pop() || '—' },
                { key: 'sku', label: 'SKU/Tier', render: (v) => v || '—' },
                { key: 'location', label: 'Location', render: (v) => v || '—' },
                { key: 'resource_group', label: 'Resource Group', render: (v) => v || '—' },
              ],
              subField: 'subscription_id', rgField: 'resource_group',
              searchFields: ['resource_name', 'kind', 'resource_type'],
              csvName: 'sql-estate.csv', gridTitle: 'SQL Estate',
            }} />
        )}
        {view === 'appservice' && (
          <AssessmentView title="App Service Modernization" Icon={Globe}
            subtitle="Right-size plans, modernize tiers, adopt Flex Consumption & containers, harden security"
            aiEndpoint="/api/ai/appservice" aiTitle="App Service AI Assessment"
            dataConfig={{
              endpoint: '/api/assess/appservice',
              kpis: (d) => [
                { label: 'App Service Plans', value: d.total_plans ?? 0, color: '#38bdf8', Icon: Globe },
                { label: 'Sites', value: d.total_sites ?? 0, color: '#22c55e' },
                { label: 'Web Apps', value: d.web_apps ?? 0 },
                { label: 'Function Apps', value: d.function_apps ?? 0, color: '#a855f7' },
                { label: 'Containers', value: d.container_apps ?? 0, color: '#06b6d4' },
                { label: 'Free/Basic Plans', value: d.free_basic_plans ?? 0, color: '#eab308' },
              ],
              items: (d) => [...(d.plans || []), ...(d.items || [])],
              columns: [
                { key: 'resource_name', label: 'Name' },
                { key: 'resource_type', label: 'Type', render: (v) => (v || '').split('/').pop() || '—' },
                { key: 'tier', label: 'Tier', render: (v) => v || '—' },
                { key: 'state', label: 'State', render: (v) => v || '—' },
                { key: 'location', label: 'Location', render: (v) => v || '—' },
                { key: 'resource_group', label: 'Resource Group', render: (v) => v || '—' },
              ],
              subField: 'subscription_id', rgField: 'resource_group',
              searchFields: ['resource_name', 'tier', 'kind'],
              csvName: 'appservice-estate.csv', gridTitle: 'App Service Estate',
            }} />
        )}
        {view === 'entra' && (
          <IdentityView />
        )}

        {/* ── Update Management ── */}
        {view === 'updates' && (
          <UpdateManagementView />
        )}

        {/* ── Networking ── */}
        {view === 'networking' && (
          <NetworkingView />
        )}

        {/* ── Resilience & SLA view ── */}
        {view === 'resilience' && (
          <ResilienceView data={data} filteredResources={filteredResources} moduleListMode={moduleListMode} setModuleListMode={setModuleListMode} tableFilter={tableFilter} setTableFilter={setTableFilter} projects={projects} setProjects={setProjects} setSelectedResourceIds={setSelectedResourceIds} setSaveProjectModalOpen={setSaveProjectModalOpen} />
        )}

        {/* ── Resources hub ── */}
        {view === 'resources' && (
          <div className="space-y-4">
            <div className="flex gap-1 bg-gray-900/60 border border-gray-800 rounded-lg p-1 w-fit">
              {[
                { key: 'bcdr-planning', label: 'BCDR Planning', Icon: ClipboardList },
                { key: 'map',        label: 'Map', Icon: MapIcon },
                { key: 'appservice', label: 'App Services', Icon: Settings },
                { key: 'storage',    label: 'Storage', Icon: HardDrive },
                { key: 'ai',         label: 'AI Costs', Icon: Bot },
              ].map(t => (
                <button key={t.key} onClick={() => setInfraView(t.key)}
                  className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                    infraView === t.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200')}
                >
                  <t.Icon size={13} />
                  {t.label}
                </button>
              ))}
            </div>
            {infraView === 'bcdr-planning' && <BCDRPlanningPanel resources={filteredResources} />}
            {infraView === 'map'        && <ResourceMap resources={filteredResources} onNavigate={setView} />}
            {infraView === 'appservice' && <AppServicePanel resources={filteredResources} onResourceClick={handleResourceDetailClick} />}
            {infraView === 'storage'    && <StoragePanel resources={filteredResources} onResourceClick={handleResourceDetailClick} />}
            {infraView === 'ai'         && <AIResourcesPanel resources={filteredResources} onResourceClick={handleResourceDetailClick} />}
          </div>
        )}

        {/* ── Overview (operational dashboard) ── */}
        {/* ── Save Project Modal ── */}
        {saveProjectModalOpen && (
          <SaveProjectModal
            resourceCount={selectedResourceIds.size > 0 ? selectedResourceIds.size : filteredResources.length}
            existingProjects={projects}
            onCancel={() => setSaveProjectModalOpen(false)}
            onSave={async ({ mode, name, description, color, icon, addToId }) => {
              const ids = selectedResourceIds.size > 0
                ? Array.from(selectedResourceIds)
                : filteredResources.map(r => r.resource_id || r.id || '')
              if (mode === 'new') {
                const created = await api.createProject({ name, resource_ids: ids, description, color, icon })
                setProjects(prev => [created, ...prev])
                setActiveProjectId(created.id)
              } else {
                await api.addProjectResources(addToId, ids)
                const updated = await api.getProjects()
                setProjects(updated)
              }
              setSelectedResourceIds(new Set())
              setSaveProjectModalOpen(false)
            }}
          />
        )}

        {view === 'overview' && <>

        {/* Strategic Navigator — links to all value tabs */}
        <StrategicNav data={data} onNavigate={setView} />

        {/* AI Insights — estate-wide AI intelligence dashboard (per-category) */}
        <AIInsightsDashboard onNavigate={setView} />

        {/* Top Recommendations — aggregated action items */}
        <TopRecommendations data={data} resources={filteredResources} onNavigate={setView} />

        {/* Azure Estate at a Glance */}
        <EstateOverview resources={filteredResources} backupCoverage={data?.backup_coverage} onNavigate={setView} />

        {/* Waste summary banner */}
        <WasteSummaryBanner data={data} resources={filteredResources} />

        {/* AI Insight Panel */}
        <AIInsightPanel
          narrative={data?.ai_narrative}
          provider={aiProvider}
          aiEnabled={data?.ai_enabled}
        />

        {/* KPI Row */}
        <KPICards
          kpi={data?.kpi}
          aiEnabled={data?.ai_enabled}
          totalCarbon={data?.total_carbon_kg}
          tagCompliancePct={data?.tag_compliance_pct}
          resources={filteredResources}
          savingsRecs={filteredSavingsRecs}
          onDrillDown={(type) => {
            if (type === 'reservations') { setView('licensing'); return }
            setDrillDownType(type)
          }}
        />

        {/* Industry Benchmark Panel */}
        <BenchmarkPanel
          kpi={data?.kpi}
          resources={filteredResources}
          resourceTypeSummary={data?.resource_type_summary ?? []}
          tagCompliancePct={data?.tag_compliance_pct ?? null}
        />

        {/* Spend Trend + Top Movers */}
        <SpendTrend
          resources={filteredResources}
          totalDailyCm={data?.total_daily_cm ?? []}
          totalDailyPm={data?.total_daily_pm ?? []}
        />

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ScoreDonut
            data={filteredScoreDist}
            onSegmentClick={(label) => handleTableFilter({ field: 'score_label', value: label, label: `Score: ${label}` })}
          />
          <CostByTypeBar
            data={filteredTypeSummary}
            onBarClick={(filter) => filter ? handleTableFilter(filter) : setTableFilter(null)}
          />
          <WasteByCategory
            resources={filteredResources}
            onBarClick={(filter) => filter ? handleTableFilter(filter) : setTableFilter(null)}
          />
        </div>

        {/* Waste Quadrant + Savings Waterfall */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <WasteQuadrant resources={filteredResources} onResourceClick={handleWasteQuadrantClick} />
          <SavingsWaterfall
            recommendations={data?.savings_recommendations ?? []}
            resources={filteredResources}
          />
        </div>

        {/* Orphan + Savings Row */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <OrphanPanel orphans={filteredOrphans} />
          <SavingsPanel recommendations={filteredSavingsRecs} />
        </div>

        {/* Right-Sizing Row */}
        {filteredRightsize?.length > 0 && (
          <RightSizePanel opportunities={filteredRightsize} />
        )}

        {/* Waste by RG + Tag Compliance Row */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <WasteByRG
            resources={filteredResources}
            onBarClick={(filter) => filter ? handleTableFilter(filter) : setTableFilter(null)}
          />
          <TagCompliance
            resources={filteredResources}
            tagCompliancePct={data?.tag_compliance_pct ?? 100}
            totalUntagged={data?.total_untagged ?? 0}
          />
        </div>

        {/* Full Resource Table */}
        <ResourceTable
          resources={filteredResources}
          externalFilter={tableFilter}
          onClearExternalFilter={() => setTableFilter(null)}
          aiEnabled={data?.ai_enabled ?? false}
          projects={projects}
          onSaveSelectedAsProject={({ mode, ids, projectId }) => {
            setSelectedResourceIds(new Set(ids))
            if (mode === 'new') {
              setSaveProjectModalOpen(true)
            } else {
              api.addProjectResources(projectId, ids).then(() =>
                api.getProjects().then(setProjects)
              )
            }
          }}
        />

        </> /* end overview view */}

      </ViewErrorBoundary>
      </main>

      <footer className="border-t border-gray-800/60 mt-6 px-6 py-4">
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>Azure Infra IQ · Enterprise Edition</span>
          <span>Utilization: Fully Used ≥76 · Active 51–75 · Underused 26–50 · Idle ≤25 · No Data = unmonitored</span>
          <span className="text-gray-700">v2.0 · Powered by Azure Resource Graph & AI</span>
        </div>
      </footer>
    </div>
    </div>
  )
}

// ── BCDR View (dashboard + table sub-tabs) ─────────────────────────────────

function InfrastructureView({ resources, onOpenSettings }) {
  const [tab, setTab] = React.useState('dashboard')
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b border-gray-800 pb-3">
        {[
          { key: 'dashboard',  label: 'Dashboard', Icon: BarChart2 },
          { key: 'ai',         label: 'AI Intelligence', Icon: Brain },
          { key: 'dependency', label: 'Dependency Graph', Icon: Network },
          { key: 'tags',       label: 'Tag Management', Icon: Tag },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
              tab === t.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200',
            )}
          >
            <t.Icon size={13} />
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'dashboard'  && <InfrastructureDashboard resources={resources} onOpenSettings={onOpenSettings} />}
      {tab === 'ai'         && <InfraAIPanel resources={resources} onOpenSettings={onOpenSettings} />}
      {tab === 'dependency' && <DependencyGraphView />}
      {tab === 'tags'       && <TagManager />}
    </div>
  )
}

function AIBCDRPanel() {
  const [data,     setData]     = React.useState(null)
  const [loading,  setLoading]  = React.useState(false)
  const [error,    setError]    = React.useState(null)
  const [progress, setProgress] = React.useState({ stage: 0, message: '' })
  const [resourceModalData, setResourceModalData] = React.useState({ isOpen: false, title: '', description: '', resources: [], context: {} })

  const stages = [
    'Analyzing environment...',
    'Evaluating backup coverage...',
    'Assessing regional distribution...',
    'Checking zone redundancy...',
    'Identifying critical gaps...',
    'Generating recommendations...',
    'Building implementation roadmap...',
    'Finalizing report...'
  ]

  const run = (refresh = false) => {
    setLoading(true)
    setError(null)
    setProgress({ stage: 0, message: stages[0] })
    
    // Simulate stage progression while AI works
    let stageIndex = 0
    const interval = setInterval(() => {
      stageIndex = (stageIndex + 1) % stages.length
      setProgress({ stage: stageIndex, message: stages[stageIndex] })
    }, 3000) // Update every 3 seconds

    api.getAIBCDR(refresh)
      .then(d => { 
        clearInterval(interval)
        setProgress({ stage: stages.length - 1, message: 'Analysis complete!' })
        setData(d); 
        setTimeout(() => setLoading(false), 500)
      })
      .catch(e => { 
        clearInterval(interval)
        setError(e.message); 
        setLoading(false);
      })
  }

  if (!data && !loading && !error) {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <div className="p-4 rounded-full bg-blue-900/20">
          <span className="text-3xl">{React.createElement(Brain, { size: 28, style: { color: '#a78bfa' } })}</span>
        </div>
        <p className="text-sm text-gray-400 text-center max-w-sm">
          Claude AI will analyze all resources against Qatar Central BCDR constraints and generate a
          prioritized action plan with RTO/RPO recommendations.
        </p>
        <button
          onClick={() => run(false)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg font-medium transition-colors"
        >
          Run AI BCDR Analysis
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {data?.ai_generated ? 'AI-generated' : ''} {data?.total ?? 0} items
        </p>
        <div className="flex gap-2">
          <button onClick={() => run(false)} disabled={loading} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? '…' : '↻'} {loading ? 'Analysing…' : 'Refresh'}
          </button>
          <button onClick={() => run(true)} disabled={loading} className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed">
            ↻ Force re-run
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-700/50 bg-red-950/20 p-4 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-red-400 font-medium">BCDR Analysis Failed</p>
              <p className="text-xs text-red-400/80 mt-1">{error}</p>
            </div>
          </div>
          <button
            onClick={() => run(false)}
            className="text-xs text-red-300 hover:text-red-200 flex items-center gap-1"
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}
      
      {loading && (
        <div className="flex flex-col items-center gap-6 py-12">
          <div className="relative">
            <RefreshCw size={40} className="text-blue-400 animate-spin" />
          </div>
          <div className="text-center space-y-3 max-w-md">
            <p className="text-base font-semibold text-gray-200">AI Comprehensive BCDR Analysis</p>
            <p className="text-sm text-blue-400">{progress.message}</p>
            <p className="text-xs text-gray-500">Analyzing 363 resources across your Azure environment</p>
            
            {/* Progress bar */}
            <div className="w-full bg-gray-800/50 rounded-full h-1.5 mt-4">
              <div 
                className="bg-gradient-to-r from-blue-600 to-blue-400 h-1.5 rounded-full transition-all duration-1000 ease-out"
                style={{ width: `${((progress.stage + 1) / stages.length) * 100}%` }}
              />
            </div>
            
            {/* Stage indicators */}
            <div className="grid grid-cols-4 gap-2 mt-4 text-xs">
              {['Environment', 'Coverage', 'Regions', 'Redundancy', 'Gaps', 'Recommendations', 'Roadmap', 'Report'].map((label, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className={clsx(
                    'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-all',
                    progress.stage >= i ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-600'
                  )}>
                    {progress.stage > i ? '✓' : i + 1}
                  </div>
                  <span className={clsx(
                    'text-[10px] text-center leading-tight',
                    progress.stage >= i ? 'text-blue-400' : 'text-gray-600'
                  )}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!loading && data && data.error && (
        <div className="rounded-lg border border-yellow-700/50 bg-yellow-950/20 p-6">
          <div className="flex items-start gap-3">
            <Brain size={20} className="text-yellow-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-300">AI Provider Configuration</p>
              <p className="text-xs text-yellow-400/80 mt-2 leading-relaxed">
                {data.error}
              </p>
              <p className="text-xs text-yellow-400/60 mt-2">
                Add ANTHROPIC_API_KEY to backend/.env or use existing Azure OpenAI configuration.
              </p>
            </div>
          </div>
        </div>
      )}

      {!loading && data && data.executive_summary && (
        <div className="space-y-6">
          {/* Executive Summary Card */}
          <div className="rounded-xl border border-blue-700/30 bg-gradient-to-br from-blue-950/40 to-blue-900/20 p-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">{React.createElement(BarChart2, { size: 22, style: { color: '#60a5fa' } })}</span>
              <h3 className="text-lg font-semibold text-white">Executive Summary</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-gray-400">Overall Score</p>
                <p className={clsx('text-3xl font-bold',
                  data.executive_summary.overall_bcdr_score >= 75 ? 'text-green-400' :
                  data.executive_summary.overall_bcdr_score >= 50 ? 'text-yellow-400' :
                  data.executive_summary.overall_bcdr_score >= 25 ? 'text-orange-400' :
                  'text-red-400'
                )}>{data.executive_summary.overall_bcdr_score}/100</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-gray-400">Risk Level</p>
                <span className={clsx('inline-block px-2 py-1 rounded text-xs font-medium',
                  data.executive_summary.risk_level === 'Low' ? 'bg-green-900/40 text-green-300' :
                  data.executive_summary.risk_level === 'Medium' ? 'bg-yellow-900/40 text-yellow-300' :
                  data.executive_summary.risk_level === 'High' ? 'bg-orange-900/40 text-orange-300' :
                  'bg-red-900/40 text-red-300'
                )}>{data.executive_summary.risk_level}</span>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-gray-400">Critical Gaps</p>
                <p className="text-2xl font-bold text-red-400">{data.executive_summary.critical_gaps_count}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-gray-400">Resources</p>
                <p className="text-2xl font-bold text-blue-400">{data.executive_summary.total_resources_analyzed}</p>
              </div>
            </div>
            {data.executive_summary.key_findings && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium text-gray-400">Key Findings:</p>
                {data.executive_summary.key_findings.slice(0, 3).map((finding, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-gray-300">
                    <span className="text-orange-400 mt-0.5">•</span>
                    <span>{finding}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Critical Gaps */}
          {data.critical_gaps && data.critical_gaps.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {React.createElement(AlertTriangle, { size: 16, style: { color: '#ef4444' } })}
                <h3 className="text-base font-semibold text-white">Critical Gaps ({data.critical_gaps.length})</h3>
              </div>
              {data.critical_gaps.slice(0, 5).map((gap, i) => (
                <div key={i} className="rounded-lg border border-red-800/50 bg-red-950/20 p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-medium text-white">{gap.title}</span>
                        <span className={clsx('text-xs px-1.5 py-0.5 rounded border',
                          gap.severity === 'Critical' ? 'bg-red-900/40 text-red-300 border-red-800' :
                          gap.severity === 'High' ? 'bg-orange-900/40 text-orange-300 border-orange-800' :
                          'bg-yellow-900/40 text-yellow-300 border-yellow-800'
                        )}>{gap.severity}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-800">
                          {gap.priority}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mb-2">{gap.description}</p>
                      <p className="text-xs text-blue-400 mb-2"><strong>Business Impact:</strong> {gap.business_impact}</p>
                      <p className="text-xs text-green-400"><strong>Recommended Action:</strong> {gap.recommended_action}</p>
                      
                      {/* Full-width modal for affected resources */}
                      {gap.resource_details && gap.resource_details.length > 0 && (
                        <div className="mt-3">
                          <button
                            onClick={() => setResourceModalData({
                              isOpen: true,
                              title: gap.title,
                              description: gap.description,
                              resources: gap.resource_details,
                              context: { gap_id: gap.gap_id, severity: gap.severity }
                            })}
                            className="text-xs px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 rounded border border-blue-700/50 hover:border-blue-600 transition-colors flex items-center gap-2"
                          >
                            View {gap.total_affected} Affected Resource{gap.total_affected !== 1 ? 's' : ''} in Full Table
                          </button>
                        </div>
                      )}
                      
                      <p className="text-xs text-orange-400 mt-2">Est. {gap.estimated_cost} • {gap.implementation_effort} effort</p>
                    </div>
                    <span className="text-xs text-gray-500 shrink-0">{gap.total_affected || gap.affected_resources_count} resources</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recommendations */}
          {data.recommendations && data.recommendations.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {React.createElement(Lightbulb, { size: 16, style: { color: '#eab308' } })}
                <h3 className="text-base font-semibold text-white">Top Recommendations ({data.recommendations.length})</h3>
              </div>
              {data.recommendations.slice(0, 5).map((rec, i) => (
                <div key={i} className="rounded-lg border border-gray-800 bg-gray-900/40 p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-medium text-white">{rec.title}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300 border border-purple-800">
                          {rec.category}
                        </span>
                        <span className={clsx('text-xs px-1.5 py-0.5 rounded border',
                          rec.priority === 'P1' ? 'bg-red-900/40 text-red-300 border-red-800' :
                          rec.priority === 'P2' ? 'bg-orange-900/40 text-orange-300 border-orange-800' :
                          'bg-yellow-900/40 text-yellow-300 border-yellow-800'
                        )}>{rec.priority}</span>
                        {rec.quick_win && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-green-900/40 text-green-300 border border-green-800 flex items-center gap-1">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Quick Win
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mb-2">{rec.description}</p>
                      
                      {/* RTO/RPO improvements */}
                      {(rec.expected_rto_improvement || rec.expected_rpo_improvement) && (
                        <div className="flex gap-4 mb-2 text-xs">
                          {rec.expected_rto_improvement && (
                            <span className="text-green-400">RTO: {rec.expected_rto_improvement}</span>
                          )}
                          {rec.expected_rpo_improvement && (
                            <span className="text-green-400">RPO: {rec.expected_rpo_improvement}</span>
                          )}
                        </div>
                      )}
                      
                      {/* Full-width modal for affected resources */}
                      {rec.resource_details && rec.resource_details.length > 0 && (
                        <div className="mt-2 mb-2">
                          <button
                            onClick={() => setResourceModalData({
                              isOpen: true,
                              title: rec.title,
                              description: rec.description,
                              resources: rec.resource_details,
                              context: { recommendation_id: rec.recommendation_id, priority: rec.priority }
                            })}
                            className="text-xs px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 rounded border border-blue-700/50 hover:border-blue-600 transition-colors flex items-center gap-2"
                          >
                            View {rec.total_affected} Affected Resource{rec.total_affected !== 1 ? 's' : ''} in Full Table
                          </button>
                        </div>
                      )}
                      
                      {rec.implementation_steps && rec.implementation_steps.length > 0 && (
                        <details className="text-xs text-gray-500 mt-2">
                          <summary className="cursor-pointer hover:text-gray-400">Implementation Steps ({rec.implementation_steps.length})</summary>
                          <ol className="list-decimal list-inside mt-2 space-y-1 ml-2">
                            {rec.implementation_steps.map((step, si) => (
                              <li key={si} className="text-gray-400">{step}</li>
                            ))}
                          </ol>
                        </details>
                      )}
                      <p className="text-xs text-blue-400 mt-2">Est. {rec.estimated_cost} • {rec.effort} effort</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Implementation Roadmap */}
          {data.implementation_roadmap && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {React.createElement(Clock, { size: 16, style: { color: '#60a5fa' } })}
                <h3 className="text-base font-semibold text-white">Implementation Roadmap</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {data.implementation_roadmap.phase_1_immediate && (
                  <div className="rounded-lg border border-red-800/50 bg-red-950/10 p-4 space-y-2">
                    <p className="text-sm font-medium text-red-300">Phase 1: Immediate</p>
                    <p className="text-xs text-gray-400">{data.implementation_roadmap.phase_1_immediate.timeline}</p>
                    <ul className="text-xs text-gray-400 space-y-1 mt-2">
                      {data.implementation_roadmap.phase_1_immediate.actions.map((action, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-red-400 shrink-0">•</span>
                          <span>{action}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-red-400 mt-2">Est. {data.implementation_roadmap.phase_1_immediate.estimated_cost}</p>
                  </div>
                )}
                {data.implementation_roadmap.phase_2_short_term && (
                  <div className="rounded-lg border border-orange-800/50 bg-orange-950/10 p-4 space-y-2">
                    <p className="text-sm font-medium text-orange-300">Phase 2: Short-term</p>
                    <p className="text-xs text-gray-400">{data.implementation_roadmap.phase_2_short_term.timeline}</p>
                    <ul className="text-xs text-gray-400 space-y-1 mt-2">
                      {data.implementation_roadmap.phase_2_short_term.actions.map((action, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-orange-400 shrink-0">•</span>
                          <span>{action}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-orange-400 mt-2">Est. {data.implementation_roadmap.phase_2_short_term.estimated_cost}</p>
                  </div>
                )}
                {data.implementation_roadmap.phase_3_long_term && (
                  <div className="rounded-lg border border-blue-800/50 bg-blue-950/10 p-4 space-y-2">
                    <p className="text-sm font-medium text-blue-300">Phase 3: Long-term</p>
                    <p className="text-xs text-gray-400">{data.implementation_roadmap.phase_3_long_term.timeline}</p>
                    <ul className="text-xs text-gray-400 space-y-1 mt-2">
                      {data.implementation_roadmap.phase_3_long_term.actions.map((action, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-blue-400 shrink-0">•</span>
                          <span>{action}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-blue-400 mt-2">Est. {data.implementation_roadmap.phase_3_long_term.estimated_cost}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Regional Analysis */}
          {data.regional_analysis && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {React.createElement(Globe, { size: 16, style: { color: '#60a5fa' } })}
                <h3 className="text-base font-semibold text-white">Regional Analysis</h3>
              </div>
              <div className="rounded-lg border border-blue-800/50 bg-blue-950/10 p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Primary Regions</p>
                    <div className="flex flex-wrap gap-1">
                      {data.regional_analysis.primary_regions && data.regional_analysis.primary_regions.map((region, i) => (
                        <span key={i} className="text-xs px-2 py-1 rounded bg-blue-900/40 text-blue-300 border border-blue-800">
                          {region}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Single Region Risk</p>
                    <span className={clsx('inline-block text-xs px-2 py-1 rounded border',
                      data.regional_analysis.single_region_risk === 'Low' ? 'bg-green-900/40 text-green-300 border-green-800' :
                      data.regional_analysis.single_region_risk === 'Medium' ? 'bg-yellow-900/40 text-yellow-300 border-yellow-800' :
                      'bg-red-900/40 text-red-300 border-red-800'
                    )}>{data.regional_analysis.single_region_risk}</span>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Recommended DR Regions</p>
                  <div className="flex flex-wrap gap-1">
                    {data.regional_analysis.recommended_dr_regions && data.regional_analysis.recommended_dr_regions.map((region, i) => (
                      <span key={i} className="text-xs px-2 py-1 rounded bg-green-900/40 text-green-300 border border-green-800">
                        ✓ {region}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Cross-Region Dependencies</p>
                  <p className="text-xs text-gray-300">{data.regional_analysis.cross_region_dependencies}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Availability Zone Status</p>
                  <p className="text-xs text-orange-300">{data.regional_analysis.availability_zone_status}</p>
                </div>
              </div>
            </div>
          )}

          {/* Cost-Benefit Analysis */}
          {data.cost_benefit_analysis && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {React.createElement(DollarSign, { size: 16, style: { color: '#eab308' } })}
                <h3 className="text-base font-semibold text-white">Cost-Benefit Analysis</h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border border-red-800/50 bg-red-950/10 p-3">
                  <p className="text-xs text-gray-400 mb-1">Current Risk Exposure</p>
                  <p className="text-lg font-bold text-red-400">{data.cost_benefit_analysis.current_annual_risk_exposure}</p>
                </div>
                <div className="rounded-lg border border-blue-800/50 bg-blue-950/10 p-3">
                  <p className="text-xs text-gray-400 mb-1">Recommended Investment</p>
                  <p className="text-lg font-bold text-blue-400">{data.cost_benefit_analysis.recommended_investment}</p>
                </div>
                <div className="rounded-lg border border-green-800/50 bg-green-950/10 p-3">
                  <p className="text-xs text-gray-400 mb-1">ROI Timeframe</p>
                  <p className="text-lg font-bold text-green-400">{data.cost_benefit_analysis.roi_timeframe}</p>
                </div>
                <div className="rounded-lg border border-purple-800/50 bg-purple-950/10 p-3">
                  <p className="text-xs text-gray-400 mb-1">Risk Reduction</p>
                  <p className="text-lg font-bold text-purple-400">{data.cost_benefit_analysis.risk_reduction_percentage}</p>
                </div>
              </div>
            </div>
          )}

          {/* Footer info */}
          <div className="flex items-center justify-between text-xs text-gray-500 pt-4 border-t border-gray-800">
            <span>Generated by {data.provider === 'anthropic' ? 'Claude AI' : 'Azure OpenAI'} • {data.model}</span>
            <span>{new Date(data.analysis_timestamp).toLocaleString()}</span>
          </div>
        </div>
      )}

      {data?.items?.length > 0 && (
        <div className="space-y-3">
          {data.items.map((item, i) => (
            <div key={i} className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4 space-y-2">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white">{item.resource_name || item.resource_id || `Item ${i+1}`}</span>
                    {item.dr_tier && (
                      <span className={clsx('text-xs px-1.5 py-0.5 rounded-full border',
                        item.dr_tier === 'Tier 0' ? 'bg-red-900/40 text-red-300 border-red-800/50' :
                        item.dr_tier === 'Tier 1' ? 'bg-orange-900/40 text-orange-300 border-orange-800/50' :
                        'bg-gray-800 text-gray-400 border-gray-700'
                      )}>{item.dr_tier}</span>
                    )}
                    {item.rto && <span className="text-xs text-gray-500">RTO: {item.rto}</span>}
                    {item.rpo && <span className="text-xs text-gray-500">RPO: {item.rpo}</span>}
                  </div>
                  {item.bcdr_gap && <p className="text-xs text-orange-400/90 mt-1">{item.bcdr_gap}</p>}
                  {item.recommendation && <p className="text-xs text-gray-400 mt-1 leading-relaxed">{item.recommendation}</p>}
                </div>
              </div>
              {item.action_steps?.length > 0 && (
                <ol className="space-y-0.5 pl-2">
                  {item.action_steps.slice(0, 3).map((s, j) => (
                    <li key={j} className="text-xs text-gray-500">{j+1}. {s}</li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      )}
      
      {/* Full-width Resource Details Modal */}
      <ResourceDetailsModal
        isOpen={resourceModalData.isOpen}
        onClose={() => setResourceModalData({ ...resourceModalData, isOpen: false })}
        title={resourceModalData.title}
        description={resourceModalData.description}
        resources={resourceModalData.resources}
        context={resourceModalData.context}
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tabbed module views with AI Analysis tabs
// ═══════════════════════════════════════════════════════════════════════════════

function ModuleTabBar({ tabs, activeTab, onTabChange }) {
  return (
    <div className="flex items-center gap-1 border-b border-gray-800 pb-3 mb-4">
      {tabs.map(t => (
        <button key={t.key} onClick={() => onTabChange(t.key)}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
            activeTab === t.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200',
          )}>
          {t.Icon && <t.Icon size={13} />}
          {t.label}
        </button>
      ))}
    </div>
  )
}

function MaturityView({ data, filteredResources, moduleListMode, setModuleListMode, tableFilter, setTableFilter, projects, setProjects, setSelectedResourceIds, setSaveProjectModalOpen }) {
  const [tab, setTab] = React.useState('dashboard')
  const cm = data?.cloud_maturity
  const waf = data?.waf_scorecard
  const subMap = React.useMemo(() => buildSubNameMap(data?.subscriptions), [data?.subscriptions])
  return (
    <div className="space-y-4">
      <ModuleTabBar tabs={[
        { key: 'dashboard', label: 'Dashboard', Icon: BarChart2 },
        { key: 'reports', label: 'Reports', Icon: ClipboardList },
        { key: 'ai', label: 'AI Analysis', Icon: Brain },
      ]} activeTab={tab} onTabChange={setTab} />
      {tab === 'dashboard' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SharedKPI label="Maturity Level" value={cm?.level || 'N/A'} color="purple" icon={BarChart2} subtitle={cm?.description} />
            <SharedKPI label="Overall Score" value={cm?.score != null ? `${cm.score}%` : 'N/A'} color="blue" icon={Target} />
            <SharedKPI label="WAF Pillars" value={waf?.pillars?.length || 0} color="cyan" icon={Shield} />
            <SharedKPI label="Resources Assessed" value={filteredResources.length} color="green" icon={Monitor} />
          </div>
          <ModuleViewToggle label="Cloud Maturity" listMode={moduleListMode} onToggle={setModuleListMode} />
          {moduleListMode ? (
            <ResourceTable resources={filteredResources} externalFilter={tableFilter} onClearExternalFilter={() => setTableFilter(null)} aiEnabled={data?.ai_enabled ?? false} projects={projects} onSaveSelectedAsProject={({ mode, ids, projectId }) => { setSelectedResourceIds(new Set(ids)); if (mode === 'new') setSaveProjectModalOpen(true); else api.addProjectResources(projectId, ids).then(() => api.getProjects().then(setProjects)) }} />
          ) : (
            <>
              <MaturityHero cm={cm} />
              <WAFScorecard waf={waf} />
              <CloudMaturityPanel cloudMaturity={cm} />
            </>
          )}
        </div>
      )}
      {tab === 'reports' && (
        <DataTable
          title="Resource Maturity Report"
          exportFilename="maturity-resources"
          columns={[
            { key: 'name', label: 'Resource' },
            { key: 'resource_type', label: 'Type' },
            { key: 'resource_group', label: 'Resource Group' },
            { key: 'location', label: 'Location' },
            { key: 'subscription_id', label: 'Subscription', render: subNameRenderer(subMap) },
            { key: 'final_score', label: 'Score', render: scoreBadgeRenderer },
            { key: 'sku', label: 'SKU' },
            { key: 'cost_current_month', label: 'Monthly Cost', render: costRenderer },
            { key: 'has_backup', label: 'Backup', render: boolBadgeRenderer('Protected', 'Unprotected') },
            { key: 'is_orphan', label: 'Orphan', render: boolBadgeRenderer('Yes', 'No') },
          ]}
          data={filteredResources.map(r => ({
            ...r,
            name: r.name || r.resource_name || r.resource_id?.split('/').pop(),
            final_score: r.final_score ?? r.score ?? null,
          }))}
          emptyMsg="No resources assessed"
        />
      )}
      {tab === 'ai' && <MaturityAIAnalysis />}
    </div>
  )
}

function SecurityView({ data, filteredResources, moduleListMode, setModuleListMode, tableFilter, setTableFilter, projects, setProjects, setSelectedResourceIds, setSaveProjectModalOpen }) {
  const [tab, setTab] = React.useState('dashboard')
  // activeSecFilter: null = all, 'critical' | 'high' | 'medium' | 'low' = severity filter
  const [activeSecFilter, setActiveSecFilter] = React.useState(null)
  const gaps = data?.security_gaps ?? []
  const critical = gaps.filter(g => g.severity === 'Critical' || g.severity === 'High').length
  const medium = gaps.filter(g => g.severity === 'Medium').length
  const low = gaps.filter(g => g.severity === 'Low').length

  // When a KPI card is clicked: switch to list view and set severity filter
  const handleKPIClick = React.useCallback((sev) => {
    setActiveSecFilter(sev)
    setModuleListMode(true)
  }, [setModuleListMode])

  // Build set of resource_ids that appear in security gaps (optionally filtered by severity)
  const securityResourceIds = React.useMemo(() => {
    let filtered = gaps
    if (activeSecFilter === 'critical') filtered = gaps.filter(g => g.severity === 'Critical' || g.severity === 'High')
    else if (activeSecFilter === 'medium') filtered = gaps.filter(g => g.severity === 'Medium')
    else if (activeSecFilter === 'low') filtered = gaps.filter(g => g.severity === 'Low')
    // Collect all resource identifiers (resource_id and resource_name)
    const ids = new Set()
    filtered.forEach(g => {
      if (g.resource_id) ids.add(g.resource_id.toLowerCase())
      if (g.resource_name) ids.add(g.resource_name.toLowerCase())
    })
    return ids
  }, [gaps, activeSecFilter])

  // Filter the resource list to only security-affected resources in list mode
  const securityFilteredResources = React.useMemo(() => {
    if (!moduleListMode || securityResourceIds.size === 0) return filteredResources
    return filteredResources.filter(r => {
      const id = (r.resource_id || r.id || '').toLowerCase()
      const name = (r.resource_name || r.name || '').toLowerCase()
      return securityResourceIds.has(id) || securityResourceIds.has(name)
    })
  }, [filteredResources, moduleListMode, securityResourceIds])

  // Reset filter when leaving list mode
  React.useEffect(() => {
    if (!moduleListMode) setActiveSecFilter(null)
  }, [moduleListMode])

  const filterLabel = activeSecFilter === 'critical' ? 'Critical/High' : activeSecFilter === 'medium' ? 'Medium' : activeSecFilter === 'low' ? 'Low/Info' : 'All Severity'

  return (
    <div className="space-y-4">
      <ModuleTabBar tabs={[
        { key: 'dashboard', label: 'Dashboard', Icon: Shield },
        { key: 'reports', label: 'Reports', Icon: ClipboardList },
        { key: 'ai', label: 'AI Analysis', Icon: Brain },
      ]} activeTab={tab} onTabChange={setTab} />
      {tab === 'dashboard' && (
        <div className="space-y-6">
          {/* KPI cards — clicking filters the list view */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div onClick={() => handleKPIClick(null)} style={{ cursor: 'pointer' }}>
              <SharedKPI label="Total Gaps" value={gaps.length} color="red" icon={Shield} subtitle="Click to view resources" />
            </div>
            <div onClick={() => handleKPIClick('critical')} style={{ cursor: 'pointer' }}>
              <SharedKPI label="Critical/High" value={critical} color="red" icon={AlertTriangle} subtitle="Click to filter" />
            </div>
            <div onClick={() => handleKPIClick('medium')} style={{ cursor: 'pointer' }}>
              <SharedKPI label="Medium" value={medium} color="amber" icon={AlertCircle} subtitle="Click to filter" />
            </div>
            <div onClick={() => handleKPIClick('low')} style={{ cursor: 'pointer' }}>
              <SharedKPI label="Low/Info" value={low} color="green" icon={Shield} subtitle="Click to filter" />
            </div>
          </div>
          <ModuleViewToggle label="Security" listMode={moduleListMode} onToggle={(v) => { setModuleListMode(v); if (!v) setActiveSecFilter(null) }} />
          {moduleListMode ? (
            <div className="space-y-3">
              {/* Security filter context banner */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Shield size={14} style={{ color: '#3b82f6' }} />
                  <span style={{ color: '#93c5fd', fontSize: 13, fontWeight: 600 }}>
                    {securityFilteredResources.length} resource{securityFilteredResources.length !== 1 ? 's' : ''} with security gaps
                    {activeSecFilter && <span style={{ color: '#64748b', fontWeight: 400 }}> — {filterLabel} severity</span>}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['critical', 'medium', 'low'].map(sev => (
                    <button key={sev} onClick={() => setActiveSecFilter(activeSecFilter === sev ? null : sev)} style={{
                      padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none',
                      background: activeSecFilter === sev ? '#3b82f6' : '#1e293b',
                      color: activeSecFilter === sev ? '#fff' : '#94a3b8',
                    }}>
                      {sev === 'critical' ? 'Critical/High' : sev === 'medium' ? 'Medium' : 'Low'}
                    </button>
                  ))}
                  {activeSecFilter && (
                    <button onClick={() => setActiveSecFilter(null)} style={{ padding: '3px 8px', borderRadius: 5, fontSize: 11, background: 'none', border: '1px solid #334155', color: '#64748b', cursor: 'pointer' }}>
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <ResourceTable
                resources={securityFilteredResources}
                externalFilter={tableFilter}
                onClearExternalFilter={() => setTableFilter(null)}
                aiEnabled={data?.ai_enabled ?? false}
                projects={projects}
                onSaveSelectedAsProject={({ mode, ids, projectId }) => { setSelectedResourceIds(new Set(ids)); if (mode === 'new') setSaveProjectModalOpen(true); else api.addProjectResources(projectId, ids).then(() => api.getProjects().then(setProjects)) }}
              />
            </div>
          ) : (
            <>
              <SecurityHero gaps={gaps} waf={data?.waf_scorecard} />
              <SecurityPanel securityGaps={gaps} />
            </>
          )}
        </div>
      )}
      {tab === 'reports' && (
        <DataTable
          title="Security Gaps Report"
          exportFilename="security-gaps"
          columns={[
            { key: 'resource_name', label: 'Resource' },
            { key: 'resource_type', label: 'Type' },
            { key: 'severity', label: 'Severity', render: severityBadgeRenderer },
            { key: 'category', label: 'Category' },
            { key: 'description', label: 'Description' },
            { key: 'recommendation', label: 'Recommendation' },
            { key: 'monthly_risk_usd', label: 'Monthly Risk', render: costRenderer },
          ]}
          data={gaps}
          emptyMsg="No security gaps detected"
        />
      )}
      {tab === 'ai' && <SecurityAIAnalysis />}
    </div>
  )
}

function InnovationView({ data, filteredResources, moduleListMode, setModuleListMode, tableFilter, setTableFilter, projects, setProjects, setSelectedResourceIds, setSaveProjectModalOpen }) {
  const [tab, setTab] = React.useState('dashboard')
  const gaps = data?.innovation_gaps ?? []
  const scores = data?.service_adoption_scores ?? []
  return (
    <div className="space-y-4">
      <ModuleTabBar tabs={[
        { key: 'dashboard', label: 'Dashboard', Icon: Rocket },
        { key: 'reports', label: 'Reports', Icon: ClipboardList },
        { key: 'ai', label: 'AI Analysis', Icon: Brain },
      ]} activeTab={tab} onTabChange={setTab} />
      {tab === 'dashboard' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SharedKPI label="Innovation Gaps" value={gaps.length} color="purple" icon={Rocket} />
            <SharedKPI label="Services Scored" value={scores.length} color="blue" icon={BarChart2} />
            <SharedKPI label="Avg Adoption" value={scores.length ? `${Math.round(scores.reduce((s, x) => s + (x.score || 0), 0) / scores.length)}%` : '0%'} color="cyan" icon={TrendingUp} />
            <SharedKPI label="Resources" value={filteredResources.length} color="green" icon={Monitor} />
          </div>
          <ModuleViewToggle label="Innovation" listMode={moduleListMode} onToggle={setModuleListMode} />
          {moduleListMode ? (
            <ResourceTable resources={filteredResources} externalFilter={tableFilter} onClearExternalFilter={() => setTableFilter(null)} aiEnabled={data?.ai_enabled ?? false} projects={projects} onSaveSelectedAsProject={({ mode, ids, projectId }) => { setSelectedResourceIds(new Set(ids)); if (mode === 'new') setSaveProjectModalOpen(true); else api.addProjectResources(projectId, ids).then(() => api.getProjects().then(setProjects)) }} />
          ) : (
            <>
              <InnovationHero gaps={gaps} scores={scores} />
              <InnovationGapPanel innovationGaps={gaps} serviceAdoptionScores={scores} />
            </>
          )}
        </div>
      )}
      {tab === 'reports' && (
        <DataTable
          title="Innovation Gaps Report"
          exportFilename="innovation-gaps"
          columns={[
            { key: 'opportunity', label: 'Opportunity' },
            { key: 'category', label: 'Category' },
            { key: 'recommendation_detail', label: 'Recommendation' },
            { key: 'business_impact', label: 'Business Impact' },
            { key: 'azure_services', label: 'Azure Services' },
            { key: 'estimated_effort', label: 'Effort' },
            { key: 'status', label: 'Status' },
          ]}
          data={gaps}
          emptyMsg="No innovation gaps detected"
        />
      )}
      {tab === 'ai' && <InnovationAIAnalysis />}
    </div>
  )
}

function MigrationView({ data, filteredResources, moduleListMode, setModuleListMode, tableFilter, setTableFilter, projects, setProjects, setSelectedResourceIds, setSaveProjectModalOpen }) {
  const [tab, setTab] = React.useState('dashboard')
  const opps = data?.modernization_opportunities ?? []
  return (
    <div className="space-y-4">
      <ModuleTabBar tabs={[
        { key: 'dashboard', label: 'Dashboard', Icon: RefreshCw },
        { key: 'reports', label: 'Reports', Icon: ClipboardList },
        { key: 'ai', label: 'AI Analysis', Icon: Brain },
      ]} activeTab={tab} onTabChange={setTab} />
      {tab === 'dashboard' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SharedKPI label="Migration Opportunities" value={opps.length} color="blue" icon={RefreshCw} />
            <SharedKPI label="Legacy Resources" value={opps.filter(o => o.category === 'legacy' || o.migration_type === 'modernize').length} color="amber" icon={AlertTriangle} />
            <SharedKPI label="Quick Wins" value={opps.filter(o => o.effort === 'low' || o.priority === 'high').length} color="green" icon={Zap} />
            <SharedKPI label="Total Resources" value={filteredResources.length} color="cyan" icon={Monitor} />
          </div>
          <ModuleViewToggle label="Migration" listMode={moduleListMode} onToggle={setModuleListMode} />
          {moduleListMode ? (
            <ResourceTable resources={filteredResources} externalFilter={tableFilter} onClearExternalFilter={() => setTableFilter(null)} aiEnabled={data?.ai_enabled ?? false} projects={projects} onSaveSelectedAsProject={({ mode, ids, projectId }) => { setSelectedResourceIds(new Set(ids)); if (mode === 'new') setSaveProjectModalOpen(true); else api.addProjectResources(projectId, ids).then(() => api.getProjects().then(setProjects)) }} />
          ) : (
            <MigrationDashboard legacyOpps={opps} />
          )}
        </div>
      )}
      {tab === 'reports' && (
        <DataTable
          title="Modernization Opportunities Report"
          exportFilename="migration-opportunities"
          columns={[
            { key: 'resource_name', label: 'Resource' },
            { key: 'resource_type', label: 'Current Type' },
            { key: 'target', label: 'Target Service' },
            { key: 'category', label: 'Category' },
            { key: 'effort', label: 'Effort' },
            { key: 'priority', label: 'Priority' },
            { key: 'recommendation', label: 'Recommendation' },
          ]}
          data={opps}
          emptyMsg="No modernization opportunities found"
        />
      )}
      {tab === 'ai' && <MigrationAIAnalysis />}
    </div>
  )
}

function BackupView({ data, filteredResources, moduleListMode, setModuleListMode, tableFilter, setTableFilter, projects, setProjects, setSelectedResourceIds, setSaveProjectModalOpen }) {
  const [tab, setTab] = React.useState('dashboard')
  const bc = data?.backup_coverage
  return (
    <div className="space-y-4">
      <ModuleTabBar tabs={[
        { key: 'dashboard', label: 'Dashboard', Icon: HardDrive },
        { key: 'reports', label: 'Reports', Icon: ClipboardList },
        { key: 'ai', label: 'AI Analysis', Icon: Brain },
      ]} activeTab={tab} onTabChange={setTab} />
      {tab === 'dashboard' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SharedKPI label="Protected" value={bc?.protected_count || 0} color="green" icon={Shield} subtitle={`${bc?.coverage_pct || 0}% coverage`} />
            <SharedKPI label="Unprotected" value={bc?.unprotected_count || 0} color="red" icon={AlertTriangle} />
            <SharedKPI label="Total Assessed" value={bc?.total_resources || 0} color="blue" icon={Database} />
            <SharedKPI label="Vaults" value={bc?.vault_count || 0} color="purple" icon={HardDrive} />
          </div>
          <ModuleViewToggle label="Backup & Resilience" listMode={moduleListMode} onToggle={setModuleListMode} />
          {moduleListMode ? (
            <ResourceTable resources={filteredResources} externalFilter={tableFilter} onClearExternalFilter={() => setTableFilter(null)} aiEnabled={data?.ai_enabled ?? false} projects={projects} onSaveSelectedAsProject={({ mode, ids, projectId }) => { setSelectedResourceIds(new Set(ids)); if (mode === 'new') setSaveProjectModalOpen(true); else api.addProjectResources(projectId, ids).then(() => api.getProjects().then(setProjects)) }} />
          ) : (
            <BackupResiliencePanel backupCoverage={bc} />
          )}
        </div>
      )}
      {tab === 'reports' && (
        <DataTable
          title="Backup Coverage Report"
          exportFilename="backup-coverage"
          columns={[
            { key: 'name', label: 'Resource' },
            { key: 'resource_type', label: 'Type' },
            { key: 'resource_group', label: 'Resource Group' },
            { key: 'location', label: 'Location' },
            { key: 'backup_status', label: 'Backup Status' },
          ]}
          data={filteredResources.map(r => ({ ...r, name: r.name || r.resource_name || r.resource_id?.split('/').pop(), backup_status: r.is_protected ? 'Protected' : 'Unprotected' }))}
          emptyMsg="No backup data available"
        />
      )}
      {tab === 'ai' && <BackupAIAnalysis />}
    </div>
  )
}

function ResilienceView({ data, filteredResources, moduleListMode, setModuleListMode, tableFilter, setTableFilter, projects, setProjects, setSelectedResourceIds, setSaveProjectModalOpen }) {
  const [tab, setTab] = React.useState('dashboard')
  return (
    <div className="space-y-4">
      <ModuleTabBar tabs={[
        { key: 'dashboard', label: 'Dashboard', Icon: Zap },
        { key: 'reports', label: 'Reports', Icon: ClipboardList },
        { key: 'ai', label: 'AI Analysis', Icon: Brain },
      ]} activeTab={tab} onTabChange={setTab} />
      {tab === 'dashboard' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SharedKPI label="Total Resources" value={filteredResources.length} color="blue" icon={Monitor} />
            <SharedKPI label="HA Configured" value={filteredResources.filter(r => r.ha_enabled || r.zone_redundant).length} color="green" icon={Shield} />
            <SharedKPI label="Single Instance" value={filteredResources.filter(r => !r.ha_enabled && !r.zone_redundant).length} color="amber" icon={AlertTriangle} />
            <SharedKPI label="Zone Redundant" value={filteredResources.filter(r => r.zone_redundant).length} color="cyan" icon={Globe} />
          </div>
          <ModuleViewToggle label="Resilience & SLA" listMode={moduleListMode} onToggle={setModuleListMode} />
          {moduleListMode ? (
            <ResourceTable resources={filteredResources} externalFilter={tableFilter} onClearExternalFilter={() => setTableFilter(null)} aiEnabled={data?.ai_enabled ?? false} projects={projects} onSaveSelectedAsProject={({ mode, ids, projectId }) => { setSelectedResourceIds(new Set(ids)); if (mode === 'new') setSaveProjectModalOpen(true); else api.addProjectResources(projectId, ids).then(() => api.getProjects().then(setProjects)) }} />
          ) : (
            <ResiliencePanel resources={filteredResources} />
          )}
        </div>
      )}
      {tab === 'reports' && (
        <DataTable
          title="Resilience & SLA Report"
          exportFilename="resilience-sla"
          columns={[
            { key: 'name', label: 'Resource' },
            { key: 'resource_type', label: 'Type' },
            { key: 'location', label: 'Location' },
            { key: 'sla', label: 'SLA' },
            { key: 'availability', label: 'Availability' },
            { key: 'redundancy', label: 'Redundancy' },
          ]}
          data={filteredResources.map(r => ({ ...r, name: r.name || r.resource_name || r.resource_id?.split('/').pop(), redundancy: r.zone_redundant ? 'Zone Redundant' : r.ha_enabled ? 'HA' : 'Single Instance', sla: r.sla || 'N/A', availability: r.availability || 'N/A' }))}
          emptyMsg="No resilience data available"
        />
      )}
      {tab === 'ai' && <ResilienceAIAnalysis />}
    </div>
  )
}

function LicensingViewEnhanced({ data, filteredResources, moduleListMode, setModuleListMode, tableFilter, setTableFilter, projects, setProjects, setSelectedResourceIds, setSaveProjectModalOpen }) {
  const [tab, setTab] = React.useState('dashboard')
  const opps = data?.licensing_opportunities ?? []
  const reservations = data?.active_reservations ?? []
  return (
    <div className="space-y-4">
      <ModuleTabBar tabs={[
        { key: 'dashboard', label: 'Dashboard', Icon: DollarSign },
        { key: 'reports', label: 'Reports', Icon: ClipboardList },
      ]} activeTab={tab} onTabChange={setTab} />
      {tab === 'dashboard' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SharedKPI label="Licensing Opportunities" value={opps.length} color="green" icon={DollarSign} />
            <SharedKPI label="Active Reservations" value={reservations.length} color="blue" icon={Shield} />
            <SharedKPI label="Over-Commitment" value={`$${(data?.reservation_over_commitment_usd || 0).toLocaleString()}`} color="red" icon={AlertTriangle} />
            <SharedKPI label="Recommendations" value={data?.reservation_recommendations?.length || 0} color="purple" icon={Lightbulb} />
          </div>
          <ModuleViewToggle label="Licensing & Reservation" listMode={moduleListMode} onToggle={setModuleListMode} />
          {moduleListMode ? (
            <ResourceTable resources={filteredResources} externalFilter={tableFilter} onClearExternalFilter={() => setTableFilter(null)} aiEnabled={data?.ai_enabled ?? false} projects={projects} onSaveSelectedAsProject={({ mode, ids, projectId }) => { setSelectedResourceIds(new Set(ids)); if (mode === 'new') setSaveProjectModalOpen(true); else api.addProjectResources(projectId, ids).then(() => api.getProjects().then(setProjects)) }} />
          ) : (
            <>
              <LicensingHero opps={opps} />
              <LicensingPanel licensingOpportunities={opps} />
              <ReservationsPanel
                resources={filteredResources}
                activeReservations={reservations}
                overCommitmentUsd={data?.reservation_over_commitment_usd ?? 0}
                reservationRecommendations={data?.reservation_recommendations ?? []}
              />
            </>
          )}
        </div>
      )}
      {tab === 'reports' && (
        <DataTable
          title="Licensing Opportunities Report"
          exportFilename="licensing-opportunities"
          columns={[
            { key: 'resource_name', label: 'Resource' },
            { key: 'resource_type', label: 'Type' },
            { key: 'opportunity_type', label: 'Opportunity' },
            { key: 'savings_potential', label: 'Savings' },
            { key: 'recommendation', label: 'Recommendation' },
          ]}
          data={opps}
          emptyMsg="No licensing opportunities found"
        />
      )}
    </div>
  )
}

function NetworkingView() {
  const [tab, setTab] = React.useState('dashboard')
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b border-gray-800 pb-3">
        {[
          { key: 'dashboard', label: 'Dashboard', Icon: Globe },
          { key: 'ai',        label: 'AI Analysis', Icon: Brain },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
              tab === t.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200',
            )}
          >
            <t.Icon size={13} />
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'dashboard' && <NetworkingDashboard />}
      {tab === 'ai'        && <NetworkingAIAnalysis />}
    </div>
  )
}

function BCDRView() {
  const [tab, setTab] = React.useState('dashboard')
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b border-gray-800 pb-3">
        {[
          { key: 'dashboard',  label: 'Dashboard', Icon: Shield },
          { key: 'assessment', label: 'Full Assessment (19-Column SA Analysis)', Icon: ClipboardList },
          { key: 'ai',         label: 'AI BCDR Analysis', Icon: Brain },
          { key: 'avs',        label: 'AVS DR', Icon: Cloud },
          { key: 'deep',       label: 'Deep BCDR AI', Icon: Microscope },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
              tab === t.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200',
            )}
          >
            <t.Icon size={13} />
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'dashboard'   && <BCDRDashboard onViewAssessment={() => setTab('assessment')} />}
      {tab === 'assessment'  && <BCDRAssessmentTable />}
      {tab === 'ai'          && <AIBCDRPanel />}
      {tab === 'avs'         && <AVSDRPanel />}
      {tab === 'deep'        && <DeepBCDRAnalysis />}
    </div>
  )
}

export default function App() {
  return (
    <>
      <ErrorBoundary><AppInner /></ErrorBoundary>
      {/* Outside the boundary on purpose: if the app has crashed to the fallback,
          VersionWatcher keeps polling and can auto-reload the tab into a fixed
          build, self-healing the crash without user action. */}
      <VersionWatcher />
    </>
  )
}
