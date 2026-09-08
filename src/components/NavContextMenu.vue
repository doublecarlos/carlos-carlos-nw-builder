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
    /** Which edge of the trigger the menu lines up with. `right` suits a kebab at the end of a
     *  row; `left` a trigger at the start of a bar, where a right-aligned menu would run off. */
    align?: "left" | "right";
  }>(),
  { ignore: () => [], align: "right" },
);

const emit = defineEmits<{
  /** The Shift key at click time: skips the confirmation dialog the action would raise. */
  action: [action: string, skipConfirm: boolean];
  close: [];
}>();

const popover = ref<InstanceType<typeof BasePopover> | null>(null);
const menuEl = ref<HTMLElement | null>(null);

// Place the popover after mount - the component is v-if-gated so it mounts fresh each
// time a menu opens. nextTick gives BasePopover's Teleport a chance to render.
// A left-aligned menu passes the trigger's left edge as the origin: `place` starts at the
// anchor's right edge, which only the `-translate-x-full` case pulls back over the trigger.
onMounted(async () => {
  await nextTick();
  const anchor = props.anchor;
  if (anchor)
    popover.value?.place(
      anchor,
      props.align === "left" ? anchor.left : undefined,
    );
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
      class="navmenu flex min-w-48 flex-col rounded-md border border-line bg-surface p-1 shadow-lg"
      :class="align === 'right' && '-translate-x-full'"
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
        @click="$emit('action', item.action, $event.shiftKey)"
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
