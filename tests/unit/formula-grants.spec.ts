// Formulas on grants, resolved through the engine: `scale`, `tierBy`, named formulas, the
// formula leaf, and how failures surface. Plus the catalog checks that need the composed data.
import { describe, expect, it } from "vitest";
import * as db from "../../src/data/db";
import * as catalog from "../../src/data/catalog";
import * as engine from "../../src/engine/engine";
import { bonusInputAddress, writeInput } from "../../src/lib/build-inputs";
import { choseLabel, grantFormulas } from "../../src/lib/bonus-inspector";
import type {
  Bonus,
  Build,
  BuildParameterSlot,
  FormulaCondition,
  FormulaRef,
  Item,
  Schema,
  Slot,
  SlotsData,
} from "../../src/types";

const schema: Schema = {
  stats: [{ key: "power", label: "Power", kind: "int" }],
  statByKey: { power: { key: "power", label: "Power", kind: "int" } },
  statKeys: ["power"],
  multiplicativeStats: [],
  ratingStats: [],
  abilityStats: [],
  ratingConversion: [],
  statContributions: [],
  forteSplit: {},
  roles: { dps: { label: "DPS", hpBonus: 1, damageBonus: 1.2 } },
};

/** 100 power per 5s in combat, up to 5 stacks. */
const ramp: Bonus = {
  id: "ramp",
  name: "Ramp",
  formulas: {
    stacks: { formula: "min(floor(duration / 5), 5)", label: "Stacks" },
  },
  grants: [{ stats: { power: 100 }, scale: { formula: "$stacks" } }],
};

/** Excludes `victim` while active, which a scale of 0 must not do. */
const excluder: Bonus = {
  id: "excluder",
  excludes: ["victim"],
  grants: [{ stats: { power: 1 }, scale: { formula: "enemies" } }],
};
const victim: Bonus = { id: "victim", grants: [{ stats: { power: 7 } }] };

const ladder: Bonus = {
  id: "ladder",
  grants: [
    {
      tierBy: { formula: "enemies" },
      tiers: [
        { atLeast: 1, stats: { power: 10 } },
        { atLeast: 3, stats: { power: 30 } },
      ],
    },
  ],
};

const counted: Bonus = {
  id: "counted",
  grants: [
    {
      tiers: [
        { atLeast: 2, stats: { power: 20 } },
        { atLeast: 1, stats: { power: 10 } },
      ],
    },
  ],
};

const gated: Bonus = {
  id: "gated",
  inputs: {
    procs: { type: "number", min: 0, max: 10, default: 2, label: "Procs" },
  },
  grants: [
    {
      when: { formula: { formula: "$procs * 2", atLeast: 6 } },
      stats: { power: 50 },
    },
  ],
};

/** 10 power per proc, the count set on the build. */
const perProc: Bonus = {
  id: "per-proc",
  inputs: {
    procs: { type: "number", min: 0, max: 10, default: 2, label: "Procs" },
  },
  grants: [{ stats: { power: 10 }, scale: { formula: "$procs" } }],
};

const broken: Bonus = {
  id: "broken",
  grants: [{ stats: { power: 5 }, scale: { formula: "10 / enemies" } }],
};
const negative: Bonus = {
  id: "negative",
  grants: [{ stats: { power: 5 }, scale: { formula: "enemies - 3" } }],
};

/** Each fails at 0 enemies; whether that is reported depends on what else decides it. */
const divide = { formula: "1 / enemies" };
const guardedScale: Bonus = {
  id: "guarded-scale",
  grants: [
    {
      when: { enemies: { atLeast: 1 } },
      stats: { power: 5 },
      scale: { formula: "10 / enemies" },
    },
  ],
};
const eitherLeaf: Bonus = {
  id: "either-leaf",
  grants: [
    {
      when: {
        any: [
          { formula: { ...divide, atLeast: 0 } },
          { duration: { atLeast: 10 } },
        ],
      },
      stats: { power: 5 },
    },
  ],
};
const bothLeaves: Bonus = {
  id: "both-leaves",
  grants: [
    {
      when: {
        all: [
          { duration: { atLeast: 10 } },
          { formula: { ...divide, atLeast: 0 } },
        ],
      },
      stats: { power: 5 },
    },
  ],
};
const negatedLeaf: Bonus = {
  id: "negated-leaf",
  grants: [
    {
      when: { not: { formula: { ...divide, atLeast: 1 } } },
      stats: { power: 5 },
    },
  ],
};
const laterVariant: Bonus = {
  id: "later-variant",
  grants: [
    {
      variants: [
        { when: { duration: { atLeast: 10 } }, stats: { power: 1 } },
        { when: { formula: { ...divide, atLeast: 0 } }, stats: { power: 2 } },
      ],
    },
  ],
};
const brokenLadder: Bonus = {
  id: "broken-ladder",
  grants: [{ tierBy: divide, tiers: [{ atLeast: 0, stats: { power: 5 } }] }],
};

/** Layer data that failed validation: a bare string scale and a leaf without text. */
const malformed: Bonus = {
  id: "malformed",
  grants: [
    { stats: { power: 5 }, scale: "enemies" as unknown as FormulaRef },
    {
      when: {
        formula: { formula: 3, atLeast: 1 } as unknown as FormulaCondition,
      },
      stats: { power: 5 },
    },
  ],
};

const bonuses = [
  ramp,
  excluder,
  victim,
  ladder,
  counted,
  gated,
  perProc,
  broken,
  negative,
  malformed,
  guardedScale,
  eitherLeaf,
  bothLeaves,
  negatedLeaf,
  laterVariant,
  brokenLadder,
];

const ringFor = (bonus: string): Item => ({
  id: `${bonus}-ring`,
  name: `${bonus} ring`,
  filter: "rings",
  bonuses: [bonus],
});
const items = bonuses.map((bonus) => ringFor(bonus.id));

const picker = (id: string): Slot => ({
  id,
  label: id,
  section: "gear",
  type: "item_picker",
  filter: "rings",
});
const slotsData: SlotsData = {
  sections: [{ id: "gear", label: "Gear", slotIds: [] }],
  slots: [picker("ring1"), picker("ring2"), picker("ring3")],
  presets: [],
};
const testDb = db.build(items, bonuses, schema, slotsData);

function buildWith(
  rings: string[],
  context: Partial<Build["context"]> = {},
): Build {
  const choices = Object.fromEntries(
    rings.map((bonus, index) => [`ring${index + 1}`, `${bonus}-ring`]),
  );
  return {
    id: "b",
    name: "b",
    choices,
    values: {},
    bonusValues: {},
    assignments: {},
    listRows: {},
    disabledSlots: {},
    context: { role: "dps", toggles: {}, ...context } as Build["context"],
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
  };
}

const resolve = (build: Build) => engine.resolveBuild(testDb, build);
const entry = (build: Build, id: string) =>
  resolve(build).bonuses.find((b) => b.id === id)!;

describe("scale", () => {
  it("multiplies the payload by the formula's result", () => {
    const at = (duration: number) =>
      entry(buildWith(["ramp"], { duration }), "ramp").appliedStats?.power;
    expect([5, 12, 25, 60].map(at)).toEqual([100, 200, 500, 500]);
  });

  it("reads by the named formula's label", () => {
    const [grant] = entry(buildWith(["ramp"], { duration: 12 }), "ramp").grants;
    expect(grant.scale).toMatchObject({
      formula: "$stacks",
      label: "Stacks",
      multiplier: 2,
      unscaled: { power: 100 },
    });
    expect(grant.scale).not.toHaveProperty("path");
  });

  it("at 0 leaves the grant inactive, one unmet step away, previewing the real value", () => {
    const ramped = entry(buildWith(["ramp"], { duration: 4 }), "ramp");
    expect(ramped.active).toBe(false);
    expect(ramped.previewStats).toEqual({ power: 100 });
    expect(ramped.gate.unmet).toEqual([
      { ok: false, label: "Stacks > 0", detail: "you have 0" },
    ]);
    expect(resolve(buildWith(["ramp"], { duration: 4 })).errors).toEqual([]);
  });

  it("at 0 does not exclude anything", () => {
    const off = resolve(buildWith(["excluder", "victim"], { enemies: 0 }));
    expect(off.bonuses.find((b) => b.id === "victim")?.active).toBe(true);
    const on = resolve(buildWith(["excluder", "victim"], { enemies: 2 }));
    expect(on.bonuses.find((b) => b.id === "victim")).toMatchObject({
      active: false,
      excludedBy: "excluder",
    });
  });

  it("reports a failed formula as a slot error and leaves the grant inactive", () => {
    const result = resolve(buildWith(["broken"], { enemies: 0 }));
    expect(result.bonuses.find((b) => b.id === "broken")?.active).toBe(false);
    expect(result.errors).toEqual([
      {
        slotId: "ring1",
        kind: "formula",
        choice: "broken",
        message: "division by zero in 10 / enemies",
        severity: "error",
      },
    ]);
  });

  it("reports a negative result the same way", () => {
    const result = resolve(buildWith(["negative"], { enemies: 1 }));
    expect(result.bonuses.find((b) => b.id === "negative")?.active).toBe(false);
    expect(result.errors.map((e) => e.message)).toEqual([
      "enemies - 3 is negative (-2)",
    ]);
  });
});

describe("malformed formulas", () => {
  it("leave their grants inactive with a slot error instead of throwing", () => {
    const result = resolve(buildWith(["malformed"], { enemies: 2 }));
    const bonus = result.bonuses.find((b) => b.id === "malformed")!;
    expect(bonus.active).toBe(false);
    expect(bonus.grants[0].scale?.formula).toBe('"enemies"');
    expect(bonus.grants[0].scale?.label).toBeUndefined();
    expect(bonus.grants[1].gate.unmet[0].label).toBe(
      '{"formula":3,"atLeast":1} ≥ 1',
    );
    expect(result.errors.map((e) => e.message)).toEqual([
      "a formula of this bonus is not a string",
    ]);
  });
});

describe("which formula errors are reported", () => {
  const messages = (bonus: string, duration = 0) =>
    resolve(buildWith([bonus], { enemies: 0, duration })).errors.map(
      (e) => e.message,
    );
  const divided = ["division by zero in 1 / enemies"];

  it("keeps a scale's error on its record while the gate is unmet", () => {
    expect(messages("guarded-scale")).toEqual([]);
    const [grant] = entry(buildWith(["guarded-scale"]), "guarded-scale").grants;
    expect(grant.scale?.error).toBe("division by zero in 10 / enemies");
  });

  it("reports a leaf only when it decides the gate", () => {
    expect(messages("either-leaf", 20)).toEqual([]);
    expect(messages("either-leaf")).toEqual(divided);
    expect(messages("both-leaves")).toEqual([]);
    expect(messages("both-leaves", 20)).toEqual(divided);
  });

  it("fails a gate closed on an error under a not", () => {
    expect(entry(buildWith(["negated-leaf"]), "negated-leaf").active).toBe(
      false,
    );
    expect(messages("negated-leaf")).toEqual(divided);
  });

  it("skips variants past the first match", () => {
    expect(messages("later-variant", 20)).toEqual([]);
    expect(messages("later-variant")).toEqual(divided);
  });

  it("reports a failed tierBy", () => {
    expect(messages("broken-ladder")).toEqual(divided);
  });
});

describe("tiers", () => {
  it("pick the highest threshold the tierBy measure reaches", () => {
    const at = (enemies: number) =>
      entry(buildWith(["ladder"], { enemies }), "ladder");
    expect(at(0).active).toBe(false);
    expect(at(1).appliedStats).toEqual({ power: 10 });
    expect(at(2).appliedStats).toEqual({ power: 10 });
    expect(at(5)).toMatchObject({
      chose: "tier:3",
      appliedStats: { power: 30 },
    });
  });

  it("carry the tierBy measure, active or not, for naming the rungs", () => {
    const at = (enemies: number) =>
      entry(buildWith(["ladder"], { enemies }), "ladder");
    expect(at(5).grants[0].measure).toEqual({ formula: "enemies", value: 5 });
    expect(at(0).grants[0].measure).toEqual({ formula: "enemies", value: 0 });
    expect(choseLabel(at(5))).toBe("enemies ≥ 3");
    expect(entry(buildWith(["counted"]), "counted").grants[0].measure).toBe(
      undefined,
    );
    expect(
      choseLabel(entry(buildWith(["counted", "counted"]), "counted")),
    ).toBe("2 equipped");
  });

  it("count the bonus's own occurrences without a tierBy, in any order", () => {
    expect(entry(buildWith(["counted"]), "counted").appliedStats).toEqual({
      power: 10,
    });
    expect(
      entry(buildWith(["counted", "counted"]), "counted").appliedStats,
    ).toEqual({ power: 20 });
  });
});

describe("the formula condition leaf", () => {
  it("gates a grant on an input read through a formula", () => {
    const build = buildWith(["gated"]);
    const inactive = entry(build, "gated");
    expect(inactive.active).toBe(false);
    expect(inactive.gate.unmet).toEqual([
      { ok: false, label: "$procs * 2 ≥ 6", detail: "you have 4" },
    ]);
    writeInput(build, bonusInputAddress("gated", "procs"), 3);
    expect(entry(build, "gated").active).toBe(true);
  });
});

describe("$ inputs", () => {
  it("scale a grant by the value set on the build", () => {
    const build = buildWith(["per-proc"]);
    const scaled = entry(build, "per-proc");
    expect(scaled.appliedStats).toEqual({ power: 20 });
    expect(scaled.grants[0].scale).toMatchObject({
      label: "Procs",
      multiplier: 2,
    });
    writeInput(build, bonusInputAddress("per-proc", "procs"), 5);
    expect(entry(build, "per-proc").appliedStats).toEqual({ power: 50 });
  });
});

describe("catalog.validate: formulas", () => {
  const params: Slot[] = [
    {
      id: "p.num",
      label: "Num",
      section: "gear",
      type: "build_parameter",
      paramType: "number",
      path: "num",
      default: 0,
    },
    {
      id: "p.flag",
      label: "Flag",
      section: "gear",
      type: "build_parameter",
      paramType: "boolean",
      path: "flag",
      default: false,
    },
    {
      id: "p.share",
      label: "Share",
      section: "gear",
      type: "build_parameter",
      paramType: "percent",
      path: "scalers.share",
      default: 1,
      scaler: { mode: "absolute" },
    } as BuildParameterSlot,
  ];
  const lint = (bonus: Bonus, extraItems: Item[] = []) =>
    catalog
      .validate(
        [ringFor(bonus.id), ...extraItems],
        [bonus, victim],
        schema,
        [],
        [...slotsData.slots, ...params],
        [],
        [],
      )
      .filter((f) => f.name === bonus.id)
      .map((f) => `${f.level}: ${f.message}`);

  it("accepts every lookup the catalog can resolve", () => {
    expect(
      lint(
        {
          id: "fine",
          inputs: {
            n: { type: "number", min: 0, max: 5, default: 1 },
          },
          formulas: { base: { formula: 'param("num") + $n' } },
          grants: [
            {
              stats: { power: 1 },
              scale: {
                formula:
                  '$base * scaler("scalers.share") + occurrences("victim") + equipped("fine-ring") + tagged("t")',
              },
            },
          ],
        },
        [{ id: "tagged", name: "Tagged", filter: "rings", tags: ["t"] }],
      ),
    ).toEqual([]);
  });

  it("checks a scale's step ladder hint", () => {
    const steps = { over: "duration", min: 0, max: 25, step: 5 };
    expect(
      lint({
        id: "stepped",
        grants: [
          { stats: { power: 1 }, scale: { formula: "enemies", steps } },
          {
            tiers: [{ atLeast: 1, stats: { power: 1 } }],
            scale: { formula: "duration", steps },
          },
        ],
      }),
    ).toEqual([
      "error: grant 1: the scale formula does not read duration",
      "warn: grant 2: scale steps lay out a flat payload; this grant shows none",
    ]);
  });

  it("names the position of a parse problem", () => {
    expect(
      lint({ id: "bad", grants: [{ stats: {}, scale: { formula: "1 +" } }] }),
    ).toEqual(['error: grant 1 scale: formula ends early (column 4 of "1 +")']);
  });

  it("rejects lookups the catalog cannot resolve", () => {
    expect(
      lint({
        id: "lookups",
        inputs: { on: { type: "boolean", default: false } },
        grants: [
          {
            when: { input: { key: "on", is: true } },
            stats: {},
            scale: {
              formula:
                'param("nope") + param("flag") + scaler("num") + $on' +
                ' + occurrences("ghost") + occurrences("lookups") + equipped("ghost") + tagged("ghost")',
            },
          },
        ],
      }),
    ).toEqual([
      `error: grant 1 scale: param("nope") is not a build_parameter's path`,
      'error: grant 1 scale: param("flag") is a boolean; formulas read numbers, so test it in "when"',
      'error: grant 1 scale: scaler("num") is not a parameter declaring a scaler',
      'error: grant 1 scale: $on is a boolean input; formulas read numbers, so test it in "when"',
      'error: grant 1 scale: occurrences("ghost") names no bonus',
      'warn: grant 1 scale: occurrences("lookups") names this bonus itself; use occurrences()',
      'error: grant 1 scale: equipped("ghost") names no item',
      'warn: grant 1 scale: tagged("ghost") matches no item',
    ]);
  });

  it("checks named formulas: names, unknown references, missing sigils and loops", () => {
    expect(
      lint({
        id: "named",
        formulas: {
          a: { formula: "$b" },
          b: { formula: "$a" },
          "bad-name": { formula: "1" },
        },
        grants: [
          {
            stats: {},
            scale: { formula: "a + $c" },
            tierBy: { formula: "1" },
          },
        ],
      }),
    ).toEqual([
      'error: formula "bad-name": a name is a letter or _ then letters, digits or _',
      "error: formulas refer to each other in a loop: $a → $b → $a",
      'error: grant 1 scale: unknown name "a"; did you mean "$a"? (column 1 of "a + $c")',
      'error: grant 1 scale: "$c" is not a formula or input of this bonus; did you mean "$a"? (column 5 of "a + $c")',
      "warn: grant 1: tierBy does nothing without tiers",
    ]);
  });

  it("checks tier ladders", () => {
    expect(
      lint({
        id: "tiers",
        grants: [
          {
            tiers: [
              { atLeast: 2, stats: {} },
              { atLeast: 2, stats: {} },
              { bonusOccurrences: { atLeast: 3 }, stats: {} } as never,
            ],
          },
        ],
      }),
    ).toEqual([
      "error: grant 1: two tiers start at 2; only one can apply",
      'error: grant 1 tier 3: needs a numeric "atLeast" (a tier is { atLeast, stats }); the tier never applies',
      "warn: grant 1: the lowest tier starts at 2 occurrences, so fewer grant nothing",
    ]);
  });

  it("warns when a perSource bonus scales by its own count, even through a name", () => {
    expect(
      lint({
        id: "doubled",
        stacking: "perSource",
        formulas: { n: { formula: "occurrences()" } },
        grants: [{ stats: {}, scale: { formula: "min($n, 3)" } }],
      }),
    ).toEqual([
      "warn: grant 1: scale counts this bonus's own occurrences, which perSource stacking already multiplies by",
    ]);
  });

  it("requires a range on the formula leaf, and counts formula input reads as reads", () => {
    expect(
      lint({
        id: "leaf",
        inputs: { n: { type: "number", min: 0, max: 5, default: 1 } },
        grants: [{ when: { formula: { formula: "$n" } }, stats: {} }],
      }),
    ).toEqual([
      "error: grant 1: formula condition needs atLeast/below/exactly",
    ]);
  });

  it("rejects a name declared both as a formula and as an input", () => {
    expect(
      lint({
        id: "clash",
        inputs: { n: { type: "number", min: 0, max: 5, default: 1 } },
        formulas: { n: { formula: "2" } },
        grants: [{ stats: {}, scale: { formula: "$n" } }],
      }),
    ).toEqual([
      'error: formula "n": "$n" is also an input of this bonus; rename the formula',
      // $n reads the formula, leaving the input unread.
      'warn: input "n" is never read by a condition or formula',
    ]);
  });

  it("warns on an input no condition or formula reads", () => {
    expect(
      lint({
        id: "unread",
        inputs: {
          n: { type: "number", min: 0, max: 5, default: 1 },
          m: { type: "number", min: 0, max: 5, default: 1 },
        },
        formulas: { twice: { formula: "$n * 2" } },
        grants: [{ stats: {}, scale: { formula: "$twice" } }],
      }),
    ).toEqual(['warn: input "m" is never read by a condition or formula']);
  });
});

describe("the inspector's formula lines", () => {
  const linesAt = (id: string, context: Partial<Build["context"]>) => {
    const result = resolve(buildWith([id], context));
    const bonus = result.bonuses.find((b) => b.id === id)!;
    return grantFormulas(bonus, result.context, testDb.slots);
  };

  it("explains a scale, then the named formulas it uses, against the build", () => {
    expect(linesAt("ramp", { duration: 30 })).toEqual([
      {
        key: 0,
        label: "always on",
        lines: [
          {
            title: "Scale (Stacks)",
            parts: [{ text: "$stacks" }],
            substituted: null,
            result: "5",
            failed: false,
          },
          {
            title: "$stacks (Stacks)",
            parts: [
              { text: "min(floor(" },
              { text: "duration" },
              { text: " / 5), 5)" },
            ],
            substituted: "min(floor(30 / 5), 5)",
            result: "5",
            failed: false,
          },
        ],
      },
    ]);
  });

  it("explains a tier measure, and a failure as its error", () => {
    expect(linesAt("broken-ladder", { enemies: 0 })[0].lines).toEqual([
      {
        title: "Tier measure",
        parts: [{ text: "1 / " }, { text: "enemies" }],
        substituted: "1 / 0",
        result: "division by zero in 1 / enemies",
        failed: true,
      },
    ]);
  });

  it("links a $ input to the row where it is set", () => {
    const [grant] = linesAt("per-proc", {});
    expect(grant.lines).toEqual([
      {
        title: "Scale (Procs)",
        parts: [{ text: "$procs", slotId: expect.any(String) }],
        substituted: null,
        result: "2",
        failed: false,
      },
    ]);
  });

  it("lists nothing for a bonus without scale or tierBy", () => {
    expect(linesAt("counted", {})).toEqual([]);
  });
});
