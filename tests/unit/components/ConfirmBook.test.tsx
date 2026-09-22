// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmBook, type ConfirmBookViewData } from "@/components/add/ConfirmBook";

const ACTIVE_CATEGORIES = [
  { slug: "picture-books", label: "Picture Books" },
  { slug: "early-readers", label: "Early Readers" },
];

function baseData(overrides: Partial<ConfirmBookViewData> = {}): ConfirmBookViewData {
  return {
    coverPreviewUrl: "blob:fake-preview",
    coverPreviewRotationDegrees: 0,
    title: "The Gruffalo",
    authors: ["Julia Donaldson"],
    languageCode: "en",
    description: null,
    categorySlug: null,
    categoryLabel: null,
    fictionType: null,
    format: null,
    ageMinMonths: null,
    ageMaxMonths: null,
    readAloudMinutes: null,
    tags: [],
    visualMediaTypes: [],
    visualRealism: null,
    aiSuggestionsAvailable: false,
    ...overrides,
  };
}

function aiSuggestedData(): ConfirmBookViewData {
  return baseData({
    description: "A mouse invents a fearsome creature to scare off forest predators.",
    categorySlug: "picture-books",
    categoryLabel: "Picture Books",
    fictionType: "fiction",
    format: "picture_book",
    ageMinMonths: 24,
    ageMaxMonths: 60,
    readAloudMinutes: 8,
    tags: ["forest", "clever-mouse"],
    visualMediaTypes: ["digital_illustration"],
    visualRealism: "stylized_illustration",
    aiSuggestionsAvailable: true,
  });
}

describe("ConfirmBook — AI-first catalog draft correction (§7/§8)", () => {
  afterEach(() => cleanup());

  it("displays AI-suggested description, category, age range, fiction type, format, and read-aloud estimate on the default (non-editing) screen", () => {
    render(<ConfirmBook data={aiSuggestedData()} activeCategories={ACTIVE_CATEGORIES} onConfirm={vi.fn()} onReviewLater={vi.fn()} submitting={false} />);

    expect(screen.getByText(/invents a fearsome creature/)).toBeTruthy();
    expect(screen.getByText("Picture Books")).toBeTruthy();
    expect(screen.getByText("2–5 years")).toBeTruthy();
    expect(screen.getByText("Fiction")).toBeTruthy();
    expect(screen.getByText("Picture book")).toBeTruthy();
    expect(screen.getByText("5–10 min read-aloud")).toBeTruthy();
    expect(screen.getByText("Stylized illustration")).toBeTruthy();
    expect(screen.getByText("forest")).toBeTruthy();
    expect(screen.getByText("AI prepared this book record for you")).toBeTruthy();
  });

  it("never exposes a raw confidence decimal, a provider id, or a model name", () => {
    render(<ConfirmBook data={aiSuggestedData()} activeCategories={ACTIVE_CATEGORIES} onConfirm={vi.fn()} onReviewLater={vi.fn()} submitting={false} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/gemini/i);
    expect(text).not.toMatch(/0\.\d{2,}/); // no raw decimal confidence like 0.85
  });

  it("shows no 'AI prepared' banner and no suggestion chips when AI never ran at all", () => {
    render(<ConfirmBook data={baseData()} activeCategories={ACTIVE_CATEGORIES} onConfirm={vi.fn()} onReviewLater={vi.fn()} submitting={false} />);
    expect(screen.queryByText("AI prepared this book record for you")).toBeNull();
    expect(screen.queryByText("Suggested")).toBeNull();
  });

  it("Quick Edit initializes fiction type, format, and age range from the AI-suggested values, not blank (§8)", () => {
    render(<ConfirmBook data={aiSuggestedData()} activeCategories={ACTIVE_CATEGORIES} onConfirm={vi.fn()} onReviewLater={vi.fn()} submitting={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Quick edit" }));

    expect((screen.getByLabelText("Fiction / nonfiction") as HTMLSelectElement).value).toBe("fiction");
    expect((screen.getByLabelText("Format") as HTMLSelectElement).value).toBe("picture_book");
    expect((screen.getByLabelText("Age from (years)") as HTMLInputElement).value).toBe("2");
    expect((screen.getByLabelText("Age to (years)") as HTMLInputElement).value).toBe("5");
    expect((screen.getByLabelText("Physical category") as HTMLSelectElement).value).toBe("picture-books");
    expect((screen.getByLabelText("Short description") as HTMLTextAreaElement).value).toContain("invents a fearsome creature");
  });

  it("confirming without ever opening Quick Edit calls onConfirm with empty edits — the server-side AI-suggestion fallback is what persists them (§11)", () => {
    const onConfirm = vi.fn();
    render(<ConfirmBook data={aiSuggestedData()} activeCategories={ACTIVE_CATEGORIES} onConfirm={onConfirm} onReviewLater={vi.fn()} submitting={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm / Add book" }));
    expect(onConfirm).toHaveBeenCalledWith({});
  });

  it("a teacher correction in Quick Edit is what reaches onConfirm, overriding the AI-suggested value", () => {
    const onConfirm = vi.fn();
    render(<ConfirmBook data={aiSuggestedData()} activeCategories={ACTIVE_CATEGORIES} onConfirm={onConfirm} onReviewLater={vi.fn()} submitting={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Quick edit" }));
    fireEvent.change(screen.getByLabelText("Fiction / nonfiction"), { target: { value: "nonfiction" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm / Add book" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ fictionType: "nonfiction" }));
  });

  it("renders the source cover preview with the persisted rotation applied", () => {
    render(<ConfirmBook data={baseData({ coverPreviewRotationDegrees: 270 })} activeCategories={ACTIVE_CATEGORIES} onConfirm={vi.fn()} onReviewLater={vi.fn()} submitting={false} />);
    const img = document.querySelector("img") as HTMLImageElement;
    expect(img.style.transform).toBe("rotate(270deg)");
  });

  describe("AI draft human-correction semantics (final round §1) — buildEdits sends ONLY changed fields", () => {
    it("(A) changing only the description omits category/age/fiction/format from the edits sent to the server", () => {
      const onConfirm = vi.fn();
      render(<ConfirmBook data={aiSuggestedData()} activeCategories={ACTIVE_CATEGORIES} onConfirm={onConfirm} onReviewLater={vi.fn()} submitting={false} />);
      fireEvent.click(screen.getByRole("button", { name: "Quick edit" }));
      fireEvent.change(screen.getByLabelText("Short description"), { target: { value: "A teacher-edited description." } });
      fireEvent.click(screen.getByRole("button", { name: "Confirm / Add book" }));

      expect(onConfirm).toHaveBeenCalledWith({ description: "A teacher-edited description." });
      const sentEdits = onConfirm.mock.calls[0][0];
      expect(sentEdits).not.toHaveProperty("physicalCategorySlug");
      expect(sentEdits).not.toHaveProperty("ageMinMonths");
      expect(sentEdits).not.toHaveProperty("ageMaxMonths");
      expect(sentEdits).not.toHaveProperty("fictionType");
      expect(sentEdits).not.toHaveProperty("format");
    });

    it("(B) opening Quick Edit and changing nothing sends an empty edits object — no AI field is ever marked as touched", () => {
      const onConfirm = vi.fn();
      render(<ConfirmBook data={aiSuggestedData()} activeCategories={ACTIVE_CATEGORIES} onConfirm={onConfirm} onReviewLater={vi.fn()} submitting={false} />);
      fireEvent.click(screen.getByRole("button", { name: "Quick edit" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirm / Add book" }));
      expect(onConfirm).toHaveBeenCalledWith({});
    });

    it("(C) changing fiction type to Unknown sends an explicit null, not the AI's original 'fiction' value", () => {
      const onConfirm = vi.fn();
      render(<ConfirmBook data={aiSuggestedData()} activeCategories={ACTIVE_CATEGORIES} onConfirm={onConfirm} onReviewLater={vi.fn()} submitting={false} />);
      fireEvent.click(screen.getByRole("button", { name: "Quick edit" }));
      fireEvent.change(screen.getByLabelText("Fiction / nonfiction"), { target: { value: "" } }); // "Unknown" option
      fireEvent.click(screen.getByRole("button", { name: "Confirm / Add book" }));
      expect(onConfirm).toHaveBeenCalledWith({ fictionType: null });
    });

    it("(D) clearing both age fields sends explicit nulls, not the AI's original age range", () => {
      const onConfirm = vi.fn();
      render(<ConfirmBook data={aiSuggestedData()} activeCategories={ACTIVE_CATEGORIES} onConfirm={onConfirm} onReviewLater={vi.fn()} submitting={false} />);
      fireEvent.click(screen.getByRole("button", { name: "Quick edit" }));
      fireEvent.change(screen.getByLabelText("Age from (years)"), { target: { value: "" } });
      fireEvent.change(screen.getByLabelText("Age to (years)"), { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: "Confirm / Add book" }));
      expect(onConfirm).toHaveBeenCalledWith({ ageMinMonths: null, ageMaxMonths: null });
    });

    it("(E) clearing the description sends an explicit null, not the AI's original description", () => {
      const onConfirm = vi.fn();
      render(<ConfirmBook data={aiSuggestedData()} activeCategories={ACTIVE_CATEGORIES} onConfirm={onConfirm} onReviewLater={vi.fn()} submitting={false} />);
      fireEvent.click(screen.getByRole("button", { name: "Quick edit" }));
      fireEvent.change(screen.getByLabelText("Short description"), { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: "Confirm / Add book" }));
      expect(onConfirm).toHaveBeenCalledWith({ description: null });
    });

    it("(F) clearing the physical category sends an explicit null — the server is what turns this into the required-category error, never silently restoring the AI category", () => {
      const onConfirm = vi.fn();
      render(<ConfirmBook data={aiSuggestedData()} activeCategories={ACTIVE_CATEGORIES} onConfirm={onConfirm} onReviewLater={vi.fn()} submitting={false} />);
      fireEvent.click(screen.getByRole("button", { name: "Quick edit" }));
      fireEvent.change(screen.getByLabelText("Physical category"), { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: "Confirm / Add book" }));
      expect(onConfirm).toHaveBeenCalledWith({ physicalCategorySlug: null });
    });
  });
});
