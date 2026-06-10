"""
Diagram Image Renderer Service
Generates PNG-ready SVG architecture diagrams directly from component data.
Uses the same Azure icon SVGs as the draw.io service but outputs a proper 
standalone SVG image that can be rendered to PNG via browser canvas.
"""

import base64
from pathlib import Path
from typing import Dict, List, Any, Optional
import logging

logger = logging.getLogger(__name__)

ICONS_DIR = Path(__file__).parent.parent.parent / "Icons"

# Azure service to icon mapping (same as drawio_service)
AZURE_ICON_MAP = {
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
    "container apps": "other/02884-icon-service-Worker-Container-App.svg",
    "container registry": "containers/10105-icon-service-Container-Registries.svg",
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
    "storage account": "storage/10086-icon-service-Storage-Accounts.svg",
    "storage": "storage/10086-icon-service-Storage-Accounts.svg",
    "blob storage": "general/10839-icon-service-Storage-Container.svg",
    "data lake": "storage/10090-icon-service-Data-Lake-Storage-Gen1.svg",
    "file share": "general/10838-icon-service-Storage-Azure-Files.svg",
    "queue storage": "general/10840-icon-service-Storage-Queue.svg",
    "key vault": "security/10245-icon-service-Key-Vaults.svg",
    "active directory": "identity/10221-icon-service-Azure-Active-Directory.svg",
    "azure ad": "identity/10221-icon-service-Azure-Active-Directory.svg",
    "aad": "identity/10221-icon-service-Azure-Active-Directory.svg",
    "entra id": "identity/10221-icon-service-Azure-Active-Directory.svg",
    "defender": "security/10244-icon-service-Microsoft-Defender-for-Cloud.svg",
    "monitor": "monitor/00001-icon-service-Monitor.svg",
    "azure monitor": "monitor/00001-icon-service-Monitor.svg",
    "log analytics": "management + governance/00009-icon-service-Log-Analytics-Workspaces.svg",
    "application insights": "monitor/00012-icon-service-Application-Insights.svg",
    "app insights": "monitor/00012-icon-service-Application-Insights.svg",
    "cognitive services": "ai + machine learning/10162-icon-service-Cognitive-Services.svg",
    "openai": "ai + machine learning/10162-icon-service-Cognitive-Services.svg",
    "azure openai": "ai + machine learning/10162-icon-service-Cognitive-Services.svg",
    "machine learning": "ai + machine learning/10166-icon-service-Machine-Learning.svg",
    "ai search": "general/10044-icon-service-Search-Services.svg",
    "search": "general/10044-icon-service-Search-Services.svg",
    "service bus": "integration/10836-icon-service-Service-Bus.svg",
    "event hub": "integration/10150-icon-service-Event-Hubs.svg",
    "event hubs": "integration/10150-icon-service-Event-Hubs.svg",
    "event grid": "integration/10158-icon-service-Event-Grid-Topics.svg",
    "logic app": "integration/10152-icon-service-Logic-Apps.svg",
    "notification hub": "web/10045-icon-service-Notification-Hubs.svg",
    "signalr": "web/10153-icon-service-SignalR.svg",
    "backup": "general/10094-icon-service-Recovery-Services-Vaults.svg",
    "recovery services": "general/10094-icon-service-Recovery-Services-Vaults.svg",
    "site recovery": "general/10094-icon-service-Recovery-Services-Vaults.svg",
    "data factory": "databases/10126-icon-service-Data-Factory.svg",
    "synapse": "analytics/00606-icon-service-Azure-Synapse-Analytics.svg",
    "databricks": "analytics/10787-icon-service-Azure-Databricks.svg",
    "iot hub": "iot/10182-icon-service-IoT-Hub.svg",
}

CROSS_CUT_TYPES = {
    "monitor", "azure monitor", "monitoring", "key vault", "key vaults",
    "active directory", "azure ad", "aad", "entra id",
    "defender", "log analytics", "security", "backup",
    "application insights", "app insights"
}


def _resolve_icon(service_name: str) -> Optional[str]:
    """Resolve service name to base64-encoded SVG data URL."""
    name_lower = service_name.lower().strip()
    
    # Direct match
    for key, rel_path in AZURE_ICON_MAP.items():
        if key in name_lower or name_lower in key:
            full_path = ICONS_DIR / rel_path
            if full_path.exists():
                try:
                    svg_data = full_path.read_bytes()
                    b64 = base64.b64encode(svg_data).decode("ascii")
                    return f"data:image/svg+xml;base64,{b64}"
                except Exception:
                    pass
                return None
    
    # Partial word match
    words = name_lower.replace("-", " ").replace("_", " ").split()
    for key, rel_path in AZURE_ICON_MAP.items():
        if any(w in key for w in words if len(w) > 3):
            full_path = ICONS_DIR / rel_path
            if full_path.exists():
                try:
                    svg_data = full_path.read_bytes()
                    b64 = base64.b64encode(svg_data).decode("ascii")
                    return f"data:image/svg+xml;base64,{b64}"
                except Exception:
                    pass
                return None
    return None


def _xml_esc(text: str) -> str:
    if not text:
        return ""
    return (text.replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


class DiagramImageService:
    """Generates standalone SVG architecture diagram images with embedded Azure icons."""

    def render_architecture_svg(
        self,
        components: List[Dict[str, Any]],
        title: str = "Azure Architecture",
        edges: Optional[List[Dict[str, Any]]] = None,
    ) -> str:
        """
        Render architecture components directly to an SVG image.
        Returns a complete SVG string ready for browser rendering.
        """
        # Layout constants
        ICON_SIZE = 56
        CARD_W = 100
        CARD_H = 90
        H_GAP = 50
        V_GAP = 60
        PADDING = 50
        TITLE_H = 50
        CROSS_GAP = 60

        # Separate main flow from cross-cutting
        main_flow = []
        cross_cutting = []
        for comp in components:
            comp_type = (comp.get("type") or comp.get("name") or "").lower()
            if any(cc in comp_type for cc in CROSS_CUT_TYPES):
                cross_cutting.append(comp)
            else:
                main_flow.append(comp)

        # Layout calculation
        n_main = len(main_flow)
        n_cross = len(cross_cutting)
        cols = min(n_main, 6)
        rows = (n_main + cols - 1) // cols if cols > 0 else 1

        content_w = cols * (CARD_W + H_GAP) - H_GAP
        total_w = max(content_w + PADDING * 2, 600)
        main_h = rows * (CARD_H + V_GAP) - V_GAP
        cross_h = CARD_H + 30 if cross_cutting else 0
        total_h = TITLE_H + PADDING + main_h + (CROSS_GAP + cross_h if cross_cutting else 0) + PADDING

        # Node positions for edge drawing
        node_positions = {}  # name -> (center_x, center_y)

        svg_parts = []
        svg_parts.append(
            f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            f'width="{total_w}" height="{total_h}" viewBox="0 0 {total_w} {total_h}">'
        )
        
        # Definitions (arrow markers, gradients)
        svg_parts.append('''<defs>
  <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
    <polygon points="0 0, 10 3.5, 0 7" fill="#64748b"/>
  </marker>
  <linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" style="stop-color:#0f172a"/>
    <stop offset="100%" style="stop-color:#1e293b"/>
  </linearGradient>
  <filter id="cardShadow" x="-5%" y="-5%" width="110%" height="120%">
    <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.3"/>
  </filter>
</defs>''')

        # Background
        svg_parts.append(f'<rect width="{total_w}" height="{total_h}" fill="url(#bgGrad)"/>')

        # Title
        svg_parts.append(
            f'<text x="{total_w/2}" y="{TITLE_H - 10}" text-anchor="middle" '
            f'fill="#f1f5f9" font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="bold">'
            f'{_xml_esc(title)}</text>'
        )

        # Azure Cloud boundary
        cloud_x = PADDING - 20
        cloud_y = TITLE_H + 5
        cloud_w = total_w - PADDING * 2 + 40
        cloud_h = main_h + 40
        svg_parts.append(
            f'<rect x="{cloud_x}" y="{cloud_y}" width="{cloud_w}" height="{cloud_h}" '
            f'rx="16" fill="none" stroke="#3b82f6" stroke-width="2" stroke-dasharray="8,4" opacity="0.6"/>'
        )
        svg_parts.append(
            f'<text x="{cloud_x + 16}" y="{cloud_y + 18}" fill="#60a5fa" '
            f'font-family="Segoe UI, Arial, sans-serif" font-size="12" font-weight="600" opacity="0.8">'
            f'Microsoft Azure</text>'
        )

        # Render main flow components
        start_x = (total_w - content_w) / 2
        start_y = TITLE_H + PADDING

        for idx, comp in enumerate(main_flow):
            name = comp.get("name") or comp.get("service") or f"Service {idx}"
            svc_type = comp.get("type") or comp.get("name") or ""

            col = idx % cols
            row = idx // cols
            cx = start_x + col * (CARD_W + H_GAP) + CARD_W / 2
            cy = start_y + row * (CARD_H + V_GAP) + CARD_H / 2
            x = cx - CARD_W / 2
            y = cy - CARD_H / 2

            node_positions[name] = (cx, cy)

            # Card background
            svg_parts.append(
                f'<rect x="{x}" y="{y}" width="{CARD_W}" height="{CARD_H}" '
                f'rx="10" fill="#1e293b" stroke="#334155" stroke-width="1.5" filter="url(#cardShadow)"/>'
            )

            # Icon
            icon_data_url = _resolve_icon(svc_type) or _resolve_icon(name)
            if icon_data_url:
                ix = cx - ICON_SIZE / 2
                iy = y + 8
                svg_parts.append(
                    f'<image x="{ix}" y="{iy}" width="{ICON_SIZE}" height="{ICON_SIZE}" '
                    f'href="{icon_data_url}"/>'
                )
            else:
                # Fallback: colored circle with initial
                initial = name[0].upper() if name else "?"
                svg_parts.append(
                    f'<circle cx="{cx}" cy="{y + 8 + ICON_SIZE/2}" r="{ICON_SIZE/2 - 4}" '
                    f'fill="#3b82f6" opacity="0.3"/>'
                )
                svg_parts.append(
                    f'<text x="{cx}" y="{y + 8 + ICON_SIZE/2 + 6}" text-anchor="middle" '
                    f'fill="#93c5fd" font-size="20" font-weight="bold">{initial}</text>'
                )

            # Label below icon
            label = name[:18] + "..." if len(name) > 18 else name
            svg_parts.append(
                f'<text x="{cx}" y="{y + CARD_H - 6}" text-anchor="middle" '
                f'fill="#e2e8f0" font-family="Segoe UI, Arial, sans-serif" font-size="10" font-weight="500">'
                f'{_xml_esc(label)}</text>'
            )

        # Render cross-cutting services
        if cross_cutting:
            cross_y = start_y + main_h + CROSS_GAP
            cross_content_w = n_cross * (CARD_W + H_GAP) - H_GAP
            cross_start_x = (total_w - cross_content_w) / 2

            # Separator line
            svg_parts.append(
                f'<line x1="{PADDING}" y1="{cross_y - 20}" x2="{total_w - PADDING}" y2="{cross_y - 20}" '
                f'stroke="#475569" stroke-width="1" stroke-dasharray="4,4"/>'
            )
            svg_parts.append(
                f'<text x="{total_w/2}" y="{cross_y - 6}" text-anchor="middle" '
                f'fill="#94a3b8" font-family="Segoe UI, Arial, sans-serif" font-size="11" font-style="italic">'
                f'Cross-Cutting Services</text>'
            )

            for idx, comp in enumerate(cross_cutting):
                name = comp.get("name") or comp.get("service") or f"Service {idx}"
                svc_type = comp.get("type") or comp.get("name") or ""

                cx = cross_start_x + idx * (CARD_W + H_GAP) + CARD_W / 2
                cy = cross_y + CARD_H / 2
                x = cx - CARD_W / 2
                y = cross_y

                node_positions[name] = (cx, cy)

                svg_parts.append(
                    f'<rect x="{x}" y="{y}" width="{CARD_W}" height="{CARD_H}" '
                    f'rx="10" fill="#1e293b" stroke="#475569" stroke-width="1" opacity="0.8"/>'
                )

                icon_data_url = _resolve_icon(svc_type) or _resolve_icon(name)
                if icon_data_url:
                    ix = cx - ICON_SIZE / 2
                    iy = y + 8
                    svg_parts.append(
                        f'<image x="{ix}" y="{iy}" width="{ICON_SIZE}" height="{ICON_SIZE}" '
                        f'href="{icon_data_url}"/>'
                    )

                label = name[:18] + "..." if len(name) > 18 else name
                svg_parts.append(
                    f'<text x="{cx}" y="{y + CARD_H - 6}" text-anchor="middle" '
                    f'fill="#94a3b8" font-family="Segoe UI, Arial, sans-serif" font-size="10">'
                    f'{_xml_esc(label)}</text>'
                )

        # Render edges (connections)
        if edges:
            for edge in edges:
                src = edge.get("source") or edge.get("from", "")
                tgt = edge.get("target") or edge.get("to", "")
                label = edge.get("label") or edge.get("description", "")

                src_pos = node_positions.get(src)
                tgt_pos = node_positions.get(tgt)
                if not src_pos or not tgt_pos:
                    continue

                sx, sy = src_pos
                tx, ty = tgt_pos

                # Orthogonal edge routing
                if abs(tx - sx) > abs(ty - sy):
                    # Mostly horizontal
                    mx = (sx + tx) / 2
                    path = f"M{sx},{sy} L{mx},{sy} L{mx},{ty} L{tx},{ty}"
                else:
                    # Mostly vertical
                    my = (sy + ty) / 2
                    path = f"M{sx},{sy} L{sx},{my} L{tx},{my} L{tx},{ty}"

                svg_parts.append(
                    f'<path d="{path}" fill="none" stroke="#64748b" stroke-width="1.5" '
                    f'marker-end="url(#arrowhead)" opacity="0.7"/>'
                )
                if label:
                    lx = (sx + tx) / 2
                    ly = (sy + ty) / 2 - 8
                    svg_parts.append(
                        f'<text x="{lx}" y="{ly}" text-anchor="middle" '
                        f'fill="#94a3b8" font-size="9" font-family="Segoe UI, Arial, sans-serif">'
                        f'{_xml_esc(label)}</text>'
                    )
        else:
            # Auto-generate sequential edges for main flow
            main_names = [c.get("name") or c.get("service", "") for c in main_flow]
            for i in range(len(main_names) - 1):
                src_pos = node_positions.get(main_names[i])
                tgt_pos = node_positions.get(main_names[i + 1])
                if not src_pos or not tgt_pos:
                    continue
                sx, sy = src_pos
                tx, ty = tgt_pos
                svg_parts.append(
                    f'<path d="M{sx + CARD_W/2 - 5},{sy} L{tx - CARD_W/2 + 5},{ty}" '
                    f'fill="none" stroke="#64748b" stroke-width="1.5" '
                    f'marker-end="url(#arrowhead)" opacity="0.6"/>'
                )

        svg_parts.append("</svg>")
        return "\n".join(svg_parts)

    def render_from_agent_output(
        self,
        agent_name: str,
        output_data: Dict[str, Any],
        assessment_name: str = "Assessment"
    ) -> str:
        """Render SVG image from APEX agent output data."""
        components = []
        edges = []

        if agent_name in ("03-architect", "04-design"):
            for comp in output_data.get("components", []):
                if isinstance(comp, dict):
                    components.append({
                        "name": comp.get("name") or comp.get("service") or "Component",
                        "type": comp.get("type") or comp.get("current_sku") or comp.get("name") or "",
                    })
                elif isinstance(comp, str):
                    components.append({"name": comp, "type": comp})

            for flow in output_data.get("data_flow", []):
                if isinstance(flow, dict):
                    edges.append({
                        "source": flow.get("from") or flow.get("source", ""),
                        "target": flow.get("to") or flow.get("target", ""),
                        "label": flow.get("description") or flow.get("label", ""),
                    })
        else:
            # Generic: try components or resource_inventory
            for item in output_data.get("components", output_data.get("resource_inventory", [])):
                if isinstance(item, dict):
                    components.append({
                        "name": item.get("name") or item.get("resource") or "Resource",
                        "type": item.get("type") or item.get("sku") or "",
                    })
                elif isinstance(item, str):
                    components.append({"name": item, "type": item})

        if not components:
            # Fallback: minimal placeholder
            components = [{"name": assessment_name, "type": "app service"}]

        title = f"{assessment_name} — Architecture"
        return self.render_architecture_svg(components=components, title=title, edges=edges or None)
