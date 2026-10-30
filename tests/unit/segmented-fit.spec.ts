// SegmentedControl's one-row width and its fit decision.
import { describe, it, expect } from "vitest";
import { fitsOneRow, oneRowWidth } from "../../src/lib/segmented-fit";

const chrome = { paddingX: 16, border: 1 };

describe("oneRowWidth", () => {
  it("adds each label's padding and every segment's side borders", () => {
    // 3 labels, 3 paddings, 5 border lines: two each, but the last shares its left one.
    expect(oneRowWidth([40, 20, 60], chrome)).toBe(120 + 48 + 5);
  });

  it("is zero with no options", () => {
    expect(oneRowWidth([], chrome)).toBe(0);
  });

  it("counts a lone option's right border only", () => {
    expect(oneRowWidth([30], chrome)).toBe(30 + 16 + 1);
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
