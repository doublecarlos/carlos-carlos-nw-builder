// The names a condition summary reads (lib/condition-summary.ts), built once per condition tree.
// The outermost ConditionRows builds it from the editor's catalog and provides it, and every
// nested branch reuses that one. It is lazy, so a layout that shows no summaries never builds it.
import {
  computed,
  inject,
  provide,
  type ComputedRef,
  type InjectionKey,
} from "vue";
import { useEditorDb } from "./useEditorDb";
import { summaryContext } from "../lib/condition-summary";
import type { BonusOption, BuildParameterSlot, EvalContext } from "../types";
import type { InputOption } from "../lib/bonus-draft";

const SUMMARY_CONTEXT: InjectionKey<ComputedRef<EvalContext>> = Symbol(
  "conditionSummaryContext",
);

export function useConditionSummaryContext(
  options: () => { bonuses: BonusOption[]; inputs: InputOption[] },
): ComputedRef<EvalContext> {
  const outer = inject(SUMMARY_CONTEXT, null);
  if (outer) return outer;
  const db = useEditorDb();
  const context = computed(() => {
    const { bonuses, inputs } = options();
    return summaryContext({
      bonusNames: new Map(bonuses.map((bonus) => [bonus.value, bonus.label])),
      itemNames: new Map(db.value.items.map((item) => [item.id, item.name])),
      paramLabels: new Map(
        db.value.slots
          .filter(
            (slot): slot is BuildParameterSlot =>
              slot.type === "build_parameter",
          )
          .map((slot) => [slot.path, slot.label]),
      ),
      inputs,
    });
  });
  provide(SUMMARY_CONTEXT, context);
  return context;
}
