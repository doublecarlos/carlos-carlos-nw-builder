<script setup lang="ts">
// Presentational card shell: rounded border, surface background, shadow. Use inside
// BasePopover for overlay cards, or stand-alone for inline cards.
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-line bg-surface shadow-lg"
  >
    <slot />
  </div>
</template>
