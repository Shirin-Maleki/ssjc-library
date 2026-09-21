import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { prepareAnalysisImage } from "@/lib/intake/imagePrep";

async function realJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 180, b: 150 } } }).jpeg().toBuffer();
}

/** A real JPEG with a distinct 20x20 red marker in its top-left corner (against a
 * gray background) and a real EXIF `Orientation` tag — for tests that need to prove
 * pixel content actually moved, not just that dimensions happen to match. */
async function realJpegWithMarkerAndOrientation(width: number, height: number, orientation: 1 | 3 | 6 | 8): Promise<Buffer> {
  const marker = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
  const composed = await sharp({ create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 } } })
    .composite([{ input: marker, left: 0, top: 0 }])
    .jpeg({ quality: 100 })
    .toBuffer();
  return sharp(composed).withMetadata({ orientation }).jpeg({ quality: 100 }).toBuffer();
}

async function samplePixel(buf: Buffer, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const idx = (y * info.width + x) * info.channels;
  return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
}

function isRedMarker(pixel: { r: number; g: number; b: number }): boolean {
  return pixel.r > 200 && pixel.g < 60 && pixel.b < 60;
}
function isGrayBackground(pixel: { r: number; g: number; b: number }): boolean {
  return Math.abs(pixel.r - 128) < 20 && Math.abs(pixel.g - 128) < 20 && Math.abs(pixel.b - 128) < 20;
}

describe("intake/imagePrep — prepareAnalysisImage", () => {
  it("resizes a real oversized JPEG down to the analysis longest edge, preserving aspect ratio", async () => {
    const source = await realJpeg(3000, 4000);
    const result = await prepareAnalysisImage(source, "image/jpeg");
    expect(result.wasResized).toBe(true);
    expect(result.mimeType).toBe("image/jpeg");
    const meta = await sharp(result.bytes).metadata();
    expect(meta.height).toBeLessThanOrEqual(1024);
    expect(meta.width).toBeLessThanOrEqual(1024);
    // Aspect ratio (3:4) preserved, not cropped to a square.
    expect(meta.width! / meta.height!).toBeCloseTo(3000 / 4000, 1);
  });

  it("does not upscale an already-small image", async () => {
    const source = await realJpeg(200, 300);
    const result = await prepareAnalysisImage(source, "image/jpeg");
    const meta = await sharp(result.bytes).metadata();
    expect(meta.width).toBeLessThanOrEqual(200);
    expect(meta.height).toBeLessThanOrEqual(300);
  });

  it("resizes a real PNG source", async () => {
    const source = await sharp({ create: { width: 2000, height: 2000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
      .png()
      .toBuffer();
    const result = await prepareAnalysisImage(source, "image/png");
    expect(result.wasResized).toBe(true);
    const meta = await sharp(result.bytes).metadata();
    expect(meta.width).toBeLessThanOrEqual(1024);
  });

  // Real-cover correction pass §2 — the real bug: `prepareAnalysisImage` never
  // called `.rotate()`, so a phone photo's EXIF orientation was silently ignored.
  // These tests prove the resulting derivative's actual dimensions/pixel content,
  // never merely that sharp returned *a* buffer.

  it("an upright JPEG (EXIF orientation=1) needs no correction — dimensions and marker position unchanged", async () => {
    const source = await realJpegWithMarkerAndOrientation(300, 200, 1);
    const result = await prepareAnalysisImage(source, "image/jpeg");
    const meta = await sharp(result.bytes).metadata();
    expect(meta.width).toBe(300);
    expect(meta.height).toBe(200);
    expect(isRedMarker(await samplePixel(result.bytes, 5, 5))).toBe(true);
  });

  it("auto-orients a real EXIF-rotated JPEG requiring a 90-degree correction (orientation=6) — proven by the expected dimension swap", async () => {
    const source = await realJpegWithMarkerAndOrientation(300, 200, 6);
    // Before the fix, sharp would report the raw, uncorrected 300x200 — the real
    // regression this test guards against.
    const result = await prepareAnalysisImage(source, "image/jpeg");
    const meta = await sharp(result.bytes).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(300);
  });

  it("auto-orients a real EXIF-rotated JPEG requiring a 180-degree correction (orientation=3) — proven by the marker moving to the opposite corner", async () => {
    const width = 300;
    const height = 200;
    const source = await realJpegWithMarkerAndOrientation(width, height, 3);
    const result = await prepareAnalysisImage(source, "image/jpeg");
    const meta = await sharp(result.bytes).metadata();
    // 180 degrees never swaps width/height — dimension checks alone can't prove
    // this case, so the marker's actual pixel position is what proves it.
    expect(meta.width).toBe(width);
    expect(meta.height).toBe(height);
    expect(isGrayBackground(await samplePixel(result.bytes, 5, 5))).toBe(true);
    expect(isRedMarker(await samplePixel(result.bytes, width - 5, height - 5))).toBe(true);
  });

  it("a landscape source containing a portrait book cover still auto-orients correctly (orientation=8)", async () => {
    const source = await realJpegWithMarkerAndOrientation(300, 200, 8);
    const result = await prepareAnalysisImage(source, "image/jpeg");
    const meta = await sharp(result.bytes).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(300);
  });

  it("applies the teacher's manual rotation on top of EXIF auto-orientation (real-cover correction pass §6)", async () => {
    // Upright source (orientation=1, no correction needed) — the teacher manually
    // asks for an additional 90-degree correction because the photo itself is
    // sideways in a way EXIF didn't capture (the real failed-cover finding).
    const source = await realJpegWithMarkerAndOrientation(300, 200, 1);
    const result = await prepareAnalysisImage(source, "image/jpeg", 90);
    expect(result.manualRotationApplied).toBe(true);
    const meta = await sharp(result.bytes).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(300);
  });

  it("manual rotation of 0 (the default) is reported as not applied, even though it is technically a no-op rotation", async () => {
    const source = await realJpeg(300, 200);
    const result = await prepareAnalysisImage(source, "image/jpeg", 0);
    expect(result.manualRotationApplied).toBe(false);
  });

  it("HEIC/HEIF passthrough never claims a manual rotation was applied, since sharp cannot decode those bytes here", async () => {
    const result = await prepareAnalysisImage(Buffer.from("not-a-real-heic-file"), "image/heic", 90);
    expect(result.manualRotationApplied).toBe(false);
    expect(result.wasResized).toBe(false);
  });

  it("passes HEIC bytes through unchanged — real, tested finding that this sharp build cannot decode HEIC", async () => {
    const source = Buffer.from("not-a-real-heic-file-just-bytes");
    const result = await prepareAnalysisImage(source, "image/heic");
    expect(result.wasResized).toBe(false);
    expect(result.mimeType).toBe("image/heic");
    expect(result.bytes).toBe(source);
  });

  it("passes HEIF bytes through unchanged for the same documented reason", async () => {
    const source = Buffer.from("not-a-real-heif-file-either");
    const result = await prepareAnalysisImage(source, "image/heif");
    expect(result.wasResized).toBe(false);
    expect(result.bytes).toBe(source);
  });

  it("falls back to the original bytes, never throwing, when sharp cannot process genuinely corrupt bytes", async () => {
    const corrupt = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03]);
    const result = await prepareAnalysisImage(corrupt, "image/jpeg");
    expect(result.wasResized).toBe(false);
    expect(result.bytes).toBe(corrupt);
    expect(result.mimeType).toBe("image/jpeg");
  });
});
