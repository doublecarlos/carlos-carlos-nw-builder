import { describe, it, expect } from "vitest";
import * as catalogExport from "../../src/data/catalogExport";
import { NW_SLOTS, NW_ITEMS, NW_BONUSES } from "../../src/data/data";
import type {
  Bonus,
  Item,
  Slot,
  SectionPreset,
  SlotSection,
  FilterDefaultsMap,
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
      { defaultOpen: true, id: "a", label: "A" },
      { defaultOpen: false, id: "b", label: "B" },
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
      catalogExport.toSlotsFile(sections, slots, presets, {}),
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
      { defaultOpen: true, id: "a", label: "A" },
    ];
    const parsed = JSON.parse(catalogExport.toSlotsFile(sections, [], [], {}));
    expect(Object.hasOwn(parsed.sections[0], "presets")).toBe(false);
  });

  it("carries filterDefaults through unchanged", () => {
    const filterDefaults: FilterDefaultsMap = {
      artifact: { maxCopies: 1 },
      gear_head: { maxCopies: 2 },
    };
    const parsed = JSON.parse(
      catalogExport.toSlotsFile([], [], [], filterDefaults),
    );
    expect(parsed.filterDefaults).toEqual(filterDefaults);
  });

  it("produces valid JSON for the real shipped data", () => {
    const parsed = JSON.parse(
      catalogExport.toSlotsFile(
        NW_SLOTS.sections,
        NW_SLOTS.slots,
        NW_SLOTS.presets ?? [],
        NW_SLOTS.filterDefaults ?? {},
      ),
    );
    expect(parsed.sections.length).toBe(NW_SLOTS.sections.length);
    expect(parsed.filterDefaults).toEqual(NW_SLOTS.filterDefaults);
  });
});
