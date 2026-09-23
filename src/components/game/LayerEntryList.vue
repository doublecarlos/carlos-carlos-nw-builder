<script setup lang="ts">
// The layer editor's flat left pane for the Items, Bonuses and Filters tabs: name-sorted rows
// with create/select/restore. The Slots tab uses LayerSlotOutline.vue instead.
//
// Owns the keyboard cursor; the parent owns what "select" does (routing, section state).
import { computed } from "vue";
import { onKeyStroke } from "@vueuse/core";
import { CirclePlus, RotateCcw } from "@lucide/vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseBadge from "../ui/BaseBadge.vue";
import BaseTooltip from "../ui/BaseTooltip.vue";
import LayerListHeader from "./LayerListHeader.vue";
import type { Item, Bonus, FilterDef } from "../../types";
import type { EntryStatus } from "../../data/catalog";

export interface ItemRow {
  key: string;
  name: string;
  filter: string;
  item: Item | null;
  status: EntryStatus;
  kind: "item";
}
export interface BonusRow {
  key: string;
  name: string;
  filter: string;
  bonus: Bonus | null;
  status: EntryStatus;
  kind: "bonus";
}
/** One item category. `def` is null for an undeclared category. */
export interface FilterRow {
  key: string;
  name: string;
  /** The secondary column: how many items carry this category. */
  filter: string;
  def: FilterDef | null;
  status: EntryStatus;
  kind: "filter";
}
export type EditorRow = ItemRow | BonusRow | FilterRow;

const props = defineProps<{
  /** Already filtered by query/status; this component only renders and navigates them. */
  rows: EditorRow[];
  section: string; // items | bonuses | filters
  selectedKey: string | null;
  statusFilterOptions: { value: string; label: string }[];
  hasUnsavedDraft: (row: EditorRow) => boolean;
}>();

/** The header text for each overlay group the list serves. */
interface SectionChrome {
  createLabel: string;
  createTestId: string;
  searchPlaceholder: string;
}
const CHROME: Record<string, SectionChrome> = {
  items: {
    createLabel: "New item",
    createTestId: "new-item",
    searchPlaceholder: "Filter items…",
  },
  bonuses: {
    createLabel: "New bonus",
    createTestId: "new-bonus",
    searchPlaceholder: "Filter bonuses…",
  },
  filters: {
    createLabel: "New filter",
    createTestId: "new-filter",
    searchPlaceholder: "Filter categories…",
  },
};
const chrome = computed(() => CHROME[props.section] ?? CHROME.items);

const emit = defineEmits<{
  select: [row: EditorRow, options?: { push?: boolean }];
  create: [];
  restore: [row: EditorRow];
}>();

const query = defineModel<string>("query", { required: true });
const statusFilter = defineModel<string>("statusFilter", { required: true });

function onRowClick(row: EditorRow) {
  if (row.status === "removed") return;
  emit("select", row);
}

/**
 * ArrowUp/Down drive the list from either the search box (kept focused, command-palette
 * style -- typing still filters normally) or a focused row. The current section's selected
 * key doubles as the keyboard cursor: the existing click UX has no separate "highlighted
 * but not open" state, so keyboard nav matches it exactly rather than inventing one.
 * Guarded to the search input or an `.editor-row` so the status ComboBox's own dropdown
 * keeps its arrows.
 */
onKeyStroke(["ArrowDown", "ArrowUp", "Enter"], (event) => {
  const target = event.target as HTMLElement;
  const isSearch = target.matches?.('input[type="search"]');
  const isRow = target.closest?.(".editor-row");
  if (!isSearch && !isRow) return;
  const rowsList = props.rows;
  if (!rowsList.length) return;
  event.preventDefault();
  const idx = rowsList.findIndex((row) => row.key === props.selectedKey);
  if (event.key === "Enter") {
    if (idx !== -1) emit("select", rowsList[idx]);
    return;
  }
  const dir = event.key === "ArrowDown" ? 1 : -1;
  const next =
    idx === -1
      ? dir === 1
        ? 0
        : rowsList.length - 1
      : Math.min(Math.max(idx + dir, 0), rowsList.length - 1);
  emit("select", rowsList[next], { push: false });
});
</script>

<template>
  <div class="flex min-h-0 flex-col rounded-md border border-line bg-surface">
    <LayerListHeader
      v-model:query="query"
      v-model:status-filter="statusFilter"
      :search-placeholder="chrome.searchPlaceholder"
      :status-filter-options="statusFilterOptions"
    >
      <template #create>
        <BaseButton
          class="flex-1 text-center justify-center"
          variant="primary"
          :data-testid="chrome.createTestId"
          @click="emit('create')"
          ><CirclePlus />{{ chrome.createLabel }}</BaseButton
        >
      </template>
    </LayerListHeader>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div
        v-for="row in rows"
        :key="row.key"
        tabindex="0"
        class="editor-row flex cursor-pointer items-center gap-1.5 border-b border-line/45 px-2 py-1 hover:bg-surface-2"
        :class="row.key === selectedKey && 'is-on bg-accent-soft'"
        @click="onRowClick(row)"
      >
        <span class="editor-row-name min-w-0 flex-1 truncate">{{
          row.name
        }}</span>
        <BaseBadge v-if="row.status !== 'base'" :variant="row.status">{{
          row.status
        }}</BaseBadge>
        <BaseTooltip text="Unsaved edits in the form">
          <BaseBadge v-if="hasUnsavedDraft(row)" variant="unsaved"
            >unsaved</BaseBadge
          >
        </BaseTooltip>
        <BaseButton
          v-if="row.status === 'removed'"
          variant="ghost"
          @click.stop="emit('restore', row)"
          ><RotateCcw />restore</BaseButton
        >
        <span v-else class="text-muted">{{ row.filter }}</span>
      </div>
      <p v-if="!rows.length" class="p-2 text-muted">Nothing matches.</p>
    </div>
  </div>
</template>
