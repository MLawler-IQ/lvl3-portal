import { createClient, createServiceClient } from '@/lib/supabase/server'
import { userCanAccessClient } from '@/lib/auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { crawlTargets } from '@/lib/crawlers/index'
import type { CrawlResult } from '@/lib/crawlers/index'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 600

// ── Types ────────────────────────────────────────────────────────────────────

export interface CompetitorProfile {
  domain: string
  pagesAnalyzed: number
  avgWordCount: number
  schemaTypes: string[]
  hasAuthorBylines: boolean
  hasFaqSections: boolean
  hasHowToContent: boolean
  trustSignals: string[]
  avgCtaCount: number
  avgFormCount: number
}

export interface BenchmarkReport {
  vertical: string
  competitors: CompetitorProfile[]
  tableStakes: string[]
  differentiators: string[]
  citationFrequency: Record<string, number>
  clientGaps: string[]
  generatedAt: string
}

type BenchmarkEvent =
  | { type: 'progress'; message: string; pct: number }
  | { type: 'competitors_discovered'; competitors: string[] }
  | { type: 'page_crawled'; domain: string; url: string; pct: number }
  | { type: 'citation_result'; question: string; citedDomains: string[] }
  | { type: 'complete'; runId: string; report: BenchmarkReport }
  | { type: 'error'; message: string }

// ── Helpers ──────────────────────────────────────────────────────────────────

function getTopPages(domain: string): string[] {
  return [
    `https://${domain}/`,
    `https://${domain}/services/`,
    `https://${domain}/about/`,
  ]
}

function buildCompetitorProfile(domain: string, results: CrawlResult[]): CompetitorProfile {
  const pages = results.filter(r => r.url.includes(domain) && !r.page.error)
  if (pages.length === 0) {
    return {
      domain,
      pagesAnalyzed: 0,
      avgWordCount: 0,
      schemaTypes: [],
      hasAuthorBylines: false,
      hasFaqSections: false,
      hasHowToContent: false,
      trustSignals: [],
      avgCtaCount: 0,
      avgFormCount: 0,
    }
  }

  const totalWordCount = pages.reduce((sum, r) => sum + r.page.wordCount, 0)
  const allSchemaTypes = Array.from(
    new Set(pages.flatMap(r => r.page.schemaTypes))
  )
  const allTrustSignals = Array.from(
    new Set(pages.flatMap(r => r.page.trustSignals))
  )
  const totalCtaCount = pages.reduce((sum, r) => sum + r.page.ctaCount, 0)
  const totalFormCount = pages.reduce((sum, r) => sum + r.page.formCount, 0)

  return {
    domain,
    pagesAnalyzed: pages.length,
    avgWordCount: Math.round(totalWordCount / pages.length),
    schemaTypes: allSchemaTypes,
    hasAuthorBylines: pages.some(r => r.page.hasAuthorByline),
    hasFaqSections: pages.some(r => r.page.hasFaqSection),
    hasHowToContent: pages.some(r => r.page.hasHowToContent),
    trustSignals: allTrustSignals,
    avgCtaCount: Math.round(totalCtaCount / pages.length),
    avgFormCount: Math.round(totalFormCount / pages.length),
  }
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // Auth (before ReadableStream — needs sync context)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role, client_id')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'member'].includes(profile.role as string)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
  }

  const body = (await request.json()) as {
    vertical: string
    clientId?: string
    competitorDomains?: string[]
  }

  const { vertical, clientId, competitorDomains } = body

  if (!vertical?.trim()) {
    return new Response(JSON.stringify({ error: 'Missing vertical' }), { status: 400 })
  }

  if (clientId && !(await userCanAccessClient(
    { id: user.id, role: profile.role as 'admin' | 'member' | 'client', client_id: profile.client_id as string | null },
    clientId,
  ))) {
    return new Response(JSON.stringify({ error: 'Forbidden: no access to this client' }), { status: 403 })
  }

  const rl = await checkRateLimit(user.id, { maxPerHour: 30, toolSlug: 'vertical-benchmark' })
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSeconds)

  const service = await createServiceClient()
  const anthropic = new Anthropic()

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: BenchmarkEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
        } catch {
          /* stream closed */
        }
      }

      let runId = 'unknown'

      try {
        // ── 1. Fetch client data ────────────────────────────────────────────
        let clientDomain: string | null = null
        let clientName: string | null = null

        if (clientId) {
          const { data: clientRow } = await service
            .from('clients')
            .select('name, gsc_site_url')
            .eq('id', clientId)
            .single()

          if (clientRow) {
            clientName = (clientRow as Record<string, unknown>).name as string | null
            const gscUrl = (clientRow as Record<string, unknown>).gsc_site_url as string | null
            if (gscUrl) {
              clientDomain = gscUrl
                .replace('sc-domain:', '')
                .replace(/^https?:\/\//, '')
                .replace(/\/$/, '')
            }
          }
        }

        // ── 2. Create tool_runs row ─────────────────────────────────────────
        const { data: runRow } = await service
          .from('tool_runs')
          .insert({
            tool_slug: 'vertical-benchmark',
            client_id: clientId ?? null,
            user_id: user.id,
            status: 'running',
            started_at: new Date().toISOString(),
            input: {
              vertical,
              clientId: clientId ?? null,
              competitorDomains: competitorDomains ?? null,
            },
          })
          .select('id')
          .single()

        runId = (runRow as Record<string, unknown> | null)?.id as string | null ?? 'unknown'

        emit({ type: 'progress', message: `Starting benchmark for "${vertical}"`, pct: 2 })

        // ── 3. Discover competitors ────────────────────────────────────────
        let competitors: string[] = competitorDomains ?? []

        if (competitors.length === 0) {
          emit({ type: 'progress', message: 'Discovering top competitors via Claude...', pct: 5 })

          const discoverMsg = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 512,
            messages: [
              {
                role: 'user',
                content: `List 8 real company domains that typically rank well organically for "${vertical}" in the US. Provide only domains (e.g. example.com), one per line, no URLs, no commentary.`,
              },
            ],
          })

          const rawText =
            discoverMsg.content[0].type === 'text' ? discoverMsg.content[0].text : ''

          competitors = rawText
            .split('\n')
            .map(line => line.trim().replace(/^[-•*\d.)\s]+/, '').toLowerCase())
            .filter(line => /^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/.test(line))
            .slice(0, 8)
        }

        // Include client domain in crawl if available, but not in competitor list shown to user
        const domainsToAnalyze = clientDomain
          ? [...competitors.filter(d => d !== clientDomain)]
          : competitors

        emit({ type: 'competitors_discovered', competitors: domainsToAnalyze })
        emit({
          type: 'progress',
          message: `Found ${domainsToAnalyze.length} competitors to analyze`,
          pct: 10,
        })

        // ── 4. Crawl pages ─────────────────────────────────────────────────
        const allDomainsToCrawl = clientDomain
          ? [...domainsToAnalyze, clientDomain]
          : domainsToAnalyze

        const crawlTargetList = allDomainsToCrawl.flatMap(domain =>
          getTopPages(domain).map(url => ({ url }))
        )

        const totalPages = crawlTargetList.length
        let crawledCount = 0

        const allResults = await crawlTargets(crawlTargetList, {
          onResult(result) {
            crawledCount++
            // Extract domain from URL
            let resultDomain = ''
            try {
              resultDomain = new URL(result.url).hostname.replace(/^www\./, '')
            } catch {
              resultDomain = result.url
            }
            const pct = 10 + Math.round((crawledCount / totalPages) * 40)
            emit({ type: 'page_crawled', domain: resultDomain, url: result.url, pct })
          },
        })

        emit({ type: 'progress', message: `Crawled ${allResults.length} pages`, pct: 50 })

        // ── 5. Citation probing ────────────────────────────────────────────
        emit({ type: 'progress', message: 'Running citation probing...', pct: 52 })

        const citationQuestions = [
          `Who are the best companies for ${vertical}?`,
          `Which websites have the most helpful guides about ${vertical}?`,
          `What are the top-rated service providers for ${vertical}?`,
          `Which companies in ${vertical} have the best online reputation?`,
          `Who should I hire for ${vertical} and why?`,
        ]

        const citationFrequency: Record<string, number> = {}
        const citationResults: Array<{ question: string; citedDomains: string[] }> = []

        for (let qi = 0; qi < citationQuestions.length; qi++) {
          const question = citationQuestions[qi]
          const citationMsg = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 512,
            messages: [
              {
                role: 'user',
                content: `${question} Name specific companies or websites.`,
              },
            ],
          })

          const responseText =
            citationMsg.content[0].type === 'text' ? citationMsg.content[0].text.toLowerCase() : ''

          const citedDomains = allDomainsToCrawl.filter(domain => {
            const domainBase = domain.replace(/^www\./, '')
            const domainWithoutTld = domainBase.split('.')[0]
            return responseText.includes(domainBase) || responseText.includes(domainWithoutTld)
          })

          for (const d of citedDomains) {
            citationFrequency[d] = (citationFrequency[d] ?? 0) + 1
          }

          citationResults.push({ question, citedDomains })
          emit({ type: 'citation_result', question, citedDomains })

          const pct = 52 + Math.round(((qi + 1) / citationQuestions.length) * 18)
          emit({ type: 'progress', message: `Citation question ${qi + 1}/${citationQuestions.length} done`, pct })
        }

        // ── 6. Build competitor profiles ───────────────────────────────────
        emit({ type: 'progress', message: 'Building competitor profiles...', pct: 72 })

        const competitorProfiles: CompetitorProfile[] = domainsToAnalyze.map(domain =>
          buildCompetitorProfile(domain, allResults)
        )

        // ── 7. Synthesize with Claude Sonnet ───────────────────────────────
        emit({ type: 'progress', message: 'Synthesizing patterns with Claude...', pct: 78 })

        const profileSummary = competitorProfiles
          .map(
            p =>
              `Domain: ${p.domain}
Pages analyzed: ${p.pagesAnalyzed}
Avg word count: ${p.avgWordCount}
Schema types: ${p.schemaTypes.join(', ') || 'none'}
Author bylines: ${p.hasAuthorBylines}
FAQ sections: ${p.hasFaqSections}
HowTo content: ${p.hasHowToContent}
Trust signals: ${p.trustSignals.join(', ') || 'none'}
Avg CTAs: ${p.avgCtaCount}
Avg forms: ${p.avgFormCount}`
          )
          .join('\n\n')

        let clientProfileSummary = ''
        if (clientDomain) {
          const clientProfile = buildCompetitorProfile(clientDomain, allResults)
          clientProfileSummary = `\n\nCLIENT DOMAIN (${clientDomain} — ${clientName ?? 'client'}):\n${JSON.stringify(clientProfile, null, 2)}`
        }

        const synthesisMsg = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          messages: [
            {
              role: 'user',
              content: `You are an expert SEO strategist. Analyze these competitor profiles for the vertical "${vertical}" and produce a structured synthesis.

COMPETITOR PROFILES:
${profileSummary}
${clientProfileSummary}

Produce a JSON object with these exact keys:
{
  "tableStakes": ["string", ...],     // 5-8 patterns found in 60%+ of competitors (things every site must have)
  "differentiators": ["string", ...], // 3-5 patterns found only in top performers
  "clientGaps": ["string", ...]       // only if client domain provided: gaps vs table stakes and differentiators
}

Focus on actionable SEO and GEO patterns: content depth, schema usage, trust signals, FAQ/HowTo presence, author credibility, CTA structure. Be specific and actionable. Output only the JSON, no commentary.`,
            },
          ],
        })

        const synthesisText =
          synthesisMsg.content[0].type === 'text' ? synthesisMsg.content[0].text : '{}'

        let tableStakes: string[] = []
        let differentiators: string[] = []
        let clientGaps: string[] = []

        try {
          const jsonMatch = synthesisText.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]) as {
              tableStakes?: string[]
              differentiators?: string[]
              clientGaps?: string[]
            }
            tableStakes = parsed.tableStakes ?? []
            differentiators = parsed.differentiators ?? []
            clientGaps = parsed.clientGaps ?? []
          }
        } catch {
          tableStakes = ['Analysis complete — see competitor profiles above']
        }

        emit({ type: 'progress', message: 'Finalizing report...', pct: 95 })

        // ── 8. Build report + save ─────────────────────────────────────────
        const report: BenchmarkReport = {
          vertical,
          competitors: competitorProfiles,
          tableStakes,
          differentiators,
          citationFrequency,
          clientGaps,
          generatedAt: new Date().toISOString(),
        }

        await service
          .from('tool_runs')
          .update({
            status: 'complete',
            completed_at: new Date().toISOString(),
            output: report as unknown as Record<string, unknown>,
          })
          .eq('id', runId)

        emit({ type: 'complete', runId, report })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unexpected error'
        emit({ type: 'error', message })
        if (runId !== 'unknown') {
          await service
            .from('tool_runs')
            .update({ status: 'failed', error: message, completed_at: new Date().toISOString() })
            .eq('id', runId)
            .then(() => {}, () => {})
        }
      } finally {
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
