<script setup lang="ts">
// The left gutter of a nested row: a guide line hanging from the parent above it, an elbow from
// that line into the label, and, for a row with a nested sibling below, a bottom border that
// starts at the line instead of the edge. The last row's line stops at its elbow.
// The row itself must be `relative` and drop its own bottom border while `nest.last` is false.
// The elbow's `top-4` is the centre of the row's first line, and its width runs up to the
// label's `pl-8.5` indent less a small gap.
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
      nest.last ? (nest.first ? 'h-2.5' : 'h-4') : 'bottom-0',
    ]"
  />
  <span
    aria-hidden="true"
    class="pointer-events-none absolute left-3.5 top-4 h-px w-3.5 bg-line"
  />
  <span
    v-if="!nest.last"
    aria-hidden="true"
    class="pointer-events-none absolute bottom-0 left-3.5 right-0 h-px bg-line/45"
  />
</template>
