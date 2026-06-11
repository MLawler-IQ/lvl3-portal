import { Sparkles } from 'lucide-react'
import MetricTable, { ColumnDef } from '@/components/analytics/shared/MetricTable'
import type { SourceMediumRow } from '@/lib/google-analytics'

const columns: ColumnDef<SourceMediumRow & Record<string, unknown>>[] = [
  {
    key: 'sourceMedium',
    label: 'Source / Medium',
    render: (v) => <span className="text-surface-300">{String(v)}</span>,
  },
  {
    key: 'sessions',
    label: 'Sessions',
    align: 'right',
    render: (v) => <span className="text-surface-300">{Number(v).toLocaleString()}</span>,
  },
  {
    key: 'users',
    label: 'Users',
    align: 'right',
    render: (v) => <span className="text-surface-300">{Number(v).toLocaleString()}</span>,
  },
]

// ── AI Search detection ──────────────────────────────────────────────────────
// Surface AI-assistant referrals as a named "AI Search" grouping at the display
// level only — the server data shape (SourceMediumRow) is unchanged. We match on
// the source token (the part before the " / " medium separator), case-insensitive,
// and allow subdomains via suffix matching against the registered host list.
const AI_SEARCH_DOMAINS = [
  'chatgpt.com',
  'chat.openai.com',
  'perplexity.ai',
  'gemini.google.com',
  'bard.google.com',
  'copilot.microsoft.com',
] as const

function isAiSearchSource(sourceMedium: string): boolean {
  // Source token = everything before the " / " medium separator.
  const source = sourceMedium.split(' / ')[0].trim().toLowerCase()
  if (!source) return false
  return AI_SEARCH_DOMAINS.some(
    (domain) => source === domain || source.endsWith(`.${domain}`),
  )
}

interface Props {
  rows: SourceMediumRow[]
}

const MAX_ROWS = 25

export default function SourceMediumTable({ rows }: Props) {
  const aiRows = rows.filter((r) => isAiSearchSource(r.sourceMedium))

  // No AI-assistant traffic → render exactly as before.
  if (aiRows.length === 0) {
    return (
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
        <p className="text-sm font-semibold text-surface-100 mb-4">Top Source / Medium</p>
        <MetricTable
          columns={columns}
          rows={rows as (SourceMediumRow & Record<string, unknown>)[]}
          maxRows={MAX_ROWS}
        />
      </div>
    )
  }

  const otherRows = rows.filter((r) => !isAiSearchSource(r.sourceMedium))
  const aiSessions = aiRows.reduce((acc, r) => acc + (r.sessions ?? 0), 0)
  const aiUsers = aiRows.reduce((acc, r) => acc + (r.users ?? 0), 0)

  // Keep the overall table bounded like before: the AI section is always shown
  // in full; the remaining slots go to the (already-ranked) non-AI rows.
  const visibleOther = otherRows.slice(0, Math.max(0, MAX_ROWS - aiRows.length))

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <p className="text-sm font-semibold text-surface-100 mb-4">Top Source / Medium</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-700">
              <th className="pb-2 text-left text-xs font-medium uppercase tracking-wider text-surface-500">
                Source / Medium
              </th>
              <th className="pb-2 text-right text-xs font-medium uppercase tracking-wider text-surface-500">
                Sessions
              </th>
              <th className="pb-2 text-right text-xs font-medium uppercase tracking-wider text-surface-500">
                Users
              </th>
            </tr>
          </thead>
          <tbody>
            {/* AI Search summary row — aggregates all matched AI-assistant referrals. */}
            <tr className="border-b border-surface-700/50 bg-surface-800/30">
              <td className="py-2">
                <span className="inline-flex items-center gap-1.5 font-medium text-accent-400">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  AI Search
                  <span className="text-xs font-normal text-surface-500">
                    ({aiRows.length} source{aiRows.length === 1 ? '' : 's'})
                  </span>
                </span>
              </td>
              <td className="py-2 text-right font-semibold text-accent-400">
                {aiSessions.toLocaleString()}
              </td>
              <td className="py-2 text-right font-semibold text-accent-400">
                {aiUsers.toLocaleString()}
              </td>
            </tr>
            {/* Matched rows, indented + badged under the summary. */}
            {aiRows.map((row, i) => (
              <tr
                key={`ai-${i}`}
                className="border-b border-surface-700/50 hover:bg-surface-800/30 transition-colors"
              >
                <td className="py-2 pl-6">
                  <span className="text-surface-300">{row.sourceMedium}</span>
                  <span className="ml-2 rounded bg-accent-400/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent-400">
                    AI
                  </span>
                </td>
                <td className="py-2 text-right text-surface-300">{row.sessions.toLocaleString()}</td>
                <td className="py-2 text-right text-surface-300">{row.users.toLocaleString()}</td>
              </tr>
            ))}
            {/* All other sources, ranked as before. */}
            {visibleOther.map((row, i) => (
              <tr
                key={`o-${i}`}
                className="border-b border-surface-700/50 hover:bg-surface-800/30 transition-colors"
              >
                <td className="py-2 text-surface-300">{row.sourceMedium}</td>
                <td className="py-2 text-right text-surface-300">{row.sessions.toLocaleString()}</td>
                <td className="py-2 text-right text-surface-300">{row.users.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
