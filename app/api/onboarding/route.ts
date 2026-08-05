// Conversational onboarding: the interview loop.
//
// Forked from app/api/ask-lvl3/route.ts, which is the proven template for a
// streaming agentic loop in this codebase. Same NDJSON protocol, same auth
// preamble, same clear_partial retraction, same persist-user-before-call
// ordering.
//
// Two deliberate differences:
//   1. One tool (record_answers) instead of thirteen, and it only writes.
//   2. The system prompt is rebuilt every turn from computeCompleteness(), so
//      the model always knows what is still missing — and the route, not the
//      model, decides when the session is ready for review.

import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { MODEL_SONNET } from '@/lib/ai/models'
import { computeCompleteness, describeGapsForPrompt } from '@/lib/onboarding/completeness'
import { answersSchema, type Answers } from '@/lib/onboarding/schema'
import {
  RECORD_ANSWERS_STATUS,
  RECORD_ANSWERS_TOOL,
  applyRecordAnswers,
} from '@/lib/onboarding/tools'
import { logError } from '@/lib/logging'

const requestSchema = z.object({
  sessionId: z.string().min(1),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(120),
})

const MAX_ITERATIONS = 6

export async function POST(req: NextRequest) {
  // ── All cookie-dependent calls MUST happen before the ReadableStream ─────────
  // cookies() from next/headers is unavailable inside ReadableStream callbacks,
  // and requireAdmin() would redirect() rather than return a status code.
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
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured' }),
      { status: 500 },
    )
  }

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 })
  }
  const parsed = requestSchema.safeParse(rawBody)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: `Invalid request: ${parsed.error.issues[0]?.message ?? 'malformed body'}`,
      }),
      { status: 400 },
    )
  }
  const { sessionId, messages } = parsed.data

  // ── Stream ────────────────────────────────────────────────────────────────────
  const encoder = new TextEncoder()

  function emit(controller: ReadableStreamDefaultController, obj: object) {
    controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const { data: session } = await service
          .from('client_onboarding_sessions')
          .select('id, client_id, status, answers')
          .eq('id', sessionId)
          .single()

        if (!session) {
          emit(controller, { type: 'error', message: 'Onboarding session not found' })
          controller.close()
          return
        }
        if (session.status === 'approved') {
          emit(controller, {
            type: 'error',
            message: 'This session is already approved. Start a new one to re-interview.',
          })
          controller.close()
          return
        }

        const { data: client } = await service
          .from('clients')
          .select('name, gsc_site_url, ga4_property_id, gbp_account_id, client_type')
          .eq('id', session.client_id)
          .single()

        if (!client) {
          emit(controller, { type: 'error', message: 'Client not found' })
          controller.close()
          return
        }

        // Answers live in the DB, not in the request — the client never gets to
        // tell us what has been recorded.
        let answers: Answers = answersSchema.safeParse(session.answers).data ?? {}

        // Persist the user turn before calling the model, so it survives a
        // generation failure.
        const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
        if (lastUserMsg) {
          await service.from('client_onboarding_messages').insert({
            session_id: sessionId,
            role: 'user',
            content: lastUserMsg.content,
          })
        }

        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
        const loopMessages: Anthropic.MessageParam[] = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }))

        let assistantText = ''

        for (let i = 0; i < MAX_ITERATIONS; i++) {
          // Rebuilt every iteration: after a record_answers call the gap list has
          // changed, and the model needs the new one to pick its next question.
          const alreadyKnown = [
            client.ga4_property_id ? `GA4 property already on file: ${client.ga4_property_id}` : null,
            client.gsc_site_url ? `Search Console property already on file: ${client.gsc_site_url}` : null,
            client.gbp_account_id ? `GBP account already on file: ${client.gbp_account_id}` : null,
            client.client_type ? `Dashboard type currently set to: ${client.client_type}` : null,
          ].filter(Boolean)

          const systemPrompt = `You are running a client onboarding interview for LVL3, an SEO agency. You are talking to an LVL3 strategist who is on a call with the client, or relaying what the client said. Your job is to get the context the SEO pipeline needs and record it.

Client: ${client.name}

${alreadyKnown.length > 0 ? `Already configured (confirm rather than re-ask):\n${alreadyKnown.join('\n')}\n` : ''}
${describeGapsForPrompt(answers)}

How to run this:
- Ask about ONE topic at a time. Two short questions at most per message.
- Call record_answers the moment you learn something. Do not batch it to the end.
- Never record a guess. If an answer is vague ("we cover the whole area"), ask for specifics ("which cities, and what is the furthest you will drive?").
- If the client genuinely does not know, record the slot with unknown: true and a short reason, then move on. A known gap is useful; an invented answer is not.
- Explain briefly why you need something when it is not obvious — average job value in particular, because people are cautious about revenue questions. Say it is what lets us forecast revenue rather than just traffic.
- Keep your turns short and conversational. No preamble, no bullet-point interrogations, no restating everything you already know.
- Do not tell the strategist the interview is complete or ready for review. The portal decides that from the recorded answers and shows it on screen.

You have no ability to look anything up. Everything you record must come from what you were just told.`

          const streamObj = anthropic.messages.stream({
            model: MODEL_SONNET,
            max_tokens: 2048,
            system: systemPrompt,
            tools: [RECORD_ANSWERS_TOOL],
            messages: loopMessages,
          })

          let isToolIteration = false
          let partialText = ''

          for await (const event of streamObj) {
            if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
              if (!isToolIteration) {
                isToolIteration = true
                // Retract any text streamed before the tool call was detected.
                if (partialText) {
                  emit(controller, { type: 'clear_partial' })
                  assistantText = assistantText.slice(0, assistantText.length - partialText.length)
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

          if (finalMsg.stop_reason === 'tool_use') {
            loopMessages.push({ role: 'assistant', content: finalMsg.content })
            const toolBlocks = finalMsg.content.filter((b) => b.type === 'tool_use')

            const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []

            for (const block of toolBlocks) {
              if (block.type !== 'tool_use') continue

              if (block.name !== RECORD_ANSWERS_TOOL.name) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: `Unknown tool: ${block.name}. The only tool available is ${RECORD_ANSWERS_TOOL.name}.`,
                })
                continue
              }

              emit(controller, { type: 'status', text: RECORD_ANSWERS_STATUS })

              const previousAnswers = answers
              const result = applyRecordAnswers(block.input as Record<string, unknown>, answers)
              answers = result.answers

              // Nothing valid was sent — tell the model what was wrong and skip
              // the write entirely rather than re-persisting an unchanged map.
              if (result.appliedIds.length === 0) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: result.message,
                })
                continue
              }

              const completeness = computeCompleteness(answers)

              // Single write path for the draft. Status is derived here, never
              // taken from the model.
              const { error: saveErr } = await service
                .from('client_onboarding_sessions')
                .update({
                  answers,
                  status: completeness.readyForReview ? 'ready_for_review' : 'in_progress',
                  updated_at: new Date().toISOString(),
                })
                .eq('id', sessionId)

              if (saveErr) {
                logError('onboarding.save', 'Failed to persist answers', {
                  sessionId,
                  detail: saveErr.message,
                })
                // Roll the in-memory draft back to what is actually in the
                // database, so the `done` event and the review pane never show
                // answers that were not persisted.
                answers = previousAnswers
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: `Error saving: ${saveErr.message}. Tell the strategist the answer was not saved and to try again.`,
                  is_error: true,
                })
                continue
              }

              // Send the answers too, not just coverage: the review pane needs
              // the actual values, and inventing a placeholder for it risked an
              // admin approving that placeholder into ga4_property_id. This is
              // an admin-only surface, so the draft is safe to send.
              emit(controller, { type: 'completeness', completeness, answers })
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: result.message,
              })
            }

            loopMessages.push({ role: 'user', content: toolResults })
            continue
          }

          // end_turn, or any other stop reason — the turn is over either way.
          if (assistantText) {
            await service.from('client_onboarding_messages').insert({
              session_id: sessionId,
              role: 'assistant',
              content: assistantText,
            })
          }
          emit(controller, {
            type: 'done',
            completeness: computeCompleteness(answers),
            answers,
          })
          controller.close()
          return
        }

        // Max iterations: the model kept calling the tool without ever replying.
        const fallback =
          'I recorded what I could, but lost track of the conversation. Everything saved so far is on the right — carry on and ask the next question yourself, or start a fresh session.'
        emit(controller, { type: 'text', delta: fallback })
        await service.from('client_onboarding_messages').insert({
          session_id: sessionId,
          role: 'assistant',
          content: fallback,
        })
        emit(controller, {
          type: 'done',
          completeness: computeCompleteness(answers),
          answers,
        })
        controller.close()
      } catch (err) {
        logError('onboarding.stream', 'Interview turn failed', {
          sessionId,
          detail: err instanceof Error ? err.message : String(err),
        })
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
