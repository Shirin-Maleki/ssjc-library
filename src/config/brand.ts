/**
 * Branding status: PENDING. The real school logo and color palette have not been
 * provided yet (see docs/BRANDING.md). This file exists so that when they arrive,
 * updating branding is a small, localized change — not a hunt through components.
 *
 * Do not add hex colors here or anywhere else; colors live only as CSS custom
 * properties in src/app/globals.css and are consumed via Tailwind's semantic
 * color tokens (bg-background, text-text-primary, border-border, etc.).
 */

export const brandConfig = {
  /** True until a real logo asset replaces the placeholder mark. */
  logoIsPlaceholder: true,
  /** Alt text for the logo — update if a real school logo changes what it depicts. */
  logoAltText: "Scandinavian School Library logo (temporary placeholder)",
  /** True until docs/BRANDING.md's real palette mapping has been applied. */
  paletteIsPlaceholder: true,
} as const;
