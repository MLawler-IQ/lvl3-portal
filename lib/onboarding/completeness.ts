// Deterministic coverage. This is the guardrail that makes an LLM-driven
// interview safe: the model decides what to ask, this decides when it's done.
//
// No LLM, no I/O, no dates read from the environment — a pure function of the
// answers blob, so it is trivially unit-testable and is the regression gate for
// prompt changes.

import { SLOTS, isFilled, isKnownGap, type Answers, type Slot } from './schema'

export interface SlotStatus {
  id: string
  label: string
  group: Slot['group']
  required: boolean
  state: 'filled' | 'unknown' | 'empty'
  reason?: string
}

export interface Completeness {
  slots: SlotStatus[]
  /** Required slots with a real answer. */
  filled: string[]
  /** Required slots the client explicitly couldn't answer — visible gaps. */
  unknown: string[]
  /** Required slots not yet covered at all. */
  missing: string[]
  /** Percentage of required slots filled. Excludes `unknown` on purpose. */
  pct: number
  /**
   * True only when every required slot is either filled or marked unknown WITH
   * a reason. `unknown` is allowed to unblock review — a client who doesn't know
   * their average ticket shouldn't be able to deadlock onboarding — but it is
   * carried into the review screen and the approved context as a named gap, and
   * an unknown with no reason counts as empty rather than as a gap.
   */
  readyForReview: boolean
}

export function computeCompleteness(answers: Answers): Completeness {
  const slots: SlotStatus[] = SLOTS.map((slot) => {
    const v = answers[slot.id]
    const state: SlotStatus['state'] = isFilled(v)
      ? 'filled'
      : isKnownGap(v)
        ? 'unknown'
        : 'empty'
    return {
      id: slot.id,
      label: slot.label,
      group: slot.group,
      required: slot.required,
      state,
      ...(state === 'unknown' && v?.reason ? { reason: v.reason } : {}),
    }
  })

  const required = slots.filter((s) => s.required)
  const filled = required.filter((s) => s.state === 'filled').map((s) => s.id)
  const unknown = required.filter((s) => s.state === 'unknown').map((s) => s.id)
  const missing = required.filter((s) => s.state === 'empty').map((s) => s.id)

  return {
    slots,
    filled,
    unknown,
    missing,
    pct: required.length === 0 ? 100 : Math.round((filled.length / required.length) * 100),
    readyForReview: missing.length === 0,
  }
}

/**
 * The still-missing slots, rendered for the system prompt. Rebuilt every turn so
 * the model always knows what is left without being told when to stop.
 */
export function describeGapsForPrompt(answers: Answers): string {
  const { slots, missing, unknown } = computeCompleteness(answers)
  if (missing.length === 0 && unknown.length === 0) {
    return 'Every required topic is covered. Confirm anything that felt thin, then tell the strategist the interview is ready for review.'
  }

  const byId = new Map(slots.map((s) => [s.id, s]))
  const lines: string[] = []

  if (missing.length > 0) {
    lines.push('STILL NEEDED (ask about these, most important first):')
    for (const id of missing) {
      const slot = SLOTS.find((s) => s.id === id)!
      lines.push(`- ${slot.id} — ${slot.label}. ${slot.questionHint}`)
    }
  }

  if (unknown.length > 0) {
    lines.push('')
    lines.push(
      'MARKED UNKNOWN (do not re-ask unless the conversation naturally reopens them):',
    )
    for (const id of unknown) {
      const s = byId.get(id)
      lines.push(`- ${id}${s?.reason ? ` (${s.reason})` : ''}`)
    }
  }

  const covered = slots.filter((s) => s.state === 'filled').map((s) => s.id)
  if (covered.length > 0) {
    lines.push('')
    lines.push(`ALREADY ANSWERED (do not ask again): ${covered.join(', ')}`)
  }

  return lines.join('\n')
}
