import { fetchAnalyticsData, fetchDashboardReport, type AnalyticsData, type DashboardReport, type SnapshotInsights } from "@/app/actions/analytics";
import { getGA4TrendData, getGA4EcomFunnelData, getGA4TopProductsData } from "@/app/actions/dashboard-ga4";
import { getGSCTrendAction, getGSCBrandedSplitAction, getGSCIntentSplitAction } from "@/app/actions/dashboard-gsc";
import { getConvertingPagesData, getContentPerformanceData } from "@/app/actions/dashboard-leadgen";
import { getCompetitiveData } from "@/app/actions/dashboard-competitive";
import { get13MonthTable, type MetricTableRow } from "@/app/actions/dashboard-metrics-table";
import { listAnnotations, type Annotation } from "@/app/actions/annotations";
import { getPacingActuals } from "@/app/actions/dashboard-pacing";
import { fetchDashboardGBP, type DashboardGBPData } from "@/app/actions/dashboard-gbp";
import { defaultModulesForType } from "@/lib/dashboard/registry";
import { computePacing, monthElapsedFraction, type PacingRow } from "@/lib/dashboard/pacing";
import { deriveAlerts, type AlertInput } from "@/lib/dashboard/alerts";
import { deriveInsightCards, deriveHeadline, type InsightSignals, type MetricSignal } from "@/lib/dashboard/insights";
import { buildDateRange, pickGranularity } from "@/lib/date-range";
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
  hasCompetitors: boolean;
  hasKeyEvents: boolean;
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

// Alert-engine metric keys → the human labels used in alert titles and insight
// cards (mirrors lib/dashboard/alerts.ts METRIC_META).
const ALERT_METRIC_LABELS: Record<string, string> = {
  sessions: "Sessions",
  organicClicks: "Organic clicks",
  conversions: "Conversions",
  revenue: "Revenue",
  gbpCalls: "GBP calls",
};

// Decline phrasings (or a signed-minus magnitude, U+2212) used to detect a
// down-reading headline for the dedup-vs-top-alert check below.
const HEADLINE_DECLINE_RE = /\b(down|fell|behind|declin\w*|drop\w*|decreas\w*)\b|−\s?\d/i;

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
  hasCompetitors,
  hasKeyEvents,
  snapshotInsights,
  snapshotUpdatedAt,
}: AnalyticsSectionProps) {
  const type = (clientType as ClientType | null) ?? null;
  // Registry defaults for the client type, plus data-gated modules: configuring
  // competitors / key events surfaces those modules regardless of client type.
  const moduleSet = new Set<DashboardModuleId>(defaultModulesForType(type));
  if (hasCompetitors) moduleSet.add("competitive");
  if (hasKeyEvents) moduleSet.add("converting_pages");
  const modules: DashboardModuleId[] = Array.from(moduleSet);
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
    // One consistent month-to-date actuals snapshot (GA4 sessions/key-events/
    // revenue, GSC clicks, GBP calls) so the run-rate projection is sound.
    const actuals = (await safe(getPacingActuals(clientId))) ?? {};
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
  // Tooltips are the metric definitions (period-agnostic — the band follows the picker).
  const kpis: ExecKpi[] = [];
  if (ga4) {
    kpis.push({
      label: "Sessions",
      value: fmtInt(ga4.sessions),
      delta: ga4.sessionsDelta,
      sparkline: sessionsTrend,
      tooltip: "Visits to the website — one session covers all activity in a single visit (GA4)",
    });
  }
  if (gsc) {
    const cur = clicksTrend.reduce((s, p) => s + p.value, 0);
    const prev = clicksTrend.reduce((s, p) => s + (p.compareValue ?? 0), 0);
    const clicksDelta = prev > 0 ? ((cur - prev) / prev) * 100 : undefined;
    kpis.push({
      label: "Organic clicks",
      value: fmtInt(gsc.clicks),
      delta: clicksDelta,
      sparkline: clicksTrend,
      tooltip: "Clicks to the website from unpaid Google search results (Search Console)",
    });
  }
  if (type === "ecommerce" && dashboardReport.ga4) {
    kpis.push({
      label: "Revenue",
      value: fmtCurrency(dashboardReport.ga4.purchaseRevenue),
      delta: dashboardReport.ga4.purchaseRevenueDelta,
      tooltip: "Purchase revenue tracked by ecommerce events on the website (GA4)",
    });
  }
  if (gbp?.configured && gbp.insights) {
    const calls = gbp.insights.totals["CALL_CLICKS"] ?? 0;
    const callsDeltaPct = gbp.insights.deltas.find((d) => d.metric === "CALL_CLICKS")?.deltaPct;
    kpis.push({
      label: "Calls (GBP)",
      value: fmtInt(calls),
      delta: callsDeltaPct ?? undefined,
      tooltip: "Calls placed from the Google Business Profile listings on Search and Maps",
    });
  }

  const health: HealthItem[] = [];
  if (gbp?.configured && gbp.audit) {
    health.push({ label: `GBP Profiles (${gbp.audit.locationCount})`, score: gbp.audit.avgScore });
  }

  // ── Live insight cards (verdict layer) ────────────────────────────────────
  // Derived at render from the same current-period deltas that feed the exec
  // band and alerts, so cards always match the selected period/compare frame.
  // Stored snapshot insights contribute only the LLM headline + takeaways.
  const compareLabel = buildDateRange(period, compare).compareLabel;
  // A structurally absent metric (e.g. no ecommerce tracking) reports 0 value
  // and 0% delta — drop it so it can't surface as a noise card.
  const liveSignal = (value: number, delta?: number | null): MetricSignal | undefined =>
    value > 0 || (typeof delta === "number" && delta !== 0)
      ? { value, delta: delta ?? undefined }
      : undefined;
  const insightSignals: InsightSignals = { period: compareLabel };
  if (ga4) {
    insightSignals.sessions = liveSignal(ga4.sessions, ga4.sessionsDelta);
    insightSignals.users = liveSignal(ga4.users, ga4.usersDelta);
    insightSignals.pageviews = liveSignal(ga4.pageviews, ga4.pageviewsDelta);
  }
  if (gsc) {
    insightSignals.organicClicks = liveSignal(gsc.clicks, clicksDeltaPct);
  }
  if (dashboardReport.gsc) {
    insightSignals.impressions = liveSignal(dashboardReport.gsc.impressions, dashboardReport.gsc.impressionsDelta);
    insightSignals.avgPosition = liveSignal(dashboardReport.gsc.position, dashboardReport.gsc.positionDelta);
  }
  if (dashboardReport.ga4) {
    insightSignals.conversions = liveSignal(dashboardReport.ga4.transactions, dashboardReport.ga4.transactionsDelta);
    insightSignals.revenue = liveSignal(dashboardReport.ga4.purchaseRevenue, dashboardReport.ga4.purchaseRevenueDelta);
  }
  if (gbp?.configured && gbp.insights) {
    insightSignals.gbpCalls = liveSignal(
      gbp.insights.totals["CALL_CLICKS"] ?? 0,
      gbp.insights.deltas.find((d) => d.metric === "CALL_CLICKS")?.deltaPct
    );
  }
  const insightCards = deriveInsightCards(insightSignals);

  // Stored LLM headline when present; otherwise a deterministic fallback from
  // the live cards (deriveHeadline embeds each card's correct period label).
  let headline: string | undefined = snapshotInsights?.headline || deriveHeadline(insightCards);
  // Dedup rule: suppress the band headline when it restates the top alert —
  // i.e. it names the same metric AND reads as a decline (metric alerts are
  // decline-only) — so the identical message never renders twice back-to-back.
  const topAlertMetric = alerts[0]?.metric ? ALERT_METRIC_LABELS[alerts[0].metric] : undefined;
  if (
    headline &&
    topAlertMetric &&
    headline.toLowerCase().includes(topAlertMetric.toLowerCase()) &&
    HEADLINE_DECLINE_RE.test(headline)
  ) {
    headline = undefined;
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
