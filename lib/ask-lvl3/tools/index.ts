import type Anthropic from '@anthropic-ai/sdk'
import { logError } from '@/lib/logging'
import type { AskTool, ToolExecutionContext } from './types'
import { gscTools } from './gsc'
import { ga4Tools } from './ga4'
import { keywordTools } from './keywords'
import { semrushTools } from './semrush'
import { crawlTools } from './crawl'
import { pagespeedTools } from './pagespeed'
import { gbpTools } from './gbp'
import { spreadsheetTools } from './spreadsheet'

export type { AskTool, ToolExecutionContext, OAuthClient, ToolStorageContext } from './types'

/** Registry of every Ask LVL3 tool, in the order presented to the model. */
export const ASK_TOOLS: AskTool[] = [
  ...gscTools,
  ...ga4Tools,
  ...keywordTools,
  ...semrushTools,
  ...crawlTools,
  ...pagespeedTools,
  ...gbpTools,
  ...spreadsheetTools,
]

/** Anthropic tool definitions, derived from the registry. */
export const TOOL_DEFINITIONS: Anthropic.Tool[] = ASK_TOOLS.map((t) => t.definition)

/** Streaming status line shown while each tool runs. */
export const TOOL_STATUS_MAP: Record<string, string> = Object.fromEntries(
  ASK_TOOLS.map((t) => [t.definition.name, t.status]),
)

const toolsByName = new Map(ASK_TOOLS.map((t) => [t.definition.name, t]))

/**
 * Execute a tool by name. Never throws — tool failures come back as
 * "Tool error (...)" strings the model can read and recover from.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<string> {
  const tool = toolsByName.get(name)
  if (!tool) return `Unknown tool: ${name}`
  try {
    return await tool.handler(input, ctx)
  } catch (err) {
    // Extract the specific Google API error reason if available
    type GaxiosErr = { response?: { data?: { error?: { message?: string; errors?: Array<{ reason?: string }> } } } }
    const googleMsg = (err as GaxiosErr)?.response?.data?.error?.message
    const googleReason = (err as GaxiosErr)?.response?.data?.error?.errors?.[0]?.reason
    const baseMsg = err instanceof Error ? err.message : String(err)
    const detail = googleMsg ?? baseMsg
    logError('ask-lvl3.tool', `${name} failed`, { input, detail, reason: googleReason })
    return `Tool error (${name}): ${detail}${googleReason ? ` (${googleReason})` : ''}`
  }
}
