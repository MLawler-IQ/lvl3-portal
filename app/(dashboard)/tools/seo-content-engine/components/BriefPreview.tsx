'use client'

import { useState } from 'react'
import type { ContentBrief } from '@/lib/seo-content-engine/types'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface BriefPreviewProps {
  brief: ContentBrief | Record<string, unknown>
}

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl overflow-hidden">
      <button
        type="button"
        className="w-full px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-surface-850 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="text-sm font-semibold text-surface-200">{title}</span>
        {open ? (
          <ChevronDown className="w-4 h-4 text-surface-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-surface-400" />
        )}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

// DB JSON may store entries as objects instead of strings — always coerce to string
const toStr = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : String((v as Record<string, unknown>)?.keyword ?? (v as Record<string, unknown>)?.name ?? v)

export default function BriefPreview({ brief }: BriefPreviewProps) {
  const b = brief as ContentBrief

  return (
    <div className="space-y-3">
      {/* Search Intent */}
      {b.intent && (
        <Section title="Search Intent" defaultOpen>
          <p className="text-sm text-surface-300 mb-2">{b.intent}</p>
          {b.sub_intents && b.sub_intents.length > 0 && (
            <div>
              <p className="text-xs text-surface-400 uppercase tracking-wider mb-1">Sub-intents</p>
              <ul className="list-disc list-inside text-sm text-surface-400 space-y-0.5">
                {b.sub_intents.map((si, i) => (
                  <li key={i}>{toStr(si)}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {/* Content Outline */}
      {b.outline && b.outline.length > 0 && (
        <Section title="Content Outline" defaultOpen>
          <ol className="space-y-3">
            {b.outline.map((section, i) => (
              <li key={i} className="text-sm">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-brand-400 font-mono font-bold text-xs">{i + 1}.</span>
                  <span className="font-semibold text-surface-200">{section.heading}</span>
                  <span className="text-xs text-surface-400 ml-auto">{section.estimated_word_count} words</span>
                </div>
                {(section.key_points ?? []).length > 0 && (
                  <ul className="list-disc list-inside text-surface-400 ml-5 space-y-0.5 text-xs">
                    {(section.key_points ?? []).map((pt, j) => (
                      <li key={j}>{toStr(pt)}</li>
                    ))}
                  </ul>
                )}
                {(section.keywords_to_include ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 ml-5 mt-1">
                    {(section.keywords_to_include ?? []).map((kw, j) => (
                      <span key={j} className="px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: 'var(--active-bg)', color: 'var(--color-accent)' }}>
                        {toStr(kw)}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* Competitive Gaps */}
      {b.competitive_gaps && b.competitive_gaps.length > 0 && (
        <Section title="Competitive Gaps">
          <ul className="list-disc list-inside text-sm text-surface-300 space-y-1">
            {b.competitive_gaps.map((gap, i) => (
              <li key={i}>{toStr(gap)}</li>
            ))}
          </ul>
        </Section>
      )}

      {/* GEO Targets */}
      {b.geo_targets && b.geo_targets.length > 0 && (
        <Section title="GEO Targets">
          <ul className="list-disc list-inside text-sm text-surface-300 space-y-1">
            {b.geo_targets.map((t, i) => (
              <li key={i}>{toStr(t)}</li>
            ))}
          </ul>
        </Section>
      )}

      {/* Citation Hooks */}
      {b.citation_hooks && b.citation_hooks.length > 0 && (
        <Section title="Citation Hooks">
          <ul className="list-disc list-inside text-sm text-surface-300 space-y-1">
            {b.citation_hooks.map((h, i) => (
              <li key={i}>{toStr(h)}</li>
            ))}
          </ul>
        </Section>
      )}

      {/* Entity Definitions */}
      {b.entity_definitions && Object.keys(b.entity_definitions).length > 0 && (
        <Section title="Entity Definitions">
          <dl className="space-y-2">
            {Object.entries(b.entity_definitions).map(([entity, def]) => (
              <div key={entity}>
                <dt className="text-sm font-semibold text-surface-200">{entity}</dt>
                <dd className="text-sm text-surface-400 ml-3">{def}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      {/* Editorial Guidance */}
      {b.editorial_guidance && (
        <Section title="Editorial Guidance">
          <div className="space-y-3 text-sm">
            {b.editorial_guidance.angle && (
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider mb-0.5">Angle</p>
                <p className="text-surface-300">{b.editorial_guidance.angle}</p>
              </div>
            )}
            {b.editorial_guidance.tone && (
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider mb-0.5">Tone</p>
                <p className="text-surface-300">{b.editorial_guidance.tone}</p>
              </div>
            )}
            {b.editorial_guidance.what_to_emphasize && b.editorial_guidance.what_to_emphasize.length > 0 && (
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider mb-0.5">Emphasize</p>
                <ul className="list-disc list-inside text-surface-300 space-y-0.5">
                  {b.editorial_guidance.what_to_emphasize.map((e, i) => (
                    <li key={i}>{toStr(e)}</li>
                  ))}
                </ul>
              </div>
            )}
            {b.editorial_guidance.what_to_avoid && b.editorial_guidance.what_to_avoid.length > 0 && (
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider mb-0.5">Avoid</p>
                <ul className="list-disc list-inside text-surface-300 space-y-0.5">
                  {b.editorial_guidance.what_to_avoid.map((a, i) => (
                    <li key={i}>{toStr(a)}</li>
                  ))}
                </ul>
              </div>
            )}
            {b.editorial_guidance.differentiation_notes && (
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider mb-0.5">Differentiation</p>
                <p className="text-surface-300">{b.editorial_guidance.differentiation_notes}</p>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Meta Title / Meta Description */}
      {(b.meta_title || b.meta_description) && (
        <Section title="Meta Title / Meta Description">
          <div className="space-y-2 text-sm">
            {b.meta_title && (
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider mb-0.5">Meta Title</p>
                <p className="text-surface-200 font-medium">{b.meta_title}</p>
              </div>
            )}
            {b.meta_description && (
              <div>
                <p className="text-xs text-surface-400 uppercase tracking-wider mb-0.5">Meta Description</p>
                <p className="text-surface-300">{b.meta_description}</p>
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  )
}
