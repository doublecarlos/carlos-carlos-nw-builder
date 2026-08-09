<script setup lang="ts">
// Reusable kebab-menu flyout for builds, layers, and trash entries.
// Positioned by BasePopover: the parent provides the trigger element's bounding rect
// and the popover handles viewport-edge flipping and clamping automatically.
import { ref, onMounted, nextTick, type Component } from "vue";
import { onClickOutside } from "@vueuse/core";
import BasePopover from "./ui/BasePopover.vue";
import { useEscapeToClose } from "../composables/useEscapeToClose";

const props = withDefaults(
  defineProps<{
    /** Bounding rect of the trigger element, used to anchor the popover. */
    anchor: DOMRect | null;
    items: {
      action: string;
      label: string;
      /** Lucide component rendered left of the label. */
      icon?: Component;
      danger?: boolean;
      disabled?: boolean;
    }[];
    /** CSS selectors for elements that should NOT trigger close (e.g. the kebab button). */
    ignore?: string[];
  }>(),
  { ignore: () => [] },
);

const emit = defineEmits<{
  action: [action: string];
  close: [];
}>();

const popover = ref<InstanceType<typeof BasePopover> | null>(null);
const menuEl = ref<HTMLElement | null>(null);

// Place the popover after mount — the component is v-if-gated so it mounts fresh each
// time a menu opens. nextTick gives BasePopover's Teleport a chance to render.
onMounted(async () => {
  await nextTick();
  if (props.anchor) popover.value?.place(props.anchor);
});

// Close when clicking outside the menu, ignoring the trigger buttons.
onClickOutside(menuEl, () => emit("close"), {
  ignore: props.ignore,
});

useEscapeToClose(() => emit("close"));
</script>

<template>
  <BasePopover ref="popover" :width="192">
    <div
      ref="menuEl"
      class="navmenu flex min-w-48 -translate-x-full flex-col rounded-md border border-line bg-surface p-1 shadow-lg"
    >
      <button
        v-for="item in items"
        :key="item.action"
        type="button"
        class="inline-flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left"
        :class="
          item.disabled
            ? 'text-muted'
            : item.danger
              ? 'cursor-pointer hover:bg-danger-soft hover:text-danger'
              : 'cursor-pointer hover:bg-surface-2'
        "
        :disabled="item.disabled"
        @click="$emit('action', item.action)"
      >
        <component
          :is="item.icon"
          v-if="item.icon"
          class="size-[14px] flex-none"
        />
        {{ item.label }}
      </button>
    </div>
  </BasePopover>
</template>
