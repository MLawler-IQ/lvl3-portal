'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Trash2 } from 'lucide-react'
import type { AdminUserRow, ClientOption, UserRole } from '@/app/actions/users'
import {
  setUserName,
  setUserRole,
  setMemberClients,
  deactivateUser,
  reactivateUser,
  deleteUser,
} from '@/app/actions/users'
import RoleAssignment from './role-assignment'

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(b)
  return a.every((x) => set.has(x))
}

interface Props {
  user: AdminUserRow
  clients: ClientOption[]
  currentUserId: string
  adminCount: number
  onClose: () => void
}

export default function UserEditModal({ user, clients, currentUserId, adminCount, onClose }: Props) {
  const router = useRouter()
  const [name, setName] = useState(user.name ?? '')
  const [role, setRole] = useState<UserRole>(user.role)
  const [clientId, setClientId] = useState(user.clientId ?? '')
  const [memberIds, setMemberIds] = useState<string[]>(user.memberClientIds)
  const [adminConfirmed, setAdminConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState('')

  const isSelf = user.id === currentUserId
  const isLastAdmin = user.role === 'admin' && adminCount <= 1
  const promotingToAdmin = role === 'admin' && user.role !== 'admin'

  const normName = name.trim().length > 0 ? name.trim() : null
  const nameChanged = normName !== (user.name ?? null)
  const roleChanged = role !== user.role
  const clientChanged = role === 'client' && clientId !== (user.clientId ?? '')
  const grantsChanged = role === 'member' && !sameSet(memberIds, user.memberClientIds)
  const profileChanged = roleChanged || clientChanged || grantsChanged

  // Name is editable even on your own account; role/status/delete are not.
  const roleValid = role !== 'client' || !!clientId
  const confirmOk = !promotingToAdmin || adminConfirmed
  const canSave = roleValid && confirmOk && (nameChanged || (!isSelf && profileChanged))

  async function run(fn: () => Promise<unknown>, flag: (v: boolean) => void) {
    flag(true)
    setError(null)
    try {
      await fn()
      router.refresh()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      flag(false)
    }
  }

  function handleSave() {
    run(async () => {
      if (nameChanged) await setUserName(user.id, name)
      if (!isSelf) {
        if (roleChanged || clientChanged) {
          await setUserRole(user.id, role, role === 'client' ? clientId : null)
        }
        if (role === 'member' && (roleChanged || grantsChanged)) {
          await setMemberClients(user.id, memberIds)
        }
      }
    }, setSaving)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface-900 border border-surface-700 rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-surface-100 font-semibold text-lg break-all">{user.email}</h2>
            <p className="mt-0.5 text-xs text-surface-500">
              Joined{' '}
              {new Date(user.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-surface-500 hover:text-surface-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {isSelf && (
          <p className="mb-4 text-xs text-surface-400 bg-surface-800/60 border border-surface-700 rounded-lg px-3 py-2">
            This is your own account — role and status can&apos;t be changed here.
          </p>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium text-surface-300 mb-1.5">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name"
            className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-surface-100/20 text-sm"
          />
        </div>

        {/* Role + assignment */}
        <fieldset disabled={isSelf} className={isSelf ? 'opacity-50' : ''}>
          <RoleAssignment
            clients={clients}
            role={role}
            onRole={setRole}
            clientId={clientId}
            onClientId={setClientId}
            memberIds={memberIds}
            onMemberIds={setMemberIds}
            adminConfirmed={adminConfirmed}
            onAdminConfirmed={setAdminConfirmed}
            requireAdminConfirm={promotingToAdmin}
          />
        </fieldset>

        {error && <p className="mt-3 text-red-400 text-sm">{error}</p>}

        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 bg-surface-800 text-surface-300 rounded-lg px-4 py-2 text-sm font-medium hover:bg-surface-700 transition-colors"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || saving}
            className="flex-1 bg-brand-400 text-surface-950 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-brand-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        {/* Status */}
        <div className="mt-6 pt-5 border-t border-surface-700">
          <p className="text-xs font-medium uppercase tracking-widest text-surface-500 mb-3">
            Status
          </p>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-surface-300">
              Currently <span className="text-surface-100 font-medium">{user.status}</span>
              {user.status === 'deactivated' && user.deactivatedAt && (
                <span className="text-surface-500">
                  {' '}
                  since{' '}
                  {new Date(user.deactivatedAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              )}
            </span>
            {user.status === 'deactivated' ? (
              <button
                type="button"
                onClick={() => run(() => reactivateUser(user.id), setWorking)}
                disabled={working}
                className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors disabled:opacity-50"
              >
                Reactivate
              </button>
            ) : (
              <button
                type="button"
                onClick={() => run(() => deactivateUser(user.id), setWorking)}
                disabled={working || isSelf || isLastAdmin}
                className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-surface-800 text-surface-300 hover:text-amber-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Deactivate
              </button>
            )}
          </div>
          {(isSelf || isLastAdmin) && user.status !== 'deactivated' && (
            <p className="mt-2 text-xs text-surface-500">
              {isSelf ? 'You can’t deactivate your own account.' : 'You can’t deactivate the last admin.'}
            </p>
          )}
        </div>

        {/* Danger zone */}
        <div className="mt-6 pt-5 border-t border-surface-700">
          <p className="text-xs font-medium uppercase tracking-widest text-red-400/80 mb-3">
            Danger zone
          </p>
          {isSelf || isLastAdmin ? (
            <p className="text-xs text-surface-500">
              {isSelf ? 'You can’t delete your own account.' : 'You can’t delete the last admin.'}
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-surface-400">
                Permanently removes this user and all their access. Type{' '}
                <span className="text-surface-200 font-mono">DELETE</span> to confirm.
              </p>
              <div className="flex gap-2">
                <input
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder="DELETE"
                  className="flex-1 bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-red-500/30 text-sm"
                />
                <button
                  type="button"
                  onClick={() => run(() => deleteUser(user.id), setWorking)}
                  disabled={deleteConfirm !== 'DELETE' || working}
                  className="flex items-center gap-1.5 bg-red-500/10 text-red-400 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
