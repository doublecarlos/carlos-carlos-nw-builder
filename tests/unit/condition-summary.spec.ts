// The phone's one-line condition text: the engine's own leaf label, read against names only,
// and the type alone, flagged incomplete, while a leaf still lacks a value.
import { describe, expect, it } from "vitest";
import {
  summarizeLeaf,
  summaryContext,
  type SummaryNames,
} from "../../src/lib/condition-summary";
import {
  newLeafRow,
  whenToRows,
  type ConditionRow,
} from "../../src/engine/condition-draft";
import type { ConditionWhen } from "../../src/types";

const names: SummaryNames = {
  bonusNames: new Map([["m31-guile", "Gladiator's Guile"]]),
  itemNames: new Map([["mystic-aura-self", "Mystic Aura (Self)"]]),
  paramLabels: new Map([
    ["toggles.combat", "In combat"],
    ["stacks", "Stacks"],
  ]),
  inputs: [
    { value: "share", label: "Share", type: "percent" },
    { value: "active", label: "Active", type: "boolean" },
  ],
};
const ctx = summaryContext(names);

/** The one leaf `when` holds, as the editor's row. */
const leaf = (when: ConditionWhen): ConditionRow => whenToRows(when)[0]!;
const text = (when: ConditionWhen) => summarizeLeaf(leaf(when), ctx);

describe("summarizeLeaf", () => {
  it("reads a leaf the way the item card does", () => {
    expect(text({ toggle: ["combat", "solo"] })).toEqual({
      text: "combat or solo enabled",
      complete: true,
    });
    expect(text({ class: "wizard" }).text).toBe("Class: wizard");
    expect(text({ duration: { atLeast: 10, below: 30 } }).text).toBe(
      "duration 10 to 30s",
    );
    expect(text({ enemies: { exactly: 3 } }).text).toBe("enemies = 3");
  });

  it("names bonuses, items and parameters instead of their ids", () => {
    expect(
      text({ bonusOccurrences: { bonus: "m31-guile", atLeast: 2 } }).text,
    ).toBe("2 occurrences of Gladiator's Guile");
    expect(text({ bonusOccurrences: {} }).text).toBe(
      "1 occurrence of this bonus",
    );
    expect(text({ equipped: { item: "mystic-aura-self" } }).text).toBe(
      "1× Mystic Aura (Self)",
    );
    expect(text({ equipped: { tag: "aura", exactly: 2 } }).text).toBe(
      '2× items tagged "aura"',
    );
    expect(text({ param: { key: "stacks", atLeast: 3 } }).text).toBe(
      "Stacks ≥ 3",
    );
    expect(text({ param: { key: "toggles.combat", is: true } }).text).toBe(
      "In combat on",
    );
  });

  it("reads an unknown parameter as unknown rather than failing", () => {
    expect(text({ param: { key: "gone", atLeast: 1 } }).text).toBe(
      'param "gone"',
    );
  });

  it("formats an input's bounds in its own units", () => {
    expect(text({ input: { key: "share", atLeast: 0.5 } }).text).toBe(
      "Share ≥ 50%",
    );
    expect(text({ input: { key: "active", is: false } }).text).toBe(
      "Active off",
    );
  });

  it("reads a formula by its label, else its text", () => {
    expect(
      text({ formula: { formula: "2 + 2", label: "Four", atLeast: 1 } }).text,
    ).toBe("Four ≥ 1");
    expect(text({ formula: { formula: "2 + 2", below: 5 } }).text).toContain(
      "< 5",
    );
  });

  it("names the type of a leaf still missing a value, as incomplete", () => {
    expect(summarizeLeaf(newLeafRow(), ctx)).toEqual({
      text: "toggle",
      complete: false,
    });
    // A fresh count leaf already means "at least one", so it is whole from the start.
    expect(summarizeLeaf(newLeafRow("bonusOccurrences"), ctx)).toEqual({
      text: "1 occurrence of this bonus",
      complete: true,
    });
    expect(summarizeLeaf(newLeafRow("duration"), ctx)).toEqual({
      text: "duration",
      complete: false,
    });
  });
});
