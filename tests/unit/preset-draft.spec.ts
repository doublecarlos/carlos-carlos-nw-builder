// Coverage for lib/preset-draft.ts, the draft <-> SectionPreset conversion PresetForm.vue
// delegates to (see that module's header comment). `bonusValues` is the field worth the most
// attention here: it is bonus-keyed rather than slot-keyed, and `toPreset` is only supposed to
// keep an entry while some row on the draft still reaches an item carrying that bonus (an
// item-picker row's own pick, or a point-assignment row's candidates).
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import { NW_SCHEMA } from "../../src/data/data";
import {
  bonusSettingGroups,
  buildDraft,
  toPreset,
  diffLabel,
} from "../../src/lib/preset-draft";
import type { Bonus, Item, SectionPreset, SlotsData } from "../../src/types";

const slotsData: SlotsData = {
  sections: [{ id: "gear", label: "Gear", slotIds: [] }],
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

const ring: Item = {
  id: "ring",
  name: "Ring",
  filter: "test_ring",
  bonuses: ["proc"],
};
const boon: Item = {
  id: "boon",
  name: "Boon",
  filter: "test_boon",
  inlineRepetition: { min: 0, max: 3, default: 0 },
  bonuses: ["boon-proc"],
};
const proc: Bonus = {
  id: "proc",
  name: "Proc",
  grants: [{ dynamicStats: [{ stat: "power", min: 0, max: 100, default: 5 }] }],
};
const boonProc: Bonus = {
  id: "boon-proc",
  name: "Boon Proc",
  inputs: { active: { type: "boolean", default: false, label: "Proc" } },
  grants: [
    { when: { input: { key: "active", is: true } }, stats: { power: 1 } },
  ],
};
const testDb = db.build([ring, boon], [proc, boonProc], NW_SCHEMA, slotsData);

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
      values: { ring1: { stat: { power: 5 } } },
      assignments: { "boons.tier1": { boon: 2 } },
      clears: ["ring1"],
    };
    expect(toPreset(buildDraft(preset), ctx("p2"))).toEqual(preset);
  });

  it("drops a bonus input once no row still reaches an item carrying it", () => {
    const preset: SectionPreset = {
      id: "p3",
      label: "Preset 3",
      section: "gear",
      choices: { ring1: "ring" },
      bonusValues: { proc: { input: { active: true } } },
    };
    const draft = buildDraft(preset);
    // The item picker row no longer names "ring", so nothing on the draft reaches it anymore.
    draft.itemRows[0]!.choice = "";
    expect(toPreset(draft, ctx("p3")).bonusValues).toBeUndefined();
  });

  it("keeps a bonus input reached only through a point-assignment row's candidates", () => {
    const draft = buildDraft({ id: "p4", label: "Preset 4", section: "gear" });
    draft.assignmentRows.push({ slotId: "boons.tier1", counts: {} });
    draft.bonusValues["boon-proc"] = { stat: {}, input: { active: true } };
    const preset = toPreset(draft, ctx("p4"));
    expect(preset.bonusValues).toEqual({
      "boon-proc": { input: { active: true } },
    });
  });

  it("round-trips a carried bonus's settings", () => {
    const preset: SectionPreset = {
      id: "p5",
      label: "Preset 5",
      section: "gear",
      choices: { ring1: "ring" },
      bonusValues: { proc: { stat: { power: 40 } } },
    };
    expect(toPreset(buildDraft(preset), ctx("p5"))).toEqual(preset);
  });

  it("drops blank bonus settings and those of a bonus no row's item carries", () => {
    const draft = buildDraft({
      id: "p6",
      label: "Preset 6",
      section: "gear",
      choices: { ring1: "ring" },
      bonusValues: {
        proc: { stat: { power: 40 } },
        stray: { stat: { power: 1 } },
      },
    });
    expect(toPreset(draft, ctx("p6")).bonusValues).toEqual({
      proc: { stat: { power: 40 } },
    });
    draft.bonusValues.proc!.stat.power = "";
    expect(toPreset(draft, ctx("p6")).bonusValues).toBeUndefined();
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

describe("bonusSettingGroups", () => {
  it("offers the dynamic stats of every bonus a picked item carries", () => {
    const draft = buildDraft({
      id: "p1",
      label: "P",
      section: "gear",
      choices: { ring1: "ring" },
    });
    expect(bonusSettingGroups(draft, testDb)).toEqual([
      {
        bonusId: "proc",
        name: "Proc",
        configs: proc.grants![0]!.dynamicStats,
        inputs: [],
      },
    ]);
    draft.itemRows[0]!.choice = "";
    expect(bonusSettingGroups(draft, testDb)).toEqual([]);
  });

  it("offers the inputs of a point-assignment row's item bonuses", () => {
    const draft = buildDraft({ id: "p1", label: "P", section: "gear" });
    draft.assignmentRows.push({ slotId: "boons.tier1", counts: {} });
    expect(bonusSettingGroups(draft, testDb)).toEqual([
      {
        bonusId: "boon-proc",
        name: "Boon Proc",
        configs: [],
        inputs: [{ name: "active", def: boonProc.inputs!.active }],
      },
    ]);
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
