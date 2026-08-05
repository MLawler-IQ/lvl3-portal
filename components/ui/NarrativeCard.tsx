"use client";

import { useState } from "react";

interface NarrativeCardProps {
  title: string;
  body: string;
  maxChars?: number;
  footer?: React.ReactNode;
}

export default function NarrativeCard({
  title,
  body,
  maxChars = 280,
  footer,
}: NarrativeCardProps) {
  const [expanded, setExpanded] = useState(false);
  const shouldTruncate = body.length > maxChars;
  const displayBody =
    shouldTruncate && !expanded
      ? body.slice(0, maxChars).trimEnd() + "…"
      : body;

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <p className="text-sm font-semibold text-surface-100 mb-2">{title}</p>
      <p className="text-sm text-surface-200 leading-relaxed whitespace-pre-wrap">
        {displayBody}
      </p>
      {shouldTruncate && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-xs text-surface-400 hover:text-surface-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}
