"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowRight, Home, FolderKanban, LayoutDashboard, PackageOpen, Lightbulb, Sparkles } from "lucide-react";
import { TOOLS } from "@/lib/tools/registry";

interface Result {
  id: string;
  label: string;
  sublabel?: string;
  category: string;
  href: string;
  icon?: React.ElementType;
}

const TOOL_RESULTS: Result[] = TOOLS.map((t) => ({
  id: `tool-${t.slug}`,
  label: t.name,
  sublabel: t.description.length > 55 ? t.description.slice(0, 55) + "…" : t.description,
  category: "Tools",
  href: t.route,
  icon: t.icon,
}));

const QUICK_ACTIONS: Result[] = [
  { id: "qa-home", label: "Go to Home", category: "Navigation", href: "/", icon: Home },
  { id: "qa-dashboard", label: "Go to Dashboard", category: "Navigation", href: "/dashboard", icon: LayoutDashboard },
  { id: "qa-deliverables", label: "Go to Deliverables", category: "Navigation", href: "/deliverables", icon: PackageOpen },
  { id: "qa-projects", label: "Go to Projects", category: "Navigation", href: "/projects", icon: FolderKanban },
  { id: "qa-insights", label: "Go to Insights", category: "Navigation", href: "/insights", icon: Lightbulb },
  { id: "qa-services", label: "Go to Services", category: "Navigation", href: "/services", icon: Sparkles },
];

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])';

interface Props {
  selectedClientId: string | null;
  onClose: () => void;
}

export default function CommandPalette({ onClose }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>(QUICK_ACTIONS);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.toLowerCase().trim();
    if (!q) {
      setResults(QUICK_ACTIONS);
      setActiveIndex(0);
      return;
    }

    const navResults = QUICK_ACTIONS.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q)
    );

    const toolResults = TOOL_RESULTS.filter((r) => {
      const tool = TOOLS.find((t) => t.slug === r.id.replace("tool-", ""));
      if (!tool) return false;
      return (
        tool.name.toLowerCase().includes(q) ||
        tool.description.toLowerCase().includes(q) ||
        tool.tags.some((tag) => tag.toLowerCase().includes(q)) ||
        tool.category.toLowerCase().includes(q)
      );
    });

    setResults([...navResults, ...toolResults]);
    setActiveIndex(0);
  }, [query]);

  const handleSelect = useCallback(
    (result: Result) => {
      router.push(result.href);
      onClose();
    },
    [router, onClose]
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const selected = results[activeIndex];
        if (selected) handleSelect(selected);
      }
      if (e.key === "Tab") {
        const panel = panelRef.current;
        if (!panel) return;
        const els = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
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
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [results, activeIndex, handleSelect, onClose]);

  const grouped: Record<string, Result[]> = {};
  for (const r of results) {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push(r);
  }

  let globalIndex = 0;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/70 z-50 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg z-50 animate-slide-in-up"
      >
        <div className="bg-surface-900 border border-surface-700 rounded-sm overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-700">
            <Search size={16} className="text-surface-400 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pages and tools…"
              className="flex-1 bg-transparent text-surface-100 placeholder-surface-400 text-sm rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              aria-label="Search"
            />
            <kbd className="text-[10px] text-surface-400 bg-surface-800 border border-surface-600 rounded px-1.5 py-0.5">
              esc
            </kbd>
          </div>

          <div className="max-h-80 overflow-y-auto py-2">
            {results.length === 0 ? (
              <p className="text-sm text-surface-400 text-center py-8">
                No results for &ldquo;{query}&rdquo;
              </p>
            ) : (
              Object.entries(grouped).map(([category, items]) => (
                <div key={category}>
                  <p className="px-4 py-1.5 text-[10px] font-medium uppercase tracking-widest text-surface-400">
                    {category}
                  </p>
                  {items.map((item) => {
                    const idx = globalIndex++;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelect(item)}
                        className={`flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400 ${
                          idx === activeIndex
                            ? "bg-surface-800 text-surface-100"
                            : "text-surface-200 hover:bg-surface-800/50"
                        }`}
                      >
                        {Icon && (
                          <Icon
                            size={15}
                            className="shrink-0 text-surface-400"
                          />
                        )}
                        <span className="flex-1 text-left truncate">
                          {item.label}
                        </span>
                        {item.sublabel && (
                          <span className="text-xs text-surface-400 shrink-0">
                            {item.sublabel}
                          </span>
                        )}
                        <ArrowRight
                          size={13}
                          className="text-surface-400 shrink-0"
                        />
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="border-t border-surface-700 px-4 py-2 flex items-center gap-4 text-[10px] text-surface-400">
            <span>
              <kbd className="bg-surface-800 border border-surface-600 rounded px-1 py-0.5">↑↓</kbd>{" "}
              navigate
            </span>
            <span>
              <kbd className="bg-surface-800 border border-surface-600 rounded px-1 py-0.5">↵</kbd>{" "}
              select
            </span>
            <span>
              <kbd className="bg-surface-800 border border-surface-600 rounded px-1 py-0.5">esc</kbd>{" "}
              close
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
