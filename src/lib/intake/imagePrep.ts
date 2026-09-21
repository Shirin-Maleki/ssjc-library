import sharp from "sharp";
import type { AnalysisRotationDegrees } from "./draft";

/**
 * Prepares a temporary, smaller analysis image from a freshly-uploaded source cover
 * photo, for the Gemini vision call only (Phase 7, §9 of the phase brief) — never
 * persisted, never sent to Drive, never the record of source. The Drive original
 * (already uploaded byte-for-byte via `src/lib/googleDrive/`, Phase 6) is always the
 * one that matters for provenance; this is disposable, request-scoped processing data
 * that exists purely to avoid sending a multi-megabyte phone photo to Gemini when a
 * much smaller image gives equivalent cover-recognition quality.
 *
 * **Real orientation bug found and fixed (real-cover correction pass §1/§2)**: this
 * function used to resize with no `.rotate()` call at all. `sharp` only applies EXIF
 * orientation when `.rotate()` (no args) is explicitly invoked; without it, the
 * output buffer keeps the raw, as-captured sensor pixel order — sideways or
 * upside-down for any phone photo taken with the phone itself physically rotated —
 * while `sharp`'s default metadata-stripping-on-output behavior discards the EXIF
 * orientation tag too, so nothing downstream (Gemini) had any way to know the
 * correction was needed. Browsers, meanwhile, render `<img>` EXIF-aware by default,
 * so the teacher's own preview looked correctly upright the whole time — this
 * mismatch (upright preview, sideways analysis bytes) was confirmed directly against
 * a real failed teacher upload (`docs/AI_PIPELINE.md` §12). Fixed by calling
 * `.rotate()` unconditionally before `.resize()` for every format `sharp` can decode.
 *
 * **A real further finding from that same failed photo**: EXIF-based auto-orientation
 * is necessary but not sufficient — that specific file's own EXIF `Orientation` tag
 * did not match its true required correction (confirmed by testing all four fixed
 * angles against the raw pixels and visually comparing). This is why an optional
 * teacher-chosen `manualRotationDegrees` correction (applied on top of, not instead
 * of, the EXIF auto-orientation — §6/§2) and a more robust vision prompt (§4) both
 * exist as a real safety net, not redundant decoration.
 *
 * **Real, tested finding (2026-09-20), not an assumption**: this codebase's `sharp`
 * installation's format registry reports `heif` input as `{ fileSuffix: ['.avif'] }`
 * only — real iPhone-style HEIC photos are not decodable by this default libvips
 * build (full HEIC decode needs a non-default, separately-licensed libheif build).
 * Per the phase brief's own explicit guidance ("if resizing HEIC/HEIF is unreliable
 * but Gemini itself accepts the source format, sending a reasonably sized source
 * directly is preferable to introducing fragile conversion"), `prepareAnalysisImage`
 * does NOT attempt to resize `image/heic`/`image/heif` — it returns the original
 * bytes unchanged for those two MIME types specifically (orientation normalization,
 * including any manual rotation, cannot be applied to them for the same decode-
 * limitation reason — see the real-cover correction pass's honest HEIC handling,
 * §3), relying on Gemini's own confirmed (`docs/AI_PIPELINE.md`) HEIC/HEIF input
 * support plus its now-more-robust orientation-handling instructions. jpeg/png/webp
 * all resize (and now auto-orient) successfully through the same real, tested code
 * path (`docs/DECISIONS.md`).
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
  /** `true` when a non-zero teacher-chosen `manualRotationDegrees` could actually be
   * applied to the analysis bytes (decodable formats only) — `false` for HEIC/HEIF
   * passthrough or a resize failure, so a caller can honestly tell whether the
   * teacher's manual correction actually reached the bytes Gemini receives. */
  manualRotationApplied: boolean;
}

/**
 * Builds a smaller, upright image for the Gemini vision call, preserving aspect
 * ratio and never cropping (cropping could cut off cover text). Never throws: if
 * `sharp` genuinely cannot process the given bytes for any reason (a corrupt file,
 * an unexpected real-world format quirk), the original bytes are returned unchanged
 * rather than failing the whole intake over an optimization — vision analysis of the
 * full-size original is strictly better than no vision analysis at all.
 *
 * `manualRotationDegrees` (default 0) is an additional clockwise correction applied
 * ON TOP of EXIF auto-orientation — i.e. relative to what the teacher actually sees
 * in the (already EXIF-corrected, browser-rendered) preview, not relative to the raw
 * sensor pixels. This is deliberate: the teacher's rotate control is judged against
 * what they see, regardless of whether this particular file's own EXIF orientation
 * tag happens to be accurate.
 */
export async function prepareAnalysisImage(
  sourceBytes: Buffer,
  sourceMimeType: string,
  manualRotationDegrees: AnalysisRotationDegrees = 0
): Promise<AnalysisImage> {
  if (UNRESIZABLE_SOURCE_MIME_TYPES.has(sourceMimeType)) {
    return { bytes: sourceBytes, mimeType: sourceMimeType, wasResized: false, manualRotationApplied: false };
  }

  try {
    let pipeline = sharp(sourceBytes).rotate(); // EXIF-aware auto-orientation, always applied first
    if (manualRotationDegrees !== 0) pipeline = pipeline.rotate(manualRotationDegrees);
    const resized = await pipeline
      .resize({
        width: ANALYSIS_LONGEST_EDGE_PX,
        height: ANALYSIS_LONGEST_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: ANALYSIS_JPEG_QUALITY })
      .toBuffer();
    return { bytes: resized, mimeType: "image/jpeg", wasResized: true, manualRotationApplied: manualRotationDegrees !== 0 };
  } catch {
    return { bytes: sourceBytes, mimeType: sourceMimeType, wasResized: false, manualRotationApplied: false };
  }
}
