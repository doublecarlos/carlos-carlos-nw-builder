// BonusInspector.vue's list derivation: which resolved bonuses it lists, and how a bonus's
// sources read in its "from" line.
import { describe, it, expect } from "vitest";
import {
  collapseSources,
  inspectorBonuses,
  isNearMiss,
  occurrenceStateText,
} from "../../src/lib/bonus-inspector";
import type { OccurrenceRow } from "../../src/composables/useItemBonusOccurrences";
import type { EvaluatedBonus } from "../../src/types";

const bonus = (over: Partial<EvaluatedBonus> = {}): EvaluatedBonus =>
  ({
    id: "b1",
    bonus: { id: "b1", name: "Test Bonus", grants: [{ stats: { power: 1 } }] },
    bonusId: "b1",
    sources: [{ name: "Test Item", slotId: "slot1" }],
    carrier: null,
    slotId: "slot1",
    active: false,
    gate: { ok: true, leaves: [], unmet: [] },
    chose: null,
    stats: null,
    previewStats: null,
    grants: [],
    problems: [],
    stacks: 1,
    excluded: false,
    excludedBy: null,
    ...over,
  }) as EvaluatedBonus;

describe("inspectorBonuses", () => {
  it("keeps a bonus something on the build carries", () => {
    expect(inspectorBonuses([bonus()])).toHaveLength(1);
  });

  it("drops an uncarried bonus: reachable for the hover card, not on the build", () => {
    const zero = bonus({ id: "zero", sources: [], carrier: null });
    expect(inspectorBonuses([bonus(), zero]).map((b) => b.id)).toEqual(["b1"]);
  });

  it("keeps a carried bonus whose own count sits at 0, as one the player can switch on", () => {
    const off = bonus({
      id: "off",
      sources: [],
      carrier: { itemId: "i1", name: "Test Item", slotId: "slot1" },
    });
    expect(inspectorBonuses([off]).map((b) => b.id)).toEqual(["off"]);
  });

  it("drops a problem-only bonus, which the errors summary already reports", () => {
    const problem = bonus({
      id: "warn",
      bonus: {
        id: "warn",
        name: "Warning",
        grants: [{ problem: { severity: "warning", message: "no" } }],
      },
    });
    expect(inspectorBonuses([problem])).toEqual([]);
  });
});

describe("collapseSources", () => {
  it("lists distinct sources as they are", () => {
    expect(
      collapseSources([
        { name: "Helm", slotId: "gear.head" },
        { name: "Ring", slotId: "gear.ring1" },
      ]),
    ).toEqual([
      { key: "gear.head", label: "Helm" },
      { key: "gear.ring1", label: "Ring" },
    ]);
  });

  it("folds a source repeated per stack into one link carrying the count", () => {
    const stack = { name: "Shattered Resolve", slotId: "insignia.mount1" };
    expect(collapseSources([stack, stack, stack, stack, stack])).toEqual([
      { key: "insignia.mount1", label: "Shattered Resolve ×5" },
    ]);
  });

  it("keeps the same item on two slots apart", () => {
    expect(
      collapseSources([
        { name: "Ring", slotId: "gear.ring1" },
        { name: "Ring", slotId: "gear.ring2" },
      ]),
    ).toEqual([
      { key: "gear.ring1", label: "Ring" },
      { key: "gear.ring2", label: "Ring" },
    ]);
  });

  it("keeps two items on one slot apart", () => {
    expect(
      collapseSources([
        { name: "Boon A", slotId: "boons.tier1" },
        { name: "Boon B", slotId: "boons.tier1" },
        { name: "Boon A", slotId: "boons.tier1" },
      ]),
    ).toEqual([
      { key: "boons.tier1", label: "Boon A ×2" },
      { key: "boons.tier1", label: "Boon B" },
    ]);
  });
});

describe("isNearMiss", () => {
  const leaf = { ok: false, label: "x" };
  const gate = (...unmet: (typeof leaf)[]) => ({
    ok: unmet.length === 0,
    leaves: unmet,
    unmet,
  });
  const carrier = { itemId: "i1", name: "Test Item", slotId: "slot1" };

  it("one failing condition is one away", () => {
    expect(isNearMiss(bonus({ gate: gate(leaf) }))).toBe(true);
  });

  it("two failing conditions are not", () => {
    expect(isNearMiss(bonus({ gate: gate(leaf, leaf) }))).toBe(false);
  });

  it("a carrier with a met gate is one away: its control is all that is off", () => {
    expect(isNearMiss(bonus({ gate: gate(), sources: [], carrier }))).toBe(
      true,
    );
  });

  it("a met gate with no carrier is not (nothing to flip)", () => {
    expect(isNearMiss(bonus({ gate: gate() }))).toBe(false);
  });

  it("never for an active or excluded bonus", () => {
    expect(isNearMiss(bonus({ active: true, gate: gate(leaf) }))).toBe(false);
    expect(
      isNearMiss(bonus({ excluded: true, excludedBy: "b2", gate: gate(leaf) })),
    ).toBe(false);
  });
});

describe("occurrenceStateText", () => {
  const row = (kind: OccurrenceRow["kind"]): OccurrenceRow => ({
    bonusId: "b1",
    label: "Proc",
    value: 0,
    min: 0,
    max: kind === "checkbox" ? 1 : 5,
    defaultValue: 0,
    kind,
  });

  it("reads a checkbox as off and a stepper as 0", () => {
    expect(occurrenceStateText(row("checkbox"))).toBe("off");
    expect(occurrenceStateText(row("stepper"))).toBe("0");
  });
});
