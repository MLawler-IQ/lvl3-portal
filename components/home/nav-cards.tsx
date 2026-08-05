import Link from "next/link";
import { FolderKanban, LayoutDashboard, PackageOpen, Lightbulb, Sparkles, ArrowRight } from "lucide-react";

const NAV_CARDS = [
  { href: "/projects",     icon: FolderKanban,   title: "Projects",     description: "Track monthly SEO tasks" },
  { href: "/dashboard",    icon: LayoutDashboard, title: "Dashboard",    description: "View your analytics" },
  { href: "/deliverables", icon: PackageOpen,     title: "Deliverables", description: "Reports and documents" },
  { href: "/insights",     icon: Lightbulb,       title: "Insights",     description: "SEO insights and updates" },
  { href: "/services",     icon: Sparkles,        title: "Services",     description: "Our service offerings" },
];

export default function NavCards({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {NAV_CARDS.map(({ href, icon: Icon, title }) => (
          <Link
            key={href}
            href={href}
            className="flex flex-col items-center gap-1.5 rounded-[10px] border border-surface-700 bg-surface-900 p-3 transition-all duration-200 hover:border-surface-600 hover:bg-surface-850 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-500"
          >
            <Icon size={16} className="text-surface-400" strokeWidth={1.8} />
            <p className="text-xs text-surface-400">{title}</p>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {NAV_CARDS.map(({ href, icon: Icon, title, description }) => (
        <Link
          key={href}
          href={href}
          className="group flex flex-col gap-3 rounded-[10px] border border-surface-700 bg-surface-900 p-4 transition-all duration-200 hover:border-surface-600 hover:bg-surface-850 hover:-translate-y-1 hover:shadow-[0_12px_32px_rgba(0,0,0,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-500"
        >
          <div className="flex items-center justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-surface-800 text-surface-400 transition-colors group-hover:bg-surface-700 group-hover:text-surface-400">
              <Icon size={18} strokeWidth={1.8} />
            </div>
            <ArrowRight size={14} className="text-surface-600 transition-all group-hover:translate-x-0.5 group-hover:text-surface-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-surface-100">{title}</p>
            <p className="mt-0.5 text-xs text-surface-400 leading-relaxed">{description}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
