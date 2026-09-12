// The undo/redo bindings over the real stores: `useUndoRedo` follows the undo scope between
// the nav stack and the selected item's stack, `useItemUndoRedo` stays on the item stack, and
// a form draft's own history comes first for both.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormUndoState } from "../../../src/stores/formUndo";

/** An element whose closest scoped ancestor carries `value`. */
function inRegion(value: "nav" | "editor") {
  return { closest: () => ({ getAttribute: () => value }) };
}

async function fresh() {
  vi.resetModules();
  const { installWindowShim, installIdbShim } =
    await import("../stores/window-shim");
  installWindowShim();
  installIdbShim();
  // The scope tracker listens on `document`; the shim's stub has no dispatch.
  const fakeDocument = new EventTarget();
  vi.stubGlobal("document", fakeDocument);

  const { effectScope } = await import("vue");
  const builds = await import("../../../src/stores/builds");
  const buildEditor = await import("../../../src/stores/buildEditor");
  const formUndo = await import("../../../src/stores/formUndo");
  const history = await import("../../../src/stores/history");
  const layers = await import("../../../src/stores/layers");
  const navHistory = await import("../../../src/stores/navHistory");
  const { useUndoScope } =
    await import("../../../src/composables/useUndoScope");
  const { useItemUndoRedo, useUndoRedo } =
    await import("../../../src/composables/useUndoRedo");
  builds._setLoading(false);
  history._setLoading(false);
  layers._setLoading(false);
  void builds.build.value;

  const effects = effectScope();
  const bindings = effects.run(() => {
    useUndoScope();
    return { scoped: useUndoRedo(), item: useItemUndoRedo() };
  })!;

  const focus = (region: "nav" | "editor") => {
    const event = new Event("focusin");
    Object.defineProperty(event, "target", { value: inRegion(region) });
    fakeDocument.dispatchEvent(event);
  };

  return {
    ...bindings,
    builds,
    buildEditor,
    formUndo,
    navHistory,
    focus,
    dispose: () => effects.stop(),
  };
}

/** One create step on the nav stack and one slot edit on the item stack. */
async function withBothHistories() {
  const s = await fresh();
  s.builds.createBuild();
  s.buildEditor.setChoice("ring1", "ItemA");
  expect(s.navHistory.canUndo.value).toBe(true);
  expect(s.buildEditor.canUndo.value).toBe(true);
  return s;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useUndoRedo", () => {
  it("reads and acts on the item stack in the editor scope", async () => {
    const s = await withBothHistories();
    s.focus("editor");
    expect(s.scoped.canUndo.value).toBe(true);
    expect(s.scoped.undoLabel.value).toBe("ring1 → ItemA");

    s.scoped.undo();
    expect(s.builds.build.value.choices.ring1).toBeUndefined();
    expect(s.navHistory.canUndo.value).toBe(true);
    expect(s.scoped.canUndo.value).toBe(false);
    expect(s.scoped.canRedo.value).toBe(true);
    expect(s.scoped.redoLabel.value).toBe("ring1 → ItemA");

    s.scoped.redo();
    expect(s.builds.build.value.choices.ring1).toBe("ItemA");
    s.dispose();
  });

  it("reads and acts on the nav stack in the nav scope", async () => {
    const s = await withBothHistories();
    s.focus("nav");
    expect(s.scoped.canUndo.value).toBe(true);
    expect(s.scoped.undoLabel.value).toBe('create build "Build 2"');

    s.scoped.undo();
    expect(s.builds.builds.value.map((b) => b.name)).toEqual(["Build 1"]);
    expect(s.scoped.canUndo.value).toBe(false);
    expect(s.scoped.canRedo.value).toBe(true);
    expect(s.scoped.redoLabel.value).toBe('create build "Build 2"');

    s.scoped.redo();
    expect(s.builds.builds.value.map((b) => b.name)).toEqual([
      "Build 1",
      "Build 2",
    ]);
    s.dispose();
  });

  it("reports nothing to undo in the nav scope with only item history", async () => {
    const s = await fresh();
    s.buildEditor.setChoice("ring1", "ItemA");
    s.focus("nav");
    expect(s.scoped.canUndo.value).toBe(false);
    expect(s.scoped.undoLabel.value).toBe("");

    s.scoped.undo();
    expect(s.builds.build.value.choices.ring1).toBe("ItemA");
    s.dispose();
  });

  it("follows the scope as focus moves", async () => {
    const s = await withBothHistories();
    s.focus("nav");
    expect(s.scoped.undoLabel.value).toBe('create build "Build 2"');
    s.focus("editor");
    expect(s.scoped.undoLabel.value).toBe("ring1 → ItemA");
    s.dispose();
  });
});

describe("useItemUndoRedo", () => {
  it("stays on the item stack whatever the scope", async () => {
    const s = await withBothHistories();
    s.focus("nav");
    expect(s.item.undoLabel.value).toBe("ring1 → ItemA");

    s.item.undo();
    expect(s.builds.build.value.choices.ring1).toBeUndefined();
    expect(s.navHistory.canUndo.value).toBe(true);
    expect(s.item.canUndo.value).toBe(false);
    s.dispose();
  });
});

describe("form draft history", () => {
  /** A registered draft with one step each way, counting what the bindings send it. */
  function draft(formUndo: typeof import("../../../src/stores/formUndo")) {
    const calls = { undo: 0, redo: 0 };
    const state: FormUndoState = {
      canUndo: true,
      canRedo: true,
      undoLabel: "edit name",
      redoLabel: "edit level",
      undo: () => {
        calls.undo += 1;
        return true;
      },
      redo: () => {
        calls.redo += 1;
        return true;
      },
    };
    const unregister = formUndo.register(state);
    return { calls, unregister };
  }

  it("comes first in the editor scope", async () => {
    const s = await withBothHistories();
    s.focus("editor");
    const { calls } = draft(s.formUndo);
    expect(s.scoped.undoLabel.value).toBe("edit name");
    expect(s.scoped.redoLabel.value).toBe("edit level");

    s.scoped.undo();
    s.scoped.redo();
    expect(calls).toEqual({ undo: 1, redo: 1 });
    expect(s.builds.build.value.choices.ring1).toBe("ItemA");
    s.dispose();
  });

  it("comes first in the nav scope", async () => {
    const s = await withBothHistories();
    s.focus("nav");
    const { calls } = draft(s.formUndo);
    expect(s.scoped.undoLabel.value).toBe("edit name");

    s.scoped.undo();
    expect(calls.undo).toBe(1);
    expect(s.navHistory.canUndo.value).toBe(true);
    s.dispose();
  });

  it("comes first for the item bindings", async () => {
    const s = await withBothHistories();
    const { calls } = draft(s.formUndo);
    expect(s.item.undoLabel.value).toBe("edit name");

    s.item.undo();
    expect(calls.undo).toBe(1);
    expect(s.builds.build.value.choices.ring1).toBe("ItemA");
    s.dispose();
  });

  it("hands over to the stack once the draft is gone", async () => {
    const s = await withBothHistories();
    s.focus("editor");
    const { unregister } = draft(s.formUndo);
    unregister();
    expect(s.scoped.undoLabel.value).toBe("ring1 → ItemA");
    s.dispose();
  });
});
