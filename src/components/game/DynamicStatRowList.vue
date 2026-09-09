<script setup lang="ts">
// A repeatable list of dynamic-stat rows (stat / min / max / default / label) -- an item's own
// `dynamicStats`, and a bonus grant/variant's `dynamicStats`. Same shape as `StatRowList`, one
// field wider; kept as its own component rather than a variant of it since every field here is
// wrapped in a labelled `FormField`, which `StatRowList`'s single-value row isn't.
import ComboBox from "../ui/ComboBox.vue";
import IconButton from "../ui/IconButton.vue";
import BaseInput from "../ui/BaseInput.vue";
import StatValueInput from "./StatValueInput.vue";
import FormField from "../ui/FormField.vue";
import { Plus, Trash } from "@lucide/vue";
import { statPickerOptions } from "../../lib/format";
import type { DynamicStatDraft } from "../../engine/bonus-draft";

defineProps<{ rows: DynamicStatDraft[] }>();
defineEmits<{ add: []; remove: [index: number] }>();
</script>

<template>
  <div
    v-for="(row, index) in rows"
    :key="index"
    class="dynamic-stat-row flex flex-wrap items-center gap-1.5 mb-1"
  >
    <IconButton title="Add dynamic stat" @click="$emit('add')"
      ><Plus
    /></IconButton>
    <IconButton title="Remove dynamic stat" @click="$emit('remove', index)"
      ><Trash
    /></IconButton>
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
      <StatValueInput v-model="row.default" :stat-key="row.stat" class="w-24" />
    </FormField>
    <FormField label="Label (optional)">
      <BaseInput v-model="row.label" class="w-40" type="text" />
    </FormField>
  </div>
  <div
    v-if="!rows.length"
    class="dynamic-stat-row flex flex-wrap items-center gap-1.5 mb-1"
  >
    <IconButton title="Add dynamic stat" @click="$emit('add')"
      ><Plus
    /></IconButton>
  </div>
</template>
