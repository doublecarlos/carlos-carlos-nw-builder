// The undo scope follows focus and pointer presses into marked regions and holds its last
// value everywhere else. The suite runs without a DOM: elements are small fakes with just
// `closest` and `getAttribute`, and `document` is a bare EventTarget.
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  scopeOf,
  UNDO_SCOPE_ATTR,
} from "../../../src/composables/useUndoScope";

/** An element whose closest marked ancestor carries `value`, or none at all for `null`. */
function fakeElement(value: string | null) {
  const region = value === null ? null : { getAttribute: () => value };
  return {
    closest: (selector: string) =>
      selector === `[${UNDO_SCOPE_ATTR}]` ? region : null,
  };
}

/** The composable installed on a fresh module instance, so its scope starts at the default.
 *  `vue` is imported after the reset too: an effect scope from a different Vue instance would
 *  not collect the composable's listeners. */
async function fresh() {
  vi.resetModules();
  const fakeDocument = new EventTarget();
  vi.stubGlobal("document", fakeDocument);
  const { effectScope } = await import("vue");
  const { undoScope, useUndoScope } =
    await import("../../../src/composables/useUndoScope");
  const effects = effectScope();
  effects.run(() => useUndoScope());
  const dispatch = (type: "focusin" | "pointerdown", target: unknown) => {
    const event = new Event(type);
    Object.defineProperty(event, "target", { value: target });
    fakeDocument.dispatchEvent(event);
  };
  return { undoScope, dispatch, dispose: () => effects.stop() };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scopeOf", () => {
  it("resolves the closest marked ancestor", () => {
    expect(scopeOf(fakeElement("nav") as unknown as EventTarget)).toBe("nav");
    expect(scopeOf(fakeElement("editor") as unknown as EventTarget)).toBe(
      "editor",
    );
  });

  it("is null outside every marked region", () => {
    expect(scopeOf(fakeElement(null) as unknown as EventTarget)).toBeNull();
    expect(scopeOf(null)).toBeNull();
  });

  it("is null for a target that is not an element", () => {
    expect(scopeOf(new EventTarget())).toBeNull();
  });

  it("rejects an attribute value the app does not define", () => {
    expect(scopeOf(fakeElement("header") as unknown as EventTarget)).toBeNull();
    expect(scopeOf(fakeElement("") as unknown as EventTarget)).toBeNull();
  });
});

describe("useUndoScope", () => {
  it("starts in the editor", async () => {
    const { undoScope, dispose } = await fresh();
    expect(undoScope.value).toBe("editor");
    dispose();
  });

  it("moves to the nav on focus inside it", async () => {
    const { undoScope, dispatch, dispose } = await fresh();
    dispatch("focusin", fakeElement("nav"));
    expect(undoScope.value).toBe("nav");
    dispose();
  });

  it("moves to the editor on a pointer press inside it", async () => {
    const { undoScope, dispatch, dispose } = await fresh();
    dispatch("pointerdown", fakeElement("nav"));
    dispatch("pointerdown", fakeElement("editor"));
    expect(undoScope.value).toBe("editor");
    dispose();
  });

  it("holds its value for a target outside every marked region", async () => {
    const { undoScope, dispatch, dispose } = await fresh();
    dispatch("pointerdown", fakeElement("nav"));
    dispatch("focusin", fakeElement(null));
    dispatch("pointerdown", fakeElement(null));
    expect(undoScope.value).toBe("nav");

    dispatch("focusin", fakeElement("editor"));
    dispatch("pointerdown", fakeElement(null));
    expect(undoScope.value).toBe("editor");
    dispose();
  });

  it("ignores an attribute value the app does not define", async () => {
    const { undoScope, dispatch, dispose } = await fresh();
    dispatch("focusin", fakeElement("nav"));
    dispatch("focusin", fakeElement("header"));
    expect(undoScope.value).toBe("nav");
    dispose();
  });

  it("stops listening once its scope is disposed", async () => {
    const { undoScope, dispatch, dispose } = await fresh();
    dispatch("focusin", fakeElement("nav"));
    dispose();
    dispatch("focusin", fakeElement("editor"));
    expect(undoScope.value).toBe("nav");
  });
});
