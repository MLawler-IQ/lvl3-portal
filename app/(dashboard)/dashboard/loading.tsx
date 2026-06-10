import Skeleton from "@/components/ui/Skeleton";

export default function DashboardLoading() {
  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header bar */}
      <div className="px-6 py-4 border-b border-surface-700 shrink-0 animate-pulse">
        <div className="h-6 w-32 bg-surface-800 rounded" />
        <div className="mt-2 h-3.5 w-44 bg-surface-800 rounded" />
      </div>
      <div className="flex-1 overflow-hidden p-6 space-y-6">
        {/* Tab strip */}
        <div className="flex items-center gap-2 animate-pulse">
          <div className="h-8 w-24 bg-surface-800 rounded-lg" />
          <div className="h-8 w-24 bg-surface-800 rounded-lg" />
          <div className="h-8 w-24 bg-surface-800 rounded-lg" />
        </div>
        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Skeleton variant="kpi" count={4} />
        </div>
        {/* Chart area */}
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 animate-pulse">
          <div className="h-4 w-40 bg-surface-800 rounded mb-4" />
          <div className="h-64 w-full bg-surface-800 rounded" />
        </div>
      </div>
    </div>
  );
}
