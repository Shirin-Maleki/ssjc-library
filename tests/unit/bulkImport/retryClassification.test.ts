import { describe, expect, it } from "vitest";
import { classifyBulkImportError, RUN_FATAL_DRIVE_CATEGORIES } from "@/lib/bulkImport/retryClassification";
import { DriveProviderError } from "@/lib/googleDrive/provider";
import { AIProviderError } from "@/lib/ai/provider";

describe("bulkImport/retryClassification — classifyBulkImportError", () => {
  it("classifies rate limits and transient provider failures as transient, never run-fatal", () => {
    expect(classifyBulkImportError(new DriveProviderError("rate_limited", "x"))).toMatchObject({ failureClass: "transient", runFatal: false });
    expect(classifyBulkImportError(new DriveProviderError("transient_provider_failure", "x"))).toMatchObject({ failureClass: "transient", runFatal: false });
    expect(classifyBulkImportError(new AIProviderError("rate_limited", "x"))).toMatchObject({ failureClass: "transient", runFatal: false });
    expect(classifyBulkImportError(new AIProviderError("timeout", "x"))).toMatchObject({ failureClass: "transient", runFatal: false });
  });

  it("classifies a genuinely unreadable/corrupt image as permanent, not transient", () => {
    expect(classifyBulkImportError(new DriveProviderError("invalid_file", "x"))).toMatchObject({ failureClass: "permanent" });
    expect(classifyBulkImportError(new DriveProviderError("file_not_found", "x"))).toMatchObject({ failureClass: "permanent" });
  });

  it("classifies a vision response the provider genuinely couldn't parse as reviewable, never a blind retry", () => {
    expect(classifyBulkImportError(new AIProviderError("invalid_image", "x"))).toMatchObject({ failureClass: "reviewable" });
    expect(classifyBulkImportError(new AIProviderError("invalid_response", "x"))).toMatchObject({ failureClass: "reviewable" });
  });

  it("flags missing/revoked Drive configuration and authorization as run-fatal — the whole run should stop, not retry item by item", () => {
    for (const category of RUN_FATAL_DRIVE_CATEGORIES) {
      const result = classifyBulkImportError(new DriveProviderError(category as never, "x"));
      expect(result.runFatal).toBe(true);
    }
  });

  it("flags missing Gemini configuration as permanent and run-fatal", () => {
    const result = classifyBulkImportError(new AIProviderError("configuration_missing", "x"));
    expect(result).toMatchObject({ failureClass: "permanent", runFatal: true });
  });

  it("never leaks a raw error category or provider message shape for a plain unknown error", () => {
    const result = classifyBulkImportError(new Error("some unexpected bug"));
    expect(result.failureClass).toBe("transient");
    expect(result.runFatal).toBe(false);
    expect(result.message).toBe("some unexpected bug");
  });

  it("handles a thrown non-Error value without crashing", () => {
    const result = classifyBulkImportError("a plain string throw");
    expect(result.failureClass).toBe("transient");
    expect(result.message).toMatch(/unknown error/i);
  });
});
