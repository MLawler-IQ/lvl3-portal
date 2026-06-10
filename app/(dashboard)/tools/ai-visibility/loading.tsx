import Skeleton from "@/components/ui/Skeleton";

export default function AiVisibilityLoading() {
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      {/* Header bar */}
      <div className="flex items-center gap-3 animate-pulse">
        <div className="w-5 h-5 bg-surface-800 rounded" />
        <div>
          <div className="h-6 w-44 bg-surface-800 rounded" />
          <div className="mt-2 h-3.5 w-72 bg-surface-800 rounded" />
        </div>
      </div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Skeleton variant="kpi" count={4} />
      </div>
      {/* Table */}
      <Skeleton variant="row" count={8} />
    </div>
  );
}
