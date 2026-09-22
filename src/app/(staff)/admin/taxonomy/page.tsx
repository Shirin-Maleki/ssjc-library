import Link from "next/link";
import { requireAdminSession } from "@/lib/auth/guards";
import { db } from "@/db/client";
import { listCategoriesWithHealth, listTaxonomySuggestionsWithBooks } from "@/lib/admin/categoryHealth";
import { TaxonomyClient } from "@/components/admin/TaxonomyClient";

export default async function AdminTaxonomyPage() {
  await requireAdminSession();
  const [categories, suggestions] = await Promise.all([listCategoriesWithHealth(db), listTaxonomySuggestionsWithBooks(db)]);

  return (
    <div className="flex w-full flex-col gap-6 py-8">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold text-text-primary">Taxonomy</h1>
        <Link href="/admin" className="text-sm font-medium text-text-secondary underline underline-offset-4">
          Admin overview
        </Link>
      </div>
      <TaxonomyClient categories={categories} suggestions={suggestions} />
    </div>
  );
}
