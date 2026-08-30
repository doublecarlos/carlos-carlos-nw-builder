// The generic `param` leaf -- one leaf, three mutually exclusive comparison forms, keyed on a
// build_parameter's (context-relative) path.
import { describe, it, expect } from "vitest";
import { evaluate, explain } from "../../src/engine/conditions";
import * as db from "../../src/data/db";
import * as bonus from "../../src/engine/bonus";
import type { EvalContext, SlotsData, Schema, Build } from "../../src/types";

function ctx(
  params: Record<string, string | number | boolean>,
  overrides: Partial<EvalContext> = {},
): EvalContext {
  return {
    duration: 0,
    enemies: 0,
    toggles: {},
    equipped: new Map(),
    tags: new Map(),
    bonusOccurrences: new Map(),
    bonusNames: new Map(),
    params: new Map(Object.entries(params)),
    ...overrides,
  };
}

describe("conditions.ts param leaf", () => {
  it("number form: a half-open atLeast/below range, same as duration", () => {
    const c = ctx({ bolster: 0.5 });
    expect(
      evaluate({ param: { key: "bolster", atLeast: 0.5, below: 1 } }, c),
    ).toBe(true);
    expect(evaluate({ param: { key: "bolster", atLeast: 0.6 } }, c)).toBe(
      false,
    );
    expect(evaluate({ param: { key: "bolster", below: 0.5 } }, c)).toBe(false);
  });

  it('boolean form: strict equality against "is"', () => {
    const c = ctx({ feature: true });
    expect(evaluate({ param: { key: "feature", is: true } }, c)).toBe(true);
    expect(evaluate({ param: { key: "feature", is: false } }, c)).toBe(false);
  });

  it('string form: equals a scalar, or "is one of" an array', () => {
    const c = ctx({ tier: "gold" });
    expect(evaluate({ param: { key: "tier", equals: "gold" } }, c)).toBe(true);
    expect(evaluate({ param: { key: "tier", equals: "silver" } }, c)).toBe(
      false,
    );
    expect(
      evaluate({ param: { key: "tier", equals: ["silver", "gold"] } }, c),
    ).toBe(true);
  });

  it("an unresolvable key fails closed, whatever comparison form is used", () => {
    const c = ctx({ bolster: 0.5 });
    // atLeast: 0 would otherwise be satisfied by the leaf's "missing value" fallback -- this
    // is exactly the trap `.has()` (not a falsy check) guards against.
    expect(evaluate({ param: { key: "does-not-exist", atLeast: 0 } }, c)).toBe(
      false,
    );
    expect(evaluate({ param: { key: "does-not-exist", is: false } }, c)).toBe(
      false,
    );
  });

  it('a param resolving to a falsy value (0/false/"") is not treated as unresolved', () => {
    const c = ctx({ bolster: 0, on: false });
    expect(evaluate({ param: { key: "bolster", atLeast: 0 } }, c)).toBe(true);
    expect(evaluate({ param: { key: "on", is: false } }, c)).toBe(true);
  });

  it("feeds ConditionExplain/unmet, same as every other leaf", () => {
    const c = ctx({ bolster: 0.2 });
    const result = explain({ param: { key: "bolster", atLeast: 0.5 } }, c);
    expect(result.ok).toBe(false);
    expect(result.unmet).toHaveLength(1);
    expect(result.unmet[0].detail).toContain("0.2");
  });

  it("number form: exactly, a single-value alternative to atLeast/below", () => {
    const c = ctx({ bolster: 0.5 });
    expect(evaluate({ param: { key: "bolster", exactly: 0.5 } }, c)).toBe(true);
    expect(evaluate({ param: { key: "bolster", exactly: 0.6 } }, c)).toBe(
      false,
    );
  });
});

// --- bonus.ts's collect(): populating EvalContext.params ------------------------------------

const testSlots: SlotsData = {
  sections: [{ id: "options", label: "Options" }],
  slots: [
    {
      id: "options.bolster",
      label: "Bolster",
      section: "options",
      type: "build_parameter",
      paramType: "percent",
      path: "bolster",
      default: 0.25,
    },
  ],
};
const emptySchema: Schema = {
  stats: [],
  statByKey: {},
  statKeys: [],
  multiplicativeStats: [],
  ratingStats: [],
  abilityStats: [],
  ratingConversion: [],
  abilityContributions: [],
  forteSplit: {},
  roles: {},
  statScalers: [],
};
const testDb = db.build([], [], emptySchema, testSlots);

function testBuild(context: Record<string, unknown>): Build {
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

describe("bonus.ts collect() populates EvalContext.params", () => {
  it("a param the build has never set reads its slot default, not undefined", () => {
    const { ctx: builtCtx } = bonus.collect(testDb, testBuild({}));
    expect(builtCtx.params.get("bolster")).toBe(0.25);
  });

  it("a param the build has set overrides the default", () => {
    const { ctx: builtCtx } = bonus.collect(
      testDb,
      testBuild({ bolster: 0.9 }),
    );
    expect(builtCtx.params.get("bolster")).toBe(0.9);
  });
});

describe("conditions.ts bonusOccurrences leaf uses bonusNames for friendly labels", () => {
  it("shows the bonus name when available in bonusNames", () => {
    const c = ctx(
      {},
      {
        bonusOccurrences: new Map([["m32-impending-doom-celestial", 1]]),
        bonusNames: new Map([
          ["m32-impending-doom-celestial", "Impending Doom"],
        ]),
      },
    );
    const result = explain(
      {
        bonusOccurrences: { bonus: "m32-impending-doom-celestial", atLeast: 2 },
      },
      c,
    );
    expect(result.ok).toBe(false);
    expect(result.unmet[0].label).toBe("2 occurrences of Impending Doom");
  });

  it("falls back to the bonus id when not in bonusNames", () => {
    const c = ctx(
      {},
      {
        bonusOccurrences: new Map([["m32-unknown-bonus", 1]]),
        bonusNames: new Map(),
      },
    );
    const result = explain(
      { bonusOccurrences: { bonus: "m32-unknown-bonus", atLeast: 2 } },
      c,
    );
    expect(result.ok).toBe(false);
    expect(result.unmet[0].label).toBe("2 occurrences of m32-unknown-bonus");
  });
});

describe("conditions.ts equipped/bonusOccurrences leaves support exactly", () => {
  it("equipped: exactly matches only the exact count, not >=1 (regression -- used to ignore exactly entirely)", () => {
    const zero = ctx({}, { tags: new Map() });
    const two = ctx({}, { tags: new Map([["ring_of_x", 2]]) });
    const three = ctx({}, { tags: new Map([["ring_of_x", 3]]) });
    const cond = { equipped: { tag: "ring_of_x", exactly: 2 } };
    expect(evaluate(cond, zero)).toBe(false);
    expect(evaluate(cond, two)).toBe(true);
    expect(evaluate(cond, three)).toBe(false);
  });

  it("equipped: exactly appears in the explain label instead of a stale atLeast default", () => {
    const c = ctx({}, { tags: new Map([["ring_of_x", 1]]) });
    const result = explain({ equipped: { tag: "ring_of_x", exactly: 2 } }, c);
    expect(result.unmet[0].label).toBe("2× ring_of_x");
  });

  it("bonusOccurrences: exactly matches only the exact count", () => {
    const one = ctx({}, { bonusOccurrences: new Map([["b", 1]]) });
    const two = ctx({}, { bonusOccurrences: new Map([["b", 2]]) });
    const cond = { bonusOccurrences: { bonus: "b", exactly: 2 } };
    expect(evaluate(cond, one)).toBe(false);
    expect(evaluate(cond, two)).toBe(true);
  });

  it("bonusOccurrences: exactly appears in the explain label instead of a stale atLeast default", () => {
    const c = ctx({}, { bonusOccurrences: new Map([["b", 1]]) });
    const result = explain({ bonusOccurrences: { bonus: "b", exactly: 3 } }, c);
    expect(result.unmet[0].label).toBe("3 occurrences of b");
  });

  it("bonusOccurrences: counts the noun rather than hedging with occurrence(s)", () => {
    const c = ctx({}, { bonusOccurrences: new Map() });
    const result = explain({ bonusOccurrences: { bonus: "b", atLeast: 1 } }, c);
    expect(result.unmet[0].label).toBe("1 occurrence of b");
  });
});

// Every list-taking leaf matches its list as "one of". Requiring several toggles at once is
// `all`, so the list never has to be read two ways.
describe("conditions.ts toggle leaf", () => {
  it("one name: on when that toggle is on", () => {
    expect(evaluate({ toggle: "party" }, ctx({}, { toggles: {} }))).toBe(false);
    expect(
      evaluate({ toggle: "party" }, ctx({}, { toggles: { party: true } })),
    ).toBe(true);
  });

  it("a list holds when any one of them is on", () => {
    const when = { toggle: ["combat", "party"] };
    expect(evaluate(when, ctx({}, { toggles: {} }))).toBe(false);
    expect(evaluate(when, ctx({}, { toggles: { party: true } }))).toBe(true);
    expect(
      evaluate(when, ctx({}, { toggles: { combat: true, party: true } })),
    ).toBe(true);
  });

  it("`all` is how several toggles are required at once", () => {
    const when = { all: [{ toggle: "combat" }, { toggle: "party" }] };
    expect(evaluate(when, ctx({}, { toggles: { party: true } }))).toBe(false);
    expect(
      evaluate(when, ctx({}, { toggles: { combat: true, party: true } })),
    ).toBe(true);
  });

  it("explains a list as the choice it is, and names what is off", () => {
    const result = explain({ toggle: ["combat", "party"] }, ctx({}));
    expect(result.leaves[0].label).toBe("combat or party enabled");
    expect(result.leaves[0].detail).toBe("off: combat, party");
  });
});

// The two one-line summaries (the item card's "Conditions: ..." line and the "needs ..."
// list) render `label` alone, so a compound's label has to explain itself without the tree.
describe("conditions.ts compound operators explain themselves in one line", () => {
  it("not: negates the child's own text instead of saying just 'not'", () => {
    const c = ctx({}, { toggles: { party: true } });
    const result = explain({ not: { toggle: "party" } }, c);
    expect(result.ok).toBe(false);
    expect(result.leaves[0].label).toBe("not party enabled");
    expect(result.unmet[0].label).toBe("not party enabled");
  });

  it("not: keeps its children tree, so the expandable detail is unchanged", () => {
    const c = ctx({}, { equipped: new Map([["mystic-aura-self", 1]]) });
    const result = explain(
      { not: { equipped: { item: "mystic-aura-self", atLeast: 1 } } },
      c,
    );
    expect(result.leaves[0].label).toBe("not 1× mystic-aura-self");
    expect(result.leaves[0].children?.map((child) => child.label)).toEqual([
      "1× mystic-aura-self",
    ]);
  });

  it("not: an ANDed group is negated as a whole, parenthesised", () => {
    const c = ctx({}, { toggles: { party: true }, enemies: 5 });
    const result = explain({ not: { toggle: "party", enemies: 3 } }, c);
    expect(result.leaves[0].label).toBe("not (party enabled + enemies ≥ 3)");
  });

  it("any: names its alternatives rather than counting them", () => {
    const c = ctx({}, { toggles: {}, tags: new Map() });
    const result = explain(
      { any: [{ toggle: "party" }, { equipped: { tag: "seal" } }] },
      c,
    );
    expect(result.ok).toBe(false);
    expect(result.unmet[0].label).toBe("party enabled or 1× seal");
  });

  it("any: an alternative with several conditions reads as one group, not as more alternatives", () => {
    const c = ctx({}, { toggles: {}, enemies: 0 });
    const result = explain(
      { any: [{ toggle: "party", enemies: 3 }, { toggle: "solo" }] },
      c,
    );
    expect(result.leaves[0].label).toBe(
      "(party enabled + enemies ≥ 3) or solo enabled",
    );
  });

  it("any: falls back to a count once the joined text would run away", () => {
    const c = ctx({});
    const result = explain(
      {
        any: [
          { toggle: "a-fairly-long-toggle-name-here" },
          { toggle: "another-fairly-long-toggle-name" },
          { toggle: "and-a-third-long-toggle-name" },
        ],
      },
      c,
    );
    expect(result.leaves[0].label).toBe("any of 3");
  });

  it("nested: an `any` inside a `not` is parenthesised, not left ambiguous", () => {
    const c = ctx({}, { toggles: { party: true } });
    const result = explain(
      { not: { any: [{ toggle: "party" }, { toggle: "solo" }] } },
      c,
    );
    expect(result.ok).toBe(false);
    expect(result.leaves[0].label).toBe("not (party enabled or solo enabled)");
  });

  it("nested: past two levels of compound the text defers to the expandable tree", () => {
    const c = ctx({}, { toggles: {} });
    const result = explain(
      {
        any: [
          { toggle: "solo" },
          { not: { any: [{ toggle: "party" }, { toggle: "raid" }] } },
        ],
      },
      c,
    );
    // The innermost `any` sits at depth 2 and counts itself; everything above it still reads.
    expect(result.leaves[0].label).toBe("solo enabled or not any of 2");
  });

  it("all: flattens into the surrounding conjunction, nested case included", () => {
    const c = ctx({}, { toggles: { party: true }, enemies: 5 });
    const result = explain(
      {
        any: [{ all: [{ toggle: "party" }, { enemies: 3 }] }, { toggle: "x" }],
      },
      c,
    );
    expect(result.leaves[0].label).toBe(
      "(party enabled + enemies ≥ 3) or x enabled",
    );
  });
});
