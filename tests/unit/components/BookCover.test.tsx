// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BookCover } from "@/components/find/BookCover";

/**
 * Phase 7 correction pass §2 — proves the display-cover path is actually wired
 * into the rendered component, not just present on the type. A real
 * `displayUrl` renders a real `<img>`; its absence (every fixture book, and
 * any real book without one) preserves the existing typographic placeholder
 * exactly as before.
 */
describe("BookCover", () => {
  afterEach(() => {
    cleanup();
  });

  const baseBook = { title: "The Gruffalo", authors: ["Julia Donaldson"], cover: { variant: 0 } };

  it("renders the typographic placeholder when no display URL is present", () => {
    render(<BookCover book={baseBook} />);
    const el = screen.getByRole("img", { name: "Cover of The Gruffalo" });
    expect(el.tagName).not.toBe("IMG"); // the placeholder is a styled <div>, not a real <img>
    expect(screen.getByText("The Gruffalo")).toBeTruthy();
  });

  it("renders a real image when a trustworthy display URL is present, not the placeholder text", () => {
    render(<BookCover book={{ ...baseBook, cover: { variant: 0, displayUrl: "https://covers.openlibrary.org/b/id/12345-M.jpg" } }} />);
    const img = screen.getByRole("img", { name: "Cover of The Gruffalo" });
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe("https://covers.openlibrary.org/b/id/12345-M.jpg");
    // The placeholder's own title text is not rendered when a real image is shown.
    expect(screen.queryByText("The Gruffalo", { selector: "p" })).toBeNull();
  });

  it("keeps the same aspect ratio/size classes in both states (no layout shift)", () => {
    const { container: placeholderContainer } = render(<BookCover book={baseBook} size="sm" />);
    const placeholderEl = placeholderContainer.firstChild as HTMLElement;
    cleanup();
    const { container: imageContainer } = render(
      <BookCover book={{ ...baseBook, cover: { variant: 0, displayUrl: "https://covers.openlibrary.org/b/id/1-M.jpg" } }} size="sm" />
    );
    const imageEl = imageContainer.firstChild as HTMLElement;
    expect(placeholderEl.className).toContain("aspect-[2/3]");
    expect(imageEl.className).toContain("aspect-[2/3]");
    expect(placeholderEl.className).toContain("w-16");
    expect(imageEl.className).toContain("w-16");
  });
});
