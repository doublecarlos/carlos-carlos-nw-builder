// build_parameter paths are resolved against `build.context`, not `build` itself, so a path
// structurally cannot address a sibling of `context` (`choices`, `id`, `catalog`, ...).
import { describe, it, expect } from "vitest";
import { getPath, setPath, findParamSlot } from "../../src/lib/build-path";
import { defaultBuild } from "../../src/storage/storage";
import { NW_SLOTS, NW_SCHEMA } from "../../src/data/data";
import type { BuildParameterSlot } from "../../src/types";

describe("build-path", () => {
  it("get/setPath walk down from whatever root they are given", () => {
    const root: Record<string, unknown> = { a: { b: 1 } };
    expect(getPath(root, "a.b")).toBe(1);
    setPath(root, "a.c", 2);
    (root.a as Record<string, unknown>).c = 2;
    expect(getPath(root, "a.c")).toBe(2);
  });

  it("setPath deletes the leaf on an empty/nullish value", () => {
    const root: Record<string, unknown> = { a: { b: 1 } };
    setPath(root, "a.b", "");
    expect("b" in (root.a as Record<string, unknown>)).toBe(false);
  });

  it("findParamSlot finds the build_parameter slot owning a given path", () => {
    const slot = findParamSlot(NW_SLOTS.slots, "class");
    expect(slot?.id).toBe("options.class");
    expect(findParamSlot(NW_SLOTS.slots, "nope")).toBeUndefined();
  });

  // --- paths are relative to context, and defaultBuild proves it -----------------------------

  it('every shipped build_parameter slot has a path relative to context (no "context." prefix)', () => {
    const paramSlots = NW_SLOTS.slots.filter(
      (s): s is BuildParameterSlot => s.type === "build_parameter",
    );
    expect(paramSlots.length).toBeGreaterThan(0);
    for (const slot of paramSlots) {
      expect(slot.path.startsWith("context.")).toBe(false);
    }
  });

  it("defaultBuild seeds build.context with each slot's declared default, at its path", () => {
    const build = defaultBuild();
    for (const slot of NW_SLOTS.slots) {
      if (slot.type !== "build_parameter" || slot.default === undefined)
        continue;
      // An empty default means "no value": `setPath` deletes empty leaves, so the path
      // reads as empty rather than carrying an explicit "" (see setPath's test above).
      // Every consumer falls back the same way (`?? ""`, `|| 0`).
      expect(getPath(build.context, slot.path) ?? "").toBe(slot.default ?? "");
    }
  });

  it("forte reads as a group: all three forte slots land under context.forte", () => {
    const build = defaultBuild();
    // All three forte picks now default to empty, so no key is stored -- the group
    // exists with no picks, which stage 6 (engine.ts) treats as "no redistribution".
    expect(build.context.forte).toEqual({});
    // stage 6 (engine.ts) iterates schema.forteSplit's own keys against context.forte -- the
    // nesting this proves is exactly what it depends on.
    expect(Object.keys(NW_SCHEMA.forteSplit).sort()).toEqual(
      ["primary", "secondaryA", "secondaryB"].sort(),
    );
  });

  it("toggles read as a group: every toggle slot lands under context.toggles", () => {
    const build = defaultBuild();
    const toggleSlots = NW_SLOTS.slots.filter(
      (s): s is BuildParameterSlot =>
        s.type === "build_parameter" && s.path.startsWith("toggles."),
    );
    expect(toggleSlots.length).toBeGreaterThan(0);
    for (const slot of toggleSlots) {
      const name = slot.path.slice("toggles.".length);
      expect(build.context.toggles[name]).toBe(slot.default);
    }
  });
});
