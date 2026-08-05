"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { syncSheet, SheetRow } from "@/app/actions/projects";
import {
  applyFilters,
  groupByMonth,
  sortGroups,
  groupByCategory,
  sortRows,
  getMinutesSince,
} from "./project-helpers";
import TaskTable from "./task-table";
import HeroCard from "./hero-card";
import FiltersBar from "./filters-bar";
import CollapsibleSection from "./collapsible-section";
import NarrativeCard from "@/components/ui/NarrativeCard";

type Props = {
  rows: SheetRow[];
  fetchedAt: string;
  isAdmin: boolean;
  sheetId: string;
  clientId: string;
  aiSummary?: string | null;
};

export default function ProjectsView({
  rows,
  fetchedAt,
  clientId,
  aiSummary,
}: Props) {
  const [syncing, setSyncing] = useState(false);
  const [viewMode, setViewMode] = useState<"month" | "category" | "all">(
    "month"
  );
  const [activeStatuses, setActiveStatuses] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [sortConfig, setSortConfig] = useState<{
    col: string;
    dir: "asc" | "desc";
  } | null>(null);
  const [heroFilter, setHeroFilter] = useState<Set<string>>(new Set());

  const allGroups = sortGroups(groupByMonth(rows));
  const heroGroup = allGroups[0] ?? null;
  const accordionGroups = allGroups.slice(1);
  const filteredRows = applyFilters(rows, activeStatuses, activeCategory);
  const heroFilteredRows = heroGroup
    ? applyFilters(heroGroup.rows, activeStatuses, activeCategory)
    : [];
  const categoryGroups =
    viewMode === "category" ? groupByCategory(filteredRows) : [];
  const flatRows =
    viewMode === "all" ? sortRows(filteredRows, sortConfig) : [];

  const minutesAgo = getMinutesSince(fetchedAt);

  // Status breakdown
  const statusCounts: { label: string; color: string; count: number }[] = [
    { label: "Completed", color: "text-accent-400", count: rows.filter((r) => r.status === "Completed").length },
    { label: "In Progress", color: "text-brand-400", count: rows.filter((r) => r.status === "In Progress").length },
    { label: "Blocked", color: "text-amber-400", count: rows.filter((r) => r.status === "Blocked").length },
    { label: "Not Started", color: "text-surface-400", count: rows.filter((r) => !["Completed", "In Progress", "Blocked"].includes(r.status)).length },
  ].filter((s) => s.count > 0);

  const blockedCount = rows.filter((r) => r.status === "Blocked").length;

  // This month stats (heroGroup is the most recent month)
  const thisMonthRows = heroGroup?.rows ?? [];
  const thisMonthCompleted = thisMonthRows.filter((r) => r.status === "Completed").length;
  const thisMonthBlocked = thisMonthRows.filter((r) => r.status === "Blocked").length;

  // Fees by category
  const feesByCategory = Object.entries(
    rows.reduce<Record<string, number>>((acc, r) => {
      if (r.fee == null) return acc;
      const cat = r.category || "Other";
      acc[cat] = (acc[cat] ?? 0) + r.fee;
      return acc;
    }, {})
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const hasFees = feesByCategory.length > 0;

  function formatFee(n: number) {
    return n >= 1000
      ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
      : `$${n}`;
  }

  function handleToggleStatus(status: string) {
    setActiveStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  function handleHeroFilterToggle(status: string) {
    setHeroFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  function handleSort(col: string) {
    setSortConfig((prev) =>
      prev?.col === col
        ? { col, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { col, dir: "asc" }
    );
  }

  async function handleSync() {
    setSyncing(true);
    try {
      await syncSheet(clientId);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* This month's focus narrative */}
      {aiSummary && (
        <NarrativeCard
          title="This month's focus"
          body={aiSummary}
          maxChars={280}
        />
      )}
      {!aiSummary && (
        <div className="bg-surface-900/50 border border-surface-700 rounded-xl px-5 py-3">
          <p className="text-sm text-surface-400 italic">
            Sync the project sheet to generate a summary.
          </p>
        </div>
      )}

      {/* Waiting on you callout */}
      {blockedCount > 0 && (
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
          <span className="text-amber-400 font-semibold text-sm">
            {blockedCount}
          </span>
          <p className="text-sm text-amber-300">
            {blockedCount === 1 ? "item" : "items"} may need your input
          </p>
        </div>
      )}

      {/* Project status card */}
      <div className="bg-surface-900 border border-surface-700 rounded-xl overflow-hidden">
        {/* Card header with sync */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-700">
          <span className="text-xs font-medium uppercase tracking-widest text-surface-400">
            Project Status
          </span>
          <div className="flex items-center gap-3">
            <span
              className={`text-xs px-2 py-0.5 rounded-full border ${
                minutesAgo < 5
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  : "bg-surface-800 border-surface-600 text-surface-400"
              }`}
            >
              {minutesAgo === 0
                ? "just synced"
                : minutesAgo === 1
                ? "1 min ago"
                : `${minutesAgo}m ago`}
            </span>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-100 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Sync Now"}
            </button>
          </div>
        </div>

        {/* 3-column stats */}
        <div className={`grid divide-surface-700 ${hasFees ? "grid-cols-3 divide-x" : "grid-cols-2 divide-x"}`}>
          {/* This month */}
          <div className="px-5 py-4">
            <p className="text-[10px] font-medium uppercase tracking-widest text-surface-400 mb-3">
              This Month
            </p>
            {heroGroup ? (
              <>
                <p className="text-xs text-surface-400 mb-1">{heroGroup.month}</p>
                <p className="text-2xl font-semibold text-surface-100 tabular-nums">
                  {thisMonthCompleted}
                  <span className="text-sm font-normal text-surface-400">
                    /{thisMonthRows.length}
                  </span>
                </p>
                <p className="text-xs text-surface-400 mt-0.5">tasks done</p>
                {thisMonthBlocked > 0 && (
                  <p className="text-xs text-amber-400 mt-2">
                    {thisMonthBlocked} blocked
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-surface-400 italic">No data</p>
            )}
          </div>

          {/* Status breakdown */}
          <div className="px-5 py-4">
            <p className="text-[10px] font-medium uppercase tracking-widest text-surface-400 mb-3">
              All Tasks
            </p>
            <div className="space-y-1.5">
              {statusCounts.map((s) => (
                <div key={s.label} className="flex items-center justify-between gap-4">
                  <span className={`text-xs ${s.color}`}>{s.label}</span>
                  <span className="text-xs font-medium text-surface-300 tabular-nums">{s.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Fees by category */}
          {hasFees && (
            <div className="px-5 py-4">
              <p className="text-[10px] font-medium uppercase tracking-widest text-surface-400 mb-3">
                Fees by Category
              </p>
              <div className="space-y-1.5">
                {feesByCategory.map(([cat, total]) => (
                  <div key={cat} className="flex items-center justify-between gap-4">
                    <span className="text-xs text-surface-400 truncate">{cat}</span>
                    <span className="text-xs font-medium text-surface-300 tabular-nums shrink-0">
                      {formatFee(total)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <FiltersBar
        allRows={rows}
        activeStatuses={activeStatuses}
        onToggleStatus={handleToggleStatus}
        onClearStatuses={() => setActiveStatuses(new Set())}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {heroGroup && viewMode !== "all" && (
        <HeroCard
          group={heroGroup}
          heroFilter={heroFilter}
          onHeroFilterToggle={handleHeroFilterToggle}
          globalFilteredRows={heroFilteredRows}
        />
      )}

      {viewMode === "month" && (
        <div className="space-y-3">
          {accordionGroups.map((group) => {
            const filteredGroupRows = applyFilters(
              group.rows,
              activeStatuses,
              activeCategory
            );
            return (
              <CollapsibleSection
                key={group.month}
                label={group.month}
                rows={filteredGroupRows}
                allRows={group.rows}
              />
            );
          })}
        </div>
      )}

      {viewMode === "category" && (
        <div className="space-y-3">
          {categoryGroups.map((g) => {
            const allCategoryRows = rows.filter(
              (r) => (r.category || "(Uncategorized)") === g.category
            );
            return (
              <CollapsibleSection
                key={g.category}
                label={g.category}
                rows={g.rows}
                allRows={allCategoryRows}
              />
            );
          })}
        </div>
      )}

      {viewMode === "all" && (
        <div className="border border-surface-700 rounded-lg overflow-hidden overflow-x-auto">
          <TaskTable
            rows={flatRows}
            showMonth
            sortConfig={sortConfig}
            onSort={handleSort}
          />
        </div>
      )}

    </div>
  );
}
