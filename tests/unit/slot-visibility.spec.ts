// `BuildParameterSlot.visibleWhen` (issue #270): a param's row can be scoped to when it is
// relevant. The rule the whole design rests on -- and what most of this file is about -- is
// that hiding is *purely* a display concern: a hidden param still resolves to its stored value
// (or its `default`), so nothing a condition reads depends on what is currently on screen.
import { describe, it, expect } from "vitest";
import { slotVisible } from "../../src/lib/slot-visibility";
import * as db from "../../src/data/db";
import * as bonus from "../../src/engine/bonus";
import { evaluate } from "../../src/engine/conditions";
import type {
  Build,
  EvalContext,
  Item,
  Schema,
  Slot,
  SlotsData,
} from "../../src/types";

const emptySchema: Schema = {
  stats: [],
  statByKey: {},
  statKeys: [],
  multiplicativeStats: [],
  ratingStats: [],
  abilityStats: [],
  ratingConversion: [],
  abilityContributions: [],
  forteSplit: {},
  roles: {},
  statScalers: [],
};

function ctx(overrides: Partial<EvalContext> = {}): EvalContext {
  return {
    duration: 0,
    enemies: 0,
    toggles: {},
    equipped: new Map(),
    tags: new Map(),
    bonusOccurrences: new Map(),
    bonusNames: new Map(),
    params: new Map(),
    ...overrides,
  };
}

function testBuild(context: Record<string, unknown> = {}): Build {
  return {
    id: "b",
    name: "b",
    choices: {},
    values: {},
    assignments: {},
    occurrenceInputs: {},
    context: context as unknown as Build["context"],
    compare: { id: "", highlight: false, onlyDiff: false },
  };
}

// A paragon-shaped fixture of its own rather than the shipped catalogue: what "an equipped
// item flips a param's visibility" means must not move when data/slots.json does.
const paragonItem: Item = {
  id: "test-paragon",
  name: "Test Paragon",
  filter: "test_paragon",
  tags: ["test:paragon"],
};

const forteSlot: Slot = {
  id: "options.forte",
  label: "Forte",
  section: "options",
  type: "build_parameter",
  paramType: "list",
  path: "forte.primary",
  default: "power_p",
  options: [
    { value: "power_p", label: "Power" },
    { value: "sev_p", label: "Critical Severity" },
  ],
  visibleWhen: { equipped: { tag: "test:paragon" } },
};

const testSlots: SlotsData = {
  sections: [{ id: "options", label: "Options" }],
  slots: [
    {
      id: "options.paragon",
      label: "Paragon",
      section: "options",
      type: "item_picker",
      filter: "test_paragon",
    },
    forteSlot,
  ],
};

const testDb = db.build([paragonItem], [], emptySchema, testSlots);

describe("slotVisible", () => {
  it("shows a param that declares no visibleWhen at all", () => {
    const { visibleWhen: _dropped, ...unscoped } = forteSlot as Extract<
      Slot,
      { type: "build_parameter" }
    >;
    expect(slotVisible(unscoped, ctx())).toBe(true);
  });

  it("shows every non-build_parameter slot -- visibleWhen is a param-only field", () => {
    expect(slotVisible(testSlots.slots[0], ctx())).toBe(true);
  });

  it("hides the param while its condition fails and shows it once it holds", () => {
    expect(slotVisible(forteSlot, ctx())).toBe(false);
    expect(
      slotVisible(forteSlot, ctx({ tags: new Map([["test:paragon", 1]]) })),
    ).toBe(true);
  });

  it("shows the param when there is no resolved context to evaluate against", () => {
    // The engine threw: an unresolvable build should not also make its options disappear.
    expect(slotVisible(forteSlot, null)).toBe(true);
  });
});

describe("a hidden param still resolves", () => {
  it("reaches ctx.params at its slot default while its row is hidden", () => {
    const build = testBuild();
    const { ctx: resolved } = bonus.collect(testDb, build);

    expect(slotVisible(forteSlot, resolved)).toBe(false);
    expect(resolved.params.get("forte.primary")).toBe("power_p");
  });

  it("reaches ctx.params at its stored value while its row is hidden", () => {
    const build = testBuild({ forte: { primary: "sev_p" } });
    const { ctx: resolved } = bonus.collect(testDb, build);

    expect(slotVisible(forteSlot, resolved)).toBe(false);
    expect(resolved.params.get("forte.primary")).toBe("sev_p");
  });

  it("gates a bonus identically whether or not its own row is on screen", () => {
    const stored = { forte: { primary: "sev_p" } };
    const hidden = bonus.collect(testDb, testBuild(stored)).ctx;
    const shown = bonus.collect(testDb, {
      ...testBuild(stored),
      choices: { "options.paragon": paragonItem.id },
    }).ctx;

    expect(slotVisible(forteSlot, hidden)).toBe(false);
    expect(slotVisible(forteSlot, shown)).toBe(true);

    // Equipping the paragon is what changed the row's visibility, and nothing else -- the
    // condition reading the param gets the same answer on both sides.
    const gate = { param: { key: "forte.primary", equals: "sev_p" } };
    expect(evaluate(gate, hidden)).toBe(true);
    expect(evaluate(gate, shown)).toBe(true);
  });
});
