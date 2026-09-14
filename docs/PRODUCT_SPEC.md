# Product Specification

Status: Phase 0 — living document, organized from the founding project brief. This is a
structured reference, not a replacement for the original brief; where this document
summarizes, the original brief remains the source of truth for exact wording.

## 1. Mission

Build the practical operating system for the physical children's-book library at
Scandinavian School of Jersey City: finding books, discovering books by teaching need,
knowing where books physically belong, adding new/donated books, maintaining rich metadata,
evolving taxonomy, catching duplicates, and generating a simplified teacher-facing catalog —
while remaining simple enough physically that the library survives even if the app disappears.

The guiding question for every design decision: **"Can a busy teacher find or add a book
with almost no training?"**

This is simultaneously a real deployable tool and a professional UX/product design
portfolio piece, so it must also demonstrate strong IA, accessibility, meaningful (not
decorative) AI integration, and clean documentation — without ever sacrificing usability for
sophistication.

## 2. Who this is for

**Staff only.** Teachers and administrators are the users. The school is intentionally
screen-light for children; children may browse books physically, but there is no child
account, no child-facing screen, and no gamification anywhere in this product.

There are exactly two access levels, both shared secrets rather than individual accounts:

- **Staff** — default access after entering the shared staff password.
- **Admin** — staff access plus a second password/PIN, unlocking metadata editing, review
  queues, taxonomy management, and bulk-import controls.

No per-teacher identity exists anywhere in the system (see [`docs/DECISIONS.md`](DECISIONS.md)).

## 3. Non-negotiable principles

1. **Teachers are the users, not children** — no child accounts/screens/gamification.
2. **Physical organization stays simple** — one required primary physical category per book;
   unlimited digital tags. The physical system must survive without the app.
3. **No hallucinated inventory** — search/recommendations only ever surface books actually in
   this library's catalog. Fewer honest results beat padded fake ones.
4. **AI suggests, humans decide** — AI may identify, research, tag, summarize, classify,
   rank, and flag uncertainty. AI may never silently create a physical category, overwrite
   verified metadata, merge or delete records, or make any other irreversible change.
5. **Intake must be fast** — roughly 30–60 seconds of teacher attention per book added; no
   large metadata forms shown to regular staff.
6. **Everything important is reversible** — configurable, documented, easy to change; never
   a hard-coded assumption buried in application code.

## 4. Platform

A responsive web application (not a native app, not a PWA in v1) that works well on iPhone
Safari, Android mobile browsers, tablets, and desktop browsers. See
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md) for the concrete stack.

## 5. Information architecture

**Welcome / lock screen** → shared staff password → **Home**, whose only two dominant
actions are:

1. **Find a Book**
2. **Add a Book**

Quieter secondary actions from Home: Reading Lists, Library Guide, Teacher Catalog
(outbound link to the generated Google Sheet), Admin.

### Full v1 screen/state inventory

These are conceptual states, not necessarily 1:1 routes:

1. Welcome / password gate
2. Home
3. Find a Book
4. Search results
5. Book detail
6. Browse / filters
7. Add a Book — camera capture
8. Add a Book — processing
9. Add a Book — possible duplicate
10. Add a Book — confirmation
11. Add a Book — quick edit
12. Add a Book — success / shelving instruction
13. Reading lists
14. Reading list detail
15. Create reading list
16. Library guide
17. Teacher catalog (outbound action)
18. Admin unlock
19. Admin dashboard
20. Admin review queue
21. Admin book detail / full edit
22. Admin duplicate resolution
23. Admin taxonomy management
24. Admin taxonomy suggestions
25. Admin category health
26. Admin bulk import
27. Admin Google Sheet sync

## 6. Find a Book

Three discovery paths, all converging on the same search pipeline (see
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md) §7):

- **Voice search** — browser speech recognition as primary; typed search always available as
  fallback; transcript visible/editable; no audio is ever persisted; subtle in-UI reminder
  not to include children's names or identifying details.
- **Text / natural-language search** — handles title, author, illustrator, publisher,
  imprint, physical category, theme, topic, age, language, format, fiction/nonfiction,
  visual style, reading duration, teaching situation, and combinations thereof.
- **Browse + filter** — a conventional, AI-free path: age range, language, fiction/nonfiction,
  physical category, topics/themes, author, illustrator, publisher/imprint,
  illustration/visual media, realism/visual type, read-aloud duration band, format. Uses
  progressive disclosure on mobile rather than showing every filter at once.

Autocomplete is driven entirely by real catalog data (titles, contributors, publishers,
categories, topics, languages, styles, formats) — never a hard-coded suggestion list.

**Result behavior:** top 5 ranked results by default, fewer if fewer than 5 genuinely match,
never padded. Each result shows cover, title, author, short description, age, matching tags,
fiction/nonfiction, media type, duration, language, primary physical category, and a
matching explanation grounded in actual matched attributes (never free-form invented
reasoning).

A "Open Teacher Catalog" action links out to the generated, read-only Google Sheet.

## 7. Add a Book

Single front-cover photo only in v1 (no barcode, no back cover, no title page). Flow:
capture → upload original to Drive → identify → check duplicates → enrich metadata →
classify visuals → generate description → assign tags → suggest one existing physical
category → compute confidence → **teacher confirmation** with exactly three actions:

1. **Confirm** — accept and save; show shelving instruction.
2. **Quick Edit** — correct only a small set of teacher-realistic fields (physical category,
   language, age range, fiction/nonfiction, format/size exception). No AI internals, no
   provenance, no raw tags exposed here.
3. **Review Later** — save in a usable state, flag for admin review.

Meaningful progress stages are shown during processing; never a blank spinner.

## 8. Duplicate handling

Distinguish exact copy/same edition (increment copy count on one record), same title/different
edition, same work/different language (separate records, optionally linked via a shared work
group), and false match. Multiple photographs of the same cover never silently imply multiple
copies — always routed through a human decision when uncertain.

## 9. Taxonomy

Physical categories are database-managed, never hard-coded, and AI never creates one
automatically. AI selects the single best existing category per book; low-confidence cases
are left for review rather than guessed. Over time, the system surfaces **taxonomy
suggestions** (evidence-backed proposals for new/merged categories) and **category health**
signals (size, growth, low-confidence rate, heterogeneity) for admin judgment — never
automatic taxonomy changes. The old library's category list (Technology & Engineering, Outer
Space, Global Connections, Sports/Movement/Meditation, Seasonal/Favorites, Phonics, Board
Books, etc.) is treated strictly as **research input**, not a final taxonomy — it visibly
mixes subject, genre, format, curriculum, and seasonal-collection concepts, which the new
system deliberately separates into distinct fields (primary physical category, digital tag,
format, seasonal/featured collection, curriculum tag).

Physical size/format exceptions (oversized, board/small) are human-set only — a cover photo
cannot reliably prove physical dimensions.

## 10. Reading lists

No accounts. A list requires only a name; "Created By" is optional free text, displayed as
"Anonymous" when blank. Any staff member can create, rename, delete a list, and add/remove
books. No ownership or permission model beyond that.

## 11. Library Guide

A concise, visual, non-technical explainer: how the library is organized, how to find/add/
return a book, why one physical category per book, what "Review Later" means, and how
reading lists work.

## 12. Admin

Action-oriented queues, not a stats dashboard: Needs Review, Possible Duplicates, Low
Confidence, Missing Metadata, Taxonomy Suggestions, Category Health, Recently Added, Import
Jobs, Google Sheet Sync. Full metadata editing and provenance visibility (externally sourced
vs. AI-inferred vs. human-verified, never presented as equivalent) lives here only — never in
the teacher-facing UI.

## 13. Explicit v1 scope boundaries

**Out of scope for v1** (do not build unless scope is explicitly revised): child-facing
interface, native iOS app, App Store distribution, individual teacher accounts, account-tied
favorites, circulation/checkout system, due dates, borrowing histories, barcode labels/unique
stickers, offline mode, analytics, push notifications, parent/student access or profiles,
automatic physical-category creation, public catalog, social/community features.

**Future-ready but not pre-built:** current classroom location, availability/circulation,
individual staff accounts, personalized lists, QR/barcode support, label printing, native
wrapper, analytics, classroom collections. The data model reserves space for these (see
[`docs/DATA_MODEL.md`](DATA_MODEL.md)) without building any supporting infrastructure now.

## 14. Privacy & child safety

No student data of any kind (no names, profiles, behavior notes, health, or family data)
exists anywhere in this product's scope. Voice audio is never persisted. Natural-language
search queries are not logged by default. Any future telemetry must be privacy-preserving and
opt-in, and must not include raw query contents by default.

## 15. Bulk import of the existing ~1,500 photos

Treated as a reusable, resumable ingestion system, not a one-off script — the same pipeline
used for single-book "Add a Book," run administratively in controlled, inspected batches
(≈20–30 first, then ≈100–150 for taxonomy research, only later the full collection). Never
processed all at once; every item's state is tracked and nothing is silently discarded.
