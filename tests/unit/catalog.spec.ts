// catalog.ts's `validateSlots`: a duplicate path, or one shadowing a BuildContext field, would
// otherwise silently corrupt engine state (setPath clobbering `context.forte`/`context.toggles`
// wholesale, or two slots fighting over one value).
import { describe, it, expect } from "vitest";
import * as catalog from "../../src/catalog";
import { NW_SLOTS } from "../../src/data";
import type { BonusSet, ConditionWhen, Item, Slot } from "../../src/types";

const paramSlot = (id: string, path: string): Slot => ({
  id,
  label: id,
  section: "options",
  type: "build_parameter",
  paramType: "boolean",
  path,
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

  it("item_picker slots are ignored entirely (no path to check)", () => {
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
    expect(catalog.validate(items, [])).toEqual([]);
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
    expect(catalog.nextId("!!!", [], "bonus-set")).toBe("bonus-set");
  });
});

// The `param` leaf lint. Exercised through `validate()` (not a standalone function) since the
// checks live inside `checkConditions`, keyed on the real slots.json paths -- `class` (list),
// `duration` (number), `toggles.combat` (a toggle slot, boolean).
describe("catalog.validate: param condition lint", () => {
  const setWith = (when: ConditionWhen): BonusSet[] => [
    { id: "test-set", grants: [{ when, stats: {} }] },
  ];
  const errorsFor = (when: ConditionWhen) =>
    catalog.validate([], setWith(when)).filter((f) => f.level === "error");
  const warningsFor = (when: ConditionWhen) =>
    catalog.validate([], setWith(when)).filter((f) => f.level === "warn");

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
    const errors = errorsFor({ param: { key: "class", atLeast: 1 } });
    expect(errors.some((f) => /is a list/.test(f.message))).toBe(true);
  });

  it('a list slot\'s "equals" must be one of its declared options', () => {
    const errors = errorsFor({
      param: { key: "class", equals: "not-a-class" },
    });
    expect(
      errors.some((f) => /not one of its declared options/.test(f.message)),
    ).toBe(true);
  });

  it("a well-formed param condition against a real slot is clean", () => {
    expect(errorsFor({ param: { key: "duration", atLeast: 10 } })).toEqual([]);
  });

  it("warns (not errors) when a param duplicates a dedicated leaf", () => {
    const when = { param: { key: "class", equals: "warlock" } };
    expect(errorsFor(when)).toEqual([]);
    expect(
      warningsFor(when).some((f) =>
        /dedicated "class" condition/.test(f.message),
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
