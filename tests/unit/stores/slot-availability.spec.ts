// The stores keep "what the build stores is what the editor shows": every edit, restore, import
// and catalog change leaves no value in an unavailable slot. Uses the shipped weapon mod slots,
// which exist only under an artifact weapon.
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import * as catalog from "../../../src/data/catalog";
import type {
  Build,
  BuildParameterSlot,
  ItemPickerListSlot,
  ItemPickerSlot,
  PointAssignmentSlot,
  Slot,
} from "../../../src/types";

const ARTIFACT = "m32-omen-of-doom-celestial";
const PLAIN = "m28-voidtouched-pactblade";
const MOD = "modification-dark-spiral";
const RETIRED =
  "celestial-lion-s-presence-2-stalwart-golden-lion-damage-utility";

async function freshStores() {
  vi.resetModules();
  const { installWindowShim, installIdbShim } = await import("./window-shim");
  installWindowShim();
  installIdbShim();
  const builds = await import("../../../src/stores/builds");
  const history = await import("../../../src/stores/history");
  const layers = await import("../../../src/stores/layers");
  const buildEditor = await import("../../../src/stores/buildEditor");
  const compare = await import("../../../src/stores/compare");
  const notice = await import("../../../src/stores/notice");
  const resolved = await import("../../../src/stores/resolved");
  const storage = await import("../../../src/storage/storage");
  builds._setLoading(false);
  history._setLoading(false);
  layers._setLoading(false);
  builds.replaceActive(storage.defaultBuild("Build 1"));
  const active = () => builds.build.value!;
  return {
    builds,
    history,
    layers,
    buildEditor,
    compare,
    notice,
    resolved,
    storage,
    active,
  };
}

type Stores = Awaited<ReturnType<typeof freshStores>>;

/** A slot of the composed catalog, by predicate. */
function slotWhere<T extends Slot>(
  stores: Stores,
  test: (slot: Slot) => slot is T,
): T {
  const slot = stores.resolved.db.value.slots.find(test);
  if (!slot) throw new Error("no such slot");
  return slot;
}

const isPicker = (slot: Slot): slot is ItemPickerSlot =>
  slot.type === "item_picker";
const isList = (slot: Slot): slot is ItemPickerListSlot =>
  slot.type === "item_picker_list";
const isParam = (slot: Slot): slot is BuildParameterSlot =>
  slot.type === "build_parameter";
const isPoints = (slot: Slot): slot is PointAssignmentSlot =>
  slot.type === "point_assignment";

/** Leaves a mod under a plain weapon, bypassing the stores: the state an edit that forgot to
 *  prune would save. */
function makeStale(b: Build) {
  b.choices["gear.mainhand"] = PLAIN;
  b.choices["gear.mainhandMod"] = MOD;
}

/** A second build to compare against, holding a different duration. */
function addCompareBuild(stores: Stores) {
  const { builds, compare, storage, active } = stores;
  const first = active();
  const other = storage.defaultBuild("Other");
  other.context.duration = 42;
  builds.replaceActive(other);
  builds.replaceActive(first);
  compare.setCompareBuild(other.id);
  return other;
}

/** One call per exported mutation, each with arguments that reach its edit. */
const MUTATIONS: Record<string, (stores: Stores) => void> = {
  setChoice: ({ buildEditor }) => buildEditor.setChoice("gear.head", "ItemA"),
  addListRow: (stores) =>
    stores.buildEditor.addListRow(slotWhere(stores, isList)),
  removeListRow: (stores) => {
    const list = slotWhere(stores, isList);
    stores.active().listRows[list.id] = 1;
    stores.buildEditor.removeListRow(`${list.id}#1`);
  },
  setInput: ({ buildEditor }) =>
    buildEditor.setInput({ store: "context", path: "duration" }, 10),
  setSlotDisabled: (stores) =>
    stores.buildEditor.setSlotDisabled(
      slotWhere(
        stores,
        (slot): slot is ItemPickerSlot => slot.id === "gear.head",
      ),
      true,
    ),
  applyFromCompare: (stores) => {
    addCompareBuild(stores);
    stores.buildEditor.applyFromCompare("gear.head");
  },
  applyInputFromCompare: (stores) => {
    addCompareBuild(stores);
    stores.buildEditor.applyInputFromCompare({
      store: "context",
      path: "duration",
    });
  },
  setParam: (stores) =>
    stores.buildEditor.setParam(
      slotWhere(
        stores,
        (slot): slot is BuildParameterSlot =>
          isParam(slot) && slot.path === "duration",
      ),
      30,
    ),
  resetParamToDefault: (stores) =>
    stores.buildEditor.resetParamToDefault(slotWhere(stores, isParam)),
  applyParamFromCompare: (stores) => {
    addCompareBuild(stores);
    stores.buildEditor.applyParamFromCompare(slotWhere(stores, isParam));
  },
  applyRetiredItems: (stores) => {
    stores.active().choices[retiredSlot(stores)] = RETIRED;
    stores.buildEditor.applyRetiredItems();
  },
  applyRetiredItem: (stores) => {
    const slotId = retiredSlot(stores);
    stores.active().choices[slotId] = RETIRED;
    stores.buildEditor.applyRetiredItem(slotId);
  },
  resetAssignmentsToDefault: (stores) =>
    stores.buildEditor.resetAssignmentsToDefault(slotWhere(stores, isPoints)),
  clearSlots: ({ buildEditor }) => buildEditor.clearSlots(),
  resetAll: ({ buildEditor }) => buildEditor.resetAll(),
  copySection: (stores) => {
    const other = addCompareBuild(stores);
    stores.buildEditor.copySection(other.id, ["options"]);
  },
  clearSection: ({ buildEditor }) =>
    buildEditor.clearSection("options", "Options"),
  applyPreset: (stores) =>
    stores.buildEditor.applyPreset(stores.resolved.db.value.presets[0]),
};

/** buildEditor exports that write no slot content. */
const NOT_MUTATIONS = new Set([
  "undo",
  "redo",
  "renameBuild",
  "presetFromSection",
  "presetUpdatedFromSection",
]);

/** The slot that offers the retired item. */
function retiredSlot(stores: Stores): string {
  const db = stores.resolved.db.value;
  const item = db.get(RETIRED)!;
  return slotWhere(
    stores,
    (slot): slot is ItemPickerSlot =>
      isPicker(slot) &&
      (slot.filter === item.filter ||
        !!slot.tags?.some((tag) => item.tags?.includes(tag))),
  ).id;
}

describe("every build edit prunes", () => {
  it("has a case for every exported mutation", async () => {
    const { buildEditor } = await freshStores();
    const exported = Object.entries(buildEditor)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name)
      .filter((name) => !NOT_MUTATIONS.has(name));
    expect(exported.sort()).toEqual(Object.keys(MUTATIONS).sort());
  });

  for (const [name, run] of Object.entries(MUTATIONS)) {
    it(`${name} leaves no value in an unavailable slot`, async () => {
      const stores = await freshStores();
      const before = stores.history.undoLabel.value;
      makeStale(stores.active());
      run(stores);
      expect(stores.history.undoLabel.value).not.toBe(before);
      expect(stores.active().choices["gear.mainhandMod"]).toBeUndefined();
    });
  }
});

describe("a pruning edit", () => {
  it("clears the mod with the weapon swap, as one undo step", async () => {
    const { buildEditor, active, notice } = await freshStores();
    buildEditor.setChoice("gear.mainhand", ARTIFACT);
    buildEditor.setChoice("gear.mainhandMod", MOD);
    buildEditor.setInput(
      { store: "values", slotId: "gear.mainhandMod", kind: "stat", key: "x" },
      3,
    );

    buildEditor.setChoice("gear.mainhand", PLAIN);
    expect(active().choices["gear.mainhandMod"]).toBeUndefined();
    expect(active().values["gear.mainhandMod"]).toBeUndefined();
    expect(notice.notice.value).toBe("Cleared Mainhand mod");

    buildEditor.undo();
    expect(active().choices["gear.mainhand"]).toBe(ARTIFACT);
    expect(active().choices["gear.mainhandMod"]).toBe(MOD);
    expect(active().values["gear.mainhandMod"]).toEqual({ stat: { x: 3 } });
  });

  it("offers the undo on its notice", async () => {
    const { buildEditor, active, notice } = await freshStores();
    buildEditor.setChoice("gear.mainhand", ARTIFACT);
    buildEditor.setChoice("gear.mainhandMod", MOD);
    buildEditor.setChoice("gear.mainhand", PLAIN);

    notice.noticeAction.value!.run();
    expect(active().choices["gear.mainhandMod"]).toBe(MOD);
  });

  it("joins its own notice when the edit already has one", async () => {
    const { buildEditor, active, notice } = await freshStores();
    buildEditor.setChoice("gear.mainhand", ARTIFACT);
    buildEditor.setChoice("gear.mainhandMod", MOD);
    makeStale(active());
    buildEditor.clearSection("options", "Options");
    expect(notice.notice.value).toBe("Cleared Options; cleared Mainhand mod");
  });

  it("stays quiet when nothing was cleared", async () => {
    const { buildEditor, notice } = await freshStores();
    buildEditor.setChoice("gear.mainhand", ARTIFACT);
    buildEditor.setChoice("gear.mainhandMod", MOD);
    expect(notice.notice.value).toBe("");
  });
});

describe("builds arriving from elsewhere", () => {
  it("prunes a restored snapshot", async () => {
    const { builds, active, storage } = await freshStores();
    const stale = storage.defaultBuild("Stale");
    stale.id = active().id;
    makeStale(stale);
    builds.restoreSnapshot(JSON.stringify(stale));
    expect(active().choices["gear.mainhandMod"]).toBeUndefined();
  });

  it("prunes imported builds", async () => {
    const { builds, storage } = await freshStores();
    const stale = storage.defaultBuild("Imported");
    makeStale(stale);
    builds.importBuilds([stale], false);
    expect(builds.get(stale.id)!.choices["gear.mainhandMod"]).toBeUndefined();

    const replaced = storage.defaultBuild("Replaced");
    makeStale(replaced);
    builds.upsertImported(replaced, false);
    expect(
      builds.get(replaced.id)!.choices["gear.mainhandMod"],
    ).toBeUndefined();
  });

  it("prunes every stored build when the catalog hides a slot", async () => {
    const stores = await freshStores();
    const { builds, buildEditor, layers, active, storage, notice } = stores;
    buildEditor.setChoice("gear.mainhand", ARTIFACT);
    buildEditor.setChoice("gear.mainhandMod", MOD);
    const open = active();
    const other = storage.defaultBuild("Closed");
    other.choices["gear.mainhand"] = ARTIFACT;
    other.choices["gear.mainhandMod"] = MOD;
    builds.importBuilds([other], false);
    builds.replaceActive(open);

    const layer = layers.ensureTargetLayer();
    const slot = slotWhere(
      stores,
      (s): s is ItemPickerSlot => s.id === "gear.mainhandMod",
    );
    layers.updateOverlay(
      layer.id,
      catalog.upsert(layer.overlay, "slots", slot.id, {
        ...slot,
        availableWhen: { equipped: { tag: "artifact:offhand" } },
      }),
    );
    await nextTick();

    expect(open.choices["gear.mainhandMod"]).toBeUndefined();
    expect(builds.get(other.id)!.choices["gear.mainhandMod"]).toBeUndefined();
    expect(notice.notice.value).toContain("no longer available");
  });
});
