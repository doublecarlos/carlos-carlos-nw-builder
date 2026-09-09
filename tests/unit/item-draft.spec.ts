// Coverage for lib/item-draft.ts, the draft <-> Item conversion ItemForm.vue delegates to (see
// that module's header comment). Round-trips buildDraft/toItem the same way bonus-draft.spec.ts
// does for grants, plus the diffLabel walk, including the stat-change check: see
// item-draft.ts's `itemStatRows` doc comment for why it can't read a plain `.stats` field.
import { describe, it, expect } from "vitest";
import {
  buildDraft,
  toItem,
  diffLabel,
  hasDescription,
  hasInlineRepetition,
} from "../../src/lib/item-draft";
import type { Item } from "../../src/types";

const ctx = { id: "test_item" };

describe("buildDraft / toItem round trip", () => {
  it("round-trips a minimal item", () => {
    const item: Item = { id: "sword", name: "Sword", filter: "weapon" };
    const draft = buildDraft(item);
    expect(toItem(draft, { id: "sword" })).toEqual(item);
  });

  it("round-trips flat stat keys", () => {
    const item: Item = {
      id: "ring",
      name: "Ring",
      filter: "ring",
      power: 10,
      acc: 5,
    };
    const draft = buildDraft(item);
    expect(draft.stats).toEqual(
      expect.arrayContaining([
        { key: "power", value: 10 },
        { key: "acc", value: 5 },
      ]),
    );
    expect(toItem(draft, { id: "ring" })).toEqual(item);
  });

  it("round-trips a bare replacedBy id and an ItemReplacement with seeded values", () => {
    const bare: Item = {
      id: "old",
      name: "Old",
      filter: "ring",
      replacedBy: "new",
    };
    expect(toItem(buildDraft(bare), { id: "old" })).toEqual(bare);

    const seeded: Item = {
      id: "old2",
      name: "Old 2",
      filter: "ring",
      replacedBy: { item: "new2", values: { power: 3 } },
    };
    expect(toItem(buildDraft(seeded), { id: "old2" })).toEqual(seeded);
  });

  it("round-trips a mix of bare and occurrence-config bonus attachments", () => {
    const item: Item = {
      id: "gear",
      name: "Gear",
      filter: "ring",
      bonuses: [
        "plain_bonus",
        { bonus: "scaling_bonus", min: 1, max: 5, default: 1 },
      ],
    };
    expect(toItem(buildDraft(item), { id: "gear" })).toEqual(item);
  });

  it("round-trips insignia slots, universal and shaped", () => {
    const item: Item = {
      id: "mount",
      name: "Mount",
      filter: "mount",
      insigniaSlots: [
        { shape: "regal" },
        { universal: true, preferred: "crescent" },
      ],
    };
    expect(toItem(buildDraft(item), { id: "mount" })).toEqual(item);
  });

  it("drops a typed maxCopies of 0 back in, unlike an unset one", () => {
    const withZero: Item = { id: "a", name: "A", filter: "x", maxCopies: 0 };
    expect(toItem(buildDraft(withZero), { id: "a" }).maxCopies).toBe(0);

    const unset: Item = { id: "b", name: "B", filter: "x" };
    expect(toItem(buildDraft(unset), { id: "b" })).not.toHaveProperty(
      "maxCopies",
    );
  });

  it("round-trips inline repetition including an optional priority", () => {
    const item: Item = {
      id: "boon",
      name: "Boon",
      filter: "boon",
      inlineRepetition: { min: 0, max: 3, default: 0, priority: 2 },
    };
    expect(toItem(buildDraft(item), { id: "boon" })).toEqual(item);
  });

  it("uses ctx.id rather than any id on the source draft", () => {
    const item: Item = { id: "orig", name: "Orig", filter: "x" };
    expect(toItem(buildDraft(item), ctx).id).toBe("test_item");
  });
});

describe("diffLabel", () => {
  const base: Item = { id: "i1", name: "Alpha", filter: "ring" };

  function labelFor(next: Partial<Item>): string {
    return diffLabel(
      JSON.stringify(base),
      JSON.stringify({ ...base, ...next }),
    );
  }

  it("labels a name change", () => {
    expect(labelFor({ name: "Beta" })).toBe('edit name → "Beta"');
  });

  it("labels a stat change by key, now that the check reads real stat keys", () => {
    const old: Item = { ...base, power: 1 };
    const nw: Item = { ...base, power: 2 };
    expect(diffLabel(JSON.stringify(old), JSON.stringify(nw))).toBe(
      "edit stat: power",
    );
  });

  it("labels a tag addition with a count", () => {
    expect(labelFor({ tags: ["a", "b"] })).toBe("add tags (2)");
  });

  it("labels an occurrence-config addition by bonus id", () => {
    const old: Item = { ...base, bonuses: ["b1"] };
    const nw: Item = {
      ...base,
      bonuses: [{ bonus: "b1", min: 1, max: 3, default: 1 }],
    };
    expect(diffLabel(JSON.stringify(old), JSON.stringify(nw))).toBe(
      'add occurrence config for "b1"',
    );
  });

  it("falls back to the generic label when nothing recognized changed", () => {
    expect(diffLabel(JSON.stringify(base), JSON.stringify(base))).toBe(
      "edit item",
    );
  });
});

describe("hasDescription / hasInlineRepetition", () => {
  it("hasDescription is true once either description field is set", () => {
    const draft = buildDraft(null);
    expect(hasDescription(draft)).toBe(false);
    expect(hasDescription({ ...draft, shortDescription: "x" })).toBe(true);
  });

  it("hasInlineRepetition is true once any repetition bound is set", () => {
    const draft = buildDraft(null);
    expect(hasInlineRepetition(draft)).toBe(false);
    expect(hasInlineRepetition({ ...draft, repetitionMax: 3 })).toBe(true);
  });
});
