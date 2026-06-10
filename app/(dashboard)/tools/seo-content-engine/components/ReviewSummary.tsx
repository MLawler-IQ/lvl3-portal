'use client'

import type { DraftReview } from '@/lib/seo-content-engine/types'
import { statusColor, statusTint, type StatusLevel } from '@/lib/status-color'

const GEO_LEVELS: Record<string, StatusLevel> = {
  strong: 'success',
  moderate: 'warning',
  weak: 'error',
}

const RECOMMENDATION_LEVELS: Record<string, StatusLevel> = {
  publish: 'success',
  revise: 'warning',
  rewrite: 'error',
}

const SEVERITY_LEVELS: Record<string, StatusLevel> = {
  critical: 'error',
  moderate: 'warning',
  minor: 'neutral',
}

function pillStyle(level: StatusLevel | undefined): React.CSSProperties | undefined {
  if (!level) return undefined
  return { color: statusColor(level), backgroundColor: statusTint(level, 10) }
}

export default function ReviewSummary({ review }: { review: DraftReview }) {
  // Guard against null/undefined from DB JSON blobs
  const issues = review.issues ?? []
  const missingKeywords = review.missing_keywords ?? []
  const wordCount = review.word_count ?? 0
  const geoScore = review.geo_score ?? 'weak'
  const recommendation = review.recommendation ?? 'revise'

  return (
    <div className="space-y-4">
      {/* Status row */}
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Pass / Fail */}
          <span
            className="px-3 py-1 rounded-full text-xs font-semibold"
            style={pillStyle(review.passed ? 'success' : 'error')}
          >
            {review.passed ? 'PASS' : 'FAIL'}
          </span>

          {/* Word Count */}
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-surface-800 text-surface-300 font-mono">
            {wordCount.toLocaleString()} words
          </span>

          {/* GEO Score */}
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold ${GEO_LEVELS[geoScore] ? '' : 'bg-surface-800 text-surface-400'}`}
            style={pillStyle(GEO_LEVELS[geoScore])}
          >
            GEO: {geoScore}
          </span>

          {/* Recommendation */}
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold ${RECOMMENDATION_LEVELS[recommendation] ? '' : 'bg-surface-800 text-surface-400'}`}
            style={pillStyle(RECOMMENDATION_LEVELS[recommendation])}
          >
            {recommendation.charAt(0).toUpperCase() + recommendation.slice(1)}
          </span>
        </div>
      </div>

      {/* Issues */}
      {issues.length > 0 && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-700">
            <h4 className="text-xs font-medium uppercase tracking-wider text-brand-500">
              Issues ({issues.length})
            </h4>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-800 text-surface-400 text-xs uppercase tracking-wider">
                <th className="px-4 py-2.5 text-left font-medium">Type</th>
                <th className="px-4 py-2.5 text-left font-medium">Detail</th>
                <th className="px-4 py-2.5 text-left font-medium">Severity</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue, i) => (
                <tr key={i} className="border-b border-surface-800 hover:bg-surface-850">
                  <td className="px-4 py-2.5 text-surface-300 font-medium">{issue.type}</td>
                  <td className="px-4 py-2.5 text-surface-400">{issue.detail}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className="text-xs font-semibold capitalize"
                      style={{ color: statusColor(SEVERITY_LEVELS[issue.severity] ?? 'neutral') }}
                    >
                      {issue.severity}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Missing Keywords */}
      {missingKeywords.length > 0 && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-4">
          <h4 className="text-xs font-medium uppercase tracking-wider text-brand-500 mb-2">
            Missing Keywords ({missingKeywords.length})
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {missingKeywords.map((kw, i) => (
              <span
                key={i}
                className="px-2 py-0.5 rounded-full text-xs border"
                style={{
                  color: statusColor('error'),
                  backgroundColor: statusTint('error', 10),
                  borderColor: statusTint('error', 20),
                }}
              >
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
