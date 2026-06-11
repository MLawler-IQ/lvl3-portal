import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LayoutShell from "@/components/nav/LayoutShell";
import { ToastProvider } from "@/components/ui/ToastProvider";
import {
  getClientListForUser,
  getSelectedClientId,
  getClientById,
} from "@/lib/client-resolution";
import {
  getUnviewedDeliverables,
  getOpenCommentRows,
  buildOpenThreads,
} from "@/lib/queries";
import { createServiceClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("role, client_id")
    .eq("id", user.id)
    .single();

  const role = (profile?.role ?? "member") as "admin" | "member" | "client";
  const isAdmin = role === "admin";

  const { clientList, autoSelectedClientId, showSelector } =
    await getClientListForUser(user.id, role, profile?.client_id ?? null);

  const cookieClientId = await getSelectedClientId();

  let selectedClientId: string | null;
  if (role === "client") {
    selectedClientId = autoSelectedClientId;
  } else {
    selectedClientId =
      cookieClientId && clientList.some((c) => c.id === cookieClientId)
        ? cookieClientId
        : null;
  }

  type ClientBasic = {
    id: string;
    name: string;
    analytics_summary_updated_at: string | null;
  };
  const selectedClient = selectedClientId
    ? await getClientById<ClientBasic>(
        selectedClientId,
        "id, name, analytics_summary_updated_at"
      )
    : null;

  let unreadCount = 0;
  let deliverableBadgeCount = 0;
  let postsBadgeCount = 0;
  let servicesBadgeCount = 0;
  let unviewedDeliverables: {
    id: string;
    title: string;
    viewed_at: string | null;
  }[] = [];
  let openThreadDeliverables: {
    deliverableId: string;
    title: string;
    threadCount: number;
  }[] = [];

  if (selectedClientId) {
    const service = await createServiceClient();

    const [postsResult, servicesResult] = await Promise.all([
      service
        .from("posts")
        .select("id", { count: "exact", head: true })
        .or(
          `target_client_id.eq.${selectedClientId},target_client_id.is.null`
        ),
      service
        .from("services")
        .select("id", { count: "exact", head: true }),
    ]);

    unviewedDeliverables = await getUnviewedDeliverables(selectedClientId);
    unreadCount = unviewedDeliverables.length;
    postsBadgeCount = postsResult.count ?? 0;
    servicesBadgeCount = servicesResult.count ?? 0;

    const commentRows = await getOpenCommentRows(selectedClientId);
    openThreadDeliverables = buildOpenThreads(commentRows);

    const deliverableIdsWithThreads = new Set(
      openThreadDeliverables.map((d) => d.deliverableId)
    );
    const unviewedIds = new Set(unviewedDeliverables.map((d) => d.id));
    deliverableBadgeCount = new Set([
      ...Array.from(deliverableIdsWithThreads),
      ...Array.from(unviewedIds),
    ]).size;
  }

  return (
    <LayoutShell
      userEmail={user.email ?? ""}
      userRole={role}
      isAdmin={isAdmin}
      clientList={clientList}
      selectedClientId={selectedClientId}
      selectedClientName={selectedClient?.name ?? null}
      showClientSelector={showSelector}
      summaryUpdatedAt={selectedClient?.analytics_summary_updated_at ?? null}
      unreadCount={unreadCount}
      deliverableBadgeCount={deliverableBadgeCount}
      postsBadgeCount={postsBadgeCount}
      servicesBadgeCount={servicesBadgeCount}
      unviewedDeliverables={unviewedDeliverables}
      openThreadDeliverables={openThreadDeliverables}
    >
      <ToastProvider>{children}</ToastProvider>
    </LayoutShell>
  );
}
