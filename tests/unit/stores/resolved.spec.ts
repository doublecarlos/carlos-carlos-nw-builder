// A build swap must not replace `db` while the overlay list is unchanged, or every
// `WeakMap<Db, ...>` memo is discarded. These pin that contract.
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
});

describe("resolved.db stability", () => {
  it("keeps the same db when swapping between builds without a per-build catalog", async () => {
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

  it("rebuilds db when a build swaps to one carrying its own catalog", async () => {
    const { builds, resolved } = await freshStores();
    const plain = resolved.db.value;

    builds.createBuild();
    const withCatalog = builds.build.value.id;
    builds.build.value.catalog = emptyOverlay();

    expect(resolved.db.value).not.toBe(plain);

    // Back to a catalog-less build: the previous overlay list is gone, so a fresh db.
    builds.createBuild();
    expect(builds.build.value.id).not.toBe(withCatalog);
    expect(resolved.db.value).not.toBe(plain);
  });
});
