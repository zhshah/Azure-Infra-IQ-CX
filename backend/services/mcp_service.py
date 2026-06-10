"""
MCP (Model Context Protocol) Service
Integrates Azure Pricing and Draw.io MCP servers for APEX workflow.
Uses the DrawioDiagramService for real draw.io XML generation with Azure icons.
"""

import os
import json
import subprocess
import asyncio
import logging
from typing import Dict, List, Optional, Any
from pathlib import Path

from services.drawio_service import DrawioDiagramService

logger = logging.getLogger(__name__)

class MCPService:
    """Service for interacting with MCP servers (Azure Pricing, Draw.io)"""
    
    def __init__(self):
        self.mcp_dir = Path(__file__).parent.parent.parent / "apex-integration" / "mcp-servers"
        self.drawio_svc = DrawioDiagramService()
        self.pricing_process = None
        self.drawio_process = None
    
    async def get_azure_pricing(
        self,
        resource_type: str,
        region: str,
        sku: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get Azure pricing for a resource type."""
        pricing_data = {
            "resource_type": resource_type,
            "region": region,
            "sku": sku,
            "currency": "USD",
            "monthly_cost": self._estimate_cost(resource_type, sku),
            "pay_as_you_go": True,
            "reserved_pricing": {
                "1_year": 0,
                "3_year": 0
            }
        }
        return pricing_data
    
    def _estimate_cost(self, resource_type: str, sku: Optional[str]) -> float:
        """Estimate monthly cost based on resource type and SKU."""
        base_costs = {
            "virtualMachines": 150.0,
            "storage": 30.0,
            "database": 200.0,
            "appService": 100.0,
            "containerApps": 80.0,
            "aks": 300.0,
            "backup": 50.0,
            "loadBalancer": 40.0
        }
        
        base = base_costs.get(resource_type, 100.0)
        
        if sku:
            if "D2" in sku:
                return base * 1.0
            elif "D4" in sku:
                return base * 2.0
            elif "D8" in sku:
                return base * 4.0
            elif "D16" in sku:
                return base * 8.0
        
        return base
    
    async def calculate_dr_cost(
        self,
        architecture: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Calculate total DR cost for an architecture design."""
        total_monthly = 0.0
        resource_costs = []
        
        resources = architecture.get("resources", [])
        
        for resource in resources:
            pricing = await self.get_azure_pricing(
                resource.get("type", "unknown"),
                resource.get("region", "qatarcentral"),
                resource.get("sku")
            )
            
            resource_costs.append({
                "resource_name": resource.get("name", "Unknown"),
                "resource_type": resource.get("type", "unknown"),
                "monthly_cost": pricing["monthly_cost"]
            })
            
            total_monthly += pricing["monthly_cost"]
        
        return {
            "total_monthly_cost": round(total_monthly, 2),
            "total_annual_cost": round(total_monthly * 12, 2),
            "resource_breakdown": resource_costs,
            "currency": "USD"
        }
    
    async def compare_pricing_scenarios(
        self,
        scenarios: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Compare pricing across multiple architecture scenarios."""
        comparisons = []
        
        for idx, scenario in enumerate(scenarios):
            cost_analysis = await self.calculate_dr_cost(scenario)
            comparisons.append({
                "scenario_name": scenario.get("name", f"Scenario {idx + 1}"),
                "description": scenario.get("description", ""),
                "monthly_cost": cost_analysis["total_monthly_cost"],
                "annual_cost": cost_analysis["total_annual_cost"],
                "resource_count": len(scenario.get("resources", []))
            })
        
        comparisons.sort(key=lambda x: x["monthly_cost"])
        
        return {
            "scenarios": comparisons,
            "cheapest": comparisons[0] if comparisons else None,
            "most_expensive": comparisons[-1] if comparisons else None,
            "recommendations": self._generate_cost_recommendations(comparisons)
        }
    
    def _generate_cost_recommendations(self, comparisons: List[Dict]) -> List[str]:
        """Generate cost optimization recommendations."""
        recommendations = []
        
        if not comparisons:
            return recommendations
        
        cheapest = comparisons[0]
        most_expensive = comparisons[-1]
        
        if len(comparisons) > 1:
            savings = most_expensive["monthly_cost"] - cheapest["monthly_cost"]
            if savings > 0:
                recommendations.append(
                    f"Choosing {cheapest['scenario_name']} over {most_expensive['scenario_name']} "
                    f"saves ${savings:.2f}/month (${savings * 12:.2f}/year)"
                )
        
        recommendations.extend([
            "Consider using Reserved Instances for production workloads (up to 72% savings)",
            "Use Azure Hybrid Benefit if you have existing Windows/SQL licenses",
            "Implement auto-scaling to optimize costs during low-traffic periods",
            "Use Azure Cost Management + Billing alerts to track spending"
        ])
        
        return recommendations
    
    async def generate_architecture_diagram(
        self,
        architecture: Dict[str, Any],
        diagram_type: str = "network"
    ) -> Dict[str, Any]:
        """
        Generate architecture diagram using Draw.io service with native Azure icons.
        
        Returns draw.io XML format (mxfile) with embedded Azure service icons.
        """
        components = self._extract_components(architecture)
        edges = self._extract_edges(architecture)
        title = architecture.get("name", architecture.get("title", "Azure Architecture"))
        
        layout = "LR"  # Left-to-right for architecture diagrams
        if diagram_type == "network":
            layout = "TB"
        
        try:
            diagram_xml = self.drawio_svc.generate_architecture_diagram(
                components=components,
                title=title,
                layout=layout,
                edges=edges if edges else None,
            )
            
            logger.info(f"Generated draw.io diagram: {len(components)} components, {len(edges)} edges")
            
            return {
                "diagram_type": diagram_type,
                "format": "drawio",
                "content": diagram_xml,
                "component_count": len(components),
            }
        except Exception as e:
            logger.error(f"Draw.io diagram generation failed: {e}")
            raise
    
    async def generate_agent_diagram(
        self,
        agent_name: str,
        output_data: Dict[str, Any],
        assessment_name: str = "Assessment"
    ) -> Dict[str, Any]:
        """
        Generate a draw.io diagram from APEX agent execution output.
        Called when exporting architecture/design diagrams.
        """
        try:
            diagram_xml = self.drawio_svc.generate_from_agent_output(
                agent_name=agent_name,
                output_data=output_data,
                assessment_name=assessment_name,
            )
            
            return {
                "format": "drawio",
                "content": diagram_xml,
                "agent": agent_name,
            }
        except Exception as e:
            logger.error(f"Agent diagram generation failed for {agent_name}: {e}")
            raise
    
    def _extract_components(self, architecture: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Extract component list from architecture definition."""
        components = []
        
        # From "resources" list
        for res in architecture.get("resources", []):
            if isinstance(res, dict):
                components.append({
                    "name": res.get("name", res.get("service", "Resource")),
                    "type": res.get("type", res.get("resource_type", "")),
                    "description": res.get("description", res.get("purpose", "")),
                })
            elif isinstance(res, str):
                components.append({"name": res, "type": res})
        
        # From "components" list
        for comp in architecture.get("components", []):
            if isinstance(comp, dict):
                components.append({
                    "name": comp.get("name", comp.get("service", "Component")),
                    "type": comp.get("type", comp.get("name", "")),
                    "description": comp.get("description", comp.get("purpose", "")),
                })
            elif isinstance(comp, str):
                components.append({"name": comp, "type": comp})
        
        return components
    
    def _extract_edges(self, architecture: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Extract edge/flow list from architecture definition."""
        edges = []
        
        for flow in architecture.get("data_flow", architecture.get("flows", architecture.get("edges", []))):
            if isinstance(flow, dict):
                edges.append({
                    "source": flow.get("from", flow.get("source", "")),
                    "target": flow.get("to", flow.get("target", "")),
                    "label": flow.get("description", flow.get("label", "")),
                })
        
        return edges


# Singleton instance
_mcp_service = None

def get_mcp_service() -> MCPService:
    """Get singleton instance of MCPService"""
    global _mcp_service
    if _mcp_service is None:
        _mcp_service = MCPService()
    return _mcp_service
