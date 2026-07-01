/**
 * AssessmentModule - Workload Assessment as a Service
 * 
 * Main module for creating and managing workload assessments:
 * - Service-based assessments (App Service, VMs, AKS, etc.)
 * - Multi-resource assessments (RG, subscription, custom)
 * - Assessment history and navigation
 */

import React, { useState, useEffect } from 'react';
import { 
  Plus, List, PlayCircle, CheckCircle, Clock, XCircle, TrendingUp,
  ChevronRight, Server, Cloud, Database, Shield
} from 'lucide-react';
import AssessmentWizard from './AssessmentWizard';
import ServiceIcon from './ServiceIcon';
import { api } from '../api/client';

const AssessmentModule = () => {
  const [view, setView] = useState('list'); // 'list' or 'wizard'
  const [assessments, setAssessments] = useState([]);
  const [services, setServices] = useState([]); // Azure service types with icons
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all', 'completed', 'in-progress'
  const [resumeAssessmentId, setResumeAssessmentId] = useState(null);
  // Live workflow progress map: assessmentId → workflow status
  const [liveProgress, setLiveProgress] = useState({});
  
  useEffect(() => {
    loadServices();
  }, []);
  
  useEffect(() => {
    loadAssessments();
  }, [filter]);

  // Auto-refresh the list and live progress while any assessment is running
  useEffect(() => {
    const hasRunning = assessments.some(a => a.status === 'apex-running' || a.status === 'analyzing');
    if (!hasRunning) return;
    const timer = setInterval(async () => {
      // Refresh live workflow progress for running assessments
      const running = assessments.filter(a => a.status === 'apex-running');
      const updates = {};
      await Promise.all(running.map(async (a) => {
        try {
          const wf = await api._request(`/assessments/${a.assessment_id}/apex/latest`);
          if (wf) updates[a.assessment_id] = wf;
        } catch {}
      }));
      if (Object.keys(updates).length > 0) {
        setLiveProgress(prev => ({ ...prev, ...updates }));
      }
      // Check if any running workflow just completed → reload full list
      const anyCompleted = running.some(a => {
        const wf = updates[a.assessment_id];
        return wf && (wf.status === 'completed' || wf.status === 'completed_with_errors' || wf.status === 'failed');
      });
      if (anyCompleted) loadAssessments();
    }, 4000);
    return () => clearInterval(timer);
  }, [assessments]);
  
  const loadServices = async () => {
    try {
      const response = await api._request('/assessments/services');
      setServices(response.services || []);
    } catch (error) {
      console.error('Failed to load services:', error);
    }
  };
  
  const loadAssessments = async () => {
    setLoading(true);
    try {
      const statusFilter = filter === 'all' ? null : filter;
      const response = await api._request(
        `/assessments${statusFilter ? `?status=${statusFilter}` : ''}`
      );
      setAssessments(response.assessments || []);
    } catch (error) {
      console.error('Failed to load assessments:', error);
    } finally {
      setLoading(false);
    }
  };
  
  // Get icon for a service type
  const getServiceIcon = (serviceType) => {
    if (!serviceType) return '□';
    const service = services.find(s => s.type === serviceType);
    return service?.icon || '□';
  };
  
  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'apex-running':
      case 'analyzing':
        return <Clock className="w-5 h-5 text-blue-500 animate-pulse" />;
      default:
        return <Clock className="w-5 h-5 text-gray-400" />;
    }
  };
  
  const getStatusLabel = (status) => {
    const labels = {
      'draft': 'Draft',
      'scoping': 'Scoping Resources',
      'scoped': 'Resources Scoped',
      'analyzing': 'AI Analysis Running',
      'analyzed': 'Analysis Complete',
      'apex-running': 'Agent Workflow Running',
      'completed': 'Completed',
      'failed': 'Failed'
    };
    return labels[status] || status;
  };
  
  const getStepLabel = (step) => {
    const steps = {
      1: 'Type Selection',
      2: 'Resource Scoping',
      3: 'AI Analysis',
      4: 'Agent Workflow',
      5: 'Report'
    };
    return steps[step] || `Step ${step}`;
  };
  
  const getTypeIcon = (type) => {
    return type === 'service-based' ? (
      <Server className="w-5 h-5 text-blue-500" />
    ) : (
      <Cloud className="w-5 h-5 text-purple-500" />
    );
  };
  
  if (view === 'wizard') {
    return (
      <div>
        <div className="mb-4">
          <button
            onClick={() => {
              setResumeAssessmentId(null);
              setView('list');
              loadAssessments();
            }}
            className="px-4 py-2 text-blue-400 hover:bg-gray-700 rounded-lg flex items-center gap-2"
          >
            ← Back to Assessments
          </button>
        </div>
        <AssessmentWizard resumeAssessmentId={resumeAssessmentId} />
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-100">Workload Assessments</h1>
          <p className="text-gray-400 mt-1">
            Service-based and multi-resource Azure workload assessments
          </p>
        </div>
        <button
          onClick={() => { setResumeAssessmentId(null); setView('wizard'); }}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 font-semibold shadow-lg"
        >
          <Plus className="w-5 h-5" />
          New Assessment
        </button>
      </div>
      
      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Total Assessments</p>
              <p className="text-3xl font-bold text-gray-100">{assessments.length}</p>
            </div>
            <List className="w-8 h-8 text-blue-400" />
          </div>
        </div>
        
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Completed</p>
              <p className="text-3xl font-bold text-green-400">
                {assessments.filter(a => a.status === 'completed').length}
              </p>
            </div>
            <CheckCircle className="w-8 h-8 text-green-400" />
          </div>
        </div>
        
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">In Progress</p>
              <p className="text-3xl font-bold text-blue-400">
                {assessments.filter(a => ['analyzing', 'apex-running', 'scoped'].includes(a.status)).length}
              </p>
            </div>
            <Clock className="w-8 h-8 text-blue-400" />
          </div>
        </div>
        
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Service-Based</p>
              <p className="text-3xl font-bold text-purple-400">
                {assessments.filter(a => a.assessment_type === 'service-based').length}
              </p>
            </div>
            <Server className="w-8 h-8 text-purple-400" />
          </div>
        </div>
      </div>
      
      {/* Filter Tabs */}
      <div className="bg-gray-800 rounded-lg border border-gray-700">
        <div className="border-b border-gray-700">
          <div className="flex gap-4 px-6">
            <button
              onClick={() => setFilter('all')}
              className={`py-4 px-4 font-medium border-b-2 transition ${
                filter === 'all'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              All Assessments
            </button>
            <button
              onClick={() => setFilter('completed')}
              className={`py-4 px-4 font-medium border-b-2 transition ${
                filter === 'completed'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              Completed
            </button>
            <button
              onClick={() => setFilter('apex-running')}
              className={`py-4 px-4 font-medium border-b-2 transition ${
                filter === 'apex-running'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              In Progress
            </button>
          </div>
        </div>
        
        {/* Assessment List */}
        <div className="divide-y divide-gray-700">
          {loading ? (
            <div className="p-12 text-center text-gray-400">
              Loading assessments...
            </div>
          ) : assessments.length === 0 ? (
            <div className="p-12 text-center">
              <Cloud className="w-16 h-16 mx-auto mb-4 text-gray-600" />
              <p className="text-gray-400 mb-4">No assessments found</p>
              <button
                onClick={() => { setResumeAssessmentId(null); setView('wizard'); }}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                Create Your First Assessment
              </button>
            </div>
          ) : (
            assessments.map(assessment => (
              <div
                key={assessment.assessment_id}
                className="p-6 hover:bg-gray-700/50 transition cursor-pointer"
                onClick={() => {
                  setResumeAssessmentId(assessment.assessment_id);
                  setView('wizard');
                }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4 flex-1">
                    {assessment.assessment_type === 'service-based' && assessment.service_type ? (
                      <ServiceIcon 
                        icon={getServiceIcon(assessment.service_type)} 
                        alt={assessment.service_type} 
                        size="lg" 
                      />
                    ) : (
                      getTypeIcon(assessment.assessment_type)
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-semibold text-gray-100">
                          {assessment.assessment_name}
                        </h3>
                        <span className="px-2 py-1 bg-blue-900/50 text-blue-300 text-xs font-medium rounded border border-blue-700">
                          {assessment.assessment_type === 'service-based' ? 'Service-Based' : 'Multi-Resource'}
                        </span>
                      </div>
                      
                      {assessment.description && (
                        <p className="text-sm text-gray-400 mt-1">
                          {assessment.description}
                        </p>
                      )}
                      
                      <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
                        {assessment.service_type && (
                          <span>• {assessment.service_type.split('/').pop()}</span>
                        )}
                        {assessment.resource_count > 0 && (
                          <span>• {assessment.resource_count} resources</span>
                        )}
                        {assessment.business_unit && (
                          <span>• {assessment.business_unit}</span>
                        )}
                        <span>• Created {new Date(assessment.created_at).toLocaleDateString()}</span>
                      </div>
                      
                      <div className="flex items-center gap-2 mt-3">
                        {getStatusIcon(assessment.status)}
                        <span className="text-sm font-medium text-gray-300">
                          {getStatusLabel(assessment.status)}
                        </span>
                        <span className="text-sm text-gray-500">
                          • Step {assessment.current_step}/5: {getStepLabel(assessment.current_step)}
                        </span>
                      </div>
                      
                      {/* Live APEX workflow progress bar */}
                      {assessment.status === 'apex-running' && (() => {
                        const wf = liveProgress[assessment.assessment_id];
                        const completed = wf?.agents_completed?.length ?? 0;
                        const total = wf?.total_agents ?? 7;
                        const pct = Math.round((completed / total) * 100);
                        const sequence = wf?.agent_sequence ?? [];
                        const currentIdx = wf?.current_agent_index ?? 0;
                        const currentAgent = sequence[currentIdx];
                        const agentLabels = {
                          '02-requirements': 'Requirements',
                          '03-architect': 'Architecture',
                          '04-design': 'Detailed Design',
                          '04g-governance': 'Governance',
                          '05-iac-planner': 'IaC Planning',
                          '06b-bicep-codegen': 'Bicep Codegen',
                          '08-as-built': 'As-Built Docs',
                        };
                        return (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                              <span style={{ color: 'var(--c-86efac)', fontSize: 11, fontWeight: 600 }}>
                                ⚙ {completed}/{total} agents completed
                              </span>
                              {wf?.status === 'running' && currentAgent && (
                                <span style={{ color: 'var(--c-60a5fa)', fontSize: 11 }}>
                                  Running: {agentLabels[currentAgent] || currentAgent}
                                </span>
                              )}
                            </div>
                            <div style={{ background: 'var(--c-1e293b)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                              <div style={{ background: '#22c55e', height: '100%', width: `${pct}%`, transition: 'width 0.6s ease', borderRadius: 4 }} />
                            </div>
                          </div>
                        );
                      })()}
                      
                      {/* Progress Bar */}
                      {assessment.status !== 'apex-running' && (
                      <div className="mt-3 bg-gray-700 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full transition-all"
                          style={{ width: `${(assessment.current_step / 5) * 100}%` }}
                        />
                      </div>
                      )}
                    </div>
                  </div>
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setResumeAssessmentId(assessment.assessment_id);
                      setView('wizard');
                    }}
                    className="px-4 py-2 text-blue-400 hover:bg-gray-700 rounded-lg flex items-center gap-2 ml-4"
                  >
                    {assessment.status === 'completed' ? 'View Report' : 
                     assessment.status === 'apex-running' ? 'Monitor' : 'Continue'}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default AssessmentModule;
