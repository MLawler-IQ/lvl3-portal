/**
 * The shape of a client context item, with no model dependency.
 *
 * This exists as its own module for one reason: the paste UI is a client
 * component and needs the `kind` list to render its picker, while the extractor
 * that consumes these items imports the Anthropic SDK at module scope. Importing
 * the constants from the extractor would put that import on a path reachable
 * from the browser bundle.
 *
 * Nothing leaks today — the key is read inside createAnthropicExtractor() from
 * process.env, which Next never inlines into client code — but the previous
 * generation of this tool did ship an Anthropic key to the browser, and the way
 * that happens is exactly this: a shared type pulling a server module across the
 * boundary. Keeping the boundary at a module with no imports makes it structural
 * rather than a thing to remember.
 *
 * Mirrors the `kind` check constraint on public.client_context_items.
 */

export const CONTEXT_ITEM_KINDS = [
  'meeting_transcript',
  'meeting_summary',
  'email',
  'note',
  'web_page',
  // Our own audit report, written by app/actions/audit.ts with source_ref =
  // audit_runs.id. DERIVED data in the sense of docs/CONTEXT-LIBRARY.md §5 — a
  // reading of a crawl export through our rubric, never a record of anything a
  // client said. It is not a paraphrase of testimony either, so it stays out of
  // PARAPHRASE_CONTEXT_ITEM_KINDS below: that cap is about a note-taker model
  // retelling a call, which is a different failure from a detector being wrong.
  'audit_run',
] as const

export type ContextItemKind = (typeof CONTEXT_ITEM_KINDS)[number]

/**
 * Kinds whose text is a PARAPHRASE of something rather than a record of it.
 *
 * `meeting_summary` is the case this was added for: a Zoom AI Companion summary
 * is third-person prose written by a note-taker model, so a quote from it is a
 * literal span of the summary but NOT anybody's actual words. Before this kind
 * existed those rows were stored as `meeting_transcript`, which told the
 * extractor — and the admin reading a suggestion in the review pane — that a
 * machine's paraphrase was testimony.
 *
 * This does not weaken the evidence check anywhere (see extract.ts); it only
 * caps how strongly a summary-sourced suggestion may present itself.
 */
export const PARAPHRASE_CONTEXT_ITEM_KINDS: readonly ContextItemKind[] = ['meeting_summary']

export function isParaphraseKind(kind: ContextItemKind): boolean {
  return PARAPHRASE_CONTEXT_ITEM_KINDS.includes(kind)
}

/**
 * Display names, kept here so the two surfaces that render a kind cannot drift
 * apart — and so adding a kind is one edit rather than a hunt for every
 * `Record<ContextItemKind, string>` in the component tree.
 */
export const CONTEXT_ITEM_KIND_LABELS: Record<ContextItemKind, string> = {
  meeting_transcript: 'Meeting transcript',
  meeting_summary: 'Meeting summary (AI)',
  email: 'Email',
  note: 'Note',
  web_page: 'Web page',
  audit_run: 'Audit run (ours)',
}

/**
 * Kinds a human may paste by hand.
 *
 * Deliberately NOT every kind. `audit_run` is written by the portal after a run
 * completes and carries source_ref pointing at the audit_runs row that produced
 * it. A hand-pasted one would have no run behind it and would be
 * indistinguishable downstream from a real one — including to the extractor,
 * which is told an audit_run is our own measured output. Offering it in the
 * paste picker is offering a way to forge a measurement.
 *
 * The picker reads THIS, not CONTEXT_ITEM_KINDS, so a machine-written kind added
 * later is excluded by default rather than by remembering.
 */
export const PASTEABLE_CONTEXT_ITEM_KINDS: readonly ContextItemKind[] = [
  'meeting_transcript',
  'meeting_summary',
  'email',
  'note',
  'web_page',
]

/** One row of public.client_context_items, as the extractor needs it. */
export interface ContextItem {
  id: string
  kind: ContextItemKind
  title?: string | null
  body: string
  occurredAt?: string | null
}
