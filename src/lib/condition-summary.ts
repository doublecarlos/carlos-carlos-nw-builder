// One condition leaf as a line of text, for the phone's condition list. The text is the engine's
// own leaf label (conditions.ts's `explain`), the same words the item card and bonus inspector
// use, read against a context that carries only names: nothing here depends on a build.
import { explain } from "../engine/conditions";
import {
  rowsToWhen,
  whenRowsComplete,
  type ConditionRow,
} from "../engine/condition-draft";
import { pctInput } from "./format";
import { conditionTypeLabel } from "./condition-fields";
import type { EvalContext, ResolvedInput } from "../types";
import type { InputOption } from "./bonus-draft";

/** What a leaf's label can name: bonuses, items, build parameters and the bonus's inputs. */
export interface SummaryNames {
  bonusNames: Map<string, string>;
  itemNames: Map<string, string>;
  /** Every build parameter's label, by its path. */
  paramLabels: Map<string, string>;
  inputs: readonly InputOption[];
}

/** An evaluation context holding names only. Every known parameter resolves, so a leaf on one
 *  reads by its label; a leaf on an unknown key still reads as unknown. */
export function summaryContext(names: SummaryNames): EvalContext {
  const inputs = new Map<string, ResolvedInput>(
    names.inputs.map((option) => [
      option.value,
      {
        label: option.label,
        value: option.type === "boolean" ? false : 0,
        format: option.type === "percent" ? pctInput : String,
      },
    ]),
  );
  return {
    duration: 0,
    enemies: 0,
    toggles: {},
    equipped: new Map(),
    tags: new Map(),
    bonusOccurrences: new Map(),
    bonusNames: names.bonusNames,
    itemNames: names.itemNames,
    params: new Map([...names.paramLabels.keys()].map((path) => [path, 0])),
    paramLabels: names.paramLabels,
    scalers: new Map(),
    inputs,
  };
}

export interface ConditionSummary {
  text: string;
  /** False while the leaf is missing a value it needs, so it would save as nothing. */
  complete: boolean;
}

export function summarizeLeaf(
  row: ConditionRow,
  ctx: EvalContext,
): ConditionSummary {
  const typeLabel = conditionTypeLabel(row.type);
  if (!whenRowsComplete([row])) return { text: typeLabel, complete: false };
  const text = explain(rowsToWhen([row]), ctx)
    .leaves.map((leaf) => leaf.label)
    .filter(Boolean)
    .join(" + ");
  return { text: text || typeLabel, complete: true };
}
