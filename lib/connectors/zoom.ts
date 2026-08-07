/**
 * Zoom as a source of client context.
 *
 * Ported from the iiq-preextract tool, whose whole point is that nobody goes
 * hunting for a transcript: you give it the client's domain and it finds the
 * calls. Pasting a transcript by hand is the fallback, not the workflow.
 *
 * Server-side only — the credentials are server-to-server OAuth and must never
 * reach the browser. No 'use server' here; this is lib/, and the actions in
 * app/actions/zoom-context.ts are the only callers.
 *
 * The matching and parsing logic below is deliberately separated from the HTTP
 * calls so it can be tested without a network or a Zoom account, which is most
 * of what is worth testing.
 */

import { normalizeDomain } from '@/lib/normalize-domain'

export interface ZoomCall {
  /** Zoom meeting UUID. Doubles as the idempotency key in client_context_items.source_ref. */
  uuid: string
  topic: string
  /** ISO start time, or '' when Zoom gave neither a start nor a created time. */
  start: string
  host: string
  durationMin: number | null
  /** A verbatim transcript, or an AI Companion summary — summaries are weaker evidence. */
  kind: 'recording' | 'summary'
  hasContent: boolean
  transcriptUrl: string | null
  /** Why this call matched, shown in the picker so a wrong match is visible. */
  matchedBy?: string
}

/** Words too common to be worth matching a company name on. */
const STOP_WORDS = new Set(['the', 'and', 'llc', 'inc', 'co', 'of', 'a', '&', 'group', 'services'])

/**
 * Meaningful words from a search query.
 *
 * "The Airworks Group LLC" reduces to ["airworks"], so a meeting titled
 * "Airworks / IgniteIQ kickoff" matches while every meeting containing "group"
 * does not.
 */
export function queryWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
}

/**
 * Is the input a domain (or an email) rather than a company name?
 *
 * A domain is the stronger signal by far: it matches participant email
 * addresses, which is an identity, where a name match is a guess about wording.
 * Accepts an email and takes its domain, since pasting a client contact's
 * address is the obvious thing to try.
 */
export function domainFromQuery(query: string): string | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  if (q.includes('@')) {
    const after = q.split('@').pop() ?? ''
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(after) ? after : null
  }
  // normalizeDomain strips protocol/www/path, so a pasted website URL works too.
  const normalized = normalizeDomain(q)
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(normalized) ? normalized : null
}

/** Does a meeting topic match a company-name query? */
export function topicMatches(topic: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '*') return true
  const hay = (topic || '').toLowerCase()
  if (!hay) return false
  if (hay.includes(q)) return true
  return queryWords(q).some((w) => hay.includes(w))
}

/**
 * Collapse the same meeting appearing as both a recording and a summary.
 *
 * A recording WITH a transcript wins: a verbatim transcript is stronger evidence
 * than an AI summary of the same call, and keeping both would let the extractor
 * "corroborate" a claim against what is really one conversation.
 */
export function dedupeCalls(calls: ZoomCall[]): ZoomCall[] {
  const byUuid = new Map<string, ZoomCall>()
  for (const call of calls) {
    const prev = byUuid.get(call.uuid)
    if (!prev || (call.kind === 'recording' && call.hasContent)) {
      byUuid.set(call.uuid, call)
    }
  }
  return Array.from(byUuid.values())
}

/**
 * Strip WebVTT scaffolding down to spoken text.
 *
 * Drops the WEBVTT header, the cue numbers and the `00:00:01.000 --> ...`
 * timing lines, leaving the speaker-labelled dialogue the model actually reads.
 */
export function vttToText(vtt: string): string {
  return vtt
    .split('\n')
    .filter((l) => l && !/^WEBVTT/.test(l) && !/^\d+$/.test(l.trim()) && !/-->/.test(l))
    .join('\n')
    .trim()
}

/**
 * Zoom UUIDs can contain `/` and `//`, which break a path segment unless they
 * are encoded TWICE. Zoom documents this and it is the single easiest way to get
 * a spurious 404 out of their API.
 */
export function encodeMeetingUuid(uuid: string): string {
  return encodeURIComponent(encodeURIComponent(String(uuid)))
}

/** Date as Zoom wants it in from/to query params. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ── I/O ───────────────────────────────────────────────────────────────────────

export interface ZoomConfig {
  accountId: string
  clientId: string
  clientSecret: string
  /** Whose recordings to search. Zoom scopes recording lists per user. */
  hostEmails: string[]
}

/** Read Zoom config from the environment, or explain precisely what is missing. */
export function zoomConfigFromEnv(): ZoomConfig | { error: string } {
  const accountId = process.env.ZOOM_ACCOUNT_ID
  const clientId = process.env.ZOOM_CLIENT_ID
  const clientSecret = process.env.ZOOM_CLIENT_SECRET

  const missing = [
    !accountId && 'ZOOM_ACCOUNT_ID',
    !clientId && 'ZOOM_CLIENT_ID',
    !clientSecret && 'ZOOM_CLIENT_SECRET',
  ].filter(Boolean)

  if (missing.length) {
    return {
      error: `Zoom is not configured — set ${missing.join(', ')} in Vercel. Until then you can still paste a transcript by hand.`,
    }
  }

  return {
    accountId: accountId!,
    clientId: clientId!,
    clientSecret: clientSecret!,
    hostEmails: (process.env.ZOOM_HOST_EMAILS || 'matt@igniteiq.com')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  }
}

/** Server-to-server OAuth. The token is short-lived; fetch one per operation. */
export async function zoomToken(cfg: ZoomConfig): Promise<string> {
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(cfg.accountId)}`,
    {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64'),
      },
    },
  )
  const json = await res.json()
  if (!res.ok) {
    throw new Error(`Zoom auth failed: ${json.reason || json.error || res.status}`)
  }
  return json.access_token as string
}

async function zoomGet(token: string, url: string): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  let json: Record<string, unknown> = {}
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    // A non-JSON body is a failure we report by status, not by throwing.
  }
  return { ok: res.ok, status: res.status, json }
}

/**
 * Every call from the last `days` with usable content, before matching.
 *
 * Two sources, because either alone misses calls: cloud recordings carry
 * verbatim transcripts but only exist if someone hit record, while AI Companion
 * summaries exist for meetings nobody recorded. Recordings must be queried per
 * host in 30-day windows — Zoom rejects a wider range — so this walks backwards
 * a window at a time.
 */
export async function listRecentCalls(
  token: string,
  cfg: ZoomConfig,
  days = 180,
): Promise<ZoomCall[]> {
  const calls: ZoomCall[] = []
  const now = new Date()
  const windows = Math.ceil(days / 30)

  for (const host of cfg.hostEmails) {
    for (let w = 0; w < windows; w++) {
      const to = new Date(now)
      to.setDate(to.getDate() - 30 * w)
      const from = new Date(to)
      from.setDate(from.getDate() - 30)

      const { ok, status, json } = await zoomGet(
        token,
        `https://api.zoom.us/v2/users/${encodeURIComponent(host)}/recordings?from=${ymd(from)}&to=${ymd(to)}&page_size=100`,
      )
      // 404 means the host email is not a user on this account — no point
      // walking the remaining windows for them.
      if (status === 404) break
      if (!ok) continue

      for (const m of (json.meetings as Record<string, unknown>[]) ?? []) {
        const files = (m.recording_files as Record<string, unknown>[]) ?? []
        const transcript = files.find((f) => f.file_type === 'TRANSCRIPT')
        calls.push({
          uuid: String(m.uuid ?? ''),
          topic: String(m.topic ?? '(no topic)'),
          start: String(m.start_time ?? ''),
          host,
          durationMin: typeof m.duration === 'number' ? m.duration : null,
          kind: 'recording',
          hasContent: !!transcript,
          transcriptUrl: transcript ? String(transcript.download_url) : null,
        })
      }
    }
  }

  // AI Companion summaries — account-wide, paginated rather than windowed.
  let pageToken = ''
  const from = new Date(now)
  from.setDate(from.getDate() - days)
  for (let page = 0; page < 5; page++) {
    const url =
      `https://api.zoom.us/v2/meetings/meeting_summaries?page_size=300&from=${ymd(from)}&to=${ymd(now)}` +
      (pageToken ? `&next_page_token=${pageToken}` : '')
    const { ok, json } = await zoomGet(token, url)
    // Usually a missing scope. Recordings still came back, so degrade rather
    // than fail the whole search.
    if (!ok) break

    for (const s of (json.summaries as Record<string, unknown>[]) ?? []) {
      calls.push({
        uuid: String(s.meeting_uuid ?? ''),
        topic: String(s.meeting_topic ?? s.summary_title ?? '(no topic)'),
        start: String(s.meeting_start_time ?? s.summary_created_time ?? ''),
        host: String(s.meeting_host_email ?? ''),
        durationMin: null,
        kind: 'summary',
        hasContent: true,
        transcriptUrl: null,
      })
    }

    pageToken = String(json.next_page_token ?? '')
    if (!pageToken) break
  }

  return dedupeCalls(calls).filter((c) => c.uuid)
}

async function participantsFor(token: string, uuid: string): Promise<Record<string, unknown>[]> {
  const { ok, json } = await zoomGet(
    token,
    `https://api.zoom.us/v2/past_meetings/${encodeMeetingUuid(uuid)}/participants?page_size=300`,
  )
  if (!ok) return []
  return (json.participants as Record<string, unknown>[]) ?? []
}

/**
 * Find the calls belonging to a client.
 *
 * A domain matches on participant email — an identity, not a guess — and falls
 * back to the domain's base word appearing in a topic, which catches a guest who
 * dialled in without a company address.
 *
 * A name query goes in tiers, cheapest and most reliable first:
 *   1. the meeting topic
 *   2. attendee display names, which is what finds a call filed under
 *      "Matt Lawler's Meeting Room" rather than the client's name
 *   3. the text of the AI summaries, but only if the first two found nothing —
 *      it is the most expensive and the loosest, so it is a last resort
 */
export async function findCallsFor(
  token: string,
  cfg: ZoomConfig,
  query: string,
): Promise<ZoomCall[]> {
  const all = await listRecentCalls(token, cfg)
  const withContent = all.filter((c) => c.hasContent).slice(0, 40)
  const domain = domainFromQuery(query)
  const matched: ZoomCall[] = []

  if (domain) {
    const checks = await Promise.all(
      withContent.map(async (call) => {
        const hit = (await participantsFor(token, call.uuid)).find((p) =>
          String(p.user_email ?? '')
            .toLowerCase()
            .endsWith(`@${domain}`),
        )
        return hit ? { ...call, matchedBy: `participant ${String(hit.user_email)}` } : null
      }),
    )
    matched.push(...checks.filter((c) => c !== null))

    const base = domain.split('.')[0]
    for (const call of all) {
      if (matched.some((m) => m.uuid === call.uuid)) continue
      if ((call.topic || '').toLowerCase().includes(base)) {
        matched.push({ ...call, matchedBy: 'topic' })
      }
    }
  } else {
    matched.push(
      ...all
        .filter((c) => topicMatches(c.topic, query))
        .map((c) => ({ ...c, matchedBy: 'topic' })),
    )

    if (query.trim() !== '*') {
      const remaining = withContent.filter((c) => !matched.some((m) => m.uuid === c.uuid))
      const q = query.trim().toLowerCase()
      const words = queryWords(q)
      const nameChecks = await Promise.all(
        remaining.map(async (call) => {
          const hit = (await participantsFor(token, call.uuid)).find((p) => {
            const name = String(p.name ?? '').toLowerCase()
            return name.includes(q) || words.some((w) => name.includes(w))
          })
          return hit ? { ...call, matchedBy: `attendee “${String(hit.name)}”` } : null
        }),
      )
      matched.push(...nameChecks.filter((c) => c !== null))

      if (matched.length === 0) {
        const summaries = withContent.filter((c) => c.kind === 'summary').slice(0, 15)
        const contentChecks = await Promise.all(
          summaries.map(async (call) => {
            const { ok, json } = await zoomGet(
              token,
              `https://api.zoom.us/v2/meetings/${encodeMeetingUuid(call.uuid)}/meeting_summary`,
            )
            if (!ok) return null
            const text = JSON.stringify(json).toLowerCase()
            return text.includes(q) || words.some((w) => text.includes(w))
              ? { ...call, matchedBy: 'mentioned in AI summary' }
              : null
          }),
        )
        matched.push(...contentChecks.filter((c) => c !== null))
      }
    }
  }

  matched.sort((a, b) => (b.start || '').localeCompare(a.start || ''))
  return matched.slice(0, 30)
}

/** Flatten an AI Companion summary into the text the extractor reads. */
export function summaryToText(s: Record<string, unknown>): string {
  let text = `[AI COMPANION SUMMARY] ${String(s.summary_title ?? '')}\n${String(s.summary_overview ?? '')}`
  for (const d of (s.summary_details as Record<string, unknown>[]) ?? []) {
    text += `\n${d.label ? `${String(d.label)}: ` : ''}${String(d.summary ?? '')}`
  }
  const nextSteps = s.next_steps as string[] | undefined
  if (Array.isArray(nextSteps) && nextSteps.length) {
    text += `\nNext steps: ${nextSteps.join('; ')}`
  }
  return text.trim()
}

/**
 * The text of one call, whichever kind it is.
 *
 * Returns null rather than throwing when a single call cannot be read: importing
 * four calls should not fail because the fifth lost its transcript.
 */
export async function fetchCallText(token: string, call: ZoomCall): Promise<string | null> {
  if (call.transcriptUrl) {
    // Only ever follow a Zoom-hosted URL — this value comes from an API
    // response, and fetching an arbitrary URL with the bearer token attached
    // would hand the token to whoever supplied it.
    if (!/^https:\/\/[^/]*zoom\.(us|com)\//.test(call.transcriptUrl)) return null
    const res = await fetch(call.transcriptUrl, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'follow',
    })
    if (!res.ok) return null
    const text = vttToText(await res.text())
    return text || null
  }

  const { ok, json } = await zoomGet(
    token,
    `https://api.zoom.us/v2/meetings/${encodeMeetingUuid(call.uuid)}/meeting_summary`,
  )
  if (!ok) return null
  const text = summaryToText(json)
  return text || null
}
