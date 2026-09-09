<script setup lang="ts">
// A repeatable list of "pick a stat, type its value" rows -- an item's flat `stats`, and a
// bonus grant/tier/variant's own `stats`. Add/remove stays with the caller (each entity's
// draft owns its own `addStat`/`removeStat` pair), this only owns the row markup and the
// Tab/Enter jump to the next row's stat picker.
import ComboBox from "../ui/ComboBox.vue";
import RepeatableRows from "../ui/RepeatableRows.vue";
import StatValueInput from "./StatValueInput.vue";
import { statPickerOptions } from "../../lib/format";
import { focusNextCombo } from "../../lib/stat-row-nav";
import type { StatRow } from "../../lib/bonus-draft";

defineProps<{ rows: StatRow[] }>();
const emit = defineEmits<{ add: []; remove: [index: number] }>();
</script>

<template>
  <RepeatableRows
    :rows="rows"
    row-class="stat-row flex flex-wrap items-center gap-1.5 mb-1"
    add-label="Add stat"
    remove-label="Remove stat"
    @add="emit('add')"
    @remove="(i) => emit('remove', i)"
  >
    <template #row="{ row: stat }">
      <ComboBox
        class="combo--stat w-52"
        :model-value="stat.key"
        :options="statPickerOptions"
        placeholder="- pick a stat -"
        @update:model-value="(v) => (stat.key = v)"
      />
      <StatValueInput
        v-model="stat.value"
        :stat-key="stat.key"
        class="w-28"
        step="any"
        @keydown="focusNextCombo"
      />
    </template>
  </RepeatableRows>
</template>
