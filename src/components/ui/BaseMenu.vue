<script setup lang="ts">
// Shared shell for every click-triggered menu/command popover: BasePopover placement,
// click-outside, Escape, focus-in on open, focus-restore on close, and roving keyboard focus
// via useRovingFocus. NavContextMenu, PresetMenu, CheckMenu and SectionCopyMenu are all built on
// this. See their own files for what differs between a command list, a checkbox group and a
// small form.
//
// Hover surfaces (BaseTooltip, hover cards) stay on BasePopover directly and never take focus;
// BaseModal traps focus for a full dialog. This is the middle case: a click opens it, focus
// moves in, and it must hand focus back to whatever opened it when it closes.
//
// Items default to `tabindex="-1"` (see BaseMenuItem) rather than `role="menuitem"`: the existing
// test suite reads every row by its native "button" role, and adding an explicit menuitem role
// would have broken that across every call site for no real accessibility gain at this list size.
import { ref, computed, nextTick, useTemplateRef } from "vue";
import { onClickOutside, useEventListener } from "@vueuse/core";
import BasePopover from "./BasePopover.vue";
import { useEscapeToClose } from "../../composables/useEscapeToClose";
import { useRovingFocus } from "../../composables/useRovingFocus";
import { trapTab } from "../../lib/focus-trap";

const props = withDefaults(
  defineProps<{
    /** px, forwarded to BasePopover. */
    width?: number;
    /** Forwarded to BasePopover, letting the panel shrink to its content. */
    fitContent?: boolean;
    /** Which edge of the trigger the menu lines up with. */
    align?: "left" | "right";
    /** Panel role. `group` is for a checkbox list or a form, where "menu" semantics (arrow-only
     *  navigation, no native form controls) would be wrong. */
    role?: "menu" | "group";
    /** Arrow/Home/End move focus among items, and opening focuses the panel rather than an item
     *  (see `focusOpen`). Off for a panel whose own control already owns Up/Down, e.g.
     *  SectionCopyMenu's combobox. Tab and Escape still dismiss either way. */
    roving?: boolean;
    /** Selector for the items useRovingFocus and focus-on-open target. */
    itemSelector?: string;
    /** aria-label for the panel. */
    label?: string;
    /** CSS selectors for elements that should NOT trigger close (typically the trigger). */
    ignore?: string[];
    /** The panel's own layout (flex direction, gap, padding, sizing). Every caller's content
     *  differs; BaseMenu only owns the shared border/background/shadow chrome. */
    panelClass?: string | string[];
    /** Off for a panel with its own multi-control tab order (SectionCopyMenu's combobox plus
     *  Copy button). Tab cycles within the panel instead of closing it, like a modal. */
    dismissOnTab?: boolean;
  }>(),
  {
    width: undefined,
    fitContent: false,
    align: "right",
    role: "menu",
    roving: true,
    itemSelector: 'button[tabindex="-1"]',
    label: undefined,
    ignore: () => [],
    panelClass: undefined,
    dismissOnTab: true,
  },
);

const emit = defineEmits<{ open: []; close: [] }>();

const popover = useTemplateRef<InstanceType<typeof BasePopover>>("popover");
const panel = useTemplateRef<HTMLElement>("panel");
const isOpen = ref(false);

/** Captured from the element passed to `open()`, never `document.activeElement`. Safari doesn't
 *  focus a button on click, so reading the active element at open time would pick up whatever
 *  had focus before. */
let returnFocusTo: HTMLElement | null = null;

const roving = useRovingFocus({
  container: panel,
  itemSelector: props.itemSelector,
  roving: props.roving,
  onDismiss: close,
});

/** No item starts highlighted. Native menus don't pre-select on open either, and one that did
 *  would make the *second* arrow press look like it skipped a row. Focus lands on the panel
 *  instead, which is enough for Tab, Escape and click-outside; the first ArrowDown/Up lands on
 *  an item (see useRovingFocus's `at === -1`).
 *
 *  Except when `roving` is off: SectionCopyMenu has no arrow key to fall back on to reach its
 *  single input, so it wants that input focused immediately. */
function focusOpen() {
  if (props.roving) nextTick(() => panel.value?.focus());
  else roving.focusFirst();
}

/** `anchor` defaults to the trigger's own rect. NavContextMenu passes a wider one (the whole
 *  `.nav-row`), since its trigger is a small kebab inside a bigger row. */
function open(trigger: HTMLElement, anchor?: DOMRect) {
  const rect = anchor ?? trigger.getBoundingClientRect();
  isOpen.value = true;
  returnFocusTo = trigger;
  if (props.align === "left") popover.value?.place(rect, rect.left);
  else popover.value?.place(rect, undefined, "end");
  focusOpen();
  emit("open");
}

function close() {
  if (!isOpen.value) return;
  isOpen.value = false;
  popover.value?.close();
  returnFocusTo?.focus();
  emit("close");
}

function toggle(event: MouseEvent) {
  if (isOpen.value) close();
  else open(event.currentTarget as HTMLElement);
}

/** ArrowDown/Up on a closed trigger opens the menu and seeds the first/last item, like a native
 *  `<select>`. Unlike a plain open (click, Enter), the arrow key is already a navigation
 *  gesture, so it lands on an item instead of the panel. */
function onTriggerKeydown(event: KeyboardEvent) {
  if (isOpen.value || (event.key !== "ArrowDown" && event.key !== "ArrowUp"))
    return;
  event.preventDefault();
  open(event.currentTarget as HTMLElement);
  if (event.key === "ArrowDown") roving.focusFirst();
  else roving.focusLast();
}

/** Tab cycles within the panel (a form with its own multi-control order) or dismisses the menu
 *  (everything else). Every other key always goes through roving navigation. */
function onPanelKeydown(event: KeyboardEvent) {
  if (event.key === "Tab" && !props.dismissOnTab) {
    trapTab(event, panel.value);
    return;
  }
  roving.onKeydown(event);
}

const triggerAttrs = computed(() => ({
  // "group" is not a valid aria-haspopup value. CheckMenu and SectionCopyMenu, the two
  // `role="group"` panels, are left without it rather than claiming an invalid one.
  "aria-haspopup": props.role === "menu" ? "menu" : undefined,
  "aria-expanded": isOpen.value,
  onKeydown: onTriggerKeydown,
}));

// VueUse's onClickOutside reads the click's composedPath instead of walking closest() live.
// That matters for SectionCopyMenu: choosing a ComboBox option detaches that row from the DOM
// in the same mousedown (see `choose()` in ComboBox.vue), which a live walk would miss.
onClickOutside(panel, close, { ignore: props.ignore });

// Capture phase, not the panel's own bubble-phase keydown: SectionCopyMenu's combobox has its
// own Escape handler that calls stopPropagation, which would otherwise swallow Escape before it
// reaches us. Capture fires top-down, ahead of that, so ours always runs first. Letting the
// event continue afterward is harmless, since our own close() already moved focus away.
useEventListener(panel, "keydown", onPanelKeydown, { capture: true });
// Backstops Escape for the moment between open() and the item actually taking focus.
useEscapeToClose(close);

defineExpose({ open, close, isOpen });
</script>

<template>
  <BasePopover ref="popover" :width="width" :fit-content="fitContent">
    <div
      ref="panel"
      tabindex="-1"
      class="rounded-md border border-line bg-surface shadow-lg focus:outline-none"
      :class="panelClass"
      :role="role"
      :aria-label="label"
    >
      <slot />
    </div>
  </BasePopover>
  <slot name="trigger" :open="isOpen" :toggle="toggle" :attrs="triggerAttrs" />
</template>
