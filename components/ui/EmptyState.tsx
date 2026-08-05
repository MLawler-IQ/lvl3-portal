"use client";

import Link from "next/link";

interface EmptyStateProps {
  icon?: React.ElementType;
  title: string;
  description?: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${compact ? "py-6" : "py-12"} px-6 ${className}`}
    >
      {Icon && (
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
          style={{ backgroundColor: "var(--active-bg)" }}
        >
          <Icon className="w-5 h-5" style={{ color: "var(--color-accent)" }} />
        </div>
      )}

      <p className="text-sm font-medium text-surface-100 mb-1">{title}</p>

      {description && (
        <p className="text-xs text-surface-400 leading-relaxed max-w-xs">
          {description}
        </p>
      )}

      {action && (
        action.href ? (
          <Link
            href={action.href}
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors hover:opacity-90"
            style={{ backgroundColor: "var(--color-primary)", color: "rgb(var(--surface-950))" }}
          >
            {action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors hover:opacity-90"
            style={{ backgroundColor: "var(--color-primary)", color: "rgb(var(--surface-950))" }}
          >
            {action.label}
          </button>
        )
      )}
    </div>
  );
}
