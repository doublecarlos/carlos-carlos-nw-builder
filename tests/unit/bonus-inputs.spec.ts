// Bonus inputs: values a bonus declares for the player to set, read by its grants' `input` leaf.
import { describe, expect, it } from "vitest";
import * as db from "../../src/data/db";
import * as catalog from "../../src/data/catalog";
import { toBonusesFile } from "../../src/data/catalogExport";
import * as engine from "../../src/engine/engine";
import { explain } from "../../src/engine/conditions";
import { inputEntries, numberControl } from "../../src/engine/inputs";
import { bonusInputAddress, writeInput } from "../../src/lib/build-inputs";
import { buildDraft, toBonus } from "../../src/lib/bonus-draft";
import type {
  Bonus,
  Build,
  EvalContext,
  Item,
  ResolvedInput,
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

const proc: Bonus = {
  id: "proc",
  name: "Proc",
  inputs: {
    active: { type: "boolean", default: false, label: "Proc" },
    stacks: { type: "number", min: 0, max: 5, default: 2, label: "Stacks" },
  },
  grants: [
    { when: { input: { key: "active", is: true } }, stats: { power: 100 } },
    { when: { input: { key: "stacks", atLeast: 3 } }, stats: { power: 10 } },
  ],
};

const ring: Item = {
  id: "ring",
  name: "Test Ring",
  filter: "rings",
  bonuses: ["proc"],
};
const slots: Slot[] = [
  {
    id: "ring1",
    label: "Ring 1",
    section: "gear",
    type: "item_picker",
    filter: "rings",
  },
  {
    id: "ring2",
    label: "Ring 2",
    section: "gear",
    type: "item_picker",
    filter: "rings",
  },
];
const slotsData: SlotsData = {
  sections: [{ id: "gear", label: "Gear", slotIds: [] }],
  slots,
  presets: [],
};
const testDb = db.build([ring], [proc], schema, slotsData);

function emptyBuild(overrides: Partial<Build> = {}): Build {
  return {
    id: "b",
    name: "b",
    choices: {},
    values: {},
    bonusValues: {},
    assignments: {},
    occurrenceInputs: {},
    listRows: {},
    disabledSlots: {},
    context: { role: "dps" } as Build["context"],
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    ...overrides,
  };
}

const procEntry = (build: Build) =>
  engine.resolveBuild(testDb, build).bonuses.find((b) => b.id === "proc")!;

function ctx(
  inputs: Record<string, Omit<ResolvedInput, "format">>,
): EvalContext {
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
    inputs: new Map(
      Object.entries(inputs).map(([key, input]) => [
        key,
        { ...input, format: String },
      ]),
    ),
  };
}

describe("the input leaf", () => {
  it("compares a boolean input with `is`, explained by its label", () => {
    const result = explain(
      { input: { key: "active", is: true } },
      ctx({ active: { label: "Proc", value: false } }),
    );
    expect(result.ok).toBe(false);
    expect(result.leaves[0]).toMatchObject({
      label: "Proc is on",
      detail: "you have off",
    });
  });

  it("compares a number input by range", () => {
    const inputs = { stacks: { label: "Stacks", value: 6 } };
    const result = explain(
      { input: { key: "stacks", atLeast: 7 } },
      ctx(inputs),
    );
    expect(result.ok).toBe(false);
    expect(result.leaves[0]).toMatchObject({
      label: "Stacks ≥ 7",
      detail: "you have 6",
    });
    expect(
      explain({ input: { key: "stacks", below: 7 } }, ctx(inputs)).ok,
    ).toBe(true);
  });

  it("shows a percent input's bounds and value as percentages", () => {
    const bonus: Bonus = {
      id: "share",
      inputs: { share: { type: "percent", min: 0, max: 1, default: 0.25 } },
      grants: [
        {
          when: { input: { key: "share", atLeast: 0.5 } },
          stats: { power: 1 },
        },
      ],
    };
    const shareDb = db.build(
      [{ ...ring, bonuses: ["share"] }],
      [bonus],
      schema,
      slotsData,
    );
    const [entry] = engine.resolveBuild(
      shareDb,
      emptyBuild({ choices: { ring1: "ring" } }),
    ).bonuses;
    expect(entry.gate.leaves[0]).toMatchObject({
      label: "share ≥ 50%",
      detail: "you have 25%",
    });
  });

  it("fails closed on an input the bonus does not declare", () => {
    const result = explain({ input: { key: "missing", is: true } }, ctx({}));
    expect(result.ok).toBe(false);
    expect(result.leaves[0].detail).toBe("unknown input");
  });
});

describe("resolving bonus inputs", () => {
  const withRing = (overrides: Partial<Build> = {}) =>
    emptyBuild({ choices: { ring1: "ring" }, ...overrides });

  it("reads each input's default when nothing is stored", () => {
    const entry = procEntry(withRing());
    expect(entry.inputValues).toEqual({ active: false, stacks: 2 });
    expect(entry.active).toBe(false);
  });

  it("gates grants on the stored values", () => {
    const build = withRing();
    writeInput(build, bonusInputAddress("proc", "active"), true);
    writeInput(build, bonusInputAddress("proc", "stacks"), 3);
    const entry = procEntry(build);
    expect(entry.inputValues).toEqual({ active: true, stacks: 3 });
    expect(entry.stats).toEqual({ power: 110 });
  });

  it("shares one value across every copy of the bonus", () => {
    const stackingDb = db.build(
      [ring],
      [{ ...proc, stacking: "perSource" }],
      schema,
      slotsData,
    );
    const build = withRing({ choices: { ring1: "ring", ring2: "ring" } });
    writeInput(build, bonusInputAddress("proc", "active"), true);
    const entry = engine.resolveBuild(stackingDb, build).bonuses[0];
    expect(entry.sources).toHaveLength(2);
    expect(entry.appliedStats).toEqual({ power: 200 });
  });
});

describe("the bonusInput kind", () => {
  it("lists each input once, on the bonus's anchor", () => {
    const build = emptyBuild({ choices: { ring2: "ring", ring1: "ring" } });
    const entries = inputEntries(
      testDb,
      build,
      engine.resolveBuild(testDb, build),
    ).filter((entry) => entry.kind === "bonusInput");
    expect(entries.map((entry) => [entry.spec.label, entry.slotId])).toEqual([
      ["Proc", "ring1"],
      ["Stacks", "ring1"],
    ]);
    expect(entries[0].spec).toMatchObject({ type: "boolean", min: 0, max: 1 });
    expect(entries[0].itemId).toBe("ring");
  });

  it("reports a stored value outside its bounds", () => {
    const build = emptyBuild({ choices: { ring1: "ring" } });
    writeInput(build, bonusInputAddress("proc", "stacks"), 9);
    const errors = engine
      .resolveBuild(testDb, build)
      .errors.filter((error) => error.kind === "outOfRange");
    expect(errors).toHaveLength(1);
    expect(errors[0].slotId).toBe("ring1");
    expect(errors[0].address).toEqual(bonusInputAddress("proc", "stacks"));
  });
});

describe("numberControl", () => {
  it("steps a number with both bounds, unless asked for a field", () => {
    expect(numberControl({ type: "number", min: 0, max: 5 })).toBe("stepper");
    expect(
      numberControl({ type: "number", min: 0, max: 5, control: "field" }),
    ).toBe("field");
  });

  it("keeps a field where a stepper has nothing to step within", () => {
    expect(numberControl({ type: "number", min: 0 })).toBe("field");
    expect(numberControl({ type: "percent", min: 0, max: 1 })).toBe("field");
    expect(numberControl({ type: "number", min: 0, control: "stepper" })).toBe(
      "field",
    );
  });
});

describe("catalog.validate: bonus inputs", () => {
  const messages = (bonus: Bonus) =>
    catalog
      .validate([{ ...ring, bonuses: [bonus.id] }], [bonus])
      .filter((finding) => finding.name === bonus.id)
      .map((finding) => `${finding.level}: ${finding.message}`);

  it("accepts a well-formed bonus", () => {
    expect(messages(proc)).toEqual([]);
  });

  it("rejects a leaf naming an input the bonus does not declare", () => {
    expect(
      messages({
        id: "b",
        grants: [{ when: { input: { key: "nope", is: true } }, stats: {} }],
      }),
    ).toEqual([
      'error: grant 1: input "nope" is not declared by this bonus; the condition can never be active',
    ]);
  });

  it("checks a leaf's comparison against the input's type", () => {
    expect(
      messages({
        ...proc,
        grants: [
          { when: { input: { key: "active", atLeast: 1 } }, stats: {} },
          {
            variants: [
              { when: { input: { key: "stacks", is: true } }, stats: {} },
            ],
          },
        ],
      }),
    ).toEqual([
      'error: grant 1: input "active" is a boolean; use "is"',
      'error: grant 2 variant: input "stacks" is a number; use atLeast/below/exactly',
    ]);
  });

  it("checks names, types, bounds and defaults", () => {
    expect(
      messages({
        id: "b",
        inputs: {
          "1st": { type: "boolean", default: false },
          flag: { type: "boolean", default: 1 },
          count: { type: "number", default: 3 },
          odd: { type: "text" as "number", default: 0 },
        },
        grants: [
          {
            when: {
              all: [
                { input: { key: "1st", is: true } },
                { input: { key: "flag", is: true } },
                { input: { key: "count", atLeast: 1 } },
                { input: { key: "odd", atLeast: 1 } },
              ],
            },
            stats: {},
          },
        ],
      }),
    ).toEqual([
      'error: input "1st": a name is a letter or _ then letters, digits or _',
      'error: input "flag": a boolean\'s default is true or false',
      'error: input "count" has a non-numeric min/max/default',
      'error: input "odd": type must be boolean, number or percent',
    ]);
  });

  it("checks a declared control", () => {
    expect(
      messages({
        ...proc,
        inputs: {
          ...proc.inputs,
          share: {
            type: "percent",
            min: 0,
            max: 1,
            default: 0,
            control: "stepper",
          },
          odd: {
            type: "number",
            min: 0,
            max: 1,
            default: 0,
            control: "dial" as "field",
          },
        },
        grants: [
          ...proc.grants!,
          {
            when: {
              all: [
                { input: { key: "share", atLeast: 0.5 } },
                { input: { key: "odd", atLeast: 1 } },
              ],
            },
            stats: {},
          },
        ],
      }),
    ).toEqual([
      'error: input "share": a stepper needs a number with both min and max',
      'error: input "odd": control must be "stepper" or "field"',
    ]);
  });

  it("checks a build parameter's control", () => {
    const findings = catalog.validateSlots([
      {
        id: "p",
        label: "P",
        section: "options",
        type: "build_parameter",
        paramType: "number",
        path: "p",
        min: 0,
        control: "stepper",
      },
    ]);
    expect(findings.map((finding) => finding.message)).toContain(
      "p: a stepper needs a number with both min and max",
    );
  });

  it("warns about an input nothing reads", () => {
    expect(messages({ ...proc, grants: [proc.grants![0]] })).toEqual([
      'warn: input "stacks" is never read by a condition or formula',
    ]);
  });
});

describe("carrying inputs through export and the bonus form", () => {
  it("exports inputs after the name, keys in canonical order", () => {
    const file = toBonusesFile([
      {
        id: "proc",
        name: "Proc",
        grants: [],
        inputs: {
          stacks: {
            default: 1,
            control: "field",
            max: 5,
            min: 0,
            type: "number",
          },
        },
      },
    ]);
    const [exported] = JSON.parse(file);
    expect(Object.keys(exported)).toEqual(["id", "name", "inputs", "grants"]);
    expect(Object.keys(exported.inputs.stacks)).toEqual([
      "type",
      "min",
      "max",
      "control",
      "default",
    ]);
  });

  it("keeps a bonus's inputs when the form saves it", () => {
    expect(toBonus(buildDraft(proc)).inputs).toEqual(proc.inputs);
  });
});
