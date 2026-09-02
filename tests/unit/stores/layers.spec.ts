// Tests for stores/layers.ts: create/duplicate/delete/reorder, enable/disable,
// ensureTargetLayer, allocatableIds, persistence.
import { describe, expect, it, vi } from "vitest";
import type { SectionPreset } from "../../../src/types";

async function freshStores() {
  vi.resetModules();
  // The stores get a fresh `storage/idb` from `resetModules`, so the shims are loaded after
  // it: a `setBackend` bound to this file's own import would land on the stale instance and
  // leave the stores reaching for an IndexedDB the node environment has not got.
  const { installWindowShim, installIdbShim } = await import("./window-shim");
  installWindowShim();
  installIdbShim();
  const layers = await import("../../../src/stores/layers");
  const selection = await import("../../../src/stores/selection");
  const trash = await import("../../../src/stores/trash");
  layers._setLoading(false);
  return { layers, selection, trash };
}

describe("layers store", () => {
  it("ensureTargetLayer creates Layer 1 when empty", async () => {
    const { layers } = await freshStores();
    const l = layers.ensureTargetLayer();
    expect(l.name).toBe("Layer 1");
    expect(layers.layers.value.length).toBe(1);
  });

  it("createLayer names sequentially", async () => {
    const { layers } = await freshStores();
    const l1 = layers.createLayer();
    const l2 = layers.createLayer();
    expect(l1.name).toBe("Layer 1");
    expect(l2.name).toBe("Layer 2");
  });

  it("createLayer names sequentially after a middle delete", async () => {
    const { layers } = await freshStores();
    layers.createLayer("A");
    layers.createLayer("B");
    layers.createLayer("C");
    layers.deleteLayer("B");
    const l = layers.createLayer();
    // Should count existing layers, not reuse the gap.
    expect(l.name).toMatch(/^Layer \d+$/);
  });

  it("duplicateLayer copies and appends", async () => {
    const { layers } = await freshStores();
    const orig = layers.createLayer("Original");
    layers.duplicateLayer(orig.id);
    expect(layers.layers.value.length).toBe(2);
    const copy = layers.layers.value.find((l) => l.name === "Original copy");
    expect(copy).toBeDefined();
  });

  it("deleteLayer moves to trash", async () => {
    const { layers, trash } = await freshStores();
    layers.createLayer("A");
    layers.createLayer("B");
    const idB = layers.layers.value.find((l) => l.name === "B")!.id;
    layers.deleteLayer(idB);
    expect(layers.layers.value.every((l) => l.id !== idB)).toBe(true);
    expect(trash.trashed.value.some((e) => e.item.id === idB)).toBe(true);
  });

  it("deleteLayer deletes the last layer without replacement", async () => {
    const { layers, trash } = await freshStores();

    // ensureTargetLayer creates Layer 1 when empty.
    const old = layers.ensureTargetLayer();
    expect(layers.layers.value.length).toBe(1);

    layers.deleteLayer(old.id);

    // The old layer should be in trash.
    expect(trash.trashed.value.some((e) => e.item.id === old.id)).toBe(true);

    // There should be no layers left.
    expect(layers.layers.value.length).toBe(0);
  });

  it("moveLayer clamps at both ends", async () => {
    const { layers } = await freshStores();
    layers.createLayer("A");
    layers.createLayer("B");
    const idA = layers.layers.value.find((l) => l.name === "A")!.id;

    // Moving first item up should keep it first.
    layers.moveLayer(idA, -1);
    expect(layers.layers.value[0].name).toBe("A");

    // Moving last item down should keep it last.
    const idB = layers.layers.value.find((l) => l.name === "B")!.id;
    layers.moveLayer(idB, 1);
    expect(layers.layers.value[layers.layers.value.length - 1].name).toBe("B");
  });

  it("moveLayer swaps with the neighbour in both directions", async () => {
    const { layers } = await freshStores();
    layers.createLayer("A");
    layers.createLayer("B");
    const idA = layers.layers.value.find((l) => l.name === "A")!.id;

    await layers.moveLayer(idA, 1);
    expect(layers.layers.value.map((l) => l.name)).toEqual(["B", "A"]);

    await layers.moveLayer(idA, -1);
    expect(layers.layers.value.map((l) => l.name)).toEqual(["A", "B"]);
  });

  it("moveLayerTo drops a layer at an arbitrary index, not just a neighbour swap", async () => {
    const { layers } = await freshStores();
    layers.createLayer("A");
    layers.createLayer("B");
    layers.createLayer("C");
    layers.createLayer("D");
    const idA = layers.layers.value.find((l) => l.name === "A")!.id;

    // Drag A to land right after C -- same drop-index convention drag-and-drop uses.
    await layers.moveLayerTo(idA, 3);
    expect(layers.layers.value.map((l) => l.name)).toEqual([
      "B",
      "C",
      "A",
      "D",
    ]);
  });

  it("moveLayerTo clamps to the list bounds", async () => {
    const { layers } = await freshStores();
    layers.createLayer("A");
    const idA = layers.layers.value.find((l) => l.name === "A")!.id;
    await layers.moveLayerTo(idA, 999);
    expect(layers.layers.value[layers.layers.value.length - 1].id).toBe(idA);
  });

  it("setLayerEnabled toggles the enabled flag", async () => {
    const { layers } = await freshStores();
    const l = layers.createLayer();
    expect(l.enabled).toBe(true);
    layers.setLayerEnabled(l.id, false);
    expect(l.enabled).toBe(false);
    layers.setLayerEnabled(l.id, true);
    expect(l.enabled).toBe(true);
  });

  it("allocatableIds includes ids from disabled layers", async () => {
    const { layers } = await freshStores();
    const l = layers.createLayer();
    layers.updateOverlay(l.id, {
      items: { "custom-item": { id: "custom-item", name: "Test" } },
      bonuses: {},
      sectionPresets: {},
      slots: {},
    });
    layers.setLayerEnabled(l.id, false);
    const ids = layers.allocatableIds();
    expect(ids).toContain("custom-item");
  });

  it("allocatableIds includes section preset ids", async () => {
    const { layers } = await freshStores();
    const l = layers.createLayer();
    layers.updateOverlay(l.id, {
      items: {},
      bonuses: {},
      sectionPresets: {
        "custom-preset": {
          id: "custom-preset",
          label: "Test",
          section: "options",
        },
      },
      slots: {},
    });
    expect(layers.allocatableIds()).toContain("custom-preset");
  });

  it("allocatableIds returns empty when no layers have items", async () => {
    const { layers } = await freshStores();
    expect(layers.allocatableIds()).toEqual([]);
  });

  it("ensureTargetLayer prefers the last selected layer", async () => {
    const { layers } = await freshStores();
    layers.createLayer("A");
    const b = layers.createLayer("B");

    // The last created layer is selected by default, so ensureTargetLayer returns it.
    const target = layers.ensureTargetLayer();
    expect(target.id).toBe(b.id);
  });

  it("ensureTargetLayer falls back to the top layer after the selected one is deleted", async () => {
    const { layers } = await freshStores();
    layers.createLayer("A");
    layers.createLayer("B");

    // Delete the selected layer (B).
    layers.deleteLayer(layers.layers.value[layers.layers.value.length - 1].id);

    // ensureTargetLayer should fall back to the top remaining layer (A).
    const target = layers.ensureTargetLayer();
    expect(target.name).toBe("A");
  });

  it("enabledOverlays returns only enabled layers", async () => {
    const { layers } = await freshStores();
    layers.createLayer("A");
    const b = layers.createLayer("B");
    layers.setLayerEnabled(b.id, false);
    layers.createLayer("C");

    const overlays = layers.enabledOverlays.value;
    expect(overlays.length).toBe(2);
  });

  it("enabledOverlays folds top-last so the topmost layer wins", async () => {
    const { layers } = await freshStores();
    const a = layers.createLayer("A");
    const b = layers.createLayer("B");
    const overlayNaming = (name: string) => ({
      items: { i_x: { id: "i_x", name } },
      bonuses: {},
      sectionPresets: {},
      slots: {},
    });
    layers.updateOverlay(a.id, overlayNaming("from A"));
    layers.updateOverlay(b.id, overlayNaming("from B"));

    // Displayed order is [A, B]; A is on top, so it must be folded last.
    const names = layers.enabledOverlays.value.map((o) => o.items.i_x?.name);
    expect(names).toEqual(["from B", "from A"]);
  });
});

// `updatePreset` is called from the *build* editor, so which layer it picks is the whole
// question: writing anywhere below the layer a preset actually comes from would be shadowed
// by that layer and look like nothing happened.
describe("layers.updatePreset", () => {
  const preset = (fields: Partial<SectionPreset> = {}): SectionPreset => ({
    id: "p1",
    label: "P1",
    section: "options",
    params: { "options.role": "dps" },
    ...fields,
  });

  const overlayWith = (value: SectionPreset) => ({
    items: {},
    bonuses: {},
    sectionPresets: { [value.id]: value },
    slots: {},
  });

  it("writes into the layer that already defines the preset", async () => {
    const { layers } = await freshStores();
    const owner = layers.createLayer("Owner");
    const other = layers.createLayer("Other");
    layers.updateOverlay(owner.id, overlayWith(preset()));

    layers.updatePreset(preset({ params: { "options.role": "tank" } }));

    expect(owner.overlay.sectionPresets.p1).toEqual(
      preset({ params: { "options.role": "tank" } }),
    );
    expect(other.overlay.sectionPresets.p1).toBeUndefined();
  });

  it("picks the highest-priority owner when two layers define the same preset", async () => {
    const { layers } = await freshStores();
    // Displayed order is [top, bottom] and the topmost layer wins the fold, so the edit has
    // to land on `top` -- writing to `bottom` would be invisible.
    const top = layers.createLayer("Top");
    const bottom = layers.createLayer("Bottom");
    layers.updateOverlay(top.id, overlayWith(preset()));
    layers.updateOverlay(bottom.id, overlayWith(preset()));

    layers.updatePreset(preset({ label: "Renamed" }));

    expect(top.overlay.sectionPresets.p1?.label).toBe("Renamed");
    expect(bottom.overlay.sectionPresets.p1?.label).toBe("P1");
  });

  it("skips a disabled layer, which can't have contributed the preset", async () => {
    const { layers } = await freshStores();
    const off = layers.createLayer("Off");
    const on = layers.createLayer("On");
    layers.updateOverlay(off.id, overlayWith(preset()));
    layers.setLayerEnabled(off.id, false);

    const landed = layers.updatePreset(preset({ label: "Renamed" }));

    expect(landed.id).toBe(on.id);
    expect(off.overlay.sectionPresets.p1?.label).toBe("P1");
  });

  it("falls back to a target layer for a preset no layer defines", async () => {
    const { layers } = await freshStores();
    const landed = layers.updatePreset(preset());

    expect(layers.layers.value.length).toBe(1);
    expect(landed.overlay.sectionPresets.p1).toEqual(preset());
  });

  // The fallback above goes through `ensureTargetLayer`, which creates *and selects* a layer
  // when there is none -- from the build editor that would silently navigate away.
  it("leaves the selection where it was when it has to create a layer", async () => {
    const { layers, selection } = await freshStores();
    selection.selectBuild("b1");

    layers.updatePreset(preset());

    expect(selection.selection.value).toEqual({ kind: "build", id: "b1" });
  });
});
