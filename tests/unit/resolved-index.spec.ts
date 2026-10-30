// The per-slot lookups a build-editor row reads: each slot's bonuses, errors and row, and the
// bonus inputs it notes because their bonus also comes from it.
import { describe, it, expect } from "vitest";
import {
  groupBySlot,
  indexResolved,
  inputCopiesBySlot,
} from "../../src/lib/resolved-index";
import { bonusInputAddress } from "../../src/lib/build-inputs";
import type { InputEntry } from "../../src/engine/inputs";
import type {
  EngineError,
  EngineRow,
  EvaluatedBonus,
  ResolvedBuild,
} from "../../src/types";

function bonus(
  id: string,
  slotId: string,
  sources: EvaluatedBonus["sources"] = [{ name: id, slotId }],
): EvaluatedBonus {
  return { id, bonusId: id, slotId, sources } as EvaluatedBonus;
}

function row(slotId: string, label: string): EngineRow {
  return { slotId, slot: { id: slotId, label } } as EngineRow;
}

function error(slotId: string, message: string): EngineError {
  return { slotId, kind: "outOfRange", choice: "", message, severity: "error" };
}

function result(parts: Partial<ResolvedBuild>): ResolvedBuild {
  return { bonuses: [], errors: [], rows: [], ...parts } as ResolvedBuild;
}

function bonusInput(bonusId: string, slotId: string): InputEntry {
  return {
    kind: "bonusInput",
    address: bonusInputAddress(bonusId, "stacks"),
    spec: { type: "boolean", label: "Stacks" },
    value: 0,
    slotId,
    source: bonusId,
  } as InputEntry;
}

describe("groupBySlot", () => {
  it("buckets entries by slot, keeping their order", () => {
    const entries = [
      { slotId: "a", n: 1 },
      { slotId: "b", n: 2 },
      { slotId: "a", n: 3 },
    ];
    const map = groupBySlot(entries);
    expect(map.get("a")?.map((e) => e.n)).toEqual([1, 3]);
    expect(map.get("b")?.map((e) => e.n)).toEqual([2]);
  });
});

describe("indexResolved", () => {
  it("indexes bonuses, errors and rows by slot", () => {
    const index = indexResolved(
      result({
        bonuses: [bonus("x", "ring"), bonus("y", "neck"), bonus("z", "ring")],
        errors: [error("ring", "too high"), error("neck", "missing")],
        rows: [row("ring", "Ring"), row("neck", "Neck")],
      }),
    );
    expect([...index.bonusById.keys()]).toEqual(["x", "y", "z"]);
    expect([...(index.slotBonuses.get("ring")?.keys() ?? [])]).toEqual([
      "x",
      "z",
    ]);
    expect(index.errors.get("neck")?.map((e) => e.message)).toEqual([
      "missing",
    ]);
    expect(index.rows.get("ring")?.slot.label).toBe("Ring");
  });

  it("keeps a slot's first row", () => {
    const index = indexResolved(
      result({ rows: [row("ring", "First"), row("ring", "Second")] }),
    );
    expect(index.rows.get("ring")?.slot.label).toBe("First");
  });

  it("returns the same index for the same resolution", () => {
    const resolved = result({ bonuses: [bonus("x", "ring")] });
    expect(indexResolved(resolved)).toBe(indexResolved(resolved));
  });
});

describe("inputCopiesBySlot", () => {
  it("files a bonus input under each other slot its bonus comes from", () => {
    const shared = bonus("x", "ring", [
      { name: "Ring", slotId: "ring", itemId: "r" },
      { name: "Neck", slotId: "neck", itemId: "n1" },
      { name: "Neck again", slotId: "neck", itemId: "n2" },
      { name: "Belt", slotId: "belt" },
    ]);
    const entry = bonusInput("x", "ring");
    const copies = inputCopiesBySlot([entry], new Map([["x", shared]]));
    expect(copies.has("ring")).toBe(false);
    expect(copies.get("neck")).toEqual([{ entry, itemId: "n1" }]);
    expect(copies.get("belt")).toEqual([{ entry, itemId: undefined }]);
  });

  it("skips inputs whose bonus did not resolve", () => {
    expect(inputCopiesBySlot([bonusInput("x", "ring")], new Map()).size).toBe(
      0,
    );
  });
});
