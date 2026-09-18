import { DriveProviderError } from "./provider";

/**
 * Runtime configuration for the Google Drive integration (Phase 6, `docs/GOOGLE_SETUP.md`).
 * Every value comes from the environment — never hard-coded, never committed (see
 * `.env.example`). `rootFolderId` in particular must never appear in application source or
 * public documentation (the phase brief's own explicit instruction); it is real-deployment
 * configuration, exactly like `DATABASE_URL`.
 */
export interface DriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  rootFolderId: string;
}

const REQUIRED_VARS = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "GOOGLE_DRIVE_ROOT_FOLDER_ID",
] as const;

/**
 * Reads and validates the four Phase 6 environment variables. Throws
 * `DriveProviderError("configuration_missing", …)` naming only which variable NAMES are
 * absent — never a value, never a hint about what a real value might look like. Malformed
 * (present-but-empty, whitespace-only) values are treated the same as missing.
 */
export function loadDriveConfig(): DriveConfig {
  const values = {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID?.trim(),
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
    refreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim(),
    rootFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim(),
  };

  const missing = REQUIRED_VARS.filter((name) => {
    const key = envNameToConfigKey(name);
    return !values[key];
  });

  if (missing.length > 0) {
    throw new DriveProviderError(
      "configuration_missing",
      `Missing required environment variable(s): ${missing.join(", ")}. See docs/GOOGLE_SETUP.md.`
    );
  }

  return {
    clientId: values.clientId!,
    clientSecret: values.clientSecret!,
    refreshToken: values.refreshToken!,
    rootFolderId: values.rootFolderId!,
  };
}

function envNameToConfigKey(name: (typeof REQUIRED_VARS)[number]): keyof DriveConfig {
  switch (name) {
    case "GOOGLE_OAUTH_CLIENT_ID":
      return "clientId";
    case "GOOGLE_OAUTH_CLIENT_SECRET":
      return "clientSecret";
    case "GOOGLE_OAUTH_REFRESH_TOKEN":
      return "refreshToken";
    case "GOOGLE_DRIVE_ROOT_FOLDER_ID":
      return "rootFolderId";
  }
}

/** `true` only when every required variable is present and non-blank — never throws.
 * Mirrors `embeddings/index.ts`'s "no key configured is a normal state" pattern: callers
 * (a future admin diagnostic, `google:smoke`) use this to decide whether to attempt a real
 * connection at all, without needing a try/catch for the common "not set up yet" case. */
export function isDriveConfigured(): boolean {
  try {
    loadDriveConfig();
    return true;
  } catch {
    return false;
  }
}
