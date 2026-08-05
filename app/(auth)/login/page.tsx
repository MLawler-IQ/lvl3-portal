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
    // Paper login. The only light surface in the app — see REBRAND-NOTES.md.
    // Uses the paper end of the token scale (surface-100/200/300/500,
    // brand-600/700), which shipped with the rebrand for exactly this. No new
    // colours. Everything behind auth stays ink.
    <div data-surface="paper" className="min-h-screen flex items-center justify-center px-4 py-16 bg-surface-100">
      <div className="w-full max-w-sm">

        {/* Brand mark. LVL3. in Archivo 800, paper accent period. */}
        <div className="text-center mb-8">
          <p
            className="text-4xl font-extrabold text-surface-950"
            style={{ letterSpacing: '-0.03em' }}
          >
            LVL3<span className="text-brand-600">.</span>
          </p>
          <p className="mt-3 text-xs font-medium uppercase tracking-[0.14em] text-surface-500">
            Client Portal
          </p>
        </div>

        {/* Card */}
        <div className="rounded-sm border border-surface-200 p-8">
          {submitted ? (
            <div className="text-center space-y-3 py-2">
              {/* Accent check circle */}
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto text-2xl bg-brand-600/10 text-brand-600">
                ✓
              </div>
              <p className="font-semibold text-surface-950" style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontVariantNumeric: 'tabular-nums' }}>
                Check your email
              </p>
              <p className="text-sm text-surface-500 leading-relaxed">
                We sent a magic link to{' '}
                <span className="text-surface-950 font-medium">{email}</span>.
                Click it to sign in.
              </p>
              <button
                type="button"
                onClick={() => { setSubmitted(false); setEmail('') }}
                className="text-xs text-surface-500 hover:text-surface-950 transition-colors mt-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              >
                Use a different email
              </button>
            </div>
          ) : usePassword ? (
            <form onSubmit={handlePasswordLogin} className="space-y-5">
              <div>
                <h1
                  className="text-xl font-medium text-surface-950 mb-1"
                  style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontVariantNumeric: 'tabular-nums' }}
                >
                  Sign in
                </h1>
                <p className="text-xs text-surface-500">Enter your email and password below.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="email-pw" className="block text-xs font-medium text-surface-500 mb-1.5 uppercase tracking-widest">
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
                    className="w-full rounded-sm px-4 py-2.5 text-sm bg-surface-100 text-surface-950 placeholder-surface-500 border border-surface-200 transition-colors hover:border-surface-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-xs font-medium text-surface-500 mb-1.5 uppercase tracking-widest">
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
                    className="w-full rounded-sm px-4 py-2.5 text-sm bg-surface-100 text-surface-950 placeholder-surface-500 border border-surface-200 transition-colors hover:border-surface-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                  />
                </div>
              </div>

              {error && (
                <p id="login-error-pw" role="alert" className="flex items-start gap-2 text-sm rounded-sm px-3 py-2 bg-surface-950" style={{ color: 'var(--color-error)' }}>{error}</p>
              )}

              {/* Primary button — paper accent (brand-600, 5.4:1 on paper) + paper text */}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-sm px-4 py-2.5 text-sm font-semibold bg-brand-600 text-surface-100 transition-colors duration-200 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>

              <button
                type="button"
                onClick={() => { setUsePassword(false); setError(null) }}
                className="w-full text-xs text-surface-500 hover:text-surface-950 transition-colors py-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              >
                Use magic link instead →
              </button>
            </form>
          ) : (
            <form onSubmit={handleMagicLink} className="space-y-5">
              <div>
                <h1
                  className="text-xl font-medium text-surface-950 mb-1"
                  style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontVariantNumeric: 'tabular-nums' }}
                >
                  Welcome back
                </h1>
                <p className="text-xs text-surface-500">Enter your email — we&apos;ll send a sign-in link.</p>
              </div>

              <div>
                <label htmlFor="email" className="block text-xs font-medium text-surface-500 mb-1.5 uppercase tracking-widest">
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
                  className="w-full rounded-sm px-4 py-2.5 text-sm bg-surface-100 text-surface-950 placeholder-surface-500 border border-surface-200 transition-colors hover:border-surface-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                />
              </div>

              {error && (
                <p id="login-error" role="alert" className="flex items-start gap-2 text-sm rounded-sm px-3 py-2 bg-surface-950" style={{ color: 'var(--color-error)' }}>{error}</p>
              )}

              {/* Accent button — paper accent (brand-600) + paper text */}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-sm px-4 py-2.5 text-sm font-semibold bg-brand-600 text-surface-100 transition-colors duration-200 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Sending…' : 'Send magic link'}
              </button>

              <button
                type="button"
                onClick={() => { setUsePassword(true); setError(null) }}
                className="w-full text-xs text-surface-500 hover:text-surface-950 transition-colors py-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              >
                Sign in with password instead →
              </button>
            </form>
          )}
        </div>

        {/* Footer note */}
        <p className="text-center text-xs mt-6 text-surface-500">
          Secure portal — access by invitation only
        </p>
      </div>
    </div>
  )
}
