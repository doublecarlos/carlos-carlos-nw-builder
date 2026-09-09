// Coverage for lib/preset-draft.ts, the draft <-> SectionPreset conversion PresetForm.vue
// delegates to (see that module's header comment). `occurrences` is the field worth the most
// attention here: it is item-keyed rather than slot-keyed, and `toPreset` is only supposed to
// keep an entry while some row on the draft still reaches that item (an item-picker row's own
// pick, or a point-assignment row's candidates); see `authoredItemIdsOf`.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import { NW_SCHEMA } from "../../src/data/data";
import { buildDraft, toPreset, diffLabel } from "../../src/lib/preset-draft";
import type { Item, SectionPreset, SlotsData } from "../../src/types";

const slotsData: SlotsData = {
  sections: [{ id: "gear", label: "Gear" }],
  slots: [
    {
      id: "ring1",
      label: "Ring 1",
      section: "gear",
      type: "item_picker",
      filter: "test_ring",
    },
    {
      id: "boons.tier1",
      label: "Boons",
      section: "gear",
      type: "point_assignment",
      filter: "test_boon",
    },
    {
      id: "options.flavour",
      label: "Flavour",
      section: "gear",
      type: "build_parameter",
      paramType: "list",
      path: "flavour",
      options: [{ value: "sweet", label: "Sweet" }],
    },
  ],
};

const ring: Item = { id: "ring", name: "Ring", filter: "test_ring" };
const boon: Item = {
  id: "boon",
  name: "Boon",
  filter: "test_boon",
  inlineRepetition: { min: 0, max: 3, default: 0 },
};
const testDb = db.build([ring, boon], [], NW_SCHEMA, slotsData);

const ctx = (id: string) => ({ id, db: testDb });

describe("buildDraft / toPreset round trip", () => {
  it("round-trips a minimal preset", () => {
    const preset: SectionPreset = {
      id: "p1",
      label: "Preset 1",
      section: "gear",
    };
    expect(toPreset(buildDraft(preset), ctx("p1"))).toEqual(preset);
  });

  it("round-trips params, choices, values, assignments and clears together", () => {
    const preset: SectionPreset = {
      id: "p2",
      label: "Preset 2",
      section: "gear",
      params: { "options.flavour": "sweet" },
      choices: { ring1: "ring" },
      values: { ring1: { power: 5 } },
      assignments: { "boons.tier1": { boon: 2 } },
      clears: ["ring1"],
    };
    expect(toPreset(buildDraft(preset), ctx("p2"))).toEqual(preset);
  });

  it("drops an occurrence entry once no row still reaches that item", () => {
    const preset: SectionPreset = {
      id: "p3",
      label: "Preset 3",
      section: "gear",
      choices: { ring1: "ring" },
      occurrences: { ring: { some_bonus: 2 } },
    };
    const draft = buildDraft(preset);
    // The item picker row no longer names "ring", so nothing on the draft reaches it anymore.
    draft.itemRows[0]!.choice = "";
    expect(toPreset(draft, ctx("p3")).occurrences).toBeUndefined();
  });

  it("keeps an occurrence entry reached only through a point-assignment row's candidates", () => {
    const draft = buildDraft({ id: "p4", label: "Preset 4", section: "gear" });
    draft.assignmentRows.push({ slotId: "boons.tier1", counts: {} });
    draft.occurrences.boon = { some_bonus: 1 };
    const preset = toPreset(draft, ctx("p4"));
    expect(preset.occurrences).toEqual({ boon: { some_bonus: 1 } });
  });

  it("uses ctx.id rather than any id on the source draft", () => {
    const preset: SectionPreset = {
      id: "orig",
      label: "Orig",
      section: "gear",
    };
    expect(toPreset(buildDraft(preset), ctx("renamed")).id).toBe("renamed");
  });
});

describe("diffLabel", () => {
  const base: SectionPreset = { id: "p1", label: "Alpha", section: "gear" };

  it("labels a label change", () => {
    const nw = { ...base, label: "Beta" };
    expect(diffLabel(JSON.stringify(base), JSON.stringify(nw))).toBe(
      'edit label → "Beta"',
    );
  });

  it("labels a choices/values change as one 'edit item choices' label", () => {
    const nw = { ...base, choices: { ring1: "ring" } };
    expect(diffLabel(JSON.stringify(base), JSON.stringify(nw))).toBe(
      "edit item choices",
    );
  });

  it("falls back to the generic label when nothing recognized changed", () => {
    expect(diffLabel(JSON.stringify(base), JSON.stringify(base))).toBe(
      "edit preset",
    );
  });
});
