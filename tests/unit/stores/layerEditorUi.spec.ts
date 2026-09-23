// Tests for stores/layerEditorUi.ts: the per-layer tab, search and selection remembered
// across LayerEditor.vue remounts, plus the one-shot new-item seed BuildEditor.vue hands over.
import { describe, expect, it } from "vitest";
import {
  getState,
  seedNewItem,
  takeNewItemSeed,
} from "../../../src/stores/layerEditorUi";

describe("layerEditorUi store", () => {
  it("returns empty defaults for a layer never seen before", () => {
    const state = getState("layer-fresh");
    expect(state).toEqual({
      section: "",
      item: "",
      bonus: "",
      preset: "",
      slot: "",
      sectionId: "",
      slotsGroup: "",
      filter: "",
      status: "",
      q: "",
    });
  });

  it("returns the same reactive record on repeated calls for the same layer", () => {
    const first = getState("layer-a");
    first.q = "search text";
    const second = getState("layer-a");
    expect(second).toBe(first);
    expect(second.q).toBe("search text");
  });

  it("keeps state isolated per layer id", () => {
    const a = getState("layer-b");
    a.item = "item-1";
    const b = getState("layer-c");
    expect(b.item).toBe("");
    expect(a.item).toBe("item-1");
  });

  it("remembers the Filters tab's own selection", () => {
    const state = getState("layer-filters");
    state.section = "filters";
    state.filter = "gear_ring";
    expect(getState("layer-filters")).toMatchObject({
      section: "filters",
      filter: "gear_ring",
    });
  });

  it("remembers which of the Slots tab's three groups it last showed", () => {
    const state = getState("layer-slots");
    state.section = "slots";
    state.slotsGroup = "sections";
    state.sectionId = "gear";
    expect(getState("layer-slots")).toMatchObject({
      section: "slots",
      slotsGroup: "sections",
      sectionId: "gear",
    });
  });
});

describe("new-item seed", () => {
  it("hands the seed over exactly once", () => {
    const seed = { id: "", name: "", filter: "gear_head" };
    seedNewItem(seed);

    expect(takeNewItemSeed()).toBe(seed);
    expect(takeNewItemSeed()).toBeNull();
  });

  it("reads as null when nothing was seeded", () => {
    expect(takeNewItemSeed()).toBeNull();
  });

  it("keeps only the latest seed", () => {
    seedNewItem({ id: "", name: "", filter: "gear_head" });
    seedNewItem({ id: "", name: "", tags: ["companion_power:offense"] });

    expect(takeNewItemSeed()).toEqual({
      id: "",
      name: "",
      tags: ["companion_power:offense"],
    });
  });
});
