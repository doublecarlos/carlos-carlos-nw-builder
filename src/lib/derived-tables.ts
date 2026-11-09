// The stat panel's three `derived` output tables (damage, healing, EHP): their rows, and the
// summary's choice of which row leads each one.
import type { DerivedOutputs } from "../types";

export type DerivedSource = "damage" | "healing" | "ehp";

/** A top-level `derived` field listed under a table: baseDamage/effectiveMagPhys sit beside
 *  `damage` rather than inside it. */
export interface DerivedExtraRow {
  key: "baseDamage" | "effectiveMagPhys";
  label: string;
  format: "int" | "pct";
}

export interface DerivedTable {
  source: DerivedSource;
  label: string;
  /** [label, key] per case, `average` first. */
  rows: [string, string][];
  extra?: DerivedExtraRow[];
}

const DAMAGE_ROWS: [string, string][] = [
  ["Average", "average"],
  ["Crit / no deflect", "critNoDeflect"],
  ["Crit / deflect", "critDeflect"],
  ["No crit / no deflect", "noCritNoDeflect"],
  ["No crit / deflect", "noCritDeflect"],
];
const HEALING_ROWS: [string, string][] = [
  ["Average", "average"],
  ["Crit", "crit"],
  ["No crit", "noCrit"],
];
// The enemy's crit against the player's deflect: the same four cases as damage.
const EHP_ROWS = DAMAGE_ROWS;

export const DERIVED_TABLES: DerivedTable[] = [
  {
    source: "damage",
    label: "Damage",
    rows: DAMAGE_ROWS,
    extra: [
      { key: "baseDamage", label: "Base damage", format: "int" },
      {
        key: "effectiveMagPhys",
        label: "Effective magical/physical",
        format: "pct",
      },
    ],
  },
  { source: "healing", label: "Healing", rows: HEALING_ROWS },
  { source: "ehp", label: "EHP", rows: EHP_ROWS },
];

export const DEFAULT_CASE = "average";

/** The case a table's summary row shows: the stored pick when that table still has it, else
 *  the average. */
export function summaryCase(table: DerivedTable, stored: string | undefined) {
  return stored && table.rows.some(([, key]) => key === stored)
    ? stored
    : DEFAULT_CASE;
}

export function derivedValue(
  derived: DerivedOutputs,
  source: DerivedSource,
  key: string,
) {
  return derived[source][key] ?? 0;
}
