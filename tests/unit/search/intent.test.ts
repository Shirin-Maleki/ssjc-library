import { describe, expect, it } from "vitest";
import { parseSearchIntent } from "@/lib/search/intent";

/**
 * Phase 5 correction pass — a dedicated audit of every structured free-text
 * phrasing docs/SEARCH.md documents as supported, verified directly against
 * `parseSearchIntent` (not just indirectly through `scoreBook`). Every signal here
 * is RANKING-ONLY (docs/SEARCH.md §2/§9's hard/strong/soft classification) — an
 * explicit UI Filter selection is the only thing that ever hard-excludes a book;
 * nothing parsed from free text here converts into a silent hard filter.
 */
describe("parseSearchIntent — structured signal audit", () => {
  it("an age range phrase ('2 to 5') resolves to its midpoint", () => {
    expect(parseSearchIntent("books for 2 to 5 year olds").ageYears).toBe(4); // round((2+5)/2) = 4 (rounds up .5)
    expect(parseSearchIntent("something for a 3 to 4 year old").ageYears).toBe(4);
  });

  it("an explicit single age still parses", () => {
    expect(parseSearchIntent("a book for age 3").ageYears).toBe(3);
    expect(parseSearchIntent("for a 4 year old").ageYears).toBe(4);
  });

  it("a duration range phrase does not collide with the age-range regex", () => {
    const intent = parseSearchIntent("a 5 to 10 minute read");
    expect(intent.durationBand).toBe("five_to_ten");
    expect(intent.ageYears).toBeUndefined();
  });

  it("'real photos' resolves to real photography specifically", () => {
    expect(parseSearchIntent("real photographs of animals").visualRealism).toEqual(["real_photography"]);
    expect(parseSearchIntent("real photos of animals").visualRealism).toEqual(["real_photography"]);
  });

  it("bare 'realistic' resolves to both real photography and realistic illustration (broader, less precise a claim)", () => {
    expect(parseSearchIntent("a realistic story about animals").visualRealism).toEqual([
      "real_photography",
      "realistic_illustration",
    ]);
  });

  it("'watercolor' resolves to the watercolor illustration style", () => {
    expect(parseSearchIntent("watercolor books about the sea").illustrationStyle).toBe("watercolor");
  });

  it("'collage' resolves to the collage illustration style", () => {
    expect(parseSearchIntent("a collage picture book").illustrationStyle).toBe("collage");
  });

  it("a catalog language's English name parses as a whole word", () => {
    expect(parseSearchIntent("a Swedish bedtime story").languageCode).toBe("sv");
  });

  it("an explicit minute count resolves through the same banding function real durations use", () => {
    expect(parseSearchIntent("a quick 3 minute read").durationBand).toBe("under_5");
    expect(parseSearchIntent("an 8 minute story").durationBand).toBe("five_to_ten");
  });

  it("a query with no recognizable structured phrase returns every field undefined", () => {
    const intent = parseSearchIntent("a story about a dragon");
    expect(intent.ageYears).toBeUndefined();
    expect(intent.durationBand).toBeUndefined();
    expect(intent.visualRealism).toBeUndefined();
    expect(intent.languageCode).toBeUndefined();
    expect(intent.illustrationStyle).toBeUndefined();
  });
});
