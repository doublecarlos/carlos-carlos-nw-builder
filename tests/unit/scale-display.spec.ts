// How a scale formula is shown: the values a compound one read, the step ladder a `steps` hint
// asks for, the hover card's note and ladder, and the inspector's formula lines.
import { describe, expect, it } from "vitest";
import * as db from "../../src/data/db";
import * as engine from "../../src/engine/engine";
import { stepsProblem, stepsRangeWarning } from "../../src/engine/formula";
import { scaleLadder } from "../../src/engine/scale-steps";
import { bonusInputAddress, writeInput } from "../../src/lib/build-inputs";
import { grantFormulas } from "../../src/lib/bonus-inspector";
import {
  grantRows,
  itemCardRows,
  scaleNote,
  statList,
} from "../../src/lib/item-card-rows";
import type {
  Bonus,
  Build,
  BuildParameterSlot,
  Item,
  ScaleSteps,
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

const stacks = (max: number, value: number) => ({
  type: "number" as const,
  label: "Stacks",
  min: 0,
  max,
  default: value,
});

const overStacks = (max: number): ScaleSteps => ({
  over: "$stacks",
  min: 0,
  max,
  step: 1,
});

/** Halving returns per stack, one stack fewer when your own copy is equipped. */
const pack: Bonus = {
  id: "pack",
  inputs: { stacks: stacks(4, 1) },
  formulas: {
    self: { formula: 'min(equipped("self-ring"), 1)', label: "own copy" },
  },
  grants: [
    {
      stats: { power: 1000 },
      scale: {
        formula: "geometric($stacks + $self, 0.5) - $self",
        label: "stacking multiplier",
        steps: overStacks(4),
      },
    },
  ],
};

const curse: Bonus = {
  id: "curse",
  grants: [
    {
      stats: { power: 100 },
      scale: { formula: 'scaler("scalers.enc") + scaler("scalers.aw")' },
    },
  ],
};

/** No `steps`, so no ladder however few values its input has. */
const swift: Bonus = {
  id: "swift",
  inputs: { stacks: stacks(3, 3) },
  grants: [
    { stats: { power: 10 }, scale: { formula: "clamp($stacks, 0, 6)" } },
  ],
};

/** Only applies from 3 stacks, which its ladder must respect. */
const gated: Bonus = {
  id: "gated",
  inputs: { stacks: stacks(4, 4) },
  grants: [
    {
      when: { input: { key: "stacks", atLeast: 3 } },
      stats: { power: 10 },
      scale: { formula: "$stacks * 2", steps: overStacks(4) },
    },
  ],
};

/** 18 power per full 5s of duration, up to 5. */
const breaker: Bonus = {
  id: "breaker",
  grants: [
    {
      stats: { power: 18 },
      scale: {
        formula: "clamp(floor(duration / 5), 0, 5)",
        steps: { over: "duration", min: 0, max: 25, step: 5 },
      },
    },
  ],
};

/** Scaled by a scaler, laddered over the param behind it. */
const shared: Bonus = {
  id: "shared",
  grants: [
    {
      stats: { power: 100 },
      scale: {
        formula: 'scaler("scalers.enc") * 2',
        steps: { over: 'param("scalers.enc")', min: 0, max: 1, step: 0.5 },
      },
    },
  ],
};

const single: Bonus = {
  id: "single",
  inputs: { stacks: stacks(4, 2) },
  grants: [{ stats: { power: 1 }, scale: { formula: "$stacks" } }],
};

const bonuses = [pack, curse, swift, gated, breaker, shared, single];

const items: Item[] = [
  ...bonuses.map((bonus) => ({
    id: `${bonus.id}-ring`,
    name: `${bonus.id} ring`,
    filter: "rings",
    bonuses: [bonus.id],
  })),
  { id: "self-ring", name: "self ring", filter: "rings" },
];

const scalerParam = (
  id: string,
  label: string,
  value: number,
): BuildParameterSlot => ({
  id,
  label,
  section: "gear",
  type: "build_parameter",
  paramType: "percent",
  path: `scalers.${id}`,
  default: value,
  min: 0,
  max: 1,
  scaler: { mode: "absolute" },
});

const picker = (id: string): Slot => ({
  id,
  label: id,
  section: "gear",
  type: "item_picker",
  filter: "rings",
});

const slotsData: SlotsData = {
  sections: [{ id: "gear", label: "Gear", slotIds: [] }],
  slots: [
    scalerParam("enc", "Encounter Damage", 0.4),
    scalerParam("aw", "At-will Damage", 0.3),
    picker("ring1"),
    picker("ring2"),
  ],
  presets: [],
};
const testDb = db.build(items, bonuses, schema, slotsData);

/** `context` is untyped: a scaler path is an ordinary parameter path. */
function buildWith(
  rings: string[],
  context: Record<string, unknown> = {},
): Build {
  return {
    id: "b",
    name: "b",
    choices: Object.fromEntries(
      rings.map((id, index) => [`ring${index + 1}`, id]),
    ),
    values: {},
    bonusValues: {},
    assignments: {},
    listRows: {},
    disabledSlots: {},
    context: {
      role: "dps",
      toggles: {},
      ...context,
    } as unknown as Build["context"],
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
  };
}

const resolve = (build: Build) => engine.resolveBuild(testDb, build);
const entry = (build: Build, id: string) =>
  resolve(build).bonuses.find((b) => b.id === id)!;
const scaleOf = (build: Build, id: string) => entry(build, id).grants[0].scale!;
const power = (value: number) => statList({ power: value })[0].value;

/** The hover card's grant rows for `id`, with the build's context for ladders. */
function cardGrants(build: Build, id: string) {
  const result = resolve(build);
  const bonus = result.bonuses.find((b) => b.id === id)!;
  return grantRows(bonus, testDb.slots, result.context);
}

/** Each rung as [heading, current, first stat]. */
const rungs = (build: Build, id: string) =>
  cardGrants(build, id)[0].steps!.map(({ heading, active, stats }) => [
    heading,
    active,
    stats[0].value,
  ]);

describe("a compound scale's reads", () => {
  it("names each scaler as a percent, linked by its path", () => {
    expect(scaleOf(buildWith(["curse-ring"]), "curse")).toMatchObject({
      multiplier: 0.7,
      reads: [
        {
          kind: "scaler",
          label: "Encounter Damage",
          text: "40%",
          path: "scalers.enc",
        },
        {
          kind: "scaler",
          label: "At-will Damage",
          text: "30%",
          path: "scalers.aw",
        },
      ],
    });
  });

  it("names an input and a named formula by their labels, once each", () => {
    expect(scaleOf(buildWith(["pack-ring"]), "pack").reads).toEqual([
      { key: "input:stacks", kind: "input", label: "Stacks", text: "1" },
      { key: "named:self", kind: "named", label: "own copy", text: "0" },
    ]);
  });

  it("explains an unlabeled scale at 0 by its values, not its text", () => {
    const build = buildWith(["curse-ring"], { scalers: { enc: 0, aw: 0 } });
    expect(entry(build, "curse").grants[0].gate.unmet).toEqual([
      {
        ok: false,
        label: "multiplier > 0",
        detail: "Encounter Damage: 0%, At-will Damage: 0%",
      },
    ]);
  });

  it("is absent on a single read, whose label already names it", () => {
    const scale = scaleOf(buildWith(["single-ring"]), "single");
    expect(scale.label).toBe("Stacks");
    expect(scale.reads).toBeUndefined();
  });
});

describe("a scale's step ladder", () => {
  const ladderOf = (build: Build, id: string) => {
    const result = resolve(build);
    const bonus = result.bonuses.find((b) => b.id === id)!;
    return scaleLadder(
      bonus.bonus,
      bonus.bonus.grants![0],
      result.context,
      bonus.inputValues,
    )!;
  };

  it("evaluates every value of the input, with the rest of the build as it is", () => {
    const alone = ladderOf(buildWith(["pack-ring"]), "pack");
    expect(alone.steps.map((step) => step.value)).toEqual([
      0, 1, 1.5, 1.75, 1.875,
    ]);
    const withOwn = ladderOf(buildWith(["pack-ring", "self-ring"]), "pack");
    expect(withOwn.steps.map((step) => step.value)).toEqual([
      0, 0.5, 0.75, 0.875, 0.9375,
    ]);
  });

  it("marks where the grant's conditions do not hold", () => {
    expect(ladderOf(buildWith(["gated-ring"]), "gated").steps).toEqual([
      { from: 0, to: 0, value: 0, granted: false },
      { from: 1, to: 1, value: 2, granted: false },
      { from: 2, to: 2, value: 4, granted: false },
      { from: 3, to: 3, value: 6, granted: true },
      { from: 4, to: 4, value: 8, granted: true },
    ]);
  });

  it("moves a scaler along with the param behind it", () => {
    const ladder = ladderOf(buildWith(["shared-ring"]), "shared");
    expect(ladder.steps.map((step) => step.value)).toEqual([0, 1, 2]);
    expect(ladder.label).toBe("Encounter Damage");
  });

  it("needs a hint", () => {
    const result = resolve(buildWith(["swift-ring"]));
    const bonus = result.bonuses.find((b) => b.id === "swift")!;
    expect(
      scaleLadder(bonus.bonus, bonus.bonus.grants![0], result.context),
    ).toBeNull();
  });
});

describe("stepsProblem", () => {
  const owner: Pick<Bonus, "inputs" | "formulas"> = {
    inputs: {
      stacks: stacks(4, 0),
      proc: { type: "boolean", default: false },
    },
    formulas: { twice: { formula: "$stacks * 2" } },
  };
  const steps = (over: string, extra: Partial<ScaleSteps> = {}) => ({
    over,
    min: 0,
    max: 4,
    step: 1,
    ...extra,
  });

  it("accepts an input read through a named formula, a variable or a param", () => {
    expect(stepsProblem(steps("$stacks"), "$twice", owner)).toBeNull();
    expect(stepsProblem(steps("duration"), "duration / 5", owner)).toBeNull();
    expect(
      stepsProblem(steps('param("x")'), 'param("x") + 1', owner),
    ).toBeNull();
  });

  it("rejects what it cannot vary", () => {
    expect(stepsProblem(steps("1 + 2"), "1", owner)).toMatch(
      /must be a \$input/,
    );
    expect(stepsProblem(steps("$twice"), "$twice", owner)).toMatch(
      /not an input/,
    );
    expect(stepsProblem(steps("$proc"), "$stacks", owner)).toMatch(/boolean/);
    expect(stepsProblem(steps("$stacks"), "duration", owner)).toBe(
      "the scale formula does not read $stacks",
    );
  });

  it("rejects a range it cannot list", () => {
    expect(stepsProblem(steps("$stacks", { step: 0 }), "$stacks", owner)).toBe(
      "steps.step must be above 0",
    );
    expect(stepsProblem(steps("$stacks", { min: 5 }), "$stacks", owner)).toBe(
      "steps.min is above steps.max",
    );
    expect(
      stepsProblem(steps("$stacks", { max: 1000 }), "$stacks", owner),
    ).toMatch(/at most 100/);
  });
});

describe("stepsRangeWarning", () => {
  const owner: Pick<Bonus, "inputs"> = { inputs: { stacks: stacks(4, 0) } };

  it("flags a ladder past its input's own bounds", () => {
    expect(stepsRangeWarning(overStacks(4), owner)).toBeNull();
    expect(stepsRangeWarning(overStacks(10), owner)).toBe(
      "steps go past $stacks's own range of 0 to 4; those rows can never be the build's",
    );
    expect(
      stepsRangeWarning({ ...overStacks(4), min: -1 }, owner),
    ).not.toBeNull();
  });

  it("leaves a variable or param alone", () => {
    expect(
      stepsRangeWarning(
        { over: "duration", min: 0, max: 1000, step: 100 },
        owner,
      ),
    ).toBeNull();
  });
});

describe("the hover card", () => {
  it("follows a compound scale's number with what it read, each scaler linked", () => {
    const scale = scaleOf(buildWith(["curse-ring"]), "curse");
    expect(scaleNote(100, "power", [scale], testDb.slots)).toEqual([
      { text: "100 x 0.7 (" },
      { text: "Encounter Damage", slotId: "enc" },
      { text: ": 40%" },
      { text: ", " },
      { text: "At-will Damage", slotId: "aw" },
      { text: ": 30%" },
      { text: ")" },
    ]);
  });

  it("lays a hinted ladder out like tiers, marking the current value", () => {
    const build = buildWith(["pack-ring"]);
    writeInput(build, bonusInputAddress("pack", "stacks"), 3);
    expect(rungs(build, "pack")).toEqual([
      ["Stacks 1", false, power(1000)],
      ["Stacks 2", false, power(1500)],
      ["Stacks 3", true, power(1750)],
      ["Stacks 4", false, power(1875)],
    ]);
    expect(cardGrants(build, "pack")[0].stepNote).toEqual([
      { text: "own copy" },
      { text: ": 0" },
    ]);
  });

  it("previews the ladder while the scale is 0, with no rung current", () => {
    const build = buildWith(["pack-ring"]);
    writeInput(build, bonusInputAddress("pack", "stacks"), 0);
    const [grant] = cardGrants(build, "pack");
    expect(grant.active).toBe(false);
    expect(grant.steps!.every((step) => !step.active)).toBe(true);
  });

  it("leaves out the values where the grant would not apply", () => {
    expect(rungs(buildWith(["gated-ring"]), "gated")).toEqual([
      ["Stacks 3", false, power(60)],
      ["Stacks 4", true, power(80)],
    ]);
  });

  it("marks the last rung the build's value has reached", () => {
    const at = (duration: number) =>
      rungs(buildWith(["breaker-ring"], { duration }), "breaker")
        .filter(([, active]) => active)
        .map(([heading]) => heading);
    expect(at(60)).toEqual(["duration 25s"]);
    expect(at(12)).toEqual(["duration 10s"]);
    expect(at(3)).toEqual([]);
  });

  it("keeps a single line without a hint or without the build's context", () => {
    const [unhinted] = cardGrants(buildWith(["swift-ring"]), "swift");
    expect(unhinted.steps).toBeNull();
    expect(unhinted.stats).not.toBeNull();
    const [noContext] = grantRows(
      entry(buildWith(["pack-ring"]), "pack"),
      testDb.slots,
    );
    expect(noContext.steps).toBeNull();
  });

  it("marks a bonus shaped by a formula, for its inspector link", () => {
    const result = resolve(buildWith(["curse-ring"]));
    const rows = itemCardRows(
      items.find((item) => item.id === "curse-ring")!,
      result.bonuses.filter((b) => b.id === "curse"),
    );
    expect(rows[0].formulaic).toBe(true);
  });
});

describe("the inspector's formula lines", () => {
  it("shows a scaler by its label and its value as a percent", () => {
    const result = resolve(buildWith(["curse-ring"]));
    const bonus = result.bonuses.find((b) => b.id === "curse")!;
    const [grant] = grantFormulas(bonus, result.context, testDb.slots);
    expect(grant.lines[0]).toEqual({
      title: "Scale",
      parts: [
        { text: "Encounter Damage", slotId: "enc" },
        { text: " + " },
        { text: "At-will Damage", slotId: "aw" },
      ],
      substituted: "40% + 30%",
      result: "0.7",
      failed: false,
    });
  });
});
