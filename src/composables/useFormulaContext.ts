// What a bonus's formula fields check and preview against, handed down by provide/inject so
// every field in the form (grant scales, tier measures, condition leaves at any depth, named
// formulas) sees the same thing without threading props through the condition tree.
//
// Lookups are checked against the catalog being authored (useEditorDb). Previews run against
// the active build, with the draft's own inputs and named formulas in scope, so an edit shows
// its value before it is saved. Derived labels read the draft and the catalog alone, so they
// show with no build.
import {
  computed,
  inject,
  provide,
  type ComputedRef,
  type InjectionKey,
} from "vue";
import { useEditorDb } from "./useEditorDb";
import * as engine from "../stores/resolved";
import * as builds from "../stores/builds";
import { bonusContext, resolveInputValues } from "../engine/bonus";
import { bonusInputSpec } from "../engine/inputs";
import type { FormulaVocabulary, LabelContext } from "../engine/formula";
import type {
  Bonus,
  BonusOption,
  BuildParameterSlot,
  EvalContext,
} from "../types";

/** The bonus whose formulas are edited, as the formula checks read it. */
export type FormulaOwner = Pick<
  Bonus,
  "id" | "inputs" | "formulas" | "stacking"
>;

export interface FormulaContext {
  owner: ComputedRef<FormulaOwner>;
  vocabulary: ComputedRef<FormulaVocabulary>;
  /** Every parameter declaring a scaler, for the reference list. */
  scalers: ComputedRef<BonusOption[]>;
  /** What derived labels read: the owner's inputs and named formulas, and the scalers. */
  labels: ComputedRef<LabelContext>;
  /** The name of the build previews run against, the active one. */
  buildName: ComputedRef<string>;
  /** The active build as the owner reads it, with a fresh named-formula scope per call. Null
   *  while the build does not resolve. */
  evalContext: () => EvalContext | null;
}

const FORMULA_CONTEXT: InjectionKey<FormulaContext> = Symbol("formulaContext");

/** Offers the formula context of `owner` to every formula field below. */
export function provideFormulaContext(
  owner: () => FormulaOwner,
): FormulaContext {
  const db = useEditorDb();
  const ownerRef = computed(owner);
  const params = computed(
    () =>
      new Map(
        db.value.slots
          .filter(
            (slot): slot is BuildParameterSlot =>
              slot.type === "build_parameter",
          )
          .map((slot) => [slot.path, slot]),
      ),
  );
  const vocabulary = computed<FormulaVocabulary>(() => ({
    params: params.value,
    bonusIds: new Set(db.value.bonuses.map((bonus) => bonus.id)),
    itemIds: new Set(db.value.items.map((item) => item.id)),
    tags: new Set(db.value.itemsByTag.keys()),
  }));
  const scalers = computed<BonusOption[]>(() =>
    [...params.value.values()]
      .filter((slot) => slot.scaler)
      .map((slot) => ({ value: slot.path, label: slot.label })),
  );
  const labels = computed<LabelContext>(() => ({
    inputs: new Map(
      Object.entries(ownerRef.value.inputs ?? {}).map(([name, def]) => [
        name,
        { label: bonusInputSpec(def, name).label },
      ]),
    ),
    scalers: new Map(
      scalers.value.map((option) => [option.value, { label: option.label }]),
    ),
    formulas: { named: ownerRef.value.formulas ?? {} },
  }));
  const context: FormulaContext = {
    owner: ownerRef,
    vocabulary,
    scalers,
    labels,
    buildName: computed(() => builds.build.value?.name ?? ""),
    evalContext() {
      const resolved = engine.resolved.value;
      const build = builds.build.value;
      if (!resolved.ok || !build) return null;
      const bonus = ownerRef.value;
      return bonusContext(
        bonus,
        resolved.result.context,
        resolveInputValues(bonus, build),
      );
    },
  };
  provide(FORMULA_CONTEXT, context);
  return context;
}

/** The surrounding bonus form's formula context, or null outside one. */
export function useFormulaContext(): FormulaContext | null {
  return inject(FORMULA_CONTEXT, null);
}
