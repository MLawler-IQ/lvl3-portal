'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, CalendarDays } from 'lucide-react'
import { createAnnotation, deleteAnnotation, type Annotation } from '@/app/actions/annotations'

export interface AnnotationsProps {
  annotations: Annotation[]
  isAdmin: boolean
  clientId: string
}

/** Render a YYYY-MM-DD date in UTC to avoid timezone drift. */
function fmtDate(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export default function Annotations({ annotations, isAdmin, clientId }: AnnotationsProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [adding, setAdding] = useState(false)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    if (!title.trim()) {
      setError('Title is required')
      return
    }
    startTransition(async () => {
      const res = await createAnnotation({ clientId, annotationDate: date, title, body })
      if (res.error) {
        setError(res.error)
        return
      }
      setTitle('')
      setBody('')
      setAdding(false)
      router.refresh()
    })
  }

  function remove(id: string) {
    startTransition(async () => {
      await deleteAnnotation(id)
      router.refresh()
    })
  }

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-surface-100">What we changed</p>
        {isAdmin && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add note
          </button>
        )}
      </div>

      {isAdmin && adding && (
        <div className="mb-4 space-y-2 rounded-lg border border-surface-700 bg-surface-950/40 p-3">
          <div className="flex gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-surface-800 border border-surface-600 text-surface-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-surface-500"
            />
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What changed? (e.g. Launched new landing pages)"
              className="flex-1 bg-surface-800 border border-surface-600 text-surface-200 text-sm rounded px-2 py-1.5 placeholder:text-surface-500 focus:outline-none focus:border-surface-500"
            />
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Optional detail / expected impact"
            rows={2}
            className="w-full bg-surface-800 border border-surface-600 text-surface-200 text-sm rounded px-2 py-1.5 placeholder:text-surface-500 focus:outline-none focus:border-surface-500"
          />
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={submit}
              disabled={pending}
              className="text-xs bg-brand-500 hover:bg-brand-600 text-white rounded px-3 py-1.5 disabled:opacity-50 transition-colors"
            >
              {pending ? 'Saving…' : 'Save note'}
            </button>
            <button
              onClick={() => {
                setAdding(false)
                setError(null)
              }}
              disabled={pending}
              className="text-xs text-surface-400 hover:text-surface-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {annotations.length === 0 ? (
        <p className="text-sm text-surface-500 italic">
          {isAdmin ? 'No notes yet — add what changed this period.' : 'Recent agency activity notes will appear here.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {annotations.map((a) => (
            <li key={a.id} className="relative pl-4 border-l border-surface-700">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm text-surface-200 font-medium">{a.title}</p>
                  {a.body && <p className="text-sm text-surface-400 mt-0.5">{a.body}</p>}
                  <p className="mt-1 flex items-center gap-1 text-xs text-surface-500">
                    <CalendarDays className="w-3 h-3" />
                    {fmtDate(a.annotation_date)}
                  </p>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => remove(a.id)}
                    disabled={pending}
                    className="text-surface-600 hover:text-rose-400 transition-colors shrink-0"
                    aria-label="Delete note"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
