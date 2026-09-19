// Coverage for lib/slot-draft.ts, the draft <-> BuildParameterSlot conversion SlotForm.vue now
// delegates to (see that module's header comment). `passthrough` gets the most attention here:
// a field this form doesn't know about (`visibleWhen`) must survive a round trip untouched,
// the one draft module here that preserves rather than drops what it doesn't recognize.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import { NW_SCHEMA } from "../../src/data/data";
import {
  buildDraft,
  passthroughOf,
  toSlot,
  diffLabel,
  findPathConflict,
} from "../../src/lib/slot-draft";
import type { BuildParameterSlot, SlotsData } from "../../src/types";

const ctx = (slot: BuildParameterSlot, id = slot.id) => ({
  id,
  passthrough: passthroughOf(slot),
});

describe("buildDraft / toSlot round trip", () => {
  it("round-trips a minimal numeric slot", () => {
    const slot: BuildParameterSlot = {
      id: "s1",
      label: "Recovery",
      section: "boons",
      type: "build_parameter",
      paramType: "number",
      path: "recovery",
    };
    expect(toSlot(buildDraft(slot), ctx(slot))).toEqual(slot);
  });

  it("round-trips numeric bounds and a preset list, including a 0 min", () => {
    const slot: BuildParameterSlot = {
      id: "s2",
      label: "Rank",
      section: "boons",
      type: "build_parameter",
      paramType: "number",
      path: "rank",
      min: 0,
      max: 10,
      step: 1,
      presets: [1, 5, 10],
    };
    expect(toSlot(buildDraft(slot), ctx(slot))).toEqual(slot);
  });

  it("round-trips a boolean slot's default without confusing the string 'false'", () => {
    const slot: BuildParameterSlot = {
      id: "s3",
      label: "Toggle",
      section: "boons",
      type: "build_parameter",
      paramType: "boolean",
      path: "toggle",
      default: false,
    };
    expect(toSlot(buildDraft(slot), ctx(slot))).toEqual(slot);
  });

  it("round-trips inline list options", () => {
    // A `list` slot's `default` always comes back as a string ("" for none): `toSlot`'s
    // non-numeric branch writes `String(local.default)` unconditionally.
    const slot: BuildParameterSlot = {
      id: "s4",
      label: "Flavour",
      section: "boons",
      type: "build_parameter",
      paramType: "list",
      path: "flavour",
      default: "",
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    };
    expect(toSlot(buildDraft(slot), ctx(slot))).toEqual(slot);
  });

  it("round-trips a tag-derived option set, including allowEmpty", () => {
    const slot: BuildParameterSlot = {
      id: "s5",
      label: "Companion power",
      section: "boons",
      type: "build_parameter",
      paramType: "list",
      path: "companion",
      default: "",
      optionsFrom: { tags: ["companion_power"] },
      allowEmpty: true,
    };
    expect(toSlot(buildDraft(slot), ctx(slot))).toEqual(slot);
  });

  it("carries an unrecognized field through untouched (passthrough)", () => {
    const slot: BuildParameterSlot & { visibleWhen: unknown } = {
      id: "s6",
      label: "Hidden param",
      section: "boons",
      type: "build_parameter",
      paramType: "number",
      path: "hidden",
      visibleWhen: { class: "fighter" },
    };
    const draft = buildDraft(slot);
    const passthrough = passthroughOf(slot);
    expect(passthrough).toEqual({ visibleWhen: { class: "fighter" } });
    expect(toSlot(draft, { id: "s6", passthrough })).toEqual(slot);
  });

  it("round-trips a scaler block with its mode and both applies lists", () => {
    const slot: BuildParameterSlot = {
      id: "s7",
      label: "Mount Bolster",
      section: "mounts",
      type: "build_parameter",
      paramType: "percent",
      path: "mountBolster",
      default: 0,
      scaler: {
        mode: "relative",
        applies: { filter: ["mount_combat", "mount_equip"], tags: ["mount"] },
      },
    };
    const draft = buildDraft(slot);
    expect(draft.scalerMode).toBe("relative");
    expect(draft.scalerFilters).toBe("mount_combat, mount_equip");
    expect(draft.scalerTags).toBe("mount");
    expect(toSlot(draft, ctx(slot))).toEqual(slot);
  });

  it("clearing the scaler mode removes the block rather than restoring it from passthrough", () => {
    const slot: BuildParameterSlot = {
      id: "s8",
      label: "Encounter Damage",
      section: "options",
      type: "build_parameter",
      paramType: "percent",
      path: "scalers.encounterDamage",
      scaler: { mode: "absolute", applies: { filter: ["companion"] } },
    };
    expect(passthroughOf(slot)).not.toHaveProperty("scaler");
    const draft = buildDraft(slot);
    draft.scalerMode = "";
    expect(toSlot(draft, ctx(slot))).not.toHaveProperty("scaler");
  });

  it("a scaler with no filters or tags carries only its mode", () => {
    const draft = buildDraft(null);
    draft.label = "Daily Damage";
    draft.section = "options";
    draft.paramType = "percent";
    draft.path = "scalers.dailyDamage";
    draft.scalerMode = "absolute";
    draft.scalerFilters = " , ";
    expect(toSlot(draft, { id: "s9", passthrough: {} }).scaler).toEqual({
      mode: "absolute",
    });
  });

  it("uses ctx.id rather than any id on the source draft", () => {
    const slot: BuildParameterSlot = {
      id: "orig",
      label: "X",
      section: "boons",
      type: "build_parameter",
      paramType: "number",
      path: "x",
    };
    expect(toSlot(buildDraft(slot), ctx(slot, "renamed")).id).toBe("renamed");
  });
});

describe("diffLabel", () => {
  const base: BuildParameterSlot = {
    id: "s1",
    label: "Recovery",
    section: "boons",
    type: "build_parameter",
    paramType: "number",
    path: "recovery",
  };

  it("labels a label change", () => {
    const nw = { ...base, label: "Recovery II" };
    expect(diffLabel(JSON.stringify(base), JSON.stringify(nw))).toBe(
      'edit label to "Recovery II"',
    );
  });

  it("labels a path change ahead of a default change", () => {
    const nw = { ...base, path: "recovery2", default: 5 };
    expect(diffLabel(JSON.stringify(base), JSON.stringify(nw))).toBe(
      'edit path to "recovery2"',
    );
  });

  it("labels a scaler change", () => {
    const nw = { ...base, scaler: { mode: "absolute" as const } };
    expect(diffLabel(JSON.stringify(base), JSON.stringify(nw))).toBe(
      "edit scaler",
    );
  });

  it("falls back to the generic label when nothing recognized changed", () => {
    expect(diffLabel(JSON.stringify(base), JSON.stringify(base))).toBe(
      "edit parameter",
    );
  });
});

describe("findPathConflict", () => {
  const slotsData: SlotsData = {
    sections: [{ id: "boons", label: "Boons" }],
    slots: [
      {
        id: "s1",
        label: "Recovery",
        section: "boons",
        type: "build_parameter",
        paramType: "number",
        path: "recovery",
      },
    ],
  };
  const testDb = db.build([], [], NW_SCHEMA, slotsData);

  it("finds the other slot already on this path", () => {
    const draft = buildDraft(null);
    draft.path = "recovery";
    expect(findPathConflict(draft, testDb, "s2")).toBe("s1");
  });

  it("is not a conflict against its own id", () => {
    const draft = buildDraft(null);
    draft.path = "recovery";
    expect(findPathConflict(draft, testDb, "s1")).toBeNull();
  });

  it("is null for a blank path", () => {
    const draft = buildDraft(null);
    expect(findPathConflict(draft, testDb, "s2")).toBeNull();
  });
});
