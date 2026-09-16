try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local present — fine, assume TEST_DATABASE_URL is already in the
  // environment (e.g. CI).
}

process.env.SESSION_SECRET ??= "test-only-session-secret-do-not-use-in-real-env";
