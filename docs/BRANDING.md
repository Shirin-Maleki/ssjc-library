# Branding

Status: **app name, color palette, typography, and the logo are all real**, provided by the
school (name/palette/type on 2026-09-14; the logo artwork itself a day later). Nothing left
in this system is a placeholder.

## What's real vs. placeholder right now

| Element | Status |
|---|---|
| App name ("SSJC Library") | **Real**, confirmed by the school |
| Typeface (Poppins for digital use) | **Real** — the school's own design system specifies this exact typeface for web/digital use |
| Color palette | **Real** — the school's official primary colors, mapped to semantic tokens below |
| Logo mark | **Real** — `public/brand/logo.png`, a transparent PNG, used as-is via `LogoMark` (`src/components/ui/Logo.tsx`) |

## Typography

The school's design system specifies two typefaces:

- **Campton** (primary) — reserved for official printed material: posters, brochures,
  special-event materials. **Not used in this application** — this is a web app, and the
  school's own guidelines scope Campton to print only.
- **Poppins** (secondary) — "a readily-available typeface meant for everyday and digital use
  such as weekly newsletters, website and other digital materials." This is exactly what
  Phase 1 already implemented (`next/font/google`, weights 400/500/600/700). The real brand
  system confirms Poppins was the correct choice for this product — no typeface change was
  needed.

One nuance worth recording: the school's typography guidance emphasizes a **single-story
lowercase "a"** in Campton specifically, for consistency with how children learn to
recognize and write letters. Poppins is designated for digital use regardless, so this
doesn't change the typeface choice here — but it's worth a visual double-check in a future
pass whether Poppins' own "a" shape is worth calling out to the school, rather than silently
assuming it doesn't matter.

## Color palette

The school's official primary colors, with their exact provided values:

| Swatch | Hex | RGB |
|---|---|---|
| Teal | `#6dbec6` | 109, 190, 198 |
| Coral/red | `#df3c51` | 223, 60, 81 |
| Yellow | `#efd51f` | 239, 213, 31 |
| Orange | `#e15e27` | 225, 94, 39 |
| Black | `#000000` | 0, 0, 0 |

The school's own guidance: *"Color should be used sparingly and as a complement to whitespace
or an otherwise neutral space."* That instruction is taken literally in how these map to
semantic tokens below — most of the interface stays neutral (black, white, warm grays); the
four accent hues are reserved for deliberate, small moments, not backgrounds or large fills.

### Mapping to semantic tokens — and why

| Token | Value | Source | Notes |
|---|---|---|---|
| `text-primary` / `brand-primary` | `#000000` | Official black, verbatim | Same value in both tokens deliberately — both represent the brand's literal black |
| `brand-secondary` | `#2a2a2a` | Derived (tint of black) | Hover state for brand-primary-filled buttons; teal was considered here first (see below) and rejected |
| `accent` | `#6dbec6` | Official teal, verbatim | **First real application landed in Phase 2** — see below. |
| `focus` | `#000000` | Official black, verbatim | See below — the official teal was considered and rejected here too |
| `warning` | `#b44b1f` | **Derived** (darkened from official orange `#e15e27`) | See contrast note below |
| `danger` | `#be3345` | **Derived** (darkened from official coral `#df3c51`) | See contrast note below |
| `success` | `#2f6f4e` | Not from the official palette | The school's palette has no green; this is a standalone functional addition, chosen to harmonize with the rest of the palette rather than clash with it. Flagged transparently — this is the one token here that isn't literally sourced from the brand system. |

Background, surface, and the neutral gray text/border tokens are unchanged from the earlier
placeholder values — the school's palette doesn't specify neutrals, and the existing warm
off-white/gray system already reads as "an otherwise neutral space" that lets the four accent
colors read clearly when they are eventually used.

### Why teal isn't used for buttons or focus rings

Two real, measured contrast failures ruled this out — verified with the same WCAG
relative-luminance method as `docs/ACCESSIBILITY.md`, not assumed:

- **Teal as a button hover fill:** white text on `#6dbec6` measures **2.14:1** — far under
  the 4.5:1 minimum for normal text. Black text on teal measures a healthy 9.83:1, but
  changing a button's text color on hover (rather than just its background) is an unusual,
  inconsistent pattern, so a neutral hover tint (`#2a2a2a`, a tint of brand black) was used
  instead.
- **Teal as a focus ring:** measures **2.02–2.14:1** against both the app's background and
  white surfaces — under WCAG 1.4.11's 3:1 minimum for a UI indicator that must be visible.
  Brand black is used instead, which measures at maximum contrast in every context.

Teal remains fully valid and *encouraged* for non-text, non-focus decorative use (badges,
small fills, illustration accents) — the contrast rules that ruled it out here are specific
to text-on-color and thin focus outlines, not decorative color use in general.

### Why `warning` and `danger` are darkened, not verbatim

The literal official orange (`#e15e27`) measures only 3.60:1 against white, and the literal
coral (`#df3c51`) measures 4.28:1 — both under the 4.5:1 AA minimum for normal text, and these
tokens are used for actual error/warning message text. Rather than silently picking an
unrelated red/orange, each was darkened (orange to 80% luminance, coral to 85%) until it
cleared AA against both white and its own light background tint:

| Pair | Ratio |
|---|---|
| `warning` (`#b44b1f`) on `warning-bg` (`#fdf1ea`) | 4.78:1 |
| `warning` (`#b44b1f`) on white | 5.29:1 |
| `danger` (`#be3345`) on `danger-bg` (`#fcedef`) | 4.93:1 |
| `danger` (`#be3345`) on white | 5.60:1 |

The **literal brand swatches remain correct** for large text, non-text decorative use, or any
context paired with a dark/black background (where contrast is no longer a problem) — the
darkened shades exist specifically because `warning`/`danger` are text-bearing UI states, not
because the school's official colors are somehow wrong.

## The accent color's first real use: the physical-category badge (Phase 2)

Every book result and detail view shows a "Located in [category]" badge — the physical
shelf location, which the product spec requires be "easy to visually locate and clearly
distinct from ordinary tags." This badge uses the official teal as a **light background
tint only** (`bg-accent/15`, `border-accent/40`), never as text color (teal fails text
contrast — see above), with the category name itself rendered in the normal dark text color.

The important restraint: **every category badge uses the same teal tint, regardless of which
category it names.** The color means "this is the shelf location," not "this specific
category" — so a result list never turns into a row of differently-colored badges. Ordinary
digital tags (`Tag.tsx`) stay a plain neutral gray, with no color-coding at all, precisely
because the brief warns against "chips becom[ing] a large rainbow row." One consistent
accent, spent on one consistent meaning, is the whole of Phase 2's decorative color use — the
other three brand hues (coral, orange, yellow) remain unused in the visible UI, still waiting
for a use case as clearly justified as this one.

## Logo

`public/brand/logo.png` is the real school logo — a hand-drawn, transparent-background PNG
(1000×950px). `LogoMark` (`src/components/ui/Logo.tsx`) renders it via `next/image`,
preserving its natural proportions (height computed from the caller's `size` using the
artwork's own 950:1000 ratio, never forced square) rather than the earlier placeholder SVG.
Used as-is, unmodified and unrecolored, per the standing instruction to never redraw or
alter the real logo without explicit direction.

### A real discrepancy worth knowing about: the logo's colors don't exactly match the official swatches

Measured directly from the pixel data (not eyeballed) via a small Python/Pillow script, the
logo's actual dominant colors are:

| In the logo artwork | Official palette swatch | Difference |
|---|---|---|
| `#83bcc3` (teal) | `#6dbec6` | Noticeably lighter/grayer |
| `#ebd64e` (yellow) | `#efd51f` | Less saturated, more muted |
| `#ce4b56` (coral) | `#df3c51` | Darker, more muted |
| `#000000` (black) | `#000000` | Exact match |
| `#d38d98` (dusty pink, on the antennae) | *(not in the 5-swatch official list at all)* | Appears to be a lighter tint of the coral, used for a highlight/accent within the artwork itself |

This is common and not a problem to "fix": hand-drawn or hand-painted artwork frequently
doesn't use perfectly flat, pre-defined hex values the way a vector-based brand guide
document does — blending, layering, and the drawing tool's own defaults all introduce natural
variation. **This project's semantic color tokens (`--color-accent`, etc., in
`globals.css`) intentionally continue to match the officially documented hex values from the
brand guide, not the logo file's actual pixel colors** — so the category badge, for instance,
uses precise `#6dbec6`, not the logo's softer `#83bcc3`. The logo renders with its own
original colors, exactly as provided; nothing about it was color-corrected or altered.

If the school would prefer the app's token palette to instead match the logo's actual
softer/more muted colors (rather than the brand guide's stated hex values), that's a
one-block edit to `globals.css` — flagging it here as a genuine open question, not assuming
an answer either way.

## App name

`src/config/site.ts::siteConfig.appName` = `"SSJC Library"`, consumed by the `<title>` tag,
the Welcome screen, and the header — one source, changing it anywhere is a one-line edit.
