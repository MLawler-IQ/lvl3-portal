// The onboarding slot schema. This file is the spec of the phase: it defines
// what a complete client context is, and therefore what the interview has to
// cover before it can be reviewed.
//
// Division of labour (deliberate, see the plan's "Reconciling the two choices"):
//   - The MODEL owns sequencing and phrasing. It decides what to ask next.
//   - THIS FILE owns coverage. computeCompleteness() is a pure function and is
//     the only thing that can move a session to ready_for_review.
//
// So the model can never decide it is finished, and can never mark a slot as
// answered when it wasn't told the answer.

import { z } from 'zod'
import { CLIENT_TYPES, type ClientType } from '@/lib/dashboard/types'

/**
 * One recorded answer. `unknown: true` means the client genuinely doesn't know
 * (or won't say) — which must not deadlock the interview, but must never read
 * as answered either. Same distinction the pipeline draws between `not_run` and
 * `pass`: a gap you can see is safe, a gap that looks like a pass is not.
 */
export const slotValueSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
  unknown: z.boolean().default(false),
  reason: z.string().max(500).optional(),
  recordedAt: z.string().optional(),

  // Provenance. Same envelope shape the iiq-preextract intake tool already
  // returns ({ value, confidence, source, evidence }), so a ported extractor
  // drops in without reshaping anything.
  //
  // 'auto' means the portal matched it against Google's own APIs rather than
  // being told it. Surfaced in the review pane with its evidence so a wrong
  // match is visible instead of merely plausible.
  //
  // 'context' means a model inferred it from pasted notes or a transcript. It
  // carries evidence so a human can check it, but it never counts as answered —
  // see isFilled. 'manual' means an admin typed it into settings, which is an
  // explicit override and does count.
  source: z.enum(['interview', 'auto', 'context', 'manual']).optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  evidence: z.string().max(300).optional(),
})

export type SlotValue = z.infer<typeof slotValueSchema>

/** The draft blob stored in client_onboarding_sessions.answers. */
export const answersSchema = z.record(z.string(), slotValueSchema)
export type Answers = z.infer<typeof answersSchema>

export type SlotGroup = 'business' | 'geography' | 'operations' | 'brand' | 'access'

export interface Slot {
  id: string
  label: string
  group: SlotGroup
  /** Shown to the model as guidance on what to actually ask. */
  questionHint: string
  /**
   * The downstream consumer this feeds. The doc's rule for the audit rubric —
   * "if a check cannot name the outcome it protects, it gets deleted" — applied
   * to intake: a slot that can't name who needs it does not belong here.
   */
  why: string
  required: boolean
  /** Which clients.* column this promotes to, if any. */
  promotesTo?: string
  kind: 'text' | 'number' | 'list' | 'choice'
  choices?: readonly string[]
}

/**
 * The slots. Context slots come from AUTOMATION-CONTEXT.md §13; access slots are
 * the fields the old ClientSettingsForm collected, which this interview replaces
 * as the intake path.
 */
export const SLOTS: readonly Slot[] = [
  // ── Business reality ──────────────────────────────────────────────────────
  {
    id: 'services_by_revenue',
    label: 'Services ranked by revenue',
    group: 'business',
    questionHint:
      'Which services actually make the money, in order? Not what the website lists — what pays the bills.',
    why: 'Opportunity sizing weights keywords by the service they feed. Without this the pipeline ranks by search volume, which is how you end up optimising a service the client barely sells.',
    required: true,
    kind: 'list',
  },
  {
    id: 'avg_job_value',
    label: 'Average job value per service',
    group: 'business',
    questionHint:
      'Roughly what does a completed job bill for, per service? A range is fine. Ask for the top 3 services at minimum.',
    why: 'THE missing number. Turns every traffic forecast into a revenue model — without it the pipeline can only forecast clicks, which no client cares about.',
    required: true,
    kind: 'text',
  },
  {
    id: 'seasonality',
    label: 'Seasonality and pre-season timing',
    group: 'business',
    questionHint:
      'When does demand spike, and how far ahead do you need content and coverage live for it?',
    why: 'Sets scheduling for content and campaign work. Publishing AC content in June is late.',
    required: true,
    kind: 'text',
  },

  // ── Geography ─────────────────────────────────────────────────────────────
  {
    id: 'service_radius',
    label: 'Real service radius and cities',
    group: 'geography',
    questionHint:
      'Where do technicians actually drive? Name the real cities and the furthest you will go — not the aspirational list.',
    why: 'The Tornado pilot had pages targeting Orange County from a Sherman Oaks address 45-65 miles away. A service-area business ranks by proximity to its real address, so this catches the whole class of wasted location pages on day one.',
    required: true,
    kind: 'list',
  },
  {
    id: 'gbp_service_areas_confirmed',
    label: 'GBP service areas confirmed',
    group: 'geography',
    questionHint:
      'Read back the service areas listed on the Google Business Profile and confirm they match reality.',
    why: 'LOCAL-016 (service-area radius coherence) needs this, and the audit cannot fully read the declared area list from the API.',
    required: true,
    kind: 'text',
  },

  // ── Operations ────────────────────────────────────────────────────────────
  {
    id: 'lead_handling',
    label: 'What happens after the phone rings',
    group: 'operations',
    questionHint:
      'Who answers the phone, during and after hours? What happens to a web form? Is anything tracked?',
    why: 'Home-services phone leads convert at ~46% on the call. Outcome reporting is impossible without knowing where a lead lands, and it scopes the call-tracking gap.',
    required: true,
    kind: 'text',
  },
  {
    id: 'prior_vendor_work',
    label: 'Prior vendor work, and attachment to it',
    group: 'operations',
    questionHint:
      'What did the last agency build? Is the client attached to any of it? Ask specifically about bulk-generated pages.',
    why: 'Would have surfaced Tornado\'s 130 AI-generated service pages immediately. Consolidation is the highest-impact fix and it is politically impossible to plan without knowing what the client is proud of.',
    required: true,
    kind: 'text',
  },
  {
    id: 'approval_authority',
    label: 'Who approves changes',
    group: 'operations',
    questionHint:
      'Who signs off on site changes, and what specifically needs sign-off versus what we can just do?',
    why: 'Gates tier-1 agent execution later. Also decides whether a recommendation can ship at all.',
    required: true,
    kind: 'text',
  },
  {
    id: 'cms_hosting',
    label: 'CMS and hosting reality',
    group: 'operations',
    questionHint:
      'What is the site built on, who hosts it, and who has admin access? WordPress version and page builder if known.',
    why: 'Decides DFY-versus-handoff for every recommendation, and whether the WordPress plugin path is available.',
    required: true,
    kind: 'text',
  },

  // ── Brand ─────────────────────────────────────────────────────────────────
  {
    id: 'brand_constraints',
    label: 'Brand constraints and forbidden language',
    group: 'brand',
    questionHint:
      'Any words, claims or comparisons you will not use? Licensing or warranty language you must include?',
    why: 'Grounds content generation and keeps drafts inside what the client will actually approve, which is what makes the draft gate cheap to clear.',
    required: false,
    kind: 'text',
  },

  // ── Access (this interview replaces the intake form) ───────────────────────
  {
    id: 'client_type',
    label: 'Dashboard type',
    group: 'access',
    questionHint:
      'Confirm the business model. Pre-filled from connected data — just confirm or correct it.',
    why: 'Drives the whole type-aware dashboard module set. Null means the client sees the generic dashboard and every local module stays dark.',
    required: true,
    promotesTo: 'client_type',
    kind: 'choice',
    choices: CLIENT_TYPES,
  },
  {
    id: 'ga4_property_id',
    label: 'GA4 property ID',
    group: 'access',
    questionHint: 'Numeric property ID only, not "properties/123".',
    why: 'Every outcome metric. Without it the pipeline reports traffic, not results.',
    required: true,
    promotesTo: 'ga4_property_id',
    kind: 'text',
  },
  {
    id: 'gsc_site_url',
    label: 'Search Console property',
    group: 'access',
    questionHint: 'Either "https://example.com/" or "sc-domain:example.com".',
    why: 'First-party ranking truth, and the base for cannibalisation and opportunity analysis.',
    required: true,
    promotesTo: 'gsc_site_url',
    kind: 'text',
  },
  {
    id: 'gbp_account_id',
    label: 'Google Business Profile account',
    group: 'access',
    questionHint: 'GBP resource name, "accounts/123456".',
    why: 'Local pack visibility, which for a home-services business is the revenue centre of gravity.',
    required: false,
    promotesTo: 'gbp_account_id',
    kind: 'text',
  },
  {
    id: 'gbp_location_group',
    label: 'GBP location group',
    group: 'access',
    questionHint: 'Only if the GBP account has several groups or labels — which one is this client?',
    why: 'Scopes GBP calls to one client. Without it a multi-client account returns locations aggregated across every client, with no identifiers to separate them.',
    required: false,
    promotesTo: 'gbp_location_group',
    kind: 'text',
  },
  {
    id: 'competitors',
    label: 'Competitors',
    group: 'access',
    questionHint: 'Who do you actually lose jobs to? Domains if known.',
    why: 'Competitive module and gap analysis. Client-named competitors beat tool-inferred ones.',
    required: false,
    promotesTo: 'competitors',
    kind: 'list',
  },
  {
    id: 'brand_terms',
    label: 'Branded search terms',
    group: 'access',
    questionHint:
      'How do customers actually type the business name — including misspellings and shorthand?',
    why: 'Splits branded from non-branded search. Tornado was 89% branded, which is the difference between "traffic is fine" and "we rank for nothing we sell".',
    required: false,
    promotesTo: 'brand_terms',
    kind: 'list',
  },
  {
    id: 'key_event_names',
    label: 'GA4 key events that count as a lead',
    group: 'access',
    questionHint:
      'Which GA4 events represent a real lead — a call, a form, a booking? Exact event names if known.',
    why: 'Outcome reporting. Counting the wrong event is how a dashboard shows conversions that nobody in the business recognises.',
    required: false,
    promotesTo: 'key_event_names',
    kind: 'list',
  },
  {
    id: 'google_sheet_id',
    label: 'Client-facing tracker sheet',
    group: 'access',
    questionHint: 'Paste the Google Sheet URL if this client has a shared tracker.',
    why: 'Feeds the project tracker view. Paste the URL — it is normalised to an id on approval.',
    required: false,
    promotesTo: 'google_sheet_id',
    kind: 'text',
  },
] as const

export const REQUIRED_SLOT_IDS: readonly string[] = SLOTS.filter((s) => s.required).map((s) => s.id)

export const SLOTS_BY_ID: ReadonlyMap<string, Slot> = new Map(SLOTS.map((s) => [s.id, s]))

/**
 * Coerce whatever the model sent into a valid slot map, dropping anything that
 * isn't a known slot and anything that fails the value schema.
 *
 * Follows the enforcement precedent in app/actions/recommendations.ts:190-195 —
 * the prompt instruction is not trusted; membership is checked in code. An
 * invented slot id is silently dropped rather than erroring, so one bad key
 * can't fail an otherwise good turn.
 */
export function sanitizeAnswerPatch(patch: unknown): Answers {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return {}
  const out: Answers = {}
  for (const [key, raw] of Object.entries(patch as Record<string, unknown>)) {
    const slot = SLOTS_BY_ID.get(key)
    if (!slot) continue // not a real slot — drop it
    const parsed = slotValueSchema.safeParse(raw)
    if (!parsed.success) continue
    const v = parsed.data

    // A choice slot may only hold one of its declared choices. Same subset
    // enforcement as the competitor screen: normalize, then check membership.
    if (slot.kind === 'choice' && v.value !== null && !v.unknown) {
      const candidate = String(v.value).trim()
      if (!slot.choices?.includes(candidate)) continue
    }

    out[key] = { ...v, recordedAt: v.recordedAt ?? new Date().toISOString() }
  }
  return out
}

/**
 * Is a slot recorded as an explicit gap? Requires a reason — an `unknown` with
 * no reason is a gap nobody can interpret three months later, which defeats the
 * point of recording it instead of guessing.
 */
export function isKnownGap(v: SlotValue | undefined): boolean {
  return v?.unknown === true && (v.reason ?? '').trim().length > 0
}

/**
 * Is this slot actually answered?
 *
 * `unknown` is a visible gap, never an answer. A LOW-confidence auto match is a
 * suggestion, not an answer either — it is shown pre-filled with its evidence,
 * but it still counts as missing until a human confirms it. A high-confidence
 * auto match does count: it is a fact read from the agency's own Google account,
 * not a guess.
 *
 * A `context` value NEVER counts, at any confidence. That is the whole point of
 * the source: a model reading a meeting transcript is guessing, however fluently,
 * and the distinction this function exists to protect is between a fact we read
 * and a sentence we generated. It is shown pre-filled with the quote it came
 * from, and a human promotes it by confirming it — which records it as
 * `interview` or `manual`, and only then does it count.
 */
export function isFilled(v: SlotValue | undefined): boolean {
  if (!v) return false
  if (v.unknown) return false
  if (v.source === 'context') return false
  if (v.source === 'auto' && v.confidence === 'low') return false
  if (v.value === null) return false
  if (typeof v.value === 'string') return v.value.trim().length > 0
  if (Array.isArray(v.value)) return v.value.filter((s) => s.trim().length > 0).length > 0
  return true
}

export function clientTypeFromAnswers(answers: Answers): ClientType | null {
  const v = answers['client_type']
  if (!isFilled(v)) return null
  const raw = String(v!.value).trim()
  return CLIENT_TYPES.includes(raw as ClientType) ? (raw as ClientType) : null
}
