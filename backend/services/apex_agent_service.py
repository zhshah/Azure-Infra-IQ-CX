"""
APEX Agent Orchestration Service
Handles execution of APEX agents (Requirements, Architect, Design, etc.)
with Claude AI models for Phase 2 implementation workflow
"""

import os
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
import anthropic
from openai import AzureOpenAI
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from services.database import get_raw_connection

# Agent model assignments based on APEX best practices
AGENT_MODELS = {
    "01-orchestrator": "claude-opus",
    "02-requirements": "claude-opus",
    "03-architect": "claude-opus",
    "04-design": "claude-sonnet",
    "04g-governance": "claude-sonnet",
    "05-iac-planner": "claude-opus",
    "06b-bicep-codegen": "claude-sonnet",
    "06t-terraform-codegen": "claude-sonnet",
    "07b-bicep-deploy": "gpt-4o",
    "07t-terraform-deploy": "gpt-4o",
    "08-as-built": "gpt-4o",
    "09-diagnose": "claude-opus",
    "10-challenger": "claude-sonnet",
    "11-context-optimizer": "claude-opus"
}

class ApexAgentService:
    """Service for executing APEX agents and managing workflows"""
    
    def __init__(self, db_path: str = "data/scans.db"):
        # Convert relative path to absolute
        if not os.path.isabs(db_path):
            base_dir = Path(__file__).parent.parent
            self.db_path = str(base_dir / db_path)
        else:
            self.db_path = db_path
            
        self.agents_dir = Path(__file__).parent.parent.parent / "apex-integration" / "agents"
        
        # Initialize AI clients
        self._init_ai_clients()
        
        # Load agent definitions
        self.agent_definitions = self._load_agent_definitions()
    
    def _init_ai_clients(self):
        """Initialize Claude and Azure OpenAI clients"""
        # Claude client (for Anthropic API) - Optional, fallback to Azure OpenAI
        anthropic_key = os.getenv("ANTHROPIC_API_KEY")
        if anthropic_key and anthropic_key != "your_anthropic_api_key_here":
            try:
                self.anthropic_client = anthropic.Anthropic(api_key=anthropic_key)
            except Exception as e:
                print(f"Warning: Failed to initialize Anthropic client: {e}")
                self.anthropic_client = None
        else:
            self.anthropic_client = None
        
        # Azure OpenAI client (fallback)
        azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        if azure_endpoint:
            try:
                credential = DefaultAzureCredential()
                token_provider = get_bearer_token_provider(
                    credential, "https://cognitiveservices.azure.com/.default"
                )
                self.azure_openai_client = AzureOpenAI(
                    azure_endpoint=azure_endpoint,
                    api_version="2024-10-21",
                    azure_ad_token_provider=token_provider
                )
            except:
                api_key = os.getenv("AZURE_OPENAI_KEY")
                if api_key:
                    self.azure_openai_client = AzureOpenAI(
                        azure_endpoint=azure_endpoint,
                        api_key=api_key,
                        api_version="2024-10-21"
                    )
                else:
                    self.azure_openai_client = None
        else:
            self.azure_openai_client = None
    
    def _load_agent_definitions(self) -> Dict[str, Dict]:
        """Load all agent definition files from apex-integration/agents"""
        definitions = {}
        
        if not self.agents_dir.exists():
            print(f"Warning: Agents directory not found: {self.agents_dir}")
            return definitions
        
        for agent_file in self.agents_dir.glob("*.agent.md"):
            # Extract agent name from filename (e.g., "02-requirements.agent.md" -> "02-requirements")
            agent_name = agent_file.name.replace('.agent.md', '')
            try:
                with open(agent_file, 'r', encoding='utf-8') as f:
                    content = f.read()
                    definitions[agent_name] = {
                        "name": agent_name,
                        "file_path": str(agent_file),
                        "content": content,
                        "model": AGENT_MODELS.get(agent_name, "claude-sonnet")
                    }
            except Exception as e:
                print(f"Error loading agent {agent_name}: {e}")
        
        return definitions
    
    async def execute_agent(
        self,
        agent_name: str,
        project_id: str,
        user_input: str,
        context: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        Execute an APEX agent with given input
        
        Args:
            agent_name: Name of agent (e.g., "02-requirements", "03-architect")
            project_id: Project ID for tracking
            user_input: User's input/question for the agent
            context: Additional context (resources, previous agent outputs, etc.)
        
        Returns:
            Dict with execution_id, status, output, artifacts
        """
        execution_id = str(uuid.uuid4())
        
        # Get agent definition
        if agent_name not in self.agent_definitions:
            return {
                "execution_id": execution_id,
                "status": "failed",
                "error": f"Agent {agent_name} not found"
            }
        
        agent_def = self.agent_definitions[agent_name]
        
        # Build prompt from agent definition + user input + context
        prompt = self._build_agent_prompt(agent_def, user_input, context or {})
        
        # Execute with appropriate AI model
        model_type = agent_def["model"]
        
        try:
            # Save execution start to database
            self._save_execution_start(execution_id, project_id, agent_name, user_input)
            
            # Call AI model - fallback to Azure OpenAI if Claude not available
            if (model_type == "claude-opus" or model_type == "claude-sonnet") and self.anthropic_client:
                output = await self._execute_with_claude(prompt, model_type)
            elif self.azure_openai_client:
                output = await self._execute_with_azure_openai(prompt)
            else:
                raise Exception("No AI client configured (need either ANTHROPIC_API_KEY or Azure OpenAI)")
            
            # Parse artifacts from output
            artifacts = self._extract_artifacts(output, agent_name)
            
            # Save execution result to database
            self._save_execution_complete(
                execution_id,
                output,
                artifacts,
                "completed"
            )
            
            return {
                "execution_id": execution_id,
                "status": "completed",
                "agent_name": agent_name,
                "output": output,
                "artifacts": artifacts,
                "timestamp": datetime.utcnow().isoformat()
            }
        
        except Exception as e:
            error_msg = str(e)
            self._save_execution_complete(
                execution_id,
                "",
                [],
                "failed",
                error_msg
            )
            return {
                "execution_id": execution_id,
                "status": "failed",
                "error": error_msg
            }
    
    def _build_agent_prompt(
        self,
        agent_def: Dict,
        user_input: str,
        context: Dict
    ) -> str:
        """Build complete prompt for agent execution"""
        agent_content = agent_def["content"]
        
        # Extract the markdown instruction body (after the second ---) as system instructions.
        # The .agent.md files have: --- frontmatter --- # Agent Name\n actual instructions
        parts = agent_content.split("---", 2)
        system_instructions = parts[2].strip() if len(parts) >= 3 else agent_content
        
        # Build context section
        context_text = ""
        if context.get("resources"):
            context_text += f"\n\n## Environment Context\n"
            context_text += f"Total Resources: {len(context['resources'])}\n"
            context_text += f"Resource Summary:\n"
            for r in context['resources'][:10]:  # Show first 10
                context_text += f"  - {r.get('name', 'Unknown')}: {r.get('type', 'Unknown')} ({r.get('location', 'Unknown')})\n"
        
        if context.get("previous_outputs"):
            context_text += f"\n\n## Previous Agent Outputs\n"
            for prev_agent, prev_output in context.get("previous_outputs", {}).items():
                context_text += f"\n### {prev_agent} Output:\n{prev_output[:500]}...\n"
        
        # Build complete prompt
        prompt = f"""{system_instructions}

## Current Task
{user_input}

{context_text}

## Instructions
Please provide your analysis and recommendations following the structure defined in your role.
If you're generating code (Bicep, Terraform), wrap it in proper markdown code blocks with language tags.
If you're creating diagrams, describe them in detail or provide mermaid/drawio syntax.
"""
        
        return prompt
    
    async def _execute_with_claude(self, prompt: str, model_type: str) -> str:
        """Execute with Claude (Opus or Sonnet)"""
        if not self.anthropic_client:
            raise Exception("Claude API not configured (missing ANTHROPIC_API_KEY)")
        
        model = "claude-sonnet-4-20250514" if model_type == "claude-sonnet" else "claude-opus-4-20250514"
        
        message = self.anthropic_client.messages.create(
            model=model,
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}]
        )
        
        return message.content[0].text
    
    async def _execute_with_azure_openai(self, prompt: str) -> str:
        """Execute with Azure OpenAI GPT-4o"""
        if not self.azure_openai_client:
            raise Exception("Azure OpenAI not configured")
        
        response = self.azure_openai_client.chat.completions.create(
            model=os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini"),
            messages=[{"role": "user", "content": prompt}],
            max_tokens=4096,
            temperature=0.7
        )
        
        return response.choices[0].message.content
    
    def _extract_artifacts(self, output: str, agent_name: str) -> List[Dict]:
        """Extract code artifacts (Bicep, Terraform, etc.) from agent output"""
        artifacts = []
        
        # Look for code blocks
        import re
        code_blocks = re.findall(r'```(\w+)\n(.*?)```', output, re.DOTALL)
        
        for lang, code in code_blocks:
            artifact_type = "code"
            file_ext = lang
            
            # Determine artifact type
            if lang in ["bicep", "bicepparam"]:
                artifact_type = "bicep"
                file_ext = "bicep"
            elif lang in ["terraform", "tf", "hcl"]:
                artifact_type = "terraform"
                file_ext = "tf"
            elif lang in ["mermaid"]:
                artifact_type = "diagram"
                file_ext = "mmd"
            elif lang in ["json"]:
                artifact_type = "config"
                file_ext = "json"
            elif lang in ["yaml", "yml"]:
                artifact_type = "config"
                file_ext = "yaml"
            elif lang in ["markdown", "md"]:
                artifact_type = "document"
                file_ext = "md"
            
            artifact_id = str(uuid.uuid4())
            file_name = f"{agent_name}-{artifact_type}-{artifact_id[:8]}.{file_ext}"
            
            artifacts.append({
                "artifact_id": artifact_id,
                "artifact_type": artifact_type,
                "file_name": file_name,
                "content": code.strip(),
                "language": lang
            })
        
        return artifacts
    
    def _save_execution_start(
        self,
        execution_id: str,
        project_id: str,
        agent_name: str,
        input_data: str
    ):
        """Save execution start to database"""
        conn = get_raw_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO agent_executions 
            (execution_id, project_id, agent_name, status, input_data, started_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            execution_id,
            project_id,
            agent_name,
            "running",
            json.dumps({"user_input": input_data}),
            datetime.utcnow().isoformat()
        ))
        
        conn.commit()
        conn.close()
    
    def _save_execution_complete(
        self,
        execution_id: str,
        output_data: str,
        artifacts: List[Dict],
        status: str,
        error_message: str = None
    ):
        """Save execution completion to database"""
        conn = get_raw_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE agent_executions
            SET status = ?,
                output_data = ?,
                artifacts = ?,
                error_message = ?,
                completed_at = ?
            WHERE execution_id = ?
        """, (
            status,
            json.dumps({"output": output_data}),
            json.dumps([{
                "artifact_id": a["artifact_id"],
                "file_name": a["file_name"],
                "artifact_type": a["artifact_type"]
            } for a in artifacts]),
            error_message,
            datetime.utcnow().isoformat(),
            execution_id
        ))
        
        # Save individual artifacts
        for artifact in artifacts:
            cursor.execute("""
                INSERT INTO agent_artifacts
                (artifact_id, execution_id, artifact_type, file_name, content, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                artifact["artifact_id"],
                execution_id,
                artifact["artifact_type"],
                artifact["file_name"],
                artifact["content"],
                datetime.utcnow().isoformat()
            ))
        
        conn.commit()
        conn.close()
    
    def get_execution_status(self, execution_id: str) -> Dict:
        """Get status of an agent execution"""
        conn = get_raw_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT execution_id, project_id, agent_name, status, 
                   output_data, artifacts, error_message,
                   started_at, completed_at
            FROM agent_executions
            WHERE execution_id = ?
        """, (execution_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return {"status": "not_found"}
        
        return {
            "execution_id": row[0],
            "project_id": row[1],
            "agent_name": row[2],
            "status": row[3],
            "output_data": json.loads(row[4]) if row[4] else {},
            "artifacts": json.loads(row[5]) if row[5] else [],
            "error_message": row[6],
            "started_at": row[7],
            "completed_at": row[8]
        }
    
    def get_project_executions(self, project_id: str) -> List[Dict]:
        """Get all agent executions for a project"""
        conn = get_raw_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT execution_id, agent_name, status, started_at, completed_at
            FROM agent_executions
            WHERE project_id = ?
            ORDER BY started_at DESC
        """, (project_id,))
        
        rows = cursor.fetchall()
        conn.close()
        
        return [{
            "execution_id": row[0],
            "agent_name": row[1],
            "status": row[2],
            "started_at": row[3],
            "completed_at": row[4]
        } for row in rows]
    
    def get_artifact(self, artifact_id: str) -> Optional[Dict]:
        """Get an artifact by ID"""
        conn = get_raw_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT artifact_id, execution_id, artifact_type, 
                   file_name, content, created_at
            FROM agent_artifacts
            WHERE artifact_id = ?
        """, (artifact_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return None
        
        return {
            "artifact_id": row[0],
            "execution_id": row[1],
            "artifact_type": row[2],
            "file_name": row[3],
            "content": row[4],
            "created_at": row[5]
        }
    
    def get_execution_artifacts(self, execution_id: str) -> List[Dict]:
        """Get all artifacts for an execution"""
        conn = get_raw_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT artifact_id, artifact_type, file_name, content, created_at
            FROM agent_artifacts
            WHERE execution_id = ?
            ORDER BY created_at ASC
        """, (execution_id,))
        
        rows = cursor.fetchall()
        conn.close()
        
        return [{
            "artifact_id": row[0],
            "artifact_type": row[1],
            "file_name": row[2],
            "content": row[3],
            "created_at": row[4]
        } for row in rows]
    
    def list_available_agents(self) -> List[Dict]:
        """List all available APEX agents"""
        return [
            {
                "agent_name": name,
                "model": info["model"],
                "description": self._get_agent_description(info["content"])
            }
            for name, info in self.agent_definitions.items()
        ]
    
    def _get_agent_description(self, content: str) -> str:
        """Extract description from agent markdown file"""
        lines = content.split('\n')
        for line in lines[1:10]:  # Check first 10 lines
            if line.strip() and not line.startswith('#') and not line.startswith('---'):
                return line.strip()[:200]
        return "No description available"


# Singleton instance
_apex_agent_service = None

def get_apex_agent_service() -> ApexAgentService:
    """Get singleton instance of ApexAgentService"""
    global _apex_agent_service
    if _apex_agent_service is None:
        _apex_agent_service = ApexAgentService()
    return _apex_agent_service
