// The audit screen: upload a Sitebulb export for the selected client, run it, read it.
//
// The client comes from the TopBar selection like every other tool — there is no client
// picker here. That matters beyond consistency: nothing validates that an export belongs
// to the client it is run against (docs/CONTEXT-LIBRARY.md §1), so the one selection an
// operator already trusts is the one this screen should use, rather than a second control
// that can disagree with the rest of the session.
//
// THE READ ACTIONS ARE PASSED DOWN, not imported by the client components. Same shape as
// ContextPaste: components/audit/* own no server action, so their props ARE the contract
// with app/actions/audit.ts and a drift in either signature is a type error here, at the
// seam, instead of somewhere inside a component.
//
// THE RUN IS NOT ONE OF THEM. `runClientAudit` takes the export's bytes, and bytes cannot
// cross a Server Action boundary: Next's Flight encoder rewrites a `Uint8Array` into a
// plain number array without raising anything, and the action body cap is 1 MB regardless.
// AuditRunner POSTs multipart to app/api/audit/run/route.ts instead, and that route calls
// the same action server-side — so the action is still the single implementation, it just
// is not the transport. The route file documents the failure in full.

import { requireAdmin } from '@/lib/auth'
import { resolveSelectedClientId, getClientById } from '@/lib/client-resolution'
import { listAuditRuns, getAuditRun } from '@/app/actions/audit'
import AuditRunner from '@/components/audit/AuditRunner'

/**
 * Five minutes, the Vercel maximum on this plan.
 *
 * One run parses every CSV in an export and then fetches 90 days of GSC. The default 10s
 * budget kills that mid-crawl, and a killed run is indistinguishable at the browser from a
 * run that found nothing — which is the one outcome this pipeline exists to never produce.
 * The run itself is budgeted by app/api/audit/run/route.ts, which declares the same 300;
 * this one covers the page's own reads.
 */
export const maxDuration = 300

interface ClientRow {
  id: string
  name: string
  website_url: string | null
  gsc_site_url: string | null
}

export default async function AuditPage() {
  const { user } = await requireAdmin()
  const selectedClientId = await resolveSelectedClientId(user)

  if (!selectedClientId) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <p className="text-sm text-surface-400">
          Select a client from the top bar to run an audit.
        </p>
      </div>
    )
  }

  const client = await getClientById<ClientRow>(
    selectedClientId,
    'id, name, website_url, gsc_site_url',
  )

  // Passed through whole. `listAuditRuns` returns an empty array on a read failure and
  // says so in its own doc comment — this screen cannot tell "no runs yet" from "could
  // not look", and neither can that signature. Worth knowing; not worth faking.
  const runs = await listAuditRuns(selectedClientId)

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6 pb-8">
      <header>
        <h1 className="font-mono text-[22px] font-bold text-surface-100">SEO audit</h1>
        <p className="mt-1 text-sm text-surface-400">
          {client?.name ?? 'Selected client'} — run the registered checks against a Sitebulb
          export, Search Console, and the site&apos;s robots files. Admin-only, and not a
          client-visible report: coverage is a fraction of the rubric and the screen says
          which fraction.
        </p>
      </header>

      <AuditRunner
        clientId={selectedClientId}
        clientName={client?.name ?? null}
        gscSiteUrl={client?.gsc_site_url ?? null}
        websiteUrl={client?.website_url ?? null}
        runs={runs}
        onLoadRun={getAuditRun}
      />
    </div>
  )
}
