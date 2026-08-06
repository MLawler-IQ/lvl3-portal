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
  absenceType: false,
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
    const lines = txt.split('\n').map((l) => l.trim().toLowerCase())
    let agentAppliesToGoogle = false
    const blockedRoots: string[] = []
    for (const line of lines) {
      if (line.startsWith('user-agent:')) {
        const agent = line.slice('user-agent:'.length).trim()
        agentAppliesToGoogle = agent === '*' || agent.includes('googlebot')
      } else if (agentAppliesToGoogle && line === 'disallow: /') {
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
  absenceType: false,
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
  absenceType: false,
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
  absenceType: false,
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
  // The defining absence-type check: zero rows must read as "couldn't look",
  // never as "no cannibalisation". The engine enforces it; the flag documents it.
  absenceType: true,
  evaluate: (s): Finding => {
    const rows = s.gsc!.ok ? s.gsc!.data : []
    const byQuery = new Map<string, Set<string>>()
    for (const r of rows as GSCRow[]) {
      if (r.impressions < CANNIBAL_MIN_IMPRESSIONS) continue
      const q = r.query.trim().toLowerCase()
      if (!byQuery.has(q)) byQuery.set(q, new Set())
      byQuery.get(q)!.add(r.page)
    }
    const clusters = Array.from(byQuery.entries()).filter(([, pages]) => pages.size >= 2)
    // One multi-URL query can be a legitimate variant; a pattern of them is two
    // page generations fighting (the Tornado root cause).
    if (clusters.length >= 2) {
      return {
        checkId: 'ONPAGE-006',
        status: 'fail',
        evidence: {
          value: clusters.length,
          detail: `${clusters.length} queries have 2+ pages competing for the same intent.`,
          examples: cap(clusters.map(([q, pages]) => `"${q}" → ${pages.size} URLs`)),
        },
        source: 'gsc',
      }
    }
    return {
      checkId: 'ONPAGE-006',
      status: 'pass',
      evidence: {
        detail: `No query above ${CANNIBAL_MIN_IMPRESSIONS} impressions ranks more than one URL.`,
      },
      source: 'gsc',
    }
  },
}

// ── LOCAL-016: service-area radius coherence ──────────────────────────────────

const local016: CheckDefinition = {
  id: 'LOCAL-016',
  requires: ['crawl', 'gbp'],
  absenceType: false,
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
  absenceType: false,
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
    const missing: string[] = []
    if (!gbp.hoursComplete) missing.push('hours')
    if (!gbp.phone) missing.push('phone')
    if (!gbp.websiteUri) missing.push('website')
    if (!gbp.description) missing.push('description')
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
