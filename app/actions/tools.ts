'use server'

import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
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

export type QuickWin = {
  query: string
  page: string
  position: number
  impressions: number
  clicks: number
  ctr: number
  estimatedClicksAt5: number
  estimatedClicksAt3: number
  opportunityScore: number
}

export async function fetchQuickWins(clientId: string): Promise<{
  wins?: QuickWin[]
  error?: string
}> {
  try {
    await requireAdmin()
    const siteUrl = await getClientGSCUrl(clientId)
    const rows = await fetchGSCRows(siteUrl, 90)

    const wins: QuickWin[] = rows
      .filter(
        (r) =>
          r.position >= 4 &&
          r.position <= 20 &&
          r.impressions >= 100
      )
      .map((r) => {
        const estimatedClicksAt5 = Math.round(r.impressions * 0.065)
        const estimatedClicksAt3 = Math.round(r.impressions * 0.103)
        const opportunityScore = Math.round(
          (estimatedClicksAt3 - r.clicks) * (1 / r.position) * 100
        )
        return {
          query: r.query,
          page: r.page,
          position: Math.round(r.position),
          impressions: r.impressions,
          clicks: r.clicks,
          ctr: Math.round(r.ctr * 10) / 10,
          estimatedClicksAt5,
          estimatedClicksAt3,
          opportunityScore,
        }
      })
      .sort((a, b) => b.opportunityScore - a.opportunityScore)
      .slice(0, 50)

    return { wins }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to fetch quick wins' }
  }
}

// ── AI Visibility Checker ─────────────────────────────────────────────────────

export type AIVisibilityResult = {
  domain: string
  brandedClicks: number
  brandedImpressions: number
  totalClicks: number
  totalImpressions: number
  brandedClickShare: number
  brandedImpressionShare: number
  topBrandedQueries: { query: string; clicks: number; impressions: number; position: number }[]
  topNonBrandedQueries: { query: string; clicks: number; impressions: number; position: number }[]
  periodDays: number
  /** Terms actually used to classify queries as branded. */
  brandTerms: string[]
  /** 'configured' = the client's saved brand_terms (same source as the dashboard's Branded Search module); 'heuristic' = name/slug/domain fallback. */
  termsSource: 'configured' | 'heuristic'
}

export async function checkAIVisibility(clientId: string): Promise<{
  result?: AIVisibilityResult
  error?: string
}> {
  try {
    await requireAdmin()
    const service = await createServiceClient()
    const { data: client } = await service
      .from('clients')
      .select('gsc_site_url, name, slug, brand_terms, brand_match_mode')
      .eq('id', clientId)
      .single()

    if (!client?.gsc_site_url) {
      throw new Error('No Search Console site configured. Set it in client settings.')
    }

    const rows = await fetchGSCRows(client.gsc_site_url, 90)

    // Prefer the client's configured brand_terms — the same source (and matching
    // semantics) the dashboard's Branded Search module uses via
    // fetchGSCBrandedSplit: substring match, or whole-query equality in 'exact' mode.
    const configuredTerms = ((client.brand_terms as string[] | null) ?? [])
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)

    // Heuristic fallback: registrable brand label — subdomain-safe. normalizeDomain
    // strips sc-domain:/protocol/www/path; then pick the label before the public
    // suffix so shop.brand.com → "brand" and brand.co.uk → "brand".
    const brandToken = (() => {
      const labels = normalizeDomain(client.gsc_site_url).split('.').filter(Boolean)
      if (labels.length <= 2) return labels[0] ?? ''
      const MULTI_PART_TLD = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'])
      const secondToLast = labels[labels.length - 2]
      return MULTI_PART_TLD.has(secondToLast) ? labels[labels.length - 3] : secondToLast
    })()

    const termsSource: 'configured' | 'heuristic' =
      configuredTerms.length > 0 ? 'configured' : 'heuristic'

    const brandTerms =
      termsSource === 'configured'
        ? configuredTerms
        : [client.slug.toLowerCase(), brandToken.toLowerCase(), client.name.toLowerCase()].filter(
            Boolean,
          )

    const exactMatch = client.brand_match_mode === 'exact'

    // Configured terms mirror the module's matching; the heuristic keeps a
    // word-boundary match so a brand term like "shoe" doesn't match "shoelace".
    const isBranded = (query: string) => {
      const q = query.toLowerCase()
      if (termsSource === 'configured') {
        return exactMatch ? brandTerms.includes(q) : brandTerms.some((t) => q.includes(t))
      }
      return brandTerms.some((term) => {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(q)
      })
    }

    const branded = rows.filter((r) => isBranded(r.query))
    const nonBranded = rows.filter((r) => !isBranded(r.query))

    const sum = (arr: typeof rows, key: keyof (typeof rows)[0]) =>
      arr.reduce((acc, r) => acc + (r[key] as number), 0)

    const brandedClicks = sum(branded, 'clicks')
    const brandedImpressions = sum(branded, 'impressions')
    const totalClicks = sum(rows, 'clicks')
    const totalImpressions = sum(rows, 'impressions')

    const aggregateByQuery = (arr: typeof rows) => {
      const map = new Map<string, { clicks: number; impressions: number; position: number; count: number }>()
      for (const r of arr) {
        const prev = map.get(r.query) ?? { clicks: 0, impressions: 0, position: 0, count: 0 }
        map.set(r.query, {
          clicks: prev.clicks + r.clicks,
          impressions: prev.impressions + r.impressions,
          position: prev.position + r.position,
          count: prev.count + 1,
        })
      }
      return Array.from(map.entries())
        .map(([query, v]) => ({
          query,
          clicks: v.clicks,
          impressions: v.impressions,
          position: Math.round((v.position / v.count) * 10) / 10,
        }))
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 10)
    }

    return {
      result: {
        domain: client.gsc_site_url,
        brandedClicks,
        brandedImpressions,
        totalClicks,
        totalImpressions,
        brandedClickShare: totalClicks > 0 ? Math.round((brandedClicks / totalClicks) * 100) : 0,
        brandedImpressionShare: totalImpressions > 0 ? Math.round((brandedImpressions / totalImpressions) * 100) : 0,
        topBrandedQueries: aggregateByQuery(branded),
        topNonBrandedQueries: aggregateByQuery(nonBranded),
        periodDays: 90,
        brandTerms,
        termsSource,
      },
    }
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
