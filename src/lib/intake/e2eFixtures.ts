import type { CoverIdentification } from "@/lib/ai/schemas";
import type { NormalizedMetadataCandidate } from "@/lib/metadataProviders/provider";
import { isE2EFakeProvidersEnabled } from "@/lib/e2eTestFlags";

export { isE2EFakeProvidersEnabled };

/**
 * The one, narrowly-scoped seam that makes Phase 7's E2E suite possible without
 * ever calling a live external API (§49 of the phase brief: "deterministic fake
 * external providers... never live APIs in ordinary CI"). Active ONLY when
 * `E2E_FAKE_INTAKE_PROVIDERS=true` — set exclusively in `playwright.config.ts`'s
 * `webServer.env`, never in a real deployment. In every other environment
 * `isE2EFakeProvidersEnabled()` returns `false` and every branch that checks it is
 * dead code.
 *
 * Deliberately NOT a parallel `CoverStorageProvider`/`BookVisionProvider` class
 * hierarchy — Google Books/Open Library metadata search is already made inert for
 * E2E by returning zero configured providers (`src/lib/metadataProviders/index.ts`),
 * and Gemini enrichment already degrades gracefully to `null` when
 * `GEMINI_API_KEY` is unset (unchanged, real, already-tested behavior — E2E simply
 * never sets that key). The two remaining call sites that have NO graceful
 * "unconfigured" path of their own — the Drive upload route
 * (`src/app/api/intake/cover/route.ts`) and cover identification
 * (`identifyCoverAction` in `actions.ts`) — branch directly on this flag instead.
 * One filename-keyed fixture scenario lives directly in `identifyCoverAction`
 * rather than as a `buildFakeCoverEvidence`/`buildFakeMetadataCandidates` branch
 * here — a filename containing "serviceunavailable" makes it return a real
 * `identification_unavailable` failure result (real-cover correction pass, final
 * round §2), since there is no real provider call to make throw in fake mode.
 *
 * The vision fixture is keyed off the uploaded filename (the one thing an E2E test
 * controls without any new protocol): a filename containing "gruffalo" produces
 * evidence matching the real seeded "The Gruffalo" fixture book exactly, so a test
 * can deterministically exercise the real duplicate-detection path against the
 * real seeded catalog. Any other filename produces a title built from the
 * filename's own words PLUS a fresh `randomUUID()` generated on every call —
 * empirically necessary, not defensive decoration: the E2E database is only
 * truncated once per whole run (not per test, and the desktop/mobile Playwright
 * projects share one running server and database), so several real, distinct
 * observed failures during Phase 7 implementation traced back to two different
 * test-created titles being similar enough, by real measured `pg_trgm`
 * similarity, to trip the duplicate matcher's own 0.4 floor — first from a shared
 * literal prefix, then from a shared millisecond-resolution timestamp suffix. A
 * full random UUID measured at 0.01-0.25 similarity against another instance of
 * the same scheme in this same database, comfortably under the floor. Generating
 * it here (not asking every test author to remember a "make the filename unique"
 * convention) makes a future test's title collision structurally impossible
 * rather than a matter of test-writing discipline.
 */
const BASE_EVIDENCE: CoverIdentification = {
  visibleTitle: null,
  visibleSubtitle: null,
  visibleAuthors: null,
  visibleIllustrators: null,
  visiblePublisherOrImprint: null,
  visibleLanguage: null,
  visibleIsbn: null,
  visibleSeries: null,
  candidateSearchTerms: [],
  identityConfidenceLevel: "high",
  evidenceNotes: "E2E fixture evidence — not a real vision call.",
};

export function buildFakeCoverEvidence(filename: string): CoverIdentification {
  if (filename.toLowerCase().includes("gruffalo")) {
    return {
      ...BASE_EVIDENCE,
      visibleTitle: "The Gruffalo",
      visibleAuthors: ["Julia Donaldson"],
      visibleIllustrators: ["Axel Scheffler"],
      visiblePublisherOrImprint: "Macmillan Children's Books",
      visibleLanguage: "English",
      visibleIsbn: "9780333710937",
    };
  }
  if (filename.toLowerCase().includes("unreadable")) {
    // Simulates a real vision call that runs without throwing but genuinely can't
    // read the cover (real-cover correction pass §5/§8) — no visible title, no
    // search evidence at all. Exercises the identify_recovery UI end to end
    // without depending on a live, quota-limited Gemini call.
    return {
      ...BASE_EVIDENCE,
      visibleTitle: null,
      visibleAuthors: null,
      identityConfidenceLevel: "low",
      evidenceNotes: "E2E fixture evidence — simulates a cover Gemini could not read.",
    };
  }
  if (filename.toLowerCase().includes("similartitle")) {
    // Same real seeded title, deliberately no ISBN and a different author — lands
    // in same_title_different_edition (Phase 7 correction pass §3: title alone is
    // never enough for an exact-edition claim), the AMBIGUOUS duplicate UI path,
    // for E2E coverage of the "Different book" flow (§4).
    return {
      ...BASE_EVIDENCE,
      visibleTitle: "The Gruffalo",
      visibleAuthors: ["A Totally Different Author"],
      visibleLanguage: "English",
    };
  }
  const words = filename
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return {
    ...BASE_EVIDENCE,
    visibleTitle: `${words.join(" ")} ${crypto.randomUUID()}`,
    visibleAuthors: ["E2E Fixture Author"],
    visibleLanguage: "English",
  };
}

/**
 * Fake metadata-lookup candidates (`lookupMetadataAction`'s fake-mode branch)
 * — separate from vision evidence because real metadata lookup is a genuinely
 * distinct pipeline step. Only a filename containing "displaycover" gets a
 * candidate at all (with a real-shaped, trusted `thumbnailUrl`), so the E2E
 * suite can exercise the actual display-cover save-and-render path
 * end-to-end (Phase 7 correction pass §2) without every other fixture
 * scenario's `high_confidence`/ISBN-match behavior changing. The identifier
 * embeds the same evidence title so reconciliation's own real title-matching
 * logic — not a shortcut — is what produces `high_confidence` here.
 */
export function buildFakeMetadataCandidates(filename: string, evidenceTitle: string | null): NormalizedMetadataCandidate[] {
  if (!filename.toLowerCase().includes("displaycover") || !evidenceTitle) return [];
  return [
    {
      provider: "open_library",
      providerIdentifier: `e2e-fixture-${crypto.randomUUID()}`,
      title: evidenceTitle,
      authors: ["E2E Fixture Author"],
      language: "eng",
      thumbnailUrl: "https://covers.openlibrary.org/b/id/8225631-M.jpg",
    },
  ];
}
