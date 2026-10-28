// Coverage for lib/item-quality.ts.
import { describe, it, expect } from "vitest";
import {
  QUALITIES,
  isQuality,
  qualityColor,
  toneStyle,
} from "../../src/lib/item-quality";
import { ITEM_QUALITIES } from "../../src/types";

describe("item-quality", () => {
  it("lists every quality in rank order", () => {
    expect(QUALITIES.map((q) => q.id)).toEqual([...ITEM_QUALITIES]);
  });

  it("names a quality's color variable, and nothing for no quality", () => {
    expect(qualityColor("epic")).toBe("var(--quality-epic)");
    expect(qualityColor("")).toBeUndefined();
    expect(toneStyle(null)).toEqual({ "--tone": "currentColor" });
    expect(toneStyle("rare")).toEqual({ "--tone": "var(--quality-rare)" });
  });

  it("recognizes only known qualities", () => {
    expect(isQuality("mythic")).toBe(true);
    expect(isQuality("shiny")).toBe(false);
  });
});
