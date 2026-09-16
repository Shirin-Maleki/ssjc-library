// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadingListsProvider } from "@/components/reading-lists/ReadingListsProvider";
import { ReadingListsOverview } from "@/components/reading-lists/ReadingListsOverview";

const getAllMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/reading-lists/remoteRepository", () => ({
  RemoteReadingListRepository: vi.fn().mockImplementation(function () {
    return {
      getAll: getAllMock,
      getById: vi.fn(),
      create: vi.fn(),
      rename: vi.fn(),
      delete: vi.fn(),
      addBook: vi.fn(),
      removeBook: vi.fn(),
    };
  }),
}));

/**
 * Phase 4 replaced localStorage with a Server-Action-backed repository, so the one
 * client-side failure mode worth covering here is the fetch itself rejecting (e.g. the
 * database is unreachable). This used to be exercised in E2E via corrupted
 * localStorage (docs/DECISIONS.md) — a premise that no longer exists now that Reading
 * Lists aren't stored in the browser at all, so the equivalent failure mode moves down
 * to this level instead of being dropped.
 */
describe("ReadingListsProvider — initial load", () => {
  afterEach(() => {
    cleanup();
    getAllMock.mockReset();
  });

  it("shows a calm error message, distinct from a genuinely empty list, when the initial load fails", async () => {
    getAllMock.mockRejectedValue(new Error("network error"));

    render(
      <ReadingListsProvider>
        <ReadingListsOverview />
      </ReadingListsProvider>
    );

    expect(
      await screen.findByText("Reading Lists couldn't be loaded right now. Please try refreshing the page.")
    ).toBeTruthy();
    expect(screen.queryByText("No reading lists yet")).toBeNull();
  });

  it("shows the genuinely-empty state, not an error, when the load succeeds with zero lists", async () => {
    getAllMock.mockResolvedValue([]);

    render(
      <ReadingListsProvider>
        <ReadingListsOverview />
      </ReadingListsProvider>
    );

    expect(await screen.findByText("No reading lists yet")).toBeTruthy();
    expect(
      screen.queryByText("Reading Lists couldn't be loaded right now. Please try refreshing the page.")
    ).toBeNull();
  });
});
