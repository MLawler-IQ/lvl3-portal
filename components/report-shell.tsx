'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, MessageCircle, Send, X } from 'lucide-react'

type View = 'report' | 'dashboard'
type ChatMessage = { role: 'user' | 'assistant'; content: string }

const VIEW_META: Record<View, { slug: string; label: string; switchLabel: string }> = {
  report: {
    slug: 'market-eval',
    label: 'Scrollytelling Report',
    switchLabel: 'View Decision Dashboard',
  },
  dashboard: {
    slug: 'decision-dashboard',
    label: 'Decision Dashboard',
    switchLabel: 'View Scrollytelling Report',
  },
}

export function ReportShell({ initialView }: { initialView: View }) {
  const [view, setView] = useState<View>(initialView)
  const [reloadKey, setReloadKey] = useState(0)
  const [chatOpen, setChatOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, status])

  async function sendMessage() {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages([...nextMessages, { role: 'assistant', content: '' }])
    setStreaming(true)
    setStatus(null)
    let reportWasUpdated = false

    try {
      const res = await fetch('/api/report-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
      })

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.error ?? 'Request failed')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const appendDelta = (delta: string) =>
        setMessages((prev) => {
          const out = [...prev]
          out[out.length - 1] = {
            role: 'assistant',
            content: out[out.length - 1].content + delta,
          }
          return out
        })

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          let event: { type: string; delta?: string; text?: string; message?: string }
          try {
            event = JSON.parse(line)
          } catch {
            continue
          }
          if (event.type === 'text' && event.delta) {
            setStatus(null)
            appendDelta(event.delta)
          } else if (event.type === 'clear_partial') {
            setMessages((prev) => {
              const out = [...prev]
              out[out.length - 1] = { role: 'assistant', content: '' }
              return out
            })
          } else if (event.type === 'status' && event.text) {
            setStatus(event.text)
          } else if (event.type === 'report_updated') {
            reportWasUpdated = true
          } else if (event.type === 'error') {
            appendDelta(event.message ?? 'Something went wrong.')
          }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const out = [...prev]
        out[out.length - 1] = {
          role: 'assistant',
          content: err instanceof Error ? err.message : 'Something went wrong — try again.',
        }
        return out
      })
    } finally {
      setStreaming(false)
      setStatus(null)
      if (reportWasUpdated) setReloadKey((k) => k + 1)
    }
  }

  const meta = VIEW_META[view]

  return (
    <div className="fixed inset-0 bg-surface-950">
      <iframe
        key={`${view}-${reloadKey}`}
        src={`/api/reports/${meta.slug}`}
        title={meta.label}
        className="h-full w-full border-0"
      />

      {/* Floating controls */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2.5">
        {chatOpen && (
          <div className="flex h-[560px] max-h-[calc(100vh-120px)] w-[380px] max-w-[calc(100vw-40px)] flex-col overflow-hidden rounded-sm border border-surface-800 bg-surface-900">
            <div className="flex items-center justify-between border-b border-surface-800 px-4 py-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-brand-400">
                  IgniteIQ
                </div>
                <div className="text-sm font-medium text-surface-100">Ask about this evaluation</div>
              </div>
              <button
                onClick={() => setChatOpen(false)}
                className="rounded-md p-1.5 text-surface-400 transition-colors hover:bg-surface-850 hover:text-surface-100"
                aria-label="Close chat"
              >
                <X size={16} />
              </button>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.length === 0 && (
                <div className="space-y-2 text-[13px] leading-relaxed text-surface-400">
                  <p>
                    Ask anything about this evaluation — the verdict, the numbers, the risk
                    register, the plan.
                  </p>
                  <p>
                    Have newer figures or context we should factor in? Tell me and I&apos;ll update
                    the report content live.
                  </p>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div
                    className={
                      m.role === 'user'
                        ? 'max-w-[85%] rounded-lg bg-brand-400 px-3 py-2 text-[13px] leading-relaxed text-surface-950'
                        : 'max-w-[85%] whitespace-pre-wrap rounded-lg bg-surface-900 px-3 py-2 text-[13px] leading-relaxed text-surface-200'
                    }
                  >
                    {m.content ||
                      (streaming && i === messages.length - 1 ? (
                        <span className="text-surface-400">{status ?? 'Thinking…'}</span>
                      ) : (
                        ''
                      ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-surface-800 p-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendMessage()
                    }
                  }}
                  rows={1}
                  placeholder="Ask a question or add context…"
                  className="max-h-28 min-h-[38px] flex-1 resize-none rounded-lg border border-surface-800 bg-surface-900 px-3 py-2 text-[13px] text-surface-100 placeholder:text-surface-600 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none"
                />
                <button
                  onClick={sendMessage}
                  disabled={streaming || !input.trim()}
                  className="rounded-lg bg-brand-400 p-2.5 text-surface-950 transition-colors hover:bg-brand-300 disabled:opacity-40"
                  aria-label="Send"
                >
                  <Send size={15} />
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setView(view === 'report' ? 'dashboard' : 'report')}
            className="flex items-center gap-2 rounded-full border border-surface-800 bg-surface-900 px-4 py-2.5 text-[13px] font-medium text-surface-100 transition-colors hover:border-surface-600 hover:bg-surface-850"
          >
            <ArrowLeftRight size={14} className="text-brand-400" />
            {meta.switchLabel}
          </button>
          {!chatOpen && (
            <button
              onClick={() => setChatOpen(true)}
              className="flex items-center gap-2 rounded-full bg-brand-400 px-4 py-2.5 text-[13px] font-medium text-surface-950 transition-colors hover:bg-brand-300"
            >
              <MessageCircle size={14} />
              Ask IgniteIQ
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
