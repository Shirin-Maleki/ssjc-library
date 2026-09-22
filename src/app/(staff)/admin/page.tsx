import Link from "next/link";
import { getSession } from "@/lib/auth/guards";
import { isAdminActive } from "@/lib/auth/session";
import { authenticateAdmin } from "@/lib/auth/actions";
import { SecretGate } from "@/components/auth/SecretGate";
import { db } from "@/db/client";
import { loadAdminReviewQueue } from "@/lib/admin/reviewQueueSource";
import { listCategoriesWithHealth } from "@/lib/admin/categoryHealth";
import { taxonomySuggestions } from "@/db/schema";
import { eq } from "drizzle-orm";

export default async function AdminPage() {
  // The (staff) layout already guarantees a valid session exists before this renders.
  const session = await getSession();
  const adminActive = session ? isAdminActive(session) : false;

  if (!adminActive) {
    return (
      <div className="flex flex-1 flex-col items-start justify-center gap-6 py-16">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-text-primary">Admin</h1>
          <p className="text-text-secondary">Enter the admin password to continue.</p>
        </div>
        <div className="w-full max-w-sm">
          <SecretGate
            action={authenticateAdmin}
            fieldLabel="Admin password"
            submitLabel="Unlock"
            pendingLabel="Unlocking…"
            autoFocus
          />
        </div>
      </div>
    );
  }

  const [queue, categories, pendingSuggestions] = await Promise.all([
    loadAdminReviewQueue(db),
    listCategoriesWithHealth(db),
    db.select({ id: taxonomySuggestions.id }).from(taxonomySuggestions).where(eq(taxonomySuggestions.status, "pending")),
  ]);

  const needsReviewCount = queue.filter((i) => i.primaryReason.code === "identity_needs_review" || i.primaryReason.code === "metadata_conflict" || i.primaryReason.code === "low_confidence_field" || i.primaryReason.code === "missing_metadata").length;
  const duplicateCount = queue.filter((i) => i.reasons.some((r) => r.code === "possible_duplicate")).length;
  const categoryIssueCount = queue.filter((i) => i.reasons.some((r) => r.code === "category_missing" || r.code === "category_uncertain")).length;
  const zeroUseCategoryCount = categories.filter((c) => c.isActive && c.activeBookCount === 0 && c.pendingReviewBookCount === 0).length;

  const sections = [
    {
      href: "/admin/review",
      title: "Needs Review",
      count: needsReviewCount,
      description: needsReviewCount === 0 ? "Nothing needs attention." : `${needsReviewCount} item${needsReviewCount === 1 ? "" : "s"} awaiting a decision.`,
    },
    {
      href: "/admin/review",
      title: "Possible Duplicates",
      count: duplicateCount,
      description: duplicateCount === 0 ? "No possible duplicates are waiting for review." : `${duplicateCount} possible duplicate${duplicateCount === 1 ? "" : "s"} to compare.`,
    },
    {
      href: "/admin/review",
      title: "Category Issues",
      count: categoryIssueCount,
      description: categoryIssueCount === 0 ? "All current books have a shelving category." : `${categoryIssueCount} record${categoryIssueCount === 1 ? "" : "s"} need a category decision.`,
    },
    {
      href: "/admin/taxonomy",
      title: "Taxonomy",
      count: pendingSuggestions.length,
      description: pendingSuggestions.length === 0 ? "No taxonomy suggestions are waiting." : `${pendingSuggestions.length} suggestion${pendingSuggestions.length === 1 ? "" : "s"} awaiting a decision.`,
    },
  ];

  return (
    <div className="flex w-full flex-col gap-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">Admin</h1>
        <p className="mt-1 max-w-lg text-text-secondary">Catalog maintenance: review uncertain or incomplete records, and manage shelving categories.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {sections.map((section) => (
          <Link
            key={section.title}
            href={section.href}
            className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-5 transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-text-primary">{section.title}</span>
              {section.count > 0 && (
                <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-semibold text-text-secondary">{section.count}</span>
              )}
            </div>
            <p className="text-sm text-text-secondary">{section.description}</p>
          </Link>
        ))}
      </div>

      {zeroUseCategoryCount > 0 && (
        <p className="text-sm text-text-muted">
          {zeroUseCategoryCount} active categor{zeroUseCategoryCount === 1 ? "y has" : "ies have"} no books yet — see{" "}
          <Link href="/admin/taxonomy" className="underline underline-offset-4">
            Taxonomy
          </Link>
          .
        </p>
      )}
    </div>
  );
}
