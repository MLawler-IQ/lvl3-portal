'use client'

import { useState } from 'react'
import { Copy, Check, Download } from 'lucide-react'

interface DraftPreviewProps {
  draft: string
  wordCount?: number
  onDownload?: () => void
}

/** Minimal markdown-to-HTML renderer (no external deps) */
function renderMarkdown(text: string): string {
  const lines = text.split('\n')
  const html: string[] = []
  let inList = false

  for (const line of lines) {
    const trimmed = line.trim()

    // Close list if needed
    if (inList && !trimmed.startsWith('- ') && !trimmed.startsWith('* ')) {
      html.push('</ul>')
      inList = false
    }

    // Headings
    if (trimmed.startsWith('#### ')) {
      html.push(`<h4 class="text-base font-medium text-surface-200 mt-5 mb-2">${inlineFormat(trimmed.slice(5))}</h4>`)
      continue
    }
    if (trimmed.startsWith('### ')) {
      html.push(`<h3 class="text-lg font-medium text-surface-200 mt-6 mb-2">${inlineFormat(trimmed.slice(4))}</h3>`)
      continue
    }
    if (trimmed.startsWith('## ')) {
      html.push(`<h2 class="text-xl font-medium text-surface-100 mt-8 mb-3">${inlineFormat(trimmed.slice(3))}</h2>`)
      continue
    }
    if (trimmed.startsWith('# ')) {
      html.push(`<h1 class="text-2xl font-medium text-surface-100 mt-8 mb-4">${inlineFormat(trimmed.slice(2))}</h1>`)
      continue
    }

    // Bullets
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) {
        html.push('<ul class="list-disc list-inside space-y-1 my-2 text-surface-300">')
        inList = true
      }
      html.push(`<li>${inlineFormat(trimmed.slice(2))}</li>`)
      continue
    }

    // Empty lines
    if (trimmed === '') {
      html.push('<div class="h-3"></div>')
      continue
    }

    // Paragraph
    html.push(`<p class="text-surface-300 leading-relaxed">${inlineFormat(trimmed)}</p>`)
  }

  if (inList) html.push('</ul>')
  return html.join('\n')
}

/** Handle inline bold and italic */
function inlineFormat(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-surface-200">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
}

export default function DraftPreview({ draft, wordCount, onDownload }: DraftPreviewProps) {
  const [copied, setCopied] = useState(false)

  const computedWordCount = wordCount ?? draft.split(/\s+/).filter(Boolean).length

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(draft)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
      const ta = document.createElement('textarea')
      ta.value = draft
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-brand-500/15 text-brand-400">
          {computedWordCount.toLocaleString()} words
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-800 border border-surface-700 text-surface-300 hover:bg-surface-700 hover:text-surface-100 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          {onDownload && (
            <button
              type="button"
              onClick={onDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-800 border border-surface-700 text-surface-300 hover:bg-surface-700 hover:text-surface-100 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              DOCX
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div
        className="bg-surface-900 border border-surface-700 rounded-xl p-6 prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }}
      />
    </div>
  )
}
