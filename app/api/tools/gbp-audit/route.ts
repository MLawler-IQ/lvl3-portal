import { createServiceClient } from '@/lib/supabase/server'
import { guardRoute, jsonError } from '@/lib/api/route-guard'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { getAdminGBPOAuthClient } from '@/lib/gbp-auth'
import { listGBPLocations, auditLocation } from '@/lib/connectors/gbp'

export const maxDuration = 120

// ── Types ─────────────────────────────────────────────────────────────────────

type Event =
  | { type: 'progress'; message: string; pct: number }
  | { type: 'location'; location: ReturnType<typeof auditLocation> }
  | { type: 'complete'; runId: string; totalLocations: number; avgScore: number }
  | { type: 'error'; message: string }

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { clientId, accountName } = body as { clientId?: string; accountName?: string }

  if (!accountName) {
    return jsonError('accountName is required', 400)
  }

  const guard = await guardRoute({ roles: ['admin', 'member'], clientId })
  if (!guard.ok) return guard.response
  const { user } = guard

  const rl = await checkRateLimit(user.id, { maxPerHour: 30, toolSlug: 'gbp-audit' })
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSeconds)

  const service = await createServiceClient()

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: Event) => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'))
      }

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'heartbeat' }) + '\n'))
      }, 15000)

      let runId: string | null = null

      try {
        // Create run record
        const { data: run } = await service.from('tool_runs').insert({
          tool_slug: 'gbp-audit',
          client_id: clientId ?? null,
          user_id: user.id,
          input: { accountName },
          status: 'running',
          started_at: new Date().toISOString(),
        }).select('id').single()
        runId = run?.id ?? null

        emit({ type: 'progress', message: 'Connecting to Google Business Profile…', pct: 5 })

        const auth = await getAdminGBPOAuthClient()

        emit({ type: 'progress', message: 'Fetching locations…', pct: 15 })

        const locations = await listGBPLocations(accountName, auth)

        if (locations.length === 0) {
          emit({ type: 'error', message: 'No locations found in this account.' })
          if (runId) {
            await service.from('tool_runs').update({
              status: 'complete',
              output: { locations: [], totalLocations: 0, avgScore: 0 },
              completed_at: new Date().toISOString(),
            }).eq('id', runId)
          }
          clearInterval(heartbeat)
          controller.close()
          return
        }

        emit({ type: 'progress', message: `Auditing ${locations.length} location${locations.length === 1 ? '' : 's'}…`, pct: 25 })

        const audited: ReturnType<typeof auditLocation>[] = []
        for (let i = 0; i < locations.length; i++) {
          const loc = locations[i]
          const result = auditLocation(loc)
          audited.push(result)
          emit({ type: 'location', location: result })
          emit({
            type: 'progress',
            message: `Audited ${i + 1} of ${locations.length}: ${loc.title}`,
            pct: Math.round(25 + ((i + 1) / locations.length) * 70),
          })
        }

        const avgScore = audited.length > 0
          ? Math.round(audited.reduce((s, l) => s + l.score, 0) / audited.length)
          : 0

        // Persist result
        if (runId) {
          await service.from('tool_runs').update({
            status: 'complete',
            output: {
              locations: audited,
              totalLocations: audited.length,
              avgScore,
            },
            completed_at: new Date().toISOString(),
          }).eq('id', runId)
        }

        emit({ type: 'complete', runId: runId ?? '', totalLocations: audited.length, avgScore })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'GBP audit failed'
        emit({ type: 'error', message })
        if (runId) {
          await service.from('tool_runs').update({
            status: 'failed',
            error: message,
            completed_at: new Date().toISOString(),
          }).eq('id', runId)
        }
      } finally {
        clearInterval(heartbeat)
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
