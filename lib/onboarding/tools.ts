// The interview's only tool.
//
// The model gets exactly one capability: record what it was told. It cannot read
// data, cannot score anything, and cannot decide the interview is finished —
// computeCompleteness owns that. Keeping the surface this small is the whole
// point (AUTOMATION-CONTEXT.md failure mode #7, "letting the LLM creep").
//
// Follows the AskTool contract from lib/ask-lvl3/tools/types.ts: a native
// Anthropic.Tool definition, a status line for the stream, and a handler that
// returns a string and never throws for an expected failure.

import type Anthropic from '@anthropic-ai/sdk'
import { SLOTS, sanitizeAnswerPatch, type Answers } from './schema'

export const RECORD_ANSWERS_TOOL: Anthropic.Tool = {
  name: 'record_answers',
  description: `Record what the client told you. Call this as soon as you learn something — do not wait until the end of the conversation.

Send only the slots you actually learned about in the last exchange. This is a partial patch: slots you omit keep their previous value.

Never guess a value. If the client was vague, ask a follow-up instead of recording a guess. If the client genuinely does not know or will not say, record that slot with unknown: true and a short reason — that is tracked as a known gap, which is useful, whereas a guess is harmful.

Available slot ids:
${SLOTS.map((s) => `- ${s.id} (${s.kind}${s.required ? ', required' : ', optional'}) — ${s.label}: ${s.questionHint}`).join('\n')}

For "choice" slots, the value must be exactly one of the allowed options:
${SLOTS.filter((s) => s.kind === 'choice')
  .map((s) => `- ${s.id}: ${s.choices?.join(' | ')}`)
  .join('\n')}`,
  input_schema: {
    type: 'object' as const,
    properties: {
      answers: {
        type: 'object',
        description:
          'Map of slot id to { value, unknown?, reason? }. value may be a string, number, boolean, or array of strings depending on the slot kind. Use null with unknown: true when the client cannot answer.',
        additionalProperties: {
          type: 'object',
          properties: {
            value: {
              description: 'The answer. Null only when unknown is true.',
            },
            unknown: {
              type: 'boolean',
              description: 'True when the client genuinely does not know or will not say.',
            },
            reason: {
              type: 'string',
              description: 'Why it is unknown. Required when unknown is true.',
            },
          },
          required: ['value'],
        },
      },
    },
    required: ['answers'],
  },
}

export const RECORD_ANSWERS_STATUS = 'Recording what you told me…'

export interface RecordResult {
  /**
   * The complete answer map after applying the patch — ALWAYS the full map,
   * never just the delta, and never empty when `current` wasn't.
   *
   * This shape is deliberate. An earlier version returned only the applied
   * delta, which meant a rejected patch returned `{}` and the caller — which
   * assigns this straight onto its `answers` variable and persists it — wiped
   * every previously recorded answer. Returning the merged map makes the safe
   * behaviour the default rather than something each caller has to remember.
   */
  answers: Answers
  /** Slot ids that were actually written. Empty when nothing valid was sent. */
  appliedIds: string[]
  /** Slot ids the model sent that were rejected, so it can see and correct them. */
  rejected: string[]
  /** Model-readable summary, returned as the tool_result content. */
  message: string
}

/**
 * Apply a patch from the model. Pure — the caller owns persistence, so this
 * stays unit-testable and the route keeps its single write path.
 */
export function applyRecordAnswers(input: Record<string, unknown>, current: Answers): RecordResult {
  const raw = input.answers
  const requested =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? Object.keys(raw as Record<string, unknown>)
      : []

  const patch = sanitizeAnswerPatch(raw)
  const appliedIds = Object.keys(patch)
  const rejected = requested.filter((id) => !appliedIds.includes(id))

  if (appliedIds.length === 0) {
    return {
      answers: current,
      appliedIds: [],
      rejected,
      message:
        rejected.length > 0
          ? `Recorded nothing. These were not valid: ${rejected.join(', ')}. Use only the slot ids listed in the tool description, and for choice slots use one of the allowed options exactly.`
          : 'Recorded nothing — the patch was empty.',
    }
  }

  const parts = [`Recorded: ${appliedIds.join(', ')}.`]
  if (rejected.length > 0) {
    parts.push(
      `Rejected (not valid slot ids or values): ${rejected.join(', ')}. Check the allowed ids and choice values.`,
    )
  }

  return {
    answers: { ...current, ...patch },
    appliedIds,
    rejected,
    message: parts.join(' '),
  }
}
