'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)
  const [usePassword, setUsePassword] = useState(false)

  const supabase = createClient()
  const router   = useRouter()

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // Use the host the user actually loaded. The magic link must return to the
    // same origin where signInWithOtp ran, or the PKCE code-verifier cookie set
    // here won't be present at /auth/callback and the exchange fails.
    const origin = window.location.origin

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${origin}/auth/callback` },
    })

    if (error) { setError(error.message); setLoading(false); return }
    setSubmitted(true)
    setLoading(false)
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) { setError(error.message); setLoading(false); return }
    router.push('/')
    router.refresh()
  }

  return (
    // Full-page dark-ink hero — mirrors the editorial dark sections in the design system
    <div
      className="min-h-screen flex items-center justify-center px-4 py-16"
      style={{ backgroundColor: 'var(--background)' }}
    >
            <div className="w-full max-w-sm">

        {/* Brand mark — above the card. LVL3. in Archivo 800, accent period. */}
        <div className="text-center mb-8">
          <p
            className="text-4xl font-extrabold"
            style={{ color: 'var(--foreground)', letterSpacing: '-0.03em' }}
          >
            LVL3<span style={{ color: 'rgb(var(--brand-400))' }}>.</span>
          </p>
          <p
            className="mt-3 text-xs font-medium uppercase tracking-[0.14em]"
            style={{ color: 'var(--nav-text)' }}
          >
            Client Portal
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-sm p-8"
          style={{ backgroundColor: 'rgb(var(--surface-900))', border: '1px solid var(--color-border)' }}
        >
          {submitted ? (
            <div className="text-center space-y-3 py-2">
              {/* Accent check circle */}
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mx-auto text-2xl"
                style={{ backgroundColor: 'var(--active-bg-bold)', color: 'var(--color-accent)' }}
              >
                ✓
              </div>
              <p className="font-semibold text-surface-100" style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontVariantNumeric: 'tabular-nums' }}>
                Check your email
              </p>
              <p className="text-sm text-surface-400 leading-relaxed">
                We sent a magic link to{' '}
                <span className="text-surface-100 font-medium">{email}</span>.
                Click it to sign in.
              </p>
              <button
                type="button"
                onClick={() => { setSubmitted(false); setEmail('') }}
                className="text-xs text-surface-400 hover:text-surface-100 transition-colors mt-2"
              >
                Use a different email
              </button>
            </div>
          ) : usePassword ? (
            <form onSubmit={handlePasswordLogin} className="space-y-5">
              <div>
                <h1
                  className="text-xl font-medium text-surface-100 mb-1"
                  style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontVariantNumeric: 'tabular-nums' }}
                >
                  Sign in
                </h1>
                <p className="text-xs text-surface-400">Enter your email and password below.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="email-pw" className="block text-xs font-medium text-surface-400 mb-1.5 uppercase tracking-widest">
                    Email
                  </label>
                  <input
                    id="email-pw"
                    type="email"
                    required
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? 'login-error-pw' : undefined}
                    autoComplete="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full rounded-sm px-4 py-2.5 text-sm transition-colors hover:border-surface-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                    style={{
                      backgroundColor: 'rgb(var(--surface-950))',
                      border: '1px solid var(--color-border)',
                      color: 'var(--foreground)',
                    }}
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-xs font-medium text-surface-400 mb-1.5 uppercase tracking-widest">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    required
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? 'login-error-pw' : undefined}
                    autoComplete="current-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-sm px-4 py-2.5 text-sm transition-colors hover:border-surface-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                    style={{
                      backgroundColor: 'rgb(var(--surface-950))',
                      border: '1px solid var(--color-border)',
                      color: 'var(--foreground)',
                    }}
                  />
                </div>
              </div>

              {error && (
                <p id="login-error-pw" role="alert" className="flex items-start gap-2 text-sm rounded-sm px-3 py-2" style={{ color: 'var(--color-error)', backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)', borderWidth: 1, borderStyle: 'solid', borderColor: 'color-mix(in srgb, var(--color-error) 25%, transparent)' }}>{error}</p>
              )}

              {/* Primary button — ink bg + cream text per design spec */}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-sm px-4 py-2.5 text-sm font-semibold bg-brand-400 text-surface-950 transition-colors duration-200 hover:bg-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>

              <button
                type="button"
                onClick={() => { setUsePassword(false); setError(null) }}
                className="w-full text-xs text-surface-400 hover:text-surface-100 transition-colors py-1"
              >
                Use magic link instead →
              </button>
            </form>
          ) : (
            <form onSubmit={handleMagicLink} className="space-y-5">
              <div>
                <h1
                  className="text-xl font-medium text-surface-100 mb-1"
                  style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontVariantNumeric: 'tabular-nums' }}
                >
                  Welcome back
                </h1>
                <p className="text-xs text-surface-400">Enter your email — we&apos;ll send a sign-in link.</p>
              </div>

              <div>
                <label htmlFor="email" className="block text-xs font-medium text-surface-400 mb-1.5 uppercase tracking-widest">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'login-error' : undefined}
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full rounded-sm px-4 py-2.5 text-sm transition-colors hover:border-surface-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  style={{
                    backgroundColor: 'rgb(var(--surface-950))',
                    border: '1px solid var(--color-border)',
                    color: 'var(--foreground)',
                  }}
                />
              </div>

              {error && (
                <p id="login-error" role="alert" className="flex items-start gap-2 text-sm rounded-sm px-3 py-2" style={{ color: 'var(--color-error)', backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)', borderWidth: 1, borderStyle: 'solid', borderColor: 'color-mix(in srgb, var(--color-error) 25%, transparent)' }}>{error}</p>
              )}

              {/* Accent button — sienna bg + ink text */}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-sm px-4 py-2.5 text-sm font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--background)' }}
                onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--color-primary)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--color-accent)' }}
              >
                {loading ? 'Sending…' : 'Send magic link'}
              </button>

              <button
                type="button"
                onClick={() => { setUsePassword(true); setError(null) }}
                className="w-full text-xs text-surface-400 hover:text-surface-100 transition-colors py-1"
              >
                Sign in with password instead →
              </button>
            </form>
          )}
        </div>

        {/* Footer note */}
        <p className="text-center text-xs mt-6" style={{ color: 'var(--nav-text)' }}>
          Secure portal — access by invitation only
        </p>
      </div>
    </div>
  )
}
