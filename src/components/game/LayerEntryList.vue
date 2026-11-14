<script setup lang="ts">
// The layer editor's flat left pane for the Items, Bonuses and Vocabulary tabs: name-sorted
// rows with create/select/restore, under a heading per group when a tab hosts several. The
// Slots tab uses LayerSlotOutline.vue instead.
//
// Owns the keyboard cursor; the parent owns what "select" does (routing, section state).
import { computed, useTemplateRef } from "vue";
import { onKeyStroke } from "@vueuse/core";
import { useListScroll } from "../../composables/useListScroll";
import { CirclePlus, RotateCcw } from "@lucide/vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseBadge from "../ui/BaseBadge.vue";
import BaseMenu from "../ui/BaseMenu.vue";
import BaseMenuItem from "../ui/BaseMenuItem.vue";
import BaseTooltip from "../ui/BaseTooltip.vue";
import OptionRow from "../ui/OptionRow.vue";
import ItemListFilters from "./ItemListFilters.vue";
import LayerListHeader from "./LayerListHeader.vue";
import type { Item, Bonus, FilterDef, TagDef } from "../../types";
import type { EntryStatus } from "../../data/catalog";
import { toneStyle } from "../../lib/item-quality";
import {
  defaultItemListFilter,
  isItemListFilterActive,
  type ItemListFilter,
} from "../../lib/item-list-filter";

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
/** One item tag. `def` is null for a tag in use with no declaration. */
export interface TagRow {
  key: string;
  name: string;
  /** The secondary column: how many items carry this tag. */
  filter: string;
  def: TagDef | null;
  status: EntryStatus;
  kind: "tag";
}
export type EditorRow = ItemRow | BonusRow | FilterRow | TagRow;
export type EditorRowKind = EditorRow["kind"];

const props = defineProps<{
  /** Already filtered by query, status and `itemFilter`; this component only renders and
   *  navigates them. */
  rows: EditorRow[];
  section: string; // items | bonuses | vocabulary
  selectedKey: string | null;
  /** The kind of the selected row, since two groups in one list can share an id. */
  selectedKind: EditorRowKind | null;
  statusFilterOptions: { value: string; label: string }[];
  hasUnsavedDraft: (row: EditorRow) => boolean;
  /** The Items tab's category choices. */
  categories: string[];
  /** Names this list's remembered scroll position, per layer and tab. */
  scrollKey: string;
}>();

const scroller = useTemplateRef<HTMLElement>("scroller");
const { focusCurrent } = useListScroll(
  scroller,
  () => props.scrollKey,
  () => `${props.selectedKind}:${props.selectedKey}`,
);

defineExpose({ focusCurrent });

/** The header text for each overlay group the list serves. */
interface SectionChrome {
  createLabel: string;
  createTestId: string;
  searchPlaceholder: string;
  /** For a tab hosting several groups: a heading per group, and a "New" menu entry each. */
  groups?: { kind: EditorRowKind; heading: string; createLabel: string }[];
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
  vocabulary: {
    createLabel: "New",
    createTestId: "new-vocabulary-entry",
    searchPlaceholder: "Filter the vocabulary…",
    groups: [
      { kind: "filter", heading: "Filters", createLabel: "New filter" },
      { kind: "tag", heading: "Tags", createLabel: "New tag" },
    ],
  },
};
const chrome = computed(() => CHROME[props.section] ?? CHROME.items);

/** The heading drawn above `index`, where a new group's rows start. */
function headingAt(index: number): string | null {
  const row = props.rows[index];
  if (index > 0 && props.rows[index - 1].kind === row.kind) return null;
  return (
    chrome.value.groups?.find((group) => group.kind === row.kind)?.heading ??
    null
  );
}

const isSelected = (row: EditorRow) =>
  row.kind === props.selectedKind && row.key === props.selectedKey;

const menu = useTemplateRef<InstanceType<typeof BaseMenu>>("menu");

function createKind(kind: EditorRowKind) {
  menu.value?.close();
  emit("create", kind);
}

const emit = defineEmits<{
  select: [row: EditorRow, options?: { transient?: boolean }];
  /** A new entry: of `kind` from a multi-group tab's menu, else of the tab's only group. */
  create: [kind?: EditorRowKind];
  restore: [row: EditorRow];
}>();

const query = defineModel<string>("query", { required: true });
const statusFilter = defineModel<string>("statusFilter", { required: true });
const itemFilter = defineModel<ItemListFilter>("itemFilter", {
  required: true,
});

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
  const idx = rowsList.findIndex(isSelected);
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
  emit("select", rowsList[next], { transient: true });
});
</script>

<template>
  <div class="flex min-h-0 flex-col rounded-md border border-line bg-surface">
    <LayerListHeader
      v-model:query="query"
      v-model:status-filter="statusFilter"
      :search-placeholder="chrome.searchPlaceholder"
      :status-filter-options="statusFilterOptions"
      :extra-filters-active="
        section === 'items' && isItemListFilterActive(itemFilter)
      "
      @clear="itemFilter = defaultItemListFilter()"
    >
      <template v-if="section === 'items'" #filters>
        <ItemListFilters v-model="itemFilter" :categories="categories" />
      </template>
      <template #create>
        <BaseMenu
          v-if="chrome.groups"
          ref="menu"
          fit-content
          align="left"
          :label="chrome.createLabel"
          panel-class="flex min-w-40 flex-col gap-0.5 p-1"
          :ignore="['.new-entry-menu']"
        >
          <template #trigger="{ toggle, attrs }">
            <BaseButton
              class="new-entry-menu flex-none justify-center"
              variant="primary"
              :data-testid="chrome.createTestId"
              v-bind="attrs"
              @click="toggle"
              ><CirclePlus />{{ chrome.createLabel }}</BaseButton
            >
          </template>
          <BaseMenuItem
            v-for="group in chrome.groups"
            :key="group.kind"
            :icon="CirclePlus"
            :data-testid="`new-${group.kind}`"
            @click="createKind(group.kind)"
            >{{ group.createLabel }}</BaseMenuItem
          >
        </BaseMenu>
        <BaseButton
          v-else
          class="flex-none justify-center"
          variant="primary"
          :data-testid="chrome.createTestId"
          @click="emit('create')"
          ><CirclePlus />{{ chrome.createLabel }}</BaseButton
        >
      </template>
    </LayerListHeader>
    <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto">
      <template v-for="(row, index) in rows" :key="`${row.kind}:${row.key}`">
        <div
          v-if="headingAt(index)"
          class="border-b border-line bg-surface-2 px-2 py-1 font-semibold"
          :data-testid="`entry-heading-${row.kind}`"
        >
          {{ headingAt(index) }}
        </div>
        <div
          tabindex="0"
          class="editor-row flex cursor-pointer items-center gap-1.5 border-b border-line/45 px-2 py-1 hover:bg-surface-2"
          :class="isSelected(row) && 'is-on bg-accent-soft'"
          :aria-current="isSelected(row) ? 'true' : undefined"
          :data-kind="row.kind"
          @click="onRowClick(row)"
        >
          <OptionRow
            v-if="row.kind === 'filter' || row.kind === 'tag'"
            class="editor-row-name flex-1"
            :option="{ value: row.name, label: row.def?.label || row.name }"
          />
          <span
            v-else
            class="editor-row-name min-w-0 flex-1 truncate text-(--tone)"
            :style="
              row.kind === 'item' ? toneStyle(row.item?.quality) : undefined
            "
            >{{ row.name }}</span
          >
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
      </template>
      <p v-if="!rows.length" class="p-2 text-muted">Nothing matches.</p>
    </div>
  </div>
</template>
