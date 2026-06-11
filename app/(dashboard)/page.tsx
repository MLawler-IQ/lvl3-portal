import { Suspense } from "react";
import { requireAuth } from "@/lib/auth";
import { resolveSelectedClientId, getClientById } from "@/lib/client-resolution";
import { createServiceClient } from "@/lib/supabase/server";
import { getUnviewedDeliverables, getOpenCommentRows, buildOpenThreads } from "@/lib/queries";
import { fetchAnalyticsData, type AnalyticsData } from "@/app/actions/analytics";
import NavCards from "@/components/home/nav-cards";
import NarrativeCard from "@/components/ui/NarrativeCard";
import AttentionQueueCard from "@/components/home/AttentionQueueCard";
import OpenLoopsCard from "@/components/home/OpenLoopsCard";
import RefreshSummaryButton from "@/components/home/RefreshSummaryButton";
import RefreshAnalyticsButton from "@/components/home/RefreshAnalyticsButton";
import AnalyticsKpiStrip from "@/components/analytics/AnalyticsKpiStrip";
import HeroBanner from "@/components/home/HeroBanner";
import EngagementStrip from "@/components/home/EngagementStrip";
import AdminTriageSection, { AdminTriageSkeleton } from "@/components/home/AdminTriageSection";

type HomeClient = {
  id: string;
  name: string;
  logo_url: string | null;
  hero_image_url: string | null;
  ai_summary: string | null;
  ai_summary_updated_at: string | null;
  analytics_summary: string | null;
  analytics_summary_updated_at: string | null;
};

type OpenThread = {
  deliverableId: string;
  deliverableTitle: string;
  count: number;
};

export default async function HomePage() {
  const { user } = await requireAuth();

  const selectedClientId = await resolveSelectedClientId(user);

  const selectedClient = selectedClientId
    ? await getClientById<HomeClient>(
        selectedClientId,
        "id, name, logo_url, hero_image_url, ai_summary, ai_summary_updated_at, analytics_summary, analytics_summary_updated_at"
      )
    : null;

  const isAdmin = user.role === "admin";
  const showSelector = user.role !== "client";

  let unviewedDeliverables: import("@/lib/queries").UnviewedDeliverable[] = [];
  let openThreadsData: OpenThread[] = [];
  let recentPosts: {
    id: string;
    title: string;
    body: string;
    category: string | null;
    created_at: string;
  }[] = [];
  let analyticsData: AnalyticsData = { ga4: null, gsc: null };

  if (selectedClient) {
    const service = await createServiceClient();

    const [commentRows, postsResult] = await Promise.all([
      getOpenCommentRows(selectedClient.id),
      service
        .from("posts")
        .select("id, title, body, category, created_at")
        .or(
          `target_client_id.eq.${selectedClient.id},target_client_id.is.null`
        )
        .order("created_at", { ascending: false })
        .limit(2),
    ]);

    unviewedDeliverables = await getUnviewedDeliverables(selectedClient.id);

    openThreadsData = buildOpenThreads(commentRows).map(
      ({ deliverableId, title, threadCount }) => ({
        deliverableId,
        deliverableTitle: title,
        count: threadCount,
      })
    );

    recentPosts = (postsResult.data ?? []) as typeof recentPosts;

    try {
      analyticsData = await fetchAnalyticsData(selectedClient.id);
    } catch {
      // Non-fatal
    }
  }

  const totalOpenThreads = openThreadsData.reduce((s, d) => s + d.count, 0);
  const hasAnalytics = analyticsData.ga4 !== null || analyticsData.gsc !== null;

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8 pb-8">
      {/* Hero Banner */}
      <HeroBanner
        clientName={selectedClient?.name ?? null}
        heroImageUrl={selectedClient?.hero_image_url ?? null}
        clientLogoUrl={selectedClient?.logo_url ?? null}
      />

      {/* Engagement Strip */}
      <EngagementStrip
        projectProgress={null}
        unviewedCount={unviewedDeliverables.length}
        openThreadCount={totalOpenThreads}
      />

      {/* Cross-client triage (admin only, deferred) */}
      {isAdmin && (
        <Suspense fallback={<AdminTriageSkeleton />}>
          <AdminTriageSection />
        </Suspense>
      )}

      {/* No client selected */}
      {!selectedClient && showSelector && (
        <div className="rounded-xl border border-surface-700 bg-surface-900 px-6 py-10 text-center">
          <p className="text-sm text-surface-400">
            Select a client from the workspace selector above to view their
            overview.
          </p>
        </div>
      )}

      {selectedClient && (
        <>
          {/* Analytics KPI strip (compact) */}
          <section>
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-surface-500">
              Key Metrics <span className="text-surface-600">· Last 28 days</span>
            </p>
            {hasAnalytics ? (
              <AnalyticsKpiStrip
                ga4={analyticsData.ga4}
                gsc={analyticsData.gsc}
                compact
              />
            ) : (
              <div className="rounded-xl border border-surface-700 bg-surface-900/50 px-5 py-4">
                <p className="text-sm text-surface-500 italic">
                  KPI cards will appear here once configured by your admin.
                </p>
              </div>
            )}
          </section>

          {/* Attention + Open loops */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section>
              <p className="mb-3 text-xs font-medium uppercase tracking-widest text-surface-500">
                Needs Your Review
              </p>
              <AttentionQueueCard
                unviewedDeliverables={unviewedDeliverables}
                openThreadsData={openThreadsData}
              />
            </section>
            <section>
              <p className="mb-3 text-xs font-medium uppercase tracking-widest text-surface-500">
                Open Loops
              </p>
              <OpenLoopsCard
                totalOpenThreads={totalOpenThreads}
                threadsByDeliverable={openThreadsData}
              />
            </section>
          </div>

          {/* Key movements narrative */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium uppercase tracking-widest text-surface-500">
                Key Movements
              </p>
              {isAdmin && (
                <RefreshSummaryButton clientId={selectedClient.id} />
              )}
            </div>
            {selectedClient.ai_summary ? (
              <NarrativeCard
                title="This month's work"
                body={selectedClient.ai_summary}
                maxChars={280}
                footer={
                  selectedClient.ai_summary_updated_at ? (
                    <p className="text-xs text-surface-500">
                      Last updated{" "}
                      {new Date(
                        selectedClient.ai_summary_updated_at
                      ).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  ) : undefined
                }
              />
            ) : (
              <div className="rounded-xl border border-surface-700 bg-surface-900/50 px-5 py-4">
                <p className="text-sm text-surface-500 italic">
                  No summary yet. Sync the project sheet to generate one.
                </p>
              </div>
            )}
          </section>

          {/* Analytics summary */}
          {(selectedClient.analytics_summary || isAdmin) && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium uppercase tracking-widest text-surface-500">
                  Analytics Insights
                </p>
                {isAdmin && (
                  <RefreshAnalyticsButton clientId={selectedClient.id} />
                )}
              </div>
              {selectedClient.analytics_summary ? (
                <NarrativeCard
                  title="Analytics overview"
                  body={selectedClient.analytics_summary}
                  maxChars={280}
                  footer={
                    selectedClient.analytics_summary_updated_at ? (
                      <p className="text-xs text-surface-500">
                        Last updated{" "}
                        {new Date(
                          selectedClient.analytics_summary_updated_at
                        ).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    ) : undefined
                  }
                />
              ) : (
                <div className="rounded-xl border border-surface-700 bg-surface-900/50 px-5 py-4">
                  <p className="text-sm text-surface-500 italic">
                    No analytics insights yet. Configure GA4/GSC in client settings and click &quot;Refresh analytics&quot;.
                  </p>
                </div>
              )}
            </section>
          )}

          {/* Recent insights */}
          {recentPosts.length > 0 && (
            <section>
              <p className="mb-3 text-xs font-medium uppercase tracking-widest text-surface-500">
                Recent Insights
              </p>
              <div className="space-y-3">
                {recentPosts.map((post) => (
                  <a
                    key={post.id}
                    href="/insights"
                    className="block bg-surface-900 border border-surface-700 rounded-xl p-5 hover:border-surface-600 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h3 className="text-sm font-semibold text-surface-100">
                        {post.title}
                      </h3>
                      {post.category && (
                        <span className="shrink-0 text-xs bg-surface-800 text-surface-400 px-2 py-0.5 rounded-full">
                          {post.category}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-surface-400 line-clamp-2">
                      {post.body.slice(0, 160)}
                    </p>
                    <p className="text-xs text-surface-500 mt-2">
                      {new Date(post.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </a>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Quick nav — below fold */}
      <section>
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-surface-500">
          Quick Nav
        </p>
        <NavCards compact />
      </section>
    </div>
  );
}
