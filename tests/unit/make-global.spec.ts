// "Make global" as one layer edit, on a small catalog of its own: the new global input reads
// as the input did, each reader keeps the local name that moves a build's stored value, and
// the Global inputs section is added only when the catalog has none.
import { describe, expect, it } from "vitest";
import * as db from "../../src/data/db";
import { emptyOverlay } from "../../src/data/catalog";
import { globalInputDef } from "../../src/engine/global-inputs";
import { makeGlobalOverlay, shadowedEntries } from "../../src/lib/make-global";
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
  name: "hits",
  def: hitsDef,
  readers: [defining("a"), defining("b")],
};

describe("makeGlobalOverlay", () => {
  it("defines the global input as the input was, and every reader keeps the name", () => {
    const { overlay, slot } = makeGlobalOverlay(
      emptyOverlay(),
      catalogWith([options]),
      [],
      request,
    );
    expect(slot).toMatchObject({ globalInput: true, section: "globals" });
    expect(globalInputDef(slot)).toEqual(hitsDef);
    expect(overlay.slots[slot.id]).toEqual(slot);
    for (const id of ["a", "b"])
      expect(overlay.bonuses[id]?.inputs).toEqual({
        hits: { global: slot.id },
      });
  });

  // The id doubles as the path, so it must not land on a value another slot owns.
  it("keeps the id clear of taken ids and parameter paths", () => {
    const { slot } = makeGlobalOverlay(
      emptyOverlay(),
      catalogWith([options]),
      ["globals.recent-hits-2"],
      request,
    );
    expect(slot.path).toBe(slot.id);
    expect(["globals.recent-hits", "globals.recent-hits-2"]).not.toContain(
      slot.id,
    );
  });

  it("adds the Global inputs section only when the catalog has none", () => {
    const missing = makeGlobalOverlay(
      emptyOverlay(),
      catalogWith([options]),
      [],
      request,
    );
    expect(missing.overlay.sections[GLOBAL_INPUTS_SECTION.id]).toEqual(
      GLOBAL_INPUTS_SECTION,
    );
    const present = makeGlobalOverlay(
      emptyOverlay(),
      catalogWith([options, { ...GLOBAL_INPUTS_SECTION, label: "Mine" }]),
      [],
      request,
    );
    expect(present.overlay.sections).toEqual({});
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
