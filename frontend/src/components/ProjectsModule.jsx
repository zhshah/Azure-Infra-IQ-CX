import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import {
  Plus, FolderOpen, Trash2, ArrowLeft, ChevronRight,
  Clock, CheckCircle, XCircle, AlertTriangle, FileText,
  Shield, Server, Settings, Eye, Link2, Activity
} from 'lucide-react';
import clsx from 'clsx';

/**
 * ProjectsModule – BCDR Projects with Assessment Integration
 * Dark theme, proper UX matching the rest of the app.
 */

const CRITICALITY_STYLES = {
  Critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  High:     'bg-orange-500/20 text-orange-400 border-orange-500/30',
  Medium:   'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  Low:      'bg-green-500/20 text-green-400 border-green-500/30',
};

const DR_TIER_STYLES = {
  'Tier 0': 'bg-red-500/20 text-red-300',
  'Tier 1': 'bg-orange-500/20 text-orange-300',
  'Tier 2': 'bg-yellow-500/20 text-yellow-300',
  'Tier 3': 'bg-green-500/20 text-green-300',
};

export default function ProjectsModule({ resources = [] }) {
  const [projects, setProjects] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list'); // 'list' | 'detail'

  useEffect(() => {
    loadProjects();
    loadAssessments();
  }, []);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const data = await api._request('/projects');
      setProjects(data.projects || []);
    } catch (err) {
      console.error('Failed to load projects:', err);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  const loadAssessments = async () => {
    try {
      const data = await api._request('/assessments');
      setAssessments(data.assessments || []);
    } catch (err) {
      console.error('Failed to load assessments:', err);
    }
  };

  const createProject = async (projectData) => {
    try {
      await api._request('/projects', {
        method: 'POST',
        body: JSON.stringify(projectData),
      });
      await loadProjects();
      setShowCreateModal(false);
    } catch (err) {
      alert('Failed to create project: ' + err.message);
    }
  };

  const deleteProject = async (projectId) => {
    if (!confirm('Delete this project? This cannot be undone.')) return;
    try {
      await api._request(`/projects/${projectId}`, { method: 'DELETE' });
      await loadProjects();
      if (selectedProject?.project_id === projectId) {
        setSelectedProject(null);
        setView('list');
      }
    } catch (err) {
      alert('Failed to delete project: ' + err.message);
    }
  };

  // Assessments linked to a project (match by project name or project_id)
  const getLinkedAssessments = (project) => {
    if (!project) return [];
    return assessments.filter(a =>
      a.project_id === project.project_id ||
      (a.assessment_name && project.project_name &&
        a.assessment_name.toLowerCase().includes(project.project_name.toLowerCase()))
    );
  };

  // Get APEX status summary for a project from its linked assessments
  const getProjectApexStatus = (project) => {
    const linked = getLinkedAssessments(project);
    if (linked.length === 0) return null;
    const completed = linked.find(a => a.status === 'completed');
    if (completed) return 'completed';
    const running = linked.find(a => a.status === 'apex-running');
    if (running) return 'apex-running';
    const analyzed = linked.find(a => a.status === 'analyzed');
    if (analyzed) return 'analyzed';
    return linked[0]?.status || null;
  };

  // ─── Loading State ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-12 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent" />
        <p className="mt-4 text-gray-400">Loading projects...</p>
      </div>
    );
  }

  // ─── Detail View ────────────────────────────────────────────────
  if (view === 'detail' && selectedProject) {
    const linked = getLinkedAssessments(selectedProject);

    return (
      <div className="space-y-6">
        {/* Back + Header */}
        <div className="flex items-center justify-between">
          <div>
            <button
              onClick={() => { setView('list'); setSelectedProject(null); }}
              className="text-blue-400 hover:text-blue-300 text-sm mb-2 flex items-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Projects
            </button>
            <h2 className="text-2xl font-bold text-gray-100">{selectedProject.project_name}</h2>
            <p className="text-gray-400 mt-1">{selectedProject.description || 'No description'}</p>
          </div>

          <button
            onClick={() => deleteProject(selectedProject.project_id)}
            className="px-4 py-2 border border-red-500/40 text-red-400 rounded-lg hover:bg-red-500/10 flex items-center gap-2 text-sm"
          >
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        </div>

        {/* BCDR Metadata Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: 'Business Unit', value: selectedProject.business_unit, icon: Server },
            { label: 'Criticality', value: selectedProject.criticality, icon: AlertTriangle },
            { label: 'DR Tier', value: selectedProject.dr_tier, icon: Shield },
            { label: 'RTO Target', value: selectedProject.rto_target, icon: Clock },
            { label: 'RPO Target', value: selectedProject.rpo_target, icon: Activity },
            { label: 'Environment', value: selectedProject.environment, icon: Settings },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="bg-gray-800 border border-gray-700 rounded-lg p-4">
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                <Icon className="w-3 h-3" /> {label}
              </div>
              <div className="text-sm font-medium text-gray-200">{value || 'Not set'}</div>
            </div>
          ))}
        </div>

        {/* Owner / Created */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
            <div className="text-xs text-gray-500 mb-1">Owner</div>
            <div className="text-sm text-gray-200">{selectedProject.owner || 'Not set'}</div>
          </div>
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
            <div className="text-xs text-gray-500 mb-1">Created</div>
            <div className="text-sm text-gray-200">
              {selectedProject.created_at ? new Date(selectedProject.created_at).toLocaleString() : 'Unknown'}
            </div>
          </div>
        </div>

        {/* Linked Assessments */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
              <Link2 className="w-5 h-5 text-blue-400" /> Linked Assessments
            </h3>
            <span className="text-xs text-gray-500">{linked.length} assessment(s)</span>
          </div>

          {linked.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <FileText className="w-10 h-10 mx-auto mb-3 text-gray-600" />
              <p className="text-sm">No assessments linked to this project yet.</p>
              <p className="text-xs text-gray-600 mt-1">
                Create an assessment from the Assessments tab matching this project's workload.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {linked.map((a) => (
                <div key={a.assessment_id}
                  className="flex items-center justify-between bg-gray-900/60 border border-gray-700/50 rounded-lg p-4"
                >
                  <div className="flex items-center gap-3">
                    {a.status === 'completed' ? (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    ) : a.status === 'apex-running' || a.status === 'analyzing' ? (
                      <Clock className="w-5 h-5 text-blue-400 animate-pulse" />
                    ) : a.status === 'failed' ? (
                      <XCircle className="w-5 h-5 text-red-500" />
                    ) : (
                      <Clock className="w-5 h-5 text-gray-500" />
                    )}
                    <div>
                      <div className="text-sm font-medium text-gray-200">{a.assessment_name}</div>
                      <div className="text-xs text-gray-500">
                        {a.assessment_type} &middot; {a.service_type || 'multi-resource'} &middot;{' '}
                        {a.created_at ? new Date(a.created_at).toLocaleDateString() : ''}
                      </div>
                    </div>
                  </div>
                  <span className={clsx('px-2 py-1 rounded text-xs font-medium border',
                    a.status === 'completed' && 'bg-green-500/20 text-green-400 border-green-500/30',
                    a.status === 'apex-running' && 'bg-blue-500/20 text-blue-400 border-blue-500/30',
                    a.status === 'analyzed' && 'bg-purple-500/20 text-purple-400 border-purple-500/30',
                    a.status === 'failed' && 'bg-red-500/20 text-red-400 border-red-500/30',
                    !['completed','apex-running','analyzed','failed'].includes(a.status) && 'bg-gray-700 text-gray-400 border-gray-600',
                  )}>
                    {a.status?.replace('-', ' ') || 'draft'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── List View ──────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">BCDR Projects</h2>
          <p className="text-gray-400 mt-1">Manage workloads and execute APEX implementation workflow</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 font-medium shadow-lg"
        >
          <Plus className="w-4 h-4" /> New Project
        </button>
      </div>

      {/* Empty State */}
      {projects.length === 0 ? (
        <div className="bg-gray-800/50 rounded-lg p-12 text-center border-2 border-dashed border-gray-700">
          <FolderOpen className="w-16 h-16 mx-auto text-gray-600 mb-4" />
          <h3 className="text-lg font-medium text-gray-300 mb-2">No projects yet</h3>
          <p className="text-gray-500 mb-6 max-w-md mx-auto">
            Create your first BCDR project to group workloads, define DR requirements, and execute APEX implementation workflows.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            Create Project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {projects.map((project) => {
            const apexStatus = getProjectApexStatus(project);
            const linkedCount = getLinkedAssessments(project).length;
            const critStyle = CRITICALITY_STYLES[project.criticality] || 'bg-gray-700/50 text-gray-400 border-gray-600';
            const tierStyle = DR_TIER_STYLES[project.dr_tier] || 'bg-gray-700/50 text-gray-400';

            return (
              <div
                key={project.project_id || project.id}
                className="bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-600 transition-all cursor-pointer group"
                onClick={() => {
                  setSelectedProject(project);
                  setView('detail');
                }}
              >
                {/* Card Header */}
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                      <FolderOpen className="w-5 h-5 text-blue-400" />
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteProject(project.project_id || project.id); }}
                      className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete project"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <h3 className="text-base font-semibold text-gray-100 mb-1 group-hover:text-white transition-colors">
                    {project.project_name || project.name}
                  </h3>
                  <p className="text-xs text-gray-500 line-clamp-2 mb-4">
                    {project.description || 'No description'}
                  </p>

                  {/* Tags Row */}
                  <div className="flex flex-wrap items-center gap-2">
                    {project.criticality && (
                      <span className={clsx('px-2 py-0.5 rounded text-xs font-medium border', critStyle)}>
                        {project.criticality}
                      </span>
                    )}
                    {project.dr_tier && (
                      <span className={clsx('px-2 py-0.5 rounded text-xs font-medium', tierStyle)}>
                        {project.dr_tier}
                      </span>
                    )}
                    {project.environment && (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-700/50 text-gray-400">
                        {project.environment}
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Footer */}
                <div className="px-5 py-3 border-t border-gray-700/50 flex items-center justify-between">
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    {linkedCount > 0 && (
                      <span className="flex items-center gap-1">
                        <FileText className="w-3 h-3" /> {linkedCount} assessment{linkedCount > 1 ? 's' : ''}
                      </span>
                    )}
                    {apexStatus && (
                      <span className={clsx('flex items-center gap-1',
                        apexStatus === 'completed' && 'text-green-400',
                        apexStatus === 'apex-running' && 'text-blue-400',
                        apexStatus === 'analyzed' && 'text-purple-400',
                      )}>
                        {apexStatus === 'completed' && <><CheckCircle className="w-3 h-3" /> APEX Done</>}
                        {apexStatus === 'apex-running' && <><Clock className="w-3 h-3 animate-pulse" /> APEX Running</>}
                        {apexStatus === 'analyzed' && <><Eye className="w-3 h-3" /> Analyzed</>}
                      </span>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Project Modal */}
      {showCreateModal && (
        <CreateProjectModal
          onClose={() => setShowCreateModal(false)}
          onCreate={createProject}
        />
      )}
    </div>
  );
}


/* ─── Create Project Modal ─────────────────────────────────────────── */
function CreateProjectModal({ onClose, onCreate }) {
  const [formData, setFormData] = useState({
    project_name: '',
    description: '',
    business_unit: '',
    criticality: 'Medium',
    rto_target: '< 4 hours',
    rpo_target: '< 1 hour',
    environment: 'Production',
    dr_tier: 'Tier 1',
    owner: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.project_name.trim()) return;
    setSubmitting(true);
    try {
      await onCreate({
        ...formData,
        project_id: `proj-${Date.now()}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = 'w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-600';
  const labelClass = 'block text-sm font-medium text-gray-400 mb-1';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-gray-800 border border-gray-700 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-100">Create New Project</h3>
            <p className="text-xs text-gray-500 mt-0.5">Define a BCDR workload with DR requirements</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Name */}
          <div>
            <label className={labelClass}>Project Name *</label>
            <input
              type="text"
              required
              value={formData.project_name}
              onChange={(e) => setFormData({ ...formData, project_name: e.target.value })}
              placeholder="e.g. Qatar Production BCDR"
              className={inputClass}
            />
          </div>

          {/* Description */}
          <div>
            <label className={labelClass}>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Brief description of the workload and DR objectives..."
              className={clsx(inputClass, 'min-h-[80px]')}
            />
          </div>

          {/* Grid: Business Unit + Owner */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Business Unit</label>
              <input
                type="text"
                value={formData.business_unit}
                onChange={(e) => setFormData({ ...formData, business_unit: e.target.value })}
                placeholder="e.g. Engineering"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Owner</label>
              <input
                type="text"
                value={formData.owner}
                onChange={(e) => setFormData({ ...formData, owner: e.target.value })}
                placeholder="e.g. john@contoso.com"
                className={inputClass}
              />
            </div>
          </div>

          {/* Grid: Criticality + DR Tier */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Criticality</label>
              <select
                value={formData.criticality}
                onChange={(e) => setFormData({ ...formData, criticality: e.target.value })}
                className={inputClass}
              >
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>DR Tier</label>
              <select
                value={formData.dr_tier}
                onChange={(e) => setFormData({ ...formData, dr_tier: e.target.value })}
                className={inputClass}
              >
                <option value="Tier 0">Tier 0 – Mission Critical</option>
                <option value="Tier 1">Tier 1 – Business Critical</option>
                <option value="Tier 2">Tier 2 – Business Operational</option>
                <option value="Tier 3">Tier 3 – Non-Critical</option>
              </select>
            </div>
          </div>

          {/* Grid: RTO + RPO */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>RTO Target</label>
              <select
                value={formData.rto_target}
                onChange={(e) => setFormData({ ...formData, rto_target: e.target.value })}
                className={inputClass}
              >
                <option value="< 15 minutes">&lt; 15 minutes</option>
                <option value="< 1 hour">&lt; 1 hour</option>
                <option value="< 4 hours">&lt; 4 hours</option>
                <option value="< 8 hours">&lt; 8 hours</option>
                <option value="< 24 hours">&lt; 24 hours</option>
                <option value="< 72 hours">&lt; 72 hours</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>RPO Target</label>
              <select
                value={formData.rpo_target}
                onChange={(e) => setFormData({ ...formData, rpo_target: e.target.value })}
                className={inputClass}
              >
                <option value="Zero data loss">Zero data loss</option>
                <option value="< 5 minutes">&lt; 5 minutes</option>
                <option value="< 15 minutes">&lt; 15 minutes</option>
                <option value="< 1 hour">&lt; 1 hour</option>
                <option value="< 4 hours">&lt; 4 hours</option>
                <option value="< 24 hours">&lt; 24 hours</option>
              </select>
            </div>
          </div>

          {/* Environment */}
          <div>
            <label className={labelClass}>Environment</label>
            <select
              value={formData.environment}
              onChange={(e) => setFormData({ ...formData, environment: e.target.value })}
              className={inputClass}
            >
              <option value="Production">Production</option>
              <option value="Staging">Staging</option>
              <option value="Development">Development</option>
              <option value="DR">DR</option>
            </select>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting || !formData.project_name.trim()}
              className={clsx(
                'px-6 py-2.5 rounded-lg font-medium flex items-center gap-2',
                submitting || !formData.project_name.trim()
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              )}
            >
              {submitting ? (
                <><div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" /> Creating...</>
              ) : (
                <><Plus className="w-4 h-4" /> Create Project</>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700 font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
