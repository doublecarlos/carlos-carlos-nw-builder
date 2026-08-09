// The draft <-> grant conversion for BonusRows.vue's editor, split out so item-form and
// set-bonuses can build and read drafts without importing the component.
//
// A grant is anonymous -- no `id`/`name` of its own, since a set now resolves as one unit (its
// final stats are the sum of every active grant) and only the *set* needs to be addressable.
// What the form covers structurally: the condition tree (leaves plus `all`/`any`/`not`, see
// condition-draft.ts), a flat stat payload, a *tiered* payload keyed on set pieces, and a
// *variants* payload (first matching condition wins). Only conditions nested deeper than
// `MAX_DEPTH`, unrecognized condition keys, complex tiers, or a grant using both `tiers` and
// `variants` fall through to the JSON escape hatch -- the editor never silently flattens a
// structure it has no widget for.
//
// Stacking/`excludes` are a *set*-level property now (one grant among several shouldn't imply
// the whole bonus stacks), so they're edited once by the caller (BonusSetForm.vue/
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
  BonusSet,
  StatValues,
} from "../types";

// Exactly what the engine reads off a tier (bonus.ts `evaluateBonus`). Anything else on a
// tier would be dropped by the form, so its presence forces JSON mode instead.
const TIER_KEYS = new Set(["pieces", "stats"]);
const PIECES_KEYS = new Set(["set", "atLeast"]);
const VARIANT_KEYS = new Set(["when", "stats"]);
const PROBLEM_KEYS = new Set(["severity", "message", "label"]);
const PROBLEM_SEVERITIES = new Set(["error", "warning"]);

const tiersAreSimple = (tiers: NonNullable<Grant["tiers"]>) =>
  (tiers ?? []).every(
    (tier) =>
      Object.keys(tier).every((key) => TIER_KEYS.has(key)) &&
      tier.pieces &&
      typeof tier.pieces === "object" &&
      Object.keys(tier.pieces).every((key) => PIECES_KEYS.has(key)),
  );

const variantsAreSimple = (variants: NonNullable<Grant["variants"]>) =>
  (variants ?? []).every(
    (variant) =>
      Object.keys(variant).every((key) => VARIANT_KEYS.has(key)) &&
      variant.stats &&
      typeof variant.stats === "object" &&
      whenIsRepresentable(variant.when),
  );

const problemIsSimple = (problem: GrantProblem) =>
  Object.keys(problem).every((key) => PROBLEM_KEYS.has(key)) &&
  PROBLEM_SEVERITIES.has(problem.severity) &&
  typeof problem.message === "string";

/** Structures the form cannot represent without losing something. */
export const needsJson = (grant: Grant) =>
  Boolean(
    !whenIsRepresentable(grant.when) ||
    (grant.tiers && !tiersAreSimple(grant.tiers)) ||
    (grant.variants && (grant.tiers || !variantsAreSimple(grant.variants))) ||
    (grant.problem &&
      (grant.tiers || grant.variants || !problemIsSimple(grant.problem))),
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

export interface VariantDraft {
  uid: string;
  conditions: ConditionRow[];
  stats: StatRow[];
}

export const newVariant = (): VariantDraft => ({
  uid: `v${Math.random().toString(36).slice(2, 8)}`,
  conditions: [],
  stats: [],
});

export interface TierDraft {
  set: string;
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
  tiers: TierDraft[];
  variants: VariantDraft[];
  problemSeverity: "error" | "warning";
  problemMessage: string;
  problemLabel: string;
  /** Same across every payload, unlike the payload-specific fields above -- see
   * `Grant.shortDescription`/`longDescription`. */
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
    tiers: json
      ? []
      : (grant.tiers ?? []).map((tier) => ({
          set: tier.pieces?.set ?? "",
          atLeast: tier.pieces?.atLeast ?? 1,
          stats: statRows(tier.stats),
        })),
    variants: json
      ? []
      : (grant.variants ?? []).map((variant) => ({
          ...newVariant(),
          conditions: whenToRows(variant.when),
          stats: statRows(variant.stats),
        })),
    problemSeverity: json ? "warning" : (grant.problem?.severity ?? "warning"),
    problemMessage: json ? "" : (grant.problem?.message ?? ""),
    problemLabel: json ? "" : (grant.problem?.label ?? ""),
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
  } else if (draft.payload === "tiers") {
    out.tiers = draft.tiers.map((tier) => ({
      pieces: { set: tier.set, atLeast: Number(tier.atLeast) || 1 },
      stats: rowsToStats(tier.stats),
    }));
  } else if (draft.payload === "variants") {
    out.variants = draft.variants.map((variant) => {
      const vWhen = rowsToWhen(variant.conditions);
      const entry: GrantVariant = { stats: rowsToStats(variant.stats) };
      if (Object.keys(vWhen).length) entry.when = vWhen;
      return entry;
    });
  } else {
    out.stats = rowsToStats(draft.stats);
  }

  if (draft.shortDescription) out.shortDescription = draft.shortDescription;
  if (draft.longDescription) out.longDescription = draft.longDescription;

  return out;
}

export interface SetDraft {
  id: string;
  name: string;
  grants: GrantDraft[];
  stacking?: string;
  maxStacks?: number | string | null;
  excludes?: string[];
}

/** Assembles a set-level draft (id/name/grants plus the set-level stacking/excludes fields)
 * back into the JSON shape, the same "only include if present" convention `toGrant` used to
 * apply per-effect -- shared by BonusSetForm.vue and bonus-groups.js so the two editing
 * surfaces can't drift on what counts as "present". Throws if any grant is unparseable JSON. */
export function toSet(draft: SetDraft): BonusSet {
  const grants = draft.grants.map((g) => toGrant(g));
  const out: BonusSet = {
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
    tiers: draft.tiers.map((tier) => ({
      ...tier,
      stats: tier.stats.map((s) => ({ ...s })),
    })),
    variants: draft.variants.map((variant) => ({
      ...newVariant(),
      conditions: variant.conditions.map(cloneRow),
      stats: variant.stats.map((s) => ({ ...s })),
    })),
  };
}
