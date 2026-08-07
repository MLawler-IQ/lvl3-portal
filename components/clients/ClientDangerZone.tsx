'use client'

// Archive, restore and permanent deletion for a client.
//
// Archiving is the everyday action and is presented as one: reversible, quiet,
// no dire warnings, because nothing is lost. Deletion is presented as the
// exception it is — it only appears once a client is archived, it states what
// will actually be destroyed rather than saying "this cannot be undone", and it
// requires typing the client's name.
//
// The impact numbers are the point. A confirmation that describes consequences
// in the abstract teaches nobody anything; one that says "62 tool runs, 14 files,
// and Dana is left with no clients" is a decision someone can actually make.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore, Loader2, TriangleAlert } from 'lucide-react'

export interface DeletionImpact {
  clientName: string
  archived: boolean
  rows: { table: string; count: number }[]
  totalRows: number
  storageFiles: number
  strandedUsers: { id: string; email: string }[]
}

interface Props {
  clientId: string
  impact: DeletionImpact
  onArchive: (clientId: string) => Promise<{ error?: string }>
  onRestore: (clientId: string) => Promise<{ error?: string }>
  onDelete: (clientId: string, confirmName: string) => Promise<{ error?: string }>
}

const TABLE_LABELS: Record<string, string> = {
  deliverables: 'deliverables',
  tool_runs: 'tool runs',
  semrush_reports: 'Semrush reports',
  seo_content_engine_runs: 'content engine runs',
  ask_lvl3_conversations: 'Ask LVL3 conversations',
  client_annotations: 'annotations',
  client_context_items: 'stored context items',
  client_onboarding_sessions: 'setup sessions',
  user_client_access: 'user access grants',
}

export default function ClientDangerZone({
  clientId,
  impact,
  onArchive,
  onRestore,
  onDelete,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showDelete, setShowDelete] = useState(false)
  const [typed, setTyped] = useState('')

  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) => {
    setError(null)
    startTransition(async () => {
      const res = await fn()
      if (res.error) {
        setError(res.error)
        return
      }
      after?.()
      router.refresh()
    })
  }

  return (
    <div className="mt-12 rounded-sm border border-surface-800 bg-surface-900 p-5">
      <h2 className="text-surface-100 text-sm font-medium mb-1">
        {impact.archived ? 'Archived' : 'Archive this client'}
      </h2>
      <p className="text-surface-400 text-xs mb-4 max-w-2xl leading-relaxed">
        {impact.archived
          ? 'This client is hidden from every list, picker and report. Nothing has been deleted — restoring puts it back exactly as it was.'
          : 'Hides the client from every list, picker, report and sheet lookup. Nothing is deleted and you can restore it at any time.'}
      </p>

      {error && (
        <p className="mb-3 text-[11px]" style={{ color: 'var(--color-danger, #f87171)' }}>
          {error}
        </p>
      )}

      {!impact.archived ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => onArchive(clientId))}
          className="inline-flex items-center gap-1.5 rounded-sm border border-surface-800 px-3 py-2 text-xs font-medium text-surface-100 transition-colors hover:bg-surface-850 hover:border-surface-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          {pending ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
          Archive client
        </button>
      ) : (
        <>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => onRestore(clientId))}
            className="inline-flex items-center gap-1.5 rounded-sm border border-surface-800 px-3 py-2 text-xs font-medium text-surface-100 transition-colors hover:bg-surface-850 hover:border-surface-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            {pending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <ArchiveRestore size={13} />
            )}
            Restore client
          </button>

          <div
            className="mt-5 rounded-sm p-4"
            style={{
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: 'color-mix(in srgb, var(--color-danger, #f87171) 30%, transparent)',
              backgroundColor: 'color-mix(in srgb, var(--color-danger, #f87171) 7%, transparent)',
            }}
          >
            <div
              className="flex items-center gap-1.5 text-xs font-medium mb-2"
              style={{ color: 'var(--color-danger, #f87171)' }}
            >
              <TriangleAlert size={13} />
              Delete permanently
            </div>

            <p className="text-[11px] leading-relaxed text-surface-300 mb-3">
              This destroys the client and everything below. There is no undo and no backup.
            </p>

            <ul className="mb-3 space-y-0.5 text-[11px] text-surface-400">
              {impact.rows.map((r) => (
                <li key={r.table}>
                  <span className="text-surface-100 font-mono">{r.count}</span>{' '}
                  {TABLE_LABELS[r.table] ?? r.table}
                </li>
              ))}
              {impact.storageFiles > 0 && (
                <li>
                  <span className="text-surface-100 font-mono">{impact.storageFiles}</span> stored
                  files (logos, hero images, delivered work)
                </li>
              )}
              {impact.totalRows === 0 && impact.storageFiles === 0 && (
                <li>No associated records — this client has no history.</li>
              )}
            </ul>

            {impact.strandedUsers.length > 0 && (
              <div
                className="mb-3 rounded-sm px-3 py-2 text-[11px] leading-relaxed"
                style={{
                  color: 'var(--color-warning)',
                  backgroundColor: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
                }}
              >
                {impact.strandedUsers.length === 1 ? 'This user has' : 'These users have'} no other
                client. {impact.strandedUsers.length === 1 ? 'Their' : 'Their'} login will keep
                working but show an empty portal — deactivate{' '}
                {impact.strandedUsers.length === 1 ? 'them' : 'them'} separately if that is not what
                you want.
                <ul className="mt-1 space-y-0.5">
                  {impact.strandedUsers.map((u) => (
                    <li key={u.id} className="font-mono text-surface-300">
                      {u.email}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!showDelete ? (
              <button
                type="button"
                onClick={() => setShowDelete(true)}
                className="rounded-sm px-3 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                style={{
                  color: 'var(--color-danger, #f87171)',
                  backgroundColor:
                    'color-mix(in srgb, var(--color-danger, #f87171) 12%, transparent)',
                }}
              >
                I want to delete this permanently
              </button>
            ) : (
              <div className="space-y-2">
                <label className="block text-[11px] text-surface-300">
                  Type <span className="font-mono text-surface-100">{impact.clientName}</span> to
                  confirm
                </label>
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  className="w-full max-w-sm rounded-sm border border-surface-800 bg-surface-950 px-3 py-2 text-xs text-surface-100 placeholder-surface-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  placeholder={impact.clientName}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={pending || typed.trim() !== impact.clientName.trim()}
                    onClick={() =>
                      run(
                        () => onDelete(clientId, typed),
                        () => router.push('/clients'),
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                    style={{
                      color: 'var(--color-danger, #f87171)',
                      backgroundColor:
                        'color-mix(in srgb, var(--color-danger, #f87171) 16%, transparent)',
                    }}
                  >
                    {pending && <Loader2 size={12} className="animate-spin" />}
                    Delete {impact.clientName} for good
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDelete(false)
                      setTyped('')
                    }}
                    className="rounded-sm px-2 py-1.5 text-[11px] text-surface-400 transition-colors hover:text-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
