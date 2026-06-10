'use client'

import { useEffect } from 'react'
import { logError } from '@/lib/logging'

// Replaces the root layout on a fatal error, so it ships its own html/body
// and inline styles (the global stylesheet may not be applied here).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logError('app.global-error', error.message, error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#FCFBF9',
          color: '#0A0A0A',
          fontFamily: 'Inter, system-ui, sans-serif',
          textAlign: 'center',
          padding: '0 24px',
        }}
      >
        <p
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: '#EF4444',
            margin: '0 0 12px',
          }}
        >
          Something went wrong
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: '0 0 8px' }}>
          The app hit a fatal error
        </h1>
        <p style={{ fontSize: 14, color: '#5C5B59', maxWidth: 420, margin: '0 0 24px' }}>
          The issue has been logged. Please try again.
        </p>
        <button
          onClick={reset}
          style={{
            border: 0,
            borderRadius: 8,
            background: '#DC2626',
            color: '#fff',
            fontSize: 14,
            fontWeight: 500,
            padding: '8px 16px',
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  )
}
