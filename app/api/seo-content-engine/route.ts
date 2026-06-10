/**
 * SEO Content Engine — NDJSON Streaming API Route
 * Runs the full keyword + content pipeline with real-time progress events.
 * Topics execute in parallel with a configurable concurrency limit.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { userCanAccessClient } from '@/lib/auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { SeoAnthropicClient } from '@/lib/seo-content-engine/anthropic-client'
import { DataSources } from '@/lib/seo-content-engine/data-sources'
import { KeywordEngine } from '@/lib/seo-content-engine/keyword-engine'
import { ContentEngine } from '@/lib/seo-content-engine/content-engine'
import { generateDocx } from '@/lib/seo-content-engine/docx-writer'
import { slugify } from '@/lib/seo-content-engine/utils'
import { PARALLEL_TOPIC_LIMIT, MODES } from '@/lib/seo-content-engine/config'
import type {
  TopicInput,
  RunMode,
  PipelineEvent,
  DataAvailability,
} from '@/lib/seo-content-engine/types'

export const maxDuration = 800

export async function POST(request: Request) {
  // ── Auth (before ReadableStream — cookies need sync context) ──
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  // Check role
  const { data: profile } = await supabase
    .from('users')
    .select('role, client_id')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'member'].includes(profile.role)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
  }

  const service = await createServiceClient()

  // ── Parse request ────────────────────────────────────────────
  const formData = await request.formData()
  const clientId = formData.get('clientId') as string
  const mode = (formData.get('mode') as RunMode) ?? 'full'
  const brandContext = (formData.get('brandContext') as string) ?? ''
  const topicsJson = formData.get('topics') as string

  if (!clientId || !topicsJson) {
    return new Response(JSON.stringify({ error: 'Missing clientId or topics' }), { status: 400 })
  }

  // Enforce client scope: members may only run against assigned clients
  if (!(await userCanAccessClient(
    { id: user.id, role: profile.role as 'admin' | 'member' | 'client', client_id: profile.client_id as string | null },
    clientId,
  ))) {
    return new Response(JSON.stringify({ error: 'Forbidden: no access to this client' }), { status: 403 })
  }

  const rl = await checkRateLimit(user.id, { maxPerHour: 10, toolSlug: 'seo-content-engine' })
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSeconds)

  let topics: TopicInput[]
  try {
    topics = JSON.parse(topicsJson) as TopicInput[]
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid topics JSON' }), { status: 400 })
  }

  if (!topics.length) {
    return new Response(JSON.stringify({ error: 'No topics provided' }), { status: 400 })
  }

  // Fetch client GSC site URL + brand context
  const { data: client } = await service
    .from('clients')
    .select('gsc_site_url, brand_context')
    .eq('id', clientId)
    .single()

  const gscSiteUrl = client?.gsc_site_url ?? null
  const clientBrandContext = (client?.brand_context as string | null) ?? null

  // Apply brand context: user input overrides client settings
  const finalBrandContext = brandContext || clientBrandContext || ''
  if (finalBrandContext) {
    for (const t of topics) {
      if (!t.brand_context) t.brand_context = finalBrandContext
    }
  }

  // Get API keys from environment
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? ''
  const keApiKey = process.env.KEYWORDS_EVERYWHERE_API_KEY ?? ''
  const semrushApiKey = process.env.SEMRUSH_API_KEY ?? ''

  // ── Stream ───────────────────────────────────────────────────
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: PipelineEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
        } catch {
          // Stream may be closed
        }
      }

      try {
        // Create run record
        const { data: run, error: runErr } = await service
          .from('seo_content_engine_runs')
          .insert({
            client_id: clientId,
            mode,
            status: 'running',
            brand_context: finalBrandContext || null,
            topic_count: topics.length,
          })
          .select('id')
          .single()

        if (runErr || !run) {
          emit({ type: 'error', message: `Failed to create run: ${runErr?.message}` })
          controller.close()
          return
        }

        const runId = run.id
        emit({ type: 'run_started', runId, topicCount: topics.length })

        // ── Preflight: verify all connections before processing ──
        const preflightResults = await Promise.allSettled([
          // Anthropic — tiny completion
          (async () => {
            const client = new SeoAnthropicClient(anthropicApiKey)
            await client.call('keyword_gen', 'Reply with OK.', 'ping')
            return 'Connected'
          })(),
          // Keywords Everywhere — volume lookup for 1 test keyword
          (async () => {
            if (!keApiKey) throw new Error('API key not configured')
            const { fetchKEKeywordData } = await import('@/lib/connectors/keywords-everywhere')
            const rows = await fetchKEKeywordData(['seo'], keApiKey)
            return `Connected (${rows.length} result${rows.length !== 1 ? 's' : ''})`
          })(),
          // Semrush
          (async () => {
            if (!semrushApiKey) throw new Error('API key not configured')
            const { fetchSemrushDomainOrganic } = await import('@/lib/connectors/semrush-portal')
            const rows = await fetchSemrushDomainOrganic('example.com', semrushApiKey)
            return `Connected (${rows.length} keywords)`
          })(),
          // GSC
          (async () => {
            if (!gscSiteUrl) throw new Error('No GSC site URL configured for this client')
            const { fetchGSCRows } = await import('@/lib/tools-gsc')
            const rows = await fetchGSCRows(gscSiteUrl, 7)
            return `Connected (${rows.length} queries)`
          })(),
        ])

        const preflightNames = ['Anthropic', 'Keywords Everywhere', 'Semrush', 'GSC']
        let anthropicOk = false

        for (let i = 0; i < preflightResults.length; i++) {
          const r = preflightResults[i]
          const ok = r.status === 'fulfilled'
          const detail = ok
            ? (r as PromiseFulfilledResult<string>).value
            : (r as PromiseRejectedResult).reason?.message ?? 'Unknown error'
          emit({ type: 'preflight', source: preflightNames[i], ok, detail })
          if (i === 0) anthropicOk = ok
        }

        // Anthropic is required — abort if it fails
        if (!anthropicOk) {
          const reason = preflightResults[0].status === 'rejected'
            ? (preflightResults[0] as PromiseRejectedResult).reason?.message ?? 'Unknown error'
            : 'Unknown error'
          emit({ type: 'error', message: `Anthropic connection failed: ${reason}. Aborting run.` })
          await service
            .from('seo_content_engine_runs')
            .update({ status: 'failed', error: `Preflight failed: Anthropic — ${reason}`, updated_at: new Date().toISOString() })
            .eq('id', runId)
          controller.close()
          return
        }

        // Insert topic rows
        const topicRows = topics.map((t) => ({
          run_id: runId,
          title: t.title,
          target_audience: t.target_audience ?? null,
          angle: t.angle ?? null,
          existing_url: t.existing_url ?? null,
          pillar: t.pillar ?? null,
          funnel_stage: t.funnel_stage ?? null,
          primary_intent: t.primary_intent ?? null,
          summary: t.summary ?? null,
          differentiation_angle: t.differentiation_angle ?? null,
          internal_linking: t.internal_linking ?? null,
          geo_notes: t.geo_notes ?? null,
          seed_keywords: t.seed_keywords ?? [],
          status: 'pending',
        }))

        const { data: insertedTopics } = await service
          .from('seo_content_engine_topics')
          .insert(topicRows)
          .select('id')

        const topicIds = insertedTopics?.map((t) => t.id) ?? []

        let completedCount = 0

        // ── Cache: find completed topics from previous runs ────
        const titleList = topics.map((t) => t.title)

        // Get run IDs for this client (excluding current run)
        const { data: clientRuns } = await service
          .from('seo_content_engine_runs')
          .select('id')
          .eq('client_id', clientId)
          .neq('id', runId)

        const clientRunIds = clientRuns?.map((r) => r.id) ?? []

        type CachedTopic = {
          title: string
          keyword_plan: Record<string, unknown> | null
          brief: Record<string, unknown> | null
          draft: string | null
          draft_review: Record<string, unknown> | null
          revised_draft: string | null
          word_count: number | null
          data_availability: Record<string, unknown>
          docx_storage_path: string | null
          warnings: string[]
        }

        let cachedRows: CachedTopic[] = []
        if (clientRunIds.length > 0) {
          const { data } = await service
            .from('seo_content_engine_topics')
            .select('title, keyword_plan, brief, draft, draft_review, revised_draft, word_count, data_availability, docx_storage_path, warnings')
            .in('title', titleList)
            .eq('status', 'complete')
            .in('run_id', clientRunIds)

          cachedRows = (data ?? []) as CachedTopic[]
        }

        // Build a map of title → most recent cached result
        const cacheMap = new Map<string, CachedTopic>()
        for (const row of cachedRows ?? []) {
          cacheMap.set(row.title, row) // later rows overwrite earlier (ordered by default)
        }

        // Apply cache: copy results for matched topics, mark complete, emit immediately
        const skipIndices = new Set<number>()
        for (let i = 0; i < topics.length; i++) {
          const cached = cacheMap.get(topics[i].title)
          if (!cached) continue

          // Check cache has data relevant to this mode
          const hasKeywords = cached.keyword_plan != null
          const hasBrief = cached.brief != null
          const hasDraft = cached.draft != null
          if (mode === 'full' && (!hasKeywords || !hasDraft)) continue
          if (mode === 'brief' && (!hasKeywords || !hasBrief)) continue
          if (mode === 'keywords_only' && !hasKeywords) continue

          skipIndices.add(i)

          // Copy cached data to new topic row
          if (topicIds[i]) {
            await service
              .from('seo_content_engine_topics')
              .update({
                status: 'complete',
                keyword_plan: cached.keyword_plan,
                brief: cached.brief,
                draft: cached.draft,
                draft_review: cached.draft_review,
                revised_draft: cached.revised_draft,
                word_count: cached.word_count,
                data_availability: cached.data_availability,
                docx_storage_path: cached.docx_storage_path,
                warnings: cached.warnings,
                updated_at: new Date().toISOString(),
              })
              .eq('id', topicIds[i])
          }

          completedCount++
          emit({ type: 'topic_started', topicIndex: i, title: topics[i].title })
          emit({
            type: 'progress',
            topicIndex: i,
            phase: 'content',
            step: 'Cached',
            detail: 'Using results from a previous successful run',
            pct: 1,
          })
          emit({
            type: 'topic_complete',
            topicIndex: i,
            status: 'complete',
            wordCount: cached.word_count ?? 0,
          })
        }

        // Log cache hits (no stream event needed — individual topics already emitted)

        // ── Parallel execution with semaphore ──────────────────
        const semaphore = {
          count: 0,
          max: PARALLEL_TOPIC_LIMIT,
          waiters: [] as (() => void)[],
          async acquire() {
            while (this.count >= this.max) {
              await new Promise<void>((resolve) => this.waiters.push(resolve))
            }
            this.count++
          },
          release() {
            this.count--
            const next = this.waiters.shift()
            if (next) next()
          },
        }

        const processTopic = async (topic: TopicInput, index: number) => {
          if (skipIndices.has(index)) return // Already handled from cache
          await semaphore.acquire()
          try {
            emit({ type: 'topic_started', topicIndex: index, title: topic.title })

            // Update DB status
            if (topicIds[index]) {
              await service
                .from('seo_content_engine_topics')
                .update({ status: 'running' })
                .eq('id', topicIds[index])
            }

            const dataAvailability: DataAvailability = {}

            // Create per-topic instances
            const llm = new SeoAnthropicClient(anthropicApiKey)
            const dataSources = new DataSources({
              keApiKey,
              semrushApiKey,
              gscSiteUrl,
              onDataSource: (source, status) => {
                dataAvailability[source] = status
                emit({ type: 'data_source', topicIndex: index, source, status })
              },
            })

            const onProgress = (phase: 'keywords' | 'content', step: string, detail: string, pct: number) => {
              emit({ type: 'progress', topicIndex: index, phase, step, detail, pct })
            }

            const onHeartbeat = (stage: string) => {
              emit({ type: 'heartbeat', topicIndex: index, stage })
            }

            const keywordEngine = new KeywordEngine(llm, dataSources, onProgress, onHeartbeat)
            const contentEngine = new ContentEngine(llm, dataSources, onProgress, onHeartbeat)

            // Run keyword pipeline
            const keywordPlan = await keywordEngine.run(topic)

            // Run content pipeline
            const contentResult = await contentEngine.run(topic, keywordPlan, mode)

            // Track Anthropic usage
            dataAvailability.anthropic = {
              status: 'success',
              stages_completed: llm.stagesCompleted,
              total_tokens: llm.totalTokens.input + llm.totalTokens.output,
            }

            // Generate DOCX and upload
            let docxPath: string | null = null
            const finalDraft = contentResult.revisedDraft ?? contentResult.draft
            try {
              const docxBuffer = await generateDocx({
                topic,
                keywordPlan,
                brief: contentResult.brief,
                draft: finalDraft,
                draftReview: contentResult.draftReview,
                wordCount: contentResult.wordCount,
                mode: MODES[mode] ?? mode,
              })

              const slug = slugify(topic.title)
              const storagePath = `${clientId}/seo-content/${runId}/${slug}.docx`

              await service.storage
                .from('client-assets')
                .upload(storagePath, docxBuffer, {
                  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  upsert: true,
                })

              docxPath = storagePath
            } catch (err) {
              console.error('DOCX generation/upload failed:', err)
            }

            // Update topic record
            const topicStatus = contentResult.error ? 'partial' : 'complete'
            if (topicIds[index]) {
              await service
                .from('seo_content_engine_topics')
                .update({
                  status: topicStatus,
                  keyword_plan: keywordPlan,
                  brief: contentResult.brief,
                  draft: finalDraft,
                  draft_review: contentResult.draftReview,
                  revised_draft: contentResult.revisedDraft,
                  warnings: contentResult.warnings,
                  word_count: contentResult.wordCount,
                  error: contentResult.error,
                  data_availability: dataAvailability,
                  docx_storage_path: docxPath,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', topicIds[index])
            }

            completedCount++
            emit({
              type: 'topic_complete',
              topicIndex: index,
              status: topicStatus as 'complete' | 'partial',
              wordCount: contentResult.wordCount,
              error: contentResult.error ?? null,
              warnings: contentResult.warnings,
              docxStoragePath: docxPath,
            })
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            console.error(`Topic ${index} failed:`, msg)

            if (topicIds[index]) {
              await service
                .from('seo_content_engine_topics')
                .update({ status: 'failed', error: msg, updated_at: new Date().toISOString() })
                .eq('id', topicIds[index])
            }

            emit({ type: 'topic_error', topicIndex: index, error: msg })
          } finally {
            semaphore.release()
          }
        }

        // Launch all topics — semaphore limits concurrency
        await Promise.allSettled(topics.map((topic, i) => processTopic(topic, i)))

        // Update run record
        const runStatus = completedCount === topics.length ? 'complete' : completedCount > 0 ? 'partial' : 'failed'
        await service
          .from('seo_content_engine_runs')
          .update({
            status: runStatus,
            completed_count: completedCount,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', runId)

        emit({
          type: 'run_complete',
          runId,
          completedCount,
          totalCount: topics.length,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        emit({ type: 'error', message: msg })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
