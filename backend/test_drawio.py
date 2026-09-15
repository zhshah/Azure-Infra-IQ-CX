"""Quick test for Draw.io MCP integration"""
import asyncio
from services.mcp_service import MCPService

async def test():
    svc = MCPService()
    
    # Test 1: generate_architecture_diagram
    result = await svc.generate_architecture_diagram({
        "name": "Test Architecture",
        "components": [
            {"name": "Front Door", "type": "Front Door"},
            {"name": "App Service", "type": "App Service"},
            {"name": "SQL Database", "type": "SQL Database"},
            {"name": "Key Vault", "type": "Key Vault"},
            {"name": "Azure Monitor", "type": "Azure Monitor"},
        ],
        "data_flow": [
            {"from": "Front Door", "to": "App Service", "description": "HTTPS"},
            {"from": "App Service", "to": "SQL Database", "description": "Private Endpoint"},
        ]
    }, "network")
    
    print(f"Test 1 - Format: {result['format']}")
    print(f"Test 1 - Content length: {len(result['content'])}")
    print(f"Test 1 - Components: {result['component_count']}")
    print(f"Test 1 - Has mxfile: {'<mxfile' in result['content']}")
    print(f"Test 1 - Has Azure icons: {'image=data:image/svg' in result['content']}")
    
    # Test 2: generate_agent_diagram  
    result2 = await svc.generate_agent_diagram(
        agent_name="03-architect",
        output_data={
            "components": [
                {"name": "Azure Front Door", "type": "Front Door"},
                {"name": "Web App", "type": "App Service"},
                {"name": "Redis Cache", "type": "Redis"},
                {"name": "Azure SQL", "type": "SQL Database"},
            ],
            "data_flow": [
                {"from": "Azure Front Door", "to": "Web App", "description": "HTTPS"},
                {"from": "Web App", "to": "Redis Cache"},
                {"from": "Web App", "to": "Azure SQL"},
            ]
        },
        assessment_name="Production BCDR"
    )
    
    print(f"Test 2 - Agent format: {result2['format']}")
    print(f"Test 2 - Agent length: {len(result2['content'])}")
    print(f"Test 2 - Has Azure icons: {'image=data:image/svg' in result2['content']}")
    
    print("\nAll tests passed!")

asyncio.run(test())
