<script setup lang="ts">
// Layer list section inside the left sidebar. Pure presentation.
import { computed, useTemplateRef, type Component, type Directive } from "vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseTooltip from "./ui/BaseTooltip.vue";
import BaseCheckbox from "./ui/BaseCheckbox.vue";
import { EllipsisVertical, GripVertical, Plus } from "@lucide/vue";
import NavContextMenu from "./NavContextMenu.vue";
import { isMac } from "../lib/platform";
import { matchesQuery } from "../lib/text-filter";
import {
  useDragHandle,
  useDropList,
  type DragSource,
} from "../composables/useDragAndDrop";
import type { Layer } from "../types";

const vRenameFocus: Directive<HTMLInputElement> = {
  mounted(el) {
    el.focus();
    el.select();
  },
};

const props = defineProps<{
  layers: Layer[];
  selectedId: string | null;
  filter: string;
  renamingId: string | null;
  renameText: string;
  menuOpenId: string | null;
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
  canMoveUp: (id: string) => boolean;
  canMoveDown: (id: string) => boolean;
}>();

const emit = defineEmits<{
  "update:filter": [value: string];
  select: [id: string];
  "toggle-enabled": [id: string];
  "rename-start": [id: string, name: string];
  "rename-commit": [];
  "rename-cancel": [];
  "move-up": [id: string];
  "move-down": [id: string];
  reorder: [id: string, toIndex: number];
  "delete-request": [id: string];
  "menu-open": [id: string, event: MouseEvent];
  "menu-action": [action: string, id: string];
  "menu-close": [];
  create: [];
}>();

const filteredLayers = computed(() => {
  if (!props.filter) return props.layers;
  return props.layers.filter((l) => matchesQuery(l.name, props.filter));
});

const root = useTemplateRef("root");

const dropList = useDropList({
  containerId: "nav-layers",
  accepts: (source) => source.kind === "layer",
  onDrop: (source, index) => emit("reorder", source.key, index),
});
function dragHandleProps(id: string, index: number) {
  return useDragHandle((): DragSource => ({
    kind: "layer",
    containerId: "nav-layers",
    key: id,
    index,
  }));
}

/** Same row-keyboard contract as NavBuilds.vue: ↑/↓ moves selection, Ctrl/Cmd+↑/↓ reorders,
 *  Delete/Backspace requests the parent's two-step delete confirm, F2 starts rename. */
function onRowKeydown(event: KeyboardEvent, id: string, name: string) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const dir = event.key === "ArrowDown" ? 1 : -1;
    if (isMac ? event.metaKey : event.ctrlKey) {
      if (dir === 1) emit("move-down", id);
      else emit("move-up", id);
    } else {
      moveFocus(dir);
    }
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    emit("delete-request", id);
    return;
  }
  if (event.key === "F2") {
    event.preventDefault();
    emit("rename-start", id, name);
  }
}

function moveFocus(dir: 1 | -1) {
  const rows = root.value?.querySelectorAll<HTMLElement>("[data-nav-key]");
  if (!rows?.length) return;
  const current = document.activeElement?.closest("[data-nav-key]");
  const idx = current ? Array.from(rows).indexOf(current as HTMLElement) : -1;
  const next = rows[Math.min(Math.max(idx + dir, 0), rows.length - 1)];
  next.focus();
  emit("select", next.dataset.navKey!);
}
</script>

<template>
  <div ref="root" class="border-t border-line pt-1.5">
    <div class="mb-1 flex items-center justify-between px-1 py-0.5">
      <BaseTooltip
        text="Layers apply bottom to top - a higher layer overrides the ones below it."
      >
        <span
          class="flex items-center gap-1 text-sm font-semibold uppercase text-muted"
        >
          Customization Layers
        </span>
      </BaseTooltip>
    </div>

    <input
      :value="filter"
      type="text"
      placeholder="Filter…"
      data-testid="nav-layers-filter"
      class="mb-1 rounded-md border border-line bg-surface px-2 py-0.5 text-sm focus:outline-accent w-full"
      @input="$emit('update:filter', ($event.target as HTMLInputElement).value)"
    />

    <div class="max-h-48 overflow-y-auto">
      <div
        v-for="(l, i) in filteredLayers"
        :key="l.id"
        class="nav-row nav-row--layer relative flex items-center gap-1 rounded-md py-1 pl-5 pr-1 border-t-2 border-b-2 border-transparent"
        :class="[
          selectedId === l.id && 'is-active bg-accent-soft',
          dropList.indicatorAt(i) === 'before' && '!border-t-accent',
          dropList.indicatorAt(i) === 'after' && '!border-b-accent',
        ]"
        v-bind="dropList.rowProps(i)"
      >
        <BaseTooltip text="Drag to reorder. Ctrl + ↑ or ↓ to move up/down.">
          <span
            data-testid="layer-drag-handle"
            class="cursor-grab text-muted hover:text-accent [&_svg]:size-[14px]"
            v-bind="dragHandleProps(l.id, i)"
          >
            <GripVertical />
          </span>
        </BaseTooltip>

        <div @click.stop>
          <BaseCheckbox
            :model-value="l.enabled"
            @update:model-value="$emit('toggle-enabled', l.id)"
          />
        </div>

        <input
          v-if="renamingId === l.id"
          v-rename-focus
          :value="renameText"
          class="nav-rename min-w-0 flex-1 rounded-md border border-line bg-surface px-1 py-0.5"
          @input="
            $emit(
              'rename-start',
              l.id,
              ($event.target as HTMLInputElement).value,
            )
          "
          @keydown.enter="$emit('rename-commit')"
          @keydown.esc="$emit('rename-cancel')"
          @blur="$emit('rename-commit')"
        />
        <button
          v-else
          type="button"
          class="nav-name min-w-0 flex-1 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap py-0.5 text-left"
          :class="!l.enabled && 'text-muted'"
          :data-nav-key="l.id"
          @click="$emit('select', l.id)"
          @dblclick="$emit('rename-start', l.id, l.name)"
          @contextmenu.prevent="$emit('menu-open', l.id, $event)"
          @keydown="onRowKeydown($event, l.id, l.name)"
        >
          {{ l.name }}
        </button>

        <div class="nav-menu-wrap relative">
          <BaseTooltip text="Layer menu">
            <button
              type="button"
              class="nav-kebab flex-none cursor-pointer rounded-md px-1.5 leading-none text-muted hover:bg-surface-2 hover:text-text"
              aria-label="Layer menu"
              @click="$emit('menu-open', l.id, $event)"
            >
              <EllipsisVertical class="size-[14px]" />
            </button>
          </BaseTooltip>

          <NavContextMenu
            v-if="menuOpenId === l.id"
            :anchor="menuAnchor"
            :items="menuItems"
            :ignore="['.nav-kebab']"
            @action="(a) => $emit('menu-action', a, l.id)"
            @close="$emit('menu-close')"
          />
        </div>
      </div>

      <div class="flex items-center justify-center gap-1 mt-2">
        <BaseButton data-testid="nav-add-layer" @click="$emit('create')"
          ><Plus />New</BaseButton
        >
      </div>
    </div>
  </div>
</template>
