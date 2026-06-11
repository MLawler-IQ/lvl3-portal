import { fetchAnalyticsData, fetchDashboardReport, type AnalyticsData, type DashboardReport, type SnapshotInsights } from "@/app/actions/analytics";
import { getGA4TrendData, getGA4EcomFunnelData, getGA4TopProductsData } from "@/app/actions/dashboard-ga4";
import { getGSCTrendAction, getGSCBrandedSplitAction, getGSCIntentSplitAction } from "@/app/actions/dashboard-gsc";
import { getConvertingPagesData, getContentPerformanceData } from "@/app/actions/dashboard-leadgen";
import { getCompetitiveData } from "@/app/actions/dashboard-competitive";
import { get13MonthTable, type MetricTableRow } from "@/app/actions/dashboard-metrics-table";
import { listAnnotations, type Annotation } from "@/app/actions/annotations";
import { fetchDashboardGBP, type DashboardGBPData } from "@/app/actions/dashboard-gbp";
import { defaultModulesForType } from "@/lib/dashboard/registry";
import { computePacing, monthElapsedFraction, type PacingRow } from "@/lib/dashboard/pacing";
import { deriveAlerts, type AlertInput } from "@/lib/dashboard/alerts";
import { pickGranularity } from "@/lib/date-range";
import type { ClientType, DashboardModuleId, Granularity, TrendPoint, Targets, DashboardAlert } from "@/lib/dashboard/types";
import type { ExecutiveSummaryBandProps, ExecKpi, HealthItem, ActivityItem } from "@/components/dashboard/exec/ExecutiveSummaryBand";
import { createClient } from "@/lib/supabase/server";
import { BarChart2 } from "lucide-react";
import DashboardTabs from "@/app/(dashboard)/dashboard/DashboardTabs";

type AnalyticsSectionProps = {
  clientId: string;
  clientName: string;
  lookerUrl: string | null;
  isAdmin: boolean;
  period: string;
  compare: string;
  clientType: string | null;
  targets: Targets | null;
  snapshotInsights: SnapshotInsights | null;
  snapshotUpdatedAt: string | null;
};

const fmtInt = (n: number) => Math.round(n).toLocaleString();
const fmtCurrency = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Pacing uses snake_case metric ids (TARGET_METRIC_IDS); the alert engine keys
// chartRef/labels by the camelCase AlertMetrics keys. Bridge them so goal-miss
// alerts deep-link and label correctly.
const PACING_TO_ALERT_KEY: Record<string, string> = {
  sessions: "sessions",
  organic_clicks: "organicClicks",
  conversions: "conversions",
  revenue: "revenue",
  gbp_calls: "gbpCalls",
};

/** Recent deliverables for the exec-band activity feed. Best-effort; empty on any failure. */
async function fetchActivity(clientId: string): Promise<ActivityItem[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("deliverables")
      .select("title, type, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(5);
    return (data ?? []).map((d) => ({
      title: d.title as string,
      date: d.created_at as string,
      type: (d.type as string) ?? "Deliverable",
    }));
  } catch {
    return [];
  }
}

/**
 * Async server component that performs the slow GA4/GSC/GBP analytics fetches
 * and assembles the type-aware dashboard. Rendered inside <Suspense> from the
 * dashboard page so the shell paints immediately while data streams in.
 */
export default async function AnalyticsSection({
  clientId,
  clientName,
  lookerUrl,
  isAdmin,
  period,
  compare,
  clientType,
  targets,
  snapshotInsights,
  snapshotUpdatedAt,
}: AnalyticsSectionProps) {
  const type = (clientType as ClientType | null) ?? null;
  const modules: DashboardModuleId[] = defaultModulesForType(type);
  const showGbp = modules.includes("gbp_overview");
  const trendGranularity: Granularity = pickGranularity(period);

  // Core KPI fetches (existing behaviour; null fields if not configured).
  let analyticsData: AnalyticsData = { ga4: null, gsc: null };
  let dashboardReport: DashboardReport = { ga4: null, gsc: null };
  const [coreAnalytics, coreReport] = await Promise.allSettled([
    fetchAnalyticsData(clientId, { period, compare }),
    fetchDashboardReport(clientId, { period, compare }),
  ]);
  if (coreAnalytics.status === "fulfilled") analyticsData = coreAnalytics.value;
  if (coreReport.status === "fulfilled") dashboardReport = coreReport.value;

  // New period-aware trends + GBP + activity, fetched in parallel (all non-fatal).
  const [trendRes, gscTrendRes, gbpRes, activity] = await Promise.allSettled([
    getGA4TrendData({ period, compare }),
    getGSCTrendAction({ period, compare }),
    showGbp ? fetchDashboardGBP(clientId, { period, compare }) : Promise.resolve(null),
    fetchActivity(clientId),
  ]).then((rs) => [
    rs[0].status === "fulfilled" ? rs[0].value : null,
    rs[1].status === "fulfilled" ? rs[1].value : null,
    rs[2].status === "fulfilled" ? rs[2].value : null,
    rs[3].status === "fulfilled" ? rs[3].value : [],
  ] as const);

  const sessionsTrend: TrendPoint[] =
    trendRes && trendRes.configured ? trendRes.points : [];
  const clicksTrend: TrendPoint[] = Array.isArray(gscTrendRes) ? gscTrendRes : [];
  const gbp: DashboardGBPData | null = (gbpRes as DashboardGBPData | null) ?? null;
  const activityItems: ActivityItem[] = Array.isArray(activity) ? activity : [];

  const ga4 = analyticsData.ga4;
  const gsc = analyticsData.gsc;
  const hasAnalytics = ga4 !== null || gsc !== null;

  // ── Phase B: type-specific module data (gated on the client's module set) ──
  const wants = (id: DashboardModuleId) => modules.includes(id);
  const safe = async <T,>(p: Promise<T> | null): Promise<T | null> => {
    if (!p) return null;
    try { return await p; } catch { return null; }
  };
  const [ecomFunnelRes, topProductsRes, brandedRes, intentRes, convRes, contentRes, compRes] =
    await Promise.all([
      safe(wants("ecom_funnel") ? getGA4EcomFunnelData({ period, compare }) : null),
      safe(wants("top_products") ? getGA4TopProductsData({ period, compare }) : null),
      safe(wants("branded_split") ? getGSCBrandedSplitAction({ period, compare }) : null),
      safe(wants("branded_split") ? getGSCIntentSplitAction({ period, compare }) : null),
      safe(wants("converting_pages") ? getConvertingPagesData({ period, compare }) : null),
      safe(wants("content_performance") ? getContentPerformanceData({ period, compare }) : null),
      safe(wants("competitive") ? getCompetitiveData() : null),
    ]);

  const moduleData = {
    ecomFunnel: ecomFunnelRes?.funnel ?? null,
    topProducts: topProductsRes?.products ?? [],
    branded: brandedRes ?? null,
    intent: intentRes ?? null,
    convertingPages: convRes?.rows ?? [],
    contentPerformance: contentRes?.rows ?? [],
    competitive: compRes ?? null,
  };
  const insightCards = snapshotInsights?.cards ?? [];

  // ── Phase C: pacing (month-to-date vs goals), alerts, 13-month table ──
  const targetsMap = targets ?? {};
  const hasTargets = Object.keys(targetsMap).length > 0;
  // GA4/GSC data lags to yesterday and buildDateRange('mtd') anchors its window
  // to yesterday, so pace the run-rate against yesterday (not today) — otherwise
  // the elapsed-fraction divisor is misaligned with the actuals (a ~30x blow-up
  // on the 1st of the month, a mild under-projection on other days).
  const pacingAsOf = new Date(Date.now() - 86400000);

  let pacing: PacingRow[] = [];
  if (hasTargets) {
    // Pacing projects a monthly run-rate, so it needs month-to-date actuals
    // (not the dashboard's selected range). Cached, so cheap on repeat loads.
    const [mtdA, mtdR] = await Promise.all([
      safe(fetchAnalyticsData(clientId, { period: "mtd", compare: "prior" })),
      safe(fetchDashboardReport(clientId, { period: "mtd", compare: "prior" })),
    ]);
    const actuals: Record<string, number> = {};
    if (mtdA?.ga4) actuals.sessions = mtdA.ga4.sessions;
    if (mtdA?.gsc) actuals.organic_clicks = mtdA.gsc.clicks;
    if (mtdR?.ga4) {
      actuals.revenue = mtdR.ga4.purchaseRevenue;
      actuals.conversions = mtdR.ga4.transactions;
    }
    if (gbp?.configured && gbp.insights) actuals.gbp_calls = gbp.insights.totals["CALL_CLICKS"] ?? 0;
    pacing = computePacing(actuals, targetsMap, pacingAsOf);
  }

  // Alerts from current-period deltas + GBP health + pacing (engine self-ranks).
  const clicksCur = clicksTrend.reduce((s, p) => s + p.value, 0);
  const clicksPrev = clicksTrend.reduce((s, p) => s + (p.compareValue ?? 0), 0);
  const clicksDeltaPct = clicksPrev > 0 ? ((clicksCur - clicksPrev) / clicksPrev) * 100 : undefined;
  const issueCounts = gbp?.audit?.issueCounts ?? {};
  const alertInput: AlertInput = {
    metrics: {
      sessions: ga4 ? { value: ga4.sessions, delta: ga4.sessionsDelta } : undefined,
      organicClicks: gsc ? { value: gsc.clicks, delta: clicksDeltaPct } : undefined,
      conversions: dashboardReport.ga4
        ? { value: dashboardReport.ga4.transactions, delta: dashboardReport.ga4.transactionsDelta }
        : undefined,
      revenue: dashboardReport.ga4
        ? { value: dashboardReport.ga4.purchaseRevenue, delta: dashboardReport.ga4.purchaseRevenueDelta }
        : undefined,
      gbpCalls:
        gbp?.configured && gbp.insights
          ? {
              value: gbp.insights.totals["CALL_CLICKS"] ?? 0,
              delta: gbp.insights.deltas.find((d) => d.metric === "CALL_CLICKS")?.deltaPct ?? undefined,
            }
          : undefined,
    },
    gbp:
      gbp?.configured && gbp.audit
        ? {
            avgScore: gbp.audit.avgScore,
            closedCount: issueCounts["Marked as permanently closed"] ?? 0,
            missingInfoCount:
              (issueCounts["No website URL"] ?? 0) +
              (issueCounts["No business hours set"] ?? 0) +
              (issueCounts["No business description"] ?? 0),
          }
        : undefined,
    pacing: pacing.map((p) => ({
      metricId: PACING_TO_ALERT_KEY[p.metricId] ?? p.metricId,
      status: p.status,
      pctToTarget: p.pctToTarget ?? undefined,
      label: p.label,
      monthProgress: monthElapsedFraction(pacingAsOf),
    })),
  };
  const alerts: DashboardAlert[] = deriveAlerts(alertInput);

  // 13-month metric table — admin detail view only.
  let metricTableRows: MetricTableRow[] = [];
  if (isAdmin) {
    const mt = await safe(get13MonthTable());
    metricTableRows = mt?.rows ?? [];
  }

  // "What we changed" annotations timeline (best-effort).
  const annotations: Annotation[] = (await safe(listAnnotations(clientId))) ?? [];

  // ── Assemble the executive summary band ──────────────────────────────────
  const kpis: ExecKpi[] = [];
  if (ga4) {
    kpis.push({ label: "Sessions", value: fmtInt(ga4.sessions), delta: ga4.sessionsDelta, sparkline: sessionsTrend });
  }
  if (gsc) {
    const cur = clicksTrend.reduce((s, p) => s + p.value, 0);
    const prev = clicksTrend.reduce((s, p) => s + (p.compareValue ?? 0), 0);
    const clicksDelta = prev > 0 ? ((cur - prev) / prev) * 100 : undefined;
    kpis.push({ label: "Organic clicks", value: fmtInt(gsc.clicks), delta: clicksDelta, sparkline: clicksTrend });
  }
  if (type === "ecommerce" && dashboardReport.ga4) {
    kpis.push({ label: "Revenue", value: fmtCurrency(dashboardReport.ga4.purchaseRevenue), delta: dashboardReport.ga4.purchaseRevenueDelta });
  }
  if (gbp?.configured && gbp.insights) {
    const calls = gbp.insights.totals["CALL_CLICKS"] ?? 0;
    const callsDeltaPct = gbp.insights.deltas.find((d) => d.metric === "CALL_CLICKS")?.deltaPct;
    kpis.push({ label: "Calls (GBP)", value: fmtInt(calls), delta: callsDeltaPct ?? undefined });
  }

  const health: HealthItem[] = [];
  if (gbp?.configured && gbp.audit) {
    health.push({ label: `GBP Profiles (${gbp.audit.locationCount})`, score: gbp.audit.avgScore });
  }

  let headline: string | undefined = snapshotInsights?.headline;
  if (!headline && ga4) {
    const d = ga4.sessionsDelta;
    headline =
      d > 0
        ? `Sessions up ${Math.abs(d).toFixed(0)}% vs the prior period`
        : d < 0
        ? `Sessions down ${Math.abs(d).toFixed(0)}% vs the prior period`
        : `Sessions holding steady vs the prior period`;
  }

  const execBand: ExecutiveSummaryBandProps = { headline, kpis, health, activity: activityItems };

  if (!lookerUrl && !hasAnalytics && !gbp?.configured) {
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
          execBand={execBand}
          sessionsTrend={sessionsTrend}
          trendGranularity={trendGranularity}
          gbp={gbp}
          clientType={type}
          modules={modules}
          moduleData={moduleData}
          insightCards={insightCards}
          alerts={alerts}
          pacing={pacing}
          metricTableRows={metricTableRows}
          annotations={annotations}
        />
      </div>
    </div>
  );
}
