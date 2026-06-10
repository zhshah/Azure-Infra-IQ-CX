"""
Draw.io Diagram Generator Service
Generates professional Azure architecture diagrams in draw.io XML format
with proper Azure service icons, layout, grouping and edges.
"""

import json
import base64
import zlib
import urllib.parse
from pathlib import Path
from typing import Dict, List, Any, Optional
import logging

logger = logging.getLogger(__name__)

# ── Azure Service → Icon mapping ──────────────────────────────────────────────
# Maps common Azure service names to their SVG icon files in the Icons directory

ICONS_DIR = Path(__file__).parent.parent.parent / "Icons"

# Map of azure service type keywords to icon file paths (relative to Icons dir)
AZURE_ICON_MAP = {
    # Compute
    "virtual machine": "compute/10021-icon-service-Virtual-Machine.svg",
    "vm": "compute/10021-icon-service-Virtual-Machine.svg",
    "app service": "app services/10035-icon-service-App-Services.svg",
    "web app": "app services/10035-icon-service-App-Services.svg",
    "function": "compute/10029-icon-service-Function-Apps.svg",
    "functions": "compute/10029-icon-service-Function-Apps.svg",
    "azure functions": "compute/10029-icon-service-Function-Apps.svg",
    "kubernetes": "containers/10023-icon-service-Kubernetes-Services.svg",
    "aks": "containers/10023-icon-service-Kubernetes-Services.svg",
    "container instance": "containers/10104-icon-service-Container-Instances.svg",
    "container app": "other/02884-icon-service-Worker-Container-App.svg",
    "container registry": "containers/10105-icon-service-Container-Registries.svg",
    # Networking
    "load balancer": "networking/10062-icon-service-Load-Balancers.svg",
    "front door": "networking/10073-icon-service-Front-Door-and-CDN-Profiles.svg",
    "application gateway": "networking/10076-icon-service-Application-Gateways.svg",
    "virtual network": "networking/10061-icon-service-Virtual-Networks.svg",
    "vnet": "networking/10061-icon-service-Virtual-Networks.svg",
    "firewall": "networking/10084-icon-service-Firewalls.svg",
    "vpn": "networking/10063-icon-service-Virtual-Network-Gateways.svg",
    "vpn gateway": "networking/10063-icon-service-Virtual-Network-Gateways.svg",
    "bastion": "networking/02422-icon-service-Bastions.svg",
    "dns": "networking/10064-icon-service-DNS-Zones.svg",
    "cdn": "networking/10073-icon-service-Front-Door-and-CDN-Profiles.svg",
    "traffic manager": "networking/10065-icon-service-Traffic-Manager-Profiles.svg",
    "api management": "web/10042-icon-service-API-Management-Services.svg",
    "private endpoint": "networking/02579-icon-service-Private-Endpoints.svg",
    # Databases
    "sql database": "databases/10130-icon-service-SQL-Database.svg",
    "sql server": "databases/10132-icon-service-SQL-Server.svg",
    "azure sql": "databases/02390-icon-service-Azure-SQL.svg",
    "cosmos db": "databases/10121-icon-service-Azure-Cosmos-DB.svg",
    "cosmosdb": "databases/10121-icon-service-Azure-Cosmos-DB.svg",
    "mysql": "databases/10122-icon-service-Azure-Database-MySQL-Server.svg",
    "postgresql": "databases/10131-icon-service-Azure-Database-PostgreSQL-Server.svg",
    "postgres": "databases/10131-icon-service-Azure-Database-PostgreSQL-Server.svg",
    "redis": "databases/10137-icon-service-Cache-Redis.svg",
    "cache": "databases/10137-icon-service-Cache-Redis.svg",
    "sql managed instance": "databases/10136-icon-service-SQL-Managed-Instance.svg",
    # Storage
    "storage account": "storage/10086-icon-service-Storage-Accounts.svg",
    "storage": "storage/10086-icon-service-Storage-Accounts.svg",
    "blob storage": "general/10839-icon-service-Storage-Container.svg",
    "data lake": "storage/10090-icon-service-Data-Lake-Storage-Gen1.svg",
    "file share": "general/10838-icon-service-Storage-Azure-Files.svg",
    "queue storage": "general/10840-icon-service-Storage-Queue.svg",
    # Security
    "key vault": "security/10245-icon-service-Key-Vaults.svg",
    "active directory": "identity/10221-icon-service-Azure-Active-Directory.svg",
    "azure ad": "identity/10221-icon-service-Azure-Active-Directory.svg",
    "aad": "identity/10221-icon-service-Azure-Active-Directory.svg",
    "entra id": "identity/10221-icon-service-Azure-Active-Directory.svg",
    "defender": "security/10244-icon-service-Microsoft-Defender-for-Cloud.svg",
    # Monitoring
    "monitor": "monitor/00001-icon-service-Monitor.svg",
    "azure monitor": "monitor/00001-icon-service-Monitor.svg",
    "log analytics": "management + governance/00009-icon-service-Log-Analytics-Workspaces.svg",
    "application insights": "monitor/00012-icon-service-Application-Insights.svg",
    "app insights": "monitor/00012-icon-service-Application-Insights.svg",
    # AI/ML
    "cognitive services": "ai + machine learning/10162-icon-service-Cognitive-Services.svg",
    "openai": "ai + machine learning/10162-icon-service-Cognitive-Services.svg",
    "machine learning": "ai + machine learning/10166-icon-service-Machine-Learning.svg",
    "ai search": "general/10044-icon-service-Search-Services.svg",
    "search": "general/10044-icon-service-Search-Services.svg",
    # Integration
    "service bus": "integration/10836-icon-service-Service-Bus.svg",
    "event hub": "integration/10150-icon-service-Event-Hubs.svg",
    "event grid": "integration/10158-icon-service-Event-Grid-Topics.svg",
    "logic app": "integration/10152-icon-service-Logic-Apps.svg",
    # Web
    "notification hub": "web/10045-icon-service-Notification-Hubs.svg",
    "signalr": "web/10153-icon-service-SignalR.svg",
    # Misc
    "backup": "general/10094-icon-service-Recovery-Services-Vaults.svg",
    "recovery services": "general/10094-icon-service-Recovery-Services-Vaults.svg",
    "site recovery": "general/10094-icon-service-Recovery-Services-Vaults.svg",
}


def _resolve_icon_path(service_name: str) -> Optional[Path]:
    """Resolve a service name to its SVG icon file path."""
    name_lower = service_name.lower().strip()
    
    # Direct match
    for key, rel_path in AZURE_ICON_MAP.items():
        if key in name_lower or name_lower in key:
            full_path = ICONS_DIR / rel_path
            if full_path.exists():
                return full_path
    
    # Partial match on words
    words = name_lower.replace("-", " ").replace("_", " ").split()
    for key, rel_path in AZURE_ICON_MAP.items():
        if any(w in key for w in words if len(w) > 3):
            full_path = ICONS_DIR / rel_path
            if full_path.exists():
                return full_path
    
    return None


def _svg_to_base64_style(svg_path: Path) -> str:
    """Convert an SVG file to a draw.io base64 image style.
    Uses URL-encoding of base64 data to ensure draw.io desktop compatibility."""
    try:
        svg_data = svg_path.read_bytes()
        b64 = base64.b64encode(svg_data).decode("ascii")
        # URL-encode the base64 data to prevent XML parsing issues in draw.io desktop
        encoded = urllib.parse.quote(b64, safe='')
        return (
            "shape=image;verticalLabelPosition=bottom;labelBackgroundColor=default;"
            "verticalAlign=top;aspect=fixed;imageAspect=0;"
            f"image=data:image/svg+xml;base64,{encoded};"
        )
    except Exception:
        return ""


def _default_style() -> str:
    """Default style for services without an icon."""
    return "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontColor=#333333;fontSize=12;fontStyle=1;"


# ── Azure color palette for groups ────────────────────────────────────────────
GROUP_STYLES = {
    "vnet": "rounded=1;whiteSpace=wrap;html=1;fillColor=#E8F5E9;strokeColor=#4CAF50;strokeWidth=2;dashed=0;opacity=40;verticalAlign=top;fontStyle=1;fontSize=13;fontColor=#2E7D32;",
    "subnet": "rounded=1;whiteSpace=wrap;html=1;fillColor=#E3F2FD;strokeColor=#1976D2;strokeWidth=1;dashed=1;opacity=30;verticalAlign=top;fontStyle=0;fontSize=11;fontColor=#1565C0;",
    "rg": "rounded=1;whiteSpace=wrap;html=1;fillColor=#FFF3E0;strokeColor=#FF9800;strokeWidth=2;dashed=0;opacity=30;verticalAlign=top;fontStyle=1;fontSize=13;fontColor=#E65100;",
    "region": "rounded=1;whiteSpace=wrap;html=1;fillColor=#F3E5F5;strokeColor=#9C27B0;strokeWidth=2;dashed=0;opacity=25;verticalAlign=top;fontStyle=1;fontSize=14;fontColor=#6A1B9A;",
    "zone": "rounded=1;whiteSpace=wrap;html=1;fillColor=#ECEFF1;strokeColor=#607D8B;strokeWidth=1;dashed=1;opacity=25;verticalAlign=top;fontStyle=0;fontSize=11;fontColor=#455A64;",
    "default": "rounded=1;whiteSpace=wrap;html=1;fillColor=#F5F5F5;strokeColor=#9E9E9E;strokeWidth=2;dashed=0;opacity=30;verticalAlign=top;fontStyle=1;fontSize=13;fontColor=#424242;",
}

EDGE_STYLE = "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#666666;strokeWidth=2;fontColor=#333333;fontSize=10;"
EDGE_STYLE_DASHED = "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#999999;strokeWidth=1;dashed=1;fontColor=#666666;fontSize=10;"


class DrawioDiagramService:
    """Generates draw.io XML diagrams with real Azure service icons."""

    def __init__(self):
        self.icons_dir = ICONS_DIR
        self._cell_id = 2  # 0 and 1 are reserved in draw.io

    def _next_id(self) -> int:
        cid = self._cell_id
        self._cell_id += 1
        return cid

    def generate_architecture_diagram(
        self,
        components: List[Dict[str, Any]],
        title: str = "Azure Architecture",
        layout: str = "TB",  # TB = top-to-bottom, LR = left-to-right
        groups: Optional[List[Dict[str, Any]]] = None,
        edges: Optional[List[Dict[str, Any]]] = None,
    ) -> str:
        """
        Generate a complete draw.io XML diagram with Azure icons.
        
        Args:
            components: List of {name, type, description?} dicts
            title: Diagram title
            layout: TB or LR
            groups: Optional groups [{name, type, children}]
            edges: Optional explicit edges [{source, target, label?}]
        
        Returns:
            Complete draw.io XML string (mxfile format)
        """
        self._cell_id = 2  # Reset
        cells = []
        node_ids = {}  # name -> cell_id for edges

        # Layout constants
        ICON_W, ICON_H = 64, 64
        LABEL_H = 24
        CELL_W, CELL_H = 80, 88  # icon + label
        H_GAP, V_GAP = 40, 60
        PADDING = 40
        TITLE_H = 50
        GROUP_PAD = 30
        CROSS_CUT_GAP = 80

        # Categorize components
        main_flow = []
        cross_cutting = []
        CROSS_CUT_TYPES = {"monitor", "azure monitor", "monitoring", "key vault",
                           "active directory", "azure ad", "aad", "entra id",
                           "defender", "log analytics", "security", "backup",
                           "application insights", "app insights"}

        for comp in components:
            comp_type = (comp.get("type") or comp.get("name") or "").lower()
            if any(cc in comp_type for cc in CROSS_CUT_TYPES):
                cross_cutting.append(comp)
            else:
                main_flow.append(comp)

        # Calculate layout dimensions
        n_main = len(main_flow)
        n_cross = len(cross_cutting)

        if layout == "LR":
            # Left-to-right main flow
            main_cols = n_main
            main_rows = 1
        else:
            # Top-to-bottom: max 5 per row
            main_cols = min(n_main, 5)
            main_rows = (n_main + main_cols - 1) // main_cols if main_cols > 0 else 1

        total_w = max(
            PADDING * 2 + main_cols * (CELL_W + H_GAP) - H_GAP,
            PADDING * 2 + n_cross * (CELL_W + H_GAP) - H_GAP,
            400
        )
        main_area_h = TITLE_H + main_rows * (CELL_H + V_GAP)
        cross_area_h = CELL_H + LABEL_H + 20 if cross_cutting else 0
        total_h = main_area_h + CROSS_CUT_GAP + cross_area_h + PADDING * 2

        # ── Title ────────────────────────────────────
        title_id = self._next_id()
        cells.append(
            f'<mxCell id="{title_id}" value="{_xml_escape(title)}" '
            f'style="text;html=1;fontSize=18;fontStyle=1;fontColor=#1A237E;align=center;verticalAlign=middle;" '
            f'vertex="1" parent="1">'
            f'<mxGeometry x="{PADDING}" y="10" width="{total_w - PADDING*2}" height="{TITLE_H - 10}" as="geometry"/>'
            f'</mxCell>'
        )

        # ── Main flow group ──────────────────────────
        group_id = self._next_id()
        group_x, group_y = PADDING, TITLE_H
        group_w = total_w - PADDING * 2
        group_h = main_area_h - TITLE_H + GROUP_PAD
        cells.append(
            f'<mxCell id="{group_id}" value="Azure Cloud" '
            f'style="{GROUP_STYLES["region"]}" '
            f'vertex="1" parent="1">'
            f'<mxGeometry x="{group_x}" y="{group_y}" width="{group_w}" height="{group_h}" as="geometry"/>'
            f'</mxCell>'
        )

        # ── Main flow components ─────────────────────
        for idx, comp in enumerate(main_flow):
            name = comp.get("name", f"Service {idx}")
            svc_type = comp.get("type", name)
            desc = comp.get("description", "")

            if layout == "LR":
                col, row = idx, 0
            else:
                col = idx % main_cols
                row = idx // main_cols

            cx = group_x + GROUP_PAD + col * (CELL_W + H_GAP)
            cy = group_y + GROUP_PAD + 10 + row * (CELL_H + V_GAP)

            # Try to find Azure icon
            icon_path = _resolve_icon_path(svc_type) or _resolve_icon_path(name)
            if icon_path:
                style = _svg_to_base64_style(icon_path)
            else:
                style = _default_style()

            cell_id = self._next_id()
            node_ids[name] = cell_id

            # Label below icon
            label = _xml_escape(name)
            if desc:
                label += f"<br/><font style='font-size:9px;color:#666;'>{_xml_escape(desc[:40])}</font>"

            if icon_path:
                # Icon cell
                cells.append(
                    f'<mxCell id="{cell_id}" value="{label}" '
                    f'style="{style}" '
                    f'vertex="1" parent="{group_id}">'
                    f'<mxGeometry x="{cx - group_x}" y="{cy - group_y}" width="{ICON_W}" height="{ICON_W}" as="geometry"/>'
                    f'</mxCell>'
                )
            else:
                # Rounded rectangle fallback
                cells.append(
                    f'<mxCell id="{cell_id}" value="{label}" '
                    f'style="{style}" '
                    f'vertex="1" parent="{group_id}">'
                    f'<mxGeometry x="{cx - group_x}" y="{cy - group_y}" width="{CELL_W}" height="{CELL_H}" as="geometry"/>'
                    f'</mxCell>'
                )

        # ── Cross-cutting services ───────────────────
        if cross_cutting:
            cross_y = main_area_h + CROSS_CUT_GAP
            cross_label_id = self._next_id()
            cells.append(
                f'<mxCell id="{cross_label_id}" value="Cross-Cutting Services" '
                f'style="text;html=1;fontSize=12;fontStyle=3;fontColor=#666666;align=center;" '
                f'vertex="1" parent="1">'
                f'<mxGeometry x="{PADDING}" y="{cross_y - 20}" width="{total_w - PADDING*2}" height="20" as="geometry"/>'
                f'</mxCell>'
            )

            cross_start_x = PADDING + (total_w - PADDING * 2 - n_cross * (CELL_W + H_GAP) + H_GAP) / 2
            for idx, comp in enumerate(cross_cutting):
                name = comp.get("name", f"Service {idx}")
                svc_type = comp.get("type", name)
                
                cx = cross_start_x + idx * (CELL_W + H_GAP)
                cy = cross_y + 5

                icon_path = _resolve_icon_path(svc_type) or _resolve_icon_path(name)
                if icon_path:
                    style = _svg_to_base64_style(icon_path)
                else:
                    style = _default_style()

                cell_id = self._next_id()
                node_ids[name] = cell_id
                label = _xml_escape(name)

                if icon_path:
                    cells.append(
                        f'<mxCell id="{cell_id}" value="{label}" '
                        f'style="{style}" '
                        f'vertex="1" parent="1">'
                        f'<mxGeometry x="{cx}" y="{cy}" width="{ICON_W}" height="{ICON_W}" as="geometry"/>'
                        f'</mxCell>'
                    )
                else:
                    cells.append(
                        f'<mxCell id="{cell_id}" value="{label}" '
                        f'style="{style}" '
                        f'vertex="1" parent="1">'
                        f'<mxGeometry x="{cx}" y="{cy}" width="{CELL_W}" height="{CELL_H}" as="geometry"/>'
                        f'</mxCell>'
                    )

        # ── Edges ────────────────────────────────────
        if edges:
            for edge in edges:
                src_name = edge.get("source", "")
                tgt_name = edge.get("target", "")
                label = edge.get("label", "")
                dashed = edge.get("dashed", False)
                
                src_id = node_ids.get(src_name)
                tgt_id = node_ids.get(tgt_name)
                if src_id and tgt_id:
                    edge_id = self._next_id()
                    style = EDGE_STYLE_DASHED if dashed else EDGE_STYLE
                    cells.append(
                        f'<mxCell id="{edge_id}" value="{_xml_escape(label)}" '
                        f'style="{style}" '
                        f'edge="1" source="{src_id}" target="{tgt_id}" parent="1">'
                        f'<mxGeometry relative="1" as="geometry"/>'
                        f'</mxCell>'
                    )
        else:
            # Auto-generate sequential edges for main flow
            main_names = [c.get("name", "") for c in main_flow]
            for i in range(len(main_names) - 1):
                src_id = node_ids.get(main_names[i])
                tgt_id = node_ids.get(main_names[i + 1])
                if src_id and tgt_id:
                    edge_id = self._next_id()
                    cells.append(
                        f'<mxCell id="{edge_id}" value="" '
                        f'style="{EDGE_STYLE}" '
                        f'edge="1" source="{src_id}" target="{tgt_id}" parent="1">'
                        f'<mxGeometry relative="1" as="geometry"/>'
                        f'</mxCell>'
                    )

        # ── Assemble draw.io XML ─────────────────────
        cells_xml = "\n        ".join(cells)
        diagram_xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" type="device">
  <diagram id="azure-arch" name="{_xml_escape(title)}">
    <mxGraphModel dx="{total_w + 40}" dy="{total_h + 40}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="{total_w + 40}" pageHeight="{total_h + 40}" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        {cells_xml}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>'''

        return diagram_xml

    def generate_from_agent_output(
        self,
        agent_name: str,
        output_data: Dict[str, Any],
        assessment_name: str = "Assessment"
    ) -> str:
        """
        Generate a draw.io diagram from APEX agent output data.
        
        Routes to the appropriate diagram generator based on agent type.
        Handles both rich (new) and basic (legacy) output formats.
        """
        if agent_name == "03-architect":
            return self._diagram_from_architecture(output_data, assessment_name)
        elif agent_name == "04-design":
            return self._diagram_from_design(output_data, assessment_name)
        else:
            # Generic diagram from any agent with components
            components = output_data.get("components", [])
            if not components:
                # Try to extract from resource_inventory (as-built format)
                for item in (output_data.get("resource_inventory") or []):
                    if isinstance(item, dict):
                        components.append({
                            "name": item.get("name") or item.get("resource") or "Resource",
                            "type": item.get("type") or item.get("sku") or "",
                        })
                    elif isinstance(item, str):
                        components.append({"name": item, "type": item})
            if not components:
                return self._minimal_diagram(assessment_name)
            return self.generate_architecture_diagram(
                components=components,
                title=f"{assessment_name} — Architecture"
            )

    def _diagram_from_architecture(self, data: Dict, title: str) -> str:
        """Generate diagram from 03-architect output (handles both rich and basic formats)."""
        components = []
        edges = []
        
        for comp in data.get("components", []):
            if isinstance(comp, dict):
                name = comp.get("name") or comp.get("service") or "Component"
                comp_type = comp.get("type") or comp.get("current_sku") or comp.get("name") or ""
                desc = comp.get("description") or comp.get("purpose") or comp.get("configuration_review") or ""
                # Append SKU info to description if available
                sku = comp.get("current_sku") or comp.get("recommended_sku") or ""
                if sku and sku not in desc:
                    desc = f"{sku} — {desc}" if desc else sku
                components.append({
                    "name": name,
                    "type": comp_type,
                    "description": desc[:50] if desc else "",
                })
            else:
                components.append({"name": str(comp), "type": str(comp)})

        # Build edges from data_flow if present
        if data.get("data_flow"):
            for flow in data["data_flow"]:
                if isinstance(flow, dict):
                    src = flow.get("from") or flow.get("source") or ""
                    tgt = flow.get("to") or flow.get("target") or ""
                    label = flow.get("description") or flow.get("label") or flow.get("protocol") or ""
                    if src and tgt:
                        edges.append({
                            "source": src,
                            "target": tgt,
                            "label": label[:30] if label else "",
                        })
                elif isinstance(flow, str) and "→" in flow:
                    parts = flow.split("→")
                    if len(parts) >= 2:
                        edges.append({"source": parts[0].strip(), "target": parts[-1].strip()})

        # Also extract integration_points as edges
        for ip in data.get("integration_points", []):
            if isinstance(ip, dict):
                src = ip.get("service_a") or ip.get("from") or ""
                tgt = ip.get("service_b") or ip.get("to") or ""
                label = ip.get("integration_type") or ip.get("description") or ""
                if src and tgt:
                    edges.append({"source": src, "target": tgt, "label": label[:25], "dashed": True})

        if not components:
            return self._minimal_diagram(title)

        return self.generate_architecture_diagram(
            components=components,
            title=f"{title} — Architecture",
            layout="LR",
            edges=edges if edges else None,
        )

    def _diagram_from_design(self, data: Dict, title: str) -> str:
        """Generate diagram from 04-design output (handles both rich and basic formats)."""
        components = []

        # Extract from compute_design
        for item in data.get("compute_design", []):
            if isinstance(item, dict):
                name = item.get("resource_name") or item.get("vm_name") or item.get("name") or item.get("resource") or "Compute"
                sku = item.get("sku") or item.get("vm_size") or ""
                comp_type = item.get("type") or ("Virtual Machine" if "vm" in name.lower() else "App Service")
                components.append({
                    "name": name,
                    "type": comp_type,
                    "description": sku[:40] if sku else "",
                })
            elif isinstance(item, str):
                components.append({"name": item, "type": "App Service"})

        # Extract from database_design (new rich format)
        for item in data.get("database_design", []):
            if isinstance(item, dict):
                name = item.get("resource_name") or item.get("name") or "Database"
                engine = item.get("engine") or item.get("type") or "SQL Database"
                components.append({
                    "name": name,
                    "type": engine,
                    "description": item.get("sku") or item.get("version") or "",
                })

        # Extract from storage_design
        for item in data.get("storage_design", []):
            if isinstance(item, dict):
                name = item.get("resource_name") or item.get("storage_account_name") or item.get("name") or "Storage"
                components.append({
                    "name": name,
                    "type": "Storage Account",
                    "description": item.get("account_type") or item.get("kind") or item.get("sku") or "",
                })
            elif isinstance(item, str):
                components.append({"name": item, "type": "Storage Account"})

        # Extract from network_security
        for item in data.get("network_security", []):
            if isinstance(item, dict):
                name = item.get("resource_name") or item.get("network_security_group_name") or item.get("name") or "NSG"
                ntype = item.get("type") or "Firewall"
                components.append({
                    "name": name,
                    "type": ntype,
                    "description": item.get("purpose") or "",
                })
            elif isinstance(item, str):
                components.append({"name": item, "type": "Firewall"})

        # Extract from monitoring
        for item in data.get("monitoring", []):
            if isinstance(item, dict):
                name = item.get("resource_name") or item.get("monitoring_solution") or item.get("name") or "Monitoring"
                components.append({
                    "name": name,
                    "type": "Azure Monitor",
                })
            elif isinstance(item, str):
                components.append({"name": item, "type": "Azure Monitor"})

        # Extract from identity
        for item in data.get("identity", []):
            if isinstance(item, dict):
                name = item.get("principal") or item.get("name") or "Identity"
                mi = item.get("managed_identity", {})
                if mi or "managed" in name.lower():
                    components.append({
                        "name": name,
                        "type": "Active Directory",
                    })
            elif isinstance(item, str):
                components.append({"name": item, "type": "Active Directory"})

        if not components:
            return self._minimal_diagram(title)

        return self.generate_architecture_diagram(
            components=components,
            title=f"{title} — Detailed Design",
            layout="LR",
        )

    def _minimal_diagram(self, title: str) -> str:
        """Generate a minimal placeholder diagram."""
        return self.generate_architecture_diagram(
            components=[
                {"name": "Client", "type": "web app"},
                {"name": "Application", "type": "App Service"},
                {"name": "Database", "type": "SQL Database"},
            ],
            title=f"{title} — Architecture",
            layout="LR",
        )


def _xml_escape(text: str) -> str:
    """Escape text for XML attributes."""
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )
