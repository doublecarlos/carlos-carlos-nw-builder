<script setup lang="ts">
// Small grip affordance for a draggable row, replacing the BaseTooltip + span + GripVertical
// trio that used to be hand-copied at every drag-reorderable row. `v-bind`'s the caller's
// drag-handle props (from `useDragAndDrop`/`useDropList`) straight through, same as the raw
// `<span>` it replaces did.
import { GripVertical } from "@lucide/vue";
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
      class="cursor-grab text-muted hover:text-accent [&_svg]:size-[14px]"
      v-bind="$attrs"
    >
      <GripVertical />
    </span>
  </BaseTooltip>
</template>
