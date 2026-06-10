import { connectorErr, connectorOk, type ConnectorResult } from './types'

const KE_BASE = 'https://api.keywordseverywhere.com/v1'

export interface KEKeywordRow {
  keyword: string
  vol: number
  cpc: number
  competition: number
  trend: number[]
}

async function kePost(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        params.append(`${key}[]`, String(v))
      }
    } else {
      params.append(key, String(value))
    }
  }

  const res = await fetch(`${KE_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`KE API error (${res.status}): ${text.slice(0, 200)}`)
  }

  return res.json()
}

function parseKeywordRows(data: unknown[]): KEKeywordRow[] {
  return data.map((item: unknown) => {
    const row = item as Record<string, unknown>
    const cpcObj = row.cpc as Record<string, unknown> | undefined
    const trendArr = Array.isArray(row.trend)
      ? (row.trend as Record<string, unknown>[]).map((t) => Number(t.value ?? 0))
      : []
    return {
      keyword: String(row.keyword ?? ''),
      vol: Number(row.vol ?? 0),
      cpc: Number(cpcObj?.value ?? 0),
      competition: Number(row.competition ?? 0),
      trend: trendArr,
    }
  })
}

export async function fetchKEKeywordData(
  keywords: string[],
  apiKey: string,
  country = 'us',
  dataSource = 'gkp',
): Promise<ConnectorResult<KEKeywordRow[]>> {
  try {
    const result = (await kePost('get_keyword_data', apiKey, {
      kw: keywords,
      country,
      currency: 'USD',
      dataSource,
    })) as { data?: unknown[] }

    return connectorOk(parseKeywordRows(result.data ?? []))
  } catch (err) {
    return connectorErr(err)
  }
}

export async function fetchKERelatedKeywords(
  keyword: string,
  apiKey: string,
  country = 'us',
  limit = 50,
): Promise<ConnectorResult<KEKeywordRow[]>> {
  try {
    const result = (await kePost('get_related_keywords', apiKey, {
      keyword,
      country,
      num: Math.min(limit, 1000),
    })) as { data?: unknown[] }

    return connectorOk(parseKeywordRows(result.data ?? []))
  } catch (err) {
    return connectorErr(err)
  }
}
