'use client'

import { useState, useCallback } from 'react'
import { Download, RefreshCw, FileArchive, FileSpreadsheet } from 'lucide-react'
import JSZip from 'jszip'
import type {
  TopicInput,
  RunMode,
  DataAvailability,
  KeywordPlan,
  ContentBrief,
  DraftReview,
} from '@/lib/seo-content-engine/types'
import { usePipelineStream, type TopicState } from '@/hooks/usePipelineStream'
import { loadRun, getDocxUrl, regenerateDocx, exportMatrixifyCsv } from '@/app/actions/seo-content-engine'
import TopicForm from './components/TopicForm'
import XlsxUploader from './components/XlsxUploader'
import PipelineProgress from './components/PipelineProgress'
import DataAvailabilityPanel from './components/DataAvailabilityPanel'
import KeywordPlanView from './components/KeywordPlanView'
import BriefPreview from './components/BriefPreview'
import DraftPreview from './components/DraftPreview'
import ReviewSummary from './components/ReviewSummary'
import RunHistory from './components/RunHistory'

// ── Tabs ────────────────────────────────────────────────────

const TABS = ['New Run', 'Progress', 'Results', 'History'] as const
type Tab = (typeof TABS)[number]

// ── Mode labels ─────────────────────────────────────────────

const MODE_OPTIONS: { value: RunMode; label: string }[] = [
  { value: 'keywords_only', label: 'Keywords Only' },
  { value: 'brief', label: 'Brief + Keywords' },
  { value: 'full', label: 'Full Pipeline' },
]

// ── Component ───────────────────────────────────────────────

interface Props {
  clientId: string
  clientName: string
  clientBrandContext?: string | null
}

export default function SeoContentEngineClient({ clientId, clientName, clientBrandContext }: Props) {
  // ── State ───────────────────────────────────────────────
  const [topics, setTopics] = useState<TopicInput[]>([])
  const [mode, setMode] = useState<RunMode>('full')
  const [brandContext, setBrandContext] = useState(clientBrandContext ?? '')
  const [activeTab, setActiveTab] = useState<Tab>('New Run')

  // ── Stream consumer (extracted hook) ────────────────────

  const {
    isRunning,
    runId,
    setRunId,
    topicStates,
    setTopicStates,
    preflightResults,
    setPreflightResults,
    startRun: startPipelineRun,
    stopRun,
  } = usePipelineStream({
    clientId,
    onRunStart: () => setActiveTab('Progress'),
    onRunComplete: () => setActiveTab('Results'),
  })

  const startRun = useCallback(() => {
    startPipelineRun(topics, mode, brandContext)
  }, [startPipelineRun, topics, mode, brandContext])

  // ── Load historical run from DB ─────────────────────────

  const handleLoadRun = useCallback(async (id: string, status: string) => {
    const result = await loadRun(id)
    if (result.error || !result.data) return

    const run = result.data
    const loadedTopics: TopicInput[] = run.topics.map((t) => ({
      title: t.title,
      target_audience: t.target_audience ?? undefined,
      angle: t.angle ?? undefined,
      existing_url: t.existing_url ?? undefined,
      pillar: t.pillar ?? undefined,
      funnel_stage: t.funnel_stage ?? undefined,
      primary_intent: t.primary_intent ?? undefined,
      summary: t.summary ?? undefined,
      differentiation_angle: t.differentiation_angle ?? undefined,
      internal_linking: t.internal_linking ?? undefined,
      geo_notes: t.geo_notes ?? undefined,
      seed_keywords: (t.seed_keywords ?? []) as unknown as TopicInput['seed_keywords'],
    }))

    const loadedStates = new Map<number, TopicState>()
    run.topics.forEach((t, i) => {
      // Map DB status to TopicState status — 'partial' means some phases succeeded
      const statusMap: Record<string, TopicState['status']> = {
        complete: 'complete',
        partial: 'complete', // partial topics have results — show them
        failed: 'failed',
        running: 'failed',   // orphaned running topics are effectively failed
        pending: 'pending',
      }
      const topicStatus = statusMap[t.status] ?? 'pending'

      loadedStates.set(i, {
        status: topicStatus,
        currentStep: t.status === 'complete'
          ? 'Complete'
          : t.status === 'partial'
            ? 'Partial — some phases failed'
            : topicStatus === 'failed'
              ? (t.error ?? 'Failed')
              : '',
        pct: topicStatus === 'complete' ? 1 : 0,
        logs: [],
        startedAt: null,
        lastEventAt: null,
        stageLog: [],
        dataAvailability: (t.data_availability ?? {}) as DataAvailability,
        topicDbId: t.id,
        result: (t.keyword_plan || t.brief || t.draft || t.error) ? {
          keywordPlan: (t.keyword_plan as KeywordPlan | null) ?? null,
          brief: (t.brief as ContentBrief | Record<string, unknown> | null) ?? null,
          draft: t.revised_draft ?? t.draft ?? null,
          draftReview: (t.draft_review as DraftReview | null) ?? null,
          revisedDraft: t.revised_draft ?? null,
          wordCount: t.word_count ?? 0,
          error: t.error ?? null,
          warnings: t.warnings ?? [],
          docxStoragePath: t.docx_storage_path ?? null,
        } : null,
      })
    })

    setTopics(loadedTopics)
    setTopicStates(loadedStates)
    setRunId(id)
    setPreflightResults([])
    setActiveTab(status === 'running' ? 'Progress' : 'Results')
  }, [setTopicStates, setRunId, setPreflightResults])

  // ── Completed topic indices ─────────────────────────────

  const completedTopics = Array.from(topicStates.entries())
    .filter(([, s]) => s.status === 'complete')
    .map(([i]) => i)

  const [downloadError, setDownloadError] = useState<string | null>(null)

  const downloadDocx = useCallback(async (storagePath: string, title: string): Promise<boolean> => {
    const result = await getDocxUrl(storagePath)
    if (result.error || !result.data) {
      setDownloadError(`Download failed for "${title}": ${result.error ?? 'File not found in storage'}`)
      return false
    }
    const a = document.createElement('a')
    a.href = result.data
    a.download = `${title.replace(/[^a-zA-Z0-9-_ ]/g, '')}.docx`
    a.click()
    return true
  }, [])

  const [regenerating, setRegenerating] = useState<Set<number>>(new Set())
  const [zipping, setZipping] = useState(false)
  const [exportingCsv, setExportingCsv] = useState(false)

  const handleRegenerateDocx = useCallback(async (topicIndex: number) => {
    const state = topicStates.get(topicIndex)
    if (!state?.topicDbId) return

    setRegenerating((prev) => new Set(prev).add(topicIndex))
    setDownloadError(null)

    const result = await regenerateDocx(state.topicDbId)

    setRegenerating((prev) => {
      const next = new Set(prev)
      next.delete(topicIndex)
      return next
    })

    if (result.error) {
      setDownloadError(`Regenerate failed for "${topics[topicIndex]?.title}": ${result.error}`)
      return
    }

    // Update state with the new storage path
    setTopicStates((prev) => {
      const next = new Map(prev)
      const existing = next.get(topicIndex)
      if (existing?.result) {
        next.set(topicIndex, {
          ...existing,
          result: { ...existing.result, docxStoragePath: result.data!.storagePath },
        })
      }
      return next
    })

    // Auto-download the newly generated file
    await downloadDocx(result.data!.storagePath, topics[topicIndex]?.title ?? `Topic ${topicIndex + 1}`)
  }, [topicStates, topics, downloadDocx, setTopicStates])

  // ── Render ──────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex items-center gap-1 rounded-lg bg-surface-900 border border-surface-700 p-1">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`
              px-4 py-2 text-sm font-medium rounded-md transition-colors
              ${
                activeTab === tab
                  ? 'bg-surface-800 text-surface-100'
                  : 'text-surface-400 hover:text-surface-300'
              }
            `}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── New Run Tab ─────────────────────────────────── */}
      {activeTab === 'New Run' && (
        <div className="space-y-6">
          {/* Topic input */}
          <div className="rounded-xl border border-surface-700 bg-surface-900 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-surface-100 uppercase tracking-wider">
              Topics
            </h2>
            <TopicForm topics={topics} onTopicsChange={setTopics} />
            <XlsxUploader
              onTopicsParsed={(parsed) => setTopics((prev) => [...prev, ...parsed])}
            />
          </div>

          {/* Mode selector */}
          <div className="rounded-xl border border-surface-700 bg-surface-900 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-surface-100 uppercase tracking-wider">
              Pipeline Mode
            </h2>
            <div className="flex items-center gap-2">
              {MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setMode(opt.value)}
                  className={`
                    px-4 py-2 text-sm font-medium rounded-full border transition-colors
                    ${
                      mode === opt.value
                        ? 'bg-brand-500 border-brand-500 text-white'
                        : 'bg-surface-800 border-surface-700 text-surface-400 hover:text-surface-300 hover:border-surface-600'
                    }
                  `}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Brand context */}
          <div className="rounded-xl border border-surface-700 bg-surface-900 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-surface-100 uppercase tracking-wider">
              Brand Context
            </h2>
            <p className="text-xs text-surface-400">
              {clientBrandContext
                ? `Pre-filled from ${clientName} client settings. Edit to override for this run.`
                : `Optional. Provide brand voice, tone, or style notes for ${clientName}. Save in client settings for reuse.`}
            </p>
            <textarea
              value={brandContext}
              onChange={(e) => setBrandContext(e.target.value)}
              placeholder="e.g. Professional, authoritative tone. Avoid first person. Focus on residential services..."
              rows={4}
              className="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-surface-100 placeholder:text-surface-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-y"
            />
          </div>

          {/* Start / Stop buttons */}
          <div className="flex gap-3">
            <button
              onClick={startRun}
              disabled={isRunning || topics.length === 0}
              className="flex-1 rounded-lg bg-brand-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isRunning
                ? 'Pipeline Running...'
                : topics.length === 0
                  ? 'Add Topics to Start'
                  : `Start Pipeline — ${topics.length} topic${topics.length === 1 ? '' : 's'}`}
            </button>
            {isRunning && (
              <button
                onClick={stopRun}
                className="rounded-lg bg-red-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-700"
              >
                Stop
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Progress Tab ────────────────────────────────── */}
      {activeTab === 'Progress' && (
        <div className="space-y-6">
          {topics.length === 0 && topicStates.size === 0 ? (
            <div className="rounded-xl border border-surface-700 bg-surface-900 p-8 text-center">
              <p className="text-sm text-surface-400">
                No pipeline running. Switch to &quot;New Run&quot; to start.
              </p>
            </div>
          ) : (
            <>
              {/* Preflight results */}
              {preflightResults.length > 0 && (
                <div className="rounded-xl border border-surface-700 bg-surface-900 p-4 space-y-2">
                  <h3 className="text-xs font-semibold text-surface-400 uppercase tracking-wider">
                    Connection Preflight
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {preflightResults.map((r) => (
                      <div
                        key={r.source}
                        className={`rounded-lg border px-3 py-2 text-xs ${
                          r.ok
                            ? 'border-emerald-500/30 bg-emerald-900/10 text-emerald-300'
                            : 'border-red-500/30 bg-red-900/10 text-red-300'
                        }`}
                      >
                        <div className="font-medium">{r.ok ? '\u2713' : '\u2717'} {r.source}</div>
                        <div className="text-[10px] opacity-70 mt-0.5 truncate">{r.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isRunning && (
                <div className="flex justify-end">
                  <button
                    onClick={stopRun}
                    className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
                  >
                    Stop Pipeline
                  </button>
                </div>
              )}
              <PipelineProgress
                topicTitles={topics.map((t) => t.title)}
                topicStates={topicStates}
              />

              {/* Aggregated data availability */}
              {Array.from(topicStates.entries()).some(
                ([, s]) => Object.keys(s.dataAvailability).length > 0
              ) && (
                <div className="rounded-xl border border-surface-700 bg-surface-900 p-5 space-y-3">
                  <h3 className="text-xs font-semibold text-surface-400 uppercase tracking-wider">
                    Data Availability
                  </h3>
                  <DataAvailabilityPanel
                    availability={
                      Array.from(topicStates.values()).reduce<DataAvailability>(
                        (acc, s) => ({ ...acc, ...s.dataAvailability }),
                        {}
                      )
                    }
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Results Tab ─────────────────────────────────── */}
      {activeTab === 'Results' && (
        <div className="space-y-8">
          {completedTopics.length === 0 ? (
            <div className="rounded-xl border border-surface-700 bg-surface-900 p-8 text-center">
              <p className="text-sm text-surface-400">
                No completed topics yet.{' '}
                {isRunning ? 'Pipeline is still running.' : 'Start a run to see results.'}
              </p>
            </div>
          ) : (
            <>
              {/* Download error banner */}
              {downloadError && (
                <div className="flex items-start justify-between gap-3 rounded-lg border border-red-500/30 bg-red-900/20 px-4 py-3">
                  <p className="text-sm text-red-300">{downloadError}</p>
                  <button
                    onClick={() => setDownloadError(null)}
                    className="text-red-400 hover:text-red-300 text-xs font-medium shrink-0"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Download / Regenerate buttons */}
              {completedTopics.length > 0 && (() => {
                const withDocx = completedTopics.filter((idx) => topicStates.get(idx)?.result?.docxStoragePath)
                const missingDocx = completedTopics.filter(
                  (idx) => !topicStates.get(idx)?.result?.docxStoragePath && topicStates.get(idx)?.result?.draft && topicStates.get(idx)?.topicDbId
                )
                return (
                  <div className="flex justify-end gap-2">
                    {missingDocx.length > 0 && (
                      <button
                        onClick={async () => {
                          setDownloadError(null)
                          for (const idx of missingDocx) {
                            await handleRegenerateDocx(idx)
                          }
                        }}
                        disabled={regenerating.size > 0}
                        className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-900/20 px-4 py-2 text-sm font-semibold text-amber-300 transition-colors hover:bg-amber-900/30 disabled:opacity-50"
                      >
                        <RefreshCw className={`h-4 w-4 ${regenerating.size > 0 ? 'animate-spin' : ''}`} />
                        {regenerating.size > 0 ? 'Generating...' : `Generate Missing DOCX (${missingDocx.length})`}
                      </button>
                    )}
                    {withDocx.length > 0 && (
                      <button
                        onClick={async () => {
                          setDownloadError(null)
                          setZipping(true)
                          try {
                            const zip = new JSZip()
                            let fail = 0
                            for (const idx of withDocx) {
                              const path = topicStates.get(idx)?.result?.docxStoragePath
                              const title = topics[idx]?.title ?? `Topic ${idx + 1}`
                              if (!path) { fail++; continue }
                              const urlResult = await getDocxUrl(path)
                              if (urlResult.error || !urlResult.data) { fail++; continue }
                              try {
                                const resp = await fetch(urlResult.data)
                                if (!resp.ok) { fail++; continue }
                                const blob = await resp.blob()
                                const filename = `${title.replace(/[^a-zA-Z0-9-_ ]/g, '')}.docx`
                                zip.file(filename, blob)
                              } catch { fail++ }
                            }
                            const zipBlob = await zip.generateAsync({ type: 'blob' })
                            const url = URL.createObjectURL(zipBlob)
                            const a = document.createElement('a')
                            a.href = url
                            a.download = `seo-content-${runId ?? 'export'}.zip`
                            a.click()
                            URL.revokeObjectURL(url)
                            if (fail > 0) {
                              setDownloadError(`Zipped ${withDocx.length - fail} of ${withDocx.length} files. ${fail} failed.`)
                            }
                          } catch (err) {
                            setDownloadError(`ZIP failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
                          } finally {
                            setZipping(false)
                          }
                        }}
                        disabled={zipping}
                        className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                      >
                        <FileArchive className={`h-4 w-4 ${zipping ? 'animate-pulse' : ''}`} />
                        {zipping ? 'Preparing ZIP...' : `Download ZIP (${withDocx.length})`}
                      </button>
                    )}
                    {runId && completedTopics.length > 0 && (
                      <button
                        onClick={async () => {
                          setDownloadError(null)
                          setExportingCsv(true)
                          try {
                            const result = await exportMatrixifyCsv(runId)
                            if (result.error || !result.data) {
                              setDownloadError(`CSV export failed: ${result.error ?? 'Unknown error'}`)
                              return
                            }
                            const blob = new Blob([result.data], { type: 'text/csv;charset=utf-8;' })
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement('a')
                            a.href = url
                            a.download = 'matrixify-blog-posts.csv'
                            a.click()
                            URL.revokeObjectURL(url)
                          } catch (err) {
                            setDownloadError(`CSV export failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
                          } finally {
                            setExportingCsv(false)
                          }
                        }}
                        disabled={exportingCsv}
                        className="inline-flex items-center gap-2 rounded-lg border border-surface-600 bg-surface-800 px-4 py-2 text-sm font-semibold text-surface-200 transition-colors hover:bg-surface-700 disabled:opacity-50"
                      >
                        <FileSpreadsheet className={`h-4 w-4 ${exportingCsv ? 'animate-pulse' : ''}`} />
                        {exportingCsv ? 'Exporting...' : 'Export Matrixify CSV'}
                      </button>
                    )}
                  </div>
                )
              })()}
              {completedTopics.map((idx) => {
                const state = topicStates.get(idx)!
                const result = state.result
                return (
                  <div
                    key={idx}
                    className="rounded-xl border border-surface-700 bg-surface-900 p-5 space-y-6"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-semibold text-surface-100">
                        {topics[idx]?.title ?? `Topic ${idx + 1}`}
                      </h3>
                      <div className="flex items-center gap-2">
                        {result?.docxStoragePath ? (
                          <button
                            onClick={() => {
                              setDownloadError(null)
                              downloadDocx(result.docxStoragePath!, topics[idx]?.title ?? `Topic ${idx + 1}`)
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-surface-700 bg-surface-800 px-3 py-1.5 text-xs font-medium text-surface-300 transition-colors hover:border-surface-600 hover:text-surface-100"
                          >
                            <Download className="h-3.5 w-3.5" />
                            DOCX
                          </button>
                        ) : result?.draft && state.topicDbId ? (
                          <button
                            onClick={() => handleRegenerateDocx(idx)}
                            disabled={regenerating.has(idx)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-900/20 px-3 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-900/30 disabled:opacity-50"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${regenerating.has(idx) ? 'animate-spin' : ''}`} />
                            {regenerating.has(idx) ? 'Generating...' : 'Generate DOCX'}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {result?.keywordPlan && (
                      <KeywordPlanView plan={result.keywordPlan} />
                    )}

                    {result?.brief && <BriefPreview brief={result.brief} />}

                    {result?.draft && (
                      <DraftPreview
                        draft={result.revisedDraft ?? result.draft}
                        wordCount={result.wordCount}
                      />
                    )}

                  {result?.draftReview && (
                    <ReviewSummary review={result.draftReview} />
                  )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}

      {/* ── History Tab ─────────────────────────────────── */}
      {activeTab === 'History' && (
        <RunHistory
          clientId={clientId}
          onLoadRun={handleLoadRun}
        />
      )}
    </div>
  )
}
