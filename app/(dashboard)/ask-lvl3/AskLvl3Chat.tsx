'use client'

import { useState, useRef, useEffect } from 'react'
import { MessageCircle, Send, Loader2, Trash2, FileSpreadsheet, Download } from 'lucide-react'
import { type ChatMessage, type ChatArtifact } from '@/app/actions/ask-lvl3'
import MarkdownLite from '@/components/ui/MarkdownLite'
import {
  loadConversation,
  deleteConversation,
  type ConversationSummary,
} from '@/app/actions/ask-lvl3-conversations'

const STARTERS = [
  'What are our biggest SEO wins this month?',
  'Which keywords should we prioritize next?',
  'What content should we create based on the gaps?',
  'How is our branded search trending?',
]

interface Props {
  clientId: string | null
  clientName: string | null
  conversations: ConversationSummary[]
  initialMessages: ChatMessage[]
  initialConversationId: string | null
}

export default function AskLvl3Chat({
  clientId,
  clientName,
  conversations,
  initialMessages,
  initialConversationId,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId)
  const [threadList, setThreadList] = useState<ConversationSummary[]>(conversations)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const isFirstRender = useRef(true)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // When clientId changes after initial mount, reset and load new client's most recent thread
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    setMessages([])
    setConversationId(null)
    setThreadList(conversations)
    setStatusText(null)
    setError(null)

    if (clientId && conversations.length > 0) {
      loadConversation(conversations[0].id)
        .then((msgs) => {
          setMessages(msgs)
          setConversationId(conversations[0].id)
        })
        .catch(() => {})
    }
  }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleLoadThread(id: string) {
    if (loading) return
    setLoading(true)
    try {
      const msgs = await loadConversation(id)
      setMessages(msgs)
      setConversationId(id)
      setStatusText(null)
      setError(null)
    } catch {
      setError('Failed to load conversation')
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteThread(id: string) {
    try {
      await deleteConversation(id)
      setThreadList((prev) => prev.filter((t) => t.id !== id))
      if (conversationId === id) {
        setMessages([])
        setConversationId(null)
        setError(null)
      }
    } catch {
      setError('Failed to delete conversation')
    }
  }

  function handleNewChat() {
    setMessages([])
    setConversationId(null)
    setStatusText(null)
    setError(null)
  }

  async function handleSend(text?: string) {
    const content = (text ?? input).trim()
    if (!content || !clientId || loading) return

    const newMessages: ChatMessage[] = [...messages, { role: 'user', content }]
    setMessages(newMessages)
    setInput('')
    setLoading(true)
    setError(null)
    setStatusText(null)

    try {
      const res = await fetch('/api/ask-lvl3', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          messages: newMessages,
          conversationId: conversationId ?? undefined,
        }),
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
              type: 'status' | 'clear_partial' | 'text' | 'artifact' | 'done' | 'error' | string
              text?: string
              delta?: string
              conversationId?: string
              message?: string
              path?: string
              filename?: string
              mimeType?: string
              url?: string
            }

            if (event.type === 'status') {
              setStatusText(event.text ?? null)
            } else if (event.type === 'clear_partial') {
              // Model called a tool — remove the partial thinking text it streamed before the tool call
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
                  return [
                    ...prev.slice(0, -1),
                    { role: 'assistant', content: last.content + delta },
                  ]
                }
                return [...prev, { role: 'assistant', content: delta }]
              })
            } else if (event.type === 'artifact' && event.url && event.filename) {
              const artifact: ChatArtifact = {
                path: event.path ?? '',
                filename: event.filename,
                mimeType: event.mimeType ?? '',
                url: event.url,
              }
              setMessages((prev) => {
                const last = prev[prev.length - 1]
                if (last?.role === 'assistant') {
                  return [
                    ...prev.slice(0, -1),
                    { ...last, artifacts: [...(last.artifacts ?? []), artifact] },
                  ]
                }
                return [...prev, { role: 'assistant', content: '', artifacts: [artifact] }]
              })
            } else if (event.type === 'done') {
              const newConvId = event.conversationId ?? ''
              if (newConvId) {
                setConversationId(newConvId)
                setThreadList((prev) => {
                  if (prev.find((t) => t.id === newConvId)) {
                    return prev.map((t) =>
                      t.id === newConvId
                        ? { ...t, updated_at: new Date().toISOString() }
                        : t
                    )
                  }
                  const title = content.slice(0, 80)
                  return [
                    {
                      id: newConvId,
                      title,
                      created_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                    },
                    ...prev,
                  ]
                })
              }
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const empty = messages.length === 0

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-surface-700 flex items-center gap-3 shrink-0">
        <MessageCircle className="w-5 h-5 text-surface-400" />
        <div>
          <h1 className="text-lg font-semibold text-surface-100">Ask LVL3</h1>
          <p className="text-xs text-surface-500">
            {clientName
              ? `Advising on ${clientName}`
              : 'Select a client from the top bar to start'}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {threadList.length > 0 && (
            <select
              value={conversationId ?? ''}
              onChange={(e) => {
                const id = e.target.value
                if (id) {
                  handleLoadThread(id)
                } else {
                  handleNewChat()
                }
              }}
              className="text-xs bg-surface-900 border border-surface-700 text-surface-300 rounded-lg px-2 py-1 max-w-[180px] truncate"
            >
              <option value="">New chat</option>
              {threadList.map((t) => (
                <option key={t.id} value={t.id}>
                  {(t.title ?? 'Chat').slice(0, 40)}
                </option>
              ))}
            </select>
          )}

          {conversationId && (
            <button
              onClick={() => handleDeleteThread(conversationId)}
              title="Delete this conversation"
              className="text-surface-500 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          {(messages.length > 0 || conversationId) && (
            <button
              onClick={handleNewChat}
              className="text-xs text-surface-500 hover:text-surface-300 transition-colors"
            >
              New chat
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
        {empty && clientId && (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
            <div>
              <p className="text-surface-100 font-medium mb-1">
                What do you want to know about {clientName ?? 'this client'}?
              </p>
              <p className="text-xs text-surface-500">
                I have access to their analytics summary and live GSC data.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="text-left text-xs text-surface-300 bg-surface-900 border border-surface-700 rounded-xl px-4 py-3 hover:border-surface-500 hover:text-surface-100 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {empty && !clientId && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-surface-500">
              Select a client from the top bar to start chatting.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-2xl rounded-xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-brand-400/15 text-surface-100 border border-brand-400/20'
                  : 'bg-surface-900 text-surface-200 border border-surface-700'
              }`}
            >
              {msg.role === 'assistant' ? (
                <MarkdownLite text={msg.content} />
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
              {msg.artifacts?.map((a, j) => (
                <button
                  key={j}
                  onClick={async () => {
                    try {
                      const res = await fetch(a.url!)
                      const blob = await res.blob()
                      const blobUrl = URL.createObjectURL(blob)
                      const link = document.createElement('a')
                      link.href = blobUrl
                      link.download = a.filename
                      link.click()
                      URL.revokeObjectURL(blobUrl)
                    } catch {
                      // Fallback: open in new tab
                      window.open(a.url, '_blank')
                    }
                  }}
                  className="mt-3 w-full flex items-center gap-3 rounded-lg border border-surface-700 bg-surface-800 px-4 py-3 hover:border-brand-400/40 hover:bg-surface-800/80 transition-colors group text-left"
                >
                  <FileSpreadsheet className="w-5 h-5 text-brand-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-surface-100 truncate">{a.filename}</p>
                    <p className="text-xs text-surface-500">.xlsx spreadsheet</p>
                  </div>
                  <Download className="w-4 h-4 text-surface-500 group-hover:text-brand-400 transition-colors" />
                </button>
              ))}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-surface-900 border border-surface-700 rounded-xl px-4 py-3">
              {statusText ? (
                <span className="text-xs text-surface-400 animate-pulse">{statusText}</span>
              ) : (
                <Loader2 className="w-4 h-4 text-surface-400 animate-spin" />
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-center">
            <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-surface-700 shrink-0">
        <div className="flex items-end gap-3 max-w-3xl mx-auto">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={clientId ? 'Ask anything about this client...' : 'Select a client first'}
            disabled={!clientId || loading}
            rows={1}
            className="flex-1 bg-surface-900 border border-surface-600 text-surface-100 text-sm rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-brand-400 placeholder-surface-500 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ minHeight: '44px', maxHeight: '160px' }}
            onInput={(e) => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 160) + 'px'
            }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || !clientId || loading}
            className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            <Send className="w-4 h-4 text-surface-950" />
          </button>
        </div>
        <p className="text-center text-xs text-surface-600 mt-2">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
