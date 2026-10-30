// Which fields a condition leaf edits, in order, by its type. ConditionLeafFields renders from
// this table, so the inline row and the phone's condition editor show the same fields.
import type { ConditionRow } from "../engine/condition-draft";

/** One control of a leaf, after its type picker. */
export type LeafField =
  | "bonus"
  | "tag"
  | "item"
  | "formula"
  | "paramKey"
  | "inputKey"
  | "is"
  | "equals"
  | "range"
  | "value";

/** Resolved per row from the row's `form`: a switch, a list of values, or a number range. */
type Comparison = "comparison";

interface LeafLayoutEntry {
  fields: readonly (LeafField | Comparison)[];
  /** Appended to the range fields' labels. */
  unitSuffix?: string;
  /** The range offers the unbounded "at least 1" mode. */
  allowAtLeastOne?: boolean;
}

export interface LeafLayout {
  fields: LeafField[];
  unitSuffix: string;
  allowAtLeastOne: boolean;
}

const LAYOUTS: Record<string, LeafLayoutEntry> = {
  duration: { fields: ["range"], unitSuffix: " (s)" },
  enemies: { fields: ["range"] },
  bonusOccurrences: { fields: ["bonus", "range"], allowAtLeastOne: true },
  equipped: { fields: ["tag", "item", "range"], allowAtLeastOne: true },
  formula: { fields: ["formula", "range"] },
  param: { fields: ["paramKey", "comparison"] },
  input: { fields: ["inputKey", "comparison"] },
};

/** Toggle, role, class and damage type each pick a value. */
const VALUE_LAYOUT: LeafLayoutEntry = { fields: ["value"] };

const COMPARISON_FIELD: Record<NonNullable<ConditionRow["form"]>, LeafField> = {
  boolean: "is",
  string: "equals",
  number: "range",
};

export function leafLayout(row: ConditionRow): LeafLayout {
  const entry = LAYOUTS[row.type ?? ""] ?? VALUE_LAYOUT;
  return {
    fields: entry.fields.map((field) =>
      field === "comparison" ? COMPARISON_FIELD[row.form ?? "number"] : field,
    ),
    unitSuffix: entry.unitSuffix ?? "",
    allowAtLeastOne: entry.allowAtLeastOne ?? false,
  };
}

const TYPE_LABELS: Record<string, string> = {
  bonusOccurrences: "occurrences",
};

/** A leaf type as the type picker names it. */
export const conditionTypeLabel = (type?: string): string =>
  TYPE_LABELS[type ?? ""] ?? type ?? "";
