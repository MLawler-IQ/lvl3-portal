"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, Grid, List, Search } from "lucide-react";
import type { CommentWithUser } from "@/app/actions/deliverables";
import type { DeliverableWithCounts } from "@/app/(dashboard)/deliverables/page";
import { markViewed, fetchComments, getSignedUrl } from "@/app/actions/deliverables";
import DeliverableCard from "./deliverable-card";
import DeliverableSlideOver from "./deliverable-slide-over";
import AddDeliverableModal from "./add-deliverable-modal";
import { useToast } from "@/components/ui/ToastProvider";

type FilterType = "all" | "new" | "needs-review" | "open-threads" | "resolved";
type SortType = "needs-attention" | "newest" | "oldest";

interface Props {
  initialDeliverables: DeliverableWithCounts[];
  clients: { id: string; name: string }[];
  isAdmin: boolean;
  currentUserId: string;
}

export default function DeliverablesClient({
  initialDeliverables,
  clients,
  isAdmin,
  currentUserId,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [deliverables, setDeliverables] = useState(initialDeliverables);
  const [selected, setSelected] = useState<DeliverableWithCounts | null>(null);
  const [triggerEl, setTriggerEl] = useState<HTMLElement | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [comments, setComments] = useState<CommentWithUser[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [signedUrlLoading, setSignedUrlLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [sortBy, setSortBy] = useState<SortType>("needs-attention");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    setDeliverables(initialDeliverables);
    setSelected((prev) => {
      if (!prev) return null;
      return initialDeliverables.find((d) => d.id === prev.id) ?? prev;
    });
  }, [initialDeliverables]);

  const refreshComments = useCallback(async () => {
    if (!selected) return;
    try {
      const data = await fetchComments(selected.id);
      setComments(data);
    } catch (err) {
      console.error("Failed to refresh comments:", err);
    }
  }, [selected]);

  const filteredAndSorted = useMemo(() => {
    let result = [...deliverables];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((d) => d.title.toLowerCase().includes(q));
    }

    if (activeFilter === "new") {
      result = result.filter((d) => !d.viewed_at);
    } else if (activeFilter === "needs-review" || activeFilter === "open-threads") {
      result = result.filter((d) => d.unresolvedCount > 0);
    } else if (activeFilter === "resolved") {
      result = result.filter((d) => !!d.viewed_at && d.unresolvedCount === 0);
    }

    if (sortBy === "needs-attention") {
      result.sort((a, b) => {
        const aScore = (!a.viewed_at ? 2 : 0) + (a.unresolvedCount > 0 ? 1 : 0);
        const bScore = (!b.viewed_at ? 2 : 0) + (b.unresolvedCount > 0 ? 1 : 0);
        if (bScore !== aScore) return bScore - aScore;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    } else if (sortBy === "newest") {
      result.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    } else {
      result.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    }

    return result;
  }, [deliverables, activeFilter, sortBy, searchQuery]);

  async function handleSelect(
    deliverable: DeliverableWithCounts,
    trigger?: HTMLElement
  ) {
    setSelected(deliverable);
    setTriggerEl(trigger ?? null);
    setComments([]);
    setSignedUrl(null);

    if (!deliverable.viewed_at) {
      setDeliverables((prev) =>
        prev.map((d) =>
          d.id === deliverable.id
            ? { ...d, viewed_at: new Date().toISOString() }
            : d
        )
      );
      markViewed(deliverable.id).catch(console.error);
    }

    setCommentsLoading(true);
    fetchComments(deliverable.id)
      .then(setComments)
      .catch((err) => {
        console.error("Failed to fetch comments:", err);
        toast("Failed to load comments.", "error");
      })
      .finally(() => setCommentsLoading(false));

    if (deliverable.file_type === "pdf" && deliverable.file_url) {
      setSignedUrlLoading(true);
      getSignedUrl(deliverable.file_url)
        .then(setSignedUrl)
        .catch((err) => {
          console.error("Failed to get signed URL:", err);
          toast("Failed to load the PDF preview.", "error");
        })
        .finally(() => setSignedUrlLoading(false));
    }
  }

  function handleClose() {
    setSelected(null);
    triggerEl?.focus();
    setTriggerEl(null);
  }

  const FILTERS: { key: FilterType; label: string }[] = [
    { key: "all", label: "All" },
    { key: "new", label: "New" },
    { key: "needs-review", label: "Needs review" },
    { key: "open-threads", label: "Open threads" },
    { key: "resolved", label: "Resolved" },
  ];

  return (
    <div className="p-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 max-w-7xl mx-auto">
        <div>
          <h1 className="text-xl font-semibold text-surface-100">Deliverables</h1>
          <p className="mt-1 text-surface-300 text-sm">
            {isAdmin ? "Manage and share files with clients" : "Your files and documents"}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-brand-400 hover:bg-brand-500 text-surface-950 px-4 py-2 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-400"
          >
            <Plus size={16} />
            Add Deliverable
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="max-w-7xl mx-auto mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-400 ${
                activeFilter === f.key
                  ? "bg-brand-400 text-surface-950 border-brand-400 font-medium"
                  : "bg-surface-800/50 text-surface-300 border-surface-600/50 hover:text-surface-200 hover:border-surface-500"
              }`}
            >
              {f.label}
            </button>
          ))}
          <div className="flex-1" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortType)}
            className="bg-surface-800 border border-surface-600 text-surface-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-surface-500"
          >
            <option value="needs-attention">Needs attention first</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
          <div className="flex rounded-lg overflow-hidden border border-surface-600">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 transition-colors ${
                viewMode === "grid"
                  ? "bg-surface-700 text-surface-100"
                  : "bg-surface-800/50 text-surface-400 hover:text-surface-200"
              }`}
              aria-label="Grid view"
              aria-pressed={viewMode === "grid"}
            >
              <Grid size={14} />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 transition-colors ${
                viewMode === "list"
                  ? "bg-surface-700 text-surface-100"
                  : "bg-surface-800/50 text-surface-400 hover:text-surface-200"
              }`}
              aria-label="List view"
              aria-pressed={viewMode === "list"}
            >
              <List size={14} />
            </button>
          </div>
        </div>
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none"
          />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search deliverables…"
            className="w-full bg-surface-800 border border-surface-600 rounded-lg pl-9 pr-4 py-2 text-sm text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-surface-500"
          />
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto">
        {filteredAndSorted.length === 0 ? (
          <div className="text-center py-24 text-surface-500">
            {deliverables.length === 0 ? (
              <>
                <p className="text-sm">No deliverables yet.</p>
                {isAdmin && (
                  <p className="text-xs mt-1">
                    Click &ldquo;Add Deliverable&rdquo; to get started.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm">
                No deliverables match these filters.
              </p>
            )}
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAndSorted.map((d) => (
              <DeliverableCard
                key={d.id}
                deliverable={d}
                showClientName={isAdmin}
                isSelected={selected?.id === d.id}
                onClick={handleSelect}
              />
            ))}
          </div>
        ) : (
          <div className="border border-surface-700 rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="border-b border-surface-700">
                  <th className="text-left px-4 py-3 text-xs font-medium text-surface-400 uppercase tracking-wide">
                    Title
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-surface-400 uppercase tracking-wide">
                    Type
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-surface-400 uppercase tracking-wide">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-surface-400 uppercase tracking-wide">
                    Threads
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-surface-400 uppercase tracking-wide">
                    Posted
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSorted.map((d) => (
                  <tr
                    key={d.id}
                    onClick={(e) =>
                      handleSelect(d, e.currentTarget as HTMLElement)
                    }
                    className="border-b border-surface-700 last:border-0 hover:bg-surface-800/30 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 text-sm text-surface-100 font-medium">
                      {d.title}
                    </td>
                    <td className="px-4 py-3 text-xs text-surface-300 uppercase">
                      {d.file_type}
                    </td>
                    <td className="px-4 py-3">
                      {!d.viewed_at ? (
                        <span className="text-xs bg-brand-400/10 text-brand-400 border border-brand-400/20 px-2 py-0.5 rounded-full">
                          New
                        </span>
                      ) : d.unresolvedCount > 0 ? (
                        <span className="text-xs bg-amber-500/15 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
                          Open threads
                        </span>
                      ) : (
                        <span className="text-xs text-surface-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {d.unresolvedCount > 0 ? (
                        <span className="text-amber-400">
                          {d.unresolvedCount} open
                        </span>
                      ) : d.totalCommentCount > 0 ? (
                        <span className="text-surface-300">
                          {d.totalCommentCount} total
                        </span>
                      ) : (
                        <span className="text-surface-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-surface-400">
                      {new Date(d.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <DeliverableSlideOver
          deliverable={selected}
          signedUrl={signedUrl}
          signedUrlLoading={signedUrlLoading}
          comments={comments}
          commentsLoading={commentsLoading}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          onClose={handleClose}
          onCommentsChanged={refreshComments}
        />
      )}

      {isModalOpen && (
        <AddDeliverableModal
          clients={clients}
          onClose={() => {
            setIsModalOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
