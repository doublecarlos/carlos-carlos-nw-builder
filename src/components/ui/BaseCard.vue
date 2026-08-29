<script setup lang="ts">
// Presentational card shell: rounded rim, surface background, shadow. Use inside BasePopover
// for overlay cards, or stand-alone for inline cards. The rim is --line-strong rather than
// --line so a floating card still detaches from the content behind it.
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-line-strong bg-surface shadow-xl"
  >
    <slot />
  </div>
</template>
