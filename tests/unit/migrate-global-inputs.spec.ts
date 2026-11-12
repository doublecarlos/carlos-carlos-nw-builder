// Promoting a bonus input to a global input, or demoting it back, must carry the value a build
// stores to its new address: without the move, every stored build silently resets to the
// default. Built on a small catalog of its own, in two versions: each bonus's input private,
// and the same inputs read through one global input.
import { describe, expect, it } from "vitest";
import * as db from "../../src/data/db";
import { sameContent } from "../../src/storage/storage";
import {
  migrateGlobalInputs,
  promotionMoves,
} from "../../src/storage/migrate-global-inputs";
import type {
  Bonus,
  Build,
  BuildParameterSlot,
  Db,
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
  roles: {},
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

const grants: Bonus["grants"] = [
  { when: { input: { key: "song", is: true } }, stats: { power: 1 } },
];
const privateSong = (id: string): Bonus => ({
  id,
  name: id,
  inputs: { song: { type: "boolean", default: false } },
  grants,
});
const readsSong = (id: string): Bonus => ({
  id,
  name: id,
  inputs: { song: { global: song.id } },
  grants,
});

const items: Item[] = [
  { id: "lute", name: "Lute", filter: "gear", bonuses: ["ballad"] },
  { id: "drum", name: "Drum", filter: "gear", bonuses: ["chorus"] },
];
const gear = (id: string): Slot => ({
  id,
  label: id,
  section: "gear",
  type: "item_picker",
  filter: "gear",
});

function catalogWith(bonuses: Bonus[], extra: Slot[] = []): Db {
  return db.build(items, bonuses, schema, {
    sections: [
      { id: "gear", label: "Gear", slotIds: [] },
      { id: "globals", label: "Global inputs", slotIds: [] },
    ],
    slots: [gear("a"), gear("b"), ...extra],
    presets: [],
  });
}

const privateDb = catalogWith([privateSong("ballad"), privateSong("chorus")]);
const promotedDb = catalogWith(
  [readsSong("ballad"), readsSong("chorus")],
  [song],
);

function build(
  choices: Record<string, string> = {},
  bonusValues: Build["bonusValues"] = {},
  context: Record<string, unknown> = {},
): Build {
  return {
    id: "b",
    name: "b",
    choices,
    values: {},
    bonusValues,
    assignments: {},
    listRows: {},
    disabledSlots: {},
    context: context as unknown as Build["context"],
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
  };
}

const sung = (value: boolean) => ({ input: { song: value } });

describe("promotion", () => {
  it("moves a stored private value to the global input's path", () => {
    const b = build({ a: "lute" }, { ballad: sung(true) });
    expect(migrateGlobalInputs(promotedDb, b)).toBe(true);
    expect(b.context).toEqual({ globals: { song: true } });
    expect(b.bonusValues).toEqual({});
  });

  // Every load, import and edit runs the pass, so a second run must find nothing to do.
  it("is idempotent", () => {
    const b = build({ a: "lute" }, { ballad: sung(true) });
    migrateGlobalInputs(promotedDb, b);
    const once = structuredClone(b);
    expect(migrateGlobalInputs(promotedDb, b)).toBe(false);
    expect(b).toEqual(once);
  });

  it("leaves a value the player already set on the path alone", () => {
    const b = build(
      { a: "lute" },
      { ballad: sung(true) },
      { globals: { song: false } },
    );
    migrateGlobalInputs(promotedDb, b);
    expect(b.context).toEqual({ globals: { song: false } });
    // The private address is read by nothing now, so a later reset cannot bring it back.
    expect(b.bonusValues).toEqual({});
  });

  it("prefers the equipped reader when readers disagree", () => {
    // `chorus` comes after `ballad` in catalog order, but only `chorus` is equipped.
    const b = build({ a: "drum" }, { ballad: sung(false), chorus: sung(true) });
    migrateGlobalInputs(promotedDb, b);
    expect(b.context).toEqual({ globals: { song: true } });
    expect(b.bonusValues).toEqual({});
  });

  it("prefers the reader in the earlier slot when both are equipped", () => {
    const b = build(
      { a: "drum", b: "lute" },
      { ballad: sung(false), chorus: sung(true) },
    );
    migrateGlobalInputs(promotedDb, b);
    expect(b.context).toEqual({ globals: { song: true } });
  });

  it("falls back to catalog order when no reader is equipped", () => {
    const b = build({}, { ballad: sung(false), chorus: sung(true) });
    migrateGlobalInputs(promotedDb, b);
    expect(b.context).toEqual({ globals: { song: false } });
  });

  // An input never changes meaning in place: a number read as a boolean would be a new fact.
  it("drops a stored value of the other type rather than reinterpreting it", () => {
    const b = build({ a: "lute" }, { ballad: { input: { song: 3 } } });
    migrateGlobalInputs(promotedDb, b);
    expect(b.context).toEqual({});
    expect(b.bonusValues).toEqual({});
  });

  it("does nothing on a catalog without global inputs", () => {
    expect(promotionMoves(privateDb)).toEqual([]);
  });

  // Otherwise `sameContent` reads every promoted build as changed since its download.
  it("moves the downloaded snapshot the same way", () => {
    const b = build({ a: "lute" }, { ballad: sung(true) });
    const { downloaded: _none, ...snapshot } = structuredClone(b);
    b.downloaded = { snapshot, at: 1 };
    migrateGlobalInputs(promotedDb, b);
    expect(b.downloaded.snapshot.context).toEqual({ globals: { song: true } });
    expect(sameContent<Build>(b, b.downloaded.snapshot)).toBe(true);
  });
});

describe("demotion", () => {
  it("moves the path's value back to each reader and clears the path", () => {
    const b = build({ a: "lute" }, {}, { globals: { song: true } });
    expect(migrateGlobalInputs(privateDb, b, promotedDb)).toBe(true);
    expect(b.bonusValues).toEqual({ ballad: sung(true), chorus: sung(true) });
    expect(b.context).toEqual({});
  });

  it("round-trips with promotion", () => {
    const b = build({ a: "lute" }, { ballad: sung(true) });
    const before = structuredClone(b);
    migrateGlobalInputs(promotedDb, b, privateDb);
    migrateGlobalInputs(privateDb, b, promotedDb);
    // Demotion hands the value to every reader, the one that held it included.
    expect(b.bonusValues).toEqual({ ballad: sung(true), chorus: sung(true) });
    migrateGlobalInputs(promotedDb, b, privateDb);
    migrateGlobalInputs(privateDb, b, promotedDb);
    expect(b.context).toEqual(before.context);
  });

  it("keeps the path while another reader still references it", () => {
    const partly = catalogWith(
      [privateSong("ballad"), readsSong("chorus")],
      [song],
    );
    const b = build({ a: "lute" }, {}, { globals: { song: true } });
    migrateGlobalInputs(partly, b, promotedDb);
    expect(b.bonusValues).toEqual({ ballad: sung(true) });
    expect(b.context).toEqual({ globals: { song: true } });
  });

  it("needs the previous catalog, as the current one alone cannot tell", () => {
    const b = build({ a: "lute" }, {}, { globals: { song: true } });
    expect(migrateGlobalInputs(privateDb, b)).toBe(false);
    expect(b.context).toEqual({ globals: { song: true } });
  });
});
