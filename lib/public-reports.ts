import type { SupabaseClient } from '@supabase/supabase-js'

// Slugs of reports that are publicly viewable and chat-editable (no login).
export const PUBLIC_REPORT_SLUGS = ['market-eval', 'decision-dashboard'] as const
export type PublicReportSlug = (typeof PUBLIC_REPORT_SLUGS)[number]

export function isPublicReportSlug(slug: string): slug is PublicReportSlug {
  return (PUBLIC_REPORT_SLUGS as readonly string[]).includes(slug)
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/**
 * Apply a validated find/replace edit to a stored report. Snapshots the prior
 * version into report_revisions first — history is never thrown away.
 * Returns a message meant to be fed back to the model as a tool result.
 */
export async function applyReportEdit(
  service: SupabaseClient,
  slug: PublicReportSlug,
  find: string,
  replace: string,
  note: string
): Promise<{ ok: boolean; message: string }> {
  if (find.length < 3) {
    return { ok: false, message: 'ERROR: "find" must be at least 3 characters of exact report text.' }
  }
  if (find === replace) {
    return { ok: false, message: 'ERROR: "find" and "replace" are identical — nothing to change.' }
  }

  const { data: report } = await service
    .from('public_reports')
    .select('id, html, content_text')
    .eq('slug', slug)
    .single()

  if (!report) {
    return { ok: false, message: `ERROR: report "${slug}" not found.` }
  }

  const count = countOccurrences(report.html, find)
  if (count === 0) {
    const inText = countOccurrences(report.content_text, find) > 0
    return {
      ok: false,
      message: inText
        ? 'ERROR: that text is visible in the report but is split by markup in the underlying document. Try a shorter contiguous fragment (e.g. just the number or a few words) that is unlikely to be split.'
        : 'ERROR: exact text not found in the report. Check spelling, punctuation, and dashes (the report may use — instead of -), and try a shorter distinctive fragment.',
    }
  }
  if (count > 8) {
    return {
      ok: false,
      message: `ERROR: "${find}" appears ${count} times — too ambiguous. Include more surrounding text so the match is specific.`,
    }
  }

  // Snapshot the current version before mutating
  const { error: revErr } = await service.from('report_revisions').insert({
    report_id: report.id,
    html: report.html,
    content_text: report.content_text,
    note,
  })
  if (revErr) {
    return { ok: false, message: `ERROR: could not snapshot revision: ${revErr.message}` }
  }

  const newHtml = report.html.split(find).join(replace)
  const newText = report.content_text.split(find).join(replace)

  const { error: updErr } = await service
    .from('public_reports')
    .update({ html: newHtml, content_text: newText, updated_at: new Date().toISOString() })
    .eq('id', report.id)

  if (updErr) {
    return { ok: false, message: `ERROR: update failed: ${updErr.message}` }
  }

  return {
    ok: true,
    message: `Updated ${count} occurrence(s) in ${slug}. The viewer will see the change on reload.`,
  }
}
