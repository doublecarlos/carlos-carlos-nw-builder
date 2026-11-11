<script setup lang="ts">
// A row the compare build fills and this build has none of: a slot it hides, or a list row past
// its own count. It says what the compare build has, highlighted like any differing row. A
// hidden slot's row is read-only and, like TextRow, carries no data-cursor-key, so the arrow-key
// cursor skips it. An extra list row can be applied, which adds the row here, so it is a cursor
// row with Enter as apply.
import { useTemplateRef } from "vue";
import NestGuide from "./NestGuide.vue";
import BaseLink from "../ui/BaseLink.vue";
import { useCursorRowKeys } from "../../composables/useCursorRowKeys";
import { toneStyle } from "../../lib/item-quality";
import type { Slot } from "../../types";
import type { NestPosition } from "../../lib/slot-parent";
import type { CompareOnlyReason } from "../../lib/slot-availability";

const props = defineProps<{
  slotDef: Slot;
  reason: CompareOnlyReason;
  compareName: string;
  otherChoiceLabel: string;
  otherChoiceQuality?: string | null;
  highlightDiff: boolean;
  noBorder?: boolean;
  /** See `BuildSlot`'s prop of the same name. */
  nest?: NestPosition;
  /** Arrow keys on an extra row's cursor anchor, same contract every other row has. */
  onArrow: (dir: 1 | -1, bySection: boolean) => void;
}>();

const emit = defineEmits<{ apply: [] }>();

const anchor = useTemplateRef("anchor");

useCursorRowKeys(anchor, {
  onArrow: (dir, bySection) => props.onArrow(dir, bySection),
  onEnter: () => emit("apply"),
});
</script>

<template>
  <div
    class="relative grid col-span-full py-1 pr-2.5 [grid-template-columns:subgrid]"
    :class="[
      // The same indents as BuildSlot, so the label lines up with the rows around it.
      nest ? '[--row-indent:--spacing(8.5)]' : '[--row-indent:--spacing(2.5)]',
      noBorder || (nest && !nest.last)
        ? 'border-b-0'
        : 'border-b border-line/45 last:border-b-0',
      highlightDiff && 'is-diff bg-diff/20',
      reason === 'extraRow' &&
        'focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-accent',
    ]"
    :data-diff="highlightDiff || undefined"
    :data-testid="'compare-only:' + slotDef.id"
    :data-reason="reason"
    :data-cursor-key="reason === 'extraRow' ? 'slot:' + slotDef.id : undefined"
  >
    <NestGuide v-if="nest" :nest="nest" />
    <span
      class="min-w-0 truncate self-start py-0.5 pl-(--row-indent) text-muted [grid-column:label]"
      >{{ slotDef.label }}</span
    >
    <div
      class="min-w-0 py-0.5 max-md:pl-(--row-indent) [grid-column:controls]"
      :class="nest && 'md:pl-6'"
    >
      <span
        v-if="reason === 'extraRow'"
        ref="anchor"
        tabindex="-1"
        data-cursor-anchor
        class="sr-only"
      />
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
        <BaseLink
          v-if="reason === 'extraRow'"
          class="ml-0.5"
          data-testid="compare-only-apply"
          @click.stop="emit('apply')"
        >
          apply
        </BaseLink>
      </p>
    </div>
  </div>
</template>
