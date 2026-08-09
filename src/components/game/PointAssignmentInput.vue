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
import IconButton from "../ui/IconButton.vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import { db } from "../../stores/resolved";
import * as buildEditor from "../../stores/buildEditor";
import { procRowsForItem } from "../../composables/useItemProcs";
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
  /** Hovering one row's item name -- BuildSlot.vue forwards these into the same hover-card
   *  machinery an item_picker row's whole-row hover already uses (useHoverCard.ts). */
  itemEnter: [event: MouseEvent, item: string];
  itemLeave: [];
}>();

/** Every item matching the slot's filter with a `pointAssignment` config -- one row each,
 *  already sorted by priority (db.ts's `forSlot`). */
const rows = computed(() => db.value.forSlot(props.slotDef.id));

function valueFor(item: Item) {
  return props.values[item.id] ?? item.pointAssignment!.default;
}

/** Not a computed -- called once per row inside the template's own reactive render effect
 *  (same as `valueFor` above), since this is one row's worth per item rather than a single
 *  value the whole component shares. */
function procRows(item: Item) {
  return procRowsForItem(item);
}

function onInput(item: Item, event: Event) {
  const raw = Number((event.target as HTMLInputElement).value);
  emit(
    "change",
    item.id,
    Number.isFinite(raw) ? raw : item.pointAssignment!.default,
  );
}

/** A plain click steps by one; Ctrl/Cmd+click jumps straight to that direction's bound
 *  (min for "-", max for "+") -- same platform-modifier convention BuildEditor.vue's own
 *  ctrl-click-to-edit uses. */
function step(item: Item, dir: 1 | -1, event: MouseEvent) {
  const { min, max } = item.pointAssignment!;
  if (isMac ? event.metaKey : event.ctrlKey) {
    emit("change", item.id, dir === 1 ? max : min);
    return;
  }
  const next = Math.min(Math.max(valueFor(item) + dir, min), max);
  emit("change", item.id, next);
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
  <div ref="root" class="flex flex-wrap items-end gap-4">
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
        >{{ item.name }}</span
      >
      <div class="flex items-center gap-1">
        <IconButton
          :title="`Decrease (${modKey}+click for min)`"
          :disabled="valueFor(item) <= item.pointAssignment!.min"
          @click="step(item, -1, $event)"
        >
          <Minus />
        </IconButton>
        <input
          type="number"
          class="w-14 rounded-md border border-line bg-surface py-0.5 text-center focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          :min="item.pointAssignment!.min"
          :max="item.pointAssignment!.max"
          :value="valueFor(item)"
          :data-testid="`assignment-input-${item.id}`"
          @input="onInput(item, $event)"
        />
        <IconButton
          :title="`Increase (${modKey}+click for max)`"
          :disabled="valueFor(item) >= item.pointAssignment!.max"
          @click="step(item, 1, $event)"
        >
          <Plus />
        </IconButton>
      </div>

      <!-- One checkbox per proc-gated grant credited to this row's item -- see
           useItemProcs.ts for why only the shared bonus's first contributor gets one. -->
      <BaseCheckbox
        v-for="row in procRows(item)"
        :key="row.grantKey"
        inline
        :data-testid="`proc-toggle-${row.grantKey}`"
        :model-value="row.checked"
        @update:model-value="
          buildEditor.setProc(row.grantKey, $event as boolean, row.label)
        "
      >
        {{ row.label }}
      </BaseCheckbox>
    </div>
  </div>
</template>
