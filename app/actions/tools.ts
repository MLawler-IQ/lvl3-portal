'use server'

import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { buildToolContext } from '@/lib/tools/context'
import { keywordQuickWinsTool, type QuickWin } from '@/lib/tools/callable/keyword-quick-wins'
import { aiVisibilityTool, type AIVisibilityResult } from '@/lib/tools/callable/ai-visibility'

// Re-exported so existing importers of this module keep working; the canonical
// definitions moved to lib/tools/callable/*.
export type { QuickWin } from '@/lib/tools/callable/keyword-quick-wins'
export type { AIVisibilityResult } from '@/lib/tools/callable/ai-visibility'
import { fetchGSCRows } from '@/lib/tools-gsc'
import Anthropic from '@anthropic-ai/sdk'

// ── Shared helper ─────────────────────────────────────────────────────────────

async function getClientGSCUrl(clientId: string): Promise<string> {
  const service = await createServiceClient()
  const { data } = await service
    .from('clients')
    .select('gsc_site_url, name')
    .eq('id', clientId)
    .single()
  if (!data?.gsc_site_url) {
    throw new Error(
      `No Search Console site configured for ${data?.name ?? 'this client'}. Set it in client settings.`
    )
  }
  return data.gsc_site_url
}

// ── Keyword Quick Wins ────────────────────────────────────────────────────────

export async function fetchQuickWins(clientId: string): Promise<{
  wins?: QuickWin[]
  error?: string
}> {
  // Thin wrapper now: authenticate, build a context, run the callable tool, adapt its
  // envelope to the shape this page already consumes. The scoring lives in
  // lib/tools/callable/keyword-quick-wins.ts so an orchestrator can call it without a
  // session — which requireAdmin() made impossible.
  try {
    const { user } = await requireAdmin()
    const ctx = await buildToolContext({
      clientId,
      invoker: { kind: 'user', userId: user.id },
    })
    const result = await keywordQuickWinsTool.run({}, ctx)
    return result.ok ? { wins: result.data } : { error: result.error }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to fetch quick wins' }
  }
}

// ── AI Visibility Checker ─────────────────────────────────────────────────────

export async function checkAIVisibility(clientId: string): Promise<{
  result?: AIVisibilityResult
  error?: string
}> {
  try {
    const { user } = await requireAdmin()
    const ctx = await buildToolContext({
      clientId,
      invoker: { kind: 'user', userId: user.id },
    })
    const res = await aiVisibilityTool.run({}, ctx)
    return res.ok ? { result: res.data } : { error: res.error }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to check AI visibility' }
  }
}

// ── Semrush Competitor Gap Analysis ──────────────────────────────────────────

export type MatrixKeyword = {
  keyword: string
  volume: number
  competition: number
  positions: Record<string, { position: number; url: string }>
}

export type PreFilters = {
  minVolume: number | null
  includeTerms: string[]
  excludeTerms: string[]
}

export type SemrushReportMeta = {
  id: string
  client_domain: string
  competitors: string[]
  database: string
  page_section: string
  filters: PreFilters
  client_keyword_count: number
  keyword_count: number
  created_at: string
}

export type SemrushReportFull = SemrushReportMeta & {
  matrix_data: MatrixKeyword[]
  relevance_scores: Record<string, number> | null
}

export type GapKeyword = {
  keyword: string
  volume: number
  competition: number
  competitorPositions: { domain: string; position: number; url: string }[]
  clientPosition: number | null
  clientUrl: string | null
  relevance: number
}

import { normalizeDomain } from '@/lib/normalize-domain'

const PAGE_SECTION_FILTERS: Record<string, string | null> = {
  all: null,
  blog: 'Pu|Co|/blog/|Or|Pu|Co|/articles/|Or|Pu|Co|/news/',
  product: 'Pu|Co|/product/|Or|Pu|Co|/products/|Or|Pu|Co|/shop/',
  service: 'Pu|Co|/service/|Or|Pu|Co|/services/',
  location: 'Pu|Co|/location/|Or|Pu|Co|/locations/',
}

function buildDisplayFilter(pageSection: string, minVolume: number | null): string | null {
  const sectionFilter = PAGE_SECTION_FILTERS[pageSection] ?? null
  const volumeFilter = minVolume && minVolume > 0 ? `Nq|Gt|${minVolume}` : null
  if (sectionFilter && volumeFilter) return `${sectionFilter}|And|${volumeFilter}`
  return sectionFilter ?? volumeFilter
}

function applyKeywordFilters(
  rows: { Ph: string; Po: number; Nq: number; Co: number; Ur: string }[],
  includeTerms: string[],
  excludeTerms: string[]
): { Ph: string; Po: number; Nq: number; Co: number; Ur: string }[] {
  let filtered = rows
  if (includeTerms.length > 0) {
    filtered = filtered.filter((r) => {
      const kw = r.Ph.toLowerCase()
      return includeTerms.some((t) => kw.includes(t.toLowerCase()))
    })
  }
  if (excludeTerms.length > 0) {
    filtered = filtered.filter((r) => {
      const kw = r.Ph.toLowerCase()
      return !excludeTerms.some((t) => kw.includes(t.toLowerCase()))
    })
  }
  return filtered
}

async function semrushQuery(
  domain: string,
  database: string,
  apiKey: string,
  displayFilter?: string | null
): Promise<{ Ph: string; Po: number; Nq: number; Co: number; Ur: string }[]> {
  const params = new URLSearchParams({
    type: 'domain_organic',
    key: apiKey,
    domain,
    database,
    display_limit: '2500',
    export_columns: 'Ph,Po,Nq,Co,Ur',
  })
  if (displayFilter) {
    params.set('display_filter', displayFilter)
  }

  const url = `https://api.semrush.com/?${params.toString()}`
  const res = await fetch(url)
  const text = await res.text()

  if (!res.ok || text.startsWith('ERROR')) {
    console.error(`Semrush API error for ${domain}:`, res.status, text.slice(0, 300))
    return []
  }

  if (!text.trim()) return []

  const lines = text.trim().split('\n')
  if (lines.length < 2) return []

  const headers = lines[0].split(';').map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const cols = line.split(';')
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = cols[i]?.trim() ?? '' })
    return {
      Ph: row['Keyword'] ?? row['Ph'] ?? '',
      Po: parseInt(row['Position'] ?? row['Po'] ?? '0', 10),
      Nq: parseInt(row['Search Volume'] ?? row['Nq'] ?? '0', 10),
      Co: parseFloat(row['Competition'] ?? row['Co'] ?? '0'),
      Ur: row['Url'] ?? row['Ur'] ?? '',
    }
  }).filter((r) => r.Ph)
}

async function scoreRelevance(keywords: string[], clientDomain: string): Promise<Record<string, number>> {
  if (keywords.length === 0) return {}
  const scores: Record<string, number> = {}
  try {
    const anthropic = new Anthropic()
    const chunks: string[][] = []
    for (let i = 0; i < keywords.length; i += 250) {
      chunks.push(keywords.slice(i, i + 250))
    }
    const results = await Promise.all(
      chunks.map(async (chunk) => {
        const response = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4096,
          system: 'You are an SEO relevance scorer. Respond with valid JSON only, no markdown fences.',
          messages: [
            {
              role: 'user',
              content: `Given the domain "${clientDomain}", score each keyword for business relevance on a 1-5 scale:\n1 = completely irrelevant to the domain's likely business\n2 = tangentially related\n3 = somewhat relevant\n4 = clearly relevant\n5 = highly relevant / core topic\n\nKeywords:\n${JSON.stringify(chunk)}\n\nRespond with exactly: {"scores":{"keyword1":3,"keyword2":5,...}} covering every keyword.`,
            },
          ],
        })
        const textBlock = response.content.find((b) => b.type === 'text')
        if (!textBlock || textBlock.type !== 'text') return {}
        const parsed = JSON.parse(textBlock.text) as { scores: Record<string, number> }
        return parsed.scores ?? {}
      })
    )
    for (const chunk of results) {
      for (const [kw, score] of Object.entries(chunk)) {
        if (typeof score === 'number' && score >= 1 && score <= 5) {
          scores[kw] = score
        }
      }
    }
  } catch (err) {
    console.error('Relevance scoring failed (scores will be 0):', err)
  }
  return scores
}

export async function runSemrushAnalysis(params: {
  clientId: string
  clientDomain: string
  competitors: string[]
  pageSection: string
  database: string
  filters: PreFilters
}): Promise<{
  reportId?: string
  matrix?: MatrixKeyword[]
  relevanceScores?: Record<string, number>
  clientKeywordCount?: number
  clientDomain?: string
  error?: string
}> {
  try {
    await requireAdmin()

    const apiKey = process.env.SEMRUSH_API_KEY
    if (!apiKey) {
      return { error: 'SEMRUSH_API_KEY is not configured. Add it to your environment variables.' }
    }

    const competitors = params.competitors
      .map((c) => normalizeDomain(c))
      .filter(Boolean)

    if (competitors.length === 0 || competitors.length > 4) {
      return { error: 'Provide between 1 and 4 competitor domains.' }
    }

    const clientDomain = normalizeDomain(params.clientDomain)
    if (!clientDomain) {
      return { error: 'Client domain is required.' }
    }

    const db = params.database || 'us'
    const displayFilter = buildDisplayFilter(params.pageSection, params.filters.minVolume)

    const clientRows = applyKeywordFilters(
      await semrushQuery(clientDomain, db, apiKey, displayFilter),
      params.filters.includeTerms,
      params.filters.excludeTerms
    )

    if (clientRows.length === 0) {
      return {
        error: `No organic keywords found for "${clientDomain}" in the ${db.toUpperCase()} database. Check that the domain is correct.`,
      }
    }

    const competitorResults = await Promise.all(
      competitors.map(async (domain) => ({
        domain,
        rows: applyKeywordFilters(
          await semrushQuery(domain, db, apiKey, displayFilter),
          params.filters.includeTerms,
          params.filters.excludeTerms
        ),
      }))
    )

    // Build master keyword matrix — ALL keywords from all domains
    const matrixMap = new Map<string, MatrixKeyword>()

    for (const row of clientRows) {
      const kw = row.Ph.toLowerCase()
      matrixMap.set(kw, {
        keyword: row.Ph,
        volume: row.Nq,
        competition: row.Co,
        positions: { [clientDomain]: { position: row.Po, url: row.Ur } },
      })
    }

    for (const { domain, rows } of competitorResults) {
      for (const row of rows) {
        const kw = row.Ph.toLowerCase()
        const existing = matrixMap.get(kw)
        if (existing) {
          existing.positions[domain] = { position: row.Po, url: row.Ur }
          if (row.Nq > existing.volume) existing.volume = row.Nq
          if (row.Co > existing.competition) existing.competition = row.Co
        } else {
          matrixMap.set(kw, {
            keyword: row.Ph,
            volume: row.Nq,
            competition: row.Co,
            positions: { [domain]: { position: row.Po, url: row.Ur } },
          })
        }
      }
    }

    const matrix = Array.from(matrixMap.values()).sort((a, b) => b.volume - a.volume)

    // Identify gap keywords (client position null or >20), top 500 for scoring
    const gapKeywords = matrix
      .filter((m) => {
        const cp = m.positions[clientDomain]
        return !cp || cp.position > 20
      })
      .slice(0, 500)
      .map((m) => m.keyword)

    const relevanceScores = await scoreRelevance(gapKeywords, clientDomain)

    // Persist report
    const service = await createServiceClient()
    const { data: report } = await service
      .from('semrush_reports')
      .insert({
        client_id: params.clientId,
        client_domain: clientDomain,
        competitors,
        database: db,
        page_section: params.pageSection,
        filters: params.filters,
        matrix_data: matrix,
        relevance_scores: relevanceScores,
        client_keyword_count: clientRows.length,
        keyword_count: matrix.length,
      })
      .select('id')
      .single()

    // Clean up old reports (>30 days)
    await service
      .from('semrush_reports')
      .delete()
      .eq('client_id', params.clientId)
      .lt('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

    return {
      reportId: report?.id,
      matrix,
      relevanceScores,
      clientKeywordCount: clientRows.length,
      clientDomain,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to run gap analysis' }
  }
}

// ── Content Gap Finder ────────────────────────────────────────────────────────

export type ContentGap = {
  query: string
  impressions: number
  clicks: number
  position: number
  ctr: number
  gapType: 'high-impression-no-clicks' | 'ranking-but-weak' | 'near-page-one'
  recommendation: string
}

export async function fetchContentGaps(clientId: string): Promise<{
  gaps?: ContentGap[]
  error?: string
}> {
  try {
    await requireAdmin()
    const siteUrl = await getClientGSCUrl(clientId)
    const rows = await fetchGSCRows(siteUrl, 90)

    const queryMap = new Map<string, {
      impressions: number; clicks: number; position: number; count: number
    }>()
    for (const r of rows) {
      const prev = queryMap.get(r.query) ?? { impressions: 0, clicks: 0, position: 0, count: 0 }
      queryMap.set(r.query, {
        impressions: prev.impressions + r.impressions,
        clicks: prev.clicks + r.clicks,
        position: prev.position + r.position,
        count: prev.count + 1,
      })
    }

    const gaps: ContentGap[] = []

    for (const [query, v] of Array.from(queryMap.entries())) {
      const position = v.position / v.count
      const ctr = v.impressions > 0 ? v.clicks / v.impressions : 0

      if (v.impressions >= 200 && ctr < 0.01 && position <= 30) {
        gaps.push({
          query,
          impressions: v.impressions,
          clicks: v.clicks,
          position: Math.round(position * 10) / 10,
          ctr: Math.round(ctr * 1000) / 10,
          gapType: 'high-impression-no-clicks',
          recommendation:
            'High visibility but no engagement — title/meta likely mismatched to intent. Rewrite the title tag to directly address what searchers want.',
        })
      } else if (position > 10.5 && position <= 20 && v.impressions >= 150) {
        gaps.push({
          query,
          impressions: v.impressions,
          clicks: v.clicks,
          position: Math.round(position * 10) / 10,
          ctr: Math.round(ctr * 1000) / 10,
          gapType: 'near-page-one',
          recommendation:
            'Just off page one — strengthen on-page signals (header tags, internal links, content depth) to push into top 10.',
        })
      } else if (position <= 10.5 && v.impressions >= 100) {
        const expectedCtr = position <= 3 ? 0.08 : position <= 5 ? 0.04 : 0.02
        if (ctr < expectedCtr) {
          gaps.push({
            query,
            impressions: v.impressions,
            clicks: v.clicks,
            position: Math.round(position * 10) / 10,
            ctr: Math.round(ctr * 1000) / 10,
            gapType: 'ranking-but-weak',
            recommendation: `Ranking #${Math.round(position)} but CTR is below average for this position. Add a power word to the title tag and make the meta description more specific and action-oriented.`,
          })
        }
      }
    }

    return {
      gaps: gaps
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 50),
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to fetch content gaps' }
  }
}
