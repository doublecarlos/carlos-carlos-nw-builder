// "Make global" as one layer edit, on a small catalog of its own: the new global input reads
// as the input did, each reader keeps the local name that moves a build's stored value, and
// the Global inputs section is added only when the catalog has none.
import { describe, expect, it } from "vitest";
import * as db from "../../src/data/db";
import { emptyOverlay } from "../../src/data/catalog";
import { globalInputDef } from "../../src/engine/global-inputs";
import {
  defaultGlobalId,
  globalIdError,
  makeGlobalOverlay,
  shadowedEntries,
  takenGlobalIds,
  type TakenGlobalIds,
} from "../../src/lib/make-global";
import { GLOBAL_INPUTS_SECTION } from "../../src/lib/slot-draft";
import type {
  Bonus,
  InputDef,
  Layer,
  Schema,
  Slot,
  SlotSection,
} from "../../src/types";

const schema: Schema = {
  stats: [],
  statByKey: {},
  statKeys: [],
  multiplicativeStats: [],
  ratingStats: [],
  abilityStats: [],
  ratingConversion: [],
  statContributions: [],
  forteSplit: {},
  roles: {},
};

const hitsDef: InputDef = {
  type: "number",
  default: 2,
  min: 0,
  max: 10,
  label: "Recent hits",
};
const defining = (id: string): Bonus => ({
  id,
  name: id,
  inputs: { hits: hitsDef },
  grants: [],
});

/** A parameter already on the path the new global input would be named after. */
const clash: Slot = {
  id: "options.hits",
  label: "Hits",
  section: "options",
  type: "build_parameter",
  paramType: "number",
  path: "globals.recent-hits",
};

function catalogWith(sections: SlotSection[]) {
  return db.build([], [defining("a"), defining("b")], schema, {
    sections,
    slots: [clash],
    presets: [],
  });
}

const options: SlotSection = { id: "options", label: "Options", slotIds: [] };
const request = {
  id: "globals.recentHits",
  name: "hits",
  def: hitsDef,
  readers: [defining("a"), defining("b")],
};

const NONE_TAKEN: TakenGlobalIds = { ids: [], paths: [] };

describe("makeGlobalOverlay", () => {
  it("defines the global input as the input was, and every reader keeps the name", () => {
    const { overlay, slot } = makeGlobalOverlay(
      emptyOverlay(),
      catalogWith([options]),
      NONE_TAKEN,
      request,
    );
    expect(slot).toMatchObject({
      id: request.id,
      path: request.id,
      globalInput: true,
      section: "globals",
    });
    expect(globalInputDef(slot)).toEqual(hitsDef);
    expect(overlay.slots[slot.id]).toEqual(slot);
    for (const id of ["a", "b"])
      expect(overlay.bonuses[id]?.inputs).toEqual({
        hits: { global: slot.id },
      });
  });

  // The dialog checks the id first, so a taken one reaching here is a bug, not a rename.
  it("refuses an id that is not free instead of renaming it", () => {
    const catalog = catalogWith([options]);
    expect(() =>
      makeGlobalOverlay(emptyOverlay(), catalog, takenGlobalIds(catalog, []), {
        ...request,
        id: "globals.recent-hits",
      }),
    ).toThrow();
  });

  it("adds the Global inputs section only when the catalog has none", () => {
    const missing = makeGlobalOverlay(
      emptyOverlay(),
      catalogWith([options]),
      NONE_TAKEN,
      request,
    );
    expect(missing.overlay.sections[GLOBAL_INPUTS_SECTION.id]).toEqual(
      GLOBAL_INPUTS_SECTION,
    );
    const present = makeGlobalOverlay(
      emptyOverlay(),
      catalogWith([options, { ...GLOBAL_INPUTS_SECTION, label: "Mine" }]),
      NONE_TAKEN,
      request,
    );
    expect(present.overlay.sections).toEqual({});
  });
});

// The id doubles as the path, and paths nest in the build's context, so a new global input
// must not land on, above or below a value another slot owns.
describe("global input ids", () => {
  const taken: TakenGlobalIds = {
    ids: ["options.hits", "globals.recent-hits-2"],
    paths: ["globals.recent-hits", "globals.location.enclave"],
  };

  it("offers globals.<label> first, numbered past taken ids and paths", () => {
    expect(defaultGlobalId("hits", hitsDef, NONE_TAKEN)).toBe(
      "globals.recent-hits",
    );
    expect(defaultGlobalId("hits", hitsDef, taken)).toBe(
      "globals.recent-hits-3",
    );
    expect(globalIdError(defaultGlobalId("hits", hitsDef, taken), taken)).toBe(
      null,
    );
  });

  // No number frees an id below a taken path, so the default stops instead of searching.
  it("offers the stem when a taken path sits above every candidate", () => {
    const above = { ids: [], paths: ["globals"] };
    const id = defaultGlobalId("hits", hitsDef, above);
    expect(id).toBe("globals.recent-hits");
    expect(globalIdError(id, above)).not.toBe(null);
  });

  it("accepts an id under the naming convention", () => {
    expect(globalIdError("globals.enemyTier.boss", taken)).toBe(null);
    expect(globalIdError("globals.location.sword-coast", taken)).toBe(null);
  });

  it("rejects a taken id or path", () => {
    expect(globalIdError("options.hits", taken)).not.toBe(null);
    expect(globalIdError("globals.recent-hits-2", taken)).not.toBe(null);
    expect(globalIdError("globals.recent-hits", taken)).not.toBe(null);
  });

  it("rejects an id above or below a taken path", () => {
    expect(globalIdError("globals.location", taken)).not.toBe(null);
    expect(globalIdError("globals.recent-hits.max", taken)).not.toBe(null);
  });

  // Outside `globals.` an id could land on a path the engine reads directly.
  it("rejects an empty id, one outside globals. and a malformed one", () => {
    for (const id of [
      "",
      "globals",
      "health",
      "globals.",
      "globals..a",
      "globals.a b",
    ])
      expect(globalIdError(id, NONE_TAKEN)).not.toBe(null);
  });
});

describe("shadowedEntries", () => {
  const layer = (id: string, enabled: boolean, bonuses: string[]): Layer => ({
    id,
    name: id,
    enabled,
    overlay: {
      ...emptyOverlay(),
      bonuses: Object.fromEntries(bonuses.map((b) => [b, defining(b)])),
    },
  });

  // Only an enabled layer above wins over the edited one.
  it("names the enabled layers above the edited one", () => {
    const layers = [
      layer("top", true, ["a"]),
      layer("off", false, ["b"]),
      layer("edited", true, ["a", "b", "c"]),
      layer("below", true, ["c"]),
    ];
    expect(shadowedEntries(layers, "edited", "bonuses")).toEqual(
      new Map([["a", "top"]]),
    );
  });

  // A deletion marker removes the entry rather than overriding it.
  it("passes over a deletion marker above", () => {
    const top = layer("top", true, []);
    top.overlay.bonuses.a = null;
    expect(
      shadowedEntries([top, layer("edited", true, ["a"])], "edited", "bonuses"),
    ).toEqual(new Map());
  });
});
