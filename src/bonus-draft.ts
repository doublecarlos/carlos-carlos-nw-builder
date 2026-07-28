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

import { whenIsRepresentable, whenToRows, rowsToWhen, cloneRow } from './condition-draft';

// Exactly what the engine reads off a tier (bonus.ts `evaluateBonus`). Anything else on a
// tier would be dropped by the form, so its presence forces JSON mode instead.
const TIER_KEYS = new Set(['pieces', 'stats']);
const PIECES_KEYS = new Set(['set', 'atLeast']);
const VARIANT_KEYS = new Set(['when', 'stats']);

const tiersAreSimple = (tiers: any[]) => (tiers ?? []).every((tier) => (
  Object.keys(tier).every((key) => TIER_KEYS.has(key))
  && tier.pieces && typeof tier.pieces === 'object'
  && Object.keys(tier.pieces).every((key) => PIECES_KEYS.has(key))
));

const variantsAreSimple = (variants: any[]) => (variants ?? []).every((variant) => (
  Object.keys(variant).every((key) => VARIANT_KEYS.has(key))
  && variant.stats && typeof variant.stats === 'object'
  && whenIsRepresentable(variant.when)
));

/** Structures the form cannot represent without losing something. */
export const needsJson = (grant: any) => Boolean(
  !whenIsRepresentable(grant.when)
  || (grant.tiers && !tiersAreSimple(grant.tiers))
  || (grant.variants && (grant.tiers || !variantsAreSimple(grant.variants))),
);

export const statRows = (stats: any) => Object.entries(stats ?? {})
  .map(([key, value]) => ({ key, value }));

export const rowsToStats = (rows: any[]) => {
  const stats: Record<string, number> = {};
  for (const { key, value } of rows ?? []) {
    const number = Number(value);
    if (!key || value === '' || value == null || !Number.isFinite(number)) continue;
    stats[key] = number;
  }
  return stats;
};

export const newVariant = () => ({
  uid: `v${Math.random().toString(36).slice(2, 8)}`,
  conditions: [] as any[],
  stats: [] as any[],
});

export function toDraft(grant: any = {}) {
  const json = needsJson(grant);
  return {
    uid: `b${Math.random().toString(36).slice(2, 8)}`,
    mode: json ? 'json' : 'simple',
    json: JSON.stringify(grant, null, 2),
    conditions: json ? [] : whenToRows(grant.when),
    payload: grant.variants ? 'variants' : (grant.tiers ? 'tiers' : 'flat'),
    stats: json ? [] : statRows(grant.stats),
    tiers: json ? [] : (grant.tiers ?? []).map((tier: any) => ({
      set: tier.pieces?.set ?? '',
      atLeast: tier.pieces?.atLeast ?? 1,
      stats: statRows(tier.stats),
    })),
    variants: json ? [] : (grant.variants ?? []).map((variant: any) => ({
      ...newVariant(),
      conditions: whenToRows(variant.when),
      stats: statRows(variant.stats),
    })),
  };
}

/** Throws on unparseable JSON so the caller can report it rather than dropping the grant. */
export function toGrant(draft: any): any {
  if (draft.mode === 'json') return JSON.parse(draft.json);

  const out: any = {};
  const when = rowsToWhen(draft.conditions);
  if (Object.keys(when).length) out.when = when;

  if (draft.payload === 'tiers') {
    out.tiers = draft.tiers.map((tier: any) => ({
      pieces: { set: tier.set, atLeast: Number(tier.atLeast) || 1 },
      stats: rowsToStats(tier.stats),
    }));
  } else if (draft.payload === 'variants') {
    out.variants = draft.variants.map((variant: any) => {
      const vWhen = rowsToWhen(variant.conditions);
      const entry: any = { stats: rowsToStats(variant.stats) };
      if (Object.keys(vWhen).length) entry.when = vWhen;
      return entry;
    });
  } else {
    out.stats = rowsToStats(draft.stats);
  }

  return out;
}

/** Assembles a set-level draft (id/name/grants plus the set-level stacking/excludes fields)
 * back into the JSON shape, the same "only include if present" convention `toGrant` used to
 * apply per-effect -- shared by BonusSetForm.vue and bonus-groups.js so the two editing
 * surfaces can't drift on what counts as "present". Throws if any grant is unparseable JSON. */
export function toSet(draft: any) {
  const grants = draft.grants.map((g: any) => toGrant(g));
  const out: any = { id: draft.id.trim(), name: draft.name.trim() || draft.id.trim(), grants };
  if (draft.stacking) out.stacking = draft.stacking;
  if (draft.maxStacks) out.maxStacks = Number(draft.maxStacks);
  if (draft.excludes?.length) out.excludes = [...draft.excludes];
  return out;
}

/** Deep clone, with a fresh uid so the copy does not collide with the original on save. */
export function duplicateDraft(draft: any) {
  return {
    ...draft,
    uid: `b${Math.random().toString(36).slice(2, 8)}`,
    conditions: draft.conditions.map(cloneRow),
    stats: draft.stats.map((s: any) => ({ ...s })),
    tiers: draft.tiers.map((tier: any) => ({ ...tier, stats: tier.stats.map((s: any) => ({ ...s })) })),
    variants: draft.variants.map((variant: any) => ({
      ...newVariant(),
      conditions: variant.conditions.map(cloneRow),
      stats: variant.stats.map((s: any) => ({ ...s })),
    })),
  };
}
