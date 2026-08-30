<script setup lang="ts">
// One item's inline-repetition count (`Item.inlineRepetition`): a caption plus a narrow number
// input with -/+ buttons. Shared by PointAssignmentInput (one per candidate) and ItemPickerRow
// (one for the current pick), so the control reads and behaves the same either way.
//
// A typed value outside [min, max] is let through and flagged by findErrors instead of being
// silently rewritten -- same reasoning engine.ts gives for a dynamic-stat magnitude. Only the
// -/+ buttons clamp, since they are app-driven rather than typed.
import { Minus, Plus } from "@lucide/vue";
import IconButton from "../ui/IconButton.vue";
import { isMac } from "../../lib/platform";
import type { Item } from "../../types";

const modKey = isMac ? "Cmd" : "Ctrl";

const props = defineProps<{
  item: Item;
  /** Current count, already resolved against the config's `default` by the caller. */
  value: number;
  /** Namespaces the `data-testid`s below: one build can hold two steppers for one item. */
  testidPrefix: string;
}>();

const emit = defineEmits<{
  change: [count: number];
  /** Hovering the caption -- forwarded so the owning row can feed useHoverCard.ts. */
  labelEnter: [event: MouseEvent];
  labelLeave: [];
}>();

/** See `InlineRepetitionConfig.label`. */
const label = () => props.item.inlineRepetition!.label ?? props.item.name;

function onInput(event: Event) {
  const raw = Number((event.target as HTMLInputElement).value);
  emit(
    "change",
    Number.isFinite(raw) ? raw : props.item.inlineRepetition!.default,
  );
}

/** A plain click steps by one; Ctrl/Cmd+click jumps to that direction's bound. */
function step(dir: 1 | -1, event: MouseEvent) {
  const { min, max } = props.item.inlineRepetition!;
  if (isMac ? event.metaKey : event.ctrlKey) {
    emit("change", dir === 1 ? max : min);
    return;
  }
  emit("change", Math.min(Math.max(props.value + dir, min), max));
}
</script>

<template>
  <div class="flex flex-col items-center gap-1">
    <span
      class="truncate text-center"
      :data-testid="`${testidPrefix}-label-${item.id}`"
      :data-item-id="item.id"
      @mouseenter="emit('labelEnter', $event)"
      @mouseleave="emit('labelLeave')"
      ><slot name="label">{{ label() }}</slot></span
    >
    <div class="flex items-center gap-1">
      <IconButton
        :title="`Decrease (${modKey}+click for min)`"
        :disabled="value <= item.inlineRepetition!.min"
        @click="step(-1, $event)"
      >
        <Minus />
      </IconButton>
      <input
        type="number"
        class="w-14 rounded-md border border-line bg-surface py-0.5 text-center focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
        :min="item.inlineRepetition!.min"
        :max="item.inlineRepetition!.max"
        :value="value"
        :data-testid="`${testidPrefix}-input-${item.id}`"
        @input="onInput"
      />
      <IconButton
        :title="`Increase (${modKey}+click for max)`"
        :disabled="value >= item.inlineRepetition!.max"
        @click="step(1, $event)"
      >
        <Plus />
      </IconButton>
    </div>
    <slot />
  </div>
</template>
