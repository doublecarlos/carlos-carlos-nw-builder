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
    setPieces: new Map(),
    setNames: new Map(),
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

describe("conditions.ts pieces leaf uses setNames for friendly labels", () => {
  it("shows the set name when available in setNames", () => {
    const c = ctx(
      {},
      {
        setPieces: new Map([["m32-impending-doom-celestial", 1]]),
        setNames: new Map([["m32-impending-doom-celestial", "Impending Doom"]]),
      },
    );
    const result = explain(
      { pieces: { set: "m32-impending-doom-celestial", atLeast: 2 } },
      c,
    );
    expect(result.ok).toBe(false);
    expect(result.unmet[0].label).toBe("2 piece(s) of Impending Doom");
  });

  it("falls back to the set id when not in setNames", () => {
    const c = ctx(
      {},
      {
        setPieces: new Map([["m32-unknown-set", 1]]),
        setNames: new Map(),
      },
    );
    const result = explain(
      { pieces: { set: "m32-unknown-set", atLeast: 2 } },
      c,
    );
    expect(result.ok).toBe(false);
    expect(result.unmet[0].label).toBe("2 piece(s) of m32-unknown-set");
  });
});
