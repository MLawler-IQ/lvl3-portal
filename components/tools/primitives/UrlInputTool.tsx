'use client'

import { useState } from 'react'
import { Globe, ArrowRight, AlertCircle } from 'lucide-react'

interface Props {
  onSubmit: (url: string) => void
  isRunning?: boolean
  placeholder?: string
  label?: string
  description?: string
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`)
    return url.hostname.includes('.')
  } catch {
    return false
  }
}

function normalizeUrl(value: string): string {
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  return `https://${value}`
}

export default function UrlInputTool({
  onSubmit,
  isRunning = false,
  placeholder = 'https://example.com/page',
  label = 'Page URL',
  description,
}: Props) {
  const [value, setValue] = useState('')
  const [touched, setTouched] = useState(false)

  const isValid = isValidUrl(value)
  const showError = touched && value.length > 0 && !isValid

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!isValid) return
    onSubmit(normalizeUrl(value))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {description && (
        <p className="text-sm text-surface-400">{description}</p>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
          <input
            type="text"
            value={value}
            onChange={e => { setValue(e.target.value); setTouched(false) }}
            onBlur={() => setTouched(true)}
            placeholder={placeholder}
            aria-label={label}
            disabled={isRunning}
            className="w-full bg-surface-800 border border-surface-700 rounded-lg pl-9 pr-3 py-2 text-sm text-surface-100 placeholder-surface-400 focus:outline-none focus:border-surface-600 disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={isRunning || (touched && !isValid)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}
        >
          {isRunning ? 'Running\u2026' : 'Run'}
          {!isRunning && <ArrowRight size={14} />}
        </button>
      </div>
      {showError && (
        <p className="flex items-center gap-1.5 text-xs text-error">
          <AlertCircle size={12} />
          Enter a valid URL
        </p>
      )}
    </form>
  )
}
