// Tests for stores/layerEditorUi.ts: the per-layer tab, search and selection remembered
// across LayerEditor.vue remounts, plus the one-shot new-item seed handed to the next editor.
import { describe, expect, it, vi } from "vitest";
import {
  getState,
  newItemSeed,
  openItem,
  openNewItem,
  seedNewItem,
  takeNewItemSeed,
} from "../../../src/stores/layerEditorUi";
import * as selection from "../../../src/stores/selection";

vi.mock("../../../src/stores/selection", () => ({ selectLayer: vi.fn() }));
vi.mock("../../../src/stores/layers", () => ({
  ensureTargetLayer: () => ({ id: "layer-target" }),
}));

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
      lastGroup: {},
      filter: "",
      tag: "",
      status: "",
      q: "",
      itemFilter: { quality: "", category: "", hideRetired: true },
      view: "list",
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

  it("remembers the Vocabulary tab's own selection", () => {
    const state = getState("layer-vocabulary");
    state.section = "vocabulary";
    state.tag = "gem:jade";
    expect(getState("layer-vocabulary")).toMatchObject({
      section: "vocabulary",
      tag: "gem:jade",
    });
  });

  it("remembers the group each multi-group tab last showed", () => {
    const state = getState("layer-slots");
    state.section = "slots";
    state.lastGroup = { slots: "sections", vocabulary: "tags" };
    state.sectionId = "gear";
    expect(getState("layer-slots")).toMatchObject({
      section: "slots",
      lastGroup: { slots: "sections", vocabulary: "tags" },
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

describe("openNewItem", () => {
  const seed = { id: "", name: "", filter: "mount" };

  it("seeds synchronously when the selection lands at once", () => {
    vi.mocked(selection.selectLayer).mockReturnValue(true);
    void openNewItem(seed);

    expect(selection.selectLayer).toHaveBeenCalledWith("layer-target");
    expect(newItemSeed.value).toEqual(seed);
    expect(takeNewItemSeed()).toBe(seed);
  });

  it("seeds after a confirmed discard", async () => {
    vi.mocked(selection.selectLayer).mockResolvedValue(true);
    await openNewItem(seed);

    expect(takeNewItemSeed()).toBe(seed);
  });

  it("leaves nothing pending when the discard is cancelled", async () => {
    vi.mocked(selection.selectLayer).mockResolvedValue(false);
    await openNewItem(seed);

    expect(takeNewItemSeed()).toBeNull();
  });
});

describe("openItem", () => {
  it("sets the layer's memory to the item's form before selecting the layer", () => {
    // A mounting editor restores from this memory, so it has to be in place first.
    vi.mocked(selection.selectLayer).mockImplementationOnce(() => {
      expect(getState("layer-target")).toMatchObject({
        section: "items",
        item: "item-x",
        view: "detail",
      });
      return true;
    });
    openItem("item-x");
    expect(selection.selectLayer).toHaveBeenCalledWith("layer-target");
  });
});
