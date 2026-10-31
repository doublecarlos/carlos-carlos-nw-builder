<script setup lang="ts">
// Small grip affordance for a draggable row. `v-bind`s the caller's drag-handle props (from
// `useDragHandle`) straight through. Bound with none, it is the touch grip inside a row that
// carries the props itself (NavRow): `data-drag-handle` is where a finger may start a drag.
//
// `touch-none` keeps the browser from claiming a press here for scrolling, and the context
// menu is suppressed so a long press on Android does not pop one mid-drag.
import GripVertical from "virtual:icon/grip-vertical.vue";
import BaseTooltip from "./BaseTooltip.vue";

defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    tooltip?: string;
  }>(),
  { tooltip: "Drag to reorder" },
);
</script>

<template>
  <BaseTooltip :text="tooltip">
    <span
      data-drag-handle
      class="cursor-grab touch-none select-none text-muted hover:text-accent [&_svg]:size-[14px] pointer-coarse:-m-1.5 pointer-coarse:p-2.5"
      v-bind="$attrs"
      @contextmenu.prevent
    >
      <GripVertical />
    </span>
  </BaseTooltip>
</template>
