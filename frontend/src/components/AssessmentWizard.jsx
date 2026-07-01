/**
 * AssessmentWizard - Multi-step workload assessment workflow
 * 
 * Steps:
 * 1. Type Selection - Choose service-based or multi-resource assessment
 * 2. Resource Scoping - Discover and select resources
 * 3. AI Analysis - Run comprehensive analysis with scoring
 * 4. APEX Execution - Sequential agent workflow
 * 5. Report - View final report with artifacts
 */

import React, { useState, useEffect } from 'react';
import { 
  CheckCircle, Circle, AlertCircle, Loader2, ChevronRight, ChevronLeft,
  Server, Database, Cloud, Shield, TrendingUp, FileText, Download,
  Play, Pause, CheckCircle2, XCircle, Clock, ChevronDown, FileDown, Image as ImageIcon
} from 'lucide-react';
import { api } from '../api/client';
import ServiceIcon from './ServiceIcon';

// Lazy-load PDF/export utilities to avoid @react-pdf/renderer crashing at startup
const loadArtifactExport = () => import('../utils/artifactExport');
const generateArtifactPDF = async (...args) => (await loadArtifactExport()).generateArtifactPDF(...args);
const generateFullReportPDF = async (...args) => (await loadArtifactExport()).generateFullReportPDF(...args);
const getPlainText = async (...args) => (await loadArtifactExport()).getPlainText(...args);
const renderDiagramToImage = async (...args) => (await loadArtifactExport()).renderDiagramToImage(...args);
const formatAgentOutputToMarkdown = async (...args) => (await loadArtifactExport()).formatAgentOutputToMarkdown(...args);

const AGENT_LABELS = {
  '02-requirements': 'Requirements Analysis',
  '03-architect':    'Architecture Design',
  '04-design':       'Detailed Design',
  '04g-governance':  'Governance Framework',
  '05-iac-planner':  'IaC Planning',
  '06b-bicep-codegen': 'Bicep Code Generation',
  '08-as-built':     'As-Built Documentation',
};

const AssessmentWizard = ({ resumeAssessmentId }) => {
  // Wizard state
  const [currentStep, setCurrentStep] = useState(1);
  const [assessmentId, setAssessmentId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [resuming, setResuming] = useState(false);
  
  // Step 1: Type Selection
  const [assessmentType, setAssessmentType] = useState('service-based');
  const [assessmentName, setAssessmentName] = useState('');
  const [description, setDescription] = useState('');
  const [businessUnit, setBusinessUnit] = useState('');
  const [owner, setOwner] = useState('');
  const [selectedServiceType, setSelectedServiceType] = useState('');
  const [scopeType, setScopeType] = useState('resource-group');
  const [scopeValue, setScopeValue] = useState('');
  const [supportedServices, setSupportedServices] = useState([]);
  // Pre-loaded subscription/RG lists for multi-resource scope dropdowns
  const [dashboardSubscriptions, setDashboardSubscriptions] = useState([]);
  const [dashboardResourceGroups, setDashboardResourceGroups] = useState([]);
  
  // Step 2: Resource Scoping
  const [discoveredResources, setDiscoveredResources] = useState([]);
  const [selectedResources, setSelectedResources] = useState([]);
  const [discovering, setDiscovering] = useState(false);
  const [resourceFilter, setResourceFilter] = useState(''); // for filtering resources
  const [selectedSubscription, setSelectedSubscription] = useState('all'); // subscription filter
  const [selectedResourceGroup, setSelectedResourceGroup] = useState('all'); // RG filter
  const [availableSubscriptions, setAvailableSubscriptions] = useState([]);
  const [availableResourceGroups, setAvailableResourceGroups] = useState([]);
  const [iconCache, setIconCache] = useState({}); // resource type -> icon path
  
  // Step 3: AI Analysis
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  
  // Step 4: APEX Execution
  const [apexWorkflowId, setApexWorkflowId] = useState(null);
  const [apexStatus, setApexStatus] = useState(null);
  const [apexRunning, setApexRunning] = useState(false);
  
  // Step 5: Report
  const [report, setReport] = useState(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [downloadDropdown, setDownloadDropdown] = useState(null);
  const [exportGenerating, setExportGenerating] = useState(null);
  
  const steps = [
    { number: 1, label: 'Type & Scope', icon: Circle },
    { number: 2, label: 'Resources', icon: Server },
    { number: 3, label: 'AI Analysis', icon: TrendingUp },
    { number: 4, label: 'Agent Workflow', icon: Play },
    { number: 5, label: 'Report', icon: FileText }
  ];
  
  // Load supported services and preload dashboard data for scope dropdowns
  useEffect(() => {
    loadSupportedServices();
    preloadDashboardData();
  }, []);
  
  // Resume an existing assessment when resumeAssessmentId is provided
  useEffect(() => {
    if (!resumeAssessmentId) return;
    const resumeAssessment = async () => {
      setResuming(true);
      try {
        const data = await api._request(`/assessments/${resumeAssessmentId}`);
        console.log('[Resume] Loaded assessment:', data);
        
        // Set assessment identity
        setAssessmentId(data.assessment_id);
        setAssessmentName(data.assessment_name || '');
        setAssessmentType(data.assessment_type || 'service-based');
        setDescription(data.description || '');
        setBusinessUnit(data.business_unit || '');
        setOwner(data.owner || '');
        
        if (data.assessment_type === 'service-based') {
          setSelectedServiceType(data.service_type || '');
        } else {
          setScopeType(data.scope_type || 'resource-group');
          setScopeValue(data.scope_value || '');
        }
        
        // Load scoped resources if they exist
        if (data.resources && data.resources.length > 0) {
          const enriched = data.resources.map(r => ({
            ...r,
            subscription_id: r.subscription_id || (r.resource_id ? r.resource_id.match(/\/subscriptions\/([^\/]+)/i)?.[1] || '' : ''),
          }));
          setDiscoveredResources(enriched);
          setSelectedResources(enriched);
          
          // Build filter lists
          const subIds = [...new Set(enriched.map(r => r.subscription_id).filter(Boolean))];
          setAvailableSubscriptions(subIds.map(id => ({ id, name: id.substring(0, 12) + '...' })));
          const rgs = [...new Set(enriched.map(r => r.resource_group).filter(Boolean))].sort();
          setAvailableResourceGroups(rgs);
        }
        
        // Load analysis if it exists
        if (data.analysis) {
          setAnalysisResult(data.analysis);
        }
        
        // Jump to the correct step based on current_step from DB
        const step = data.current_step || 1;
        setCurrentStep(step);
        console.log('[Resume] Jumping to step', step);
        
        // If APEX is running, fetch the latest workflow and start polling
        if (data.status === 'apex-running' && step === 4) {
          try {
            const wf = await api._request(`/assessments/${data.assessment_id}/apex/latest`);
            if (wf && wf.workflow_id) {
              setApexWorkflowId(wf.workflow_id);
              setApexStatus(wf);
              if (wf.status === 'running' || wf.status === 'stale') {
                // Auto-resume: the backend thread likely died on server restart.
                // Call resume endpoint to restart execution from where it left off.
                console.log('[Resume] Workflow shows running/stale — calling resume to restart');
                try {
                  const resumed = await api._request(`/assessments/${data.assessment_id}/apex/resume`, { method: 'POST' });
                  console.log('[Resume] Workflow resumed:', resumed);
                  setApexStatus(resumed);
                } catch (resumeErr) {
                  console.warn('[Resume] Resume call failed (may already be running):', resumeErr);
                }
                setApexRunning(true);
              } else if (wf.status === 'completed' || wf.status === 'completed_with_errors') {
                // Workflow already finished — jump to report
                console.log('[Resume] Workflow already completed, jumping to step 5');
                setCurrentStep(5);
              }
            }
          } catch (e) {
            console.warn('[Resume] No existing APEX workflow found:', e);
          }
        }
        
        // If assessment is completed but user is on step 4, check if we should jump to 5
        if (data.status === 'completed' && step === 4) {
          try {
            const wf = await api._request(`/assessments/${data.assessment_id}/apex/latest`);
            if (wf && (wf.status === 'completed' || wf.status === 'completed_with_errors')) {
              setApexWorkflowId(wf.workflow_id);
              setApexStatus(wf);
              setCurrentStep(5);
            }
          } catch (e) {
            console.warn('[Resume] Could not fetch workflow for completed assessment:', e);
          }
        }
      } catch (error) {
        console.error('[Resume] Failed to load assessment:', error);
        alert('Failed to load assessment: ' + error.message);
      } finally {
        setResuming(false);
      }
    };
    resumeAssessment();
  }, [resumeAssessmentId]);
  
  const loadSupportedServices = async () => {
    try {
      const response = await api._request('/assessments/services');
      setSupportedServices(response.services);
    } catch (error) {
      console.error('Failed to load supported services:', error);
    }
  };
  
  // Preload subscription/RG lists from cached dashboard for Step 1 dropdowns
  const preloadDashboardData = async () => {
    try {
      const dashboard = await api.getCachedDashboard();
      if (dashboard) {
        // Use the subscriptions list from dashboard (has proper names)
        if (dashboard.subscriptions && dashboard.subscriptions.length > 0) {
          setDashboardSubscriptions(dashboard.subscriptions);
        }
        // Use the resource_groups list from dashboard
        if (dashboard.resource_groups && dashboard.resource_groups.length > 0) {
          setDashboardResourceGroups(dashboard.resource_groups.sort());
        }
      }
    } catch (error) {
      console.error('Failed to preload dashboard data:', error);
    }
  };
  
  // Group services by category
  const groupedServices = supportedServices.reduce((acc, service) => {
    const category = service.category || 'Other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(service);
    return acc;
  }, {});
  
  // ===== STEP 1: Create Assessment =====
  const handleCreateAssessment = async () => {
    setCreating(true);
    try {
      const payload = {
        assessment_name: assessmentName,
        assessment_type: assessmentType,
        description,
        business_unit: businessUnit,
        owner
      };
      
      if (assessmentType === 'service-based') {
        payload.service_type = selectedServiceType;
      } else {
        payload.scope_type = scopeType;
        payload.scope_value = scopeValue;
      }
      
      const assessment = await api._request('/assessments', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      
      setAssessmentId(assessment.assessment_id);
      setCurrentStep(2);
    } catch (error) {
      alert('Failed to create assessment: ' + error.message);
    } finally {
      setCreating(false);
    }
  };
  
  // Helper: Extract subscription ID from resource ID
  const extractSubscriptionId = (resourceId) => {
    if (!resourceId) return '';
    const match = resourceId.match(/\/subscriptions\/([^\/]+)/i);
    return match ? match[1] : '';
  };
  
  // Helper: Get subscription display name using dashboard data
  const getSubscriptionName = (subscriptionId) => {
    if (!subscriptionId) return 'Unknown';
    const sub = dashboardSubscriptions.find(s => 
      s.subscription_id?.toLowerCase() === subscriptionId.toLowerCase()
    );
    return sub?.subscription_name || subscriptionId.substring(0, 12) + '...';
  };
  
  // Helper: Case-insensitive service type comparison
  const serviceTypeMatches = (resourceType, serviceType) => {
    return resourceType.toLowerCase() === serviceType.toLowerCase();
  };
  
  // Helper: Safely parse JSON strings or return arrays as-is
  const safeParseList = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch { return []; }
    }
    return [];
  };
  
  // ===== STEP 2: Discover & Scope Resources =====
  const handleDiscoverResources = async () => {
    setDiscovering(true);
    try {
      console.log('[Discovery] Starting resource discovery...');
      console.log('[Discovery] Assessment type:', assessmentType);
      console.log('[Discovery] Selected service type:', selectedServiceType);
      
      // Get resources from cached dashboard (same as main Resources page)
      const dashboard = await api.getCachedDashboard();
      
      if (!dashboard || !dashboard.resources || dashboard.resources.length === 0) {
        console.warn('[Discovery] No cached dashboard data available');
        setDiscoveredResources([]);
        return;
      }
      
      console.log('[Discovery] Total resources from dashboard:', dashboard.resources.length);
      
      // Enrich resources with subscription_id extracted from resource_id
      // (ResourceMetrics doesn't have subscription_id as a field)
      let resources = dashboard.resources.map(r => ({
        ...r,
        subscription_id: r.subscription_id || extractSubscriptionId(r.resource_id),
      }));
      
      // If service-based assessment, filter to only that service type (case-insensitive)
      if (assessmentType === 'service-based' && selectedServiceType) {
        console.log('[Discovery] Filtering for service type:', selectedServiceType);
        const beforeFilter = resources.length;
        resources = resources.filter(r => serviceTypeMatches(r.resource_type, selectedServiceType));
        console.log('[Discovery] After filtering:', resources.length, 'resources (from', beforeFilter, ')');
      }
      
      // For multi-resource with RG or subscription scope, pre-filter
      if (assessmentType === 'multi-resource' && scopeType === 'resource-group' && scopeValue) {
        resources = resources.filter(r => 
          r.resource_group?.toLowerCase() === scopeValue.toLowerCase()
        );
      }
      if (assessmentType === 'multi-resource' && scopeType === 'subscription' && scopeValue) {
        resources = resources.filter(r => 
          r.subscription_id?.toLowerCase() === scopeValue.toLowerCase()
        );
      }
      
      console.log('[Discovery] Final resource count:', resources.length);
      
      // Extract unique subscriptions with proper names
      const subIds = [...new Set(resources.map(r => r.subscription_id).filter(Boolean))];
      const subs = subIds.map(id => ({ id, name: getSubscriptionName(id) }));
      setAvailableSubscriptions(subs);
      
      const rgs = [...new Set(resources.map(r => r.resource_group).filter(Boolean))].sort();
      setAvailableResourceGroups(rgs);
      
      setDiscoveredResources(resources);
      setSelectedResources(resources); // Select all by default
    } catch (error) {
      console.error('[Discovery] Error:', error);
      alert('Failed to discover resources: ' + error.message);
    } finally {
      setDiscovering(false);
    }
  };
  
  // Auto-discover resources when entering Step 2
  useEffect(() => {
    if (currentStep === 2 && discoveredResources.length === 0 && !discovering) {
      console.log('[Effect] Auto-discovery triggered for step 2');
      handleDiscoverResources();
    }
  }, [currentStep, discoveredResources.length, discovering]);
  
  const handleScopeResources = async () => {
    try {
      await api._request(`/assessments/${assessmentId}/scope`, {
        method: 'POST',
        body: JSON.stringify({ resources: selectedResources })
      });

      // Fire-and-forget: enrich scoped resources with detailed config from Resource Graph
      api._request(`/assessments/${assessmentId}/enrich`, { method: 'POST' })
        .catch(() => {/* best-effort, non-blocking */});

      setCurrentStep(3);
    } catch (error) {
      alert('Failed to scope resources: ' + error.message);
    }
  };
  
  // Helper to get icon for a resource type
  const getResourceIcon = (resourceType) => {
    // First check icon cache (from API)
    if (iconCache[resourceType]) return iconCache[resourceType];
    // Then check supported services
    const service = supportedServices.find(s => s.type === resourceType);
    if (service?.icon) return service.icon;
    // Return null to show nothing while loading
    return null;
  };

  // Fetch icons for discovered resource types via API
  useEffect(() => {
    if (!discoveredResources.length) return;
    const uniqueTypes = [...new Set(discoveredResources.map(r => r.resource_type))];
    uniqueTypes.forEach(rt => {
      if (iconCache[rt] !== undefined) return;
      setIconCache(prev => ({ ...prev, [rt]: null }));
      fetch(`/api/icons/${encodeURIComponent(rt)}`)
        .then(r => r.json())
        .then(data => {
          if (data.icon_path) {
            setIconCache(prev => ({ ...prev, [rt]: data.icon_path }));
          }
        })
        .catch(() => {});
    });
  }, [discoveredResources]);

  const toggleResourceSelection = (resourceId) => {
    setSelectedResources(prev => {
      const exists = prev.find(r => r.resource_id === resourceId);
      if (exists) {
        return prev.filter(r => r.resource_id !== resourceId);
      } else {
        const resource = discoveredResources.find(r => r.resource_id === resourceId);
        return [...prev, resource];
      }
    });
  };
  
  // ===== STEP 3: AI Analysis =====
  const handleRunAnalysis = async () => {
    setAnalyzing(true);
    try {
      const analysis = await api._request(
        `/assessments/${assessmentId}/analyze`,
        { method: 'POST' }
      );
      
      setAnalysisResult(analysis);
      setCurrentStep(4);
    } catch (error) {
      alert('Failed to run analysis: ' + error.message);
    } finally {
      setAnalyzing(false);
    }
  };
  
  // ===== STEP 4: APEX Execution =====
  const handleStartApex = async () => {
    setApexRunning(true);
    try {
      const workflow = await api._request(
        `/assessments/${assessmentId}/apex/start`,
        { method: 'POST' }
      );
      
      setApexWorkflowId(workflow.workflow_id);
      setApexStatus(workflow);
    } catch (error) {
      alert('Failed to start agent workflow: ' + error.message);
      setApexRunning(false);
    }
  };
  
  // Poll APEX workflow status when running
  useEffect(() => {
    if (!apexRunning || !apexWorkflowId) return;
    
    let stalePollCount = 0;
    let lastCompletedCount = -1;
    
    const pollInterval = setInterval(async () => {
      try {
        const status = await api._request(
          `/assessments/apex/workflow/${apexWorkflowId}`
        );
        setApexStatus(status);
        
        if (status.status === 'completed' || status.status === 'completed_with_errors' || status.status === 'failed') {
          clearInterval(pollInterval);
          setApexRunning(false);
          if (status.status === 'completed' || status.status === 'completed_with_errors') {
            setCurrentStep(5);
          }
          return;
        }
        
        // Backend marked it stale — auto-resume immediately
        if (status.status === 'stale' && assessmentId) {
          console.warn('[APEX Poll] Backend reported stale — auto-resuming');
          try {
            const resumed = await api._request(`/assessments/${assessmentId}/apex/resume`, { method: 'POST' });
            setApexStatus(resumed);
          } catch (resumeErr) {
            console.warn('[APEX Poll] Resume after stale failed:', resumeErr);
            clearInterval(pollInterval);
            setApexRunning(false);
          }
          return;
        }
        
        // Stale detection: if still "running" but no progress after ~300s (100 polls × 3s).
        // This matches the longest agent timeout (04-design = 300s). Previously this was
        // 30s (10 polls) which triggered a spurious resume while the agent was still running.
        const currentCompleted = (status.agents_completed || []).length;
        if (currentCompleted === lastCompletedCount) {
          stalePollCount++;
        } else {
          stalePollCount = 0;
          lastCompletedCount = currentCompleted;
        }
        
        if (stalePollCount >= 100 && assessmentId) {
          console.warn('[APEX Poll] Stale workflow detected — auto-resuming');
          stalePollCount = 0; // reset to avoid spamming
          try {
            await api._request(`/assessments/${assessmentId}/apex/resume`, { method: 'POST' });
          } catch (resumeErr) {
            console.warn('[APEX Poll] Resume failed:', resumeErr);
          }
        }
      } catch (error) {
        console.error('[APEX Poll] Error:', error);
        clearInterval(pollInterval);
        setApexRunning(false);
      }
    }, 3000);
    
    return () => clearInterval(pollInterval);
  }, [apexRunning, apexWorkflowId, assessmentId]);
  
  // ===== STEP 5: Generate Report =====
  const handleGenerateReport = async () => {
    setGeneratingReport(true);
    try {
      const reportData = await api._request(
        `/assessments/${assessmentId}/report`,
        { method: 'POST' }
      );
      
      setReport(reportData);
    } catch (error) {
      alert('Failed to generate report: ' + error.message);
    } finally {
      setGeneratingReport(false);
    }
  };
  
  useEffect(() => {
    if (currentStep === 5 && !report) {
      handleGenerateReport();
    }
  }, [currentStep]);

  // Close download dropdown on outside click
  useEffect(() => {
    if (downloadDropdown === null) return;
    const close = () => setDownloadDropdown(null);
    const timer = setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', close); };
  }, [downloadDropdown]);

  // ===== DOWNLOAD HELPERS =====

  const downloadFile = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getExecutionContent = (execution) => {
    const content = execution.output_data || execution.artifacts || 'No content';
    try {
      const parsed = JSON.parse(content);
      return typeof parsed === 'object' ? JSON.stringify(parsed, null, 2) : String(parsed);
    } catch {
      return content;
    }
  };

  const handleArtifactDownload = async (format, execution, idx) => {
    const text = getExecutionContent(execution);
    const formatted = await formatAgentOutputToMarkdown(execution.agent_name, text);
    const baseName = `${execution.agent_name}-output`;
    setDownloadDropdown(null);

    switch (format) {
      case 'md':
        downloadFile(new Blob([formatted], { type: 'text/markdown' }), `${baseName}.md`);
        break;
      case 'txt':
        downloadFile(new Blob([await getPlainText(formatted)], { type: 'text/plain' }), `${baseName}.txt`);
        break;
      case 'pdf':
        setExportGenerating(idx);
        try {
          const pdfBlob = await generateArtifactPDF(
            execution.agent_name,
            report?.assessment?.assessment_name || 'Assessment',
            formatted
          );
          downloadFile(pdfBlob, `${baseName}.pdf`);
        } catch (err) {
          console.error('PDF generation failed:', err);
          alert('PDF generation failed. Downloading as markdown instead.');
          downloadFile(new Blob([formatted], { type: 'text/markdown' }), `${baseName}.md`);
        } finally {
          setExportGenerating(null);
        }
        break;
      case 'png':
        setExportGenerating(idx);
        try {
          const result = await renderDiagramToImage(
            formatted,
            execution.agent_name,
            text,
            report?.assessment?.assessment_name || 'Assessment'
          );
          if (result) {
            const ext = result.type === 'drawio' ? 'drawio' : result.type;
            downloadFile(result.blob, `${baseName}.${ext}`);
          } else {
            alert('No diagram found in this artifact. Downloading as markdown.');
            downloadFile(new Blob([formatted], { type: 'text/markdown' }), `${baseName}.md`);
          }
        } catch (err) {
          console.error('Image generation failed:', err);
          const isTimeout = err?.message?.includes('timed out');
          alert(isTimeout
            ? 'Image generation timed out. Downloading as markdown instead.'
            : 'Image rendering failed. Downloading as markdown.');
          downloadFile(new Blob([formatted], { type: 'text/markdown' }), `${baseName}.md`);
        } finally {
          setExportGenerating(null);
        }
        break;
    }
  };

  const handleExportFullReport = async (format) => {
    setDownloadDropdown(null);
    if (format === 'json') {
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      downloadFile(blob, `assessment-report-${assessmentId}.json`);
    } else if (format === 'pdf') {
      setExportGenerating('full');
      try {
        const pdfBlob = await generateFullReportPDF(report);
        downloadFile(pdfBlob, `assessment-report-${assessmentId}.pdf`);
      } catch (err) {
        console.error('Full report PDF failed:', err);
        alert('PDF generation failed. Try JSON export instead.');
      } finally {
        setExportGenerating(null);
      }
    }
  };
  
  // ===== RENDER =====
  
  const renderStepIndicator = () => (
    <div className="flex items-center justify-between mb-8 px-4">
      {steps.map((step, idx) => (
        <React.Fragment key={step.number}>
          <div className="flex flex-col items-center">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition ${
                currentStep > step.number
                  ? 'bg-green-500 text-white'
                  : currentStep === step.number
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-700 text-gray-400'
              }`}
            >
              {currentStep > step.number ? (
                <CheckCircle className="w-6 h-6" />
              ) : (
                step.number
              )}
            </div>
            <span className="text-xs mt-2 text-gray-400">{step.label}</span>
          </div>
          {idx < steps.length - 1 && (
            <div
              className={`flex-1 h-1 mx-2 transition ${
                currentStep > step.number ? 'bg-green-500' : 'bg-gray-700'
              }`}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
  
  const renderStep1 = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-100">Create New Assessment</h2>
      
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Assessment Name *</label>
        <input
          type="text"
          value={assessmentName}
          onChange={e => setAssessmentName(e.target.value)}
          className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          placeholder="e.g., Production Web App Assessment"
        />
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Description</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          rows={3}
          placeholder="Describe the purpose and scope of this assessment"
        />
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Business Unit</label>
          <input
            type="text"
            value={businessUnit}
            onChange={e => setBusinessUnit(e.target.value)}
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="e.g., IT Operations"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Owner</label>
          <input
            type="email"
            value={owner}
            onChange={e => setOwner(e.target.value)}
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="email@example.com"
          />
        </div>
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Assessment Type *</label>
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => setAssessmentType('service-based')}
            className={`p-4 border-2 rounded-lg text-left transition ${
              assessmentType === 'service-based'
                ? 'border-blue-500 bg-blue-900/20'
                : 'border-gray-700 bg-gray-800 hover:border-blue-400'
            }`}
          >
            <Server className="w-8 h-8 mb-2 text-blue-400" />
            <h3 className="font-semibold text-gray-100">Service-Based</h3>
            <p className="text-sm text-gray-400">
              Assess single Azure service type (App Services, VMs, AKS, etc.)
            </p>
          </button>
          
          <button
            onClick={() => setAssessmentType('multi-resource')}
            className={`p-4 border-2 rounded-lg text-left transition ${
              assessmentType === 'multi-resource'
                ? 'border-blue-500 bg-blue-900/20'
                : 'border-gray-700 bg-gray-800 hover:border-blue-400'
            }`}
          >
            <Cloud className="w-8 h-8 mb-2 text-purple-400" />
            <h3 className="font-semibold text-gray-100">Multi-Resource</h3>
            <p className="text-sm text-gray-400">
              Assess RG, subscription, or custom resource selection
            </p>
          </button>
        </div>
      </div>
      
      {assessmentType === 'service-based' && (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Select Azure Service *</label>
          <select
            value={selectedServiceType}
            onChange={e => setSelectedServiceType(e.target.value)}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            <option value="">-- Choose a service type --</option>
            {Object.entries(groupedServices).map(([category, services]) => (
              <optgroup key={category} label={category}>
                {services.map(service => (
                  <option key={service.type} value={service.type}>
                    {service.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {selectedServiceType && (
            <div className="mt-2 p-3 bg-blue-900/20 border border-blue-700 rounded-lg flex items-center gap-3">
              <ServiceIcon 
                icon={supportedServices.find(s => s.type === selectedServiceType)?.icon} 
                alt={selectedServiceType} 
                size="md" 
              />
              <div>
                <div className="text-sm font-medium text-blue-300">
                  {supportedServices.find(s => s.type === selectedServiceType)?.name}
                </div>
                <div className="text-xs text-gray-400">
                  {supportedServices.find(s => s.type === selectedServiceType)?.category}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      
      {assessmentType === 'multi-resource' && (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Scope Type *</label>
          <select
            value={scopeType}
            onChange={e => setScopeType(e.target.value)}
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 mb-4"
          >
            <option value="resource-group">Resource Group</option>
            <option value="subscription">Subscription</option>
            <option value="custom">Custom Selection (with filters)</option>
          </select>
          
          {scopeType !== 'custom' && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {scopeType === 'resource-group' ? 'Select Resource Group' : 'Select Subscription'}
              </label>
              {scopeType === 'resource-group' ? (
                <select
                  value={scopeValue}
                  onChange={e => setScopeValue(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">-- Choose a resource group --</option>
                  {dashboardResourceGroups.map(rg => (
                    <option key={rg} value={rg}>{rg}</option>
                  ))}
                </select>
              ) : (
                <select
                  value={scopeValue}
                  onChange={e => setScopeValue(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">-- Choose a subscription --</option>
                  {dashboardSubscriptions.map(sub => (
                    <option key={sub.subscription_id} value={sub.subscription_id}>
                      {sub.subscription_name || sub.subscription_id} ({sub.resource_count} resources)
                    </option>
                  ))}
                </select>
              )}
              {dashboardSubscriptions.length === 0 && dashboardResourceGroups.length === 0 && (
                <p className="text-xs text-yellow-400 mt-2">
                  △ No data available. Please run a scan from the Overview page first.
                </p>
              )}
            </div>
          )}
          {scopeType === 'custom' && (
            <div className="p-4 bg-purple-900/20 border border-purple-700 rounded-lg">
              <p className="text-sm text-purple-300">
                Custom selection will let you choose resources from all subscriptions with advanced filters in the next step.
              </p>
            </div>
          )}
        </div>
      )}
      
      <div className="flex justify-end pt-4">
        <button
          onClick={handleCreateAssessment}
          disabled={creating || !assessmentName || (assessmentType === 'service-based' && !selectedServiceType)}
          className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {creating && <Loader2 className="w-4 h-4 animate-spin" />}
          {creating ? 'Creating...' : 'Next: Scope Resources'}
          {!creating && <ChevronRight className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
  
  const renderStep2 = () => {
    // Multi-level filtering: subscription → resource group → search text
    let filteredResources = discoveredResources;
    
    // Filter by subscription
    if (selectedSubscription !== 'all') {
      filteredResources = filteredResources.filter(r => r.subscription_id === selectedSubscription);
    }
    
    // Filter by resource group
    if (selectedResourceGroup !== 'all') {
      filteredResources = filteredResources.filter(r => r.resource_group === selectedResourceGroup);
    }
    
    // Filter by search text
    if (resourceFilter) {
      filteredResources = filteredResources.filter(r =>
        r.resource_name.toLowerCase().includes(resourceFilter.toLowerCase()) ||
        r.resource_type.toLowerCase().includes(resourceFilter.toLowerCase()) ||
        r.location?.toLowerCase().includes(resourceFilter.toLowerCase())
      );
    }
    
    // Update available RGs when subscription changes
    const availableRGsForSubscription = selectedSubscription === 'all' 
      ? availableResourceGroups
      : [...new Set(discoveredResources.filter(r => r.subscription_id === selectedSubscription).map(r => r.resource_group))].sort();
    
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-100">Discover & Scope Resources</h2>
        
        {discovering && (
          <div className="flex items-center gap-3 p-4 bg-blue-900/20 border border-blue-700 rounded-lg">
            <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
            <span className="text-blue-300">Discovering resources from your Azure environment...</span>
          </div>
        )}
        
        {!discovering && discoveredResources.length === 0 && (
          <div className="p-6 bg-yellow-900/20 border border-yellow-700 rounded-lg">
            <p className="text-yellow-300 font-medium mb-2">No resources discovered</p>
            <p className="text-sm text-gray-400 mb-4">
              {assessmentType === 'service-based' && selectedServiceType
                ? `No resources of type "${supportedServices.find(s => s.type === selectedServiceType)?.name || selectedServiceType}" found. Possible causes:`
                : 'No cached data found. Please run a scan from the Overview page first, then retry.'}
            </p>
            {assessmentType === 'service-based' && selectedServiceType && (
              <ul className="text-sm text-gray-400 list-disc list-inside mb-4 ml-2">
                <li>No resources of this type are deployed in your environment</li>
                <li>The Azure environment hasn't been scanned yet (run scan from Overview)</li>
                <li>Resources exist but weren't included in the last scan scope</li>
              </ul>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setCurrentStep(1)}
                className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 flex items-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
              <button
                onClick={handleDiscoverResources}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                Retry Discovery
              </button>
              {assessmentType === 'service-based' && (
                <button
                  onClick={() => {
                    // Show all resources regardless of type
                    api.getCachedDashboard().then(dash => {
                      if (dash && dash.resources && dash.resources.length > 0) {
                        const allResources = dash.resources.map(r => ({
                          ...r,
                          subscription_id: r.subscription_id || extractSubscriptionId(r.resource_id),
                        }));
                        setDiscoveredResources(allResources);
                        setSelectedResources([]);
                        const subIds = [...new Set(allResources.map(r => r.subscription_id).filter(Boolean))];
                        const subs = subIds.map(id => ({ id, name: getSubscriptionName(id) }));
                        setAvailableSubscriptions(subs);
                        const rgs = [...new Set(allResources.map(r => r.resource_group).filter(Boolean))].sort();
                        setAvailableResourceGroups(rgs);
                      } else {
                        alert('No cached data available. Please run a scan from the Overview page first.');
                      }
                    });
                  }}
                  className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600"
                >
                  Show All Resources
                </button>
              )}
            </div>
          </div>
        )}
        
        {discoveredResources.length > 0 && (
          <div>
            <div className="mb-4">
              <h3 className="font-semibold text-gray-100 mb-3">
                {assessmentType === 'service-based' && selectedServiceType && (
                  <span>Found {discoveredResources.length} {supportedServices.find(s => s.type === selectedServiceType)?.name} resources</span>
                )}
                {assessmentType !== 'service-based' && (
                  <span>Discovered {discoveredResources.length} resources</span>
                )}
              </h3>
              
              {/* Filter Controls */}
              <div className="grid grid-cols-4 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Subscription</label>
                  <select
                    value={selectedSubscription}
                    onChange={e => {
                      setSelectedSubscription(e.target.value);
                      setSelectedResourceGroup('all'); // Reset RG filter
                    }}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="all">All Subscriptions ({availableSubscriptions.length})</option>
                    {availableSubscriptions.map(sub => (
                      <option key={sub.id} value={sub.id}>
                        {sub.name} ({discoveredResources.filter(r => r.subscription_id === sub.id).length} resources)
                      </option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Resource Group</label>
                  <select
                    value={selectedResourceGroup}
                    onChange={e => setSelectedResourceGroup(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="all">All Resource Groups ({availableRGsForSubscription.length})</option>
                    {availableRGsForSubscription.map(rg => (
                      <option key={rg} value={rg}>
                        {rg} ({discoveredResources.filter(r => 
                          r.resource_group === rg && 
                          (selectedSubscription === 'all' || r.subscription_id === selectedSubscription)
                        ).length})
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-400 mb-1">Search</label>
                  <input
                    type="text"
                    value={resourceFilter}
                    onChange={e => setResourceFilter(e.target.value)}
                    placeholder="Filter by name, type, or location..."
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
              
              {/* Action Buttons */}
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-400">
                  Showing {filteredResources.length} of {discoveredResources.length} resources • Selected: {selectedResources.length}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSelectedResources(filteredResources)}
                    className="px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                  >
                    Select Visible ({filteredResources.length})
                  </button>
                  <button
                    onClick={() => setSelectedResources([])
                    }
                    className="px-3 py-2 bg-gray-700 text-gray-300 rounded text-sm hover:bg-gray-600"
                  >
                    Clear All
                  </button>
                </div>
              </div>
            </div>
            
            <div className="max-h-96 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg">
              <table className="w-full">
                <thead className="sticky top-0 bg-gray-900 border-b border-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">
                      <input
                        type="checkbox"
                        checked={selectedResources.length === filteredResources.length && filteredResources.length > 0}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedResources([...new Set([...selectedResources, ...filteredResources])]);
                          } else {
                            setSelectedResources(selectedResources.filter(sr => 
                              !filteredResources.some(fr => fr.resource_id === sr.resource_id)
                            ));
                          }
                        }}
                        className="w-4 h-4"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">Resource</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">Location</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {filteredResources.map(resource => (
                    <tr
                      key={resource.resource_id}
                      className="hover:bg-gray-700/50 transition cursor-pointer"
                      onClick={() => toggleResourceSelection(resource.resource_id)}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedResources.some(r => r.resource_id === resource.resource_id)}
                          onChange={() => toggleResourceSelection(resource.resource_id)}
                          className="w-4 h-4"
                          onClick={e => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <ServiceIcon 
                            icon={getResourceIcon(resource.resource_type) || '□'} 
                            alt={resource.resource_type} 
                            size="md" 
                          />
                          <div className="font-medium text-sm text-gray-100">{resource.resource_name}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400">
                        {resource.resource_type.split('/').pop()}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400">
                        {resource.location}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredResources.length === 0 && resourceFilter && (
                <div className="p-8 text-center text-gray-500">
                  No resources match filter "{resourceFilter}"
                </div>
              )}
            </div>
            
            <div className="flex justify-between pt-4">
              <button
                onClick={() => setCurrentStep(1)}
                className="px-6 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 flex items-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
              <button
                onClick={handleScopeResources}
                disabled={selectedResources.length === 0}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 flex items-center gap-2"
              >
                Next: AI Analysis ({selectedResources.length} selected)
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };
  
  const renderStep3 = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-100">AI Analysis</h2>
      
      {!analysisResult && (
        <div className="text-center py-12">
          <TrendingUp className="w-16 h-16 mx-auto mb-4 text-blue-400" />
          <p className="text-gray-300 mb-6">
            Run comprehensive AI analysis on {selectedResources.length} resources
          </p>
          <button
            onClick={handleRunAnalysis}
            disabled={analyzing}
            className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 flex items-center gap-2 mx-auto"
          >
            {analyzing && <Loader2 className="w-5 h-5 animate-spin" />}
            {analyzing ? 'Analyzing...' : 'Start AI Analysis'}
          </button>
          
          <div className="flex justify-between pt-8 max-w-2xl mx-auto">
            <button
              onClick={() => setCurrentStep(2)}
              className="px-6 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 flex items-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" />
              Back to Resources
            </button>
          </div>
        </div>
      )}
      
      {analysisResult && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-blue-500 to-purple-600 text-white p-6 rounded-lg">
            <h3 className="text-4xl font-bold mb-2">{analysisResult.overall_score}/100</h3>
            <p className="text-blue-100">Overall Assessment Score</p>
          </div>
          
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-red-900/20 border border-red-700 p-4 rounded-lg">
              <h4 className="font-semibold text-red-400 mb-2">Critical Gaps</h4>
              <p className="text-2xl font-bold text-red-300">
                {safeParseList(analysisResult.critical_gaps).length}
              </p>
            </div>
            <div className="bg-yellow-900/20 border border-yellow-700 p-4 rounded-lg">
              <h4 className="font-semibold text-yellow-400 mb-2">Warnings</h4>
              <p className="text-2xl font-bold text-yellow-300">
                {safeParseList(analysisResult.warnings).length}
              </p>
            </div>
            <div className="bg-green-900/20 border border-green-700 p-4 rounded-lg">
              <h4 className="font-semibold text-green-400 mb-2">Opportunities</h4>
              <p className="text-2xl font-bold text-green-300">
                {safeParseList(analysisResult.opportunities).length}
              </p>
            </div>
          </div>
          
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-2 text-gray-100">
                <AlertCircle className="w-5 h-5 text-red-400" />
                Critical Gaps
              </h4>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {safeParseList(analysisResult.critical_gaps).map((gap, idx) => (
                  <li key={idx} className="text-gray-300">{typeof gap === 'string' ? gap : JSON.stringify(gap)}</li>
                ))}
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-2 text-gray-100">
                <TrendingUp className="w-5 h-5 text-blue-400" />
                Recommendations
              </h4>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {safeParseList(analysisResult.recommendations).slice(0, 5).map((rec, idx) => (
                  <li key={idx} className="text-gray-300">{typeof rec === 'string' ? rec : JSON.stringify(rec)}</li>
                ))}
              </ul>
            </div>
          </div>
          
          <div className="flex justify-between pt-4">
            <button
              onClick={() => setCurrentStep(2)}
              className="px-6 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 flex items-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
            <button
              onClick={() => setCurrentStep(4)}
              className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2"
            >
              Next: Agent Workflow
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
  
  const renderStep4 = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-100">Azure Workload Planner</h2>
        {/* Always-visible "Continue in Background" when workflow is running */}
        {apexWorkflowId && apexStatus?.status === 'running' && (
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-gray-700 text-blue-300 border border-blue-700 rounded-lg hover:bg-gray-600 flex items-center gap-2 text-sm font-medium"
            title="The workflow continues running on the server. You can return to this assessment anytime."
          >
            <span>↩ Continue Browsing</span>
            <span className="text-xs text-gray-400">(runs in background)</span>
          </button>
        )}
      </div>

      {/* Running-in-background info banner */}
      {apexWorkflowId && apexStatus?.status === 'running' && (
        <div style={{ background: 'var(--c-0f2a1f)', border: '1px solid #16a34a40', borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Loader2 className="w-4 h-4 text-green-400 animate-spin flex-shrink-0" />
          <div>
            <span style={{ color: 'var(--c-86efac)', fontSize: 13, fontWeight: 600 }}>Running in background — safe to navigate away</span>
            <span style={{ color: 'var(--c-4ade80)', fontSize: 12, marginLeft: 8 }}>
              {(apexStatus.agents_completed || []).length}/{apexStatus.total_agents} agents completed
            </span>
          </div>
        </div>
      )}

      {!apexWorkflowId && (
        <div className="text-center py-12">
          <Play className="w-16 h-16 mx-auto mb-4 text-blue-400" />
          <p className="text-gray-300 mb-6">
            Execute sequential AI agents to generate implementation artifacts
          </p>
          <button
            onClick={handleStartApex}
            disabled={apexRunning}
            className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 flex items-center gap-2 mx-auto"
          >
            {apexRunning && <Loader2 className="w-5 h-5 animate-spin" />}
            {apexRunning ? 'Starting...' : 'Start Agent Workflow'}
          </button>
          
          <div className="flex justify-between pt-8 max-w-2xl mx-auto">
            <button
              onClick={() => setCurrentStep(3)}
              className="px-6 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 flex items-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" />
              Back to Analysis
            </button>
          </div>
        </div>
      )}
      
      {apexStatus && (() => {
        const sequence = apexStatus.agent_sequence || [];
        const completed = apexStatus.agents_completed || [];
        const failed = apexStatus.agents_failed || [];
        const currentIdx = apexStatus.current_agent_index ?? -1;
        const isRunning = apexStatus.status === 'running';

        const getAgentStatus = (agent, idx) => {
          if (completed.includes(agent)) return 'completed';
          if (failed.includes(agent)) return 'failed';
          if (isRunning && idx === currentIdx) return 'running';
          return 'pending';
        };

        return (
        <div className="space-y-4">
          {/* Progress header */}
          <div className="bg-blue-900/20 border border-blue-700 p-4 rounded-lg">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-gray-100">Workflow Progress</span>
              <span className="text-sm text-gray-400">
                {completed.length} / {apexStatus.total_agents} agents completed
              </span>
            </div>
            <div className="mt-2 bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{
                  width: `${((completed.length) / apexStatus.total_agents) * 100}%`
                }}
              />
            </div>
          </div>

          {/* Horizontal pipeline indicator */}
          <div className="flex items-center justify-between px-2 py-3 overflow-x-auto">
            {sequence.map((agent, idx) => {
              const status = getAgentStatus(agent, idx);
              return (
                <div key={agent} className="flex items-center">
                  <div className={`flex flex-col items-center min-w-[32px] ${
                    status === 'running' ? 'scale-110' : ''
                  }`}>
                    {status === 'completed' && <CheckCircle2 className="w-6 h-6 text-green-400" />}
                    {status === 'failed' && <XCircle className="w-6 h-6 text-red-400" />}
                    {status === 'running' && <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />}
                    {status === 'pending' && <div className="w-6 h-6 rounded-full border-2 border-gray-600" />}
                    <span className={`text-[10px] mt-1 whitespace-nowrap ${
                      status === 'completed' ? 'text-green-400' :
                      status === 'failed' ? 'text-red-400' :
                      status === 'running' ? 'text-blue-400 font-semibold' :
                      'text-gray-500'
                    }`}>
                      {(AGENT_LABELS[agent] || agent).split(' ')[0]}
                    </span>
                  </div>
                  {idx < sequence.length - 1 && (
                    <div className={`w-8 h-0.5 mx-1 ${
                      completed.includes(agent) ? 'bg-green-500' : 'bg-gray-600'
                    }`} />
                  )}
                </div>
              );
            })}
          </div>
          
          {/* Detailed agent list */}
          <div className="space-y-2">
            {sequence.map((agent, idx) => {
              const status = getAgentStatus(agent, idx);
              const label = AGENT_LABELS[agent] || agent;
              const stepNum = idx + 1;
              return (
                <div key={agent} className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                  status === 'completed' ? 'bg-green-900/20 border-green-700' :
                  status === 'failed' ? 'bg-red-900/20 border-red-700' :
                  status === 'running' ? 'bg-blue-900/30 border-blue-500 ring-1 ring-blue-500/50' :
                  'bg-gray-800/50 border-gray-700 opacity-60'
                }`}>
                  {status === 'completed' && <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />}
                  {status === 'failed' && <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />}
                  {status === 'running' && <Loader2 className="w-5 h-5 text-blue-400 animate-spin flex-shrink-0" />}
                  {status === 'pending' && <div className="w-5 h-5 rounded-full border-2 border-gray-600 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                        status === 'completed' ? 'bg-green-900/40 text-green-300' :
                        status === 'failed' ? 'bg-red-900/40 text-red-300' :
                        status === 'running' ? 'bg-blue-900/40 text-blue-300' :
                        'bg-gray-700 text-gray-500'
                      }`}>{stepNum}/{sequence.length}</span>
                      <span className={`font-medium ${
                        status === 'pending' ? 'text-gray-500' : 'text-gray-100'
                      }`}>{label}</span>
                    </div>
                    {status === 'running' && (
                      <p className="text-xs text-blue-300 mt-1">Agent executing...</p>
                    )}
                  </div>
                  {status === 'completed' && (
                    <span className="text-xs text-green-400">Done</span>
                  )}
                  {status === 'failed' && (
                    <span className="text-xs text-red-400">Failed</span>
                  )}
                </div>
              );
            })}
          </div>
          
          <div className="flex justify-between pt-4">
            <button
              onClick={() => setCurrentStep(3)}
              className="px-6 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 flex items-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
            {(apexStatus?.status === 'completed' || apexStatus?.status === 'completed_with_errors') && (
              <button
                onClick={() => setCurrentStep(5)}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2"
              >
                View Report
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        );
      })()}
    </div>
  );
  
  const renderStep5 = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-100">Assessment Report</h2>
      
      {generatingReport && (
        <div className="text-center py-12">
          <Loader2 className="w-16 h-16 mx-auto mb-4 text-blue-400 animate-spin" />
          <p className="text-gray-300">Generating comprehensive report...</p>
        </div>
      )}
      
      {report && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-green-500 to-blue-600 text-white p-6 rounded-lg">
            <h3 className="text-2xl font-bold mb-2">✓ Assessment Complete</h3>
            <p className="text-green-100">{report.assessment.assessment_name}</p>
            <p className="text-sm text-green-200">
              Generated: {new Date(report.generated_at).toLocaleString()}
            </p>
          </div>
          
          {report.analysis && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
              <h4 className="font-semibold text-lg mb-4 text-gray-100">Executive Summary</h4>
              <div className="prose max-w-none">
                <pre className="whitespace-pre-wrap text-sm text-gray-300">
                  {report.executive_summary || report.analysis.executive_summary || 'No summary available'}
                </pre>
              </div>
            </div>
          )}
          
          <div>
            <h4 className="font-semibold text-lg mb-4 text-gray-100">Generated Artifacts</h4>
            <div className="space-y-2">
              {report.executions && report.executions.length > 0 ? (
                report.executions.map((execution, idx) => {
                  const isDesign = execution.agent_name === '04-design';
                  const isIaC = execution.agent_name === '06b-bicep-codegen';
                  const label = AGENT_LABELS[execution.agent_name] || execution.agent_name;
                  const isGenerating = exportGenerating === idx;

                  return (
                    <div key={idx} className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                      <div className="flex justify-between items-center">
                        <div>
                          <h5 className="font-medium text-gray-100">{label}</h5>
                          <p className="text-sm text-gray-400">
                            {execution.started_at ? new Date(execution.started_at).toLocaleString() : 'N/A'}
                          </p>
                        </div>
                        <div className="relative">
                          <button
                            onClick={(e) => { e.stopPropagation(); setDownloadDropdown(downloadDropdown === idx ? null : idx); }}
                            disabled={isGenerating}
                            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-2 disabled:opacity-60 disabled:cursor-wait"
                          >
                            {isGenerating ? (
                              <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
                            ) : (
                              <><Download className="w-4 h-4" /> Download <ChevronDown className="w-3 h-3 ml-1" /></>
                            )}
                          </button>
                          {downloadDropdown === idx && (
                            <div className="absolute right-0 mt-1 w-60 bg-gray-700 border border-gray-600 rounded-lg shadow-xl z-20 py-1" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={() => handleArtifactDownload('md', execution, idx)}
                                className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-600 flex items-center gap-3 rounded-t-lg"
                              >
                                <FileText className="w-4 h-4 text-blue-400 flex-shrink-0" />
                                <div><div>Markdown</div><div className="text-xs text-gray-400">.md — Original format</div></div>
                              </button>
                              <button
                                onClick={() => handleArtifactDownload('txt', execution, idx)}
                                className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-600 flex items-center gap-3"
                              >
                                <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                <div><div>Plain Text</div><div className="text-xs text-gray-400">.txt — Clean text without formatting</div></div>
                              </button>
                              <button
                                onClick={() => handleArtifactDownload('pdf', execution, idx)}
                                className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-600 flex items-center gap-3"
                              >
                                <FileDown className="w-4 h-4 text-red-400 flex-shrink-0" />
                                <div><div>PDF Document</div><div className="text-xs text-gray-400">.pdf — Professional formatted report</div></div>
                              </button>
                              {(isDesign || execution.agent_name === '03-architect') && (
                                <button
                                  onClick={() => handleArtifactDownload('png', execution, idx)}
                                  className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-600 flex items-center gap-3 rounded-b-lg"
                                >
                                  <ImageIcon className="w-4 h-4 text-green-400 flex-shrink-0" />
                                  <div><div>Architecture Diagram</div><div className="text-xs text-gray-400">.png — Azure architecture image with service icons</div></div>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-gray-400 text-sm">No artifacts generated yet</p>
              )}
            </div>
          </div>
          
          <div className="flex justify-between pt-4">
            <button
              onClick={() => setCurrentStep(4)}
              className="px-6 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 flex items-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
            <div className="flex gap-3">
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600"
              >
                New Assessment
              </button>
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setDownloadDropdown(downloadDropdown === 'export' ? null : 'export'); }}
                  disabled={exportGenerating === 'full'}
                  className="px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-2 disabled:opacity-60 disabled:cursor-wait"
                >
                  {exportGenerating === 'full' ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Generating PDF...</>
                  ) : (
                    <><Download className="w-4 h-4" /> Export Report <ChevronDown className="w-3 h-3 ml-1" /></>
                  )}
                </button>
                {downloadDropdown === 'export' && (
                  <div className="absolute right-0 bottom-full mb-1 w-60 bg-gray-700 border border-gray-600 rounded-lg shadow-xl z-20 py-1" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => handleExportFullReport('json')}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-600 flex items-center gap-3 rounded-t-lg"
                    >
                      <FileText className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                      <div><div>JSON Data</div><div className="text-xs text-gray-400">Raw report data for integration</div></div>
                    </button>
                    <button
                      onClick={() => handleExportFullReport('pdf')}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-600 flex items-center gap-3 rounded-b-lg"
                    >
                      <FileDown className="w-4 h-4 text-red-400 flex-shrink-0" />
                      <div><div>PDF Report</div><div className="text-xs text-gray-400">Full formatted assessment report</div></div>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
  
  return (
    <div className="max-w-5xl mx-auto p-6">
      {resuming ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
          <p className="text-gray-400">Loading assessment...</p>
        </div>
      ) : (
        <>
          {renderStepIndicator()}
          <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-lg p-8">
            {currentStep === 1 && renderStep1()}
            {currentStep === 2 && renderStep2()}
            {currentStep === 3 && renderStep3()}
            {currentStep === 4 && renderStep4()}
            {currentStep === 5 && renderStep5()}
          </div>
        </>
      )}
    </div>
  );
};

export default AssessmentWizard;
