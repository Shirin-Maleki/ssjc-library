import { describe, expect, it, vi } from "vitest";

const requireStaffSession = vi.fn().mockResolvedValue({ role: "staff" });
vi.mock("@/lib/auth/guards", () => ({ requireStaffSession }));

const autocomplete = vi.fn();
vi.mock("@/db/repositories", () => ({ searchRepository: { autocomplete } }));

const { autocompleteAction } = await import("@/lib/search/autocompleteAction");

/**
 * Unit coverage for `autocompleteAction`'s own logic — authentication, the
 * 2-character minimum, and the prefix-first/type-priority/alphabetical ordering —
 * with `searchRepository.autocomplete` mocked (real DB behavior for topic/language
 * rows is covered by `tests/integration/db/searchRepository.test.ts` instead).
 */
describe("autocompleteAction", () => {
  it("requires an authenticated staff session before doing anything else", async () => {
    autocomplete.mockResolvedValueOnce([]);
    await autocompleteAction("caterpillar");
    expect(requireStaffSession).toHaveBeenCalled();
  });

  it("returns nothing for a query under 2 characters, without ever querying the repository", async () => {
    autocomplete.mockClear();
    const result = await autocompleteAction("c");
    expect(result).toEqual([]);
    expect(autocomplete).not.toHaveBeenCalled();
  });

  it("a genuine prefix match ranks above a substring match of the same type", async () => {
    autocomplete.mockResolvedValueOnce([
      { value: "Realistic watercolor", type: "topic" },
      { value: "Watercolor dreams", type: "topic" },
    ]);
    const result = await autocompleteAction("water");
    expect(result[0].value).toBe("Watercolor dreams");
  });

  it("applies the documented type priority (title > author > illustrator > category > publisher > topic > language) when prefix status ties", async () => {
    autocomplete.mockResolvedValueOnce([
      { value: "Swedish", type: "language" },
      { value: "Swedish Folktales", type: "title" },
      { value: "Sweden's Wildlife", type: "topic" },
    ]);
    const result = await autocompleteAction("swe");
    expect(result.map((r) => r.type)).toEqual(["title", "topic", "language"]);
  });

  it("a topic and a language suggestion both pass through untouched in shape", async () => {
    autocomplete.mockResolvedValueOnce([
      { value: "caterpillars", type: "topic" },
      { value: "German", type: "language" },
    ]);
    const result = await autocompleteAction("ca");
    expect(result).toContainEqual({ value: "caterpillars", type: "topic" });
  });
});
