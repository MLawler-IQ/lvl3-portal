'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, CheckCircle } from 'lucide-react'
import type { ClientOption, UserRole } from '@/app/actions/users'
import { inviteUserGlobal } from '@/app/actions/users'
import RoleAssignment from './role-assignment'

interface Props {
  clients: ClientOption[]
  onClose: () => void
}

export default function UserInviteModal({ clients, onClose }: Props) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<UserRole>('client')
  const [clientId, setClientId] = useState('')
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [adminConfirmed, setAdminConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  const canSubmit =
    !!email.trim() &&
    (role !== 'client' || !!clientId) &&
    (role !== 'admin' || adminConfirmed)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.set('email', email)
      fd.set('name', name)
      fd.set('role', role)
      if (role === 'client') fd.set('clientId', clientId)
      if (role === 'member') fd.set('memberClientIds', memberIds.join(','))
      await inviteUserGlobal(fd)
      setSuccess(true)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface-900 border border-surface-700 rounded-xl w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-surface-100 font-semibold text-lg">Invite user</h2>
          <button
            onClick={onClose}
            className="text-surface-500 hover:text-surface-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle size={32} className="text-green-400" />
            <p className="text-surface-100 font-medium">Invite sent to {email}</p>
            <p className="text-surface-400 text-sm">
              They&apos;ll receive a magic link to join as{' '}
              <span className="text-surface-100">a{role === 'admin' || role === 'member' ? 'n' : ''} {role}</span>.
            </p>
            <button
              onClick={onClose}
              className="mt-2 bg-brand-400 text-surface-950 rounded-lg px-6 py-2 text-sm font-semibold hover:bg-brand-500 transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1.5">
                Email address
              </label>
              <input
                ref={emailRef}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@company.com"
                className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-surface-100/20 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1.5">
                Name <span className="text-surface-500 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
                className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-surface-100/20 text-sm"
              />
            </div>

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
              requireAdminConfirm
            />

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 bg-surface-800 text-surface-300 rounded-lg px-4 py-2 text-sm font-medium hover:bg-surface-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !canSubmit}
                className="flex-1 bg-brand-400 text-surface-950 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-brand-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Sending…' : 'Send invite'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
