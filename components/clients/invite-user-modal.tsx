'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, CheckCircle } from 'lucide-react'
import { inviteUser } from '@/app/actions/clients'

interface InviteUserModalProps {
  clientId: string
  clientName: string
  onClose: () => void
}

export default function InviteUserModal({ clientId, clientName, onClose }: InviteUserModalProps) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'client' | 'member'>('client')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.set('email', email)
      fd.set('role', role)
      fd.set('clientId', clientId)
      await inviteUser(fd)
      setSuccess(true)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface-900 border border-surface-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-surface-100 font-semibold text-lg">Add access</h2>
          <button onClick={onClose} className="text-surface-400 hover:text-surface-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle size={32} className="text-green-400" />
            <p className="text-surface-100 font-medium">Invite sent to {email}</p>
            <p className="text-surface-400 text-sm">
              They&apos;ll receive a magic link to join as a{' '}
              <span className="text-surface-100">{role}</span> on <span className="text-surface-100">{clientName}</span>.
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
                className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-surface-100/20 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-300 mb-2">Role</label>
              <div className="flex rounded-lg overflow-hidden border border-surface-600">
                <button
                  type="button"
                  onClick={() => setRole('client')}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${
                    role === 'client'
                      ? 'bg-brand-400/10 text-brand-400'
                      : 'bg-surface-800 text-surface-400 hover:text-surface-100'
                  }`}
                >
                  Client
                </button>
                <button
                  type="button"
                  onClick={() => setRole('member')}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${
                    role === 'member'
                      ? 'bg-brand-400/10 text-brand-400'
                      : 'bg-surface-800 text-surface-400 hover:text-surface-100'
                  }`}
                >
                  Member
                </button>
              </div>
              <p className="mt-1.5 text-xs text-surface-400">
                {role === 'client'
                  ? 'External client — read-only access to this workspace only.'
                  : 'Internal LVL3 team — can be added to multiple client workspaces.'}
              </p>
            </div>

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
                disabled={loading || !email.trim()}
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
