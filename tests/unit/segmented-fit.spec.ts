// SegmentedControl's one-row width, its fit decision and the grid it falls back to.
import { describe, it, expect } from "vitest";
import {
  fitsOneRow,
  gridColumns,
  oneRowWidth,
} from "../../src/lib/segmented-fit";

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

describe("gridColumns", () => {
  // Four 40px labels: one cell is 56px, so n columns need 56n + n + 1.
  const four = [40, 40, 40, 40];

  it("spreads columns evenly over the fewest rows that fit", () => {
    // Three columns fit (172px), but two rows of two read better than three and one.
    expect(gridColumns(four, chrome, 180)).toBe(2);
  });

  it("keeps three across when that is still one row fewer", () => {
    // Five options in three columns: two rows, the last spanning what is left.
    expect(gridColumns([40, 40, 40, 40, 40], chrome, 180)).toBe(3);
  });

  it("sizes every cell for the longest label", () => {
    // Two 40px cells would fit 120px, but the 70px label widens both.
    expect(gridColumns([40, 70, 40, 40], chrome, 120)).toBe(1);
  });

  it("falls back to a single column when two do not fit", () => {
    expect(gridColumns(four, chrome, 100)).toBe(1);
  });

  it("is a single column for one option or none", () => {
    expect(gridColumns([40], chrome, 30)).toBe(1);
    expect(gridColumns([], chrome, 30)).toBe(1);
  });
});
