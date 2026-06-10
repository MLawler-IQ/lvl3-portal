"use client"

import Link from "next/link"
import { useEffect } from "react"
import {
  X,
  Home,
  FolderKanban,
  LayoutDashboard,
  PackageOpen,
  Lightbulb,
  Sparkles,
  Wrench,
  MessageCircle,
  Users,
  ShieldCheck,
} from "lucide-react"

interface MobileNavDrawerProps {
  isOpen: boolean
  onClose: () => void
  isAdmin: boolean
  pathname: string
  deliverableBadgeCount: number
  postsBadgeCount: number
  servicesBadgeCount: number
}

type NavItem = {
  label: string
  href: string
  icon: React.ElementType
  badge?: number
}

export default function MobileNavDrawer({
  isOpen,
  onClose,
  isAdmin,
  pathname,
  deliverableBadgeCount,
  postsBadgeCount,
  servicesBadgeCount,
}: MobileNavDrawerProps) {
  // Lock background scroll while the drawer is open
  useEffect(() => {
    if (!isOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [isOpen])

  if (!isOpen) return null

  function isActive(href: string) {
    if (href === "/") return pathname === "/"
    return pathname.startsWith(href)
  }

  const coreItems: NavItem[] = [
    { label: "Home",         href: "/",             icon: Home },
    { label: "Projects",     href: "/projects",     icon: FolderKanban },
    { label: "Dashboard",    href: "/dashboard",    icon: LayoutDashboard },
    { label: "Deliverables", href: "/deliverables", icon: PackageOpen,   badge: deliverableBadgeCount || undefined },
    { label: "Insights",     href: "/insights",     icon: Lightbulb,     badge: postsBadgeCount || undefined },
    { label: "Services",     href: "/services",     icon: Sparkles,      badge: servicesBadgeCount || undefined },
  ]

  const adminItems: NavItem[] = [
    { label: "Tools",    href: "/tools",    icon: Wrench },
    { label: "Ask LVL3", href: "/ask-lvl3", icon: MessageCircle },
    { label: "Clients",  href: "/clients",  icon: Users },
    { label: "Admin",    href: "/admin",    icon: ShieldCheck },
  ]

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className="fixed top-0 left-0 bottom-0 w-64 z-50 flex flex-col animate-fade-in"
        style={{
          backgroundColor: "var(--sidebar-bg)",
          borderRight: "1px solid var(--sidebar-border)",
        }}
      >
        {/* Header */}
        <div
          className="h-14 flex items-center justify-between px-4 shrink-0"
          style={{ borderBottom: "1px solid var(--sidebar-border)" }}
        >
          <span
            className="font-bold text-base"
            style={{
              color: "var(--color-primary)",
              fontFamily: "var(--font-jetbrains-mono), monospace",
            }}
          >
            LVL3
          </span>
          <button
            onClick={onClose}
            className="p-2.5 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            style={{ color: "var(--sidebar-text)" }}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 overflow-y-auto overflow-x-hidden space-y-0.5">
          {/* Workspace section */}
          <p
            className="px-3 py-2 text-[10px] font-medium uppercase tracking-[0.14em]"
            style={{ color: "var(--sidebar-text)" }}
          >
            Workspace
          </p>

          {coreItems.map(({ label, href, icon: Icon, badge }) => {
            const active = isActive(href)
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className="flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded text-sm font-medium transition-colors"
                style={{
                  color: active ? "var(--sidebar-active)" : "var(--sidebar-text)",
                  backgroundColor: active ? "var(--active-bg)" : "transparent",
                }}
              >
                <Icon size={16} strokeWidth={active ? 2.5 : 1.8} className="shrink-0" />
                <span className="flex-1">{label}</span>
                {badge && badge > 0 && (
                  <span
                    className="text-xs rounded-full px-1.5 py-0.5 leading-none"
                    style={{
                      backgroundColor: "var(--active-bg)",
                      color: "var(--sidebar-active)",
                    }}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </Link>
            )
          })}

          {/* Admin section */}
          {isAdmin && (
            <>
              <div
                className="my-1 mx-1 h-px"
                style={{ backgroundColor: "var(--sidebar-border)" }}
              />
              <p
                className="px-3 py-2 text-[10px] font-medium uppercase tracking-[0.14em]"
                style={{ color: "var(--sidebar-text)" }}
              >
                Admin
              </p>

              {adminItems.map(({ label, href, icon: Icon }) => {
                const active = isActive(href)
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onClose}
                    className="flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded text-sm font-medium transition-colors"
                    style={{
                      color: active ? "var(--sidebar-active)" : "var(--sidebar-text)",
                      backgroundColor: active ? "var(--active-bg)" : "transparent",
                    }}
                  >
                    <Icon size={16} strokeWidth={active ? 2.5 : 1.8} className="shrink-0" />
                    <span className="flex-1">{label}</span>
                  </Link>
                )
              })}
            </>
          )}
        </nav>
      </div>
    </>
  )
}
