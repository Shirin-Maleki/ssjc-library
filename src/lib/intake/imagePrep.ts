import sharp from "sharp";

/**
 * Prepares a temporary, smaller analysis image from a freshly-uploaded source cover
 * photo, for the Gemini vision call only (Phase 7, §9 of the phase brief) — never
 * persisted, never sent to Drive, never the record of source. The Drive original
 * (already uploaded byte-for-byte via `src/lib/googleDrive/`, Phase 6) is always the
 * one that matters for provenance; this is disposable, request-scoped processing data
 * that exists purely to avoid sending a multi-megabyte phone photo to Gemini when a
 * much smaller image gives equivalent cover-recognition quality.
 *
 * **Real, tested finding (2026-09-20), not an assumption**: this codebase's `sharp`
 * installation's format registry reports `heif` input as `{ fileSuffix: ['.avif'] }`
 * only — real iPhone-style HEIC photos are not decodable by this default libvips
 * build (full HEIC decode needs a non-default, separately-licensed libheif build).
 * Per the phase brief's own explicit guidance ("if resizing HEIC/HEIF is unreliable
 * but Gemini itself accepts the source format, sending a reasonably sized source
 * directly is preferable to introducing fragile conversion"), `prepareAnalysisImage`
 * does NOT attempt to resize `image/heic`/`image/heif` — it returns the original
 * bytes unchanged for those two MIME types specifically, relying on Gemini's own
 * confirmed (`docs/AI_PIPELINE.md`) HEIC/HEIF input support. jpeg/png/webp all resize
 * successfully through the same real, tested code path (`docs/DECISIONS.md`).
 */

/** Longest-edge target for the analysis derivative — comfortably enough resolution
 * for Gemini to read cover text/typography, far smaller than a typical phone photo
 * (often 3000-4000px on the long edge). Not a source-quality decision — the Drive
 * original is completely unaffected. */
const ANALYSIS_LONGEST_EDGE_PX = 1024;
const ANALYSIS_JPEG_QUALITY = 82;

/** MIME types `sharp` cannot reliably decode in this deployment — verified directly
 * against the real installed `sharp` build's format registry, not assumed from
 * general HEIC/HEIF reputation. Kept as its own named constant so the real
 * evidence/decision is discoverable independent of the resize function's control
 * flow. */
const UNRESIZABLE_SOURCE_MIME_TYPES: ReadonlySet<string> = new Set(["image/heic", "image/heif"]);

export interface AnalysisImage {
  bytes: Buffer;
  mimeType: string;
  /** `true` when this is the resized derivative; `false` when the original bytes
   * were passed through unchanged (HEIC/HEIF, or a resize failure — see below). */
  wasResized: boolean;
}

/**
 * Builds a smaller image for the Gemini vision call, preserving aspect ratio and
 * never cropping (cropping could cut off cover text). Never throws: if `sharp`
 * genuinely cannot process the given bytes for any reason (a corrupt file, an
 * unexpected real-world format quirk), the original bytes are returned unchanged
 * rather than failing the whole intake over an optimization — vision analysis of the
 * full-size original is strictly better than no vision analysis at all.
 */
export async function prepareAnalysisImage(sourceBytes: Buffer, sourceMimeType: string): Promise<AnalysisImage> {
  if (UNRESIZABLE_SOURCE_MIME_TYPES.has(sourceMimeType)) {
    return { bytes: sourceBytes, mimeType: sourceMimeType, wasResized: false };
  }

  try {
    const resized = await sharp(sourceBytes)
      .resize({
        width: ANALYSIS_LONGEST_EDGE_PX,
        height: ANALYSIS_LONGEST_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: ANALYSIS_JPEG_QUALITY })
      .toBuffer();
    return { bytes: resized, mimeType: "image/jpeg", wasResized: true };
  } catch {
    return { bytes: sourceBytes, mimeType: sourceMimeType, wasResized: false };
  }
}
