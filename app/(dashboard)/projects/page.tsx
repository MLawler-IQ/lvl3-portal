import { requireAuth } from "@/lib/auth";
import { resolveSelectedClientId, getClientById } from "@/lib/client-resolution";
import { getSheetData } from "@/app/actions/projects";
import ProjectsView from "@/components/projects/projects-view";
import { FileSpreadsheet } from "lucide-react";

export default async function ProjectsPage() {
  const { user } = await requireAuth();

  type ClientRow = {
    id: string;
    name: string;
    google_sheet_id: string | null;
    ai_summary: string | null;
    sheet_header_row: number | null;
    sheet_column_map: import("@/lib/google-sheets").ColumnMap | null;
  };

  const selectedClientId = await resolveSelectedClientId(user);

  const selectedClient = selectedClientId
    ? await getClientById<ClientRow>(
        selectedClientId,
        "id, name, google_sheet_id, ai_summary, sheet_header_row, sheet_column_map"
      )
    : null;

  const showSelector = user.role === "admin" || user.role === "member";
  const isAdmin = user.role === "admin";
  const sheetId = selectedClient?.google_sheet_id ?? null;

  let sheetData: {
    rows: import("@/app/actions/projects").SheetRow[];
    fetchedAt: string;
  } | null = null;
  let sheetError: string | null = null;

  if (sheetId) {
    try {
      const headerRow = selectedClient?.sheet_header_row ?? 1;
      const columnMap = selectedClient?.sheet_column_map ?? null;
      sheetData = await getSheetData(sheetId, headerRow, columnMap);
    } catch (err) {
      sheetError = err instanceof Error ? err.message : String(err);
      console.error("[projects] sheet fetch error:", err);
    }
  }

  if (!selectedClient && showSelector) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center p-8">
        <FileSpreadsheet className="w-10 h-10 text-surface-400 mb-3" />
        <p className="text-surface-400">
          Select a client from the workspace selector to view their project
          tracker.
        </p>
      </div>
    );
  }

  if (!selectedClient) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center p-8">
        <FileSpreadsheet className="w-10 h-10 text-surface-400 mb-3" />
        <p className="text-surface-400">No client assigned to your account.</p>
      </div>
    );
  }

  if (!sheetId) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-surface-100">Projects</h1>
          <p className="mt-1 text-surface-400 text-sm">{selectedClient.name}</p>
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileSpreadsheet className="w-10 h-10 text-surface-400 mb-3" />
          <p className="text-surface-400">
            No Google Sheet has been connected for this client yet.
          </p>
          {isAdmin && (
            <p className="text-surface-400 text-sm mt-1">
              Set the Google Sheet ID in{" "}
              <a
                href={`/clients/${selectedClient.id}/settings`}
                className="text-brand-400 hover:underline"
              >
                Client Settings
              </a>
              .
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!sheetData) {
    return (
      <div className="p-6 max-w-xl">
        <p className="text-surface-400 mb-2">Failed to load sheet data.</p>
        {sheetError && (
          <pre className="text-xs text-red-400 bg-surface-900 border border-surface-700 rounded-lg px-4 py-3 text-left whitespace-pre-wrap break-all w-full">
            {sheetError}
          </pre>
        )}
      </div>
    );
  }

  if (sheetData.rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center p-8">
        <FileSpreadsheet className="w-10 h-10 text-surface-400 mb-3" />
        <p className="text-surface-400">The connected sheet has no task rows yet.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-surface-100">Projects</h1>
          <p className="mt-1 text-surface-400 text-sm">{selectedClient.name}</p>
        </div>
      </div>
      <ProjectsView
        rows={sheetData.rows}
        fetchedAt={sheetData.fetchedAt}
        isAdmin={isAdmin}
        sheetId={sheetId}
        clientId={selectedClient.id}
        aiSummary={selectedClient.ai_summary}
      />
    </div>
  );
}
