"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ISO_639_1_LANGUAGE_NAMES, type LanguageCode } from "@/lib/catalog/languages";
import { FORMAT_LABELS, FICTION_TYPE_LABELS, ILLUSTRATION_STYLE_LABELS, VISUAL_REALISM_LABELS } from "@/lib/catalog/labels";
import { formatAgeRange } from "@/lib/catalog/age";
import type { Format, FictionType, IllustrationStyle, VisualRealism } from "@/lib/catalog/types";
import type { TeacherEdits } from "@/lib/intake/draft";
import { SourceCoverPreview, type RotationDegrees } from "./SourceCoverPreview";

export interface ConfirmBookViewData {
  coverPreviewUrl: string;
  /** The teacher's persisted manual rotation (AI-first catalog draft correction §9)
   * — the same value used throughout the intake flow, so a photo the teacher
   * rotated during capture never reverts to looking sideways here. */
  coverPreviewRotationDegrees: RotationDegrees;
  title: string;
  authors: string[];
  languageCode: string | null;
  /** Everything below is `ai_inferred` catalog-assistance from the single combined
   * analysis call — genuinely useful suggestions, never claimed as bibliographic
   * fact (AI-first catalog draft correction §2/§7/§10). */
  description: string | null;
  categorySlug: string | null;
  categoryLabel: string | null;
  fictionType: FictionType | null;
  format: Format | null;
  ageMinMonths: number | null;
  ageMaxMonths: number | null;
  readAloudMinutes: number | null;
  tags: string[];
  visualMediaTypes: IllustrationStyle[];
  visualRealism: VisualRealism | null;
  /** `false` only when AI never ran at all (unconfigured, or a real provider
   * failure that still let identification/reconciliation complete on cover
   * evidence alone) — distinct from AI running and having nothing useful to add,
   * so the UI can be honest about which case it's showing. */
  aiSuggestionsAvailable: boolean;
}

interface ConfirmBookProps {
  data: ConfirmBookViewData;
  activeCategories: { slug: string; label: string }[];
  onConfirm: (edits: TeacherEdits) => void;
  onReviewLater: () => void;
  submitting: boolean;
}

const FICTION_OPTIONS = [
  { value: "", label: "Unknown" },
  { value: "fiction", label: "Fiction" },
  { value: "nonfiction", label: "Nonfiction" },
] as const;

/** A friendly, teacher-facing band rather than a precise minute count — the
 * estimate itself is already a recommendation, not a measured fact (§6 of the
 * phase brief). */
function readAloudBand(minutes: number | null): string | null {
  if (minutes == null) return null;
  if (minutes < 5) return "Under 5 min";
  if (minutes <= 10) return "5–10 min";
  return "10+ min";
}

/** A small, subtle chip for one piece of compact catalog info — never a provider
 * id, a raw confidence decimal, or any other internal detail (§7 of the phase
 * brief). */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-surface-subtle px-3 py-1 text-xs font-medium text-text-secondary">
      {children}
    </span>
  );
}

/**
 * The default confirmation view (§29 of the phase brief; AI-first catalog draft
 * correction §7) — designed to feel like "AI prepared this book record for you,"
 * not a blank catalog form. Compact rows/chips, mobile-first, scannable in
 * roughly 10-15 seconds. Quick Edit is a deliberately small correction surface
 * that STARTS FROM the AI-suggested values (§8) — the teacher corrects a draft,
 * never fills an empty form. Nothing here ever shows a provider id, a raw
 * confidence number, a provenance row, raw AI output, an embedding, every tag, or
 * a raw Drive id.
 */
export function ConfirmBook({ data, activeCategories, onConfirm, onReviewLater, submitting }: ConfirmBookProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(data.title);
  const [authorsText, setAuthorsText] = useState(data.authors.join(", "));
  const [languageCode, setLanguageCode] = useState(data.languageCode ?? "");
  const [categorySlug, setCategorySlug] = useState(data.categorySlug ?? "");
  const [description, setDescription] = useState(data.description ?? "");
  // Quick Edit initializes from the AI's own suggestions (§8) — a teacher is
  // CORRECTING a draft, not filling blanks, even though these three fields have
  // no dedicated always-visible chip of their own above.
  const [fictionType, setFictionType] = useState(data.fictionType ?? "");
  const [format, setFormat] = useState(data.format ?? "");
  const [ageMinYears, setAgeMinYears] = useState(data.ageMinMonths != null ? String(Math.floor(data.ageMinMonths / 12)) : "");
  const [ageMaxYears, setAgeMaxYears] = useState(data.ageMaxMonths != null ? String(Math.ceil(data.ageMaxMonths / 12)) : "");

  /**
   * AI draft human-correction semantics (final round §1) — sends ONLY fields
   * whose value actually differs from what the confirm screen originally
   * showed. A field the teacher never touched is OMITTED entirely (the server
   * then keeps the AI/proposed value and its `ai_inferred`/`cover_visible`
   * provenance untouched); a field the teacher genuinely changed — including
   * changing it to "Unknown"/empty — is INCLUDED, explicitly as `null` when
   * cleared, never silently dropped. Opening Quick Edit and closing it again
   * without changing anything must produce `{}`, exactly like never opening it
   * at all — the presence of the Quick Edit panel itself must never be mistaken
   * for a correction.
   */
  function buildEdits(): TeacherEdits {
    if (!editing) return {};
    const edits: TeacherEdits = {};

    const trimmedTitle = title.trim();
    if (trimmedTitle !== data.title) edits.title = trimmedTitle || null;

    const originalAuthorsText = data.authors.join(", ");
    if (authorsText !== originalAuthorsText) {
      edits.authors = authorsText.trim() ? authorsText.split(",").map((a) => a.trim()).filter(Boolean) : null;
    }

    if (languageCode !== (data.languageCode ?? "")) edits.languageCode = languageCode || null;

    if (categorySlug !== (data.categorySlug ?? "")) edits.physicalCategorySlug = categorySlug || null;

    const trimmedDescription = description.trim();
    if (trimmedDescription !== (data.description ?? "")) edits.description = trimmedDescription || null;

    if (fictionType !== (data.fictionType ?? "")) {
      edits.fictionType = fictionType ? (fictionType as "fiction" | "nonfiction") : null;
    }

    if (format !== (data.format ?? "")) {
      edits.format = format ? (format as Format) : null;
    }

    const originalAgeMinYears = data.ageMinMonths != null ? String(Math.floor(data.ageMinMonths / 12)) : "";
    if (ageMinYears !== originalAgeMinYears) edits.ageMinMonths = ageMinYears ? Number(ageMinYears) * 12 : null;

    const originalAgeMaxYears = data.ageMaxMonths != null ? String(Math.ceil(data.ageMaxMonths / 12)) : "";
    if (ageMaxYears !== originalAgeMaxYears) edits.ageMaxMonths = ageMaxYears ? Number(ageMaxYears) * 12 : null;

    return edits;
  }

  const readAloud = readAloudBand(data.readAloudMinutes);
  const hasAgeRange = data.ageMinMonths != null || data.ageMaxMonths != null;
  const hasAnySuggestionChip =
    Boolean(data.categoryLabel) || hasAgeRange || Boolean(data.fictionType) || Boolean(data.format) || Boolean(readAloud) || Boolean(data.visualRealism) || data.visualMediaTypes.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-4">
        <div className="flex h-40 w-28 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-subtle sm:h-48 sm:w-32">
          <SourceCoverPreview previewUrl={data.coverPreviewUrl} alt="" rotationDegrees={data.coverPreviewRotationDegrees} />
        </div>
        <div className="flex min-w-0 flex-col gap-1 pt-1">
          {data.aiSuggestionsAvailable && (
            <p className="text-xs font-medium uppercase tracking-wide text-brand-primary">AI prepared this book record for you</p>
          )}
          <h2 className="text-lg font-semibold text-text-primary">{editing ? title : data.title}</h2>
          {data.authors.length > 0 && <p className="text-sm text-text-secondary">{editing ? authorsText : data.authors.join(", ")}</p>}
          <p className="text-sm text-text-muted">
            {ISO_639_1_LANGUAGE_NAMES[(editing ? languageCode : data.languageCode) as LanguageCode] ?? "Language not identified"}
          </p>
        </div>
      </div>

      {data.description && !editing && <p className="text-sm text-text-secondary">{data.description}</p>}

      {!editing && hasAnySuggestionChip && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Suggested</p>
          <div className="flex flex-wrap gap-2">
            {data.categoryLabel && <Chip>{data.categoryLabel}</Chip>}
            {hasAgeRange && <Chip>{formatAgeRange(data.ageMinMonths ?? undefined, data.ageMaxMonths ?? undefined)}</Chip>}
            {data.fictionType && <Chip>{FICTION_TYPE_LABELS[data.fictionType]}</Chip>}
            {data.format && <Chip>{FORMAT_LABELS[data.format]}</Chip>}
            {readAloud && <Chip>{readAloud} read-aloud</Chip>}
            {data.visualRealism && <Chip>{VISUAL_REALISM_LABELS[data.visualRealism]}</Chip>}
            {data.visualMediaTypes.map((type) => (
              <Chip key={type}>{ILLUSTRATION_STYLE_LABELS[type]}</Chip>
            ))}
          </div>
        </div>
      )}

      {!editing && data.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.tags.map((tag) => (
            <span key={tag} className="rounded-full border border-border px-2.5 py-0.5 text-xs text-text-muted">
              {tag}
            </span>
          ))}
        </div>
      )}

      {editing && (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-subtle p-4">
          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base" />
          </Field>
          <Field label="Author(s)">
            <input
              value={authorsText}
              onChange={(e) => setAuthorsText(e.target.value)}
              placeholder="Separate multiple authors with commas"
              className="h-11 rounded-md border border-border-input bg-surface px-3 text-base"
            />
          </Field>
          <Field label="Language">
            <select
              value={languageCode}
              onChange={(e) => setLanguageCode(e.target.value)}
              className="h-11 rounded-md border border-border-input bg-surface px-3 text-base"
            >
              <option value="">Not specified</option>
              {Object.entries(ISO_639_1_LANGUAGE_NAMES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Short description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="rounded-md border border-border-input bg-surface px-3 py-2 text-base"
            />
          </Field>
          <Field label="Physical category">
            <select
              value={categorySlug}
              onChange={(e) => setCategorySlug(e.target.value)}
              className="h-11 rounded-md border border-border-input bg-surface px-3 text-base"
            >
              <option value="">Not specified</option>
              {activeCategories.map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Age from (years)">
              <input
                type="number"
                min={0}
                max={18}
                value={ageMinYears}
                onChange={(e) => setAgeMinYears(e.target.value)}
                className="h-11 rounded-md border border-border-input bg-surface px-3 text-base"
              />
            </Field>
            <Field label="Age to (years)">
              <input
                type="number"
                min={0}
                max={18}
                value={ageMaxYears}
                onChange={(e) => setAgeMaxYears(e.target.value)}
                className="h-11 rounded-md border border-border-input bg-surface px-3 text-base"
              />
            </Field>
          </div>
          <Field label="Fiction / nonfiction">
            <select
              value={fictionType}
              onChange={(e) => setFictionType(e.target.value)}
              className="h-11 rounded-md border border-border-input bg-surface px-3 text-base"
            >
              {FICTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Format">
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="h-11 rounded-md border border-border-input bg-surface px-3 text-base"
            >
              <option value="">Not specified</option>
              {Object.entries(FORMAT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Button variant="primary" size="lg" disabled={submitting} onClick={() => onConfirm(buildEdits())}>
          {submitting ? "Adding…" : "Confirm / Add book"}
        </Button>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="text-sm font-medium text-text-secondary underline underline-offset-4 hover:text-text-primary"
          >
            {editing ? "Cancel edit" : "Quick edit"}
          </button>
          <button
            type="button"
            onClick={onReviewLater}
            disabled={submitting}
            className="text-sm font-medium text-text-muted underline underline-offset-4 hover:text-text-primary"
          >
            Review later
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
      {label}
      {children}
    </label>
  );
}
