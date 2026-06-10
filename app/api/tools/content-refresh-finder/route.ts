import { createServiceClient } from '@/lib/supabase/server'
import { guardRoute, jsonError } from '@/lib/api/route-guard'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { fetchGSCPageRows } from '@/lib/tools-gsc'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 300

// ── Types ────────────────────────────────────────────────────────────────────

interface RefreshCandidate {
  page: string
  currentImpressions: number
  priorImpressions: number
  impressionChange: number
  currentClicks: number
  priorClicks: number
  clickChange: number
  currentPosition: number
  priorPosition: number
  positionChange: number
  declineScore: number
}

type Event =
  | { type: 'progress'; message: string; pct: number }
  | { type: 'candidates'; candidates: RefreshCandidate[] }
  | { type: 'brief'; page: string; brief: string }
  | { type: 'complete'; runId: string; totalCandidates: number }
  | { type: 'error'; message: string }

// ── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // Auth (before ReadableStream — needs sync context)
  const body = await request.json().catch(() => ({})) as { clientId?: string }
  const { clientId } = body

  if (!clientId) {
    return jsonError('Missing clientId', 400)
  }

  const guard = await guardRoute({ roles: ['admin', 'member'], clientId })
  if (!guard.ok) return guard.response
  const { user } = guard

  const rl = await checkRateLimit(user.id, { maxPerHour: 30, toolSlug: 'content-refresh-finder' })
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSeconds)

  const service = await createServiceClient()

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: Event) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
        } catch {
          /* stream closed */
        }
      }

      try {
        // Fetch client
        const { data: clientRow } = await service
          .from('clients')
          .select('gsc_site_url, brand_context, name')
          .eq('id', clientId)
          .single()

        const gscSiteUrl = (clientRow as Record<string, unknown> | null)?.gsc_site_url as string | null
        if (!gscSiteUrl) {
          emit({ type: 'error', message: 'No Search Console site URL configured for this client.' })
          return
        }

        // Date ranges
        const d = (offset: number) =>
          new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10)

        const currentStart = d(91)
        const currentEnd   = d(1)
        const priorStart   = d(181)
        const priorEnd     = d(92)

        emit({ type: 'progress', message: 'Fetching current period GSC data (last 90 days)…', pct: 5 })

        // Fetch both periods in parallel
        const [currentRows, priorRows] = await Promise.all([
          fetchGSCPageRows(gscSiteUrl, currentStart, currentEnd),
          fetchGSCPageRows(gscSiteUrl, priorStart, priorEnd),
        ])

        emit({ type: 'progress', message: `Got ${currentRows.length} pages (current) and ${priorRows.length} pages (prior). Analysing…`, pct: 20 })

        // Build maps
        type PageMetrics = { clicks: number; impressions: number; position: number }
        const currentMap = new Map<string, PageMetrics>()
        const priorMap   = new Map<string, PageMetrics>()

        for (const r of currentRows) currentMap.set(r.page, r)
        for (const r of priorRows)   priorMap.set(r.page, r)

        // Union of all pages
        const allPages = Array.from(new Set([
          ...Array.from(currentMap.keys()),
          ...Array.from(priorMap.keys()),
        ]))

        const zero: PageMetrics = { clicks: 0, impressions: 0, position: 0 }

        const candidates: RefreshCandidate[] = []

        for (const page of allPages) {
          const cur  = currentMap.get(page) ?? zero
          const prev = priorMap.get(page)   ?? zero

          // Filter: at least 100 impressions in either period
          if (cur.impressions < 100 && prev.impressions < 100) continue

          // Calculate changes
          const impressionChange = prev.impressions > 0
            ? (cur.impressions - prev.impressions) / prev.impressions
            : 0

          const clickChange = prev.clicks > 0
            ? (cur.clicks - prev.clicks) / prev.clicks
            : 0

          // Position: higher number = worse rank; positive positionChange = decline
          const positionChange = prev.position > 0
            ? cur.position - prev.position
            : 0

          // Filter: >10% impression decline OR dropped 3+ rank spots
          if (impressionChange > -0.1 && positionChange < 3) continue

          const declineScore = cur.impressions * Math.abs(impressionChange)

          candidates.push({
            page,
            currentImpressions: cur.impressions,
            priorImpressions:   prev.impressions,
            impressionChange,
            currentClicks:   cur.clicks,
            priorClicks:     prev.clicks,
            clickChange,
            currentPosition: cur.position,
            priorPosition:   prev.position,
            positionChange,
            declineScore,
          })
        }

        // Sort and cap at 20
        candidates.sort((a, b) => b.declineScore - a.declineScore)
        const topCandidates = candidates.slice(0, 20)

        // Create tool_runs row
        const { data: runRow } = await service
          .from('tool_runs')
          .insert({
            tool_slug: 'content-refresh-finder',
            client_id: clientId,
            user_id:   user.id,
            input:     { clientId },
            status:    'running',
          })
          .select('id')
          .single()

        const runId: string = (runRow as Record<string, unknown> | null)?.id as string ?? ''

        emit({ type: 'candidates', candidates: topCandidates })
        emit({ type: 'progress', message: `Found ${topCandidates.length} declining pages. Generating briefs…`, pct: 40 })

        // Generate briefs for top 10 in parallel batches of 3
        const top10 = topCandidates.slice(0, 10)
        const BATCH_SIZE = 3
        const briefs: Record<string, string> = {}

        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

        for (let i = 0; i < top10.length; i += BATCH_SIZE) {
          const batch = top10.slice(i, i + BATCH_SIZE)

          await Promise.all(batch.map(async (candidate) => {
            const impressionChangePct = Math.round(candidate.impressionChange * 100)
            const positionChangeRounded = Math.round(candidate.positionChange * 10) / 10

            const prompt = `You are an SEO strategist. Write a 200-word refresh brief for a page that has declined in search performance.

Page URL: ${candidate.page}
Current impressions (last 90d): ${candidate.currentImpressions}
Prior impressions (prior 90d): ${candidate.priorImpressions}
Impression change: ${impressionChangePct}%
Position change: ${positionChangeRounded} spots

Brief should cover: likely cause of decline, recommended structural updates, content freshness signals to add, title/meta recommendations. Be specific and actionable. No fluff.`

            try {
              const message = await anthropic.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 600,
                messages: [{ role: 'user', content: prompt }],
              })

              const briefText = message.content
                .filter(b => b.type === 'text')
                .map(b => (b as { type: 'text'; text: string }).text)
                .join('')

              briefs[candidate.page] = briefText
              emit({ type: 'brief', page: candidate.page, brief: briefText })
            } catch {
              // Skip failed brief — don't block the rest
            }
          }))
        }

        emit({ type: 'progress', message: 'Saving results…', pct: 95 })

        // Update tool_runs row
        await service
          .from('tool_runs')
          .update({
            status:       'complete',
            output:       { candidates: topCandidates, briefs },
            completed_at: new Date().toISOString(),
          })
          .eq('id', runId)

        emit({ type: 'complete', runId, totalCandidates: topCandidates.length })
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
    },
  })
}
