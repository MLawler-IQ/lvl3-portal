"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState } from "react";
import LookerEmbed from "@/components/dashboard/looker-embed";
import AnalyticsKpiStrip from "@/components/analytics/AnalyticsKpiStrip";
import RefreshAnalyticsButton from "@/components/home/RefreshAnalyticsButton";
import WebsiteTab from "@/components/analytics/website/WebsiteTab";
import SeoTab from "@/components/analytics/seo/SeoTab";
import ExecutiveSummaryBand, { type ExecutiveSummaryBandProps } from "@/components/dashboard/exec/ExecutiveSummaryBand";
import TrendChart from "@/components/analytics/shared/TrendChart";
import RankedBarChart from "@/components/analytics/shared/RankedBarChart";
import ChannelBarChart from "@/components/analytics/website/ChannelBarChart";
import InsightCards from "@/components/dashboard/modules/InsightCards";
import EcomFunnel from "@/components/dashboard/modules/EcomFunnel";
import TopProducts from "@/components/dashboard/modules/TopProducts";
import BrandedSplit from "@/components/dashboard/modules/BrandedSplit";
import LocationLeaderboard from "@/components/dashboard/modules/LocationLeaderboard";
import LocationCompleteness from "@/components/dashboard/modules/LocationCompleteness";
import ConvertingPages from "@/components/dashboard/modules/ConvertingPages";
import ContentPerformance from "@/components/dashboard/modules/ContentPerformance";
import Competitive from "@/components/dashboard/modules/Competitive";
import Alerts from "@/components/dashboard/modules/Alerts";
import Targets from "@/components/dashboard/modules/Targets";
import MetricTable13 from "@/components/dashboard/modules/MetricTable13";
import Annotations from "@/components/dashboard/modules/Annotations";
import { CALENDAR_PRESETS } from "@/lib/date-range";
import { gbpLocationLabel, hasDuplicateTitles } from "@/lib/dashboard/gbp-labels";
import type { Annotation } from "@/app/actions/annotations";
import type { AnalyticsData, SnapshotInsights, DashboardReport } from "@/app/actions/analytics";
import type { DashboardGBPData } from "@/app/actions/dashboard-gbp";
import type { GA4EcomFunnel, GA4TopProduct } from "@/app/actions/dashboard-ga4";
import type { GSCBrandedSplit, GSCIntentSplit } from "@/lib/google-search-console";
import type { ConvertingPageRow, ContentUrlRow } from "@/app/actions/dashboard-leadgen";
import type { CompetitiveResult } from "@/app/actions/dashboard-competitive";
import type { MetricTableRow } from "@/app/actions/dashboard-metrics-table";
import type { PacingRow } from "@/lib/dashboard/pacing";
import type { Granularity, TrendPoint, InsightCard, DashboardModuleId, ClientType, DashboardAlert } from "@/lib/dashboard/types";

interface ModuleData {
  ecomFunnel: GA4EcomFunnel | null;
  topProducts: GA4TopProduct[];
  branded: GSCBrandedSplit | null;
  intent: GSCIntentSplit | null;
  convertingPages: ConvertingPageRow[];
  contentPerformance: ContentUrlRow[];
  competitive: CompetitiveResult | null;
}

interface Props {
  lookerUrl: string | null;
  clientName: string;
  isAdmin: boolean;
  analyticsData: AnalyticsData;
  snapshotInsights: SnapshotInsights | null;
  snapshotUpdatedAt: string | null;
  clientId: string;
  dashboardReport: DashboardReport;
  execBand: ExecutiveSummaryBandProps;
  sessionsTrend: TrendPoint[];
  trendGranularity: Granularity;
  gbp: DashboardGBPData | null;
  clientType: ClientType | null;
  modules: DashboardModuleId[];
  moduleData: ModuleData;
  insightCards: InsightCard[];
  alerts: DashboardAlert[];
  pacing: PacingRow[];
  metricTableRows: MetricTableRow[];
  annotations: Annotation[];
}

type Tab = "snapshot" | "locations" | "detail" | "website" | "seo" | "full" | "definitions";

// Modules that live on the "Detail" tab (kept off the at-a-glance Snapshot).
const DETAIL_MODULE_IDS: DashboardModuleId[] = [
  "ecom_funnel",
  "top_products",
  "converting_pages",
  "content_performance",
  "branded_split",
  "competitive",
];

const PERIOD_OPTIONS: { value: string; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "28d", label: "28D" },
  { value: "90d", label: "3M" },
  { value: "180d", label: "6M" },
  { value: "365d", label: "12M" },
];

function SnapshotSection({
  title,
  content,
  isEmpty,
}: {
  title: string;
  content: string;
  isEmpty: boolean;
}) {
  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <p className="text-sm font-semibold text-surface-100 mb-2">{title}</p>
      <p className={`text-sm leading-relaxed ${isEmpty ? "text-surface-500 italic" : "text-surface-300"}`}>
        {content}
      </p>
    </div>
  );
}

const GBP_TILE_LABELS: Record<string, string> = {
  CALL_CLICKS: "Calls",
  WEBSITE_CLICKS: "Website clicks",
  BUSINESS_DIRECTION_REQUESTS: "Directions",
  BUSINESS_CONVERSATIONS: "Messages",
  BUSINESS_BOOKINGS: "Bookings",
};

const GBP_IMPRESSION_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
];

function GbpOverview({ gbp }: { gbp: DashboardGBPData }) {
  if (!gbp.configured) return null;
  const totals = gbp.insights?.totals ?? {};
  const impressions = GBP_IMPRESSION_METRICS.reduce((s, k) => s + (totals[k] ?? 0), 0);
  const deltaFor = (m: string) => gbp.insights?.deltas.find((d) => d.metric === m)?.deltaPct ?? null;

  const tiles: { label: string; value: number; delta: number | null }[] = [
    { label: "Total impressions", value: impressions, delta: null },
    ...Object.keys(GBP_TILE_LABELS)
      .filter((k) => (totals[k] ?? 0) > 0 || k === "CALL_CLICKS")
      .map((k) => ({ label: GBP_TILE_LABELS[k], value: totals[k] ?? 0, delta: deltaFor(k) })),
  ];

  const topIssues = Object.entries(gbp.audit?.issueCounts ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-surface-100">Google Business Profile</p>
        {gbp.audit && (
          <span className="text-xs text-surface-400">
            {gbp.audit.locationCount} location{gbp.audit.locationCount === 1 ? "" : "s"} ·{" "}
            <span className="text-accent-400 font-medium">{gbp.audit.avgScore}/100</span> avg profile
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-surface-700 bg-surface-950/40 px-3 py-2.5">
            <p className="text-xs text-surface-400 truncate">{t.label}</p>
            <p className="text-lg font-semibold text-surface-100 tabular-nums">{Math.round(t.value).toLocaleString()}</p>
            {typeof t.delta === "number" && (
              <p className={`text-xs ${t.delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {t.delta >= 0 ? "+" : ""}
                {t.delta.toFixed(0)}%
              </p>
            )}
          </div>
        ))}
      </div>
      {topIssues.length > 0 && (
        <p className="mt-3 text-xs text-surface-500">
          Top profile gaps: {topIssues.map(([issue, count]) => `${issue} (${count})`).join(" · ")}
        </p>
      )}
      {(gbp.insightsError || gbp.auditError) && (
        <p className="mt-3 text-xs text-amber-400/80">Some GBP data could not be loaded this period.</p>
      )}
    </div>
  );
}

export default function DashboardTabs({
  lookerUrl,
  clientName,
  isAdmin,
  analyticsData,
  snapshotInsights,
  snapshotUpdatedAt,
  clientId,
  dashboardReport,
  execBand,
  sessionsTrend,
  trendGranularity,
  gbp,
  modules,
  moduleData,
  insightCards,
  alerts,
  pacing,
  metricTableRows,
  annotations,
}: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [iframeEverActive, setIframeEverActive] = useState(false);
  const [iframeTimedOut, setIframeTimedOut] = useState(false);

  const activeTab = (searchParams.get("tab") ?? "snapshot") as Tab;
  // Defaults must match page.tsx: last full month vs same month prior year.
  const period = searchParams.get("period") ?? "last_full_month";
  const compare = searchParams.get("compare") ?? "yoy";

  function navigate(updates: Record<string, string>) {
    const p = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([k, v]) => p.set(k, v));
    router.push(`/dashboard?${p.toString()}`);
  }

  function handleTabChange(tab: Tab) {
    navigate({ tab });
    if (tab === "full" && !iframeEverActive) {
      setIframeEverActive(true);
      setTimeout(() => {
        setIframeTimedOut(true);
      }, 3000);
    }
  }

  const hasLooker = !!lookerUrl;
  const hasAnalytics =
    analyticsData.ga4 !== null || analyticsData.gsc !== null;
  const hasLocations = !!gbp?.configured;
  const hasDetail =
    DETAIL_MODULE_IDS.some((id) => modules.includes(id)) ||
    (isAdmin && metricTableRows.length > 0);

  const TABS: { key: Tab; label: string }[] = [
    { key: "snapshot" as Tab, label: "Snapshot" },
    ...(hasLocations ? [{ key: "locations" as Tab, label: "Locations" }] : []),
    ...(hasDetail ? [{ key: "detail" as Tab, label: "Detail" }] : []),
    ...(hasAnalytics ? [{ key: "website" as Tab, label: "Website" }] : []),
    ...(hasAnalytics ? [{ key: "seo" as Tab, label: "SEO" }] : []),
    ...(hasLooker ? [{ key: "full" as Tab, label: "Full Dashboard" }] : []),
    { key: "definitions" as Tab, label: "Definitions & Notes" },
  ];

  const showDateSelector =
    ["snapshot", "detail", "locations"].includes(activeTab) ||
    (["website", "seo"].includes(activeTab) && hasAnalytics);

  // Derived chart data.
  const metricTrend: TrendPoint[] = metricTableRows.map((r) => ({ date: r.yearMonth, value: r.sessions }));
  const gbpLocations = gbp?.insights?.locations ?? [];
  // Chain brands share one title across locations — label bars by city instead.
  const gbpPreferCity = hasDuplicateTitles(gbpLocations.map((l) => l.locationTitle));
  const locationBars = gbpLocations.map((l) => ({
    label: gbpLocationLabel(l.locationTitle || l.locationName, l.locality, l.administrativeArea, gbpPreferCity),
    value: GBP_IMPRESSION_METRICS.reduce((s, k) => s + (l.metrics[k] ?? 0), 0),
  }));

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-surface-700 px-6 shrink-0 justify-between">
        {/* Left: tab pills */}
        <div className="flex items-center gap-0">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900 ${
                activeTab === tab.key
                  ? "border-surface-500 text-surface-100"
                  : "border-transparent text-surface-400 hover:text-surface-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Right: date range selector */}
        {showDateSelector && (
          <div className="flex items-center gap-2 pb-1">
            {/* Period pills */}
            <div className="flex items-center gap-1">
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => navigate({ period: opt.value })}
                  className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
                    period === opt.value
                      ? "border-surface-500 text-surface-100 bg-surface-700/40"
                      : "border-surface-700 text-surface-400 hover:text-surface-100 hover:border-surface-600"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Calendar presets */}
            <select
              value={CALENDAR_PRESETS.some((p) => p.value === period) ? period : ""}
              onChange={(e) => e.target.value && navigate({ period: e.target.value })}
              className="text-xs bg-surface-800 border border-surface-600 text-surface-300 rounded px-2 py-1 focus:outline-none focus:border-surface-500"
            >
              <option value="">Calendar…</option>
              {CALENDAR_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>

            {/* Compare select */}
            <select
              value={compare}
              onChange={(e) => navigate({ compare: e.target.value })}
              className="text-xs bg-surface-800 border border-surface-600 text-surface-300 rounded px-2 py-1 focus:outline-none focus:border-surface-500"
            >
              <option value="prior">vs. prior period</option>
              <option value="yoy">vs. prior year</option>
            </select>
          </div>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {/* Snapshot tab */}
        {activeTab === "snapshot" && (
          <div className="p-6 max-w-4xl space-y-6">
            {/* Alerts (self-hides when nothing is wrong) */}
            <Alerts alerts={alerts} />

            {/* Executive summary band (type-aware hero) */}
            <ExecutiveSummaryBand {...execBand} />

            {/* Goals & pacing (self-hides when no targets are set) */}
            <Targets pacing={pacing} />

            {/* Period-aware traffic trend with prior-period ghost overlay */}
            {sessionsTrend.length >= 2 && (
              <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
                <p className="text-sm font-semibold text-surface-100 mb-3">Traffic trend</p>
                <TrendChart data={sessionsTrend} label="Sessions" granularity={trendGranularity} />
              </div>
            )}

            {/* Channel mix — where sessions (and revenue) come from */}
            {dashboardReport.ga4 && dashboardReport.ga4.topChannels.length > 0 && (
              <ChannelBarChart channels={dashboardReport.ga4.topChannels} />
            )}

            {/* Key insights (narrative; richer modules live on Locations / Detail) */}
            {modules.includes("insight_cards") && insightCards.length > 0 && (
              <InsightCards cards={insightCards} headline={execBand.headline} />
            )}

            {/* KPI strip */}
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-surface-500 mb-3">
                Key Metrics
              </p>
              {hasAnalytics ? (
                <AnalyticsKpiStrip
                  ga4={analyticsData.ga4}
                  gsc={analyticsData.gsc}
                />
              ) : (
                <div className="rounded-xl border border-surface-700 bg-surface-900/50 px-5 py-4">
                  <p className="text-sm text-surface-500 italic">
                    KPI snapshot cards will appear here once configured.
                  </p>
                </div>
              )}
            </div>

            {/* Context panel */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium uppercase tracking-widest text-surface-500">
                  Context
                </p>
                <div className="flex items-center gap-3">
                  {snapshotUpdatedAt && (
                    <p className="text-xs text-surface-500">
                      Updated{" "}
                      {new Date(snapshotUpdatedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  )}
                  {isAdmin && (
                    <RefreshAnalyticsButton clientId={clientId} />
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <SnapshotSection
                  title="Takeaways"
                  content={
                    snapshotInsights?.takeaways ||
                    "Takeaways will appear here once analytics insights are generated."
                  }
                  isEmpty={!snapshotInsights?.takeaways}
                />
                <SnapshotSection
                  title="Anomalies"
                  content={
                    snapshotInsights?.anomalies ||
                    "No anomalies detected this period."
                  }
                  isEmpty={!snapshotInsights?.anomalies}
                />
                <SnapshotSection
                  title="Opportunities"
                  content={
                    snapshotInsights?.opportunities ||
                    "Opportunities will appear here once analytics insights are generated."
                  }
                  isEmpty={!snapshotInsights?.opportunities}
                />
                <Annotations annotations={annotations} isAdmin={isAdmin} clientId={clientId} />
              </div>
            </div>
          </div>
        )}

        {/* Locations tab (GBP) */}
        {activeTab === "locations" && (
          <div className="p-6 max-w-4xl space-y-6">
            {gbp?.configured ? (
              <>
                <GbpOverview gbp={gbp} />
                <RankedBarChart title="Top locations by impressions" rows={locationBars} valueLabel="Impressions" />
                {modules.includes("location_leaderboard") && <LocationLeaderboard data={gbp} />}
                {modules.includes("location_completeness") && <LocationCompleteness data={gbp} />}
              </>
            ) : (
              <div className="rounded-xl border border-surface-700 bg-surface-900/50 px-5 py-4">
                <p className="text-sm text-surface-500 italic">
                  Connect a Google Business Profile account in client settings to see location performance.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Detail tab — richer per-vertical modules + long-range trends */}
        {activeTab === "detail" && (
          <div className="p-6 max-w-4xl space-y-6">
            {metricTrend.length >= 2 && (
              <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
                <p className="text-sm font-semibold text-surface-100 mb-3">13-month sessions trend</p>
                <TrendChart data={metricTrend} label="Sessions" granularity="monthly" />
              </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {modules.includes("ecom_funnel") && <EcomFunnel funnel={moduleData.ecomFunnel} />}
              {modules.includes("top_products") && <TopProducts products={moduleData.topProducts} />}
              {modules.includes("converting_pages") && <ConvertingPages rows={moduleData.convertingPages} />}
              {modules.includes("content_performance") && <ContentPerformance rows={moduleData.contentPerformance} />}
              {modules.includes("branded_split") && (
                <BrandedSplit branded={moduleData.branded} intent={moduleData.intent} />
              )}
              {modules.includes("competitive") && moduleData.competitive && (
                <div className="lg:col-span-2">
                  <Competitive data={moduleData.competitive} />
                </div>
              )}
            </div>
            {isAdmin && <MetricTable13 rows={metricTableRows} />}
          </div>
        )}

        {/* Website tab */}
        {activeTab === "website" && (
          <WebsiteTab ga4={dashboardReport.ga4} />
        )}

        {/* SEO tab */}
        {activeTab === "seo" && (
          <SeoTab
            ga4={dashboardReport.ga4}
            gsc={dashboardReport.gsc}
            gscError={dashboardReport.gscError}
            isAdmin={isAdmin}
          />
        )}

        {/* Full Dashboard tab */}
        {activeTab === "full" && hasLooker && (
          <div className="h-full flex flex-col">
            {iframeTimedOut && !iframeEverActive && (
              <div className="px-6 py-3 bg-surface-900/50 border-b border-surface-700 text-sm text-surface-400">
                Loading full dashboard. KPI snapshot is ready.{" "}
                <button
                  onClick={() => handleTabChange("snapshot")}
                  className="text-surface-300 underline underline-offset-2 hover:text-surface-100 transition-colors"
                >
                  Back to Snapshot
                </button>
              </div>
            )}
            <div className="flex-1">
              <LookerEmbed
                url={lookerUrl!}
                clientName={clientName}
                isActive={iframeEverActive}
              />
            </div>
          </div>
        )}

        {/* Definitions tab */}
        {activeTab === "definitions" && (
          <div className="p-6 max-w-2xl">
            <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-surface-100 mb-2">
                  Metric Definitions & Methodology
                </p>
                {isAdmin && (
                  <button className="text-xs text-surface-500 hover:text-surface-400 transition-colors shrink-0">
                    Admin: Edit
                  </button>
                )}
              </div>
              <p className="text-sm text-surface-500 italic">
                Metric definitions and methodology notes will appear here.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
