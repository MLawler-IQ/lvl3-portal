import { requireAuth } from "@/lib/auth";
import { resolveSelectedClientId, getClientById } from "@/lib/client-resolution";
import { createServiceClient } from "@/lib/supabase/server";
import { Lightbulb } from "lucide-react";
import NarrativeCard from "@/components/ui/NarrativeCard";
import RefreshAnalyticsButton from "@/components/home/RefreshAnalyticsButton";

type Post = {
  id: string;
  title: string;
  body: string;
  category: string | null;
  created_at: string;
};

type InsightsClient = {
  id: string;
  name: string;
  analytics_summary: string | null;
  analytics_summary_updated_at: string | null;
};

const CATEGORY_COLORS: Record<string, string> = {
  SEO: "bg-brand-500/15 text-brand-400 border-brand-500/20",
  CRO: "bg-accent-400/15 text-accent-400 border-accent-400/20",
  Analytics: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  "AI Search": "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
};

function CategoryTag({ category }: { category: string | null }) {
  if (!category) return null;
  const cls =
    CATEGORY_COLORS[category] ??
    "bg-surface-700/50 text-surface-400 border-surface-600/50";
  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-full border ${cls}`}
    >
      {category}
    </span>
  );
}

export default async function InsightsPage() {
  const { user } = await requireAuth();

  const selectedClientId = await resolveSelectedClientId(user);
  const isAdmin = user.role === "admin";

  const selectedClient =
    selectedClientId
      ? await getClientById<InsightsClient>(
          selectedClientId,
          "id, name, analytics_summary, analytics_summary_updated_at"
        )
      : null;

  let posts: Post[] = [];

  if (selectedClientId) {
    const service = await createServiceClient();
    const { data } = await service
      .from("posts")
      .select("id, title, body, category, created_at")
      .or(
        `target_client_id.eq.${selectedClientId},target_client_id.is.null`
      )
      .order("created_at", { ascending: false });
    posts = (data ?? []) as Post[];
  } else {
    // Show global posts even when no client selected
    const service = await createServiceClient();
    const { data } = await service
      .from("posts")
      .select("id, title, body, category, created_at")
      .is("target_client_id", null)
      .order("created_at", { ascending: false });
    posts = (data ?? []) as Post[];
  }

  const featured = posts[0] ?? null;
  const rest = posts.slice(1);

  const analyticsSummary = selectedClient?.analytics_summary ?? null;
  const analyticsSummaryUpdatedAt =
    selectedClient?.analytics_summary_updated_at ?? null;

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      <div>
        <h1 className="text-xl font-semibold text-surface-100">Insights</h1>
        <p className="mt-1 text-sm text-surface-400">
          {posts.length > 0
            ? `${posts.length} ${posts.length === 1 ? "post" : "posts"}`
            : "Posts and updates from your team"}
        </p>
      </div>

      {/* Analytics Insights section */}
      {(analyticsSummary || isAdmin) && selectedClient && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium uppercase tracking-widest text-surface-500">
              Analytics Insights
            </p>
            {isAdmin && (
              <RefreshAnalyticsButton clientId={selectedClient.id} />
            )}
          </div>
          {analyticsSummary ? (
            <NarrativeCard
              title="Analytics overview"
              body={analyticsSummary}
              maxChars={400}
              footer={
                analyticsSummaryUpdatedAt ? (
                  <p className="text-xs text-surface-500">
                    Last updated{" "}
                    {new Date(analyticsSummaryUpdatedAt).toLocaleDateString(
                      "en-US",
                      { month: "long", day: "numeric", year: "numeric" }
                    )}
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

      {posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Lightbulb className="w-10 h-10 text-surface-500 mb-3" />
          <p className="text-surface-400">
            No insights published yet. Check back soon.
          </p>
        </div>
      ) : (
        <>
          {/* Featured post */}
          {featured && (
            <div className="bg-surface-900 border border-surface-700 rounded-xl p-6">
              <div className="flex items-start justify-between gap-3 mb-3">
                <h2 className="text-lg font-semibold text-surface-100">
                  {featured.title}
                </h2>
                <CategoryTag category={featured.category} />
              </div>
              <p className="text-sm text-surface-300 leading-relaxed mb-4">
                {featured.body.slice(0, 400)}
                {featured.body.length > 400 && "…"}
              </p>
              <p className="text-xs text-surface-500">
                {new Date(featured.created_at).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
          )}

          {/* Post list */}
          {rest.length > 0 && (
            <div className="space-y-3">
              {rest.map((post) => (
                <div
                  key={post.id}
                  className="bg-surface-900 border border-surface-700 rounded-xl p-5 hover:border-surface-600 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <h3 className="text-sm font-semibold text-surface-100">
                      {post.title}
                    </h3>
                    <CategoryTag category={post.category} />
                  </div>
                  <p className="text-sm text-surface-400 line-clamp-2">
                    {post.body}
                  </p>
                  <p className="text-xs text-surface-500 mt-2">
                    {new Date(post.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
