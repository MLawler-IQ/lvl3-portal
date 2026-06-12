'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, Search } from 'lucide-react'
import type { AdminUsersData, AdminUserRow, UserRole, UserStatus } from '@/app/actions/users'
import { resendInvite } from '@/app/actions/users'
import UserInviteModal from './user-invite-modal'
import UserEditModal from './user-edit-modal'

const ROLE_BADGE: Record<UserRole, string> = {
  admin: 'bg-brand-400/10 text-brand-400',
  member: 'bg-brand-500/15 text-brand-400 border border-brand-500/30',
  client: 'bg-surface-700 text-surface-300',
}

const STATUS_BADGE: Record<UserStatus, string> = {
  active: 'bg-green-500/10 text-green-400',
  invited: 'bg-amber-500/10 text-amber-400',
  deactivated: 'bg-red-500/10 text-red-400',
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function UsersTable({ data }: { data: AdminUsersData }) {
  const router = useRouter()
  const { users, clients, currentUserId, adminCount } = data
  const clientName = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients])

  const [inviteOpen, setInviteOpen] = useState(false)
  const [editing, setEditing] = useState<AdminUserRow | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all')
  const [resending, setResending] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const filtered = users.filter((u) => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      if (!`${u.name ?? ''} ${u.email}`.toLowerCase().includes(q)) return false
    }
    return true
  })

  async function handleResend(u: AdminUserRow) {
    setResending(u.id)
    setNotice(null)
    try {
      const res = await resendInvite(u.id)
      setNotice(
        res.kind === 'invite'
          ? `Invite re-sent to ${u.email}.`
          : `Password-reset link sent to ${u.email}.`,
      )
      router.refresh()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Failed to send.')
    } finally {
      setResending(null)
    }
  }

  function clientCell(u: AdminUserRow) {
    if (u.role === 'admin') return <span className="text-surface-500">All clients</span>
    if (u.role === 'client') {
      return u.clientName ? (
        <span className="text-surface-200">{u.clientName}</span>
      ) : (
        <span className="text-amber-400">Unassigned</span>
      )
    }
    // member
    if (u.memberClientIds.length === 0) return <span className="text-surface-500">No access yet</span>
    const names = u.memberClientIds
      .map((id) => clientName.get(id))
      .filter((n): n is string => !!n)
    return (
      <span className="text-surface-200" title={names.join(', ')}>
        {u.memberClientIds.length} client{u.memberClientIds.length === 1 ? '' : 's'}
      </span>
    )
  }

  return (
    <>
      <div className="bg-surface-900 border border-surface-700 rounded-xl overflow-hidden">
        {/* Header + controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-surface-700">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or email…"
                className="w-48 bg-surface-800 border border-surface-600 rounded-lg pl-8 pr-3 py-1.5 text-sm text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-surface-100/20"
              />
            </div>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as 'all' | UserRole)}
              className="bg-surface-800 border border-surface-600 rounded-lg px-2.5 py-1.5 text-sm text-surface-200 focus:outline-none focus:ring-2 focus:ring-surface-100/20"
            >
              <option value="all">All roles</option>
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="client">Client</option>
            </select>
          </div>
          <button
            onClick={() => setInviteOpen(true)}
            className="flex items-center gap-1.5 bg-brand-400 text-surface-950 text-xs font-semibold rounded-lg px-3 py-1.5 hover:bg-brand-500 transition-colors"
          >
            <UserPlus size={13} />
            Invite user
          </button>
        </div>

        {notice && (
          <div className="px-5 py-2.5 text-xs text-surface-300 bg-surface-800/50 border-b border-surface-700">
            {notice}
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="px-5 py-10 text-center text-surface-500 text-sm">
            {users.length === 0 ? 'No users yet. Invite someone to get started.' : 'No users match your filters.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-700">
                  <th className="text-left text-xs font-medium text-surface-500 px-5 py-3">Name</th>
                  <th className="text-left text-xs font-medium text-surface-500 px-5 py-3">Email</th>
                  <th className="text-left text-xs font-medium text-surface-500 px-5 py-3">Role</th>
                  <th className="text-left text-xs font-medium text-surface-500 px-5 py-3">Clients</th>
                  <th className="text-left text-xs font-medium text-surface-500 px-5 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-surface-500 px-5 py-3">Last login</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="border-b border-surface-800/50 last:border-0">
                    <td className="px-5 py-3 text-surface-200">
                      {u.name ? u.name : <span className="text-surface-500">—</span>}
                    </td>
                    <td className="px-5 py-3 text-surface-400 break-all">
                      {u.email}
                      {u.id === currentUserId && (
                        <span className="ml-2 text-xs text-surface-500">(you)</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-block text-xs font-medium rounded-full px-2.5 py-0.5 ${ROLE_BADGE[u.role]}`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="px-5 py-3">{clientCell(u)}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-block text-xs font-medium rounded-full px-2.5 py-0.5 ${STATUS_BADGE[u.status]}`}
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-surface-500">{fmtDate(u.lastSignInAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-3">
                        {u.status !== 'deactivated' && (
                          <button
                            onClick={() => handleResend(u)}
                            disabled={resending === u.id}
                            className="text-xs text-surface-500 hover:text-surface-200 transition-colors disabled:opacity-50"
                          >
                            {resending === u.id
                              ? 'Sending…'
                              : u.status === 'invited'
                                ? 'Resend invite'
                                : 'Reset password'}
                          </button>
                        )}
                        <button
                          onClick={() => setEditing(u)}
                          className="text-xs font-medium text-brand-400 hover:text-brand-500 transition-colors"
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {inviteOpen && <UserInviteModal clients={clients} onClose={() => setInviteOpen(false)} />}
      {editing && (
        <UserEditModal
          user={editing}
          clients={clients}
          currentUserId={currentUserId}
          adminCount={adminCount}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
