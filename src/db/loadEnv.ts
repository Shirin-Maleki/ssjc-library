/**
 * Standalone DB scripts (migrate/seed/reset) run outside Next.js, which is the only
 * thing that normally loads `.env.local` for this project. Node's own built-in loader
 * does no "$"-expansion (unlike Next's — the exact bug documented in
 * docs/SECURITY.md), so it's used here deliberately instead of a "dotenv" dependency.
 * Safe to import multiple times; safe when no `.env.local` exists (e.g. CI with real
 * env vars already set).
 */
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local present — fine, assume the environment already has what's needed.
}
