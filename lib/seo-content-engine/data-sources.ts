/**
 * SEO Content Engine — Data Sources Adapter
 * Replaces Python MCP client with direct calls to existing portal connectors.
 * Each method tracks availability (success/failure/latency) for the UI panel.
 */
import type {
  DataSourceCallback,
  DataSourceStatus,
  DataAvailability,
  KeywordMetrics,
} from './types'
import { DATA_SOURCE_TOGGLES } from './config'
import {
  fetchKEKeywordData,
  fetchKERelatedKeywords,
  type KEKeywordRow,
} from '@/lib/connectors/keywords-everywhere'
import {
  fetchSemrushDomainOrganic,
  type SemrushKeywordRow,
} from '@/lib/connectors/semrush-portal'
import { fetchAndParse, type ParsedPage } from '@/lib/connectors/crawler'
import { tryConnector, type ConnectorResult } from '@/lib/connectors/types'
import { fetchGSCRows, type GSCRow } from '@/lib/tools-gsc'

export class DataSources {
  private keApiKey: string
  private semrushApiKey: string
  private gscSiteUrl: string | null
  private onDataSource: DataSourceCallback
  private _availability: DataAvailability = {}

  constructor(opts: {
    keApiKey: string
    semrushApiKey: string
    gscSiteUrl: string | null
    onDataSource: DataSourceCallback
  }) {
    this.keApiKey = opts.keApiKey
    this.semrushApiKey = opts.semrushApiKey
    this.gscSiteUrl = opts.gscSiteUrl
    this.onDataSource = opts.onDataSource
  }

  get availability(): DataAvailability {
    return { ...this._availability }
  }

  // ── Tracking wrapper ────────────────────────────────────────

  private async tracked<T>(
    source: keyof DataAvailability,
    fn: () => Promise<ConnectorResult<T>>,
  ): Promise<T | null> {
    if (!DATA_SOURCE_TOGGLES[source]) {
      const status: DataSourceStatus = { status: 'skipped', reason: 'disabled in config' }
      this._availability[source] = status
      this.onDataSource(source, status)
      return null
    }

    const start = performance.now()
    let result: ConnectorResult<T>
    try {
      result = await fn()
    } catch (err) {
      // Defensive: connectors shouldn't throw under the contract, but a bug
      // in one must still be recorded as a failed source, not crash the run.
      result = { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    const latency_ms = Math.round(performance.now() - start)

    if (!result.ok) {
      const status: DataSourceStatus = { status: 'failed', error: result.error, latency_ms }
      this._availability[source] = status
      this.onDataSource(source, status)
      return null
    }

    const count = Array.isArray(result.data) ? result.data.length : undefined
    const status: DataSourceStatus = { status: 'success', latency_ms, count }
    this._availability[source] = status
    this.onDataSource(source, status)
    return result.data
  }

  // ── Keywords Everywhere ─────────────────────────────────────

  async getKeywordVolumeBatch(
    keywords: string[],
  ): Promise<Record<string, KeywordMetrics>> {
    const rows = await this.tracked('keywords_everywhere', () =>
      fetchKEKeywordData(keywords, this.keApiKey),
    )
    if (!rows) return {}

    const metrics: Record<string, KeywordMetrics> = {}
    for (const row of rows) {
      metrics[row.keyword] = {
        msv: row.vol,
        cpc: row.cpc,
        competition: row.competition,
      }
    }
    return metrics
  }

  async getRelatedKeywords(query: string): Promise<string[]> {
    const rows = await this.tracked('keywords_everywhere', () =>
      fetchKERelatedKeywords(query, this.keApiKey),
    )
    return rows?.map((r: KEKeywordRow) => r.keyword) ?? []
  }

  async getPasfKeywords(query: string): Promise<string[]> {
    // PASF (People Also Search For) — fetches from KE related endpoint with smaller limit
    const rows = await this.tracked('keywords_everywhere', () =>
      fetchKERelatedKeywords(query, this.keApiKey, 'us', 30),
    )
    // Filter for question-like terms (how, what, why, when, can, does, is, are)
    return (rows?.map((r: KEKeywordRow) => r.keyword) ?? []).filter((kw: string) =>
      /^(how|what|why|when|can|does|is|are|will|should|do|which)\b/i.test(kw),
    )
  }

  // ── Semrush ─────────────────────────────────────────────────

  async getCompetitorKeywordGap(domain: string): Promise<SemrushKeywordRow[]> {
    const rows = await this.tracked('semrush', () =>
      fetchSemrushDomainOrganic(domain, this.semrushApiKey),
    )
    return rows ?? []
  }

  // ── Google Search Console ───────────────────────────────────

  async getTopQueries(days = 90): Promise<GSCRow[]> {
    if (!this.gscSiteUrl) {
      const status: DataSourceStatus = {
        status: 'skipped',
        reason: 'no GSC site URL configured',
      }
      this._availability.gsc = status
      this.onDataSource('gsc', status)
      return []
    }

    const rows = await this.tracked('gsc', () =>
      tryConnector(() => fetchGSCRows(this.gscSiteUrl!, days)),
    )
    return rows ?? []
  }

  // ── Crawler ─────────────────────────────────────────────────

  async crawlPage(url: string): Promise<ParsedPage | null> {
    return this.tracked('crawler', () => fetchAndParse(url))
  }

  // ── SERP Features (stub — returns null initially) ───────────

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getSerpFeatures(_keyword: string): Promise<Record<string, unknown> | null> {
    // TODO: Add Semrush SERP features API or MCP integration
    return null
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getPage1Rankings(_keyword: string): Promise<Record<string, unknown> | null> {
    // TODO: Add Semrush page-1 rankings API or MCP integration
    return null
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getContentBrief(_query: string): Promise<Record<string, unknown> | null> {
    // TODO: Add MCP content brief integration
    return null
  }
}
