// targetGeo derivation: which city a location page targets.
//
// LOCAL-016 compares this against the GBP profile's declared service areas, which
// arrive as 'City, ST' strings. So the only useful output is 'City, ST' — a bare
// city name can never match a service area, and inventing the state to make it
// match would be fabricating the very fact the check is testing.
//
// Hence the rule: DERIVE ONLY WHERE A STATE CODE IS EXPLICITLY PRESENT, in the URL
// slug or the page title, and return null otherwise. Under-deriving costs
// LOCAL-016 some coverage (reported as a note). Over-deriving invents a mismatch
// between a page and a service area, and "an automated audit that faults correct
// configuration destroys trust in every other finding" (§9).
//
// On the pilot crawl this yields 'Los Angeles, CA' for the generated /Service/
// family and null for the /areas-we-serve/ pages, whose slugs and titles name a
// city with no state at all ('air-duct-cleaning-brentwood').

const US_STATES = new Set([
  'al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks','ky','la','me',
  'md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd','oh','ok','or','pa',
  'ri','sc','sd','tn','tx','ut','vt','va','wa','wv','wi','wy','dc','pr',
])

const LOWERCASE_WORDS = new Set(['and', 'of', 'the', 'at', 'in', 'on'])

/** 'los-angeles' → 'Los Angeles'. Joining words stay lowercase. */
function titleCaseSlug(slug: string): string {
  return slug
    .split('-')
    .filter((part) => part.length > 0)
    .map((part, i) =>
      i > 0 && LOWERCASE_WORDS.has(part) ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(' ')
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url.split('#')[0].split('?')[0]
  }
}

/**
 * The `-in-<city>-<st>` slug form, which is the only slug shape with an
 * unambiguous city boundary.
 *
 * '…-in-los-angeles-ca/' → 'Los Angeles, CA'. A trailing WordPress duplicate
 * suffix ('-ca-2') is stripped first. The alternative shape,
 * '…-cleaning-los-angeles-ca', is deliberately NOT matched: without the 'in-'
 * marker there is nothing to say where the service name stops and the city
 * starts, and guessing produced 'Emergency Dryer Vent Cleaning Los Angeles' as a
 * city on the pilot data.
 */
function fromSlug(url: string): string | null {
  const segments = pathOf(url).split('/').filter((s) => s.length > 0)
  const leaf = segments[segments.length - 1]
  if (!leaf) return null
  const cleaned = leaf.toLowerCase().replace(/-\d+$/, '')
  const match = cleaned.match(/-in-([a-z0-9-]+)-([a-z]{2})$/)
  if (!match) return null
  const state = match[2]
  if (!US_STATES.has(state)) return null
  const city = titleCaseSlug(match[1])
  if (city.length === 0) return null
  return `${city}, ${state.toUpperCase()}`
}

// 'in Los Angeles, CA' and the comma-less 'in Los Angeles CA' that this site's
// titles use about as often. Capitalised words only, so a sentence fragment
// cannot be mistaken for a place name.
const TITLE_WITH_COMMA = /\bin\s+([A-Z][A-Za-z.'’-]*(?:\s+[A-Z][A-Za-z.'’-]*)*),\s*([A-Za-z]{2})\b/
const TITLE_NO_COMMA = /\bin\s+([A-Z][A-Za-z.'’-]*(?:\s+[A-Z][A-Za-z.'’-]*)*)\s+([A-Z]{2})\b/

function fromTitle(title: string): string | null {
  for (const pattern of [TITLE_WITH_COMMA, TITLE_NO_COMMA]) {
    const match = title.match(pattern)
    if (!match) continue
    const state = match[2].toLowerCase()
    if (!US_STATES.has(state)) continue
    // 'in Los Angeles CA' can swallow a trailing capitalised word; the city is
    // whatever precedes the state code, trimmed of connective words.
    const city = match[1].trim()
    if (city.length === 0) continue
    return `${city}, ${state.toUpperCase()}`
  }
  return null
}

/**
 * The geography a page targets, or null when no state code is stated.
 *
 * URL first: a slug is written once by the template and cannot drift, whereas a
 * title is hand-edited per page.
 */
export function deriveTargetGeo(url: string, title: string): string | null {
  return fromSlug(url) ?? (title.length > 0 ? fromTitle(title) : null)
}

/**
 * The template family a URL belongs to, or null for a root-level page.
 *
 * The FIRST PATH SEGMENT of a URL at least two segments deep — '/Service/x/' →
 * 'service', '/areas-we-serve/y/' → 'areas-we-serve'. Root-level pages
 * ('/contact-us/') and the homepage get null: they are the hand-built pages, and
 * on the pilot site those 58 URLs are unrelated to each other, so claiming they
 * share a template would let a group-size floor fire a template-level finding on
 * a pile of one-offs.
 *
 * Deliberately NOT the same algorithm as
 * lib/findings/analyses/template-groups.ts, which derives its own grouping from
 * URL strings alone and does its own numeric-segment collapsing. That file's
 * comment explains why the two are independent: the ingester's value is only as
 * good as the crawl's configuration, so an independent derivation is a
 * cross-check rather than a duplicate. Divergence between them is a signal.
 */
export function deriveTemplateGroup(url: string): string | null {
  const segments = pathOf(url).split('/').filter((s) => s.length > 0)
  if (segments.length < 2) return null
  return segments[0].toLowerCase()
}
