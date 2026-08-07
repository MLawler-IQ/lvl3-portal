'use client'

// One audit run, rendered honestly.
//
// This is the browser half of lib/orchestrator/report-text.ts, and it inherits that
// file's one hard rule: a `not_run` row carries the SAME visual weight as a `fail`.
// Never dimmed, never collapsed into a footnote, never absent. The cheapest way for a
// UI to break that rule is to render "no result" as a green tick or as blank space, so
// three things here are structural rather than incidental:
//
//   1. Every finding goes through ONE row renderer. There is no branch on status
//      anywhere in the layout — only in the status chip, which is a label, not a weight.
//   2. The station strip iterates a hand-written list of all four slots, so a run that
//      forgot a station renders "not reported" instead of silently omitting the row.
//      (Same reasoning as STATION_ORDER in report-text.ts, and the same literal.)
//   3. Counts print all four statuses even at zero. "0 not_run" is information; an
//      omitted not_run count is indistinguishable from a view that does not track them.
//
// SHAPE TOLERANCE. `AuditSummary` widens every field to optional, and both
// `PersistedAuditRun` (out of `audit_runs.result jsonb`) and a live `AuditRunResult`
// satisfy it. Widening is NOT permission to default: an absent field renders as an
// explicit "not reported", never as a zero or a blank, because an absent `scoring` is
// not an empty plan and an absent `coverage` is not a clean crawl. Whether the stored
// envelope was readable at all is decided upstream in lib/audit/store.ts, which returns
// null plus an `unreadableReason` — this view is never handed a guess.

import { useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  HelpCircle,
  X,
} from 'lucide-react'
import type { AuditExportAttribution } from '@/lib/audit/store'
import type { Finding, FindingStatus } from '@/lib/findings/types'
import type { SitebulbCoverage } from '@/lib/ingest/sitebulb/crawl'
import type { StationReport, StationSlot, StationState } from '@/lib/orchestrator/types'
import type { ScoredRecommendation, ScoringResult, UnscoredFinding } from '@/lib/scoring/types'

/**
 * What this view can render.
 *
 * Structurally a widened `AuditRunResult` minus `stations` (the raw station data is not
 * a screen) and minus `recording` (a tool_runs bookkeeping detail). Widened because the
 * same object may have made a round trip through Postgres: every field is optional so a
 * stored run written by an older shape still renders what it does have and says what it
 * does not, rather than throwing on a missing key.
 */
export interface AuditSummary {
  status?: string
  /** ScoringResult.configVersion, mirrored. 'unavailable' when scoring could not run. */
  configVersion?: string | null
  /** Partial on purpose: a missing slot renders as "not reported", never as absent. */
  stationStatus?: Partial<Record<StationSlot, StationReport>>
  coverage?: SitebulbCoverage | null
  findings?: Finding[]
  scoring?: ScoringResult | null
  /** Degradations of the RUN itself, as opposed to of any one station. */
  notes?: string[]
  startedAt?: string
  completedAt?: string
  durationMs?: number
}

/**
 * All four slots, in a fixed order, as a literal.
 *
 * Hand-listed rather than derived from the run's keys — deriving them lets a run that
 * dropped a station render a strip that simply omits it. `gbp` is on this list even
 * though no GBP station exists in the pipeline: its permanent `unavailable` state with a
 * reason is the honest statement, and an absent row is not.
 */
const STATION_ORDER: readonly StationSlot[] = ['crawl', 'gsc', 'gbp', 'robots']

const STATUS_ORDER: readonly FindingStatus[] = ['fail', 'degraded', 'pass', 'not_run']

const EMPTY = '—'

function num(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return EMPTY
  return Number(n.toFixed(4)).toLocaleString()
}

function timestamp(iso: string | undefined): string {
  if (!iso) return EMPTY
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

/* ── status chips ──────────────────────────────────────────────────────────────
 * Colour distinguishes; it does not rank. `not_run` gets the accent violet and a
 * question-mark glyph rather than a grey — grey reads as "inactive", which is one
 * step from "fine", and the whole point is that we did not look.
 */

type Tone = 'error' | 'warning' | 'success' | 'accent' | 'neutral'

const TONE_VAR: Record<Exclude<Tone, 'accent' | 'neutral'>, string> = {
  error: 'var(--color-error)',
  warning: 'var(--color-warning)',
  success: 'var(--color-success)',
}

function toneStyle(tone: Tone): React.CSSProperties {
  if (tone === 'neutral') return {}
  if (tone === 'accent') return {}
  const v = TONE_VAR[tone]
  return {
    color: v,
    backgroundColor: `color-mix(in srgb, ${v} 12%, transparent)`,
    borderColor: `color-mix(in srgb, ${v} 35%, transparent)`,
  }
}

function toneClass(tone: Tone): string {
  if (tone === 'accent') return 'text-brand-400 bg-brand-400/10 border-brand-400/40'
  if (tone === 'neutral') return 'text-surface-300 bg-surface-800 border-surface-700'
  return ''
}

const FINDING_TONE: Record<FindingStatus, Tone> = {
  fail: 'error',
  degraded: 'warning',
  pass: 'success',
  not_run: 'accent',
}

function FindingStatusChip({ status }: { status: FindingStatus }) {
  const tone = FINDING_TONE[status] ?? 'neutral'
  const Icon =
    status === 'fail' ? X : status === 'degraded' ? AlertTriangle : status === 'pass' ? Check : HelpCircle
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.08em] ${toneClass(tone)}`}
      style={toneStyle(tone)}
    >
      <Icon size={11} className="shrink-0" />
      {status === 'not_run' ? 'not run' : status}
    </span>
  )
}

const STATION_TONE: Record<StationState, Tone> = {
  ok: 'success',
  degraded: 'warning',
  failed: 'error',
  skipped: 'accent',
  unconfigured: 'accent',
  unavailable: 'accent',
}

function StationStateChip({ state }: { state: StationState | 'not reported' }) {
  const tone: Tone = state === 'not reported' ? 'accent' : (STATION_TONE[state] ?? 'neutral')
  const Icon = state === 'ok' ? Check : state === 'failed' ? X : state === 'degraded' ? AlertTriangle : CircleSlash
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium ${toneClass(tone)}`}
      style={toneStyle(tone)}
    >
      <Icon size={11} className="shrink-0" />
      {state}
    </span>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-brand-500 mb-3">
      {children}
    </h3>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-surface-700 bg-surface-900 px-5 py-4">
      {children}
    </section>
  )
}

/**
 * The evidence line.
 *
 * The engine's `notRun` helper sets `evidence.detail` and `reason` to the same string,
 * so printing both unconditionally renders "gbp station not provided (gbp station not
 * provided)" on every not_run row. report-text.ts hit this first; the fix is the same.
 */
function detailFor(finding: Finding): { detail: string; reason: string | null } {
  const detail = finding.evidence?.detail ?? EMPTY
  const reason = finding.reason && finding.reason !== detail ? finding.reason : null
  return { detail, reason }
}

function magnitude(finding: Finding): string | null {
  const ev = finding.evidence
  if (!ev) return null
  if (typeof ev.affectedUrls === 'number') return `${num(ev.affectedUrls)} URLs affected`
  if (typeof ev.value === 'number') return `value ${num(ev.value)}`
  return null
}

export interface AuditResultViewProps {
  summary: AuditSummary
  /** Shown in the header when known. The run result carries no client name. */
  clientName?: string | null
  /**
   * Whose site the export describes, as far as anyone can tell.
   *
   * Rendered rather than hidden because nothing in the pipeline validates that an export
   * belongs to the client it was filed under — a `mismatch` here is the only place an
   * operator will ever find out they uploaded the wrong folder.
   */
  attribution?: AuditExportAttribution | null
  /** The run as lib/orchestrator/report-text.ts rendered it, verbatim. */
  reportText?: string | null
}

export default function AuditResultView({
  summary,
  clientName,
  attribution,
  reportText,
}: AuditResultViewProps) {
  const findings = summary.findings ?? []
  const scoring = summary.scoring ?? null
  const items: ScoredRecommendation[] = scoring?.items ?? []
  const unscored: UnscoredFinding[] = scoring?.unscored ?? []
  const notes = summary.notes ?? []

  const rankByCheck = new Map<string, ScoredRecommendation>()
  for (const item of items) rankByCheck.set(item.checkId, item)

  const ordered = [...findings].sort((a, b) => {
    const ra = rankByCheck.get(a.checkId)?.rank ?? Number.MAX_SAFE_INTEGER
    const rb = rankByCheck.get(b.checkId)?.rank ?? Number.MAX_SAFE_INTEGER
    return ra - rb || a.checkId.localeCompare(b.checkId)
  })

  const counts = STATUS_ORDER.map((s) => ({ status: s, n: findings.filter((f) => f.status === s).length }))

  return (
    <div className="space-y-4">
      {/* ── header ───────────────────────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <Eyebrow>Audit run</Eyebrow>
            <p className="text-sm text-surface-100">
              {clientName ?? 'Client not named'}
              {attribution ? (
                <span className="text-surface-400"> · {attribution.label}</span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-surface-400">
            <span>
              status{' '}
              <span className="font-medium text-surface-100">{summary.status ?? 'unknown'}</span>
            </span>
            <span>
              configVersion{' '}
              <span className="font-mono text-surface-100">{summary.configVersion || EMPTY}</span>
            </span>
            <span>
              duration <span className="tabular-nums text-surface-100">{num(summary.durationMs)}ms</span>
            </span>
            <span>started {timestamp(summary.startedAt)}</span>
          </div>
        </div>

        {/*
          The score is only as interpretable as the config that produced it, so the two
          are never shown apart. 'unavailable' is the orchestrator's own word for
          "scoring could not run" — surfaced verbatim rather than smoothed into a blank.
        */}
        {(!summary.configVersion || summary.configVersion === 'unavailable') && (
          <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--color-warning)' }}>
            No scoring config version on this run — the ranked plan below is absent or
            unattributable. A number nobody can trace to a config is not a score.
          </p>
        )}

        {attribution && (
          <div className="mt-3 border-t border-surface-800 pt-3 text-[11px] leading-relaxed">
            <p className="text-surface-400">
              Export attribution{' '}
              <span
                className="font-medium"
                style={
                  attribution.verdict === 'mismatch'
                    ? { color: 'var(--color-error)' }
                    : attribution.verdict === 'unknown'
                      ? { color: 'var(--color-warning)' }
                      : undefined
                }
              >
                {attribution.verdict}
              </span>{' '}
              — {attribution.reason}
            </p>
            <p className="mt-1 text-surface-400">
              export origins{' '}
              <span className="font-mono text-surface-300">
                {attribution.origins.length > 0 ? attribution.origins.join(', ') : 'none read'}
                {attribution.originsTruncated ? ' …' : ''}
              </span>{' '}
              · client website_url{' '}
              <span className="font-mono text-surface-300">
                {attribution.clientWebsiteUrl || 'not set'}
              </span>
            </p>
          </div>
        )}
      </Card>

      {/* ── run degradation notes ────────────────────────────────────────────── */}
      <Card>
        <Eyebrow>Run degradations</Eyebrow>
        {notes.length === 0 ? (
          <p className="text-[13px] text-surface-400">
            None recorded. This says the run reported no run-level degradation — it does
            not say every station ran; read the strip below for that.
          </p>
        ) : (
          <ul className="space-y-2">
            {notes.map((note, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-surface-300">
                <AlertTriangle
                  size={13}
                  className="mt-0.5 shrink-0"
                  style={{ color: 'var(--color-warning)' }}
                />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── station strip ────────────────────────────────────────────────────── */}
      <Card>
        <Eyebrow>Stations</Eyebrow>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.08em] text-surface-400">
                <th className="pb-2 pr-4 font-medium">Station</th>
                <th className="pb-2 pr-4 font-medium">State</th>
                <th className="pb-2 pr-4 font-medium">Duration</th>
                <th className="pb-2 pr-4 font-medium">Sources</th>
                <th className="pb-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {STATION_ORDER.map((slot) => {
                const report = summary.stationStatus?.[slot]
                const detail = report
                  ? [report.reason, ...(report.notes ?? [])].filter(Boolean).join(' · ')
                  : 'No station report was recorded for this slot.'
                return (
                  <tr key={slot} className="border-t border-surface-800 align-top">
                    <td className="py-2 pr-4 font-mono text-surface-100">{slot}</td>
                    <td className="py-2 pr-4">
                      <StationStateChip state={report?.state ?? 'not reported'} />
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-surface-400">
                      {report ? `${num(report.durationMs)}ms` : EMPTY}
                    </td>
                    <td className="py-2 pr-4 text-surface-400">
                      {report && report.sources?.length ? report.sources.join(', ') : EMPTY}
                    </td>
                    <td className="py-2 leading-relaxed text-surface-300">{detail || EMPTY}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-surface-400">
          Four slots, always. <span className="font-mono">gbp</span> is{' '}
          <span className="text-surface-300">unavailable</span> in this pipeline rather than
          skipped — no GBP station exists, so LOCAL-003 and LOCAL-016 read{' '}
          <span className="font-mono">not_run</span> below by construction.
        </p>
      </Card>

      {/* ── coverage ─────────────────────────────────────────────────────────── */}
      <Card>
        <Eyebrow>Crawl coverage</Eyebrow>
        <CoverageBlock coverage={summary.coverage ?? null} />
      </Card>

      {/* ── findings ─────────────────────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-brand-500">
            Findings
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {counts.map(({ status, n }) => (
              <span key={status} className="inline-flex items-center gap-1.5">
                <FindingStatusChip status={status} />
                <span className="tabular-nums text-[13px] text-surface-300">{n}</span>
              </span>
            ))}
          </div>
        </div>

        {findings.length === 0 ? (
          <p className="text-[13px] text-surface-400">
            This run recorded no findings at all. That is a broken run, not a clean site.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-[0.08em] text-surface-400">
                  <th className="pb-2 pr-3 font-medium">Rank</th>
                  <th className="pb-2 pr-3 font-medium">Check</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 pr-3 font-medium">Source</th>
                  <th className="pb-2 pr-3 font-medium text-right">Impact</th>
                  <th className="pb-2 pr-3 font-medium text-right">Priority</th>
                  <th className="pb-2 pr-3 font-medium">Band</th>
                  <th className="pb-2 font-medium">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {/*
                  ONE renderer, every status. No branch on status in this map, no second
                  table for not_run, no dimming class keyed off it. Restoring any of those
                  is how "we did not look" quietly becomes a footnote.
                */}
                {ordered.map((finding) => {
                  const item = rankByCheck.get(finding.checkId)
                  const { detail, reason } = detailFor(finding)
                  const mag = magnitude(finding)
                  return (
                    <tr key={finding.checkId} className="border-t border-surface-800 align-top">
                      <td className="py-2.5 pr-3 tabular-nums text-surface-400">
                        {item ? item.rank : EMPTY}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-surface-100 whitespace-nowrap">
                        {finding.checkId}
                      </td>
                      <td className="py-2.5 pr-3">
                        <FindingStatusChip status={finding.status} />
                      </td>
                      <td className="py-2.5 pr-3 text-surface-400">{finding.source}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-surface-300">
                        {item ? num(item.impact) : EMPTY}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-surface-300">
                        {item ? num(item.priorityScore) : EMPTY}
                      </td>
                      <td className="py-2.5 pr-3 text-surface-400">{item ? item.band : EMPTY}</td>
                      <td className="py-2.5 leading-relaxed text-surface-300">
                        {detail}
                        {reason && <span className="text-surface-400"> ({reason})</span>}
                        {mag && <span className="text-surface-400"> · {mag}</span>}
                        {finding.evidence?.examples && finding.evidence.examples.length > 0 && (
                          <span className="mt-1 block break-all font-mono text-[11px] text-surface-400">
                            {finding.evidence.examples.slice(0, 5).join('  ·  ')}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-surface-400">
          <span className="font-mono text-surface-300">not run</span> means the check could
          not be evaluated — a missing station, empty data, a failed fetch. It is never a
          pass, and it is never evidence that the defect is absent.
        </p>
      </Card>

      {/* ── score trace ──────────────────────────────────────────────────────── */}
      <Card>
        <Eyebrow>Score trace</Eyebrow>
        {items.length === 0 ? (
          <p className="text-[13px] text-surface-400">
            No scored items. Only failing checks are scored, so this is either a run with
            no failures or a run where scoring did not complete — the config version in the
            header tells the two apart.
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <ScoreTraceRow key={item.checkId} item={item} />
            ))}
          </div>
        )}

        {unscored.length > 0 && (
          <div className="mt-4 border-t border-surface-800 pt-3">
            <p className="text-[11px] uppercase tracking-[0.08em] text-surface-400 mb-2">
              Deliberately unscored ({unscored.length})
            </p>
            <ul className="space-y-1.5">
              {unscored.map((u) => (
                <li key={u.checkId} className="text-[13px] text-surface-300">
                  <span className="font-mono text-surface-100">{u.checkId}</span>{' '}
                  <span className="text-surface-400">
                    [{u.status}] {u.reason}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* ── the run as text ──────────────────────────────────────────────────── */}
      {reportText && (
        <Card>
          <Eyebrow>Report, verbatim</Eyebrow>
          <p className="mb-2 text-[11px] leading-relaxed text-surface-400">
            Exactly the bytes lib/orchestrator/report-text.ts produced and the context
            library stored — the same renderer the dry-run script prints, whose equal-weight
            guarantee for <span className="font-mono">not_run</span> rows is a tested
            property. Quotable as-is.
          </p>
          <details>
            <summary className="cursor-pointer text-[13px] text-surface-300 transition-colors hover:text-surface-100">
              Show the text report
            </summary>
            <pre className="mt-2 max-h-[32rem] overflow-auto rounded-sm border border-surface-800 bg-surface-950 px-3 py-2 font-mono text-[11px] leading-relaxed text-surface-300">
              {reportText}
            </pre>
          </details>
        </Card>
      )}
    </div>
  )
}

/**
 * Coverage, including the degradation rule stated rather than implied.
 *
 * The rule is printed with its inputs directly above it so a reader can check the
 * arithmetic — same reasoning as formatCoverage in report-text.ts. A missing coverage
 * report is NOT a clean one, and the empty state says so in those words.
 */
function CoverageBlock({ coverage }: { coverage: SitebulbCoverage | null }) {
  if (!coverage) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-surface-300">
          No coverage report: the crawl ingest failed before any coverage existed.
        </p>
        <p className="text-[11px] leading-relaxed text-surface-400">
          A missing coverage report is not a clean one. <span className="font-mono">degraded
          = filesMissing.length &gt; 0</span> → <span className="font-medium">unknown</span>{' '}
          here, because there is no coverage to read.
        </p>
      </div>
    )
  }

  const unmeasured = Object.entries(coverage.unmeasured ?? {}).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )
  const missing = coverage.filesMissing ?? []

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[9rem_1fr] text-[13px]">
        <dt className="text-surface-400">URLs</dt>
        <dd className="tabular-nums text-surface-100">{num(coverage.urls)}</dd>

        <dt className="text-surface-400">Files read</dt>
        <dd className="text-surface-300">
          {coverage.filesRead?.length ? coverage.filesRead.join(', ') : '(none)'}
        </dd>

        <dt className="text-surface-400">Files missing</dt>
        <dd style={missing.length > 0 ? { color: 'var(--color-warning)' } : undefined}
            className={missing.length > 0 ? '' : 'text-surface-300'}>
          {missing.length > 0 ? missing.join(', ') : '(none)'}
        </dd>

        <dt className="text-surface-400">Unmeasured</dt>
        <dd className="text-surface-300">
          {unmeasured.length === 0 ? (
            '(none)'
          ) : (
            <ul className="space-y-0.5">
              {unmeasured.map(([signal, n]) => (
                <li key={signal} className="tabular-nums">
                  <span className="font-mono text-surface-100">{signal}</span> = {num(n)} of{' '}
                  {num(coverage.urls)}
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>

      <p className="font-mono text-[12px] text-surface-100">
        degraded = filesMissing.length &gt; 0 → {missing.length > 0 ? 'TRUE' : 'FALSE'}
      </p>
      <p className="text-[11px] leading-relaxed text-surface-400">
        <span className="font-mono">unmeasured</span> deliberately does not degrade the
        crawl station. <span className="font-mono">internalLinksOut</span> is bumped for
        every page on every export, so degrading on it would leave the crawl station
        permanently degraded and no crawl-backed check could ever return{' '}
        <span className="font-mono">pass</span>. The rule lives in one place,{' '}
        <span className="font-mono">lib/stations/degradation.ts</span>.
      </p>
    </div>
  )
}

/**
 * One scored item, expandable to its full derivation.
 *
 * `inputs.formula` is printed VERBATIM and never wrapped, prettified or truncated — the
 * whole reason it is persisted is that it is quotable on a client call, and a re-flowed
 * formula is a different string. Same exception report-text.ts carves out.
 */
function ScoreTraceRow({ item }: { item: ScoredRecommendation }) {
  const [open, setOpen] = useState(false)
  const terms = Object.entries(item.inputs?.terms ?? {})

  return (
    <div className="rounded-lg border border-surface-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-850 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        {open ? (
          <ChevronDown size={13} className="shrink-0 text-surface-400" />
        ) : (
          <ChevronRight size={13} className="shrink-0 text-surface-400" />
        )}
        <span className="font-mono text-surface-100">{item.checkId}</span>
        <span className="text-surface-400">
          rank {item.rank} · {item.band} · impact {num(item.impact)} · priority{' '}
          {num(item.priorityScore)}
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-surface-800 px-3 py-3 text-[12px]">
          <p className="text-surface-400">
            basis <span className="text-surface-100">{item.basis}</span> · severity{' '}
            <span className="text-surface-100">{item.severity}</span> (
            {num(item.severityWeight)}) · effort{' '}
            <span className="text-surface-100">{item.effort}</span> ({num(item.effortWeight)}) ·
            category <span className="text-surface-100">{item.category}</span>
          </p>
          <p className="overflow-x-auto whitespace-pre font-mono text-surface-100">
            {item.inputs?.formula ?? EMPTY}
          </p>
          <p className="text-surface-300">
            {terms.length === 0
              ? 'terms (none)'
              : terms.map(([k, v]) => `${k}=${num(v)}`).join(', ')}
          </p>
          <p className="text-surface-300">
            rawImpact {num(item.inputs?.rawImpact)} × basisWeight {num(item.inputs?.basisWeight)}{' '}
            → impact {num(item.impact)}; priorityScore = impact / effortWeight ={' '}
            {num(item.priorityScore)}
          </p>
          {item.inputs?.notes && item.inputs.notes.length > 0 && (
            <ul className="space-y-1">
              {item.inputs.notes.map((n, i) => (
                <li key={i} className="text-surface-400">
                  · {n}
                </li>
              ))}
            </ul>
          )}
          <p className="text-surface-400">{item.evidenceDetail}</p>
        </div>
      )}
    </div>
  )
}
