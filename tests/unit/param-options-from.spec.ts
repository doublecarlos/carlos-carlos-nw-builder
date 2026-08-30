// `optionsFrom` (issue #272): a `list` build_parameter derives its option set from the item
// catalogue instead of enumerating it inline, so "add a value" becomes "add an item" and
// happens entirely in the item editor -- including for items an overlay added.
import { describe, it, expect } from "vitest";
import * as catalog from "../../src/data/catalog";
import * as db from "../../src/data/db";
import { optionsFromItems, resolvedOptions } from "../../src/lib/param-options";
import { NW_SCHEMA } from "../../src/data/data";
import type {
  BuildParameterSlot,
  CatalogOverlay,
  Item,
  Slot,
  SlotsData,
} from "../../src/types";

const items: Item[] = [
  { id: "cls-wizard", name: "Wizard", filter: "cls", tags: ["cls"] },
  { id: "cls-bard", name: "Bard", filter: "cls", tags: ["cls"] },
  { id: "cls-archer", name: "Archer", filter: "cls", tags: ["cls"] },
  {
    id: "cls-secret",
    name: "Secret",
    filter: "cls",
    tags: ["cls"],
    hideFromPicker: true,
  },
  { id: "not-a-class", name: "Sword", filter: "gear_weapon", tags: ["gear"] },
];

const derivedSlot: BuildParameterSlot = {
  id: "options.cls",
  label: "Class",
  section: "options",
  type: "build_parameter",
  paramType: "list",
  path: "cls",
  default: "",
  optionsFrom: { tags: ["cls"] },
};

const slotsData = (slots: Slot[]): SlotsData => ({
  sections: [{ id: "options", label: "Options" }],
  slots,
  presets: [],
});

describe("optionsFromItems", () => {
  it("selects by tag, in name order", () => {
    expect(optionsFromItems({ tags: ["cls"] }, items).map((i) => i.id)).toEqual(
      ["cls-archer", "cls-bard", "cls-wizard"],
    );
  });

  it("selects by filter as the alternative to tags", () => {
    expect(
      optionsFromItems({ filter: "gear_weapon" }, items).map((i) => i.id),
    ).toEqual(["not-a-class"]);
  });

  it("unions across several tags without duplicating an item carrying both", () => {
    const both: Item[] = [
      { id: "a", name: "A", filter: "x", tags: ["one", "two"] },
      { id: "b", name: "B", filter: "x", tags: ["two"] },
    ];
    expect(
      optionsFromItems({ tags: ["one", "two"] }, both).map((i) => i.id),
    ).toEqual(["a", "b"]);
  });

  it("leaves out hideFromPicker items, same as a picker does", () => {
    expect(
      optionsFromItems({ tags: ["cls"] }, items).some(
        (i) => i.id === "cls-secret",
      ),
    ).toBe(false);
  });
});

describe("resolvedOptions", () => {
  it("takes its value from the item id and its label from the item name", () => {
    expect(resolvedOptions(derivedSlot, items)).toEqual([
      { value: "cls-archer", label: "Archer" },
      { value: "cls-bard", label: "Bard" },
      { value: "cls-wizard", label: "Wizard" },
    ]);
  });

  it("prepends the empty row only when the slot asks for it", () => {
    const withEmpty = resolvedOptions(
      { ...derivedSlot, allowEmpty: true },
      items,
    );
    expect(withEmpty?.[0]).toEqual({ value: "", label: "- none -" });
    expect(resolvedOptions(derivedSlot, items)?.[0].value).toBe("cls-archer");
  });

  it("passes an inline-authored option list straight through", () => {
    const inline: BuildParameterSlot = {
      ...derivedSlot,
      optionsFrom: undefined,
      options: [{ value: "a", label: "A" }],
    };
    expect(resolvedOptions(inline, items)).toEqual([
      { value: "a", label: "A" },
    ]);
  });
});

describe("db.build resolves optionsFrom", () => {
  const built = db.build(items, [], NW_SCHEMA, slotsData([derivedSlot]));

  it("db.slots carries the resolved options, so no consumer needs to know", () => {
    const slot = built.slotById.get("options.cls") as BuildParameterSlot;
    expect(slot.options?.map((o) => o.label)).toEqual([
      "Archer",
      "Bard",
      "Wizard",
    ]);
  });

  it("db.authoredSlots keeps the pre-resolution form for the write side", () => {
    const authored = built.authoredSlots[0] as BuildParameterSlot;
    expect(authored.options).toBeUndefined();
    expect(authored.optionsFrom).toEqual({ tags: ["cls"] });
  });

  it("an overlay-added item becomes an option with no slot edit at all", () => {
    // The whole point: extending the option set happens in the item editor.
    const overlay: CatalogOverlay = {
      ...catalog.emptyOverlay(),
      items: {
        "cls-custom": {
          id: "cls-custom",
          name: "Aardvark",
          filter: "cls",
          tags: ["cls"],
        },
      },
      slots: { [derivedSlot.id]: derivedSlot },
    };
    const composed = catalog.makeDb([overlay]);
    const slot = composed.slotById.get("options.cls") as BuildParameterSlot;
    // Name order, so a new item lands where its name says rather than at the end.
    expect(slot.options?.[0]).toEqual({
      value: "cls-custom",
      label: "Aardvark",
    });
  });
});

describe("catalog.validateSlots: the optionsFrom rules", () => {
  const withSelector = (
    optionsFrom: BuildParameterSlot["optionsFrom"],
    extra: Partial<BuildParameterSlot> = {},
  ): Slot => ({ ...derivedSlot, optionsFrom, ...extra });

  it("accepts a well-formed tag selector", () => {
    expect(catalog.validateSlots([withSelector({ tags: ["cls"] })])).toEqual(
      [],
    );
  });

  it("accepts a well-formed filter selector", () => {
    expect(catalog.validateSlots([withSelector({ filter: "cls" })])).toEqual(
      [],
    );
  });

  it("rejects a selector with neither filter nor tags", () => {
    const findings = catalog.validateSlots([withSelector({})]);
    expect(
      findings.some((f) => /neither a filter nor tags/.test(f.message)),
    ).toBe(true);
  });

  it("rejects a selector with both", () => {
    const findings = catalog.validateSlots([
      withSelector({ filter: "cls", tags: ["cls"] }),
    ]);
    expect(findings.some((f) => /both a filter and tags/.test(f.message))).toBe(
      true,
    );
  });

  it("rejects a slot declaring both options and optionsFrom", () => {
    const findings = catalog.validateSlots([
      withSelector(
        { tags: ["cls"] },
        { options: [{ value: "a", label: "A" }] },
      ),
    ]);
    expect(
      findings.some((f) => /both options and optionsFrom/.test(f.message)),
    ).toBe(true);
  });

  it("rejects optionsFrom on a param that is not a list", () => {
    const findings = catalog.validateSlots([
      withSelector({ tags: ["cls"] }, { paramType: "number" }),
    ]);
    expect(
      findings.some((f) => /only meaningful on a list param/.test(f.message)),
    ).toBe(true);
  });
});

describe("the allowedClass lint reads resolved options", () => {
  it("validates against a derived class vocabulary, not an empty one", () => {
    const classSlot: Slot = {
      ...derivedSlot,
      id: "options.class",
      path: "class",
      optionsFrom: { tags: ["cls"] },
    };
    const restricted: Item = {
      id: "restricted",
      name: "Restricted",
      filter: "gear_weapon",
      allowedClass: ["cls-bard"],
    };
    const typo: Item = {
      id: "typo",
      name: "Typo",
      filter: "gear_weapon",
      allowedClass: ["cls-bardd"],
    };

    const findings = catalog.validate(
      [...items, restricted, typo],
      [],
      NW_SCHEMA,
      [],
      [classSlot],
    );
    const allowedClassFindings = findings.filter((f) =>
      /allowedClass/.test(f.message),
    );
    expect(allowedClassFindings.map((f) => f.name)).toEqual(["typo"]);
  });
});
