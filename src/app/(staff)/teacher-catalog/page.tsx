import { db } from "@/db/client";
import { getSheetsTarget } from "@/lib/googleSheets/targetState";

/**
 * The Teacher Catalog destination (§19 of the phase brief) — a plain app link
 * out to the real, persistent Google Sheet `npm run sheets:sync` maintains,
 * never a Google-authenticated view rendered inside this app. No Google
 * Sign-In is added here or anywhere else in the teacher-facing app; a signed-
 * in staff session is all that gates this page, matching every other
 * destination in `(staff)`.
 */
export default async function TeacherCatalogPage() {
  const target = await getSheetsTarget(db);

  if (!target) {
    return (
      <div className="flex flex-1 flex-col items-start justify-center gap-4 py-16">
        <h1 className="text-2xl font-semibold text-text-primary">Teacher Catalog</h1>
        <p className="max-w-md text-text-secondary">
          The reference spreadsheet hasn&rsquo;t been set up in this environment yet. Once an admin runs the catalog
          sync, this page will link straight to it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-4 py-16">
      <h1 className="text-2xl font-semibold text-text-primary">Teacher Catalog</h1>
      <p className="max-w-md text-text-secondary">
        A reference view of the catalog in Google Sheets — useful for browsing or sorting the whole collection at a
        glance. This app is still the place to search, add, and manage books; the sheet reflects what&rsquo;s here,
        not the other way around, so any changes made directly in the sheet are overwritten the next time it syncs.
      </p>
      <a
        href={target.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-11 items-center rounded-md bg-brand-primary px-5 text-sm font-semibold text-text-on-brand transition-colors hover:bg-brand-secondary"
      >
        Open teacher catalog
      </a>
      {target.lastSyncedAt && (
        <p className="text-xs text-text-muted">Last synced {new Date(target.lastSyncedAt).toLocaleString()}.</p>
      )}
    </div>
  );
}
