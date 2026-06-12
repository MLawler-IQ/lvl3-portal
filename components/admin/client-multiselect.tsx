'use client'

import type { ClientOption } from '@/app/actions/users'

interface Props {
  clients: ClientOption[]
  selected: string[]
  onChange: (ids: string[]) => void
}

export default function ClientMultiSelect({ clients, selected, onChange }: Props) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  }

  if (clients.length === 0) {
    return <p className="text-xs text-surface-500">No clients to grant yet.</p>
  }

  return (
    <div className="max-h-40 overflow-y-auto rounded-lg border border-surface-600 bg-surface-800 divide-y divide-surface-700/60">
      {clients.map((c) => (
        <label
          key={c.id}
          className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-surface-700/40"
        >
          <input
            type="checkbox"
            checked={selected.includes(c.id)}
            onChange={() => toggle(c.id)}
            className="accent-brand-500"
          />
          <span className="text-sm text-surface-200">{c.name}</span>
        </label>
      ))}
    </div>
  )
}
