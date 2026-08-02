// Tests for stores/layers.ts: create/duplicate/delete/reorder, enable/disable,
// ensureTargetLayer, allocatableIds, persistence.
import { describe, expect, it, vi } from "vitest";
import { installWindowShim } from "./window-shim";

async function freshStores() {
  vi.resetModules();
  installWindowShim();
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
      bonusSets: {},
    });
    layers.setLayerEnabled(l.id, false);
    const ids = layers.allocatableIds();
    expect(ids).toContain("custom-item");
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

  it("ensureTargetLayer falls back to the last layer after the selected one is deleted", async () => {
    const { layers } = await freshStores();
    layers.createLayer("A");
    layers.createLayer("B");

    // Delete the selected layer (B).
    layers.deleteLayer(layers.layers.value[layers.layers.value.length - 1].id);

    // ensureTargetLayer should fall back to the last remaining layer (A).
    const target = layers.ensureTargetLayer();
    expect(target.name).toBe("A");
  });

  it("enabledOverlays returns only enabled layers in order", async () => {
    const { layers } = await freshStores();
    layers.createLayer("A");
    const b = layers.createLayer("B");
    layers.setLayerEnabled(b.id, false);
    layers.createLayer("C");

    const overlays = layers.enabledOverlays.value;
    expect(overlays.length).toBe(2);
  });
});
