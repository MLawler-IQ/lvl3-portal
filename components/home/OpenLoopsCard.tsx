import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { STATUS_TONE } from "@/lib/status-tone";

interface Props {
  totalOpenThreads: number;
  threadsByDeliverable: {
    deliverableId: string;
    deliverableTitle: string;
    count: number;
  }[];
}

export default function OpenLoopsCard({
  totalOpenThreads,
  threadsByDeliverable,
}: Props) {
  if (totalOpenThreads === 0) {
    return (
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare size={14} className="text-surface-400" />
          <p className="text-xs text-surface-400">All threads resolved</p>
        </div>
        <p className="text-sm text-surface-400 italic">Clean slate.</p>
      </div>
    );
  }

  const topItems = threadsByDeliverable.slice(0, 3);
  const deliverableCount = threadsByDeliverable.length;

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <div className="flex items-start gap-2 mb-4">
        <MessageSquare size={14} className={`mt-0.5 shrink-0 ${STATUS_TONE.warning.text}`} />
        <p className="text-sm text-surface-200">
          <span className="font-semibold text-surface-100">{totalOpenThreads}</span>{" "}
          unresolved {totalOpenThreads === 1 ? "thread" : "threads"} across{" "}
          <span className="font-semibold text-surface-100">{deliverableCount}</span>{" "}
          {deliverableCount === 1 ? "deliverable" : "deliverables"}
        </p>
      </div>
      <div className="space-y-2 mb-4">
        {topItems.map((item) => (
          <div
            key={item.deliverableId}
            className="flex items-center justify-between gap-3"
          >
            <p className="text-sm text-surface-300 truncate flex-1">
              {item.deliverableTitle}
            </p>
            <span className={`shrink-0 text-xs border px-2 py-0.5 rounded-full ${STATUS_TONE.warning.chip}`}>
              {item.count} {item.count === 1 ? "thread" : "threads"}
            </span>
          </div>
        ))}
      </div>
      <Link
        href="/deliverables"
        className="flex items-center justify-center w-full px-4 py-2 bg-surface-800 hover:bg-surface-850 border border-surface-600 text-surface-200 hover:text-surface-100 text-xs font-medium rounded-lg transition-colors"
      >
        Review and resolve
      </Link>
    </div>
  );
}
