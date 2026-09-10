import { describe, it, expect } from "vitest";
import { matchesQuery, filterAndRank } from "../../src/lib/text-filter";

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

describe("filterAndRank", () => {
  const options = [
    { value: "test-pick-longer", label: "Aardvark Pick" },
    { value: "test-pick", label: "Zed Pick" },
    { value: "other", label: "Other" },
  ];
  const rank = (query: string) =>
    filterAndRank(
      options,
      query,
      (option) => [option.value, option.label],
      (option) => option.value,
    ).map((option) => option.value);

  it("filters by the haystack and keeps the caller's order", () => {
    expect(rank("pick")).toEqual(["test-pick-longer", "test-pick"]);
  });

  it("moves an exact value match to the front, case-insensitively", () => {
    expect(rank("test-pick")).toEqual(["test-pick", "test-pick-longer"]);
    expect(rank("TEST-PICK")).toEqual(["test-pick", "test-pick-longer"]);
  });

  it("compares the value even when it is not in the haystack", () => {
    const byLabel = filterAndRank(
      options,
      "test-pick",
      (option) => option.label,
      (option) => option.value,
    );
    // Nothing's label contains the query, so nothing lists -- the value only ranks.
    expect(byLabel).toEqual([]);
  });

  it("an empty query lists everything unranked", () => {
    expect(rank("")).toEqual(["test-pick-longer", "test-pick", "other"]);
  });
});
