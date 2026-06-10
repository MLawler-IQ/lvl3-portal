'use client'

import { useRef, useState } from 'react'
import { Upload, Download, CheckCircle2, Loader2, Circle, AlertCircle, X } from 'lucide-react'
import JSZip from 'jszip'
import { parsePromptRows, type ParsedPromptRow } from '@/lib/parse-csv'

type Row = ParsedPromptRow

type ImageStatus = 'pending' | 'generating' | 'done' | 'error'

interface ImageState {
  filename: string
  status: ImageStatus
  error?: string
  data?: string // base64 WebP
}

const DEFAULT_STYLE_RULES = `Style rules: photorealistic lifestyle interior, warm neutral palette, natural light, minimal clutter, clean lines, TV screen dark/blank, no text overlays, no logos.

Avoid: text, logo, watermark, brand name, blurry, low-res, extra fingers, warped geometry, fake UI, illegible text, distorted TV, crooked mantel, cluttered room, oversaturated`

export default function BlogImageGeneratorClient() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileText, setFileText] = useState<string>('')
  const [fileName, setFileName] = useState<string>('')
  const [previewRows, setPreviewRows] = useState<Row[]>([])
  const [styleRules, setStyleRules] = useState(DEFAULT_STYLE_RULES)
  const [images, setImages] = useState<ImageState[]>([])
  const [generating, setGenerating] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completedCount, setCompletedCount] = useState(0)

  const imageDataRef = useRef<Map<string, string>>(new Map())
  const abortRef = useRef<AbortController | null>(null)
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const STALL_TIMEOUT_MS = 120_000

  function handleFile(file: File) {
    setFileName(file.name)
    setDone(false)
    setImages([])
    setError(null)
    setCompletedCount(0)
    imageDataRef.current = new Map()

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = (e.target?.result as string) ?? ''
      setFileText(text)
      setPreviewRows(parsePromptRows(text))
    }
    reader.readAsText(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  function clearFile() {
    setFileName('')
    setFileText('')
    setPreviewRows([])
    setDone(false)
    setImages([])
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function resetStallTimer() {
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current)
    stallTimerRef.current = setTimeout(() => {
      abortRef.current?.abort()
      setError('Generation stalled — no response from server for 2 minutes')
      setGenerating(false)
    }, STALL_TIMEOUT_MS)
  }

  function handleCancel() {
    abortRef.current?.abort()
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current)
    setGenerating(false)
  }

  async function handleGenerate() {
    if (!fileText || previewRows.length === 0 || generating) return

    const initialStates: ImageState[] = previewRows.map((r) => ({
      filename: `${r.filename}.webp`,
      status: 'pending',
    }))
    setImages(initialStates)
    setGenerating(true)
    setDone(false)
    setError(null)
    setCompletedCount(0)
    imageDataRef.current = new Map()

    const abortController = new AbortController()
    abortRef.current = abortController

    const formData = new FormData()
    const blob = new Blob([fileText], { type: 'text/plain' })
    formData.append('file', blob, fileName || 'prompts.csv')
    formData.append('styleRules', styleRules)

    try {
      const res = await fetch('/api/generate-blog-images', {
        method: 'POST',
        body: formData,
        signal: abortController.signal,
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Request failed' }))
        setError(errData.error ?? 'Request failed')
        setGenerating(false)
        return
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      resetStallTimer()

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break

        resetStallTimer()

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line) as {
              type: 'progress' | 'image' | 'image_error' | 'done' | 'error' | 'heartbeat'
              index?: number
              total?: number
              filename?: string
              data?: string
              message?: string
            }

            if (event.type === 'heartbeat') continue

            if (event.type === 'progress' && event.filename) {
              setImages((prev) =>
                prev.map((img) =>
                  img.filename === event.filename
                    ? { ...img, status: 'generating' }
                    : img
                )
              )
            } else if (event.type === 'image' && event.filename && event.data) {
              imageDataRef.current.set(event.filename, event.data)
              setImages((prev) =>
                prev.map((img) =>
                  img.filename === event.filename
                    ? { ...img, status: 'done', data: event.data }
                    : img
                )
              )
              setCompletedCount((c) => c + 1)
            } else if (event.type === 'image_error' && event.filename) {
              setImages((prev) =>
                prev.map((img) =>
                  img.filename === event.filename
                    ? { ...img, status: 'error', error: event.message }
                    : img
                )
              )
              setCompletedCount((c) => c + 1)
            } else if (event.type === 'done') {
              setDone(true)
            } else if (event.type === 'error') {
              setError(event.message ?? 'Unknown error')
            }
          } catch {
            // skip malformed line
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // user cancelled or stall timeout — error already set if stall
      } else {
        setError(err instanceof Error ? err.message : 'Failed to connect')
      }
    } finally {
      if (stallTimerRef.current) clearTimeout(stallTimerRef.current)
      abortRef.current = null
      setGenerating(false)
    }
  }

  async function handleDownload() {
    const zip = new JSZip()
    for (const [filename, b64] of Array.from(imageDataRef.current.entries())) {
      const binary = atob(b64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      zip.file(filename, bytes, { binary: true })
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'blog-images.zip'
    a.click()
    URL.revokeObjectURL(url)
  }

  const total = previewRows.length
  const progress = total > 0 ? Math.round((completedCount / total) * 100) : 0
  const successCount = images.filter((i) => i.status === 'done').length

  return (
    <div className="space-y-5">
      {/* File upload */}
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-4">
        <p className="text-sm font-semibold text-surface-100 uppercase tracking-wide">1. Upload prompts file</p>

        {!fileName ? (
          <div
            className="border-2 border-dashed border-surface-600 rounded-lg p-8 text-center cursor-pointer hover:border-surface-500 transition-colors"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-8 h-8 mx-auto mb-3 text-surface-500" />
            <p className="text-sm text-surface-300">Drop a CSV or TSV file here, or click to browse</p>
            <p className="text-xs text-surface-500 mt-1">
              Needs two columns: <span className="text-surface-400">post title</span> and <span className="text-surface-400">prompt</span>
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt"
              className="hidden"
              onChange={handleInputChange}
            />
          </div>
        ) : (
          <div className="flex items-center justify-between bg-surface-800 border border-surface-600 rounded-lg px-4 py-3">
            <div>
              <p className="text-sm text-surface-100">{fileName}</p>
              <p className="text-xs text-surface-400 mt-0.5">{previewRows.length} row{previewRows.length !== 1 ? 's' : ''} detected</p>
            </div>
            <button
              onClick={clearFile}
              className="text-surface-500 hover:text-surface-300 transition-colors"
              aria-label="Remove file"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {previewRows.length > 0 && (
          <div className="overflow-auto max-h-52 rounded-lg border border-surface-700">
            <table className="w-full text-xs">
              <thead className="bg-surface-800 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 text-surface-400 font-medium w-1/3">Filename</th>
                  <th className="text-left px-3 py-2 text-surface-400 font-medium">Prompt</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i} className="border-t border-surface-700">
                    <td className="px-3 py-2 text-surface-300 font-mono">{row.filename}.webp</td>
                    <td className="px-3 py-2 text-surface-400 leading-relaxed">{row.prompt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Style rules */}
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-3">
        <p className="text-sm font-semibold text-surface-100 uppercase tracking-wide">2. Style rules</p>
        <p className="text-xs text-surface-400">Appended to every prompt. Edit or clear as needed.</p>
        <textarea
          value={styleRules}
          onChange={(e) => setStyleRules(e.target.value)}
          rows={5}
          className="w-full bg-surface-800 border border-surface-600 text-surface-100 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:border-surface-500"
          placeholder="Enter style rules to append to every prompt..."
        />
      </div>

      {/* Generate button */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleGenerate}
          disabled={generating || previewRows.length === 0}
          className="flex items-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-400 disabled:opacity-50 disabled:cursor-not-allowed text-surface-100 text-sm font-medium rounded-lg transition-colors"
        >
          {generating && <Loader2 className="w-4 h-4 animate-spin" />}
          {generating ? 'Generating…' : 'Generate Images'}
        </button>

        {generating && (
          <button
            onClick={handleCancel}
            className="flex items-center gap-2 px-5 py-2.5 bg-surface-800 hover:bg-surface-700 text-surface-300 text-sm font-medium rounded-lg transition-colors border border-surface-600"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
        )}

        {done && successCount > 0 && (
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
            style={{ backgroundColor: 'var(--color-accent)', color: '#020617' }}
          >
            <Download className="w-4 h-4" />
            Download ZIP ({successCount} image{successCount !== 1 ? 's' : ''})
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-surface-900 border border-red-800 rounded-xl px-4 py-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Progress */}
      {images.length > 0 && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-surface-400">
              <span>{generating ? 'Generating…' : done ? 'Complete' : 'Stopped'}</span>
              <span>{completedCount} / {total}</span>
            </div>
            <div className="w-full h-1.5 bg-surface-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${progress}%`, backgroundColor: 'var(--color-accent)' }}
              />
            </div>
          </div>

          <ul className="space-y-1.5">
            {images.map((img) => (
              <li key={img.filename} className="flex items-start gap-2.5 text-sm">
                {img.status === 'done' && (
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-success" />
                )}
                {img.status === 'generating' && (
                  <Loader2 className="w-4 h-4 mt-0.5 shrink-0 animate-spin text-surface-400" />
                )}
                {img.status === 'pending' && (
                  <Circle className="w-4 h-4 mt-0.5 shrink-0 text-surface-600" />
                )}
                {img.status === 'error' && (
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
                )}
                <span
                  className={
                    img.status === 'done'
                      ? 'text-surface-200'
                      : img.status === 'generating'
                      ? 'text-surface-300'
                      : img.status === 'error'
                      ? 'text-red-400'
                      : 'text-surface-500'
                  }
                >
                  {img.filename}
                  {img.status === 'error' && img.error && (
                    <span className="ml-2 text-xs text-red-400">— {img.error}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
