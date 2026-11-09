<script setup lang="ts">
// Reusable kebab-menu flyout for builds, layers, and trash entries. Built on BaseMenu, which
// owns placement, click-outside, Escape, and focus. This component just supplies the row list.
// The trigger lives in the parent (NavRow's kebab, AppHeader's Tools button), so `origin` carries
// the anchor rect to place against and the element to hand focus back to on close.
//
// An entry with a `submenu` swaps the list in place for its own, headed by Back, rather than
// flying a second panel out to the side: it reads the same under a mouse, a finger and the
// keyboard, and a long list scrolls inside the one panel.
import { computed, nextTick, onMounted, ref, useTemplateRef } from "vue";
import { ArrowLeft } from "@lucide/vue";
import BaseMenu from "./ui/BaseMenu.vue";
import BaseMenuItem from "./ui/BaseMenuItem.vue";
import type { NavMenuItem } from "../lib/nav-menu";
import { treePadding } from "../lib/tree-rows";

const props = withDefaults(
  defineProps<{
    /** The trigger's bounding rect (for placement) and element (for focus-restore on close). */
    origin: { anchor: DOMRect; trigger: HTMLElement } | null;
    items: NavMenuItem[];
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

/** The action of the entry whose submenu is showing, or null on the main list. Looked up by
 *  action so a parent that rebuilds `items` while open keeps the view. */
const openSubmenu = ref<string | null>(null);
const submenu = computed(
  () => props.items.find((item) => item.action === openSubmenu.value)?.submenu,
);

/** The entry that held focus is gone, so focus moves to the new list's first entry. */
function show(action: string | null) {
  openSubmenu.value = action;
  void nextTick(() => menu.value?.focusFirst());
}

function onItem(item: NavMenuItem, event: MouseEvent) {
  if (item.submenu) show(item.action);
  else emit("action", item.action, event.shiftKey);
}

/** Indents a hierarchy's entries past the menu item's own padding. */
const indentStyle = (item: NavMenuItem) => treePadding(item.indent ?? 0, 0.5);

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
    panel-class="navmenu flex max-h-[60dvh] min-w-48 flex-col overflow-y-auto p-1"
    @close="emit('close')"
  >
    <template v-if="submenu">
      <BaseMenuItem
        :icon="ArrowLeft"
        data-testid="navmenu-back"
        @click="show(null)"
        >Back</BaseMenuItem
      >
      <div class="px-2 py-1 text-muted">{{ submenu.title }}</div>
      <BaseMenuItem
        v-for="item in submenu.items"
        :key="item.action"
        :icon="item.icon"
        :danger="item.danger"
        :disabled="item.disabled"
        :style="indentStyle(item)"
        @click="(e) => emit('action', item.action, e.shiftKey)"
        @keydown.left.prevent="show(null)"
      >
        {{ item.label }}
      </BaseMenuItem>
    </template>
    <template v-else>
      <BaseMenuItem
        v-for="item in items"
        :key="item.action"
        :icon="item.icon"
        :danger="item.danger"
        :disabled="item.disabled"
        :aria-haspopup="item.submenu ? 'menu' : undefined"
        :style="indentStyle(item)"
        @click="(e) => onItem(item, e)"
        @keydown.right="item.submenu && show(item.action)"
      >
        {{ item.label }}
      </BaseMenuItem>
    </template>
  </BaseMenu>
</template>
