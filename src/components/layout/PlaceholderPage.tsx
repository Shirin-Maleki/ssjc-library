import Link from "next/link";

interface PlaceholderPageProps {
  title: string;
  message: string;
}

/** A deliberate "coming in a later phase" state — not a broken link, not fake
 * functionality. Used by every Phase 1 navigation destination that has no real
 * implementation yet. */
export function PlaceholderPage({ title, message }: PlaceholderPageProps) {
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-4 py-16">
      <h1 className="text-2xl font-semibold text-text-primary">{title}</h1>
      <p className="max-w-md text-text-secondary">{message}</p>
      <Link
        href="/home"
        className="text-sm font-medium text-brand-primary underline underline-offset-4 hover:text-brand-secondary"
      >
        Back to Home
      </Link>
    </div>
  );
}
