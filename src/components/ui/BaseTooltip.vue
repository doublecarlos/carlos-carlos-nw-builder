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
// element itself, not the wrapper, which has no box to hover, is what registers with the
// shared listeners in useTooltipController and supplies the rectangle to position against.
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  useTemplateRef,
  watch,
} from "vue";
import BasePopover from "./BasePopover.vue";
import { useTooltipController } from "../../composables/useTooltipController";

const props = withDefaults(
  defineProps<{
    /** Tooltip body. Empty disables the tooltip entirely, so a caller can pass a conditional
     *  string without branching on it. */
    text?: string;
    /** px. A maximum for the bubble, which otherwise sizes to its text. */
    width?: number;
    /** Hover open delay. Focus opens with no delay: a keyboard user has already committed
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
const { open, show, attach, detach } = useTooltipController();

/** The slotted element the tooltip belongs to. Resolved from the DOM rather than taken as a
 *  prop so callers just wrap their existing markup. `firstElementChild` is unambiguous: the
 *  popover below is teleported to `<body>`, so it is never a child here. */
const trigger = ref<Element | null>(null);

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

onMounted(() => {
  const el = wrapper.value?.firstElementChild;
  if (!el) return;
  trigger.value = el;
  attach(el, {
    delayMs: () => props.delayMs,
    tappable: () => props.tappable,
    reveal,
  });
});
onBeforeUnmount(detach);

/** Described-by rather than labeled-by: the tooltip explains the control, it does not name
 *  it. Only wired while the bubble exists, since pointing at a removed element says nothing. */
watch([open, trigger], ([isOpen, el]) => {
  if (!el) return;
  if (isOpen) el.setAttribute("aria-describedby", tooltipId);
  else el.removeAttribute("aria-describedby");
});
</script>

<template>
  <span ref="wrapper" class="contents">
    <slot />

    <BasePopover
      v-if="open"
      ref="popover"
      :width="width"
      fit-content
      :animate="false"
    >
      <div
        :id="tooltipId"
        role="tooltip"
        data-testid="tooltip"
        class="animate-fade-in-fast whitespace-pre-line rounded-md border border-line bg-surface px-2 py-1 text-sm text-text shadow-lg"
      >
        {{ text }}
      </div>
    </BasePopover>
  </span>
</template>
