"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { ISO_639_1_LANGUAGE_NAMES } from "@/lib/catalog/languages";
import { FORMAT_LABELS, FICTION_TYPE_LABELS, ILLUSTRATION_STYLE_LABELS, VISUAL_REALISM_LABELS } from "@/lib/catalog/labels";
import type { TeacherEdits } from "@/lib/intake/draft";
import type { PhysicalCategoryOption } from "@/db/repositories/categoryRepository";
import type { AdminReviewDetail } from "@/lib/admin/reviewDetail";
import type { DuplicateResolutionAction } from "@/lib/admin/duplicateResolution";
import {
  approveReviewLaterAction,
  resolveDuplicateAction,
  resolveReviewFlagAction,
  archiveBookAction,
  updateBookMetadataAction,
  type ApproveReviewLaterActionInput,
  type ResolveDuplicateActionInput,
} from "@/lib/admin/actions";
import type { AdminMetadataPatch } from "@/lib/admin/adminPatch";

const UNRESOLVED_DUPLICATE_OUTCOMES = new Set(["exact_copy_same_edition", "same_title_different_edition", "same_work_different_language", "ambiguous_similar_title"]);

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
      {label}
      {children}
    </label>
  );
}

/** A calm fallback when the original source photo can't be loaded (Drive
 * unavailable, a stale/test item, or the file was never actually uploaded) —
 * never a browser's default broken-image icon (§10/§35). */
function SourceCoverImage({ ingestionItemId }: { ingestionItemId: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex h-64 w-full items-center justify-center rounded-lg border border-border bg-surface-subtle">
        <p className="px-6 text-center text-sm text-text-muted">The original source photo isn&rsquo;t available right now.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-subtle">
      {/* eslint-disable-next-line @next/next/no-img-element -- admin-only proxied source photo, never a next/image remote-host case */}
      <img
        src={`/api/admin/source-cover/${ingestionItemId}`}
        alt="Original source cover photo"
        className="h-64 w-full object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

interface ReviewDetailClientProps {
  detail: AdminReviewDetail;
  activeCategories: PhysicalCategoryOption[];
}

export function ReviewDetailClient({ detail, activeCategories }: ReviewDetailClientProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const draft = detail.draft;
  const proposed = draft?.proposedBookValues;

  const [title, setTitle] = useState(proposed?.title ?? "");
  const [authorsText, setAuthorsText] = useState((proposed?.authors ?? []).join(", "));
  const [languageCode, setLanguageCode] = useState(proposed?.languageCode ?? "");
  const [categorySlug, setCategorySlug] = useState(draft?.teacherEdits?.physicalCategorySlug ?? draft?.categorySuggestion?.slug ?? "");
  const [description, setDescription] = useState(draft?.teacherEdits?.description ?? draft?.enrichmentSuggestion?.description ?? "");
  const [fictionType, setFictionType] = useState(draft?.teacherEdits?.fictionType ?? draft?.enrichmentSuggestion?.fictionType ?? "");
  const [format, setFormat] = useState(draft?.teacherEdits?.format ?? draft?.enrichmentSuggestion?.format ?? "");
  const [ageMinMonths, setAgeMinMonths] = useState(String(draft?.enrichmentSuggestion?.ageMinMonths ?? ""));
  const [ageMaxMonths, setAgeMaxMonths] = useState(String(draft?.enrichmentSuggestion?.ageMaxMonths ?? ""));
  const [showEvidence, setShowEvidence] = useState(false);

  const hasUnresolvedDuplicate = draft?.duplicateOutcome != null && UNRESOLVED_DUPLICATE_OUTCOMES.has(draft.duplicateOutcome);

  const book = detail.book;
  const [bookTitle, setBookTitle] = useState(book?.title ?? "");
  const [bookAuthorsText, setBookAuthorsText] = useState((book?.authors ?? []).join(", "));
  const [bookLanguageCode, setBookLanguageCode] = useState(book?.languageCode ?? "");
  const [bookPublisherName, setBookPublisherName] = useState(book?.publisher ?? "");
  const [bookIsbn10, setBookIsbn10] = useState(book?.isbn10 ?? "");
  const [bookIsbn13, setBookIsbn13] = useState(book?.isbn13 ?? "");
  const [bookDescription, setBookDescription] = useState(book?.description ?? "");
  const [bookCategorySlug, setBookCategorySlug] = useState(book?.physicalCategory ?? "");
  const [bookAgeMin, setBookAgeMin] = useState(String(book?.ageMinMonths ?? ""));
  const [bookAgeMax, setBookAgeMax] = useState(String(book?.ageMaxMonths ?? ""));
  const [bookFictionType, setBookFictionType] = useState(book?.fictionType ?? "");
  const [bookFormat, setBookFormat] = useState(book?.format ?? "");
  const [bookVisualMediaTypes, setBookVisualMediaTypes] = useState<string[]>(book?.illustrationStyles ?? []);
  const [bookVisualRealism, setBookVisualRealism] = useState(book?.visualRealism ?? "");

  function buildBookPatch(): AdminMetadataPatch {
    if (!book) return {};
    const patch: AdminMetadataPatch = {};
    const trimmedTitle = bookTitle.trim();
    if (trimmedTitle !== book.title) patch.title = trimmedTitle || null;

    const originalAuthorsText = book.authors.join(", ");
    if (bookAuthorsText !== originalAuthorsText) {
      patch.authors = bookAuthorsText.trim() ? bookAuthorsText.split(",").map((a) => a.trim()).filter(Boolean) : null;
    }
    if (bookLanguageCode !== book.languageCode) patch.languageCode = bookLanguageCode || null;
    if (bookPublisherName !== (book.publisher ?? "")) patch.publisherName = bookPublisherName.trim() || null;
    if (bookIsbn10 !== (book.isbn10 ?? "")) patch.isbn10 = bookIsbn10.trim() || null;
    if (bookIsbn13 !== (book.isbn13 ?? "")) patch.isbn13 = bookIsbn13.trim() || null;
    if (bookDescription !== (book.description ?? "")) patch.description = bookDescription.trim() || null;
    if (bookCategorySlug !== book.physicalCategory) patch.physicalCategorySlug = bookCategorySlug || null;
    if (bookAgeMin !== String(book.ageMinMonths ?? "")) patch.ageMinMonths = bookAgeMin ? Number(bookAgeMin) : null;
    if (bookAgeMax !== String(book.ageMaxMonths ?? "")) patch.ageMaxMonths = bookAgeMax ? Number(bookAgeMax) : null;
    if (bookFictionType !== (book.fictionType ?? "")) patch.fictionType = bookFictionType ? (bookFictionType as "fiction" | "nonfiction") : null;
    if (bookFormat !== (book.format ?? "")) patch.format = bookFormat ? (bookFormat as AdminMetadataPatch["format"] & string) : null;
    const originalVisualMediaTypes = [...(book.illustrationStyles ?? [])].sort().join(",");
    if ([...bookVisualMediaTypes].sort().join(",") !== originalVisualMediaTypes) {
      patch.visualMediaTypes = bookVisualMediaTypes.length ? (bookVisualMediaTypes as AdminMetadataPatch["visualMediaTypes"] & string[]) : null;
    }
    if (bookVisualRealism !== (book.visualRealism ?? "")) patch.visualRealism = bookVisualRealism ? (bookVisualRealism as AdminMetadataPatch["visualRealism"] & string) : null;

    return patch;
  }

  async function handleUpdateBookMetadata() {
    if (!detail.bookId || !book) return;
    setSubmitting(true);
    setMessage(null);
    const result = await updateBookMetadataAction({
      bookId: detail.bookId,
      patch: buildBookPatch(),
      expectedUpdatedAt: detail.bookUpdatedAt ? new Date(detail.bookUpdatedAt).toISOString() : undefined,
    });
    setSubmitting(false);
    if (result.ok) {
      setMessage({ tone: "success", text: "Saved." });
      router.refresh();
    } else {
      setMessage({ tone: "error", text: result.message });
    }
  }

  /** Human-verify UX (§6): "Keep current category" leaves the value unchanged
   * but records an explicit `human_verified` decision for it — never sent as
   * a side effect of an ordinary Save, and never applied to any other field. */
  async function handleKeepCurrentCategory() {
    if (!detail.bookId) return;
    setSubmitting(true);
    setMessage(null);
    const result = await updateBookMetadataAction({
      bookId: detail.bookId,
      patch: {},
      explicitlyVerifiedFields: ["physical_category"],
      expectedUpdatedAt: detail.bookUpdatedAt ? new Date(detail.bookUpdatedAt).toISOString() : undefined,
    });
    setSubmitting(false);
    if (result.ok) {
      setMessage({ tone: "success", text: "Category kept as-is and marked verified." });
      router.refresh();
    } else {
      setMessage({ tone: "error", text: result.message });
    }
  }

  function buildEdits(): TeacherEdits {
    const edits: TeacherEdits = {};
    const trimmedTitle = title.trim();
    if (trimmedTitle !== (proposed?.title ?? "")) edits.title = trimmedTitle || null;

    const originalAuthorsText = (proposed?.authors ?? []).join(", ");
    if (authorsText !== originalAuthorsText) {
      edits.authors = authorsText.trim() ? authorsText.split(",").map((a) => a.trim()).filter(Boolean) : null;
    }
    if (languageCode !== (proposed?.languageCode ?? "")) edits.languageCode = languageCode || null;

    const originalDescription = draft?.enrichmentSuggestion?.description ?? "";
    if (description !== originalDescription) edits.description = description.trim() || null;

    const originalFiction = draft?.enrichmentSuggestion?.fictionType ?? "";
    if (fictionType !== originalFiction) edits.fictionType = fictionType ? (fictionType as "fiction" | "nonfiction") : null;

    const originalFormat = draft?.enrichmentSuggestion?.format ?? "";
    if (format !== originalFormat) edits.format = format ? (format as TeacherEdits["format"] & string) : null;

    const originalMin = String(draft?.enrichmentSuggestion?.ageMinMonths ?? "");
    if (ageMinMonths !== originalMin) edits.ageMinMonths = ageMinMonths ? Number(ageMinMonths) : null;
    const originalMax = String(draft?.enrichmentSuggestion?.ageMaxMonths ?? "");
    if (ageMaxMonths !== originalMax) edits.ageMaxMonths = ageMaxMonths ? Number(ageMaxMonths) : null;

    return edits;
  }

  async function handleApprove() {
    if (!detail.ingestionItemId) return;
    setSubmitting(true);
    setMessage(null);
    const input: ApproveReviewLaterActionInput = { ingestionItemId: detail.ingestionItemId, edits: buildEdits(), categorySlug };
    const result = await approveReviewLaterAction(input);
    setSubmitting(false);
    if (result.ok) {
      router.push("/admin/review");
      router.refresh();
    } else {
      setMessage({ tone: "error", text: result.message });
    }
  }

  async function handleDuplicateAction(action: DuplicateResolutionAction, existingBookId?: string) {
    if (!detail.ingestionItemId) return;
    setSubmitting(true);
    setMessage(null);
    const input: ResolveDuplicateActionInput = { ingestionItemId: detail.ingestionItemId, action, existingBookId };
    const result = await resolveDuplicateAction(input);
    setSubmitting(false);
    if (result.ok) {
      if (action === "same_edition") {
        router.push("/admin/review");
      }
      router.refresh();
      setMessage({ tone: "success", text: "Duplicate decision recorded." });
    } else {
      setMessage({ tone: "error", text: result.message });
    }
  }

  async function handleResolveFlag(flagId: string, outcome: "resolved" | "dismissed") {
    setSubmitting(true);
    const result = await resolveReviewFlagAction(flagId, outcome);
    setSubmitting(false);
    if (result.ok) router.refresh();
    else setMessage({ tone: "error", text: result.message ?? "Couldn't update this flag." });
  }

  async function handleArchive() {
    if (!detail.bookId) return;
    if (!confirm("Archive this record? It will be hidden from Find until restored.")) return;
    setSubmitting(true);
    const result = await archiveBookAction(detail.bookId);
    setSubmitting(false);
    if (result.ok) {
      router.push("/admin/review");
    } else {
      setMessage({ tone: "error", text: result.message ?? "Couldn't archive this record." });
    }
  }

  if (detail.draftInvalid) {
    return (
      <StatusMessage tone="error">This item&rsquo;s saved progress could not be read. It needs a fresh look — see the raw ingestion record for detail.</StatusMessage>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
      {message && <StatusMessage tone={message.tone === "error" ? "error" : "success"}>{message.text}</StatusMessage>}

      {detail.ingestionItemId && <SourceCoverImage ingestionItemId={detail.ingestionItemId} />}

      {hasUnresolvedDuplicate && detail.duplicateCandidates.length > 0 && (
        <section className="flex flex-col gap-3 rounded-lg border border-accent-emphasis/30 bg-danger-bg/40 p-4">
          <h2 className="font-semibold text-text-primary">Possible duplicate</h2>
          <p className="text-sm text-text-secondary">Compare against the existing catalog record(s) below and decide how this relates.</p>
          <ul className="flex flex-col gap-3">
            {detail.duplicateCandidates.map((candidate) => (
              <li key={candidate.id} className="rounded-md border border-border bg-surface p-3">
                <p className="font-medium text-text-primary">{candidate.title}</p>
                <p className="text-sm text-text-secondary">
                  {candidate.authors.join(", ") || "Author not identified"} · {candidate.publisher || "Publisher unknown"} · {candidate.languageCode} · {candidate.copyCount ?? 0} cop{(candidate.copyCount ?? 0) === 1 ? "y" : "ies"}
                </p>
                {/* A 2-column grid (not flex-wrap) keeps this a clean, evenly
                    spaced touch target grid at 390px — flex-wrap previously
                    produced an uneven, hard-to-scan wrap on narrow screens. */}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button size="md" variant="secondary" disabled={submitting} onClick={() => handleDuplicateAction("same_edition", candidate.id)}>
                    Same edition
                  </Button>
                  <Button size="md" variant="ghost" disabled={submitting} onClick={() => handleDuplicateAction("different_edition", candidate.id)}>
                    Different edition
                  </Button>
                  <Button size="md" variant="ghost" disabled={submitting} onClick={() => handleDuplicateAction("different_language", candidate.id)}>
                    Different language
                  </Button>
                  <Button size="md" variant="ghost" disabled={submitting} onClick={() => handleDuplicateAction("false_match", candidate.id)}>
                    False match
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => handleDuplicateAction("unresolved")} disabled={submitting} className="self-start text-sm text-text-muted underline underline-offset-4">
            Leave unresolved for now
          </button>
        </section>
      )}

      {draft && (
        <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold text-text-primary">Identity &amp; classification</h2>
          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base" />
          </Field>
          <Field label="Author(s)">
            <input value={authorsText} onChange={(e) => setAuthorsText(e.target.value)} placeholder="Separate multiple authors with commas" className="h-11 rounded-md border border-border-input bg-surface px-3 text-base" />
          </Field>
          <Field label="Language">
            <select value={languageCode ?? ""} onChange={(e) => setLanguageCode(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base">
              <option value="">Not specified</option>
              {Object.entries(ISO_639_1_LANGUAGE_NAMES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Physical category">
            <select value={categorySlug ?? ""} onChange={(e) => setCategorySlug(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base">
              <option value="">Not specified</option>
              {activeCategories.map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Short description">
            <textarea value={description ?? ""} onChange={(e) => setDescription(e.target.value)} rows={3} className="rounded-md border border-border-input bg-surface px-3 py-2 text-base" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Age from (months)">
              <input type="number" min={0} max={216} value={ageMinMonths} onChange={(e) => setAgeMinMonths(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base" />
            </Field>
            <Field label="Age to (months)">
              <input type="number" min={0} max={216} value={ageMaxMonths} onChange={(e) => setAgeMaxMonths(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base" />
            </Field>
          </div>
          <Field label="Fiction / nonfiction">
            <select value={fictionType ?? ""} onChange={(e) => setFictionType(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base">
              <option value="">Not specified</option>
              {Object.entries(FICTION_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Format">
            <select value={format ?? ""} onChange={(e) => setFormat(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base">
              <option value="">Not specified</option>
              {Object.entries(FORMAT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Button variant="primary" size="lg" disabled={submitting || hasUnresolvedDuplicate} onClick={handleApprove}>
            {submitting ? "Approving…" : "Approve into catalog"}
          </Button>
          {hasUnresolvedDuplicate && <p className="text-sm text-text-muted">Resolve the possible duplicate above before approving.</p>}
        </section>
      )}

      {!draft && book && (
        <section className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-4">
          <div>
            <h2 className="font-semibold text-text-primary">Metadata</h2>
            <p className="text-sm text-text-secondary">{book.title}</p>
          </div>

          <div className="flex flex-col gap-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Identity</h3>
            <Field label="Title">
              <input value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base" />
            </Field>
            <Field label="Author(s)">
              <input value={bookAuthorsText} onChange={(e) => setBookAuthorsText(e.target.value)} placeholder="Separate multiple authors with commas" className="h-11 rounded-md border border-border-input bg-surface px-3 text-base" />
            </Field>
            <Field label="Language">
              <select value={bookLanguageCode} onChange={(e) => setBookLanguageCode(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base">
                {Object.entries(ISO_639_1_LANGUAGE_NAMES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Publisher">
              <input value={bookPublisherName} onChange={(e) => setBookPublisherName(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="ISBN-10">
                <input value={bookIsbn10} onChange={(e) => setBookIsbn10(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base" />
              </Field>
              <Field label="ISBN-13">
                <input value={bookIsbn13} onChange={(e) => setBookIsbn13(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base" />
              </Field>
            </div>
          </div>

          <div className="flex flex-col gap-4 border-t border-border pt-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Classification</h3>
            <div className="flex flex-col gap-1.5">
              <Field label="Physical category">
                <select value={bookCategorySlug} onChange={(e) => setBookCategorySlug(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base">
                  {activeCategories.map((category) => (
                    <option key={category.slug} value={category.slug}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </Field>
              <button type="button" onClick={handleKeepCurrentCategory} disabled={submitting} className="self-start text-sm font-medium text-text-secondary underline underline-offset-4 hover:text-text-primary">
                Keep current category (mark verified)
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Age from (months)">
                <input type="number" min={0} max={216} value={bookAgeMin} onChange={(e) => setBookAgeMin(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base" />
              </Field>
              <Field label="Age to (months)">
                <input type="number" min={0} max={216} value={bookAgeMax} onChange={(e) => setBookAgeMax(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base" />
              </Field>
            </div>
            <Field label="Fiction / nonfiction">
              <select value={bookFictionType} onChange={(e) => setBookFictionType(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base">
                <option value="">Not specified</option>
                {Object.entries(FICTION_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Format">
              <select value={bookFormat} onChange={(e) => setBookFormat(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base">
                <option value="">Not specified</option>
                {Object.entries(FORMAT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="flex flex-col gap-4 border-t border-border pt-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Discovery details</h3>
            <Field label="Short description">
              <textarea value={bookDescription} onChange={(e) => setBookDescription(e.target.value)} rows={3} className="rounded-md border border-border-input bg-surface px-3 py-2 text-base" />
            </Field>
            <Field label="Visual media / style">
              <select
                multiple
                value={bookVisualMediaTypes}
                onChange={(e) => setBookVisualMediaTypes(Array.from(e.target.selectedOptions, (o) => o.value))}
                className="min-h-24 rounded-md border border-border-input bg-surface px-3 py-2 text-base"
              >
                {Object.entries(ILLUSTRATION_STYLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Visual realism">
              <select value={bookVisualRealism} onChange={(e) => setBookVisualRealism(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base">
                <option value="">Not specified</option>
                {Object.entries(VISUAL_REALISM_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Button variant="primary" size="lg" disabled={submitting} onClick={handleUpdateBookMetadata}>
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </section>
      )}

      {detail.openReviewFlags.length > 0 && (
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold text-text-primary">Open flags</h2>
          <ul className="flex flex-col gap-2">
            {detail.openReviewFlags.map((flag) => (
              <li key={flag.id} className="flex flex-col gap-2 rounded-md border border-border bg-surface-subtle p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-text-primary">{flag.flagType.replaceAll("_", " ")}</p>
                  {flag.detail && <p className="text-sm text-text-secondary">{flag.detail}</p>}
                </div>
                <div className="flex gap-2">
                  <Button size="md" variant="secondary" disabled={submitting} onClick={() => handleResolveFlag(flag.id, "resolved")}>
                    Resolve
                  </Button>
                  <Button size="md" variant="ghost" disabled={submitting} onClick={() => handleResolveFlag(flag.id, "dismissed")}>
                    Dismiss
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(draft?.coverEvidence || draft?.enrichmentSuggestion || draft?.categorySuggestion) && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <button type="button" onClick={() => setShowEvidence((v) => !v)} className="text-sm font-medium text-text-secondary underline underline-offset-4">
            {showEvidence ? "Hide evidence" : "Show evidence"}
          </button>
          {showEvidence && (
            <div className="mt-3 flex flex-col gap-3 text-sm text-text-secondary">
              {draft?.coverEvidence && (
                <div>
                  <p className="font-medium text-text-primary">From cover</p>
                  <p>Title: {draft.coverEvidence.visibleTitle ?? "Not visible"}</p>
                  <p>Author(s): {draft.coverEvidence.visibleAuthors?.join(", ") || "Not visible"}</p>
                  <p>Confidence: {draft.coverEvidence.identityConfidenceLevel ?? "Not available"}</p>
                </div>
              )}
              {draft?.categorySuggestion && (
                <div>
                  <p className="font-medium text-text-primary">AI suggested category</p>
                  <p>
                    {draft.categorySuggestion.label} ({draft.categorySuggestion.confidence ?? "unrated"} confidence)
                  </p>
                  {draft.categorySuggestion.reason && <p>{draft.categorySuggestion.reason}</p>}
                </div>
              )}
              {draft?.enrichmentSuggestion?.tags && draft.enrichmentSuggestion.tags.length > 0 && (
                <div>
                  <p className="font-medium text-text-primary">AI suggested tags</p>
                  <p>{draft.enrichmentSuggestion.tags.join(", ")}</p>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {detail.bookId && !detail.ingestionItemId && (
        <button type="button" onClick={handleArchive} disabled={submitting} className="self-start text-sm font-medium text-danger underline underline-offset-4">
          Archive this record
        </button>
      )}
    </div>
  );
}
