<script setup lang="ts">
// Pure control for one PointAssignmentSlot -- no label, no diff markup, no row chrome, same
// division of concerns BuildParamInput.vue keeps for build_parameter. One
// InlineRepetitionStepper per assignment row, all inline (BuildSlot.vue's own row wraps this in
// the section's row chrome). That stepper is shared with an item_picker's repeating pick; what
// is type-specific -- which items get a row, and their bonus-occurrence inputs -- stays here.
import { computed, useTemplateRef } from "vue";
import BonusOccurrenceInputs from "./BonusOccurrenceInputs.vue";
import InlineRepetitionStepper from "./InlineRepetitionStepper.vue";
import { db } from "../../stores/resolved";
import {
  occurrenceRows,
  occurrenceRowsForItem,
  type OccurrenceRow,
} from "../../composables/useItemBonusOccurrences";
import type { Item, PointAssignmentSlot } from "../../types";

const props = defineProps<{
  slotDef: PointAssignmentSlot;
  /** itemId -> current count, sparse -- a row missing from this object reads as its own
   *  `default` (mirrors how a missing `build_parameter` value falls back to `slot.default`). */
  values: Record<string, number>;
  /** itemId -> bonusId -> occurrence count, same shape as `Build.occurrenceInputs`. Omitted in
   *  the build editor, where those counts *are* the active build's; supplied by an editor whose
   *  rows author counts of their own (PresetForm.vue), so the steppers below show and write that
   *  editor's values instead of the current build's. */
  occurrenceValues?: Record<string, Record<string, number>>;
}>();

const emit = defineEmits<{
  change: [item: string, count: number];
  /** One item's own BonusOccurrenceConfig attachment changed -- independent of this row's own
   *  repetition count, see bonus.ts's `collectInlineRepetition`. `label` mirrors `change`'s
   *  caller-resolved-name convention (ItemPickerRow.vue's own `onOccurrenceInput` et al). */
  occurrenceChange: [
    item: string,
    bonusId: string,
    count: number,
    label: string,
  ];
  /** Hovering one row's item name -- BuildSlot.vue forwards these into the same hover-card
   *  machinery an item_picker row's whole-row hover already uses (useHoverCard.ts). */
  itemEnter: [event: MouseEvent, item: string];
  itemLeave: [];
}>();

/** Every item matching the slot's filter with an `inlineRepetition` config -- one row each,
 *  already sorted by priority (db.ts's `forSlot`). */
const rows = computed(() => db.value.forSlot(props.slotDef.id));

function valueFor(item: Item) {
  return props.values[item.id] ?? item.inlineRepetition!.default;
}

// --- one item's own BonusOccurrenceConfig attachments, independent of its repetition count ---
// (bonus.ts's `collectInlineRepetition`). Same rows ItemPickerRow.vue renders for a single
// picked item, one set per row here since a point_assignment row has many items at once.

function occurrenceRowsFor(item: Item): OccurrenceRow[] {
  return props.occurrenceValues
    ? occurrenceRows(item, props.occurrenceValues[item.id])
    : occurrenceRowsForItem(item);
}

// --- keyboard cursor integration ---------------------------------------------------------

const root = useTemplateRef("root");

function focus() {
  root.value?.querySelector("input")?.focus();
}

/** No type-ahead target here (no combobox to seed) -- same no-op-beyond-focus behaviour
 *  BuildParamInput uses for its own non-list paramTypes. */
function focusAndSeed() {
  focus();
}

defineExpose({ focus, focusAndSeed });
</script>

<template>
  <div ref="root" class="flex flex-wrap gap-4">
    <InlineRepetitionStepper
      v-for="item in rows"
      :key="item.id"
      :item="item"
      :value="valueFor(item)"
      testid-prefix="assignment"
      @change="(count) => emit('change', item.id, count)"
      @label-enter="(event) => emit('itemEnter', event, item.id)"
      @label-leave="emit('itemLeave')"
    >
      <!-- One item's own BonusOccurrenceConfig inputs, independent of the stepper above --
           one set per row here, since a point_assignment row has many items at once. -->
      <div
        v-if="occurrenceRowsFor(item).length"
        class="flex flex-wrap items-center justify-center gap-2"
      >
        <BonusOccurrenceInputs
          :rows="occurrenceRowsFor(item)"
          :testid-prefix="`assignment-occurrence-${item.id}`"
          @change="
            (bonusId, count, label) =>
              emit('occurrenceChange', item.id, bonusId, count, label)
          "
        />
      </div>
    </InlineRepetitionStepper>
  </div>
</template>
