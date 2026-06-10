import { NextRequest } from 'next/server'
import { z } from 'zod'
import { guardRoute, jsonError } from '@/lib/api/route-guard'
import { parsePromptRows, type ParsedPromptRow } from '@/lib/parse-csv'
import OpenAI from 'openai'
import sharp from 'sharp'

export const maxDuration = 300

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured')
  return new OpenAI({ apiKey })
}

const requestSchema = z.object({
  styleRules: z.string().max(5000),
  rows: z
    .array(z.object({ filename: z.string().min(1), prompt: z.string().min(1) }))
    .min(1, 'No valid rows found in file')
    .max(200, 'Too many rows (max 200 per run)'),
})

const PER_IMAGE_TIMEOUT_MS = 90_000

async function generateAndCrop(prompt: string): Promise<Buffer> {
  const openai = getOpenAI()
  const resp = await Promise.race([
    openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      size: '1536x1024',
      n: 1,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('OpenAI image generation timed out (90s)')), PER_IMAGE_TIMEOUT_MS)
    ),
  ])

  const b64 = resp.data?.[0]?.b64_json
  if (!b64) throw new Error('No image data returned from OpenAI')

  const rawBuffer = Buffer.from(b64, 'base64')

  const webpBuffer = await sharp(rawBuffer)
    .resize({
      width: 1500,
      height: 1000,
      fit: 'cover',
      position: 'centre',
    })
    .webp({ quality: 82, effort: 4 })
    .toBuffer()

  return webpBuffer
}

export async function POST(req: NextRequest) {
  const guard = await guardRoute({ roles: ['admin'] })
  if (!guard.ok) return guard.response

  let rows: ParsedPromptRow[]
  let styleRules: string

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return jsonError('No file uploaded', 400)
    }

    const text = await file.text()
    const parsed = requestSchema.safeParse({
      styleRules: (formData.get('styleRules') as string | null) ?? '',
      rows: parsePromptRows(text),
    })
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? 'Invalid request', 400)
    }
    rows = parsed.data.rows
    styleRules = parsed.data.styleRules
  } catch {
    return jsonError('Failed to parse request', 400)
  }

  const encoder = new TextEncoder()

  function emit(controller: ReadableStreamDefaultController, obj: object) {
    controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
  }

  const stream = new ReadableStream({
    async start(controller) {
      const total = rows.length
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null

      try {
        heartbeatTimer = setInterval(() => {
          try {
            emit(controller, { type: 'heartbeat' })
          } catch { /* controller may be closed */ }
        }, 15_000)

        for (let i = 0; i < total; i++) {
          const { filename, prompt } = rows[i]
          const fullFilename = `${filename}.webp`

          emit(controller, { type: 'progress', index: i, total, filename: fullFilename })

          try {
            const fullPrompt = styleRules
              ? `${prompt}\n\n${styleRules}`
              : prompt

            const webpBuffer = await generateAndCrop(fullPrompt)
            const b64 = webpBuffer.toString('base64')

            emit(controller, { type: 'image', filename: fullFilename, data: b64 })
          } catch (err) {
            emit(controller, {
              type: 'image_error',
              filename: fullFilename,
              message: err instanceof Error ? err.message : 'Generation failed',
            })
          }
        }

        emit(controller, { type: 'done', total })
      } catch (err) {
        try {
          emit(controller, {
            type: 'error',
            message: err instanceof Error ? err.message : 'Stream failed unexpectedly',
          })
        } catch { /* controller may already be closed */ }
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
