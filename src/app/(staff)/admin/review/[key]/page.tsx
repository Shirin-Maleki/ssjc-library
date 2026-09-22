import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminSession } from "@/lib/auth/guards";
import { db } from "@/db/client";
import { loadAdminReviewDetail } from "@/lib/admin/reviewDetail";
import { ReviewDetailClient } from "@/components/admin/ReviewDetailClient";

export default async function AdminReviewDetailPage({ params }: { params: Promise<{ key: string }> }) {
  await requireAdminSession();
  const { key } = await params;
  const detail = await loadAdminReviewDetail(db, decodeURIComponent(key));

  if (!detail) notFound();

  const title = detail.book?.title ?? detail.draft?.proposedBookValues?.title ?? "Title not identified";

  return (
    <div className="flex w-full flex-col gap-6 py-8">
      <div>
        <Link href="/admin/review" className="text-sm font-medium text-text-secondary underline underline-offset-4">
          ← Needs Review
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-text-primary">{title}</h1>
      </div>
      <ReviewDetailClient detail={detail} activeCategories={detail.activeCategories} />
    </div>
  );
}
