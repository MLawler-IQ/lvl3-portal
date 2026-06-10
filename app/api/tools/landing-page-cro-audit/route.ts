/**
 * Landing Page CRO Audit — NDJSON Streaming API Route
 * Crawls a URL, runs PageSpeed Insights, and asks Claude to score
 * the page across 5 CRO dimensions.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { guardRoute, jsonError } from '@/lib/api/route-guard'
import { analyzePage, analyzePsi } from '@/lib/crawlers/page-analyzer'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 120

export interface CROAuditScore {
  score: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  issues: string[]
  suggestions: string[]
}

export interface CROAudit {
  url: string
  overallScore: number
  sections: {
    formFriction: CROAuditScore
    ctaClarity: CROAuditScore
    valueProp: CROAuditScore
    trustSignals: CROAuditScore
    pageSpeed: CROAuditScore
  }
  topFixes: Array<{ priority: 1 | 2 | 3; fix: string; impact: 'high' | 'medium' | 'low' }>
}

type Event =
  | { type: 'progress'; message: string; pct: number }
  | { type: 'complete'; runId: string; audit: CROAudit }
  | { type: 'error'; message: string }

function defaultAudit(url: string, rawText?: string): CROAudit {
  const issue = rawText ? `Claude returned unparseable JSON: ${rawText.slice(0, 200)}` : 'Analysis unavailable'
  const fallbackSection: CROAuditScore = {
    score: 50,
    grade: 'C',
    issues: [issue],
    suggestions: ['Retry the audit'],
  }
  return {
    url,
    overallScore: 50,
    sections: {
      formFriction: fallbackSection,
      ctaClarity: fallbackSection,
      valueProp: fallbackSection,
      trustSignals: fallbackSection,
      pageSpeed: fallbackSection,
    },
    topFixes: [{ priority: 1, fix: 'Retry the audit — Claude response was not valid JSON', impact: 'high' }],
  }
}

export async function POST(request: Request) {
  // ── Auth (before ReadableStream — cookies need sync context) ──
  const guard = await guardRoute({ roles: ['admin', 'member'] })
  if (!guard.ok) return guard.response
  const { user } = guard

  const body = await request.json().catch(() => ({})) as { url?: string }
  if (!body.url?.startsWith('http')) {
    return jsonError('Invalid URL', 400)
  }

  const { url } = body
  const service = await createServiceClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: Event) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
        } catch {
          // stream already closed
        }
      }

      // Insert tool_runs row
      const { data: runRow } = await service
        .from('tool_runs')
        .insert({
          tool_slug: 'landing-page-cro-audit',
          client_id: null,
          user_id: user.id,
          input: { url },
          status: 'running',
          started_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      const runId: string = runRow?.id ?? ''

      try {
        emit({ type: 'progress', message: 'Crawling page...', pct: 10 })
        const pageAnalysis = await analyzePage(url)

        emit({ type: 'progress', message: 'Fetching performance data...', pct: 35 })
        // Run PSI in parallel with the Claude prep
        const psiPromise = analyzePsi(url)

        emit({ type: 'progress', message: 'Running CRO analysis with Claude...', pct: 60 })
        const psi = await psiPromise

        // Build the prompt
        const lcp = psi.lcp != null ? `${Math.round(psi.lcp / 1000 * 10) / 10}s` : 'N/A'
        const prompt = `You are a conversion rate optimization expert. Analyze this landing page and return a JSON audit.

URL: ${url}
H1: ${pageAnalysis.h1 ?? '(none)'}
Word count: ${pageAnalysis.wordCount}
CTA elements: ${pageAnalysis.ctaCount}
Forms: ${pageAnalysis.formCount} (trust: no form friction analysis needed if 0)
Trust signals detected: ${pageAnalysis.trustSignals.join(', ') || 'none'}
Images without alt: ${pageAnalysis.imagesWithoutAlt}
Has author byline: ${pageAnalysis.hasAuthorByline}
Has FAQ section: ${pageAnalysis.hasFaqSection}
Page Speed score: ${psi.performanceScore ?? 'unavailable'} / 100
LCP: ${lcp}

Return ONLY valid JSON with this exact structure (no markdown fences):
{
  "overallScore": <0-100>,
  "sections": {
    "formFriction": { "score": <0-100>, "grade": "<A|B|C|D|F>", "issues": ["..."], "suggestions": ["..."] },
    "ctaClarity": { "score": <0-100>, "grade": "<A|B|C|D|F>", "issues": ["..."], "suggestions": ["..."] },
    "valueProp": { "score": <0-100>, "grade": "<A|B|C|D|F>", "issues": ["..."], "suggestions": ["..."] },
    "trustSignals": { "score": <0-100>, "grade": "<A|B|C|D|F>", "issues": ["..."], "suggestions": ["..."] },
    "pageSpeed": { "score": <0-100>, "grade": "<A|B|C|D|F>", "issues": ["..."], "suggestions": ["..."] }
  },
  "topFixes": [
    { "priority": 1, "fix": "...", "impact": "high" },
    { "priority": 2, "fix": "...", "impact": "medium" },
    { "priority": 3, "fix": "...", "impact": "medium" }
  ]
}`

        const anthropic = new Anthropic()
        const message = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        })

        const rawText =
          message.content[0]?.type === 'text' ? message.content[0].text.trim() : ''

        let parsedAuditData: Omit<CROAudit, 'url'>
        try {
          parsedAuditData = JSON.parse(rawText) as Omit<CROAudit, 'url'>
        } catch {
          const audit = defaultAudit(url, rawText)
          await service
            .from('tool_runs')
            .update({ status: 'complete', output: { audit }, completed_at: new Date().toISOString() })
            .eq('id', runId)
          emit({ type: 'complete', runId, audit })
          return
        }

        const audit: CROAudit = { url, ...parsedAuditData }

        await service
          .from('tool_runs')
          .update({ status: 'complete', output: { audit }, completed_at: new Date().toISOString() })
          .eq('id', runId)

        emit({ type: 'complete', runId, audit })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed'
        try {
          await service
            .from('tool_runs')
            .update({ status: 'failed', error: message, completed_at: new Date().toISOString() })
            .eq('id', runId)
        } catch {
          // best-effort — ignore DB update failure
        }
        emit({ type: 'error', message })
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
