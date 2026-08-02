<script setup lang="ts">
// Build list section inside the left sidebar. Pure presentation — actions, menu items,
// and rename state are provided by the parent (Nav.vue).
import { computed, type Directive } from "vue";
import BaseButton from "./ui/BaseButton.vue";
import IconButton from "./ui/IconButton.vue";
import NavContextMenu from "./NavContextMenu.vue";
import type { Build } from "../types";

const vRenameFocus: Directive<HTMLInputElement> = {
  mounted(el) {
    el.focus();
    el.select();
  },
};

const props = defineProps<{
  builds: Build[];
  selectedId: string | null;
  filter: string;
  /** Which build is being renamed (id), or null. */
  renamingId: string | null;
  renameText: string;
  /** Menu items for the open menu, position, and which build's menu is open. */
  menuOpenId: string | null;
  menuItems: {
    action: string;
    label: string;
    danger?: boolean;
    disabled?: boolean;
  }[];
  /** Bounding rect of the row that opened the menu, for popover anchoring. */
  menuAnchor: DOMRect | null;
  /** Index helpers for Move up/down disabled state. */
  canMoveUp: (id: string) => boolean;
  canMoveDown: (id: string) => boolean;
}>();

defineEmits<{
  "update:filter": [value: string];
  select: [id: string];
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

const filteredBuilds = computed(() => {
  if (!props.filter) return props.builds;
  const q = props.filter.toLowerCase();
  return props.builds.filter((b) => b.name.toLowerCase().includes(q));
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="mb-1 flex items-center justify-between px-1 py-0.5">
      <span class="text-xs font-semibold uppercase text-muted">Builds</span>
      <div class="flex items-center gap-1">
        <BaseButton variant="link" @click="$emit('import')">Import</BaseButton>
        <BaseButton variant="link" @click="$emit('create')">+ New</BaseButton>
      </div>
    </div>

    <input
      :value="filter"
      type="text"
      placeholder="Filter…"
      class="mb-1 rounded-md border border-line bg-surface px-2 py-0.5 text-xs focus:outline-accent"
      @input="$emit('update:filter', ($event.target as HTMLInputElement).value)"
    />

    <div class="flex-1 overflow-y-auto">
      <div
        v-for="b in filteredBuilds"
        :key="b.id"
        class="nav-row nav-row--build relative flex items-center gap-1 rounded-md py-1 pl-5 pr-1"
        :class="selectedId === b.id && 'is-active bg-accent-soft'"
      >
        <IconButton
          icon="arrow-up"
          title="Move up"
          data-testid="move-up"
          :disabled="!canMoveUp(b.id)"
          @click="$emit('move-up', b.id)"
        />
        <IconButton
          icon="arrow-down"
          title="Move down"
          data-testid="move-down"
          :disabled="!canMoveDown(b.id)"
          @click="$emit('move-down', b.id)"
        />

        <input
          v-if="renamingId === b.id"
          v-rename-focus
          :value="renameText"
          class="nav-rename min-w-0 flex-1 rounded-md border border-line bg-surface px-1 py-0.5"
          @input="
            $emit(
              'rename-start',
              b.id,
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
          @click="$emit('select', b.id)"
          @dblclick="$emit('rename-start', b.id, b.name)"
          @contextmenu.prevent="$emit('menu-open', b.id, $event)"
        >
          {{ b.name }}
        </button>

        <div class="nav-menu-wrap relative">
          <button
            type="button"
            class="nav-kebab flex-none cursor-pointer rounded-md px-1.5 leading-none text-muted hover:bg-surface-2 hover:text-text"
            title="Build menu"
            @click="$emit('menu-open', b.id, $event)"
          >
            ⋮
          </button>

          <NavContextMenu
            v-if="menuOpenId === b.id"
            :anchor="menuAnchor"
            :items="menuItems"
            :ignore="['.nav-kebab']"
            @action="(a) => $emit('menu-action', a, b.id)"
            @close="$emit('menu-close')"
          />
        </div>
      </div>
    </div>
  </div>
</template>
