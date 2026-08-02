<script setup lang="ts">
// Sticky header bar for a BaseCard. Use `sticky` prop to make it stick to the top of
// the card's scroll container.
withDefaults(defineProps<{ sticky?: boolean }>(), { sticky: false });
</script>

<template>
  <div
    class="flex items-center gap-2 border-b border-line bg-surface px-2.5 py-1.5"
    :class="sticky && 'sticky top-0 z-10'"
  >
    <slot />
  </div>
</template>
