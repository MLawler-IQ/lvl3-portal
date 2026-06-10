'use client'

import { useEffect } from 'react'
import { logError } from '@/lib/logging'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logError('app.error-boundary', error.message, error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <p className="eyebrow mb-3">Something went wrong</p>
      <h1 className="text-2xl font-semibold text-surface-100 mb-2">
        This page hit an unexpected error
      </h1>
      <p className="text-sm text-surface-400 max-w-md mb-6">
        The issue has been logged. You can try again, or head back home.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Try again
        </button>
        <a
          href="/"
          className="rounded-lg border border-surface-700 px-4 py-2 text-sm font-medium text-surface-300 hover:bg-surface-850"
        >
          Go home
        </a>
      </div>
    </div>
  )
}
