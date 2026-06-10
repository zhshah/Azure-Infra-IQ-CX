import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Play, CheckCircle, XCircle, Clock, FileText, Code, Image } from 'lucide-react';
import clsx from 'clsx';

/**
 * ApexWorkflowPanel - Phase 2 APEX Agent Execution UI
 * Shows APEX workflow phases and allows executing agents
 */
export default function ApexWorkflowPanel({ projectId, resources = [] }) {
  const [agents, setAgents] = useState([]);
  const [executions, setExecutions] = useState([]);
  const [activeAgent, setActiveAgent] = useState(null);
  const [userInput, setUserInput] = useState('');
  const [executing, setExecuting] = useState(false);
  const [selectedExecution, setSelectedExecution] = useState(null);
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(true);

  // APEX Workflow Phases
  const workflowPhases = [
    { id: 1, name: 'Requirements', agent: '02-requirements', icon: FileText, color: 'blue' },
    { id: 2, name: 'Architecture', agent: '03-architect', icon: FileText, color: 'purple' },
    { id: 3, name: 'Design', agent: '04-design', icon: Code, color: 'indigo' },
    { id: 4, name: 'Governance', agent: '04g-governance', icon: CheckCircle, color: 'green' },
    { id: 5, name: 'IaC Planning', agent: '05-iac-planner', icon: FileText, color: 'yellow' },
    { id: 6, name: 'Code Generation', agent: '06b-bicep-codegen', icon: Code, color: 'orange' },
    { id: 7, name: 'Documentation', agent: '08-as-built', icon: FileText, color: 'teal' },
  ];

  useEffect(() => {
    loadData();
  }, [projectId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [agentsData, executionsData] = await Promise.all([
        api.listApexAgents(),
        projectId ? api.listProjectExecutions(projectId) : Promise.resolve({ executions: [] })
      ]);
      const loadedAgents = agentsData.agents || [];
      setAgents(loadedAgents);
      setExecutions(executionsData.executions || []);
      // Auto-select first workflow phase agent if none selected yet
      if (!activeAgent && workflowPhases.length > 0) {
        setActiveAgent(workflowPhases[0].agent);
      }
    } catch (err) {
      console.error('Failed to load Azure Workload Planner data:', err);
    } finally {
      setLoading(false);
    }
  };

  const executeAgent = async () => {
    if (!activeAgent || !userInput.trim()) return;
    if (!projectId) {
      alert('Please open this from a Project to execute agents. Create or select a project first.');
      return;
    }

    try {
      setExecuting(true);
      
      // Build context from resources
      const context = {
        resources: resources.map(r => ({
          name: r.name,
          type: r.resource_type,
          location: r.location,
          criticality: r.bcdr_metadata?.criticality,
          dr_tier: r.bcdr_metadata?.dr_tier
        }))
      };

      const result = await api.executeApexAgent(projectId, {
        agent_name: activeAgent,
        user_input: userInput,
        context
      });

      if (result.status === 'completed') {
        // Reload executions
        await loadData();
        
        // Select the new execution
        setSelectedExecution(result.execution_id);
        
        // Load artifacts
        if (result.artifacts && result.artifacts.length > 0) {
          const artifactsData = await api.getExecutionArtifacts(result.execution_id);
          setArtifacts(artifactsData.artifacts || []);
        }
        
        // Clear input
        setUserInput('');
      } else {
        alert('Agent execution failed: ' + (result.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Failed to execute agent: ' + err.message);
    } finally {
      setExecuting(false);
    }
  };

  const viewExecution = async (executionId) => {
    setSelectedExecution(executionId);
    
    try {
      const artifactsData = await api.getExecutionArtifacts(executionId);
      setArtifacts(artifactsData.artifacts || []);
    } catch (err) {
      console.error('Failed to load artifacts:', err);
    }
  };

  const getPhaseStatus = (agentName) => {
    const execution = executions.find(e => e.agent_name === agentName);
    if (!execution) return 'not-started';
    return execution.status;
  };

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
        <p className="mt-4 text-gray-400">Loading Azure Workload Planner...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-950/60 to-purple-950/40 border border-blue-800/40 text-white p-6 rounded-2xl">
        <h2 className="text-2xl font-bold mb-2">Azure Workload Planner</h2>
        <p className="text-blue-300">
          Requirements → Architecture → Design → IaC Generation
        </p>
      </div>

      {/* Workflow Timeline */}
      <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800">
        <h3 className="text-lg font-semibold text-gray-100 mb-4">Workflow Phases</h3>
        
        <div className="relative">
          {/* Progress line */}
          <div className="absolute top-6 left-0 right-0 h-1 bg-gray-700"></div>
          
          {/* Phases */}
          <div className="relative flex justify-between">
            {workflowPhases.map((phase, idx) => {
              const status = getPhaseStatus(phase.agent);
              const Icon = phase.icon;
              
              return (
                <div key={phase.id} className="flex flex-col items-center" style={{ width: '120px' }}>
                  {/* Status icon */}
                  <div className={clsx(
                    'w-12 h-12 rounded-full flex items-center justify-center mb-2 relative z-10',
                    status === 'completed' && 'bg-green-500 text-white',
                    status === 'running' && 'bg-blue-500 text-white animate-pulse',
                    status === 'failed' && 'bg-red-500 text-white',
                    status === 'not-started' && 'bg-gray-700 text-gray-400'
                  )}>
                    {status === 'completed' && <CheckCircle className="w-6 h-6" />}
                    {status === 'running' && <Clock className="w-6 h-6" />}
                    {status === 'failed' && <XCircle className="w-6 h-6" />}
                    {status === 'not-started' && <Icon className="w-6 h-6" />}
                  </div>
                  
                  {/* Phase name */}
                  <div className="text-center text-xs font-medium text-gray-300">
                    {phase.name}
                  </div>
                  
                  {/* Execute button */}
                  {status === 'not-started' && (
                    <button
                      onClick={() => setActiveAgent(phase.agent)}
                      className={clsx(
                        'mt-2 px-3 py-1 text-xs rounded-full border',
                        activeAgent === phase.agent
                          ? 'bg-blue-600 text-white border-blue-500'
                          : 'bg-gray-800 text-blue-400 border-blue-700/50 hover:bg-gray-700'
                      )}
                    >
                      {activeAgent === phase.agent ? 'Selected' : 'Execute'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Agent Execution Panel */}
      {activeAgent && (
        <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800">
          <h3 className="text-lg font-semibold text-gray-100 mb-4">
            Execute Agent: <span className="text-blue-400">{activeAgent}</span>
          </h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Your Input/Question for the Agent:
              </label>
              <textarea
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                placeholder={`Enter your requirements, questions, or instructions for ${activeAgent}...`}
                className="w-full bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 rounded-lg p-3 min-h-[120px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={executeAgent}
                disabled={executing || !userInput.trim()}
                className={clsx(
                  'px-6 py-2 rounded-lg font-medium flex items-center gap-2',
                  executing || !userInput.trim()
                    ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-500'
                )}
              >
                {executing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    Executing...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Execute Agent
                  </>
                )}
              </button>
              
              <button
                onClick={() => {
                  setActiveAgent(null);
                  setUserInput('');
                }}
                className="px-6 py-2 rounded-lg font-medium border border-gray-700 text-gray-300 hover:bg-gray-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Execution History */}
      {executions.length > 0 && (
        <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800">
          <h3 className="text-lg font-semibold text-gray-100 mb-4">Execution History</h3>
          
          <div className="space-y-2">
            {executions.map((exec) => (
              <div
                key={exec.execution_id}
                onClick={() => viewExecution(exec.execution_id)}
                className={clsx(
                  'p-4 rounded-lg border cursor-pointer transition-colors',
                  selectedExecution === exec.execution_id
                    ? 'border-blue-500 bg-blue-900/20'
                    : 'border-gray-700 hover:bg-gray-800'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {exec.status === 'completed' && <CheckCircle className="w-5 h-5 text-green-500" />}
                    {exec.status === 'failed' && <XCircle className="w-5 h-5 text-red-500" />}
                    {exec.status === 'running' && <Clock className="w-5 h-5 text-blue-500 animate-pulse" />}
                    
                    <div>
                      <div className="font-medium text-gray-100">{exec.agent_name}</div>
                      <div className="text-sm text-gray-500">
                        Started: {new Date(exec.started_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  
                  <div className={clsx(
                    'px-3 py-1 rounded-full text-xs font-medium',
                    exec.status === 'completed' && 'bg-green-900/30 text-green-400',
                    exec.status === 'failed' && 'bg-red-900/30 text-red-400',
                    exec.status === 'running' && 'bg-blue-900/30 text-blue-400'
                  )}>
                    {exec.status}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Artifacts Viewer */}
      {selectedExecution && artifacts.length > 0 && (
        <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800">
          <h3 className="text-lg font-semibold text-gray-100 mb-4">Generated Artifacts</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {artifacts.map((artifact) => (
              <div
                key={artifact.artifact_id}
                className="border border-gray-700 rounded-lg p-4 bg-gray-800/50 hover:bg-gray-800 transition-colors"
              >
                <div className="flex items-start gap-3">
                  {artifact.artifact_type === 'bicep' && <Code className="w-5 h-5 text-blue-500 mt-1" />}
                  {artifact.artifact_type === 'terraform' && <Code className="w-5 h-5 text-purple-500 mt-1" />}
                  {artifact.artifact_type === 'diagram' && <Image className="w-5 h-5 text-green-500 mt-1" />}
                  {artifact.artifact_type === 'document' && <FileText className="w-5 h-5 text-orange-500 mt-1" />}
                  
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-200 truncate">{artifact.file_name}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {artifact.artifact_type} • {new Date(artifact.created_at).toLocaleString()}
                    </div>
                    
                    <button
                      onClick={async () => {
                        try {
                          const data = await api.getApexArtifact(artifact.artifact_id);
                          // Download the artifact
                          const blob = new Blob([data.content], { type: 'text/plain' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = data.file_name;
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch (err) {
                          alert('Failed to download: ' + err.message);
                        }
                      }}
                      className="mt-2 text-xs text-blue-400 hover:text-blue-300 font-medium"
                    >
                      Download
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
