import { describe, it, expect } from "vitest";
import { matchesQuery } from "../../src/lib/text-filter";

describe("matchesQuery", () => {
  it("matches a plain substring", () => {
    expect(matchesQuery("Celestial Amethyst", "ame")).toBe(true);
    expect(matchesQuery("Celestial Amethyst", "xyz")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(matchesQuery("Celestial Amethyst", "CEL")).toBe(true);
  });

  it("requires every whitespace-separated word to match, in any order", () => {
    expect(matchesQuery("Celestial Amethyst", "cel ame")).toBe(true);
    expect(matchesQuery("Celestial Amethyst", "ame cel")).toBe(true);
    expect(matchesQuery("Celestial Amethyst", "cel xyz")).toBe(false);
  });

  it("collapses repeated whitespace between words", () => {
    expect(matchesQuery("Celestial Amethyst", "cel    ame")).toBe(true);
  });

  it("treats an empty or whitespace-only query as matching everything", () => {
    expect(matchesQuery("Celestial Amethyst", "")).toBe(true);
    expect(matchesQuery("Celestial Amethyst", "   ")).toBe(true);
  });

  it("accepts a list of fields, matching a word against any one of them", () => {
    expect(matchesQuery(["Head Slot", "Celestial Amethyst"], "head ame")).toBe(
      true,
    );
    expect(matchesQuery(["Head Slot", "Celestial Amethyst"], "head xyz")).toBe(
      false,
    );
  });

  it("does not let a word match across a field boundary", () => {
    // "cel" ends field 1 and "estial" starts field 2 -- joined without a separator this
    // would falsely read as "celestial" despite neither field containing that word.
    expect(matchesQuery(["...cel", "estial..."], "celestial")).toBe(false);
  });
});
