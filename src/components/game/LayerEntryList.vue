<script setup lang="ts">
// LayerEditor's left panel: search/status-filter the current section's rows, create a new
// entry, and browse/select/restore existing ones. Owns its own keyboard cursor (arrow keys
// from the search box or a focused row) since that only ever needs this list's own rows and
// selection -- the parent still owns what "select" actually does (routing, section state).
import { computed } from "vue";
import { onKeyStroke } from "@vueuse/core";
import { CirclePlus, FilterX, RotateCcw } from "@lucide/vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseBadge from "../ui/BaseBadge.vue";
import BaseTooltip from "../ui/BaseTooltip.vue";
import ComboBox from "../ui/ComboBox.vue";
import type {
  Item,
  Bonus,
  SectionPreset,
  BuildParameterSlot,
} from "../../types";

export interface ItemRow {
  key: string;
  name: string;
  filter: string;
  item: Item | null;
  status: string;
  kind: "item";
}
export interface BonusRow {
  key: string;
  name: string;
  filter: string;
  bonus: Bonus | null;
  status: string;
  kind: "bonus";
}
export interface PresetRow {
  key: string;
  name: string;
  filter: string;
  preset: SectionPreset | null;
  status: string;
  kind: "sectionPreset";
}
export interface SlotRow {
  key: string;
  name: string;
  filter: string;
  slot: BuildParameterSlot | null;
  status: string;
  kind: "slot";
}
export type EditorRow = ItemRow | BonusRow | PresetRow | SlotRow;

const props = defineProps<{
  /** Already filtered by query/status -- this component only renders and navigates them. */
  rows: EditorRow[];
  section: string; // items | bonuses | sectionPresets | slots
  selectedKey: string | null;
  statusFilterOptions: { value: string; label: string }[];
  hasUnsavedDraft: (row: EditorRow) => boolean;
}>();

const CREATE_LABEL: Record<string, string> = {
  bonuses: "New bonus",
  sectionPresets: "New preset",
  slots: "New parameter",
  items: "New item",
};
const SEARCH_PLACEHOLDER: Record<string, string> = {
  bonuses: "Filter bonuses…",
  sectionPresets: "Filter presets…",
  slots: "Filter parameters…",
  items: "Filter items…",
};
const CREATE_TESTID: Record<string, string> = {
  bonuses: "new-bonus",
  sectionPresets: "new-preset",
  slots: "new-slot",
  items: "new-item",
};
const createLabel = computed(
  () => CREATE_LABEL[props.section] ?? CREATE_LABEL.items,
);
const createTestId = computed(
  () => CREATE_TESTID[props.section] ?? CREATE_TESTID.items,
);
const searchPlaceholder = computed(
  () => SEARCH_PLACEHOLDER[props.section] ?? SEARCH_PLACEHOLDER.items,
);

const emit = defineEmits<{
  select: [row: EditorRow, options?: { push?: boolean }];
  create: [];
  restore: [row: EditorRow];
}>();

const query = defineModel<string>("query", { required: true });
const statusFilter = defineModel<string>("statusFilter", { required: true });

function clearFilters() {
  query.value = "";
  statusFilter.value = "all";
}

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
    <div class="flex items-center gap-1 p-2">
      <input
        v-model="query"
        type="search"
        class="editor-search w-full min-w-0 rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
        :placeholder="searchPlaceholder"
      />
    </div>
    <div class="flex flex-none gap-1.5 px-2">
      <ComboBox
        class="w-full"
        :model-value="statusFilter"
        :options="statusFilterOptions"
        @update:model-value="(v) => (statusFilter = v)"
      />
    </div>
    <div class="flex flex-none gap-1.5 border-b border-line px-2 py-2">
      <BaseButton
        :disabled="!(query || statusFilter !== 'all')"
        class="flex-1 text-center justify-center"
        @click="clearFilters"
        ><FilterX />clear filters</BaseButton
      >
      <BaseButton
        class="flex-1 text-center justify-center"
        variant="primary"
        :data-testid="createTestId"
        @click="emit('create')"
        ><CirclePlus />{{ createLabel }}</BaseButton
      >
    </div>
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
        <BaseBadge v-if="row.status !== 'base'" :variant="row.status as any">{{
          row.status
        }}</BaseBadge>
        <BaseTooltip text="Unsaved edits in the form">
          <BaseBadge v-if="hasUnsavedDraft(row)" variant="unsaved"
            >unsaved</BaseBadge
          >
        </BaseTooltip>
        <BaseButton
          v-if="row.status === 'removed'"
          variant="link"
          @click.stop="emit('restore', row)"
          ><RotateCcw />restore</BaseButton
        >
        <span v-else class="text-muted">{{ row.filter }}</span>
      </div>
      <p v-if="!rows.length" class="p-2 text-muted">Nothing matches.</p>
    </div>
  </div>
</template>
