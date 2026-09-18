<script setup lang="ts">
// Shared presentation row for build/folder/layer nav rows: leading icon, name and optional
// count live inside one button; rename input, tooltip, drag bind, drag-source/drop-into
// styling, menu and the keyboard contract live around it. The insertion line itself is a
// list-level DropIndicator, not drawn per row. A `before` slot is kept for the layer enable
// checkbox, a control rather than part of the name button.
import { computed, type Component, type Directive } from "vue";
import BaseTooltip from "./ui/BaseTooltip.vue";
import BaseInput from "./ui/BaseInput.vue";
import { EllipsisVertical } from "@lucide/vue";
import NavContextMenu from "./NavContextMenu.vue";
import { isMac } from "../lib/platform";
import {
  dragSource,
  type DragHandleProps,
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
  /** The kebab's bounding rect (placement) and element (focus-restore), for NavContextMenu. */
  menuOrigin: { anchor: DOMRect; trigger: HTMLElement } | null;
  handleProps: DragHandleProps;
  rowProps: Record<string, string | undefined>;
  isDropInto: boolean;
  disabled?: boolean;
  collapsed?: boolean;
  /** Display-only leading icon, rendered inside the name button. */
  icon?: Component;
  /** Trailing count rendered inside the name button (a folder's build count). */
  count?: number;
}>();

const emit = defineEmits<{
  /** This row's own button was clicked (or Entered): the row activates itself. */
  activate: [id: string];
  /** Arrow navigation landed on a selectable row: the list should select this id. */
  select: [id: string];
  "rename-start": [id: string, name: string];
  "rename-commit": [];
  "rename-cancel": [];
  "move-up": [id: string];
  "move-down": [id: string];
  "delete-request": [id: string, skipConfirm: boolean];
  "folder-toggle": [id: string];
  "menu-open": [id: string, event: MouseEvent];
  "menu-action": [action: string, id: string, skipConfirm: boolean];
  "menu-close": [];
}>();

const rowProps = computed(() => ({
  ...props.rowProps,
  ...(props.renaming ? {} : props.handleProps),
}));

const isDragSource = computed(() => dragSource.value?.key === props.id);

/** Plain arrow keys walk the enclosing nav list, so the primitive owns its own keyboard
 *  cursor instead of every list re-implementing the walk. Landing on a folder moves focus
 *  only: a folder row toggles rather than loading into the editor. */
function moveFocus(origin: HTMLElement, dir: 1 | -1) {
  const list = origin.closest("[data-nav-list]");
  const rows = list?.querySelectorAll<HTMLElement>("[data-nav-key]");
  if (!rows?.length) return;
  const idx = Array.from(rows).indexOf(origin);
  const next = rows[Math.min(Math.max(idx + dir, 0), rows.length - 1)];
  next.focus();
  if (next.dataset.navKind !== "folder") emit("select", next.dataset.navKey!);
}

function onRowKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const dir = event.key === "ArrowDown" ? 1 : -1;
    if (isMac ? event.metaKey : event.ctrlKey) {
      if (dir === 1) emit("move-down", props.id);
      else emit("move-up", props.id);
    } else {
      moveFocus(event.currentTarget as HTMLElement, dir);
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
    class="nav-row relative flex cursor-grab select-none items-center gap-1 h-9 rounded-md py-1 pl-2 pr-1 focus-within:rounded-none focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-accent"
    :class="[
      `nav-row--${kind}`,
      active && 'is-active bg-accent-soft',
      isDragSource && 'is-drag-source opacity-50',
      kind === 'folder' && isDropInto && 'is-drop-into bg-accent-soft',
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
        class="nav-name flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 overflow-hidden py-0.5 text-left focus:outline-none"
        :class="disabled && 'text-muted'"
        :data-nav-key="id"
        :data-nav-kind="kind"
        @click="emit('activate', id)"
        @dblclick="emit('rename-start', id, name)"
        @contextmenu.prevent="emit('menu-open', id, $event)"
        @keydown="onRowKeydown"
      >
        <component
          :is="icon"
          v-if="icon"
          class="size-[14px] flex-none text-muted"
        />
        <span
          class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
          >{{ name }}</span
        >
        <span
          v-if="count !== undefined"
          class="flex-none text-sm tabular-nums text-muted"
          >{{ count }}</span
        >
      </button>
    </BaseTooltip>

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
          data-no-drag
          class="nav-kebab flex flex-none cursor-pointer items-center rounded-md px-1.5 py-1 text-muted hover:bg-surface-2 hover:text-text focus:outline-none"
          :aria-label="`${kind} menu`"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          @click="emit('menu-open', id, $event)"
        >
          <EllipsisVertical class="size-[14px]" />
        </button>
      </BaseTooltip>

      <NavContextMenu
        v-if="menuOpen"
        :origin="menuOrigin"
        :items="menuItems"
        :ignore="['.nav-kebab']"
        @action="(a, skip) => emit('menu-action', a, id, skip)"
        @close="emit('menu-close')"
      />
    </div>
  </div>
</template>
