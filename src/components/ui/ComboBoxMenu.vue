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
import {
  asideStacks,
  placeAside,
  stackedMenuRoom,
} from "../../lib/aside-placement";

// Floating dropdown shell used by ComboBox.vue. Same interaction (type to filter, arrow keys,
// Enter, Escape), just different row content via the `#option` slot. `data-testid` rather than
// a styling class: e2e specs need a stable hook that survives restyling.
//
// Rendered in place rather than teleported through BasePopover (base.css's exception), but
// `fixed` against its parent's rect, so a scrolling ancestor (a point section's horizontally
// scrolling body) can't clip it. `--anchor-width` carries the parent's width for `menuClass`.
//
// The optional `aside` slot is a detail panel beside the menu, top-aligned with it, on whichever
// side has room. When neither does it stacks past the menu instead (lib/aside-placement.ts).
// Pressing on it keeps focus in the input that owns the menu, and its clicks stay its own: a
// host row reacting to them (BuildSlot's cursor parking) would blur that input.
//
// `fill` drops the floating shell for a plain list filling the rest of its parent, which is
// how ComboBoxScreen shows the rows. It has no aside.

const props = withDefaults(
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
    /** Fill the parent's remaining height in flow instead of floating by the input. */
    fill?: boolean;
  }>(),
  { menuClass: "w-(--anchor-width)", listboxId: undefined, fill: false },
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

const asideEl = useTemplateRef("aside");
const menuBox = useElementBounding(el);
const asideBox = useElementBounding(asideEl);

/** Drops below the input, or opens upward when the rows don't fit below and there is more
 *  room above. */
const opening = computed(() => {
  const below = viewportHeight.value - bottom.value - GAP - MARGIN;
  const above = top.value - GAP - MARGIN;
  const up = contentHeight.value > below && above > below;
  return { up, room: Math.max(up ? above : below, 0) };
});

const menuRect = computed(() => ({
  left: menuBox.left.value,
  top: menuBox.top.value,
  right: menuBox.right.value,
  bottom: menuBox.bottom.value,
}));

/** An aside too wide for either side of the menu stacks past it, taking half the room. */
const stacked = computed(
  () =>
    asideBox.width.value > 0 &&
    asideStacks(menuRect.value, asideBox.width.value, viewportWidth.value),
);

/** Capped to the space on its side of the input. */
const style = computed<CSSProperties>(() => {
  const { up, room } = opening.value;
  const cap = stacked.value ? stackedMenuRoom(room) : room;
  return {
    left: `${left.value}px`,
    "--anchor-width": `${width.value}px`,
    maxHeight: `min(20rem, ${cap}px)`,
    ...(up
      ? { bottom: `${viewportHeight.value - top.value + GAP}px` }
      : { top: `${bottom.value + GAP}px` }),
  };
});

const asideStyle = computed<CSSProperties>(() => {
  const placement = placeAside({
    menu: menuRect.value,
    aside: { width: asideBox.width.value, height: asideBox.height.value },
    viewport: { width: viewportWidth.value, height: viewportHeight.value },
    menuUp: opening.value.up,
  });
  return {
    left: `${placement.left}px`,
    top: `${placement.top}px`,
    maxHeight: `${placement.maxHeight}px`,
    // Hidden rather than removed, so its size stays measurable for the next placement.
    visibility: placement.hidden ? "hidden" : undefined,
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
    class="overflow-y-auto bg-surface"
    :class="
      props.fill
        ? 'min-h-0 flex-1 overscroll-contain'
        : ['fixed z-menu rounded-md border border-line shadow-lg', menuClass]
    "
    :style="props.fill ? undefined : style"
  >
    <slot />
  </div>
  <div
    v-if="$slots.aside && !props.fill"
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
