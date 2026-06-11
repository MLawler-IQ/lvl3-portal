interface DeltaChipProps {
  direction: "up" | "down" | "flat";
  percent: string;
  absolute?: string;
}

export default function DeltaChip({
  direction,
  percent,
  absolute,
}: DeltaChipProps) {
  if (direction === "up") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
        <span aria-hidden="true">↑</span>
        <span>Up {percent}</span>
        {absolute && <span className="text-surface-500">({absolute})</span>}
      </span>
    );
  }
  if (direction === "down") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-rose-500">
        <span aria-hidden="true">↓</span>
        <span>Down {percent}</span>
        {absolute && <span className="text-surface-500">({absolute})</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-surface-400">
      <span aria-hidden="true">→</span>
      <span>Flat</span>
      {absolute && <span className="text-surface-500">({absolute})</span>}
    </span>
  );
}
