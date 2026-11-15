// Which fields a condition leaf edits, in order, by its type. ConditionLeafFields renders from
// this table, so the inline row and the phone's condition editor show the same fields.
import type { ConditionRow } from "../engine/condition-draft";
import type { Db } from "../types";

interface ItemPick {
  /** Every item by name, found by its id too. */
  options: { value: string; label: string; search: string }[];
  ids: ReadonlySet<string>;
}

const itemPickCache = new WeakMap<Db, ItemPick>();

/** The equipped leaf's item picker. It depends on the catalog alone, so every leaf shares
 *  one list per `Db`. */
export function itemPick(db: Db): ItemPick {
  const memoized = itemPickCache.get(db);
  if (memoized) return memoized;
  const options = db.items
    .map((item) => ({ value: item.id, label: item.name, search: item.id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const pick = { options, ids: new Set(options.map((o) => o.value)) };
  itemPickCache.set(db, pick);
  return pick;
}

/** One control of a leaf, after its type picker. */
export type LeafField =
  | "bonus"
  | "matchBy"
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
/** Resolved per row from the row's `matchBy`: a tag picker or an item picker. */
type Target = "target";

interface LeafLayoutEntry {
  fields: readonly (LeafField | Comparison | Target)[];
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
  equipped: { fields: ["matchBy", "target", "range"], allowAtLeastOne: true },
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
    fields: entry.fields.map((field) => {
      if (field === "comparison") return COMPARISON_FIELD[row.form ?? "number"];
      if (field === "target") return row.matchBy === "item" ? "item" : "tag";
      return field;
    }),
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
