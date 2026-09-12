<script setup lang="ts">
// Presentation row for a single build, delegates to NavRow with kind="build".
import NavRow from "./NavRow.vue";
import type { Build } from "../types";
import type { DragHandleProps } from "../composables/useDragAndDrop";
import type { Component } from "vue";

defineProps<{
  build: Build;
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
  rowProps: Record<string, string | undefined>;
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
  "delete-request": [id: string, skipConfirm: boolean];
  "menu-open": [id: string, event: MouseEvent];
  "menu-action": [action: string, id: string, skipConfirm: boolean];
  "menu-close": [];
}>();
</script>

<template>
  <NavRow
    :id="build.id"
    :name="build.name"
    kind="build"
    :active="active"
    :renaming="renaming"
    :rename-text="renameText"
    :menu-open="menuOpen"
    :menu-items="menuItems"
    :menu-anchor="menuAnchor"
    :handle-props="handleProps"
    :row-props="rowProps"
    :is-drop-into="false"
    :nested="nested"
    @select="(id) => emit('select', id)"
    @rename-start="(id, name) => emit('rename-start', id, name)"
    @rename-commit="emit('rename-commit')"
    @rename-cancel="emit('rename-cancel')"
    @move-up="(id) => emit('move-up', id)"
    @move-down="(id) => emit('move-down', id)"
    @focus-move="(dir) => emit('focus-move', dir)"
    @delete-request="(id, skip) => emit('delete-request', id, skip)"
    @menu-open="(id, ev) => emit('menu-open', id, ev)"
    @menu-action="(a, id, skip) => emit('menu-action', a, id, skip)"
    @menu-close="emit('menu-close')"
  />
</template>
