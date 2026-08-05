"use client";

import { FileText, Monitor, Table2, ExternalLink } from "lucide-react";
import StatusBadge from "@/components/ui/StatusBadge";
import type { DeliverableWithCounts } from "@/app/(dashboard)/deliverables/page";

const FILE_TYPE_CONFIG = {
  pdf: { icon: FileText, color: "text-red-400", bg: "bg-red-400/10" },
  slides: { icon: Monitor, color: "text-orange-400", bg: "bg-orange-400/10" },
  sheets: { icon: Table2, color: "text-green-400", bg: "bg-green-400/10" },
  link: { icon: ExternalLink, color: "text-brand-400", bg: "bg-brand-400/10" },
} as const;

interface Props {
  deliverable: DeliverableWithCounts;
  showClientName: boolean;
  isSelected: boolean;
  onClick: (d: DeliverableWithCounts, trigger: HTMLElement) => void;
}

export default function DeliverableCard({
  deliverable,
  showClientName,
  isSelected,
  onClick,
}: Props) {
  const config = FILE_TYPE_CONFIG[deliverable.file_type];
  const Icon = config.icon;
  const isNew = !deliverable.viewed_at;
  const hasOpenThreads = deliverable.unresolvedCount > 0;
  const derivedStatus = isNew ? "new" : hasOpenThreads ? "needs-review" : null;

  return (
    <button
      onClick={(e) => onClick(deliverable, e.currentTarget)}
      className={`w-full text-left p-4 rounded-xl border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-400 hover:shadow-[0_0_20px_rgba(251,146,60,0.04)] ${
        isSelected
          ? "border-brand-400/30 bg-surface-800"
          : "border-surface-700 bg-surface-850 hover:border-surface-600 hover:bg-surface-800"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className={`p-2 rounded-lg ${config.bg} shrink-0`}>
          <Icon size={18} className={config.color} />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end min-w-0">
          {derivedStatus && <StatusBadge status={derivedStatus} />}
          {hasOpenThreads && (
            <span className="text-xs bg-amber-500/15 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full shrink-0">
              {deliverable.unresolvedCount} open
            </span>
          )}
        </div>
      </div>

      <p className="text-surface-100 font-medium text-sm leading-snug mb-1 line-clamp-2">
        {deliverable.title}
      </p>

      {showClientName && deliverable.clients && (
        <p className="text-surface-400 text-xs mb-1">{deliverable.clients.name}</p>
      )}

      <p className="text-surface-400 text-xs">
        {new Date(deliverable.created_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </p>
    </button>
  );
}
