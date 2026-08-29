<script setup lang="ts">
// The strip along a rail's inner edge.
//
// It carries the show/hide toggle and, while the rail is open, doubles as the handle that
// drags the rail wider or narrower. Putting both on one strip is what lets the toggle drop the
// row of its own it used to occupy above the rail's content -- and it keeps the button in the
// same place across the collapse, which is where a user looks to undo it.
import { computed } from "vue";
import RailToggle from "./RailToggle.vue";
import * as rails from "../../stores/rails";
import type { RailId } from "../../stores/rails";
import { useRailResize } from "../../composables/useRailResize";

const props = withDefaults(
  defineProps<{
    rail: RailId;
    /** Which edge the rail lives on -- a left rail closes leftward, a right one rightward. */
    side: "left" | "right";
    /** What the rail holds, as it reads in "Hide builds" / "Show builds". */
    label: string;
    collapsed: boolean;
    /** False where the rail's width is not the page's to give -- a stacked narrow layout. */
    resizable?: boolean;
  }>(),
  { resizable: true },
);

const {
  dragging,
  onPointerdown,
  onPointermove,
  onPointerup,
  onKeydown,
  reset,
} = useRailResize(props.rail, props.side);

/** Nothing to drag once the rail is closed: the toggle is the only way back. */
const draggable = computed(() => props.resizable && !props.collapsed);

const width = rails.width(props.rail);
const max = rails.maxWidth(props.rail);
</script>

<template>
  <div
    class="relative flex-none"
    :class="[
      collapsed ? 'w-7' : 'w-5',
      draggable &&
        'cursor-col-resize touch-none select-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
      dragging && 'bg-surface-2',
    ]"
    :role="draggable ? 'separator' : undefined"
    :tabindex="draggable ? 0 : undefined"
    :aria-orientation="draggable ? 'vertical' : undefined"
    :aria-label="draggable ? `Resize ${label}` : undefined"
    :aria-valuenow="draggable ? width : undefined"
    :aria-valuemin="draggable ? rails.MIN_RAIL_PX : undefined"
    :aria-valuemax="draggable ? max : undefined"
    :data-testid="`rail-gutter-${rail}`"
    @pointerdown="draggable && onPointerdown($event)"
    @pointermove="onPointermove"
    @pointerup="onPointerup"
    @pointercancel="onPointerup"
    @keydown="draggable && onKeydown($event)"
    @dblclick="draggable && reset()"
  >
    <!-- `.stop` so pressing the button never also starts a drag or resets the width. -->
    <RailToggle
      class="absolute top-1 left-1/2 z-10 -translate-x-1/2 border border-line bg-surface"
      :side="side"
      :label="label"
      :collapsed="collapsed"
      @pointerdown.stop
      @dblclick.stop
      @toggle="rails.toggle(rail)"
    />
  </div>
</template>
