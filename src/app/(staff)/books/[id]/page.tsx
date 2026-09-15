import Link from "next/link";
import { getBookById } from "@/lib/catalog/fixtures";
import { formatAgeRange } from "@/lib/catalog/age";
import { DURATION_BAND_LABELS, getReadDurationBand } from "@/lib/catalog/duration";
import { FICTION_TYPE_LABELS, FORMAT_LABELS, ILLUSTRATION_STYLE_LABELS, VISUAL_REALISM_LABELS } from "@/lib/catalog/labels";
import { getLanguageName } from "@/lib/catalog/languages";
import { BookCover } from "@/components/find/BookCover";
import { CategoryBadge } from "@/components/find/CategoryBadge";
import { Tag } from "@/components/find/Tag";

interface BookDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}

/** Only a `from` value that actually points back into Find is trusted — anything
 * else (missing, malformed, or pointing elsewhere) falls back to a plain `/find`
 * rather than risking an open redirect or a confusing "back" link. */
function resolveBackHref(from: string | undefined): string {
  if (from && from.startsWith("/find")) return from;
  return "/find";
}

export default async function BookDetailPage({ params, searchParams }: BookDetailPageProps) {
  const { id } = await params;
  const { from } = await searchParams;
  const book = getBookById(id);
  const backHref = resolveBackHref(from);

  if (!book) {
    return (
      <div className="flex flex-1 flex-col items-start justify-center gap-4 py-16">
        <h1 className="text-2xl font-semibold text-text-primary">Book not found</h1>
        <p className="max-w-md text-text-secondary">
          This book isn&rsquo;t in the development catalog. It may have been a link to a book that no longer exists.
        </p>
        <Link href="/find" className="text-sm font-medium text-brand-primary underline underline-offset-4">
          Back to Find a Book
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 py-4">
      <Link
        href={backHref}
        className="-ml-2 inline-flex min-h-11 w-fit items-center gap-1.5 px-2 text-sm font-medium text-text-secondary hover:text-text-primary"
      >
        <span aria-hidden="true">←</span> Back to results
      </Link>

      <div className="flex flex-col gap-6 sm:flex-row sm:gap-10">
        <div className="flex justify-center sm:block">
          <BookCover book={book} size="md" className="w-36 sm:w-48" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary sm:text-3xl">{book.title}</h1>
            {book.subtitle && <p className="text-lg text-text-secondary">{book.subtitle}</p>}
            <p className="mt-1 text-sm text-text-secondary">
              {book.authors.join(", ")}
              {book.illustrators && book.illustrators.length > 0 && (
                <span> · Illustrated by {book.illustrators.join(", ")}</span>
              )}
            </p>
          </div>

          <CategoryBadge categoryId={book.physicalCategory} className="w-fit" />

          <p className="max-w-2xl text-text-secondary">{book.description}</p>

          <dl className="grid max-w-2xl grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-text-muted">Age</dt>
              <dd className="text-text-primary">{formatAgeRange(book.ageMinMonths, book.ageMaxMonths)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Read-aloud time</dt>
              <dd className="text-text-primary">{DURATION_BAND_LABELS[getReadDurationBand(book.readAloudMinutes)]}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Language</dt>
              <dd className="text-text-primary">{getLanguageName(book.languageCode)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Fiction / nonfiction</dt>
              <dd className="text-text-primary">{FICTION_TYPE_LABELS[book.fictionType]}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Format</dt>
              <dd className="text-text-primary">{FORMAT_LABELS[book.format]}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Visual style</dt>
              <dd className="text-text-primary">{VISUAL_REALISM_LABELS[book.visualRealism]}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Illustration</dt>
              <dd className="text-text-primary">
                {book.illustrationStyles.map((style) => ILLUSTRATION_STYLE_LABELS[style]).join(", ")}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">Publisher</dt>
              <dd className="text-text-primary">
                {book.publisher}
                {book.imprint ? ` (${book.imprint})` : ""}
              </dd>
            </div>
          </dl>

          {book.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {book.tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
