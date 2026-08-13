// The draft <-> grant conversion for BonusRows.vue's editor, split out so item-form and
// bonus-form can build and read drafts without importing the component.
//
// A grant has no `id` of its own, since a bonus now resolves as one unit (its final stats
// are the sum of every active grant) and only the *bonus* needs to be addressable for
// stacking/exclusion/everything mechanical. `name` is the one exception -- purely a display
// label (ItemCard.vue's hover card), optional, for telling a multi-grant bonus's parts apart.
// What the form covers structurally: the condition tree (leaves plus
// `all`/`any`/`not`, see condition-draft.ts), a flat stat payload (optionally with its own
// dynamic stats), a *tiered* payload keyed on bonus occurrences, and a *variants* payload
// (first matching condition wins, each with its own optional dynamic stats). Only conditions
// nested deeper than `MAX_DEPTH`, unrecognized condition keys, complex tiers, or a grant using
// both `tiers` and `variants` fall through to the JSON escape hatch -- the editor never
// silently flattens a structure it has no widget for.
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
} from "./condition-draft";
import type {
  Grant,
  GrantVariant,
  GrantProblem,
  Bonus,
  StatValues,
  DynamicStatConfig,
} from "../types";

// Exactly what the engine reads off a tier (bonus.ts `evaluateBonus`). Anything else on a
// tier would be dropped by the form, so its presence forces JSON mode instead.
const TIER_KEYS = new Set(["bonusOccurrences", "stats"]);
const OCCURRENCE_KEYS = new Set(["bonus", "atLeast"]);
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
      tier.bonusOccurrences &&
      typeof tier.bonusOccurrences === "object" &&
      Object.keys(tier.bonusOccurrences).every((key) =>
        OCCURRENCE_KEYS.has(key),
      ),
  );

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
 *  `ItemForm.vue`'s "Dynamic stats" section) -- but `Grant.dynamicStats` only ever applies
 *  alongside the flat payload, so pairing it with `tiers`/`variants`/`problem` on the same
 *  grant has no widget and falls to JSON, same "drop to JSON rather than silently flatten"
 *  rule `tiers`/`variants`/`problem` already follow. */
export const needsJson = (grant: Grant) =>
  Boolean(
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
  Object.entries(stats ?? {}).map(([key, value]) => ({
    key,
    value: value as number,
  }));

export const rowsToStats = (
  rows: StatRow[] | undefined,
): Record<string, number> => {
  const stats: Record<string, number> = {};
  for (const { key, value } of rows ?? []) {
    const number = Number(value);
    if (
      !key ||
      (value as unknown) === "" ||
      value == null ||
      !Number.isFinite(number)
    )
      continue;
    stats[key] = number;
  }
  return stats;
};

/** One `DynamicStatConfig` row -- widened to `number | string | null` like every other
 *  numeric draft field so a cleared input reads as empty rather than `0`. Shared by the item
 *  editor (`Item.dynamicStats`) and the grant/variant "Dynamic stats" sections below, since
 *  both edit the same underlying shape. */
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
    .map((d) => ({
      stat: d.stat,
      min: Number(d.min) || 0,
      max: Number(d.max) || 0,
      default: Number(d.default) || 0,
      ...(d.label.trim() ? { label: d.label.trim() } : {}),
    }));

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

export interface TierDraft {
  bonus: string;
  atLeast: number;
  stats: StatRow[];
}

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
  /** Same across every payload, unlike the payload-specific fields above -- see
   * `Grant.name`/`shortDescription`/`longDescription`. */
  name: string;
  shortDescription: string;
  longDescription: string;
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
          bonus: tier.bonusOccurrences?.bonus ?? "",
          atLeast: tier.bonusOccurrences?.atLeast ?? 1,
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
  };
}

/**
 * True when every condition tree in the grant serializes without dropping anything: the
 * grant's own `when`, plus each variant's when when the payload is `variants` (a variant
 * with *no* condition is valid -- it always matches -- so an empty tree is complete). The
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
  const when = rowsToWhen(draft.conditions);
  if (Object.keys(when).length) out.when = when;

  if (draft.payload === "problem") {
    out.problem = {
      severity: draft.problemSeverity,
      message: draft.problemMessage,
    };
    if (draft.problemLabel) out.problem.label = draft.problemLabel;
    if (draft.problemHideFromPicker) out.problem.hideFromPicker = true;
  } else if (draft.payload === "tiers") {
    out.tiers = draft.tiers.map((tier) => ({
      bonusOccurrences: {
        bonus: tier.bonus,
        atLeast: Number(tier.atLeast) || 1,
      },
      stats: rowsToStats(tier.stats),
    }));
  } else if (draft.payload === "variants") {
    out.variants = draft.variants.map((variant) => {
      const vWhen = rowsToWhen(variant.conditions);
      const entry: GrantVariant = { stats: rowsToStats(variant.stats) };
      if (Object.keys(vWhen).length) entry.when = vWhen;
      const vDynamicStats = rowsToDynamicStats(variant.dynamicStats);
      if (vDynamicStats.length) entry.dynamicStats = vDynamicStats;
      return entry;
    });
  } else {
    out.stats = rowsToStats(draft.stats);
    const dynamicStats = rowsToDynamicStats(draft.dynamicStats);
    if (dynamicStats.length) out.dynamicStats = dynamicStats;
  }

  if (draft.name) out.name = draft.name;
  if (draft.shortDescription) out.shortDescription = draft.shortDescription;
  if (draft.longDescription) out.longDescription = draft.longDescription;

  return out;
}

export interface BonusDraft {
  id: string;
  name: string;
  grants: GrantDraft[];
  stacking?: string;
  maxStacks?: number | string | null;
  excludes?: string[];
}

/** Assembles a bonus-level draft (id/name/grants plus the bonus-level stacking/excludes
 * fields) back into the JSON shape, the same "only include if present" convention `toGrant`
 * used to apply per-effect -- shared by BonusForm.vue and bonus-groups.js so the two editing
 * surfaces can't drift on what counts as "present". Throws if any grant is unparseable JSON. */
export function toBonus(draft: BonusDraft): Bonus {
  const grants = draft.grants.map((g) => toGrant(g));
  const out: Bonus = {
    id: draft.id.trim(),
    name: draft.name.trim() || draft.id.trim(),
    grants,
  };
  if (draft.stacking) out.stacking = draft.stacking;
  if (draft.maxStacks) out.maxStacks = Number(draft.maxStacks);
  if (draft.excludes?.length) out.excludes = [...draft.excludes];
  return out;
}

/** Deep clone, with a fresh uid so the copy does not collide with the original on save. */
export function duplicateDraft(draft: GrantDraft): GrantDraft {
  return {
    ...draft,
    uid: `b${Math.random().toString(36).slice(2, 8)}`,
    conditions: draft.conditions.map(cloneRow),
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
