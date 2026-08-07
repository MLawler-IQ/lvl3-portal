/**
 * Client slug derivation.
 *
 * A slug is a URL path segment (`/clients/acme-hvac`) and a human-typed key in
 * exports and support conversations, so it has to stay lowercase ASCII with no
 * surprises. Keep this module pure — it runs in the browser as the admin types
 * in the new-client modal, so it must not be a server action and must not touch
 * the database. Collision checking is done against a caller-supplied list.
 */

/**
 * Slugs live in URLs and in a `text` column with a unique index, so the cap is
 * about readability rather than storage. 48 leaves room for the `-2`, `-3`
 * disambiguation suffixes without producing a slug nobody can read aloud.
 */
export const MAX_SLUG_LENGTH = 48

/**
 * Some inputs contain no ASCII-able characters at all — an emoji-only name, a
 * name written entirely in a script that does not transliterate, or nothing but
 * punctuation. An empty slug would produce a broken `/clients/` route and a
 * unique-index collision the moment a second such client is created, so we fall
 * back to a fixed stem and let `uniqueSlug` number it (`client`, `client-2`, …).
 */
export const FALLBACK_SLUG = 'client'

/**
 * Normalize arbitrary text into a slug: ASCII-folded, lowercase, hyphen-joined.
 *
 * Accents are folded rather than dropped (`Café` → `cafe`, not `caf`) because a
 * dropped letter changes how the slug reads and admins retype these by hand.
 */
export function slugify(input: string): string {
  const folded = (input ?? '')
    // NFKD splits an accented letter into base + combining mark; stripping the
    // mark range then leaves the plain ASCII base letter behind.
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Everything that is not a-z0-9 collapses to a single hyphen, which covers
    // spaces, punctuation, emoji and any script that survived normalization.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!folded) return FALLBACK_SLUG

  // Trim trailing hyphens again: truncation can land mid-separator.
  const capped = folded.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '')
  return capped || FALLBACK_SLUG
}

/**
 * Slugify `input`, then append `-2`, `-3`, … until the result is not already in
 * `taken`. Comparison is case-insensitive because the slug column is matched
 * case-insensitively downstream and `Acme` must not be allowed to shadow `acme`.
 */
export function uniqueSlug(input: string, taken: Iterable<string>): string {
  // Array.from rather than for...of — the TS target here predates downlevel
  // iteration, so iterating an Iterable directly does not compile.
  const used = new Set<string>(
    Array.from(taken)
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .map((t) => t.trim().toLowerCase()),
  )

  const base = slugify(input)
  if (!used.has(base)) return base

  // Each attempt re-trims the stem so that stem + suffix still fits the cap.
  // Trimming alone is not enough to guarantee freedom — two long names can trim
  // to the same stem — so every candidate is re-checked against `taken`, and the
  // loop simply advances until one is free. Suffixes are distinct per n, and
  // `taken` is finite, so this always terminates.
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const stem = base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/g, '') || FALLBACK_SLUG
    const candidate = `${stem}${suffix}`
    if (!used.has(candidate)) return candidate
  }
}
