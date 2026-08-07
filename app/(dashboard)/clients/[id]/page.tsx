import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { getClientUsers } from '@/app/actions/clients'
import { getActiveSession, addClientContext } from '@/app/actions/onboarding'
import { computeCompleteness } from '@/lib/onboarding/completeness'
import { SLOTS } from '@/lib/onboarding/schema'
import ClientUsersTable from '@/components/clients/client-users-table'
import ClientSettingsForm from '@/components/clients/ClientSettingsForm'
import OnboardingWorkspace from '@/components/onboarding/OnboardingWorkspace'
import StartOnboardingButton from '@/components/onboarding/StartOnboardingButton'
import ContextPaste from '@/components/onboarding/ContextPaste'
import type { Answers } from '@/lib/onboarding/schema'
import type { Targets } from '@/lib/dashboard/types'

/**
 * Setup runs here now, so this page inherits the duration budget the standalone
 * onboarding page used to carry: server actions inherit the invoking page's
 * budget, and runDiscovery's cold-cache path fans out one dataStreams.list call
 * per GA4 property. On the Vercel default that gets cut off mid-index.
 */
export const maxDuration = 300

interface Props {
  params: Promise<{ id: string }>
}

export default async function ClientDetailPage({ params }: Props) {
  const { id } = await params

  await requireAdmin()

  const service = await createServiceClient()
  const { data: client } = await service
    .from('clients')
    .select('*')
    .eq('id', id)
    .single()

  if (!client) notFound()

  const users = await getClientUsers(id)
  const { session, messages } = await getActiveSession(id)

  // Slot metadata is static; pass it down rather than round-tripping an action.
  const slots = SLOTS.map((s) => ({
    id: s.id,
    label: s.label,
    group: s.group,
    why: s.why,
    required: s.required,
    kind: s.kind,
    choices: s.choices ?? null,
  }))

  return (
    <div className="p-8 max-w-4xl">
      {/* Back nav */}
      <Link
        href="/clients"
        className="flex items-center gap-1.5 text-surface-400 hover:text-surface-100 text-sm transition-colors mb-6"
      >
        <ChevronLeft size={15} />
        All clients
      </Link>

      {/* Header */}
      <div className="flex items-start gap-4 mb-8">
        {client.logo_url ? (
          <img
            src={client.logo_url}
            alt={`${client.name} logo`}
            className="w-14 h-14 rounded-xl object-contain bg-surface-800 flex-shrink-0"
          />
        ) : (
          <div className="w-14 h-14 rounded-xl bg-surface-800 flex items-center justify-center flex-shrink-0">
            <span className="text-surface-100 text-xl font-bold">
              {client.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-surface-100 text-2xl font-medium">{client.name}</h1>
          <p className="text-surface-400 text-sm font-mono">{client.slug}</p>
        </div>
      </div>

      {!client.service_context && !session && (
        <div
          className="mb-8 rounded-sm px-4 py-3 text-sm"
          style={{
            color: 'var(--color-warning)',
            backgroundColor: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: 'color-mix(in srgb, var(--color-warning) 25%, transparent)',
          }}
        >
          No onboarding context captured yet. The pipeline is guessing at service radius,
          average job value and lead handling until setup is run.
        </div>
      )}

      {/*
        Setup is the primary content of this page. It used to be a separate
        destination, which is how the interview and the settings form ended up
        writing the same nine columns without either knowing about the other.
        Reading as one status is the point, so it sits above settings rather than
        beside it.
      */}
      <section className="mb-12">
        <h2 className="text-surface-100 text-xl font-medium mb-1">Setup</h2>
        <p className="text-surface-400 text-sm mb-6 max-w-2xl leading-relaxed">
          What the pipeline needs to know about {client.name} — service radius, average job
          value, how leads are handled, which Google properties are theirs. Everything stays a
          draft until you approve it.
        </p>

        {session ? (
          <OnboardingWorkspace
            sessionId={session.id}
            clientId={id}
            clientName={client.name}
            slots={slots}
            answers={session.answers}
            completeness={computeCompleteness(session.answers)}
            messages={messages}
          />
        ) : (
          <div className="rounded-sm border border-surface-800 bg-surface-900 p-8 text-center">
            <h3 className="text-surface-100 text-lg font-medium mb-1.5">No setup in progress</h3>
            <p className="text-sm text-surface-400 mb-5 max-w-md mx-auto leading-relaxed">
              Starting one opens a conversation alongside a live checklist of what still needs
              covering. You can leave and come back — progress is saved as you go.
            </p>
            <StartOnboardingButton clientId={id} />
          </div>
        )}

        {/* ContextPaste renders its own heading and explanation. */}
        <div className="mt-6 rounded-sm border border-surface-800 bg-surface-900 p-5">
          <ContextPaste clientId={id} onSubmit={addClientContext} />
        </div>
      </section>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Users', value: users.length },
          {
            label: 'Google Sheet',
            value: client.google_sheet_id ? 'Connected' : 'Not set',
          },
          {
            label: 'Looker Embed',
            value: client.looker_embed_url ? 'Connected' : 'Not set',
          },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="bg-surface-900 border border-surface-700 rounded-xl px-5 py-4"
          >
            <p className="text-surface-400 text-xs mb-1">{label}</p>
            <p className="text-surface-100 font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {/* Users table */}
      <ClientUsersTable users={users} clientId={id} clientName={client.name} />

      {/* Settings */}
      <div className="mt-12">
        <h2 className="text-surface-100 text-xl font-medium mb-1">Settings</h2>
        <p className="text-surface-400 text-sm mb-6">Update details and integrations for {client.name}.</p>
        <ClientSettingsForm
          client={{
            id: client.id,
            name: client.name,
            slug: client.slug,
            logo_url: client.logo_url ?? null,
            hero_image_url: (client.hero_image_url as string | null) ?? null,
            google_sheet_id: client.google_sheet_id ?? null,
            looker_embed_url: client.looker_embed_url ?? null,
            sheet_header_row: (client.sheet_header_row as number | null) ?? null,
            sheet_column_map: (client.sheet_column_map as Record<string, string> | null) ?? null,
            ga4_property_id: (client.ga4_property_id as string | null) ?? null,
            gsc_site_url: (client.gsc_site_url as string | null) ?? null,
            brand_context: (client.brand_context as string | null) ?? null,
            client_type: (client.client_type as string | null) ?? null,
            gbp_account_id: (client.gbp_account_id as string | null) ?? null,
            gbp_location_group: (client.gbp_location_group as string | null) ?? null,
            key_event_names: (client.key_event_names as string[] | null) ?? null,
            competitors: (client.competitors as string[] | null) ?? null,
            brand_terms: (client.brand_terms as string[] | null) ?? null,
            brand_match_mode: (client.brand_match_mode as string | null) ?? null,
            targets: (client.targets as Targets | null) ?? null,
            // Provenance for the nine columns setup also writes. No migration
            // and no join — promote.ts already wrote it onto this row.
            service_context:
              (client.service_context as { answers?: Answers } | null) ?? null,
          }}
        />
      </div>
    </div>
  )
}
