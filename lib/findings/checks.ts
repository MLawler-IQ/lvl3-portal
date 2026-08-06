// The first seven detector-backed checks. This is the beginning of phase 3's
// derived-analysis layer, landed with the eval harness because the harness needs
// real detectors to gate and the detectors need the harness's fixtures to be
// trustworthy — they keep each other honest.
//
// Detectors are written from docs/rubric/rubric.json's how-to-test text and the
// documented Tornado audit (AUTOMATION-CONTEXT.md §9), NOT from each other — that
// separation is half of the eval's circularity mitigation.
//
// A detector states facts with magnitudes; it does not decide importance. Severity
// lives in the rubric, prioritisation in the scoring stage.

import type { CheckDefinition, Finding, StationBundle } from './types'
import type { CrawlPageRecord } from '@/lib/tools/crawl-record'
import type { GSCRow } from '@/lib/tools-gsc'

const cap = <T>(arr: T[], n = 5): T[] => arr.slice(0, n)

// ── TECH-001: robots.txt does not block Googlebot ─────────────────────────────

const tech001: CheckDefinition = {
  id: 'TECH-001',
  requires: ['crawl'],
  evaluate: (s: StationBundle): Finding => {
    const site = s.crawl!.ok ? s.crawl!.data.site : { robotsTxt: null, sitemapUrls: [] }
    const txt = site.robotsTxt
    if (txt == null) {
      // No robots.txt at all blocks nothing.
      return {
        checkId: 'TECH-001',
        status: 'pass',
        evidence: { detail: 'No robots.txt served; nothing is blocked.' },
        source: 'crawl',
      }
    }
    // A root disallow under *, or one aimed at Googlebot, blocks the whole site.
    // Parsed as directives (split on the first colon), not exact strings — the
    // verification pass showed 'Disallow:/' (no space) and 'Disallow: /*' are
    // valid, root-blocking, and slipped past an exact-match comparison.
    const lines = txt.split('\n').map((l) => l.trim().toLowerCase())
    let agentAppliesToGoogle = false
    const blockedRoots: string[] = []
    for (const line of lines) {
      const colon = line.indexOf(':')
      if (colon === -1) continue
      const directive = line.slice(0, colon).trim()
      const value = line.slice(colon + 1).trim()
      if (directive === 'user-agent') {
        agentAppliesToGoogle = value === '*' || value.includes('googlebot')
      } else if (agentAppliesToGoogle && directive === 'disallow' && (value === '/' || value === '/*')) {
        blockedRoots.push(line)
      }
    }
    if (blockedRoots.length > 0) {
      return {
        checkId: 'TECH-001',
        status: 'fail',
        evidence: {
          value: blockedRoots.length,
          detail: 'robots.txt disallows the site root for Googlebot.',
        },
        source: 'crawl',
      }
    }
    return {
      checkId: 'TECH-001',
      status: 'pass',
      evidence: { detail: 'robots.txt does not block Googlebot from the site root.' },
      source: 'crawl',
    }
  },
}

// ── ONPAGE-003: one H1 per page ───────────────────────────────────────────────

const onpage003: CheckDefinition = {
  id: 'ONPAGE-003',
  requires: ['crawl'],
  evaluate: (s): Finding => {
    const pages = s.crawl!.ok ? s.crawl!.data.pages : []
    const affected = pages.filter((p) => p.h1s.length !== 1)
    if (affected.length === 0) {
      return {
        checkId: 'ONPAGE-003',
        status: 'pass',
        evidence: { detail: `All ${pages.length} pages carry exactly one H1.` },
        source: 'crawl',
      }
    }
    // A fact with a magnitude; the scoring stage decides how loud 1-of-500 is.
    return {
      checkId: 'ONPAGE-003',
      status: 'fail',
      evidence: {
        affectedUrls: affected.length,
        detail: `${affected.length} of ${pages.length} pages do not have exactly one H1.`,
        examples: cap(affected.map((p) => p.url)),
      },
      source: 'crawl',
    }
  },
}

// ── TECH-011: mobile-friendly rendering ───────────────────────────────────────

const tech011: CheckDefinition = {
  id: 'TECH-011',
  requires: ['crawl'],
  evaluate: (s): Finding => {
    const pages = s.crawl!.ok ? s.crawl!.data.pages : []
    const affected = pages.filter((p) => !p.hasViewportMeta || !p.tapTargetsOk)
    if (affected.length === 0) {
      return {
        checkId: 'TECH-011',
        status: 'pass',
        evidence: { detail: `All ${pages.length} pages pass viewport and tap-target checks.` },
        source: 'crawl',
      }
    }
    return {
      checkId: 'TECH-011',
      status: 'fail',
      evidence: {
        affectedUrls: affected.length,
        detail: `${affected.length} of ${pages.length} pages fail mobile viewport or tap-target sizing.`,
        examples: cap(affected.map((p) => p.url)),
      },
      source: 'crawl',
    }
  },
}

// ── MEAS-001: analytics installed and firing ──────────────────────────────────

const meas001: CheckDefinition = {
  id: 'MEAS-001',
  requires: ['crawl'],
  evaluate: (s): Finding => {
    const pages = s.crawl!.ok ? s.crawl!.data.pages : []
    const untagged = pages.filter((p) => !p.analytics.ga4 && !p.analytics.gtm)
    const share = pages.length > 0 ? untagged.length / pages.length : 0
    // Majority-untagged means measurement is broken site-wide, which gates every
    // outcome number the pipeline could ever report (the rubric weights this as
    // critical for exactly that reason).
    if (share > 0.5) {
      return {
        checkId: 'MEAS-001',
        status: 'fail',
        evidence: {
          affectedUrls: untagged.length,
          detail: `${untagged.length} of ${pages.length} pages carry no GA4 or GTM tag — measurement is effectively off.`,
          examples: cap(untagged.map((p) => p.url)),
        },
        source: 'crawl',
      }
    }
    if (untagged.length > 0) {
      return {
        checkId: 'MEAS-001',
        status: 'fail',
        evidence: {
          affectedUrls: untagged.length,
          detail: `${untagged.length} of ${pages.length} pages are missing analytics tags.`,
          examples: cap(untagged.map((p) => p.url)),
        },
        source: 'crawl',
      }
    }
    return {
      checkId: 'MEAS-001',
      status: 'pass',
      evidence: { detail: `Analytics tags detected on all ${pages.length} pages.` },
      source: 'crawl',
    }
  },
}

// ── ONPAGE-006: keyword cannibalisation ───────────────────────────────────────

/** Impressions below this are noise, not a competing ranking. */
const CANNIBAL_MIN_IMPRESSIONS = 50

const onpage006: CheckDefinition = {
  id: 'ONPAGE-006',
  requires: ['gsc'],
  // Zero rows must read as "couldn't look", never as "no cannibalisation" — the
  // engine's empty-station rule enforces that for every check.
  evaluate: (s): Finding => {
    const rows = s.gsc!.ok ? s.gsc!.data : []
    // Group ALL rows first, then apply the noise floor to the CLUSTER's strongest
    // row — not per row. Google suppresses the losing page in a cannibalised
    // pair, so the loser often sits below any per-row floor; dropping it row-by-
    // row hid exactly the page that proves the conflict.
    const byQuery = new Map<string, { pages: Set<string>; maxImpressions: number }>()
    for (const r of rows as GSCRow[]) {
      const q = r.query.trim().toLowerCase()
      const entry = byQuery.get(q) ?? { pages: new Set<string>(), maxImpressions: 0 }
      entry.pages.add(r.page)
      entry.maxImpressions = Math.max(entry.maxImpressions, r.impressions)
      byQuery.set(q, entry)
    }
    const clusters = Array.from(byQuery.entries()).filter(
      ([, e]) => e.pages.size >= 2 && e.maxImpressions >= CANNIBAL_MIN_IMPRESSIONS,
    )
    const worst = clusters.reduce((m, [, e]) => Math.max(m, e.pages.size), 0)
    // One 2-URL query can be a legitimate variant; a PATTERN of them — or a single
    // query with 3+ competing URLs (Tornado had one at four) — is two page
    // generations fighting.
    if (clusters.length >= 2 || worst >= 3) {
      return {
        checkId: 'ONPAGE-006',
        status: 'fail',
        evidence: {
          value: clusters.length,
          detail: `${clusters.length} queries have 2+ pages competing for the same intent (worst: ${worst} URLs on one query).`,
          examples: cap(clusters.map(([q, e]) => `"${q}" → ${e.pages.size} URLs`)),
        },
        source: 'gsc',
      }
    }
    return {
      checkId: 'ONPAGE-006',
      status: 'pass',
      evidence: {
        detail: `No pattern of queries above ${CANNIBAL_MIN_IMPRESSIONS} impressions ranks multiple URLs.`,
      },
      source: 'gsc',
    }
  },
}

// ── LOCAL-016: service-area radius coherence ──────────────────────────────────

const local016: CheckDefinition = {
  id: 'LOCAL-016',
  requires: ['crawl', 'gbp'],
  evaluate: (s): Finding => {
    const pages = s.crawl!.ok ? s.crawl!.data.pages : []
    const gbp = s.gbp!.ok ? s.gbp!.data : null
    const served = new Set((gbp?.serviceAreas ?? []).map((a) => a.trim().toLowerCase()))
    const home = gbp?.businessCity.trim().toLowerCase()

    const locationPages = pages.filter((p): p is CrawlPageRecord & { targetGeo: string } =>
      Boolean(p.targetGeo),
    )
    const incoherent = locationPages.filter((p) => {
      const geo = p.targetGeo.trim().toLowerCase()
      // Targeting the business's own city is always coherent, listed or not.
      return geo !== home && !served.has(geo)
    })

    if (incoherent.length > 0) {
      return {
        checkId: 'LOCAL-016',
        status: 'fail',
        evidence: {
          affectedUrls: incoherent.length,
          detail: `${incoherent.length} of ${locationPages.length} location pages target geography outside the profile's service area.`,
          examples: cap(incoherent.map((p) => `${p.url} → ${p.targetGeo}`)),
        },
        source: 'derived',
      }
    }
    return {
      checkId: 'LOCAL-016',
      status: 'pass',
      evidence: {
        detail:
          locationPages.length > 0
            ? `All ${locationPages.length} location pages target geography the profile serves.`
            : 'No location pages found to test against the service area.',
      },
      source: 'derived',
    }
  },
}

// ── LOCAL-003: GBP completeness ───────────────────────────────────────────────

const local003: CheckDefinition = {
  id: 'LOCAL-003',
  requires: ['gbp'],
  evaluate: (s): Finding => {
    const gbp = s.gbp!.ok ? s.gbp!.data : null
    if (!gbp) {
      return {
        checkId: 'LOCAL-003',
        status: 'not_run',
        evidence: { detail: 'GBP profile unavailable.' },
        source: 'gbp',
        reason: 'GBP profile unavailable',
      }
    }
    // trim(): an ingester that defaults absent API fields to '' or '  ' must not
    // read as complete. Real placeholder validation ('N/A') belongs to the
    // phase-3 ingest boundary; whitespace is the cheap floor we hold here.
    const blank = (v: string | null) => !v || v.trim().length === 0
    const missing: string[] = []
    if (!gbp.hoursComplete) missing.push('hours')
    if (blank(gbp.phone)) missing.push('phone')
    if (blank(gbp.websiteUri)) missing.push('website')
    if (blank(gbp.description)) missing.push('description')
    if (gbp.photoCount < 3) missing.push('photos')
    // THE §9 FALSE POSITIVE, FIXED AT THE DETECTOR: a service-area business with a
    // hidden storefront address is configured CORRECTLY — Google tells SABs to
    // hide it. Docking completeness for it faulted a client for doing the right
    // thing, and "an automated audit that faults correct configuration destroys
    // trust in every other finding." Only a storefront business missing its
    // address is incomplete. The healthy fixture pins this behaviour.
    if (!gbp.isServiceAreaBusiness && !gbp.storefrontAddress) missing.push('storefront address')

    if (missing.length > 0) {
      return {
        checkId: 'LOCAL-003',
        status: 'fail',
        evidence: {
          value: missing.length,
          detail: `GBP profile incomplete: missing ${missing.join(', ')}.`,
        },
        source: 'gbp',
      }
    }
    return {
      checkId: 'LOCAL-003',
      status: 'pass',
      evidence: {
        detail: gbp.isServiceAreaBusiness
          ? 'GBP profile complete (service-area business; hidden address is correct).'
          : 'GBP profile complete.',
      },
      source: 'gbp',
    }
  },
}

/** Every detector-backed check. The eval manifest loader validates against this. */
export const CHECKS: CheckDefinition[] = [
  tech001,
  onpage003,
  tech011,
  meas001,
  onpage006,
  local016,
  local003,
]

export const CHECK_IDS = new Set(CHECKS.map((c) => c.id))

// A duplicated check id would let scoring's byId map silently keep only the last
// finding — a benign duplicate could mask a real fail. Refuse to load instead.
if (CHECK_IDS.size !== CHECKS.length) {
  throw new Error('Duplicate check id registered in lib/findings/checks.ts')
}
