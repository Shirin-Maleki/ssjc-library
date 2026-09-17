// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchInput } from "@/components/find/SearchInput";
import { EMPTY_FILTERS } from "@/lib/search/filters";

const autocompleteAction = vi.fn();
vi.mock("@/lib/search/autocompleteAction", () => ({ autocompleteAction: (...args: unknown[]) => autocompleteAction(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

/**
 * Component-level regression coverage for the Phase 5 correction pass: topic and
 * language suggestions must render with the correct type label, exactly like every
 * other suggestion type already did — real DB-backed correctness (visibility
 * scoping, additional-language surfacing) is covered by
 * `tests/integration/db/searchRepository.test.ts`; the action's own ordering logic
 * by `tests/unit/search/autocompleteAction.test.ts`; this file only proves the UI
 * renders what the action returns.
 */
describe("SearchInput — topic and language autocomplete rendering", () => {
  afterEach(() => {
    cleanup();
    autocompleteAction.mockReset();
  });

  it("renders a topic suggestion with the 'Topic' type label", async () => {
    autocompleteAction.mockResolvedValue([{ value: "caterpillars", type: "topic" }]);
    render(<SearchInput initialQuery="" filters={EMPTY_FILTERS} />);
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: "caterp" } });
    fireEvent.focus(input);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(await screen.findByText("caterpillars")).toBeTruthy();
    expect(screen.getByText("Topic")).toBeTruthy();
  });

  it("renders a language suggestion with the 'Language' type label", async () => {
    autocompleteAction.mockResolvedValue([{ value: "Swedish", type: "language" }]);
    render(<SearchInput initialQuery="" filters={EMPTY_FILTERS} />);
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: "swed" } });
    fireEvent.focus(input);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(await screen.findByText("Swedish")).toBeTruthy();
    expect(screen.getByText("Language")).toBeTruthy();
  });
});
