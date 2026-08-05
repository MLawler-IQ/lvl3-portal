'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, MessagesSquare } from 'lucide-react'
import { startSession } from '@/app/actions/onboarding'

export default function StartOnboardingButton({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleStart() {
    setLoading(true)
    setError(null)
    const res = await startSession(clientId)
    setLoading(false)
    if (res.error) setError(res.error)
    else router.refresh()
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
      {error && (
        <p className="mt-3 text-xs" style={{ color: 'var(--color-error)' }} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
