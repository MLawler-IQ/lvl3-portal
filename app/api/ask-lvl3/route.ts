import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getAdminOAuthClient } from '@/lib/google-auth'
import { getAdminGBPOAuthClient } from '@/lib/gbp-auth'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { OAuth2Client } from 'google-auth-library'
import { normalizeDomain } from '@/lib/normalize-domain'
import {
  TOOL_DEFINITIONS,
  TOOL_STATUS_MAP,
  executeTool,
  type OAuthClient,
} from '@/lib/ask-lvl3/tools'
import type { ChatArtifact } from '@/app/actions/ask-lvl3'

function today(): string {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10)
}

// ── Request validation ────────────────────────────────────────────────────────

const requestSchema = z.object({
  clientId: z.string().min(1),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
        artifacts: z.array(z.unknown()).optional(),
      }),
    )
    .min(1),
  conversationId: z.string().min(1).optional(),
})

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── All cookie-dependent calls MUST happen before the ReadableStream ─────────
  // cookies() from next/headers is unavailable inside ReadableStream callbacks.

  // 1. Auth check
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const service = await createServiceClient()
  const { data: profile } = await service
    .from('users')
    .select('role, status')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
  }
  if (profile.status === 'deactivated') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
  }

  // 2. Pre-fetch OAuth client (calls createServiceClient → cookies internally)
  let oauthClient: OAuthClient
  try {
    oauthClient = await getAdminOAuthClient()
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Google account not connected',
      }),
      { status: 500 }
    )
  }

  // GBP uses a separate OAuth token. Pre-fetch so cookies() isn't called inside the stream.
  // If GBP isn't connected, GBP tools will return a friendly error; everything else still works.
  let gbpOAuthClient: OAuth2Client | null = null
  try {
    gbpOAuthClient = await getAdminGBPOAuthClient()
  } catch {
    gbpOAuthClient = null
  }

  // 3. Parse + validate body
  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 })
  }
  const parsed = requestSchema.safeParse(rawBody)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: `Invalid request: ${parsed.error.issues[0]?.message ?? 'malformed body'}` }),
      { status: 400 }
    )
  }
  const { clientId, messages, conversationId: incomingConvId } = parsed.data

  // ── Stream ────────────────────────────────────────────────────────────────────
  const encoder = new TextEncoder()

  function emit(controller: ReadableStreamDefaultController, obj: object) {
    controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Fetch client row — uses pre-created service client (no new cookies() call)
        const { data: client } = await service
          .from('clients')
          .select('name, gsc_site_url, ga4_property_id, analytics_summary, snapshot_insights')
          .eq('id', clientId)
          .single()

        if (!client) {
          emit(controller, { type: 'error', message: 'Client not found' })
          controller.close()
          return
        }

        // Build system prompt
        const contextParts: string[] = [
          `Client: ${client.name}`,
          `Today's date: ${today()}`,
          `GSC site: ${client.gsc_site_url ?? 'not configured'}`,
          `GA4 property: ${client.ga4_property_id ?? 'not configured'}`,
        ]

        if (client.analytics_summary) {
          contextParts.push(`Stored Analytics Summary:\n${client.analytics_summary}`)
        }

        if (client.snapshot_insights) {
          const si = client.snapshot_insights as {
            takeaways?: string
            anomalies?: string
            opportunities?: string
          }
          if (si.takeaways) contextParts.push(`Key Takeaways: ${si.takeaways}`)
          if (si.anomalies) contextParts.push(`Anomalies: ${si.anomalies}`)
          if (si.opportunities) contextParts.push(`Opportunities: ${si.opportunities}`)
        }

        const clientDomain = client.gsc_site_url ? normalizeDomain(client.gsc_site_url) : ''

        const systemPrompt = `You are Ask LVL3, an expert SEO and digital marketing strategist for the agency LVL3, advising the internal team on a specific client.

${contextParts.join('\n\n')}

Client domain: ${clientDomain || 'not configured'}

You have 13 tools available to fetch live data:
- get_gsc_data: Query Google Search Console (keywords, pages, clicks, impressions, rankings)
- get_ga4_data: Query Google Analytics 4 (sessions, users, traffic, revenue, landing pages)
- get_keyword_data: Look up search volume, CPC, competition, and trends for specific keywords
- get_related_keywords: Find related/long-tail keywords for a seed term
- get_domain_visibility: Semrush organic visibility (keyword count, traffic estimate, top keywords)
- get_competitor_gap: Find keywords a competitor ranks for that this client doesn't
- crawl_page_seo: On-page SEO audit of a URL (title, meta, headings, images, structured data)
- get_core_web_vitals: PageSpeed Insights + Core Web Vitals for a URL
- get_backlink_overview: Semrush backlink profile (total backlinks, referring domains, authority score)
- list_gbp_accounts: List Google Business Profile accounts the agency has access to (call first for any GBP question)
- get_gbp_locations: Fetch and audit all GBP locations under an account (NAP, hours, categories, completeness score)
- get_gbp_insights: Pull GBP performance metrics (impressions, calls, website clicks, direction requests, bookings) for one or more locations over a date range
- create_spreadsheet: Generate a downloadable .xlsx file from structured data. Use AFTER fetching data with other tools when the user wants to export, download, or get a spreadsheet/CSV/Excel file.

When a question requires data, use the tools to fetch it rather than saying you don't have it.
When the user asks to export data, download a spreadsheet, or get an Excel file, first fetch the data with the appropriate tool, then call create_spreadsheet with the results formatted as headers and rows.
For trend or comparison questions, call the tool twice — once for the current period and once for the prior period — then calculate the delta yourself.
Tools that accept a domain default to "${clientDomain || 'the client domain'}" when not specified.
Be specific and direct. Skip preamble. Lead with the actual answer, then support it with data.`

        // Upsert conversation
        let conversationId: string = incomingConvId ?? ''
        if (!conversationId) {
          const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
          const title = lastUserMsg ? lastUserMsg.content.slice(0, 80) : 'New conversation'
          const { data: conv } = await service
            .from('ask_lvl3_conversations')
            .insert({ client_id: clientId, title })
            .select('id')
            .single()
          conversationId = conv?.id ?? ''
        } else {
          await service
            .from('ask_lvl3_conversations')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', conversationId)
        }

        // Insert the new user message (last in array)
        const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
        if (lastUserMsg && conversationId) {
          await service.from('ask_lvl3_messages').insert({
            conversation_id: conversationId,
            role: 'user',
            content: lastUserMsg.content,
          })
        }

        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

        const loopMessages: Anthropic.MessageParam[] = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }))

        const MAX_ITERATIONS = 6
        let assistantText = ''
        const allArtifacts: ChatArtifact[] = []

        for (let i = 0; i < MAX_ITERATIONS; i++) {
          const streamObj = anthropic.messages.stream({
            model: 'claude-sonnet-4-6',
            max_tokens: 4096,
            system: systemPrompt,
            tools: TOOL_DEFINITIONS,
            messages: loopMessages,
          })

          let isToolIteration = false
          let partialText = '' // text emitted this iteration; cleared if tool_use detected

          for await (const event of streamObj) {
            if (
              event.type === 'content_block_start' &&
              event.content_block.type === 'tool_use'
            ) {
              if (!isToolIteration) {
                isToolIteration = true
                // Clear any thinking text streamed before detecting tool_use
                if (partialText) {
                  emit(controller, { type: 'clear_partial' })
                  assistantText = assistantText.slice(
                    0,
                    assistantText.length - partialText.length
                  )
                  partialText = ''
                }
              }
            }
            if (
              !isToolIteration &&
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              partialText += event.delta.text
              assistantText += event.delta.text
              emit(controller, { type: 'text', delta: event.delta.text })
            }
          }

          const finalMsg = await streamObj.finalMessage()

          if (finalMsg.stop_reason === 'end_turn') {
            if (conversationId && assistantText) {
              await service.from('ask_lvl3_messages').insert({
                conversation_id: conversationId,
                role: 'assistant',
                content: assistantText,
                artifacts: allArtifacts.length > 0 ? allArtifacts : [],
              })
            }
            emit(controller, { type: 'done', conversationId })
            controller.close()
            return
          }

          if (finalMsg.stop_reason === 'tool_use') {
            loopMessages.push({ role: 'assistant', content: finalMsg.content })

            const toolBlocks = finalMsg.content.filter((b) => b.type === 'tool_use')

            // Emit status before executing tools
            for (const block of toolBlocks) {
              if (block.type !== 'tool_use') continue
              const statusText = TOOL_STATUS_MAP[block.name] ?? `Running ${block.name}…`
              emit(controller, { type: 'status', text: statusText })
            }

            // Execute tools in parallel using the pre-built oauthClient
            const collectedArtifacts: ChatArtifact[] = []
            const toolResults = await Promise.all(
              toolBlocks.map(async (block) => {
                if (block.type !== 'tool_use') return null
                const result = await executeTool(block.name, block.input as Record<string, unknown>, {
                  client: { gsc_site_url: client.gsc_site_url, ga4_property_id: client.ga4_property_id },
                  auth: oauthClient,
                  gbpAuth: gbpOAuthClient,
                  storage: { service, clientId, conversationId },
                })

                // Detect artifact results and emit download event
                try {
                  const parsed = JSON.parse(result)
                  if (parsed?.artifact === true && parsed.url) {
                    const artifact: ChatArtifact = {
                      path: parsed.path,
                      filename: parsed.filename,
                      mimeType: parsed.mimeType,
                    }
                    collectedArtifacts.push(artifact)
                    emit(controller, {
                      type: 'artifact',
                      path: parsed.path,
                      filename: parsed.filename,
                      mimeType: parsed.mimeType,
                      url: parsed.url,
                    })
                  }
                } catch {
                  // Not JSON or not an artifact — fine
                }

                return {
                  type: 'tool_result' as const,
                  tool_use_id: block.id,
                  content: result,
                }
              })
            )

            allArtifacts.push(...collectedArtifacts)

            loopMessages.push({
              role: 'user',
              content: toolResults.filter(
                Boolean
              ) as Anthropic.Messages.ToolResultBlockParam[],
            })

            continue
          }

          // Unexpected stop reason — close out
          emit(controller, { type: 'done', conversationId })
          controller.close()
          return
        }

        // Hit max iterations — emit fallback
        const fallback =
          'I ran into repeated errors fetching the data and was unable to complete your request. ' +
          "This usually means the GSC or GA4 data source is unavailable or the date range returned no results. " +
          "Try a simpler question, or check that the client's GSC site URL and GA4 property are configured correctly in client settings."
        emit(controller, { type: 'text', delta: fallback })
        if (conversationId) {
          await service.from('ask_lvl3_messages').insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: fallback,
          })
        }
        emit(controller, { type: 'done', conversationId })
        controller.close()
      } catch (err) {
        emit(controller, {
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to get response',
        })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
    },
  })
}
