<script setup lang="ts">
// A repeatable list of a bonus's named formulas: a name, referenced as `$name` by any formula
// of the bonus, and the formula it stands for. The same row-mutating shape as
// `BonusInputRowList`. Inputs share the `$` names, so a name an input has is flagged.
import BaseInput from "../ui/BaseInput.vue";
import FormField from "../ui/FormField.vue";
import RepeatableRows from "../ui/RepeatableRows.vue";
import FormulaField from "./FormulaField.vue";
import { isFormulaName } from "../../engine/formula";
import type { NamedFormulaDraft } from "../../lib/bonus-draft";
import type { FormulaInputIssue } from "../ui/FormulaInput.vue";

const props = defineProps<{
  rows: NamedFormulaDraft[];
  /** Reference cycles among the rows, each as the names along it, first repeated last. */
  cycles: string[][];
  /** Row names the bonus also declares as inputs. */
  clashes: string[];
}>();
const emit = defineEmits<{ add: []; remove: [index: number] }>();

/** Problems the formula field cannot see on its own: a named row with no formula, which is
 *  saved and fails validation, or a cycle through the row, marked over its whole formula. */
function rowIssues(row: NamedFormulaDraft): FormulaInputIssue[] {
  const name = row.name.trim();
  if (!name) return [];
  if (!row.formula.trim())
    return [{ start: 0, end: 0, message: "formula is empty" }];
  const cycle = props.cycles.find((names) => names.includes(name));
  if (!cycle) return [];
  return [
    {
      start: 0,
      end: row.formula.length,
      message: `formulas refer to each other in a loop: ${cycle.map((n) => `$${n}`).join(" → ")}`,
    },
  ];
}
</script>

<template>
  <RepeatableRows
    :rows="rows"
    row-class="bonus-formula-row flex flex-wrap items-start gap-1.5 mb-1"
    labeled-fields
    add-label="Add formula"
    remove-label="Remove formula"
    add-testid="add-bonus-formula"
    @add="emit('add')"
    @remove="(i) => emit('remove', i)"
  >
    <template #row="{ row }">
      <FormField label="Name">
        <BaseInput
          v-model="row.name"
          class="w-32 font-mono"
          type="text"
          placeholder="stacks"
          data-testid="bonus-formula-name"
        />
        <span
          v-if="row.name.trim() && !isFormulaName(row.name.trim())"
          class="text-danger"
          data-testid="bonus-formula-name-issue"
          >a letter or _, then letters, digits or _</span
        >
        <span
          v-else-if="clashes.includes(row.name.trim())"
          class="text-danger"
          data-testid="bonus-formula-name-issue"
          >also an input of this bonus; rename the formula</span
        >
      </FormField>
      <FormField label="Formula" class="min-w-72 flex-1">
        <FormulaField
          v-model:formula="row.formula"
          v-model:label="row.label"
          :extra-issues="rowIssues(row)"
          testid="bonus-formula"
        />
      </FormField>
    </template>
    <template #empty>
      <span class="text-muted">No formulas.</span>
    </template>
  </RepeatableRows>
</template>
