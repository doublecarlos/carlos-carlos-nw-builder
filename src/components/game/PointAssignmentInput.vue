<script setup lang="ts">
// Pure control for one PointAssignmentSlot -- no label, no diff markup, no row chrome, same
// division of concerns BuildParamInput.vue keeps for build_parameter. One narrow number input
// with -/+ buttons per assignment row, all inline (BuildSlot.vue's own row wraps this in the
// section's row chrome).
//
// Each stepper's count is read by the engine as "N copies of that item id" (bonus.ts's
// collect()), so typing a value outside [min, max] is let through here -- same reasoning
// engine.ts gives for not clamping a dynamicStat magnitude -- and flagged by findErrors'
// outOfRange check instead of being silently rewritten. Only the -/+ buttons themselves clamp,
// since they're app-driven rather than typed.
import { computed, useTemplateRef } from "vue";
import { Minus, Plus } from "@lucide/vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import IconButton from "../ui/IconButton.vue";
import { db } from "../../stores/resolved";
import {
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
  return occurrenceRowsForItem(item);
}

function onOccurrenceCheckbox(
  item: Item,
  row: OccurrenceRow,
  checked: boolean,
) {
  emit("occurrenceChange", item.id, row.bonusId, checked ? 1 : 0, row.label);
}

function onOccurrenceInput(item: Item, row: OccurrenceRow, event: Event) {
  const raw = Number((event.target as HTMLInputElement).value);
  emit(
    "occurrenceChange",
    item.id,
    row.bonusId,
    Number.isFinite(raw) ? raw : row.defaultValue,
    row.label,
  );
}

function stepOccurrence(
  item: Item,
  row: OccurrenceRow,
  dir: 1 | -1,
  event: MouseEvent,
) {
  event.stopPropagation();
  if (isMac ? event.metaKey : event.ctrlKey) {
    emit(
      "occurrenceChange",
      item.id,
      row.bonusId,
      dir === 1 ? row.max : row.min,
      row.label,
    );
    return;
  }
  const next = Math.min(Math.max(row.value + dir, row.min), row.max);
  emit("occurrenceChange", item.id, row.bonusId, next, row.label);
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
        class="truncate text-sm text-center"
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

      <!-- One row per BonusOccurrenceConfig this item carries, independent of the stepper
           above -- same rendering ItemPickerRow.vue uses for a single picked item. -->
      <div
        v-if="occurrenceRowsFor(item).length"
        class="flex flex-wrap items-center justify-center gap-2"
      >
        <BaseCheckbox
          v-for="row in occurrenceRowsFor(item).filter(
            (r) => r.kind === 'checkbox',
          )"
          :key="row.bonusId"
          inline
          :data-testid="`assignment-occurrence-toggle-${item.id}-${row.bonusId}`"
          :model-value="row.value === 1"
          @update:model-value="
            onOccurrenceCheckbox(item, row, $event as boolean)
          "
        >
          {{ row.label }}
        </BaseCheckbox>
        <div
          v-for="row in occurrenceRowsFor(item).filter(
            (r) => r.kind === 'stepper',
          )"
          :key="row.bonusId"
          class="flex items-center gap-1.5"
        >
          <span class="text-sm">{{ row.label }}</span>
          <div class="flex items-center gap-1">
            <IconButton
              :title="`Decrease (${modKey}+click for min)`"
              :disabled="row.value <= row.min"
              @click="stepOccurrence(item, row, -1, $event)"
            >
              <Minus />
            </IconButton>
            <input
              type="number"
              class="w-14 rounded-md border border-line bg-surface py-0.5 text-center focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
              :min="row.min"
              :max="row.max"
              :value="row.value"
              :data-testid="`assignment-occurrence-input-${item.id}-${row.bonusId}`"
              @input="onOccurrenceInput(item, row, $event)"
            />
            <IconButton
              :title="`Increase (${modKey}+click for max)`"
              :disabled="row.value >= row.max"
              @click="stepOccurrence(item, row, 1, $event)"
            >
              <Plus />
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
