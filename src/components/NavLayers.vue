<script setup lang="ts">
// Layer list section inside the left sidebar. Pure presentation.
import { computed, useTemplateRef, type Component } from "vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseTooltip from "./ui/BaseTooltip.vue";
import BaseCheckbox from "./ui/BaseCheckbox.vue";
import BaseInput from "./ui/BaseInput.vue";
import { Plus } from "@lucide/vue";

import NavRow from "./NavRow.vue";
import DropIndicator from "./ui/DropIndicator.vue";

import { matchesQuery } from "../lib/text-filter";
import {
  useDragHandle,
  useDropList,
  type DragSource,
} from "../composables/useDragAndDrop";
import type { Layer } from "../types";

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
  "delete-request": [id: string, skipConfirm: boolean];
  "menu-open": [id: string, event: MouseEvent];
  "menu-action": [action: string, id: string, skipConfirm: boolean];
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
        text="Layers apply bottom to top; a higher layer overrides the ones below it."
      >
        <span
          class="flex items-center gap-1 text-sm font-semibold uppercase text-muted"
        >
          Customization Layers
        </span>
      </BaseTooltip>
    </div>

    <BaseInput
      :model-value="filter"
      type="text"
      placeholder="Filter…"
      data-testid="nav-layers-filter"
      class="mb-1 w-full"
      @update:model-value="$emit('update:filter', String($event))"
    />

    <div
      v-bind="dropList.listProps()"
      class="relative max-h-48 overflow-y-auto pb-2"
    >
      <DropIndicator :pos="dropList.separatorStyle.value" />

      <NavRow
        v-for="(l, i) in filteredLayers"
        :id="l.id"
        :key="l.id"
        :name="l.name"
        kind="layer"
        :active="selectedId === l.id"
        :renaming="renamingId === l.id"
        :rename-text="renameText"
        :menu-open="menuOpenId === l.id"
        :menu-items="menuOpenId === l.id ? menuItems : []"
        :menu-anchor="menuAnchor"
        :handle-props="dragHandleProps(l.id, i)"
        :row-props="dropList.rowProps(i)"
        :is-drop-into="false"
        :nested="false"
        :disabled="!l.enabled"
        @select="(id) => $emit('select', id)"
        @rename-start="(id, name) => $emit('rename-start', id, name)"
        @rename-commit="$emit('rename-commit')"
        @rename-cancel="$emit('rename-cancel')"
        @move-up="(id) => $emit('move-up', id)"
        @move-down="(id) => $emit('move-down', id)"
        @focus-move="moveFocus"
        @delete-request="(id, skip) => $emit('delete-request', id, skip)"
        @menu-open="(id, ev) => $emit('menu-open', id, ev)"
        @menu-action="(a, id, skip) => $emit('menu-action', a, id, skip)"
        @menu-close="$emit('menu-close')"
      >
        <template #before>
          <div @click.stop>
            <BaseCheckbox
              :model-value="l.enabled"
              @update:model-value="$emit('toggle-enabled', l.id)"
            />
          </div>
        </template>
      </NavRow>
    </div>

    <div class="flex items-center justify-center gap-1 mt-2">
      <BaseButton data-testid="nav-add-layer" @click="$emit('create')"
        ><Plus />New</BaseButton
      >
    </div>
  </div>
</template>
