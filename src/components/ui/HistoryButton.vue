<script setup lang="ts">
// Undo/redo button: fixed-width, single line, with an inline detail label of what the next
// step would do -- shared by BuildBar, ItemForm, BonusSetForm and DataEditor's own history.
import Button from './Button.vue';

defineProps<{
  disabled?: boolean;
  detail?: string;
}>();
</script>

<template>
  <Button :disabled="disabled" class="max-w-xs overflow-hidden text-left whitespace-nowrap">
    <slot />
    <span v-if="detail" class="ml-1 inline-block max-w-40 overflow-hidden text-ellipsis whitespace-nowrap align-bottom text-muted">{{ detail }}</span>
  </Button>
</template>
