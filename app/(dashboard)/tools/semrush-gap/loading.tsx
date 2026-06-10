import Skeleton from "@/components/ui/Skeleton";

export default function SemrushGapLoading() {
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      {/* Header bar */}
      <div className="flex items-center gap-3 animate-pulse">
        <div className="w-5 h-5 bg-surface-800 rounded" />
        <div>
          <div className="h-6 w-56 bg-surface-800 rounded" />
          <div className="mt-2 h-3.5 w-72 bg-surface-800 rounded" />
        </div>
      </div>
      {/* Form / input area */}
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 animate-pulse space-y-3">
        <div className="h-9 w-full max-w-md bg-surface-800 rounded-lg" />
        <div className="h-9 w-28 bg-surface-800 rounded-lg" />
      </div>
      {/* Table */}
      <Skeleton variant="row" count={8} />
    </div>
  );
}
