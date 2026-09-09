<script setup lang="ts">
// A repeatable list of "pick a stat, type its value" rows -- an item's flat `stats`, and a
// bonus grant/tier/variant's own `stats`. Add/remove stays with the caller (each entity's
// draft owns its own `addStat`/`removeStat` pair), this only owns the row markup and the
// Tab/Enter jump to the next row's stat picker.
import ComboBox from "../ui/ComboBox.vue";
import IconButton from "../ui/IconButton.vue";
import StatValueInput from "./StatValueInput.vue";
import { Plus, Trash } from "@lucide/vue";
import { statPickerOptions } from "../../lib/format";
import { focusNextCombo } from "../../lib/stat-row-nav";
import type { StatRow } from "../../engine/bonus-draft";

defineProps<{ rows: StatRow[] }>();
defineEmits<{ add: []; remove: [index: number] }>();
</script>

<template>
  <div
    v-for="(stat, index) in rows"
    :key="index"
    class="stat-row flex flex-wrap items-center gap-1.5 mb-1"
  >
    <IconButton title="Add stat" @click="$emit('add')"><Plus /></IconButton>
    <IconButton title="Remove stat" @click="$emit('remove', index)"
      ><Trash
    /></IconButton>
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
  </div>
  <div
    v-if="!rows.length"
    class="stat-row flex flex-wrap items-center gap-1.5 mb-1"
  >
    <IconButton title="Add stat" @click="$emit('add')"><Plus /></IconButton>
  </div>
</template>
