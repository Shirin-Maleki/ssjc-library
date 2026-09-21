// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoverCapture, nextRotation } from "@/components/add/CoverCapture";

/**
 * Real-cover correction pass §6 — the manual rotate control on the selected-cover
 * preview. `URL.createObjectURL`/`revokeObjectURL` are stubbed since jsdom doesn't
 * implement them; the exact returned URL value is never asserted on, only that
 * rotation state changes what's passed to `onConfirm`.
 */
describe("CoverCapture — rotate control", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:fake-preview-url");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    cleanup();
  });

  function selectAFile() {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["fake-bytes"], "cover.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
  }

  it("nextRotation cycles 0 -> 90 -> 180 -> 270 -> 0", () => {
    expect(nextRotation(0)).toBe(90);
    expect(nextRotation(90)).toBe(180);
    expect(nextRotation(180)).toBe(270);
    expect(nextRotation(270)).toBe(0);
  });

  it("a freshly selected photo starts at 0 degrees — no rotate button rendered until upright text isn't needed either way, but the preview transform starts unrotated", () => {
    render(<CoverCapture onConfirm={vi.fn()} />);
    selectAFile();
    const img = screen.getByAltText("Selected book cover preview") as HTMLImageElement;
    expect(img.style.transform).toBe("rotate(0deg)");
  });

  it("tapping Rotate 90° increments the preview's rotation and is passed through to onConfirm", () => {
    const onConfirm = vi.fn();
    render(<CoverCapture onConfirm={onConfirm} />);
    selectAFile();

    const rotateButton = screen.getByRole("button", { name: /Rotate 90°/ });
    fireEvent.click(rotateButton);
    const img = screen.getByAltText("Selected book cover preview") as HTMLImageElement;
    expect(img.style.transform).toBe("rotate(90deg)");

    fireEvent.click(screen.getByRole("button", { name: "Use this cover" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ rotationDegrees: 90 }));
  });

  it("four taps returns to 0 degrees, proving fixed 90-degree increments rather than open-ended rotation", () => {
    render(<CoverCapture onConfirm={vi.fn()} />);
    selectAFile();
    const rotateButton = screen.getByRole("button", { name: /Rotate 90°/ });
    fireEvent.click(rotateButton);
    fireEvent.click(rotateButton);
    fireEvent.click(rotateButton);
    fireEvent.click(rotateButton);
    const img = screen.getByAltText("Selected book cover preview") as HTMLImageElement;
    expect(img.style.transform).toBe("rotate(0deg)");
  });

  it("choosing a new photo resets rotation to 0, never carrying over the previous photo's correction", () => {
    render(<CoverCapture onConfirm={vi.fn()} />);
    selectAFile();
    fireEvent.click(screen.getByRole("button", { name: /Rotate 90°/ }));
    expect((screen.getByAltText("Selected book cover preview") as HTMLImageElement).style.transform).toBe("rotate(90deg)");

    fireEvent.click(screen.getByRole("button", { name: "Change photo" }));
    selectAFile();
    expect((screen.getByAltText("Selected book cover preview") as HTMLImageElement).style.transform).toBe("rotate(0deg)");
  });
});
