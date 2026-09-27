// Builds and layers saved while `values[slotId]` held item stats and `bonusId:stat` keys side
// by side.
import { describe, expect, it } from "vitest";
import * as storage from "../../src/storage/storage";

describe("normalize", () => {
  it("nests an item's stats under the slot's `stat`", () => {
    const build = storage.normalize({
      values: { "gear.head": { power: 500 } },
    });
    expect(build.values).toEqual({ "gear.head": { stat: { power: 500 } } });
    expect(build.bonusValues).toEqual({});
  });

  it("moves a bonus's stats out to `bonusValues`", () => {
    const build = storage.normalize({
      values: { "gear.ring1": { power: 5, "proc:crit": 0.1 } },
    });
    expect(build.values).toEqual({ "gear.ring1": { stat: { power: 5 } } });
    expect(build.bonusValues).toEqual({ proc: { stat: { crit: 0.1 } } });
  });

  it("keeps the first slot's value when several slots held one, in slot order", () => {
    const build = storage.normalize({
      values: {
        "gear.ring2": { "proc:crit": 0.2 },
        "gear.ring1": { "proc:crit": 0.1 },
      },
    });
    expect(build.bonusValues).toEqual({ proc: { stat: { crit: 0.1 } } });
    expect(build.values).toEqual({});
  });

  it("prefers a value already in `bonusValues`", () => {
    const build = storage.normalize({
      values: { "gear.ring1": { "proc:crit": 0.1 } },
      bonusValues: { proc: { stat: { crit: 0.3 } } },
    });
    expect(build.bonusValues).toEqual({ proc: { stat: { crit: 0.3 } } });
  });

  it("is a no-op on an already-migrated build", () => {
    const once = storage.normalize({
      values: { "gear.ring1": { power: 5, "proc:crit": 0.1 } },
    });
    const twice = storage.normalize(once);
    expect(twice.values).toEqual(once.values);
    expect(twice.bonusValues).toEqual(once.bonusValues);
  });

  it("drops what is not a number, and keeps a boolean input", () => {
    const build = storage.normalize({
      values: { "gear.ring1": { power: "x", stat: { crit: null } } },
      bonusValues: { proc: { stat: { power: "x" }, input: { on: true } } },
    });
    expect(build.values).toEqual({});
    expect(build.bonusValues).toEqual({ proc: { input: { on: true } } });
  });

  it("moves a pre-list row's values with its pick", () => {
    const build = storage.normalize({
      choices: { "misc.misc4": "a" },
      values: { "misc.misc4": { power: 10 } },
    });
    expect(build.values).toEqual({ "misc.misc#1": { stat: { power: 10 } } });
  });
});

describe("normalizeLayer", () => {
  it("migrates a preset's values the same way", () => {
    const layer = storage.normalizeLayer({
      id: "l1",
      name: "Layer",
      overlay: {
        sectionPresets: {
          p: {
            id: "p",
            label: "P",
            section: "gear",
            choices: { "gear.ring1": "ring" },
            values: { "gear.ring1": { power: 5, "proc:crit": 0.1 } },
          },
        },
      },
    });
    const preset = layer.overlay.sectionPresets.p;
    expect(preset?.values).toEqual({ "gear.ring1": { stat: { power: 5 } } });
    expect(preset?.bonusValues).toEqual({ proc: { stat: { crit: 0.1 } } });
  });

  it("leaves a preset with no values alone", () => {
    const layer = storage.normalizeLayer({
      overlay: {
        sectionPresets: { p: { id: "p", label: "P", section: "gear" } },
      },
    });
    expect(layer.overlay.sectionPresets.p).toEqual({
      id: "p",
      label: "P",
      section: "gear",
    });
  });
});
