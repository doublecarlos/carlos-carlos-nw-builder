// How authored description text breaks: a wrap is not a break, a blank line is.
import { describe, it, expect } from "vitest";
import { descriptionParagraphs } from "../../src/lib/description";

describe("descriptionParagraphs", () => {
  it("rejoins a soft-wrapped line into one paragraph", () => {
    expect(
      descriptionParagraphs("When you kill an enemy,\ngain 3% AP."),
    ).toEqual(["When you kill an enemy, gain 3% AP."]);
  });

  it("breaks on a blank line", () => {
    expect(descriptionParagraphs("First effect.\n\nSecond effect.")).toEqual([
      "First effect.",
      "Second effect.",
    ]);
  });

  it("treats a longer run of blank lines as one break", () => {
    expect(descriptionParagraphs("First.\n\n\n\nSecond.")).toEqual([
      "First.",
      "Second.",
    ]);
  });

  it("ignores the whitespace a blank line is padded with", () => {
    expect(descriptionParagraphs("First.\n   \nSecond.")).toEqual([
      "First.",
      "Second.",
    ]);
  });

  it("drops leading, trailing and empty paragraphs", () => {
    expect(descriptionParagraphs("\n\n  Only one.  \n\n")).toEqual([
      "Only one.",
    ]);
  });

  it("has nothing to show for empty or absent text", () => {
    expect(descriptionParagraphs("")).toEqual([]);
    expect(descriptionParagraphs(undefined)).toEqual([]);
    expect(descriptionParagraphs("  \n \n ")).toEqual([]);
  });
});
