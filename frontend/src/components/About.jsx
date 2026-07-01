/**
 * About page — solution-accelerator credit, Features and FAQs.
 * Rendered for the nav views: 'about', 'about-features', 'about-faqs'.
 * Styled to match the Microsoft / Fluent palette used across the app.
 */
import React from 'react'
import { DollarSign, Server, Brain, ShieldCheck, LifeBuoy, ScrollText, Activity, Cloud, Lock } from 'lucide-react'

const C = {
  panel: 'var(--c-131a2b)',
  border: 'rgba(148, 163, 184, 0.16)',
  textStrong: 'var(--c-f1f5f9)',
  text: 'var(--c-cbd5e1)',
  muted: 'var(--c-94a3b8)',
  primary: '#3b82f6',
  primaryHover: '#60a5fa',
  soft: 'var(--c-0c1220)',
}
const FONT = '"Segoe UI", system-ui, -apple-system, sans-serif'

// Accent colour + icon per feature group (matches the colourful dashboard tiles).
const GROUP_ACCENTS = [
  { color: '#22c55e', Icon: DollarSign },  // Cost Management & FinOps
  { color: '#3b82f6', Icon: Server },      // Resource & Infrastructure Inventory
  { color: '#a855f7', Icon: Brain },       // AI-Powered Assessments
  { color: '#ef4444', Icon: ShieldCheck }, // Security & Identity
  { color: '#06b6d4', Icon: LifeBuoy },    // Resiliency & BCDR
  { color: '#f59e0b', Icon: ScrollText },  // Governance & Management
  { color: '#14b8a6', Icon: Activity },    // Operations
  { color: '#6366f1', Icon: Cloud },       // Hybrid, Arc & On-Premises
  { color: '#0ea5e9', Icon: Lock },        // Platform & Security
]

function MicrosoftLogo({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 21 21" aria-hidden="true" style={{ display: 'block' }}>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}

const FEATURE_GROUPS = [
  {
    group: 'Cost Management & FinOps',
    items: [
      'Multi-subscription cost dashboards with current-vs-previous month, daily/monthly trends and sparklines',
      'FinOps Overview & Dashboard aligned to the FinOps Framework',
      'Cost Explorer with group-by subscription, resource group, service, location or tag',
      'Budget Manager — create and track budgets with thresholds',
      'Forecasting of projected spend',
      'Cost Allocation, Chargeback & Showback by tag / owner / cost-center',
      'Commitments & Reservations (RI) coverage and purchase recommendations',
      'Savings Optimizer — quantified savings from idle, orphaned and right-size opportunities',
      'Tag Cost Analytics and FinOps Alerts for cost anomalies',
      'Cost Warehouse — historical cost snapshots persisted for trend analysis',
      'FinOps Compliance scorecard (tagging & cost governance)',
    ],
  },
  {
    group: 'Resource & Infrastructure Inventory',
    items: [
      'Full estate inventory via Azure Resource Graph (compute, networking, data & storage)',
      'Idle, orphaned and under-utilised resource detection',
      'Right-sizing recommendations from Azure Monitor metrics',
      'Networking view — VNets, NSGs, Public IPs and private endpoints',
      'Interactive Architecture Map topology visualization',
      'Resource locks, VM power states and dependency / blast-radius mapping',
    ],
  },
  {
    group: 'AI-Powered Assessments',
    items: [
      'Azure Well-Architected (WAF) scorecard across all five pillars',
      'Cloud Adoption Framework (CAF) assessment',
      'SQL Modernization — PaaS / IaaS / Arc / on-prem → Azure SQL DB or Managed Instance',
      'App Service modernization — plan right-sizing, tier upgrades, Flex Consumption',
      'VM Performance — idle / over-utilised analysis and right-sizing',
      'Cloud Maturity scoring and modernization journey',
      'AI Executive Briefing (cross-category synthesis) + per-module narratives via Azure OpenAI',
    ],
  },
  {
    group: 'Security & Identity',
    items: [
      'Security posture, gaps and Microsoft Defender for Cloud signals',
      'Zero-Trust scorecard and attack-surface analysis',
      'RBAC / role-assignment and privileged-access signals',
      'Microsoft Entra ID posture — users, guests and service principals',
      'App-registration & credential hygiene (secret / certificate expiry) via Microsoft Graph',
    ],
  },
  {
    group: 'Resiliency & BCDR',
    items: [
      'Backup coverage analysis — protected vs unprotected resources',
      'RPO/RTO matrix and ransomware-readiness assessment',
      'BCDR assessment with availability-zone & region resilience',
      'DR testing plans, business-impact analysis and recovery-sequence planning',
      'Region-aware guidance (e.g. Qatar Central pairing / Region-of-Choice)',
    ],
  },
  {
    group: 'Governance & Management',
    items: [
      'Azure Policy compliance, exemptions and management-group governance',
      'Azure Advisor across cost, security, reliability, performance & operational excellence',
      'Tagging analytics and required-tag compliance',
      'Projects — portal-style resource grouping and scoping',
      'Assessments hub with exportable PDF / Excel reports',
    ],
  },
  {
    group: 'Operations',
    items: [
      'Monitoring and Azure Monitor metrics',
      'Update Management — patch / hotfix status',
      'Service Health — active issues, planned maintenance and security advisories',
      'Quota & Capacity — vCPU limits, near-limit quotas and regional availability',
    ],
  },
  {
    group: 'Hybrid, Arc & On-Premises',
    items: [
      'Azure Arc-enabled servers and the hybrid estate',
      'On-premises discovery via LDAP / WinRM with software inventory',
      'Software governance and licensing optimization (e.g. Azure Hybrid Benefit) with reservation analysis',
    ],
  },
  {
    group: 'Platform & Security',
    items: [
      'Microsoft Entra ID sign-in (login / logout) — no anonymous access',
      'Read-only access via system-assigned managed identity — no changes are made to your estate',
      'Multi-subscription and management-group scope',
      'Live Azure data with optional Redis L2 cache and Azure SQL history',
      'Public or fully private deployment (App Service / Container Apps + Private Endpoints)',
    ],
  },
]

const FAQS = [
  { q: 'What does this solution accelerator do?', a: 'It is a unified FinOps and cloud-operations console for Azure — cost optimization, resource and infrastructure inventory, AI-powered Well-Architected / CAF / modernization assessments, security & identity posture, resiliency (BCDR), governance, operations and hybrid/Arc insights across one or many subscriptions.' },
  { q: 'Does it make any changes to my Azure environment?', a: 'No. The tool is strictly read-only. It reads metadata, metrics and cost data and never creates, modifies or deletes any Azure resource.' },
  { q: 'How does the application authenticate to Azure?', a: 'In production it uses the app’s system-assigned managed identity with least-privilege, read-only roles. No secrets or API keys are stored. For local development it can use a service principal or your az login.' },
  { q: 'How is access to the portal protected?', a: 'Sign-in is enforced with Microsoft Entra ID (MSAL, authorization-code + PKCE). Users must authenticate before any data is shown and can sign out at any time — there is no anonymous access.' },
  { q: 'What Azure RBAC roles are required?', a: 'Reader and Cost Management Reader at the scope you analyze. Optionally Management Group Reader and Reservations Reader for the management-group hierarchy and reservation insights. All are read-only.' },
  { q: 'What Microsoft Graph permissions are required, and why?', a: 'Directory.Read.All, Application.Read.All and User.Read.All — used by the Identity & Access module to surface users, guests, service principals and app-registration secret/certificate expiry. They are read-only and require admin consent.' },
  { q: 'Which subscriptions does it cover?', a: 'One or many. Set AZURE_SUBSCRIPTION_IDS for multiple subscriptions; the scope selector also supports management groups when the identity has Management Group Reader.' },
  { q: 'Is my data sent anywhere outside my tenant?', a: 'No. All queries run within your tenant against Azure APIs, and AI features use your own Azure OpenAI resource, so prompts stay in your subscription.' },
  { q: 'Is AI required to use the tool?', a: 'No. AI is optional. With Azure OpenAI configured you get executive briefings and per-module narratives; without it, all rule-based analysis still works.' },
  { q: 'How fresh is the data, and how is it cached?', a: 'Data is read live from Azure. An optional Redis L2 cache speeds repeat loads and an optional Azure SQL store persists cost/scan history for trends. Without them the app still runs using an in-process cache and SQLite.' },
  { q: 'Can it be deployed fully private?', a: 'Yes. Both deployments support private topologies — VNet integration and Private Endpoints for the app, Azure OpenAI, SQL and Redis, reusing your existing Private DNS zones.' },
  { q: 'How do I deploy it to my Azure environment?', a: 'Two PowerShell scripts are provided: deploy-appservice.ps1 (Azure App Service — ideal for regions without Container Apps, e.g. Qatar Central) and deploy-automated.ps1 (Azure Container Apps). Both create the resources, managed identity, RBAC and Microsoft Graph permissions automatically.' },
  { q: 'Does it work in Qatar Central?', a: 'Yes. Use the App Service deployment in Qatar Central; Azure OpenAI (not offered there) is provisioned in a nearby supported region and reached over a Private Endpoint in private mode.' },
  { q: 'What is the Architecture Map, and is it always available?', a: 'It is an interactive topology view. It is included in the Container Apps deployment; the App Service deployment omits it because it requires a side-car container.' },
  { q: 'Can I export reports?', a: 'Yes. Assessments and dashboards can be exported to PDF and Excel for sharing with stakeholders.' },
]

function PageHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, color: C.textStrong, margin: 0 }}>{title}</h1>
      {subtitle && <p style={{ fontSize: 13, color: C.muted, margin: '6px 0 0' }}>{subtitle}</p>}
    </div>
  )
}

function DeveloperCard() {
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        padding: 28,
        maxWidth: 520,
        boxShadow: '0 1.6px 3.6px rgba(0,0,0,.06)',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.primary, marginBottom: 12 }}>
        Solution Accelerator Developed by
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: C.textStrong, lineHeight: 1.2 }}>Zahir Hussain Shah</div>
      <div style={{ fontSize: 14, color: C.text, marginTop: 4 }}>Senior Cloud Solution Architect</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <MicrosoftLogo size={16} />
        <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Microsoft Qatar</span>
      </div>

      <div style={{ height: 1, background: C.border, margin: '20px 0' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 8 }}>
        <span aria-hidden="true">✉️</span>
        <a href="mailto:zahir@zahir.cloud" style={{ color: C.primary, textDecoration: 'none' }}>zahir@zahir.cloud</a>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
        <span aria-hidden="true">🌐</span>
        <a href="https://www.zahir.cloud" target="_blank" rel="noopener noreferrer" style={{ color: C.primary, textDecoration: 'none' }}>www.zahir.cloud</a>
      </div>
    </div>
  )
}

function FeaturesGrid() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14, alignItems: 'start' }}>
      {FEATURE_GROUPS.map((g, gi) => {
        const accent = GROUP_ACCENTS[gi % GROUP_ACCENTS.length]
        const Icon = accent.Icon
        return (
          <div key={g.group} style={{ background: C.panel, border: `1px solid ${C.border}`, borderTop: `3px solid ${accent.color}`, borderRadius: 8, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ width: 30, height: 30, borderRadius: 7, background: `${accent.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={16} color={accent.color} />
              </span>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.textStrong }}>{g.group}</span>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {g.items.map((it, i) => (
                <li key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: C.text, lineHeight: 1.45 }}>
                  <span style={{ color: accent.color, flexShrink: 0, marginTop: 1, fontSize: 11 }}>▸</span>
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

function FaqList() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 820 }}>
      {FAQS.map((f) => (
        <div key={f.q} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.textStrong }}>{f.q}</div>
          <p style={{ fontSize: 13, color: C.muted, margin: '8px 0 0', lineHeight: 1.55 }}>{f.a}</p>
        </div>
      ))}
    </div>
  )
}

export default function About({ tab = 'about' }) {
  const meta = {
    about: { title: 'About', subtitle: 'Azure Infra IQ — AI Powered Azure Infrastructure Management and Insights.' },
    features: { title: 'Features', subtitle: 'What this solution accelerator provides.' },
    faqs: { title: 'FAQs', subtitle: 'Frequently asked questions.' },
  }[tab] || { title: 'About', subtitle: '' }

  return (
    <div style={{ fontFamily: FONT, maxWidth: 1000 }}>
      <PageHeader title={meta.title} subtitle={meta.subtitle} />
      {tab === 'about' && <DeveloperCard />}
      {tab === 'features' && <FeaturesGrid />}
      {tab === 'faqs' && <FaqList />}
    </div>
  )
}
