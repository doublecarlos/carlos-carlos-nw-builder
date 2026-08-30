<script setup lang="ts">
// One build row in the sidebar's Builds section. Its own component only because there are two
// call sites -- the top level and inside a folder -- that differ in indent and in which drop
// list the row belongs to, and in nothing else. Pure presentation, like NavBuilds itself:
// every action is an emit the parent chain resolves.
import { computed, type Component, type Directive } from "vue";
import BaseTooltip from "./ui/BaseTooltip.vue";
import { EllipsisVertical } from "@lucide/vue";
import NavContextMenu from "./NavContextMenu.vue";
import { isMac } from "../lib/platform";
import type {
  DragHandleProps,
  DropRowProps,
  DropZone,
} from "../composables/useDragAndDrop";
import type { Build } from "../types";

const vRenameFocus: Directive<HTMLInputElement> = {
  mounted(el) {
    el.focus();
    el.select();
  },
};

const props = defineProps<{
  build: Build;
  active: boolean;
  renaming: boolean;
  renameText: string;
  menuOpen: boolean;
  menuItems: {
    action: string;
    label: string;
    /** Lucide component rendered left of the label. */
    icon?: Component;
    danger?: boolean;
    disabled?: boolean;
  }[];
  /** Bounding rect of the row that opened the menu, for popover anchoring. */
  menuAnchor: DOMRect | null;
  /** `useDragHandle`'s bindings -- carried by the whole row, which is what drags. */
  handleProps: DragHandleProps;
  /** `useDropList`'s `rowProps` for whichever list this row sits in. */
  dropProps: DropRowProps;
  indicator: DropZone | null;
  /** Inside a folder -- indents the row under its folder header. */
  nested: boolean;
}>();

const emit = defineEmits<{
  select: [id: string];
  "rename-start": [id: string, name: string];
  "rename-commit": [];
  "rename-cancel": [];
  "move-up": [id: string];
  "move-down": [id: string];
  "focus-move": [dir: 1 | -1];
  "delete-request": [id: string];
  "menu-open": [id: string, event: MouseEvent];
  "menu-action": [action: string, id: string];
  "menu-close": [];
}>();

/** The row itself is the drag handle, so while it is being renamed the input inside it would
 *  lose the browser's drag-to-select-text gesture to the row's drag. Dragging is off for as
 *  long as the rename input is up. */
const rowProps = computed(() => ({
  ...props.dropProps,
  ...props.handleProps,
  draggable: !props.renaming,
}));

/** ↑/↓ moves the list selection; Ctrl/Cmd+↑/↓ reorders instead, within this row's own folder
 *  (or the top level). Delete/Backspace asks for the parent's two-step delete confirm. F2
 *  starts rename -- Enter is left alone since a native button already treats it as a click
 *  (= select), matching the "Enter activates, same as click" convention used elsewhere
 *  (useCursorRowKeys). */
function onRowKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const dir = event.key === "ArrowDown" ? 1 : -1;
    if (isMac ? event.metaKey : event.ctrlKey) {
      if (dir === 1) emit("move-down", props.build.id);
      else emit("move-up", props.build.id);
    } else {
      emit("focus-move", dir);
    }
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    emit("delete-request", props.build.id);
    return;
  }
  if (event.key === "F2") {
    event.preventDefault();
    emit("rename-start", props.build.id, props.build.name);
  }
}
</script>

<template>
  <div
    class="nav-row nav-row--build relative flex cursor-grab items-center gap-1 rounded-md border-b-2 border-t-2 border-transparent py-1 pr-1"
    :class="[
      nested ? 'nav-row--nested pl-7' : 'pl-1',
      active && 'is-active bg-accent-soft',
      indicator === 'before' && '!border-t-accent',
      indicator === 'after' && '!border-b-accent',
    ]"
    v-bind="rowProps"
  >
    <!-- Stands in for a folder header's chevron so build names line up with folder names. -->
    <span class="size-[18px] flex-none" aria-hidden="true" />

    <input
      v-if="renaming"
      v-rename-focus
      :value="renameText"
      class="nav-rename min-w-0 flex-1 rounded-md border border-line bg-surface px-1 py-0.5"
      @input="
        emit(
          'rename-start',
          build.id,
          ($event.target as HTMLInputElement).value,
        )
      "
      @keydown.enter="emit('rename-commit')"
      @keydown.esc="emit('rename-cancel')"
      @blur="emit('rename-commit')"
    />

    <BaseTooltip v-else :text="build.name">
      <button
        type="button"
        class="nav-name min-w-0 flex-1 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap py-0.5 text-left"
        :data-nav-key="build.id"
        data-nav-kind="build"
        @click="emit('select', build.id)"
        @dblclick="emit('rename-start', build.id, build.name)"
        @contextmenu.prevent="emit('menu-open', build.id, $event)"
        @keydown="onRowKeydown"
      >
        {{ build.name }}
      </button>
    </BaseTooltip>

    <div class="nav-menu-wrap relative">
      <BaseTooltip text="Build menu">
        <button
          type="button"
          class="nav-kebab flex-none cursor-pointer rounded-md px-1.5 leading-none text-muted hover:bg-surface-2 hover:text-text"
          aria-label="Build menu"
          @click="emit('menu-open', build.id, $event)"
        >
          <EllipsisVertical class="size-[14px]" />
        </button>
      </BaseTooltip>

      <NavContextMenu
        v-if="menuOpen"
        :anchor="menuAnchor"
        :items="menuItems"
        :ignore="['.nav-kebab']"
        @action="(a) => emit('menu-action', a, build.id)"
        @close="emit('menu-close')"
      />
    </div>
  </div>
</template>
