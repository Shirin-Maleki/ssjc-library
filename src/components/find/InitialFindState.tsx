import Link from "next/link";
import { buildFindHref } from "@/lib/search/urlParams";

const EXAMPLE_QUERIES = ["dinosaurs", "Eric Carle", "bedtime stories", "real photographs of animals", "Swedish books"];

/** Shown before the teacher has searched or filtered anything — orients them toward
 * what's searchable without looking like a dashboard. Never called "no results," since
 * nothing has been asked for yet. */
export function InitialFindState() {
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center sm:py-10">
      {/* A small, restrained editorial mark — the one decorative color moment on this
          otherwise-neutral state. Not a functional icon; purely a bit of identity. */}
      <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/20">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-accent">
          <path d="M8 1.5c.4 2.4 1.1 3.6 2.5 4.5-1.4.9-2.1 2.1-2.5 4.5-.4-2.4-1.1-3.6-2.5-4.5 1.4-.9 2.1-2.1 2.5-4.5Z" />
          <path d="M13 9.5c.2 1.2.6 1.8 1.5 2.3-.9.5-1.3 1.1-1.5 2.3-.2-1.2-.6-1.8-1.5-2.3.9-.5 1.3-1.1 1.5-2.3Z" />
        </svg>
      </span>
      <p className="max-w-xs text-sm text-text-secondary sm:max-w-none">
        Search by title, author, topic, or describe what you need — or browse by category above.
      </p>
      {/* Deliberately styled as understated text links, not pill chips — these are
          example phrases to try, not another set of filters, and shouldn't be
          confused with the category pills above (docs/BRANDING.md restraint note). */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <span className="text-xs italic text-text-muted">Try:</span>
        {EXAMPLE_QUERIES.map((example) => (
          <Link
            key={example}
            href={buildFindHref(example, {})}
            className="inline-flex min-h-11 items-center text-sm text-text-secondary underline decoration-border-strong decoration-1 underline-offset-4 hover:text-text-primary hover:decoration-text-primary"
          >
            {example}
          </Link>
        ))}
      </div>
    </div>
  );
}
