// Undo coalescing was previously untestable in isolation -- it lived inside App.vue, entangled
// with routing/persistence/every other concern. Now that it's its own module, these prove the
// coalescing behaviour directly: same key within the window collapses to one undo step: a
// different key, or the window elapsing, doesn't.
import { afterEach, describe, expect, it, vi } from "vitest";
import { installWindowShim } from "./window-shim";

async function freshStores() {
  vi.resetModules();
  installWindowShim();
  const builds = await import("../../../src/stores/builds");
  const history = await import("../../../src/stores/history");
  const layers = await import("../../../src/stores/layers");
  const selection = await import("../../../src/stores/selection");
  const trash = await import("../../../src/stores/trash");
  const buildEditor = await import("../../../src/stores/buildEditor");
  builds._setLoading(false);
  history._setLoading(false);
  layers._setLoading(false);
  return { builds, history, layers, selection, trash, buildEditor };
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

// The real shipped "boons.tier1" slot -- two rows, min 0/max 4/default 0 (data/slots.json,
// data/db-items.json's "boon-tier1-power"/"boon-tier1-defense"). `defaultBuild` seeds both
// rows into `build.assignments["boons.tier1"]` up front, same as `context` is seeded from
// build_parameter defaults, so every assertion below has to account for that seed rather than
// assume the slot starts out absent.
describe("buildEditor point_assignment edits", () => {
  const slot = {
    id: "boons.tier1",
    label: "Boons (Tier 1)",
    section: "boons",
    type: "point_assignment" as const,
    filter: "boon_tier1",
  };

  it("defaultBuild seeds both rows before any edit", async () => {
    const { builds } = await freshStores();
    expect(builds.build.value.assignments["boons.tier1"]).toEqual({
      "boon-tier1-power": 0,
      "boon-tier1-defense": 0,
    });
  });

  it("setAssignment writes the count under the slot id, keyed by item", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setAssignment(slot, "boon-tier1-power", 2);
    expect(builds.build.value.assignments["boons.tier1"]).toEqual({
      "boon-tier1-power": 2,
      "boon-tier1-defense": 0,
    });
  });

  it("setAssignment on a second item does not clobber the first", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setAssignment(slot, "boon-tier1-power", 2);
    buildEditor.setAssignment(slot, "boon-tier1-defense", 1);
    expect(builds.build.value.assignments["boons.tier1"]).toEqual({
      "boon-tier1-power": 2,
      "boon-tier1-defense": 1,
    });
  });

  it("undo reverts one item's count without touching the other's", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setAssignment(slot, "boon-tier1-power", 2);
    buildEditor.setAssignment(slot, "boon-tier1-defense", 1);
    buildEditor.undo();
    expect(builds.build.value.assignments["boons.tier1"]).toEqual({
      "boon-tier1-power": 2,
      "boon-tier1-defense": 0,
    });
  });

  it("resetAssignmentsToDefault resets every row in the slot at once", async () => {
    const { builds, buildEditor } = await freshStores();
    buildEditor.setAssignment(slot, "boon-tier1-power", 2);
    buildEditor.setAssignment(slot, "boon-tier1-defense", 1);
    buildEditor.resetAssignmentsToDefault(slot);
    expect(builds.build.value.assignments["boons.tier1"]).toEqual({
      "boon-tier1-power": 0,
      "boon-tier1-defense": 0,
    });
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
