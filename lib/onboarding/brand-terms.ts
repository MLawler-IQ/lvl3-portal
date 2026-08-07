// The one place brand terms are derived.
//
// Why this exists: the same guess was already being made twice, at read time,
// and thrown away each time.
//
//   - lib/tools/callable/ai-visibility.ts builds [slug, domain token, name] and
//     tags the result termsSource:'heuristic'.
//   - lib/google-search-console.ts:defaultBrandToken independently derives a
//     single token from the domain — and gets it wrong for multi-part TLDs
//     ("shop.brand.co.uk" → "co"), where the ai-visibility version is right.
//
// Two implementations that can disagree, neither persisted, neither reviewable —
// the same duplication-buys-a-disagreement pattern this repo already hit with
// four copies of slugify. This module is the superset of both and is meant to
// replace them: both call sites keep their behaviour (name, slug and domain
// token are all still derived) and pick up the multi-part-TLD fix for free.
//
// Pure. No I/O, no 'use server', no LLM — a guess dressed up by a model is still
// a guess, and this one has to be auditable by a human reading the review pane.
//
// ── THE OVER-CAPTURE PROBLEM (the reason this file is careful) ────────────────
//
// The matcher downstream is a SUBSTRING test: ai-visibility.ts:55 does
// `q.includes(term)`, and fetchGSCBrandedSplit does the same. So a term is not a
// label, it is a filter over every query the client ranks for.
//
// For a generic-word brand — Apex, Summit, Tornado, Comfort Air — a bare token
// marks "tornado damage repair" as BRANDED. That inflates branded share and
// understates the non-branded opportunity the audit exists to find. It is
// backwards, it is invisible (the split still renders, it is just wrong), and it
// is worse than having no terms at all: with no terms the tools say "guessed"
// and a human goes and sets them.
//
// Two defences, both deliberate:
//
//   1. A candidate that would over-capture is NOT PROPOSED. It goes into
//      `withheld` with a reason, so the strategist can see the word we refused
//      to guess with and add it back knowingly. Silence about it would be the
//      dangerous option; refusing to emit it and saying so is not.
//
//   2. The confidence is `'low'`, BY CONSTRUCTION — the field is typed as the
//      literal, so no caller can raise it. schema.ts:isFilled counts an
//      auto/high value as answered and an auto/low value as a suggestion the
//      human still has to confirm. Nothing in this file is read from an account:
//      it is inference from a name and a URL about how strangers type a business
//      into Google. That never earns 'high'. A wrong high-confidence brand term
//      would silently corrupt every branded/non-branded split downstream, and
//      would do it while reading as confirmed.

import { normalizeDomain } from '@/lib/normalize-domain'

/**
 * Bare tokens shorter than this are never proposed. Under substring matching a
 * short token is a fragment of longer words — "air" is inside "repair", "ace"
 * is inside "furnace" — so it tags unrelated queries as branded. The same
 * 4-character floor discover.ts:matchGa4 already uses for "is this a meaningful
 * name signal at all".
 */
export const MIN_BARE_TOKEN_LENGTH = 4

/** slotValueSchema caps `evidence` at 300 chars, and an over-long evidence makes
 *  sanitizeAnswerPatch drop the WHOLE answer. Cheaper to cap here than to lose
 *  the seeded slot to a validation rule nobody sees fail. */
const EVIDENCE_MAX = 300

/**
 * The vocabulary of the service itself: trades, the objects they act on, and the
 * words a searcher who has never heard of the client would type. These are
 * exactly the words of the NON-branded queries the audit exists to find.
 *
 * Kept as its own list because the phrase rule below needs it separately from
 * the wider ambiguous list: a phrase made entirely of service words IS a service
 * phrase ("comfort air" is inside "comfort air conditioning"), whereas a phrase
 * that mixes an ordinary name word with a trade word is a brand phrase
 * ("tornado hvac" — which is one of the real, human-confirmed brand terms on the
 * Tornado account).
 */
const SERVICE_WORDS = [
  'air', 'heat', 'heating', 'cool', 'cooling', 'hvac', 'furnace', 'boiler',
  'duct', 'ducts', 'vent', 'vents', 'plumbing', 'plumber', 'plumbers', 'drain',
  'drains', 'sewer', 'septic', 'water', 'well', 'electric', 'electrical',
  'electrician', 'solar', 'roof', 'roofing', 'roofer', 'siding', 'gutter',
  'gutters', 'window', 'windows', 'door', 'doors', 'garage', 'fence', 'fencing',
  'deck', 'concrete', 'masonry', 'chimney', 'insulation', 'painting', 'painter',
  'flooring', 'carpet', 'glass', 'appliance', 'appliances', 'pest', 'lawn',
  'landscape', 'landscaping', 'tree', 'pool', 'spa', 'cleaning', 'clean',
  'restoration', 'remodel', 'remodeling', 'repair', 'repairs', 'service',
  'services', 'mechanical', 'maintenance', 'install', 'installation',
  'contractor', 'contractors', 'home', 'house', 'comfort', 'climate', 'energy',
  'power', 'emergency', 'conditioning', 'sales', 'company', 'and', 'the', 'of',
] as const

/** See SERVICE_WORDS. Exported for the phrase rule's tests. */
export const SERVICE_VOCABULARY: ReadonlySet<string> = new Set(SERVICE_WORDS)

/**
 * Words that appear in ordinary, NON-branded search queries and are also common
 * in home-services brand names. A BARE token that is one of these cannot
 * distinguish a branded query from a service query, so it is never proposed on
 * its own.
 *
 * Selection rule: a word belongs here if a searcher who has never heard of the
 * client would plausibly type it. That is why "phoenix" (a city), "viking" (an
 * appliance manufacturer) and "tornado" (a thing that damages roofs) are listed
 * next to "plumbing".
 *
 * This list is a FLOOR, not a guarantee — no offline list can cover every city
 * name and every dictionary word. It is why the confidence ceiling is 'low' and
 * why a human still confirms the list; the list just stops the obvious, common
 * cases from being proposed with a straight face.
 */
export const AMBIGUOUS_BRAND_WORDS: ReadonlySet<string> = new Set([
  ...SERVICE_WORDS,

  // Positioning words a business adopts as a name and a searcher also types.
  'apex', 'summit', 'peak', 'pinnacle', 'premier', 'premium', 'elite', 'pro',
  'pros', 'prime', 'first', 'best', 'top', 'quality', 'reliable', 'trusted',
  'expert', 'experts', 'master', 'masters', 'superior', 'advantage', 'advanced',
  'choice', 'select', 'direct', 'express', 'rapid', 'speedy', 'quick', 'fast',
  'precision', 'integrity', 'legacy', 'liberty', 'patriot', 'american',
  'national', 'united', 'general', 'standard', 'classic', 'custom', 'complete',
  'total', 'ultimate', 'absolute', 'action', 'star', 'stars', 'safe', 'value',
  'affordable', 'discount', 'budget', 'local', 'family', 'brothers', 'sons',

  // Weather and nature words that are also ordinary query words. This is the
  // Tornado case: "tornado damage repair" is not a branded query.
  'tornado', 'storm', 'thunder', 'lightning', 'hurricane', 'breeze', 'arctic',
  'polar', 'frost', 'frozen', 'ice', 'flame', 'fire', 'eagle', 'falcon',
  'phoenix', 'titan', 'atlas', 'viking', 'oak', 'pine', 'cedar', 'maple',
  'river', 'lake', 'creek', 'ridge', 'valley', 'mountain', 'hill', 'hills',
  'coast', 'coastal', 'harbor', 'park', 'springs', 'heights',

  // Bare geography. A direction or a "city" in a query says nothing about which
  // business the searcher meant.
  'north', 'south', 'east', 'west', 'northern', 'southern', 'eastern',
  'western', 'central', 'city', 'town', 'county', 'state', 'metro', 'area',
  'region',
])

/**
 * Trailing legal suffixes. Stripping them produces an ADDITIONAL variant — the
 * full name is always kept too — because nobody searches "tornado hvac inc" but
 * the registered name is what ends up in the clients table.
 */
const LEGAL_SUFFIXES: ReadonlySet<string> = new Set([
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation',
  'company', 'plc', 'pllc', 'lp', 'llp', 'pc', 'pa',
])

/** Multi-part TLDs, so `brand.co.uk` yields "brand" and not "co". */
const MULTI_PART_TLD: ReadonlySet<string> = new Set([
  'co', 'com', 'org', 'net', 'gov', 'ac', 'edu',
])

export interface BrandTermsInput {
  name?: string | null
  slug?: string | null
  /** Anything normalizeDomain accepts: a URL, a bare host, or an sc-domain property. */
  websiteUrl?: string | null
}

export interface BrandTermsDerivation {
  /** De-duplicated, lowercased, trimmed, no empties. May be empty. */
  terms: string[]
  /**
   * Always 'low', and typed as the literal so it cannot be widened at a call
   * site. See the over-capture note at the top of this file: a derived list is
   * never a fact, and auto/high counts as answered.
   */
  confidence: 'low'
  /** The one-word brand token, whether or not it was proposed. '' if none. */
  bareToken: string
  /** Candidates deliberately not proposed, with the reason, for the review pane. */
  withheld: { term: string; reason: string }[]
  /** True when anything was withheld for over-capture — the signal that this
   *  client's brand words are ordinary search words. */
  overCaptureRisk: boolean
  /** Provenance sentence for the slot, ≤ 300 chars. */
  evidence: string
}

/** Fold accents to ASCII: "café" → "cafe". Same NFKD trick as lib/slug.ts. */
function fold(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Punctuation a searcher never types, written out as an explicit class rather
 * than `\p{P}` because this file has to compile to the repo's TS target, which
 * predates unicode property escapes (tsconfig sets no `target`).
 *
 * `&` and `'` are deliberately absent — they survive, because they do occur in
 * real typed queries ("b&b heating", "o'brien plumbing").
 */
const PUNCTUATION = /[.,;:!?"“”„«»()[\]{}<>/\\|@#$%^*+=~`_\-–—…]+/g

/**
 * At least one letter, in any script that is not an emoji. Surrogate-pair
 * characters (emoji, which start at \uD800) fall outside every range here, so an
 * emoji-only name produces no proposable term.
 */
const HAS_LETTER = /[a-zA-Z\u00c0-\u024f\u0370-\u1fff\u3040-\ud7ff]/

/** Lowercase, strip punctuation, collapse whitespace. */
function cleanPhrase(raw: string): string {
  return (raw ?? '')
    .normalize('NFKC')
    .replace(/[‘’ʼ]/g, "'") // curly apostrophes → straight
    .toLowerCase()
    .replace(PUNCTUATION, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(^[&' ]+)|([&' ]+$)/g, '')
    .trim()
}

/** Drop a leading "the" and trailing legal suffixes. */
function stripCorporateFurniture(phrase: string): string {
  let words = phrase.split(' ').filter(Boolean)
  if (words.length > 1 && words[0] === 'the') words = words.slice(1)
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words = words.slice(0, -1)
  return words.join(' ')
}

/**
 * The registrable label of a domain, subdomain-safe.
 *
 * shop.brand.com → "brand", brand.co.uk → "brand", tornadohvacca.com →
 * "tornadohvacca". This is ai-visibility's brandTokenFromSite; the GSC copy
 * returns "co" for the multi-part-TLD case, which is the disagreement this
 * module exists to end.
 */
export function registrableLabel(websiteOrDomain: string): string {
  const labels = normalizeDomain(websiteOrDomain ?? '').split('.').filter(Boolean)
  if (labels.length <= 2) return labels[0] ?? ''
  const secondToLast = labels[labels.length - 2]
  return MULTI_PART_TLD.has(secondToLast) ? (labels[labels.length - 3] ?? '') : secondToLast
}

/**
 * Why a candidate must not be proposed, or null if it is safe enough to suggest.
 *
 * Exported because the review pane wants to explain a withheld term, and because
 * this is the rule most worth testing directly.
 */
export function overCaptureReason(term: string): string | null {
  const words = term.split(' ').filter(Boolean)
  if (words.length === 0) return 'empty'

  // Digits, symbols and emoji are not a brand term — they are a substring that
  // would match on punctuation and numerals across unrelated queries. A name in
  // a script with no letters this recognises lands here too, visibly withheld
  // rather than silently proposed.
  if (!HAS_LETTER.test(term)) return 'has no letters, so it would match arbitrary queries'

  if (words.length === 1) {
    const w = words[0]
    if (w.length < MIN_BARE_TOKEN_LENGTH) {
      return `under ${MIN_BARE_TOKEN_LENGTH} characters, so as a substring it matches inside unrelated words`
    }
    if (AMBIGUOUS_BRAND_WORDS.has(w)) {
      return 'an ordinary search word, so on its own it would mark non-branded queries as branded'
    }
    return null
  }

  // A multi-word phrase is normally safe — "tornado hvac" rarely turns up by
  // accident, and it is one of the human-confirmed brand terms on the Tornado
  // account, so the rule here must NOT withhold it.
  //
  // The exception is a phrase made entirely of SERVICE vocabulary: "comfort air"
  // is a substring of "comfort air conditioning", so a real HVAC brand named
  // Comfort Air would swallow its own non-branded queries. That is narrower than
  // "all words are ambiguous" on purpose — a name word plus a trade word reads
  // as a brand, two trade words read as a service.
  if (words.every((w) => SERVICE_VOCABULARY.has(w))) {
    return 'every word in it is ordinary service vocabulary, so it would mark non-branded queries as branded'
  }
  return null
}

function capEvidence(s: string): string {
  return s.length <= EVIDENCE_MAX ? s : `${s.slice(0, EVIDENCE_MAX - 1).trimEnd()}…`
}

/**
 * Derive the brand terms to PROPOSE for a client.
 *
 * Superset of both existing derivations:
 *   - the client name (ai-visibility used it raw)
 *   - the slug (ai-visibility used it raw, hyphens and all)
 *   - the registrable domain label (both used it; only one got multi-part TLDs right)
 * plus the variants those two never produced: the name without its legal suffix,
 * an accent-folded form, and the run-together form of a hyphenated slug/domain,
 * which is how people actually type a domain into search.
 *
 * The hyphenated slug itself is NOT proposed: search queries are space-separated,
 * so a term containing a hyphen can only ever match a query nobody types. The
 * case is still covered — by the spaced and run-together forms of the same slug.
 */
export function deriveBrandTerms(input: BrandTermsInput): BrandTermsDerivation {
  const name = cleanPhrase(input.name ?? '')
  const nameCore = stripCorporateFurniture(name)
  const slugRaw = (input.slug ?? '').trim().toLowerCase()
  const slugPhrase = cleanPhrase(slugRaw.replace(/[-_]+/g, ' '))
  const slugRun = cleanPhrase(slugRaw.replace(/[-_]+/g, ''))
  const label = registrableLabel(input.websiteUrl ?? '')
  const labelPhrase = cleanPhrase(label.replace(/[-_]+/g, ' '))
  const labelRun = cleanPhrase(label.replace(/[-_]+/g, ''))

  // The single word a searcher would use for the business: the first word of the
  // name, falling back to the slug, falling back to the domain label.
  const bareToken =
    (nameCore || slugPhrase).split(' ').filter(Boolean)[0] ?? labelRun ?? ''

  // Order matters only for the review pane: most specific first, so the
  // strategist reads the full name before the fragments.
  const candidates = [
    name,
    fold(name),
    nameCore,
    fold(nameCore),
    slugPhrase,
    fold(slugPhrase),
    labelPhrase,
    slugRun,
    labelRun,
    bareToken,
  ]

  const seen = new Set<string>()
  const terms: string[] = []
  const withheld: { term: string; reason: string }[] = []
  let overCaptureRisk = false

  for (const raw of candidates) {
    const term = raw.trim()
    if (!term || seen.has(term)) continue
    seen.add(term)

    const reason = overCaptureReason(term)
    if (reason) {
      withheld.push({ term, reason })
      overCaptureRisk = true
      continue
    }
    terms.push(term)
  }

  const from = [
    name ? 'the client name' : '',
    slugPhrase ? 'the slug' : '',
    label ? `the domain ${label}` : '',
  ].filter(Boolean)

  const evidence =
    terms.length === 0 && withheld.length === 0
      ? 'No client name, slug or website to guess brand terms from.'
      : capEvidence(
          `Guessed from ${from.join(', ') || 'the client record'} — not read from any account. ` +
            'Terms match queries by substring, so confirm the list before the branded split uses it.' +
            (withheld.length > 0
              ? ` Withheld ${withheld
                  .slice(0, 2)
                  .map((w) => `"${w.term}"`)
                  .join(' and ')} — ${
                  withheld.length === 1 ? 'it would' : 'they would'
                } tag non-branded queries as branded.`
              : ''),
        )

  return { terms, confidence: 'low', bareToken, withheld, overCaptureRisk, evidence }
}
