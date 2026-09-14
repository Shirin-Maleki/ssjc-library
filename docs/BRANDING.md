# Branding

Status: **pending.** No real school logo or color palette has been provided. Everything
described below is a deliberately neutral placeholder, built so the real assets can be
dropped in with a small, localized change — never a hunt through components.

## What's real vs. placeholder right now

| Element | Status |
|---|---|
| Typeface (Poppins) | **Confirmed, real** — not a placeholder |
| App name ("Scandinavian School Library") | Placeholder — a working name, in `src/config/site.ts` |
| Logo | Placeholder — an abstract open-book glyph, `src/components/ui/Logo.tsx` |
| Color palette | Placeholder — restrained neutral tones, `src/app/globals.css` |

## Typography

Poppins, loaded via `next/font/google` in `src/app/layout.tsx`, weights 400/500/600/700 only
(no unused weights fetched). Applied through one CSS variable
(`--font-poppins` → `--font-sans`) — no component sets its own font-family.

## Color tokens

Every color in the app is a semantic CSS custom property defined once in
`src/app/globals.css`, never a raw hex value in a component:

```
--color-background        --color-brand-primary     --color-success / -bg
--color-surface           --color-brand-secondary    --color-warning / -bg
--color-surface-subtle    --color-accent             --color-danger / -bg
--color-text-primary      --color-border
--color-text-secondary    --color-border-strong
--color-text-muted        --color-border-input
--color-text-on-brand     --color-focus
```

Current placeholder values are a warm, neutral, mostly-monochrome palette (off-white
background, charcoal "brand" tones, one muted clay accent) — deliberately not a distinctive
"brand color" that could be mistaken for an actual design decision about the school's
identity. Two tokens (`border-input`, and `text-muted`) were specifically tuned to real,
measured WCAG contrast ratios, not just picked by eye — see `docs/ACCESSIBILITY.md`.

## Logo

`src/components/ui/Logo.tsx` renders `LogoMark`, an inline SVG: a simple open-book motif
inside a rounded-square outline, using `currentColor` so it automatically re-colors with the
`brand-primary` token. It is deliberately abstract and generic — not an attempt at the
school's real crest.

**To replace it with the real logo:** swap `LogoMark`'s internal SVG markup for an `<img>` (or
`next/image`) referencing an asset placed in `public/brand/` — every call site only passes a
`size` prop, so no page or component needs to change. Preserve the real logo's proportions;
do not redraw or recolor it. Update `brandConfig.logoAltText` in `src/config/brand.ts` to
describe the actual asset, and set `brandConfig.logoIsPlaceholder` to `false`.

## When the real palette arrives

1. Replace the hex values in `src/app/globals.css`'s `:root` block — nothing else needs to
   change, since every component consumes the semantic token names, not raw colors.
2. Re-run the contrast check (a small script computing WCAG relative luminance — see
   `docs/ACCESSIBILITY.md`'s method) for every text/background and border/surface pairing
   before shipping the new palette. Do not assume a "brand-approved" palette is
   automatically accessible — verify it, the same way the placeholder palette was verified.
3. Set `brandConfig.paletteIsPlaceholder` to `false` in `src/config/brand.ts`.
4. Update this document's status table.

## App name

Currently "Scandinavian School Library," in `src/config/site.ts::siteConfig.appName` — used
by the `<title>` tag, the Welcome screen, and the header, all from that single source. Changing
the final name is a one-line edit.
