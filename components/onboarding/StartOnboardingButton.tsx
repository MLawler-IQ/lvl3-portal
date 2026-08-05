'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, MessagesSquare } from 'lucide-react'
import { startSession } from '@/app/actions/onboarding'
import { runDiscovery } from '@/app/actions/onboarding-discover'

export default function StartOnboardingButton({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleStart() {
    setLoading(true)
    setError(null)
    const res = await startSession(clientId)
    if (res.error || !res.session) {
      setLoading(false)
      setError(res.error ?? 'Could not start a session')
      return
    }

    // Discovery before the conversation, so the interview never asks for an id
    // the portal could already see. A discovery failure is not a session
    // failure — the interview still opens, just without the head start.
    setStatus('Looking for connected Google properties…')
    const d = await runDiscovery(res.session.id)
    setLoading(false)
    setStatus(null)
    if (d.error) setError(`Session started, but detection failed: ${d.error}`)
    router.refresh()
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleStart}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-sm bg-brand-400 px-4 py-2 text-sm font-semibold text-surface-950 transition-colors hover:bg-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <MessagesSquare size={14} />}
        Start interview
      </button>
      {status && <p className="mt-3 text-xs text-surface-400">{status}</p>}
      {error && (
        <p className="mt-3 text-xs" style={{ color: 'var(--color-error)' }} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
