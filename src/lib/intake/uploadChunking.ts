/**
 * Shared constant between the upload-init and upload-chunk Route Handlers
 * (Phase 7 correction pass — §1). Real, current constraints, not assumed:
 *
 * - Vercel's serverless Function request-body limit is 4.5 MB (official docs,
 *   re-checked at implementation time) — a single-request upload of a real
 *   source cover (this pipeline allows up to 25 MiB, and real validation
 *   already included a 6.4 MB JPEG and 3.6-4.9 MB HEIC files) would exceed
 *   this in production even though it works against a local dev server.
 * - Google's resumable-upload protocol requires each intermediate chunk to be
 *   a multiple of 256 KiB, except the final chunk (re-confirmed against
 *   developers.google.com/workspace/drive/api/guides/manage-uploads).
 *
 * 4 MiB = 16 * 256 KiB, comfortably under 4.5 MB with headroom for headers.
 */
export const CHUNK_SIZE_BYTES = 4 * 1024 * 1024;
