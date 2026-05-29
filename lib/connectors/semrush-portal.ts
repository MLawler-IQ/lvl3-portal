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

export interface SemrushOrganicResult {
  position: number
  domain: string
  url: string
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

export async function fetchSemrushDomainRanks(
  domain: string,
  apiKey: string,
  database = 'us',
): Promise<SemrushDomainRank | null> {
  try {
    const text = await semrushFetch({
      type: 'domain_ranks',
      key: apiKey,
      domain,
      database,
      export_columns: 'Or,Ot,Oc',
    })

    const rows = parseCSV(text)
    if (rows.length === 0) return null

    const row = rows[0]
    return {
      domain,
      organic_keywords: parseInt(row['Organic Keywords'] ?? row['Or'] ?? '0', 10),
      organic_traffic: parseInt(row['Organic Traffic'] ?? row['Ot'] ?? '0', 10),
      organic_cost: parseFloat(row['Organic Cost'] ?? row['Oc'] ?? '0'),
    }
  } catch {
    return null
  }
}

export async function fetchSemrushBacklinksOverview(
  domain: string,
  apiKey: string,
): Promise<SemrushBacklinksOverview | null> {
  try {
    const text = await semrushFetch({
      type: 'backlinks_overview',
      key: apiKey,
      target: domain,
      target_type: 'root_domain',
      export_columns: 'total,domains_num,follows_num,nofollows_num,score',
    })

    const rows = parseCSV(text)
    if (rows.length === 0) return null

    const row = rows[0]
    return {
      total_backlinks: parseInt(row['total'] ?? row['Total'] ?? '0', 10),
      referring_domains: parseInt(row['domains_num'] ?? row['Referring Domains'] ?? '0', 10),
      follow_links: parseInt(row['follows_num'] ?? row['Follow'] ?? '0', 10),
      nofollow_links: parseInt(row['nofollows_num'] ?? row['Nofollow'] ?? '0', 10),
      authority_score: parseInt(row['score'] ?? row['Authority Score'] ?? '0', 10),
    }
  } catch {
    return null
  }
}

export async function fetchSemrushDomainOrganic(
  domain: string,
  apiKey: string,
  database = 'us',
  limit = 100,
): Promise<SemrushKeywordRow[]> {
  const text = await semrushFetch({
    type: 'domain_organic',
    key: apiKey,
    domain,
    database,
    display_limit: String(limit),
    export_columns: 'Ph,Po,Nq,Co,Ur,Sf',
  })

  if (!text.trim()) return []

  const rows = parseCSV(text)
  return rows
    .map((row) => ({
      keyword: row['Keyword'] ?? row['Ph'] ?? '',
      position: parseInt(row['Position'] ?? row['Po'] ?? '0', 10),
      volume: parseInt(row['Search Volume'] ?? row['Nq'] ?? '0', 10),
      competition: parseFloat(row['Competition'] ?? row['Co'] ?? '0'),
      url: row['Url'] ?? row['Ur'] ?? '',
      serp_features: parseInt(row['SERP Features'] ?? row['Sf'] ?? '0', 10) || 0,
    }))
    .filter((r) => r.keyword)
}

/**
 * Organic SERP results for a keyword (the domains/URLs ranking for the phrase).
 * Uses Semrush's `phrase_organic` report. Results are returned in ranking order,
 * so the first `limit` rows approximate page-1 rankings.
 */
export async function fetchSemrushPhraseOrganic(
  phrase: string,
  apiKey: string,
  database = 'us',
  limit = 10,
): Promise<SemrushOrganicResult[]> {
  const text = await semrushFetch({
    type: 'phrase_organic',
    key: apiKey,
    phrase,
    database,
    display_limit: String(limit),
    export_columns: 'Dn,Ur',
  })

  if (!text.trim()) return []

  const rows = parseCSV(text)
  return rows
    .map((row, i) => ({
      position: i + 1,
      domain: row['Domain'] ?? row['Dn'] ?? '',
      url: row['Url'] ?? row['Ur'] ?? '',
    }))
    .filter((r) => r.domain)
}
