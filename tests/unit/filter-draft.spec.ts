// Coverage for lib/filter-draft.ts. Mainly that `fields` round-trips unchanged, including a
// declaration naming only part of a group.
import { describe, it, expect } from "vitest";
import { nextFilterId } from "../../src/data/catalog";
import {
  buildDraft,
  toFilter,
  diffLabel,
  hasContent,
  FIELD_GROUP_OPTIONS,
} from "../../src/lib/filter-draft";
import { FIELD_GROUPS } from "../../src/lib/item-draft";
import type { FilterDef } from "../../src/types";

const ctx = (id: string) => ({ id });

describe("buildDraft / toFilter round trip", () => {
  it("round-trips a cap-only declaration", () => {
    const filter: FilterDef = { id: "artifact", maxCopies: 1 };
    expect(toFilter(buildDraft(filter), ctx(filter.id))).toEqual(filter);
  });

  it("round-trips a multi-field group", () => {
    const filter: FilterDef = {
      id: "insignia",
      fields: ["insigniaShape", "preferredVariant"],
    };
    expect(buildDraft(filter).groups).toEqual(["insignia"]);
    expect(toFilter(buildDraft(filter), ctx(filter.id))).toEqual(filter);
  });

  it("round-trips a cap and several groups, in FIELD_GROUPS order", () => {
    const filter: FilterDef = {
      id: "paragon",
      maxCopies: 2,
      fields: ["defaultParams", "allowedClass"],
    };
    const draft = buildDraft(filter);
    expect(draft.groups).toEqual(["allowedClass", "defaultParams"]);
    expect(toFilter(draft, ctx(filter.id))).toEqual({
      id: "paragon",
      maxCopies: 2,
      fields: ["allowedClass", "defaultParams"],
    });
  });

  it("writes an explicit 0 cap, and drops an emptied one", () => {
    const draft = buildDraft({ id: "ring", maxCopies: 1 });
    draft.maxCopies = 0;
    expect(toFilter(draft, ctx("ring"))).toEqual({ id: "ring", maxCopies: 0 });
    draft.maxCopies = "";
    expect(toFilter(draft, ctx("ring"))).toEqual({ id: "ring" });
  });

  it("leaves a partly claimed group unchecked and carries the field through", () => {
    const filter: FilterDef = { id: "odd", fields: ["insigniaShape"] };
    const draft = buildDraft(filter);
    expect(draft.groups).toEqual([]);
    expect(draft.otherFields).toEqual(["insigniaShape"]);
    expect(toFilter(draft, ctx(filter.id))).toEqual(filter);
  });

  it("builds an empty draft for a category with no declaration", () => {
    expect(buildDraft(null)).toEqual({
      name: "",
      maxCopies: null,
      groups: [],
      otherFields: [],
    });
  });

  it("ignores a group name outside the vocabulary", () => {
    const draft = buildDraft(null);
    draft.groups = ["tags", "notAGroup"];
    expect(toFilter(draft, ctx("x"))).toEqual({ id: "x", fields: ["tags"] });
  });

  it("offers one checkbox per FIELD_GROUPS entry", () => {
    expect(FIELD_GROUP_OPTIONS.map((option) => option.value).sort()).toEqual(
      Object.keys(FIELD_GROUPS).sort(),
    );
  });
});

describe("nextFilterId", () => {
  it("keeps the snake_case the shipped vocabulary is written in", () => {
    expect(nextFilterId("insignia_bonus", [])).toBe("insignia_bonus");
    expect(nextFilterId("boon_tier1", [])).toBe("boon_tier1");
  });

  it("folds spaces and punctuation into single underscores", () => {
    expect(nextFilterId("  Gear Ring  ", [])).toBe("gear_ring");
    expect(nextFilterId("mount / equip!", [])).toBe("mount_equip");
    expect(nextFilterId("__odd--name__", [])).toBe("odd_name");
  });

  it("falls back when the name carries nothing usable", () => {
    expect(nextFilterId("!!!", [])).toBe("filter");
  });

  it("disambiguates with an underscore suffix", () => {
    expect(nextFilterId("trinket", ["trinket"])).toBe("trinket_2");
    expect(nextFilterId("trinket", ["trinket", "trinket_2"])).toBe("trinket_3");
  });
});

describe("hasContent", () => {
  it("is false for an untouched new draft", () => {
    expect(hasContent(buildDraft(null))).toBe(false);
  });

  it("is true once a name, a cap or a group is set", () => {
    expect(hasContent({ ...buildDraft(null), name: "mount" })).toBe(true);
    expect(hasContent({ ...buildDraft(null), maxCopies: 3 })).toBe(true);
    expect(hasContent({ ...buildDraft(null), groups: ["tags"] })).toBe(true);
  });
});

describe("diffLabel", () => {
  const label = (old: FilterDef, nw: FilterDef) =>
    diffLabel(JSON.stringify(old), JSON.stringify(nw));

  it("names a cap change, and an emptied cap", () => {
    expect(label({ id: "a", maxCopies: 1 }, { id: "a", maxCopies: 2 })).toBe(
      "edit max copies → 2",
    );
    expect(label({ id: "a", maxCopies: 1 }, { id: "a" })).toBe(
      "edit max copies → (none)",
    );
  });

  it("names a field change by count", () => {
    expect(label({ id: "a" }, { id: "a", fields: ["tags"] })).toBe(
      "add field (1)",
    );
    expect(label({ id: "a", fields: ["tags"] }, { id: "a" })).toBe(
      "remove field (1)",
    );
  });

  it("falls back when nothing recognizable changed", () => {
    expect(label({ id: "a" }, { id: "b" })).toBe("edit filter");
  });
});
