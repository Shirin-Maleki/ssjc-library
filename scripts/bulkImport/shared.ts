import "../../src/db/loadEnv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../../src/db/schema";
import { GoogleDriveCoverStorageProvider } from "../../src/lib/googleDrive/googleDriveProvider";
import { GeminiBookIntelligenceProvider } from "../../src/lib/ai/geminiProvider";
import { GoogleBooksMetadataProvider } from "../../src/lib/metadataProviders/googleBooksProvider";
import { OpenLibraryMetadataProvider } from "../../src/lib/metadataProviders/openLibraryProvider";
import type { BookMetadataProvider } from "../../src/lib/metadataProviders/provider";
import { loadBulkImportDriveConfig } from "../../src/lib/bulkImport/driveConfig";

/**
 * Shared construction helpers for every `scripts/bulkImport/*.ts` CLI entry
 * point — deliberately duplicated in spirit from (never importing) the
 * `server-only`-guarded factories in `src/lib/{googleDrive,ai,metadataProviders}/
 * index.ts`, exactly matching `scripts/embeddings/generate.ts`'s and
 * `scripts/google/smoke.ts`'s own established convention for "a script needs
 * the same real provider construction production code uses, without a
 * Next.js-specific build guard in the way."
 */

export function connectDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const client = postgres(url, { max: 1 });
  return { db: drizzle(client, { schema }), client };
}

export function buildBulkImportDriveProvider(): { provider: GoogleDriveCoverStorageProvider; rootFolderId: string } {
  const { rootFolderId } = loadBulkImportDriveConfig();
  return { provider: new GoogleDriveCoverStorageProvider(rootFolderId), rootFolderId };
}

export function buildAiProvider(): GeminiBookIntelligenceProvider {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set — the bulk importer requires Gemini vision/enrichment to be configured (see docs/BULK_IMPORT.md).");
  }
  return new GeminiBookIntelligenceProvider(apiKey);
}

export function buildMetadataProviders(): BookMetadataProvider[] {
  const providers: BookMetadataProvider[] = [];
  const googleBooksKey = process.env.GOOGLE_BOOKS_API_KEY;
  if (googleBooksKey) providers.push(new GoogleBooksMetadataProvider(googleBooksKey));
  providers.push(new OpenLibraryMetadataProvider());
  return providers;
}

export function parseFlagValue(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg?.split("=").slice(1).join("=");
}

export function parseFlagInt(name: string): number | undefined {
  const raw = parseFlagValue(name);
  if (raw == null) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) throw new Error(`--${name} must be a whole number, got "${raw}".`);
  return parsed;
}

export function parseFlagList(name: string): string[] | undefined {
  const raw = parseFlagValue(name);
  if (raw == null) return undefined;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
