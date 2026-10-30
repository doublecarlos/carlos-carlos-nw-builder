<script setup lang="ts">
// Label-above-control stack, the data editor's basic form unit: ItemForm, BonusForm,
// ConditionRows, BonusRows, Options, QuickOptions.
//
// The label is a real `<label for>`: the first ui text control inside (BaseInput, ComboBox and
// the like) claims the field through useFormField.ts, so clicking the label focuses it and
// assistive tech reads the pair. SegmentedControl names its group with the label instead.
//
// The hint shows muted under the control and describes the claiming control. It wraps to the
// field's width rather than widening the field.
import { provideFormField } from "../../composables/useFormField";

const props = defineProps<{
  label?: string;
  /** Keeps the label line empty when there is no label, so the control lines up with labeled
   *  neighbors on the same row. */
  labelSpacer?: boolean;
  /** A short note on what to type, shown under the control. */
  hint?: string;
}>();

const { labelId, hintId, controlId } = provideFormField(
  () => !!props.label,
  () => !!props.hint,
);
</script>

<template>
  <div class="flex flex-col gap-0.5">
    <!-- A span when no labelable control claimed the field (a checkbox, an id display), so no
         `<label>` is left naming nothing; aria-labelledby can still point at it. -->
    <component
      :is="controlId ? 'label' : 'span'"
      v-if="label"
      :id="labelId"
      :for="controlId"
      class="text-muted"
      >{{ label }}</component
    >
    <span v-else-if="labelSpacer" aria-hidden="true">&nbsp;</span>
    <slot />
    <p v-if="hint" :id="hintId" class="w-0 min-w-full text-sm text-muted">
      {{ hint }}
    </p>
  </div>
</template>
