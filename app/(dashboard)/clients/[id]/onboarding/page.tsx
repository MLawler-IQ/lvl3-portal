import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getClientById } from '@/lib/client-resolution'
import { computeCompleteness } from '@/lib/onboarding/completeness'
import { SLOTS } from '@/lib/onboarding/schema'
import { getActiveSession } from '@/app/actions/onboarding'
import OnboardingWorkspace from '@/components/onboarding/OnboardingWorkspace'
import StartOnboardingButton from '@/components/onboarding/StartOnboardingButton'

interface ClientRow {
  id: string
  name: string
}

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdmin()
  const { id } = await params

  const client = await getClientById<ClientRow>(id, 'id, name')
  if (!client) notFound()

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
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <div className="mb-5">
        <Link
          href={`/clients/${id}`}
          className="inline-flex items-center gap-1.5 text-xs text-surface-400 rounded-sm transition-colors hover:text-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <ArrowLeft size={13} />
          Back to {client.name}
        </Link>
        <h1 className="mt-2 font-serif text-2xl text-surface-100">Onboarding interview</h1>
        <p className="mt-1 text-sm text-surface-400 max-w-2xl leading-relaxed">
          A guided conversation that captures the context the SEO pipeline needs — service
          radius, average job value, how leads are handled, what a prior vendor built.
          Everything stays a draft until you approve it.
        </p>
      </div>

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
          <h2 className="font-serif text-lg text-surface-100 mb-1.5">No interview in progress</h2>
          <p className="text-sm text-surface-400 mb-5 max-w-md mx-auto leading-relaxed">
            Starting one opens a conversation alongside a live checklist of what still needs
            covering. You can leave and come back — progress is saved as you go.
          </p>
          <StartOnboardingButton clientId={id} />
        </div>
      )}
    </div>
  )
}
