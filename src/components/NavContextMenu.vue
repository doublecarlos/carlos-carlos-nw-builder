<script setup lang="ts">
// Reusable kebab-menu flyout for builds, layers, and trash entries.
// Positioned by BasePopover: the parent provides the trigger element's bounding rect
// and the popover handles viewport-edge flipping and clamping automatically.
import { ref, onMounted, nextTick } from "vue";
import BasePopover from "./ui/BasePopover.vue";

const props = defineProps<{
  /** Bounding rect of the trigger element, used to anchor the popover. */
  anchor: DOMRect | null;
  items: {
    action: string;
    label: string;
    danger?: boolean;
    disabled?: boolean;
  }[];
}>();

defineEmits<{
  action: [action: string];
}>();

const popover = ref<InstanceType<typeof BasePopover> | null>(null);

// Place the popover after mount — the component is v-if-gated so it mounts fresh each
// time a menu opens. nextTick gives BasePopover's Teleport a chance to render.
onMounted(async () => {
  await nextTick();
  if (props.anchor) popover.value?.place(props.anchor);
});
</script>

<template>
  <BasePopover ref="popover" :width="192">
    <div
      class="navmenu flex min-w-48 -translate-x-full flex-col rounded-md border border-line bg-surface p-1 shadow-lg"
    >
      <button
        v-for="item in items"
        :key="item.action"
        type="button"
        class="rounded-md px-2 py-1 text-left"
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
        {{ item.label }}
      </button>
    </div>
  </BasePopover>
</template>
