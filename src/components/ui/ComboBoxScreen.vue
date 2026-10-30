<script setup lang="ts">
// ComboBox's phone presentation: a full-screen surface with a heading, a close button, the
// owner's search field and the option list filling the rest. Sized to the visual viewport, so
// the on-screen keyboard shortens the list instead of covering its end.
//
// The search field and rows stay the owning ComboBox's own markup, passed in through slots, so
// its keyboard handling and listbox wiring are the same in either presentation. The owner also
// takes Escape and the arrow keys on `panel`, which it focuses on open: the search field gets
// focus, and the keyboard, only once tapped.
import { useTemplateRef, computed } from "vue";
import { useScrollLock } from "@vueuse/core";
import { ArrowLeft } from "@lucide/vue";
import { trapTab } from "../../lib/focus-trap";
import { useVisualViewport } from "../../composables/useVisualViewport";
import ComboBoxMenu from "./ComboBoxMenu.vue";
import IconButton from "./IconButton.vue";

defineProps<{
  /** Heading, and the dialog's accessible name. */
  label: string;
  /** Forwarded to the list, the target of the search field's `aria-controls`. */
  listboxId?: string;
}>();

const emit = defineEmits<{ close: [] }>();

defineSlots<{
  /** The search field. */
  search(): unknown;
  /** Extra header actions beside the heading. */
  actions?(): unknown;
  /** The option rows. */
  default(): unknown;
}>();

const panel = useTemplateRef<HTMLElement>("panel");
const menu = useTemplateRef<InstanceType<typeof ComboBoxMenu>>("menu");
const box = useVisualViewport();

useScrollLock(document.body, true);

const style = computed(() => ({
  top: `${box.value.top}px`,
  left: `${box.value.left}px`,
  width: `${box.value.width}px`,
  height: `${box.value.height}px`,
}));

defineExpose({
  panel,
  scrollToHighlighted: () => menu.value?.scrollToHighlighted(),
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="panel"
      class="fixed z-modal flex flex-col bg-surface pb-[env(safe-area-inset-bottom)] focus:outline-none"
      :style="style"
      role="dialog"
      aria-modal="true"
      :aria-label="label"
      data-testid="picker-screen"
      tabindex="-1"
      @keydown.tab="trapTab($event, panel)"
    >
      <div
        class="flex flex-none flex-col gap-2 border-b border-line px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]"
      >
        <div class="flex min-w-0 items-center gap-1">
          <IconButton
            class="size-tap shrink-0 text-base"
            title="Close"
            data-testid="picker-screen-close"
            @click="emit('close')"
            ><ArrowLeft
          /></IconButton>
          <h2 class="min-w-0 flex-1 truncate text-base font-semibold">
            {{ label }}
          </h2>
          <slot name="actions" />
        </div>
        <slot name="search" />
      </div>
      <ComboBoxMenu ref="menu" fill :listbox-id="listboxId">
        <slot />
      </ComboBoxMenu>
    </div>
  </Teleport>
</template>
