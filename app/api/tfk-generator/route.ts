import { NextRequest } from 'next/server'
import { guardRoute } from '@/lib/api/route-guard'
import { parse } from '@/lib/tfk/parser'
import { enrichOne } from '@/lib/tfk/enricher'
import { generateContent, COPY_KEYS } from '@/lib/tfk/generator'
import { validate } from '@/lib/tfk/validator'
import { buildSchema } from '@/lib/tfk/schema'
import { buildXlsxBuffer } from '@/lib/tfk/writer'
import type { TfkLocation } from '@/lib/tfk/types'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const guard = await guardRoute({ roles: ['admin'] })
  if (!guard.ok) return guard.response

  const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? ''

  let locations: TfkLocation[]
  let skippedCount: number

  try {
    const formData = await req.formData()
    const storeDnaFile = formData.get('storeDnaFile') as File | null
    if (!storeDnaFile) {
      return new Response(JSON.stringify({ error: 'No storeDnaFile uploaded' }), { status: 400 })
    }

    const buffer = Buffer.from(await storeDnaFile.arrayBuffer())
    const result = parse(buffer)
    locations = result.locations
    skippedCount = result.skippedCount

    if (locations.length === 0) {
      return new Response(JSON.stringify({ error: 'No active locations found in file' }), { status: 400 })
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to parse request' }),
      { status: 400 }
    )
  }

  const encoder = new TextEncoder()

  function emit(controller: ReadableStreamDefaultController, obj: object) {
    controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
  }

  const CONCURRENCY = 5

  const stream = new ReadableStream({
    async start(controller) {
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null

      const enrichWarnings: string[] = []
      const generationFailures: string[] = []
      const hoursWarnings: string[] = []
      const validationIssues: string[] = []

      async function processOne(i: number) {
        const loc = locations[i]
        const label = `${loc.store_name} (${loc.city}, ${loc.state})`

        // Step 1: Enrich via Google Places
        emit(controller, {
          type: 'progress',
          store: loc.store_name,
          city: loc.city,
          state: loc.state,
          step: 'enriching',
          index: i,
        })

        try {
          const enrichResult = await enrichOne(loc, GOOGLE_PLACES_API_KEY)
          if (enrichResult.warning) enrichWarnings.push(label)
        } catch {
          enrichWarnings.push(label)
        }

        // Step 2: Generate content
        emit(controller, {
          type: 'progress',
          store: loc.store_name,
          city: loc.city,
          state: loc.state,
          step: 'generating',
          index: i,
        })

        let generatedContent: Record<string, string> = {}
        try {
          generatedContent = await generateContent(loc)
        } catch {
          generationFailures.push(label)
          generatedContent = Object.fromEntries(COPY_KEYS.map(k => [k, '[CONTENT NEEDED]']))
        }

        // Apply generated copy keys
        for (const key of COPY_KEYS) {
          if (generatedContent[key] !== undefined) {
            (loc as unknown as Record<string, unknown>)[key] = generatedContent[key]
          }
        }

        // Step 3: Validate
        const validation = validate(loc, generatedContent)
        loc.validation_notes = validation.summary

        if (!validation.valid) {
          validationIssues.push(label)
        }

        // Step 4: Build schema
        loc.schema_json = buildSchema(loc)

        // Step 5: Track hours mismatch
        if (loc.hours_match === '⚠ Mismatch') {
          hoursWarnings.push(label)
        }

        emit(controller, {
          type: 'location_done',
          store: loc.store_name,
          city: loc.city,
          state: loc.state,
          validation: validation.summary,
          hours_match: loc.hours_match,
          index: i,
        })
      }

      try {
        heartbeatTimer = setInterval(() => {
          try { emit(controller, { type: 'heartbeat' }) } catch { /* closed */ }
        }, 15_000)

        emit(controller, { type: 'start', total: locations.length, skipped: skippedCount })

        // Process in parallel batches of CONCURRENCY
        for (let batchStart = 0; batchStart < locations.length; batchStart += CONCURRENCY) {
          const batchEnd = Math.min(batchStart + CONCURRENCY, locations.length)
          const batch = []
          for (let i = batchStart; i < batchEnd; i++) {
            batch.push(processOne(i))
          }
          await Promise.all(batch)
        }

        // Build output xlsx
        const xlsxBuffer = buildXlsxBuffer(locations)
        const xlsxBase64 = xlsxBuffer.toString('base64')

        emit(controller, { type: 'output', xlsxBase64 })

        emit(controller, {
          type: 'summary',
          enrichWarnings,
          generationFailures,
          hoursWarnings,
          validationIssues,
          total: locations.length,
        })
      } catch (err) {
        try {
          emit(controller, {
            type: 'error',
            message: err instanceof Error ? err.message : 'Stream failed unexpectedly',
          })
        } catch { /* closed */ }
      } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer)
        try { controller.close() } catch { /* already closed */ }
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
