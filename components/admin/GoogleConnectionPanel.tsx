'use client'

import { useState, useEffect } from 'react'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { getAdminGoogleStatus, disconnectAdminGoogle } from '@/app/actions/admin-google'
import ConnectionBanner from './ConnectionBanner'

interface Props {
  googleParam: string | null
}

export default function GoogleConnectionPanel({ googleParam }: Props) {
  const [connected, setConnected] = useState(false)
  const [email, setEmail] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    if (googleParam === 'connected') {
      setBanner({ type: 'success', message: 'Google account connected successfully.' })
    } else if (googleParam === 'error') {
      setBanner({ type: 'error', message: 'Google connection failed. Try again.' })
    }

    getAdminGoogleStatus().then((status) => {
      setConnected(status.connected)
      setEmail(status.email)
      setLoading(false)
    })
  }, [googleParam])

  function handleConnect() {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    const redirectUri = `${window.location.origin}/auth/google-callback`
    const scopes = [
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/webmasters.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/business.manage',
    ].join(' ')

    const params = new URLSearchParams({
      client_id: clientId ?? '',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      access_type: 'offline',
      prompt: 'consent',
    })

    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    const result = await disconnectAdminGoogle()
    if (result.error) {
      setBanner({ type: 'error', message: result.error })
    } else {
      setConnected(false)
      setEmail(undefined)
      setBanner({ type: 'success', message: 'Google account disconnected.' })
    }
    setDisconnecting(false)
  }

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-surface-100">Google Account</p>
          <p className="text-xs text-surface-400 mt-0.5">
            Powers GA4, Search Console, and Google Sheets access across all clients.
          </p>
        </div>
        {loading ? (
          <Loader2 size={16} className="text-surface-400 animate-spin" />
        ) : connected ? (
          <CheckCircle size={16} className="text-accent-400" />
        ) : (
          <XCircle size={16} className="text-surface-400" />
        )}
      </div>

      <ConnectionBanner banner={banner} />

      {!loading && (
        connected ? (
          <div className="flex items-center justify-between">
            <p className="text-xs text-surface-400">{email ?? 'Connected'}</p>
            <div className="flex items-center gap-3">
              <button
                onClick={handleConnect}
                className="text-xs text-surface-400 hover:text-surface-300 transition-colors"
              >
                Reconnect
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="text-xs text-error hover:text-error/80 transition-colors disabled:opacity-50"
              >
                {disconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleConnect}
            className="text-sm font-medium bg-brand-400 hover:bg-brand-300 text-surface-950 px-4 py-2 rounded-lg transition-colors"
          >
            Connect Google Account
          </button>
        )
      )}
    </div>
  )
}
