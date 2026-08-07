'use server'

// Pull client context out of Zoom instead of asking a human to go find it.
//
// The point of the connector, and the thing the paste box is not: you already
// know the client's domain — it is on the client row, captured when the client
// was created — so finding the calls is the portal's job, not yours. Pasting a
// transcript by hand remains available as the fallback for anything Zoom does
// not have.
//
// Everything extracted lands as source 'context', which isFilled() refuses to
// count at any confidence. A call recording is evidence of what was said, not a
// decision about how the client is configured.

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { logError } from '@/lib/logging'
import { normalizeDomain } from '@/lib/normalize-domain'
import { SLOTS, answersSchema, isFilled, type Answers } from '@/lib/onboarding/schema'
import {
  createAnthropicExtractor,
  extractSlotValues,
  summarizeExtraction,
  type ExtractionOutcome,
  type ExtractionResult,
} from '@/lib/onboarding/extract'
import {
  fetchCallText,
  findCallsFor,
  zoomConfigFromEnv,
  zoomToken,
  type ZoomCall,
} from '@/lib/connectors/zoom'
import type { ContextItem, ContextItemKind } from '@/lib/onboarding/context-items'

/**
 * The "nothing left to ask" case, which returns before extractSlotValues is
 * called and so has no ExtractionResult to describe itself with.
 *
 * Routed through summarizeExtraction rather than hand-written, because the whole
 * point of centralising the wording is that the paste path and the Zoom path say
 * the same thing. A second sentence written here is how they drift.
 */
function nothingLeftToAsk(items: ContextItem[]) {
  return {
    outcome: 'not_attempted' as const,
    summary: summarizeExtraction({
      outcome: 'not_attempted',
      proposed: 0,
      acceptedCount: 0,
      rejectedByReason: [],
      items,
      openSlotCount: 0,
    }),
    proposed: 0,
    accepted: 0,
    rejectedByReason: [],
  }
}

/** The self-describing half of an extraction, flattened for the client bundle. */
function explain(result: ExtractionResult) {
  return {
    outcome: result.outcome,
    summary: result.summary,
    proposed: result.proposed,
    accepted: result.accepted.length,
    rejectedByReason: result.rejectedByReason.map((g) => ({
      reason: String(g.reason),
      count: g.count,
      slotIds: g.slotIds,
      phrase: g.phrase,
    })),
  }
}

export interface ZoomSearchResult {
  error?: string
  /** What was actually searched for, so a wrong guess is visible rather than mysterious. */
  query?: string
  calls?: ZoomCall[]
  /** True when Zoom credentials are absent — the UI offers pasting instead. */
  notConfigured?: boolean
}

/**
 * Find the Zoom calls for a client.
 *
 * `query` is optional: with nothing supplied it uses the client's own website
 * domain, which matches on participant email addresses and is the strongest
 * signal available. An explicit query is for the case where the client's people
 * joined from a different address than their website.
 */
export async function findClientCalls(
  clientId: string,
  query?: string,
): Promise<ZoomSearchResult> {
  try {
    await requireAdmin()

    const cfg = zoomConfigFromEnv()
    if ('error' in cfg) return { error: cfg.error, notConfigured: true }

    const service = await createServiceClient()
    const { data: client } = await service
      .from('clients')
      .select('name, website_url')
      .eq('id', clientId)
      .single()

    if (!client) return { error: 'Client not found.' }

    // Prefer an explicit query, then the domain, then the name. The domain is
    // the best of the three and it is already on the row.
    const website = (client.website_url as string | null) ?? ''
    const derived = website ? normalizeDomain(website) : ''
    const effective = (query ?? '').trim() || derived || String(client.name ?? '')

    if (!effective) {
      return { error: 'This client has no website or name to search on — type something to search for.' }
    }

    const token = await zoomToken(cfg)
    const calls = await findCallsFor(token, cfg, effective)
    return { query: effective, calls }
  } catch (err) {
    logError('zoom.search', 'Zoom search failed', {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    })
    return { error: err instanceof Error ? err.message : 'Zoom search failed' }
  }
}

export interface ZoomImportResult {
  error?: string
  imported?: number
  /** Already present from an earlier import — skipped, not duplicated. */
  skipped?: number
  suggestedSlotIds?: string[]
  nothingExtracted?: boolean
  noActiveSession?: boolean
  /**
   * Why nothing (or little) came back, rendered by lib/onboarding/extract.ts so
   * the paste path and the Zoom path cannot word it differently. The old
   * "nothing could be tied to an open question" told an admin nothing: a thin
   * source and a broken extractor read identically, and a real import of an
   * intro call was indistinguishable from a bug.
   */
  extraction?: {
    outcome: ExtractionOutcome
    summary: string
    proposed: number
    accepted: number
    rejectedByReason: { reason: string; count: number; slotIds: string[]; phrase: string }[]
  }
}

/**
 * Import the chosen calls and read them for slot suggestions.
 *
 * Stored first, extracted second, for the same reason the paste action does it:
 * the transcript is the evidence and the suggestions are a derived reading we
 * may want to redo with a better prompt. A model failure must not lose the
 * import.
 *
 * Re-importing the same call is a no-op rather than a duplicate — source_ref
 * holds the Zoom meeting UUID under a unique index, which is exactly what it was
 * added for. Duplicate transcripts would let the extractor "corroborate" a value
 * against what is really one conversation.
 */
export async function importClientCalls(
  clientId: string,
  calls: ZoomCall[],
): Promise<ZoomImportResult> {
  try {
    const { user } = await requireAdmin()
    if (!calls.length) return { error: 'Pick at least one call.' }

    const cfg = zoomConfigFromEnv()
    if ('error' in cfg) return { error: cfg.error }

    const service = await createServiceClient()
    const token = await zoomToken(cfg)

    let imported = 0
    let skipped = 0
    const items: ContextItem[] = []

    // A Zoom "recording" carries a verbatim transcript; a "summary" is an AI
    // Companion paraphrase written in the third person. Storing both as
    // meeting_transcript told the extractor that a note-taker model's prose was
    // testimony, and the extraction prompt's own instruction to trust summaries
    // less could never fire because nothing downstream could tell them apart.
    const kindFor = (call: ZoomCall): ContextItemKind =>
      call.kind === 'summary' ? 'meeting_summary' : 'meeting_transcript'

    for (const call of calls.slice(0, 10)) {
      const { data: existing } = await service
        .from('client_context_items')
        .select('id, kind, body, title, occurred_at')
        .eq('client_id', clientId)
        .eq('source_ref', call.uuid)
        .maybeSingle()

      if (existing) {
        skipped++
        items.push({
          // Trust what was stored, not what this search happens to report — the
          // row may predate the kind existing, and the row is the record.
          id: existing.id as string,
          kind: ((existing.kind as ContextItemKind) ?? kindFor(call)),
          title: (existing.title as string | null) ?? call.topic,
          body: existing.body as string,
          occurredAt: (existing.occurred_at as string | null) ?? null,
        })
        continue
      }

      const text = await fetchCallText(token, call)
      if (!text) continue

      const { data: row, error: insertErr } = await service
        .from('client_context_items')
        .insert({
          client_id: clientId,
          kind: kindFor(call),
          source_ref: call.uuid,
          title: call.topic,
          body: text,
          occurred_at: call.start || null,
          added_by: user.id,
        })
        .select('id')
        .single()

      if (insertErr) continue
      imported++
      items.push({
        id: row.id as string,
        kind: kindFor(call),
        title: call.topic,
        body: text,
        occurredAt: call.start || null,
      })
    }

    revalidatePath(`/clients/${clientId}`)

    if (items.length === 0) {
      return {
        error:
          'None of those calls had readable content. Zoom keeps a transcript only for cloud-recorded calls, and an AI Companion summary only where that was switched on.',
      }
    }

    const { data: sessionRow } = await service
      .from('client_onboarding_sessions')
      .select('id, answers')
      .eq('client_id', clientId)
      .in('status', ['in_progress', 'ready_for_review'])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!sessionRow) return { imported, skipped, noActiveSession: true }

    const existing = answersSchema.safeParse(sessionRow.answers).data ?? {}
    const open = SLOTS.filter((s) => !isFilled(existing[s.id])).map((s) => s.id)
    if (open.length === 0) {
      return { imported, skipped, nothingExtracted: true, extraction: nothingLeftToAsk(items) }
    }

    let result
    try {
      result = await extractSlotValues(items, open, { callModel: createAnthropicExtractor() })
    } catch (err) {
      logError('zoom.extract', 'Extraction failed after import', {
        clientId,
        error: err instanceof Error ? err.message : String(err),
      })
      return { imported, skipped, error: 'Calls imported, but reading them failed. Retry extraction later.' }
    }

    const suggested = Object.keys(result.answers)
    if (suggested.length === 0) {
      return { imported, skipped, nothingExtracted: true, extraction: explain(result) }
    }

    // A suggestion never displaces an answer.
    const merged: Answers = { ...existing }
    for (const [slotId, value] of Object.entries(result.answers)) {
      if (isFilled(existing[slotId])) continue
      merged[slotId] = value
    }

    const { error: sessionErr } = await service
      .from('client_onboarding_sessions')
      .update({ answers: merged, updated_at: new Date().toISOString() })
      .eq('id', sessionRow.id)

    if (sessionErr) {
      return { imported, skipped, error: `Calls imported, but the suggestions could not be attached: ${sessionErr.message}` }
    }

    revalidatePath(`/clients/${clientId}`)
    return { imported, skipped, suggestedSlotIds: suggested, extraction: explain(result) }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Import failed' }
  }
}
