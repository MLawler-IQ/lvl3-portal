import { Suspense } from "react";
import { requireAuth } from "@/lib/auth";
import { resolveSelectedClientId, getClientById } from "@/lib/client-resolution";
import { BarChart2 } from "lucide-react";
import AnalyticsSection from "@/components/dashboard/AnalyticsSection";
import DashboardLoading from "./loading";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; compare?: string; tab?: string }>
}) {
  const { user } = await requireAuth();
  const params = await searchParams;
  const period = params.period ?? '28d';
  const compare = params.compare ?? 'prior';

  type ClientRow = {
    id: string;
    name: string;
    looker_embed_url: string | null;
    snapshot_insights: import("@/app/actions/analytics").SnapshotInsights | null;
    analytics_summary_updated_at: string | null;
    client_type: string | null;
  };

  const selectedClientId = await resolveSelectedClientId(user);

  const selectedClient = selectedClientId
    ? await getClientById<ClientRow>(
        selectedClientId,
        "id, name, looker_embed_url, snapshot_insights, analytics_summary_updated_at, client_type"
      )
    : null;

  const showSelector = user.role === "admin" || user.role === "member";
  const isAdmin = user.role === "admin";
  const lookerUrl = selectedClient?.looker_embed_url ?? null;

  if (!selectedClient && showSelector) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center p-8">
        <BarChart2 className="w-10 h-10 text-surface-500 mb-3" />
        <p className="text-surface-400">
          Select a client from the workspace selector to view their dashboard.
        </p>
      </div>
    );
  }

  if (!selectedClient) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center p-8">
        <BarChart2 className="w-10 h-10 text-surface-500 mb-3" />
        <p className="text-surface-400">No client assigned to your account.</p>
      </div>
    );
  }

  // Slow GA4/GSC fetches happen inside AnalyticsSection so the shell
  // (and the skeleton fallback) can render immediately while data streams in.
  return (
    <Suspense key={`${selectedClient.id}-${period}-${compare}`} fallback={<DashboardLoading />}>
      <AnalyticsSection
        clientId={selectedClient.id}
        clientName={selectedClient.name}
        lookerUrl={lookerUrl}
        isAdmin={isAdmin}
        period={period}
        compare={compare}
        clientType={selectedClient.client_type ?? null}
        snapshotInsights={selectedClient.snapshot_insights ?? null}
        snapshotUpdatedAt={selectedClient.analytics_summary_updated_at ?? null}
      />
    </Suspense>
  );
}
