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
  'email',
  'note',
  'web_page',
] as const

export type ContextItemKind = (typeof CONTEXT_ITEM_KINDS)[number]

/** One row of public.client_context_items, as the extractor needs it. */
export interface ContextItem {
  id: string
  kind: ContextItemKind
  title?: string | null
  body: string
  occurredAt?: string | null
}
