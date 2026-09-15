import Link from "next/link";
import { buildFindHref } from "@/lib/search/urlParams";

const EXAMPLE_QUERIES = ["dinosaurs", "Eric Carle", "bedtime stories", "real photographs of animals", "Swedish books"];

/** Shown before the teacher has searched or filtered anything — orients them toward
 * what's searchable without looking like a dashboard. Never called "no results," since
 * nothing has been asked for yet. */
export function InitialFindState() {
  return (
    <div className="flex flex-col gap-3 py-10 text-center">
      <p className="text-sm text-text-secondary">
        Search by title, author, topic, or describe what you need — or browse by category above.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="text-xs text-text-muted">Try:</span>
        {EXAMPLE_QUERIES.map((example) => (
          <Link
            key={example}
            href={buildFindHref(example, {})}
            className="rounded-full border border-border px-3 py-1 text-xs text-text-secondary hover:bg-surface-subtle"
          >
            {example}
          </Link>
        ))}
      </div>
    </div>
  );
}
