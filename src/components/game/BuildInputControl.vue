<script setup lang="ts">
// One typed value on a build-editor row (useSlotInputs.ts's `BuildInput`), rendered by its
// `control`: a checkbox with its label, a stepper, a typed field noting its range, or a note
// pointing to the row that holds the control. Presets go in InputRow's slot for them, which
// places them by layout. Writes go straight to the store by the value's address. A shared
// input's control carries a shared mark whose tooltip names where else it is set. `bare`
// leaves the label to the row, as on a shared input's own row, and `inputId` lets that
// row's label point at the control.
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import BaseInput from "../ui/BaseInput.vue";
import InputRow from "../ui/InputRow.vue";
import NumberStepper from "../ui/NumberStepper.vue";
import PercentInput from "../ui/PercentInput.vue";
import PresetButtons from "../ui/PresetButtons.vue";
import SharedMark from "./SharedMark.vue";
import * as buildEditor from "../../stores/buildEditor";
import { int, pctInput } from "../../lib/format";
import type { BuildInput } from "../../composables/useSlotInputs";

const props = defineProps<{
  input: BuildInput;
  bare?: boolean;
  inputId?: string;
}>();

function set(value: number | boolean | null) {
  buildEditor.setInput(props.input.address, value, props.input.spec.label);
}

/** A typed number applies as it is typed. An emptied field writes nothing yet, since the
 *  default would refill it mid-edit; it clears back to the default once the field is left. */
function onField(raw: string | number | null) {
  if (typeof raw === "number" && Number.isFinite(raw)) set(raw);
}

function onFieldBlur(event: FocusEvent) {
  if ((event.target as HTMLInputElement).value.trim() === "") set(null);
}

/** PercentInput holds its own text while focused, so an emptied one can clear at once. */
function onPercent(raw: string | number | null) {
  if (raw === "" || raw === null) set(null);
  else onField(raw);
}

function rangeNote() {
  const format = props.input.spec.type === "percent" ? pctInput : int;
  return `(from ${format(props.input.spec.min)} to ${format(props.input.spec.max)})`;
}
</script>

<template>
  <p
    v-if="input.control === 'note'"
    class="text-muted"
    :data-testid="input.testid"
  >
    {{ input.note }}
  </p>
  <!-- A checkbox stays one clickable unit with its label, so it skips InputRow's grid. The
       shared mark sits outside it, so tapping the mark never toggles the box. -->
  <!-- Bare on a slot row, the box takes the row label's own box (one line, its padding and
       border), so the two share a center line. -->
  <div
    v-else-if="input.control === 'checkbox'"
    class="flex items-center gap-1.5"
    :class="bare && 'box-content h-lh border-y border-transparent py-0.5'"
  >
    <BaseCheckbox
      :input-id="inputId"
      :data-testid="input.testid"
      :model-value="input.value === 1"
      @update:model-value="set($event as boolean)"
    >
      <template v-if="!bare">{{ input.spec.label }}</template>
    </BaseCheckbox>
    <SharedMark
      v-if="input.shared"
      :text="input.shared"
      :testid="`${input.testid}-shared`"
    />
  </div>
  <InputRow v-else>
    <NumberStepper
      v-if="input.control === 'stepper'"
      :id="inputId"
      :min="input.spec.min"
      :max="input.spec.max"
      :step="input.spec.step"
      :model-value="input.value"
      :data-testid="input.testid"
      @update:model-value="set"
    />
    <PercentInput
      v-else-if="input.spec.type === 'percent'"
      :input-id="inputId"
      class="w-full"
      :model-value="input.value"
      :data-testid="input.testid"
      @update:model-value="onPercent"
    />
    <BaseInput
      v-else
      :id="inputId"
      type="number"
      class="w-full"
      :min="input.spec.min"
      :max="input.spec.max"
      :step="input.spec.step"
      :model-value="input.value"
      :data-testid="input.testid"
      @update:model-value="onField"
      @blur="onFieldBlur"
    />
    <template #description
      ><!-- Flex centers the mark on the label's line; vertical-align would place it by the
           font's metrics, which round differently from row to row. -->
      <span
        v-if="!bare || input.shared"
        class="inline-flex items-center gap-1.5"
        ><template v-if="!bare">{{ input.spec.label }}</template
        ><SharedMark
          v-if="input.shared"
          :text="input.shared"
          :testid="`${input.testid}-shared`" /></span
    ></template>
    <template v-if="input.spec.presets?.length" #presets>
      <PresetButtons
        :presets="input.spec.presets"
        :format="input.spec.format"
        :model-value="input.value"
        @update:model-value="set($event ?? null)"
      />
    </template>
    <template v-if="input.control === 'field'" #note>{{
      rangeNote()
    }}</template>
  </InputRow>
</template>
