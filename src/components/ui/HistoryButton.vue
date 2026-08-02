<script setup lang="ts">
// Undo/redo button: fixed-width, single line, with an inline detail label of what the next
// step would do -- shared by BuildBar, ItemForm, BonusSetForm and DataEditor's own history.
import BaseButton from "./BaseButton.vue";
import { Redo2, Undo2 } from "@lucide/vue";

defineProps<{
  disabled?: boolean;
  detail?: string;
  type: "undo" | "redo";
}>();

const iconMap = {
  undo: Undo2,
  redo: Redo2,
} as const;
</script>

<template>
  <BaseButton
    :disabled="disabled"
    class="overflow-hidden text-left whitespace-nowrap"
    :data-testid="'history-' + type"
  >
    <component :is="iconMap[type]" />
    <slot />
  </BaseButton>
</template>
