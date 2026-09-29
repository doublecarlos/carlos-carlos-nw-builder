// The draft <-> grant conversion for BonusRows.vue's editor, split out so item-form and
// bonus-form can build and read drafts without importing the component. In `lib/`, not
// `engine/`: a draft is an authoring shape over `types.ts` with no calculation semantics of its
// own, the same reasoning that puts `item-draft.ts`/`preset-draft.ts`/`slot-draft.ts` there.
//
// A grant has no `id` of its own, since a bonus now resolves as one unit (its final stats
// are the sum of every active grant) and only the *bonus* needs to be addressable for
// stacking/exclusion/everything mechanical. `name` is the one exception: purely a display
// label (ItemCard.vue's hover card), optional, for telling a multi-grant bonus's parts apart.
// What the form covers structurally: the condition tree (leaves plus
// `all`/`any`/`not`, see condition-draft.ts), a flat stat payload (optionally with its own
// dynamic stats), a *tiered* payload keyed on `tierBy` (bonus occurrences by default), a
// *variants* payload (first matching condition wins, each with its own optional dynamic stats)
// and a `scale` formula. Only conditions nested deeper than `MAX_DEPTH`, unrecognized
// condition keys, complex tiers, a grant using both `tiers` and `variants`, or a malformed
// formula fall through to the JSON escape hatch: the editor never silently flattens a
// structure it has no widget for.
//
// Stacking/`excludes` are a *bonus*-level property now (one grant among several shouldn't
// imply the whole bonus stacks), so they're edited once by the caller (BonusForm.vue/
// bonus-groups.js), not per row here.

import {
  whenIsRepresentable,
  whenToRows,
  rowsToWhen,
  cloneRow,
  whenRowsComplete,
  type ConditionRow,
} from "../engine/condition-draft";
import {
  entriesToRows,
  rowsToEntries,
  putIfSet,
  numberOrUnset,
  fieldDiffLabel,
  arrayDiffLabel,
  type DiffCheck,
} from "./draft-fields";
import { deepEqual } from "./deep-equal";
import { toDecimal, toPercent } from "./format";
import type {
  FormulaRef,
  Grant,
  ScaleSteps,
  GrantVariant,
  GrantProblem,
  Bonus,
  StatValues,
  DynamicStatConfig,
  InputDef,
  NumberControl,
} from "../types";

// Exactly what the form edits on a grant and a tier. Anything else would be dropped by the
// form, so its presence forces JSON mode instead.
const GRANT_KEYS = new Set([
  "name",
  "when",
  "stats",
  "dynamicStats",
  "variants",
  "tiers",
  "tierBy",
  "problem",
  "scale",
  "shortDescription",
  "longDescription",
]);
const TIER_KEYS = new Set(["atLeast", "stats"]);
const VARIANT_KEYS = new Set(["when", "stats", "dynamicStats"]);
const PROBLEM_KEYS = new Set([
  "severity",
  "message",
  "label",
  "hideFromPicker",
]);
const PROBLEM_SEVERITIES = new Set(["error", "warning"]);

const tiersAreSimple = (tiers: NonNullable<Grant["tiers"]>) =>
  (tiers ?? []).every(
    (tier) =>
      Object.keys(tier).every((key) => TIER_KEYS.has(key)) &&
      typeof tier.atLeast === "number",
  );

const FORMULA_KEYS = new Set(["formula", "label"]);
const SCALE_KEYS = new Set([...FORMULA_KEYS, "steps"]);
const STEPS_KEYS = new Set(["over", "min", "max", "step"]);

/** Absent, or a `FormulaRef` the formula field edits without losing anything. `keys` are the
 *  fields the site's form edits. */
const formulaIsSimple = (ref: FormulaRef | undefined, keys = FORMULA_KEYS) =>
  ref === undefined ||
  (typeof ref === "object" &&
    ref !== null &&
    Object.keys(ref).every((key) => keys.has(key)) &&
    typeof ref.formula === "string" &&
    (ref.label === undefined || typeof ref.label === "string"));

/** Absent, or `steps` the scale's step fields edit without losing anything. */
const stepsAreSimple = (steps: ScaleSteps | undefined) =>
  steps === undefined ||
  (typeof steps === "object" &&
    steps !== null &&
    Object.keys(steps).every((key) => STEPS_KEYS.has(key)) &&
    typeof steps.over === "string" &&
    [steps.min, steps.max, steps.step].every((n) => typeof n === "number"));

const variantsAreSimple = (variants: NonNullable<Grant["variants"]>) =>
  (variants ?? []).every(
    (variant) =>
      Object.keys(variant).every((key) => VARIANT_KEYS.has(key)) &&
      variant.stats &&
      typeof variant.stats === "object" &&
      (variant.dynamicStats === undefined ||
        Array.isArray(variant.dynamicStats)) &&
      whenIsRepresentable(variant.when),
  );

const problemIsSimple = (problem: GrantProblem) =>
  Object.keys(problem).every((key) => PROBLEM_KEYS.has(key)) &&
  PROBLEM_SEVERITIES.has(problem.severity) &&
  typeof problem.message === "string";

/** Structures the form cannot represent without losing something. `dynamicStats` has a
 *  dedicated widget on the flat payload and on each variant's own payload (mirroring
 *  `ItemForm.vue`'s "Dynamic stats" section), but `Grant.dynamicStats` only ever applies
 *  alongside the flat payload, so pairing it with `tiers`/`variants`/`problem` on the same
 *  grant has no widget and falls to JSON, same "drop to JSON rather than silently flatten"
 *  rule `tiers`/`variants`/`problem` already follow. A scale's `steps` is the same: its
 *  fields show on a flat payload only. */
export const needsJson = (grant: Grant) =>
  Boolean(
    Object.keys(grant).some((key) => !GRANT_KEYS.has(key)) ||
    !formulaIsSimple(grant.scale, SCALE_KEYS) ||
    !stepsAreSimple(grant.scale?.steps) ||
    (grant.scale?.steps && (grant.tiers || grant.variants || grant.problem)) ||
    !formulaIsSimple(grant.tierBy) ||
    (grant.tierBy && !grant.tiers) ||
    !whenIsRepresentable(grant.when) ||
    (grant.tiers && !tiersAreSimple(grant.tiers)) ||
    (grant.variants && (grant.tiers || !variantsAreSimple(grant.variants))) ||
    (grant.problem &&
      (grant.tiers || grant.variants || !problemIsSimple(grant.problem))) ||
    (grant.dynamicStats?.length &&
      (grant.tiers || grant.variants || grant.problem)),
  );

export interface StatRow {
  key: string;
  value: string | number;
}

export const statRows = (stats: StatValues | undefined): StatRow[] =>
  entriesToRows(stats, (key, value) => ({ key, value: value as number }));

export const rowsToStats = (
  rows: StatRow[] | undefined,
): Record<string, number> =>
  rowsToEntries(
    rows,
    (row) => row.key,
    (row) => {
      const number = Number(row.value);
      return (row.value as unknown) === "" ||
        row.value == null ||
        !Number.isFinite(number)
        ? undefined
        : number;
    },
  );

/** One `DynamicStatConfig` row, widened to `number | string | null` like every other numeric
 *  draft field so a cleared input reads as empty rather than `0`. Shared by the item editor
 *  (`Item.dynamicStats`) and the grant/variant "Dynamic stats" sections below, since both edit
 *  the same underlying shape. */
export interface DynamicStatDraft {
  stat: string;
  min: number | string | null;
  max: number | string | null;
  default: number | string | null;
  label: string;
}

export const dynamicStatRows = (
  configs: DynamicStatConfig[] | undefined,
): DynamicStatDraft[] =>
  (configs ?? []).map((d) => ({
    stat: d.stat,
    min: d.min,
    max: d.max,
    default: d.default,
    label: d.label ?? "",
  }));

export const rowsToDynamicStats = (
  rows: DynamicStatDraft[] | undefined,
): DynamicStatConfig[] =>
  (rows ?? [])
    .filter((d) => d.stat)
    .map((d) => {
      const config: DynamicStatConfig = {
        stat: d.stat,
        min: Number(d.min) || 0,
        max: Number(d.max) || 0,
        default: Number(d.default) || 0,
      };
      putIfSet(config, "label", d.label.trim());
      return config;
    });

export interface VariantDraft {
  uid: string;
  conditions: ConditionRow[];
  stats: StatRow[];
  dynamicStats: DynamicStatDraft[];
}

export const newVariant = (): VariantDraft => ({
  uid: `v${Math.random().toString(36).slice(2, 8)}`,
  conditions: [],
  stats: [],
  dynamicStats: [],
});

/** One `FormulaRef` as its field edits it. An empty `formula` means none. */
export interface FormulaDraft {
  formula: string;
  label: string;
}

export const formulaDraft = (ref?: FormulaRef): FormulaDraft => ({
  formula: ref?.formula ?? "",
  label: ref?.label ?? "",
});

/** Undefined for an empty formula, which the site then does without. */
export function draftToFormula(draft: FormulaDraft): FormulaRef | undefined {
  const formula = draft.formula.trim();
  if (!formula) return undefined;
  const out: FormulaRef = { formula };
  putIfSet(out, "label", draft.label.trim());
  return out;
}

/** A scale's `steps` as its fields edit them. An empty `over` means none. */
export interface StepsDraft {
  over: string;
  min: number | string | null;
  max: number | string | null;
  step: number | string | null;
}

export const stepsDraft = (steps?: ScaleSteps): StepsDraft => ({
  over: steps?.over ?? "",
  min: steps?.min ?? null,
  max: steps?.max ?? null,
  step: steps?.step ?? null,
});

/** Undefined without an `over`. A cleared number falls back to a 0 minimum, one value (the
 *  minimum) and a step of 1, which load validation and the field's own check report. */
export function draftToSteps(draft: StepsDraft): ScaleSteps | undefined {
  const over = draft.over.trim();
  if (!over) return undefined;
  const min = numberOrUnset(draft.min) ?? 0;
  return {
    over,
    min,
    max: numberOrUnset(draft.max) ?? min,
    step: numberOrUnset(draft.step) ?? 1,
  };
}

export interface TierDraft {
  atLeast: number;
  stats: StatRow[];
}

/** A tier row's threshold. 0 and below are kept, since a `tierBy` measure can reach them; a
 *  cleared field reads as 1. */
const tierThreshold = (value: number | string): number => {
  const threshold = Number(value);
  return String(value).trim() !== "" && Number.isFinite(threshold)
    ? threshold
    : 1;
};

export interface GrantDraft {
  uid: string;
  mode: "simple" | "json";
  json: string;
  conditions: ConditionRow[];
  payload: "flat" | "tiers" | "variants" | "problem";
  stats: StatRow[];
  dynamicStats: DynamicStatDraft[];
  tiers: TierDraft[];
  variants: VariantDraft[];
  problemSeverity: "error" | "warning";
  problemMessage: string;
  problemLabel: string;
  problemHideFromPicker: boolean;
  /** Same across every payload, unlike the payload-specific fields above; see
   * `Grant.name`/`shortDescription`/`longDescription`. */
  name: string;
  shortDescription: string;
  longDescription: string;
  /** Per grant like `name`, since it scales whichever payload wins. */
  scale: FormulaDraft;
  /** The scale's step ladder, kept only while the scale has a formula. */
  scaleSteps: StepsDraft;
  /** The measure `tiers` are keyed by. Empty means `occurrences()`. */
  tierBy: FormulaDraft;
}

export function toDraft(grant: Grant = {}): GrantDraft {
  const json = needsJson(grant);
  return {
    uid: `b${Math.random().toString(36).slice(2, 8)}`,
    mode: json ? "json" : "simple",
    json: JSON.stringify(grant, null, 2),
    conditions: json ? [] : whenToRows(grant.when),
    payload: grant.problem
      ? "problem"
      : grant.variants
        ? "variants"
        : grant.tiers
          ? "tiers"
          : "flat",
    stats: json ? [] : statRows(grant.stats),
    dynamicStats: json ? [] : dynamicStatRows(grant.dynamicStats),
    tiers: json
      ? []
      : (grant.tiers ?? []).map((tier) => ({
          atLeast: tier.atLeast,
          stats: statRows(tier.stats),
        })),
    variants: json
      ? []
      : (grant.variants ?? []).map((variant) => ({
          ...newVariant(),
          conditions: whenToRows(variant.when),
          stats: statRows(variant.stats),
          dynamicStats: dynamicStatRows(variant.dynamicStats),
        })),
    problemSeverity: json ? "warning" : (grant.problem?.severity ?? "warning"),
    problemMessage: json ? "" : (grant.problem?.message ?? ""),
    problemLabel: json ? "" : (grant.problem?.label ?? ""),
    problemHideFromPicker: json
      ? false
      : (grant.problem?.hideFromPicker ?? false),
    name: json ? "" : (grant.name ?? ""),
    shortDescription: json ? "" : (grant.shortDescription ?? ""),
    longDescription: json ? "" : (grant.longDescription ?? ""),
    scale: formulaDraft(json ? undefined : grant.scale),
    scaleSteps: stepsDraft(json ? undefined : grant.scale?.steps),
    tierBy: formulaDraft(json ? undefined : grant.tierBy),
  };
}

/**
 * True when every condition tree in the grant serializes without dropping anything: the
 * grant's own `when`, plus each variant's when when the payload is `variants` (a variant with
 * *no* condition is valid, since it always matches, so an empty tree is complete). The
 * form uses this to hold off auto-saving while a condition is half-drawn; otherwise
 * `rowsToWhen` would silently drop the empty leaf and the source round-trip would wipe the
 * row from the editor.
 */
export const grantWhenIsComplete = (grant: GrantDraft): boolean =>
  whenRowsComplete(grant.conditions) &&
  (grant.payload !== "variants" ||
    grant.variants.every((variant) => whenRowsComplete(variant.conditions)));

/** Throws on unparseable JSON so the caller can report it rather than dropping the grant. */
export function toGrant(draft: GrantDraft): Grant {
  if (draft.mode === "json") return JSON.parse(draft.json);

  const out: Grant = {};
  putIfSet(out, "when", rowsToWhen(draft.conditions));

  if (draft.payload === "problem") {
    out.problem = {
      severity: draft.problemSeverity,
      message: draft.problemMessage,
    };
    putIfSet(out.problem, "label", draft.problemLabel);
    if (draft.problemHideFromPicker) out.problem.hideFromPicker = true;
  } else if (draft.payload === "tiers") {
    putIfSet(out, "tierBy", draftToFormula(draft.tierBy));
    out.tiers = draft.tiers.map((tier) => ({
      atLeast: tierThreshold(tier.atLeast),
      stats: rowsToStats(tier.stats),
    }));
  } else if (draft.payload === "variants") {
    out.variants = draft.variants.map((variant) => {
      const entry: GrantVariant = { stats: rowsToStats(variant.stats) };
      putIfSet(entry, "when", rowsToWhen(variant.conditions));
      putIfSet(entry, "dynamicStats", rowsToDynamicStats(variant.dynamicStats));
      return entry;
    });
  } else {
    out.stats = rowsToStats(draft.stats);
    putIfSet(out, "dynamicStats", rowsToDynamicStats(draft.dynamicStats));
  }

  putIfSet(out, "name", draft.name);
  putIfSet(out, "shortDescription", draft.shortDescription);
  putIfSet(out, "longDescription", draft.longDescription);
  const scale = draftToFormula(draft.scale);
  // Only a flat payload has a ladder; the draft keeps the fields for switching back.
  const steps =
    draft.payload === "flat" ? draftToSteps(draft.scaleSteps) : undefined;
  putIfSet(out, "scale", scale && steps ? { ...scale, steps } : scale);

  return out;
}

/** One `Bonus.inputs` entry. Numeric fields are widened like `DynamicStatDraft`'s, in stored
 *  units (a percent as a decimal). `on` is a boolean input's default, kept apart from the
 *  numeric one so switching type mid-edit loses neither. */
export interface InputDraft {
  /** The input's id: the key builds store its value under and conditions read it by. */
  name: string;
  /** Declared by the bonus when the form opened, so builds may already hold a value under
   *  `name`: the form shows it read-only. An input added since stays editable. */
  frozen: boolean;
  type: InputDef["type"];
  label: string;
  on: boolean;
  default: number | string | null;
  min: number | string | null;
  max: number | string | null;
  step: number | string | null;
  /** Comma-separated, in the units the input shows: percent for a `percent` input. */
  presets: string;
  /** `number` only. Empty leaves it to the bounds: a stepper when both are set. */
  control: "" | NumberControl;
}

export const newInput = (): InputDraft => ({
  name: "",
  frozen: false,
  type: "boolean",
  label: "",
  on: false,
  default: null,
  min: null,
  max: null,
  step: null,
  presets: "",
  control: "",
});

export const inputRows = (
  inputs: Record<string, InputDef> | undefined,
): InputDraft[] =>
  entriesToRows(inputs, (name, def) => ({
    name,
    frozen: true,
    type: def.type,
    label: def.label ?? "",
    on: def.type === "boolean" && def.default === true,
    default: def.type === "boolean" ? null : Number(def.default),
    min: def.min ?? null,
    max: def.max ?? null,
    step: def.step ?? null,
    presets: (def.presets ?? [])
      .map((value) => (def.type === "percent" ? toPercent(value) : value))
      .join(", "),
    control: def.control ?? "",
  }));

/** Unnamed rows are dropped. A boolean keeps only its default and label. */
export const rowsToInputs = (
  rows: InputDraft[] | undefined,
): Record<string, InputDef> =>
  rowsToEntries(
    rows,
    (row) => row.name.trim(),
    (row) => {
      if (row.type === "boolean") {
        const def: InputDef = { type: row.type, default: row.on };
        putIfSet(def, "label", row.label.trim());
        return def;
      }
      const def = { type: row.type } as InputDef;
      putIfSet(def, "min", numberOrUnset(row.min));
      putIfSet(def, "max", numberOrUnset(row.max));
      putIfSet(def, "step", numberOrUnset(row.step));
      putIfSet(
        def,
        "presets",
        row.presets
          .split(",")
          .map((part) => numberOrUnset(part.replace("%", "").trim()))
          .filter((value): value is number => value !== undefined)
          .map((value) => (row.type === "percent" ? toDecimal(value) : value)),
      );
      if (row.type === "number" && row.control) def.control = row.control;
      def.default = numberOrUnset(row.default) ?? 0;
      putIfSet(def, "label", row.label.trim());
      return def;
    },
  );

function duplicateNames(names: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    if (seen.has(name)) dupes.add(name);
    seen.add(name);
  }
  return [...dupes];
}

/** Names given to more than one row. Only the last of them is saved. */
export const duplicateInputNames = (rows: InputDraft[]): string[] =>
  duplicateNames(rows.map((row) => row.name));

/** A bonus input as the `input` condition leaf's picker offers it. */
export interface InputOption {
  value: string;
  label: string;
  type: InputDef["type"];
}

export const inputOptions = (rows: InputDraft[]): InputOption[] =>
  rows
    .filter((row) => row.name.trim())
    .map((row) => ({
      value: row.name.trim(),
      label: row.label.trim() || row.name.trim(),
      type: row.type,
    }));

/** One `Bonus.formulas` entry. */
export interface NamedFormulaDraft extends FormulaDraft {
  /** Referenced as `$name`. */
  name: string;
}

export const newNamedFormula = (): NamedFormulaDraft => ({
  name: "",
  formula: "",
  label: "",
});

export const namedFormulaRows = (
  formulas: Record<string, FormulaRef> | undefined,
): NamedFormulaDraft[] =>
  entriesToRows(formulas, (name, ref) => ({ name, ...formulaDraft(ref) }));

/** Unnamed rows are dropped. A named row with no formula is kept, so load validation reports
 *  it rather than references to it going quietly unknown. */
export const rowsToNamedFormulas = (
  rows: NamedFormulaDraft[] | undefined,
): Record<string, FormulaRef> =>
  rowsToEntries(
    rows,
    (row) => row.name.trim(),
    (row) => draftToFormula(row) ?? { formula: "" },
  );

/** Names given to more than one row, the same check as `duplicateInputNames`. */
export const duplicateFormulaNames = (rows: NamedFormulaDraft[]): string[] =>
  duplicateNames(rows.map((row) => row.name));

export interface BonusDraft {
  id: string;
  name: string;
  inputs: InputDraft[];
  formulas: NamedFormulaDraft[];
  grants: GrantDraft[];
  stacking?: string;
  maxStacks?: number | string | null;
  excludes?: string[];
}

/** `saved` is false for a bonus seeded from another (a duplicate): no build holds its input
 *  values yet, so none of its input ids are frozen. */
export function buildDraft(
  bonus: Bonus | null | undefined,
  saved = true,
): BonusDraft {
  const source = bonus ?? ({} as Partial<Bonus>);
  return {
    id: source.id ?? "",
    name: source.name ?? "",
    inputs: inputRows(source.inputs).map((row) => ({
      ...row,
      frozen: saved,
    })),
    formulas: namedFormulaRows(source.formulas),
    grants: (source.grants ?? []).map((grant) => toDraft(grant)),
    stacking: source.stacking ?? "",
    maxStacks: source.maxStacks ?? null,
    excludes: [...(source.excludes ?? [])],
  };
}

/** The parts of `draft` its formulas read or are checked against, as a saved bonus `id` would
 *  have them. */
export const formulaOwner = (
  draft: BonusDraft,
  id: string,
): Pick<Bonus, "id" | "inputs" | "formulas" | "stacking"> => ({
  id,
  inputs: rowsToInputs(draft.inputs),
  formulas: rowsToNamedFormulas(draft.formulas),
  ...(draft.stacking && { stacking: draft.stacking }),
});

/** Assembles a bonus-level draft (id/name/grants plus the bonus-level stacking/excludes
 * fields) back into the JSON shape, the same "only include if present" convention `toGrant`
 * used to apply per-effect. Shared by BonusForm.vue and bonus-groups.js so the two editing
 * surfaces can't drift on what counts as "present". Throws if any grant is unparseable JSON. */
export function toBonus(draft: BonusDraft): Bonus {
  const grants = draft.grants.map((g) => toGrant(g));
  const out: Bonus = {
    id: draft.id.trim(),
    name: draft.name.trim() || draft.id.trim(),
    grants,
  };
  putIfSet(out, "inputs", rowsToInputs(draft.inputs));
  putIfSet(out, "formulas", rowsToNamedFormulas(draft.formulas));
  putIfSet(out, "stacking", draft.stacking);
  if (draft.maxStacks) out.maxStacks = Number(draft.maxStacks);
  putIfSet(out, "excludes", [...(draft.excludes ?? [])]);
  return out;
}

/** Deep clone, with a fresh uid so the copy does not collide with the original on save. */
export function duplicateDraft(draft: GrantDraft): GrantDraft {
  return {
    ...draft,
    uid: `b${Math.random().toString(36).slice(2, 8)}`,
    conditions: draft.conditions.map(cloneRow),
    scale: { ...draft.scale },
    scaleSteps: { ...draft.scaleSteps },
    tierBy: { ...draft.tierBy },
    stats: draft.stats.map((s) => ({ ...s })),
    dynamicStats: draft.dynamicStats.map((d) => ({ ...d })),
    tiers: draft.tiers.map((tier) => ({
      ...tier,
      stats: tier.stats.map((s) => ({ ...s })),
    })),
    variants: draft.variants.map((variant) => ({
      ...newVariant(),
      conditions: variant.conditions.map(cloneRow),
      stats: variant.stats.map((s) => ({ ...s })),
      dynamicStats: variant.dynamicStats.map((d) => ({ ...d })),
    })),
  };
}

/** Labels a change to a record of named declarations (`Bonus.inputs`, `Bonus.formulas`):
 *  which names were added or removed, else the first entry that changed. `shown` is how a
 *  name reads in the label. */
function recordDiffLabel<T>(
  noun: string,
  old: Record<string, T>,
  nw: Record<string, T>,
  shown: (name: string) => string,
): string {
  const oldNames = Object.keys(old);
  const nwNames = Object.keys(nw);
  const sameNames =
    oldNames.length === nwNames.length &&
    oldNames.every((name) => Object.hasOwn(nw, name));
  if (!sameNames) return arrayDiffLabel(noun, oldNames, nwNames);
  const changed = nwNames.find((name) => !deepEqual(old[name], nw[name]));
  return changed ? `edit ${noun} ${shown(changed)}` : `reorder ${noun}s`;
}

const CHECKS: DiffCheck<Bonus>[] = [
  (old, nw) => (old.name !== nw.name ? `edit name → "${nw.name}"` : null),
  (old, nw) =>
    old.stacking !== nw.stacking
      ? `edit stacking → "${nw.stacking || "(none)"}"`
      : null,
  (old, nw) =>
    old.maxStacks !== nw.maxStacks
      ? `edit max stacks → ${nw.maxStacks ?? "(none)"}`
      : null,
  (old, nw) =>
    JSON.stringify(old.excludes) !== JSON.stringify(nw.excludes)
      ? arrayDiffLabel("exclude", old.excludes ?? [], nw.excludes ?? [])
      : null,
  (old, nw) =>
    JSON.stringify(old.inputs) !== JSON.stringify(nw.inputs)
      ? recordDiffLabel(
          "input",
          old.inputs ?? {},
          nw.inputs ?? {},
          (name) => `"${name}"`,
        )
      : null,
  (old, nw) =>
    JSON.stringify(old.formulas) !== JSON.stringify(nw.formulas)
      ? recordDiffLabel(
          "formula",
          old.formulas ?? {},
          nw.formulas ?? {},
          (name) => `$${name}`,
        )
      : null,
  (old, nw) => {
    if (deepEqual(old.grants, nw.grants)) return null;
    const oldCount = (old.grants ?? []).length;
    const newCount = (nw.grants ?? []).length;
    if (newCount > oldCount)
      return `add grant${newCount - oldCount > 1 ? "s" : ""} (${newCount} total)`;
    if (newCount < oldCount)
      return `remove grant${oldCount - newCount > 1 ? "s" : ""} (${newCount} total)`;
    return `edit grants (${newCount} total)`;
  },
];

export function diffLabel(oldJson: string, newJson: string): string {
  return fieldDiffLabel(CHECKS, oldJson, newJson, "edit bonus");
}
