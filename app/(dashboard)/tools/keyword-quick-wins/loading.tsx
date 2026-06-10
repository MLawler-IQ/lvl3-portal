import Skeleton from "@/components/ui/Skeleton";

export default function KeywordQuickWinsLoading() {
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      {/* Header bar */}
      <div className="flex items-center gap-3 animate-pulse">
        <div className="w-5 h-5 bg-surface-800 rounded" />
        <div>
          <div className="h-6 w-48 bg-surface-800 rounded" />
          <div className="mt-2 h-3.5 w-72 bg-surface-800 rounded" />
        </div>
      </div>
      {/* Table */}
      <Skeleton variant="row" count={10} />
    </div>
  );
}
