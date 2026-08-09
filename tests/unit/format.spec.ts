// itemPreview and bonusStatPreview share the same underlying part-formatting/limit logic --
// these tests cover both the shape each returns and the schema-order/limit/zero-filtering
// behaviour that logic is responsible for.
import { describe, it, expect } from "vitest";
import { itemPreview, bonusStatPreview } from "../../src/lib/format";
import type { Item } from "../../src/types";

describe("itemPreview", () => {
  it("formats an item's own stats in schema order, signed", () => {
    const item: Item = {
      id: "i1",
      name: "Test Item",
      power: 100,
      combined_rating: 50,
    };
    expect(itemPreview(item)).toEqual({
      parts: ["CR +50", "Power +100"],
      more: 0,
    });
  });

  it("skips zero/falsy stats and the il field (shown separately as a badge)", () => {
    const item: Item = { id: "i1", name: "Test Item", il: 999, power: 0 };
    expect(itemPreview(item)).toEqual({ parts: [], more: 0 });
  });

  it("caps parts at `limit` and reports the remainder as `more`", () => {
    const item: Item = {
      id: "i1",
      name: "Test Item",
      combined_rating: 10,
      power: 20,
      acc: 30,
      ca: 40,
    };
    expect(itemPreview(item, 2)).toEqual({
      parts: ["CR +10", "Power +20"],
      more: 2,
    });
  });

  it("returns an empty preview for a null/undefined item", () => {
    expect(itemPreview(null)).toEqual({ parts: [], more: 0 });
    expect(itemPreview(undefined)).toEqual({ parts: [], more: 0 });
  });
});

describe("bonusStatPreview", () => {
  it("formats a summed bonus-stat record the same way itemPreview formats an item", () => {
    expect(bonusStatPreview({ ca: 25, power: 10 })).toEqual({
      parts: ["Power +10", "CA +25"],
      more: 0,
    });
  });

  it("returns an empty preview for null/undefined (no bonus preview context, or nothing active)", () => {
    expect(bonusStatPreview(null)).toEqual({ parts: [], more: 0 });
    expect(bonusStatPreview(undefined)).toEqual({ parts: [], more: 0 });
  });

  it("caps parts at `limit`, same as itemPreview", () => {
    expect(
      bonusStatPreview({ combined_rating: 1, power: 2, acc: 3, ca: 4 }, 2),
    ).toEqual({ parts: ["CR +1", "Power +2"], more: 2 });
  });
});
