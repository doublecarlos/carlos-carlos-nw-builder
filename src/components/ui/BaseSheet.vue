<script setup lang="ts">
// An off-canvas panel sliding in from a screen edge over a backdrop: a side drawer (App.vue's
// nav below the desktop breakpoint) or a bottom sheet. Shares BaseModal's chrome: focus trap,
// focus restore, body scroll lock, dialog semantics, and closing on Escape or a backdrop tap.
//
// Unlike BaseModal it does not silence the app's shortcuts: what a sheet holds is the app's own
// working surface, moved off-canvas for lack of room. And Escape only closes it while focus is
// inside it, so a menu or confirm dialog opened on top takes the key first.
import {
  computed,
  onBeforeUnmount,
  onMounted,
  useId,
  useTemplateRef,
} from "vue";
import { useEventListener, useScrollLock } from "@vueuse/core";
import { trapTab } from "../../lib/focus-trap";
import { useVisualViewport } from "../../composables/useVisualViewport";

// Attrs land on the backdrop, as BaseModal's do, so a `data-testid` there names the whole sheet.
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** The edge the panel is anchored to. */
    side?: "left" | "right" | "bottom";
    /** Heading text, shown with a close button and used as the accessible name. */
    title?: string;
    /** Accessible name for a sheet with no visible heading. Ignored when `title` is set. */
    label?: string;
    /** The panel's own size along the axis it is free in: width for a side, height for bottom. */
    panelClass?: string | string[];
  }>(),
  {
    side: "left",
    title: undefined,
    label: undefined,
    panelClass: undefined,
  },
);

const emit = defineEmits<{ close: [] }>();

if (import.meta.env.DEV && !props.title && !props.label) {
  console.warn("BaseSheet: pass `title` or `label`, a dialog needs a name.");
}

const SIDE_CLASSES: Record<"left" | "right" | "bottom", string> = {
  left: "inset-y-0 left-0 max-w-[85vw] border-r",
  right: "inset-y-0 right-0 max-w-[85vw] border-l",
  bottom:
    "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-lg border-t pb-[env(safe-area-inset-bottom)]",
};

/** Share of the visible height a bottom sheet may take. */
const BOTTOM_MAX_SHARE = 0.85;

// A bottom sheet rides on the visual viewport, so the on-screen keyboard pushes it up rather
// than covering the field being typed in.
const visible = useVisualViewport();
const panelStyle = computed(() => {
  if (props.side !== "bottom") return undefined;
  const { top, height } = visible.value;
  return {
    bottom: `${Math.max(0, window.innerHeight - top - height)}px`,
    maxHeight: `${Math.floor(height * BOTTOM_MAX_SHARE)}px`,
  };
});

const titleId = useId();
const panel = useTemplateRef<HTMLElement>("panel");

/** Read during setup, before the panel takes focus, so closing hands it back. */
const returnFocusTo = document.activeElement as HTMLElement | null;

useScrollLock(document.body, true);

function onTab(event: KeyboardEvent) {
  trapTab(event, panel.value);
}

/** Inside the panel, or nowhere at all once a focused control inside it has unmounted. */
function ownsKeyboard(target: EventTarget | null) {
  return (
    target === document.body ||
    (target instanceof Node && !!panel.value?.contains(target))
  );
}

useEventListener(document, "keydown", (event: KeyboardEvent) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (!ownsKeyboard(event.target)) return;
  emit("close");
});

onMounted(() => {
  panel.value?.focus();
});

onBeforeUnmount(() => {
  returnFocusTo?.focus?.();
});
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-drawer bg-scrim"
      v-bind="$attrs"
      @click.self="emit('close')"
    >
      <div
        ref="panel"
        class="absolute flex flex-col overflow-hidden border-line bg-surface shadow-xl focus:outline-none"
        :class="[SIDE_CLASSES[side], panelClass]"
        :style="panelStyle"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="title ? titleId : undefined"
        :aria-label="title ? undefined : label"
        tabindex="-1"
        data-testid="sheet-panel"
        @keydown.tab="onTab"
      >
        <div
          v-if="title"
          class="flex flex-none items-center justify-between border-b border-line px-3 py-2"
        >
          <h2 :id="titleId" class="text-base font-semibold">{{ title }}</h2>
          <button
            type="button"
            class="cursor-pointer px-1 text-muted hover:text-text"
            aria-label="Close"
            data-testid="sheet-close"
            @click="emit('close')"
          >
            ✕
          </button>
        </div>
        <slot />
      </div>
    </div>
  </Teleport>
</template>
