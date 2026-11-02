// Typed values written into a build from a payload in `Build`'s shape: a preset overwrites what
// the build holds, a replacement's seeds never do. Both are checked against the catalog the same
// way.
import { describe, expect, it } from "vitest";
import * as catalog from "../../src/data/catalog";
import {
  bonusInputAddress,
  itemStatAddress,
  storedInput,
  writeInput,
  writeTypedValues,
  type TypedValues,
} from "../../src/lib/build-inputs";
import type { Bonus, Build, SectionPreset, Slot } from "../../src/types";

function emptyBuild(): Build {
  return {
    id: "b",
    name: "b",
    choices: {},
    values: {},
    bonusValues: {},
    assignments: {},
    listRows: {},
    disabledSlots: {},
    context: {} as Build["context"],
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
  };
}

describe("writeTypedValues", () => {
  const payload: TypedValues = {
    values: { ring: { stat: { power: 5 } } },
    bonusValues: { proc: { input: { stacks: 3 } } },
  };
  const stacks = bonusInputAddress("proc", "stacks");
  const power = itemStatAddress("ring", "power");

  it("replaces stored values when overwriting, as a preset does", () => {
    const build = emptyBuild();
    writeInput(build, stacks, 1);
    writeTypedValues(build, payload, { overwrite: true });
    expect(storedInput(build, stacks)).toBe(3);
    expect(storedInput(build, power)).toBe(5);
  });

  // A replacement is stat-neutral: what the player already set stays.
  it("fills only what is unset otherwise, as a replacement's seed does", () => {
    const build = emptyBuild();
    writeInput(build, stacks, 1);
    writeTypedValues(build, payload, { overwrite: false });
    expect(storedInput(build, stacks)).toBe(1);
    expect(storedInput(build, power)).toBe(5);
  });
});

describe("validatePresets: bonusValues", () => {
  const proc: Bonus = {
    id: "proc",
    inputs: {
      active: { type: "boolean", default: false },
      stacks: { type: "number", min: 0, max: 5, default: 0 },
    },
    grants: [],
  };
  const slots: Slot[] = [];
  const findings = (bonusValues: SectionPreset["bonusValues"]) =>
    catalog
      .validatePresets(
        [{ id: "p", label: "P", section: "s", bonusValues }],
        slots,
        [{ id: "s", label: "S", slotIds: [] }],
        [proc],
      )
      .map((finding) => finding.message);

  it("accepts settings the bonus declares", () => {
    expect(findings({ proc: { input: { active: true, stacks: 2 } } })).toEqual(
      [],
    );
  });

  it("reports an unknown bonus, stat or input, or a value of the wrong type", () => {
    expect(findings({ nope: { input: { stacks: 2 } } })).toHaveLength(1);
    expect(findings({ proc: { stat: { power: 1 } } })).toHaveLength(1);
    expect(findings({ proc: { input: { other: 1 } } })).toHaveLength(1);
    expect(findings({ proc: { input: { active: 1 } } })).toHaveLength(1);
    expect(findings({ proc: { input: { stacks: true } } })).toHaveLength(1);
  });
});
