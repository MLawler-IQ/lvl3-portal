'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Link as LinkIcon } from 'lucide-react'

export default function CopyLinkButton({
  url,
  label = 'Copy link',
  className = '',
}: {
  url: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable (permissions / non-secure context) — no-op.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={url}
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-surface-600 bg-surface-800 text-surface-300 hover:text-surface-100 hover:border-surface-500 transition-colors ${className}`}
    >
      {copied ? (
        <>
          <Check size={12} className="text-emerald-400" />
          <span className="text-emerald-400">Copied</span>
        </>
      ) : (
        <>
          <LinkIcon size={12} />
          {label}
        </>
      )}
    </button>
  )
}
