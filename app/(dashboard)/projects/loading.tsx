import Skeleton from "@/components/ui/Skeleton";

export default function ProjectsLoading() {
  return (
    <div className="p-6 space-y-4">
      {/* Header bar */}
      <div className="animate-pulse">
        <div className="h-6 w-28 bg-surface-800 rounded" />
        <div className="mt-2 h-3.5 w-44 bg-surface-800 rounded" />
      </div>
      {/* Toolbar */}
      <div className="flex items-center gap-3 animate-pulse">
        <div className="h-9 w-full max-w-xs bg-surface-800 rounded-lg" />
        <div className="h-9 w-24 bg-surface-800 rounded-lg" />
        <div className="h-9 w-24 bg-surface-800 rounded-lg" />
      </div>
      {/* Task rows */}
      <Skeleton variant="row" count={10} />
    </div>
  );
}
