'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Loader2, Trash2, Upload } from 'lucide-react'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import { addItems, createBatch } from '@/app/actions/reviews'
import { reviewUrl } from '@/lib/review/helpers'
import CopyLinkButton from './CopyLinkButton'

const INPUT_CLASS =
  'w-full bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400 placeholder-surface-400'

type DraftRow = {
  key: string
  fileName: string
  sort_order: number
  title: string
  copy: string
  copy_url: string
  shopify_handle: string
  image_url: string
}

type SeedEntry = {
  order?: number
  handle?: string
  title?: string
  copy?: string
  image?: string
}

function stripExt(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}

function titleCaseFromFilename(fileName: string): string {
  return stripExt(fileName)
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

export default function NewBatchForm() {
  // Step 1 — batch details
  const [client, setClient] = useState('')
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [batch, setBatch] = useState<{ id: string; token: string } | null>(null)

  // Step 2 — images
  const [rows, setRows] = useState<DraftRow[]>([])
  const [uploadingFile, setUploadingFile] = useState<string | null>(null)
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [jsonOpen, setJsonOpen] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [jsonNotice, setJsonNotice] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Step 3 — save
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const shareUrl = batch ? reviewUrl(batch.token) : null

  async function handleCreate() {
    setCreating(true)
    setCreateError(null)
    const result = await createBatch({ client, title })
    if (result.error) {
      setCreateError(result.error)
    } else if (result.data) {
      setBatch(result.data)
    }
    setCreating(false)
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length || !batch) return
    setUploadErrors([])

    const supabase = createSupabaseClient()
    const startIndex = rows.length

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setUploadingFile(file.name)
      try {
        const path = `${batch.id}/${file.name}`
        const { error: uploadError } = await supabase.storage
          .from('review-images')
          .upload(path, file, { upsert: true })
        if (uploadError) throw uploadError
        const { data } = supabase.storage.from('review-images').getPublicUrl(path)

        const row: DraftRow = {
          key: `${file.name}-${Date.now()}-${i}`,
          fileName: file.name,
          sort_order: startIndex + i + 1,
          title: titleCaseFromFilename(file.name),
          copy: '',
          copy_url: '',
          shopify_handle: stripExt(file.name),
          image_url: data.publicUrl,
        }
        setRows((prev) => [...prev, row])
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed'
        setUploadErrors((prev) => [...prev, `${file.name}: ${message}`])
      }
    }
    setUploadingFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function updateRow(key: string, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key))
  }

  function handleMergeJson() {
    setJsonNotice(null)
    let entries: SeedEntry[]
    try {
      const parsed: unknown = JSON.parse(jsonText)
      if (!Array.isArray(parsed)) throw new Error('Expected a JSON array')
      entries = parsed as SeedEntry[]
    } catch (err) {
      setJsonNotice(err instanceof Error ? `Invalid JSON: ${err.message}` : 'Invalid JSON')
      return
    }

    let matched = 0
    setRows((prev) =>
      prev.map((row) => {
        const entry = entries.find((e) => e.image === row.fileName)
        if (!entry) return row
        matched++
        return {
          ...row,
          sort_order: typeof entry.order === 'number' ? entry.order : row.sort_order,
          title: entry.title ?? row.title,
          copy: entry.copy ?? row.copy,
          shopify_handle: entry.handle ?? row.shopify_handle,
        }
      })
    )
    setJsonNotice(
      `Matched ${matched} of ${entries.length} entries to uploaded images by filename.`
    )
  }

  async function handleSave() {
    if (!batch || !rows.length) return
    setSaving(true)
    setSaveError(null)
    const result = await addItems(
      batch.id,
      rows.map((r) => ({
        sort_order: r.sort_order,
        title: r.title,
        copy: r.copy || null,
        copy_url: r.copy_url || null,
        image_url: r.image_url,
        shopify_handle: r.shopify_handle || null,
      }))
    )
    if (result.error) {
      setSaveError(result.error)
    } else {
      setSaved(true)
    }
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      {/* Step 1 — batch details */}
      <section className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-4">
        <p className="text-xs font-medium uppercase tracking-widest text-surface-400">
          Step 1 · Batch details
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="review-client" className="block text-xs text-surface-400 mb-1.5">
              Client
            </label>
            <input
              id="review-client"
              type="text"
              value={client}
              onChange={(e) => setClient(e.target.value)}
              disabled={!!batch}
              placeholder="MantelMount"
              className={`${INPUT_CLASS} disabled:opacity-60`}
            />
          </div>
          <div>
            <label htmlFor="review-title" className="block text-xs text-surface-400 mb-1.5">
              Title
            </label>
            <input
              id="review-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!!batch}
              placeholder="Blog Hero Image Review — July 2026"
              className={`${INPUT_CLASS} disabled:opacity-60`}
            />
          </div>
        </div>
        {createError && <p className="text-sm text-rose-400">{createError}</p>}
        {!batch ? (
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || !client.trim() || !title.trim()}
            className="inline-flex items-center gap-2 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-400 hover:bg-brand-300 text-surface-950 transition-colors disabled:opacity-50"
          >
            {creating && <Loader2 size={14} className="animate-spin" />}
            {creating ? 'Creating…' : 'Create batch'}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-3 bg-surface-800/50 border border-surface-700 rounded-lg px-3 py-2.5">
            <span className="text-xs text-surface-400">Share link</span>
            <code className="text-xs text-brand-400 break-all">{shareUrl}</code>
            {shareUrl && <CopyLinkButton url={shareUrl} />}
          </div>
        )}
      </section>

      {/* Step 2 — upload images */}
      <section
        className={`bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-4 ${!batch ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <p className="text-xs font-medium uppercase tracking-widest text-surface-400">
          Step 2 · Upload images
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm font-medium px-3.5 py-2 rounded-lg border border-surface-600 bg-surface-800 text-surface-300 hover:text-surface-100 hover:border-surface-500 transition-colors cursor-pointer">
            <Upload size={14} />
            Choose images
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              onChange={handleFiles}
              disabled={!batch || uploadingFile !== null}
              className="hidden"
            />
          </label>
          {uploadingFile && (
            <span className="inline-flex items-center gap-2 text-xs text-surface-400">
              <Loader2 size={12} className="animate-spin" />
              Uploading {uploadingFile}…
            </span>
          )}
        </div>
        {uploadErrors.length > 0 && (
          <ul className="space-y-1">
            {uploadErrors.map((msg) => (
              <li key={msg} className="text-xs text-rose-400">
                {msg}
              </li>
            ))}
          </ul>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-700 text-left">
                  <th className="px-2 py-2 text-xs font-medium uppercase tracking-widest text-surface-400">Image</th>
                  <th className="px-2 py-2 text-xs font-medium uppercase tracking-widest text-surface-400 w-16">#</th>
                  <th className="px-2 py-2 text-xs font-medium uppercase tracking-widest text-surface-400">Title</th>
                  <th className="px-2 py-2 text-xs font-medium uppercase tracking-widest text-surface-400">Copy</th>
                  <th className="px-2 py-2 text-xs font-medium uppercase tracking-widest text-surface-400">Copy URL</th>
                  <th className="px-2 py-2 text-xs font-medium uppercase tracking-widest text-surface-400">Handle</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b border-surface-700/50 last:border-b-0">
                    <td className="px-2 py-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={row.image_url}
                        alt={row.title}
                        className="h-12 w-20 object-cover rounded border border-surface-700"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        value={row.sort_order}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          if (Number.isFinite(n)) updateRow(row.key, { sort_order: n })
                        }}
                        aria-label="Sort order"
                        className={`${INPUT_CLASS} w-16 px-2`}
                      />
                    </td>
                    <td className="px-2 py-2 min-w-[180px]">
                      <input
                        type="text"
                        value={row.title}
                        onChange={(e) => updateRow(row.key, { title: e.target.value })}
                        aria-label="Item title"
                        className={INPUT_CLASS}
                      />
                    </td>
                    <td className="px-2 py-2 min-w-[200px]">
                      <input
                        type="text"
                        value={row.copy}
                        onChange={(e) => updateRow(row.key, { copy: e.target.value })}
                        aria-label="Item copy"
                        className={INPUT_CLASS}
                      />
                    </td>
                    <td className="px-2 py-2 min-w-[160px]">
                      <input
                        type="text"
                        value={row.copy_url}
                        onChange={(e) => updateRow(row.key, { copy_url: e.target.value })}
                        aria-label="Copy URL"
                        className={INPUT_CLASS}
                      />
                    </td>
                    <td className="px-2 py-2 min-w-[160px]">
                      <input
                        type="text"
                        value={row.shopify_handle}
                        onChange={(e) => updateRow(row.key, { shopify_handle: e.target.value })}
                        aria-label="Shopify handle"
                        className={`${INPUT_CLASS} font-mono text-xs`}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => removeRow(row.key)}
                        title="Remove item"
                        aria-label={`Remove ${row.title}`}
                        className="p-1.5 rounded text-surface-400 hover:text-rose-400 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Paste JSON metadata */}
        <div className="border-t border-surface-700/50 pt-4">
          <button
            type="button"
            onClick={() => setJsonOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-surface-400 hover:text-surface-200 transition-colors"
          >
            {jsonOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Paste JSON metadata
          </button>
          {jsonOpen && (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-surface-400">
                Paste an array of {'{ order, handle, title, copy, image }'} — entries are merged
                onto uploaded rows by matching image filename.
              </p>
              <textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                rows={6}
                placeholder='[{"order": 1, "handle": "best-tv-mount-guide", "title": "…", "copy": "…", "image": "best-tv-mount-guide.png"}]'
                className={`${INPUT_CLASS} font-mono text-xs resize-y`}
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleMergeJson}
                  disabled={!jsonText.trim() || !rows.length}
                  className="inline-flex items-center text-xs font-medium px-2.5 py-1.5 rounded-lg border border-surface-600 bg-surface-800 text-surface-300 hover:text-surface-100 hover:border-surface-500 transition-colors disabled:opacity-50"
                >
                  Merge metadata
                </button>
                {jsonNotice && <p className="text-xs text-surface-400">{jsonNotice}</p>}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Step 3 — save */}
      <section
        className={`bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-4 ${!batch || !rows.length ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <p className="text-xs font-medium uppercase tracking-widest text-surface-400">
          Step 3 · Save
        </p>
        {saveError && <p className="text-sm text-rose-400">{saveError}</p>}
        {saved && batch ? (
          <div className="space-y-3">
            <p className="text-sm text-emerald-400">
              Saved {rows.length} item{rows.length === 1 ? '' : 's'}.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={`/reviews/${batch.id}`}
                className="inline-flex items-center text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-400 hover:bg-brand-300 text-surface-950 transition-colors"
              >
                View batch
              </Link>
              {shareUrl && (
                <>
                  <code className="text-xs text-brand-400 break-all">{shareUrl}</code>
                  <CopyLinkButton url={shareUrl} />
                </>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !batch || !rows.length}
            className="inline-flex items-center gap-2 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-400 hover:bg-brand-300 text-surface-950 transition-colors disabled:opacity-50"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving
              ? 'Saving…'
              : `Save ${rows.length} item${rows.length === 1 ? '' : 's'}`}
          </button>
        )}
      </section>
    </div>
  )
}
