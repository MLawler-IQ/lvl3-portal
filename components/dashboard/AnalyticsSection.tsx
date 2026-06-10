import { fetchAnalyticsData, fetchDashboardReport, type AnalyticsData, type DashboardReport, type SnapshotInsights } from "@/app/actions/analytics";
import { BarChart2 } from "lucide-react";
import DashboardTabs from "@/app/(dashboard)/dashboard/DashboardTabs";

type AnalyticsSectionProps = {
  clientId: string;
  clientName: string;
  lookerUrl: string | null;
  isAdmin: boolean;
  period: string;
  compare: string;
  snapshotInsights: SnapshotInsights | null;
  snapshotUpdatedAt: string | null;
};

/**
 * Async server component that performs the slow GA4/GSC analytics fetches.
 * Rendered inside <Suspense> from the dashboard page so the shell paints
 * immediately while data streams in.
 */
export default async function AnalyticsSection({
  clientId,
  clientName,
  lookerUrl,
  isAdmin,
  period,
  compare,
  snapshotInsights,
  snapshotUpdatedAt,
}: AnalyticsSectionProps) {
  // Fetch analytics data (returns null fields if not configured)
  let analyticsData: AnalyticsData = { ga4: null, gsc: null };
  try {
    analyticsData = await fetchAnalyticsData(clientId, { period, compare });
  } catch {
    // Non-fatal — dashboard still renders without analytics
  }

  let dashboardReport: DashboardReport = { ga4: null, gsc: null };
  try {
    dashboardReport = await fetchDashboardReport(clientId, { period, compare });
  } catch {
    // Non-fatal
  }

  const hasAnalytics = analyticsData.ga4 !== null || analyticsData.gsc !== null;

  if (!lookerUrl && !hasAnalytics) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center p-8">
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-8 max-w-md">
          <BarChart2 className="w-10 h-10 text-surface-500 mb-3 mx-auto" />
          <h3 className="text-surface-100 font-semibold mb-2">Dashboard Coming Soon</h3>
          <p className="text-surface-400 text-sm">
            Your dashboard is being set up — check back soon.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      <div className="px-6 py-4 border-b border-surface-700 shrink-0">
        <h1 className="text-xl font-semibold text-surface-100">Dashboard</h1>
        <p className="mt-1 text-surface-400 text-sm">{clientName}</p>
      </div>
      <div className="flex-1 overflow-hidden">
        <DashboardTabs
          lookerUrl={lookerUrl}
          clientName={clientName}
          isAdmin={isAdmin}
          analyticsData={analyticsData}
          snapshotInsights={snapshotInsights}
          snapshotUpdatedAt={snapshotUpdatedAt}
          clientId={clientId}
          dashboardReport={dashboardReport}
        />
      </div>
    </div>
  );
}
