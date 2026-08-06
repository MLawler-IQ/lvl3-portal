import DeltaChip from "./DeltaChip";
import Sparkline from "./Sparkline";
import type { TrendPoint } from "@/lib/dashboard/types";

interface KpiCardProps {
  label: string;
  value: string;
  delta?: {
    direction: "up" | "down" | "flat";
    percent: string;
    absolute?: string;
    /** See DeltaChip: pass "down" for inverted metrics (e.g. Avg Position). */
    goodDirection?: "up" | "down";
    wording?: { up: string; down: string };
  };
  tooltip?: string;
  icon?: React.ElementType;
  iconColor?: string;
  /** Optional inline trend rendered beneath the value (numeric series or TrendPoint[]). */
  sparkline?: number[] | TrendPoint[];
}

export default function KpiCard({
  label,
  value,
  delta,
  tooltip,
  icon: Icon,
  sparkline,
}: KpiCardProps) {
  return (
    <div className="bg-surface-900 border border-surface-800 rounded-sm p-5 transition-colors duration-200 hover:bg-surface-850 hover:border-surface-600">
      <div className="flex items-start justify-between mb-2">
        <p
          className="text-3xl font-medium font-serif tabular-nums leading-none text-surface-100"
          style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontVariantNumeric: 'tabular-nums' }}
        >
          {value}
        </p>
        {Icon && <Icon className="w-4 h-4 text-surface-400" />}
      </div>
      <div className="flex items-center gap-1.5 mb-2">
        <p className="text-xs font-medium uppercase tracking-widest text-surface-400">{label}</p>
        {tooltip && (
          <div className="relative group">
            <button
              type="button"
              className="w-4 h-4 rounded-full border border-surface-700 text-surface-400 hover:border-surface-600 hover:text-surface-100 text-[10px] flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              aria-label={`What ${label} measures`}
            >
              ?
            </button>
            {/* Reveals on focus as well as hover — it was group-hover only, so
                keyboard and touch users could never read any of these. Colours
                come from the --chart-tooltip-* tokens; the old markup put a dark
                surface-700 border on a paper background. */}
            <div
              role="tooltip"
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-48 rounded-sm px-3 py-2 text-xs opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none transition-opacity z-10 whitespace-normal"
              style={{
                background: 'var(--chart-tooltip-bg)',
                color: 'var(--chart-tooltip-fg)',
                border: '1px solid var(--chart-tooltip-border)',
              }}
            >
              {tooltip}
            </div>
          </div>
        )}
      </div>
      {delta && (
        <DeltaChip
          direction={delta.direction}
          percent={delta.percent}
          absolute={delta.absolute}
          goodDirection={delta.goodDirection}
          wording={delta.wording}
        />
      )}
      {sparkline && sparkline.length >= 2 && (
        <div className="mt-3 -mb-1">
          <Sparkline data={sparkline} height={36} />
        </div>
      )}
    </div>
  );
}
