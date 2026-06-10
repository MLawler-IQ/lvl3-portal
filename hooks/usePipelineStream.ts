'use client'

import { useState, useCallback, useRef } from 'react'
import type {
  TopicInput,
  RunMode,
  PipelineEvent,
  DataAvailability,
  KeywordPlan,
  ContentBrief,
  DraftReview,
} from '@/lib/seo-content-engine/types'

// ── Per-topic progress state ────────────────────────────────

export interface StageLogEntry {
  step: string
  detail: string
  elapsed: number // ms since topic started
}

export interface TopicState {
  status: 'pending' | 'running' | 'complete' | 'failed'
  currentStep: string
  pct: number
  logs: string[]
  startedAt: number | null
  lastEventAt: number | null
  stageLog: StageLogEntry[]
  dataAvailability: DataAvailability
  topicDbId?: string // DB row id — set when loading historical runs
  result: {
    keywordPlan: KeywordPlan | null
    brief: ContentBrief | Record<string, unknown> | null
    draft: string | null
    draftReview: DraftReview | null
    revisedDraft: string | null
    wordCount: number
    error?: string | null
    warnings?: string[]
    docxStoragePath?: string | null
  } | null
}

export function emptyTopicState(): TopicState {
  return {
    status: 'pending',
    currentStep: '',
    pct: 0,
    logs: [],
    startedAt: null,
    lastEventAt: null,
    stageLog: [],
    dataAvailability: {},
    result: null,
  }
}

export interface PreflightResult {
  source: string
  ok: boolean
  detail: string
}

interface UsePipelineStreamOpts {
  clientId: string
  /** Fired when a run kicks off (e.g. switch to the Progress tab). */
  onRunStart?: () => void
  /** Fired on the run_complete event (e.g. switch to the Results tab). */
  onRunComplete?: () => void
}

/**
 * NDJSON stream consumer for the SEO Content Engine pipeline. Owns all
 * run-progress state (per-topic status, preflight results, run id) and the
 * abort lifecycle. Extracted from SeoContentEngineClient — behavior-preserving.
 */
export function usePipelineStream({ clientId, onRunStart, onRunComplete }: UsePipelineStreamOpts) {
  const [isRunning, setIsRunning] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [topicStates, setTopicStates] = useState<Map<number, TopicState>>(new Map())
  const [preflightResults, setPreflightResults] = useState<PreflightResult[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const updateTopicState = useCallback(
    (index: number, updater: (prev: TopicState) => TopicState) => {
      setTopicStates((prev) => {
        const next = new Map(prev)
        const current = next.get(index) ?? emptyTopicState()
        next.set(index, updater(current))
        return next
      })
    },
    []
  )

  const startRun = useCallback(
    async (topics: TopicInput[], mode: RunMode, brandContext: string) => {
      if (isRunning || topics.length === 0) return

      setIsRunning(true)
      setRunId(null)
      setPreflightResults([])

      // Initialise topic states
      const initial = new Map<number, TopicState>()
      topics.forEach((_, i) => initial.set(i, emptyTopicState()))
      setTopicStates(initial)

      onRunStart?.()

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const formData = new FormData()
        formData.append('clientId', clientId)
        formData.append('mode', mode)
        formData.append('brandContext', brandContext)
        formData.append('topics', JSON.stringify(topics))

        const res = await fetch('/api/seo-content-engine', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        })

        if (!res.ok || !res.body) {
          throw new Error(`Pipeline request failed: ${res.status}`)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          // Keep incomplete last line in buffer
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue

            let event: PipelineEvent
            try {
              event = JSON.parse(trimmed) as PipelineEvent
            } catch {
              continue
            }

            // Route event
            switch (event.type) {
              case 'run_started':
                setRunId(event.runId)
                break

              case 'preflight':
                setPreflightResults((prev) => [
                  ...prev,
                  { source: event.source, ok: event.ok, detail: event.detail },
                ])
                break

              case 'topic_started': {
                const now = Date.now()
                updateTopicState(event.topicIndex, (prev) => ({
                  ...prev,
                  status: 'running',
                  currentStep: 'Starting...',
                  startedAt: now,
                  lastEventAt: now,
                  logs: [...prev.logs, `Topic started: ${event.title}`],
                }))
                break
              }

              case 'progress': {
                const now = Date.now()
                updateTopicState(event.topicIndex, (prev) => ({
                  ...prev,
                  currentStep: `${event.phase}: ${event.step}`,
                  pct: event.pct,
                  lastEventAt: now,
                  stageLog: [
                    ...prev.stageLog,
                    {
                      step: event.step,
                      detail: event.detail,
                      elapsed: prev.startedAt ? now - prev.startedAt : 0,
                    },
                  ],
                  logs: [...prev.logs, `[${event.phase}] ${event.step} — ${event.detail}`],
                }))
                break
              }

              case 'data_source':
                updateTopicState(event.topicIndex, (prev) => ({
                  ...prev,
                  dataAvailability: {
                    ...prev.dataAvailability,
                    [event.source]: event.status,
                  },
                }))
                break

              case 'topic_complete':
                updateTopicState(event.topicIndex, (prev) => ({
                  ...prev,
                  status: (event.status === 'complete' || event.status === 'partial') ? 'complete' : 'failed',
                  pct: 100,
                  currentStep: event.status === 'complete' ? 'Complete' : 'Partial — some phases failed',
                  lastEventAt: Date.now(),
                  logs: [
                    ...prev.logs,
                    `Topic ${event.status}${event.wordCount ? ` (${event.wordCount} words)` : ''}`,
                  ],
                  result: {
                    ...(prev.result ?? { keywordPlan: null, brief: null, draft: null, draftReview: null, revisedDraft: null, wordCount: 0 }),
                    wordCount: event.wordCount ?? prev.result?.wordCount ?? 0,
                    error: event.error ?? null,
                    warnings: event.warnings ?? [],
                    docxStoragePath: event.docxStoragePath ?? prev.result?.docxStoragePath ?? null,
                  },
                }))
                break

              case 'topic_error':
                updateTopicState(event.topicIndex, (prev) => ({
                  ...prev,
                  status: 'failed',
                  currentStep: 'Error',
                  lastEventAt: Date.now(),
                  logs: [...prev.logs, `Error: ${event.error}`],
                }))
                break

              case 'heartbeat':
                updateTopicState(event.topicIndex, (prev) => ({
                  ...prev,
                  lastEventAt: Date.now(),
                }))
                break

              case 'run_complete':
                setRunId(event.runId)
                onRunComplete?.()
                break

              case 'error':
                // Global error — log to all topics
                setTopicStates((prev) => {
                  const next = new Map(prev)
                  Array.from(next.entries()).forEach(([idx, state]) => {
                    next.set(idx, {
                      ...state,
                      logs: [...state.logs, `Pipeline error: ${event.message}`],
                    })
                  })
                  return next
                })
                break
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Pipeline stream error:', err)
        }
      } finally {
        setIsRunning(false)
        abortRef.current = null
      }
    },
    [isRunning, clientId, onRunStart, onRunComplete, updateTopicState]
  )

  const stopRun = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setIsRunning(false)
    // Mark any running topics as failed
    setTopicStates((prev) => {
      const next = new Map(prev)
      Array.from(next.entries()).forEach(([idx, state]) => {
        if (state.status === 'running' || state.status === 'pending') {
          next.set(idx, {
            ...state,
            status: 'failed',
            currentStep: 'Stopped by user',
            lastEventAt: Date.now(),
            logs: [...state.logs, 'Stopped by user'],
          })
        }
      })
      return next
    })
  }, [])

  return {
    isRunning,
    runId,
    setRunId,
    topicStates,
    setTopicStates,
    updateTopicState,
    preflightResults,
    setPreflightResults,
    startRun,
    stopRun,
  }
}
