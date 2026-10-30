// SegmentedControl's one-row width and its fit decision.
import { describe, it, expect } from "vitest";
import { fitsOneRow, oneRowWidth } from "../../src/lib/segmented-fit";

const chrome = { paddingX: 16, border: 1 };

describe("oneRowWidth", () => {
  it("adds each label's padding and one shared border line between segments", () => {
    // 3 labels, 3 paddings, 4 border lines: outer left, two joins, outer right.
    expect(oneRowWidth([40, 20, 60], chrome)).toBe(120 + 48 + 4);
  });

  it("is zero with no options", () => {
    expect(oneRowWidth([], chrome)).toBe(0);
  });

  it("counts a single option's both borders", () => {
    expect(oneRowWidth([30], chrome)).toBe(30 + 16 + 2);
  });
});

describe("fitsOneRow", () => {
  it("fits when the row is no wider than the space", () => {
    expect(fitsOneRow(200, 200)).toBe(true);
    expect(fitsOneRow(150, 200)).toBe(true);
  });

  it("does not fit a row wider than the space", () => {
    expect(fitsOneRow(201, 200)).toBe(false);
  });

  it("forgives subpixel rounding in the summed text widths", () => {
    expect(fitsOneRow(200.4, 200)).toBe(true);
  });
});
