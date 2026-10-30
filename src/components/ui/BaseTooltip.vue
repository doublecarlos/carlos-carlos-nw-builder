<script setup lang="ts">
// A themed tooltip for one trigger, replacing the native `title` attribute wherever the text
// carries information rather than just repeating what is already on screen. `title` shows
// after a ~1s delay, never on keyboard focus, never on touch, and cannot be styled; this
// shows on hover *and* keyboard focus, and is dismissable with Escape.
//
// A tap never opens it: hover means a mouse, and focus means the keyboard (see
// `revealsOnFocus`). A trigger whose tooltip is the only place its text appears, and which
// does nothing on click, sets `tappable` so a tap toggles the bubble instead.
//
// Wraps its trigger in a `display: contents` span, so it adds no box of its own: the trigger
// keeps whatever layout role it had in the parent (a flex item stays a flex item). The trigger
// element itself -- not the wrapper, which has no box to hover -- carries the listeners and
// supplies the rectangle to position against.
import { nextTick, ref, useId, useTemplateRef, watch, onMounted } from "vue";
import { useEventListener, useTimeoutFn } from "@vueuse/core";
import BasePopover from "./BasePopover.vue";
import {
  focusReveals,
  pressedByTouch,
  useTooltipController,
} from "../../composables/useTooltipController";

const props = withDefaults(
  defineProps<{
    /** Tooltip body. Empty disables the tooltip entirely, so a caller can pass a conditional
     *  string without branching on it. */
    text?: string;
    /** px. A maximum for the bubble, which otherwise sizes to its text. */
    width?: number;
    /** Hover open delay. Focus opens with no delay -- a keyboard user has already committed
     *  to the control by the time they land on it, and a delay there just reads as lag. */
    delayMs?: number;
    /** The trigger does nothing on click and the text is not on screen anywhere else: a tap
     *  toggles the bubble, so touch users can read it. */
    tappable?: boolean;
  }>(),
  { text: "", width: 240, delayMs: 300, tappable: false },
);

const wrapper = useTemplateRef<HTMLElement>("wrapper");
const popover = useTemplateRef<InstanceType<typeof BasePopover>>("popover");
const tooltipId = useId();
const { open, show, hide } = useTooltipController();

/** The slotted element the tooltip belongs to. Resolved from the DOM rather than taken as a
 *  prop so callers just wrap their existing markup. `firstElementChild` is unambiguous: the
 *  popover below is teleported to `<body>`, so it is never a child here. */
const trigger = ref<HTMLElement | null>(null);
onMounted(() => {
  trigger.value = (wrapper.value?.firstElementChild as HTMLElement) ?? null;
});

// The delay is a getter so a caller can change it reactively; `immediate: false` keeps the
// timer from firing once on mount.
const { start: startDelay, stop: stopDelay } = useTimeoutFn(
  () => reveal(),
  () => props.delayMs,
  { immediate: false },
);

async function reveal() {
  if (!props.text || !trigger.value) return;
  show();
  // The popover only mounts once `open` flips, so its rect has to be handed over after the
  // render rather than in the same tick.
  await nextTick();
  popover.value?.place(
    trigger.value.getBoundingClientRect(),
    undefined,
    "center",
  );
}

function dismiss() {
  stopDelay();
  hide();
}

// Pointer rather than mouse events, so the compatibility mouseenter a tap fires is ignored.
useEventListener(trigger, "pointerenter", (event: PointerEvent) => {
  if (event.pointerType === "mouse") startDelay();
});
useEventListener(trigger, "pointerleave", (event: PointerEvent) => {
  if (event.pointerType === "mouse") dismiss();
});
// focusin/focusout rather than focus/blur: they bubble, so a trigger that wraps its own
// focusable (a label around an input) still reports as focused.
useEventListener(trigger, "focusin", (event: FocusEvent) => {
  if (!focusReveals(event.target as Element)) return;
  stopDelay();
  reveal();
});
useEventListener(trigger, "focusout", dismiss);
// A click usually opens something -- a menu, a dialog, a drawer -- and a tooltip left hanging
// over it would cover the thing the click just produced.
useEventListener(trigger, "click", () => {
  if (props.tappable && pressedByTouch() && !open.value) reveal();
  else dismiss();
});
// A tap-opened bubble has no pointer leaving to close it, so a press anywhere else does.
useEventListener(
  () => (props.tappable ? document : null),
  "pointerdown",
  (event: PointerEvent) => {
    if (open.value && !trigger.value?.contains(event.target as Node)) hide();
  },
  true,
);
// A scroll while the bubble is up leaves it pointing at where the trigger used to be, so it
// closes -- same reasoning as the hover card's own scroll handling. A scroll during the open
// delay is a different case and deliberately does not cancel it: often that scroll is what
// brought the trigger into view to be hovered at all, and `reveal` reads a fresh rect when the
// timer fires anyway.
useEventListener(
  window,
  "scroll",
  () => {
    if (open.value) hide();
  },
  true,
);

/** Described-by rather than labeled-by: the tooltip explains the control, it does not name
 *  it. Only wired while the bubble exists -- pointing at a removed element says nothing. */
watch([open, trigger], ([isOpen, el]) => {
  if (!el) return;
  if (isOpen) el.setAttribute("aria-describedby", tooltipId);
  else el.removeAttribute("aria-describedby");
});
</script>

<template>
  <span ref="wrapper" class="contents">
    <slot />

    <BasePopover v-if="open" ref="popover" :width="width" fit-content>
      <div
        :id="tooltipId"
        role="tooltip"
        data-testid="tooltip"
        class="rounded-md border border-line bg-surface px-2 py-1 text-sm text-text shadow-lg"
      >
        {{ text }}
      </div>
    </BasePopover>
  </span>
</template>
