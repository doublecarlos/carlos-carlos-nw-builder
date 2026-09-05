// The "show unavailable" lens over db.ts's three picker filters: `includeHidden` re-admits the
// candidates a picker withholds, and each one carries the reason it was withheld.
//
// Purpose-made items rather than shipped ones: nothing shipped is retired or class-locked in a
// way these could be pinned to without becoming hostage to a data edit.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import { NW_SCHEMA } from "../../src/data/data";
import type { Build, Item, SlotsData } from "../../src/types";

const slotsData: SlotsData = {
  sections: [
    { id: "options", label: "Options" },
    { id: "gear", label: "Gear" },
    { id: "boons", label: "Boons" },
  ],
  slots: [
    {
      id: "options.class",
      label: "Class",
      section: "options",
      type: "item_picker",
      filter: "class",
    },
    {
      id: "ring1",
      label: "Ring 1",
      section: "gear",
      type: "item_picker",
      filter: "test_ring",
    },
    {
      id: "ring2",
      label: "Ring 2",
      section: "gear",
      type: "item_picker",
      filter: "test_ring",
    },
    {
      id: "boons.tier1",
      label: "Boons",
      section: "boons",
      type: "point_assignment",
      filter: "test_boon",
    },
  ],
};

const wizard: Item = {
  id: "class-wizard",
  name: "Wizard",
  filter: "class",
  publishes: { class: "wizard" },
};
const cleric: Item = {
  id: "class-cleric",
  name: "Cleric",
  filter: "class",
  publishes: { class: "cleric" },
};
const plain: Item = { id: "plain", name: "Plain Ring", filter: "test_ring" };
const retired: Item = {
  id: "retired",
  name: "Retired Ring",
  filter: "test_ring",
  hideFromPicker: true,
};
const wizardOnly: Item = {
  id: "wizard-only",
  name: "Wizard Ring",
  filter: "test_ring",
  allowedClass: ["wizard"],
};
const capped: Item = {
  id: "capped",
  name: "Capped Ring",
  filter: "test_ring",
  maxCopies: 1,
};
const boon: Item = {
  id: "boon",
  name: "Boon",
  filter: "test_boon",
  hideFromPicker: true,
  inlineRepetition: { min: 0, max: 5, default: 0 },
};

const testDb = db.build(
  [wizard, cleric, plain, retired, wizardOnly, capped, boon],
  [],
  NW_SCHEMA,
  slotsData,
);

function buildWith(choices: Record<string, string> = {}): Build {
  return {
    id: "b",
    name: "b",
    choices,
    values: {},
    assignments: {},
    occurrenceInputs: {},
    listRows: {},
    context: { class: "" },
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
  } as unknown as Build;
}

const idsIn = (slotId: string, build: Build, includeHidden = false) =>
  db.forSlotAndBuild(testDb, slotId, build, { includeHidden }).map((i) => i.id);

describe("forSlotAndBuild's includeHidden lens", () => {
  it("re-admits a retired candidate", () => {
    const build = buildWith();
    expect(idsIn("ring1", build)).not.toContain("retired");
    expect(idsIn("ring1", build, true)).toContain("retired");
  });

  it("re-admits a candidate restricted to another class", () => {
    const build = buildWith({ "options.class": "class-cleric" });
    expect(idsIn("ring1", build)).not.toContain("wizard-only");
    expect(idsIn("ring1", build, true)).toContain("wizard-only");
  });

  it("re-admits a candidate already at its copy cap", () => {
    const build = buildWith({ ring1: "capped" });
    expect(idsIn("ring2", build)).not.toContain("capped");
    expect(idsIn("ring2", build, true)).toContain("capped");
  });

  it("re-admits a retired point_assignment row's item", () => {
    const build = buildWith();
    expect(idsIn("boons.tier1", build)).not.toContain("boon");
    expect(idsIn("boons.tier1", build, true)).toContain("boon");
  });

  it("changes nothing about the candidates that were never withheld", () => {
    const build = buildWith({ "options.class": "class-wizard" });
    expect(idsIn("ring1", build)).toContain("plain");
    expect(idsIn("ring1", build, true)).toContain("plain");
  });
});

describe("the reason a re-shown candidate carries", () => {
  it("names retirement", () => {
    expect(db.hiddenReasons(testDb, "ring1", buildWith()).get("retired")).toBe(
      "retired",
    );
  });

  it("names the class by its display name, not the published id", () => {
    const reasons = db.hiddenReasons(
      testDb,
      "ring1",
      buildWith({ "options.class": "class-cleric" }),
    );
    expect(reasons.get("wizard-only")).toBe("Wizard only");
  });

  it("names the copies already spent and the cap", () => {
    const reasons = db.hiddenReasons(
      testDb,
      "ring2",
      buildWith({ ring1: "capped" }),
    );
    expect(reasons.get("capped")).toBe("1/1 copies");
  });

  it("says nothing about a candidate the picker offers anyway", () => {
    const reasons = db.hiddenReasons(
      testDb,
      "ring1",
      buildWith({ "options.class": "class-wizard" }),
    );
    expect(reasons.has("plain")).toBe(false);
    expect(reasons.has("wizard-only")).toBe(false);
  });

  it("leaves the slot's own equipped pick unlabelled, so clearing it is not a one-way door", () => {
    const build = buildWith({ ring1: "retired" });
    expect(db.hiddenReasons(testDb, "ring1", build).has("retired")).toBe(false);
    expect(db.hiddenReasons(testDb, "ring2", build).get("retired")).toBe(
      "retired",
    );
  });

  it("reports one reason per candidate, retirement first", () => {
    const both = db.build(
      [
        wizard,
        cleric,
        {
          id: "both",
          name: "Both Ring",
          filter: "test_ring",
          hideFromPicker: true,
          allowedClass: ["wizard"],
        },
      ],
      [],
      NW_SCHEMA,
      slotsData,
    );
    const reasons = db.hiddenReasons(
      both,
      "ring1",
      buildWith({ "options.class": "class-cleric" }),
    );
    expect(reasons.get("both")).toBe("retired");
  });
});
