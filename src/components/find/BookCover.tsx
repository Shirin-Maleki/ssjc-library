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
 * Variety comes from layout (three restrained rule placements), not color — the
 * brand's four accent hues are reserved for the one place they carry real meaning in
 * this UI (the physical-category badge), not spent on cover decoration. When Phase 6+
 * connects real cover images, only this component needs to change; every caller just
 * passes a `book`.
 */
export function BookCover({ book, size = "md", className }: BookCoverProps) {
  const layout = book.cover.variant % 3;
  const author = book.authors[0];

  return (
    <div
      className={cn(
        "relative flex aspect-[2/3] shrink-0 flex-col overflow-hidden rounded-md border border-border bg-surface-subtle",
        size === "sm" ? "w-16" : "w-24 sm:w-28",
        className
      )}
      role="img"
      aria-label={`Cover of ${book.title}`}
    >
      {layout === 0 && <div className="h-1.5 w-full bg-brand-primary" />}
      {layout === 1 && <div className="absolute inset-y-0 left-0 w-1.5 bg-brand-primary" />}
      <div className={cn("flex flex-1 flex-col justify-center gap-1 px-2.5 py-2", layout === 1 && "pl-3.5")}>
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
      {layout === 2 && <div className="h-1.5 w-full bg-brand-primary" />}
    </div>
  );
}
