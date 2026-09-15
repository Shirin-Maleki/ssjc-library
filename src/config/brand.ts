/**
 * Branding status: app name, palette, typography, AND the real logo are all in place
 * as of 2026-09-14 — see docs/BRANDING.md, including a documented color discrepancy
 * between the logo artwork's actual pixel colors and the official palette hex values.
 *
 * Do not add hex colors here or anywhere else; colors live only as CSS custom
 * properties in src/app/globals.css and are consumed via Tailwind's semantic
 * color tokens (bg-background, text-text-primary, border-border, etc.).
 */

export const brandConfig = {
  /** False as of 2026-09-14 — public/brand/logo.png is the real school logo. */
  logoIsPlaceholder: false,
  logoAltText: "SSJC Library logo",
  /** False as of 2026-09-14 — the real palette from docs/BRANDING.md is applied. */
  paletteIsPlaceholder: false,
} as const;
