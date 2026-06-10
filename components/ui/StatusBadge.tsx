import {
  Sparkles,
  Clock,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Zap,
} from "lucide-react";

// ---------------------------------------------------------------------------
// RunStatusBadge — tool / pipeline run status pill
// ---------------------------------------------------------------------------

type RunStatus =
  | "stable"
  | "beta"
  | "new"
  | "deprecated"
  | "coming-soon"
  | "running"
  | "complete"
  | "failed"
  | "partial"
  | "queued";

interface RunStatusBadgeProps {
  variant: RunStatus;
  className?: string;
}

const BASE =
  "inline-flex items-center text-[10px] font-medium uppercase tracking-[0.1em] px-2 py-0.5 rounded-full";

export function RunStatusBadge({ variant, className = "" }: RunStatusBadgeProps) {
  if (variant === "stable") return null;

  if (variant === "running") {
    return (
      <span
        className={`${BASE} border bg-brand-400/15 text-brand-400 border-brand-400/20 ${className}`}
      >
        <span className="animate-pulse w-1.5 h-1.5 rounded-full bg-brand-400 mr-1" />
        Running
      </span>
    );
  }

  if (variant === "complete") {
    return (
      <span
        className={`${BASE} border ${className}`}
        style={{
          backgroundColor: "rgba(74,222,128,0.1)",
          color: "#4ade80",
          borderColor: "rgba(74,222,128,0.2)",
        }}
      >
        Complete
      </span>
    );
  }

  if (variant === "failed") {
    return (
      <span
        className={`${BASE} border ${className}`}
        style={{
          backgroundColor: "rgba(248,113,113,0.1)",
          color: "#f87171",
          borderColor: "rgba(248,113,113,0.2)",
        }}
      >
        Failed
      </span>
    );
  }

  const variantClasses: Record<Exclude<RunStatus, "stable" | "running" | "complete" | "failed">, string> = {
    new: "bg-brand-400/15 text-brand-400 border border-brand-400/20",
    beta: "bg-surface-700 text-surface-300 border border-surface-600",
    deprecated: "bg-surface-800 text-surface-500 border border-surface-700",
    "coming-soon": "bg-surface-800 text-surface-500 border border-surface-700",
    partial: "bg-surface-700 text-surface-300 border border-surface-600",
    queued: "bg-surface-700 text-surface-400 border border-surface-600",
  };

  const labels: Record<Exclude<RunStatus, "stable" | "running" | "complete" | "failed">, string> = {
    new: "New",
    beta: "Beta",
    deprecated: "Deprecated",
    "coming-soon": "Coming Soon",
    partial: "Partial",
    queued: "Queued",
  };

  return (
    <span className={`${BASE} ${variantClasses[variant as keyof typeof variantClasses]} ${className}`}>
      {labels[variant as keyof typeof labels]}
    </span>
  );
}

type Status =
  | "new"
  | "needs-review"
  | "in-progress"
  | "blocked"
  | "resolved"
  | "opportunity";

const STATUS_CONFIG: Record<
  Status,
  { label: string; icon: React.ElementType; className: string }
> = {
  new: {
    label: "New",
    icon: Sparkles,
    className:
      "bg-brand-400/10 text-brand-400 border-brand-400/20",
  },
  "needs-review": {
    label: "Needs review",
    icon: Clock,
    className: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  },
  "in-progress": {
    label: "In progress",
    icon: RefreshCw,
    className: "bg-brand-500/15 text-brand-400 border-brand-500/20",
  },
  blocked: {
    label: "Blocked",
    icon: AlertCircle,
    className: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  },
  resolved: {
    label: "Resolved",
    icon: CheckCircle,
    className: "bg-surface-700/50 text-surface-400 border-surface-600",
  },
  opportunity: {
    label: "Opportunity",
    icon: Zap,
    className: "bg-accent-400/10 text-accent-400 border-accent-400/20",
  },
};

interface StatusBadgeProps {
  status: Status;
  className?: string;
}

export default function StatusBadge({
  status,
  className = "",
}: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${config.className} ${className}`}
    >
      <Icon size={11} aria-hidden="true" />
      {config.label}
    </span>
  );
}
