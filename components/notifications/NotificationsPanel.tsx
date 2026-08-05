"use client";

import { useEffect, useRef } from "react";
import { X, PackageOpen, MessageSquare, CheckCheck } from "lucide-react";
import Link from "next/link";
import { markViewed } from "@/app/actions/deliverables";
import { useRouter } from "next/navigation";

interface UnviewedDeliverable {
  id: string;
  title: string;
  viewed_at: string | null;
}

interface OpenThreadDeliverable {
  deliverableId: string;
  title: string;
  threadCount: number;
}

interface Props {
  unviewedDeliverables: UnviewedDeliverable[];
  openThreadDeliverables: OpenThreadDeliverable[];
  onClose: () => void;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function NotificationsPanel({
  unviewedDeliverables,
  openThreadDeliverables,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
    focusables[0]?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const els = panel!.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleMarkAllRead() {
    await Promise.all(unviewedDeliverables.map((d) => markViewed(d.id)));
    router.refresh();
    onClose();
  }

  const hasNotifications =
    unviewedDeliverables.length > 0 || openThreadDeliverables.length > 0;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/70 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        className="fixed inset-y-0 right-0 w-full max-w-sm bg-surface-900 border-l border-surface-700 z-50 flex flex-col animate-slide-in-right"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-700 shrink-0">
          <h2 className="text-surface-100 font-medium text-sm">Notifications</h2>
          <div className="flex items-center gap-2">
            {hasNotifications && unviewedDeliverables.length > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="flex items-center gap-1.5 text-xs text-surface-300 hover:text-surface-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-400 rounded"
              >
                <CheckCheck size={13} />
                Mark all read
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-surface-300 hover:text-surface-100 hover:bg-surface-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-400"
              aria-label="Close notifications"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!hasNotifications ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-6">
              <CheckCheck className="w-10 h-10 text-surface-600 mb-3" />
              <p className="text-sm text-surface-400">
                You&apos;re all caught up.
              </p>
            </div>
          ) : (
            <div className="py-2">
              {unviewedDeliverables.length > 0 && (
                <div>
                  <p className="px-5 py-2 text-[10px] font-medium uppercase tracking-widest text-surface-400">
                    New deliverables
                  </p>
                  {unviewedDeliverables.map((d) => (
                    <Link
                      key={d.id}
                      href="/deliverables"
                      onClick={onClose}
                      className="flex items-start gap-3 px-5 py-3 hover:bg-surface-850 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-surface-500"
                    >
                      <div className="mt-0.5 w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
                        <PackageOpen size={14} className="text-emerald-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-surface-200 font-medium truncate">
                          New deliverable
                        </p>
                        <p className="text-xs text-surface-400 truncate">
                          {d.title}
                        </p>
                      </div>
                      <span className="text-[10px] text-surface-400 shrink-0 mt-1">
                        Open
                      </span>
                    </Link>
                  ))}
                </div>
              )}

              {openThreadDeliverables.length > 0 && (
                <div>
                  <p className="px-5 py-2 text-[10px] font-medium uppercase tracking-widest text-surface-400">
                    Open threads
                  </p>
                  {openThreadDeliverables.map((d) => (
                    <Link
                      key={d.deliverableId}
                      href="/deliverables"
                      onClick={onClose}
                      className="flex items-start gap-3 px-5 py-3 hover:bg-surface-850 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-surface-500"
                    >
                      <div className="mt-0.5 w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
                        <MessageSquare size={14} className="text-amber-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-surface-200 font-medium truncate">
                          {d.threadCount}{" "}
                          {d.threadCount === 1 ? "open thread" : "open threads"}
                        </p>
                        <p className="text-xs text-surface-400 truncate">
                          {d.title}
                        </p>
                      </div>
                      <span className="text-[10px] text-surface-400 shrink-0 mt-1">
                        Open
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
