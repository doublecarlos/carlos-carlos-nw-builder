<script setup lang="ts">
// The insertion line for one `useDropList` (useDragAndDrop.ts). Positioned by the caller's
// `separatorStyle` inside that list's `position: relative` root. Nested lists render their
// own indicator.
defineProps<{
  pos: { top: string } | null;
}>();
</script>

<template>
  <div
    v-if="pos"
    data-testid="drop-indicator"
    class="pointer-events-none absolute left-0 right-0 -mt-px h-[2px] rounded bg-accent z-base"
    :style="pos"
  />
</template>
