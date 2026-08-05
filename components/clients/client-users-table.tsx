'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus } from 'lucide-react'
import type { UserWithAccess } from '@/app/actions/clients'
import { revokeAccess } from '@/app/actions/clients'
import InviteUserModal from './invite-user-modal'

const ROLE_BADGE: Record<string, string> = {
  admin: 'bg-brand-400/10 text-brand-400',
  member: 'bg-brand-500/15 text-brand-400 border border-brand-500/30',
  client: 'bg-surface-700 text-surface-300',
}

interface ClientUsersTableProps {
  users: UserWithAccess[]
  clientId: string
  clientName: string
}

export default function ClientUsersTable({ users, clientId, clientName }: ClientUsersTableProps) {
  const router = useRouter()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)

  async function handleRevoke(userId: string) {
    setRevoking(userId)
    try {
      await revokeAccess(userId, clientId)
      router.refresh()
    } catch (err) {
      console.error('Revoke failed:', err)
    } finally {
      setRevoking(null)
    }
  }

  return (
    <>
      <div className="bg-surface-900 border border-surface-700 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-700">
          <h2 className="text-surface-100 font-medium">Users with access</h2>
          <button
            onClick={() => setInviteOpen(true)}
            className="flex items-center gap-1.5 bg-brand-400 text-surface-950 text-xs font-semibold rounded-lg px-3 py-1.5 hover:bg-brand-500 transition-colors"
          >
            <UserPlus size={13} />
            Add access
          </button>
        </div>

        {users.length === 0 ? (
          <div className="px-5 py-10 text-center text-surface-400 text-sm">
            No users yet. Invite a client or team member to get started.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-700">
                <th className="text-left text-xs font-medium text-surface-400 px-5 py-3">Email</th>
                <th className="text-left text-xs font-medium text-surface-400 px-5 py-3">Role</th>
                <th className="text-left text-xs font-medium text-surface-400 px-5 py-3">Added</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-surface-800/50 last:border-0">
                  <td className="px-5 py-3 text-surface-200">{u.email}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-block text-xs font-medium rounded-full px-2.5 py-0.5 ${ROLE_BADGE[u.role] ?? ROLE_BADGE.client}`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-surface-400">
                    {new Date(u.granted_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => handleRevoke(u.id)}
                      disabled={revoking === u.id}
                      className="text-xs text-surface-400 hover:text-red-400 transition-colors disabled:opacity-50"
                    >
                      {revoking === u.id ? 'Removing…' : 'Revoke'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {inviteOpen && (
        <InviteUserModal
          clientId={clientId}
          clientName={clientName}
          onClose={() => setInviteOpen(false)}
        />
      )}
    </>
  )
}
