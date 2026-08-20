<script setup lang="ts">
// The app's one modal overlay: backdrop, focus trap, focus restore, Escape, body scroll lock
// and the dialog semantics that make it announce as a dialog. Callers supply the panel's
// sizing through `panelClass` -- the chrome is shared, the shape is not.
//
// Anchored surfaces (BasePopover, BaseTooltip, NavContextMenu) are deliberately not built on
// this: they are not modal, and taking focus away from the control they hang off is the one
// thing they must not do. In-flow panels are BaseDrawer.
import { onBeforeUnmount, onMounted, useId, useTemplateRef } from "vue";
import { useScrollLock } from "@vueuse/core";
import { useEscapeToClose } from "../../composables/useEscapeToClose";

// Attrs land on the backdrop, not the panel: `data-testid` on the outer element is what lets
// a spec click the backdrop to dismiss, and `panelClass` covers the inner box.
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** Heading text. Rendered as the panel's header (with a close button) and used as the
     *  dialog's accessible name. Every modal needs this or `label`. */
    title?: string;
    /** Accessible name for a modal with no visible heading -- the palette's search box is its
     *  own chrome. Ignored when `title` is set. */
    label?: string;
    /** Where the panel sits vertically. `top` is what a palette wants: the box stays put while
     *  the result list grows and shrinks under it, instead of drifting with its own height. */
    align?: "center" | "top";
    /** The panel's own width and height -- every surface differs, so none is assumed here. */
    panelClass?: string;
  }>(),
  {
    title: undefined,
    label: undefined,
    panelClass: undefined,
    align: "center",
  },
);

const emit = defineEmits<{ close: [] }>();

if (import.meta.env.DEV && !props.title && !props.label) {
  console.warn("BaseModal: pass `title` or `label` -- a dialog needs a name.");
}

const titleId = useId();
const panel = useTemplateRef<HTMLElement>("panel");

/** Whatever had focus when the modal opened, so closing hands it back rather than dropping the
 *  user at the top of the document. Read during setup: by `onMounted` the panel already has it. */
let returnFocusTo = document.activeElement as HTMLElement | null;

/** Close without handing focus back, for a caller whose own action puts focus somewhere
 *  deliberate -- choosing a palette destination parks the keyboard cursor on the row it
 *  jumped to, and restoring the pre-modal focus would undo that immediately. */
function releaseFocus() {
  returnFocusTo = null;
}

defineExpose({ releaseFocus });

// Locked for as long as this component lives; VueUse restores the previous overflow on unmount.
useScrollLock(document.body, true);

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Tabbable descendants in document order, minus the hidden ones -- the file inputs behind
 *  "Choose file…" buttons are focusable by selector but not reachable by Tab. */
function focusables(): HTMLElement[] {
  const root = panel.value;
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0,
  );
}

/** Tab wraps inside the panel: a modal owns the screen while it is open, so tabbing off its
 *  edge must not land on the page behind it. */
function onTab(event: KeyboardEvent) {
  const items = focusables();
  if (!items.length) {
    // Nothing to move to -- the panel itself keeps the keyboard.
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey ? active !== first : active !== last) return;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
}

/** The panel, not its first control: the dialog's name is read out, and no control wears a
 *  focus ring it did not earn. Callers that want a specific field focused do it themselves --
 *  their `onMounted` runs after this one. */
onMounted(() => panel.value?.focus());

onBeforeUnmount(() => returnFocusTo?.focus?.());

useEscapeToClose(() => emit("close"));
</script>

<template>
  <!-- Teleported so stacking never depends on where the modal was mounted. -->
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex justify-center bg-black/30"
      :class="align === 'top' ? 'items-start pt-[12vh]' : 'items-center'"
      v-bind="$attrs"
      @click.self="emit('close')"
    >
      <div
        ref="panel"
        class="flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-xl focus:outline-none"
        :class="panelClass"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="title ? titleId : undefined"
        :aria-label="title ? undefined : label"
        tabindex="-1"
        @keydown.tab="onTab"
      >
        <div
          v-if="title"
          class="flex flex-none items-center justify-between border-b border-line px-4 py-3"
        >
          <h2 :id="titleId" class="text-base font-semibold">{{ title }}</h2>
          <button
            type="button"
            class="cursor-pointer text-muted hover:text-text"
            aria-label="Close"
            data-testid="modal-close"
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
