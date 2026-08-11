// Undo coalescing was previously untestable in isolation -- it lived inside App.vue, entangled
// with routing/persistence/every other concern. Now that it's its own module, these prove the
// coalescing behaviour directly: same key within the window collapses to one undo step: a
// different key, or the window elapsing, doesn't.
import { afterEach, describe, expect, it, vi } from "vitest";
import { installWindowShim } from "./window-shim";
import * as storage from "../../../src/storage/storage";

async function freshStores() {
  vi.resetModules();
  installWindowShim();
  const builds = await import("../../../src/stores/builds");
  const history = await import("../../../src/stores/history");
  const layers = await import("../../../src/stores/layers");
  const selection = await import("../../../src/stores/selection");
  const trash = await import("../../../src/stores/trash");
  const buildEditor = await import("../../../src/stores/buildEditor");
  const compare = await import("../../../src/stores/compare");
  const resolved = await import("../../../src/stores/resolved");
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
// same mechanism proc-toggle.spec.ts's e2e fixture uses -- both test builds carry an identical
// copy so the item resolves regardless of which one ends up active (db.ts only folds in the
// *active* build's own catalog, see resolved.ts's `overlays`).
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

// A preset touching all four fields at once: `options.role` (a real build_parameter),
// `ring1`/`ring1` (a fictitious item_picker slot, same test-only convention the rest of this
// file uses for choices/values), and the real shipped `boons.tier1` point_assignment slot
// (same rationale as the describe block above -- exercising the merge against real seeded
// data rather than a synthetic row).
describe("buildEditor.applyPreset", () => {
  const preset = {
    id: "test-preset",
    label: "Test Preset",
    section: "options",
    params: { "options.role": "dps" },
    choices: { ring1: "ItemA" },
    values: { ring1: 42 },
    assignments: { "boons.tier1": { "boon-tier1-power": 3 } },
  };

  const tier1Slot = {
    id: "boons.tier1",
    label: "Boons (Tier 1)",
    section: "boons",
    type: "point_assignment" as const,
    filter: "boon_tier1",
  };

  it("writes params/choices/values/assignments in one call", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.applyPreset(preset);

    expect(builds.build.value.context.role).toBe("dps");
    expect(builds.build.value.choices.ring1).toBe("ItemA");
    expect(builds.build.value.values.ring1).toBe(42);
    expect(builds.build.value.assignments["boons.tier1"]).toEqual({
      ...seededRows,
      "boon-tier1-power": 3,
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
    buildEditor.setValue("gear.head", "5");

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

  it("setValue includes the new value in the label", async () => {
    const { buildEditor } = await freshStores();
    buildEditor.setValue("ring1", "42");
    expect(buildEditor.undoLabel.value).toContain("→ 42");
  });

  it("setValue shows (none) when clearing", async () => {
    const { buildEditor } = await freshStores();
    buildEditor.setValue("ring1", "");
    expect(buildEditor.undoLabel.value).toContain("→ (none)");
  });
});
