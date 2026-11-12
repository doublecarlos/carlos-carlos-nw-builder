// Global inputs: a value defined once by a flagged build_parameter slot and read by every bonus
// referencing it in its `inputs`, through the same `input` leaf and `$name` a private input uses.
import { describe, expect, it } from "vitest";
import * as db from "../../src/data/db";
import * as catalog from "../../src/data/catalog";
import * as engine from "../../src/engine/engine";
import { inputEntries } from "../../src/engine/inputs";
import { bonusInputAddress, writeInput } from "../../src/lib/build-inputs";
import { seededDefaults } from "../../src/storage/storage";
import type {
  Bonus,
  Build,
  BuildParameterSlot,
  Item,
  Schema,
  Slot,
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

const song: BuildParameterSlot = {
  id: "globals.song",
  label: "Played a song",
  section: "globals",
  type: "build_parameter",
  paramType: "boolean",
  path: "globals.song",
  default: false,
  globalInput: true,
};
const hits: BuildParameterSlot = {
  id: "globals.hits",
  label: "Recent hits",
  section: "globals",
  type: "build_parameter",
  paramType: "number",
  path: "globals.hits",
  min: 0,
  max: 10,
  default: 2,
  globalInput: true,
};

// Two bonuses read the song under different local names; a third has a private input that
// happens to share one of those names.
const ballad: Bonus = {
  id: "ballad",
  name: "Ballad",
  inputs: { song: { global: song.id } },
  grants: [
    { when: { input: { key: "song", is: true } }, stats: { power: 100 } },
  ],
};
const chorus: Bonus = {
  id: "chorus",
  name: "Chorus",
  inputs: { sang: { global: song.id }, hits: { global: hits.id } },
  grants: [
    { when: { input: { key: "sang", is: true } }, stats: { power: 10 } },
    {
      when: { input: { key: "hits", atLeast: 0 } },
      scale: { formula: "$hits" },
      stats: { power: 1 },
    },
  ],
};
const solo: Bonus = {
  id: "solo",
  name: "Solo",
  inputs: { song: { type: "boolean", default: false } },
  grants: [
    { when: { input: { key: "song", is: true } }, stats: { power: 1000 } },
  ],
};

const items: Item[] = [
  { id: "lute", name: "Lute", filter: "gear", bonuses: ["ballad"] },
  { id: "drum", name: "Drum", filter: "gear", bonuses: ["chorus"] },
  { id: "flute", name: "Flute", filter: "gear", bonuses: ["solo"] },
];
const gear = (id: string): Slot => ({
  id,
  label: id,
  section: "gear",
  type: "item_picker",
  filter: "gear",
});
const slots: Slot[] = [gear("a"), gear("b"), gear("c"), song, hits];
const testDb = db.build(items, [ballad, chorus, solo], schema, {
  sections: [
    { id: "gear", label: "Gear", slotIds: [] },
    { id: "globals", label: "Global inputs", slotIds: [] },
  ],
  slots,
  presets: [],
});

function build(choices: Record<string, string>): Build {
  return {
    id: "b",
    name: "b",
    choices,
    values: {},
    bonusValues: {},
    assignments: {},
    listRows: {},
    disabledSlots: {},
    context: { role: "dps" } as Build["context"],
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
  };
}

const applied = (b: Build, bonusId: string) =>
  engine.resolveBuild(testDb, b).bonuses.find((entry) => entry.id === bonusId)
    ?.appliedStats?.power ?? 0;

describe("reading a global input", () => {
  it("reads the slot's default while the build stores nothing", () => {
    const b = build({ a: "lute", b: "drum" });
    expect(applied(b, "ballad")).toBe(0);
    // $hits defaults to the slot's 2.
    expect(applied(b, "chorus")).toBe(2);
  });

  // The point of a global input: one setting gates every reader, whatever it calls it.
  it("gives every reader the one value stored at the slot's path", () => {
    const b = build({ a: "lute", b: "drum" });
    writeInput(b, { store: "context", path: song.path }, true);
    writeInput(b, { store: "context", path: hits.path }, 4);
    expect(applied(b, "ballad")).toBe(100);
    expect(applied(b, "chorus")).toBe(14);
  });

  // A generic local name never merges unrelated procs.
  it("keeps a private input of the same name apart", () => {
    const b = build({ a: "lute", c: "flute" });
    writeInput(b, { store: "context", path: song.path }, true);
    expect(applied(b, "ballad")).toBe(100);
    expect(applied(b, "solo")).toBe(0);
    writeInput(b, bonusInputAddress("solo", "song"), true);
    expect(applied(b, "solo")).toBe(1000);
  });

  it("lists one entry per reader, all at the slot's path", () => {
    const b = build({ a: "lute", b: "drum" });
    const resolved = engine.resolveBuild(testDb, b);
    const songEntries = inputEntries(testDb, b, resolved).filter(
      (entry) => entry.bonusInput?.global === song.id,
    );
    expect(
      songEntries.map((entry) => [entry.slotId, entry.bonusInput?.name]),
    ).toEqual([
      ["a", "song"],
      ["b", "sang"],
    ]);
    for (const entry of songEntries)
      expect(entry.address).toEqual({ store: "context", path: song.path });
  });

  // A stored value means the player set it, which a later migration relies on.
  it("is not seeded into a fresh build", () => {
    const { context } = seededDefaults(slots, testDb);
    expect(context).not.toHaveProperty("globals");
  });
});

describe("catalog.validate: global inputs", () => {
  const messages = (bonus: Bonus, extraSlots: Slot[] = []) =>
    catalog
      .validate(
        [{ ...items[0], bonuses: [bonus.id] }],
        [bonus],
        undefined,
        [],
        [...slots, ...extraSlots],
        [
          { id: "gear", label: "Gear", slotIds: [] },
          { id: "globals", label: "Global inputs", slotIds: [] },
        ],
      )
      .filter((finding) => finding.name === bonus.id)
      .map((finding) => `${finding.level}: ${finding.message}`);

  it("accepts a reference to a global input", () => {
    expect(messages(ballad)).toEqual([]);
  });

  it("rejects a reference with other fields, to an unknown slot or an unflagged one", () => {
    const plain: Slot = {
      id: "plain",
      label: "Plain",
      section: "globals",
      type: "build_parameter",
      paramType: "boolean",
      path: "plain",
    };
    expect(
      messages(
        {
          id: "bad",
          inputs: {
            extra: { global: song.id, default: true } as { global: string },
            unknown: { global: "nope" },
            unflagged: { global: "plain" },
          },
          grants: [
            {
              when: {
                all: [
                  { input: { key: "extra", is: true } },
                  { input: { key: "unknown", is: true } },
                  { input: { key: "unflagged", is: true } },
                ],
              },
              stats: {},
            },
          ],
        },
        [plain],
      ).filter((message) => message.startsWith("error: input")),
    ).toEqual([
      'error: input "extra": a reference to a global input takes no other field (default)',
      'error: input "unknown": "nope" is not a build_parameter slot',
      'error: input "unflagged": "plain" is not a global input; flag the slot with globalInput',
    ]);
  });

  it("checks a reader's leaf against the global input's type", () => {
    expect(
      messages({
        ...ballad,
        grants: [{ when: { input: { key: "song", atLeast: 1 } }, stats: {} }],
      }),
    ).toEqual(['error: grant 1: input "song" is a boolean; use "is"']);
  });

  // A direct read would gate a bonus with no row showing the control.
  it("rejects reading a global input's path directly", () => {
    expect(
      messages({
        id: "direct",
        grants: [
          { when: { param: { key: song.path, is: true } }, stats: {} },
          { scale: { formula: `param("${hits.path}")` }, stats: {} },
        ],
      }),
    ).toEqual([
      `error: grant 2 scale: param("${hits.path}") is a global input; declare it in the bonus's inputs and read it as $name`,
      `error: grant 1: param "${song.path}" is a global input; declare it in the bonus's inputs and read it with an "input" condition`,
    ]);
  });

  it("rejects a flagged slot that is quick, a scaler, a list or read by the engine", () => {
    const flagged = (overrides: Partial<BuildParameterSlot>): Slot => ({
      ...song,
      id: `flag.${overrides.path}`,
      ...overrides,
    });
    const findings = catalog.validateSlots([
      flagged({ path: "q", quick: true }),
      flagged({
        path: "s",
        paramType: "number",
        default: 0,
        scaler: { mode: "absolute" },
      }),
      flagged({ path: "l", paramType: "list", options: [] }),
      flagged({ path: "toggles.combat" }),
      flagged({ path: "enemies", paramType: "number", default: 0 }),
    ]);
    expect(findings.map((finding) => finding.message)).toEqual([
      "flag.q: a global input has no row of its own, so it cannot be quick",
      "flag.s: a global input is read through bonus inputs, not as a scaler",
      "flag.l: a global input is a boolean, number or percent",
      'flag.toggles.combat: path "toggles.combat" is read directly by the engine or a condition, not through bonus inputs',
      'flag.enemies: path "enemies" is read directly by the engine or a condition, not through bonus inputs',
    ]);
  });

  // A preset or replacement seed writes `bonusValues`, where a global input is never stored.
  it("rejects bonusValues naming a global input", () => {
    expect(
      catalog.bonusValuesProblems(
        { ballad: { input: { song: true } } },
        new Map([["ballad", ballad]]),
      ),
    ).toEqual([
      'bonusValues "ballad": input "song" is a global input, stored on the build rather than the bonus',
    ]);
  });
});
