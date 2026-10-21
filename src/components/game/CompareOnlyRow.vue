<script setup lang="ts">
// A slot this build hides but the compare build fills. The build holds nothing here and cannot,
// so the row is read-only: it only says what the compare build has, highlighted like any
// differing row. Like TextRow, it carries no data-cursor-key, so the arrow-key cursor and Tab
// skip it.
import type { Slot } from "../../types";

defineProps<{
  slotDef: Slot;
  compareName: string;
  otherChoiceLabel: string;
  highlightDiff: boolean;
  noBorder?: boolean;
}>();
</script>

<template>
  <div
    class="relative grid col-span-full py-1 pr-2.5 [grid-template-columns:subgrid]"
    :class="[
      noBorder ? 'border-b-0' : 'border-b border-line/45 last:border-b-0',
      highlightDiff && 'is-diff bg-diff/20',
    ]"
    :data-testid="'compare-only:' + slotDef.id"
  >
    <span
      class="col-start-1 w-44 min-w-0 truncate self-start py-0.5 pl-2.5 text-muted"
      >{{ slotDef.label }}</span
    >
    <div class="min-w-0 [grid-column:2/-1] py-0.5">
      <p class="italic text-muted">Not available in this build</p>
      <p class="slot-diff-note mt-0.5 text-muted">
        {{ compareName }}: {{ otherChoiceLabel }}
      </p>
    </div>
  </div>
</template>
