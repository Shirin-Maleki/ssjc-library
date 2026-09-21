import { categoryRepository } from "@/db/repositories";
import { isDriveConfigured } from "@/lib/googleDrive";
import { AddBookFlow } from "@/components/add/AddBookFlow";
import { PlaceholderPage } from "@/components/layout/PlaceholderPage";

/**
 * The real Phase 7 Add Book intake page (§10 of the phase brief), replacing the
 * placeholder. A thin Server Component: checks whether the infrastructure this page
 * depends on is actually configured, fetches the current active physical
 * categories server-side (never a stale/hard-coded list, §28), and hands off to the
 * client orchestrator (`AddBookFlow`) for the actual multi-step workflow.
 */
export default async function AddPage() {
  if (!isDriveConfigured()) {
    return (
      <PlaceholderPage
        title="Add a Book"
        message="Photo storage isn't configured in this environment yet. See docs/GOOGLE_SETUP.md."
      />
    );
  }

  const activeCategories = await categoryRepository.listActiveCategories();

  return (
    <div className="mx-auto w-full max-w-lg">
      <AddBookFlow activeCategories={activeCategories} />
    </div>
  );
}
