<script setup lang="ts">
// A number field between -/+ buttons. A plain click steps by `step` (one by default),
// Ctrl/Cmd+click jumps to that direction's bound.
//
// A typed value outside [min, max] is let through, so the caller can flag it rather than have
// it silently rewritten. Only the buttons clamp. Attributes (`data-testid`, `id`) land on the
// input itself, the way they would on a native one.
import { Minus, Plus } from "@lucide/vue";
import BaseInput from "./BaseInput.vue";
import IconButton from "./IconButton.vue";
import { isMac } from "../../lib/platform";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    min: number;
    max: number;
    step?: number;
  }>(),
  { step: 1 },
);

const model = defineModel<number>({ required: true });

const modKey = isMac ? "Cmd" : "Ctrl";

/** Mid-typing states ("-", "") are left in the field without writing anything. */
function onInput(raw: string | number | null) {
  if (typeof raw === "number" && Number.isFinite(raw)) model.value = raw;
}

/** Stopped from bubbling, so a row's own click handling (Ctrl+click to edit) never sees it. */
function stepBy(dir: 1 | -1, event: MouseEvent) {
  event.stopPropagation();
  if (isMac ? event.metaKey : event.ctrlKey) {
    model.value = dir === 1 ? props.max : props.min;
    return;
  }
  model.value = Math.min(
    Math.max(model.value + dir * props.step, props.min),
    props.max,
  );
}
</script>

<template>
  <div class="flex items-center gap-1">
    <IconButton
      :title="`Decrease (${modKey}+click for min)`"
      :disabled="model <= min"
      @click="stepBy(-1, $event)"
    >
      <Minus />
    </IconButton>
    <BaseInput
      v-bind="$attrs"
      type="number"
      class="w-14 text-center!"
      :min="min"
      :max="max"
      :step="step"
      :model-value="model"
      @update:model-value="onInput"
    />
    <IconButton
      :title="`Increase (${modKey}+click for max)`"
      :disabled="model >= max"
      @click="stepBy(1, $event)"
    >
      <Plus />
    </IconButton>
  </div>
</template>
