'use server'

// Thin auth wrappers. Every tool's logic now lives in lib/tools/callable/* so an
// orchestrator can run it without a session; these keep the exact signatures the
// pages already call, and adapt the tool envelope to the {data?, error?} shape they
// expect.

import { requireAdmin } from '@/lib/auth'
import { buildToolContext } from '@/lib/tools/context'
import {
  coreWebVitalsTool,
  pageSeoAuditTool,
  contentQualityTool,
  keywordResearchTool,
  type PageSeoResult,
  type ContentQualityResult,
} from '@/lib/tools/callable/page-audits'
import { backlinkOverviewTool, type BacklinkResult } from '@/lib/tools/callable/backlink-overview'
import type { PageSpeedResult } from '@/lib/connectors/pagespeed'
import type { KEKeywordRow } from '@/lib/connectors/keywords-everywhere'
import { getAdminGBPOAuthClient } from '@/lib/gbp-auth'
import { listGBPAccounts, type GBPAccount } from '@/lib/connectors/gbp'

export type { PageSeoResult } from '@/lib/tools/callable/page-audits'
export type { ContentQualityResult } from '@/lib/tools/callable/page-audits'
export type { BacklinkResult } from '@/lib/tools/callable/backlink-overview'

/** Every wrapper does the same three things, so it is written once. */
async function withCtx<T>(
  clientId: string | null,
  run: (ctx: Awaited<ReturnType<typeof buildToolContext>>) => Promise<{ ok: true; data: T } | { ok: false; error: string }>,
  fallbackMessage: string,
): Promise<{ data?: T; error?: string }> {
  try {
    const { user } = await requireAdmin()
    const ctx = await buildToolContext({ clientId, invoker: { kind: 'user', userId: user.id } })
    const res = await run(ctx)
    return res.ok ? { data: res.data } : { error: res.error }
  } catch (err) {
    return { error: err instanceof Error ? err.message : fallbackMessage }
  }
}

export async function fetchCoreWebVitals(
  url: string,
  strategy: 'mobile' | 'desktop' = 'mobile',
): Promise<{ data?: PageSpeedResult; error?: string }> {
  return withCtx(null, (ctx) => coreWebVitalsTool.run({ url, strategy }, ctx), 'Failed to fetch Core Web Vitals')
}

export async function fetchPageSeoAudit(url: string): Promise<{ data?: PageSeoResult; error?: string }> {
  return withCtx(null, (ctx) => pageSeoAuditTool.run({ url }, ctx), 'Failed to audit page')
}

export async function fetchKeywordResearch(
  keywords: string[],
  country = 'us',
): Promise<{ data?: KEKeywordRow[]; error?: string }> {
  return withCtx(null, (ctx) => keywordResearchTool.run({ keywords, country }, ctx), 'Failed to fetch keyword data')
}

export async function fetchBacklinkOverview(
  clientId: string,
): Promise<{ data?: BacklinkResult; error?: string }> {
  return withCtx(clientId, (ctx) => backlinkOverviewTool.run({}, ctx), 'Failed to fetch backlink overview')
}

export async function fetchContentQuality(
  url: string,
): Promise<{ data?: ContentQualityResult; error?: string }> {
  return withCtx(null, (ctx) => contentQualityTool.run({ url }, ctx), 'Failed to analyze content quality')
}

// ── GBP Accounts ─────────────────────────────────────────────────────────────

export async function fetchGBPAccounts(): Promise<{ data?: GBPAccount[]; error?: string }> {
  try {
    await requireAdmin()
    const auth = await getAdminGBPOAuthClient()
    const accounts = await listGBPAccounts(auth)
    return { data: accounts }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to list GBP accounts' }
  }
}
