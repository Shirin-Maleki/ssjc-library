/** Joins conditional class names. Deliberately not a full clsx/tailwind-merge — Phase 1's
 * component set is small enough that a naive join covers every case without a dependency. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
