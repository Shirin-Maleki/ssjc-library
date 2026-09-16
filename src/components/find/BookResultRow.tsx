import Link from "next/link";
import type { SearchResult } from "@/lib/search/searchBooks";
import { formatAgeRange } from "@/lib/catalog/age";
import { DURATION_BAND_LABELS, getReadDurationBand } from "@/lib/catalog/duration";
import { VISUAL_REALISM_LABELS } from "@/lib/catalog/labels";
import { getLanguageName } from "@/lib/catalog/languages";
import { AddToListButton } from "@/components/reading-lists/AddToListButton";
import { BookCover } from "./BookCover";
import { CategoryBadge } from "./CategoryBadge";
import { Tag } from "./Tag";

const VISIBLE_TAG_LIMIT = 3;

interface BookResultRowProps {
  result: SearchResult;
  findUrl: string;
  categoryLabel: string;
}

export function BookResultRow({ result, findUrl, categoryLabel }: BookResultRowProps) {
  const { book } = result;
  const visibleTags = book.tags.slice(0, VISIBLE_TAG_LIMIT);
  const remainingTagCount = book.tags.length - visibleTags.length;
  const detailHref = `/books/${book.id}?from=${encodeURIComponent(findUrl)}`;

  return (
    <li className="relative flex gap-4 border-b border-border py-5 last:border-b-0 sm:gap-6">
      {/* Makes the entire row tappable, not just the title text — the visible title
          link below remains the real accessible/keyboard link (tabIndex -1 here, and
          it sits behind the in-flow content in paint order via `relative` on the
          content below, so a direct click on the title still hits that link first). */}
      <Link href={detailHref} aria-hidden="true" tabIndex={-1} className="absolute inset-0" />
      <BookCover book={book} className="relative" />
      <div className="relative flex min-w-0 flex-1 flex-col gap-1.5 sm:gap-2">
        <div>
          <h3 className="text-base font-semibold leading-snug text-text-primary sm:text-lg">
            <Link href={detailHref} className="hover:underline">
              {book.title}
            </Link>
          </h3>
          <p className="text-sm text-text-secondary">
            {book.authors.join(", ")}
            {book.languageCode !== "en" && <span> · {getLanguageName(book.languageCode)}</span>}
          </p>
        </div>

        <p className="line-clamp-1 text-sm text-text-secondary sm:line-clamp-2">{book.description}</p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
          <span>{formatAgeRange(book.ageMinMonths, book.ageMaxMonths)}</span>
          <span aria-hidden="true">·</span>
          <span>{DURATION_BAND_LABELS[getReadDurationBand(book.readAloudMinutes)]}</span>
          <span aria-hidden="true">·</span>
          <span>{VISUAL_REALISM_LABELS[book.visualRealism]}</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <CategoryBadge categoryLabel={categoryLabel} />
          <AddToListButton bookId={book.id} bookTitle={book.title} className="-mr-2" />
        </div>

        {visibleTags.length > 0 && (
          <div className="hidden flex-wrap gap-1.5 sm:flex">
            {visibleTags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
            {remainingTagCount > 0 && <Tag>+{remainingTagCount} more</Tag>}
          </div>
        )}

        {result.explanation && <p className="line-clamp-1 text-xs italic text-text-muted">{result.explanation}</p>}
      </div>
    </li>
  );
}
