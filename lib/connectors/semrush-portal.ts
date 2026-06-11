import { logError } from '@/lib/logging'
import { connectorErr, connectorOk, type ConnectorResult } from './types'

export interface SemrushDomainRank {
  domain: string
  organic_keywords: number
  organic_traffic: number
  organic_cost: number
}

export interface SemrushBacklinksOverview {
  total_backlinks: number
  referring_domains: number
  follow_links: number
  nofollow_links: number
  authority_score: number
}

export interface SemrushKeywordRow {
  keyword: string
  position: number
  volume: number
  competition: number
  url: string
  serp_features: number
}

async function semrushFetch(params: Record<string, string>): Promise<string> {
  const url = `https://api.semrush.com/?${new URLSearchParams(params).toString()}`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  const text = await res.text()

  if (!res.ok || text.startsWith('ERROR')) {
    throw new Error(`Semrush API error: ${text.slice(0, 200)}`)
  }

  return text
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(';').map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const cols = line.split(';')
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = cols[i]?.trim() ?? ''
    })
    return row
  })
}

/** data is null when Semrush has no rows for the domain (≠ API failure). */
export async function fetchSemrushDomainRanks(
  domain: string,
  apiKey: string,
  database = 'us',
): Promise<ConnectorResult<SemrushDomainRank | null>> {
  try {
    const text = await semrushFetch({
      type: 'domain_ranks',
      key: apiKey,
      domain,
      database,
      export_columns: 'Or,Ot,Oc',
    })

    const rows = parseCSV(text)
    if (rows.length === 0) return connectorOk(null)

    const row = rows[0]
    return connectorOk({
      domain,
      organic_keywords: parseInt(row['Organic Keywords'] ?? row['Or'] ?? '0', 10),
      organic_traffic: parseInt(row['Organic Traffic'] ?? row['Ot'] ?? '0', 10),
      organic_cost: parseFloat(row['Organic Cost'] ?? row['Oc'] ?? '0'),
    })
  } catch (err) {
    logError('semrush.domain_ranks', `fetch failed for ${domain}`, err)
    return connectorErr(err)
  }
}

/** data is null when Semrush has no backlink rows for the domain (≠ API failure). */
export async function fetchSemrushBacklinksOverview(
  domain: string,
  apiKey: string,
): Promise<ConnectorResult<SemrushBacklinksOverview | null>> {
  try {
    const text = await semrushFetch({
      type: 'backlinks_overview',
      key: apiKey,
      target: domain,
      target_type: 'root_domain',
      export_columns: 'total,domains_num,follows_num,nofollows_num,score',
    })

    const rows = parseCSV(text)
    if (rows.length === 0) return connectorOk(null)

    const row = rows[0]
    return connectorOk({
      total_backlinks: parseInt(row['total'] ?? row['Total'] ?? '0', 10),
      referring_domains: parseInt(row['domains_num'] ?? row['Referring Domains'] ?? '0', 10),
      follow_links: parseInt(row['follows_num'] ?? row['Follow'] ?? '0', 10),
      nofollow_links: parseInt(row['nofollows_num'] ?? row['Nofollow'] ?? '0', 10),
      authority_score: parseInt(row['score'] ?? row['Authority Score'] ?? '0', 10),
    })
  } catch (err) {
    logError('semrush.backlinks_overview', `fetch failed for ${domain}`, err)
    return connectorErr(err)
  }
}

export interface SemrushOrganicCompetitor {
  domain: string
  competitionLevel: number
  commonKeywords: number
  organicTraffic: number
}

/** Organic competitors for a domain (Semrush domain_organic_organic report). */
export async function fetchSemrushOrganicCompetitors(
  domain: string,
  apiKey: string,
  database = 'us',
  limit = 10,
): Promise<ConnectorResult<SemrushOrganicCompetitor[]>> {
  try {
    const text = await semrushFetch({
      type: 'domain_organic_organic',
      key: apiKey,
      domain,
      database,
      display_limit: String(limit),
      export_columns: 'Dn,Cr,Np,Ot',
    })

    if (!text.trim()) return connectorOk([])

    const rows = parseCSV(text)
    return connectorOk(
      rows
        .map((row) => ({
          domain: row['Domain'] ?? row['Dn'] ?? '',
          competitionLevel: parseFloat(row['Competitor Relevance'] ?? row['Cr'] ?? '0') || 0,
          commonKeywords: parseInt(row['Common Keywords'] ?? row['Np'] ?? '0', 10) || 0,
          organicTraffic: parseInt(row['Organic Traffic'] ?? row['Ot'] ?? '0', 10) || 0,
        }))
        .filter((r) => r.domain),
    )
  } catch (err) {
    logError('semrush.organic_competitors', `fetch failed for ${domain}`, err)
    return connectorErr(err)
  }
}

export async function fetchSemrushDomainOrganic(
  domain: string,
  apiKey: string,
  database = 'us',
  limit = 100,
): Promise<ConnectorResult<SemrushKeywordRow[]>> {
  try {
    const text = await semrushFetch({
      type: 'domain_organic',
      key: apiKey,
      domain,
      database,
      display_limit: String(limit),
      export_columns: 'Ph,Po,Nq,Co,Ur,Sf',
    })

    if (!text.trim()) return connectorOk([])

    const rows = parseCSV(text)
    return connectorOk(
      rows
        .map((row) => ({
          keyword: row['Keyword'] ?? row['Ph'] ?? '',
          position: parseInt(row['Position'] ?? row['Po'] ?? '0', 10),
          volume: parseInt(row['Search Volume'] ?? row['Nq'] ?? '0', 10),
          competition: parseFloat(row['Competition'] ?? row['Co'] ?? '0'),
          url: row['Url'] ?? row['Ur'] ?? '',
          serp_features: parseInt(row['SERP Features'] ?? row['Sf'] ?? '0', 10) || 0,
        }))
        .filter((r) => r.keyword),
    )
  } catch (err) {
    logError('semrush.domain_organic', `fetch failed for ${domain}`, err)
    return connectorErr(err)
  }
}
