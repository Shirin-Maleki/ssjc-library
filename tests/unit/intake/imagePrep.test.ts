import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { prepareAnalysisImage } from "@/lib/intake/imagePrep";

async function realJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 180, b: 150 } } }).jpeg().toBuffer();
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
