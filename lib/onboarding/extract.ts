// Context extraction: read pasted transcripts/emails/notes, propose slot values.
//
// The output of this module is ALWAYS `source: 'context'`, and isFilled() returns
// false for that source at every confidence (schema.ts). That is deliberate and
// permanent: a model reading a meeting transcript is guessing, however fluently,
// and this whole file exists to produce suggestions a human confirms — not
// answers. Nothing here can move a session to ready_for_review, and nothing here
// can reach clients.* without an admin approving it in the review pane.
//
// Two rules follow from that, and they are the substance of this file:
//
//   1. VALIDATION IS IN CODE, NOT IN THE PROMPT. Same precedent as
//      sanitizeAnswerPatch: the prompt asks nicely, the code enforces. An
//      invented slot id, a value of the wrong shape, or a choice outside its
//      declared options is dropped silently rather than failing the batch.
//
//   2. EVIDENCE MUST ACTUALLY QUOTE THE SOURCE. This is the check the existing
//      sanitizer does not do and could not: a fabricated quote is the exact
//      failure mode of extraction, and it is the one that looks most convincing
//      in the review pane. An admin skimming suggestions confirms the ones with
//      a plausible quote attached; if the quote can be invented, the human review
//      that the whole `context` source rests on is worth nothing. So the claimed
//      evidence is checked against the body of the item it claims to come from,
//      and anything that does not appear there is dropped.
//
// This lives in lib/, so no 'use server'. Model access is SERVER-SIDE ONLY: the
// Anthropic client is constructed behind createAnthropicExtractor(), which reads
// process.env.ANTHROPIC_API_KEY. An earlier version of this tool shipped an API
// key to the browser; the injectable `callModel` dependency also keeps tests off
// the network entirely.
//
// This module must not be imported by a client component — the SDK import below
// is module-scoped, so any such import puts it on a path into the browser
// bundle. The paste UI needs the item kinds, so those live in ./context-items,
// which imports nothing; see the note there.

import Anthropic from '@anthropic-ai/sdk'
import { MODEL_SONNET } from '@/lib/ai/models'
import {
  SLOTS,
  SLOTS_BY_ID,
  sanitizeAnswerPatch,
  type Answers,
  type Slot,
} from './schema'
import { CONTEXT_ITEM_KINDS, type ContextItem, type ContextItemKind } from './context-items'

// Re-exported so server-side callers keep a single import site.
export { CONTEXT_ITEM_KINDS }
export type { ContextItem, ContextItemKind }

/** Why a proposed value was thrown away. Surfaced for debugging, not to users. */
export type RejectionReason =
  | 'unknown_slot'
  | 'already_answered'
  | 'unknown_source_item'
  | 'missing_evidence'
  | 'evidence_not_in_source'
  | 'wrong_type'
  | 'invalid_choice'
  | 'malformed'

export interface Rejection {
  slotId: string
  reason: RejectionReason
  /** The offending detail, trimmed. Useful when a prompt change starts failing. */
  detail?: string
}

export interface ExtractionResult {
  /** Slot map, every entry `source: 'context'`. Merge as suggestions only. */
  answers: Answers
  /** Slot ids that produced a surviving suggestion. */
  accepted: string[]
  rejected: Rejection[]
  /** True when the model returned something this module could not parse at all. */
  unparseable: boolean
}

/**
 * The model call, injected. Takes a system + user prompt, returns raw text.
 * Tests pass a stub; production passes createAnthropicExtractor().
 */
export type CallModel = (args: { system: string; user: string }) => Promise<string>

/** Hard ceiling on characters of context sent in one call. */
const MAX_BODY_CHARS = 24_000

/** slotValueSchema caps evidence at 300; longer quotes are truncated, not dropped. */
const MAX_EVIDENCE_CHARS = 300

const CONFIDENCES = ['high', 'medium', 'low'] as const
type Confidence = (typeof CONFIDENCES)[number]

// ── Pure validation (where the bugs would be, so it is all directly testable) ──

/**
 * Normalize text for the quote check.
 *
 * Deliberately forgiving about things a model changes without changing meaning —
 * case, whitespace runs, line breaks, smart quotes and dashes — and deliberately
 * strict about everything else. A looser check (say, matching a few keywords)
 * would let a paraphrase through, and a paraphrase is exactly the fabrication
 * this is meant to catch.
 */
export function normalizeForQuoteCheck(s: string): string {
  return s
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Does `evidence` actually appear in `source`? */
export function evidenceQuotesSource(evidence: string, source: string): boolean {
  const needle = normalizeForQuoteCheck(evidence)
  if (needle.length === 0) return false
  return normalizeForQuoteCheck(source).includes(needle)
}

/**
 * Does this value match the shape the slot declares?
 *
 * sanitizeAnswerPatch validates the value against a union of every allowed type
 * and enforces choice membership, but it does NOT tie the type to the slot's
 * `kind` — a bare string passes for a `list` slot there. From the interview that
 * was tolerable, because a strategist was watching the model type it. From a
 * bulk extraction it is not: a list slot holding "HVAC, plumbing, drains" as one
 * string quietly breaks every consumer that iterates it.
 */
export function valueMatchesKind(slot: Slot, value: unknown): boolean {
  switch (slot.kind) {
    case 'list':
      return Array.isArray(value) && value.every((v) => typeof v === 'string')
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'choice':
      return typeof value === 'string'
    case 'text':
      return typeof value === 'string'
  }
}

interface RawExtraction {
  slotId: unknown
  value: unknown
  confidence: unknown
  evidence: unknown
  sourceItemId: unknown
}

/**
 * Turn whatever the model returned into validated `context` suggestions.
 *
 * Exported separately from extractSlotValues so the validation can be tested
 * without a prompt, a model, or a stub in the way.
 */
export function validateExtractions(
  raw: unknown,
  items: ContextItem[],
  allowedSlotIds: readonly string[],
): Omit<ExtractionResult, 'unparseable'> {
  const rejected: Rejection[] = []
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { extractions?: unknown }).extractions)
      ? ((raw as { extractions: unknown[] }).extractions)
      : []

  const bodiesById = new Map(items.map((i) => [i.id, i.body]))
  const allowed = new Set(allowedSlotIds)

  // Build a patch keyed by slot id, then hand it to the existing sanitizer for
  // the checks it already owns (unknown ids, the value schema, choice
  // membership) rather than reimplementing them here.
  const patch: Record<string, unknown> = {}
  const evidenceById = new Map<string, string>()

  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      rejected.push({ slotId: '(unnamed)', reason: 'malformed' })
      continue
    }
    const e = entry as unknown as RawExtraction
    const slotId = typeof e.slotId === 'string' ? e.slotId.trim() : ''
    if (!slotId) {
      rejected.push({ slotId: '(unnamed)', reason: 'malformed' })
      continue
    }

    const slot = SLOTS_BY_ID.get(slotId)
    if (!slot) {
      rejected.push({ slotId, reason: 'unknown_slot' })
      continue
    }

    // Only propose against slots that are actually still open. Re-suggesting an
    // answered slot is how a transcript would end up overwriting something a
    // human already confirmed.
    if (!allowed.has(slotId)) {
      rejected.push({ slotId, reason: 'already_answered' })
      continue
    }

    const evidence = typeof e.evidence === 'string' ? e.evidence.trim() : ''
    if (!evidence) {
      rejected.push({ slotId, reason: 'missing_evidence' })
      continue
    }

    // The item must be one we actually sent. A value attributed to an item id
    // that does not exist cannot be checked, and an unverifiable quote is
    // treated exactly like a false one.
    const sourceItemId = typeof e.sourceItemId === 'string' ? e.sourceItemId.trim() : ''
    const body = bodiesById.get(sourceItemId)
    if (body === undefined) {
      rejected.push({ slotId, reason: 'unknown_source_item', detail: sourceItemId })
      continue
    }

    if (!evidenceQuotesSource(evidence, body)) {
      rejected.push({
        slotId,
        reason: 'evidence_not_in_source',
        detail: evidence.slice(0, 120),
      })
      continue
    }

    if (!valueMatchesKind(slot, e.value)) {
      rejected.push({ slotId, reason: 'wrong_type', detail: typeof e.value })
      continue
    }

    const confidence: Confidence = CONFIDENCES.includes(e.confidence as Confidence)
      ? (e.confidence as Confidence)
      : 'low'

    patch[slotId] = {
      value: e.value,
      unknown: false,
      source: 'context',
      confidence,
      // Truncated rather than rejected: slotValueSchema caps evidence at 300
      // chars, and a good long quote is worth keeping in shortened form. The
      // quote check above ran against the full string, so nothing is smuggled
      // in by truncation.
      evidence:
        evidence.length > MAX_EVIDENCE_CHARS
          ? evidence.slice(0, MAX_EVIDENCE_CHARS - 1) + '…'
          : evidence,
    }
    evidenceById.set(slotId, evidence)
  }

  const answers = sanitizeAnswerPatch(patch)

  // Anything the sanitizer dropped that we passed it: currently only the
  // choice-membership rule, since kind and schema are checked above. Reported
  // rather than swallowed so a prompt regression is visible.
  for (const slotId of Object.keys(patch)) {
    if (!(slotId in answers)) {
      rejected.push({ slotId, reason: 'invalid_choice' })
    }
  }

  return { answers, accepted: Object.keys(answers), rejected }
}

// ── Prompting ─────────────────────────────────────────────────────────────────

function describeSlotsForPrompt(slotIds: readonly string[]): string {
  return SLOTS.filter((s) => slotIds.includes(s.id))
    .map((s) => {
      const choices = s.choices ? ` — one of: ${s.choices.join(' | ')}` : ''
      return `- ${s.id} (${s.kind})${choices}\n  ${s.label}: ${s.questionHint}`
    })
    .join('\n')
}

export function buildExtractionPrompts(
  items: ContextItem[],
  slotIds: readonly string[],
): { system: string; user: string } {
  const system = `You are reading raw client context for an SEO agency and pulling out facts that answer specific questions. You are NOT having a conversation and you are NOT summarising.

Return ONLY JSON, in exactly this shape:
{"extractions":[{"slotId":"...","value":...,"confidence":"high|medium|low","evidence":"...","sourceItemId":"..."}]}

Rules, all enforced in code — a violation means the item is discarded, not corrected:
- slotId must be one of the ids listed below. Nothing else.
- value must match the slot's type: "list" means an array of strings, "text" means a string, "number" means a number, "choice" means exactly one of the listed options.
- evidence must be a VERBATIM span copied from the source item you name in sourceItemId. Do not paraphrase, do not stitch two sentences together, do not clean up the grammar. If you cannot copy a literal span that supports the value, do not return the item at all.
- sourceItemId must be one of the item ids given below.
- Return nothing for a slot the context does not actually address. An empty array is a correct answer.
- confidence is about how directly the quote establishes the value, not how confident you feel.

Everything you return is shown to a human as a SUGGESTION to confirm. It never counts as an answer on its own, so a missing suggestion costs almost nothing and a fabricated one costs a lot.

Questions still open:
${describeSlotsForPrompt(slotIds)}`

  const user = items
    .map((item) => {
      const header = [
        `id: ${item.id}`,
        `kind: ${item.kind}`,
        item.title ? `title: ${item.title}` : null,
        item.occurredAt ? `occurred_at: ${item.occurredAt}` : null,
      ]
        .filter(Boolean)
        .join('\n')
      return `<context_item>\n${header}\n---\n${item.body.slice(0, MAX_BODY_CHARS)}\n</context_item>`
    })
    .join('\n\n')

  return { system, user }
}

/** Pull the first JSON object/array out of a model response. */
export function parseModelJson(text: string): unknown | null {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1].trim() : trimmed
  const start = candidate.search(/[[{]/)
  if (start === -1) return null
  const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'))
  if (end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Read the given context items and propose values for the still-open slots.
 *
 * Never throws for an expected failure: an unparseable response comes back as an
 * empty result with `unparseable: true`, because a failed extraction is a
 * visible no-op and must not take down the paste that triggered it.
 */
export async function extractSlotValues(
  items: ContextItem[],
  unansweredSlotIds: readonly string[],
  deps: { callModel: CallModel },
): Promise<ExtractionResult> {
  const usable = items.filter((i) => i.body.trim().length > 0)
  // Ignore any id the caller invented; the prompt must only ever list real slots.
  const slotIds = unansweredSlotIds.filter((id) => SLOTS_BY_ID.has(id))

  if (usable.length === 0 || slotIds.length === 0) {
    return { answers: {}, accepted: [], rejected: [], unparseable: false }
  }

  const { system, user } = buildExtractionPrompts(usable, slotIds)
  const text = await deps.callModel({ system, user })
  const raw = parseModelJson(text)
  if (raw === null) {
    return { answers: {}, accepted: [], rejected: [], unparseable: true }
  }

  return { ...validateExtractions(raw, usable, slotIds), unparseable: false }
}

/**
 * The production model call. SERVER-SIDE ONLY — it reads ANTHROPIC_API_KEY, so
 * importing this from a client component would ship the key to the browser.
 * Client components take the extraction result as data via a server action; they
 * never construct this.
 */
export function createAnthropicExtractor(apiKey = process.env.ANTHROPIC_API_KEY): CallModel {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured')
  const anthropic = new Anthropic({ apiKey })

  return async ({ system, user }) => {
    const res = await anthropic.messages.create({
      model: MODEL_SONNET,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
    })
    const block = res.content.find((b) => b.type === 'text')
    return block && block.type === 'text' ? block.text : ''
  }
}
