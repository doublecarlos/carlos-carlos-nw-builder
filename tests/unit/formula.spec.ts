// The formula language on its own: parsing, evaluation, what a formula reads, and the load-time
// checks that need no catalog.
import { describe, expect, it } from "vitest";
import {
  checkFormula,
  evaluateFormula,
  explainFormula,
  formulaReads,
  isFormulaName,
  lintFormula,
  formulaLabel,
  formulaScope,
  geometric,
  inputFormulaClashes,
  namedCycles,
  ownerScope,
  parseFormula,
  perSourceScaleWarning,
  singleRead,
  splitNamed,
  transitiveReads,
} from "../../src/engine/formula";
import { explain } from "../../src/engine/conditions";
import type {
  BuildParameterSlot,
  EvalContext,
  FormulaRef,
  ResolvedScaler,
} from "../../src/types";

function ctx(overrides: Partial<EvalContext> = {}): EvalContext {
  return {
    duration: 0,
    enemies: 0,
    toggles: {},
    equipped: new Map(),
    tags: new Map(),
    bonusOccurrences: new Map(),
    bonusNames: new Map(),
    itemNames: new Map(),
    params: new Map(),
    scalers: new Map(),
    ...overrides,
  };
}

/** A context evaluating inside a bonus declaring `named`. */
const inBonus = (
  named: Record<string, FormulaRef>,
  overrides: Partial<EvalContext> = {},
) =>
  ctx({
    self: "b",
    formulas: formulaScope({ id: "b", formulas: named }),
    ...overrides,
  });

const value = (formula: string, context = ctx()) => {
  const result = evaluateFormula(formula, context);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

const errorOf = (formula: string, context = ctx()) => {
  const result = evaluateFormula(formula, context);
  return result.ok ? null : result.error;
};

describe("arithmetic", () => {
  it("binds * and / tighter than + and -, left to right", () => {
    expect(value("1 + 2 * 3")).toBe(7);
    expect(value("10 - 4 - 3")).toBe(3);
    expect(value("24 / 4 / 2")).toBe(3);
    expect(value("(1 + 2) * 3")).toBe(9);
  });

  it("reads unary minus tighter than any binary operator", () => {
    expect(value("-2 * 3")).toBe(-6);
    expect(value("2 - -3")).toBe(5);
    expect(value("-(1 + 2)")).toBe(-3);
  });

  it("reads decimals and exponents", () => {
    expect(value(".5 + 1.25")).toBe(1.75);
    expect(value("2e2")).toBe(200);
  });
});

describe("functions", () => {
  it("min and max take two or more arguments", () => {
    expect(value("min(3, 1)")).toBe(1);
    expect(value("max(3, 1, 7, 2)")).toBe(7);
  });

  it("clamp, floor, ceil and pow", () => {
    expect(value("clamp(12, 0, 10)")).toBe(10);
    expect(value("clamp(-1, 0, 10)")).toBe(0);
    expect(value("floor(2.7)")).toBe(2);
    expect(value("ceil(2.1)")).toBe(3);
    expect(value("pow(2, 10)")).toBe(1024);
  });

  it("geometric sums halving stacks, and counts terms at a ratio of 1", () => {
    expect(value("geometric(1, 0.5)")).toBe(1);
    expect(value("geometric(3, 0.5)")).toBe(1.75);
    expect(value("geometric(4, 1)")).toBe(4);
    expect(geometric(0, 0.5)).toBe(0);
  });

  it("ramps a time stack count up to its cap", () => {
    const stacks = (duration: number) =>
      value("min(floor(duration / 5), 5)", ctx({ duration }));
    expect([0, 4, 5, 14, 25, 60].map(stacks)).toEqual([0, 0, 1, 2, 5, 5]);
  });

  it("intervals counts full intervals up to its cap", () => {
    const stacks = (duration: number) =>
      value("intervals(duration, 5, 5)", ctx({ duration }));
    expect([0, 4, 5, 14, 25, 60].map(stacks)).toEqual([0, 0, 1, 2, 5, 5]);
  });
});

describe("build lookups", () => {
  it("counts occurrences of the bonus itself or a named one, like the condition leaf", () => {
    const context = ctx({
      self: "own",
      bonusOccurrences: new Map([
        ["own", 2],
        ["other-bonus", 3],
      ]),
    });
    expect(value("occurrences()", context)).toBe(2);
    expect(value('occurrences("other-bonus")', context)).toBe(3);
    expect(value('occurrences("absent")', context)).toBe(0);
    expect(
      explain({ bonusOccurrences: { atLeast: 2 } }, context).ok &&
        value("occurrences()", context) >= 2,
    ).toBe(true);
  });

  it("counts equipped items and tagged ones", () => {
    const context = ctx({
      equipped: new Map([["ring-a", 2]]),
      tags: new Map([["insignia", 4]]),
    });
    expect(value('equipped("ring-a") + tagged("insignia")', context)).toBe(6);
  });

  it("reads a number param, and fails on one without a number value", () => {
    const context = ctx({
      params: new Map<string, string | number | boolean>([
        ["bolster", 0.5],
        ["flag", true],
      ]),
    });
    expect(value('param("bolster") * 2', context)).toBe(1);
    expect(errorOf('param("flag")', context)).toBe(
      'param("flag") has no number value',
    );
    expect(errorOf('param("missing")', context)).toBe(
      'param("missing") has no number value',
    );
  });

  it("reads a scaler's multiplier, and fails on a path that is not one", () => {
    const scaler: ResolvedScaler = {
      path: "scalers.x",
      label: "X share",
      mode: "absolute",
      value: 0.4,
      multiplier: 0.4,
    };
    const context = ctx({ scalers: new Map([["scalers.x", scaler]]) });
    expect(value('scaler("scalers.x")', context)).toBe(0.4);
    expect(errorOf("scaler('scalers.y')", context)).toBe(
      "scaler('scalers.y') is not a scaler",
    );
  });

  it("reads the bonus's own number input as $name, but not a boolean one", () => {
    const context = ctx({
      inputs: new Map([
        ["stacks", { label: "Stacks", value: 3, format: String }],
        ["on", { label: "On", value: true, format: String }],
      ]),
    });
    expect(value("$stacks * 2", context)).toBe(6);
    expect(errorOf("$on", context)).toBe(
      "$on is a boolean input, not a number",
    );
  });

  it("reads a named formula over an input declaring the same name", () => {
    const context = inBonus(
      { stacks: { formula: "5" } },
      {
        inputs: new Map([
          ["stacks", { label: "Stacks", value: 3, format: String }],
        ]),
      },
    );
    expect(value("$stacks", context)).toBe(5);
  });

  it("reads duration and enemies", () => {
    expect(value("duration + enemies", ctx({ duration: 30, enemies: 4 }))).toBe(
      34,
    );
  });
});

describe("runtime failures", () => {
  it("reports division by zero with the expression that divided", () => {
    expect(errorOf("10 / (duration - 5)", ctx({ duration: 5 }))).toBe(
      "division by zero in 10 / (duration - 5)",
    );
  });

  it("reports a non-finite result rather than returning it", () => {
    expect(errorOf("pow(10, 400)")).toBe("pow(10, 400) is not a finite number");
    expect(errorOf("pow(-1, 0.5)")).toBe("pow(-1, 0.5) is not a finite number");
  });
});

describe("named formulas", () => {
  it("evaluate through $ references, each at most once per scope", () => {
    const context = inBonus(
      {
        stacks: { formula: "min(floor(duration / 5), 5)" },
        doubled: { formula: "$stacks * 2" },
      },
      { duration: 12 },
    );
    expect(value("$doubled + $stacks", context)).toBe(6);
    expect(context.formulas!.results.get("stacks")).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("fail on a name the bonus does not declare, and on a reference loop", () => {
    const context = inBonus({
      a: { formula: "$b + 1" },
      b: { formula: "$a + 1" },
    });
    expect(errorOf("$missing", context)).toBe(
      "$missing is not a formula or input of this bonus",
    );
    expect(errorOf("$a", context)).toBe("$a refers to itself");
  });

  it("pass a failure on to every formula reading it", () => {
    const context = inBonus({ broken: { formula: "1 / enemies" } });
    expect(errorOf("$broken * 2", context)).toBe(
      "division by zero in 1 / enemies",
    );
  });
});

describe("parse problems", () => {
  const issues = (formula: string, named: string[] = []) =>
    checkFormula(formula, named).map(({ message, start, end }) => [
      message,
      start,
      end,
    ]);

  it("points at the offending text", () => {
    expect(issues("1 +")).toEqual([["formula ends early", 3, 3]]);
    expect(issues("1 + * 2")).toEqual([['unexpected "*"', 4, 5]]);
    expect(issues("(1 + 2")).toEqual([
      ['expected ")", found end of formula', 6, 6],
    ]);
    expect(issues("1 2")).toEqual([['unexpected "2"', 2, 3]]);
    expect(issues('input("x)')).toEqual([["unterminated string", 6, 9]]);
    expect(issues("2 % 3")).toEqual([['unexpected "%"', 2, 3]]);
    expect(issues("")).toEqual([["formula is empty", 0, 0]]);
  });

  it("suggests the missing sigil on a $ name, and a close name otherwise", () => {
    expect(issues("stacks * 2", ["stacks"])).toEqual([
      ['unknown name "stacks"; did you mean "$stacks"?', 0, 6],
    ]);
    expect(issues("duraton / 5")).toEqual([
      ['unknown name "duraton"; did you mean "duration"?', 0, 7],
    ]);
    expect(issues("$stakcs", ["stacks"])).toEqual([
      [
        '"$stakcs" is not a formula or input of this bonus; did you mean "$stacks"?',
        0,
        7,
      ],
    ]);
    expect(issues("mni(1, 2)")).toEqual([
      ['unknown function "mni"; did you mean "min"?', 0, 9],
    ]);
  });

  it("carries each suggestion as a fix for the name alone", () => {
    const [unknown] = checkFormula("stacks * 2", ["stacks"]);
    expect(unknown).toMatchObject({
      brief: 'unknown name "stacks"',
      fix: { start: 0, end: 6, text: "$stacks" },
    });
    const [fn] = checkFormula("mni(1, 2)", []);
    expect(fn.fix).toEqual({ start: 0, end: 3, text: "min" });
    expect(checkFormula("zzzzzz", [])[0]).not.toHaveProperty("fix");
  });

  it("checks argument counts and which arguments are quoted", () => {
    expect(issues("min(1)")[0][0]).toBe("min() takes at least 2 arguments");
    expect(issues("occurrences(1, 2)")[0][0]).toBe(
      "occurrences() takes 0 or 1 arguments",
    );
    expect(issues("param(duration)")[0][0]).toBe(
      'param() takes a quoted id or path, like param("...")',
    );
    expect(issues('floor("x")')[0][0]).toBe(
      '"x" is text; quoted ids and paths only go inside a function call',
    );
  });

  it("fails evaluation with the first problem", () => {
    expect(errorOf("min(1)")).toBe("min() takes at least 2 arguments");
    expect(errorOf("nope + 1")).toBe('unknown name "nope"');
  });
});

describe("reads", () => {
  it("lists every path, id and input a formula looks up", () => {
    const { reads } = parseFormula(
      'param("bolster") * scaler("scalers.x") + $stacks + $ramp' +
        ' + occurrences() + occurrences("other") + equipped("ring") + tagged("t")',
    );
    expect(reads).toMatchObject({
      params: ["bolster"],
      scalers: ["scalers.x"],
      named: [
        expect.objectContaining({ name: "stacks" }),
        expect.objectContaining({ name: "ramp" }),
      ],
      bonuses: ["other"],
      ownOccurrences: true,
      items: ["ring"],
      tags: ["t"],
    });
  });

  it("follow named formulas transitively", () => {
    const named = {
      a: { formula: "$b + occurrences()" },
      b: { formula: 'param("p")' },
    };
    const all = transitiveReads("$a", named);
    expect(all.some((reads) => reads.ownOccurrences)).toBe(true);
    expect(all.flatMap((reads) => reads.params)).toEqual(["p"]);
  });

  it("split $ names into inputs and named formulas against the bonus", () => {
    const scope = ownerScope({
      inputs: { stacks: { type: "number", default: 0 } },
      formulas: { ramp: { formula: "1" } },
    });
    expect(
      splitNamed(parseFormula("$stacks + $ramp + $gone").reads, scope),
    ).toEqual({ inputs: ["stacks"], formulas: ["ramp"] });
  });

  it("parses each distinct text once", () => {
    expect(parseFormula("duration * 2")).toBe(parseFormula("duration * 2"));
  });
});

describe("inputFormulaClashes", () => {
  it("names each formula an input also declares", () => {
    expect(
      inputFormulaClashes({
        inputs: { stacks: { type: "number", default: 0 } },
        formulas: { stacks: { formula: "1" }, ramp: { formula: "2" } },
      }),
    ).toEqual(["stacks"]);
  });
});

describe("namedCycles", () => {
  it("names each loop along its path", () => {
    expect(
      namedCycles({
        a: { formula: "$b" },
        b: { formula: "$c + 1" },
        c: { formula: "$a" },
        d: { formula: "$d" },
        e: { formula: "$a" },
      }),
    ).toEqual([
      ["a", "b", "c", "a"],
      ["d", "d"],
    ]);
  });

  it("finds none in an acyclic set", () => {
    expect(namedCycles({ a: { formula: "$b" }, b: { formula: "1" } })).toEqual(
      [],
    );
  });
});

describe("labels", () => {
  const scaler: ResolvedScaler = {
    path: "scalers.x",
    label: "Encounter share",
    mode: "absolute",
    value: 1,
    multiplier: 1,
  };
  const context = inBonus(
    {
      stacks: { formula: "duration / 5", label: "Stacks" },
      bare: { formula: "duration" },
      share: { formula: 'scaler("scalers.x")' },
    },
    {
      scalers: new Map([["scalers.x", scaler]]),
      inputs: new Map([
        ["procs", { label: "Procs", value: 1, format: String }],
      ]),
    },
  );
  const label = (ref: FormulaRef) => formulaLabel(ref, context);

  it("derives one from a single input, scaler or named formula", () => {
    expect(label({ formula: "$procs" })).toBe("Procs");
    expect(label({ formula: 'scaler("scalers.x")' })).toBe("Encounter share");
    expect(label({ formula: "$stacks" })).toBe("Stacks");
    expect(label({ formula: "$share" })).toBe("Encounter share");
    expect(label({ formula: "$bare" })).toBe("bare");
  });

  it("derives one from an intervals call, in seconds over duration", () => {
    expect(label({ formula: "intervals(duration, 5, 6)" })).toBe(
      "full 5s intervals",
    );
    expect(label({ formula: "intervals(duration, 2.5, 4)" })).toBe(
      "full 2.5s intervals",
    );
    expect(label({ formula: "intervals($procs, 2, 4)" })).toBe(
      "full intervals of 2",
    );
    expect(label({ formula: "intervals(duration, $procs, 4)" })).toBe(
      "full intervals",
    );
    expect(
      label({ formula: "intervals(duration, 2, 10) * 2" }),
    ).toBeUndefined();
  });

  it("derives one from a geometric call, as a multiplier", () => {
    expect(label({ formula: "geometric(min(occurrences(), 3), 0.5)" })).toBe(
      "halving-stack multiplier",
    );
    expect(label({ formula: "geometric($procs, 0.75)" })).toBe(
      "stack multiplier (each 75% of the last)",
    );
    expect(label({ formula: "geometric($procs, $procs)" })).toBe(
      "stack multiplier",
    );
    expect(label({ formula: "geometric($procs, 1)" })).toBeUndefined();
    expect(label({ formula: "geometric($procs, 0.5) - 1" })).toBeUndefined();
  });

  it("lets a site's own label win, and has none for anything else", () => {
    expect(label({ formula: "$stacks", label: "Charges" })).toBe("Charges");
    expect(
      label({ formula: "intervals(duration, 5, 6)", label: "Stacks" }),
    ).toBe("Stacks");
    expect(label({ formula: "$stacks * 2" })).toBeUndefined();
    expect(singleRead("$stacks * 2")).toBeNull();
  });
});

describe("the formula condition leaf", () => {
  it("reads by the formula's label and explains the value it has", () => {
    const context = inBonus(
      { stacks: { formula: "min(floor(duration / 5), 5)", label: "Stacks" } },
      { duration: 10 },
    );
    const result = explain(
      { formula: { formula: "$stacks", atLeast: 3 } },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.unmet).toEqual([
      { ok: false, label: "Stacks ≥ 3", detail: "you have 2" },
    ]);
  });

  it("shows the formula text without a label, and fails closed on an error", () => {
    const result = explain(
      { formula: { formula: "10 / enemies", below: 3 } },
      ctx(),
    );
    expect(result.leaves).toEqual([
      {
        ok: false,
        label: "10 / enemies < 3",
        detail: "division by zero in 10 / enemies",
        error: "division by zero in 10 / enemies",
      },
    ]);
  });

  it("formats a single percent input's value in its units", () => {
    const pct = (value: number) => `${value * 100}%`;
    const context = ctx({
      inputs: new Map([
        ["uptime", { label: "Uptime", value: 0.5, format: pct }],
      ]),
    });
    expect(
      explain({ formula: { formula: "$uptime", atLeast: 0.75 } }, context)
        .leaves[0],
    ).toEqual({ ok: false, label: "Uptime ≥ 75%", detail: "you have 50%" });
  });
});

describe("lintFormula", () => {
  const param = (path: string, extra: Partial<BuildParameterSlot> = {}) =>
    [
      path,
      {
        id: path,
        label: path,
        section: "s",
        type: "build_parameter",
        path,
        paramType: "number",
        ...extra,
      } as BuildParameterSlot,
    ] as const;
  const vocabulary = {
    params: new Map([
      param("bolster"),
      param("flag", { paramType: "boolean" }),
      param("scalers.x", { scaler: { mode: "absolute" } }),
    ]),
    bonusIds: new Set(["other"]),
    itemIds: new Set(["ring"]),
    tags: new Set(["t"]),
  };
  const owner = {
    id: "self",
    inputs: {
      n: { type: "number" as const, default: 1 },
      on: { type: "boolean" as const, default: false },
    },
    formulas: { stacks: { formula: "1" } },
  };
  const lint = (formula: string) =>
    lintFormula(formula, owner, vocabulary).map(
      ({ level, message, start, end, syntax }) => [
        level,
        message,
        formula.slice(start, end),
        syntax,
      ],
    );

  it("passes a formula whose every lookup the catalog satisfies", () => {
    expect(
      lint(
        'param("bolster") * scaler("scalers.x") + $n + $stacks' +
          ' + occurrences("other") + equipped("ring") + tagged("t")',
      ),
    ).toEqual([]);
  });

  it("marks each lookup it cannot satisfy at the call, after the text's own problems", () => {
    expect(
      lint(
        'stacks + param("flag") + scaler("bolster") + $on + occurrences("self") + tagged("x")',
      ),
    ).toEqual([
      [
        "error",
        'unknown name "stacks"; did you mean "$stacks"?',
        "stacks",
        true,
      ],
      [
        "error",
        'param("flag") is a boolean; formulas read numbers, so test it in "when"',
        'param("flag")',
        false,
      ],
      [
        "error",
        'scaler("bolster") is not a parameter declaring a scaler',
        'scaler("bolster")',
        false,
      ],
      [
        "error",
        '$on is a boolean input; formulas read numbers, so test it in "when"',
        "$on",
        false,
      ],
      [
        "warn",
        'occurrences("self") names this bonus itself; use occurrences()',
        'occurrences("self")',
        false,
      ],
      ["warn", 'tagged("x") matches no item', 'tagged("x")', false],
    ]);
  });
});

describe("formulaReads", () => {
  it("names each lookup by the bonus, item or tag it counts", () => {
    const context = ctx({
      self: "own",
      bonusOccurrences: new Map([
        ["own", 2],
        ["other", 3],
      ]),
      bonusNames: new Map([["other", "Other Bonus"]]),
      equipped: new Map([["ring", 1]]),
      itemNames: new Map([["ring", "Test Ring"]]),
      tags: new Map([["fire", 4]]),
    });
    const formula =
      'occurrences() + occurrences("other") + equipped("ring") + tagged("fire")';
    expect(
      formulaReads(formula, context).map(({ label, text }) => [label, text]),
    ).toEqual([
      ["occurrences", "2"],
      ["Other Bonus occurrences", "3"],
      ["Test Ring equipped", "1"],
      ['tagged "fire"', "4"],
    ]);
  });
});

describe("explainFormula", () => {
  it("splits the text at every read and substitutes each read's value", () => {
    const context = inBonus(
      { stacks: { formula: "min(floor(duration / 5), 5)" } },
      {
        duration: 30,
        params: new Map([["bolster", 2]]),
      },
    );
    const { parts, substituted, result } = explainFormula(
      '$stacks * param("bolster") + 1',
      context,
    );
    expect(parts).toEqual([
      { text: "$stacks", read: { kind: "named", arg: "stacks" }, value: 5 },
      { text: " * " },
      {
        text: 'param("bolster")',
        read: { kind: "param", arg: "bolster" },
        value: 2,
        label: "bolster",
      },
      { text: " + 1" },
    ]);
    expect(substituted).toBe("5 * 2 + 1");
    expect(result).toEqual({ ok: true, value: 11 });
  });

  it("marks a $ input as an input read", () => {
    const context = ctx({
      inputs: new Map([["n", { label: "N", value: 3, format: String }]]),
    });
    expect(explainFormula("$n + 1", context).parts[0]).toEqual({
      text: "$n",
      read: { kind: "input", arg: "n" },
      value: 3,
      valueText: "3",
    });
  });

  it("keeps a read that fails as text, and carries the failure", () => {
    const { parts, substituted, result } = explainFormula(
      'duration + param("gone")',
      ctx({ duration: 4 }),
    );
    expect(parts.at(-1)).toEqual({
      text: 'param("gone")',
      read: { kind: "param", arg: "gone" },
    });
    expect(substituted).toBe('4 + param("gone")');
    expect(result.ok).toBe(false);
  });

  it("returns the text whole when it does not parse", () => {
    expect(explainFormula("1 +", ctx())).toMatchObject({
      parts: [{ text: "1 +" }],
      substituted: "1 +",
      result: { ok: false },
    });
  });
});

describe("perSourceScaleWarning", () => {
  const bonus = {
    id: "self",
    stacking: "perSource",
    formulas: { count: { formula: 'occurrences("self")' } },
  };

  it("warns on a perSource scale counting its own occurrences, even through a name", () => {
    expect(perSourceScaleWarning("occurrences() / 2", bonus)).toContain(
      "perSource stacking already multiplies by",
    );
    expect(perSourceScaleWarning("$count", bonus)).not.toBeNull();
  });

  it("passes another bonus's count, or any scale without perSource", () => {
    expect(perSourceScaleWarning('occurrences("other")', bonus)).toBeNull();
    expect(
      perSourceScaleWarning("occurrences()", { ...bonus, stacking: undefined }),
    ).toBeNull();
  });
});

describe("isFormulaName", () => {
  it("takes a letter or _ then word characters", () => {
    expect(["stacks", "_x", "a1_b"].every(isFormulaName)).toBe(true);
    expect(["1a", "a-b", "$a", ""].some(isFormulaName)).toBe(false);
  });
});
