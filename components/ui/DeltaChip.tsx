import { DELTA_TONE_TEXT, toneFromDirection } from '@/lib/delta-tone'

interface DeltaChipProps {
  direction: "up" | "down" | "flat";
  percent: string;
  absolute?: string;
  /** Which numeric direction is good news (default "up"). Inverted metrics like
   *  Avg Position pass "down" so a numeric decrease renders green. The arrow
   *  always shows the numeric direction; only the color follows goodDirection. */
  goodDirection?: "up" | "down";
  /** Verb copy per numeric direction (default Up/Down) — e.g. Improved/Worsened
   *  for Avg Position, where plain Up/Down would misread. */
  wording?: { up: string; down: string };
}

export default function DeltaChip({
  direction,
  percent,
  absolute,
  goodDirection = "up",
  wording = { up: "Up", down: "Down" },
}: DeltaChipProps) {
  if (direction === "flat") {
    return (
      <span className={`inline-flex items-center gap-1 text-xs ${DELTA_TONE_TEXT.flat}`}>
        <span aria-hidden="true">→</span>
        <span>Flat</span>
        {absolute && <span className="text-surface-400">({absolute})</span>}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${
        DELTA_TONE_TEXT[toneFromDirection(direction, goodDirection)]
      }`}
    >
      <span aria-hidden="true">{direction === "up" ? "↑" : "↓"}</span>
      <span>
        {direction === "up" ? wording.up : wording.down} {percent}
      </span>
      {absolute && <span className="text-surface-400">({absolute})</span>}
    </span>
  );
}
