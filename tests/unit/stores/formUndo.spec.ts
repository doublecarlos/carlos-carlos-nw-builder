// Tests for stores/formUndo.ts: `_active` must be a `shallowRef` so `register`'s returned
// unregister closure can find itself via `===` and actually clear `_active` -- a plain `ref`
// deep-wraps the assigned object in a reactive Proxy, so `.value` would never `===` the raw
// object passed to `register`, and unregister would silently no-op forever.
import { describe, expect, it } from "vitest";
import * as formUndo from "../../../src/stores/formUndo";

function state(overrides: Partial<formUndo.FormUndoState> = {}) {
  return {
    canUndo: true,
    canRedo: false,
    undo: () => true,
    redo: () => false,
    undoLabel: "test",
    redoLabel: "",
    ...overrides,
  };
}

describe("formUndo store", () => {
  it("unregister actually clears the active form", () => {
    const unregister = formUndo.register(state());
    expect(formUndo.canUndo.value).toBe(true);

    unregister();
    expect(formUndo.canUndo.value).toBe(false);
  });

  it("a later registration's unregister doesn't clobber an even-later one", () => {
    const unregisterA = formUndo.register(state({ undoLabel: "A" }));
    const unregisterB = formUndo.register(state({ undoLabel: "B" }));
    expect(formUndo.undoLabel.value).toBe("B");

    // A unmounting after B has taken over must not steal B's slot.
    unregisterA();
    expect(formUndo.undoLabel.value).toBe("B");

    unregisterB();
    expect(formUndo.canUndo.value).toBe(false);
  });

  it("undo() delegates to the active form and returns false once none is active", () => {
    let undone = false;
    const unregister = formUndo.register(
      state({ undo: () => ((undone = true), true) }),
    );

    expect(formUndo.undo()).toBe(true);
    expect(undone).toBe(true);

    unregister();
    expect(formUndo.undo()).toBe(false);
  });
});
