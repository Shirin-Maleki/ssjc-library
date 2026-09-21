import type { Book } from "@/lib/catalog/types";
import { cn } from "@/lib/utils/cn";

interface BookCoverProps {
  book: Pick<Book, "title" | "authors" | "cover">;
  size?: "sm" | "md";
  className?: string;
}

/**
 * A generated, typographic placeholder — not real cover artwork. See
 * src/lib/catalog/fixtures.ts for why: no licensed/public-domain covers are bundled,
 * and hotlinking copyrighted cover images was explicitly ruled out for Phase 2.
 *
 * Four controlled compositions, cycling deterministically by `book.cover.variant` —
 * three carry one restrained brand-color field each (teal, coral, yellow+orange), one
 * stays fully neutral, so a shelf of results reads as "intentionally varied," never as
 * a rainbow (the brief's explicit "use color sparingly" direction — see
 * docs/BRANDING.md). Color is a full light tint field here, not just a thin rule,
 * specifically to move these off "wireframe" without implying real cover artwork —
 * every composition still leads with the same typographic title/author block, so
 * scanning a results list stays about the words, not the color. When Phase 6+
 * connects real cover images, only this component needs to change; every caller just
 * passes a `book`.
 */
interface CoverComposition {
  fieldBg: string;
  rulePosition: "top" | "left" | "bottom";
  ruleBg: string;
}

const COMPOSITIONS: CoverComposition[] = [
  { fieldBg: "bg-accent/12", rulePosition: "top", ruleBg: "bg-accent" },
  { fieldBg: "bg-accent-emphasis/10", rulePosition: "left", ruleBg: "bg-accent-emphasis" },
  { fieldBg: "bg-highlight/30", rulePosition: "bottom", ruleBg: "bg-accent-warm" },
  { fieldBg: "bg-surface-subtle", rulePosition: "top", ruleBg: "bg-brand-primary" },
];

export function BookCover({ book, size = "md", className }: BookCoverProps) {
  const composition = COMPOSITIONS[book.cover.variant % COMPOSITIONS.length];
  const author = book.authors[0];
  const isLeftRule = composition.rulePosition === "left";
  const sizeClass = size === "sm" ? "w-16" : "w-24 sm:w-28";

  // A real, previously-verified display URL (Phase 7 — see BookCoverSpec's own
  // doc comment) renders directly; every fixture book and any real book without
  // one falls back to the typographic placeholder below, unchanged from Phase 2.
  if (book.cover.displayUrl) {
    // A real external provider URL (Google Books/Open Library) — plain <img>,
    // matching the same accepted pattern (and lint warning) already used
    // throughout src/components/add/ for dynamic/external image sources; not
    // worth configuring next/image's static remote-pattern allowlist for one
    // small, already-bounded set of covers.
    return (
      <img
        src={book.cover.displayUrl}
        alt={`Cover of ${book.title}`}
        className={cn("aspect-[2/3] shrink-0 rounded-md border border-border object-cover", sizeClass, className)}
        loading="lazy"
      />
    );
  }

  return (
    <div
      className={cn("relative flex aspect-[2/3] shrink-0 flex-col overflow-hidden rounded-md border border-border", composition.fieldBg, sizeClass, className)}
      role="img"
      aria-label={`Cover of ${book.title}`}
    >
      {composition.rulePosition === "top" && <div className={cn("h-1.5 w-full", composition.ruleBg)} />}
      {isLeftRule && <div className={cn("absolute inset-y-0 left-0 w-1.5", composition.ruleBg)} />}
      <div className={cn("flex flex-1 flex-col justify-center gap-1 px-2.5 py-2", isLeftRule && "pl-3.5")}>
        <p
          className={cn(
            "font-semibold text-text-primary",
            size === "sm" ? "line-clamp-4 text-[10px] leading-tight" : "line-clamp-5 text-xs leading-snug"
          )}
        >
          {book.title}
        </p>
        {author && size !== "sm" && (
          <p className="line-clamp-2 text-[10px] leading-snug text-text-muted">{author}</p>
        )}
      </div>
      {composition.rulePosition === "bottom" && <div className={cn("h-1.5 w-full", composition.ruleBg)} />}
    </div>
  );
}
