"use client";

import { useState } from "react";
import { ChevronRight, Send } from "lucide-react";
import { postComment, resolveComment } from "@/app/actions/deliverables";
import type { CommentWithUser } from "@/app/actions/deliverables";
import { useToast } from "@/components/ui/ToastProvider";

type ThreadedComment = CommentWithUser & { replies: CommentWithUser[] };

function groupComments(comments: CommentWithUser[]): ThreadedComment[] {
  const topLevel = comments.filter((c) => !c.parent_id);
  return topLevel.map((c) => ({
    ...c,
    replies: comments.filter((r) => r.parent_id === c.id),
  }));
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function CommentInput({
  placeholder = "Write a comment…",
  onSubmit,
  prefixTemplate,
}: {
  placeholder?: string;
  onSubmit: (body: string) => Promise<void>;
  prefixTemplate?: string;
}) {
  const [body, setBody] = useState(prefixTemplate ?? "");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setLoading(true);
    try {
      await onSubmit(body.trim());
      setBody("");
    } catch (err) {
      console.error("Failed to post comment:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        disabled={loading}
        className="flex-1 bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-sm text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-surface-500 disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={!body.trim() || loading}
        className="p-2 bg-brand-400 hover:bg-brand-500 text-surface-950 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-400"
        aria-label="Submit comment"
      >
        <Send size={14} />
      </button>
    </form>
  );
}

function Thread({
  thread,
  deliverableId,
  onChanged,
}: {
  thread: ThreadedComment;
  deliverableId: string;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(!thread.resolved);
  const [showReply, setShowReply] = useState(false);
  const [showRequestChanges, setShowRequestChanges] = useState(false);
  const [resolving, setResolving] = useState(false);

  async function handleReply(body: string) {
    await postComment(deliverableId, body, thread.id);
    setShowReply(false);
    onChanged();
  }

  async function handleRequestChanges(body: string) {
    await postComment(deliverableId, `[Request changes] ${body}`, thread.id);
    setShowRequestChanges(false);
    onChanged();
  }

  async function handleResolve() {
    setResolving(true);
    const nextResolved = !thread.resolved;
    try {
      await resolveComment(thread.id, nextResolved);
      onChanged();
      if (nextResolved) {
        toast("Thread resolved.", "success", {
          duration: 5000,
          onUndo: async () => {
            await resolveComment(thread.id, false);
            onChanged();
          },
        });
      }
    } catch (err) {
      console.error("Failed to resolve:", err);
      toast("Failed to update thread.", "error");
    } finally {
      setResolving(false);
    }
  }

  function handleCopyLink() {
    const url = `${window.location.origin}/deliverables#comment-${thread.id}`;
    navigator.clipboard.writeText(url).catch(console.error);
  }

  if (thread.resolved && !expanded) {
    return (
      <div className="border border-surface-700 rounded-lg px-4 py-2.5">
        <button
          onClick={() => setExpanded(true)}
          className="flex items-center gap-2 text-xs text-surface-400 hover:text-surface-200 w-full text-left transition-colors"
        >
          <ChevronRight size={13} className="shrink-0" />
          <span className="truncate">Resolved: {thread.body}</span>
          {thread.replies.length > 0 && (
            <span className="shrink-0 ml-auto text-surface-500">
              {thread.replies.length}{" "}
              {thread.replies.length === 1 ? "reply" : "replies"}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      id={`comment-${thread.id}`}
      className={`border rounded-xl p-4 space-y-3 ${
        thread.resolved ? "border-surface-600 opacity-75" : "border-surface-700"
      }`}
    >
      <div>
        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-medium text-surface-200 truncate">
              {thread.users.email}
            </span>
            <span className="text-xs text-surface-500 shrink-0">
              {formatDate(thread.created_at)}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {thread.resolved && (
              <button
                onClick={() => setExpanded(false)}
                className="text-xs text-surface-500 hover:text-surface-300 transition-colors"
              >
                Collapse
              </button>
            )}
            <button
              onClick={handleCopyLink}
              className="text-xs text-surface-500 hover:text-surface-300 transition-colors"
              aria-label="Copy link to thread"
            >
              #
            </button>
            <button
              onClick={handleResolve}
              disabled={resolving}
              className={`text-xs px-2 py-0.5 rounded-full border transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-surface-500 ${
                thread.resolved
                  ? "border-surface-500 text-surface-300 hover:border-surface-400 hover:text-surface-200"
                  : "border-accent-700 text-accent-500 hover:bg-accent-500/10"
              }`}
            >
              {thread.resolved ? "Unresolve" : "Resolve"}
            </button>
          </div>
        </div>
        <p className="text-sm text-surface-200 leading-relaxed">{thread.body}</p>
      </div>

      {thread.replies.length > 0 && (
        <div className="ml-3 pl-3 border-l border-surface-700 space-y-3">
          {thread.replies.map((reply) => (
            <div key={reply.id}>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium text-surface-200">
                  {reply.users.email}
                </span>
                <span className="text-xs text-surface-500">
                  {formatDate(reply.created_at)}
                </span>
              </div>
              <p className="text-sm text-surface-200 leading-relaxed">{reply.body}</p>
            </div>
          ))}
        </div>
      )}

      {!thread.resolved && (
        <div className="space-y-2">
          {showRequestChanges ? (
            <div>
              <p className="text-xs text-surface-400 mb-1.5">What should change?</p>
              <CommentInput
                placeholder="Describe the requested change…"
                onSubmit={handleRequestChanges}
              />
            </div>
          ) : showReply ? (
            <CommentInput placeholder="Write a reply…" onSubmit={handleReply} />
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowReply(true)}
                className="text-xs text-surface-400 hover:text-surface-200 transition-colors"
              >
                Reply
              </button>
              <button
                onClick={() => setShowRequestChanges(true)}
                className="text-xs text-surface-400 hover:text-amber-400 transition-colors"
              >
                Request changes
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  deliverableId: string;
  comments: CommentWithUser[];
  loading: boolean;
  isAdmin: boolean;
  currentUserId: string;
  onChanged: () => void;
}

export default function CommentThread({
  deliverableId,
  comments,
  loading,
  onChanged,
}: Props) {
  const [showResolved, setShowResolved] = useState(false);

  const threads = groupComments(comments);
  const visibleThreads = showResolved
    ? threads
    : threads.filter((t) => !t.resolved);
  const resolvedCount = threads.filter((t) => t.resolved).length;

  async function handleNewComment(body: string) {
    await postComment(deliverableId, body);
    onChanged();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-surface-100 font-semibold text-sm">
          Comments{" "}
          {!loading && comments.length > 0 && (
            <span className="text-surface-400 font-normal">({comments.length})</span>
          )}
        </h3>
        {!loading && resolvedCount > 0 && (
          <button
            onClick={() => setShowResolved(!showResolved)}
            className="text-xs text-surface-400 hover:text-surface-200 transition-colors"
          >
            {showResolved
              ? "Hide resolved"
              : `Show resolved (${resolvedCount})`}
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-surface-400 text-sm">Loading comments…</p>
      ) : visibleThreads.length === 0 ? (
        <p className="text-surface-500 text-sm">
          {threads.length === 0
            ? "No comments yet. Be the first to leave one."
            : "No unresolved threads."}
        </p>
      ) : (
        <div className="space-y-3">
          {visibleThreads.map((thread) => (
            <Thread
              key={thread.id}
              thread={thread}
              deliverableId={deliverableId}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}

      <div className="pt-1">
        <CommentInput onSubmit={handleNewComment} />
      </div>
    </div>
  );
}
