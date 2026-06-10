import Skeleton from "@/components/ui/Skeleton";

export default function InsightsLoading() {
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      {/* Header bar */}
      <div className="animate-pulse">
        <div className="h-6 w-28 bg-surface-800 rounded" />
        <div className="mt-2 h-3.5 w-48 bg-surface-800 rounded" />
      </div>
      {/* Analytics insights section */}
      <section className="space-y-3">
        <div className="h-3 w-36 bg-surface-800 rounded animate-pulse" />
        <Skeleton variant="card" />
      </section>
      {/* Featured post */}
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 animate-pulse">
        <div className="h-5 w-2/3 bg-surface-800 rounded mb-4" />
        <div className="space-y-2 mb-4">
          <div className="h-3 w-full bg-surface-800 rounded" />
          <div className="h-3 w-5/6 bg-surface-800 rounded" />
          <div className="h-3 w-3/4 bg-surface-800 rounded" />
        </div>
        <div className="h-3 w-24 bg-surface-800 rounded" />
      </div>
      {/* Post list */}
      <div className="space-y-3">
        <Skeleton variant="card" count={3} />
      </div>
    </div>
  );
}
