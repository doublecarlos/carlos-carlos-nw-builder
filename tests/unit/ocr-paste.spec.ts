// The non-recognition half of pasting a screenshot into a description field: how a
// transcription is tidied for the field it lands in, and where it lands.
import { describe, it, expect } from "vitest";
import { insertText, tidyOcrText } from "../../src/lib/ocr-paste";

describe("tidyOcrText", () => {
  it("puts a wrapped paragraph on one line for a one-line field", () => {
    expect(
      tidyOcrText("When you kill an enemy,\ngain 3% Action\nPoints.\n", true),
    ).toBe("When you kill an enemy, gain 3% Action Points.");
  });

  it("keeps line breaks everywhere else", () => {
    expect(tidyOcrText("First line\nSecond line", false)).toBe(
      "First line\nSecond line",
    );
  });

  it("trims trailing space and collapses blank runs in multi-line text", () => {
    expect(tidyOcrText("\n\nFirst   \n\n\n\nSecond \n\n", false)).toBe(
      "First\n\nSecond",
    );
  });

  it("reports nothing recognised as empty rather than whitespace", () => {
    expect(tidyOcrText("  \n \n", false)).toBe("");
    expect(tidyOcrText("  \n \n", true)).toBe("");
  });
});

describe("insertText", () => {
  it("inserts at the caret", () => {
    expect(insertText("ab", 1, 1, "X")).toEqual({ value: "aXb", caret: 2 });
  });

  it("replaces the selection, as an ordinary paste would", () => {
    expect(insertText("abcd", 1, 3, "X")).toEqual({ value: "aXd", caret: 2 });
  });

  it("clamps a range that no longer fits the value", () => {
    expect(insertText("ab", 9, 12, "X")).toEqual({ value: "abX", caret: 3 });
  });

  it("clamps an inverted range", () => {
    expect(insertText("abcd", 3, 1, "X")).toEqual({ value: "abcXd", caret: 4 });
  });
});
