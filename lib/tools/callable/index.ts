// The callable registry: slug → CallableTool.
//
// Deliberately SEPARATE from lib/tools/registry.ts, which is the UI manifest and
// imports lucide-react icons. Merging them would drag React into anything
// server-side that wants to run a tool — an orchestrator, a cron job, an Ask LVL3
// handler. They are joined by `slug` instead, and a test asserts every callable slug
// exists in the manifest so the two can't drift apart silently.

import { keywordQuickWinsTool } from './keyword-quick-wins'
import { aiVisibilityTool } from './ai-visibility'
import { contentGapsTool } from './content-gaps'
import { backlinkOverviewTool } from './backlink-overview'
import {
  coreWebVitalsTool,
  pageSeoAuditTool,
  contentQualityTool,
  keywordResearchTool,
} from './page-audits'
import type { CallableTool, ToolContext, ToolResult } from '../contract'

/* eslint-disable @typescript-eslint/no-explicit-any -- the registry is heterogeneous
   by nature: each tool has its own input and output types. Callers get the precise
   types by importing the tool directly; this map exists for dynamic dispatch, where
   the input is only known at runtime. */
export const CALLABLE_TOOLS: Record<string, CallableTool<any, any>> = {
  [keywordQuickWinsTool.slug]: keywordQuickWinsTool,
  [aiVisibilityTool.slug]: aiVisibilityTool,
  [contentGapsTool.slug]: contentGapsTool,
  [backlinkOverviewTool.slug]: backlinkOverviewTool,
  [coreWebVitalsTool.slug]: coreWebVitalsTool,
  [pageSeoAuditTool.slug]: pageSeoAuditTool,
  [contentQualityTool.slug]: contentQualityTool,
  [keywordResearchTool.slug]: keywordResearchTool,
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type CallableSlug = keyof typeof CALLABLE_TOOLS

/** Slugs an orchestrator can currently compose. */
export function callableSlugs(): string[] {
  return Object.keys(CALLABLE_TOOLS).sort()
}

/**
 * Run a tool by slug.
 *
 * Never throws: an unknown slug is a ToolErr like any other failure, because the
 * caller composing these is a loop over a plan, and one bad entry must not abort the
 * rest of the run.
 */
export async function runTool(
  slug: string,
  input: unknown,
  ctx: ToolContext,
): Promise<ToolResult<unknown>> {
  const tool = CALLABLE_TOOLS[slug]
  if (!tool) {
    return {
      ok: false,
      error: `Unknown tool "${slug}". Callable tools: ${callableSlugs().join(', ')}`,
      sources: [],
      durationMs: 0,
    }
  }
  return tool.run(input, ctx)
}

export {
  keywordQuickWinsTool,
  aiVisibilityTool,
  contentGapsTool,
  backlinkOverviewTool,
  coreWebVitalsTool,
  pageSeoAuditTool,
  contentQualityTool,
  keywordResearchTool,
}
