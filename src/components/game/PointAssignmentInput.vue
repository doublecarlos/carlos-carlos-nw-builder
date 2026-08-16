<script setup lang="ts">
// Pure control for one PointAssignmentSlot -- no label, no diff markup, no row chrome, same
// division of concerns BuildParamInput.vue keeps for build_parameter. One narrow number input
// with -/+ buttons per assignment row, all inline (BuildSlot.vue's own row wraps this in the
// section's row chrome).
//
// Each stepper's count is read by the engine as "N copies of that item id" (bonus.ts's
// collect()), so typing a value outside [min, max] is let through here -- same reasoning
// engine.ts gives for not clamping a dynamic-stat magnitude -- and flagged by findErrors'
// outOfRange check instead of being silently rewritten. Only the -/+ buttons themselves clamp,
// since they're app-driven rather than typed.
import { computed, useTemplateRef } from "vue";
import { Minus, Plus } from "@lucide/vue";
import BonusOccurrenceInputs from "./BonusOccurrenceInputs.vue";
import IconButton from "../ui/IconButton.vue";
import { db } from "../../stores/resolved";
import {
  occurrenceRows,
  occurrenceRowsForItem,
  type OccurrenceRow,
} from "../../composables/useItemBonusOccurrences";
import { isMac } from "../../lib/platform";
import type { Item, PointAssignmentSlot } from "../../types";

const modKey = isMac ? "Cmd" : "Ctrl";

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

/** Overrides the item's own name on its row -- see `InlineRepetitionConfig.label`'s own doc
 *  comment. */
function labelFor(item: Item) {
  return item.inlineRepetition!.label ?? item.name;
}

function onInput(item: Item, event: Event) {
  const raw = Number((event.target as HTMLInputElement).value);
  emit(
    "change",
    item.id,
    Number.isFinite(raw) ? raw : item.inlineRepetition!.default,
  );
}

/** A plain click steps by one; Ctrl/Cmd+click jumps straight to that direction's bound
 *  (min for "-", max for "+") -- same platform-modifier convention BuildEditor.vue's own
 *  ctrl-click-to-edit uses. */
function step(item: Item, dir: 1 | -1, event: MouseEvent) {
  const { min, max } = item.inlineRepetition!;
  if (isMac ? event.metaKey : event.ctrlKey) {
    emit("change", item.id, dir === 1 ? max : min);
    return;
  }
  const next = Math.min(Math.max(valueFor(item) + dir, min), max);
  emit("change", item.id, next);
}

// --- one item's own BonusOccurrenceConfig attachments, independent of its repetition count ---
// (bonus.ts's `collectInlineRepetition` -- see #232). Same rows ItemPickerRow.vue renders for a
// single picked item, one set per row here since a point_assignment row has many items at once.

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
    <div
      v-for="item in rows"
      :key="item.id"
      class="flex flex-col items-center gap-1"
    >
      <span
        class="truncate text-center"
        :data-testid="`assignment-label-${item.id}`"
        :data-item-id="item.id"
        @mouseenter="emit('itemEnter', $event, item.id)"
        @mouseleave="emit('itemLeave')"
        >{{ labelFor(item) }}</span
      >
      <div class="flex items-center gap-1">
        <IconButton
          :title="`Decrease (${modKey}+click for min)`"
          :disabled="valueFor(item) <= item.inlineRepetition!.min"
          @click="step(item, -1, $event)"
        >
          <Minus />
        </IconButton>
        <input
          type="number"
          class="w-14 rounded-md border border-line bg-surface py-0.5 text-center focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          :min="item.inlineRepetition!.min"
          :max="item.inlineRepetition!.max"
          :value="valueFor(item)"
          :data-testid="`assignment-input-${item.id}`"
          @input="onInput(item, $event)"
        />
        <IconButton
          :title="`Increase (${modKey}+click for max)`"
          :disabled="valueFor(item) >= item.inlineRepetition!.max"
          @click="step(item, 1, $event)"
        >
          <Plus />
        </IconButton>
      </div>

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
    </div>
  </div>
</template>
