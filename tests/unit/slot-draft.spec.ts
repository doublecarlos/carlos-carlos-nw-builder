// Coverage for lib/slot-draft.ts, mainly that each slot type round-trips unchanged and never
// picks up another type's fields.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import { NW_SCHEMA } from "../../src/data/data";
import {
  buildDraft,
  toSlot,
  diffLabel,
  findPathConflict,
  slotSaveError,
  TYPE_FIELDS,
} from "../../src/lib/slot-draft";
import type {
  BuildParameterSlot,
  Item,
  Slot,
  SlotsData,
} from "../../src/types";

const ctx = (slot: Slot, id = slot.id) => ({ id });

const roundTrip = (slot: Slot) => toSlot(buildDraft(slot), ctx(slot));

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
    expect(roundTrip(slot)).toEqual(slot);
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
    expect(roundTrip(slot)).toEqual(slot);
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
    expect(roundTrip(slot)).toEqual(slot);
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
    expect(roundTrip(slot)).toEqual(slot);
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
    expect(roundTrip(slot)).toEqual(slot);
  });

  it("round-trips a visibleWhen through the condition rows", () => {
    const slot: BuildParameterSlot = {
      id: "s6",
      label: "Hidden param",
      section: "boons",
      type: "build_parameter",
      paramType: "number",
      path: "hidden",
      visibleWhen: { class: "fighter" },
    };
    const draft = buildDraft(slot);
    expect(draft.whenMode).toBe("rows");
    expect(roundTrip(slot)).toEqual(slot);
  });

  it("keeps a condition the row model cannot express as JSON", () => {
    const slot: BuildParameterSlot = {
      id: "s6b",
      label: "Odd",
      section: "boons",
      type: "build_parameter",
      paramType: "number",
      path: "odd",
      visibleWhen: {
        equipped: ["a", "b"],
      } as BuildParameterSlot["visibleWhen"],
    };
    const draft = buildDraft(slot);
    expect(draft.whenMode).toBe("json");
    expect(roundTrip(slot)).toEqual(slot);
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

  it("clearing the scaler mode removes the block", () => {
    const slot: BuildParameterSlot = {
      id: "s8",
      label: "Encounter Damage",
      section: "options",
      type: "build_parameter",
      paramType: "percent",
      path: "scalers.encounterDamage",
      scaler: { mode: "absolute", applies: { filter: ["companion"] } },
    };
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
    const slot = toSlot(draft, { id: "s9" }) as BuildParameterSlot;
    expect(slot.scaler).toEqual({ mode: "absolute" });
  });

  it("round-trips an item_picker with every flag, a default and a stable row", () => {
    const slot: Slot = {
      id: "stable.insignia1",
      label: "Insignia 1",
      section: "stable",
      type: "item_picker",
      filter: "insignia",
      default: "ins-a",
      disallowEmpty: true,
      hidePreview: true,
      toggleable: true,
      quick: true,
      stable: { group: 1, role: "insignia", index: 2 },
      visibleWhen: { class: "fighter" },
    };
    expect(roundTrip(slot)).toEqual(slot);
  });

  it("round-trips a tag-selected item_picker", () => {
    const slot: Slot = {
      id: "gear.power",
      label: "Companion power",
      section: "gear",
      type: "item_picker",
      tags: ["companion_power:offense", "companion_power:utility"],
    };
    expect(roundTrip(slot)).toEqual(slot);
  });

  it("round-trips an item_picker_list", () => {
    const slot: Slot = {
      id: "misc.misc",
      label: "Misc",
      section: "misc",
      type: "item_picker_list",
      filter: "misc",
      defaultRows: 2,
      toggleable: true,
    };
    expect(roundTrip(slot)).toEqual(slot);
  });

  it("round-trips a point_assignment, a separator and a text slot", () => {
    const points: Slot = {
      id: "boons.points",
      label: "Boon points",
      section: "boons",
      type: "point_assignment",
      filter: "boon_points",
    };
    const separator: Slot = {
      id: "gear.sep",
      section: "gear",
      type: "separator",
    };
    const text: Slot = {
      id: "gear.note",
      section: "gear",
      type: "text",
      text: "Offense slots below",
    };
    expect(roundTrip(points)).toEqual(points);
    expect(roundTrip(separator)).toEqual(separator);
    expect(roundTrip(text)).toEqual(text);
  });

  it("writes only the active type's fields, so switching type leaks nothing", () => {
    const draft = buildDraft(null);
    draft.label = "Head";
    draft.section = "gear";
    draft.path = "leftover";
    draft.default = "7";
    draft.type = "item_picker";
    draft.filter = "head";
    const slot = toSlot(draft, { id: "gear.head" });
    expect(slot).toEqual({
      id: "gear.head",
      label: "Head",
      section: "gear",
      type: "item_picker",
      filter: "head",
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

  it("names a field block for every slot type", () => {
    const types: Slot["type"][] = [
      "build_parameter",
      "item_picker",
      "item_picker_list",
      "point_assignment",
      "separator",
      "text",
    ];
    for (const type of types) expect(TYPE_FIELDS[type]).toBeDefined();
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

  it("labels a move between sections", () => {
    const nw = { ...base, section: "gear" };
    expect(diffLabel(JSON.stringify(base), JSON.stringify(nw))).toBe(
      'move to section "gear"',
    );
  });

  it("falls back to the generic label when nothing recognized changed", () => {
    expect(diffLabel(JSON.stringify(base), JSON.stringify(base))).toBe(
      "edit slot",
    );
  });
});

const items: Item[] = [
  { id: "ins-a", name: "Insignia A", filter: "insignia" },
  { id: "mount-a", name: "Mount A", filter: "mount" },
];

const slotsData: SlotsData = {
  sections: [
    { id: "boons", label: "Boons", slotIds: [] },
    { id: "stable", label: "Stable", slotIds: [] },
  ],
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
const testDb = db.build(items, [], NW_SCHEMA, slotsData);

describe("findPathConflict", () => {
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

  it("is null for a type that has no path at all", () => {
    const draft = buildDraft(null);
    draft.type = "item_picker";
    draft.path = "recovery";
    expect(findPathConflict(draft, testDb, "s2")).toBeNull();
  });
});

describe("slotSaveError", () => {
  function draftOf(patch: Partial<ReturnType<typeof buildDraft>>) {
    return { ...buildDraft(null), section: "boons", label: "X", ...patch };
  }

  it("wants a section", () => {
    expect(slotSaveError(draftOf({ section: "" }), testDb, "x")).toMatch(
      /needs a section/,
    );
  });

  it("wants a label on a slot that renders one", () => {
    expect(slotSaveError(draftOf({ label: "" }), testDb, "x")).toMatch(
      /needs a label/,
    );
  });

  it("does not want a label on a separator", () => {
    expect(
      slotSaveError(draftOf({ label: "", type: "separator" }), testDb, "x"),
    ).toBeNull();
  });

  it("blocks a path already taken by another parameter", () => {
    expect(slotSaveError(draftOf({ path: "recovery" }), testDb, "s2")).toMatch(
      /already used by s1/,
    );
  });

  it("wants a selector on an item picker", () => {
    expect(
      slotSaveError(draftOf({ type: "item_picker" }), testDb, "x"),
    ).toMatch(/needs an item filter or tags/);
  });

  it("blocks a default that is not one of the slot's own candidates", () => {
    const draft = draftOf({
      type: "item_picker",
      filter: "insignia",
      itemDefault: "mount-a",
    });
    expect(slotSaveError(draft, testDb, "stable.x")).toMatch(
      /not one of this slot's own candidates/,
    );
  });

  it("accepts a default the slot does offer", () => {
    const draft = draftOf({
      type: "item_picker",
      filter: "insignia",
      itemDefault: "ins-a",
    });
    expect(slotSaveError(draft, testDb, "stable.x")).toBeNull();
  });

  it("holds a stable row to the filter its role has to select", () => {
    const draft = draftOf({
      type: "item_picker",
      filter: "insignia",
      stableRole: "mount",
      stableGroup: "1",
    });
    expect(slotSaveError(draft, testDb, "stable.x")).toMatch(
      /must select the "mount" filter/,
    );
  });

  it("wants a position on a stable insignia row", () => {
    const draft = draftOf({
      type: "item_picker",
      filter: "insignia",
      stableRole: "insignia",
      stableGroup: "1",
    });
    expect(slotSaveError(draft, testDb, "stable.x")).toMatch(
      /needs a position/,
    );
  });

  it("reports unparseable visibleWhen JSON", () => {
    const draft = draftOf({ whenMode: "json", whenJson: "{oops" });
    expect(slotSaveError(draft, testDb, "x")).toMatch(/not valid JSON/);
  });
});
