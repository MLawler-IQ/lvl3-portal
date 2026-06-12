import { requireAdmin } from "@/lib/auth";
import { getClientsWithStats } from "@/app/actions/clients";
import { getLastLoginByClient } from "@/app/actions/users";
import { createServiceClient } from "@/lib/supabase/server";
import { ShieldCheck, CheckCircle, XCircle } from "lucide-react";
import GoogleConnectionPanel from "@/components/admin/GoogleConnectionPanel";
import GBPConnectionPanel from "@/components/admin/GBPConnectionPanel";
import AdminTabs from "@/components/admin/admin-tabs";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; gbp?: string }>
}) {
  const params = await searchParams
  await requireAdmin();

  const clients = await getClientsWithStats();
  const lastLoginByClient = await getLastLoginByClient();

  // Fetch open thread counts per client
  const service = await createServiceClient();
  const { data: openComments } = await service
    .from("comments")
    .select("deliverables!inner(client_id)")
    .eq("resolved", false);

  const openThreadsByClient: Record<string, number> = {};
  for (const row of (openComments ?? []) as unknown as Array<{
    deliverables: { client_id: string } | null;
  }>) {
    const clientId = row.deliverables?.client_id;
    if (!clientId) continue;
    openThreadsByClient[clientId] = (openThreadsByClient[clientId] ?? 0) + 1;
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      <AdminTabs />
      <GoogleConnectionPanel googleParam={params.google ?? null} />
      <GBPConnectionPanel gbpParam={params.gbp ?? null} />
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-5 h-5 text-surface-400" />
        <div>
          <h1 className="text-xl font-semibold text-surface-100">Admin</h1>
          <p className="mt-0.5 text-sm text-surface-400">
            Client health and engagement overview
          </p>
        </div>
      </div>

      {/* Client health grid */}
      <div>
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-surface-500">
          Client Health
        </p>
        {clients.length === 0 ? (
          <p className="text-sm text-surface-500">No clients yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {clients.map((client) => {
              const openThreads = openThreadsByClient[client.id] ?? 0;
              const hasSheet = !!client.google_sheet_id;
              const hasLooker = !!client.looker_embed_url;

              return (
                <div
                  key={client.id}
                  className="bg-surface-900 border border-surface-700 rounded-xl p-5"
                >
                  <div className="flex items-start justify-between gap-2 mb-4">
                    <h3 className="text-sm font-semibold text-surface-100">
                      {client.name}
                    </h3>
                    <a
                      href={`/clients/${client.id}`}
                      className="text-xs text-surface-500 hover:text-surface-200 transition-colors"
                    >
                      Manage →
                    </a>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-surface-800/50 rounded-lg px-3 py-2">
                      <p className="text-lg font-bold text-surface-100">
                        {client.unread_count}
                      </p>
                      <p className="text-xs text-surface-500">Unread deliverables</p>
                    </div>
                    <div className="bg-surface-800/50 rounded-lg px-3 py-2">
                      <p className="text-lg font-bold text-surface-100">{openThreads}</p>
                      <p className="text-xs text-surface-500">Open threads</p>
                    </div>
                    <div className="bg-surface-800/50 rounded-lg px-3 py-2">
                      <p className="text-lg font-bold text-surface-100">
                        {client.deliverable_count}
                      </p>
                      <p className="text-xs text-surface-500">Deliverables</p>
                    </div>
                    <div className="bg-surface-800/50 rounded-lg px-3 py-2">
                      <p className="text-lg font-bold text-surface-100">
                        {client.user_count}
                      </p>
                      <p className="text-xs text-surface-500">Users</p>
                    </div>
                  </div>

                  {/* Connection status */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-xs">
                      {hasSheet ? (
                        <CheckCircle size={12} className="text-accent-400" />
                      ) : (
                        <XCircle size={12} className="text-surface-500" />
                      )}
                      <span className={hasSheet ? "text-surface-300" : "text-surface-500"}>
                        Google Sheet {hasSheet ? "connected" : "not set"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {hasLooker ? (
                        <CheckCircle size={12} className="text-accent-400" />
                      ) : (
                        <XCircle size={12} className="text-surface-500" />
                      )}
                      <span className={hasLooker ? "text-surface-300" : "text-surface-500"}>
                        Looker embed {hasLooker ? "connected" : "not set"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-surface-500">
                      <span className="w-3 h-3 rounded-full border border-surface-600 flex-shrink-0" />
                      Last login:{" "}
                      {lastLoginByClient[client.id]
                        ? new Date(lastLoginByClient[client.id]!).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "Never"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
