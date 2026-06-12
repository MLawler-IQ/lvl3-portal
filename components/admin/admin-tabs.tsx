'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { label: 'Overview', href: '/admin' },
  { label: 'Users', href: '/admin/users' },
]

export default function AdminTabs() {
  const pathname = usePathname()
  return (
    <div className="flex items-center gap-1 border-b border-surface-700">
      {TABS.map((t) => {
        const active = t.href === '/admin' ? pathname === '/admin' : pathname.startsWith(t.href)
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              active
                ? 'border-brand-400 text-surface-100'
                : 'border-transparent text-surface-400 hover:text-surface-100'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
