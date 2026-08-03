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
import type { ConditionRow } from "../engine/condition-draft";
import type { GrantDraft } from "../engine/bonus-draft";

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

  setPayload(payload: "flat" | "tiers" | "variants"): void {
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

  moveTier(index: number, delta: number): void {
    const to = index + delta;
    if (to < 0 || to >= this.grant.tiers.length) return;
    const tiers = this.grant.tiers;
    const [item] = tiers.splice(index, 1);
    tiers.splice(to, 0, item);
    this.store.onChange();
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

  moveVariant(index: number, delta: number): void {
    const to = index + delta;
    if (to < 0 || to >= this.grant.variants.length) return;
    const variants = this.grant.variants;
    const [item] = variants.splice(index, 1);
    variants.splice(to, 0, item);
    this.store.onChange();
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

  moveGrant(index: number, delta: number): void {
    const to = index + delta;
    if (to < 0 || to >= this._getGrants().length) return;
    const grants = this._getGrants();
    const [item] = grants.splice(index, 1);
    grants.splice(to, 0, item);
    this.onChange();
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

  /** Returns a store scoped to one grant. */
  grantStore(index: number): GrantStore | undefined {
    const grants = this._getGrants();
    if (index < 0 || index >= grants.length) return undefined;
    return new GrantStore(this, index);
  }
}
