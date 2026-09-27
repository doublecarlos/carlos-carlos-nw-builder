<script setup lang="ts">
// One typed value on a build-editor row (useSlotInputs.ts's `BuildInput`), rendered by its
// `control`: a checkbox with its label, a stepper, or a typed field noting its range. Writes go
// straight to the store by the value's address.
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import BaseInput from "../ui/BaseInput.vue";
import InputRow from "../ui/InputRow.vue";
import NumberStepper from "../ui/NumberStepper.vue";
import PercentInput from "../ui/PercentInput.vue";
import * as buildEditor from "../../stores/buildEditor";
import { int, pctInput } from "../../lib/format";
import type { BuildInput } from "../../composables/useSlotInputs";

const props = defineProps<{ input: BuildInput }>();

function set(value: number | boolean | null) {
  buildEditor.setInput(props.input.address, value, props.input.spec.label);
}

/** An emptied field clears the value back to its default. */
function onField(raw: string | number | null) {
  if (raw === "" || raw === null) set(null);
  else if (typeof raw === "number" && Number.isFinite(raw)) set(raw);
}

function rangeNote() {
  const format = props.input.spec.type === "percent" ? pctInput : int;
  return `(from ${format(props.input.spec.min)} to ${format(props.input.spec.max)})`;
}
</script>

<template>
  <!-- A checkbox stays one clickable unit with its label, so it skips InputRow's grid. -->
  <BaseCheckbox
    v-if="input.control === 'checkbox'"
    :data-testid="input.testid"
    :model-value="input.value === 1"
    @update:model-value="set($event as boolean)"
  >
    {{ input.spec.label }}
  </BaseCheckbox>
  <InputRow v-else>
    <NumberStepper
      v-if="input.control === 'stepper'"
      :min="input.spec.min"
      :max="input.spec.max"
      :model-value="input.value"
      :data-testid="input.testid"
      @update:model-value="set"
    />
    <PercentInput
      v-else-if="input.spec.type === 'percent'"
      class="w-full"
      :model-value="input.value"
      :data-testid="input.testid"
      @update:model-value="onField"
    />
    <BaseInput
      v-else
      type="number"
      class="w-full"
      :min="input.spec.min"
      :max="input.spec.max"
      :model-value="input.value"
      :data-testid="input.testid"
      @update:model-value="onField"
    />
    <template #description>{{ input.spec.label }}</template>
    <template v-if="input.control === 'field'" #note>{{
      rangeNote()
    }}</template>
  </InputRow>
</template>
