<script setup lang="ts">
// Pure control for one PointAssignmentSlot: no label, no diff markup, no row chrome, the same
// division of concerns BuildParamInput.vue keeps for build_parameter. One
// InlineRepetitionStepper per candidate item. Whatever belongs under an item's stepper (its
// bonus occurrence counts) comes from the caller through the `item` slot, since the build
// editor and PresetForm.vue read and write those differently.
import { computed, useTemplateRef } from "vue";
import InlineRepetitionStepper from "./InlineRepetitionStepper.vue";
import { db } from "../../stores/resolved";
import { stillOffered } from "../../data/db";
import type { Item, PointAssignmentSlot } from "../../types";

const props = defineProps<{
  slotDef: PointAssignmentSlot;
  /** itemId -> current count, sparse -- a row missing from this object reads as its own
   *  `default` (mirrors how a missing `build_parameter` value falls back to `slot.default`). */
  values: Record<string, number>;
  /** True when the caller laid out a shared column grid (the build editor's section): the
   *  steppers become its items, one per column. PresetForm.vue leaves this off and wraps. */
  subgrid?: boolean;
}>();

const emit = defineEmits<{
  change: [item: string, count: number];
  /** Hovering one row's item name -- BuildSlot.vue forwards these into the same hover-card
   *  machinery an item_picker row's whole-row hover already uses (useHoverCard.ts). */
  itemEnter: [event: MouseEvent, item: string];
  itemLeave: [];
}>();

defineSlots<{
  /** Extra controls under one item's stepper. */
  item?(props: { item: Item }): unknown;
}>();

/** Every item matching the slot's filter with an `inlineRepetition` config -- one row each,
 *  already sorted by priority (db.ts's `forSlot`).
 *
 *  A `hideFromPicker` item keeps its row while it still holds points: these all render at once,
 *  so dropping an assigned one would strand points the engine still counts. */
const rows = computed(() =>
  db.value
    .forSlot(props.slotDef.id)
    .filter((item) => stillOffered(item, valueFor(item) > 0)),
);

function valueFor(item: Item) {
  return props.values[item.id] ?? item.inlineRepetition!.default;
}

// --- keyboard cursor integration ---------------------------------------------------------

const root = useTemplateRef("root");

function focus() {
  root.value?.querySelector("input")?.focus();
}

/** No type-ahead target here (no combobox to seed) -- same no-op-beyond-focus behavior
 *  BuildParamInput uses for its own non-list paramTypes. */
function focusAndSeed() {
  focus();
}

defineExpose({ focus, focusAndSeed });
</script>

<template>
  <div
    ref="root"
    :class="
      subgrid
        ? 'grid col-span-full min-w-0 [grid-template-columns:subgrid]'
        : 'flex flex-wrap gap-4'
    "
  >
    <InlineRepetitionStepper
      v-for="item in rows"
      :key="item.id"
      :item-id="item.id"
      :label="item.inlineRepetition!.label ?? item.name"
      :value="valueFor(item)"
      :min="item.inlineRepetition!.min"
      :max="item.inlineRepetition!.max"
      testid-prefix="assignment"
      @change="(count) => emit('change', item.id, count)"
      @label-enter="(event) => emit('itemEnter', event, item.id)"
      @label-leave="emit('itemLeave')"
    >
      <slot name="item" :item="item" />
    </InlineRepetitionStepper>
  </div>
</template>
