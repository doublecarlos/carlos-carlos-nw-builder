<script setup lang="ts">
// Layer list section inside the left sidebar. Pure presentation.
import { computed, useTemplateRef, type Component, type Directive } from "vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseCheckbox from "./ui/BaseCheckbox.vue";
import IconButton from "./ui/IconButton.vue";
import {
  ArrowDown,
  ArrowUp,
  EllipsisVertical,
  Plus,
  Upload,
} from "@lucide/vue";
import NavContextMenu from "./NavContextMenu.vue";
import { isMac } from "../lib/platform";
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
  "delete-request": [id: string];
  "menu-open": [id: string, event: MouseEvent];
  "menu-action": [action: string, id: string];
  "menu-close": [];
  create: [];
  import: [];
}>();

const filteredLayers = computed(() => {
  if (!props.filter) return props.layers;
  const q = props.filter.toLowerCase();
  return props.layers.filter((l) => l.name.toLowerCase().includes(q));
});

const root = useTemplateRef("root");

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
      <span
        class="flex items-center gap-1 text-xs font-semibold uppercase text-muted"
        title="Layers apply top to bottom — a lower layer overrides the ones above it."
      >
        Layers
      </span>
      <div class="flex items-center gap-1">
        <BaseButton @click="$emit('import')"><Upload />Import</BaseButton>
        <BaseButton data-testid="nav-add-layer" @click="$emit('create')"
          ><Plus />New</BaseButton
        >
      </div>
    </div>

    <p class="mb-1 px-1 text-[11px] text-muted">
      ↑/↓ select · F2 rename · Delete remove
    </p>

    <input
      :value="filter"
      type="text"
      placeholder="Filter…"
      class="mb-1 rounded-md border border-line bg-surface px-2 py-0.5 text-xs focus:outline-accent w-full"
      @input="$emit('update:filter', ($event.target as HTMLInputElement).value)"
    />

    <div class="max-h-48 overflow-y-auto">
      <div
        v-for="l in filteredLayers"
        :key="l.id"
        class="nav-row nav-row--layer relative flex items-center gap-1 rounded-md py-1 pl-5 pr-1"
        :class="selectedId === l.id && 'is-active bg-accent-soft'"
      >
        <IconButton
          title="Move up (Ctrl+↑)"
          data-testid="move-up"
          :disabled="!canMoveUp(l.id)"
          @click="$emit('move-up', l.id)"
        >
          <ArrowUp />
        </IconButton>
        <IconButton
          title="Move down (Ctrl+↓)"
          data-testid="move-down"
          :disabled="!canMoveDown(l.id)"
          @click="$emit('move-down', l.id)"
        >
          <ArrowDown />
        </IconButton>

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
          <button
            type="button"
            class="nav-kebab flex-none cursor-pointer rounded-md px-1.5 leading-none text-muted hover:bg-surface-2 hover:text-text"
            title="Layer menu"
            @click="$emit('menu-open', l.id, $event)"
          >
            <EllipsisVertical class="size-[14px]" />
          </button>

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
    </div>
  </div>
</template>
