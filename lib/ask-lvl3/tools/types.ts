import type Anthropic from '@anthropic-ai/sdk'
import type { OAuth2Client } from 'google-auth-library'
import type { createServiceClient } from '@/lib/supabase/server'
import type { getAdminOAuthClient } from '@/lib/google-auth'

export type OAuthClient = Awaited<ReturnType<typeof getAdminOAuthClient>>

export interface ToolClientInfo {
  gsc_site_url: string | null
  ga4_property_id: string | null
}

/** Storage context required by tools that persist artifacts (create_spreadsheet). */
export interface ToolStorageContext {
  service: Awaited<ReturnType<typeof createServiceClient>>
  clientId: string
  conversationId: string
}

export interface ToolExecutionContext {
  client: ToolClientInfo
  auth: OAuthClient
  gbpAuth: OAuth2Client | null
  storage?: ToolStorageContext
}

/** One Ask LVL3 tool: Anthropic definition + streaming status line + handler. */
export interface AskTool {
  definition: Anthropic.Tool
  status: string
  handler: (input: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<string>
}
