'use client'

import { useEffect } from 'react'
import { logError } from '@/lib/logging'

// Dashboard-scoped boundary: renders inside the dashboard shell (sidebar/nav
// stay intact) so a single page error doesn't take down the whole workspace.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logError('dashboard.error-boundary', error.message, error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 text-center">
      <p className="eyebrow mb-3">Something went wrong</p>
      <h1 className="text-xl font-semibold text-surface-100 mb-2">
        This view couldn&apos;t load
      </h1>
      <p className="text-sm text-surface-400 max-w-md mb-6">
        The error has been logged. Try again, or pick another page from the sidebar.
      </p>
      <button
        onClick={reset}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        Try again
      </button>
    </div>
  )
}
