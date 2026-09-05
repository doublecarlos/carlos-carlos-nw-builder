<script setup lang="ts">
// Teleported overlay shell for tooltips, hover cards, and click-triggered popovers.
// Takes a `width` (px) and exposes `place(anchor, pointerX?, align?)` plus `close()`, so
// callers control positioning without duplicating viewport-flip logic. See `PopoverAlign` for
// the two horizontal modes and `fitContent` for the two sizing ones.
//
// Content scrolls independently via an inner wrapper; the measurements for the vertical flip
// and for centring use the real rendered box, not the CSS bounds, so a short panel near an
// edge is placed by what it actually is rather than what it was allowed to be.
//
// Sits above BaseModal's z-50, so a control inside a modal can still have a tooltip.
import { ref, nextTick, useTemplateRef } from "vue";

const props = withDefaults(
  defineProps<{
    /** px, clamped to 90vw on narrow viewports. A max-width always; also a min-width unless
     *  `fitContent` is set. */
    width?: number;
    /** Let the panel shrink to its content instead of always filling `width`.
     *
     *  Off (the default) is what a hover card wants: every ItemCard reads at the same width
     *  regardless of how little that particular item needs, so sweeping a list doesn't make
     *  the card jump about. On is what a tooltip wants -- "Build menu" in a 240px box centred
     *  on a 20px kebab would hang off both sides of it and read as belonging to nothing. */
    fitContent?: boolean;
  }>(),
  { width: 256, fitContent: false },
);

const el = useTemplateRef("el");
const pos = ref<{ left: number; top: number } | null>(null);

const MARGIN = 10;
const GAP = 8;

/**
 * Where the panel sits horizontally relative to its anchor.
 *
 * `beside` (the default) starts at the anchor's right edge and flips to its left when there is
 * no room -- what a hover card wants, since it is a panel *about* the row it appears next to
 * and covering that row would be worse than moving.
 *
 * `center` centres the panel on the anchor and slides it just far enough to stay on screen --
 * what a tooltip wants, since it belongs to the control it points at and has to stay visibly
 * attached to it. Flipping a small label to the far side of its trigger reads as belonging to
 * whatever it landed next to instead.
 */
type PopoverAlign = "beside" | "center";

/** Centres `width` on the anchor, kept inside the viewport. */
function centredLeft(anchor: DOMRect, width: number) {
  const left = anchor.left + anchor.width / 2 - width / 2;
  // Clamped rather than flipped: the panel stays over its anchor either way.
  return Math.max(Math.min(left, window.innerWidth - width - MARGIN), MARGIN);
}

function place(
  anchor: DOMRect,
  pointerX?: number,
  align: PopoverAlign = "beside",
) {
  let left: number;
  if (align === "center") {
    // `props.width` is only an opening guess when the panel sizes to its content; the pass
    // below re-centres on the width it actually rendered at.
    left = centredLeft(anchor, props.width);
  } else {
    // Horizontal: from pointer if given, else from anchor's right edge.
    const originX = pointerX ?? anchor.right + GAP;
    left = originX;
    if (left + props.width > window.innerWidth - MARGIN) {
      left = (pointerX ?? anchor.right) - props.width - GAP;
    }
    left = Math.max(left, MARGIN);
  }

  pos.value = {
    left,
    top: anchor.bottom + 6,
  };

  // Re-measure after layout, so both axes are placed by the real box.
  nextTick(() => {
    if (!el.value || !pos.value) return;
    const { offsetWidth, offsetHeight } = el.value;

    const nextLeft =
      align === "center" ? centredLeft(anchor, offsetWidth) : pos.value.left;
    const nextTop =
      pos.value.top + offsetHeight > window.innerHeight - MARGIN
        ? Math.max(anchor.top - offsetHeight - 6, MARGIN)
        : pos.value.top;

    if (nextLeft === pos.value.left && nextTop === pos.value.top) return;
    pos.value = { left: nextLeft, top: nextTop };
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
      class="fixed z-60 flex"
      :style="{
        left: pos.left + 'px',
        top: pos.top + 'px',
        minWidth: fitContent ? undefined : 'min(' + width + 'px, 90vw)',
        maxWidth: 'min(' + width + 'px, 90vw)',
        maxHeight: '32rem',
      }"
    >
      <slot />
    </div>
  </Teleport>
</template>
