<script setup lang="ts">
// The open/closed marker of a fold: one chevron that turns down when expanded, so the change
// reads as motion rather than a swapped icon. Size and color come from the caller.
import { ChevronRight } from "@lucide/vue";

defineProps<{ expanded: boolean }>();
</script>

<template>
  <ChevronRight
    class="transition-transform"
    :class="expanded && 'rotate-90'"
    aria-hidden="true"
  />
</template>
