'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, Users, PackageOpen, Eye } from 'lucide-react'
import type { ClientWithStats } from '@/app/actions/clients'
import NewClientModal from './new-client-modal'

interface ClientsGridProps {
  clients: ClientWithStats[]
}

export default function ClientsGrid({ clients }: ClientsGridProps) {
  const [newOpen, setNewOpen] = useState(false)

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-surface-100 text-2xl font-bold">Clients</h1>
        <button
          onClick={() => setNewOpen(true)}
          className="flex items-center gap-1.5 bg-brand-400 text-surface-950 text-sm font-semibold rounded-lg px-4 py-2 hover:bg-brand-500 transition-colors"
        >
          <Plus size={15} />
          New client
        </button>
      </div>

      {clients.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-surface-400 text-sm mb-4">No clients yet.</p>
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-1.5 bg-brand-400 text-surface-950 text-sm font-semibold rounded-lg px-4 py-2 hover:bg-brand-500 transition-colors"
          >
            <Plus size={15} />
            Add your first client
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map((client) => (
            <Link
              key={client.id}
              href={`/clients/${client.id}`}
              className="block bg-surface-900 border border-surface-700 rounded-xl p-5 hover:border-surface-500 transition-colors group"
            >
              <div className="flex items-start gap-3 mb-4">
                {client.logo_url ? (
                  <img
                    src={client.logo_url}
                    alt={`${client.name} logo`}
                    className="w-10 h-10 rounded-lg object-contain bg-surface-800 flex-shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-surface-800 flex items-center justify-center flex-shrink-0">
                    <span className="text-surface-400 text-sm font-bold">
                      {client.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="text-surface-100 font-semibold truncate group-hover:text-surface-100">
                    {client.name}
                  </h3>
                  <p className="text-surface-500 text-xs font-mono">{client.slug}</p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5 text-surface-500 text-xs">
                  <Users size={12} />
                  <span>{client.user_count}</span>
                </div>
                <div className="flex items-center gap-1.5 text-surface-500 text-xs">
                  <PackageOpen size={12} />
                  <span>{client.deliverable_count}</span>
                </div>
                {client.unread_count > 0 && (
                  <div className="flex items-center gap-1.5 text-amber-400 text-xs">
                    <Eye size={12} />
                    <span>{client.unread_count} unread</span>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {newOpen && <NewClientModal onClose={() => setNewOpen(false)} />}
    </>
  )
}
