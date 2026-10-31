// Coverage for lib/item-quality.ts.
import { describe, it, expect } from "vitest";
import { QUALITIES, isQuality } from "../../src/lib/item-quality";
import { ITEM_QUALITIES } from "../../src/types";

describe("item-quality", () => {
  it("lists every quality in rank order", () => {
    expect(QUALITIES.map((q) => q.id)).toEqual([...ITEM_QUALITIES]);
  });

  it("recognizes only known qualities", () => {
    expect(isQuality("mythic")).toBe(true);
    expect(isQuality("shiny")).toBe(false);
  });
});
