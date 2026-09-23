import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as catalog from "../../src/data/catalog";
import * as catalogExport from "../../src/data/catalogExport";
import {
  NW_SLOTS,
  NW_ITEMS,
  NW_BONUSES,
  NW_FILTERS,
} from "../../src/data/data";
import type {
  Bonus,
  CatalogOverlay,
  Grant,
  Item,
  Slot,
  SectionPreset,
  SlotSection,
  FilterDef,
} from "../../src/types";

describe("catalogExport.toItemsFile", () => {
  it("leads with id/name/filter and trails with tags/bonuses/etc, regardless of the input's own key order", () => {
    // Deliberately scrambled -- a stray hand edit to data/db-items.json shouldn't survive
    // the next `npm run fix` unchanged.
    const scrambled = {
      tags: ["a"],
      il: 10,
      filter: "gear_head",
      name: "Z Item",
      id: "z-item",
    } as Item;
    const text = catalogExport.toItemsFile([scrambled]);
    expect(JSON.parse(text)).toEqual([scrambled]);
    const positions = ["id", "name", "filter", "il", "tags"].map((key) =>
      text.indexOf(`"${key}"`),
    );
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("produces valid JSON for the real shipped data", () => {
    expect(JSON.parse(catalogExport.toItemsFile(NW_ITEMS))).toEqual(NW_ITEMS);
  });
});

describe("catalogExport.toBonusesFile", () => {
  it("leads with id/name/grants, regardless of the input's own key order", () => {
    const scrambled = {
      maxStacks: 2,
      grants: [],
      name: "Z Bonus",
      id: "z-bonus",
    } as Bonus;
    const text = catalogExport.toBonusesFile([scrambled]);
    expect(JSON.parse(text)).toEqual([scrambled]);
    const positions = ["id", "name", "grants", "maxStacks"].map((key) =>
      text.indexOf(`"${key}"`),
    );
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("defaults a missing name to the bonus's id", () => {
    const bonuses: Bonus[] = [{ id: "no-name-bonus", grants: [] }];
    const parsed = JSON.parse(catalogExport.toBonusesFile(bonuses));
    expect(parsed).toEqual([
      { id: "no-name-bonus", name: "no-name-bonus", grants: [] },
    ]);
  });

  // An occurrence leaf naming the bonus it sits in is the engine's reading of one naming
  // nothing, so the file carries the shorter spelling; a leaf naming another bonus is not.
  it("drops a bonusOccurrences bonus equal to the owning bonus, everywhere one can sit", () => {
    const bonus: Bonus = {
      id: "self",
      name: "Self",
      grants: [
        {
          when: {
            bonusOccurrences: { bonus: "self", atLeast: 2 },
            any: [
              { bonusOccurrences: { bonus: "self" } },
              { not: { bonusOccurrences: { bonus: "other", exactly: 1 } } },
            ],
          },
          variants: [
            {
              when: { bonusOccurrences: { bonus: "self", atLeast: 2 } },
              stats: {},
            },
            { stats: {} },
          ],
          tiers: [
            { bonusOccurrences: { bonus: "self", atLeast: 1 }, stats: {} },
          ],
        },
      ],
    };
    const parsed = JSON.parse(catalogExport.toBonusesFile([bonus]));
    expect(parsed[0].grants[0]).toEqual({
      when: {
        bonusOccurrences: { atLeast: 2 },
        any: [
          { bonusOccurrences: {} },
          { not: { bonusOccurrences: { bonus: "other", exactly: 1 } } },
        ],
      },
      variants: [
        { when: { bonusOccurrences: { atLeast: 2 } }, stats: {} },
        { stats: {} },
      ],
      tiers: [{ bonusOccurrences: { atLeast: 1 }, stats: {} }],
    });
    // The input is left alone: the exporter reads the catalog, it does not edit it.
    expect(bonus.grants![0].when!.bonusOccurrences!.bonus).toBe("self");
  });

  // Once the self-reference is implicit, "at least one of itself" as a grant's whole `when`
  // is no condition at all, but only as the whole `when`, and only when unbounded above.
  it("drops a when that is nothing but an unbounded self-occurrence gate", () => {
    const grants: Grant[] = [
      { when: { bonusOccurrences: {} }, stats: { power: 1 } },
      {
        when: { bonusOccurrences: { bonus: "self", atLeast: 1 } },
        stats: { power: 2 },
      },
      {
        variants: [
          { when: { bonusOccurrences: { atLeast: 1 } }, stats: { power: 3 } },
        ],
      },
      // Not trivial: another key, an upper bound, a different bonus, a negation.
      { when: { bonusOccurrences: {}, toggle: "combat" }, stats: {} },
      { when: { bonusOccurrences: { atLeast: 2 } }, stats: {} },
      { when: { bonusOccurrences: { bonus: "other" } }, stats: {} },
      { when: { not: { bonusOccurrences: {} } }, stats: {} },
    ];
    const parsed = JSON.parse(
      catalogExport.toBonusesFile([{ id: "self", grants }]),
    );
    expect(parsed[0].grants).toEqual([
      { stats: { power: 1 } },
      { stats: { power: 2 } },
      { variants: [{ stats: { power: 3 } }] },
      { when: { bonusOccurrences: {}, toggle: "combat" }, stats: {} },
      { when: { bonusOccurrences: { atLeast: 2 } }, stats: {} },
      { when: { bonusOccurrences: { bonus: "other" } }, stats: {} },
      { when: { not: { bonusOccurrences: {} } }, stats: {} },
    ]);
  });

  it("keeps an explicit name as-is", () => {
    const bonuses: Bonus[] = [
      { id: "named-bonus", name: "Named Bonus", grants: [] },
    ];
    const parsed = JSON.parse(catalogExport.toBonusesFile(bonuses));
    expect(parsed[0].name).toBe("Named Bonus");
  });

  it("produces valid JSON for the real shipped data", () => {
    expect(JSON.parse(catalogExport.toBonusesFile(NW_BONUSES))).toEqual(
      NW_BONUSES.map((bonus) => ({ ...bonus, name: bonus.name ?? bonus.id })),
    );
  });
});

describe("catalogExport.toSlotsFile", () => {
  it("round-trips a small sections/slots/presets fixture", () => {
    const sections: SlotSection[] = [
      { defaultOpen: true, id: "a", label: "A", slotIds: [] },
      { defaultOpen: false, id: "b", label: "B", slotIds: [] },
    ];
    const slots: Slot[] = [
      {
        id: "a.x",
        label: "X",
        section: "a",
        type: "build_parameter",
        paramType: "boolean",
        path: "x",
      },
      {
        id: "b.y",
        label: "Y",
        section: "b",
        type: "point_assignment",
        filter: "filter_y",
      },
    ];
    const presets: SectionPreset[] = [
      {
        id: "a.preset1",
        label: "Preset 1",
        section: "a",
        params: { "a.x": true },
      },
    ];

    const parsed = JSON.parse(
      catalogExport.toSlotsFile(sections, slots, presets),
    );

    expect(parsed.sections).toEqual([
      {
        defaultOpen: true,
        id: "a",
        label: "A",
        presets: [
          { id: "a.preset1", label: "Preset 1", params: { "a.x": true } },
        ],
        slots: [
          {
            id: "a.x",
            label: "X",
            type: "build_parameter",
            paramType: "boolean",
            path: "x",
          },
        ],
      },
      {
        defaultOpen: false,
        id: "b",
        label: "B",
        slots: [
          {
            id: "b.y",
            label: "Y",
            type: "point_assignment",
            filter: "filter_y",
          },
        ],
      },
    ]);
  });

  it("omits the presets key entirely for a section with none", () => {
    const sections: SlotSection[] = [
      { defaultOpen: true, id: "a", label: "A", slotIds: [] },
    ];
    const parsed = JSON.parse(catalogExport.toSlotsFile(sections, [], []));
    expect(Object.hasOwn(parsed.sections[0], "presets")).toBe(false);
  });

  it("writes nothing but the sections", () => {
    const parsed = JSON.parse(catalogExport.toSlotsFile([], [], []));
    expect(Object.keys(parsed)).toEqual(["sections"]);
  });

  it("produces valid JSON for the real shipped data", () => {
    const parsed = JSON.parse(
      catalogExport.toSlotsFile(
        NW_SLOTS.sections,
        NW_SLOTS.slots,
        NW_SLOTS.presets ?? [],
      ),
    );
    expect(parsed.sections.length).toBe(NW_SLOTS.sections.length);
  });

  it("writes the shipped data back as the same document data/slots.json holds", () => {
    const raw = readFileSync(
      new URL("../../data/slots.json", import.meta.url),
      "utf8",
    );
    expect(
      JSON.parse(
        catalogExport.toSlotsFile(
          NW_SLOTS.sections,
          NW_SLOTS.slots,
          NW_SLOTS.presets ?? [],
        ),
      ),
    ).toEqual(JSON.parse(raw));
  });

  it("writes a reordered and an added section as nesting, never as slotIds", () => {
    const added: Slot = {
      id: "extra.pick",
      label: "Pick",
      section: "extra",
      type: "item_picker",
      filter: "artifact",
    };
    const overlay: CatalogOverlay = {
      ...catalog.emptyOverlay(),
      slots: { [added.id]: added },
      sections: { extra: { id: "extra", label: "Extra", slotIds: [added.id] } },
      sectionOrder: ["extra", "gear"],
    };
    const composed = catalog.compose([overlay]);
    const text = catalogExport.toSlotsFile(
      composed.sections,
      composed.slots,
      composed.sectionPresets,
    );
    expect(text).not.toContain("slotIds");

    const parsed = JSON.parse(text) as {
      sections: { id: string; slots: { id: string; section?: string }[] }[];
    };
    expect(parsed.sections.map((section) => section.id).slice(0, 2)).toEqual([
      "extra",
      "gear",
    ]);
    expect(parsed.sections[0].slots).toEqual([
      {
        id: "extra.pick",
        label: "Pick",
        type: "item_picker",
        filter: "artifact",
      },
    ]);
    // Order survives a round trip through deriveSlots' shape: nesting is the order.
    const gear = parsed.sections[1];
    expect(gear.slots.map((slot) => slot.id)).toEqual(
      composed.slots.filter((s) => s.section === "gear").map((s) => s.id),
    );
  });
});

describe("catalogExport.toFiltersFile", () => {
  it("keys each filter by id, with the id in the key alone", () => {
    const filters: FilterDef[] = [
      { id: "insignia_bonus", maxCopies: 3, fields: ["insigniaRecipe"] },
    ];
    expect(JSON.parse(catalogExport.toFiltersFile(filters))).toEqual({
      insignia_bonus: { maxCopies: 3, fields: ["insigniaRecipe"] },
    });
  });

  it("sorts the entries by id whatever order the list arrived in", () => {
    const filters: FilterDef[] = [
      { id: "mount", fields: ["insigniaSlots"] },
      { id: "artifact", maxCopies: 1 },
      { id: "insignia", fields: ["insigniaShape"] },
    ];
    const parsed = JSON.parse(catalogExport.toFiltersFile(filters));
    expect(Object.keys(parsed)).toEqual(["artifact", "insignia", "mount"]);
  });

  it("omits a field left undefined instead of writing null", () => {
    const filters: FilterDef[] = [
      { id: "artifact", maxCopies: 1, fields: undefined },
      { id: "boon_tier1", maxCopies: undefined, fields: ["inlineRepetition"] },
      { id: "bare" },
    ];
    const text = catalogExport.toFiltersFile(filters);
    expect(text).not.toContain("null");
    expect(JSON.parse(text)).toEqual({
      artifact: { maxCopies: 1 },
      bare: {},
      boon_tier1: { fields: ["inlineRepetition"] },
    });
  });

  it("round-trips the real shipped data", () => {
    const parsed = JSON.parse(catalogExport.toFiltersFile(NW_FILTERS));
    expect(Object.keys(parsed)).toEqual(NW_FILTERS.map((f) => f.id));
    for (const filter of NW_FILTERS) {
      const { id, ...rest } = filter;
      expect(parsed[id]).toEqual(rest);
    }
  });
});
