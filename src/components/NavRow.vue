<script setup lang="ts">
// Shared presentation row for build/folder/layer nav rows: rename input, tooltip,
// drag bind, indicator styling, menu, keyboard contract. Before/after slots for
// folder chevron and build count.
import { computed, type Component, type Directive } from "vue";
import BaseTooltip from "./ui/BaseTooltip.vue";
import BaseInput from "./ui/BaseInput.vue";
import { EllipsisVertical } from "@lucide/vue";
import NavContextMenu from "./NavContextMenu.vue";
import { isMac } from "../lib/platform";
import type {
  DragHandleProps,
  DropRowProps,
  DropZone,
} from "../composables/useDragAndDrop";

const vRenameFocus: Directive<HTMLInputElement> = {
  mounted(el) {
    el.focus();
    el.select();
  },
};

const props = defineProps<{
  id: string;
  name: string;
  kind: "build" | "folder" | "layer";
  active: boolean;
  renaming: boolean;
  renameText: string;
  menuOpen: boolean;
  menuItems: {
    action: string;
    label: string;
    icon?: Component;
    danger?: boolean;
    disabled?: boolean;
  }[];
  menuAnchor: DOMRect | null;
  handleProps: DragHandleProps;
  dropProps: DropRowProps;
  indicator: DropZone | null;
  nested: boolean;
  disabled?: boolean;
  collapsed?: boolean;
}>();

const emit = defineEmits<{
  select: [id: string];
  "rename-start": [id: string, name: string];
  "rename-commit": [];
  "rename-cancel": [];
  "move-up": [id: string];
  "move-down": [id: string];
  "focus-move": [dir: 1 | -1];
  "delete-request": [id: string, skipConfirm: boolean];
  "folder-toggle": [id: string];
  "menu-open": [id: string, event: MouseEvent];
  "menu-action": [action: string, id: string, skipConfirm: boolean];
  "menu-close": [];
}>();

const rowProps = computed(() => ({
  ...props.dropProps,
  ...props.handleProps,
  draggable: !props.renaming,
}));

function onRowKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const dir = event.key === "ArrowDown" ? 1 : -1;
    if (isMac ? event.metaKey : event.ctrlKey) {
      if (dir === 1) emit("move-down", props.id);
      else emit("move-up", props.id);
    } else {
      emit("focus-move", dir);
    }
    return;
  }
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    if (props.kind === "folder") {
      event.preventDefault();
      if (props.collapsed === undefined) {
        emit("folder-toggle", props.id);
      } else {
        const wantsCollapse = event.key === "ArrowLeft";
        if (props.collapsed !== wantsCollapse) {
          emit("folder-toggle", props.id);
        }
      }
    }
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    emit("delete-request", props.id, event.shiftKey);
    return;
  }
  if (event.key === "F2") {
    event.preventDefault();
    emit("rename-start", props.id, props.name);
  }
}
</script>

<template>
  <div
    :class="[
      nested
        ? 'nav-row--nested ml-6 pl-1 border-l-1 border-solid border-line'
        : 'pl-1 my-1',
    ]"
  >
    <div
      class="nav-row relative flex cursor-grab items-center gap-1 h-9 rounded-md border-b-2 border-t-2 border-transparent py-1 pl-2 pr-1 focus-within:rounded-none focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-accent"
      :class="[
        `nav-row--${kind}`,
        active && 'is-active bg-accent-soft',
        indicator === 'before' && '!border-t-accent',
        indicator === 'after' && '!border-b-accent',
        kind === 'folder' &&
          indicator === 'into' &&
          'is-drop-into bg-accent-soft !border-b-accent !border-t-accent',
      ]"
      v-bind="rowProps"
    >
      <slot name="before" />

      <BaseInput
        v-if="renaming"
        v-rename-focus
        :model-value="renameText"
        type="text"
        class="nav-rename min-w-0 flex-1 focus:outline-none"
        @update:model-value="emit('rename-start', id, String($event))"
        @keydown.enter="emit('rename-commit')"
        @keydown.esc="emit('rename-cancel')"
        @blur="emit('rename-commit')"
      />

      <BaseTooltip v-else :text="name">
        <button
          type="button"
          class="nav-name min-w-0 flex-1 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap py-0.5 text-left focus:outline-none"
          :class="disabled && 'text-muted'"
          :data-nav-key="id"
          :data-nav-kind="kind"
          @click="emit('select', id)"
          @dblclick="emit('rename-start', id, name)"
          @contextmenu.prevent="emit('menu-open', id, $event)"
          @keydown="onRowKeydown"
        >
          {{ name }}
        </button>
      </BaseTooltip>

      <slot name="after" />

      <div class="nav-menu-wrap relative flex items-center">
        <BaseTooltip
          :text="
            kind === 'folder'
              ? 'Folder menu'
              : kind === 'layer'
                ? 'Layer menu'
                : 'Build menu'
          "
        >
          <button
            type="button"
            class="nav-kebab flex flex-none cursor-pointer items-center rounded-md px-1.5 py-1 text-muted hover:bg-surface-2 hover:text-text focus:outline-none"
            :aria-label="`${kind} menu`"
            @click="emit('menu-open', id, $event)"
          >
            <EllipsisVertical class="size-[14px]" />
          </button>
        </BaseTooltip>

        <NavContextMenu
          v-if="menuOpen"
          :anchor="menuAnchor"
          :items="menuItems"
          :ignore="['.nav-kebab']"
          @action="(a, skip) => emit('menu-action', a, id, skip)"
          @close="emit('menu-close')"
        />
      </div>
    </div>
  </div>
</template>
