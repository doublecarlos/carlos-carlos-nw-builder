<script setup lang="ts">
// Label-above-control stack, the data editor's basic form unit: ItemForm, BonusForm,
// ConditionRows, BonusRows, Options, QuickOptions.
//
// The label is a real `<label for>`: the first ui text control inside (BaseInput, ComboBox and
// the like) claims the field through useFormField.ts, so clicking the label focuses it and
// assistive tech reads the pair. SegmentedControl names its group with the label instead.
//
// As a FormGrid cell the field spans two subgrid rows, label then control, so every control
// on a visual row starts at the same y even when a neighbor's label wraps.
import { provideFormField } from "../../composables/useFormField";

const props = defineProps<{
  label?: string;
  /** Keeps the label line empty when there is no label, so the control lines up with labeled
   *  neighbors on the same row. */
  labelSpacer?: boolean;
}>();

const { inGrid, labelId, controlId } = provideFormField(() => !!props.label);
</script>

<template>
  <div
    :class="
      inGrid
        ? 'row-span-2 grid grid-rows-subgrid gap-y-0.5'
        : 'flex flex-col gap-0.5'
    "
  >
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
    <span v-else-if="inGrid"></span>
    <div v-if="inGrid" class="flex min-w-0 flex-col gap-0.5">
      <slot />
    </div>
    <slot v-else />
  </div>
</template>
