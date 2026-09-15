/**
 * Branding status: palette, typography, and app name are real (provided 2026-09-14) —
 * see docs/BRANDING.md. The logo *mark* itself is still a placeholder: only colors,
 * type, and the name have arrived so far, not a logo file.
 *
 * Do not add hex colors here or anywhere else; colors live only as CSS custom
 * properties in src/app/globals.css and are consumed via Tailwind's semantic
 * color tokens (bg-background, text-text-primary, border-border, etc.).
 */

export const brandConfig = {
  /** True until a real logo asset replaces the placeholder open-book mark. */
  logoIsPlaceholder: true,
  /** Alt text for the logo — update if a real school logo changes what it depicts. */
  logoAltText: "SSJC Library logo (temporary placeholder)",
  /** False as of 2026-09-14 — the real palette from docs/BRANDING.md is applied. */
  paletteIsPlaceholder: false,
} as const;
