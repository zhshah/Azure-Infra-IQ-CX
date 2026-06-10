/**
 * APEX Artifact Export Utilities
 * 
 * Provides multi-format export for assessment artifacts:
 * - PDF: Professional formatted document using @react-pdf/renderer
 * - TXT: Plain text with markdown stripped
 * - PNG/DRAWIO: Diagram rendering via Draw.io MCP service with Azure icons
 * - Full Report PDF: Combined all-artifacts document
 */

import React from 'react';
import { pdf, Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

// ── API Configuration ────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8001';

// ── Color Palette (matches app dark theme) ───────────────────────────────────

const C = {
  bg:        '#0f172a',
  bgCard:    '#1e293b',
  accent:    '#3b82f6',
  accentDim: '#1d4ed8',
  success:   '#22c55e',
  danger:    '#ef4444',
  text:      '#f1f5f9',
  textMuted: '#94a3b8',
  textDim:   '#64748b',
  border:    '#334155',
  white:     '#ffffff',
};

// ── Agent Output → Markdown Formatter ────────────────────────────────────────
// Converts JSON agent output into properly structured markdown for export

function renderArrayAsMd(arr, indent = '') {
  if (!Array.isArray(arr)) return '';
  return arr.map(item => {
    if (typeof item === 'object' && item !== null) {
      const lines = Object.entries(item).map(([k, v]) => `${indent}- **${k}**: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
      return lines.join('\n');
    }
    return `${indent}- ${item}`;
  }).join('\n');
}

function renderObjectAsMd(obj, headingLevel = 3) {
  if (!obj || typeof obj !== 'object') return String(obj || '');
  const prefix = '#'.repeat(headingLevel);
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    const label = key.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    if (Array.isArray(value)) {
      lines.push(`${prefix} ${label}\n`);
      lines.push(renderArrayAsMd(value));
      lines.push('');
    } else if (typeof value === 'object' && value !== null) {
      lines.push(`${prefix} ${label}\n`);
      lines.push(renderObjectAsMd(value, headingLevel + 1));
      lines.push('');
    } else {
      lines.push(`- **${label}**: ${value}`);
    }
  }
  return lines.join('\n');
}

export function formatAgentOutputToMarkdown(agentName, rawContent) {
  // Try to parse as JSON
  let data;
  try {
    data = typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent;
  } catch {
    // Already markdown or plain text — return as-is
    return rawContent || '';
  }

  // If not an object/array, return as string
  if (typeof data !== 'object' || data === null) return String(data);

  // Route to agent-specific formatters
  switch (agentName) {
    case '02-requirements':
      return formatRequirements(data);
    case '03-architect':
      return formatArchitecture(data);
    case '04-design':
      return formatDesign(data);
    case '04g-governance':
      return formatGovernance(data);
    case '05-iac-planner':
      return formatIaCPlanning(data);
    case '06b-bicep-codegen':
      return formatBicepCodegen(data);
    case '08-as-built':
      return formatAsBuilt(data);
    default:
      return formatGenericAgent(agentName, data);
  }
}

function formatRequirements(data) {
  const lines = ['# Requirements Analysis\n'];
  
  // New rich format: project_name + business_context
  if (data.project_name) {
    lines.push(`## Project: ${data.project_name}\n`);
  }
  
  if (data.business_context) {
    lines.push('## Business Context\n');
    const bc = data.business_context;
    if (bc.description) lines.push(`${bc.description}\n`);
    if (bc.environment) lines.push(`- **Environment**: ${bc.environment}`);
    if (bc.criticality) lines.push(`- **Criticality**: ${bc.criticality}`);
    if (bc.industry_indicators?.length) lines.push(`- **Industry**: ${bc.industry_indicators.join(', ')}`);
    lines.push('');
  }
  
  // New format: functional_requirements array with IDs
  if (data.functional_requirements?.length) {
    lines.push('## Functional Requirements\n');
    lines.push('| ID | Title | Priority | Source Resources |');
    lines.push('|----|-------|----------|-----------------|');
    data.functional_requirements.forEach(r => {
      if (typeof r === 'object') {
        const id = r.id || '';
        const title = r.title || r.name || '';
        const priority = r.priority || '';
        const sources = Array.isArray(r.source_resources) ? r.source_resources.join(', ') : (r.source_resources || '');
        lines.push(`| ${id} | ${title} | ${priority} | ${sources} |`);
        if (r.description) lines.push(`\n   > ${r.description}\n`);
      } else {
        lines.push(`| — | ${r} | — | — |`);
      }
    });
    lines.push('');
  }
  // Legacy format
  else if (data.requirements?.length) {
    lines.push('## Functional Requirements\n');
    data.requirements.forEach((r, i) => {
      if (typeof r === 'object') {
        lines.push(`${i + 1}. **${r.title || r.name || 'Requirement'}**: ${r.description || r.detail || JSON.stringify(r)}`);
      } else {
        lines.push(`${i + 1}. ${r}`);
      }
    });
    lines.push('');
  }
  
  // New format: non_functional_requirements object with categories
  if (data.non_functional_requirements && typeof data.non_functional_requirements === 'object') {
    lines.push('## Non-Functional Requirements\n');
    const nfr = data.non_functional_requirements;
    
    if (nfr.availability) {
      lines.push('### Availability');
      lines.push(`- **SLA Target**: ${nfr.availability.sla_target || 'N/A'}`);
      if (nfr.availability.justification) lines.push(`- **Justification**: ${nfr.availability.justification}`);
      if (nfr.availability.current_config) lines.push(`- **Current Config**: ${nfr.availability.current_config}`);
      lines.push('');
    }
    if (nfr.performance) {
      lines.push('### Performance');
      if (nfr.performance.response_time) lines.push(`- **Response Time**: ${nfr.performance.response_time}`);
      if (nfr.performance.throughput) lines.push(`- **Throughput**: ${nfr.performance.throughput}`);
      if (nfr.performance.current_sku_sizing) lines.push(`- **Current SKU Sizing**: ${nfr.performance.current_sku_sizing}`);
      lines.push('');
    }
    if (nfr.scalability) {
      lines.push('### Scalability');
      if (nfr.scalability.current_scale) lines.push(`- **Current Scale**: ${nfr.scalability.current_scale}`);
      if (nfr.scalability.growth_projection) lines.push(`- **Growth Projection**: ${nfr.scalability.growth_projection}`);
      if (nfr.scalability.autoscaling_config) lines.push(`- **Autoscaling**: ${nfr.scalability.autoscaling_config}`);
      lines.push('');
    }
    if (nfr.security) {
      lines.push('### Security');
      if (nfr.security.network_isolation) lines.push(`- **Network Isolation**: ${nfr.security.network_isolation}`);
      if (nfr.security.identity) lines.push(`- **Identity**: ${nfr.security.identity}`);
      if (nfr.security.encryption) lines.push(`- **Encryption**: ${nfr.security.encryption}`);
      if (nfr.security.compliance?.length) lines.push(`- **Compliance**: ${nfr.security.compliance.join(', ')}`);
      lines.push('');
    }
    if (nfr.disaster_recovery) {
      lines.push('### Disaster Recovery');
      if (nfr.disaster_recovery.rpo) lines.push(`- **RPO**: ${nfr.disaster_recovery.rpo}`);
      if (nfr.disaster_recovery.rto) lines.push(`- **RTO**: ${nfr.disaster_recovery.rto}`);
      if (nfr.disaster_recovery.current_dr_posture) lines.push(`- **Current DR Posture**: ${nfr.disaster_recovery.current_dr_posture}`);
      if (nfr.disaster_recovery.geo_redundancy) lines.push(`- **Geo-Redundancy**: ${nfr.disaster_recovery.geo_redundancy}`);
      lines.push('');
    }
  }
  // Legacy format
  else if (data.nfr?.length) {
    lines.push('## Non-Functional Requirements\n');
    data.nfr.forEach((r, i) => {
      if (typeof r === 'object') {
        lines.push(`${i + 1}. **${r.category || r.name || 'NFR'}**: ${r.requirement || r.description || JSON.stringify(r)}`);
      } else {
        lines.push(`${i + 1}. ${r}`);
      }
    });
    lines.push('');
  }
  
  // New format: infrastructure_requirements
  if (data.infrastructure_requirements?.length) {
    lines.push('## Infrastructure Requirements\n');
    lines.push('| ID | Title | Current State | Target State |');
    lines.push('|----|-------|---------------|--------------|');
    data.infrastructure_requirements.forEach(r => {
      if (typeof r === 'object') {
        lines.push(`| ${r.id || ''} | ${r.title || ''} | ${r.current_state || ''} | ${r.target_state || ''} |`);
      }
    });
    lines.push('');
  }
  
  // New format: dependency_requirements
  if (data.dependency_requirements?.length) {
    lines.push('## Resource Dependencies\n');
    data.dependency_requirements.forEach(d => {
      if (typeof d === 'object') {
        lines.push(`- **${d.from_resource}** → **${d.to_resource}** (${d.dependency_type || 'depends'}): ${d.description || ''}`);
      }
    });
    lines.push('');
  }
  
  // Legacy BCDR targets
  if (data.bcdr_targets) {
    lines.push('## BCDR Targets\n');
    if (typeof data.bcdr_targets === 'object') {
      Object.entries(data.bcdr_targets).forEach(([k, v]) => {
        lines.push(`- **${k.toUpperCase()}**: ${v}`);
      });
    } else {
      lines.push(`- ${data.bcdr_targets}`);
    }
    lines.push('');
  }
  
  // New format: constraints
  if (data.constraints) {
    lines.push('## Constraints\n');
    const c = data.constraints;
    if (c.qatar_central) {
      lines.push('### Qatar Central Constraints');
      if (c.qatar_central.no_zone_redundancy) lines.push('- ⚠️ No availability zone redundancy available');
      if (c.qatar_central.no_paired_region) lines.push('- ⚠️ No paired region — manual DR required');
      if (c.qatar_central.data_residency) lines.push(`- 🔒 Data residency: ${c.qatar_central.data_residency}`);
      lines.push('');
    }
    if (c.existing_investments?.length) {
      lines.push('### Existing Investments');
      c.existing_investments.forEach(inv => lines.push(`- ${inv}`));
      lines.push('');
    }
    if (c.budget_indicators) lines.push(`- **Budget Indicators**: ${c.budget_indicators}\n`);
  }
  
  if (data.compliance_requirements?.length) {
    lines.push('## Compliance Requirements\n');
    data.compliance_requirements.forEach(c => {
      if (typeof c === 'object') {
        lines.push(`- **${c.framework || c.name || 'Compliance'}**: ${c.description || c.requirement || JSON.stringify(c)}`);
      } else {
        lines.push(`- ${c}`);
      }
    });
    lines.push('');
  }
  // Legacy
  else if (data.compliance?.length) {
    lines.push('## Compliance Requirements\n');
    data.compliance.forEach(c => {
      if (typeof c === 'object') {
        lines.push(`- **${c.framework || c.name || 'Compliance'}**: ${c.description || c.requirement || JSON.stringify(c)}`);
      } else {
        lines.push(`- ${c}`);
      }
    });
    lines.push('');
  }

  return lines.join('\n');
}

function formatArchitecture(data) {
  const lines = ['# Architecture Design\n'];
  
  if (data.architecture_pattern) {
    lines.push(`## Architecture Pattern\n`);
    lines.push(`**${data.architecture_pattern}**\n`);
  }
  
  if (data.architecture_summary) {
    lines.push('## Architecture Summary\n');
    lines.push(`${data.architecture_summary}\n`);
  }
  
  // WAF Assessment (new rich format)
  if (data.waf_assessment) {
    lines.push('## Well-Architected Framework Assessment\n');
    lines.push('| Pillar | Score | Current State |');
    lines.push('|--------|-------|---------------|');
    const pillars = ['reliability', 'security', 'cost_optimization', 'operational_excellence', 'performance_efficiency'];
    pillars.forEach(pillar => {
      const p = data.waf_assessment[pillar];
      if (p) {
        const label = pillar.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const scoreBar = '█'.repeat(Math.round((p.score || 0))) + '░'.repeat(10 - Math.round((p.score || 0)));
        lines.push(`| ${label} | ${scoreBar} ${p.score || 0}/10 | ${p.current_state || ''} |`);
      }
    });
    lines.push('');
    
    // Show gaps and recommendations per pillar
    pillars.forEach(pillar => {
      const p = data.waf_assessment[pillar];
      if (p && (p.gaps?.length || p.recommendations?.length)) {
        const label = pillar.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        lines.push(`### ${label}\n`);
        if (p.gaps?.length) {
          lines.push('**Gaps:**');
          p.gaps.forEach(g => lines.push(`- ⚠️ ${typeof g === 'object' ? JSON.stringify(g) : g}`));
        }
        if (p.recommendations?.length) {
          lines.push('**Recommendations:**');
          p.recommendations.forEach(r => lines.push(`- ✅ ${typeof r === 'object' ? JSON.stringify(r) : r}`));
        }
        lines.push('');
      }
    });
  }
  
  if (data.components?.length) {
    lines.push('## Components\n');
    lines.push('| # | Name | Type | SKU | Purpose | Tier |');
    lines.push('|---|------|------|-----|---------|------|');
    data.components.forEach((c, i) => {
      if (typeof c === 'object') {
        const name = c.name || c.service || 'Component';
        const type = c.type || '';
        const sku = c.current_sku || c.recommended_sku || '';
        const purpose = c.purpose || c.description || '';
        const tier = c.tier || '';
        lines.push(`| ${i + 1} | **${name}** | ${type} | ${sku} | ${purpose} | ${tier} |`);
      } else {
        lines.push(`| ${i + 1} | ${c} | — | — | — | — |`);
      }
    });
    lines.push('');
  }
  
  // SKU Recommendations (new)
  if (data.sku_recommendations?.length) {
    lines.push('## SKU Recommendations\n');
    lines.push('| Resource | Current SKU | Recommended | Reason | Cost Impact |');
    lines.push('|----------|-------------|-------------|--------|-------------|');
    data.sku_recommendations.forEach(r => {
      if (typeof r === 'object') {
        lines.push(`| ${r.resource || ''} | ${r.current_sku || ''} | ${r.recommended_sku || ''} | ${r.reason || ''} | ${r.monthly_cost_impact || ''} |`);
      }
    });
    lines.push('');
  }
  
  if (data.network_design) {
    lines.push('## Network Design\n');
    if (typeof data.network_design === 'object') {
      if (data.network_design.topology) lines.push(`- **Topology**: ${data.network_design.topology}`);
      if (data.network_design.connectivity) lines.push(`- **Connectivity**: ${data.network_design.connectivity}`);
      if (data.network_design.vnets?.length) {
        lines.push('- **VNets**:');
        data.network_design.vnets.forEach(v => lines.push(`  - ${typeof v === 'object' ? JSON.stringify(v) : v}`));
      }
      if (data.network_design.private_endpoints?.length) {
        lines.push('- **Private Endpoints**:');
        data.network_design.private_endpoints.forEach(pe => lines.push(`  - ${typeof pe === 'object' ? JSON.stringify(pe) : pe}`));
      }
      // Fallback for simple format
      Object.entries(data.network_design).forEach(([k, v]) => {
        if (!['topology', 'connectivity', 'vnets', 'private_endpoints', 'subnets', 'nsg_rules_summary'].includes(k)) return;
        if (k === 'topology' || k === 'connectivity') return; // already handled
        const label = k.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        if (typeof v === 'string') lines.push(`- **${label}**: ${v}`);
      });
    } else {
      lines.push(`- ${data.network_design}`);
    }
    lines.push('');
  }
  
  if (data.data_flow?.length) {
    lines.push('## Data Flow\n');
    data.data_flow.forEach((f, i) => {
      if (typeof f === 'object') {
        const from = f.from || f.source || '';
        const to = f.to || f.target || '';
        const protocol = f.protocol || '';
        const desc = f.description || '';
        const security = f.security || '';
        lines.push(`${i + 1}. **${from}** → **${to}**${protocol ? ` (${protocol})` : ''}`);
        if (desc) lines.push(`   - ${desc}`);
        if (security) lines.push(`   - Security: ${security}`);
      } else {
        lines.push(`${i + 1}. ${f}`);
      }
    });
    lines.push('');
  }

  // Reliability Design (new)
  if (data.reliability_design) {
    lines.push('## Reliability Design\n');
    const rd = data.reliability_design;
    if (rd.ha_strategy) lines.push(`- **HA Strategy**: ${rd.ha_strategy}`);
    if (rd.dr_strategy) lines.push(`- **DR Strategy**: ${rd.dr_strategy}`);
    if (rd.backup_design) lines.push(`- **Backup Design**: ${rd.backup_design}`);
    if (rd.failover_mechanism) lines.push(`- **Failover Mechanism**: ${rd.failover_mechanism}`);
    lines.push('');
  }
  
  // Security Design (new)
  if (data.security_design) {
    lines.push('## Security Design\n');
    const sd = data.security_design;
    if (sd.identity_model) lines.push(`- **Identity Model**: ${sd.identity_model}`);
    if (sd.network_security) lines.push(`- **Network Security**: ${sd.network_security}`);
    if (sd.data_protection) lines.push(`- **Data Protection**: ${sd.data_protection}`);
    if (sd.compliance_alignment?.length) lines.push(`- **Compliance**: ${sd.compliance_alignment.join(', ')}`);
    lines.push('');
  }
  
  // Cost Estimate (new)
  if (data.cost_estimate) {
    lines.push('## Cost Estimate\n');
    const ce = data.cost_estimate;
    if (ce.current_monthly) lines.push(`- **Current Monthly**: ${ce.current_monthly}`);
    if (ce.optimized_monthly) lines.push(`- **Optimized Monthly**: ${ce.optimized_monthly}`);
    if (ce.savings_potential) lines.push(`- **Savings Potential**: ${ce.savings_potential}`);
    lines.push('');
  }

  if (data.integration_points?.length) {
    lines.push('## Integration Points\n');
    data.integration_points.forEach(p => {
      if (typeof p === 'object') {
        const svcA = p.service_a || p.from || '';
        const svcB = p.service_b || p.to || '';
        const type = p.integration_type || p.type || '';
        lines.push(`- **${svcA}** ↔ **${svcB}**${type ? ` (${type})` : ''}${p.description ? `: ${p.description}` : ''}`);
      } else {
        lines.push(`- ${p}`);
      }
    });
    lines.push('');
  }

  // Generate mermaid diagram from architecture data
  lines.push('## Architecture Diagram\n');
  lines.push('```mermaid');
  lines.push('graph TB');
  lines.push('  subgraph "Azure Cloud"');
  if (data.components?.length) {
    const nodes = data.components.map((c, i) => {
      const name = typeof c === 'object' ? (c.name || c.service || `Component${i}`) : c;
      const id = `C${i}`;
      return { id, name };
    });
    nodes.forEach(n => {
      lines.push(`    ${n.id}["${n.name.replace(/"/g, "'")}"]`);
    });
    // Use data_flow for edges if available, else sequential
    if (data.data_flow?.length) {
      const nameToId = {};
      nodes.forEach(n => { nameToId[n.name.toLowerCase()] = n.id; });
      data.data_flow.forEach(f => {
        if (typeof f === 'object') {
          const from = (f.from || f.source || '').toLowerCase();
          const to = (f.to || f.target || '').toLowerCase();
          const srcId = nameToId[from] || nodes.find(n => n.name.toLowerCase().includes(from))?.id;
          const tgtId = nameToId[to] || nodes.find(n => n.name.toLowerCase().includes(to))?.id;
          if (srcId && tgtId) {
            const label = f.protocol || '';
            lines.push(`    ${srcId} -->|${label}| ${tgtId}`);
          }
        }
      });
    } else {
      for (let i = 0; i < nodes.length - 1; i++) {
        lines.push(`    ${nodes[i].id} --> ${nodes[i + 1].id}`);
      }
    }
  } else {
    lines.push('    Client["Client"] --> FrontDoor["Front Door"]');
    lines.push('    FrontDoor --> App["Application"]');
    lines.push('    App --> DB["Database"]');
  }
  lines.push('  end');
  lines.push('```\n');
  
  return lines.join('\n');
}

function formatDesign(data) {
  const lines = ['# Detailed Design\n'];
  
  if (data.compute_design?.length) {
    lines.push('## Compute Design\n');
    lines.push('| Resource | SKU | Scaling | Network | Identity |');
    lines.push('|----------|-----|---------|---------|----------|');
    data.compute_design.forEach((c) => {
      if (typeof c === 'object') {
        const name = c.resource_name || c.vm_name || c.resource || c.name || 'Compute';
        const sku = c.sku || c.vm_size || '';
        const scaling = c.scaling_policy ? (typeof c.scaling_policy === 'object' ? JSON.stringify(c.scaling_policy) : c.scaling_policy) : '';
        const network = c.networking ? (typeof c.networking === 'object' ? `${c.networking.vnet || ''}/${c.networking.subnet || ''}` : c.networking) : '';
        const identity = c.managed_identity ? 'Managed Identity' : '';
        lines.push(`| **${name}** | ${sku} | ${scaling.slice(0, 30)} | ${network} | ${identity} |`);
        // Show target config details if present
        if (c.target_config && typeof c.target_config === 'object') {
          Object.entries(c.target_config).forEach(([k, v]) => {
            lines.push(`  - ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
          });
        }
      } else {
        lines.push(`| ${c} | — | — | — | — |`);
      }
    });
    lines.push('');
  }
  
  // Database Design (new rich format)
  if (data.database_design?.length) {
    lines.push('## Database Design\n');
    lines.push('| Resource | Engine | Version | SKU | HA | Backup |');
    lines.push('|----------|--------|---------|-----|----|--------|');
    data.database_design.forEach(db => {
      if (typeof db === 'object') {
        const name = db.resource_name || db.name || 'Database';
        const engine = db.engine || '';
        const version = db.version || '';
        const sku = db.sku || '';
        const ha = db.ha_config ? (typeof db.ha_config === 'object' ? JSON.stringify(db.ha_config) : db.ha_config) : '';
        const backup = db.backup_config ? (typeof db.backup_config === 'object' ? JSON.stringify(db.backup_config) : db.backup_config) : '';
        lines.push(`| **${name}** | ${engine} | ${version} | ${sku} | ${ha.slice(0, 20)} | ${backup.slice(0, 20)} |`);
      }
    });
    lines.push('');
  }
  
  if (data.storage_design?.length) {
    lines.push('## Storage Design\n');
    lines.push('| Resource | Type | Replication | Access Tier | Network Rules |');
    lines.push('|----------|------|-------------|-------------|---------------|');
    data.storage_design.forEach((s) => {
      if (typeof s === 'object') {
        const name = s.resource_name || s.storage_account_name || s.type || s.name || 'Storage';
        const type = s.account_type || s.kind || s.sku || '';
        const replication = s.replication || '';
        const tier = s.access_tier || '';
        const network = s.network_rules ? (typeof s.network_rules === 'object' ? JSON.stringify(s.network_rules) : s.network_rules) : '';
        lines.push(`| **${name}** | ${type} | ${replication} | ${tier} | ${network.slice(0, 25)} |`);
      } else {
        lines.push(`| ${s} | — | — | — | — |`);
      }
    });
    lines.push('');
  }
  
  if (data.network_security?.length) {
    lines.push('## Network Security\n');
    data.network_security.forEach((n) => {
      if (typeof n === 'object') {
        const name = n.resource_name || n.network_security_group_name || n.rule || n.name || 'Rule';
        const type = n.type || 'NSG';
        const purpose = n.purpose || n.description || '';
        lines.push(`### ${name} (${type})\n`);
        if (purpose) lines.push(`${purpose}\n`);
        if (n.rules?.length) {
          lines.push('| Priority | Direction | Access | Protocol | Source | Destination |');
          lines.push('|----------|-----------|--------|----------|--------|-------------|');
          n.rules.forEach(rule => {
            if (typeof rule === 'object') {
              lines.push(`| ${rule.priority || ''} | ${rule.direction || ''} | ${rule.access || ''} | ${rule.protocol || ''} | ${rule.source || ''} | ${rule.destination || ''} |`);
            } else {
              lines.push(`| — | — | — | — | ${rule} | — |`);
            }
          });
        }
        if (n.associated_resources?.length) {
          lines.push(`\nAssociated: ${n.associated_resources.join(', ')}`);
        }
        lines.push('');
      } else {
        lines.push(`- ${n}`);
      }
    });
    lines.push('');
  }
  
  if (data.identity?.length) {
    lines.push('## Identity & Access Management\n');
    lines.push('| Principal | Type | Roles | Scope | Purpose |');
    lines.push('|-----------|------|-------|-------|---------|');
    data.identity.forEach(id => {
      if (typeof id === 'object') {
        const principal = id.principal || id.name || 'Identity';
        const type = id.type || '';
        const roles = Array.isArray(id.roles) ? id.roles.join(', ') : (id.roles || id.role || '');
        const scope = id.scope || '';
        const purpose = id.purpose || id.description || '';
        lines.push(`| **${principal}** | ${type} | ${roles} | ${scope} | ${purpose} |`);
      } else {
        lines.push(`| ${id} | — | — | — | — |`);
      }
    });
    lines.push('');
  }
  
  if (data.monitoring?.length) {
    lines.push('## Monitoring & Alerting\n');
    data.monitoring.forEach(m => {
      if (typeof m === 'object') {
        const name = m.resource_name || m.tool || m.name || 'Monitor';
        lines.push(`### ${name}\n`);
        if (m.metrics?.length) lines.push(`- **Metrics**: ${m.metrics.join(', ')}`);
        if (m.alerts?.length) lines.push(`- **Alerts**: ${m.alerts.map(a => typeof a === 'object' ? a.name || JSON.stringify(a) : a).join(', ')}`);
        if (m.log_categories?.length) lines.push(`- **Log Categories**: ${m.log_categories.join(', ')}`);
        if (m.workspace) lines.push(`- **Workspace**: ${m.workspace}`);
        if (m.retention_days) lines.push(`- **Retention**: ${m.retention_days} days`);
        lines.push('');
      } else {
        lines.push(`- ${m}`);
      }
    });
    lines.push('');
  }

  // Mermaid diagram if provided
  if (data.mermaid_architecture_diagram) {
    lines.push('## Design Diagram\n');
    // Strip markdown code fences if already wrapped
    const mermaid = data.mermaid_architecture_diagram
      .replace(/^```mermaid\n?/, '')
      .replace(/\n?```$/, '');
    lines.push('```mermaid');
    lines.push(mermaid);
    lines.push('```\n');
  } else {
    // Generate design diagram
    lines.push('## Design Diagram\n');
    lines.push('```mermaid');
    lines.push('graph LR');
    const pickName = (obj, ...fallbacks) => {
      if (typeof obj !== 'object' || !obj) return String(obj || 'Item');
      for (const k of fallbacks) if (obj[k]) return obj[k];
      const nameKey = Object.keys(obj).find(k => /name$/i.test(k));
      if (nameKey && obj[nameKey]) return obj[nameKey];
      return fallbacks[fallbacks.length - 1] || 'Item';
    };
    lines.push('  subgraph "Network Security"');
    if (data.network_security?.length) {
      data.network_security.forEach((n, i) => {
        const name = pickName(n, 'resource_name', 'network_security_group_name', 'rule', 'name', `NSG${i}`);
        lines.push(`    NSG${i}["${String(name).replace(/"/g, "'").slice(0, 30)}"]`);
      });
    } else {
      lines.push('    NSG["NSG Rules"]');
    }
    lines.push('  end');
    lines.push('  subgraph "Compute"');
    if (data.compute_design?.length) {
      data.compute_design.forEach((c, i) => {
        const name = pickName(c, 'resource_name', 'vm_name', 'resource', 'name', `Compute${i}`);
        lines.push(`    COMP${i}["${String(name).replace(/"/g, "'").slice(0, 30)}"]`);
      });
    } else {
      lines.push('    APP["Application"]');
    }
    lines.push('  end');
    lines.push('  subgraph "Data"');
    if (data.storage_design?.length || data.database_design?.length) {
      (data.database_design || []).forEach((d, i) => {
        const name = pickName(d, 'resource_name', 'name', `DB${i}`);
        lines.push(`    DB${i}["${String(name).replace(/"/g, "'").slice(0, 30)}"]`);
      });
      (data.storage_design || []).forEach((s, i) => {
        const name = pickName(s, 'resource_name', 'storage_account_name', 'type', 'name', `Storage${i}`);
        lines.push(`    STR${i}["${String(name).replace(/"/g, "'").slice(0, 30)}"]`);
      });
    } else {
      lines.push('    DB["Database"]');
    }
    lines.push('  end');
    lines.push('  NSG0 --> COMP0');
    lines.push('  COMP0 --> DB0');
    lines.push('```\n');
  }

  return lines.join('\n');
}

function formatGovernance(data) {
  const lines = ['# Governance Framework\n'];
  
  if (data.policies?.length) {
    lines.push('## Azure Policies\n');
    lines.push('| Policy | Effect | Target Resources | Compliance | Remediation |');
    lines.push('|--------|--------|------------------|------------|-------------|');
    data.policies.forEach((p) => {
      if (typeof p === 'object') {
        const name = p.name || p.policy || 'Policy';
        const effect = p.effect || '';
        const targets = Array.isArray(p.target_resources) ? p.target_resources.join(', ') : (p.target_resources || '');
        const compliance = p.current_compliance || '';
        const remediation = p.remediation || '';
        lines.push(`| **${name}** | ${effect} | ${targets.slice(0, 30)} | ${compliance} | ${remediation.slice(0, 30)} |`);
        if (p.description) lines.push(`\n> ${p.description}\n`);
      } else {
        lines.push(`| ${p} | — | — | — | — |`);
      }
    });
    lines.push('');
  }
  
  if (data.naming_convention) {
    lines.push('## Naming Convention\n');
    if (typeof data.naming_convention === 'object') {
      if (data.naming_convention.pattern) lines.push(`**Pattern**: \`${data.naming_convention.pattern}\`\n`);
      if (data.naming_convention.current_compliance) lines.push(`**Current Compliance**: ${data.naming_convention.current_compliance}\n`);
      if (data.naming_convention.non_compliant_resources?.length) {
        lines.push('**Non-Compliant Resources:**');
        data.naming_convention.non_compliant_resources.forEach(r => lines.push(`- ⚠️ ${r}`));
      }
      // Legacy format: key-value pairs
      Object.entries(data.naming_convention).forEach(([k, v]) => {
        if (!['pattern', 'current_compliance', 'non_compliant_resources'].includes(k)) {
          lines.push(`- **${k}**: \`${v}\``);
        }
      });
    } else {
      lines.push(`Pattern: \`${data.naming_convention}\`\n`);
    }
    lines.push('');
  }
  
  if (data.tagging_strategy?.length) {
    lines.push('## Tagging Strategy\n');
    lines.push('| Tag Key | Required | Values | Coverage |');
    lines.push('|---------|----------|--------|----------|');
    data.tagging_strategy.forEach(t => {
      if (typeof t === 'object') {
        const key = t.tag_key || t.name || t.key || '';
        const required = t.required ? '✅ Yes' : 'Recommended';
        const values = Array.isArray(t.values) ? t.values.join(', ') : (t.values || '');
        const coverage = t.current_coverage || '';
        lines.push(`| \`${key}\` | ${required} | ${values.slice(0, 30)} | ${coverage} |`);
      } else {
        lines.push(`| ${t} | Required | — | — |`);
      }
    });
    lines.push('');
  }
  
  if (data.cost_controls?.length) {
    lines.push('## Cost Controls\n');
    data.cost_controls.forEach(c => {
      if (typeof c === 'object') {
        const name = c.control || c.name || 'Control';
        const type = c.type || '';
        const savings = c.estimated_savings || '';
        lines.push(`- **${name}**${type ? ` (${type})` : ''}: ${c.description || c.action || ''}`);
        if (savings) lines.push(`  - 💰 Estimated Savings: ${savings}`);
      } else {
        lines.push(`- ${c}`);
      }
    });
    lines.push('');
  }
  
  if (data.compliance_controls?.length) {
    lines.push('## Compliance Controls\n');
    lines.push('| Framework | Control | Status | Affected Resources | Remediation |');
    lines.push('|-----------|---------|--------|-------------------|-------------|');
    data.compliance_controls.forEach(c => {
      if (typeof c === 'object') {
        const framework = c.framework || '';
        const control = c.control_id || c.name || '';
        const status = c.status === 'met' ? '✅ Met' : c.status === 'partial' ? '⚠️ Partial' : '❌ Not Met';
        const affected = Array.isArray(c.affected_resources) ? c.affected_resources.join(', ') : (c.affected_resources || '');
        const remediation = c.remediation || '';
        lines.push(`| ${framework} | ${control} | ${status} | ${affected.slice(0, 25)} | ${remediation.slice(0, 30)} |`);
      } else {
        lines.push(`| — | ${c} | — | — | — |`);
      }
    });
    lines.push('');
  }
  
  // RBAC recommendations (new)
  if (data.rbac_recommendations?.length) {
    lines.push('## RBAC Recommendations\n');
    lines.push('| Role | Scope | Principal Type | Justification |');
    lines.push('|------|-------|----------------|---------------|');
    data.rbac_recommendations.forEach(r => {
      if (typeof r === 'object') {
        lines.push(`| ${r.role || ''} | ${r.scope || ''} | ${r.principal_type || ''} | ${r.justification || ''} |`);
      }
    });
    lines.push('');
  }

  return lines.join('\n');
}

function formatIaCPlanning(data) {
  const lines = ['# Infrastructure as Code Planning\n'];
  
  if (data.iac_tool) {
    lines.push(`## Tool Selection\n`);
    lines.push(`**Selected Tool**: ${data.iac_tool}\n`);
  }
  
  // Deployment strategy (new rich format)
  if (data.deployment_strategy) {
    lines.push('## Deployment Strategy\n');
    const ds = data.deployment_strategy;
    if (ds.approach) lines.push(`- **Approach**: ${ds.approach}`);
    if (ds.estimated_deployment_time) lines.push(`- **Estimated Time**: ${ds.estimated_deployment_time}`);
    if (ds.rollback_strategy) lines.push(`- **Rollback**: ${ds.rollback_strategy}`);
    lines.push('');
    
    if (ds.phases?.length) {
      lines.push('### Deployment Phases\n');
      ds.phases.forEach(phase => {
        if (typeof phase === 'object') {
          lines.push(`**Phase ${phase.phase || '?'}: ${phase.name || ''}**`);
          if (phase.description) lines.push(`${phase.description}`);
          if (phase.resources?.length) lines.push(`- Resources: ${phase.resources.join(', ')}`);
          if (phase.dependencies?.length) lines.push(`- Dependencies: ${phase.dependencies.join(', ')}`);
          lines.push('');
        }
      });
    }
  }
  
  if (data.modules?.length) {
    lines.push('## Module Structure\n');
    lines.push('| Module | Path | AVM Module | Resources | Dependencies |');
    lines.push('|--------|------|------------|-----------|--------------|');
    data.modules.forEach((m) => {
      if (typeof m === 'object') {
        const name = m.name || m.module || 'Module';
        const path = m.path || '';
        const avm = m.avm_module || '';
        const resources = Array.isArray(m.resources) ? m.resources.join(', ') : (m.resources || '');
        const deps = Array.isArray(m.dependencies) ? m.dependencies.join(', ') : (m.dependencies || '');
        lines.push(`| **${name}** | \`${path}\` | ${avm} | ${resources.slice(0, 30)} | ${deps.slice(0, 20)} |`);
        if (m.description) lines.push(`\n> ${m.description}\n`);
      } else {
        lines.push(`| \`${m}\` | — | — | — | — |`);
      }
    });
    lines.push('');
  }
  
  if (data.parameters?.length) {
    lines.push('## Parameters\n');
    lines.push('| Parameter | Type | Default Value | Source Resources |');
    lines.push('|-----------|------|---------------|-----------------|');
    data.parameters.forEach(p => {
      if (typeof p === 'object') {
        const name = p.name || p.param || '';
        const type = p.type || 'string';
        const defaultVal = p.default_value || p.default || '';
        const sources = Array.isArray(p.source_resources) ? p.source_resources.join(', ') : '';
        lines.push(`| \`${name}\` | ${type} | ${defaultVal} | ${sources} |`);
        if (p.description) lines.push(`  > ${p.description}`);
      } else {
        const parts = p.replace(/^param\s+/, '').split(/\s+/);
        lines.push(`| \`${parts[0]}\` | ${parts[1] || 'string'} | — | — |`);
      }
    });
    lines.push('');
  }
  
  // Parameter files (new)
  if (data.parameter_files?.length) {
    lines.push('## Parameter Files\n');
    data.parameter_files.forEach(pf => {
      if (typeof pf === 'object') {
        lines.push(`### ${pf.environment || 'Environment'} — \`${pf.file || ''}\`\n`);
        if (pf.key_values && typeof pf.key_values === 'object') {
          lines.push('```json');
          lines.push(JSON.stringify(pf.key_values, null, 2));
          lines.push('```\n');
        }
      }
    });
  }
  
  if (data.pipeline_stages?.length) {
    lines.push('## Deployment Pipeline\n');
    data.pipeline_stages.forEach((stage, i) => {
      if (typeof stage === 'object') {
        lines.push(`### ${i + 1}. ${stage.stage || stage.name || 'Stage'}\n`);
        if (stage.description) lines.push(`${stage.description}\n`);
        if (stage.commands?.length) {
          lines.push('```bash');
          stage.commands.forEach(cmd => lines.push(cmd));
          lines.push('```\n');
        }
      } else {
        lines.push(`${i + 1}. ${stage}`);
      }
    });
    lines.push('');
  }
  
  if (data.environments?.length) {
    lines.push('## Environment Strategy\n');
    data.environments.forEach(env => {
      if (typeof env === 'object') {
        lines.push(`- **${env.name || env.environment || 'Environment'}**${env.purpose ? `: ${env.purpose}` : ''}`);
      } else {
        lines.push(`- ${env}`);
      }
    });
    lines.push('');
  }
  
  if (data.naming_convention) {
    lines.push(`## Naming Convention\n\n\`${data.naming_convention}\`\n`);
  }

  return lines.join('\n');
}

function formatBicepCodegen(data) {
  const lines = ['# Bicep Code Generation\n'];
  
  // Summary stats (new)
  if (data.resource_count || data.avm_modules_used?.length) {
    lines.push('## Summary\n');
    if (data.resource_count) lines.push(`- **Total Resources**: ${data.resource_count}`);
    if (data.avm_modules_used?.length) lines.push(`- **AVM Modules Used**: ${data.avm_modules_used.join(', ')}`);
    lines.push('');
  }
  
  if (data.main_template) {
    lines.push('## Main Template\n');
    if (data.main_template.includes('\n') || data.main_template.includes('param ') || data.main_template.includes('resource ')) {
      lines.push('```bicep');
      lines.push(data.main_template);
      lines.push('```\n');
    } else {
      lines.push(`**Entry Point**: \`${data.main_template}\`\n`);
    }
  }
  
  if (data.modules?.length) {
    lines.push('## Modules\n');
    data.modules.forEach((m, i) => {
      if (typeof m === 'object') {
        const name = m.name || m.path || 'Module';
        const avm = m.avm_module ? ` (AVM: ${m.avm_module})` : '';
        const resources = Array.isArray(m.resources_deployed) ? ` — deploys: ${m.resources_deployed.join(', ')}` : '';
        lines.push(`### ${i + 1}. ${name}${avm}${resources}\n`);
        if (m.content) {
          lines.push('```bicep');
          lines.push(m.content);
          lines.push('```\n');
        } else if (m.code) {
          lines.push('```bicep');
          lines.push(m.code);
          lines.push('```\n');
        }
        if (m.description) lines.push(`> ${m.description}\n`);
      } else {
        lines.push(`${i + 1}. \`${m}\``);
      }
    });
    lines.push('');
  }
  
  if (data.parameters?.length) {
    lines.push('## Parameters\n');
    lines.push('```bicep');
    data.parameters.forEach(p => {
      if (typeof p === 'object') {
        lines.push(`@description('${p.description || ''}')`)
        lines.push(`param ${p.name || 'param'} ${p.type || 'string'}${p.value ? ` = '${p.value}'` : (p.default ? ` = '${p.default}'` : '')}`);
      } else {
        lines.push(p);
      }
    });
    lines.push('```\n');
  }
  
  // Parameter file (new)
  if (data.parameter_file) {
    lines.push('## Parameter File\n');
    lines.push('```bicep');
    lines.push(data.parameter_file);
    lines.push('```\n');
  }
  
  if (data.outputs?.length) {
    lines.push('## Outputs\n');
    lines.push('```bicep');
    data.outputs.forEach(o => {
      if (typeof o === 'object') {
        if (o.description) lines.push(`@description('${o.description}')`);
        lines.push(`output ${o.name || 'output'} ${o.type || 'string'} = ${o.value || "''"}`);
      } else {
        lines.push(`output ${o} string = ''`);
      }
    });
    lines.push('```\n');
  }
  
  // Deployment script (new)
  if (data.deployment_script) {
    lines.push('## Deployment Script\n');
    const ext = data.deployment_script.includes('$') || data.deployment_script.includes('pwsh') ? 'powershell' : 'bash';
    lines.push(`\`\`\`${ext}`);
    lines.push(data.deployment_script);
    lines.push('```\n');
  }
  
  // Azure YAML (new)
  if (data.azure_yaml) {
    lines.push('## azure.yaml (azd)\n');
    lines.push('```yaml');
    lines.push(data.azure_yaml);
    lines.push('```\n');
  }

  return lines.join('\n');
}

function formatAsBuilt(data) {
  const lines = ['# As-Built Documentation\n'];
  
  if (data.summary) {
    lines.push('## Executive Summary\n');
    lines.push(`${data.summary}\n`);
  }
  
  // Solution overview (new)
  if (data.solution_overview) {
    lines.push('## Solution Overview\n');
    const so = data.solution_overview;
    if (so.architecture_pattern) lines.push(`- **Architecture Pattern**: ${so.architecture_pattern}`);
    if (so.total_resources) lines.push(`- **Total Resources**: ${so.total_resources}`);
    if (so.total_monthly_cost_estimate) lines.push(`- **Monthly Cost Estimate**: ${so.total_monthly_cost_estimate}`);
    if (so.regions?.length) lines.push(`- **Regions**: ${so.regions.join(', ')}`);
    if (so.resource_groups?.length) lines.push(`- **Resource Groups**: ${so.resource_groups.join(', ')}`);
    lines.push('');
  }
  
  if (data.resource_inventory?.length) {
    lines.push('## Resource Inventory\n');
    lines.push('| # | Name | Type | SKU | Location | RG | Monthly Cost |');
    lines.push('|---|------|------|-----|----------|----|--------------| ');
    data.resource_inventory.forEach((r, i) => {
      if (typeof r === 'object') {
        const name = r.name || r.resource || 'Resource';
        const type = r.type || '';
        const sku = r.sku || '';
        const location = r.location || '';
        const rg = r.resource_group || '';
        const cost = r.monthly_cost_estimate || '';
        lines.push(`| ${i + 1} | **${name}** | ${type} | ${sku} | ${location} | ${rg} | ${cost} |`);
      } else {
        lines.push(`| ${i + 1} | ${r} | — | — | — | — | — |`);
      }
    });
    lines.push('');
  }
  
  // Architecture description (new)
  if (data.architecture_description) {
    lines.push('## Architecture Description\n');
    lines.push(`${data.architecture_description}\n`);
  }
  
  // Network topology (new)
  if (data.network_topology) {
    lines.push('## Network Topology\n');
    const nt = data.network_topology;
    if (nt.description) lines.push(`${nt.description}\n`);
    if (nt.connectivity?.length) {
      lines.push('### Connectivity');
      nt.connectivity.forEach(c => lines.push(`- ${typeof c === 'object' ? JSON.stringify(c) : c}`));
      lines.push('');
    }
    if (nt.security_boundaries?.length) {
      lines.push('### Security Boundaries');
      nt.security_boundaries.forEach(s => lines.push(`- ${typeof s === 'object' ? JSON.stringify(s) : s}`));
      lines.push('');
    }
  }
  
  if (data.configurations?.length) {
    lines.push('## Configuration Details\n');
    data.configurations.forEach(c => {
      if (typeof c === 'object') {
        const resource = c.resource || c.name || 'Config';
        const category = c.category || '';
        lines.push(`### ${resource}${category ? ` (${category})` : ''}\n`);
        if (c.key_settings && typeof c.key_settings === 'object') {
          Object.entries(c.key_settings).forEach(([k, v]) => {
            lines.push(`- **${k}**: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
          });
        }
        if (c.best_practice_compliance) lines.push(`- **Best Practice Compliance**: ${c.best_practice_compliance}`);
        if (c.value || c.description) lines.push(`- ${c.value || c.description}`);
        lines.push('');
      } else {
        lines.push(`- ${c}`);
      }
    });
    lines.push('');
  }
  
  // Operations (new rich format: object with sub-arrays)
  if (data.operations && typeof data.operations === 'object' && !Array.isArray(data.operations)) {
    lines.push('## Operations\n');
    if (data.operations.monitoring_setup?.length) {
      lines.push('### Monitoring Setup');
      data.operations.monitoring_setup.forEach(m => lines.push(`- ${typeof m === 'object' ? JSON.stringify(m) : m}`));
      lines.push('');
    }
    if (data.operations.alerting_rules?.length) {
      lines.push('### Alerting Rules');
      data.operations.alerting_rules.forEach(a => lines.push(`- ${typeof a === 'object' ? JSON.stringify(a) : a}`));
      lines.push('');
    }
    if (data.operations.scaling_procedures?.length) {
      lines.push('### Scaling Procedures');
      data.operations.scaling_procedures.forEach(s => lines.push(`- ${typeof s === 'object' ? JSON.stringify(s) : s}`));
      lines.push('');
    }
    if (data.operations.maintenance_windows) {
      lines.push(`### Maintenance Windows\n${data.operations.maintenance_windows}\n`);
    }
  }
  // Legacy format: array
  else if (Array.isArray(data.operations) && data.operations.length) {
    lines.push('## Operational Procedures\n');
    data.operations.forEach((op, i) => {
      if (typeof op === 'object') {
        lines.push(`### ${op.name || op.runbook || `Procedure ${i + 1}`}\n`);
        if (op.steps?.length) {
          op.steps.forEach((s, si) => lines.push(`${si + 1}. ${s}`));
        } else {
          lines.push(`${op.description || op.detail || JSON.stringify(op)}`);
        }
        lines.push('');
      } else {
        lines.push(`${i + 1}. ${op}`);
      }
    });
    lines.push('');
  }
  
  // DR procedures (new rich format: object with sub-arrays)
  if (data.dr_procedures && typeof data.dr_procedures === 'object' && !Array.isArray(data.dr_procedures)) {
    lines.push('## Disaster Recovery\n');
    if (data.dr_procedures.rpo_rto_current && typeof data.dr_procedures.rpo_rto_current === 'object') {
      const rr = data.dr_procedures.rpo_rto_current;
      lines.push(`- **Current RPO**: ${rr.rpo || 'N/A'}`);
      lines.push(`- **Current RTO**: ${rr.rto || 'N/A'}`);
      lines.push('');
    }
    if (data.dr_procedures.backup_config?.length) {
      lines.push('### Backup Configuration');
      data.dr_procedures.backup_config.forEach(b => lines.push(`- ${typeof b === 'object' ? JSON.stringify(b) : b}`));
      lines.push('');
    }
    if (data.dr_procedures.failover_steps?.length) {
      lines.push('### Failover Steps');
      data.dr_procedures.failover_steps.forEach((s, i) => lines.push(`${i + 1}. ${typeof s === 'object' ? JSON.stringify(s) : s}`));
      lines.push('');
    }
    if (data.dr_procedures.recovery_validation?.length) {
      lines.push('### Recovery Validation');
      data.dr_procedures.recovery_validation.forEach(r => lines.push(`- ${typeof r === 'object' ? JSON.stringify(r) : r}`));
      lines.push('');
    }
    if (data.dr_procedures.dr_test_schedule) {
      lines.push(`### DR Test Schedule\n${data.dr_procedures.dr_test_schedule}\n`);
    }
  }
  // Legacy format
  else if (Array.isArray(data.dr_procedures) && data.dr_procedures.length) {
    lines.push('## Disaster Recovery Procedures\n');
    data.dr_procedures.forEach((dr, i) => {
      if (typeof dr === 'object') {
        lines.push(`${i + 1}. **${dr.step || dr.name || 'Step'}**: ${dr.action || dr.description || JSON.stringify(dr)}`);
      } else {
        lines.push(`${i + 1}. ${dr}`);
      }
    });
    lines.push('');
  }
  
  // Security posture (new)
  if (data.security_posture) {
    lines.push('## Security Posture\n');
    const sp = data.security_posture;
    if (sp.identity_management?.length) {
      lines.push('### Identity Management');
      sp.identity_management.forEach(i => lines.push(`- ${typeof i === 'object' ? JSON.stringify(i) : i}`));
      lines.push('');
    }
    if (sp.network_security?.length) {
      lines.push('### Network Security');
      sp.network_security.forEach(n => lines.push(`- ${typeof n === 'object' ? JSON.stringify(n) : n}`));
      lines.push('');
    }
    if (sp.data_protection?.length) {
      lines.push('### Data Protection');
      sp.data_protection.forEach(d => lines.push(`- ${typeof d === 'object' ? JSON.stringify(d) : d}`));
      lines.push('');
    }
    if (sp.compliance_status?.length) {
      lines.push('### Compliance Status');
      sp.compliance_status.forEach(c => lines.push(`- ${typeof c === 'object' ? JSON.stringify(c) : c}`));
      lines.push('');
    }
  }
  
  // Cost analysis (new)
  if (data.cost_analysis) {
    lines.push('## Cost Analysis\n');
    const ca = data.cost_analysis;
    if (ca.monthly_breakdown?.length) {
      lines.push('### Monthly Breakdown');
      lines.push('| Resource | Monthly Cost |');
      lines.push('|----------|-------------|');
      ca.monthly_breakdown.forEach(m => {
        if (typeof m === 'object') {
          lines.push(`| ${m.resource || m.name || ''} | ${m.cost || m.amount || ''} |`);
        } else {
          lines.push(`| ${m} | — |`);
        }
      });
      lines.push('');
    }
    if (ca.optimization_opportunities?.length) {
      lines.push('### Optimization Opportunities');
      ca.optimization_opportunities.forEach(o => lines.push(`- 💰 ${typeof o === 'object' ? JSON.stringify(o) : o}`));
      lines.push('');
    }
    if (ca.reserved_instance_recommendations?.length) {
      lines.push('### Reserved Instance Recommendations');
      ca.reserved_instance_recommendations.forEach(r => lines.push(`- ${typeof r === 'object' ? JSON.stringify(r) : r}`));
      lines.push('');
    }
  }

  return lines.join('\n');
}

function formatGenericAgent(agentName, data) {
  const label = agentName.replace(/^\d+-/, '').replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const lines = [`# ${label}\n`];
  
  // Handle text-format output
  if (data.output && data.format === 'text') {
    lines.push(data.output);
    return lines.join('\n');
  }

  // Generic object rendering
  for (const [key, value] of Object.entries(data)) {
    if (key === 'agent' || key === 'format' || key === 'status') continue;
    const heading = key.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    lines.push(`## ${heading}\n`);
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === 'object' && item !== null) {
          const primary = Object.values(item)[0];
          lines.push(`${i + 1}. ${typeof primary === 'string' ? primary : JSON.stringify(item)}`);
        } else {
          lines.push(`${i + 1}. ${item}`);
        }
      });
    } else if (typeof value === 'object' && value !== null) {
      Object.entries(value).forEach(([k, v]) => {
        lines.push(`- **${k}**: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
      });
    } else {
      lines.push(`${value}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Agent Labels ─────────────────────────────────────────────────────────────

const AGENT_LABELS = {
  '02-requirements': 'Requirements Analysis',
  '03-architect':    'Architecture Design',
  '04-design':       'Detailed Design',
  '04g-governance':  'Governance Framework',
  '05-iac-planner':  'IaC Planning',
  '06b-bicep-codegen': 'Bicep Code Generation',
  '08-as-built':     'As-Built Documentation',
};

// ── PDF Styles ───────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    backgroundColor: C.bg,
    padding: 48,
    fontFamily: 'Helvetica',
    color: C.text,
  },
  coverBanner: {
    backgroundColor: C.bgCard,
    borderRadius: 8,
    padding: 28,
    marginBottom: 24,
    borderLeftWidth: 4,
    borderLeftColor: C.accent,
  },
  coverTitle: {
    fontSize: 24,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
    marginBottom: 8,
  },
  coverSub: {
    fontSize: 10,
    color: C.textMuted,
    marginBottom: 3,
  },
  coverBadge: {
    marginTop: 8,
    backgroundColor: C.accentDim,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  coverBadgeText: {
    fontSize: 8,
    color: C.white,
    fontFamily: 'Helvetica-Bold',
  },
  h1: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
    marginTop: 24,
    marginBottom: 10,
  },
  h2: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: '#60a5fa',
    marginTop: 20,
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  h3: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: '#93c5fd',
    marginTop: 14,
    marginBottom: 4,
  },
  h4: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#a5b4fc',
    marginTop: 10,
    marginBottom: 3,
  },
  body: {
    fontSize: 10,
    color: '#cbd5e1',
    lineHeight: 1.6,
    marginBottom: 4,
  },
  listItem: {
    fontSize: 10,
    color: '#cbd5e1',
    lineHeight: 1.6,
    marginBottom: 2,
    paddingLeft: 14,
  },
  codeBlock: {
    backgroundColor: C.bgCard,
    borderRadius: 4,
    padding: 12,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  codeText: {
    fontFamily: 'Courier',
    fontSize: 8,
    color: '#a5b4fc',
    lineHeight: 1.4,
  },
  quote: {
    fontSize: 10,
    color: C.textMuted,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: C.accent,
    marginVertical: 6,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    marginVertical: 16,
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 48,
    right: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 8,
  },
  footerText: {
    fontSize: 7,
    color: C.textDim,
  },
  agentCard: {
    backgroundColor: C.bgCard,
    borderRadius: 6,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: C.success,
  },
  agentCardFailed: {
    backgroundColor: C.bgCard,
    borderRadius: 6,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: C.danger,
  },
  agentName: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
    marginBottom: 4,
  },
  agentMeta: {
    fontSize: 8,
    color: C.textDim,
  },
});

// ── Markdown Parser ──────────────────────────────────────────────────────────

function parseMdToElements(md) {
  if (!md) return [];
  const lines = md.split('\n');
  const elements = [];
  let inCode = false;
  let codeLines = [];

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        elements.push({ type: 'code', text: codeLines.join('\n') });
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }

    if (line.startsWith('#### '))     elements.push({ type: 'h4', text: line.slice(5) });
    else if (line.startsWith('### ')) elements.push({ type: 'h3', text: line.slice(4) });
    else if (line.startsWith('## '))  elements.push({ type: 'h2', text: line.slice(3) });
    else if (line.startsWith('# '))   elements.push({ type: 'h1', text: line.slice(2) });
    else if (line.match(/^[-*]\s/))   elements.push({ type: 'li', text: '\u2022 ' + line.replace(/^[-*]\s/, '') });
    else if (line.match(/^\d+\.\s/))  elements.push({ type: 'li', text: line });
    else if (line.startsWith('> '))   elements.push({ type: 'quote', text: line.slice(2) });
    else if (line.startsWith('---') || line.startsWith('***')) elements.push({ type: 'hr' });
    else if (line.trim()) {
      const clean = line
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/`(.*?)`/g, '$1');
      elements.push({ type: 'p', text: clean });
    }
  }
  if (inCode && codeLines.length) elements.push({ type: 'code', text: codeLines.join('\n') });
  return elements;
}

function renderElements(elements) {
  return elements.map((el, i) => {
    switch (el.type) {
      case 'h1':    return <Text key={i} style={s.h1}>{el.text}</Text>;
      case 'h2':    return <Text key={i} style={s.h2}>{el.text}</Text>;
      case 'h3':    return <Text key={i} style={s.h3}>{el.text}</Text>;
      case 'h4':    return <Text key={i} style={s.h4}>{el.text}</Text>;
      case 'li':    return <Text key={i} style={s.listItem}>{el.text}</Text>;
      case 'code':  return <View key={i} style={s.codeBlock}><Text style={s.codeText}>{el.text}</Text></View>;
      case 'quote': return <Text key={i} style={s.quote}>{el.text}</Text>;
      case 'hr':    return <View key={i} style={s.divider} />;
      default:      return <Text key={i} style={s.body}>{el.text}</Text>;
    }
  });
}

// ── Single Artifact PDF ──────────────────────────────────────────────────────

function ArtifactPDFDocument({ agentName, assessmentName, content, generatedAt }) {
  const elements = parseMdToElements(content);
  const label = AGENT_LABELS[agentName] || agentName;

  return (
    <Document>
      <Page size="A4" style={s.page} wrap>
        <View style={s.coverBanner}>
          <Text style={s.coverTitle}>{label}</Text>
          <Text style={s.coverSub}>Assessment: {assessmentName}</Text>
          <Text style={s.coverSub}>Generated: {generatedAt}</Text>
          <View style={s.coverBadge}>
            <Text style={s.coverBadgeText}>APEX WORKLOAD ASSESSMENT</Text>
          </View>
        </View>
        {renderElements(elements)}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>APEX Assessment \u2022 {label}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function generateArtifactPDF(agentName, assessmentName, content) {
  const blob = await pdf(
    <ArtifactPDFDocument
      agentName={agentName}
      assessmentName={assessmentName}
      content={content}
      generatedAt={new Date().toLocaleString()}
    />
  ).toBlob();
  return blob;
}

// ── Full Report PDF ──────────────────────────────────────────────────────────

function FullReportPDFDocument({ report }) {
  const assessment = report.assessment || {};
  const executions = report.executions || [];
  const summary = report.executive_summary || report.analysis?.executive_summary || '';

  return (
    <Document>
      {/* Cover Page */}
      <Page size="A4" style={{ ...s.page, justifyContent: 'space-between' }}>
        <View>
          <View style={{ marginBottom: 40 }}>
            <Text style={{ fontSize: 8, color: C.textDim, letterSpacing: 2, fontFamily: 'Helvetica-Bold', marginBottom: 4 }}>AZURE</Text>
            <Text style={{ fontSize: 18, fontFamily: 'Helvetica-Bold', color: C.white }}>Workload Assessment Platform</Text>
          </View>
          <View style={{ flex: 1, justifyContent: 'center', paddingVertical: 40 }}>
            <Text style={{ fontSize: 28, fontFamily: 'Helvetica-Bold', color: C.white, marginBottom: 12 }}>
              {assessment.assessment_name || 'Assessment Report'}
            </Text>
            <Text style={{ fontSize: 14, color: C.textMuted, marginBottom: 28 }}>
              Comprehensive Workload Assessment Report
            </Text>
            <View style={{ backgroundColor: C.bgCard, borderRadius: 8, padding: 20, borderLeftWidth: 3, borderLeftColor: C.accent }}>
              <View style={{ flexDirection: 'row', marginBottom: 6 }}>
                <Text style={{ fontSize: 9, color: C.textDim, width: 100 }}>Type</Text>
                <Text style={{ fontSize: 9, color: C.text }}>{assessment.assessment_type || 'N/A'}</Text>
              </View>
              <View style={{ flexDirection: 'row', marginBottom: 6 }}>
                <Text style={{ fontSize: 9, color: C.textDim, width: 100 }}>Service</Text>
                <Text style={{ fontSize: 9, color: C.text }}>{assessment.service_type || 'Multiple'}</Text>
              </View>
              <View style={{ flexDirection: 'row', marginBottom: 6 }}>
                <Text style={{ fontSize: 9, color: C.textDim, width: 100 }}>Owner</Text>
                <Text style={{ fontSize: 9, color: C.text }}>{assessment.owner || 'N/A'}</Text>
              </View>
              <View style={{ flexDirection: 'row' }}>
                <Text style={{ fontSize: 9, color: C.textDim, width: 100 }}>Generated</Text>
                <Text style={{ fontSize: 9, color: C.text }}>{new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</Text>
              </View>
            </View>
          </View>
        </View>
        <Text style={{ fontSize: 8, color: C.textDim }}>
          APEX Workload Assessment Platform — Confidential
        </Text>
      </Page>

      {/* Executive Summary Page */}
      {summary ? (
        <Page size="A4" style={s.page} wrap>
          <Text style={s.h2}>Executive Summary</Text>
          {renderElements(parseMdToElements(summary))}
          <View style={s.footer} fixed>
            <Text style={s.footerText}>APEX Assessment Report — {assessment.assessment_name}</Text>
            <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
          </View>
        </Page>
      ) : null}

      {/* Agent Artifact Pages */}
      {executions.map((exec, idx) => {
        const content = exec.output_data || exec.artifacts || '';
        const text = formatAgentOutputToMarkdown(exec.agent_name, content);
        const elements = parseMdToElements(text);
        const label = AGENT_LABELS[exec.agent_name] || exec.agent_name;

        return (
          <Page key={idx} size="A4" style={s.page} wrap>
            <View style={exec.status === 'failed' ? s.agentCardFailed : s.agentCard}>
              <Text style={s.agentName}>{label}</Text>
              <Text style={s.agentMeta}>
                Agent: {exec.agent_name} {'\u2022'} Status: {exec.status || 'completed'} {'\u2022'} {exec.started_at ? new Date(exec.started_at).toLocaleString() : 'N/A'}
              </Text>
            </View>
            {renderElements(elements)}
            <View style={s.footer} fixed>
              <Text style={s.footerText}>APEX Assessment — {label}</Text>
              <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
            </View>
          </Page>
        );
      })}
    </Document>
  );
}

export async function generateFullReportPDF(report) {
  const blob = await pdf(<FullReportPDFDocument report={report} />).toBlob();
  return blob;
}

// ── Plain Text Conversion ────────────────────────────────────────────────────

export function getPlainText(markdownContent) {
  if (!markdownContent) return '';
  return markdownContent
    .replace(/^#{1,6}\s/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`{3}[\w]*\n/g, '')
    .replace(/`{3}/g, '')
    .replace(/`(.*?)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/^>\s?/gm, '');
}

// ── Diagram Rendering (for design artifacts) ─────────────────────────────────

// Helper: race a promise against a timeout
function withTimeout(promise, ms, label = 'Operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function renderDiagramToImage(markdownContent, agentName, rawData, assessmentName) {
  // Helper: convert SVG text to PNG blob via canvas
  async function svgToPng(svgText) {
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl = svgDoc.documentElement;
    let width = parseFloat(svgEl.getAttribute('width')) || 1400;
    let height = parseFloat(svgEl.getAttribute('height')) || 900;
    if (width < 100) width = 1400;
    if (height < 100) height = 900;

    // Ensure proper xmlns
    if (!svgEl.getAttribute('xmlns')) {
      svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    if (!svgEl.getAttribute('xmlns:xlink')) {
      svgEl.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    }

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgEl);
    const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);

    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, width, height);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((pngBlob) => {
            if (pngBlob) resolve(pngBlob);
            else reject(new Error('canvas.toBlob returned null'));
          }, 'image/png');
        } catch (e) { reject(e); }
      };
      img.onerror = (e) => reject(new Error('SVG image load failed'));
      img.src = svgDataUrl;
    });
  }

  // ── Priority 1: Use direct SVG image generation from agent output data ──
  if (agentName && rawData && (agentName === '03-architect' || agentName === '04-design')) {
    try {
      const outputData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      // Call the direct image endpoint (renders SVG from component data, no draw.io XML round-trip)
      const imageResp = await withTimeout(
        fetch('/api/mcp/diagram/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_name: agentName,
            output_data: outputData,
            assessment_name: assessmentName || 'Assessment',
          }),
        }),
        25000,
        'Architecture diagram image generation'
      );
      if (imageResp.ok) {
        const svgText = await imageResp.text();
        // Convert SVG to PNG via canvas
        const pngBlob = await withTimeout(svgToPng(svgText), 15000, 'SVG to PNG conversion');
        return { type: 'png', blob: pngBlob };
      }
    } catch (err) {
      console.warn('Direct diagram image failed, trying draw.io fallback:', err.message);
    }

    // Fallback: generate draw.io XML and try export
    try {
      const outputData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      const diagramResult = await withTimeout(
        generateDrawioDiagram(agentName, outputData, assessmentName || 'Assessment'),
        20000,
        'Draw.io MCP diagram generation'
      );
      if (diagramResult && diagramResult.content) {
        try {
          const exportResp = await withTimeout(
            fetch('/api/mcp/diagram/export', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ xml: diagramResult.content, format: 'svg' }),
            }),
            25000,
            'Diagram SVG export'
          );
          if (exportResp.ok) {
            const svgText = await exportResp.text();
            const pngBlob = await withTimeout(svgToPng(svgText), 15000, 'SVG to PNG conversion');
            return { type: 'png', blob: pngBlob };
          }
        } catch (exportErr) {
          console.warn('Draw.io export failed:', exportErr.message);
        }
        // Final fallback: return drawio XML for manual use
        return {
          type: 'drawio',
          blob: new Blob([diagramResult.content], { type: 'application/xml' }),
          drawioXml: diagramResult.content,
        };
      }
    } catch (err) {
      console.warn('Draw.io fallback also failed:', err.message);
    }
  }

  // ── Priority 2: Check for embedded draw.io XML (mxfile) and export as image ──
  const drawioRegex = /<mxfile[\s\S]*?<\/mxfile>/;
  const drawioMatch = markdownContent.match(drawioRegex);
  if (drawioMatch) {
    try {
      const exportResp = await withTimeout(
        fetch('/api/mcp/diagram/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ xml: drawioMatch[0], format: 'svg' }),
        }),
        25000,
        'Embedded diagram export'
      );
      if (exportResp.ok) {
        const svgText = await exportResp.text();
        const pngBlob = await withTimeout(svgToPng(svgText), 15000, 'SVG to PNG conversion');
        return { type: 'png', blob: pngBlob };
      }
    } catch (e) {
      console.warn('Embedded drawio export failed:', e.message);
    }
    // Fallback to raw drawio
    return { type: 'drawio', blob: new Blob([drawioMatch[0]], { type: 'application/xml' }) };
  }

  // ── Priority 3: Fall back to mermaid rendering ──
  const mermaidRegex = /```mermaid\n([\s\S]*?)```/;
  const match = markdownContent.match(mermaidRegex);

  if (!match) {
    return null;
  }

  const mermaidCode = match[1].trim();

  try {
    const mermaid = (await import('mermaid')).default;
    mermaid.initialize({
      theme: 'dark',
      startOnLoad: false,
      securityLevel: 'loose',       // allow foreignObject for better rendering
      themeVariables: {
        darkMode: true,
        background: '#1e293b',
        primaryColor: '#3b82f6',
        primaryTextColor: '#f1f5f9',
        primaryBorderColor: '#334155',
        lineColor: '#64748b',
        secondaryColor: '#1e293b',
        tertiaryColor: '#334155',
      },
    });

    const id = 'artifact-diagram-' + Date.now();
    // Timeout mermaid.render at 15s — complex diagrams can hang
    const { svg } = await withTimeout(
      mermaid.render(id, mermaidCode),
      15000,
      'Mermaid render'
    );

    // Parse SVG to get dimensions
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svg, 'image/svg+xml');
    const svgEl = svgDoc.documentElement;
    let width = parseFloat(svgEl.getAttribute('width')) || 800;
    let height = parseFloat(svgEl.getAttribute('height')) || 600;
    if (width < 100) width = 800;
    if (height < 100) height = 600;

    // Ensure SVG has proper xmlns for standalone rendering
    if (!svgEl.getAttribute('xmlns')) {
      svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    svgEl.setAttribute('width', String(width));
    svgEl.setAttribute('height', String(height));

    // Serialize to a clean SVG string, use data URL (more reliable than blob URL)
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgEl);
    const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);

    // Convert SVG to PNG via canvas with a 10s timeout
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, width, height);

    const pngResult = await withTimeout(
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          try {
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob((pngBlob) => {
              if (pngBlob) {
                resolve({ type: 'png', blob: pngBlob });
              } else {
                reject(new Error('canvas.toBlob returned null'));
              }
            }, 'image/png');
          } catch (e) {
            reject(e);
          }
        };
        img.onerror = (e) => {
          reject(new Error('Image load failed: ' + String(e)));
        };
        img.src = svgDataUrl;
      }),
      10000,
      'SVG to PNG conversion'
    );

    return pngResult;
  } catch (err) {
    console.error('Diagram rendering failed:', err);
    // Fallback: try returning the SVG directly so the user gets something
    if (match) {
      try {
        const mermaid = (await import('mermaid')).default;
        const { svg } = await withTimeout(mermaid.render('fallback-' + Date.now(), match[1].trim()), 10000, 'Fallback mermaid render');
        return { type: 'svg', blob: new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }) };
      } catch {
        // Last resort: return the raw mermaid code as markdown
      }
    }
    return null;
  }
}

/**
 * Call the backend Draw.io MCP service to generate an architecture diagram
 * with native Azure service icons.
 */
async function generateDrawioDiagram(agentName, outputData, assessmentName) {
  const resp = await fetch(`${API_BASE}/api/mcp/diagram/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_name: agentName,
      output_data: outputData,
      assessment_name: assessmentName,
    }),
  });
  
  if (!resp.ok) {
    throw new Error(`Draw.io MCP API returned ${resp.status}: ${resp.statusText}`);
  }
  
  return await resp.json();
}
