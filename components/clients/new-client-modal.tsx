'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, RefreshCw } from 'lucide-react'
import { createClient } from '@/app/actions/clients'
import { fetchLogoUrl } from '@/app/actions/analytics'
import { uniqueSlug } from '@/lib/slug'

interface NewClientModalProps {
  onClose: () => void
  /**
   * Slugs already in use, so the derived slug never lands on a taken one.
   *
   * Must include ARCHIVED clients. They are hidden from every list in the app,
   * but they keep their slug in the unique index — deriving this from the
   * visible client list is what let "Tornado HVAC" be proposed while an archived
   * client already held `tornado-hvac`. The server checks again regardless: this
   * list is a snapshot, and it is stale the moment anyone else creates a client.
   */
  existingSlugs?: string[]
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'

export default function NewClientModal({ onClose, existingSlugs = [] }: NewClientModalProps) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugManual, setSlugManual] = useState(false)
  const [website, setWebsite] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [logoFetching, setLogoFetching] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  // Focus trap — pattern copied from CommandPalette
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'Tab') {
        const panel = panelRef.current
        if (!panel) return
        const els = panel.querySelectorAll<HTMLElement>(FOCUSABLE)
        if (!els.length) return
        const first = els[0]
        const last = els[els.length - 1]
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function handleNameChange(val: string) {
    setName(val)
    // Track the name until the admin edits the slug themselves. After that the
    // slug is theirs and re-deriving would silently discard their edit.
    if (!slugManual) setSlug(uniqueSlug(val, existingSlugs))
  }

  async function handleFetchLogo() {
    if (!website) return
    setLogoFetching(true)
    try {
      const url = await fetchLogoUrl(website)
      if (url) setLogoUrl(url)
    } finally {
      setLogoFetching(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.set('name', name)
      fd.set('slug', slug)
      fd.set('logo_url', logoUrl)
      // Persisted now, and used as the match key for auto-discovery.
      fd.set('website', website)
      const res = await createClient(fd)
      // createClient returns its errors rather than throwing: Next redacts
      // thrown server-action errors in production, which turned a plain "that
      // slug is taken" into an unreadable digest.
      if (res.error || !res.id) {
        setError(res.error ?? 'Something went wrong')
        setLoading(false)
        return
      }
      const id = res.id
      onClose()
      // Creation captures only name/website/slug/logo. Everything else — GA4, GSC, GBP,
      // client type, competitors — is captured by the onboarding interview, so
      // go straight there rather than leaving a half-configured client behind.
      // Setup lives on the client page now; /onboarding still redirects here for
      // older links, but there is no reason to route through it.
      router.push(`/clients/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-client-title"
        className="relative bg-surface-900 border border-surface-700 rounded-sm w-full max-w-md p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 id="new-client-title" className="font-serif text-surface-100 text-lg">New client</h2>
          <button onClick={onClose} aria-label="Close dialog" className="text-surface-400 hover:text-surface-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <p className="text-xs text-surface-400 mb-5 leading-relaxed">
          Name and website are all we need. Saving opens the onboarding interview,
          which uses the website to find the GA4, Search Console and Business Profile
          accounts, then captures service area, job values and the rest.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-surface-300 mb-1.5">
              Name <span className="text-brand-400">*</span>
            </label>
            <input
              ref={nameRef}
              type="text"
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'new-client-error' : undefined}
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Acme Corp"
              className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-surface-100 placeholder-surface-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-surface-300 mb-1.5">
              Website <span className="text-brand-400">*</span>
            </label>
            {/* The domain is the match key auto-discovery uses to find the GA4
                property, the Search Console site and the GBP location, so a
                client created without one starts onboarding with nothing to
                match against. Asked for up front, not treated as an extra. */}
            <div className="flex gap-2">
              <input
                type="text"
                required
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="acme.com"
                className="flex-1 bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-surface-100 placeholder-surface-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 text-sm"
              />
              <button
                type="button"
                onClick={handleFetchLogo}
                disabled={!website || logoFetching}
                className="shrink-0 bg-surface-800 border border-surface-600 text-surface-300 rounded-lg px-3 py-2 text-sm hover:bg-surface-700 hover:text-surface-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <RefreshCw size={12} className={logoFetching ? 'animate-spin' : ''} />
                Fetch Logo
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-surface-300 mb-1.5">
              Slug{' '}
              <span className="text-surface-400 text-xs font-normal">
                {slugManual ? '(edited)' : '(from name)'}
              </span>
            </label>
            <input
              type="text"
              required
              value={slug}
              onChange={(e) => {
                setSlugManual(true)
                setSlug(e.target.value)
              }}
              placeholder="acme-corp"
              className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-surface-100 placeholder-surface-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 text-sm font-mono"
            />
            <p className="mt-1.5 text-xs text-surface-400">
              Used in URLs and exports. Derived from the name — edit it and it stops following.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-surface-300 mb-1.5">
              Logo URL <span className="text-surface-400 text-xs font-normal">(optional)</span>
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="url"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://..."
                className="flex-1 bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-surface-100 placeholder-surface-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 text-sm"
              />
              {logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt="Logo preview"
                  className="w-8 h-8 rounded-sm object-contain bg-surface-100 p-0.5 shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              )}
            </div>
          </div>

          {error && <p id="new-client-error" role="alert" className="text-error text-sm">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-surface-800 text-surface-300 rounded-lg px-4 py-2 text-sm font-medium hover:bg-surface-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim() || !website.trim() || !slug.trim()}
              className="flex-1 bg-brand-400 text-surface-950 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-brand-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating…' : 'Create client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
