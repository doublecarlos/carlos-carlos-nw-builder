<script setup lang="ts">
// Presentational card shell: rounded border, surface background, shadow. Use inside
// BaseTooltip for overlay cards, or stand-alone for inline cards.
</script>

<template>
  <div
    class="overflow-hidden rounded-md border border-line bg-surface shadow-lg"
  >
    <slot />
  </div>
</template>
