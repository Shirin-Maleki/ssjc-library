# Accessibility

Status: reflects what Phase 1 actually implements and verifies. This is the accessibility
foundation the brief requires from the start, not a checklist deferred to a later "polish"
phase.

## Semantic structure

- **Landmarks:** `<header>` (site identity + logout, shared across every staff/admin page),
  `<main>` on the Welcome screen, `<nav aria-label="More library tools">` around the
  secondary Home navigation.
- **Heading hierarchy:** exactly one `<h1>` per page (Welcome: the app name; each placeholder
  page: its own title; Admin: "Admin" in both its unlock and placeholder states). Home's `<h1>`
  is visually hidden (`sr-only`) — sighted users get the two dominant tiles immediately with
  no extra visual heading clutter, while screen-reader users still get correct page structure.
  "Find a Book" / "Add a Book" are `<h2>` elements (initially built as plain `<span>`s, caught
  by an E2E test expecting a heading role and fixed — see `docs/TESTING.md`).
- **Forms:** every input has a real `<label htmlFor>` association (`PasswordInput`), not a
  placeholder-as-label anti-pattern. Errors are associated via `aria-describedby` and
  `aria-invalid`, and rendered as `<p role="alert">` (an implicit assertive live region) — no
  `aria-live` was hand-added since `role="alert"` already provides it.

## Keyboard navigation

Verified by real E2E tests, not just asserted: tabbing to "Tap to Enter" and pressing Enter
reveals the password field; filling it and pressing Enter (no mouse) submits the form and
reaches Home. All interactive elements are real `<button>`/`<a>`/`<input>` elements, so tab
order follows document order with no custom `tabindex` needed anywhere.

## Focus visibility

One global rule (`:focus-visible` in `globals.css`) applies a consistent 2px outline using the
dedicated `--color-focus` token across every interactive element — no component defines its
own focus style, so there's no risk of an inconsistent or missing focus ring anywhere.

## Touch targets

Buttons are 48px (`h-12`) or 56px (`h-14`) tall; the primary Home tiles have generous padding
well beyond minimum tap-target guidance; the password show/hide toggle is a real button with
adequate padding, not a bare icon.

## Reduced motion

One global rule (`@media (prefers-reduced-motion: reduce)`) collapses all animations and
transitions to ~0ms. The only animation in Phase 1 (the Welcome password field's reveal) is a
plain CSS `@keyframes` triggered on mount — no JavaScript timing logic to separately gate on
`prefers-reduced-motion`, since the global CSS rule already neutralizes it.

## Color contrast — verified, not assumed

Every token pair actually used for text was checked against the WCAG relative-luminance
formula (a small script, not a visual guess) before this phase was considered done:

| Pair | Ratio | Result |
|---|---|---|
| `text-primary` (`#000000`) on `background` | 19.81:1 | Passes AAA |
| `text-secondary` on `background` | 7.21:1 | Passes AAA |
| `text-muted` on `background` | 3.42:1 → **fixed to 5.31:1** | Was failing AA (4.5:1 required for normal text) — the token was darkened from `#8a867d` to `#6b675f` |
| `danger` (`#be3345`, a darkened shade of the school's official coral) on `danger-bg` | 4.93:1 | Passes AA — see `docs/BRANDING.md` for why the literal brand swatch (4.28:1) needed darkening for text use |
| `warning` (`#b44b1f`, a darkened shade of the school's official orange) on `warning-bg` | 4.78:1 | Passes AA — same reasoning as `danger` |
| default `border` on `surface` | 1.34:1 | Acceptable — decorative/structural only (card outlines, dividers), not relied on alone to convey an interactive boundary |
| `border-input` on `surface` | 3.01:1 | Passes WCAG 1.4.11's 3:1 non-text contrast minimum for form-control boundaries |
| `focus` (brand black) on `background`/`surface` | 19.81:1 / 21.00:1 | Passes at maximum contrast — the school's official teal was considered here and measured only 2.02–2.14:1, well under the 3:1 minimum for a UI indicator; see `docs/BRANDING.md` |

The second finding (`border`) is why `PasswordInput` now uses a dedicated `border-input`
token instead of the general-purpose `border` token: an input field's boundary is the only
cue to where it can be clicked/typed into, which WCAG 1.4.11 holds to a 3:1 minimum — a card
outline, which has other visual cues (fill, content, whitespace) establishing its boundary,
is treated differently and was deliberately left soft, matching the calm/restrained visual
direction. See `docs/DECISIONS.md` for this reasoning recorded as a decision, and
`src/app/globals.css` for both tokens with their measured ratios in comments.

## No information conveyed by color alone

The error state on `PasswordInput` is never color-only: an invalid field gets a red border
*and* a visible text error message *and* `aria-invalid="true"`. Admin/staff distinction is
communicated through actual page content ("Enter the admin password to continue" /
"Review queues...") — never a color badge alone.

## Phase 2 additions: Find a Book

- **Combobox pattern** (`SearchInput`): the search field uses `role="combobox"` with
  `aria-expanded`, `aria-controls`, and `aria-autocomplete="list"`; the suggestion list is a
  real `role="listbox"` of `role="option"` elements, with the active one communicated via
  `aria-activedescendant` (not by moving DOM focus into the list, which would fight normal
  text input). Arrow Up/Down moves the active suggestion, Enter selects it (or submits the
  typed text if none is active), Escape closes the list without clearing the input. Verified
  end to end with real keyboard-only Playwright interaction, not just inline code review.
- **Filter dialog** (`FilterDialog`): built on Radix's Dialog primitive specifically for its
  correct, well-tested focus trap, `Escape`-to-close, and labelling — exactly the "reuse an
  existing accessible primitive" the brief asks for rather than hand-rolling one. Every
  filter group is a real `<fieldset>`/`<legend>` with real (visually restyled but not
  visually hidden from assistive tech) checkboxes; a real fix was needed here — see below.
- **A real focus-visibility bug caught during this phase:** filter checkboxes are visually
  restyled as pill buttons, with the actual `<input type="checkbox">` hidden via `sr-only`
  inside a wrapping `<label>`. The global `:focus-visible` rule targets the *focused element
  itself*, but a hidden 0-size input's own outline is invisible — so keyboard users tabbing
  through filters would see no focus indicator at all. Fixed with `:focus-within` on the
  *label* (the parent), which is the correct pseudo-class for "one of my descendants has
  focus," since `:focus-visible` doesn't cascade to an ancestor via `peer`/sibling selectors
  the way it would if the input and label were siblings.
- **Age control**: real `<button aria-pressed>` elements, not a slider — deliberately, per
  the brief's caution against implying developmental-science precision a slider would
  suggest.
- **Active filters** (`ActiveFilters`) and **quick category pills** (`CategoryQuickPills`)
  are each a labelled `role="group"`, so a screen-reader user can distinguish "the pills that
  add a filter" from "the chips that remove one" even though both render as small rounded
  links. Each removable chip's accessible name comes from a dedicated sr-only "Remove X
  filter" span — the visible "×" glyph is `aria-hidden`, since a decorative glyph has no
  business being read aloud as part of the name (and, being `aria-hidden`, is correctly
  excluded from it, which a first draft of this phase's E2E tests initially got wrong before
  the tests were fixed).
- **Book covers** are `role="img"` with an `aria-label` of "Cover of {title}" — informative,
  not redundant with the title text already displayed beside it in normal reading order.
- **Heading hierarchy**: Find's own `<h1>` is `sr-only` (mirroring Home's pattern from Phase
  1) since the search input itself is the page's obvious focal point for sighted users; "Top
  matches" is a real `<h2>`; each result's title is a real `<h3>` containing the link to
  its detail page — verified by an E2E assertion using `getByRole("heading", { level: 3 })`,
  not just visual inspection.
- **Live region**: the results-count line ("N matches") is `aria-live="polite"`, so a screen
  reader user who just changed a filter or query hears the updated count without needing to
  re-navigate to find it.

## What's deliberately not done yet

No screen-reader-specific microphone control (voice search is Phase 3). No skip-to-content
link yet — each page's content starts immediately after a slim header, and there's no long
repeated navigation block to skip past yet; worth revisiting once Add/Admin get real content
in later phases.
