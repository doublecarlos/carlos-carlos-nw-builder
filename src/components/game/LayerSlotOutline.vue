<script setup lang="ts">
// The Slots tab's left pane: the composed layout as an ordered tree, one group per section with
// its slots in render order and its presets underneath. The tree is built by
// lib/slot-outline.ts; this file owns markup, the keyboard cursor and reordering.
//
// Drag and drop and the move up/down buttons both emit `move` with an absolute destination,
// resolved against the composed layout rather than the possibly filtered tree. The buttons
// show on the selected row only, to keep the narrow rail readable.
import { computed, useTemplateRef } from "vue";
import { onKeyStroke } from "@vueuse/core";
import {
  ArrowDown,
  ArrowUp,
  CirclePlus,
  RotateCcw,
  SquarePlus,
} from "@lucide/vue";
import BaseBadge from "../ui/BaseBadge.vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseMenu from "../ui/BaseMenu.vue";
import BaseMenuItem from "../ui/BaseMenuItem.vue";
import BaseTooltip from "../ui/BaseTooltip.vue";
import DragHandle from "../ui/DragHandle.vue";
import DropIndicator from "../ui/DropIndicator.vue";
import IconButton from "../ui/IconButton.vue";
import LayerListHeader from "./LayerListHeader.vue";
import {
  dragSource,
  reorderIndex,
  useDragHandle,
  useDropList,
  type DragSource,
} from "../../composables/useDragAndDrop";
import {
  buildOutline,
  filterOutline,
  outlineRows,
  type OutlineGroup,
  type OutlineKind,
  type OutlineMove,
  type OutlineRow,
} from "../../lib/slot-outline";
import type { CatalogOverlay, Db } from "../../types";

const SECTION_KIND = "outline-section";
const SLOT_KIND = "outline-slot";
const SECTIONS_CONTAINER = "outline-sections";
const slotsContainerId = (sectionId: string) => `outline-slots:${sectionId}`;

const props = defineProps<{
  db: Db;
  overlay: CatalogOverlay;
  /** The kind the Slots tab has open, or null for a blank draft. */
  selected: { kind: OutlineKind; key: string } | null;
  statusFilterOptions: { value: string; label: string }[];
  hasUnsavedDraft: (row: OutlineRow) => boolean;
}>();

const emit = defineEmits<{
  select: [row: OutlineRow, options?: { push?: boolean }];
  /** The section to add to; absent for "New section". */
  create: [payload: { kind: OutlineKind; sectionId: string }];
  restore: [row: OutlineRow];
  /** One reordering, as an absolute destination in the composed layout. */
  move: [move: OutlineMove];
}>();

const query = defineModel<string>("query", { required: true });
const statusFilter = defineModel<string>("statusFilter", { required: true });

const menu = useTemplateRef<InstanceType<typeof BaseMenu>>("menu");

const groups = computed<OutlineGroup[]>(() =>
  filterOutline(buildOutline(props.db, props.overlay), {
    query: query.value,
    status: statusFilter.value,
  }),
);

const rows = computed(() => outlineRows(groups.value));

const isSelected = (row: OutlineRow) =>
  props.selected?.kind === row.kind && props.selected.key === row.key;

/** Each section's index in the composed order, to disable the move buttons at either end. */
const sectionOrder = computed(() =>
  props.db.sections.map((section) => section.id),
);

/** How many slots each section holds in the composed layout. */
const sectionSizes = computed(() => {
  const counts = new Map<string, number>();
  for (const slot of props.db.authoredSlots)
    counts.set(slot.section, (counts.get(slot.section) ?? 0) + 1);
  return counts;
});

/** Each slot's index within its section, and that section's size. */
const slotPlaces = computed(() => {
  const places = new Map<string, { index: number; count: number }>();
  const seen = new Map<string, number>();
  for (const slot of props.db.authoredSlots) {
    const index = seen.get(slot.section) ?? 0;
    seen.set(slot.section, index + 1);
    places.set(slot.id, {
      index,
      count: sectionSizes.value.get(slot.section) ?? 0,
    });
  }
  return places;
});

// --- drag and drop ------------------------------------------------------------------------
// Two nested levels of drop list: one for sections, and one per section for its slots. A
// section dragged over an inner list falls through to the outer one. A slot can also be
// dropped onto a section header to append it, which is how an empty section is reached.

const draggingSlot = computed(() => dragSource.value?.kind === SLOT_KIND);

const sectionsDrop = useDropList({
  containerId: SECTIONS_CONTAINER,
  accepts: (source) =>
    source.kind === SECTION_KIND || source.kind === SLOT_KIND,
  onDrop: (source, index, zone) => {
    if (source.kind === SLOT_KIND) {
      // A slot can only drop onto a header, not between sections.
      const sectionId = zone === "into" ? sectionOrder.value[index] : undefined;
      if (sectionId)
        emit("move", {
          kind: "slot",
          key: source.key,
          sectionId,
          index: sectionSizes.value.get(sectionId) ?? 0,
        });
      return;
    }
    emit("move", {
      kind: "section",
      key: source.key,
      index: reorderIndex(source.index, index),
    });
  },
});

// One drop list per section, cached by id so a render doesn't rebuild its computeds.
const slotDrops = new Map<string, ReturnType<typeof useDropList>>();
function slotsDrop(sectionId: string) {
  let list = slotDrops.get(sectionId);
  if (!list) {
    const containerId = slotsContainerId(sectionId);
    list = useDropList({
      containerId,
      // The orphan bucket accepts no drops; it registers only to keep the markup uniform.
      accepts: (source) => source.kind === SLOT_KIND && !!sectionId,
      onDrop: (source, index) =>
        emit("move", {
          kind: "slot",
          key: source.key,
          sectionId,
          index:
            source.containerId === containerId
              ? reorderIndex(source.index, index)
              : index,
        }),
    });
    slotDrops.set(sectionId, list);
  }
  return list;
}

function sectionHandleProps(key: string, index: number) {
  return useDragHandle((): DragSource => ({
    kind: SECTION_KIND,
    containerId: SECTIONS_CONTAINER,
    key,
    index,
  }));
}

function slotHandleProps(key: string, sectionId: string, index: number) {
  return useDragHandle((): DragSource => ({
    kind: SLOT_KIND,
    containerId: slotsContainerId(sectionId),
    key,
    index,
  }));
}

interface SlotRowView {
  row: OutlineRow;
  /** Index among the section's members in the composed layout. */
  index: number;
  /** False for a removed or orphaned slot. */
  draggable: boolean;
}

/** Each rendered group with its composed index, slot drop list and real slot indices. */
const groupViews = computed(() =>
  groups.value.map((group) => {
    const sectionId = group.section?.key ?? "";
    return {
      group,
      key: group.label + sectionId,
      sectionIndex: group.section
        ? sectionOrder.value.indexOf(group.section.key)
        : -1,
      drop: slotsDrop(sectionId),
      slots: group.slots.map((row, position): SlotRowView => {
        const place = slotPlaces.value.get(row.key);
        return {
          row,
          index: place?.index ?? position,
          draggable: !!sectionId && !!place && row.status !== "removed",
        };
      }),
    };
  }),
);

/** Where the selected row lands one step in `delta`'s direction, or null at the end of its
 *  list. Presets have no order, so they never move. */
function moveBy(row: OutlineRow, delta: 1 | -1): OutlineMove | null {
  if (row.status === "removed") return null;
  if (row.kind === "section") {
    const index = sectionOrder.value.indexOf(row.key);
    if (index === -1) return null;
    const to = index + delta;
    if (to < 0 || to > sectionOrder.value.length - 1) return null;
    return { kind: "section", key: row.key, index: to };
  }
  if (row.kind !== "slot") return null;
  const place = slotPlaces.value.get(row.key);
  const section = props.db.slotById.get(row.key)?.section;
  if (!place || !section) return null;
  const to = place.index + delta;
  if (to < 0 || to > place.count - 1) return null;
  return { kind: "slot", key: row.key, sectionId: section, index: to };
}

function move(row: OutlineRow, delta: 1 | -1) {
  const payload = moveBy(row, delta);
  if (payload) emit("move", payload);
}

/** The section a "New slot"/"New preset" lands in: the selection's, else the first one. */
const currentSectionId = computed(() => {
  const selected = props.selected;
  if (selected?.kind === "section") return selected.key;
  if (selected?.kind === "slot")
    return props.db.slotById.get(selected.key)?.section ?? "";
  if (selected?.kind === "sectionPreset") {
    const preset = props.db.presets.find(
      (candidate) => candidate.id === selected.key,
    );
    if (preset) return preset.section;
  }
  return props.db.sections[0]?.id ?? "";
});

const currentSectionLabel = computed(
  () =>
    props.db.sections.find((section) => section.id === currentSectionId.value)
      ?.label ?? "",
);

const newSlotLabel = computed(() =>
  currentSectionLabel.value
    ? `New slot in “${currentSectionLabel.value}”`
    : "New slot",
);
const newPresetLabel = computed(() =>
  currentSectionLabel.value
    ? `New preset for “${currentSectionLabel.value}”`
    : "New preset",
);

function onRowClick(row: OutlineRow) {
  if (row.status === "removed") return;
  emit("select", row);
}

function create(kind: OutlineKind) {
  menu.value?.close();
  emit("create", { kind, sectionId: currentSectionId.value });
}

/**
 * ArrowUp/Down move the selection through the flattened tree, from the search box or a focused
 * row, as in the flat entry list. Other targets keep their own arrow key handling.
 */
onKeyStroke(["ArrowDown", "ArrowUp", "Enter"], (event) => {
  const target = event.target as HTMLElement;
  const isSearch = target.matches?.('input[type="search"]');
  const isRow = target.closest?.(".editor-row");
  if (!isSearch && !isRow) return;
  const list = rows.value;
  if (!list.length) return;
  event.preventDefault();
  const idx = list.findIndex(isSelected);
  if (event.key === "Enter") {
    if (idx !== -1) emit("select", list[idx]);
    return;
  }
  const dir = event.key === "ArrowDown" ? 1 : -1;
  const next =
    idx === -1
      ? dir === 1
        ? 0
        : list.length - 1
      : Math.min(Math.max(idx + dir, 0), list.length - 1);
  emit("select", list[next], { push: false });
});
</script>

<template>
  <div class="flex min-h-0 flex-col rounded-md border border-line bg-surface">
    <LayerListHeader
      v-model:query="query"
      v-model:status-filter="statusFilter"
      search-placeholder="Filter the layout…"
      :status-filter-options="statusFilterOptions"
    >
      <template #create>
        <BaseMenu
          ref="menu"
          fit-content
          align="left"
          label="Add to the layout"
          panel-class="flex min-w-56 flex-col gap-0.5 p-1"
          :ignore="['.new-slot-entry']"
        >
          <template #trigger="{ toggle, attrs }">
            <BaseButton
              class="new-slot-entry flex-1 text-center justify-center"
              variant="primary"
              data-testid="new-slot-entry"
              v-bind="attrs"
              @click="toggle"
              ><CirclePlus />New</BaseButton
            >
          </template>
          <BaseMenuItem
            :icon="SquarePlus"
            data-testid="new-section"
            @click="create('section')"
            >New section</BaseMenuItem
          >
          <BaseMenuItem
            :icon="CirclePlus"
            :disabled="!currentSectionId"
            data-testid="new-slot"
            @click="create('slot')"
            >{{ newSlotLabel }}</BaseMenuItem
          >
          <BaseMenuItem
            :icon="CirclePlus"
            :disabled="!currentSectionId"
            data-testid="new-preset"
            @click="create('sectionPreset')"
            >{{ newPresetLabel }}</BaseMenuItem
          >
        </BaseMenu>
      </template>
    </LayerListHeader>

    <div class="min-h-0 flex-1 overflow-y-auto" data-testid="slot-outline">
      <!-- On this wrapper, not the scroll container, so the insertion line ignores scroll. -->
      <div v-bind="sectionsDrop.listProps()" class="relative">
        <DropIndicator :pos="sectionsDrop.separatorStyle.value" />

        <!-- One child per group, so a section drop lands between whole sections. -->
        <div v-for="view in groupViews" :key="view.key">
          <!-- The orphan bucket is a plain heading, with nothing to open. -->
          <div
            v-if="view.group.section"
            tabindex="0"
            class="editor-row outline-section flex cursor-pointer items-center gap-1.5 border-b border-line/45 bg-surface-2 px-2 py-1 font-semibold hover:bg-surface-2"
            :class="[
              isSelected(view.group.section) && 'is-on bg-accent-soft',
              dragSource?.kind === SECTION_KIND &&
                dragSource.key === view.group.section.key &&
                'is-drag-source opacity-50',
              sectionsDrop.intoIndex.value === view.sectionIndex &&
                'ring-1 ring-accent',
            ]"
            :data-outline-key="`section:${view.group.section.key}`"
            v-bind="
              view.sectionIndex >= 0
                ? sectionsDrop.rowProps(view.sectionIndex, {
                    into: draggingSlot,
                  })
                : {}
            "
            @click="onRowClick(view.group.section)"
          >
            <DragHandle
              v-if="view.sectionIndex >= 0"
              tooltip="Drag to reorder sections"
              data-testid="outline-handle"
              v-bind="
                sectionHandleProps(view.group.section.key, view.sectionIndex)
              "
            />
            <span class="editor-row-name min-w-0 flex-1 truncate">{{
              view.group.section.name
            }}</span>
            <BaseBadge
              v-if="view.group.section.status !== 'base'"
              :variant="view.group.section.status"
              >{{ view.group.section.status }}</BaseBadge
            >
            <BaseTooltip text="Unsaved edits in the form">
              <BaseBadge
                v-if="hasUnsavedDraft(view.group.section)"
                variant="unsaved"
                >unsaved</BaseBadge
              >
            </BaseTooltip>
            <BaseButton
              v-if="view.group.section.status === 'removed'"
              variant="ghost"
              @click.stop="emit('restore', view.group.section)"
              ><RotateCcw />restore</BaseButton
            >
            <template v-else-if="isSelected(view.group.section)">
              <IconButton
                title="Move section up"
                data-testid="outline-move-up"
                :disabled="!moveBy(view.group.section, -1)"
                @click.stop="move(view.group.section, -1)"
                ><ArrowUp
              /></IconButton>
              <IconButton
                title="Move section down"
                data-testid="outline-move-down"
                :disabled="!moveBy(view.group.section, 1)"
                @click.stop="move(view.group.section, 1)"
                ><ArrowDown
              /></IconButton>
            </template>
            <span v-else class="text-muted">{{
              view.group.section.detail
            }}</span>
          </div>
          <div
            v-else
            class="border-b border-line/45 bg-surface-2 px-2 py-1 font-semibold text-warn"
          >
            {{ view.group.label }}
          </div>

          <div v-bind="view.drop.listProps()" class="relative">
            <DropIndicator :pos="view.drop.separatorStyle.value" />

            <div
              v-for="entry in view.slots"
              :key="`slot:${entry.row.key}`"
              tabindex="0"
              class="editor-row flex cursor-pointer items-center gap-1.5 border-b border-line/45 py-1 pl-5 pr-2 hover:bg-surface-2"
              :class="[
                isSelected(entry.row) && 'is-on bg-accent-soft',
                dragSource?.kind === SLOT_KIND &&
                  dragSource.key === entry.row.key &&
                  'is-drag-source opacity-50',
              ]"
              :data-outline-key="`slot:${entry.row.key}`"
              v-bind="entry.draggable ? view.drop.rowProps(entry.index) : {}"
              @click="onRowClick(entry.row)"
            >
              <DragHandle
                v-if="entry.draggable"
                tooltip="Drag to reorder or move to another section"
                data-testid="outline-handle"
                v-bind="
                  slotHandleProps(
                    entry.row.key,
                    view.group.section?.key ?? '',
                    entry.index,
                  )
                "
              />
              <span class="editor-row-name min-w-0 flex-1 truncate">{{
                entry.row.name
              }}</span>
              <BaseBadge
                v-if="entry.row.status !== 'base'"
                :variant="entry.row.status"
                >{{ entry.row.status }}</BaseBadge
              >
              <BaseTooltip text="Unsaved edits in the form">
                <BaseBadge v-if="hasUnsavedDraft(entry.row)" variant="unsaved"
                  >unsaved</BaseBadge
                >
              </BaseTooltip>
              <BaseButton
                v-if="entry.row.status === 'removed'"
                variant="ghost"
                @click.stop="emit('restore', entry.row)"
                ><RotateCcw />restore</BaseButton
              >
              <template v-else-if="isSelected(entry.row)">
                <IconButton
                  title="Move slot up"
                  data-testid="outline-move-up"
                  :disabled="!moveBy(entry.row, -1)"
                  @click.stop="move(entry.row, -1)"
                  ><ArrowUp
                /></IconButton>
                <IconButton
                  title="Move slot down"
                  data-testid="outline-move-down"
                  :disabled="!moveBy(entry.row, 1)"
                  @click.stop="move(entry.row, 1)"
                  ><ArrowDown
                /></IconButton>
              </template>
              <span v-else class="text-muted">{{ entry.row.detail }}</span>
            </div>
          </div>

          <template v-if="view.group.presets.length">
            <div class="px-2 py-0.5 pl-5 text-muted">Presets</div>
            <div
              v-for="row in view.group.presets"
              :key="`preset:${row.key}`"
              tabindex="0"
              class="editor-row flex cursor-pointer items-center gap-1.5 border-b border-line/45 py-1 pl-8 pr-2 hover:bg-surface-2"
              :class="isSelected(row) && 'is-on bg-accent-soft'"
              :data-outline-key="`preset:${row.key}`"
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
            </div>
          </template>
        </div>
      </div>
      <p v-if="!rows.length" class="p-2 text-muted">Nothing matches.</p>
    </div>
  </div>
</template>
