// catalog.ts's `validateSlots`: a duplicate path, or one shadowing a BuildContext field, would
// otherwise silently corrupt engine state (setPath clobbering `context.forte`/`context.toggles`
// wholesale, or two slots fighting over one value).
import { describe, it, expect } from "vitest";
import * as catalog from "../../src/data/catalog";
import { NW_SLOTS, NW_ITEMS, NW_BONUSES } from "../../src/data/data";
import type {
  Bonus,
  BuildParameterSlot,
  ConditionWhen,
  Item,
  Slot,
  SectionPreset,
  CatalogOverlay,
  Db,
  Build,
} from "../../src/types";

const paramSlot = (id: string, path: string): Slot => ({
  id,
  label: id,
  section: "options",
  type: "build_parameter",
  paramType: "boolean",
  path,
});

const pointAssignmentSlot = (id: string, filter: string): Slot => ({
  id,
  label: id,
  section: "boons",
  type: "point_assignment",
  filter,
});

describe("catalog.validateSlots", () => {
  it("the shipped slots.json has no duplicate or shadowing paths", () => {
    expect(catalog.validateSlots(NW_SLOTS.slots)).toEqual([]);
  });

  it("reports two slots sharing one path", () => {
    const slots = [paramSlot("a", "bolster"), paramSlot("b", "bolster")];
    const findings = catalog.validateSlots(slots);
    expect(findings).toHaveLength(1);
    expect(findings[0].level).toBe("error");
    expect(findings[0].message).toMatch(/duplicates/);
  });

  it("reports an empty path", () => {
    const findings = catalog.validateSlots([paramSlot("a", "")]);
    expect(findings.some((f) => /no path/.test(f.message))).toBe(true);
  });

  it("reports a custom parameter shadowing a bare compound BuildContext field", () => {
    const findings = catalog.validateSlots([paramSlot("a", "toggles")]);
    expect(
      findings.some((f) => /shadows a BuildContext field/.test(f.message)),
    ).toBe(true);
  });

  it("reports a custom parameter nesting under a scalar BuildContext field", () => {
    const findings = catalog.validateSlots([paramSlot("a", "class.tier")]);
    expect(
      findings.some((f) => /shadows a BuildContext field/.test(f.message)),
    ).toBe(true);
  });

  it("does not flag legitimate nesting into a compound field", () => {
    const findings = catalog.validateSlots([
      paramSlot("a", "toggles.myFeature"),
    ]);
    expect(findings).toEqual([]);
  });

  it("accepts a visibleWhen gating one param on another", () => {
    const findings = catalog.validateSlots([
      paramSlot("a", "toggles.myFeature"),
      {
        ...(paramSlot("b", "bolster") as BuildParameterSlot),
        visibleWhen: { param: { key: "toggles.myFeature", is: true } },
      },
    ]);
    // Only the "prefer the dedicated toggle leaf" nudge -- nothing structural.
    expect(findings.map((f) => f.level)).toEqual(["warn"]);
  });

  it("resolves a visibleWhen against a param declared later in the list", () => {
    const findings = catalog.validateSlots([
      {
        ...(paramSlot("b", "bolster") as BuildParameterSlot),
        visibleWhen: { param: { key: "myLater", is: true } },
      },
      paramSlot("a", "myLater"),
    ]);
    expect(findings).toEqual([]);
  });

  it("reports a visibleWhen naming a param that does not exist", () => {
    const findings = catalog.validateSlots([
      {
        ...(paramSlot("a", "bolster") as BuildParameterSlot),
        visibleWhen: { param: { key: "nope", is: true } },
      },
    ]);
    expect(
      findings.some((f) => /is not a build_parameter's path/.test(f.message)),
    ).toBe(true);
  });

  it("reports a visibleWhen reading the slot's own path", () => {
    const findings = catalog.validateSlots([
      {
        ...(paramSlot("a", "bolster") as BuildParameterSlot),
        visibleWhen: { param: { key: "bolster", is: true } },
      },
    ]);
    expect(findings.some((f) => /reads its own path/.test(f.message))).toBe(
      true,
    );
  });

  it("reports a self-referential visibleWhen through a dedicated leaf", () => {
    const findings = catalog.validateSlots([
      {
        ...(paramSlot("a", "toggles.combat") as BuildParameterSlot),
        visibleWhen: { not: { toggle: "combat" } },
      },
    ]);
    expect(findings.some((f) => /reads its own path/.test(f.message))).toBe(
      true,
    );
  });

  it("reports a self-referential visibleWhen nested inside a combinator", () => {
    const findings = catalog.validateSlots([
      {
        ...(paramSlot("a", "bolster") as BuildParameterSlot),
        visibleWhen: {
          any: [
            { equipped: { tag: "paragon" } },
            { all: [{ param: { key: "bolster", is: true } }] },
          ],
        },
      },
    ]);
    expect(findings.some((f) => /reads its own path/.test(f.message))).toBe(
      true,
    );
  });

  it("accepts a well-formed item_picker slot using filter", () => {
    const findings = catalog.validateSlots([
      {
        id: "gear.head",
        label: "Head",
        section: "gear",
        type: "item_picker",
        filter: "gear_head",
      },
    ]);
    expect(findings).toEqual([]);
  });

  it("accepts a well-formed item_picker slot using tags", () => {
    const findings = catalog.validateSlots([
      {
        id: "companions.offense",
        label: "Offense",
        section: "companions",
        type: "item_picker",
        tags: ["companion_power:offense"],
      },
    ]);
    expect(findings).toEqual([]);
  });

  it("reports an item_picker slot with neither filter nor tags", () => {
    const findings = catalog.validateSlots([
      {
        id: "a",
        label: "a",
        section: "gear",
        type: "item_picker",
      },
    ]);
    expect(
      findings.some((f) => /neither a filter nor tags/.test(f.message)),
    ).toBe(true);
  });

  it("reports an item_picker slot with both filter and tags", () => {
    const findings = catalog.validateSlots([
      {
        id: "a",
        label: "a",
        section: "gear",
        type: "item_picker",
        filter: "gear_head",
        tags: ["gear:head"],
      },
    ]);
    expect(findings.some((f) => /both a filter and tags/.test(f.message))).toBe(
      true,
    );
  });

  it("accepts a well-formed point_assignment slot", () => {
    const findings = catalog.validateSlots([
      pointAssignmentSlot("boons.tier1", "boon_tier1"),
    ]);
    expect(findings).toEqual([]);
  });

  it("reports a point_assignment slot with no filter", () => {
    const findings = catalog.validateSlots([pointAssignmentSlot("a", "")]);
    expect(findings.some((f) => /no filter/.test(f.message))).toBe(true);
  });
});

describe("catalog.validatePresets", () => {
  const slots: Slot[] = [
    paramSlot("options.role", "role"),
    {
      id: "gear.head",
      label: "Head",
      section: "gear",
      type: "item_picker",
      filter: "gear_head",
    },
    pointAssignmentSlot("boons.tier1", "boon_tier1"),
  ];

  const preset = (fields: Partial<SectionPreset>): SectionPreset => ({
    id: "test-preset",
    label: "Test",
    section: "options",
    ...fields,
  });

  it("the shipped slots.json presets are all well-formed", () => {
    expect(
      catalog.validatePresets(NW_SLOTS.presets ?? [], NW_SLOTS.slots),
    ).toEqual([]);
  });

  it("accepts a well-formed preset touching every field", () => {
    const findings = catalog.validatePresets(
      [
        preset({ section: "options", params: { "options.role": "dps" } }),
        preset({
          id: "gear-preset",
          section: "gear",
          choices: { "gear.head": "some-item" },
          values: { "gear.head": { power: 500 } },
        }),
        preset({
          id: "boons-preset",
          section: "boons",
          assignments: { "boons.tier1": { "some-boon": 2 } },
        }),
      ],
      slots,
    );
    expect(findings).toEqual([]);
  });

  it("reports a reference to an unknown slot id", () => {
    const findings = catalog.validatePresets(
      [preset({ params: { "options.nope": "x" } })],
      slots,
    );
    expect(findings.some((f) => /not a known slot/.test(f.message))).toBe(true);
  });

  it("reports a field targeting the wrong slot type", () => {
    const findings = catalog.validatePresets(
      [preset({ choices: { "options.role": "x" } })],
      slots,
    );
    expect(
      findings.some((f) =>
        /is a build_parameter slot.*item_picker/.test(f.message),
      ),
    ).toBe(true);
  });

  it("reports a slot belonging to a different section", () => {
    const findings = catalog.validatePresets(
      [preset({ section: "options", choices: { "gear.head": "x" } })],
      slots,
    );
    expect(
      findings.some((f) => /belongs to section "gear"/.test(f.message)),
    ).toBe(true);
  });

  it("reports a duplicate preset id", () => {
    const findings = catalog.validatePresets(
      [
        preset({ params: { "options.role": "dps" } }),
        preset({ params: { "options.role": "tank" } }),
      ],
      slots,
    );
    expect(findings.some((f) => /defined more than once/.test(f.message))).toBe(
      true,
    );
  });
});

describe("catalog.validate (class lookup after path trim)", () => {
  it("still finds allowedClass values through the class slot", () => {
    const findings = catalog.validate(
      [
        {
          id: "test-item",
          name: "Test Item",
          filter: "gear_head",
          allowedClass: ["not-a-class"],
        },
      ],
      [],
    );
    expect(
      findings.some(
        (f) => f.name === "test-item" && /allowedClass/.test(f.message),
      ),
    ).toBe(true);
  });
});

describe("catalog.validate: defaultParams lint", () => {
  it("reports a defaultParams key that is not a build_parameter slot id", () => {
    const findings = catalog.validate(
      [
        {
          id: "test-item",
          name: "Test Item",
          filter: "paragon",
          defaultParams: { "not-a-slot": "dps" },
        },
      ],
      [],
    );
    expect(
      findings.some(
        (f) =>
          f.name === "test-item" &&
          /not a build_parameter slot/.test(f.message),
      ),
    ).toBe(true);
  });

  it("reports a defaultParams value that is not one of its slot's options", () => {
    const findings = catalog.validate(
      [
        {
          id: "test-item",
          name: "Test Item",
          filter: "paragon",
          defaultParams: { "options.role": "not-a-role" },
        },
      ],
      [],
    );
    expect(
      findings.some(
        (f) =>
          f.name === "test-item" && /not one of its options/.test(f.message),
      ),
    ).toBe(true);
  });

  it("the shipped Hellbringer paragon's defaultParams pass validation", () => {
    const findings = catalog.validate(NW_ITEMS, NW_BONUSES);
    expect(
      findings.some(
        (f) =>
          f.name === "paragon-hellbringer" && /defaultParams/.test(f.message),
      ),
    ).toBe(false);
  });
});

describe("catalog.validate: item id lint", () => {
  it("reports a missing id, naming the item by its display name", () => {
    const findings = catalog.validate(
      [{ name: "No Id", filter: "gear_head" }] as unknown as Item[],
      [],
    );
    expect(
      findings.some((f) => f.name === "No Id" && /no id/.test(f.message)),
    ).toBe(true);
  });

  it("reports a duplicate id, but not a duplicate name", () => {
    const items = [
      { id: "dup", name: "Item A", filter: "gear_head" },
      { id: "dup", name: "Item B", filter: "gear_head" },
    ];
    const findings = catalog.validate(items, []);
    expect(findings.some((f) => /duplicate item id/.test(f.message))).toBe(
      true,
    );
    expect(findings.some((f) => /duplicate.*name/i.test(f.message))).toBe(
      false,
    );
  });

  it("two items sharing a display name are both clean otherwise", () => {
    const items = [
      { id: "ring-a", name: "Ring", filter: "gear_ring" },
      { id: "ring-b", name: "Ring", filter: "gear_ring" },
    ];
    // Scoped to these two items -- validate() also lints the real shipped NW_SLOTS (e.g.
    // linkedItem references), which this synthetic two-item catalogue can never satisfy.
    const findings = catalog
      .validate(items, [])
      .filter((f) => f.name === "ring-a" || f.name === "ring-b");
    expect(findings).toEqual([]);
  });
});

describe("catalog.validate: item shortDescription/longDescription", () => {
  it("does not flag shortDescription/longDescription as an unknown field", () => {
    const items = [
      {
        id: "cindersilk-hood",
        name: "Cindersilk Hood",
        filter: "gear_head",
        shortDescription: "AP when killing mobs",
        longDescription: "When you kill an enemy, gain 3% Action Points.",
      },
    ];
    const findings = catalog
      .validate(items, [])
      .filter((f) => f.name === "cindersilk-hood");
    expect(findings).toEqual([]);
  });
});

describe("catalog.validate: gameIds lint", () => {
  it("does not flag a well-formed gameIds list", () => {
    const items = [
      {
        id: "some-item",
        name: "Some Item",
        filter: "gear_head",
        gameIds: ["Head_Heavyheal_Test"],
      },
    ];
    const findings = catalog
      .validate(items, [])
      .filter((f) => f.name === "some-item");
    expect(findings).toEqual([]);
  });

  it("does not flag gameIds as an unknown field", () => {
    const items = [
      {
        id: "some-item",
        name: "Some Item",
        filter: "gear_head",
        gameIds: ["Some_Gid"],
      },
    ];
    const findings = catalog
      .validate(items, [])
      .filter((f) => /neither a stat nor an item field/.test(f.message));
    expect(findings).toEqual([]);
  });

  it("reports a non-string / empty gameIds entry as an error", () => {
    const items = [
      {
        id: "bad-item",
        name: "Bad Item",
        filter: "gear_head",
        gameIds: ["", 5 as unknown as string],
      },
    ];
    const findings = catalog.validate(items, []);
    const own = findings.filter((f) => f.name === "bad-item");
    expect(own).toHaveLength(2);
    expect(own.every((f) => f.level === "error")).toBe(true);
    expect(own.every((f) => /not a non-empty string/.test(f.message))).toBe(
      true,
    );
  });

  it("warns on a duplicate entry within one item's own gameIds", () => {
    const items = [
      {
        id: "dup-item",
        name: "Dup Item",
        filter: "gear_head",
        gameIds: ["Same_Gid", "Same_Gid"],
      },
    ];
    const finding = catalog
      .validate(items, [])
      .find((f) => f.name === "dup-item");
    expect(finding?.level).toBe("warn");
    expect(finding?.message).toMatch(/duplicate entry/);
  });

  it("errors when two items of the same filter claim one game id, naming both", () => {
    const items = [
      {
        id: "item-a",
        name: "Item A",
        filter: "gear_head",
        gameIds: ["Shared_Gid"],
      },
      {
        id: "item-b",
        name: "Item B",
        filter: "gear_head",
        gameIds: ["Shared_Gid"],
      },
    ];
    const finding = catalog
      .validate(items, [])
      .find((f) => /claimed by multiple/.test(f.message));
    expect(finding?.level).toBe("error");
    expect(finding?.message).toContain("item-a");
    expect(finding?.message).toContain("item-b");
  });

  it("allows one game id across items of different filters -- an enchantment's slot forms", () => {
    // One in-game Celestial Garnet, three catalogue entries; the importer tells them apart by
    // which slot accepts which, so this is legitimate data, not an ambiguity.
    const items = [
      {
        id: "garnet-power",
        name: "Celestial Garnet",
        filter: "enchantment_offense",
        gameIds: ["Enchantment_Standard_D_V2_R6_Account"],
      },
      {
        id: "garnet-defense",
        name: "Celestial Garnet",
        filter: "enchantment_defense",
        gameIds: ["Enchantment_Standard_D_V2_R6_Account"],
      },
      {
        id: "garnet-forte",
        name: "Celestial Garnet",
        filter: "enchantment_utility",
        gameIds: ["Enchantment_Standard_D_V2_R6_Account"],
      },
    ];
    expect(
      catalog
        .validate(items, [])
        .some((f) => /claimed by multiple/.test(f.message)),
    ).toBe(false);
  });

  it("still errors on the third same-filter claimant among otherwise legitimate forms", () => {
    const items = [
      {
        id: "garnet-power",
        name: "Celestial Garnet",
        filter: "enchantment_offense",
        gameIds: ["Shared_Gid"],
      },
      {
        id: "garnet-defense",
        name: "Celestial Garnet",
        filter: "enchantment_defense",
        gameIds: ["Shared_Gid"],
      },
      {
        id: "garnet-defense-copy",
        name: "Celestial Garnet (copy)",
        filter: "enchantment_defense",
        gameIds: ["Shared_Gid"],
      },
    ];
    const findings = catalog
      .validate(items, [])
      .filter((f) => /claimed by multiple/.test(f.message));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("garnet-defense");
    expect(findings[0].message).toContain("garnet-defense-copy");
    expect(findings[0].message).not.toContain("garnet-power");
  });

  it("the same item listing one game id twice is not also reported as a cross-item conflict", () => {
    const items = [
      {
        id: "dup-item",
        name: "Dup Item",
        filter: "gear_head",
        gameIds: ["Same_Gid", "Same_Gid"],
      },
    ];
    const findings = catalog.validate(items, []);
    expect(findings.some((f) => /claimed by multiple/.test(f.message))).toBe(
      false,
    );
  });
});

describe("catalog.validate: point_assignment-referenced items", () => {
  it("carries a point_assignment slot's own filter, resolved as a row via that filter", () => {
    const item = NW_ITEMS.find((i) => i.id === "boon-tier1-power");
    expect(item?.filter).toBe("boon_tier1");
    // Bounds themselves are game data, free to tune -- only the shape matters here.
    expect(item?.inlineRepetition?.min).toBeTypeOf("number");
    expect(item?.inlineRepetition?.max).toBeTypeOf("number");
    expect(item?.inlineRepetition?.default).toBeTypeOf("number");
  });

  it("a point_assignment slot's filter passes the 'matches no slot' check", () => {
    const findings = catalog.validate(NW_ITEMS, NW_BONUSES);
    expect(
      findings.some(
        (f) =>
          f.name === "boon-tier1-power" &&
          /no filter|matches no slot/.test(f.message),
      ),
    ).toBe(false);
  });

  it("an item with no filter at all is still an error, same as any other item", () => {
    const items = [{ id: "orphan", name: "Orphan", filter: "" }];
    const findings = catalog.validate(items, []);
    expect(findings.some((f) => /no filter/.test(f.message))).toBe(true);
  });

  it("the shipped 'boon_tier1' filter is not also claimed by an item_picker slot", () => {
    // validate()'s ambiguous-filter check reads NW_SLOTS directly (not a parameter), so this
    // documents the invariant it depends on rather than exercising the check with a synthetic
    // slot list.
    expect(
      NW_SLOTS.slots.some(
        (s) => s.type === "item_picker" && s.filter === "boon_tier1",
      ),
    ).toBe(false);
  });

  it("an item's inlineRepetition default outside its own min/max is an error", () => {
    const items: Item[] = [
      {
        id: "bad-boon",
        name: "Bad Boon",
        filter: "boon_tier1",
        inlineRepetition: { min: 1, max: 4, default: 0 },
      },
    ];
    const findings = catalog.validate(items, []);
    expect(
      findings.some(
        (f) => f.name === "bad-boon" && /is outside/.test(f.message),
      ),
    ).toBe(true);
  });

  it("a point_assignment filter with no inlineRepetition config on the item is a warning", () => {
    const items: Item[] = [
      {
        id: "unconfigured-boon",
        name: "Unconfigured Boon",
        filter: "boon_tier1",
      },
    ];
    const findings = catalog.validate(items, []);
    const finding = findings.find((f) => f.name === "unconfigured-boon");
    expect(finding?.level).toBe("warn");
    expect(finding?.message).toMatch(/no inlineRepetition config/);
  });
});

describe("catalog.validate: BonusOccurrenceConfig attachments", () => {
  it("a well-formed occurrence config attached to a real bonus passes clean", () => {
    const items: Item[] = [
      {
        id: "stacking-item",
        name: "Stacking Item",
        filter: "gear_ring",
        bonuses: [{ bonus: "real-bonus", min: 0, max: 5, default: 0 }],
      },
    ];
    const bonuses: Bonus[] = [{ id: "real-bonus", grants: [] }];
    const findings = catalog.validate(items, bonuses);
    expect(findings.filter((f) => f.name === "stacking-item")).toEqual([]);
  });

  it("an occurrence config referencing an undefined bonus is a warning, same as a bare id would be", () => {
    const items: Item[] = [
      {
        id: "orphan-attachment",
        name: "Orphan Attachment",
        filter: "gear_ring",
        bonuses: [{ bonus: "no-such-bonus", min: 0, max: 5, default: 0 }],
      },
    ];
    const findings = catalog.validate(items, []);
    const finding = findings.find((f) => f.name === "orphan-attachment");
    expect(finding?.level).toBe("warn");
    expect(finding?.message).toMatch(/no-such-bonus.*has no definition/);
  });

  it("an occurrence config's default outside its own min/max is an error", () => {
    const items: Item[] = [
      {
        id: "bad-occurrence",
        name: "Bad Occurrence",
        filter: "gear_ring",
        bonuses: [{ bonus: "real-bonus", min: 1, max: 4, default: 0 }],
      },
    ];
    const bonuses: Bonus[] = [{ id: "real-bonus", grants: [] }];
    const findings = catalog.validate(items, bonuses);
    expect(
      findings.some(
        (f) => f.name === "bad-occurrence" && /is outside/.test(f.message),
      ),
    ).toBe(true);
  });

  it("an occurrence config with a non-numeric bound is an error", () => {
    const items: Item[] = [
      {
        id: "bad-shape",
        name: "Bad Shape",
        filter: "gear_ring",
        bonuses: [
          {
            bonus: "real-bonus",
            min: 0,
            max: "five" as unknown as number,
            default: 0,
          },
        ],
      },
    ];
    const bonuses: Bonus[] = [{ id: "real-bonus", grants: [] }];
    const findings = catalog.validate(items, bonuses);
    expect(
      findings.some(
        (f) => f.name === "bad-shape" && /non-numeric/.test(f.message),
      ),
    ).toBe(true);
  });

  it("a well-formed label passes clean (#227)", () => {
    const items: Item[] = [
      {
        id: "labeled-item",
        name: "Labeled Item",
        filter: "gear_ring",
        bonuses: [
          { bonus: "real-bonus", min: 0, max: 5, default: 0, label: "Stacks" },
        ],
      },
    ];
    const bonuses: Bonus[] = [{ id: "real-bonus", grants: [] }];
    const findings = catalog.validate(items, bonuses);
    expect(findings.filter((f) => f.name === "labeled-item")).toEqual([]);
  });

  it("a present but blank label is an error (#227)", () => {
    const items: Item[] = [
      {
        id: "blank-label",
        name: "Blank Label",
        filter: "gear_ring",
        bonuses: [
          { bonus: "real-bonus", min: 0, max: 5, default: 0, label: "   " },
        ],
      },
    ];
    const bonuses: Bonus[] = [{ id: "real-bonus", grants: [] }];
    const findings = catalog.validate(items, bonuses);
    expect(
      findings.some(
        (f) =>
          f.name === "blank-label" && /label.*non-empty string/.test(f.message),
      ),
    ).toBe(true);
  });
});

describe("catalog.validate: filters not meant to be picked directly", () => {
  it("an unrecognized filter still warns 'matches no slot'", () => {
    const items = [{ id: "stray", name: "Stray", filter: "totally_unknown" }];
    const findings = catalog.validate(items, []);
    expect(
      findings.some(
        (f) => f.name === "stray" && /matches no slot/.test(f.message),
      ),
    ).toBe(true);
  });

  it("a filter naming 'build_param' is exempt from the 'matches no slot' warning", () => {
    const items = [
      { id: "param-item", name: "Param Item", filter: "some_build_param_x" },
    ];
    const findings = catalog.validate(items, []);
    expect(findings.some((f) => f.name === "param-item")).toBe(false);
  });

  it("a filter naming 'hidden' is exempt from the 'matches no slot' warning", () => {
    const items = [
      { id: "hidden-item", name: "Hidden Item", filter: "internal_hidden" },
    ];
    const findings = catalog.validate(items, []);
    expect(findings.some((f) => f.name === "hidden-item")).toBe(false);
  });

  it("the 'matches no slot' warning explains the naming convention that silences it", () => {
    const items = [{ id: "stray", name: "Stray", filter: "totally_unknown" }];
    const findings = catalog.validate(items, []);
    const finding = findings.find((f) => f.name === "stray");
    expect(finding?.message).toMatch(/build_param/);
    expect(finding?.message).toMatch(/hidden/);
  });
});

describe("catalog.nextId", () => {
  it("slugifies a name with no existing collision", () => {
    expect(catalog.nextId("Brutality (Pref)", [])).toBe("brutality-pref");
  });

  it("disambiguates against existing ids by appending -2, -3, ...", () => {
    expect(catalog.nextId("Brutality", ["brutality"])).toBe("brutality-2");
    expect(catalog.nextId("Brutality", ["brutality", "brutality-2"])).toBe(
      "brutality-3",
    );
  });

  it("falls back to the given default when the name slugifies to nothing", () => {
    expect(catalog.nextId("!!!", [], "bonus")).toBe("bonus");
  });
});

describe("catalog.compose: layer overlay (two layers, same item id)", () => {
  it("the later overlay wins when both define the same item id", () => {
    const early: CatalogOverlay = {
      items: {
        "shared-item": {
          id: "shared-item",
          name: "Original",
          filter: "gear_head",
        },
      },
      bonuses: {},
      sectionPresets: {},
      slots: {},
    };
    const later: CatalogOverlay = {
      items: {
        "shared-item": {
          id: "shared-item",
          name: "Override",
          filter: "gear_head",
        },
      },
      bonuses: {},
      sectionPresets: {},
      slots: {},
    };
    const composed = catalog.compose([early, later]);
    const item = composed.items.find((i) => i.id === "shared-item");
    expect(item?.name).toBe("Override");
  });

  it("disabling the later overlay makes the earlier one show through", () => {
    const early: CatalogOverlay = {
      items: {
        "shared-item": {
          id: "shared-item",
          name: "Original",
          filter: "gear_head",
        },
      },
      bonuses: {},
      sectionPresets: {},
      slots: {},
    };
    // Disabling the later layer means not passing it to compose
    const composed = catalog.compose([early]);
    const item = composed.items.find((i) => i.id === "shared-item");
    expect(item?.name).toBe("Original");
  });

  it("a tombstone (null) in the later overlay hides the base item", () => {
    const early: CatalogOverlay = {
      items: {
        "shared-item": {
          id: "shared-item",
          name: "Original",
          filter: "gear_head",
        },
      },
      bonuses: {},
      sectionPresets: {},
      slots: {},
    };
    const later: CatalogOverlay = {
      items: { "shared-item": null },
      bonuses: {},
      sectionPresets: {},
      slots: {},
    };
    const composed = catalog.compose([early, later]);
    expect(composed.items.find((i) => i.id === "shared-item")).toBeUndefined();
  });
});

describe("catalog.compose: sectionPresets overlay", () => {
  const presetOverlay = (preset: SectionPreset | null): CatalogOverlay => ({
    items: {},
    bonuses: {},
    sectionPresets: { "test-preset": preset },
    slots: {},
  });

  it("a layer-added preset appears in the composed list", () => {
    const composed = catalog.compose([
      presetOverlay({
        id: "test-preset",
        label: "Test",
        section: "options",
        params: { "options.role": "dps" },
      }),
    ]);
    expect(
      composed.sectionPresets.find((p) => p.id === "test-preset")?.label,
    ).toBe("Test");
  });

  it("a later overlay's edit wins over an earlier one", () => {
    const early = presetOverlay({
      id: "test-preset",
      label: "Original",
      section: "options",
    });
    const later = presetOverlay({
      id: "test-preset",
      label: "Renamed",
      section: "options",
    });
    const composed = catalog.compose([early, later]);
    expect(
      composed.sectionPresets.find((p) => p.id === "test-preset")?.label,
    ).toBe("Renamed");
  });

  it("a tombstone (null) removes the preset from the composed list", () => {
    const added = presetOverlay({
      id: "test-preset",
      label: "Test",
      section: "options",
    });
    const removed = presetOverlay(null);
    const composed = catalog.compose([added, removed]);
    expect(
      composed.sectionPresets.find((p) => p.id === "test-preset"),
    ).toBeUndefined();
  });

  it("a tombstone over a shipped preset hides it, without touching the others", () => {
    const shipped = NW_SLOTS.presets?.[0];
    expect(shipped).toBeDefined();
    const composed = catalog.compose([
      {
        items: {},
        bonuses: {},
        sectionPresets: { [shipped!.id]: null },
        slots: {},
      },
    ]);
    expect(
      composed.sectionPresets.find((p) => p.id === shipped!.id),
    ).toBeUndefined();
    expect(composed.sectionPresets.length).toBe(
      (NW_SLOTS.presets?.length ?? 0) - 1,
    );
  });
});

// The `param` leaf lint. Exercised through `validate()` (not a standalone function) since the
// checks live inside `checkConditions`, keyed on the real slots.json paths -- `class` (list),
// `duration` (number), `toggles.combat` (a toggle slot, boolean).
describe("catalog.validate: param condition lint", () => {
  const bonusWith = (when: ConditionWhen): Bonus[] => [
    { id: "test-bonus", grants: [{ when, stats: {} }] },
  ];
  // Scoped to `kind === "bonus"` so these helpers isolate the condition lint under test
  // from unrelated findings validate() also produces against the real shipped NW_SLOTS (e.g.
  // linkedItem lint, which items=[] can never satisfy).
  const errorsFor = (when: ConditionWhen) =>
    catalog
      .validate([], bonusWith(when))
      .filter((f) => f.level === "error" && f.kind === "bonus");
  const warningsFor = (when: ConditionWhen) =>
    catalog
      .validate([], bonusWith(when))
      .filter((f) => f.level === "warn" && f.kind === "bonus");

  it("an unresolvable key is an error -- the condition can never be active", () => {
    const errors = errorsFor({ param: { key: "does-not-exist", is: true } });
    expect(
      errors.some((f) => /not a build_parameter's path/.test(f.message)),
    ).toBe(true);
  });

  it('an empty "key" is an error', () => {
    const errors = errorsFor({ param: { key: "" } });
    expect(errors.some((f) => /no "key"/.test(f.message))).toBe(true);
  });

  it('a number slot rejects "equals"/"is" and requires atLeast/below', () => {
    const errors = errorsFor({ param: { key: "duration", equals: "30" } });
    expect(errors.some((f) => /is a number/.test(f.message))).toBe(true);
  });

  it('a boolean slot rejects atLeast/below and requires "is"', () => {
    const errors = errorsFor({ param: { key: "m32Forte", atLeast: 1 } });
    expect(errors.some((f) => /is a boolean/.test(f.message))).toBe(true);
  });

  it('a list slot requires "equals"', () => {
    const errors = errorsFor({ param: { key: "role", atLeast: 1 } });
    expect(errors.some((f) => /is a list/.test(f.message))).toBe(true);
  });

  it('a list slot\'s "equals" must be one of its declared options', () => {
    const errors = errorsFor({
      param: { key: "role", equals: "not-a-role" },
    });
    expect(
      errors.some((f) => /not one of its declared options/.test(f.message)),
    ).toBe(true);
  });

  it("a well-formed param condition against a real slot is clean", () => {
    expect(errorsFor({ param: { key: "duration", atLeast: 10 } })).toEqual([]);
  });

  it("warns (not errors) when a param duplicates a dedicated leaf", () => {
    const when = { param: { key: "role", equals: "dps" } };
    expect(errorsFor(when)).toEqual([]);
    expect(
      warningsFor(when).some((f) =>
        /dedicated "role" condition/.test(f.message),
      ),
    ).toBe(true);
  });

  it('warns for a toggle path, pointing at the dedicated "toggle" leaf', () => {
    const warnings = warningsFor({
      param: { key: "toggles.combat", is: true },
    });
    expect(
      warnings.some((f) => /dedicated "toggle" condition/.test(f.message)),
    ).toBe(true);
  });

  it("does not warn for a param with no dedicated leaf (the actual escape-hatch case)", () => {
    // `magnitude` is a real build_parameter slot with no dedicated condition leaf of its own --
    // exactly what `param` exists for.
    const warnings = warningsFor({ param: { key: "magnitude", atLeast: 10 } });
    expect(warnings).toEqual([]);
  });
});

// An item reaches a build through a slot: an `item_picker`'s `filter` or `tags`, or a
// `point_assignment`'s filter. There used to be a fourth way in -- a build_parameter's
// `linkedItem` -- and items reached only that way were exempt from this check. #273 removed
// the mechanism, so the exemption went with it.
describe("catalog.validate: an item in no slot is still flagged", () => {
  it("an item with no filter and no picker tag has no way to be equipped", () => {
    const findings = catalog.validate(
      [{ id: "orphan", name: "Orphan", filter: "" }],
      [],
    );
    expect(
      findings.some((f) => f.name === "orphan" && /no filter/.test(f.message)),
    ).toBe(true);
  });
});

// --- referencedOverlay -------------------------------------------------------------------

/** Build a minimal Db for testing. Only `get`, `bonusById`, `slots` and `authoredSlots` are
 * exercised. The two slot lists are the same here: nothing in these fixtures uses
 * `optionsFrom`, which is the only thing that makes them differ. */
function testDb(items: Item[], bonuses: Bonus[], slots: Slot[] = []): Db {
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const bonusesById = new Map(bonuses.map((s) => [s.id, s]));
  return {
    get: (id: string | null | undefined) => itemsById.get(id ?? "") ?? null,
    bonusById: bonusesById,
    slots,
    authoredSlots: slots,
  } as unknown as Db;
}

/** The first shipped item that attaches a shipped bonus by bare id, with that bonus. */
function shippedItemWithBonus(): { item: Item; bonus: Bonus } {
  for (const item of NW_ITEMS) {
    const attachment = item.bonuses?.[0];
    if (typeof attachment !== "string") continue;
    const bonus = NW_BONUSES.find((b) => b.id === attachment);
    if (bonus) return { item, bonus };
  }
  throw new Error("no shipped item attaches a shipped bonus by id");
}

// A real item that exists in the shipped base catalogue — referencedOverlay should not emit it.
const BASE_ITEM_ID = "1-amethyst-awareness";

/** Cloned out of the shipped list rather than retyped: referencedOverlay diffs against base,
 *  so a hand-copied literal starts being emitted the moment the shipped entry gains a field. */
function shippedItem(id: string): Item {
  const item = NW_ITEMS.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`no shipped item with id ${id}`);
  return structuredClone(item);
}

const baseItem: Item = shippedItem(BASE_ITEM_ID);

const layerItem: Item = {
  id: "layer-item",
  name: "Layer Item",
  filter: "gear_ring",
  bonuses: ["layer-bonus"],
};

const layerBonus: Bonus = {
  id: "layer-bonus",
  grants: [{ stats: { power: 100 } }],
};

const excludedBonus: Bonus = {
  id: "excluded-bonus",
  grants: [{ stats: { power: 50 } }],
};

const chainedBonus: Bonus = {
  id: "chained-bonus",
  grants: [{ stats: { power: 25 } }],
  excludes: ["excluded-bonus"],
};

describe("catalog.referencedOverlay", () => {
  it("is empty for a build of only shipped items", () => {
    const db = testDb([baseItem], []);
    const build: Build = {
      id: "b1",
      name: "Test",
      choices: { gear_head: BASE_ITEM_ID },
      values: {},
      assignments: {},
      occurrenceInputs: {},
      context: {} as Build["context"],
      compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    };
    const overlay = catalog.referencedOverlay(db, build);
    // baseItem matches a real shipped item, so nothing should be emitted
    expect(catalog.isEmpty(overlay)).toBe(true);
  });

  it("picks up a layer-defined item and its bonuses", () => {
    const db = testDb([baseItem, layerItem], [layerBonus]);
    const build: Build = {
      id: "b1",
      name: "Test",
      choices: { gear_head: BASE_ITEM_ID, gear_ring: "layer-item" },
      values: {},
      assignments: {},
      occurrenceInputs: {},
      context: {} as Build["context"],
      compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    };
    // baseItem (BASE_ITEM_ID) is in base, so it should not appear in the overlay.
    // layer-item is NOT in base, so it should appear along with its bonus.
    const overlay = catalog.referencedOverlay(db, build);
    expect(overlay.items["layer-item"]).toBeDefined();
    expect(overlay.items["layer-item"]?.name).toBe("Layer Item");
    expect(overlay.bonuses["layer-bonus"]).toBeDefined();
    // baseItem is in base, so it should NOT be in the overlay
    expect(overlay.items[BASE_ITEM_ID]).toBeUndefined();
  });

  it("includes bonuses reachable through excludes", () => {
    const db = testDb(
      [
        baseItem,
        {
          ...layerItem,
          bonuses: ["chained-bonus"],
          excludes: ["excluded-bonus"],
        },
      ],
      [layerBonus, chainedBonus, excludedBonus],
    );
    const build: Build = {
      id: "b1",
      name: "Test",
      choices: { gear_ring: "layer-item" },
      values: {},
      assignments: {},
      occurrenceInputs: {},
      context: {} as Build["context"],
      compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    };
    // The item has bonuses: ["chained-bonus"] and excludes: ["excluded-bonus"]
    // chained-bonus also excludes excluded-bonus (transitive)
    const overlay = catalog.referencedOverlay(db, build);
    expect(overlay.items["layer-item"]).toBeDefined();
    expect(overlay.bonuses["chained-bonus"]).toBeDefined();
    expect(overlay.bonuses["excluded-bonus"]).toBeDefined();
  });

  it("excludes layer entries the build does not reference", () => {
    const db = testDb([baseItem, layerItem], [layerBonus]);
    const build: Build = {
      id: "b1",
      name: "Test",
      choices: { gear_head: BASE_ITEM_ID },
      values: {},
      assignments: {},
      occurrenceInputs: {},
      context: {} as Build["context"],
      compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    };
    // build only references baseItem, not layerItem
    const overlay = catalog.referencedOverlay(db, build);
    expect(catalog.isEmpty(overlay)).toBe(true);
  });

  it("picks up a base item whose bonus a layer edited", () => {
    // referencedOverlay diffs against the shipped base catalogue, so this case needs a real
    // base item carrying a real base bonus -- picked out of the shipped data rather than
    // hardcoded, so renaming any one entry cannot break the test.
    const shippedPair = shippedItemWithBonus();
    const baseItemWithBonus: Item = structuredClone(shippedPair.item);
    // Layer edits the bonus with different stats.
    const editedBonus: Bonus = {
      ...structuredClone(shippedPair.bonus),
      grants: [{ stats: { power: 999 } }], // different from base
    };
    const db = testDb([baseItemWithBonus], [editedBonus]);
    const build: Build = {
      id: "b1",
      name: "Test",
      choices: { group_buff: baseItemWithBonus.id },
      values: {},
      assignments: {},
      occurrenceInputs: {},
      context: {} as Build["context"],
      compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    };
    const overlay = catalog.referencedOverlay(db, build);
    // The item is unchanged from base, so it should NOT be emitted.
    expect(overlay.items[baseItemWithBonus.id]).toBeUndefined();
    // The bonus IS different from base, so it SHOULD be emitted.
    expect(overlay.bonuses[editedBonus.id]).toBeDefined();
    expect(overlay.bonuses[editedBonus.id]?.grants?.[0]?.stats?.power).toBe(
      999,
    );
  });

  it("does not emit a base item or its bonus when both match base", () => {
    // Use the actual base item without any bonuses — it should emit nothing.
    const db = testDb([baseItem], []);
    const build: Build = {
      id: "b1",
      name: "Test",
      choices: { gear_head: BASE_ITEM_ID },
      values: {},
      assignments: {},
      occurrenceInputs: {},
      context: {} as Build["context"],
      compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    };
    const overlay = catalog.referencedOverlay(db, build);
    expect(catalog.isEmpty(overlay)).toBe(true);
  });

  it("carries a custom build_parameter even though no choice references it", () => {
    const raceSlot: BuildParameterSlot = {
      id: "options.race",
      label: "Race",
      section: "options",
      type: "build_parameter",
      paramType: "list",
      path: "race",
      default: "",
      options: [
        { value: "half-orc", label: "Half-Orc" },
        { value: "elf", label: "Elf" },
      ],
    };
    const db = testDb([baseItem, layerItem], [layerBonus], [raceSlot]);
    const build: Build = {
      id: "b1",
      name: "Test",
      choices: {},
      values: {},
      assignments: {},
      occurrenceInputs: {},
      context: { race: "elf" } as unknown as Build["context"],
      compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    };
    const overlay = catalog.referencedOverlay(db, build);
    // A parameter equips nothing since #273, so nothing rides along on its account -- but the
    // slot itself still travels, since every build_parameter reaches `ctx.params`.
    expect(overlay.items).toEqual({});
    expect(overlay.bonuses).toEqual({});
    // The slot itself still travels -- it is not in base, and every build_parameter reaches
    // `ctx.params` whether or not its current value selects a linked item.
    expect(overlay.slots).toEqual({ "options.race": raceSlot });
  });
});
