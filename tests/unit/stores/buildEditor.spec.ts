// Undo coalescing was previously untestable in isolation -- it lived inside App.vue, entangled
// with routing/persistence/every other concern. Now that it's its own module, these prove the
// coalescing behaviour directly: same key within the window collapses to one undo step: a
// different key, or the window elapsing, doesn't.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as storage from "../../../src/storage/storage";

async function freshStores() {
  vi.resetModules();
  // The stores get a fresh `storage/idb` from `resetModules`, so the shims are loaded after
  // it: a `setBackend` bound to this file's own import would land on the stale instance and
  // leave the stores reaching for an IndexedDB the node environment has not got.
  const { installWindowShim, installIdbShim } = await import("./window-shim");
  installWindowShim();
  const idb = installIdbShim();
  const builds = await import("../../../src/stores/builds");
  const history = await import("../../../src/stores/history");
  const layers = await import("../../../src/stores/layers");
  const selection = await import("../../../src/stores/selection");
  const trash = await import("../../../src/stores/trash");
  const buildEditor = await import("../../../src/stores/buildEditor");
  const compare = await import("../../../src/stores/compare");
  const resolved = await import("../../../src/stores/resolved");
  const meta = await import("../../../src/stores/meta");
  builds._setLoading(false);
  history._setLoading(false);
  layers._setLoading(false);
  return {
    builds,
    history,
    layers,
    selection,
    trash,
    buildEditor,
    compare,
    resolved,
    meta,
    idb,
  };
}

describe("buildEditor undo coalescing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses consecutive edits of the same slot into one undo step", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setChoice("ring1", "ItemA");
    buildEditor.setChoice("ring1", "ItemB");

    expect(builds.build.value.choices.ring1).toBe("ItemB");
    buildEditor.undo();
    expect(builds.build.value.choices.ring1).toBeUndefined();
    expect(buildEditor.canUndo.value).toBe(false);
  });

  it("does not coalesce edits to a different slot", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setChoice("ring1", "ItemA");
    buildEditor.setChoice("ring2", "ItemC");

    buildEditor.undo();
    expect(builds.build.value.choices.ring2).toBeUndefined();
    expect(builds.build.value.choices.ring1).toBe("ItemA");

    buildEditor.undo();
    expect(builds.build.value.choices.ring1).toBeUndefined();
    expect(buildEditor.canUndo.value).toBe(false);
  });

  it("does not coalesce once the coalescing window has elapsed", async () => {
    vi.useFakeTimers();
    const { builds, buildEditor } = await freshStores();
    buildEditor.setChoice("ring1", "ItemA");
    vi.advanceTimersByTime(800);
    buildEditor.setChoice("ring1", "ItemB");

    buildEditor.undo();
    expect(builds.build.value.choices.ring1).toBe("ItemA");
    expect(buildEditor.canUndo.value).toBe(true);

    buildEditor.undo();
    expect(builds.build.value.choices.ring1).toBeUndefined();
  });

  it("redo replays an undone step", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setChoice("ring1", "ItemA");
    buildEditor.undo();
    expect(builds.build.value.choices.ring1).toBeUndefined();

    expect(buildEditor.canRedo.value).toBe(true);
    buildEditor.redo();
    expect(builds.build.value.choices.ring1).toBe("ItemA");
    expect(buildEditor.canRedo.value).toBe(false);
  });

  // A build_parameter slot's `path` is resolved against `build.context`, not `build` --
  // setParam writing to the wrong root would either throw (no such top-level
  // property) or silently create a stray field alongside `context` instead of inside it.
  it("setParam writes into build.context at the slot's path, not the build root", async () => {
    const { builds, buildEditor } = await freshStores();
    const classSlot = {
      id: "options.class",
      label: "Class",
      section: "options",
      type: "build_parameter" as const,
      paramType: "list" as const,
      path: "class",
    };

    buildEditor.setParam(classSlot, "wizard");

    expect(builds.build.value.context.class).toBe("wizard");
    expect(Object.hasOwn(builds.build.value, "class")).toBe(false);
  });
});

// The real shipped "boons.tier1" slot -- seven rows, min 0/max 5/default 0 (data/slots.json,
// data/db-items.json's "boon-tier1-*" items). `defaultBuild` seeds every row into
// `build.assignments["boons.tier1"]` up front, same as `context` is seeded from
// build_parameter defaults, so every assertion below has to account for that seed rather than
// assume the slot starts out absent. Shared with the `applyPreset` describe block below, which
// exercises the same real slot.
const seededRows = {
  "boon-tier1-power": 0,
  "boon-tier1-avoidance": 0,
  "boon-tier1-strike": 0,
  "boon-tier1-hp": 0,
  "boon-tier1-cultist": 0,
  "boon-tier1-gold": 0,
  "boon-tier1-loot-radius": 0,
};

describe("buildEditor point_assignment edits", () => {
  const slot = {
    id: "boons.tier1",
    label: "Tier 1",
    section: "boons",
    type: "point_assignment" as const,
    filter: "boon_tier1",
  };

  it("defaultBuild seeds both rows before any edit", async () => {
    const { builds } = await freshStores();
    expect(builds.build.value.assignments["boons.tier1"]).toEqual(seededRows);
  });

  it("setAssignment writes the count under the slot id, keyed by item", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setAssignment(slot, "boon-tier1-power", 2);
    expect(builds.build.value.assignments["boons.tier1"]).toEqual({
      ...seededRows,
      "boon-tier1-power": 2,
    });
  });

  it("setAssignment on a second item does not clobber the first", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setAssignment(slot, "boon-tier1-power", 2);
    buildEditor.setAssignment(slot, "boon-tier1-avoidance", 1);
    expect(builds.build.value.assignments["boons.tier1"]).toEqual({
      ...seededRows,
      "boon-tier1-power": 2,
      "boon-tier1-avoidance": 1,
    });
  });

  it("undo reverts one item's count without touching the other's", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setAssignment(slot, "boon-tier1-power", 2);
    buildEditor.setAssignment(slot, "boon-tier1-avoidance", 1);
    buildEditor.undo();
    expect(builds.build.value.assignments["boons.tier1"]).toEqual({
      ...seededRows,
      "boon-tier1-power": 2,
    });
  });

  it("resetAssignmentsToDefault resets every row in the slot at once", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setAssignment(slot, "boon-tier1-power", 2);
    buildEditor.setAssignment(slot, "boon-tier1-avoidance", 1);
    buildEditor.resetAssignmentsToDefault(slot);
    expect(builds.build.value.assignments["boons.tier1"]).toEqual(seededRows);
  });
});

describe("buildEditor.setOccurrenceInput", () => {
  it("writes the count under the item id, keyed by bonus id", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setOccurrenceInput("test-ring", "test-bonus", 3, "Test Bonus");
    expect(builds.build.value.occurrenceInputs).toEqual({
      "test-ring": { "test-bonus": 3 },
    });
  });

  it("a second bonus on the same item does not clobber the first", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setOccurrenceInput("test-ring", "bonus-a", 2, "Bonus A");
    buildEditor.setOccurrenceInput("test-ring", "bonus-b", 1, "Bonus B");
    expect(builds.build.value.occurrenceInputs).toEqual({
      "test-ring": { "bonus-a": 2, "bonus-b": 1 },
    });
  });

  it("the same bonus on a different item is tracked independently", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setOccurrenceInput("ring-a", "shared-bonus", 2, "Shared Bonus");
    buildEditor.setOccurrenceInput("ring-b", "shared-bonus", 5, "Shared Bonus");
    expect(builds.build.value.occurrenceInputs).toEqual({
      "ring-a": { "shared-bonus": 2 },
      "ring-b": { "shared-bonus": 5 },
    });
  });

  it("undo reverts one bonus's count without touching a sibling's", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setOccurrenceInput("test-ring", "bonus-a", 2, "Bonus A");
    buildEditor.setOccurrenceInput("test-ring", "bonus-b", 1, "Bonus B");
    buildEditor.undo();
    expect(builds.build.value.occurrenceInputs).toEqual({
      "test-ring": { "bonus-a": 2 },
    });
  });
});

// A custom ring carried by each build's own `catalog` overlay (storage.ts's `Build.catalog`),
// same mechanism bonus-occurrence-config.spec.ts's e2e fixtures use -- both test builds carry
// an identical copy so the item resolves regardless of which one ends up active (db.ts only
// folds in the *active* build's own catalog, see resolved.ts's `overlays`).
describe("buildEditor.applyOccurrenceFromCompare", () => {
  const RING_ID = "test-occurrence-ring";
  const STACK_BONUS_ID = "test-occurrence-stack-bonus";

  const catalog = {
    items: {
      [RING_ID]: {
        id: RING_ID,
        name: "Test Occurrence Ring",
        filter: "gear_ring",
        bonuses: [{ bonus: STACK_BONUS_ID, min: 0, max: 5, default: 0 }],
      },
    },
    bonuses: {
      [STACK_BONUS_ID]: {
        id: STACK_BONUS_ID,
        name: "Stack Bonus",
        grants: [{ stats: { power: 10 } }],
      },
    },
    sectionPresets: {},
    slots: {},
  };

  function buildWithRing(
    name: string,
    occurrenceInputs: Record<string, Record<string, number>> = {},
  ) {
    return {
      ...storage.defaultBuild(name),
      choices: { "gear.ring1": RING_ID },
      occurrenceInputs,
      catalog,
    };
  }

  it("copies the compare build's counts onto the active build's item", async () => {
    const { builds, buildEditor, compare } = await freshStores();
    const active = buildWithRing("Active", {
      [RING_ID]: { [STACK_BONUS_ID]: 2 },
    });
    const other = buildWithRing("Other", {
      [RING_ID]: { [STACK_BONUS_ID]: 4 },
    });
    builds.replaceActive(other);
    builds.replaceActive(active);
    compare.setCompareBuild(other.id);

    buildEditor.applyOccurrenceFromCompare(RING_ID);

    expect(builds.build.value.occurrenceInputs[RING_ID]).toEqual({
      [STACK_BONUS_ID]: 4,
    });
  });

  it("falls back to the attachment's own default for a bonus the compare build never touched", async () => {
    const { builds, buildEditor, compare } = await freshStores();
    const active = buildWithRing("Active", {
      [RING_ID]: { [STACK_BONUS_ID]: 2 },
    });
    const other = buildWithRing("Other");
    builds.replaceActive(other);
    builds.replaceActive(active);
    compare.setCompareBuild(other.id);

    buildEditor.applyOccurrenceFromCompare(RING_ID);

    expect(builds.build.value.occurrenceInputs[RING_ID]).toEqual({
      [STACK_BONUS_ID]: 0,
    });
  });

  it("does nothing without a compare build selected", async () => {
    const { builds, buildEditor } = await freshStores();
    const active = buildWithRing("Active", {
      [RING_ID]: { [STACK_BONUS_ID]: 2 },
    });
    builds.replaceActive(active);

    buildEditor.applyOccurrenceFromCompare(RING_ID);

    expect(builds.build.value.occurrenceInputs[RING_ID]).toEqual({
      [STACK_BONUS_ID]: 2,
    });
  });
});

// A preset touching every field at once: `options.role` (a real build_parameter),
// `ring1`/`ring1` (a fictitious item_picker slot, same test-only convention the rest of this
// file uses for choices/values), the real shipped `boons.tier1` point_assignment slot
// (same rationale as the describe block above -- exercising the merge against real seeded
// data rather than a synthetic row), and one occurrence count for the item that row picks
// (keyed by item id, not slot id -- see `SectionPreset.occurrences`).
describe("buildEditor.applyPreset", () => {
  const preset = {
    id: "test-preset",
    label: "Test Preset",
    section: "options",
    params: { "options.role": "dps" },
    choices: { ring1: "ItemA" },
    values: { ring1: { power: 42 } },
    assignments: { "boons.tier1": { "boon-tier1-power": 3 } },
    occurrences: { ItemA: { "stack-bonus": 4 } },
  };

  const tier1Slot = {
    id: "boons.tier1",
    label: "Boons (Tier 1)",
    section: "boons",
    type: "point_assignment" as const,
    filter: "boon_tier1",
  };

  it("writes params/choices/values/assignments/occurrences in one call", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.applyPreset(preset);

    expect(builds.build.value.context.role).toBe("dps");
    expect(builds.build.value.choices.ring1).toBe("ItemA");
    expect(builds.build.value.values.ring1).toEqual({ power: 42 });
    expect(builds.build.value.assignments["boons.tier1"]).toEqual({
      ...seededRows,
      "boon-tier1-power": 3,
    });
    expect(builds.build.value.occurrenceInputs.ItemA).toEqual({
      "stack-bonus": 4,
    });
  });

  it("merges into an item's occurrence counts without clobbering its other bonus", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setOccurrenceInput("ItemA", "other-bonus", 2, "Other Bonus");
    buildEditor.setOccurrenceInput("ItemA", "stack-bonus", 1, "Stack Bonus");
    buildEditor.applyPreset(preset);

    expect(builds.build.value.occurrenceInputs.ItemA).toEqual({
      "other-bonus": 2,
      "stack-bonus": 4,
    });
  });

  it("leaves another item's occurrence counts untouched", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setOccurrenceInput("ItemB", "stack-bonus", 5, "Stack Bonus");
    buildEditor.applyPreset(preset);

    expect(builds.build.value.occurrenceInputs.ItemB).toEqual({
      "stack-bonus": 5,
    });
  });

  it("leaves a slot the preset doesn't mention untouched (partial apply)", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setChoice("ring2", "PreExisting");
    buildEditor.applyPreset(preset);
    expect(builds.build.value.choices.ring2).toBe("PreExisting");
  });

  it("merges into an assignment row without clobbering a sibling item", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setAssignment(tier1Slot, "boon-tier1-avoidance", 1);
    buildEditor.applyPreset(preset);
    expect(builds.build.value.assignments["boons.tier1"]).toEqual({
      ...seededRows,
      "boon-tier1-power": 3,
      "boon-tier1-avoidance": 1,
    });
  });

  it("applies as a single undo step", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.applyPreset(preset);
    buildEditor.undo();
    // The default "" is deleted rather than stored (build-path.ts's `setPath`), so a fresh
    // build's `role` is absent, not an empty string.
    expect(builds.build.value.context.role).toBeUndefined();
    expect(builds.build.value.choices.ring1).toBeUndefined();
    expect(builds.build.value.assignments["boons.tier1"]).toEqual(seededRows);
    expect(builds.build.value.occurrenceInputs.ItemA).toBeUndefined();
  });

  it("ignores a params entry whose slot id is not a build_parameter", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.applyPreset({
      id: "bad-preset",
      label: "Bad",
      section: "gear",
      params: { "gear.head": "nope" }, // gear.head is an item_picker slot
    });
    expect(builds.build.value.context.role).toBeUndefined();
  });
});

// `clears` is the one preset field that removes rather than writes -- the same per-slot-type
// reset `clearSection` does, addressed one slot at a time.
describe("buildEditor.applyPreset clears", () => {
  const tier1Slot = {
    id: "boons.tier1",
    label: "Tier 1",
    section: "boons",
    type: "point_assignment" as const,
    filter: "boon_tier1",
  };
  const roleSlot = {
    id: "options.role",
    label: "Role",
    section: "options",
    type: "build_parameter" as const,
    paramType: "list" as const,
    path: "role",
    default: "",
  };

  it("resets each named slot to its default, per slot type", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setParam(roleSlot, "dps");
    buildEditor.setChoice("gear.head", "ItemA");
    buildEditor.setDynamicValue("gear.head", "power", "5");
    buildEditor.setAssignment(tier1Slot, "boon-tier1-power", 3);

    buildEditor.applyPreset({
      id: "wipe",
      label: "Wipe",
      section: "gear",
      clears: ["options.role", "gear.head", "boons.tier1"],
    });

    expect(builds.build.value.context.role).toBeUndefined();
    expect(builds.build.value.choices["gear.head"]).toBeUndefined();
    expect(builds.build.value.values["gear.head"]).toBeUndefined();
    expect(builds.build.value.assignments["boons.tier1"]).toEqual(seededRows);
  });

  it("leaves a slot it doesn't name untouched", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setChoice("gear.head", "ItemA");
    buildEditor.setChoice("gear.arms", "ItemB");

    buildEditor.applyPreset({
      id: "wipe-head",
      label: "Wipe head",
      section: "gear",
      clears: ["gear.head"],
    });

    expect(builds.build.value.choices["gear.head"]).toBeUndefined();
    expect(builds.build.value.choices["gear.arms"]).toBe("ItemB");
  });

  // Order matters: clearing runs first so a hand-authored preset naming one slot in both
  // fields still ends up with the written value rather than an empty slot.
  it("lets a writing field win over a clear of the same slot", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setChoice("gear.head", "ItemA");

    buildEditor.applyPreset({
      id: "both",
      label: "Both",
      section: "gear",
      clears: ["gear.head"],
      choices: { "gear.head": "ItemB" },
    });

    expect(builds.build.value.choices["gear.head"]).toBe("ItemB");
  });

  it("ignores an unknown slot id", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setChoice("gear.head", "ItemA");

    buildEditor.applyPreset({
      id: "nonsense",
      label: "Nonsense",
      section: "gear",
      clears: ["not.a.slot"],
    });

    expect(builds.build.value.choices["gear.head"]).toBe("ItemA");
  });

  it("applies as a single undo step alongside the rest of the preset", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setChoice("gear.head", "ItemA");

    buildEditor.applyPreset({
      id: "mixed",
      label: "Mixed",
      section: "gear",
      clears: ["gear.head"],
      choices: { "gear.arms": "ItemB" },
    });
    buildEditor.undo();

    expect(builds.build.value.choices["gear.head"]).toBe("ItemA");
    expect(builds.build.value.choices["gear.arms"]).toBeUndefined();
  });
});

// The inverse direction: snapshotting a live section back into a preset shape. Round-tripping
// it through `applyPreset` from a *different* starting state is the real contract -- a
// faithful snapshot has to reproduce the section, not merge into whatever was there.
describe("buildEditor.presetFromSection", () => {
  it("captures a section's picks, values and occurrence counts", async () => {
    const { buildEditor } = await freshStores();
    buildEditor.setChoice("gear.head", "ItemA");
    buildEditor.setDynamicValue("gear.head", "power", "5");
    buildEditor.setOccurrenceInput("ItemA", "stack-bonus", 2, "Stack Bonus");

    const preset = buildEditor.presetFromSection("gear", "My Gear");

    expect(preset.label).toBe("My Gear");
    expect(preset.section).toBe("gear");
    expect(preset.choices?.["gear.head"]).toBe("ItemA");
    expect(preset.values?.["gear.head"]).toEqual({ power: 5 });
    expect(preset.occurrences?.ItemA).toEqual({ "stack-bonus": 2 });
  });

  it("lists a slot sitting at its default under clears", async () => {
    const { buildEditor } = await freshStores();
    buildEditor.setChoice("gear.head", "ItemA");

    const preset = buildEditor.presetFromSection("gear");

    expect(preset.clears).toContain("gear.arms");
    expect(preset.clears).not.toContain("gear.head");
  });

  it("leaves the id blank for the layer editor to allocate", async () => {
    const { buildEditor } = await freshStores();
    expect(buildEditor.presetFromSection("gear").id).toBe("");
  });

  it("captures only the named section", async () => {
    const { buildEditor } = await freshStores();
    buildEditor.setChoice("gear.head", "ItemA");
    buildEditor.setParam(
      {
        id: "options.role",
        label: "Role",
        section: "options",
        type: "build_parameter" as const,
        paramType: "list" as const,
        path: "role",
        default: "",
      },
      "dps",
    );

    const preset = buildEditor.presetFromSection("gear");

    expect(preset.params).toBeUndefined();
    expect(preset.clears).not.toContain("options.role");
  });

  it("presetUpdatedFromSection re-snapshots into an existing preset's identity", async () => {
    const { buildEditor } = await freshStores();
    buildEditor.setChoice("gear.head", "ItemA");

    const updated = buildEditor.presetUpdatedFromSection({
      id: "kept-id",
      label: "Kept Label",
      section: "gear",
      choices: { "gear.arms": "Stale" },
    });

    expect(updated.id).toBe("kept-id");
    expect(updated.label).toBe("Kept Label");
    expect(updated.section).toBe("gear");
    // Contents are replaced wholesale, not merged -- the stale pick is gone, and the slot it
    // named comes back under `clears` because the section leaves it empty now.
    expect(updated.choices).toEqual({ "gear.head": "ItemA" });
    expect(updated.clears).toContain("gear.arms");
  });

  it("round-trips: applying the snapshot reproduces the section it came from", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setChoice("gear.head", "ItemA");
    const preset = buildEditor.presetFromSection("gear", "Snapshot");

    // A different starting state: the snapshot has to clear `gear.arms` back out, not just
    // re-set `gear.head`.
    buildEditor.setChoice("gear.head", "ItemB");
    buildEditor.setChoice("gear.arms", "ItemC");

    buildEditor.applyPreset(preset);

    expect(builds.build.value.choices["gear.head"]).toBe("ItemA");
    expect(builds.build.value.choices["gear.arms"]).toBeUndefined();
  });
});

// Real shipped slots spanning all three types, chosen to also cover two different
// sections ("options" and "boons"/"gear") so clearSection's section filter is exercised,
// not just its per-type reset.
describe("buildEditor.clearSection", () => {
  const tier1Slot = {
    id: "boons.tier1",
    label: "Tier 1",
    section: "boons",
    type: "point_assignment" as const,
    filter: "boon_tier1",
  };

  it("resets a build_parameter slot's path to its default", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setParam(
      {
        id: "options.role",
        label: "Role",
        section: "options",
        type: "build_parameter" as const,
        paramType: "list" as const,
        path: "role",
        default: "",
      },
      "dps",
    );
    expect(builds.build.value.context.role).toBe("dps");

    buildEditor.clearSection("options", "Options");
    expect(builds.build.value.context.role).toBeUndefined();
  });

  it("resets a point_assignment slot's rows to their defaults", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setAssignment(tier1Slot, "boon-tier1-power", 3);
    buildEditor.clearSection("boons", "Boons");
    expect(builds.build.value.assignments["boons.tier1"]).toEqual(seededRows);
  });

  it("clears an item_picker slot's choice and value", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setChoice("gear.head", "ItemA");
    buildEditor.setDynamicValue("gear.head", "power", "5");

    buildEditor.clearSection("gear", "Gear");
    expect(builds.build.value.choices["gear.head"]).toBeUndefined();
    expect(builds.build.value.values["gear.head"]).toBeUndefined();
  });

  it("leaves other sections untouched", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setChoice("gear.head", "ItemA");
    buildEditor.setAssignment(tier1Slot, "boon-tier1-power", 3);

    buildEditor.clearSection("gear", "Gear");
    expect(builds.build.value.assignments["boons.tier1"]).toEqual({
      ...seededRows,
      "boon-tier1-power": 3,
    });
  });

  it("applies as a single undo step", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setChoice("gear.head", "ItemA");
    buildEditor.setAssignment(tier1Slot, "boon-tier1-power", 3);

    buildEditor.clearSection("boons", "Boons");
    buildEditor.undo();
    expect(builds.build.value.assignments["boons.tier1"]).toEqual({
      ...seededRows,
      "boon-tier1-power": 3,
    });
  });

  it("includes the section label in the undo label", async () => {
    const { buildEditor } = await freshStores();
    buildEditor.setChoice("gear.head", "ItemA");
    buildEditor.clearSection("gear", "Gear");
    expect(buildEditor.undoLabel.value).toBe('clear section "Gear"');
  });
});

// The real shipped "paragon-hellbringer" item (data/db-items.json) and its `defaultParams`,
// picked through the real "options.paragon" item_picker slot -- proves the cascade end to end
// against shipped data rather than a synthetic fixture.
describe("buildEditor.setChoice applies the picked item's defaultParams", () => {
  it("writes each defaultParams entry onto its build_parameter slot's path", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setChoice("options.paragon", "paragon-hellbringer");

    expect(builds.build.value.choices["options.paragon"]).toBe(
      "paragon-hellbringer",
    );
    expect(builds.build.value.context.role).toBe("dps");
    expect(builds.build.value.context.forte).toEqual({
      primary: "power_p",
      secondaryA: "strike_p",
      secondaryB: "awareness_p",
    });
  });

  it("applies the choice and its defaultParams as a single undo step", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setChoice("options.paragon", "paragon-hellbringer");
    buildEditor.undo();

    expect(builds.build.value.choices["options.paragon"]).toBeUndefined();
    expect(builds.build.value.context.role).toBeUndefined();
    // `forte` is a compound field: replaceActive's normalization always gives it an object,
    // just an empty one once the picks themselves are gone -- unlike the scalar `role` above.
    expect(builds.build.value.context.forte).toEqual({});
  });

  it("leaves defaultParams as ordinary editable fields (what-if override)", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setChoice("options.paragon", "paragon-hellbringer");
    buildEditor.setParam(
      {
        id: "options.role",
        label: "Role",
        section: "options",
        type: "build_parameter" as const,
        paramType: "list" as const,
        path: "role",
        default: "",
      },
      "healer",
    );

    expect(builds.build.value.context.role).toBe("healer");
  });

  it("does nothing extra when the picked item has no defaultParams", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setChoice("ring1", "ItemA");

    expect(builds.build.value.choices.ring1).toBe("ItemA");
    expect(builds.build.value.context.role).toBeUndefined();
  });
});

describe("buildEditor undo labels", () => {
  it("renameBuild includes the new name in the label", async () => {
    const { buildEditor } = await freshStores();
    buildEditor.renameBuild("My Warlock");
    expect(buildEditor.undoLabel.value).toBe('rename build → "My Warlock"');
  });

  it("setDynamicValue includes the new value in the label", async () => {
    const { buildEditor } = await freshStores();
    buildEditor.setDynamicValue("ring1", "power", "42");
    expect(buildEditor.undoLabel.value).toContain("→ 42");
  });

  it("setDynamicValue shows (none) when clearing", async () => {
    const { buildEditor } = await freshStores();
    buildEditor.setDynamicValue("ring1", "power", "");
    expect(buildEditor.undoLabel.value).toContain("→ (none)");
  });
});

/**
 * `misc.misc` is a shipped `item_picker_list`; `removeListRow` resolves its container off the
 * composed catalogue, so these need a real slot rather than a local fixture.
 */
describe("buildEditor item_picker_list rows", () => {
  const LIST = "misc.misc";
  const row = (index: number) => `${LIST}#${index}`;

  it("adds an empty row, and starts from the slot's own default count", async () => {
    const { builds, buildEditor, resolved } = await freshStores();
    const slot = resolved.db.value.slotById.get(LIST)!;
    if (slot.type !== "item_picker_list") throw new Error("not a list slot");

    expect(builds.build.value.listRows[LIST]).toBe(slot.defaultRows ?? 0);
    buildEditor.addListRow(slot);
    buildEditor.addListRow(slot);
    expect(builds.build.value.listRows[LIST]).toBe((slot.defaultRows ?? 0) + 2);
    expect(builds.build.value.choices[row(1)]).toBeUndefined();
  });

  it("closes the gap when a row in the middle is removed", async () => {
    const { builds, buildEditor, resolved } = await freshStores();
    const slot = resolved.db.value.slotById.get(LIST)!;
    if (slot.type !== "item_picker_list") throw new Error("not a list slot");
    for (let i = 0; i < 3; i += 1) buildEditor.addListRow(slot);

    buildEditor.setChoice(row(1), "ItemA");
    buildEditor.setChoice(row(2), "ItemB");
    buildEditor.setChoice(row(3), "ItemC");
    buildEditor.setDynamicValue(row(3), "power", "42");

    buildEditor.removeListRow(row(2));

    const build = builds.build.value;
    expect(build.listRows[LIST]).toBe(2);
    expect(build.choices[row(1)]).toBe("ItemA");
    expect(build.choices[row(2)]).toBe("ItemC");
    expect(build.choices[row(3)]).toBeUndefined();
    expect(build.values[row(2)]).toEqual({ power: 42 });
    expect(build.values[row(3)]).toBeUndefined();
  });

  it("undoes a removal as one step, rows and count together", async () => {
    const { builds, buildEditor, resolved } = await freshStores();
    const slot = resolved.db.value.slotById.get(LIST)!;
    if (slot.type !== "item_picker_list") throw new Error("not a list slot");
    buildEditor.addListRow(slot);
    buildEditor.addListRow(slot);
    buildEditor.setChoice(row(2), "ItemB");

    buildEditor.removeListRow(row(1));
    expect(builds.build.value.choices[row(1)]).toBe("ItemB");

    buildEditor.undo();
    expect(builds.build.value.listRows[LIST]).toBe(2);
    expect(builds.build.value.choices[row(2)]).toBe("ItemB");
    expect(builds.build.value.choices[row(1)]).toBeUndefined();
  });

  it("ignores a row that is past the end of the list", async () => {
    const { builds, buildEditor, resolved } = await freshStores();
    const slot = resolved.db.value.slotById.get(LIST)!;
    if (slot.type !== "item_picker_list") throw new Error("not a list slot");
    buildEditor.addListRow(slot);

    buildEditor.removeListRow(row(4));
    expect(builds.build.value.listRows[LIST]).toBe(1);
  });

  it("clearSection drops every row the list held", async () => {
    const { builds, buildEditor, resolved } = await freshStores();
    const slot = resolved.db.value.slotById.get(LIST)!;
    if (slot.type !== "item_picker_list") throw new Error("not a list slot");
    buildEditor.addListRow(slot);
    buildEditor.addListRow(slot);
    buildEditor.setChoice(row(2), "ItemB");

    buildEditor.clearSection(slot.section, "Misc");

    expect(builds.build.value.listRows[LIST]).toBe(slot.defaultRows ?? 0);
    expect(builds.build.value.choices[row(2)]).toBeUndefined();
  });

  it("applyPreset grows a list to cover the rows it names", async () => {
    const { builds, buildEditor, resolved } = await freshStores();
    const slot = resolved.db.value.slotById.get(LIST)!;
    if (slot.type !== "item_picker_list") throw new Error("not a list slot");

    buildEditor.applyPreset({
      id: "p",
      label: "Preset",
      section: slot.section,
      choices: { [row(3)]: "ItemC" },
    });

    expect(builds.build.value.listRows[LIST]).toBe(3);
    expect(builds.build.value.choices[row(3)]).toBe("ItemC");
  });
});

describe("buildEditor storage wiring", () => {
  it("writes the meta record through to the backend", async () => {
    const { meta, idb } = await freshStores();

    await meta.persistMeta();

    expect(idb.stores.get("meta")?.get("app")).toMatchObject({
      buildOrder: expect.any(Array),
    });
  });
});
