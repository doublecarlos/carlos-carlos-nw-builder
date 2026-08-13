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
    compare: { id: "", highlight: false, onlyDiff: false },
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
    expect(result.unmet[0].label).toBe("2 occurrence(s) of Impending Doom");
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
    expect(result.unmet[0].label).toBe("2 occurrence(s) of m32-unknown-bonus");
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
    expect(result.unmet[0].label).toBe("3 occurrence(s) of b");
  });
});
