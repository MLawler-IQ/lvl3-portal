'use client'

// The interview surface. Stream reader forked from AskLvl3Chat.tsx:109-245 —
// same getReader + line-buffer loop, same optimistic user message with rollback.
// The addition is the `completeness` event, which drives the checklist so the
// strategist can see coverage instead of guessing at it.

import { useEffect, useRef, useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import MarkdownLite from '@/components/ui/MarkdownLite'
import type { Completeness } from '@/lib/onboarding/completeness'
import type { Answers } from '@/lib/onboarding/schema'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  sessionId: string
  clientName: string
  initialMessages: ChatTurn[]
  /** Fired whenever the interview records something, with the fresh draft. */
  onRecorded: (c: Completeness, answers?: Answers) => void
}

const OPENERS = [
  'Start the interview',
  'Pick up where we left off',
]

export default function OnboardingChat({
  sessionId,
  clientName,
  initialMessages,
  onRecorded,
}: Props) {
  const [messages, setMessages] = useState<ChatTurn[]>(initialMessages)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, statusText])

  async function handleSend(text?: string) {
    const content = (text ?? input).trim()
    if (!content || loading) return

    const newMessages: ChatTurn[] = [...messages, { role: 'user', content }]
    setMessages(newMessages)
    setInput('')
    setLoading(true)
    setError(null)
    setStatusText(null)

    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, messages: newMessages }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Request failed' }))
        setError(errData.error ?? 'Request failed')
        setMessages(messages)
        setLoading(false)
        return
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line) as {
              type: string
              text?: string
              delta?: string
              message?: string
              completeness?: Completeness
              answers?: Answers
            }

            if (event.type === 'status') {
              setStatusText(event.text ?? null)
            } else if (event.type === 'clear_partial') {
              // The model called the tool — drop the thinking text it streamed first.
              setMessages((prev) => {
                const last = prev[prev.length - 1]
                if (last?.role === 'assistant') return prev.slice(0, -1)
                return prev
              })
            } else if (event.type === 'text') {
              const delta = event.delta ?? ''
              setMessages((prev) => {
                const last = prev[prev.length - 1]
                if (last?.role === 'assistant') {
                  return [...prev.slice(0, -1), { role: 'assistant', content: last.content + delta }]
                }
                return [...prev, { role: 'assistant', content: delta }]
              })
            } else if (event.type === 'completeness' && event.completeness) {
              onRecorded(event.completeness, event.answers)
              setStatusText(null)
            } else if (event.type === 'done') {
              if (event.completeness) onRecorded(event.completeness, event.answers)
              setStatusText(null)
            } else if (event.type === 'error') {
              setError(event.message ?? 'Unknown error')
            }
          } catch {
            // malformed JSON line — skip
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get response')
      setMessages(messages)
    } finally {
      setLoading(false)
      setStatusText(null)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
        {messages.length === 0 && (
          <div className="text-center py-10">
            <p className="text-sm text-surface-400 mb-1">
              Onboarding interview for{' '}
              <span className="text-surface-100 font-medium">{clientName}</span>
            </p>
            <p className="text-xs text-surface-400 mb-5 max-w-md mx-auto leading-relaxed">
              Relay what the client says. Answers are recorded as you go and stay a draft
              until you approve them.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {OPENERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleSend(s)}
                  className="text-xs px-3 py-1.5 rounded-sm border border-surface-800 text-surface-300 transition-colors hover:bg-surface-850 hover:text-surface-100 hover:border-surface-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={
                m.role === 'user'
                  ? 'max-w-[85%] rounded-sm border border-surface-800 bg-surface-850 px-3.5 py-2.5 text-sm text-surface-100 whitespace-pre-wrap'
                  : 'max-w-[90%] rounded-sm border border-surface-800 bg-surface-900 px-3.5 py-2.5 text-sm text-surface-200'
              }
            >
              {m.role === 'assistant' ? <MarkdownLite text={m.content} /> : m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-sm border border-surface-800 bg-surface-900 px-3.5 py-2.5">
              {statusText ? (
                <span className="text-xs text-brand-400 animate-pulse">{statusText}</span>
              ) : (
                <Loader2 size={14} className="animate-spin text-surface-400" />
              )}
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-sm px-3 py-2 text-sm"
            style={{
              color: 'var(--color-error)',
              backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: 'color-mix(in srgb, var(--color-error) 25%, transparent)',
            }}
          >
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-surface-800 p-3 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            rows={2}
            placeholder="What did the client say?"
            aria-label="Your message"
            disabled={loading}
            className="flex-1 resize-none rounded-sm border border-surface-800 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-400 transition-colors hover:border-surface-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => handleSend()}
            disabled={loading || !input.trim()}
            aria-label="Send"
            className="rounded-sm bg-brand-400 p-2.5 text-surface-950 transition-colors hover:bg-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
