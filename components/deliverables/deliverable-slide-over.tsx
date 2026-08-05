"use client";

import { useEffect, useRef } from "react";
import { X, ExternalLink, Link as LinkIcon, MessageSquare } from "lucide-react";
import type { CommentWithUser } from "@/app/actions/deliverables";
import type { DeliverableWithCounts } from "@/app/(dashboard)/deliverables/page";
import CommentThread from "./comment-thread";

const FILE_TYPE_LABELS: Record<string, string> = {
  pdf: "PDF",
  slides: "Google Slides",
  sheets: "Google Sheets",
  link: "External Link",
};

function getEmbedUrl(url: string, fileType: string): string {
  if (fileType === "slides") {
    return url.replace(/\/(edit|pub|present|view)([?#].*)?$/, "/embed");
  }
  if (fileType === "sheets") {
    return url.replace(/\/edit([?#].*)?$/, "/pub?output=html");
  }
  return url;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

interface Props {
  deliverable: DeliverableWithCounts;
  signedUrl: string | null;
  signedUrlLoading: boolean;
  comments: CommentWithUser[];
  commentsLoading: boolean;
  isAdmin: boolean;
  currentUserId: string;
  onClose: () => void;
  onCommentsChanged: () => void;
}

export default function DeliverableSlideOver({
  deliverable,
  signedUrl,
  signedUrlLoading,
  comments,
  commentsLoading,
  isAdmin,
  currentUserId,
  onClose,
  onCommentsChanged,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = `slide-over-title-${deliverable.id}`;
  const isPdf = deliverable.file_type === "pdf";
  const hasUrl = !!deliverable.file_url;
  const embedUrl =
    !isPdf && hasUrl
      ? getEmbedUrl(deliverable.file_url!, deliverable.file_type)
      : null;
  const unresolvedCount = deliverable.unresolvedCount ?? 0;

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

  function handleCopyLink() {
    const url = `${window.location.origin}/deliverables#${deliverable.id}`;
    navigator.clipboard.writeText(url).catch(console.error);
  }

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
        aria-labelledby={titleId}
        className="fixed inset-y-0 right-0 w-full max-w-2xl bg-surface-900 border-l border-surface-700 z-50 flex flex-col animate-slide-in-right"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-surface-700 shrink-0">
          <div className="min-w-0">
            <p className="text-xs text-surface-400 mb-0.5 uppercase tracking-wider">
              {FILE_TYPE_LABELS[deliverable.file_type]}
            </p>
            <h2
              id={titleId}
              className="text-surface-100 font-medium text-lg leading-tight"
            >
              {deliverable.title}
            </h2>
            {deliverable.clients && (
              <p className="text-surface-300 text-sm mt-0.5">
                {deliverable.clients.name}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1.5 rounded-lg text-surface-300 hover:text-surface-100 hover:bg-surface-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Actions bar */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-surface-700 bg-surface-900/40 shrink-0 flex-wrap">
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 text-xs text-surface-300 hover:text-surface-100 bg-surface-800 border border-surface-600 px-3 py-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <LinkIcon size={12} />
            Copy link
          </button>
          {deliverable.file_url && !isPdf && (
            <a
              href={deliverable.file_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-surface-300 hover:text-surface-100 bg-surface-800 border border-surface-600 px-3 py-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <ExternalLink size={12} />
              Open source
            </a>
          )}
          <div className="flex-1" />
          {unresolvedCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-amber-400">
              <MessageSquare size={12} />
              {unresolvedCount} open{" "}
              {unresolvedCount === 1 ? "thread" : "threads"}
            </span>
          )}
        </div>

        {/* Summary block */}
        <div className="px-6 py-4 border-b border-surface-700 bg-surface-900/50 shrink-0">
          <p className="text-sm text-surface-200 leading-relaxed">
            Review this deliverable and leave feedback in the comments below.
          </p>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          <div className="border-b border-surface-700 bg-surface-900">
            {isPdf ? (
              <div className="h-[420px] flex items-center justify-center">
                {signedUrlLoading ? (
                  <p className="text-surface-400 text-sm">Loading PDF…</p>
                ) : signedUrl ? (
                  <iframe
                    src={signedUrl}
                    className="w-full h-full"
                    title={deliverable.title}
                  />
                ) : (
                  <p className="text-surface-400 text-sm">Unable to load PDF.</p>
                )}
              </div>
            ) : hasUrl ? (
              <div className="h-[420px]">
                <iframe
                  src={embedUrl!}
                  className="w-full h-full"
                  title={deliverable.title}
                  allow="autoplay"
                />
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center">
                <p className="text-surface-400 text-sm">No file attached.</p>
              </div>
            )}
          </div>

          <div className="p-6">
            <CommentThread
              deliverableId={deliverable.id}
              comments={comments}
              loading={commentsLoading}
              isAdmin={isAdmin}
              currentUserId={currentUserId}
              onChanged={onCommentsChanged}
            />
          </div>
        </div>
      </div>
    </>
  );
}
