// An undo or redo marks the build editor rows it changed. Each kind of row state counts, a
// bonus setting counts on the rows whose pick carries the bonus, and rows that kept their
// state are left out.
import { describe, it, expect } from "vitest";
import { changedSlots } from "../../src/lib/build-changes";
import { picker, testBuild, testDb, testSchema } from "./engine-fixtures";
import type { Bonus, BuildParameterSlot, Item } from "../../src/types";

const ring: Item = {
  id: "ring",
  name: "Ring",
  filter: "rings",
  bonuses: ["proc"],
};
const plain: Item = { id: "plain", name: "Plain", filter: "rings" };
const proc: Bonus = { id: "proc", name: "Proc", grants: [] };
const duration: BuildParameterSlot = {
  id: "options.duration",
  label: "Duration",
  section: "options",
  type: "build_parameter",
  path: "duration",
} as BuildParameterSlot;

const db = testDb(
  testSchema(["power"]),
  [ring, plain],
  [proc],
  [picker("gear.ring1", "rings"), picker("gear.ring2", "rings"), duration],
);

describe("changedSlots", () => {
  it("lists the rows whose pick changed, in editor order", () => {
    const before = testBuild({ choices: { "gear.ring2": "plain" } });
    const after = testBuild({
      choices: { "gear.ring1": "ring", "gear.ring2": "ring" },
    });
    expect(changedSlots(db, before, after)).toEqual([
      "gear.ring1",
      "gear.ring2",
    ]);
  });

  it("leaves out rows that kept their state", () => {
    const build = testBuild({ choices: { "gear.ring1": "ring" } });
    expect(changedSlots(db, build, testBuild(build))).toEqual([]);
  });

  it("counts a build parameter's value", () => {
    const before = testBuild({ context: { duration: 60 } });
    const after = testBuild({ context: { duration: 90 } });
    expect(changedSlots(db, before, after)).toEqual(["options.duration"]);
  });

  it("counts a bonus setting on the rows carrying that bonus", () => {
    const choices = { "gear.ring1": "ring", "gear.ring2": "plain" };
    const before = testBuild({ choices });
    const after = testBuild({
      choices,
      bonusValues: { proc: { input: { stacks: 2 } } },
    });
    expect(changedSlots(db, before, after)).toEqual(["gear.ring1"]);
  });
});
