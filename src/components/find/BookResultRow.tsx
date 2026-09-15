import Link from "next/link";
import type { SearchResult } from "@/lib/search/searchBooks";
import { formatAgeRange } from "@/lib/catalog/age";
import { DURATION_BAND_LABELS, getReadDurationBand } from "@/lib/catalog/duration";
import { VISUAL_REALISM_LABELS } from "@/lib/catalog/labels";
import { getLanguageName } from "@/lib/catalog/languages";
import { BookCover } from "./BookCover";
import { CategoryBadge } from "./CategoryBadge";
import { Tag } from "./Tag";

const VISIBLE_TAG_LIMIT = 3;

export function BookResultRow({ result, findUrl }: { result: SearchResult; findUrl: string }) {
  const { book } = result;
  const visibleTags = book.tags.slice(0, VISIBLE_TAG_LIMIT);
  const remainingTagCount = book.tags.length - visibleTags.length;

  return (
    <li className="flex gap-4 border-b border-border py-5 last:border-b-0 sm:gap-6">
      <BookCover book={book} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <h3 className="text-base font-semibold leading-snug text-text-primary sm:text-lg">
            <Link href={`/books/${book.id}?from=${encodeURIComponent(findUrl)}`} className="hover:underline">
              {book.title}
            </Link>
          </h3>
          <p className="text-sm text-text-secondary">
            {book.authors.join(", ")}
            {book.languageCode !== "en" && <span> · {getLanguageName(book.languageCode)}</span>}
          </p>
        </div>

        <p className="line-clamp-2 text-sm text-text-secondary">{book.description}</p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
          <span>{formatAgeRange(book.ageMinMonths, book.ageMaxMonths)}</span>
          <span aria-hidden="true">·</span>
          <span>{DURATION_BAND_LABELS[getReadDurationBand(book.readAloudMinutes)]}</span>
          <span aria-hidden="true">·</span>
          <span>{VISUAL_REALISM_LABELS[book.visualRealism]}</span>
        </div>

        {visibleTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {visibleTags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
            {remainingTagCount > 0 && <Tag>+{remainingTagCount} more</Tag>}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <CategoryBadge categoryId={book.physicalCategory} />
        </div>

        {result.explanation && <p className="text-xs italic text-text-muted">{result.explanation}</p>}
      </div>
    </li>
  );
}
