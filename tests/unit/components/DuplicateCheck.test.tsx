// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DuplicateCheck, type DuplicateCandidateViewData } from "@/components/add/DuplicateCheck";

const candidate: DuplicateCandidateViewData = {
  bookId: "book-1",
  title: "The Gruffalo",
  authors: ["Julia Donaldson"],
  languageCode: "en",
  publisher: "Macmillan",
  displayCoverUrl: "https://covers.openlibrary.org/b/id/12345-M.jpg",
};

describe("DuplicateCheck — rotation persistence (AI-first catalog draft correction §9)", () => {
  afterEach(() => cleanup());

  it("applies the teacher's persisted rotation to the 'Just photographed' source preview", () => {
    render(
      <DuplicateCheck
        isExactMatch={false}
        coverPreviewUrl="blob:fake-source-preview"
        coverPreviewRotationDegrees={90}
        capturedTitle="The Gruffalo"
        candidate={candidate}
        onSameBook={vi.fn()}
        onDifferentBook={vi.fn()}
        onReviewLater={vi.fn()}
        submitting={false}
      />
    );
    const sourceImg = document.querySelector('img[src="blob:fake-source-preview"]') as HTMLImageElement;
    expect(sourceImg).toBeTruthy();
    expect(sourceImg.style.transform).toBe("rotate(90deg)");
  });

  it("never rotates the metadata-provider display cover — it is a separate, already-correctly-oriented asset", () => {
    render(
      <DuplicateCheck
        isExactMatch={false}
        coverPreviewUrl="blob:fake-source-preview"
        coverPreviewRotationDegrees={180}
        capturedTitle="The Gruffalo"
        candidate={candidate}
        onSameBook={vi.fn()}
        onDifferentBook={vi.fn()}
        onReviewLater={vi.fn()}
        submitting={false}
      />
    );
    const images = document.querySelectorAll("img");
    const displayCoverImg = Array.from(images).find((img) => img.getAttribute("src") === candidate.displayCoverUrl) as HTMLImageElement;
    expect(displayCoverImg).toBeTruthy();
    expect(displayCoverImg.style.transform).toBe("");
  });

  it("at rotation 0, the source preview has no visible rotation applied", () => {
    render(
      <DuplicateCheck
        isExactMatch
        coverPreviewUrl="blob:fake-source-preview"
        coverPreviewRotationDegrees={0}
        capturedTitle="The Gruffalo"
        candidate={candidate}
        onSameBook={vi.fn()}
        onDifferentBook={vi.fn()}
        onReviewLater={vi.fn()}
        submitting={false}
      />
    );
    const sourceImg = document.querySelector('img[src="blob:fake-source-preview"]') as HTMLImageElement;
    expect(sourceImg.style.transform).toBe("rotate(0deg)");
  });
});
