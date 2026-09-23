// Sections and filters as overlay groups, and layout as data: `slotIds` ordering a section's
// members, `sectionOrder` ordering the sections, `moveSlot`/`moveSection` writing those, the
// structural lint over the result, and everything traveling with a downloaded build.
import { describe, it, expect } from "vitest";
import * as catalog from "../../src/data/catalog";
import {
  NW_ITEMS,
  NW_BONUSES,
  NW_SLOTS,
  NW_FILTERS,
} from "../../src/data/data";
import { REQUIRED_SLOT_IDS } from "../../src/lib/demo-slots";
import type {
  Build,
  CatalogOverlay,
  Db,
  FilterDef,
  ItemPickerSlot,
  SectionPreset,
  Slot,
  SlotSection,
} from "../../src/types";

const overlayWith = (parts: Partial<CatalogOverlay>): CatalogOverlay => ({
  ...catalog.emptyOverlay(),
  ...parts,
});

const section = (id: string, slotIds: string[] = []): SlotSection => ({
  id,
  label: id,
  slotIds,
});

const picker = (id: string, sectionId: string): ItemPickerSlot => ({
  id,
  label: id,
  section: sectionId,
  type: "item_picker",
  filter: "custom_filter",
});

const idsIn = (slots: Slot[], sectionId: string) =>
  slots.filter((slot) => slot.section === sectionId).map((slot) => slot.id);

/** The shipped Options section and its member ids, in file order. */
const options = NW_SLOTS.sections.find((s) => s.id === "options")!;
const optionIds = idsIn(NW_SLOTS.slots, "options");

const testBuild = (): Build => ({
  id: "b",
  name: "b",
  choices: {},
  values: {},
  assignments: {},
  occurrenceInputs: {},
  listRows: {},
  disabledSlots: {},
  context: {} as Build["context"],
  compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
});

describe("deriveSlots fills slotIds from nesting", () => {
  it("every shipped section lists exactly its own slots, in file order", () => {
    for (const shipped of NW_SLOTS.sections) {
      expect(shipped.slotIds).toEqual(idsIn(NW_SLOTS.slots, shipped.id));
    }
  });
});

describe("catalog.compose: layout order", () => {
  it("a section's slotIds reorder its members, unlisted ones follow in base order", () => {
    const [first, second, ...rest] = optionIds;
    const composed = catalog.compose([
      overlayWith({
        sections: { options: { ...options, slotIds: [second, first] } },
      }),
    ]);
    expect(idsIn(composed.slots, "options")).toEqual([second, first, ...rest]);
  });

  it("ignores ids that name no slot or another section's slot", () => {
    const composed = catalog.compose([
      overlayWith({
        sections: {
          options: { ...options, slotIds: ["gear.head", "options.nope"] },
        },
      }),
    ]);
    expect(idsIn(composed.slots, "options")).toEqual(optionIds);
    expect(idsIn(composed.slots, "gear")).toEqual(
      idsIn(NW_SLOTS.slots, "gear"),
    );
  });

  it("slot.section owns membership: an added slot lands in its section unlisted", () => {
    const added = picker("options.added", "options");
    const composed = catalog.compose([
      overlayWith({ slots: { [added.id]: added } }),
    ]);
    expect(idsIn(composed.slots, "options")).toEqual([...optionIds, added.id]);
  });

  it("appends slots of a section that does not exist after everything else", () => {
    const orphan = picker("nowhere.x", "nowhere");
    const composed = catalog.compose([
      overlayWith({ slots: { [orphan.id]: orphan } }),
    ]);
    expect(composed.slots.at(-1)?.id).toBe(orphan.id);
    expect(composed.sections.some((s) => s.id === "nowhere")).toBe(false);
  });

  it("sectionOrder puts the listed sections first and the rest in base order", () => {
    const baseIds = NW_SLOTS.sections.map((s) => s.id);
    const composed = catalog.compose([
      overlayWith({ sectionOrder: ["gear", "unknown-section", "options"] }),
    ]);
    expect(composed.sections.map((s) => s.id)).toEqual([
      "gear",
      "options",
      ...baseIds.filter((id) => id !== "gear" && id !== "options"),
    ]);
    // Slots follow the sections.
    expect(composed.slots[0].section).toBe("gear");
  });

  it("a later layer's sectionOrder replaces an earlier one wholesale", () => {
    const composed = catalog.compose([
      overlayWith({ sectionOrder: ["gear", "options"] }),
      overlayWith({ sectionOrder: ["boons"] }),
    ]);
    expect(composed.sections[0].id).toBe("boons");
    expect(composed.sections[1].id).toBe("options");
  });

  it("an added section is appended in base order and a tombstoned one is gone", () => {
    const added = section("extra", []);
    const composed = catalog.compose([
      overlayWith({ sections: { extra: added, gear: null } }),
    ]);
    expect(composed.sections.at(-1)).toEqual(added);
    expect(composed.sections.some((s) => s.id === "gear")).toBe(false);
  });

  it("filters fold like items and come out sorted by id", () => {
    const added: FilterDef = { id: "aaa_custom", maxCopies: 2 };
    const composed = catalog.compose([
      overlayWith({ filters: { aaa_custom: added, artifact: null } }),
    ]);
    expect(composed.filters[0]).toEqual(added);
    expect(composed.filters.some((f) => f.id === "artifact")).toBe(false);
  });
});

describe("makeDb with composed sections and filters", () => {
  it("the db's sections are the composed ones", () => {
    const db = catalog.makeDb([overlayWith({ sectionOrder: ["gear"] })]);
    expect(db.sections[0].id).toBe("gear");
  });

  it("a tombstoned filter falls back to the defaults", () => {
    const artifact = NW_ITEMS.find(
      (item) => item.filter === "artifact" && item.maxCopies === undefined,
    )!;
    expect(catalog.makeDb([]).maxCopies(artifact)).toBe(1);
    const db = catalog.makeDb([overlayWith({ filters: { artifact: null } })]);
    expect(db.maxCopies(artifact)).toBe(0);
    expect(db.filterDefaults.artifact).toBeUndefined();
  });
});

describe("normalizeOverlay and the overlay shape", () => {
  it("defaults the groups an older overlay lacks", () => {
    const normalized = catalog.normalizeOverlay({
      items: {},
      bonuses: {},
      sectionPresets: {},
      slots: {},
    });
    expect(normalized.sections).toEqual({});
    expect(normalized.filters).toEqual({});
    expect(normalized.sectionOrder).toBeUndefined();
  });

  it("keeps section and filter entries, their tombstones and sectionOrder", () => {
    const normalized = catalog.normalizeOverlay({
      sections: { extra: section("extra", ["extra.a"]), gear: null },
      filters: { custom: { id: "custom", maxCopies: 1 }, artifact: null },
      sectionOrder: ["gear", "options"],
    });
    expect(normalized.sections.extra).toEqual(section("extra", ["extra.a"]));
    expect(normalized.sections.gear).toBe(null);
    expect(normalized.filters.custom).toEqual({ id: "custom", maxCopies: 1 });
    expect(normalized.filters.artifact).toBe(null);
    expect(normalized.sectionOrder).toEqual(["gear", "options"]);
  });

  it("gives a section entry without slotIds an empty list and drops a bad sectionOrder", () => {
    const normalized = catalog.normalizeOverlay({
      sections: { extra: { id: "extra", label: "Extra" } },
      sectionOrder: "gear",
    });
    expect(normalized.sections.extra?.slotIds).toEqual([]);
    expect(normalized.sectionOrder).toBeUndefined();
  });

  it("isEmpty, changedCount and entryCount see sectionOrder and the new groups", () => {
    const ordered = overlayWith({ sectionOrder: ["gear"] });
    expect(catalog.isEmpty(ordered)).toBe(false);
    expect(catalog.changedCount(ordered)).toBe(1);
    expect(catalog.entryCount(ordered)).toBe(0);

    const mixed = overlayWith({
      sections: { extra: section("extra"), gear: null },
      filters: { custom: { id: "custom" } },
    });
    expect(catalog.changedCount(mixed)).toBe(3);
    expect(catalog.entryCount(mixed)).toBe(2);
  });

  it("statusOf, tombstoneIds, revert and remove cover sections and filters", () => {
    let overlay = catalog.upsert(
      catalog.emptyOverlay(),
      "sections",
      "extra",
      section("extra"),
    );
    expect(catalog.statusOf(overlay, "sections", "extra")).toBe("added");
    overlay = catalog.upsert(overlay, "filters", "artifact", {
      id: "artifact",
      maxCopies: 2,
    });
    expect(catalog.statusOf(overlay, "filters", "artifact")).toBe("edited");
    overlay = catalog.remove(overlay, "sections", "gear");
    expect(catalog.statusOf(overlay, "sections", "gear")).toBe("removed");
    expect(catalog.tombstoneIds(overlay, "sections")).toEqual(["gear"]);
    overlay = catalog.revert(overlay, "sections", "gear");
    expect(catalog.statusOf(overlay, "sections", "gear")).toBe("base");
    overlay = catalog.remove(overlay, "sections", "extra");
    expect("extra" in overlay.sections).toBe(false);
  });
});

describe("catalog.nextSlotId fallback stems", () => {
  it("falls back per slot type when the label slugifies to nothing", () => {
    expect(catalog.nextSlotId("gear", "", [], "separator")).toBe("gear.sep");
    expect(catalog.nextSlotId("gear", "", [], "text")).toBe("gear.text");
    expect(catalog.nextSlotId("gear", "", [])).toBe("gear.param");
  });
});

describe("catalog.moveSlot / moveSection", () => {
  const layout = () => catalog.compose([]);

  it("reorders within a section by writing the section's full slotIds", () => {
    const [first, second, third] = optionIds;
    const next = catalog.moveSlot(
      catalog.emptyOverlay(),
      layout(),
      first,
      "options",
      1,
    );
    expect(next.sections.options?.slotIds.slice(0, 3)).toEqual([
      second,
      first,
      third,
    ]);
    expect(next.sections.options?.slotIds).toHaveLength(optionIds.length);
    expect(Object.keys(next.slots)).toEqual([]);
    expect(idsIn(catalog.compose([next]).slots, "options").slice(0, 3)).toEqual(
      [second, first, third],
    );
  });

  it("moves across sections: both sections and the slot's section field", () => {
    const moved = optionIds[0];
    const gearIds = idsIn(NW_SLOTS.slots, "gear");
    const next = catalog.moveSlot(
      catalog.emptyOverlay(),
      layout(),
      moved,
      "gear",
      0,
    );
    expect(next.sections.gear?.slotIds).toEqual([moved, ...gearIds]);
    expect(next.sections.options?.slotIds).toEqual(optionIds.slice(1));
    expect(next.slots[moved]?.section).toBe("gear");
    expect(next.slots[moved]?.id).toBe(moved);

    const composed = catalog.compose([next]);
    expect(idsIn(composed.slots, "gear")).toEqual([moved, ...gearIds]);
    expect(idsIn(composed.slots, "options")).toEqual(optionIds.slice(1));
  });

  it("is a no-op for an unknown slot or section, or a drop that changes nothing", () => {
    const empty = catalog.emptyOverlay();
    expect(catalog.moveSlot(empty, layout(), "nope", "gear", 0)).toBe(empty);
    expect(catalog.moveSlot(empty, layout(), optionIds[0], "nope", 0)).toBe(
      empty,
    );
    expect(catalog.moveSlot(empty, layout(), optionIds[0], "options", 0)).toBe(
      empty,
    );
  });

  it("moveSection writes the whole order and is a no-op when nothing moves", () => {
    const baseIds = NW_SLOTS.sections.map((s) => s.id);
    const next = catalog.moveSection(
      catalog.emptyOverlay(),
      layout(),
      "gear",
      0,
    );
    expect(next.sectionOrder).toEqual([
      "gear",
      ...baseIds.filter((id) => id !== "gear"),
    ]);
    expect(catalog.compose([next]).sections[0].id).toBe("gear");

    const empty = catalog.emptyOverlay();
    expect(catalog.moveSection(empty, layout(), "nope", 0)).toBe(empty);
    expect(catalog.moveSection(empty, layout(), baseIds[0], 0)).toBe(empty);
  });
});

describe("catalog.referencedOverlay: layout travels with a build", () => {
  const testDb = (parts: Partial<Db>): Db =>
    ({
      get: () => null,
      replacementFor: () => null,
      bonusById: new Map(),
      slots: NW_SLOTS.slots,
      authoredSlots: NW_SLOTS.slots,
      sections: NW_SLOTS.sections,
      filters: NW_FILTERS,
      ...parts,
    }) as unknown as Db;

  it("carries an added item_picker slot, its section and a changed filter", () => {
    const added = picker("extra.pick", "extra");
    const extra = section("extra", [added.id]);
    const artifact: FilterDef = { id: "artifact", maxCopies: 2 };
    const composed = catalog.compose([
      overlayWith({
        slots: { [added.id]: added },
        sections: { extra },
        filters: { artifact },
      }),
    ]);
    const overlay = catalog.referencedOverlay(
      testDb({
        slots: composed.slots,
        authoredSlots: composed.slots,
        sections: composed.sections,
        filters: composed.filters,
      }),
      testBuild(),
    );
    expect(overlay.slots).toEqual({ [added.id]: added });
    expect(overlay.sections).toEqual({ extra });
    expect(overlay.filters).toEqual({ artifact });
    expect(overlay.sectionOrder).toBeUndefined();
  });

  it("carries a reordered section and sectionOrder, but not an untouched layout", () => {
    expect(
      catalog.isEmpty(catalog.referencedOverlay(testDb({}), testBuild())),
    ).toBe(true);

    const composed = catalog.compose([
      catalog.moveSection(
        catalog.moveSlot(
          catalog.emptyOverlay(),
          catalog.compose([]),
          optionIds[0],
          "options",
          1,
        ),
        catalog.compose([]),
        "gear",
        0,
      ),
    ]);
    const overlay = catalog.referencedOverlay(
      testDb({
        slots: composed.slots,
        authoredSlots: composed.slots,
        sections: composed.sections,
      }),
      testBuild(),
    );
    expect(Object.keys(overlay.sections)).toEqual(["options"]);
    expect(overlay.sectionOrder).toEqual(composed.sections.map((s) => s.id));
  });

  it("an added section that merely appends needs no sectionOrder", () => {
    const composed = catalog.compose([
      overlayWith({ sections: { extra: section("extra") } }),
    ]);
    const overlay = catalog.referencedOverlay(
      testDb({ sections: composed.sections }),
      testBuild(),
    );
    expect(overlay.sectionOrder).toBeUndefined();
  });
});

describe("catalog.validateSections", () => {
  const slots: Slot[] = [picker("a.one", "a"), picker("a.two", "a")];

  it("is quiet on a coherent layout", () => {
    expect(
      catalog.validateSections([section("a", ["a.two", "a.one"])], slots),
    ).toEqual([]);
  });

  it("errors on a slot whose section does not exist", () => {
    const findings = catalog.validateSections(
      [section("a")],
      [...slots, picker("b.lost", "b")],
    );
    expect(findings).toEqual([
      expect.objectContaining({
        level: "error",
        kind: "slot",
        name: "b.lost",
      }),
    ]);
  });

  it("errors on a duplicate section id", () => {
    const findings = catalog.validateSections(
      [section("a"), section("a")],
      slots,
    );
    expect(findings.map((f) => [f.level, f.kind, f.name])).toEqual([
      ["error", "section", "a"],
    ]);
  });

  it("warns on slotIds naming an unknown or foreign slot", () => {
    const findings = catalog.validateSections(
      [section("a", ["a.one", "nope", "b.other"]), section("b", [])],
      [...slots, picker("b.other", "b")],
    );
    expect(findings.map((f) => f.message)).toEqual([
      expect.stringMatching(/"nope", which is not a slot/),
      expect.stringMatching(/"b.other", which belongs to section "b"/),
    ]);
    expect(findings.every((f) => f.level === "warn")).toBe(true);
  });

  it("warns on sectionOrder naming an unknown section and on an empty section", () => {
    const findings = catalog.validateSections(
      [section("a"), section("empty")],
      slots,
      ["empty", "gone"],
    );
    expect(findings.map((f) => [f.level, f.name])).toEqual([
      ["warn", "empty"],
      ["warn", "gone"],
    ]);
  });
});

describe("catalog.validatePresets: section must exist", () => {
  it("errors on a preset whose section does not exist", () => {
    const preset: SectionPreset = { id: "p", label: "P", section: "nowhere" };
    const findings = catalog.validatePresets([preset], NW_SLOTS.slots);
    expect(findings).toEqual([
      expect.objectContaining({
        level: "error",
        kind: "sectionPreset",
        name: "p",
        message: expect.stringMatching(/section "nowhere" does not exist/),
      }),
    ]);
  });
});

describe("catalog.usedFilters", () => {
  it("unions an item's own category with every slot selector's", () => {
    expect(
      [
        ...catalog.usedFilters(
          [{ id: "i1", name: "One", filter: "gear_ring" }],
          [picker("a.one", "a")],
        ),
      ].sort(),
    ).toEqual(["custom_filter", "gear_ring"]);
  });

  it("is empty when nothing names a category", () => {
    expect([...catalog.usedFilters([], [])]).toEqual([]);
  });
});

describe("catalog.validateFilters", () => {
  it("warns on a declared filter nothing uses", () => {
    const findings = catalog.validateFilters(
      [{ id: "unused" }, { id: "artifact" }],
      NW_ITEMS,
      NW_SLOTS.slots,
    );
    expect(findings).toEqual([
      expect.objectContaining({
        level: "warn",
        kind: "filter",
        name: "unused",
      }),
    ]);
  });

  it("counts a slot selector as a use, items or not", () => {
    expect(
      catalog.validateFilters(
        [{ id: "custom_filter" }],
        [],
        [picker("a.one", "a")],
      ),
    ).toEqual([]);
  });
});

describe("catalog.validateRequiredSlots", () => {
  const without = (slotId: string) =>
    catalog.compose([overlayWith({ slots: { [slotId]: null } })]);

  it("is quiet on the shipped data", () => {
    expect(
      catalog.validateRequiredSlots(NW_SLOTS.slots, NW_SLOTS.sections),
    ).toEqual([]);
  });

  it("warns when an engine-coupled param is tombstoned, naming the reader", () => {
    const { slots, sections } = without("options.magnitude");
    const findings = catalog.validateRequiredSlots(slots, sections);
    const engine = findings.filter((f) => /path "magnitude"/.test(f.message));
    expect(engine).toEqual([
      expect.objectContaining({
        level: "warn",
        kind: "slot",
        name: "options.magnitude",
        message: expect.stringMatching(/the engine scales damage by it/),
      }),
    ]);
  });

  it("says nothing about a bolster param, whose scaling lives on the slot itself", () => {
    const { slots, sections } = without("mounts.bolster");
    const findings = catalog.validateRequiredSlots(slots, sections);
    expect(findings.some((f) => /mountBolster/.test(f.message))).toBe(false);
  });

  it("warns when a slot the app writes to is tombstoned, naming the writer", () => {
    const { slots, sections } = without(REQUIRED_SLOT_IDS.race.id);
    const findings = catalog.validateRequiredSlots(slots, sections);
    expect(findings.some((f) => f.name === REQUIRED_SLOT_IDS.race.id)).toBe(
      true,
    );
    expect(
      findings.find((f) => f.name === REQUIRED_SLOT_IDS.race.id)?.message,
    ).toMatch(/the game import writes to it/);
  });

  it("warns when a slot game-import.json names is tombstoned", () => {
    const { slots, sections } = without("gear.head");
    const findings = catalog.validateRequiredSlots(slots, sections);
    expect(findings).toEqual([
      expect.objectContaining({
        level: "warn",
        kind: "slot",
        name: "gear.head",
        message: expect.stringMatching(/game-import\.json \(bag "Head"\)/),
      }),
    ]);
  });

  it("warns when a section game-import.json names is tombstoned", () => {
    const { slots, sections } = catalog.compose([
      overlayWith({ sections: { boons: null } }),
    ]);
    const findings = catalog.validateRequiredSlots(slots, sections);
    expect(findings).toEqual([
      expect.objectContaining({
        level: "warn",
        kind: "section",
        name: "boons",
        message: expect.stringMatching(/notInDemoReasons "Boons"/),
      }),
    ]);
  });
});

describe("catalog.validate on the composed shipped catalog", () => {
  it("lints clean", () => {
    expect(
      catalog.validate(
        NW_ITEMS,
        NW_BONUSES,
        undefined,
        NW_SLOTS.presets,
        NW_SLOTS.slots,
        NW_SLOTS.sections,
        NW_FILTERS,
      ),
    ).toEqual([]);
  });

  it("reports the layer's own stale sectionOrder", () => {
    const findings = catalog.validate(
      NW_ITEMS,
      NW_BONUSES,
      undefined,
      NW_SLOTS.presets,
      NW_SLOTS.slots,
      NW_SLOTS.sections,
      NW_FILTERS,
      ["gone"],
    );
    expect(findings.map((f) => f.name)).toEqual(["gone"]);
  });
});
