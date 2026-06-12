import { requireAdmin } from '@/lib/auth'
import { Users as UsersIcon } from 'lucide-react'
import { listAllUsers } from '@/app/actions/users'
import AdminTabs from '@/components/admin/admin-tabs'
import UsersTable from '@/components/admin/users-table'

export default async function AdminUsersPage() {
  await requireAdmin()
  const data = await listAllUsers()

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      <AdminTabs />
      <div className="flex items-center gap-3">
        <UsersIcon className="w-5 h-5 text-surface-400" />
        <div>
          <h1 className="text-xl font-semibold text-surface-100">Users</h1>
          <p className="mt-0.5 text-sm text-surface-400">
            Invite, assign, and manage everyone with portal access
          </p>
        </div>
      </div>

      <UsersTable data={data} />
    </div>
  )
}
