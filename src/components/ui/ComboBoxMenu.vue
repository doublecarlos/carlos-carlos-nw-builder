<script setup lang="ts">
import {
  computed,
  onMounted,
  onUpdated,
  ref,
  useTemplateRef,
  type CSSProperties,
} from "vue";
import { useElementBounding, useWindowSize } from "@vueuse/core";

// Floating dropdown shell used by ComboBox.vue. Same interaction (type to filter, arrow keys,
// Enter, Escape), just different row content via the `#option` slot. `data-testid` rather than
// a styling class: e2e specs need a stable hook that survives restyling.
//
// Rendered in place rather than teleported through BasePopover (base.css's exception), but
// `fixed` against its parent's rect, so a scrolling ancestor (a point section's horizontally
// scrolling body) can't clip it. `--anchor-width` carries the parent's width for `menuClass`.
//
// The optional `aside` slot is a detail panel beside the menu, top-aligned with it. It sits on
// whichever side has room and stays hidden when neither does, since covering the menu would be
// worse than not showing it. Pressing on it keeps focus in the input that owns the menu, and
// its clicks stay its own: a host row reacting to them (BuildSlot's cursor parking) would
// blur that input.

withDefaults(
  defineProps<{
    /** Grows the menu past the input's own width, up to a cap, instead of matching it exactly
     *  -- for callers (ItemPicker) whose row content (stat/bonus preview) needs more room than
     *  a plain option label does. Anchored to the input's left edge, so it only ever grows
     *  rightward. */
    menuClass?: string;
    /** The listbox's own id, so the input driving it can point `aria-controls` here and its
     *  `aria-activedescendant` at one of the rows inside. Omitted by callers that have not
     *  been wired for it yet -- the role still applies, only the association is missing. */
    listboxId?: string;
  }>(),
  { menuClass: "w-(--anchor-width)", listboxId: undefined },
);

/** Gap between the input and the menu, and the menu's minimum distance to the viewport edge. */
const GAP = 2;
const MARGIN = 8;

const el = useTemplateRef("el");
const anchor = computed(() => el.value?.parentElement ?? null);
const { left, top, bottom, width } = useElementBounding(anchor);
const { width: viewportWidth, height: viewportHeight } = useWindowSize();

/** The rows' full height, unconstrained by `max-height`. Remeasured only when the row count
 *  changes: reading `scrollHeight` forces a layout, and a highlight move re-renders the menu
 *  without changing its height. */
const contentHeight = ref(0);
let measuredRows = -1;
const measure = () => {
  const rows = el.value?.childElementCount ?? 0;
  if (rows === measuredRows) return;
  measuredRows = rows;
  contentHeight.value = el.value?.scrollHeight ?? 0;
};
onMounted(measure);
onUpdated(measure);

/** Drops below the input, or opens upward when the rows don't fit below and there is more
 *  room above. Either way the menu is capped to the space on its side. */
const style = computed<CSSProperties>(() => {
  const below = viewportHeight.value - bottom.value - GAP - MARGIN;
  const above = top.value - GAP - MARGIN;
  const up = contentHeight.value > below && above > below;
  const room = Math.max(up ? above : below, 0);
  return {
    left: `${left.value}px`,
    "--anchor-width": `${width.value}px`,
    maxHeight: `min(20rem, ${room}px)`,
    ...(up
      ? { bottom: `${viewportHeight.value - top.value + GAP}px` }
      : { top: `${bottom.value + GAP}px` }),
  };
});

const asideEl = useTemplateRef("aside");
const menuBox = useElementBounding(el);
const asideBox = useElementBounding(asideEl);

/** Gap between the menu and the aside panel. */
const ASIDE_GAP = 6;

const asideStyle = computed<CSSProperties>(() => {
  const asideWidth = asideBox.width.value;
  const right = menuBox.right.value + ASIDE_GAP;
  const leftSide = menuBox.left.value - ASIDE_GAP - asideWidth;
  const asideLeft =
    right + asideWidth <= viewportWidth.value - MARGIN
      ? right
      : leftSide >= MARGIN
        ? leftSide
        : null;
  // Slid up just enough to end inside the viewport, never above its top margin.
  const asideTop = Math.max(
    Math.min(
      menuBox.top.value,
      viewportHeight.value - MARGIN - asideBox.height.value,
    ),
    MARGIN,
  );
  return {
    left: `${asideLeft ?? 0}px`,
    top: `${asideTop}px`,
    maxHeight: `min(32rem, ${viewportHeight.value - 2 * MARGIN}px)`,
    // Hidden rather than removed, so its size stays measurable for the next placement.
    visibility: asideLeft === null ? "hidden" : undefined,
  };
});

/** Scroll the `[data-highlighted]` row into view. Called by the parent picker's
 * `watch(highlight, ...)` instead of reaching into `$el`.
 *
 * Adjusts this menu's own `scrollTop` rather than calling `scrollIntoView`: that scrolls every
 * scrollable ancestor, the document included, so opening a picker whose selected row sits far
 * down the list would yank the page out from under the input the user just clicked. The maths
 * below is `block: "nearest"`, scoped to the menu box. */
function scrollToHighlighted() {
  const menu = el.value;
  const row = menu?.querySelector("[data-highlighted]");
  if (!menu || !row) return;
  const menuBox = menu.getBoundingClientRect();
  const rowBox = row.getBoundingClientRect();
  if (rowBox.top < menuBox.top) menu.scrollTop -= menuBox.top - rowBox.top;
  else if (rowBox.bottom > menuBox.bottom)
    menu.scrollTop += rowBox.bottom - menuBox.bottom;
}

defineExpose({ scrollToHighlighted });

defineSlots<{
  default(): unknown;
  aside?(): unknown;
}>();
</script>

<template>
  <div
    :id="listboxId"
    ref="el"
    role="listbox"
    data-testid="picker-menu"
    class="fixed z-menu animate-fade-in overflow-y-auto rounded-md border border-line bg-surface shadow-lg"
    :class="menuClass"
    :style="style"
  >
    <slot />
  </div>
  <div
    v-if="$slots.aside"
    ref="aside"
    class="fixed z-menu flex"
    data-testid="picker-aside"
    :style="asideStyle"
    @mousedown.prevent
    @click.stop
  >
    <slot name="aside" />
  </div>
</template>
