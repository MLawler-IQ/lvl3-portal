'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  Search,
  Wrench,
  TrendingUp,
  Eye,
  FileSearch,
  GitCompare,
  Link2,
  FileText,
  FileSpreadsheet,
  ImageIcon,
  BookOpen,
  Gauge,
  FileCode,
  AlignLeft,
  RefreshCw,
  MousePointerClick,
  BarChart3,
  Code2,
  LayoutTemplate,
  Activity,
  MapPin,
} from 'lucide-react'
import { RunStatusBadge } from '@/components/ui/StatusBadge'
import type {
  ToolCategory,
  ToolInputType,
  ToolDataSource,
  ToolAccess,
  ToolStatus,
  ToolRuntime,
} from '@/lib/tools/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SerializedTool {
  slug: string
  name: string
  description: string
  category: ToolCategory
  tags: string[]
  inputType: ToolInputType
  dataSources: ToolDataSource[]
  access: ToolAccess
  status: ToolStatus
  persistsRuns: boolean
  estimatedRuntime: ToolRuntime
  route: string
}

interface Props {
  tools: SerializedTool[]
  selectedClientId: string | null
}

// ---------------------------------------------------------------------------
// Icon map
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, React.ElementType> = {
  'keyword-quick-wins': TrendingUp,
  'ai-visibility': Eye,
  'content-gaps': FileSearch,
  'semrush-gap': GitCompare,
  'backlink-overview': Link2,
  'seo-content-engine': FileText,
  'tfk-generator': FileSpreadsheet,
  'blog-image-generator': ImageIcon,
  'keyword-research': BookOpen,
  'core-web-vitals': Gauge,
  'page-seo-audit': FileCode,
  'content-quality': AlignLeft,
  'content-refresh-finder': RefreshCw,
  'landing-page-cro-audit': MousePointerClick,
  'vertical-benchmark': BarChart3,
  'schema-generator': Code2,
  'service-page-generator': LayoutTemplate,
  'indexation-monitor': Activity,
  'gbp-audit': MapPin,
}

// ---------------------------------------------------------------------------
// Category config
// ---------------------------------------------------------------------------

const CATEGORY_ORDER: ToolCategory[] = [
  'analyze',
  'create',
  'audit',
  'research',
  'monitor',
  'operate',
]

const CATEGORY_LABELS: Record<ToolCategory, string> = {
  analyze: 'Analyze',
  create: 'Create',
  audit: 'Audit',
  research: 'Research',
  monitor: 'Monitor',
  operate: 'Operate',
}

// ---------------------------------------------------------------------------
// ToolCard
// ---------------------------------------------------------------------------

function ToolCard({
  tool,
  selectedClientId,
}: {
  tool: SerializedTool
  selectedClientId: string | null
}) {
  const Icon = ICON_MAP[tool.slug] ?? Wrench
  const requiresClient = tool.inputType === 'client' || tool.inputType === 'mixed'
  const isComingSoon = tool.status === 'coming-soon'
  const enabled = !isComingSoon && (!requiresClient || !!selectedClientId)

  return (
    <Link
      href={enabled ? tool.route : '#'}
      className={`bg-surface-900 border border-surface-700 rounded-xl p-6 space-y-3 transition-all duration-200 block ${
        enabled
          ? 'hover:border-surface-600 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(0,0,0,0.12)] cursor-pointer'
          : 'opacity-50 cursor-not-allowed pointer-events-none'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: 'var(--active-bg)' }}
        >
          <Icon className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
        </div>
        <RunStatusBadge variant={tool.status} />
      </div>
      <div>
        <p className="text-sm font-semibold text-surface-100 mb-1">{tool.name}</p>
        <p className="text-xs text-surface-400 leading-relaxed">{tool.description}</p>
      </div>
      {enabled && (
        <p className="text-xs font-medium" style={{ color: 'var(--color-accent)' }}>
          Run →
        </p>
      )}
    </Link>
  )
}

// ---------------------------------------------------------------------------
// ToolsHubClient
// ---------------------------------------------------------------------------

const CATEGORY_CHIPS = ['all', 'analyze', 'create', 'audit', 'research', 'monitor'] as const

export default function ToolsHubClient({ tools, selectedClientId }: Props) {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<ToolCategory | 'all'>('all')
  const [recentSlugs, setRecentSlugs] = useState<string[]>([])

  useEffect(() => {
    try {
      const stored = localStorage.getItem('lvl3-recent-tools')
      if (stored) setRecentSlugs(JSON.parse(stored) as string[])
    } catch {
      // ignore parse errors
    }
  }, [])

  // ── Filtering ─────────────────────────────────────────────────────────────

  // Coming-soon stubs are hidden until built — they occupied prime grid slots
  // as permanently-disabled cards.
  const available = tools.filter(t => t.status !== 'coming-soon')

  const filtered = available.filter(t => {
    const q = query.toLowerCase()
    const matchesQuery =
      !q ||
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some(tag => tag.includes(q))
    const matchesCategory = activeCategory === 'all' || t.category === activeCategory
    return matchesQuery && matchesCategory
  })

  // ── Derived rows ──────────────────────────────────────────────────────────

  const newTools = filtered.filter(t => t.status === 'new')
  const recentTools = recentSlugs
    .map(slug => filtered.find(t => t.slug === slug))
    .filter(Boolean) as SerializedTool[]

  const hasActiveFilter = query || activeCategory !== 'all'

  return (
    <div className="max-w-7xl mx-auto p-6 pb-8 space-y-8">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: 'var(--active-bg)' }}
        >
          <Wrench className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-surface-100">Tools</h1>
          <p className="text-sm text-surface-400 mt-0.5">
            SEO analysis, content generation, and site auditing tools.
          </p>
        </div>
      </div>

      {/* Search + filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search tools…"
            className="w-full bg-surface-800 border border-surface-700 rounded-lg pl-8 pr-3 py-2 text-sm text-surface-100 placeholder-surface-500 focus:outline-none focus:border-surface-600"
          />
        </div>

        {CATEGORY_CHIPS.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat as ToolCategory | 'all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeCategory === cat
                ? 'bg-brand-400/15 text-brand-400 border border-brand-400/20'
                : 'bg-surface-800 text-surface-400 border border-surface-700 hover:text-surface-300'
            }`}
          >
            {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
          </button>
        ))}
      </div>

      {/* No-client warning — shown once before any sections */}
      {!selectedClientId &&
        filtered.some(t => t.inputType === 'client' || t.inputType === 'mixed') && (
          <div className="bg-surface-900 border border-surface-700 rounded-xl px-5 py-4">
            <p className="text-sm text-surface-400">
              No client selected — pick one from the top bar to enable client-scoped tools.
            </p>
          </div>
        )}

      {/* No results */}
      {filtered.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-sm text-surface-400">No tools match &ldquo;{query}&rdquo;</p>
        </div>
      )}

      {/* New row */}
      {newTools.length > 0 && !query && activeCategory === 'all' && (
        <section className="space-y-3">
          <p className="eyebrow">New</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {newTools.map(t => (
              <ToolCard key={t.slug} tool={t} selectedClientId={selectedClientId} />
            ))}
          </div>
        </section>
      )}

      {/* Recent row */}
      {recentTools.length > 0 && !query && (
        <section className="space-y-3">
          <p className="eyebrow">Recent</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {recentTools.map(t => (
              <ToolCard key={t.slug} tool={t} selectedClientId={selectedClientId} />
            ))}
          </div>
        </section>
      )}

      {/* All tools grouped by category */}
      {filtered.length > 0 &&
        (hasActiveFilter ? (
          // Flat grid when search/filter is active
          <section className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {filtered.map(t => (
                <ToolCard key={t.slug} tool={t} selectedClientId={selectedClientId} />
              ))}
            </div>
          </section>
        ) : (
          // Grouped by category
          CATEGORY_ORDER.filter(cat =>
            filtered.some(t => t.category === cat)
          ).map(cat => (
            <section key={cat} className="space-y-3">
              <p className="eyebrow">{CATEGORY_LABELS[cat]}</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {filtered
                  .filter(t => t.category === cat)
                  .map(t => (
                    <ToolCard key={t.slug} tool={t} selectedClientId={selectedClientId} />
                  ))}
              </div>
            </section>
          ))
        ))}
    </div>
  )
}
