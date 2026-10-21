<script setup lang="ts">
// The left gutter of a nested row: a guide line hanging from the parent above it, and, for a
// row with a nested sibling below, a bottom border that starts at the line instead of the edge.
// The row itself must be `relative` and drop its own bottom border while `nest.last` is false.
import type { NestPosition } from "../../lib/slot-parent";

defineProps<{ nest: NestPosition }>();
</script>

<template>
  <span
    aria-hidden="true"
    data-testid="nest-guide"
    class="pointer-events-none absolute left-3.5 w-px bg-line"
    :class="[
      nest.first ? 'top-1.5' : 'top-0',
      nest.last ? 'bottom-1.5' : 'bottom-0',
    ]"
  />
  <span
    v-if="!nest.last"
    aria-hidden="true"
    class="pointer-events-none absolute bottom-0 left-3.5 right-0 h-px bg-line/45"
  />
</template>
