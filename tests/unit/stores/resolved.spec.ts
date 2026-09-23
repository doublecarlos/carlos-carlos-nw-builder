// `db` is composed from the enabled layers and nothing else, so which build is active never
// touches it: swapping builds must not replace `db`, or every `WeakMap<Db, ...>` memo keyed on
// it is discarded. These pin that contract.
import { describe, expect, it, vi } from "vitest";
import type { CatalogOverlay } from "../../../src/types";

async function freshStores() {
  vi.resetModules();
  // The stores get a fresh `storage/idb` from `resetModules`, so the shims are loaded after it.
  const { installWindowShim, installIdbShim } = await import("./window-shim");
  installWindowShim();
  installIdbShim();
  const builds = await import("../../../src/stores/builds");
  const layers = await import("../../../src/stores/layers");
  const resolved = await import("../../../src/stores/resolved");
  builds._setLoading(false);
  layers._setLoading(false);
  return { builds, layers, resolved };
}

const emptyOverlay = (): CatalogOverlay => ({
  items: {},
  bonuses: {},
  sectionPresets: {},
  slots: {},
  sections: {},
  filters: {},
});

describe("resolved.db stability", () => {
  it("keeps the same db when swapping between builds", async () => {
    const { builds, resolved } = await freshStores();
    const first = resolved.db.value;
    const before = builds.build.value.id;

    builds.createBuild();

    expect(builds.build.value.id).not.toBe(before);
    expect(resolved.db.value).toBe(first);
  });

  it("keeps the same db when the active build's choices change", async () => {
    const { builds, resolved } = await freshStores();
    const first = resolved.db.value;

    builds.build.value.choices.ring1 = "some-item";

    expect(resolved.db.value).toBe(first);
  });

  it("rebuilds db when an enabled layer's overlay changes", async () => {
    const { layers, resolved } = await freshStores();
    const first = resolved.db.value;
    const layer = layers.createLayer("Layer");

    // A layer existing at all already changes the overlay list identity, so it has its own db.
    const afterCreate = resolved.db.value;
    expect(afterCreate).not.toBe(first);

    layers.updateOverlay(layer.id, emptyOverlay());
    expect(resolved.db.value).not.toBe(afterCreate);
  });
});

describe("resolved.overlays", () => {
  it("is the enabled layers' overlays and nothing else", async () => {
    const { layers, resolved } = await freshStores();
    const bottom = layers.createLayer("Bottom");
    const top = layers.createLayer("Top");
    await layers.moveLayerTo(top.id, 0);

    // Lowest priority first, so the top layer folds last.
    expect(resolved.overlays.value).toEqual([bottom.overlay, top.overlay]);

    layers.setLayerEnabled(bottom.id, false);
    expect(resolved.overlays.value).toEqual([top.overlay]);
  });
});
