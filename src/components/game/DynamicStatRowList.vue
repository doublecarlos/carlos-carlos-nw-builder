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
</script>

<template>
  <RepeatableRows
    :rows="rows"
    row-class="dynamic-stat-row flex flex-wrap items-center gap-1.5 mb-1"
    add-label="Add dynamic stat"
    remove-label="Remove dynamic stat"
    @add="emit('add')"
    @remove="(i) => emit('remove', i)"
  >
    <template #row="{ row }">
      <FormField label="Stat">
        <ComboBox
          class="combo--stat w-52"
          :model-value="row.stat"
          :options="statPickerOptions"
          placeholder="- pick a stat -"
          @update:model-value="(v) => (row.stat = v)"
        />
      </FormField>
      <FormField label="Min">
        <StatValueInput v-model="row.min" :stat-key="row.stat" class="w-24" />
      </FormField>
      <FormField label="Max">
        <StatValueInput v-model="row.max" :stat-key="row.stat" class="w-24" />
      </FormField>
      <FormField label="Default">
        <StatValueInput
          v-model="row.default"
          :stat-key="row.stat"
          class="w-24"
        />
      </FormField>
      <FormField label="Label (optional)">
        <BaseInput v-model="row.label" class="w-40" type="text" />
      </FormField>
    </template>
    <template #empty>
      <span class="text-muted"
        >No dynamic stats defined. A dynamic stat's value is typed per
        build.</span
      >
    </template>
  </RepeatableRows>
</template>
