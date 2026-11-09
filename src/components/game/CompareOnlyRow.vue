<script setup lang="ts">
// A row the compare build fills and this build has none of: a slot it hides, or a list row past
// its own count. The row is read-only: it only says what the compare build has, highlighted like
// any differing row. Like TextRow, it carries no data-cursor-key, so the arrow-key cursor and Tab
// skip it.
import NestGuide from "./NestGuide.vue";
import { toneStyle } from "../../lib/item-quality";
import type { Slot } from "../../types";
import type { NestPosition } from "../../lib/slot-parent";
import type { CompareOnlyReason } from "../../lib/slot-availability";

defineProps<{
  slotDef: Slot;
  reason: CompareOnlyReason;
  compareName: string;
  otherChoiceLabel: string;
  otherChoiceQuality?: string | null;
  highlightDiff: boolean;
  noBorder?: boolean;
  /** See `BuildSlot`'s prop of the same name. */
  nest?: NestPosition;
}>();
</script>

<template>
  <div
    class="relative grid col-span-full py-1 pr-2.5 [grid-template-columns:subgrid]"
    :class="[
      noBorder || (nest && !nest.last)
        ? 'border-b-0'
        : 'border-b border-line/45 last:border-b-0',
      highlightDiff && 'is-diff bg-diff/20',
    ]"
    :data-diff="highlightDiff || undefined"
    :data-testid="'compare-only:' + slotDef.id"
    :data-reason="reason"
  >
    <NestGuide v-if="nest" :nest="nest" />
    <span
      class="col-start-1 w-44 min-w-0 truncate self-start py-0.5 text-muted max-md:col-span-full max-md:w-auto"
      :class="nest ? 'pl-8.5' : 'pl-2.5'"
      >{{ slotDef.label }}</span
    >
    <div
      class="min-w-0 [grid-column:2/-1] py-0.5 max-md:[grid-column:1/-1]"
      :class="nest ? 'pl-6 max-md:pl-8.5' : 'max-md:pl-2.5'"
    >
      <p class="italic text-muted">
        {{
          reason === "extraRow"
            ? "No such row in this build"
            : "Not available in this build"
        }}
      </p>
      <p class="slot-diff-note mt-0.5 text-muted">
        {{ compareName }}:
        <span class="text-(--tone)" :style="toneStyle(otherChoiceQuality)">{{
          otherChoiceLabel
        }}</span>
      </p>
    </div>
  </div>
</template>
