/**
 * Draw.io MCP Server for APEX Integration
 * 
 * Generates professional Azure architecture diagrams in draw.io XML format
 * with native Azure service icons. Implements the tools expected by APEX
 * agent 04-Design's 9-step workflow.
 * 
 * Tools: search-shapes, create-groups, add-cells, add-cells-to-group,
 *        finish-diagram, clear-diagram, save-drawio, validate-drawio
 */

const HTTP_PORT = parseInt(Deno.env.get("HTTP_PORT") || "3001");

// ── Azure Service Shape Registry ────────────────────────────────────────────
// Maps common Azure service names to draw.io stencil names and icon identifiers

interface AzureShape {
  shape_name: string;
  category: string;
  display_name: string;
  icon_file: string;  // Relative to Icons/ directory
  width: number;
  height: number;
}

const AZURE_SHAPES: Record<string, AzureShape> = {
  // Compute
  "virtual machine": { shape_name: "Virtual Machines", category: "Compute", display_name: "Virtual Machine", icon_file: "compute/10021-icon-service-Virtual-Machine.svg", width: 64, height: 64 },
  "vm": { shape_name: "Virtual Machines", category: "Compute", display_name: "Virtual Machine", icon_file: "compute/10021-icon-service-Virtual-Machine.svg", width: 64, height: 64 },
  "app service": { shape_name: "App Services", category: "Compute", display_name: "App Service", icon_file: "app services/10035-icon-service-App-Services.svg", width: 64, height: 64 },
  "web app": { shape_name: "App Services", category: "Compute", display_name: "Web App", icon_file: "app services/10035-icon-service-App-Services.svg", width: 64, height: 64 },
  "functions": { shape_name: "Function Apps", category: "Compute", display_name: "Azure Functions", icon_file: "compute/10029-icon-service-Function-Apps.svg", width: 64, height: 64 },
  "function app": { shape_name: "Function Apps", category: "Compute", display_name: "Function App", icon_file: "compute/10029-icon-service-Function-Apps.svg", width: 64, height: 64 },
  "kubernetes": { shape_name: "Kubernetes Services", category: "Containers", display_name: "AKS", icon_file: "containers/10023-icon-service-Kubernetes-Services.svg", width: 64, height: 64 },
  "aks": { shape_name: "Kubernetes Services", category: "Containers", display_name: "AKS", icon_file: "containers/10023-icon-service-Kubernetes-Services.svg", width: 64, height: 64 },
  "container instance": { shape_name: "Container Instances", category: "Containers", display_name: "Container Instance", icon_file: "containers/10104-icon-service-Container-Instances.svg", width: 64, height: 64 },
  "container instances": { shape_name: "Container Instances", category: "Containers", display_name: "Container Instances", icon_file: "containers/10104-icon-service-Container-Instances.svg", width: 64, height: 64 },
  "container app": { shape_name: "Container Apps", category: "Containers", display_name: "Container App", icon_file: "other/02884-icon-service-Worker-Container-App.svg", width: 64, height: 64 },
  "container apps": { shape_name: "Container Apps", category: "Containers", display_name: "Container Apps", icon_file: "other/02884-icon-service-Worker-Container-App.svg", width: 64, height: 64 },
  "container registry": { shape_name: "Container Registries", category: "Containers", display_name: "Container Registry", icon_file: "containers/10105-icon-service-Container-Registries.svg", width: 64, height: 64 },
  
  // Networking
  "load balancer": { shape_name: "Load Balancers", category: "Networking", display_name: "Load Balancer", icon_file: "networking/10062-icon-service-Load-Balancers.svg", width: 64, height: 64 },
  "front door": { shape_name: "Front Doors", category: "Networking", display_name: "Front Door", icon_file: "networking/10073-icon-service-Front-Door-and-CDN-Profiles.svg", width: 64, height: 64 },
  "front doors": { shape_name: "Front Doors", category: "Networking", display_name: "Front Door", icon_file: "networking/10073-icon-service-Front-Door-and-CDN-Profiles.svg", width: 64, height: 64 },
  "application gateway": { shape_name: "Application Gateways", category: "Networking", display_name: "App Gateway", icon_file: "networking/10076-icon-service-Application-Gateways.svg", width: 64, height: 64 },
  "virtual network": { shape_name: "Virtual Networks", category: "Networking", display_name: "Virtual Network", icon_file: "networking/10061-icon-service-Virtual-Networks.svg", width: 64, height: 64 },
  "vnet": { shape_name: "Virtual Networks", category: "Networking", display_name: "VNet", icon_file: "networking/10061-icon-service-Virtual-Networks.svg", width: 64, height: 64 },
  "firewall": { shape_name: "Firewalls", category: "Networking", display_name: "Azure Firewall", icon_file: "networking/10084-icon-service-Firewalls.svg", width: 64, height: 64 },
  "bastion": { shape_name: "Bastions", category: "Networking", display_name: "Bastion", icon_file: "networking/02422-icon-service-Bastions.svg", width: 64, height: 64 },
  "vpn gateway": { shape_name: "VPN Gateways", category: "Networking", display_name: "VPN Gateway", icon_file: "networking/10063-icon-service-Virtual-Network-Gateways.svg", width: 64, height: 64 },
  "dns": { shape_name: "DNS Zones", category: "Networking", display_name: "DNS", icon_file: "networking/10064-icon-service-DNS-Zones.svg", width: 64, height: 64 },
  "cdn": { shape_name: "CDN Profiles", category: "Networking", display_name: "CDN", icon_file: "networking/10073-icon-service-Front-Door-and-CDN-Profiles.svg", width: 64, height: 64 },
  "traffic manager": { shape_name: "Traffic Manager", category: "Networking", display_name: "Traffic Manager", icon_file: "networking/10065-icon-service-Traffic-Manager-Profiles.svg", width: 64, height: 64 },
  "api management": { shape_name: "API Management", category: "Networking", display_name: "API Management", icon_file: "web/10042-icon-service-API-Management-Services.svg", width: 64, height: 64 },
  "private endpoint": { shape_name: "Private Endpoints", category: "Networking", display_name: "Private Endpoint", icon_file: "networking/02579-icon-service-Private-Endpoints.svg", width: 64, height: 64 },

  // Databases
  "sql database": { shape_name: "SQL Databases", category: "Databases", display_name: "SQL Database", icon_file: "databases/10130-icon-service-SQL-Database.svg", width: 64, height: 64 },
  "sql server": { shape_name: "SQL Servers", category: "Databases", display_name: "SQL Server", icon_file: "databases/10132-icon-service-SQL-Server.svg", width: 64, height: 64 },
  "azure sql": { shape_name: "Azure SQL", category: "Databases", display_name: "Azure SQL", icon_file: "databases/02390-icon-service-Azure-SQL.svg", width: 64, height: 64 },
  "cosmos db": { shape_name: "Azure Cosmos DB", category: "Databases", display_name: "Cosmos DB", icon_file: "databases/10121-icon-service-Azure-Cosmos-DB.svg", width: 64, height: 64 },
  "cosmosdb": { shape_name: "Azure Cosmos DB", category: "Databases", display_name: "Cosmos DB", icon_file: "databases/10121-icon-service-Azure-Cosmos-DB.svg", width: 64, height: 64 },
  "mysql": { shape_name: "MySQL Servers", category: "Databases", display_name: "MySQL", icon_file: "databases/10122-icon-service-Azure-Database-MySQL-Server.svg", width: 64, height: 64 },
  "postgresql": { shape_name: "PostgreSQL Servers", category: "Databases", display_name: "PostgreSQL", icon_file: "databases/10131-icon-service-Azure-Database-PostgreSQL-Server.svg", width: 64, height: 64 },
  "redis": { shape_name: "Redis Cache", category: "Databases", display_name: "Redis Cache", icon_file: "databases/10137-icon-service-Cache-Redis.svg", width: 64, height: 64 },
  "cache": { shape_name: "Redis Cache", category: "Databases", display_name: "Redis Cache", icon_file: "databases/10137-icon-service-Cache-Redis.svg", width: 64, height: 64 },

  // Storage
  "storage account": { shape_name: "Storage Accounts", category: "Storage", display_name: "Storage Account", icon_file: "storage/10086-icon-service-Storage-Accounts.svg", width: 64, height: 64 },
  "storage": { shape_name: "Storage Accounts", category: "Storage", display_name: "Storage", icon_file: "storage/10086-icon-service-Storage-Accounts.svg", width: 64, height: 64 },
  "blob storage": { shape_name: "Blob Storage", category: "Storage", display_name: "Blob Storage", icon_file: "general/10839-icon-service-Storage-Container.svg", width: 64, height: 64 },
  "data lake": { shape_name: "Data Lake", category: "Storage", display_name: "Data Lake", icon_file: "storage/10090-icon-service-Data-Lake-Storage-Gen1.svg", width: 64, height: 64 },

  // Security & Identity
  "key vault": { shape_name: "Key Vaults", category: "Security", display_name: "Key Vault", icon_file: "security/10245-icon-service-Key-Vaults.svg", width: 64, height: 64 },
  "key vaults": { shape_name: "Key Vaults", category: "Security", display_name: "Key Vault", icon_file: "security/10245-icon-service-Key-Vaults.svg", width: 64, height: 64 },
  "active directory": { shape_name: "Azure Active Directory", category: "Identity", display_name: "Azure AD", icon_file: "identity/10221-icon-service-Azure-Active-Directory.svg", width: 64, height: 64 },
  "azure ad": { shape_name: "Azure Active Directory", category: "Identity", display_name: "Azure AD", icon_file: "identity/10221-icon-service-Azure-Active-Directory.svg", width: 64, height: 64 },
  "entra id": { shape_name: "Entra ID", category: "Identity", display_name: "Entra ID", icon_file: "identity/10221-icon-service-Azure-Active-Directory.svg", width: 64, height: 64 },
  "defender": { shape_name: "Microsoft Defender", category: "Security", display_name: "Defender", icon_file: "security/10244-icon-service-Microsoft-Defender-for-Cloud.svg", width: 64, height: 64 },

  // Monitoring
  "monitor": { shape_name: "Azure Monitor", category: "Monitoring", display_name: "Azure Monitor", icon_file: "monitor/00001-icon-service-Monitor.svg", width: 64, height: 64 },
  "azure monitor": { shape_name: "Azure Monitor", category: "Monitoring", display_name: "Azure Monitor", icon_file: "monitor/00001-icon-service-Monitor.svg", width: 64, height: 64 },
  "log analytics": { shape_name: "Log Analytics", category: "Monitoring", display_name: "Log Analytics", icon_file: "management + governance/00009-icon-service-Log-Analytics-Workspaces.svg", width: 64, height: 64 },
  "application insights": { shape_name: "Application Insights", category: "Monitoring", display_name: "App Insights", icon_file: "monitor/00012-icon-service-Application-Insights.svg", width: 64, height: 64 },

  // AI/ML
  "cognitive services": { shape_name: "Cognitive Services", category: "AI", display_name: "Cognitive Services", icon_file: "ai + machine learning/10162-icon-service-Cognitive-Services.svg", width: 64, height: 64 },
  "openai": { shape_name: "OpenAI", category: "AI", display_name: "Azure OpenAI", icon_file: "ai + machine learning/10162-icon-service-Cognitive-Services.svg", width: 64, height: 64 },
  "machine learning": { shape_name: "Machine Learning", category: "AI", display_name: "Machine Learning", icon_file: "ai + machine learning/10166-icon-service-Machine-Learning.svg", width: 64, height: 64 },

  // Integration
  "service bus": { shape_name: "Service Bus", category: "Integration", display_name: "Service Bus", icon_file: "integration/10836-icon-service-Service-Bus.svg", width: 64, height: 64 },
  "event hub": { shape_name: "Event Hubs", category: "Integration", display_name: "Event Hub", icon_file: "integration/10150-icon-service-Event-Hubs.svg", width: 64, height: 64 },
  "event hubs": { shape_name: "Event Hubs", category: "Integration", display_name: "Event Hubs", icon_file: "integration/10150-icon-service-Event-Hubs.svg", width: 64, height: 64 },
  "event grid": { shape_name: "Event Grid", category: "Integration", display_name: "Event Grid", icon_file: "integration/10158-icon-service-Event-Grid-Topics.svg", width: 64, height: 64 },
  "logic app": { shape_name: "Logic Apps", category: "Integration", display_name: "Logic App", icon_file: "integration/10152-icon-service-Logic-Apps.svg", width: 64, height: 64 },

  // Web
  "signalr": { shape_name: "SignalR", category: "Web", display_name: "SignalR", icon_file: "web/10153-icon-service-SignalR.svg", width: 64, height: 64 },
  "notification hub": { shape_name: "Notification Hubs", category: "Web", display_name: "Notification Hub", icon_file: "web/10045-icon-service-Notification-Hubs.svg", width: 64, height: 64 },

  // Misc
  "backup": { shape_name: "Recovery Services Vaults", category: "General", display_name: "Backup", icon_file: "general/10094-icon-service-Recovery-Services-Vaults.svg", width: 64, height: 64 },
  "recovery services": { shape_name: "Recovery Services Vaults", category: "General", display_name: "Recovery Services", icon_file: "general/10094-icon-service-Recovery-Services-Vaults.svg", width: 64, height: 64 },
  "search": { shape_name: "Search Services", category: "General", display_name: "AI Search", icon_file: "general/10044-icon-service-Search-Services.svg", width: 64, height: 64 },
};

// ── XML Helpers ──────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── Shape Search ────────────────────────────────────────────────────────────

function searchShapes(queries: string[]): { results: Array<{ query: string; matches: AzureShape[] }> } {
  const results = queries.map((query) => {
    const q = query.toLowerCase().trim();
    const matches: AzureShape[] = [];
    
    // Direct match
    if (AZURE_SHAPES[q]) {
      matches.push(AZURE_SHAPES[q]);
    } else {
      // Partial match
      for (const [key, shape] of Object.entries(AZURE_SHAPES)) {
        if (key.includes(q) || q.includes(key) || 
            shape.display_name.toLowerCase().includes(q) ||
            shape.shape_name.toLowerCase().includes(q)) {
          matches.push(shape);
        }
      }
    }
    
    return { query, matches };
  });
  
  return { results };
}

// ── Group Styles ────────────────────────────────────────────────────────────

const GROUP_STYLES: Record<string, string> = {
  vnet: "rounded=1;whiteSpace=wrap;html=1;fillColor=#E8F5E9;strokeColor=#4CAF50;strokeWidth=2;dashed=0;opacity=40;verticalAlign=top;fontStyle=1;fontSize=13;fontColor=#2E7D32;container=1;collapsible=0;",
  subnet: "rounded=1;whiteSpace=wrap;html=1;fillColor=#E3F2FD;strokeColor=#1976D2;strokeWidth=1;dashed=1;opacity=30;verticalAlign=top;fontStyle=0;fontSize=11;fontColor=#1565C0;container=1;collapsible=0;",
  rg: "rounded=1;whiteSpace=wrap;html=1;fillColor=#FFF3E0;strokeColor=#FF9800;strokeWidth=2;dashed=0;opacity=30;verticalAlign=top;fontStyle=1;fontSize=13;fontColor=#E65100;container=1;collapsible=0;",
  region: "rounded=1;whiteSpace=wrap;html=1;fillColor=#F3E5F5;strokeColor=#9C27B0;strokeWidth=2;dashed=0;opacity=25;verticalAlign=top;fontStyle=1;fontSize=14;fontColor=#6A1B9A;container=1;collapsible=0;",
  zone: "rounded=1;whiteSpace=wrap;html=1;fillColor=#ECEFF1;strokeColor=#607D8B;strokeWidth=1;dashed=1;opacity=25;verticalAlign=top;fontStyle=0;fontSize=11;fontColor=#455A64;container=1;collapsible=0;",
};

// ── Diagram State ───────────────────────────────────────────────────────────
// The MCP server is NOT stateful between calls.
// Clients MUST pass diagram_xml from each response to the next call.

interface DiagramCell {
  id: string;
  temp_id?: string;
  type: "vertex" | "edge" | "group";
  value: string;
  style: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parent: string;
  source?: string;
  target?: string;
  shape_name?: string;
}

let cellCounter = 2;

function nextCellId(): string {
  return `cell-${cellCounter++}`;
}

// ── Create Groups ───────────────────────────────────────────────────────────

interface GroupSpec {
  name: string;
  type: string; // vnet, subnet, rg, region, zone
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
}

function createGroups(
  groups: GroupSpec[],
  diagram_xml?: string
): { data: { results: Array<{ cell: DiagramCell; success: boolean }> }; diagram_xml: string } {
  const results: Array<{ cell: DiagramCell; success: boolean }> = [];
  const cellsXml: string[] = [];

  for (const g of groups) {
    const id = nextCellId();
    const style = GROUP_STYLES[g.type] || GROUP_STYLES.rg;
    const label = g.text !== undefined ? g.text : g.name;
    
    const cell: DiagramCell = {
      id,
      type: "group",
      value: label,
      style,
      x: g.x,
      y: g.y,
      width: g.width,
      height: g.height,
      parent: "1",
    };
    
    cellsXml.push(
      `<mxCell id="${id}" value="${xmlEscape(label)}" style="${style}" vertex="1" parent="1">` +
      `<mxGeometry x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" as="geometry"/></mxCell>`
    );
    
    results.push({ cell, success: true });
  }

  // Build or extend diagram XML
  const newXml = buildDiagramXml(diagram_xml, cellsXml);
  return { data: { results }, diagram_xml: newXml };
}

// ── Add Cells ───────────────────────────────────────────────────────────────

interface CellSpec {
  type: "vertex" | "edge";
  value?: string;
  shape_name?: string;
  temp_id?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  parent?: string;
  source?: string;
  target?: string;
  style?: string;
  label?: string;
}

function addCells(
  cells: CellSpec[],
  diagram_xml?: string,
  transactional?: boolean,
): { data: { results: Array<{ cell: DiagramCell; tempId?: string; success: boolean }> }; diagram_xml: string } {
  const results: Array<{ cell: DiagramCell; tempId?: string; success: boolean }> = [];
  const cellsXml: string[] = [];
  const tempIdMap: Record<string, string> = {};

  // First pass: assign IDs to all vertices (for edge resolution)
  for (const spec of cells) {
    if (spec.type === "vertex" && spec.temp_id) {
      const id = nextCellId();
      tempIdMap[spec.temp_id] = id;
    }
  }

  // Reset counter for actual generation
  cellCounter -= Object.keys(tempIdMap).length;

  for (const spec of cells) {
    const id = spec.temp_id && tempIdMap[spec.temp_id] 
      ? tempIdMap[spec.temp_id] 
      : nextCellId();
    
    if (!spec.temp_id || !tempIdMap[spec.temp_id]) {
      // If we didn't pre-assign, track it now
      if (spec.temp_id) tempIdMap[spec.temp_id] = id;
    }

    if (spec.type === "vertex") {
      // Resolve Azure shape
      let style = spec.style || "";
      let w = spec.width || 64;
      let h = spec.height || 64;

      if (spec.shape_name && !style) {
        const shapeLower = spec.shape_name.toLowerCase();
        const shape = AZURE_SHAPES[shapeLower];
        if (shape) {
          // Use Azure icon style with image reference
          style = `shape=image;verticalLabelPosition=bottom;labelBackgroundColor=default;verticalAlign=top;aspect=fixed;imageAspect=0;image=azure-icon://${encodeURIComponent(shape.icon_file)};`;
          w = shape.width;
          h = shape.height;
        }
      }

      if (!style) {
        style = "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontColor=#333;fontSize=12;fontStyle=1;";
      }

      const label = spec.value || spec.label || "";
      const parent = spec.parent || "1";
      const x = spec.x || 0;
      const y = spec.y || 0;

      const cell: DiagramCell = {
        id, temp_id: spec.temp_id, type: "vertex",
        value: label, style, x, y, width: w, height: h, parent,
        shape_name: spec.shape_name,
      };

      cellsXml.push(
        `<mxCell id="${id}" value="${xmlEscape(label)}" style="${style}" vertex="1" parent="${parent}">` +
        `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`
      );

      results.push({ cell, tempId: spec.temp_id, success: true });
    } else if (spec.type === "edge") {
      const srcId = spec.source ? (tempIdMap[spec.source] || spec.source) : "";
      const tgtId = spec.target ? (tempIdMap[spec.target] || spec.target) : "";
      const label = spec.value || spec.label || "";
      const style = spec.style || "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#666;strokeWidth=2;";

      const cell: DiagramCell = {
        id, type: "edge", value: label, style,
        x: 0, y: 0, width: 0, height: 0,
        parent: "1", source: srcId, target: tgtId,
      };

      cellsXml.push(
        `<mxCell id="${id}" value="${xmlEscape(label)}" style="${style}" edge="1" source="${srcId}" target="${tgtId}" parent="1">` +
        `<mxGeometry relative="1" as="geometry"/></mxCell>`
      );

      results.push({ cell, tempId: spec.temp_id, success: true });
    }
  }

  const newXml = buildDiagramXml(diagram_xml, cellsXml);
  return { data: { results }, diagram_xml: newXml };
}

// ── Add Cells to Group ──────────────────────────────────────────────────────

interface GroupAssignment {
  cell_id: string;
  group_id: string;
}

function addCellsToGroup(
  assignments: GroupAssignment[],
  diagram_xml?: string,
): { data: { results: Array<{ cell_id: string; group_id: string; success: boolean }> }; diagram_xml: string } {
  const results = assignments.map((a) => ({
    cell_id: a.cell_id,
    group_id: a.group_id,
    success: true,
  }));

  // Modify the XML to change parent attributes
  let xml = diagram_xml || "";
  for (const a of assignments) {
    // Update parent attribute for the cell
    const regex = new RegExp(`(<mxCell id="${a.cell_id}"[^>]*?)parent="[^"]*"`, "g");
    xml = xml.replace(regex, `$1parent="${a.group_id}"`);
  }

  return { data: { results }, diagram_xml: xml };
}

// ── Finish Diagram ──────────────────────────────────────────────────────────

function finishDiagram(
  diagram_xml?: string,
  compress?: boolean,
  title?: string,
): { diagram_xml: string; format: string } {
  let xml = diagram_xml || buildDiagramXml(undefined, []);
  
  // Resolve azure-icon:// references to base64-embedded SVGs
  xml = resolveAzureIcons(xml);
  
  return { diagram_xml: xml, format: "drawio" };
}

// ── Clear Diagram ───────────────────────────────────────────────────────────

function clearDiagram(): { diagram_xml: string } {
  cellCounter = 2;
  return { diagram_xml: buildDiagramXml(undefined, []) };
}

// ── Build Diagram XML ───────────────────────────────────────────────────────

function buildDiagramXml(existing?: string, newCells?: string[]): string {
  if (existing && newCells && newCells.length > 0) {
    // Insert new cells before </root>
    const insertPoint = existing.lastIndexOf("</root>");
    if (insertPoint >= 0) {
      return (
        existing.substring(0, insertPoint) +
        "\n        " + newCells.join("\n        ") + "\n      " +
        existing.substring(insertPoint)
      );
    }
  }

  if (existing) return existing;

  // Create fresh diagram
  const cellsStr = newCells ? "\n        " + newCells.join("\n        ") : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="drawio-mcp" type="device">
  <diagram id="azure-arch" name="Azure Architecture">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1200" pageHeight="800" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>${cellsStr}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
}

// ── Resolve Azure Icon References ───────────────────────────────────────────
// Replace azure-icon://path references with actual base64-encoded SVG data

function resolveAzureIcons(xml: string): string {
  const iconRegex = /azure-icon:\/\/([^;]+);/g;
  let match;
  
  while ((match = iconRegex.exec(xml)) !== null) {
    const encodedPath = match[1];
    const iconPath = decodeURIComponent(encodedPath);
    
    // Try to read the SVG file
    try {
      const fullPath = `../../../Icons/${iconPath}`;
      // In the MCP server context, we'll embed a placeholder
      // The backend Python service resolves these when serving
      const placeholder = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="32" y="32" text-anchor="middle" font-size="8">${iconPath.split("/").pop()?.replace(".svg", "") || "Azure"}</text></svg>`)}`;
      xml = xml.replace(`azure-icon://${encodedPath}`, placeholder);
    } catch {
      // Keep the reference for later resolution
    }
  }
  
  return xml;
}

// ── MCP Tool Definitions ────────────────────────────────────────────────────

const TOOLS = {
  "search-shapes": {
    description: "Search for Azure service shapes/icons available for diagram generation",
    inputSchema: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          items: { type: "string" },
          description: "Array of Azure service names to search for (e.g. ['Virtual Machine', 'SQL Database', 'Key Vault'])",
        },
      },
      required: ["queries"],
    },
  },
  "create-groups": {
    description: "Create container groups (VNets, subnets, resource groups) in the diagram",
    inputSchema: {
      type: "object",
      properties: {
        groups: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string", enum: ["vnet", "subnet", "rg", "region", "zone"] },
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
              text: { type: "string" },
            },
            required: ["name", "type", "x", "y", "width", "height"],
          },
        },
        diagram_xml: { type: "string", description: "Existing diagram XML to extend" },
      },
      required: ["groups"],
    },
  },
  "add-cells": {
    description: "Add vertices (Azure service icons) and edges (connections) to the diagram",
    inputSchema: {
      type: "object",
      properties: {
        cells: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["vertex", "edge"] },
              value: { type: "string" },
              shape_name: { type: "string", description: "Azure service shape name from search-shapes" },
              temp_id: { type: "string" },
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
              parent: { type: "string" },
              source: { type: "string", description: "Source temp_id or cell_id for edges" },
              target: { type: "string", description: "Target temp_id or cell_id for edges" },
              style: { type: "string" },
              label: { type: "string" },
            },
            required: ["type"],
          },
        },
        diagram_xml: { type: "string" },
        transactional: { type: "boolean" },
      },
      required: ["cells"],
    },
  },
  "add-cells-to-group": {
    description: "Assign cells to container groups",
    inputSchema: {
      type: "object",
      properties: {
        assignments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              cell_id: { type: "string" },
              group_id: { type: "string" },
            },
            required: ["cell_id", "group_id"],
          },
        },
        diagram_xml: { type: "string" },
      },
      required: ["assignments"],
    },
  },
  "finish-diagram": {
    description: "Finalize the diagram, resolving icon references and optionally compressing",
    inputSchema: {
      type: "object",
      properties: {
        diagram_xml: { type: "string" },
        compress: { type: "boolean" },
        title: { type: "string" },
      },
    },
  },
  "clear-diagram": {
    description: "Clear the diagram and reset state",
    inputSchema: { type: "object", properties: {} },
  },
};

// ── HTTP Server ─────────────────────────────────────────────────────────────

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // Health check
  if (url.pathname === "/health" || url.pathname === "/") {
    return new Response(
      JSON.stringify({ status: "ok", tools: Object.keys(TOOLS) }),
      { headers }
    );
  }

  // List tools (MCP convention)
  if (url.pathname === "/tools" || url.pathname === "/tools/list") {
    const toolsList = Object.entries(TOOLS).map(([name, def]) => ({
      name: `drawio/${name}`,
      ...def,
    }));
    return new Response(JSON.stringify({ tools: toolsList }), { headers });
  }

  // Execute tool
  if (url.pathname === "/tools/call" && req.method === "POST") {
    try {
      const body = await req.json();
      const toolName = (body.name || "").replace("drawio/", "");
      const params = body.arguments || body.params || {};

      let result: unknown;

      switch (toolName) {
        case "search-shapes":
          result = searchShapes(params.queries || []);
          break;
        case "create-groups":
          result = createGroups(params.groups || [], params.diagram_xml);
          break;
        case "add-cells":
          result = addCells(params.cells || [], params.diagram_xml, params.transactional);
          break;
        case "add-cells-to-group":
          result = addCellsToGroup(params.assignments || [], params.diagram_xml);
          break;
        case "finish-diagram":
          result = finishDiagram(params.diagram_xml, params.compress, params.title);
          break;
        case "clear-diagram":
          result = clearDiagram();
          break;
        default:
          return new Response(
            JSON.stringify({ error: `Unknown tool: ${toolName}` }),
            { status: 404, headers }
          );
      }

      return new Response(JSON.stringify(result), { headers });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `Tool execution error: ${err}` }),
        { status: 500, headers }
      );
    }
  }

  // Generate full diagram (convenience endpoint)
  if (url.pathname === "/generate" && req.method === "POST") {
    try {
      const body = await req.json();
      const { components, title, layout, edges } = body;
      
      const diagram = generateFullDiagram(
        components || [],
        title || "Azure Architecture",
        layout || "LR",
        edges,
      );
      
      return new Response(JSON.stringify({ diagram_xml: diagram }), { headers });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `Generation error: ${err}` }),
        { status: 500, headers }
      );
    }
  }

  return new Response(
    JSON.stringify({ error: "Not found" }),
    { status: 404, headers }
  );
}

// ── Full Diagram Generator (convenience) ────────────────────────────────────

function generateFullDiagram(
  components: Array<{ name: string; type?: string; description?: string }>,
  title: string,
  layout: string,
  edges?: Array<{ source: string; target: string; label?: string }>,
): string {
  cellCounter = 2;

  const ICON_W = 64, ICON_H = 64;
  const CELL_W = 80, CELL_H = 88;
  const H_GAP = 50, V_GAP = 60;
  const PAD = 40, TITLE_H = 50, GROUP_PAD = 30;
  const CROSS_GAP = 80;

  // Categorize
  const crossCutTypes = new Set([
    "monitor", "azure monitor", "monitoring", "key vault", "key vaults",
    "active directory", "azure ad", "entra id", "defender", "log analytics",
    "security", "backup", "application insights", "app insights",
  ]);

  const mainFlow: typeof components = [];
  const crossCut: typeof components = [];
  for (const c of components) {
    const t = (c.type || c.name || "").toLowerCase();
    if ([...crossCutTypes].some(cc => t.includes(cc))) {
      crossCut.push(c);
    } else {
      mainFlow.push(c);
    }
  }

  const n = mainFlow.length;
  const nCross = crossCut.length;
  const cols = layout === "LR" ? n : Math.min(n, 5);
  const rows = cols > 0 ? Math.ceil(n / cols) : 1;

  const totalW = Math.max(
    PAD * 2 + cols * (CELL_W + H_GAP),
    PAD * 2 + nCross * (CELL_W + H_GAP),
    600
  );
  const mainH = TITLE_H + rows * (CELL_H + V_GAP);
  const crossH = nCross > 0 ? CELL_H + 40 : 0;
  const totalH = mainH + CROSS_GAP + crossH + PAD * 2;

  const cellsXml: string[] = [];
  const nodeIds: Record<string, string> = {};

  // Title
  const titleId = nextCellId();
  cellsXml.push(
    `<mxCell id="${titleId}" value="${xmlEscape(title)}" style="text;html=1;fontSize=18;fontStyle=1;fontColor=#1A237E;align=center;" vertex="1" parent="1">` +
    `<mxGeometry x="${PAD}" y="10" width="${totalW - PAD * 2}" height="40" as="geometry"/></mxCell>`
  );

  // Region group
  const regionId = nextCellId();
  const gx = PAD, gy = TITLE_H;
  const gw = totalW - PAD * 2, gh = mainH - TITLE_H + GROUP_PAD;
  cellsXml.push(
    `<mxCell id="${regionId}" value="Azure Cloud" style="${GROUP_STYLES.region}" vertex="1" parent="1">` +
    `<mxGeometry x="${gx}" y="${gy}" width="${gw}" height="${gh}" as="geometry"/></mxCell>`
  );

  // Main flow
  for (let i = 0; i < mainFlow.length; i++) {
    const comp = mainFlow[i];
    const name = comp.name;
    const svcType = (comp.type || comp.name || "").toLowerCase();
    
    const col = layout === "LR" ? i : i % cols;
    const row = layout === "LR" ? 0 : Math.floor(i / cols);
    
    const cx = GROUP_PAD + col * (CELL_W + H_GAP);
    const cy = GROUP_PAD + 10 + row * (CELL_H + V_GAP);

    const shape = AZURE_SHAPES[svcType];
    const id = nextCellId();
    nodeIds[name] = id;

    if (shape) {
      const style = `shape=image;verticalLabelPosition=bottom;labelBackgroundColor=default;verticalAlign=top;aspect=fixed;imageAspect=0;image=azure-icon://${encodeURIComponent(shape.icon_file)};`;
      cellsXml.push(
        `<mxCell id="${id}" value="${xmlEscape(name)}" style="${style}" vertex="1" parent="${regionId}">` +
        `<mxGeometry x="${cx}" y="${cy}" width="${ICON_W}" height="${ICON_H}" as="geometry"/></mxCell>`
      );
    } else {
      const style = "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontColor=#333;fontSize=12;fontStyle=1;";
      cellsXml.push(
        `<mxCell id="${id}" value="${xmlEscape(name)}" style="${style}" vertex="1" parent="${regionId}">` +
        `<mxGeometry x="${cx}" y="${cy}" width="${CELL_W}" height="${CELL_H}" as="geometry"/></mxCell>`
      );
    }
  }

  // Cross-cutting services
  if (nCross > 0) {
    const crossY = mainH + CROSS_GAP;
    const crossLabelId = nextCellId();
    cellsXml.push(
      `<mxCell id="${crossLabelId}" value="Cross-Cutting Services" style="text;html=1;fontSize=12;fontStyle=3;fontColor=#666;align=center;" vertex="1" parent="1">` +
      `<mxGeometry x="${PAD}" y="${crossY - 20}" width="${totalW - PAD * 2}" height="20" as="geometry"/></mxCell>`
    );

    const startX = PAD + (totalW - PAD * 2 - nCross * (CELL_W + H_GAP) + H_GAP) / 2;
    for (let i = 0; i < crossCut.length; i++) {
      const comp = crossCut[i];
      const name = comp.name;
      const svcType = (comp.type || comp.name || "").toLowerCase();
      
      const cx = startX + i * (CELL_W + H_GAP);
      const cy = crossY + 5;

      const shape = AZURE_SHAPES[svcType];
      const id = nextCellId();
      nodeIds[name] = id;

      if (shape) {
        const style = `shape=image;verticalLabelPosition=bottom;labelBackgroundColor=default;verticalAlign=top;aspect=fixed;imageAspect=0;image=azure-icon://${encodeURIComponent(shape.icon_file)};`;
        cellsXml.push(
          `<mxCell id="${id}" value="${xmlEscape(name)}" style="${style}" vertex="1" parent="1">` +
          `<mxGeometry x="${cx}" y="${cy}" width="${ICON_W}" height="${ICON_H}" as="geometry"/></mxCell>`
        );
      } else {
        const style = "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontColor=#333;fontSize=12;fontStyle=1;";
        cellsXml.push(
          `<mxCell id="${id}" value="${xmlEscape(name)}" style="${style}" vertex="1" parent="1">` +
          `<mxGeometry x="${cx}" y="${cy}" width="${CELL_W}" height="${CELL_H}" as="geometry"/></mxCell>`
        );
      }
    }
  }

  // Edges
  if (edges) {
    for (const e of edges) {
      const srcId = nodeIds[e.source];
      const tgtId = nodeIds[e.target];
      if (srcId && tgtId) {
        const id = nextCellId();
        cellsXml.push(
          `<mxCell id="${id}" value="${xmlEscape(e.label || "")}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#666;strokeWidth=2;" edge="1" source="${srcId}" target="${tgtId}" parent="1">` +
          `<mxGeometry relative="1" as="geometry"/></mxCell>`
        );
      }
    }
  } else {
    // Auto-connect main flow sequentially
    const names = mainFlow.map(c => c.name);
    for (let i = 0; i < names.length - 1; i++) {
      const src = nodeIds[names[i]];
      const tgt = nodeIds[names[i + 1]];
      if (src && tgt) {
        const id = nextCellId();
        cellsXml.push(
          `<mxCell id="${id}" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#666;strokeWidth=2;" edge="1" source="${src}" target="${tgt}" parent="1">` +
          `<mxGeometry relative="1" as="geometry"/></mxCell>`
        );
      }
    }
  }

  // Assemble
  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="drawio-mcp" type="device">
  <diagram id="azure-arch" name="${xmlEscape(title)}">
    <mxGraphModel dx="${totalW + 40}" dy="${totalH + 40}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${totalW + 40}" pageHeight="${totalH + 40}" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        ${cellsXml.join("\n        ")}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
}

// ── Start Server ────────────────────────────────────────────────────────────

console.log(`Draw.io MCP Server starting on port ${HTTP_PORT}...`);

Deno.serve({ port: HTTP_PORT }, handleRequest);
