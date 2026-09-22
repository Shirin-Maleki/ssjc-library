/**
 * Slug generation for a brand-new physical category (Phase 8, §19) — generated
 * ONCE at creation time from the admin-supplied label, then permanently stable:
 * renaming the label later never regenerates or touches the slug (§19/§21 — "a
 * label rename must not change the category UUID or stable slug"). This module
 * only ever runs at creation; nothing here is called on rename.
 */

/** Lowercase, hyphenated, alphanumeric-only — matches the existing seeded slugs
 * (`animals-nature`, `picture-books`, etc.) exactly. Diacritics are stripped via
 * NFKD normalization rather than dropped outright, so "Café Stories" still produces
 * a legible `cafe-stories` instead of `caf-stories`. */
export function slugify(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Appends `-2`, `-3`, ... only when the base slug already collides — the common
 * case (a genuinely new category name) gets the clean slug with no suffix at all.
 * `existingSlugs` should include every category slug regardless of active state
 * (a slug is a stable identifier forever, even for a deactivated category — never
 * reused). */
export function generateUniqueCategorySlug(label: string, existingSlugs: ReadonlySet<string>): string {
  const base = slugify(label) || "category";
  if (!existingSlugs.has(base)) return base;
  let suffix = 2;
  while (existingSlugs.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
