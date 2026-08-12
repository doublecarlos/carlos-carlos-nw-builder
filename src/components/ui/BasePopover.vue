<script setup lang="ts">
// Teleported overlay shell for tooltips, hover cards, and click-triggered popovers.
// Takes a `width` (px, fixes the card's size and doubles as the horizontal flip-detection
// bound) and exposes `place(anchor, pointerX?)` plus `close()` so callers control positioning
// without duplicating viewport-flip logic.
//
// Content scrolls independently via an inner wrapper; the measurement for the vertical flip
// uses the real rendered height, not a CSS max-height, so a short tooltip near the viewport
// bottom does not flip unnecessarily.
import { ref, nextTick, useTemplateRef } from "vue";

const props = withDefaults(
  defineProps<{
    /** px. Used as both a min- and max-width (clamped to 90vw on narrow viewports) -- a
     *  fixed size per caller so e.g. every ItemCard hover reads at the same width regardless
     *  of how little that particular item/bonus list happens to need, not for horizontal
     *  viewport-edge detection alone. */
    width?: number;
  }>(),
  { width: 256 },
);

const el = useTemplateRef("el");
const pos = ref<{ left: number; top: number } | null>(null);

const MARGIN = 10;
const GAP = 8;

function place(anchor: DOMRect, pointerX?: number) {
  // Horizontal: from pointer if given, else from anchor's right edge.
  const originX = pointerX ?? anchor.right + GAP;
  let left = originX;
  if (left + props.width > window.innerWidth - MARGIN) {
    left = (pointerX ?? anchor.right) - props.width - GAP;
  }
  left = Math.max(left, MARGIN);

  pos.value = {
    left,
    top: anchor.bottom + 6,
  };

  // Vertical flip after layout so offsetHeight is real.
  nextTick(() => {
    if (!el.value || !pos.value) return;
    const height = el.value.offsetHeight;
    if (pos.value.top + height <= window.innerHeight - MARGIN) return;
    pos.value = {
      ...pos.value,
      top: Math.max(anchor.top - height - 6, MARGIN),
    };
  });
}

function close() {
  pos.value = null;
}

defineExpose({ place, close });
</script>

<template>
  <Teleport to="body">
    <div
      v-if="pos"
      ref="el"
      class="fixed z-40 flex"
      :style="{
        left: pos.left + 'px',
        top: pos.top + 'px',
        minWidth: 'min(' + width + 'px, 90vw)',
        maxWidth: 'min(' + width + 'px, 90vw)',
        maxHeight: '32rem',
      }"
    >
      <slot />
    </div>
  </Teleport>
</template>
