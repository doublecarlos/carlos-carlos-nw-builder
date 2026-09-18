<script setup lang="ts">
// Reusable kebab-menu flyout for builds, layers, and trash entries. Built on BaseMenu, which
// owns placement, click-outside, Escape, and focus. This component just supplies the row list.
// The trigger lives in the parent (NavRow's kebab, AppHeader's Tools button), so `origin` carries
// the anchor rect to place against and the element to hand focus back to on close.
import { onMounted, useTemplateRef, type Component } from "vue";
import BaseMenu from "./ui/BaseMenu.vue";
import BaseMenuItem from "./ui/BaseMenuItem.vue";

const props = withDefaults(
  defineProps<{
    /** The trigger's bounding rect (for placement) and element (for focus-restore on close). */
    origin: { anchor: DOMRect; trigger: HTMLElement } | null;
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

const menu = useTemplateRef<InstanceType<typeof BaseMenu>>("menu");

// v-if-gated by the parent, so it mounts fresh each time a menu opens. Open it right away:
// BaseMenu's own ref is available as soon as this component mounts.
onMounted(() => {
  if (props.origin) menu.value?.open(props.origin.trigger, props.origin.anchor);
});
</script>

<template>
  <BaseMenu
    ref="menu"
    :width="192"
    :align="align"
    :ignore="ignore"
    panel-class="navmenu flex min-w-48 flex-col p-1"
    @close="emit('close')"
  >
    <BaseMenuItem
      v-for="item in items"
      :key="item.action"
      :icon="item.icon"
      :danger="item.danger"
      :disabled="item.disabled"
      @click="(e) => emit('action', item.action, e.shiftKey)"
    >
      {{ item.label }}
    </BaseMenuItem>
  </BaseMenu>
</template>
