import Skeleton from "@/components/ui/Skeleton";

export default function DeliverablesLoading() {
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      {/* Header bar */}
      <div className="animate-pulse">
        <div className="h-6 w-36 bg-surface-800 rounded" />
        <div className="mt-2 h-3.5 w-56 bg-surface-800 rounded" />
      </div>
      {/* Filter / toolbar */}
      <div className="flex items-center gap-3 animate-pulse">
        <div className="h-9 w-full max-w-xs bg-surface-800 rounded-lg" />
        <div className="h-9 w-28 bg-surface-800 rounded-lg" />
      </div>
      {/* Deliverable cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Skeleton variant="card" count={6} />
      </div>
    </div>
  );
}
