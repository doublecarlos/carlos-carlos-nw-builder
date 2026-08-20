// `build_parameter` slots as a fourth CatalogOverlay group (issue #271): composing, editing,
// linting, and -- the half that matters most -- travelling with a downloaded build, so a
// user-defined parameter resolves identically on someone else's machine instead of being
// trapped in the browser that authored it.
import { describe, it, expect } from "vitest";
import * as catalog from "../../src/data/catalog";
import * as bonus from "../../src/engine/bonus";
import { evaluate } from "../../src/engine/conditions";
import { NW_SCHEMA } from "../../src/data/data";
import type {
  Bonus,
  Build,
  BuildParameterSlot,
  CatalogOverlay,
  Db,
  Schema,
  Slot,
} from "../../src/types";

const customParam: BuildParameterSlot = {
  id: "options.bolster",
  label: "Bolster",
  section: "options",
  type: "build_parameter",
  paramType: "percent",
  path: "bolster",
  default: 0.25,
  min: 0,
  max: 1,
};

const overlayWith = (slots: CatalogOverlay["slots"]): CatalogOverlay => ({
  ...catalog.emptyOverlay(),
  slots,
});

/** The first shipped `build_parameter`, picked out of base rather than hardcoded -- these
 * tests are about the overlay mechanism, not about which params happen to ship. */
function shippedParam(): BuildParameterSlot {
  const slot = catalog
    .base()
    .slots.find((s): s is BuildParameterSlot => s.type === "build_parameter");
  if (!slot) throw new Error("no shipped build_parameter slot");
  return slot;
}

function testBuild(context: Record<string, unknown> = {}): Build {
  return {
    id: "b",
    name: "b",
    choices: {},
    values: {},
    assignments: {},
    occurrenceInputs: {},
    context: context as unknown as Build["context"],
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
  };
}

describe("catalog.compose: slots overlay", () => {
  it("adds a slot the base does not have", () => {
    const composed = catalog.compose([
      overlayWith({ [customParam.id]: customParam }),
    ]);
    expect(composed.slots.find((s) => s.id === customParam.id)).toEqual(
      customParam,
    );
  });

  it("replaces a shipped slot in place, keeping its position", () => {
    const shipped = shippedParam();
    const baseIndex = catalog
      .base()
      .slots.findIndex((s) => s.id === shipped.id);
    const edited = { ...shipped, label: "Renamed" };

    const composed = catalog.compose([overlayWith({ [shipped.id]: edited })]);

    expect(composed.slots.findIndex((s) => s.id === shipped.id)).toBe(
      baseIndex,
    );
    expect(composed.slots[baseIndex].label).toBe("Renamed");
  });

  it("a tombstone removes a shipped slot", () => {
    const shipped = shippedParam();
    const composed = catalog.compose([overlayWith({ [shipped.id]: null })]);
    expect(composed.slots.some((s) => s.id === shipped.id)).toBe(false);
  });

  it("later layers win, same as items", () => {
    const early = overlayWith({
      [customParam.id]: { ...customParam, label: "Early" },
    });
    const later = overlayWith({
      [customParam.id]: { ...customParam, label: "Later" },
    });
    const composed = catalog.compose([early, later]);
    expect(composed.slots.find((s) => s.id === customParam.id)?.label).toBe(
      "Later",
    );
  });

  it("keeps base declaration order and appends an added slot at the end", () => {
    // A slot list *is* its render order, so unlike items/bonuses/presets it must not sort
    // by id -- `options.bolster` would otherwise jump ahead of most of the Options section.
    const baseIds = catalog.base().slots.map((s) => s.id);
    const composed = catalog.compose([
      overlayWith({ [customParam.id]: customParam }),
    ]);
    expect(composed.slots.map((s) => s.id)).toEqual([
      ...baseIds,
      customParam.id,
    ]);
  });
});

describe("catalog overlay editing: the slots group", () => {
  it("statusOf reports added / edited / removed", () => {
    const shipped = shippedParam();
    const empty = catalog.emptyOverlay();

    expect(catalog.statusOf(empty, "slots", shipped.id)).toBe("base");
    expect(
      catalog.statusOf(
        catalog.upsert(empty, "slots", customParam.id, customParam),
        "slots",
        customParam.id,
      ),
    ).toBe("added");
    expect(
      catalog.statusOf(
        catalog.upsert(empty, "slots", shipped.id, {
          ...shipped,
          label: "x",
        }),
        "slots",
        shipped.id,
      ),
    ).toBe("edited");
    expect(
      catalog.statusOf(
        catalog.remove(empty, "slots", shipped.id),
        "slots",
        shipped.id,
      ),
    ).toBe("removed");
  });

  it("remove tombstones a shipped slot but drops an added one outright", () => {
    const shipped = shippedParam();
    const withBoth = catalog.upsert(
      catalog.upsert(
        catalog.emptyOverlay(),
        "slots",
        customParam.id,
        customParam,
      ),
      "slots",
      shipped.id,
      { ...shipped, label: "x" },
    );

    expect(
      catalog.remove(withBoth, "slots", shipped.id).slots[shipped.id],
    ).toBe(null);
    expect(
      customParam.id in catalog.remove(withBoth, "slots", customParam.id).slots,
    ).toBe(false);
  });

  it("revert forgets an override so the shipped slot shows through again", () => {
    const shipped = shippedParam();
    const edited = catalog.upsert(catalog.emptyOverlay(), "slots", shipped.id, {
      ...shipped,
      label: "Renamed",
    });
    const reverted = catalog.revert(edited, "slots", shipped.id);

    expect(catalog.isEmpty(reverted)).toBe(true);
    expect(
      catalog.compose([reverted]).slots.find((s) => s.id === shipped.id),
    ).toEqual(shipped);
  });

  it("isEmpty counts the slots group", () => {
    expect(
      catalog.isEmpty(overlayWith({ [customParam.id]: customParam })),
    ).toBe(false);
  });

  it("normaliseOverlay fills in slots for an overlay saved before they existed", () => {
    const legacy = { items: {}, bonuses: {}, sectionPresets: {} };
    expect(catalog.normaliseOverlay(legacy).slots).toEqual({});
  });

  it("normaliseOverlay keeps a slot entry and its tombstone", () => {
    const normalised = catalog.normaliseOverlay({
      slots: { [customParam.id]: customParam, "options.gone": null },
    });
    expect(normalised.slots[customParam.id]).toEqual(customParam);
    expect(normalised.slots["options.gone"]).toBe(null);
  });
});

describe("catalog.nextSlotId", () => {
  it("namespaces a new slot's id by its section, unlike an item's", () => {
    expect(catalog.nextSlotId("options", "My Bolster", [])).toBe(
      "options.my-bolster",
    );
  });

  it("disambiguates against the prefixed form, which is what has to be unique", () => {
    expect(catalog.nextSlotId("options", "Bolster", ["options.bolster"])).toBe(
      "options.bolster-2",
    );
    // A collision on the bare slug is not a collision at all.
    expect(catalog.nextSlotId("options", "Bolster", ["bolster"])).toBe(
      "options.bolster",
    );
  });
});

describe("makeDb with an overlay-added parameter", () => {
  it("exposes it in db.slots and db.slotById", () => {
    const db = catalog.makeDb([overlayWith({ [customParam.id]: customParam })]);
    expect(db.slotById.get(customParam.id)).toEqual(customParam);
  });

  it("reaches ctx.params at its default, so a bonus can gate on it immediately", () => {
    // The point of the whole issue: define a param in a layer, gate a bonus on it, and the
    // engine resolves it with no seeding step. `defaultBuild` only seeds from base, so the
    // build's own `context` is empty here on purpose.
    const db = catalog.makeDb([overlayWith({ [customParam.id]: customParam })]);
    const { ctx } = bonus.collect(db, testBuild());

    expect(ctx.params.get("bolster")).toBe(0.25);
    expect(evaluate({ param: { key: "bolster", atLeast: 0.25 } }, ctx)).toBe(
      true,
    );
    expect(evaluate({ param: { key: "bolster", atLeast: 0.5 } }, ctx)).toBe(
      false,
    );
  });

  it("a stored value overrides the default", () => {
    const db = catalog.makeDb([overlayWith({ [customParam.id]: customParam })]);
    const { ctx } = bonus.collect(db, testBuild({ bolster: 0.9 }));
    expect(ctx.params.get("bolster")).toBe(0.9);
  });

  it("a tombstoned shipped param leaves its key unresolvable, so conditions fail closed", () => {
    const shipped = shippedParam();
    const db = catalog.makeDb([overlayWith({ [shipped.id]: null })]);
    const { ctx } = bonus.collect(db, testBuild());
    expect(ctx.params.has(shipped.path)).toBe(false);
  });
});

describe("catalog.referencedOverlay: slots travel with a build", () => {
  /** Minimal Db -- `referencedOverlay` only reaches for `get`, `bonusById` and the slot
   * lists, and reads the *authored* one so a derived option set is never frozen into a
   * download. Nothing here uses `optionsFrom`, so the two lists are the same. */
  const testDb = (slots: Slot[]): Db =>
    ({
      get: () => null,
      bonusById: new Map(),
      slots,
      authoredSlots: slots,
    }) as unknown as Db;

  it("carries an overlay-added param even though no choice references it", () => {
    const overlay = catalog.referencedOverlay(
      testDb([...catalog.base().slots, customParam]),
      testBuild(),
    );
    expect(overlay.slots).toEqual({ [customParam.id]: customParam });
  });

  it("carries an edited shipped param, but not the untouched ones", () => {
    const shipped = shippedParam();
    const edited = { ...shipped, label: "Renamed" };
    const slots = catalog
      .base()
      .slots.map((slot) => (slot.id === shipped.id ? edited : slot));

    const overlay = catalog.referencedOverlay(testDb(slots), testBuild());
    expect(overlay.slots).toEqual({ [shipped.id]: edited });
  });

  it("emits nothing when every param is exactly what shipped", () => {
    const overlay = catalog.referencedOverlay(
      testDb(catalog.base().slots),
      testBuild(),
    );
    expect(overlay.slots).toEqual({});
  });
});

describe("catalog.validateParamSchema", () => {
  const schema: Schema = { ...NW_SCHEMA, roles: { dps: NW_SCHEMA.roles.dps } };

  const listParam = (path: string, values: string[]): Slot => ({
    id: `options.${path}`,
    label: path,
    section: "options",
    type: "build_parameter",
    paramType: "list",
    path,
    default: "",
    options: values.map((value) => ({ value, label: value })),
  });

  it("accepts a role option the schema knows", () => {
    expect(
      catalog.validateParamSchema([listParam("role", ["dps"])], schema),
    ).toEqual([]);
  });

  it("rejects a role option the schema does not know", () => {
    const findings = catalog.validateParamSchema(
      [listParam("role", ["dps", "bard-support"])],
      schema,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].level).toBe("error");
    expect(findings[0].kind).toBe("slot");
    expect(findings[0].message).toMatch(/not a role in schema\.roles/);
  });

  it("rejects a forte option that is not a real stat key", () => {
    const findings = catalog.validateParamSchema(
      [listParam("forte.primary", ["power_p", "not_a_stat"])],
      schema,
    );
    expect(findings.map((f) => f.message)).toEqual([
      expect.stringMatching(/"not_a_stat" is not a stat key/),
    ]);
  });

  it('always allows the empty "— none —" option every one of these slots carries', () => {
    expect(
      catalog.validateParamSchema([listParam("role", ["", "dps"])], schema),
    ).toEqual([]);
  });

  it("leaves a param the schema has no say over alone", () => {
    expect(
      catalog.validateParamSchema([listParam("myThing", ["whatever"])], schema),
    ).toEqual([]);
  });
});

describe("catalog.validateParamReaders", () => {
  const shipped = shippedParam();
  const reader: Bonus = {
    id: "reads-it",
    name: "Reads it",
    grants: [{ when: { param: { key: shipped.path, is: true } }, stats: {} }],
  };

  it("warns when a shipped param a bonus gates on has been removed", () => {
    const remaining = catalog.base().slots.filter((s) => s.id !== shipped.id);
    const findings = catalog.validateParamReaders(remaining, [reader]);

    expect(findings).toHaveLength(1);
    expect(findings[0].level).toBe("warn");
    expect(findings[0].name).toBe("reads-it");
    expect(findings[0].message).toMatch(/fails closed/);
  });

  it("says nothing while the param is still there", () => {
    expect(
      catalog.validateParamReaders(catalog.base().slots, [reader]),
    ).toEqual([]);
  });

  it("only flags the bonuses that actually read the removed path", () => {
    const remaining = catalog.base().slots.filter((s) => s.id !== shipped.id);
    const unrelated: Bonus = {
      id: "unrelated",
      grants: [{ when: { toggle: "combat" }, stats: {} }],
    };
    const findings = catalog.validateParamReaders(remaining, [
      reader,
      unrelated,
    ]);
    expect(findings.map((f) => f.name)).toEqual(["reads-it"]);
  });
});
