/**
 * A single, neutral home for the one Phase 7 E2E test flag, so both the provider
 * layer (`src/lib/metadataProviders/index.ts`) and the domain layer
 * (`src/lib/intake/e2eFixtures.ts`, `actions.ts`, the upload route) can check it
 * without importing across layers in the wrong direction. See
 * `src/lib/intake/e2eFixtures.ts` for the full explanation of what this flag does
 * and why it exists. Active ONLY when `E2E_FAKE_INTAKE_PROVIDERS=true`, set
 * exclusively in `playwright.config.ts`'s `webServer.env` — never in a real
 * deployment.
 */
export function isE2EFakeProvidersEnabled(): boolean {
  return process.env.E2E_FAKE_INTAKE_PROVIDERS === "true";
}
