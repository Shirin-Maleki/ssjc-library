import Link from "next/link";
import { requireAdminSession } from "@/lib/auth/guards";
import { db } from "@/db/client";
import { loadAdminReviewQueue } from "@/lib/admin/reviewQueueSource";

const PRIORITY_LABELS: Record<number, string> = {
  1: "Identity & duplicates",
  2: "Category decisions",
  3: "Metadata conflicts",
  4: "Metadata cleanup",
};

function formatRelativeDate(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

export default async function AdminReviewPage() {
  await requireAdminSession();
  const items = await loadAdminReviewQueue(db);

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-start justify-center gap-3 py-16">
        <h1 className="text-2xl font-semibold text-text-primary">Needs Review</h1>
        <p className="max-w-md text-text-secondary">Nothing needs attention right now.</p>
        <Link href="/admin" className="text-sm font-medium underline underline-offset-4">
          Back to Admin
        </Link>
      </div>
    );
  }

  const grouped = new Map<number, typeof items>();
  for (const item of items) {
    const list = grouped.get(item.priority) ?? [];
    list.push(item);
    grouped.set(item.priority, list);
  }

  return (
    <div className="flex w-full flex-col gap-8 py-8">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold text-text-primary">Needs Review</h1>
        <Link href="/admin" className="text-sm font-medium text-text-secondary underline underline-offset-4">
          Admin overview
        </Link>
      </div>

      {[1, 2, 3, 4].map((priority) => {
        const group = grouped.get(priority);
        if (!group || group.length === 0) return null;
        return (
          <section key={priority} className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">{PRIORITY_LABELS[priority]}</h2>
            <ul className="flex flex-col gap-2">
              {group.map((item) => (
                <li key={item.key}>
                  <Link
                    href={`/admin/review/${encodeURIComponent(item.key)}`}
                    className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-text-primary">{item.title}</span>
                      <span className="text-sm text-text-secondary">
                        {item.primaryReason.label}
                        {item.primaryReason.detail ? ` — ${item.primaryReason.detail}` : ""}
                        {item.secondaryReasonCount > 0 ? ` · +${item.secondaryReasonCount} more` : ""}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs text-text-muted">{formatRelativeDate(item.enteredReviewAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
