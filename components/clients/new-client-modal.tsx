'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, RefreshCw } from 'lucide-react'
import { createClient } from '@/app/actions/clients'
import { fetchLogoUrl } from '@/app/actions/analytics'

interface NewClientModalProps {
  onClose: () => void
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'

function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export default function NewClientModal({ onClose }: NewClientModalProps) {
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
    if (!slugManual) setSlug(slugify(val))
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
      await createClient(fd)
      router.refresh()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-client-title"
        className="relative bg-surface-900 border border-surface-700 rounded-xl w-full max-w-md p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 id="new-client-title" className="text-surface-100 font-semibold text-lg">New client</h2>
          <button onClick={onClose} aria-label="Close dialog" className="text-surface-500 hover:text-surface-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-surface-300 mb-1.5">
              Name <span className="text-red-400">*</span>
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
              className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-surface-100/20 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-surface-300 mb-1.5">
              Slug <span className="text-surface-500 text-xs font-normal">(auto-generated)</span>
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
              className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-surface-100/20 text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-surface-300 mb-1.5">
              Website <span className="text-surface-500 text-xs font-normal">(optional)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="acme.com"
                className="flex-1 bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-surface-100/20 text-sm"
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
              Logo URL <span className="text-surface-500 text-xs font-normal">(optional)</span>
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="url"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://..."
                className="flex-1 bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-surface-100/20 text-sm"
              />
              {logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt="Logo preview"
                  className="w-8 h-8 rounded object-contain bg-white p-0.5 shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              )}
            </div>
          </div>

          {error && <p id="new-client-error" role="alert" className="text-red-400 text-sm">{error}</p>}

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
              disabled={loading || !name.trim() || !slug.trim()}
              className="flex-1 bg-brand-400 text-surface-950 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-brand-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating…' : 'Create client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
