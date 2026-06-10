'use client'

import { useState, useRef } from 'react'
import { X, Upload } from 'lucide-react'
import { createDeliverable } from '@/app/actions/deliverables'
import { useToast } from '@/components/ui/ToastProvider'

type FileType = 'pdf' | 'slides' | 'sheets' | 'link'

const FILE_TYPES: { value: FileType; label: string; requiresFile: boolean; placeholder?: string }[] = [
  { value: 'pdf', label: 'PDF Upload', requiresFile: true },
  { value: 'slides', label: 'Google Slides URL', requiresFile: false, placeholder: 'https://docs.google.com/presentation/d/...' },
  { value: 'sheets', label: 'Google Sheets URL', requiresFile: false, placeholder: 'https://docs.google.com/spreadsheets/d/...' },
  { value: 'link', label: 'External Link', requiresFile: false, placeholder: 'https://' },
]

interface Props {
  clients: { id: string; name: string }[]
  onClose: () => void
}

export default function AddDeliverableModal({ clients, onClose }: Props) {
  const { toast } = useToast()
  const [clientId, setClientId] = useState(clients[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [fileType, setFileType] = useState<FileType>('pdf')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const currentConfig = FILE_TYPES.find(ft => ft.value === fileType)!

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!clientId) { setError('Please select a client.'); return }
    if (!title.trim()) { setError('Title is required.'); return }
    if (currentConfig.requiresFile && !file) { setError('Please select a PDF file.'); return }
    if (!currentConfig.requiresFile && !url.trim()) { setError('Please enter a URL.'); return }

    setLoading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('clientId', clientId)
      formData.append('title', title.trim())
      formData.append('fileType', fileType)
      if (currentConfig.requiresFile && file) {
        formData.append('file', file)
      } else {
        formData.append('url', url.trim())
      }
      await createDeliverable(formData)
      toast(`Deliverable "${title.trim()}" added.`, 'success')
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong.'
      setError(message)
      toast('Failed to add deliverable.', 'error')
      setLoading(false)
    }
  }

  function handleFileTypeChange(value: FileType) {
    setFileType(value)
    setFile(null)
    setUrl('')
    setError(null)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-700">
          <h2 className="text-surface-100 font-semibold">Add Deliverable</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-surface-400 hover:text-surface-100 hover:bg-surface-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Client */}
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">Client</label>
            <select
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-sm text-surface-100 focus:outline-none focus:ring-1 focus:ring-surface-500"
            >
              {clients.length === 0 && <option value="">No clients found</option>}
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Q1 Performance Report"
              className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-sm text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-1 focus:ring-surface-500"
            />
          </div>

          {/* File type selector */}
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {FILE_TYPES.map(ft => (
                <button
                  key={ft.value}
                  type="button"
                  onClick={() => handleFileTypeChange(ft.value)}
                  className={`px-3 py-2 rounded-lg text-sm text-left transition-colors border ${
                    fileType === ft.value
                      ? 'bg-brand-400/10 text-brand-400 border-brand-400/30 font-medium'
                      : 'bg-surface-800 text-surface-300 border-surface-600 hover:border-surface-500'
                  }`}
                >
                  {ft.label}
                </button>
              ))}
            </div>
          </div>

          {/* File or URL input */}
          {currentConfig.requiresFile ? (
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">PDF File</label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-surface-600 rounded-lg p-6 text-center cursor-pointer hover:border-surface-500 transition-colors"
              >
                {file ? (
                  <p className="text-sm text-surface-100 font-medium">{file.name}</p>
                ) : (
                  <div className="space-y-1.5">
                    <Upload size={20} className="mx-auto text-surface-500" />
                    <p className="text-sm text-surface-400">Click to select a PDF</p>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">URL</label>
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder={currentConfig.placeholder ?? 'https://'}
                className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-sm text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-1 focus:ring-surface-500"
              />
            </div>
          )}

          {error && <p className="text-rose-400 text-sm">{error}</p>}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-surface-600 text-surface-300 text-sm hover:bg-surface-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || clients.length === 0}
              className="flex-1 px-4 py-2 rounded-lg bg-brand-400 hover:bg-brand-500 text-surface-950 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Uploading…' : 'Add Deliverable'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
