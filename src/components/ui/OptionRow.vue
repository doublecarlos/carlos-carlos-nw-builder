<script setup lang="ts">
// How a named id reads as a picker row: the label leads, the id sits under it in small type.
// Every picker over named ids shares it (bonuses, inputs, filters, tags), so their rows never
// drift. The second line is dropped when it would repeat the first.
import type { ComboBoxOption } from "./ComboBox.vue";

defineProps<{ option: Pick<ComboBoxOption, "value" | "label"> }>();
</script>

<template>
  <div class="min-w-0 leading-tight">
    <div class="overflow-hidden text-ellipsis whitespace-nowrap">
      {{ option.label }}
    </div>
    <div
      v-if="option.value !== option.label"
      class="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted"
      data-testid="option-row-id"
    >
      {{ option.value }}
    </div>
  </div>
</template>
