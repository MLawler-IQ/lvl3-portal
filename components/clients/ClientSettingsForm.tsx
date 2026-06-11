'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, Wand2 } from 'lucide-react'
import { updateClient } from '@/app/actions/clients'
import {
  fetchLogoUrl,
  getSheetHeadersAction,
  generateAnalyticsInsights,
  listGA4Properties,
  listGSCSiteOptions,
  type GA4PropertyOption,
  type GSCSiteOption,
} from '@/app/actions/analytics'
import { fetchGBPAccounts } from '@/app/actions/tools-extended'
import type { GBPAccount } from '@/lib/connectors/gbp'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import { CLIENT_TYPES, CLIENT_TYPE_LABELS, type ClientType, type Targets } from '@/lib/dashboard/types'
import { inferClientType } from '@/lib/dashboard/registry'
import { TARGET_METRIC_IDS, TARGET_METRIC_LABELS } from '@/lib/dashboard/pacing'

interface ClientData {
  id: string
  name: string
  slug: string
  logo_url: string | null
  hero_image_url: string | null
  google_sheet_id: string | null
  looker_embed_url: string | null
  sheet_header_row: number | null
  sheet_column_map: Record<string, string> | null
  ga4_property_id: string | null
  gsc_site_url: string | null
  brand_context: string | null
  client_type: string | null
  gbp_account_id: string | null
  gbp_location_group: string | null
  key_event_names: string[] | null
  competitors: string[] | null
  targets: Targets | null
}

interface Props {
  client: ClientData
}

const COLUMN_FIELDS = [
  { key: 'month', label: 'Month' },
  { key: 'category', label: 'Category / Service' },
  { key: 'task', label: 'Task' },
  { key: 'status', label: 'Status' },
  { key: 'fee', label: 'Fee / Budget' },
  { key: 'note', label: 'Notes' },
] as const

type ColumnField = (typeof COLUMN_FIELDS)[number]['key']

export default function ClientSettingsForm({ client }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Basic info
  const [name, setName] = useState(client.name)
  const [slug, setSlug] = useState(client.slug)
  const [logoUrl, setLogoUrl] = useState(client.logo_url ?? '')
  const [heroImageUrl, setHeroImageUrl] = useState(client.hero_image_url ?? '')
  const [heroUploading, setHeroUploading] = useState(false)
  const [website, setWebsite] = useState('')

  // Brand Context
  const [brandContext, setBrandContext] = useState(client.brand_context ?? '')

  // Google Sheet
  const [sheetIdOrUrl, setSheetIdOrUrl] = useState(client.google_sheet_id ?? '')
  const [headerRow, setHeaderRow] = useState(client.sheet_header_row ?? 1)
  const [headers, setHeaders] = useState<string[]>([])
  const [columnMap, setColumnMap] = useState<Record<string, string>>(
    client.sheet_column_map ?? {}
  )

  // Looker
  const [lookerUrl, setLookerUrl] = useState(client.looker_embed_url ?? '')

  // Analytics
  const [ga4PropertyId, setGa4PropertyId] = useState(client.ga4_property_id ?? '')
  const [gscSiteUrl, setGscSiteUrl] = useState(client.gsc_site_url ?? '')
  const [ga4Properties, setGa4Properties] = useState<GA4PropertyOption[]>([])
  const [ga4Loading, setGa4Loading] = useState(false)
  const [ga4LoadError, setGa4LoadError] = useState<string | null>(null)
  const [gscSiteOptions, setGscSiteOptions] = useState<GSCSiteOption[]>([])
  const [gscOptionsLoading, setGscOptionsLoading] = useState(false)

  // Dashboard type
  const [clientType, setClientType] = useState<ClientType | ''>(
    CLIENT_TYPES.includes(client.client_type as ClientType)
      ? (client.client_type as ClientType)
      : ''
  )
  const [detectHint, setDetectHint] = useState<string | null>(null)

  // Google Business Profile mapping
  const [gbpAccountId, setGbpAccountId] = useState(client.gbp_account_id ?? '')
  const [gbpLocationGroup, setGbpLocationGroup] = useState(client.gbp_location_group ?? '')
  const [gbpAccounts, setGbpAccounts] = useState<GBPAccount[]>([])
  const [gbpAccountsLoading, setGbpAccountsLoading] = useState(false)
  const [gbpAccountsError, setGbpAccountsError] = useState<string | null>(null)

  // Key events + competitors (text[] → comma/newline separated)
  const [keyEventNames, setKeyEventNames] = useState((client.key_event_names ?? []).join(', '))
  const [competitors, setCompetitors] = useState((client.competitors ?? []).join(', '))

  // Monthly goals (clients.targets jsonb) → metric id → string input value
  const [targets, setTargets] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const metricId of TARGET_METRIC_IDS) {
      const value = client.targets?.[metricId]?.value
      init[metricId] = typeof value === 'number' && value > 0 ? String(value) : ''
    }
    return init
  })

  // UI states
  const [logoFetching, setLogoFetching] = useState(false)
  const [headersLoading, setHeadersLoading] = useState(false)
  const [headersError, setHeadersError] = useState<string | null>(null)
  const [analyticsRefreshing, setAnalyticsRefreshing] = useState(false)
  const [analyticsError, setAnalyticsError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

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

  async function handleHeroUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setHeroUploading(true)
    try {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `${client.id}/hero.${ext}`
      const supabase = createSupabaseClient()
      const { error: uploadError } = await supabase.storage
        .from('client-assets')
        .upload(path, file, { upsert: true })
      if (uploadError) throw uploadError
      const { data } = supabase.storage.from('client-assets').getPublicUrl(path)
      setHeroImageUrl(data.publicUrl)
    } finally {
      setHeroUploading(false)
    }
  }

  async function handleLoadHeaders() {
    if (!sheetIdOrUrl) return
    setHeadersLoading(true)
    setHeadersError(null)
    const result = await getSheetHeadersAction(sheetIdOrUrl, headerRow)
    if (result.error) {
      setHeadersError(result.error)
    } else if (result.headers) {
      setHeaders(result.headers)
    }
    setHeadersLoading(false)
  }

  async function handleLoadGA4Properties() {
    setGa4Loading(true)
    setGa4LoadError(null)
    const result = await listGA4Properties()
    if (result.properties) setGa4Properties(result.properties)
    if (result.error) setGa4LoadError(result.error)
    setGa4Loading(false)
  }

  async function handleLoadGSCSites() {
    setGscOptionsLoading(true)
    const result = await listGSCSiteOptions()
    if (result.sites) setGscSiteOptions(result.sites)
    setGscOptionsLoading(false)
  }

  async function handleLoadGBPAccounts() {
    setGbpAccountsLoading(true)
    setGbpAccountsError(null)
    const result = await fetchGBPAccounts()
    if (result.data) setGbpAccounts(result.data)
    if (result.error) setGbpAccountsError(result.error)
    setGbpAccountsLoading(false)
  }

  // Heuristic best-guess based on the signals available in this form. Admin
  // always confirms; we pass conservative zeros where data isn't wired in here.
  function handleAutoDetect() {
    const suggestion = inferClientType({})
    setClientType(suggestion)
    setDetectHint(
      `Suggested ${CLIENT_TYPE_LABELS[suggestion]} — adjust if needed, then Save.`
    )
  }

  async function handleRefreshAnalytics() {
    setAnalyticsRefreshing(true)
    setAnalyticsError(null)
    const result = await generateAnalyticsInsights(client.id)
    if (result.error) {
      setAnalyticsError(result.error)
    } else {
      router.refresh()
    }
    setAnalyticsRefreshing(false)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaveError(null)
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('name', name)
        fd.set('slug', slug)
        fd.set('logo_url', logoUrl)
        fd.set('hero_image_url', heroImageUrl)
        fd.set('google_sheet_id', sheetIdOrUrl)
        fd.set('looker_embed_url', lookerUrl)
        fd.set('sheet_header_row', String(headerRow))
        fd.set(
          'sheet_column_map',
          Object.keys(columnMap).length > 0 ? JSON.stringify(columnMap) : ''
        )
        fd.set('ga4_property_id', ga4PropertyId)
        fd.set('gsc_site_url', gscSiteUrl)
        fd.set('brand_context', brandContext)
        fd.set('client_type', clientType)
        fd.set('gbp_account_id', gbpAccountId)
        fd.set('gbp_location_group', gbpLocationGroup)
        fd.set('key_event_names', keyEventNames)
        fd.set('competitors', competitors)
        for (const metricId of TARGET_METRIC_IDS) {
          fd.set(`target_${metricId}`, targets[metricId] ?? '')
        }
        await updateClient(client.id, fd)
        router.refresh()
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save changes')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ── Basic Info ─────────────────────────────────────────────── */}
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 space-y-4">
        <h2 className="text-surface-100 font-semibold text-sm uppercase tracking-wide">Basic Info</h2>

        {/* Hero Image Upload */}
        <div>
          <label className="block text-surface-400 text-sm mb-1.5">Hero Image</label>
          {heroImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={heroImageUrl}
              alt="Hero preview"
              className="w-full h-32 object-cover rounded-lg mb-2 bg-surface-800"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          )}
          <input
            type="file"
            accept="image/*"
            onChange={handleHeroUpload}
            disabled={heroUploading}
            className="block w-full text-sm text-surface-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-surface-800 file:text-surface-300 hover:file:bg-surface-700 disabled:opacity-50"
          />
          {heroUploading && <p className="text-xs text-surface-500 mt-1">Uploading…</p>}
          <input type="hidden" name="hero_image_url" value={heroImageUrl} />
        </div>

        <div>
          <label className="block text-surface-400 text-sm mb-1.5">Name</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-surface-400 text-sm mb-1.5">Slug</label>
          <input
            type="text"
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="w-full bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
          />
        </div>

        <div>
          <label className="block text-surface-400 text-sm mb-1.5">Website</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="acme.com"
              className="flex-1 bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 placeholder-surface-500"
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
          <label className="block text-surface-400 text-sm mb-1.5">Logo URL</label>
          <div className="flex gap-2 items-center">
            <input
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://..."
              className="flex-1 bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 placeholder-surface-500"
            />
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt="Logo preview"
                className="w-8 h-8 rounded object-contain bg-white p-0.5 shrink-0"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Dashboard Type ───────────────────────────────────────────── */}
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-surface-100 font-semibold text-sm uppercase tracking-wide">Dashboard Type</h2>
          <button
            type="button"
            onClick={handleAutoDetect}
            className="shrink-0 bg-surface-800 border border-surface-600 text-surface-300 rounded-lg px-3 py-1.5 text-xs hover:bg-surface-700 hover:text-surface-100 transition-colors flex items-center gap-1.5"
          >
            <Wand2 size={12} />
            Auto-detect
          </button>
        </div>
        <p className="text-surface-500 text-xs">
          Archetype that drives which modules this client&rsquo;s dashboard shows by default.
          Leave as Generic for the core module set.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {/* Generic / null option */}
          <label
            className={`flex items-center gap-2.5 cursor-pointer rounded-lg border px-3 py-2.5 text-sm transition-colors ${
              clientType === ''
                ? 'border-brand-500 bg-brand-500/10 text-surface-100'
                : 'border-surface-600 bg-surface-800 text-surface-300 hover:border-surface-500'
            }`}
          >
            <input
              type="radio"
              name="client_type_radio"
              value=""
              checked={clientType === ''}
              onChange={() => {
                setClientType('')
                setDetectHint(null)
              }}
              className="accent-brand-500"
            />
            Generic
          </label>
          {CLIENT_TYPES.map((t) => (
            <label
              key={t}
              className={`flex items-center gap-2.5 cursor-pointer rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                clientType === t
                  ? 'border-brand-500 bg-brand-500/10 text-surface-100'
                  : 'border-surface-600 bg-surface-800 text-surface-300 hover:border-surface-500'
              }`}
            >
              <input
                type="radio"
                name="client_type_radio"
                value={t}
                checked={clientType === t}
                onChange={() => {
                  setClientType(t)
                  setDetectHint(null)
                }}
                className="accent-brand-500"
              />
              {CLIENT_TYPE_LABELS[t]}
            </label>
          ))}
        </div>
        {detectHint && <p className="text-brand-400 text-xs">{detectHint}</p>}
      </div>

      {/* ── Brand Context ────────────────────────────────────────────── */}
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 space-y-4">
        <h2 className="text-surface-100 font-semibold text-sm uppercase tracking-wide">Brand Context</h2>
        <p className="text-surface-500 text-xs">
          Brand voice, tone, and style instructions for AI content generation. This auto-populates in the SEO Content Engine.
        </p>
        <textarea
          value={brandContext}
          onChange={(e) => setBrandContext(e.target.value)}
          placeholder="e.g., Professional, authoritative tone. Avoid first person. Focus on residential services. Emphasize 24/7 availability and licensed technicians..."
          rows={6}
          className="w-full bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 placeholder-surface-500 resize-y"
        />
      </div>

      {/* ── Google Sheet ───────────────────────────────────────────── */}
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 space-y-4">
        <h2 className="text-surface-100 font-semibold text-sm uppercase tracking-wide">Google Sheet</h2>

        <div>
          <label className="block text-surface-400 text-sm mb-1.5">Sheet URL or ID</label>
          <input
            type="text"
            value={sheetIdOrUrl}
            onChange={(e) => setSheetIdOrUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/SHEET_ID/edit"
            className="w-full bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 placeholder-surface-500"
          />
          <p className="text-surface-500 text-xs mt-1.5">
            Paste the full URL or just the Sheet ID — both work.
          </p>
        </div>

        <div>
          <label className="block text-surface-400 text-sm mb-1.5">Header Row</label>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              min={1}
              value={headerRow}
              onChange={(e) => setHeaderRow(parseInt(e.target.value) || 1)}
              className="w-24 bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              type="button"
              onClick={handleLoadHeaders}
              disabled={!sheetIdOrUrl || headersLoading}
              className="bg-surface-800 border border-surface-600 text-surface-300 rounded-lg px-3 py-2 text-sm hover:bg-surface-700 hover:text-surface-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <RefreshCw size={12} className={headersLoading ? 'animate-spin' : ''} />
              Load Headers
            </button>
          </div>
          {headersError && <p className="text-red-400 text-xs mt-1.5">{headersError}</p>}
        </div>

        {headers.length > 0 && (
          <div>
            <p className="text-surface-400 text-sm mb-2">Detected columns:</p>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {headers.map((h) => (
                <span
                  key={h}
                  className="text-xs bg-surface-800 border border-surface-600 text-surface-300 px-2 py-0.5 rounded-full"
                >
                  {h}
                </span>
              ))}
            </div>

            <p className="text-surface-400 text-sm mb-3">Map columns to fields:</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {COLUMN_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-surface-500 text-xs mb-1">{label}</label>
                  <select
                    value={columnMap[key as ColumnField] ?? ''}
                    onChange={(e) =>
                      setColumnMap((prev) => {
                        const next = { ...prev }
                        if (e.target.value) {
                          next[key as ColumnField] = e.target.value
                        } else {
                          delete next[key as ColumnField]
                        }
                        return next
                      })
                    }
                    className="w-full bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">— not mapped —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {headers.length === 0 && client.sheet_column_map && Object.keys(client.sheet_column_map).length > 0 && (
          <div>
            <p className="text-surface-500 text-xs">
              Current mapping saved. Click &ldquo;Load Headers&rdquo; to edit column mapping.
            </p>
          </div>
        )}
      </div>

      {/* ── Looker Studio ──────────────────────────────────────────── */}
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 space-y-4">
        <h2 className="text-surface-100 font-semibold text-sm uppercase tracking-wide">Looker Studio</h2>

        <div>
          <label className="block text-surface-400 text-sm mb-1.5">Embed URL</label>
          <input
            type="url"
            value={lookerUrl}
            onChange={(e) => setLookerUrl(e.target.value)}
            placeholder="https://lookerstudio.google.com/embed/reporting/..."
            className="w-full bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 placeholder-surface-500"
          />
        </div>
      </div>

      {/* ── Analytics ──────────────────────────────────────────────── */}
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 space-y-4">
        <h2 className="text-surface-100 font-semibold text-sm uppercase tracking-wide">Analytics</h2>

        <div>
          <label className="block text-surface-400 text-sm mb-1.5">GA4 Property</label>
          <div className="flex gap-2">
            <select
              value={ga4PropertyId}
              onChange={(e) => setGa4PropertyId(e.target.value)}
              className="flex-1 bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">— select a property —</option>
              {ga4Properties.map((p) => (
                <option key={p.propertyId} value={p.propertyId}>
                  {p.displayName} ({p.propertyId})
                </option>
              ))}
              {ga4PropertyId && !ga4Properties.find((p) => p.propertyId === ga4PropertyId) && (
                <option value={ga4PropertyId}>{ga4PropertyId} (currently saved)</option>
              )}
            </select>
            <button
              type="button"
              onClick={handleLoadGA4Properties}
              disabled={ga4Loading}
              className="shrink-0 bg-surface-800 border border-surface-600 text-surface-300 rounded-lg px-3 py-2 text-sm hover:bg-surface-700 hover:text-surface-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <RefreshCw size={12} className={ga4Loading ? 'animate-spin' : ''} />
              {ga4Loading ? 'Loading…' : 'Load'}
            </button>
          </div>
          {ga4LoadError && <p className="text-red-400 text-xs mt-1.5">{ga4LoadError}</p>}
        </div>

        <div>
          <label className="block text-surface-400 text-sm mb-1.5">Search Console Site</label>
          <div className="flex gap-2">
            <select
              value={gscSiteUrl}
              onChange={(e) => setGscSiteUrl(e.target.value)}
              className="flex-1 bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">— select a site —</option>
              {gscSiteOptions.map((s) => (
                <option key={s.siteUrl} value={s.siteUrl}>
                  {s.siteUrl}
                </option>
              ))}
              {gscSiteUrl && !gscSiteOptions.find((s) => s.siteUrl === gscSiteUrl) && (
                <option value={gscSiteUrl}>{gscSiteUrl} (currently saved)</option>
              )}
            </select>
            <button
              type="button"
              onClick={handleLoadGSCSites}
              disabled={gscOptionsLoading}
              className="shrink-0 bg-surface-800 border border-surface-600 text-surface-300 rounded-lg px-3 py-2 text-sm hover:bg-surface-700 hover:text-surface-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <RefreshCw size={12} className={gscOptionsLoading ? 'animate-spin' : ''} />
              {gscOptionsLoading ? 'Loading…' : 'Load'}
            </button>
          </div>
        </div>

        <div className="pt-1">
          <button
            type="button"
            onClick={handleRefreshAnalytics}
            disabled={analyticsRefreshing || (!ga4PropertyId && !gscSiteUrl)}
            className="flex items-center gap-2 bg-surface-800 border border-surface-600 text-surface-300 rounded-lg px-4 py-2 text-sm hover:bg-surface-700 hover:text-surface-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={13} className={analyticsRefreshing ? 'animate-spin' : ''} />
            {analyticsRefreshing ? 'Refreshing…' : 'Refresh Analytics Insights'}
          </button>
          {analyticsError && (
            <p className="text-red-400 text-xs mt-2 max-w-md">{analyticsError}</p>
          )}
        </div>
      </div>

      {/* ── Google Business Profile ──────────────────────────────────── */}
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 space-y-4">
        <h2 className="text-surface-100 font-semibold text-sm uppercase tracking-wide">Google Business Profile</h2>
        <p className="text-surface-500 text-xs">
          Maps this client to a GBP account for dashboard location insights.
        </p>

        <div>
          <label className="block text-surface-400 text-sm mb-1.5">GBP Account</label>
          <div className="flex gap-2">
            <select
              value={gbpAccountId}
              onChange={(e) => setGbpAccountId(e.target.value)}
              className="flex-1 bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">— not mapped —</option>
              {gbpAccounts.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.accountName || a.name} ({a.name})
                </option>
              ))}
              {gbpAccountId && !gbpAccounts.find((a) => a.name === gbpAccountId) && (
                <option value={gbpAccountId}>{gbpAccountId} (currently saved)</option>
              )}
            </select>
            <button
              type="button"
              onClick={handleLoadGBPAccounts}
              disabled={gbpAccountsLoading}
              className="shrink-0 bg-surface-800 border border-surface-600 text-surface-300 rounded-lg px-3 py-2 text-sm hover:bg-surface-700 hover:text-surface-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <RefreshCw size={12} className={gbpAccountsLoading ? 'animate-spin' : ''} />
              {gbpAccountsLoading ? 'Loading…' : 'Load'}
            </button>
          </div>
          {gbpAccountsError && <p className="text-red-400 text-xs mt-1.5">{gbpAccountsError}</p>}
          <p className="text-surface-500 text-xs mt-1.5">
            Click Load to pick from connected accounts, or paste a resource name (e.g. accounts/123456) below.
          </p>
          <input
            type="text"
            value={gbpAccountId}
            onChange={(e) => setGbpAccountId(e.target.value)}
            placeholder="accounts/123456"
            className="w-full mt-2 bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 placeholder-surface-500 font-mono"
          />
        </div>

        <div>
          <label className="block text-surface-400 text-sm mb-1.5">Location Group (optional)</label>
          <input
            type="text"
            value={gbpLocationGroup}
            onChange={(e) => setGbpLocationGroup(e.target.value)}
            placeholder="Group / label that scopes which locations belong to this client"
            className="w-full bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 placeholder-surface-500"
          />
        </div>
      </div>

      {/* ── Key Events & Competitors ─────────────────────────────────── */}
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 space-y-4">
        <h2 className="text-surface-100 font-semibold text-sm uppercase tracking-wide">Key Events & Competitors</h2>

        <div>
          <label className="block text-surface-400 text-sm mb-1.5">Key Event Names</label>
          <input
            type="text"
            value={keyEventNames}
            onChange={(e) => setKeyEventNames(e.target.value)}
            placeholder="generate_lead, phone_call, form_submit"
            className="w-full bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 placeholder-surface-500"
          />
          <p className="text-surface-500 text-xs mt-1.5">
            GA4 key-event (conversion) names that count as this client&rsquo;s north-star leads. Comma-separated.
          </p>
        </div>

        <div>
          <label className="block text-surface-400 text-sm mb-1.5">Competitors</label>
          <input
            type="text"
            value={competitors}
            onChange={(e) => setCompetitors(e.target.value)}
            placeholder="competitor-a.com, competitor-b.com"
            className="w-full bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 placeholder-surface-500"
          />
          <p className="text-surface-500 text-xs mt-1.5">
            Competitor domains tracked in the competitive module. Comma-separated.
          </p>
        </div>
      </div>

      {/* ── Monthly Goals ────────────────────────────────────────────── */}
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 space-y-4">
        <h2 className="text-surface-100 font-semibold text-sm uppercase tracking-wide">Monthly Goals</h2>
        <p className="text-surface-500 text-xs">
          Monthly targets that power the dashboard pacing module. Leave blank to skip a metric.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {TARGET_METRIC_IDS.map((metricId) => (
            <div key={metricId}>
              <label className="block text-surface-400 text-sm mb-1.5">
                {TARGET_METRIC_LABELS[metricId]}
              </label>
              <input
                type="number"
                min={0}
                step="any"
                value={targets[metricId] ?? ''}
                onChange={(e) =>
                  setTargets((prev) => ({ ...prev, [metricId]: e.target.value }))
                }
                placeholder="—"
                className="w-full bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 placeholder-surface-500 font-mono"
              />
            </div>
          ))}
        </div>
      </div>

      {saveError && <p className="text-red-400 text-sm">{saveError}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="bg-brand-500 hover:bg-brand-400 text-surface-100 text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </form>
  )
}
