"use client";

import { ExternalLink, AlertCircle } from "lucide-react";

type Props = {
  url: string;
  clientName?: string;
  isActive?: boolean;
};

export default function LookerEmbed({ url, clientName, isActive = true }: Props) {
  return (
    <>
      {/* Desktop */}
      <div className="hidden md:flex flex-col w-full h-full">
        <div className="flex items-center justify-between px-4 py-2 bg-surface-900/50 border-b border-surface-700 shrink-0">
          <p className="text-xs text-surface-400">
            <AlertCircle size={11} className="inline mr-1 -mt-0.5" />
            Data may be cached within a 12-hour freshness window.{" "}
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-surface-300 hover:text-surface-100 underline underline-offset-2 transition-colors"
            >
              Open in Looker Studio
            </a>{" "}
            for the latest.
          </p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-surface-300 hover:text-surface-100 bg-surface-800 border border-surface-600 px-3 py-1.5 rounded-lg transition-colors shrink-0 ml-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-400"
          >
            Open in Looker Studio
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
        <div className="flex-1 relative">
          {isActive ? (
            <iframe
              src={url}
              className="w-full h-full border-0"
              allowFullScreen
              title={clientName ? `${clientName} Dashboard` : "Dashboard"}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-900">
              <div className="text-center">
                <div className="w-12 h-12 bg-surface-800 rounded-xl flex items-center justify-center mx-auto mb-3 animate-pulse">
                  <ExternalLink className="w-5 h-5 text-surface-400" />
                </div>
                <p className="text-surface-400 text-sm">Loading dashboard…</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile */}
      <div className="md:hidden p-8">
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 max-w-sm mx-auto text-center">
          <div className="w-12 h-12 bg-brand-900/40 border border-brand-700/50 rounded-xl flex items-center justify-center mx-auto mb-4">
            <ExternalLink className="w-6 h-6 text-brand-400" />
          </div>
          <h3 className="text-surface-100 font-medium mb-1">
            {clientName ? `${clientName} Dashboard` : "Analytics Dashboard"}
          </h3>
          <p className="text-surface-300 text-sm mb-5">
            This dashboard is best viewed on a desktop. You can also open it
            directly in Looker Studio.
          </p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-brand-400 hover:bg-brand-500 text-surface-950 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Open Dashboard
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>
    </>
  );
}
