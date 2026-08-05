import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface PageHeaderProps {
  icon?: React.ElementType;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  actions?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  icon: Icon,
  eyebrow,
  title,
  subtitle,
  breadcrumbs,
  actions,
  badge,
  className = "",
}: PageHeaderProps) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 mb-2">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && (
                  <ChevronRight
                    size={12}
                    className="text-surface-600 shrink-0"
                    aria-hidden="true"
                  />
                )}
                {crumb.href ? (
                  <Link
                    href={crumb.href}
                    className="text-xs text-surface-400 hover:text-surface-300 transition-colors"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-xs text-surface-400">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}

        {eyebrow && (
          <p
            className="text-[11px] font-medium uppercase tracking-[0.14em] mb-1"
            style={{ color: "var(--color-primary)" }}
          >
            {eyebrow}
          </p>
        )}

        <div className="flex items-center gap-3">
          {Icon && (
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: "var(--active-bg)" }}
            >
              <Icon className="w-4 h-4" style={{ color: "var(--color-accent)" }} />
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-medium text-surface-100">{title}</h1>
            {badge}
          </div>
        </div>

        {subtitle && (
          <p className="text-sm text-surface-400 mt-0.5">{subtitle}</p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
  );
}
