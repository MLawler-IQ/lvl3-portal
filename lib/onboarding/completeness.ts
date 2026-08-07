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
  /**
   * OPTIONAL slots not yet covered. Asked, but they do not gate review.
   *
   * The distinction the old code collapsed: "worth asking about" and "cannot
   * finish without" are different questions. Because the prompt was built from
   * `missing` alone, every optional slot was silently never asked — including
   * brand_terms, competitors and key_event_names, each of which writes a column
   * the portal actually reads. Meanwhile nine slots nothing read were required
   * and blocked every interview from ever completing.
   */
  optionalMissing: string[]
  /**
   * OPTIONAL slots the client explicitly could not answer, with a reason.
   *
   * Separate from `unknown` because these must NOT count toward required
   * coverage, but they are still worth keeping: "they don't track average job
   * value, because nobody measures it" is a fact about the client, and losing it
   * would be the cut quietly narrowing what we capture. `unknown` stayed
   * required-only when nine slots were required; with three, it would have made
   * recorded gaps almost always empty.
   */
  optionalUnknown: string[]
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
  const optionalMissing = slots
    .filter((s) => !s.required && s.state === 'empty')
    .map((s) => s.id)
  const optionalUnknown = slots
    .filter((s) => !s.required && s.state === 'unknown')
    .map((s) => s.id)

  return {
    slots,
    filled,
    unknown,
    missing,
    optionalMissing,
    optionalUnknown,
    pct: required.length === 0 ? 100 : Math.round((filled.length / required.length) * 100),
    readyForReview: missing.length === 0,
  }
}

/**
 * The still-missing slots, rendered for the system prompt. Rebuilt every turn so
 * the model always knows what is left without being told when to stop.
 */
export function describeGapsForPrompt(answers: Answers): string {
  const { slots, missing, unknown, optionalMissing, optionalUnknown } =
    computeCompleteness(answers)
  if (missing.length === 0 && unknown.length === 0 && optionalMissing.length === 0) {
    return 'Every topic is covered. Confirm anything that felt thin, then tell the strategist the interview is ready for review.'
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

  // Asked, but never blocking. Every one of these writes a column something in
  // the portal reads, so not asking them was strictly worse than asking and
  // getting no answer.
  if (optionalMissing.length > 0) {
    lines.push('')
    lines.push(
      'ALSO WORTH CAPTURING (ask when it fits the conversation; none of these blocks review):',
    )
    for (const id of optionalMissing) {
      const slot = SLOTS.find((s) => s.id === id)
      if (slot) lines.push(`- ${slot.id} — ${slot.label}. ${slot.questionHint}`)
    }
  }

  if (unknown.length > 0 || optionalUnknown.length > 0) {
    lines.push('')
    lines.push(
      'MARKED UNKNOWN (do not re-ask unless the conversation naturally reopens them):',
    )
    for (const id of [...unknown, ...optionalUnknown]) {
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
