// The table of fields each condition leaf edits, which the inline row and the phone's editor
// both render from.
import { describe, expect, it } from "vitest";
import { conditionTypeLabel, leafLayout } from "../../src/lib/condition-fields";
import {
  LEAF_TYPES,
  newLeafRow,
  type ConditionRow,
} from "../../src/engine/condition-draft";

const fields = (row: ConditionRow) => leafLayout(row).fields;

describe("leafLayout", () => {
  it("lists each type's fields in the order the row shows them", () => {
    expect(fields(newLeafRow("duration"))).toEqual(["range"]);
    expect(fields(newLeafRow("bonusOccurrences"))).toEqual(["bonus", "range"]);
    expect(fields(newLeafRow("equipped"))).toEqual(["tag", "item", "range"]);
    expect(fields(newLeafRow("formula"))).toEqual(["formula", "range"]);
    for (const type of ["toggle", "role", "class", "damageType"])
      expect(fields(newLeafRow(type))).toEqual(["value"]);
  });

  it("picks a param or input's comparison by its form", () => {
    const param = newLeafRow("param");
    expect(fields(param)).toEqual(["paramKey", "range"]);
    expect(fields({ ...param, form: "boolean" })).toEqual(["paramKey", "is"]);
    expect(fields({ ...param, form: "string" })).toEqual([
      "paramKey",
      "equals",
    ]);
    expect(fields({ ...newLeafRow("input"), form: "boolean" })).toEqual([
      "inputKey",
      "is",
    ]);
  });

  it("carries the range's unit and its at-least-one mode", () => {
    expect(leafLayout(newLeafRow("duration"))).toMatchObject({
      unitSuffix: " (s)",
      allowAtLeastOne: false,
    });
    expect(leafLayout(newLeafRow("equipped")).allowAtLeastOne).toBe(true);
    expect(leafLayout(newLeafRow("bonusOccurrences")).allowAtLeastOne).toBe(
      true,
    );
    expect(leafLayout(newLeafRow("enemies"))).toMatchObject({
      unitSuffix: "",
      allowAtLeastOne: false,
    });
  });

  it("gives every leaf type at least one field", () => {
    for (const type of LEAF_TYPES)
      expect(fields(newLeafRow(type)).length).toBeGreaterThan(0);
  });
});

describe("conditionTypeLabel", () => {
  it("names occurrences by its short label and the rest by their type", () => {
    expect(conditionTypeLabel("bonusOccurrences")).toBe("occurrences");
    expect(conditionTypeLabel("damageType")).toBe("damageType");
  });
});
