<script setup lang="ts">
// The inputs for one item's BonusOccurrenceConfig attachments outside the active build: a
// preset's counts (PresetForm.vue) and the item editor's preview (BonusOccurrenceSection.vue).
// A 0-1 range reads as a checkbox, a wider range as a stepper. The build editor renders its own
// counts through BuildInputControl.vue.
//
// Multi-root on purpose: every caller wraps these in its own layout, so the wrapper stays
// theirs and only the controls are shared.
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import InputRow from "../ui/InputRow.vue";
import NumberStepper from "../ui/NumberStepper.vue";
import type { OccurrenceRow } from "../../composables/useItemBonusOccurrences";

defineProps<{
  rows: OccurrenceRow[];
  /** Leading part of each control's `data-testid`: `<prefix>-toggle-<bonusId>` and
   *  `<prefix>-input-<bonusId>`. */
  testidPrefix: string;
}>();

const emit = defineEmits<{
  change: [bonusId: string, count: number];
}>();
</script>

<template>
  <!-- A checkbox stays one clickable unit with its label, so it skips InputRow's grid. -->
  <BaseCheckbox
    v-for="row in rows.filter((r) => r.kind === 'checkbox')"
    :key="row.bonusId"
    :data-testid="`${testidPrefix}-toggle-${row.bonusId}`"
    :model-value="row.value === 1"
    @update:model-value="emit('change', row.bonusId, $event ? 1 : 0)"
  >
    {{ row.label }}
  </BaseCheckbox>
  <InputRow
    v-for="row in rows.filter((r) => r.kind === 'stepper')"
    :key="row.bonusId"
  >
    <NumberStepper
      :min="row.min"
      :max="row.max"
      :model-value="row.value"
      :data-testid="`${testidPrefix}-input-${row.bonusId}`"
      @update:model-value="emit('change', row.bonusId, $event)"
    />
    <template #description>
      <span>{{ row.label }}</span>
    </template>
  </InputRow>
</template>
