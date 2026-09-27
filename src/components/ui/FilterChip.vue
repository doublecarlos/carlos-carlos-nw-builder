<script setup lang="ts">
// An active filter shown as a chip with its own clear button, for a filter that has no control
// of its own on screen (it was set from somewhere else) but still needs saying that it is on.
import BaseBadge from "./BaseBadge.vue";

defineProps<{
  /** Accessible name of the clear button. */
  clearLabel: string;
  /** The chip's test id; the clear button gets `<testid>-clear`. */
  testid: string;
}>();

defineEmits<{ clear: [] }>();
</script>

<template>
  <BaseBadge variant="near" :data-testid="testid">
    <slot />
    <button
      type="button"
      class="ml-1 cursor-pointer font-semibold"
      :aria-label="clearLabel"
      :data-testid="`${testid}-clear`"
      @click="$emit('clear')"
    >
      ✕
    </button>
  </BaseBadge>
</template>
