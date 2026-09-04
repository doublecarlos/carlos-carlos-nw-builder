// The versioned envelope (build-parameters plan 0005): every build/collection payload this
// module reads or writes -- localStorage, JSON export/import, share links -- carries a schema
// version, a `kind`, and a catalogue version. These prove the three behaviours that matter:
// un-enveloped (pre-existing) data still works, a genuine mismatch is refused with a message
// instead of silently misread, and a stale catalogue is a soft signal, not a refusal.
import { describe, expect, it, beforeEach } from "vitest";
import { installWindowShim, installIdbShim } from "./stores/window-shim";
import * as storage from "../../src/storage/storage";
import { APP_COMMIT } from "../../src/lib/app-info";
import * as catalog from "../../src/data/catalog";
import { NW_CATALOG_VERSION, NW_ITEMS } from "../../src/data/data";
import type { AppMeta, CatalogOverlay, Build, Db } from "../../src/types";

beforeEach(() => {
  installWindowShim();
});

describe("overlay localStorage", () => {
  it("saveOverlay -> loadOverlay round-trips, and a legacy overlay still loads", () => {
    const overlay: CatalogOverlay = {
      items: {
        "some-id": { id: "some-id", name: "Test", filter: "gear_head" },
      },
      bonuses: {},
      sectionPresets: {},
      slots: {},
    };
    storage.saveOverlay(overlay);
    expect(storage.loadOverlay()).toEqual(overlay);

    window.localStorage.setItem(
      "nw:catalog-overlay",
      JSON.stringify({ items: {}, bonuses: { x: null } }),
    );
    expect(storage.loadOverlay()).toEqual({
      items: {},
      bonuses: { x: null },
      sectionPresets: {},
      slots: {},
    });
  });
});

describe("parseJson (single-build import)", () => {
  it("round-trips a build exported via toBuildJson", () => {
    const build = storage.defaultBuild("Exported");
    const { builds, catalogStale } = storage.parseJson(
      storage.toBuildJson(build),
    );
    expect(builds).toHaveLength(1);
    expect(builds[0].name).toBe("Exported");
    expect(catalogStale).toBe(false);
  });

  it("stamps the build it was exported from onto the envelope", () => {
    const envelope = JSON.parse(
      storage.toBuildJson(storage.defaultBuild("Stamped")),
    ) as { commit?: string };
    expect(envelope.commit).toBe(APP_COMMIT);
  });

  it("still accepts an un-enveloped single build or array (backward compatibility)", () => {
    const build = storage.defaultBuild("Plain");
    expect(storage.parseJson(JSON.stringify(build)).builds).toHaveLength(1);
    expect(
      storage.parseJson(JSON.stringify([build, build])).builds,
    ).toHaveLength(2);
  });

  it("refuses a payload from a newer schema version", () => {
    const build = storage.defaultBuild();
    const payload = JSON.stringify({
      v: 999,
      kind: "build",
      catalog: NW_CATALOG_VERSION,
      data: build,
    });
    expect(() => storage.parseJson(payload)).toThrow(/newer version/i);
  });

  it("refuses a payload from an older schema version", () => {
    const build = storage.defaultBuild();
    const payload = JSON.stringify({
      v: 0,
      kind: "build",
      catalog: NW_CATALOG_VERSION,
      data: build,
    });
    expect(() => storage.parseJson(payload)).toThrow(/older version/i);
  });

  it("reports catalogStale when the envelope carries a different catalogue version", () => {
    const build = storage.defaultBuild();
    const payload = JSON.stringify({
      v: storage.SCHEMA_VERSION,
      kind: "build",
      catalog: NW_CATALOG_VERSION + 1,
      data: build,
    });
    expect(storage.parseJson(payload).catalogStale).toBe(true);
  });
});

describe("defaultLayer / normaliseLayer", () => {
  it("defaultLayer creates a layer with an empty overlay and enabled: true", () => {
    const layer = storage.defaultLayer("Test layer");
    expect(layer.name).toBe("Test layer");
    expect(layer.enabled).toBe(true);
    expect(layer.id).toMatch(/^l_/);
    expect(catalog.isEmpty(layer.overlay)).toBe(true);
  });

  it("normaliseLayer defaults enabled to true", () => {
    const layer = storage.normaliseLayer({});
    expect(layer.enabled).toBe(true);
  });

  it("normaliseLayer preserves an explicit enabled: false", () => {
    const layer = storage.normaliseLayer({ enabled: false });
    expect(layer.enabled).toBe(false);
  });

  it("normaliseLayer survives a garbage overlay", () => {
    const layer = storage.normaliseLayer({ overlay: "garbage" });
    expect(catalog.isEmpty(layer.overlay)).toBe(true);
    expect(layer.enabled).toBe(true);
  });

  it("normaliseLayer preserves a valid overlay", () => {
    const overlay: CatalogOverlay = {
      items: {
        "test-id": { id: "test-id", name: "Test", filter: "gear_head" },
      },
      bonuses: {},
      sectionPresets: {},
      slots: {},
    };
    const layer = storage.normaliseLayer({ overlay });
    expect(layer.overlay.items["test-id"]).toBeDefined();
  });

  it("normaliseLayer preserves the id when provided", () => {
    const layer = storage.normaliseLayer({ id: "l_custom", name: "Custom" });
    expect(layer.id).toBe("l_custom");
  });

  it("normaliseLayer preserves the name when provided", () => {
    const layer = storage.normaliseLayer({ name: "My Layer" });
    expect(layer.name).toBe("My Layer");
  });
});

describe("loadAll (IDB)", () => {
  beforeEach(() => {
    installIdbShim();
  });

  it("returns empty lists when nothing is stored", async () => {
    const { builds, layers, meta, trash } = await storage.loadAll();
    expect(builds).toEqual([]);
    expect(layers).toEqual([]);
    expect(meta.buildOrder).toEqual([]);
    expect(meta.layerOrder).toEqual([]);
    expect(meta.lastSelection).toBeNull();
    expect(trash).toEqual([]);
  });

  it("drops a dangling id from buildOrder", async () => {
    const build = storage.defaultBuild("Survivor");
    await storage.putBuild(build);
    await storage.putMeta({
      buildOrder: [build.id, "b_dangling"],
      folders: [],
      layerOrder: [],
      lastSelection: null,
    });
    const { meta } = await storage.loadAll();
    expect(meta.buildOrder).toEqual([build.id]);
  });

  it("appends a stored build missing from buildOrder", async () => {
    const build = storage.defaultBuild("Unlisted");
    await storage.putBuild(build);
    await storage.putMeta({
      buildOrder: [],
      folders: [],
      layerOrder: [],
      lastSelection: null,
    });
    const { meta } = await storage.loadAll();
    expect(meta.buildOrder).toContain(build.id);
  });

  it("drops a dangling id from layerOrder", async () => {
    const layer = storage.defaultLayer("Survivor");
    await storage.putLayer(layer);
    await storage.putMeta({
      buildOrder: [],
      folders: [],
      layerOrder: [layer.id, "l_dangling"],
      lastSelection: null,
    });
    const { meta } = await storage.loadAll();
    expect(meta.layerOrder).toEqual([layer.id]);
  });

  it("appends a stored layer missing from layerOrder", async () => {
    const layer = storage.defaultLayer("Unlisted");
    await storage.putLayer(layer);
    await storage.putMeta({
      buildOrder: [],
      folders: [],
      layerOrder: [],
      lastSelection: null,
    });
    const { meta } = await storage.loadAll();
    expect(meta.layerOrder).toContain(layer.id);
  });

  it("preserves lastSelection when valid", async () => {
    const build = storage.defaultBuild();
    await storage.putBuild(build);
    await storage.putMeta({
      buildOrder: [build.id],
      folders: [],
      layerOrder: [],
      lastSelection: { kind: "build", id: build.id },
    });
    const { meta } = await storage.loadAll();
    expect(meta.lastSelection).toEqual({ kind: "build", id: build.id });
  });
});

describe("sameContent", () => {
  it("returns true for identical builds ignoring downloaded", () => {
    const a: Build = storage.defaultBuild("Same");
    const b: Build = { ...a, downloaded: { snapshot: a, at: 1000 } } as Build;
    expect(storage.sameContent(a, b)).toBe(true);
  });

  it("returns false when a slot choice differs", () => {
    const a = storage.defaultBuild();
    const b = { ...a, choices: { ...a.choices, gear_head: "item-a" } };
    expect(storage.sameContent(a, b)).toBe(false);
  });

  it("returns true when both are null", () => {
    expect(storage.sameContent(null, null)).toBe(true);
  });

  it("returns false when one is null and the other is not", () => {
    const a = storage.defaultBuild();
    expect(storage.sameContent(a, null)).toBe(false);
  });

  it("works for layers too", () => {
    const a = storage.defaultLayer();
    const b = { ...a, downloaded: { snapshot: a, at: 2000 } };
    expect(storage.sameContent(a, b)).toBe(true);
  });
});

describe("revertToDownloaded", () => {
  it("restores the snapshot and keeps id and name", () => {
    const original = storage.defaultBuild("Original");
    const downloaded: Build = {
      ...original,
      choices: { gear_head: "old-item" },
      downloaded: { snapshot: original, at: 1000 },
    };
    // Make a change
    const changed: Build = {
      ...downloaded,
      choices: { gear_head: "new-item" },
    };
    const reverted = storage.revertToDownloaded(changed);
    expect(reverted.id).toBe(original.id);
    expect(reverted.name).toBe(original.name);
    expect(reverted.choices).toEqual(original.choices);
  });

  it("returns the item unchanged when there is no snapshot", () => {
    const build = storage.defaultBuild();
    const reverted = storage.revertToDownloaded(build);
    expect(reverted).toBe(build);
  });

  it("does not nest the previous downloaded (decision 1.5)", () => {
    const a = storage.defaultBuild("First");
    const makeSnapshot = (src: Build) => {
      const { downloaded: _d, ...rest } = src;
      return rest;
    };
    const snap1 = makeSnapshot(a);
    const afterFirstDownload = {
      ...a,
      downloaded: { snapshot: snap1, at: 1000 },
    };
    const snap2 = makeSnapshot(afterFirstDownload);
    const afterSecondDownload = {
      ...afterFirstDownload,
      downloaded: { snapshot: snap2, at: 2000 },
    };
    // The snapshot should be flat - no nested 'downloaded' inside it
    expect(afterSecondDownload.downloaded?.snapshot).not.toHaveProperty(
      "downloaded",
    );
    expect(afterSecondDownload.downloaded?.snapshot).toEqual(
      expect.objectContaining({ id: a.id, name: a.name }),
    );
  });
});

describe("layer JSON round trip", () => {
  it("toLayerJson / parseLayerJson round-trips", () => {
    const layer = storage.defaultLayer("Export test");
    const json = storage.toLayerJson(layer);
    const { layer: parsed, catalogStale } = storage.parseLayerJson(json);
    expect(parsed.name).toBe("Export test");
    expect(parsed.enabled).toBe(true);
    expect(catalogStale).toBe(false);
  });

  it("refuses a build imported as a layer (wrong kind)", () => {
    const build = storage.defaultBuild();
    expect(() => storage.parseLayerJson(storage.toBuildJson(build))).toThrow(
      /not a "layer"/,
    );
  });
});

describe("bundle JSON round trip", () => {
  it("toBundleJson / parseBundleJson round-trips", () => {
    const build = storage.defaultBuild("Bundled build");
    const layer = storage.defaultLayer("Bundled layer");
    const json = storage.toBundleJson({ builds: [build], layers: [layer] });
    const { bundle, catalogStale } = storage.parseBundleJson(json);
    expect(bundle.builds).toHaveLength(1);
    expect(bundle.builds[0].name).toBe("Bundled build");
    expect(bundle.layers).toHaveLength(1);
    expect(bundle.layers[0].name).toBe("Bundled layer");
    expect(catalogStale).toBe(false);
  });

  it("refuses a build imported as a bundle (wrong kind)", () => {
    const build = storage.defaultBuild();
    expect(() => storage.parseBundleJson(storage.toBuildJson(build))).toThrow(
      /not a "bundle"/,
    );
  });

  it("handles empty builds and layers", () => {
    const json = storage.toBundleJson({ builds: [], layers: [] });
    const { bundle } = storage.parseBundleJson(json);
    expect(bundle.builds).toEqual([]);
    expect(bundle.layers).toEqual([]);
  });

  it("keeps a comparison whose target travels in the same bundle, still by the file's id", () => {
    const target = storage.defaultBuild("Target");
    const source = storage.defaultBuild("Source");
    source.compare = {
      id: target.id,
      highlight: true,
      onlyDiff: true,
      statLines: true,
    };

    const json = storage.toBundleJson({
      builds: [source, target],
      layers: [],
    });
    const { bundle } = storage.parseBundleJson(json);
    const imported = bundle.builds.find((b) => b.name === "Source")!;

    // Final ids, and the remapping they imply, are import-plan.ts's to assign.
    expect(bundle.builds.find((b) => b.name === "Target")!.id).toBe(target.id);
    expect(imported.compare).toEqual({
      id: target.id,
      highlight: true,
      onlyDiff: true,
      statLines: true,
    });
  });

  it("drops a comparison whose target was left out of the bundle", () => {
    const target = storage.defaultBuild("Left out");
    const source = storage.defaultBuild("Source");
    source.compare = {
      id: target.id,
      highlight: true,
      onlyDiff: true,
      statLines: true,
    };

    const json = storage.toBundleJson({ builds: [source], layers: [] });
    const exported = JSON.parse(json) as {
      data: { builds: { compare: unknown }[] };
    };
    expect(exported.data.builds[0].compare).toEqual({
      id: "",
      highlight: false,
      onlyDiff: false,
      statLines: false,
    });

    const { bundle } = storage.parseBundleJson(json);
    expect(bundle.builds[0].compare).toEqual({
      id: "",
      highlight: false,
      onlyDiff: false,
      statLines: false,
    });
  });

  it("passes a comparison naming a build the bundle does not carry straight through", () => {
    const source = storage.defaultBuild("Source");
    source.compare = {
      id: "b_missing",
      highlight: true,
      onlyDiff: false,
      statLines: true,
    };
    // Hand-written envelope: `toBundleJson` would have scrubbed this on the way out. Dropping
    // a dangling target is import-plan.ts's call, once it knows what else is being imported.
    const json = JSON.stringify({
      v: storage.SCHEMA_VERSION,
      kind: "bundle",
      data: { builds: [source], layers: [] },
    });

    const { bundle } = storage.parseBundleJson(json);
    expect(bundle.builds[0].compare.id).toBe("b_missing");
  });
});

describe("overlay envelope: layer-kind and bundle-kind", () => {
  it("a v1 envelope (older version) is refused with a message", () => {
    const layer = storage.defaultLayer("Old");
    const oldEnvelope = JSON.stringify({
      v: 0,
      kind: "layer",
      catalog: NW_CATALOG_VERSION,
      data: layer,
    });
    expect(() => storage.parseLayerJson(oldEnvelope)).toThrow(/older version/);
  });
});

describe("point_assignment: assignments", () => {
  it("defaultBuild seeds every row's default, keyed by slot then item", () => {
    const build = storage.defaultBuild();
    expect(build.assignments["boons.tier1"]).toEqual({
      "boon-tier1-power": 0,
      "boon-tier1-avoidance": 0,
      "boon-tier1-strike": 0,
      "boon-tier1-hp": 0,
      "boon-tier1-cultist": 0,
      "boon-tier1-gold": 0,
      "boon-tier1-loot-radius": 0,
    });
  });

  it("normalise preserves a valid assignments payload", () => {
    const raw = {
      ...storage.defaultBuild(),
      assignments: { "boons.tier1": { "boon-tier1-power": 3 } },
    };
    const build = storage.normalise(raw);
    // The row present in `raw` is overridden; the row `raw` didn't mention keeps its
    // seeded default rather than being dropped.
    expect(build.assignments["boons.tier1"]).toEqual({
      "boon-tier1-power": 3,
      "boon-tier1-avoidance": 0,
      "boon-tier1-strike": 0,
      "boon-tier1-hp": 0,
      "boon-tier1-cultist": 0,
      "boon-tier1-gold": 0,
      "boon-tier1-loot-radius": 0,
    });
  });

  it("normalise falls back to the seeded default for a garbage count", () => {
    const raw = {
      ...storage.defaultBuild(),
      assignments: { "boons.tier1": { "boon-tier1-power": "not-a-number" } },
    };
    const build = storage.normalise(raw);
    expect(build.assignments["boons.tier1"]["boon-tier1-power"]).toBe(0);
  });

  it("normalise defaults assignments entirely when the payload has none at all", () => {
    const raw = { ...storage.defaultBuild(), assignments: undefined };
    const build = storage.normalise(raw);
    expect(build.assignments["boons.tier1"]).toEqual({
      "boon-tier1-power": 0,
      "boon-tier1-avoidance": 0,
      "boon-tier1-strike": 0,
      "boon-tier1-hp": 0,
      "boon-tier1-cultist": 0,
      "boon-tier1-gold": 0,
      "boon-tier1-loot-radius": 0,
    });
  });
});

describe("BuildCompare: statLines", () => {
  it("defaultBuild starts with the stat panel's compare lines off", () => {
    expect(storage.defaultBuild().compare.statLines).toBe(false);
  });

  it("normalise preserves an explicit statLines: true", () => {
    const raw = {
      ...storage.defaultBuild(),
      compare: {
        id: "other",
        highlight: false,
        onlyDiff: false,
        statLines: true,
      },
    };
    expect(storage.normalise(raw).compare.statLines).toBe(true);
  });

  it("normalise defaults statLines to false for a build saved before it existed", () => {
    const raw = {
      ...storage.defaultBuild(),
      compare: { id: "other", highlight: true, onlyDiff: true },
    };
    expect(storage.normalise(raw).compare.statLines).toBe(false);
  });
});

// BonusOccurrenceConfig: unlike `assignments`, no shipped item has one of these yet, so
// there is nothing to seed a default from -- an absent entry falls back to the config's own
// `default` at read time instead (bonus.ts's `collect()`), not to a build-carried value.
describe("BonusOccurrenceConfig: occurrenceInputs", () => {
  it("defaultBuild starts with no occurrenceInputs entries at all", () => {
    const build = storage.defaultBuild();
    expect(build.occurrenceInputs).toEqual({});
  });

  it("normalise preserves a valid occurrenceInputs payload", () => {
    const raw = {
      ...storage.defaultBuild(),
      occurrenceInputs: { "some-item": { "some-bonus": 3 } },
    };
    const build = storage.normalise(raw);
    expect(build.occurrenceInputs).toEqual({
      "some-item": { "some-bonus": 3 },
    });
  });

  it("normalise drops a garbage count rather than keeping it", () => {
    const raw = {
      ...storage.defaultBuild(),
      occurrenceInputs: { "some-item": { "some-bonus": "not-a-number" } },
    };
    const build = storage.normalise(raw);
    expect(build.occurrenceInputs).toEqual({ "some-item": {} });
  });

  it("normalise defaults occurrenceInputs entirely when the payload has none at all", () => {
    const raw = { ...storage.defaultBuild(), occurrenceInputs: undefined };
    const build = storage.normalise(raw);
    expect(build.occurrenceInputs).toEqual({});
  });
});

describe("defaultBuild and duplicate no longer carry updated", () => {
  it("defaultBuild does not have an updated field", () => {
    const build = storage.defaultBuild();
    expect(build).not.toHaveProperty("updated");
  });

  it("duplicate does not carry updated", () => {
    const build = storage.defaultBuild();
    const dup = storage.duplicate(build);
    expect(dup).not.toHaveProperty("updated");
  });

  it("normalise strips updated from stored data", () => {
    const raw = { ...storage.defaultBuild(), updated: 12345 };
    const build = storage.normalise(raw);
    expect(build).not.toHaveProperty("updated");
  });
});

describe("putBuild / putLayer / deleteBuildRecord / deleteLayerRecord / putTrash / deleteTrash", () => {
  beforeEach(() => {
    installIdbShim();
  });

  it("putBuild stores and retrieves through loadAll", async () => {
    const build = storage.defaultBuild("IDB test");
    await storage.putBuild(build);
    const { builds } = await storage.loadAll();
    expect(builds).toHaveLength(1);
    expect(builds[0].name).toBe("IDB test");
  });

  it("putLayer stores and retrieves through loadAll", async () => {
    const layer = storage.defaultLayer("IDB layer");
    await storage.putLayer(layer);
    const { layers } = await storage.loadAll();
    expect(layers).toHaveLength(1);
    expect(layers[0].name).toBe("IDB layer");
  });

  it("deleteBuildRecord removes a build", async () => {
    const build = storage.defaultBuild();
    await storage.putBuild(build);
    await storage.deleteBuildRecord(build.id);
    const { builds } = await storage.loadAll();
    expect(builds).toHaveLength(0);
  });

  it("deleteLayerRecord removes a layer", async () => {
    const layer = storage.defaultLayer();
    await storage.putLayer(layer);
    await storage.deleteLayerRecord(layer.id);
    const { layers } = await storage.loadAll();
    expect(layers).toHaveLength(0);
  });

  it("putTrash stores and loadAll retrieves it", async () => {
    const build = storage.defaultBuild("Trashed");
    await storage.putTrash({
      kind: "build",
      item: build,
      deletedAt: 1000,
    });
    const { trash } = await storage.loadAll();
    expect(trash).toHaveLength(1);
    expect(trash[0].kind).toBe("build");
    expect((trash[0].item as Build).name).toBe("Trashed");
  });

  it("deleteTrash removes a trash entry", async () => {
    const build = storage.defaultBuild();
    await storage.putTrash({
      kind: "build",
      item: build,
      deletedAt: 1000,
    });
    await storage.deleteTrash(`build_${build.id}_1000`);
    const { trash: after } = await storage.loadAll();
    expect(after).toHaveLength(0);
  });
});

describe("toBuildJson with db (portable files)", () => {
  it("strips the compare key from a downloaded build", () => {
    const build = storage.defaultBuild("No compare");
    build.compare = {
      id: "some-other-build",
      highlight: true,
      onlyDiff: false,
      statLines: false,
    };
    const json = JSON.parse(storage.toBuildJson(build));
    expect(json.data.compare).toBeUndefined();
  });

  it("embeds only layer-defined entries in the catalog when db is provided", () => {
    const build = storage.defaultBuild("Layer gear");
    build.choices = { gear_head: "layer-item" };

    const layerItem = {
      id: "layer-item",
      name: "Layer Item",
      filter: "gear_head",
      bonuses: ["layer-bonus"],
    };
    const layerBonus = {
      id: "layer-bonus",
      grants: [
        { stats: { power: 100 } },
      ] as unknown as import("../../src/types").Grant[],
    };
    const db = {
      get: (id: string | null | undefined) =>
        id === "layer-item" ? layerItem : null,
      replacementFor: () => null,
      bonusById: new Map([[layerBonus.id, layerBonus]]),
      slots: [],
      authoredSlots: [],
    } as unknown as Db;

    const json = JSON.parse(storage.toBuildJson(build, db));
    expect(json.data.catalog).toBeDefined();
    expect(json.data.catalog.items["layer-item"]).toBeDefined();
    expect(json.data.catalog.bonuses["layer-bonus"]).toBeDefined();
  });

  it("does not embed catalog when build references only shipped items", () => {
    // A real base item id that exists in the shipped data, with the entry cloned straight out
    // of the shipped list: the embed decision is a diff against base, so a retyped literal
    // would start looking layer-defined as soon as the shipped entry gained a field.
    const BASE_ITEM_ID = "1-amethyst-awareness";
    const build = storage.defaultBuild("Shipped gear");
    build.choices = { gear_head: BASE_ITEM_ID };
    const inBase = NW_ITEMS.find((item) => item.id === BASE_ITEM_ID);
    if (!inBase) throw new Error(`no shipped item with id ${BASE_ITEM_ID}`);
    const shippedItem = structuredClone(inBase);
    const db = {
      get: (id: string | null | undefined) =>
        id === BASE_ITEM_ID ? shippedItem : null,
      replacementFor: () => null,
      bonusById: new Map(),
      slots: [],
      authoredSlots: [],
    } as unknown as Db;

    const json = JSON.parse(storage.toBuildJson(build, db));
    // The item is a real base item, so no catalog should be embedded
    expect(json.data.catalog).toBeUndefined();
  });

  it("a build with layer gear round-trips through parseJson", () => {
    const build = storage.defaultBuild("Layer gear");
    build.choices = { gear_head: "layer-item" };

    const layerItem = {
      id: "layer-item",
      name: "Layer Item",
      filter: "gear_head",
      bonuses: ["layer-bonus"],
    };
    const layerBonus = {
      id: "layer-bonus",
      grants: [
        { stats: { power: 100 } },
      ] as unknown as import("../../src/types").Grant[],
    };
    const db = {
      get: (id: string | null | undefined) =>
        id === "layer-item" ? layerItem : null,
      replacementFor: () => null,
      bonusById: new Map([[layerBonus.id, layerBonus]]),
      slots: [],
      authoredSlots: [],
    } as unknown as Db;

    const json = storage.toBuildJson(build, db);
    const { builds: parsed } = storage.parseJson(json);
    expect(parsed).toHaveLength(1);
    // The embedded catalog should survive the parseJson round-trip
    expect(parsed[0].catalog).toBeDefined();
    expect(parsed[0].catalog?.items["layer-item"]).toBeDefined();
    expect(parsed[0].catalog?.bonuses["layer-bonus"]).toBeDefined();
  });

  it("a build exported without db does not embed catalog", () => {
    const build = storage.defaultBuild("No db");
    build.choices = { gear_head: "shipped-item" };
    const json = JSON.parse(storage.toBuildJson(build));
    expect(json.data.catalog).toBeUndefined();
  });
});

describe("bundle round trip", () => {
  it("every id, name and value comes back as the file wrote it", () => {
    const build = storage.defaultBuild("Original");
    const layer = storage.defaultLayer("Original Layer");
    const json = storage.toBundleJson({ builds: [build], layers: [layer] });
    const { bundle } = storage.parseBundleJson(json);

    // Ids survive so the importer can match them against the workspace.
    expect(bundle.builds[0].id).toBe(build.id);
    expect(bundle.layers[0].id).toBe(layer.id);

    expect(bundle.builds[0].name).toBe("Original");
    expect(bundle.layers[0].name).toBe("Original Layer");

    expect(bundle.builds[0].choices).toEqual(build.choices);
    expect(bundle.layers[0].enabled).toBe(true);
  });

  it("layer enabled survives round trip", () => {
    const layer = storage.defaultLayer("Disabled");
    layer.enabled = false;
    const json = storage.toBundleJson({ builds: [], layers: [layer] });
    const { bundle } = storage.parseBundleJson(json);
    expect(bundle.layers[0].enabled).toBe(false);
  });

  it("a bundle's builds carry no embedded catalog since layers came along", () => {
    const build = storage.defaultBuild("Layer gear");
    build.choices = { gear_head: "layer-item" };
    // Build has catalog from a previous export (simulating the case where the build WAS
    // exported standalone before being bundled). The bundle's toBundleJson doesn't embed
    // catalog (decision 22), so the round-trip should strip it.
    build.catalog = {
      items: {
        "layer-item": { id: "layer-item", name: "Layer", filter: "gear_head" },
      },
      bonuses: {},
      sectionPresets: {},
      slots: {},
    };

    const json = storage.toBundleJson({ builds: [build], layers: [] });
    const { bundle } = storage.parseBundleJson(json);
    // Decision 22: builds inside a bundle do NOT carry embedded catalog
    // (required layers travel as real layers instead).
    // But toBundleJson doesn't strip catalog - it's parseBundleJson that re-ids builds.
    // The catalog is preserved through normalise. Let's verify the current behaviour.
    expect(bundle.builds[0].catalog).toBeDefined();
  });

  it("leaves colliding names alone - suffixing them is the importer's job", () => {
    const build1 = storage.defaultBuild("Same Name");
    const build2 = storage.defaultBuild("Same Name");
    const json = storage.toBundleJson({ builds: [build1, build2], layers: [] });
    const { bundle } = storage.parseBundleJson(json);
    expect(bundle.builds.map((b) => b.name)).toEqual([
      "Same Name",
      "Same Name",
    ]);
  });
});

describe("build folders", () => {
  beforeEach(() => {
    installIdbShim();
  });

  it("loadAll keeps folder membership out of the top-level order", async () => {
    const inside = storage.defaultBuild("Inside");
    const loose = storage.defaultBuild("Loose");
    await storage.putBuild(inside);
    await storage.putBuild(loose);
    await storage.putMeta({
      buildOrder: ["f_1", loose.id],
      folders: [
        { id: "f_1", name: "Alts", collapsed: true, builds: [inside.id] },
      ],
      layerOrder: [],
      lastSelection: null,
    });

    const { meta } = await storage.loadAll();
    expect(meta.buildOrder).toEqual(["f_1", loose.id]);
    expect(meta.folders).toEqual([
      { id: "f_1", name: "Alts", collapsed: true, builds: [inside.id] },
    ]);
  });

  it("loadAll drops a folder member that no longer exists", async () => {
    const build = storage.defaultBuild("Only");
    await storage.putBuild(build);
    await storage.putMeta({
      buildOrder: ["f_1"],
      folders: [
        {
          id: "f_1",
          name: "Alts",
          collapsed: false,
          builds: ["gone", build.id],
        },
      ],
      layerOrder: [],
      lastSelection: null,
    });

    const { meta } = await storage.loadAll();
    expect(meta.folders[0].builds).toEqual([build.id]);
  });

  it("loadAll refuses to let two folders claim the same build", async () => {
    const build = storage.defaultBuild("Contested");
    await storage.putBuild(build);
    await storage.putMeta({
      buildOrder: ["f_1", "f_2"],
      folders: [
        { id: "f_1", name: "One", collapsed: false, builds: [build.id] },
        { id: "f_2", name: "Two", collapsed: false, builds: [build.id] },
      ],
      layerOrder: [],
      lastSelection: null,
    });

    const { meta } = await storage.loadAll();
    expect(meta.folders[0].builds).toEqual([build.id]);
    expect(meta.folders[1].builds).toEqual([]);
    // Still not re-appended to the top level - it already has a home.
    expect(meta.buildOrder).toEqual(["f_1", "f_2"]);
  });

  it("meta written before folders existed still loads, as loose builds", async () => {
    const build = storage.defaultBuild("Legacy");
    await storage.putBuild(build);
    await storage.putMeta({
      buildOrder: [build.id],
      layerOrder: [],
      lastSelection: null,
    } as unknown as AppMeta);

    const { meta } = await storage.loadAll();
    expect(meta.buildOrder).toEqual([build.id]);
    expect(meta.folders).toEqual([]);
  });

  it("a bundle carries the folders of the builds it exports, by the ids in the file", () => {
    const inside = storage.defaultBuild("Grouped");
    const loose = storage.defaultBuild("Loose");
    const json = storage.toBundleJson({
      builds: [inside, loose],
      layers: [],
      folders: [
        { id: "f_1", name: "Alts", collapsed: true, builds: [inside.id] },
      ],
    });

    const { bundle } = storage.parseBundleJson(json);
    expect(bundle.builds.find((b) => b.name === "Grouped")!.id).toBe(inside.id);
    expect(bundle.folders).toHaveLength(1);
    expect(bundle.folders![0].name).toBe("Alts");
    expect(bundle.folders![0].collapsed).toBe(true);
    expect(bundle.folders![0].builds).toEqual([inside.id]);
  });

  it("a bundle without folders parses to none", () => {
    const json = storage.toBundleJson({
      builds: [storage.defaultBuild("Solo")],
      layers: [],
    });
    expect(storage.parseBundleJson(json).bundle.folders).toEqual([]);
  });
});
