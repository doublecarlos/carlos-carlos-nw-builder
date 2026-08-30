<script setup lang="ts">
// Recently-deleted section inside the left sidebar. Pure presentation.
import NavContextMenu from "./NavContextMenu.vue";
import BaseTooltip from "./ui/BaseTooltip.vue";
import {
  ChevronDown,
  ChevronRight,
  EllipsisVertical,
  RotateCcw,
} from "@lucide/vue";
import type { Component } from "vue";
import type { TrashEntry } from "../types";

defineProps<{
  entries: TrashEntry[];
  expanded: boolean;
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
  timeAgo: (ms: number) => string;
}>();

defineEmits<{
  "toggle-expand": [];
  restore: [entry: TrashEntry];
  "menu-open": [id: string, event: MouseEvent];
  "menu-action": [action: string, id: string];
  "menu-close": [];
}>();
</script>

<template>
  <div v-if="entries.length" class="border-t border-line pt-1.5">
    <div
      class="flex cursor-pointer select-none items-center justify-between px-1 py-0.5"
      @click="$emit('toggle-expand')"
    >
      <span
        class="inline-flex items-center gap-1 text-sm font-semibold uppercase text-muted"
      >
        <ChevronDown v-if="expanded" class="size-[14px]" />
        <ChevronRight v-else class="size-[14px]" />
        Recently deleted ({{ entries.length }})
      </span>
    </div>

    <div v-if="expanded" class="overflow-y-auto">
      <div
        v-for="entry in entries"
        :key="`${entry.kind}_${entry.item.id}_${entry.deletedAt}`"
        class="nav-row relative flex items-center gap-1 rounded-md py-1 pl-5 pr-1"
      >
        <span
          class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-muted"
        >
          <span class="text-[10px] uppercase">{{
            entry.kind === "build" ? "B" : "L"
          }}</span>
          {{ entry.item.name }}
          <span class="text-[10px]">- {{ timeAgo(entry.deletedAt) }}</span>
        </span>

        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-sm text-accent hover:bg-accent-soft"
          @click="$emit('restore', entry)"
        >
          <RotateCcw class="size-[14px]" />
          Restore
        </button>
        <div class="nav-menu-wrap relative flex items-center">
          <BaseTooltip text="Trash menu">
            <button
              type="button"
              class="nav-kebab flex flex-none cursor-pointer items-center rounded-md px-1.5 py-1 text-muted hover:bg-surface-2 hover:text-text"
              aria-label="Trash menu"
              @click="
                $emit('menu-open', `${entry.kind}_${entry.item.id}`, $event)
              "
            >
              <EllipsisVertical class="size-[14px]" />
            </button>
          </BaseTooltip>

          <NavContextMenu
            v-if="menuOpenId === `${entry.kind}_${entry.item.id}`"
            :anchor="menuAnchor"
            :items="menuItems"
            :ignore="['.nav-kebab']"
            @action="
              (a) => $emit('menu-action', a, `${entry.kind}_${entry.item.id}`)
            "
            @close="$emit('menu-close')"
          />
        </div>
      </div>
      <p class="px-1 py-0.5 text-[10px] text-muted">
        Entries clear themselves after 7 days.
      </p>
    </div>
  </div>
</template>
