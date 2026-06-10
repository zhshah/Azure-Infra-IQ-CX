import { useState, useEffect } from 'react'
import { Tag, AlertTriangle, CheckCircle, Info } from 'lucide-react'
import { api } from '../api/client'

export default function TagAIBanner({ onNavigateToTags }) {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    api.getTagStats().then(setStats).catch(() => {})
  }, [])

  if (!stats) return null

  const total = stats.total_resources || 0
  const tagged = stats.tagged_resources || 0
  const coverage = total > 0 ? Math.round((tagged / total) * 100) : 0
  const critTagged = stats.by_key?.Criticality || 0

  if (coverage >= 80) {
    return (
      <div className="mb-4 p-3 bg-green-900/30 border border-green-700 rounded-lg flex items-center gap-3">
        <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
        <div className="text-sm text-green-200">
          <span className="font-medium">Custom Tags Active:</span>{' '}
          {tagged}/{total} resources tagged ({coverage}% coverage). AI assessments use your Criticality, DR_Tier, RPO/RTO tags to prioritize recommendations.
        </div>
      </div>
    )
  }

  if (coverage > 0) {
    return (
      <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-700 rounded-lg flex items-center gap-3">
        <Info className="w-5 h-5 text-yellow-400 shrink-0" />
        <div className="text-sm text-yellow-200 flex-1">
          <span className="font-medium">Partial Tag Coverage:</span>{' '}
          {tagged}/{total} resources tagged ({coverage}%). {critTagged > 0 ? `${critTagged} have Criticality tags.` : 'No Criticality tags yet.'}{' '}
          Tag more resources to improve AI recommendation accuracy.
        </div>
        {onNavigateToTags && (
          <button onClick={onNavigateToTags} className="text-xs px-2 py-1 bg-yellow-700 hover:bg-yellow-600 rounded text-yellow-100 whitespace-nowrap">
            <Tag className="w-3 h-3 inline mr-1" />Manage Tags
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="mb-4 p-3 bg-blue-900/30 border border-blue-700 rounded-lg flex items-center gap-3">
      <AlertTriangle className="w-5 h-5 text-blue-400 shrink-0" />
      <div className="text-sm text-blue-200 flex-1">
        <span className="font-medium">Enhance AI Accuracy:</span>{' '}
        Tag resources with Criticality, DR_Tier, RPO/RTO to get prioritized, business-aware recommendations from AI assessments.
      </div>
      {onNavigateToTags && (
        <button onClick={onNavigateToTags} className="text-xs px-2 py-1 bg-blue-700 hover:bg-blue-600 rounded text-blue-100 whitespace-nowrap">
          <Tag className="w-3 h-3 inline mr-1" />Start Tagging
        </button>
      )}
    </div>
  )
}
