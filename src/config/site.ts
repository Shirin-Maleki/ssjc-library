/**
 * Centralized product configuration. Nothing product-facing (app name, organization
 * name, session durations, navigation labels) should be hard-coded anywhere else —
 * change it here.
 */

export const siteConfig = {
  appName: "SSJC Library",
  organizationName: "Scandinavian School of Jersey City",
  /** Shown under the app name on the welcome screen. Keep it short. */
  tagline: "Staff access",
} as const;

export const sessionConfig = {
  /** Overall staff session lifetime, in seconds, before re-entering the password is required. */
  staffSessionTtlSeconds: 60 * 60 * 12, // 12 hours
  /** Elevated admin privilege lifetime, in seconds — shorter than the staff session itself. */
  adminElevationTtlSeconds: 60 * 45, // 45 minutes
  /** A session is silently renewed once less than this fraction of its lifetime remains. */
  slidingRenewalThreshold: 0.5,
  cookieName: "ssjc_session",
} as const;

export const rateLimitConfig = {
  maxAttempts: 8,
  windowSeconds: 15 * 60,
} as const;

export interface NavItem {
  href: string;
  label: string;
  description: string;
}

/** The two dominant Home actions. Order matters — Find a Book comes first. */
export const primaryNav: NavItem[] = [
  {
    href: "/find",
    label: "Find a Book",
    description: "Search and browse the collection.",
  },
  {
    href: "/add",
    label: "Add a Book",
    description: "Photograph a cover to add it to the library.",
  },
];

/** Visually subordinate to primaryNav on Home. */
export const secondaryNav: NavItem[] = [
  {
    href: "/lists",
    label: "Reading Lists",
    description: "Shared lists any staff member can build.",
  },
  {
    href: "/guide",
    label: "Library Guide",
    description: "How the library is organized.",
  },
  {
    href: "/teacher-catalog",
    label: "Teacher Catalog",
    description: "Open the shared spreadsheet view.",
  },
  {
    href: "/admin",
    label: "Admin",
    description: "Review queues and taxonomy management.",
  },
];
