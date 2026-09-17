// stores/slotFilter.ts: three filters behind one clear button, with the supply filter (set from
// the Bonuses tab and the hover card) droppable on its own.
import { beforeEach, describe, expect, it, vi } from "vitest";

async function freshStore() {
  vi.resetModules();
  return import("../../../src/stores/slotFilter");
}

let store: Awaited<ReturnType<typeof freshStore>>;

beforeEach(async () => {
  store = await freshStore();
});

describe("slotFilter", () => {
  it("starts empty and inactive", () => {
    expect(store.isActive.value).toBe(false);
    expect(store.need.value).toBeNull();
    expect(store.label.value).toBe("");
  });

  it("showSuppliersOf sets the need and its label, and activates the filter", () => {
    store.showSuppliersOf({ kind: "tag", tag: "gem:amethyst" }, "amethyst");
    expect(store.need.value).toEqual({ kind: "tag", tag: "gem:amethyst" });
    expect(store.label.value).toBe("amethyst");
    expect(store.isActive.value).toBe(true);
  });

  it("a later showSuppliersOf replaces the need rather than adding to it", () => {
    store.showSuppliersOf({ kind: "bonus", bonusId: "a" }, "A");
    store.showSuppliersOf({ kind: "item", itemId: "b" }, "B");
    expect(store.need.value).toEqual({ kind: "item", itemId: "b" });
    expect(store.label.value).toBe("B");
  });

  it("clearNeed drops the need and leaves the text and stat filters alone", () => {
    store.text.value = "boons";
    store.stat.value = "power";
    store.showSuppliersOf({ kind: "bonus", bonusId: "a" }, "A");

    store.clearNeed();

    expect(store.need.value).toBeNull();
    expect(store.label.value).toBe("");
    expect(store.text.value).toBe("boons");
    expect(store.stat.value).toBe("power");
    expect(store.isActive.value).toBe(true);
  });

  it("clear drops all three", () => {
    store.text.value = "boons";
    store.stat.value = "power";
    store.showSuppliersOf({ kind: "bonus", bonusId: "a" }, "A");

    store.clear();

    expect(store.text.value).toBe("");
    expect(store.stat.value).toBe("");
    expect(store.need.value).toBeNull();
    expect(store.isActive.value).toBe(false);
  });

  it("whitespace-only text does not count as a filter", () => {
    store.text.value = "   ";
    expect(store.isActive.value).toBe(false);
  });
});
