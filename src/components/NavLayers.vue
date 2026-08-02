<script setup lang="ts">
// Layer list section inside the left sidebar. Pure presentation.
import { computed, type Component, type Directive } from "vue";
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

defineEmits<{
  "update:filter": [value: string];
  select: [id: string];
  "toggle-enabled": [id: string];
  "rename-start": [id: string, name: string];
  "rename-commit": [];
  "rename-cancel": [];
  "move-up": [id: string];
  "move-down": [id: string];
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
</script>

<template>
  <div class="border-t border-line pt-1.5">
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
          title="Move up"
          data-testid="move-up"
          :disabled="!canMoveUp(l.id)"
          @click="$emit('move-up', l.id)"
        >
          <ArrowUp />
        </IconButton>
        <IconButton
          title="Move down"
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
          @click="$emit('select', l.id)"
          @dblclick="$emit('rename-start', l.id, l.name)"
          @contextmenu.prevent="$emit('menu-open', l.id, $event)"
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
            <EllipsisVertical class="size-3.5" />
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
