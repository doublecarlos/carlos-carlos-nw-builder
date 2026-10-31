// The non-recognition half of pasting a screenshot into a description field: how a
// transcription is tidied for the field it lands in, and where it lands.
import { describe, it, expect } from "vitest";
import { gameIdFrom, insertText, tidyOcrText } from "../../src/lib/ocr-paste";

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

  it("reports nothing recognized as empty rather than whitespace", () => {
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

describe("gameIdFrom", () => {
  // The id is read off the tooltip's "Def:" line so a whole-tooltip screenshot yields only that.
  it("takes the id from a Def: line among other text", () => {
    expect(
      gameIdFrom("Neck of Power\nDef: Neck_M26_Artifact_R1\n+6,300 Power"),
    ).toBe("Neck_M26_Artifact_R1");
  });

  // The game prints several fields on one line; only the token after the label is the id.
  it("takes just the id when other fields share its line", () => {
    expect(
      gameIdFrom(
        "Level: 1 RepairVersion: 0 Def: Head_M33_Boe DispNameMsgKey: In.Bzt2gq",
      ),
    ).toBe("Head_M33_Boe");
  });

  // A crop of just the id is the id itself.
  it("takes a bare id as is", () => {
    expect(gameIdFrom(" Neck_M26_Artifact_R1 ")).toBe("Neck_M26_Artifact_R1");
  });

  // "Defense:" is a stat label, not the id line, and prose is not an id: a whole tooltip
  // without a Def line must not become one long token.
  it("finds nothing in text without a Def label or a bare id", () => {
    expect(gameIdFrom("Defense: +2,700")).toBeNull();
    expect(gameIdFrom("Omen of Doom Legendary Neck")).toBeNull();
  });
});
