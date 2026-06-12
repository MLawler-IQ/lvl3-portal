'use client'

import { AlertTriangle } from 'lucide-react'
import type { ClientOption, UserRole } from '@/app/actions/users'
import ClientMultiSelect from './client-multiselect'

const ROLES: { value: UserRole; label: string; hint: string }[] = [
  {
    value: 'client',
    label: 'Client',
    hint: 'External client — read-only access to a single assigned workspace.',
  },
  {
    value: 'member',
    label: 'Member',
    hint: 'Internal LVL3 team — can be granted access to multiple client workspaces.',
  },
  {
    value: 'admin',
    label: 'Admin',
    hint: 'Full access to everything, including this admin area and all clients.',
  },
]

interface Props {
  clients: ClientOption[]
  role: UserRole
  onRole: (r: UserRole) => void
  clientId: string
  onClientId: (id: string) => void
  memberIds: string[]
  onMemberIds: (ids: string[]) => void
  adminConfirmed: boolean
  onAdminConfirmed: (v: boolean) => void
  /** Show the admin-access confirmation checkbox (new admins / promotions). */
  requireAdminConfirm: boolean
}

export default function RoleAssignment({
  clients,
  role,
  onRole,
  clientId,
  onClientId,
  memberIds,
  onMemberIds,
  adminConfirmed,
  onAdminConfirmed,
  requireAdminConfirm,
}: Props) {
  const hint = ROLES.find((r) => r.value === role)?.hint
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-surface-300 mb-2">Role</label>
        <div className="flex rounded-lg overflow-hidden border border-surface-600">
          {ROLES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => onRole(r.value)}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                role === r.value
                  ? 'bg-brand-400/10 text-brand-400'
                  : 'bg-surface-800 text-surface-400 hover:text-surface-100'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {hint && <p className="mt-1.5 text-xs text-surface-500">{hint}</p>}
      </div>

      {role === 'client' && (
        <div>
          <label className="block text-sm font-medium text-surface-300 mb-1.5">
            Assigned client
          </label>
          <select
            value={clientId}
            onChange={(e) => onClientId(e.target.value)}
            required
            className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-surface-100 focus:outline-none focus:ring-2 focus:ring-surface-100/20 text-sm"
          >
            <option value="">Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {role === 'member' && (
        <div>
          <label className="block text-sm font-medium text-surface-300 mb-1.5">
            Client access <span className="text-surface-500 font-normal">(optional)</span>
          </label>
          <ClientMultiSelect clients={clients} selected={memberIds} onChange={onMemberIds} />
        </div>
      )}

      {role === 'admin' && requireAdminConfirm && (
        <label className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={adminConfirmed}
            onChange={(e) => onAdminConfirmed(e.target.checked)}
            className="mt-0.5 accent-amber-500"
          />
          <span className="flex items-center gap-1.5 text-xs text-amber-300">
            <AlertTriangle size={13} className="shrink-0" />
            I understand this grants full admin access to the entire portal.
          </span>
        </label>
      )}
    </div>
  )
}
