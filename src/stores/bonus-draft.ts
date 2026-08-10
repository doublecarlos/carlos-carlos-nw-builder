// Stores mutations for BonusRows.vue's grant list. BonusSetForm owns `draft` (undo, dirty);
// this store sits between the form and the component, providing grant-level operations so
// BonusRows never has to emit a replaced array back up — it just calls store methods.
//
// The store operates directly on `draft.value.grants` (which is the proxied array from a
// `ref<SetDraft>`), so mutations are picked up by Vue's deep reactivity. `onChange()` is
// called after every mutation to trigger the snapshot-scheduling callback in BonusSetForm.
//
// This replaces the emit-based pattern where BonusRows had to clone the entire grants array
// on every edit and emit it to the parent. Now `addStat(gi)` mutates
// `draft.grants[gi].stats.push(row)` directly — no structural cloning needed.

import * as bonusDraft from "../engine/bonus-draft";
import {
  removeConditionAt,
  insertConditionAt,
  adjustPathAfterRemoval,
  type ConditionRow,
} from "../engine/condition-draft";
import type { GrantDraft } from "../engine/bonus-draft";
import { reorderIndex } from "../composables/useDragAndDrop";

/** Addresses one condition row within a `BonusDraftStore`'s condition trees, for drag-and-drop
 *  transfers between them -- a grant's own "Active when" tree (`scope: "grant"`) or one of its
 *  variants' "When" trees (`scope: "variant"`). `path` is a condition-draft.ts path within
 *  that tree (see its "path addressing" section). */
export interface ConditionLocation {
  grantIndex: number;
  scope: "grant" | "variant";
  variantIndex?: number;
  path: number[];
}

// -- GrantStore ========================================================
// Per-grant: owns all mutations inside a single GrantDraft (payload, stats, tiers, variants,
// JSON toggle). The grant list itself (remove/insert/duplicate/grant-move) is managed by
// the parent BonusDraftStore.

export class GrantStore {
  constructor(
    private store: BonusDraftStore,
    private gi: number,
  ) {}

  get grant(): GrantDraft {
    return this.store.grants[this.gi]!;
  }

  setPayload(payload: "flat" | "tiers" | "variants" | "problem"): void {
    const grant = this.grant;
    grant.payload = payload;
    // Auto-create initial tier when switching to tiered mode (only if empty).
    if (payload === "tiers" && grant.tiers.length === 0) {
      const last = grant.tiers[grant.tiers.length - 1];
      grant.tiers.push({
        set: last?.set ?? this.store.setIds?.[0] ?? "",
        atLeast: (last?.atLeast ?? 0) + 1,
        stats: last ? last.stats.map((s) => ({ ...s })) : [],
      });
    }
    // Auto-create variant when switching to variant mode.
    if (payload === "variants" && grant.variants.length === 0) {
      grant.variants.push(bonusDraft.newVariant());
    }
    this.store.onChange();
  }

  /** Add a stat row to the flat payload's list. */
  addStat(): void {
    this.grant.stats.push({ key: "", value: 0 });
    this.store.onChange();
  }

  removeStat(index: number): void {
    this.grant.stats.splice(index, 1);
    this.store.onChange();
  }

  /** Add a stat row to one tier of a tiered payload. */
  addTierStat(tierIndex: number): void {
    const tier = this.grant.tiers[tierIndex];
    if (!tier) return;
    tier.stats.push({ key: "", value: 0 });
    this.store.onChange();
  }

  removeTierStat(statIndex: number, tierIndex: number): void {
    const tier = this.grant.tiers[tierIndex];
    if (!tier) return;
    tier.stats.splice(statIndex, 1);
    this.store.onChange();
  }

  /** Add a stat row to one variant of a variant payload. */
  addVariantStat(variantIndex: number): void {
    const variant = this.grant.variants[variantIndex];
    if (!variant) return;
    variant.stats.push({ key: "", value: 0 });
    this.store.onChange();
  }

  removeVariantStat(statIndex: number, variantIndex: number): void {
    const variant = this.grant.variants[variantIndex];
    if (!variant) return;
    variant.stats.splice(statIndex, 1);
    this.store.onChange();
  }

  addTier(): void {
    const grant = this.grant;
    const last = grant.tiers[grant.tiers.length - 1];
    grant.tiers.push({
      set: last?.set ?? this.store.setIds?.[0] ?? "",
      atLeast: (last?.atLeast ?? 0) + 1,
      stats: last ? last.stats.map((s) => ({ ...s })) : [],
    });
    this.store.onChange();
  }

  removeTier(index: number): void {
    this.grant.tiers.splice(index, 1);
    this.store.onChange();
  }

  insertTier(index: number): void {
    const grant = this.grant;
    const ref = grant.tiers[index];
    grant.tiers.splice(index + 1, 0, {
      set: ref?.set ?? this.store.setIds?.[0] ?? "",
      atLeast: (ref?.atLeast ?? 0) + 1,
      stats: [],
    });
    this.store.onChange();
  }

  duplicateTier(index: number): void {
    const grant = this.grant;
    const tier = grant.tiers[index];
    grant.tiers.splice(index + 1, 0, {
      ...tier,
      stats: tier.stats.map((s) => ({ ...s })),
    });
    this.store.onChange();
  }

  /** `toIndex` is relative to the tier list as it stands now (before the moved tier is
   *  removed) -- same contract as `moveTier`'s delta and drag-and-drop's drop-index math. */
  moveTierTo(index: number, toIndex: number): void {
    const tiers = this.grant.tiers;
    if (index < 0 || index >= tiers.length) return;
    const clamped = Math.max(0, Math.min(tiers.length, toIndex));
    const insertAt = reorderIndex(index, clamped);
    if (insertAt === index) return;
    const [item] = tiers.splice(index, 1);
    tiers.splice(insertAt, 0, item);
    this.store.onChange();
  }

  moveTier(index: number, delta: number): void {
    this.moveTierTo(index, index + delta);
  }

  addVariant(): void {
    this.grant.variants.push(bonusDraft.newVariant());
    this.store.onChange();
  }

  removeVariant(index: number): void {
    this.grant.variants.splice(index, 1);
    this.store.onChange();
  }

  insertVariant(index: number): void {
    this.grant.variants.splice(index + 1, 0, bonusDraft.newVariant());
    this.store.onChange();
  }

  duplicateVariant(index: number): void {
    const grant = this.grant;
    const variant = grant.variants[index];
    grant.variants.splice(index + 1, 0, {
      ...bonusDraft.newVariant(),
      conditions: variant.conditions.map((r) => ({ ...r })),
      stats: variant.stats.map((s) => ({ ...s })),
    });
    this.store.onChange();
  }

  /** See `moveTierTo` -- same "index relative to the list before removal" contract. */
  moveVariantTo(index: number, toIndex: number): void {
    const variants = this.grant.variants;
    if (index < 0 || index >= variants.length) return;
    const clamped = Math.max(0, Math.min(variants.length, toIndex));
    const insertAt = reorderIndex(index, clamped);
    if (insertAt === index) return;
    const [item] = variants.splice(index, 1);
    variants.splice(insertAt, 0, item);
    this.store.onChange();
  }

  moveVariant(index: number, delta: number): void {
    this.moveVariantTo(index, index + delta);
  }

  /** Attempt to switch between simple/form and JSON editing.
   *  Returns false when the grant is already in JSON mode and the JSON is unparseable — the
   *  caller should report the error. Returns false when the structure is too complex for the
   *  form (stays in JSON mode with an informative message). */
  toggleJson(): -1 | 0 | 1 {
    const grant = this.grant;
    if (grant.mode === "simple") {
      grant.json = JSON.stringify(bonusDraft.toGrant(grant), null, 2);
      grant.mode = "json";
      return 1; // entered JSON mode
    }
    // already in JSON mode → try to enter simple mode (form)
    try {
      const parsed = JSON.parse(grant.json);
      if (bonusDraft.needsJson(parsed)) return 0; // stay JSON: too complex
      Object.assign(grant, bonusDraft.toDraft(parsed), { uid: grant.uid });
    } catch {
      return -1; // invalid JSON — stay JSON, caller reports error
    }
    this.store.onChange();
    return 0; // entered simple/form mode
  }
}

// -- BonusDraftStore ===================================================
// Top-level: owns the grants array reference, manages all grant-level mutations
// (remove/insert/duplicate/grant-move), and creates per-grant GrantStore instances.

export class BonusDraftStore {
  readonly onChange: () => void;

  constructor(
    private readonly _getGrants: () => GrantDraft[],
    onChange: () => void,
    readonly setIds: string[] = [],
  ) {
    this.onChange = onChange;
  }

  get grants(): GrantDraft[] {
    return this._getGrants();
  }

  removeGrant(index: number): void {
    this._getGrants().splice(index, 1);
    this.onChange();
  }

  insertGrant(index: number): void {
    this._getGrants().splice(
      index + 1,
      0,
      bonusDraft.toDraft({ when: {}, stats: {} }),
    );
    this.onChange();
  }

  duplicateGrant(index: number): void {
    this._getGrants().splice(
      index + 1,
      0,
      bonusDraft.duplicateDraft(this._getGrants()[index]),
    );
    this.onChange();
  }

  /** See `GrantStore.moveTierTo` -- same "index relative to the list before removal" contract. */
  moveGrantTo(index: number, toIndex: number): void {
    const grants = this._getGrants();
    if (index < 0 || index >= grants.length) return;
    const clamped = Math.max(0, Math.min(grants.length, toIndex));
    const insertAt = reorderIndex(index, clamped);
    if (insertAt === index) return;
    const [item] = grants.splice(index, 1);
    grants.splice(insertAt, 0, item);
    this.onChange();
  }

  moveGrant(index: number, delta: number): void {
    this.moveGrantTo(index, index + delta);
  }

  /** ConditionRows @update handler for grant-level conditions. */
  setConditions(grantIndex: number, conditions: ConditionRow[]): void {
    const g = this._getGrants()[grantIndex];
    if (!g) return;
    g.conditions = conditions;
    this.onChange();
  }

  /** ConditionRows @update handler for variant-level conditions. */
  setVariantConditions(
    grantIndex: number,
    variantIndex: number,
    conditions: ConditionRow[],
  ): void {
    const g = this._getGrants()[grantIndex];
    if (!g) return;
    const v = g.variants[variantIndex];
    if (!v) return;
    v.conditions = conditions;
    this.onChange();
  }

  /** The `ConditionRow[]` a condition-tree drag-and-drop location resolves to -- a grant's
   *  own "Active when" tree, or one of its variants' "When" trees. */
  rowsAt(location: ConditionLocation): ConditionRow[] | undefined {
    const g = this._getGrants()[location.grantIndex];
    if (!g) return undefined;
    if (location.scope === "grant") return g.conditions;
    const v = g.variants[location.variantIndex ?? -1];
    return v?.conditions;
  }

  /** Moves a condition row from one location in this store's condition trees to another --
   *  within one grant's tree, between two grants, or between a grant and a variant. Both
   *  locations are resolved fresh (not cached), so this is safe to call with a source/target
   *  pair computed before either tree changed. No-op if either location no longer resolves. */
  moveCondition(source: ConditionLocation, target: ConditionLocation): void {
    const sourceRows = this.rowsAt(source);
    const targetRows = this.rowsAt(target);
    if (!sourceRows || !targetRows) return;
    const removed = removeConditionAt(sourceRows, source.path);
    if (!removed) return;
    // Removing the source row can shift indices target.path depends on, but only when both
    // resolve into the *same* array (e.g. dragging a row into a sibling branch of the same
    // grant's tree) -- see adjustPathAfterRemoval's own doc comment.
    const targetPath =
      sourceRows === targetRows
        ? adjustPathAfterRemoval(source.path, target.path)
        : target.path;
    insertConditionAt(targetRows, targetPath, removed);
    this.onChange();
  }

  /** Returns a store scoped to one grant. */
  grantStore(index: number): GrantStore | undefined {
    const grants = this._getGrants();
    if (index < 0 || index >= grants.length) return undefined;
    return new GrantStore(this, index);
  }
}

/** Like `BonusDraftStore.moveCondition`, but the source and target locations live in two
 *  independently-owned stores -- a condition dragged from one bonus's tree into another's
 *  (BonusGroups.vue's cross-bonus registry). Each store's own `onChange()` fires so both
 *  bonuses' undo histories see the edit. */
export function moveConditionAcrossStores(
  source: { store: BonusDraftStore; location: ConditionLocation },
  target: { store: BonusDraftStore; location: ConditionLocation },
): void {
  const sourceRows = source.store.rowsAt(source.location);
  const targetRows = target.store.rowsAt(target.location);
  if (!sourceRows || !targetRows) return;
  const removed = removeConditionAt(sourceRows, source.location.path);
  if (!removed) return;
  const targetPath =
    sourceRows === targetRows
      ? adjustPathAfterRemoval(source.location.path, target.location.path)
      : target.location.path;
  insertConditionAt(targetRows, targetPath, removed);
  source.store.onChange();
  if (target.store !== source.store) target.store.onChange();
}
