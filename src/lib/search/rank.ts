import type { Book } from "@/lib/catalog/types";
import { bookMatchesAgeYears } from "@/lib/catalog/age";
import { getReadDurationBand } from "@/lib/catalog/duration";
import { FORMAT_LABELS } from "@/lib/catalog/labels";
import { meaningfulTokens, normalizeSearchText } from "./normalize";
import { parseSearchIntent } from "./intent";
import { MINIMUM_MEANINGFUL_SCORE, RANKING_WEIGHTS } from "./rankingConfig";

export type MatchReasonType =
  | "title_exact"
  | "title_prefix"
  | "title_partial"
  | "author"
  | "illustrator"
  | "publisher"
  | "category"
  | "tag"
  | "language"
  | "age"
  | "illustration_style"
  | "visual_realism"
  | "duration"
  | "format"
  | "fiction_type"
  | "description"
  | "exact_retrieval"
  | "fuzzy_match"
  | "semantic";

export interface MatchReason {
  type: MatchReasonType;
  value?: string;
}

export interface ScoredBook {
  book: Book;
  score: number;
  reasons: MatchReason[];
}

function containsAnyToken(normalizedText: string, tokens: string[]): boolean {
  return tokens.some((token) => normalizedText.includes(token));
}

/**
 * Whole-word variant of `containsAnyToken` — a query token must equal one of the
 * target text's own words exactly, not merely appear as a substring somewhere
 * inside a longer word. Used only for category and format matching (both small,
 * fixed label vocabularies where substring tolerance buys no real plural/typo
 * benefit but carries real false-positive risk), never for title/tag/description
 * matching, which intentionally keep the looser substring rule (docs/SEARCH.md:
 * "animal" should match the tag "animals").
 *
 * Real-provider validation finding (2026-09-17): a live manual product check with
 * real Gemini embeddings showed "A Little Bit of Music and Movement" and "Kitchen
 * Helpers" — both tagged/categorized "Everyday Life & Play" — ranking above
 * genuinely relevant books for the query "a gentle story about saying goodbye to a
 * parent for the day", because the token "day" is a literal substring of
 * "everyday" and `containsAnyToken`'s plain substring check doesn't respect word
 * boundaries. The exact same class of bug the "age"/"courage" fix
 * (`docs/SEARCH.md`) already documents, in a new field — but here stop-wording the
 * one colliding word ("day" is a genuinely meaningful word in other queries, e.g.
 * "a snowy day," unlike "age"/"year"/"minute," which are pure scaffolding already
 * redundantly extracted by the age/duration intent parser) would throw away real
 * signal, so the fix is word-boundary matching at the two call sites where a fixed,
 * small label vocabulary makes it safe.
 */
function containsAnyWholeWordToken(normalizedText: string, tokens: string[]): boolean {
  const words = new Set(normalizedText.split(" ").filter(Boolean));
  return tokens.some((token) => words.has(token));
}

/**
 * For named entities (author/illustrator/publisher) specifically: requires every word
 * of the entity's own name to appear among the query's tokens, not just any single
 * shared word. Without this, "books by Eric Carle" also matched "Eric Hill" on the
 * shared first name alone — a real false positive caught by testing against the
 * fixture catalog, not a hypothetical. A query token set may still contain extra
 * words beyond the name (e.g. "Eric Carle animal books"); only the entity's own
 * tokens need to be a subset of it.
 */
function matchesWholeEntityName(entityValue: string, queryTokens: string[]): boolean {
  const entityTokens = normalizeSearchText(entityValue).split(" ").filter(Boolean);
  return entityTokens.length > 0 && entityTokens.every((token) => queryTokens.includes(token));
}

/**
 * Scores a single book against a free-text query. Every contribution is additive and
 * non-negative — a book with no matching signal at all scores exactly 0, which
 * `rankBooks` treats as "not a meaningful result," never padding results with noise.
 * See docs/SEARCH.md for the full weight table and reasoning.
 */
export function scoreBook(book: Book, query: string): ScoredBook {
  const reasons: MatchReason[] = [];
  let score = 0;

  const normalizedQuery = normalizeSearchText(query);
  const tokens = meaningfulTokens(query);
  const intent = parseSearchIntent(query);

  const normalizedTitle = normalizeSearchText(book.title);
  if (normalizedQuery.length > 0) {
    if (normalizedTitle === normalizedQuery) {
      score += RANKING_WEIGHTS.exactTitle;
      reasons.push({ type: "title_exact" });
    } else if (normalizedQuery.length >= 3 && normalizedTitle.startsWith(normalizedQuery)) {
      score += RANKING_WEIGHTS.titlePrefix;
      reasons.push({ type: "title_prefix" });
    } else if (tokens.length && containsAnyToken(normalizedTitle, tokens)) {
      score += RANKING_WEIGHTS.titlePartial;
      reasons.push({ type: "title_partial" });
    }
  }

  if (tokens.length) {
    const matchedAuthor = book.authors.find((author) => matchesWholeEntityName(author, tokens));
    if (matchedAuthor) {
      score += RANKING_WEIGHTS.author;
      reasons.push({ type: "author", value: matchedAuthor });
    }

    const matchedIllustrator = (book.illustrators ?? []).find((name) => matchesWholeEntityName(name, tokens));
    if (matchedIllustrator) {
      score += RANKING_WEIGHTS.illustrator;
      reasons.push({ type: "illustrator", value: matchedIllustrator });
    }

    if (matchesWholeEntityName(book.publisher, tokens)) {
      score += RANKING_WEIGHTS.publisherOrImprint;
      reasons.push({ type: "publisher", value: book.publisher });
    } else if (book.imprint && matchesWholeEntityName(book.imprint, tokens)) {
      score += RANKING_WEIGHTS.publisherOrImprint;
      reasons.push({ type: "publisher", value: book.imprint });
    }

    if (containsAnyWholeWordToken(normalizeSearchText(book.physicalCategory), tokens)) {
      score += RANKING_WEIGHTS.physicalCategory;
      reasons.push({ type: "category", value: book.physicalCategory });
    }

    const matchedTag = book.tags.find((tag) => containsAnyToken(normalizeSearchText(tag), tokens));
    if (matchedTag) {
      score += RANKING_WEIGHTS.tagOrTopic;
      reasons.push({ type: "tag", value: matchedTag });
    }

    // An unrecorded format/fiction status contributes no signal at all — never
    // matched, never scored (Phase 5 correction pass).
    if (book.format) {
      const formatLabel = normalizeSearchText(FORMAT_LABELS[book.format]);
      if (containsAnyWholeWordToken(formatLabel, tokens)) {
        score += RANKING_WEIGHTS.formatOrFictionType;
        reasons.push({ type: "format", value: book.format });
      }
    }
    if (book.fictionType && tokens.includes(book.fictionType)) {
      score += RANKING_WEIGHTS.formatOrFictionType;
      reasons.push({ type: "fiction_type", value: book.fictionType });
    }

    if (containsAnyToken(normalizeSearchText(book.description), tokens)) {
      score += RANKING_WEIGHTS.descriptionKeyword;
      reasons.push({ type: "description" });
    }
  }

  // A book matches a free-text language mention via either its primary or an
  // additional language (Phase 5 correction pass — parity with the explicit-filter
  // and facet behavior `docs/DECISIONS.md` already established in Phase 4).
  if (
    intent.languageCode &&
    (book.languageCode === intent.languageCode || (book.additionalLanguageCodes ?? []).includes(intent.languageCode))
  ) {
    score += RANKING_WEIGHTS.languageIntent;
    reasons.push({ type: "language", value: intent.languageCode });
  }

  if (typeof intent.ageYears === "number" && bookMatchesAgeYears(book, intent.ageYears)) {
    score += RANKING_WEIGHTS.ageIntent;
    reasons.push({ type: "age" });
  }

  if (intent.illustrationStyle && book.illustrationStyles.includes(intent.illustrationStyle)) {
    score += RANKING_WEIGHTS.illustrationStyleIntent;
    reasons.push({ type: "illustration_style", value: intent.illustrationStyle });
  }

  if (book.visualRealism && intent.visualRealism && intent.visualRealism.includes(book.visualRealism)) {
    score += RANKING_WEIGHTS.visualRealismIntent;
    reasons.push({ type: "visual_realism", value: book.visualRealism });
  }

  if (intent.durationBand && getReadDurationBand(book.readAloudMinutes) === intent.durationBand) {
    score += RANKING_WEIGHTS.durationIntent;
    reasons.push({ type: "duration", value: intent.durationBand });
  }

  return { book, score, reasons };
}

/**
 * Ranks books by score, descending, breaking ties alphabetically by sort title for a
 * deterministic order (docs/SEARCH.md). Books scoring at or below
 * MINIMUM_MEANINGFUL_SCORE are excluded entirely — never padded into the list.
 */
export function rankBooks(books: Book[], query: string): ScoredBook[] {
  const trimmedQuery = query.trim();

  if (trimmedQuery.length === 0) {
    return [...books]
      .sort((a, b) => a.sortTitle.localeCompare(b.sortTitle))
      .map((book) => ({ book, score: 0, reasons: [] }));
  }

  return books
    .map((book) => scoreBook(book, trimmedQuery))
    .filter((scored) => scored.score > MINIMUM_MEANINGFUL_SCORE)
    .sort((a, b) => b.score - a.score || a.book.sortTitle.localeCompare(b.book.sortTitle));
}
