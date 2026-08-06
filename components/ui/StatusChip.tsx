import { STATUS_TONE, type StatusTone } from '@/lib/status-tone'

// A status pill that cannot be colour-only.
//
// PORTAL-REBRAND-SPEC §4: status colours "always ship with an icon AND a label,
// never color alone". Several of the hand-rolled chips this replaces were a coloured
// dot or a bare tinted pill, which fails for anyone who can't distinguish the hues —
// and the sienna/warning pair is exactly the one that goes on protanopia.
//
// So `label` is required and `icon` is strongly encouraged. Where a caller genuinely
// has no icon the label still carries the meaning, which is the floor.

export interface StatusChipProps {
  tone: StatusTone
  /** Required — the chip must never be colour alone. */
  label: string
  icon?: React.ElementType
  /** Extra classes; keep to layout, not colour. */
  className?: string
  /** Longer explanation, surfaced as a native tooltip. */
  title?: string
}

export default function StatusChip({
  tone,
  label,
  icon: Icon,
  className = '',
  title,
}: StatusChipProps) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${STATUS_TONE[tone].chip} ${className}`}
    >
      {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />}
      {label}
    </span>
  )
}
