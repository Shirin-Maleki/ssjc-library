import { cn } from "@/lib/utils/cn";

/**
 * The physical category is the one place this UI deliberately spends a brand accent
 * color (the official teal, as a background tint only — never as text, since teal
 * fails text contrast; see docs/BRANDING.md). It's always the same color regardless
 * of which category, so the color itself comes to mean "this is the shelf location,"
 * not "this specific category" — which keeps every other tag neutral and avoids the
 * "rainbow of tags" the product brief explicitly warns against.
 */
export function CategoryBadge({ categoryLabel, className }: { categoryLabel: string; className?: string }) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/15 px-2.5 py-1 text-xs font-medium text-text-primary",
        className
      )}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 14s5-4.2 5-8a5 5 0 0 0-10 0c0 3.8 5 8 5 8Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <circle cx="8" cy="6" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      </svg>
      <span>
        Located in <span className="font-semibold">{categoryLabel}</span>
      </span>
    </div>
  );
}
