import { requireAuth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveSelectedClientId } from "@/lib/client-resolution";
import { Sparkles, ExternalLink } from "lucide-react";
import StatusBadge from "@/components/ui/StatusBadge";

type Service = {
  id: string;
  title: string;
  description: string;
  cta_url: string | null;
  target_client_ids: string[] | null;
};

export default async function ServicesPage() {
  const { user } = await requireAuth();

  const selectedClientId = await resolveSelectedClientId(user);

  const service = await createServiceClient();
  const { data } = await service
    .from("services")
    .select("id, title, description, cta_url, target_client_ids")
    .order("title");

  const services = (data ?? []) as Service[];

  function isTargeted(svc: Service): boolean {
    if (!selectedClientId) return false;
    return (svc.target_client_ids ?? []).includes(selectedClientId);
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      <div>
        <h1 className="text-xl font-semibold text-surface-100">
          Services &amp; Opportunities
        </h1>
        <p className="mt-1 text-sm text-surface-400">
          {services.length > 0
            ? `${services.length} ${services.length === 1 ? "service" : "services"} available`
            : "Service offerings and opportunities"}
        </p>
      </div>

      {services.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Sparkles className="w-10 h-10 text-surface-400 mb-3" />
          <p className="text-surface-400">
            No services are currently highlighted for your account.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map((svc) => {
            const targeted = isTargeted(svc);
            return (
              <div
                key={svc.id}
                className="bg-surface-900 border border-surface-700 rounded-xl p-5 flex flex-col"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-surface-100">
                    {svc.title}
                  </h3>
                  {targeted && <StatusBadge status="opportunity" />}
                </div>
                <p className="text-sm text-surface-400 leading-relaxed flex-1 mb-4 line-clamp-3">
                  {svc.description}
                </p>
                {svc.cta_url && (
                  <a
                    href={svc.cta_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 w-full px-4 py-2 bg-surface-800 hover:bg-surface-800 border border-surface-600 text-surface-300 hover:text-surface-100 text-xs font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-400"
                  >
                    Learn more
                    <ExternalLink size={11} />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
