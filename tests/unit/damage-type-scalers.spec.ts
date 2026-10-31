// Damage-type shares: absolute scalers that claim no item, reached by a grant only through a
// `scaler(...)` scale. A grant stores the game's own value and the share weights it, so a
// share of 0 (the default) turns the grant off. Three shapes cover the ways a grant reads
// them: a sum over every power type, a stack ladder and a plain unconditional grant.
import { describe, it, expect } from "vitest";
import * as engine from "../../src/engine/engine";
import {
  bonusOf,
  picker,
  rowOf,
  testBuild,
  testDb,
  testSchema,
} from "./engine-fixtures";
import type { Bonus, Build, BuildParameterSlot } from "../../src/types";

const share = (key: string): BuildParameterSlot => ({
  id: `scalers.${key}`,
  label: key,
  section: "scalers",
  type: "build_parameter",
  paramType: "percent",
  path: `scalers.${key}`,
  default: 0,
  min: 0,
  max: 1,
  scaler: { mode: "absolute" },
});

const ENCOUNTER = 'scaler("scalers.encounterDamage")';

const bonuses: Bonus[] = [
  {
    id: "all-powers",
    grants: [
      {
        when: { toggle: "combat" },
        stats: { outgoing_damage: 0.15 },
        scale: {
          formula: `${ENCOUNTER} + scaler("scalers.atWillDamage") + scaler("scalers.dailyDamage")`,
        },
      },
    ],
  },
  // A base grant plus a per-stack grant, both off at zero stacks.
  {
    id: "ladder",
    inputs: {
      stacks: { type: "number", label: "Stacks", min: 0, max: 5, default: 5 },
    },
    grants: [
      {
        when: { toggle: "combat", input: { key: "stacks", atLeast: 1 } },
        stats: { outgoing_damage: 0.2 },
        scale: { formula: ENCOUNTER },
      },
      {
        when: { toggle: "combat", input: { key: "stacks", atLeast: 1 } },
        stats: { outgoing_damage: 0.02 },
        scale: {
          formula: `$stacks * ${ENCOUNTER}`,
          steps: { over: "$stacks", min: 1, max: 5, step: 1 },
        },
      },
    ],
  },
  {
    id: "collar",
    grants: [
      { stats: { outgoing_damage_mult: 0.05 }, scale: { formula: ENCOUNTER } },
    ],
  },
];

const sharesDb = testDb(
  testSchema([
    "il",
    "combined_rating",
    "outgoing_damage",
    "outgoing_damage_mult",
  ]),
  [
    { id: "feat-a", name: "Feat A", filter: "feat", bonuses: ["all-powers"] },
    { id: "feat-b", name: "Feat B", filter: "feat", bonuses: ["ladder"] },
    {
      id: "collar",
      name: "Collar",
      filter: "collar",
      il: 1000,
      combined_rating: 900,
      bonuses: ["collar"],
    },
  ],
  bonuses,
  [
    share("encounterDamage"),
    share("atWillDamage"),
    share("dailyDamage"),
    picker("feats.a", "feat"),
    picker("feats.b", "feat"),
    picker("mounts.collar", "collar"),
  ],
);

const CHOICES = {
  "feats.a": "feat-a",
  "feats.b": "feat-b",
  "mounts.collar": "collar",
};

const SHARES = { encounterDamage: 0.4, atWillDamage: 0.05, dailyDamage: 0.05 };

function resolve(
  scalers: Record<string, unknown> = {},
  bonusValues: Build["bonusValues"] = {},
) {
  return engine.resolveBuild(
    sharesDb,
    testBuild({
      choices: CHOICES,
      bonusValues,
      context: { toggles: { combat: true }, scalers },
    }),
  );
}

function bonusStats(result: ReturnType<typeof resolve>, id: string) {
  const entry = bonusOf(result, id);
  expect(entry?.active, `${id} active`).toBe(true);
  return entry!.appliedStats!;
}

const stacksOf = (stacks: number) => ({ ladder: { input: { stacks } } });

describe("damage-type scaled grants", () => {
  it("weight each grant's stored value by the shares it reads", () => {
    const result = resolve(SHARES);
    // 0.30 at the default five stacks x 0.40 encounters.
    expect(bonusStats(result, "ladder").outgoing_damage).toBeCloseTo(0.12, 9);
    // 0.05 x 0.40 encounters.
    expect(bonusStats(result, "collar").outgoing_damage_mult).toBeCloseTo(
      0.02,
      9,
    );
    // 0.15 x (0.40 + 0.05 + 0.05): one grant reading all three shares.
    expect(bonusStats(result, "all-powers").outgoing_damage).toBeCloseTo(
      0.075,
      9,
    );
  });

  it("stay inactive at the default shares of 0, without reporting an error", () => {
    const result = resolve();
    const entries = ["ladder", "collar", "all-powers"].map((id) =>
      bonusOf(result, id),
    );
    expect(entries.map((entry) => entry?.active)).toEqual([
      false,
      false,
      false,
    ]);
    expect(entries.map((entry) => entry?.appliedStats)).toEqual([
      null,
      null,
      null,
    ]);
    expect(result.errors.filter((e) => e.kind === "formula")).toEqual([]);
  });

  it("give a stack ladder nothing at zero stacks", () => {
    const entry = bonusOf(resolve(SHARES, stacksOf(0)), "ladder");
    expect(entry?.active).toBe(false);
    expect(entry?.appliedStats).toBeNull();
  });

  it("climb a stack ladder by the per-stack grant", () => {
    const at = (stacks: number) =>
      bonusStats(resolve({ encounterDamage: 1 }, stacksOf(stacks)), "ladder")
        .outgoing_damage;
    // The base and the per-stack grant are summed, so compare past float noise.
    [0.22, 0.24, 0.26, 0.28, 0.3].forEach((expected, index) =>
      expect(at(index + 1)).toBeCloseTo(expected, 10),
    );
  });

  it("leave the carrying item's own stats unscaled", () => {
    // A share without `applies` claims no item: it only reaches grants that name it.
    const row = rowOf(resolve({ encounterDamage: 0.4 }), "mounts.collar");
    expect(row.stats.il).toBe(1000);
    expect(row.stats.combined_rating).toBe(900);
  });
});
