'use client'

import { useState, useRef, useCallback } from 'react'
import type { TopicInput } from '@/lib/seo-content-engine/types'
import { parseXlsx } from '@/lib/seo-content-engine/xlsx-parser'

interface XlsxUploaderProps {
  onTopicsParsed: (topics: TopicInput[]) => void
  disabled?: boolean
}

export default function XlsxUploader({ onTopicsParsed, disabled }: XlsxUploaderProps) {
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parsedCount, setParsedCount] = useState<number | null>(null)
  const [previewTitles, setPreviewTitles] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(
    async (file: File) => {
      setError(null)
      setParsedCount(null)
      setPreviewTitles([])

      if (
        !file.name.endsWith('.xlsx') &&
        !file.name.endsWith('.xls')
      ) {
        setError('Please upload an .xlsx or .xls file.')
        return
      }

      try {
        const buffer = await file.arrayBuffer()
        const topics = parseXlsx(buffer)

        if (topics.length === 0) {
          setError('No topics found in the spreadsheet. Make sure there is a "title" column.')
          return
        }

        setParsedCount(topics.length)
        setPreviewTitles(topics.slice(0, 3).map((t) => t.title))
        onTopicsParsed(topics)
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to parse spreadsheet.'
        )
      }
    },
    [onTopicsParsed]
  )

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) setDragActive(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (disabled) return

    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    // Reset so the same file can be re-selected
    e.target.value = ''
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer
          ${
            dragActive
              ? 'border-brand-500 bg-brand-500/5'
              : 'border-surface-700 hover:border-surface-600'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileChange}
          className="hidden"
          disabled={disabled}
        />

        <div className="flex flex-col items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-surface-400"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p className="text-sm text-surface-300">
            Drop an <span className="font-medium text-surface-100">.xlsx</span> file here or{' '}
            <span className="text-brand-500 font-medium">browse</span>
          </p>
          <p className="text-xs text-surface-400">
            Expects columns: title, target_audience, angle, existing_url
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-error/10 border border-error/20 rounded-lg px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      {parsedCount !== null && !error && (
        <div className="bg-brand-500/10 border border-brand-500/20 rounded-lg px-4 py-3">
          <p className="text-sm text-brand-400 font-medium">
            {parsedCount} topic{parsedCount !== 1 ? 's' : ''} parsed
          </p>
          {previewTitles.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {previewTitles.map((t, i) => (
                <li key={i} className="text-xs text-surface-400 truncate">
                  {t}
                </li>
              ))}
              {parsedCount > 3 && (
                <li className="text-xs text-surface-400">
                  +{parsedCount - 3} more...
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
