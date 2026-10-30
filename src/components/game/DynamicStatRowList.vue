<script setup lang="ts">
// A repeatable list of dynamic-stat rows (stat / min / max / default / label): an item's own
// `dynamicStats`, and a bonus grant/variant's. Its own component rather than a `StatRowList`
// variant, since every field here is wrapped in a labeled `FormField`.
import ComboBox from "../ui/ComboBox.vue";
import RepeatableRows from "../ui/RepeatableRows.vue";
import BaseInput from "../ui/BaseInput.vue";
import StatValueInput from "./StatValueInput.vue";
import FormField from "../ui/FormField.vue";
import { statPickerOptions } from "../../lib/format";
import type { DynamicStatDraft } from "../../lib/bonus-draft";

defineProps<{ rows: DynamicStatDraft[] }>();
const emit = defineEmits<{ add: []; remove: [index: number] }>();

/** The value fields, each typed in the stat's own units. */
const BOUNDS = [
  { key: "min", label: "Min" },
  { key: "max", label: "Max" },
  { key: "default", label: "Default" },
] as const;
</script>

<template>
  <RepeatableRows
    :rows="rows"
    row-class="dynamic-stat-row flex md:flex-wrap items-center gap-1.5 mb-1"
    add-label="Add dynamic stat"
    remove-label="Remove dynamic stat"
    @add="emit('add')"
    @remove="(i) => emit('remove', i)"
  >
    <template #lead="{ row }">
      <FormField label="Stat">
        <ComboBox
          class="combo--stat w-full md:w-52"
          :model-value="row.stat"
          :options="statPickerOptions"
          placeholder="- pick a stat -"
          phone-screen
          screen-label="Stat"
          @update:model-value="(v) => (row.stat = v)"
        />
      </FormField>
    </template>
    <template #row="{ row }">
      <!-- Equal columns on a phone, so the bounds line up from row to row. -->
      <div class="grid w-full grid-cols-3 gap-1.5 md:contents">
        <FormField
          v-for="field in BOUNDS"
          :key="field.key"
          :label="field.label"
        >
          <StatValueInput
            v-model="row[field.key]"
            :stat-key="row.stat"
            class="w-full md:w-24"
          />
        </FormField>
      </div>
      <FormField label="Label (optional)" class="w-full md:w-auto">
        <BaseInput v-model="row.label" class="w-full md:w-40" type="text" />
      </FormField>
    </template>
    <template #empty>
      <span class="text-muted">No dynamic stats.</span>
    </template>
  </RepeatableRows>
</template>
