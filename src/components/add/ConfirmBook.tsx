"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ISO_639_1_LANGUAGE_NAMES, type LanguageCode } from "@/lib/catalog/languages";
import type { TeacherEdits } from "@/lib/intake/draft";

export interface ConfirmBookViewData {
  coverPreviewUrl: string;
  title: string;
  authors: string[];
  languageCode: string | null;
  description: string | null;
  categorySlug: string | null;
  categoryLabel: string | null;
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

/**
 * The default confirmation view (§29 of the phase brief) — compact, mostly
 * read-only. Quick Edit is a deliberately small correction surface, never a full
 * catalog form: title, authors, language, category, age range, fiction/nonfiction.
 * Nothing here ever shows a provider id, a raw confidence number, a provenance row,
 * raw AI output, an embedding, every tag, or a raw Drive id.
 */
export function ConfirmBook({ data, activeCategories, onConfirm, onReviewLater, submitting }: ConfirmBookProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(data.title);
  const [authorsText, setAuthorsText] = useState(data.authors.join(", "));
  const [languageCode, setLanguageCode] = useState(data.languageCode ?? "");
  const [categorySlug, setCategorySlug] = useState(data.categorySlug ?? "");
  const [fictionType, setFictionType] = useState("");
  const [ageMinYears, setAgeMinYears] = useState("");
  const [ageMaxYears, setAgeMaxYears] = useState("");

  function buildEdits(): TeacherEdits {
    if (!editing) return {};
    return {
      title: title.trim() || null,
      authors: authorsText.trim() ? authorsText.split(",").map((a) => a.trim()).filter(Boolean) : null,
      languageCode: languageCode || null,
      physicalCategorySlug: categorySlug || null,
      fictionType: fictionType ? (fictionType as "fiction" | "nonfiction") : null,
      ageMinMonths: ageMinYears ? Number(ageMinYears) * 12 : null,
      ageMaxMonths: ageMaxYears ? Number(ageMaxYears) * 12 : null,
    };
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-4">
        <img src={data.coverPreviewUrl} alt="" className="h-40 w-28 shrink-0 rounded-md border border-border object-cover sm:h-48 sm:w-32" />
        <div className="flex min-w-0 flex-col gap-1 pt-1">
          <h2 className="text-lg font-semibold text-text-primary">{editing ? title : data.title}</h2>
          {data.authors.length > 0 && <p className="text-sm text-text-secondary">{editing ? authorsText : data.authors.join(", ")}</p>}
          <p className="text-sm text-text-muted">
            {ISO_639_1_LANGUAGE_NAMES[(editing ? languageCode : data.languageCode) as LanguageCode] ?? "Language not identified"}
          </p>
          {data.categoryLabel && <p className="text-sm text-text-muted">Category: {editing ? undefined : data.categoryLabel}</p>}
          {data.description && !editing && <p className="mt-1 text-sm text-text-secondary">{data.description}</p>}
        </div>
      </div>

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
