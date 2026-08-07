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
//   3. A DROP MUST BE EXPLAINABLE. Rules 1 and 2 throw work away silently, which
//      is right for the batch and wrong for the person watching. In production a
//      strategist imported a Zoom call, got "no suggestions were made", and could
//      not tell a broken feature from an empty call — the source was a 964-char
//      AI summary of an introductions call, so the extractor was correct, but it
//      had no way to say so. The result therefore carries its own account of
//      what happened: how many candidates the model proposed, how many survived,
//      why the rest did not, and a sentence a UI can render verbatim. That
//      sentence is built HERE rather than in the components, so the paste path
//      and the Zoom path cannot describe the same outcome two different ways.
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
import {
  CONTEXT_ITEM_KINDS,
  isParaphraseKind,
  type ContextItem,
  type ContextItemKind,
} from './context-items'

// Re-exported so server-side callers keep a single import site.
export { CONTEXT_ITEM_KINDS }
export type { ContextItem, ContextItemKind }

/** Why a proposed value was thrown away. The raw reason code, not user copy. */
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

/** One reason, with everything a caller needs to say "3 of these, because X". */
export interface RejectionGroup {
  reason: RejectionReason
  count: number
  /** The slots that hit this reason, in rejection order. Repeats are kept. */
  slotIds: string[]
  /**
   * The group as a ready-to-print phrase WITH the count already in it — "2
   * quoted words that are not in the source". Count-inclusive because the
   * singular and plural forms differ ("1 was not readable" / "3 were not
   * readable"), and a component stitching a number onto a fixed string is
   * exactly the kind of local copy logic that let the two intake paths drift.
   */
  phrase: string
}

/**
 * What happened, at the granularity a person actually needs.
 *
 * The whole point of this union is that the three ways to get zero suggestions
 * are NOT the same event and must not share a sentence:
 *
 *   nothing_proposed — the model read the material and proposed nothing. The
 *                      source genuinely does not answer the open questions.
 *   all_rejected     — the model proposed values and every one failed a check.
 *                      We know precisely why, and the user should be told.
 *   unparseable      — we could not read the model's reply. Our fault, retryable.
 *
 * `not_attempted` is the fourth zero: the model was never called, because there
 * was no readable text or nothing left to ask about.
 */
export type ExtractionOutcome =
  | 'suggested'
  | 'nothing_proposed'
  | 'all_rejected'
  | 'unparseable'
  | 'not_attempted'

export interface ExtractionResult {
  /** Slot map, every entry `source: 'context'`. Merge as suggestions only. */
  answers: Answers
  /** Slot ids that produced a surviving suggestion. */
  accepted: string[]
  /**
   * Every dropped candidate, with its reason and offending detail. Kept
   * alongside the grouped view because a prompt regression is diagnosed from
   * the detail, not from the counts.
   */
  rejected: Rejection[]
  /** True when the model returned something this module could not parse at all. */
  unparseable: boolean
  /**
   * How many candidates the model proposed.
   *
   * Counted where the list is read rather than derived from accepted + rejected,
   * because those two do not have to add up: if the model proposes the same slot
   * twice and both pass, the second overwrites the first and one candidate
   * vanishes from both tallies. `proposed` is what the model actually said.
   */
  proposed: number
  /** `rejected` collapsed by reason, most common first. */
  rejectedByReason: RejectionGroup[]
  outcome: ExtractionOutcome
  /**
   * One or two sentences describing this result, safe to render as-is. Built
   * here so every caller tells the user the same story.
   */
  summary: string
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

/**
 * The strongest confidence a suggestion may carry when its quote came from a
 * paraphrase kind (today: an AI meeting summary).
 *
 * The quote is real — it is a literal span of the summary — but the summary is
 * itself a machine's retelling of a call, so the value is second-hand however
 * cleanly it reads. Capping here rather than trusting the prompt is the same
 * precedent as everything else in this file: the prompt asks, the code enforces.
 */
const PARAPHRASE_MAX_CONFIDENCE: Confidence = 'medium'

// ── Reporting ─────────────────────────────────────────────────────────────────

/**
 * Each reason as a clause that completes "N proposed values ...".
 *
 * Written for the strategist who pasted the thing, not for us: "quoted words
 * that are not in the source" tells them the model made something up, where
 * `evidence_not_in_source` tells them nothing and looks like a crash. Both
 * numbers are spelled out because several of these do not survive a naive
 * pluralisation — "3 was not readable as a suggestion".
 */
const REASON_LABELS: Record<RejectionReason, { one: string; many: string }> = {
  unknown_slot: {
    one: 'named a question that does not exist',
    many: 'named questions that do not exist',
  },
  already_answered: {
    one: 'answered a question that is already filled in',
    many: 'answered questions that are already filled in',
  },
  unknown_source_item: {
    one: 'cited a source that was not sent to it',
    many: 'cited sources that were not sent to it',
  },
  missing_evidence: {
    one: 'came with no quote at all',
    many: 'came with no quote at all',
  },
  evidence_not_in_source: {
    one: 'quoted words that are not in the source',
    many: 'quoted words that are not in the source',
  },
  wrong_type: {
    one: 'gave the wrong kind of value for the question',
    many: 'gave the wrong kind of value for their question',
  },
  invalid_choice: {
    one: 'picked an option the question does not offer',
    many: 'picked options their question does not offer',
  },
  malformed: {
    one: 'was not readable as a suggestion',
    many: 'were not readable as suggestions',
  },
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Collapse rejections by reason, most common first, ties broken by name. */
export function groupRejections(rejected: readonly Rejection[]): RejectionGroup[] {
  const byReason = new Map<RejectionReason, string[]>()
  for (const r of rejected) {
    const slotIds = byReason.get(r.reason)
    if (slotIds) slotIds.push(r.slotId)
    else byReason.set(r.reason, [r.slotId])
  }

  return Array.from(byReason.entries())
    .map(([reason, slotIds]) => ({
      reason,
      count: slotIds.length,
      slotIds,
      phrase: plural(slotIds.length, REASON_LABELS[reason].one, REASON_LABELS[reason].many),
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
}

/** "2 quoted words that are not in the source, 1 was not readable…" */
function listReasons(groups: readonly RejectionGroup[]): string {
  return groups.map((g) => g.phrase).join(', ')
}

/**
 * The note that would have saved the production incident: the import succeeded,
 * the extractor was right, and the material was an AI summary of an
 * introductions call. Only added when EVERY item read was a paraphrase kind —
 * with a real transcript in the batch this would be blaming the wrong source.
 */
function paraphraseNote(items: readonly ContextItem[]): string {
  if (items.length === 0 || !items.every((i) => isParaphraseKind(i.kind))) return ''
  return items.length === 1
    ? ' This was an AI meeting summary rather than a transcript, and a summary usually records what a call was about rather than the specific facts these questions ask for.'
    : ' These were AI meeting summaries rather than transcripts, and a summary usually records what a call was about rather than the specific facts these questions ask for.'
}

/**
 * The sentence the UI shows. Lives here, not in the components, so the paste
 * path and the Zoom path cannot drift into describing the same outcome
 * differently — the drift that made the original failure unreadable.
 */
export function summarizeExtraction(input: {
  outcome: ExtractionOutcome
  proposed: number
  acceptedCount: number
  rejectedByReason: readonly RejectionGroup[]
  items: readonly ContextItem[]
  openSlotCount: number
}): string {
  const { outcome, proposed, acceptedCount, rejectedByReason, items, openSlotCount } = input
  const read = plural(items.length, 'item', 'items')
  const open = plural(openSlotCount, 'open question', 'open questions')

  switch (outcome) {
    case 'not_attempted':
      // Two different nothings, and the difference is the whole message.
      return items.length === 0
        ? 'There was no readable text here, so nothing was read.'
        : `Every question is already answered, so there was nothing left to look for in ${read}.`

    case 'unparseable':
      return 'The model replied with something this tool could not read as suggestions, so nothing was added. That is a fault on our side rather than a problem with the material — retry the extraction.'

    case 'nothing_proposed':
      return (
        `Read ${read} against ${open} and the model proposed nothing at all — ` +
        `it found no statement here that answers any of them.` +
        paraphraseNote(items)
      )

    case 'all_rejected':
      return (
        `The model proposed ${plural(proposed, 'value', 'values')} from ${read}, ` +
        `and every one failed a check, so nothing was added: ${listReasons(rejectedByReason)}.` +
        paraphraseNote(items)
      )

    case 'suggested': {
      const kept = `The model proposed ${plural(proposed, 'value', 'values')} from ${read}; ${acceptedCount} became ${acceptedCount === 1 ? 'a suggestion' : 'suggestions'} to confirm.`
      return rejectedByReason.length === 0
        ? kept
        : `${kept} Dropped: ${listReasons(rejectedByReason)}.`
    }
  }
}

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

  const itemsById = new Map(items.map((i) => [i.id, i]))
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
    const sourceItem = itemsById.get(sourceItemId)
    if (sourceItem === undefined) {
      rejected.push({ slotId, reason: 'unknown_source_item', detail: sourceItemId })
      continue
    }

    // NOTE ON SUMMARIES. This check is NOT relaxed for a paraphrase kind, and
    // the reason is worth stating because relaxing it looks reasonable: an AI
    // summary is paraphrase, so demanding a verbatim quote sounds unfair. It is
    // not. The quote is checked against THIS ITEM'S STORED TEXT — for a summary
    // that text is the summary, a document like any other, and any span of it
    // can be copied exactly. Nothing about a summary makes verbatim quotation
    // hard; what a summary changes is how much the quote proves, which is a
    // question of confidence (capped below), not of admissibility. A looser
    // match here would accept an invented citation against precisely the class
    // of source whose facts are already second-hand.
    if (!evidenceQuotesSource(evidence, sourceItem.body)) {
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

    const claimed: Confidence = CONFIDENCES.includes(e.confidence as Confidence)
      ? (e.confidence as Confidence)
      : 'low'

    // A genuine quote out of a machine's retelling of a call is still
    // second-hand, so it may not present itself as strongly as a quote of what
    // someone actually said. Downgrade only — a summary never raises confidence.
    const confidence: Confidence =
      isParaphraseKind(sourceItem.kind) && claimed === 'high'
        ? PARAPHRASE_MAX_CONFIDENCE
        : claimed

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

  const accepted = Object.keys(answers)
  const rejectedByReason = groupRejections(rejected)

  // The distinction the production incident turned on: an empty list from the
  // model means the material had nothing in it, while a list that was entirely
  // rejected means the model tried and we caught it. Same zero, different fact.
  const outcome: ExtractionOutcome =
    accepted.length > 0 ? 'suggested' : list.length === 0 ? 'nothing_proposed' : 'all_rejected'

  return {
    answers,
    accepted,
    rejected,
    proposed: list.length,
    rejectedByReason,
    outcome,
    summary: summarizeExtraction({
      outcome,
      proposed: list.length,
      acceptedCount: accepted.length,
      rejectedByReason,
      items,
      openSlotCount: allowedSlotIds.length,
    }),
  }
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

/**
 * What a quote out of each kind actually proves.
 *
 * `meeting_summary` exists as a separate kind because of this paragraph: until
 * it did, Zoom AI Companion summaries were stored as `meeting_transcript`, so
 * the model was told a note-taker's third-person prose was a record of what
 * people said, and had no way to weigh it differently. Note what this does NOT
 * say: it does not excuse a summary from verbatim quotation. The quote is
 * checked against the summary text itself, which can always be copied exactly.
 */
const KIND_GUIDANCE: Record<ContextItemKind, string> = {
  meeting_transcript:
    'a verbatim record of a call. A quote is what someone actually said, so it can carry "high".',
  meeting_summary:
    'an AI-written summary of a call — third-person paraphrase, not anyone\'s words. Quote it verbatim ANYWAY (your evidence must be a literal span of the summary text, and that is checked), but treat what it asserts as second-hand: use "medium" at best, and never fill in a detail the summary does not state.',
  email: 'written by a person. Quote it as-is.',
  note: 'written by a colleague, often shorthand. Quote it as-is.',
  web_page: "scraped page text. It is the client's marketing copy, not their testimony.",
  audit_run:
    'our own audit output — a machine reading of a crawl against a rubric. Quote it verbatim like anything else, but it is evidence about the SITE, not testimony about the BUSINESS: it can support a fact about what the site does, and never a fact about what the client wants, sells or has decided. If a question asks what the client thinks, this is not a source for it.',
}

export function buildExtractionPrompts(
  items: ContextItem[],
  slotIds: readonly string[],
): { system: string; user: string } {
  // Only describe the kinds actually present, so the model is not reasoning
  // about email rules while reading a transcript.
  const kindsPresent = CONTEXT_ITEM_KINDS.filter((k) => items.some((i) => i.kind === k))
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

What each kind of source is, and what a quote from it proves:
${kindsPresent.map((k) => `- ${k}: ${KIND_GUIDANCE[k]}`).join('\n')}

Questions still open:
${describeSlotsForPrompt(slotIds)}`

  const user = items
    .map((item) => {
      const header = [
        `id: ${item.id}`,
        `kind: ${item.kind}`,
        `about this kind: ${KIND_GUIDANCE[item.kind]}`,
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
    return emptyResult('not_attempted', usable, slotIds)
  }

  const { system, user } = buildExtractionPrompts(usable, slotIds)
  const text = await deps.callModel({ system, user })
  const raw = parseModelJson(text)
  if (raw === null) {
    return emptyResult('unparseable', usable, slotIds)
  }

  return { ...validateExtractions(raw, usable, slotIds), unparseable: false }
}

/**
 * A result with no suggestions in it, still able to explain itself.
 *
 * `unparseable` stays a plain boolean alongside `outcome` because it is the one
 * outcome that means "we failed", not "the material was thin" — callers that
 * only branch on failure should not have to know the whole union.
 */
function emptyResult(
  outcome: Extract<ExtractionOutcome, 'not_attempted' | 'unparseable'>,
  items: readonly ContextItem[],
  slotIds: readonly string[],
): ExtractionResult {
  return {
    answers: {},
    accepted: [],
    rejected: [],
    unparseable: outcome === 'unparseable',
    proposed: 0,
    rejectedByReason: [],
    outcome,
    summary: summarizeExtraction({
      outcome,
      proposed: 0,
      acceptedCount: 0,
      rejectedByReason: [],
      items,
      openSlotCount: slotIds.length,
    }),
  }
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
