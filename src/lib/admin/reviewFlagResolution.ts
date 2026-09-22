/**
 * Phase 8 correction pass — which `review_flags.flag_type` values a given
 * admin decision genuinely addresses (§3). Previously, `finalizePendingBook()`
 * resolved nothing at all (leaving the newly-activated book's own
 * `low_identification_confidence` flag open, which could put it right back in
 * Needs Review via the queue's open-flag signal), and SAME EDITION duplicate
 * resolution resolved EVERY open flag on the archived placeholder regardless
 * of whether the decision actually addressed it. Both are wrong for the same
 * reason: a flag should only ever be marked resolved by the specific decision
 * that actually resolved the concern it represents — never as a side effect
 * of an unrelated action succeeding.
 *
 * Pure, exported constants (not a function of draft/DB state) — a Review
 * Later approval and a same-edition duplicate decision each address a FIXED,
 * predictable set of concerns by construction: approval always means "a human
 * looked at the identity and category and the duplicate ambiguity (if any)
 * was already resolved before approval could even proceed" (`approveReviewLater`'s
 * own unresolved-duplicate guard). `missing_metadata`, `metadata_conflict`,
 * `user_flagged`, `import_error`, and `visual_style_uncertain` are never in
 * either list — those require their own dedicated correction, not merely "an
 * admin approved this book."
 */
export const FLAG_TYPES_RESOLVED_BY_REVIEW_LATER_APPROVAL = [
  "low_identification_confidence",
  "teacher_requested_review",
  "category_uncertain",
  "duplicate_uncertain",
] as const;

/** Same-edition duplicate resolution never touches category concerns — the
 * placeholder is archived, not re-categorized, so a `category_uncertain` flag
 * on it was never actually addressed by "this is the same book we already
 * have." Archived books are excluded from the queue by construction
 * regardless (`reviewQueueSource.ts`'s `ne(books.reviewStatus, "archived")`),
 * so leaving this flag open is purely a truthfulness matter, not a queue
 * visibility one — see the phase brief's own "truthful history is preferable
 * to falsely saying an unrelated issue was resolved." */
export const FLAG_TYPES_RESOLVED_BY_SAME_EDITION_DUPLICATE = ["low_identification_confidence", "duplicate_uncertain", "teacher_requested_review"] as const;
