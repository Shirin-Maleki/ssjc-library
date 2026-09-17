import { createHash } from "node:crypto";
import { formatAgeRange } from "@/lib/catalog/age";
import { getReadDurationBand, DURATION_BAND_LABELS } from "@/lib/catalog/duration";
import {
  FICTION_TYPE_LABELS,
  FORMAT_LABELS,
  ILLUSTRATION_STYLE_LABELS,
  VISUAL_REALISM_LABELS,
} from "@/lib/catalog/labels";
import { getLanguageName } from "@/lib/catalog/languages";
import type {
  FictionType,
  Format,
  IllustrationStyle,
  LanguageCode,
  Tag,
  VisualRealism,
} from "@/lib/catalog/types";

/**
 * Bumped whenever the *composition* below changes (a field added/removed/reworded),
 * OR whenever a configured provider's own input-formatting contract changes in a way
 * that changes what's actually sent to the embedding model — not whenever a single
 * book's data changes. Stored alongside every embedding
 * (`books.embedding_composition_version`) so the backfill script can tell "this
 * book's embedding used an old composition/provider-contract" apart from "this
 * book's data changed since its embedding was made" (`embedding_source_hash`,
 * below). `docs/SEARCH.md` §5 / `docs/DECISIONS.md`.
 *
 * Bumped 1 → 2 in the Phase 5 correction pass: `GeminiEmbeddingProvider` began
 * wrapping this function's output in `gemini-embedding-2`'s documented asymmetric
 * retrieval task-instruction format ("title: none | text: …" for documents,
 * "task: search result | query: …" for a search query) before sending it to the
 * API — this function's own output text and `sourceHash` are unchanged, but what a
 * real Gemini call actually embeds is now different, so any embedding generated
 * under version 1 must be treated as stale. See `geminiProvider.ts`'s own comment
 * for the exact contract and its sourcing.
 */
export const EMBEDDING_COMPOSITION_VERSION = 2;

/**
 * Everything the deterministic document (and, by extension, the `search_text`/
 * `search_vector` full-text column — `src/db/seed.ts` builds both from the same
 * input) needs — plain teacher-facing values already resolved by the repository
 * layer, never a raw Drizzle row or a database id (`docs/SEARCH.md` §5: "no
 * provenance, audit, credentials, IDs, or operational metadata").
 */
export interface EmbeddingDocumentInput {
  title: string;
  subtitle?: string;
  description?: string;
  authors: string[];
  illustrators?: string[];
  publisher?: string;
  imprint?: string;
  categoryLabel?: string;
  tags: Tag[];
  languageCode: LanguageCode;
  additionalLanguageCodes?: LanguageCode[];
  fictionType?: FictionType;
  format?: Format;
  illustrationStyles: IllustrationStyle[];
  visualRealism?: VisualRealism;
  ageMinMonths?: number;
  ageMaxMonths?: number;
  readAloudMinutes?: number;
}

export interface EmbeddingDocument {
  /** The exact plain-text document a provider would embed / Postgres would index
   * for full-text search — one line per populated field, stable field order. */
  text: string;
  version: number;
  /** SHA-256 of `text` — the precise "would re-generating change anything"
   * check, independent of `version` (which only changes when the composition
   * itself is edited, not when one book's data is). */
  sourceHash: string;
}

function line(label: string, value: string | undefined | null): string | null {
  if (!value) return null;
  return `${label}: ${value}`;
}

function listLine(label: string, values: string[] | undefined): string | null {
  if (!values || values.length === 0) return null;
  return `${label}: ${values.join(", ")}`;
}

/**
 * The single deterministic function constructing the text embedded/indexed for a
 * book — stable field order, stable sort on multi-valued relations, no raw row
 * serialization. Two calls with the same input always produce byte-identical output
 * (covered by snapshot tests), which is what makes `sourceHash` meaningful as a
 * staleness check.
 */
export function buildEmbeddingDocument(input: EmbeddingDocumentInput): EmbeddingDocument {
  const languageNames = [
    getLanguageName(input.languageCode),
    ...(input.additionalLanguageCodes ?? []).map((code) => getLanguageName(code)),
  ];

  const lines = [
    line("Title", input.subtitle ? `${input.title} — ${input.subtitle}` : input.title),
    listLine("Authors", input.authors),
    listLine("Illustrators", input.illustrators),
    line("Publisher", input.imprint ? `${input.publisher ?? ""} (${input.imprint})`.trim() : input.publisher),
    line("Category", input.categoryLabel),
    // Tags are sorted alphabetically — their storage/join order carries no meaning,
    // unlike authors (credited order) or illustration styles (as recorded).
    listLine("Topics", [...input.tags].sort((a, b) => a.localeCompare(b))),
    listLine("Languages", languageNames),
    line("Type", input.fictionType ? FICTION_TYPE_LABELS[input.fictionType] : undefined),
    line("Format", input.format ? FORMAT_LABELS[input.format] : undefined),
    listLine("Illustration style", input.illustrationStyles.map((style) => ILLUSTRATION_STYLE_LABELS[style])),
    line("Visual style", input.visualRealism ? VISUAL_REALISM_LABELS[input.visualRealism] : undefined),
    line("Age", formatAgeRange(input.ageMinMonths, input.ageMaxMonths)),
    line(
      "Read-aloud length",
      (() => {
        const band = getReadDurationBand(input.readAloudMinutes);
        return band ? DURATION_BAND_LABELS[band] : undefined;
      })()
    ),
    line("Description", input.description),
  ].filter((entry): entry is string => entry !== null);

  const text = lines.join("\n");
  const sourceHash = createHash("sha256").update(text).digest("hex");

  return { text, version: EMBEDDING_COMPOSITION_VERSION, sourceHash };
}

/**
 * The text Postgres full-text-indexes (`books.search_text` → `search_vector`,
 * `docs/SEARCH.md` §3) — deliberately a *different* derivation from
 * `buildEmbeddingDocument`, not the same text reused, even though both start from the
 * same `EmbeddingDocumentInput`.
 *
 * `buildEmbeddingDocument`'s "Label: value" lines (e.g. "Read-aloud length: Under 5
 * minutes") are good for a semantic embedding model, which reasons about meaning, but
 * actively wrong for literal lexeme full-text search: verified directly against the
 * dev DB that the single word "Read" in the "Read-aloud length" label alone caused
 * `to_tsvector` to match all 48 seeded books for a query as generic as "something to
 * read please" — a structural label, present in every single record, has zero
 * discriminative value for FTS and must never be searchable as if it were content.
 * Classifier fields (type/format/visual style/age/duration) are already reachable
 * through Layer 2's structured filters; free-text search only needs the genuinely
 * distinguishing named-entity and descriptive fields below, with no label words at
 * all — only real values, so a document can never match on its own scaffolding.
 */
export function buildSearchIndexText(input: EmbeddingDocumentInput): string {
  const languageNames = [
    getLanguageName(input.languageCode),
    ...(input.additionalLanguageCodes ?? []).map((code) => getLanguageName(code)),
  ];

  const values = [
    input.subtitle ? `${input.title} ${input.subtitle}` : input.title,
    ...input.authors,
    ...(input.illustrators ?? []),
    input.publisher,
    input.imprint,
    input.categoryLabel,
    ...[...input.tags].sort((a, b) => a.localeCompare(b)),
    ...languageNames,
    input.fictionType ? FICTION_TYPE_LABELS[input.fictionType] : undefined,
    input.format ? FORMAT_LABELS[input.format] : undefined,
    ...input.illustrationStyles.map((style) => ILLUSTRATION_STYLE_LABELS[style]),
    input.visualRealism ? VISUAL_REALISM_LABELS[input.visualRealism] : undefined,
    input.description,
  ].filter((entry): entry is string => Boolean(entry));

  return values.join("\n");
}
