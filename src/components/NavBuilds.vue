<script setup lang="ts">
// Build list section inside the left sidebar: top-level builds and folders, each folder holding
// builds and further folders. Pure presentation - actions, menu items, and rename state are
// provided by the parent (NavBar.vue), which also resolves whether a row id names a build or a
// folder (ids are unique across both, so one `menuOpenId`/`renamingId` covers each), and which
// moves the tree allows (`canPlace`). The one store read here is the nav history behind the
// heading's undo/redo pair: it is the sidebar's own stack, with nothing for the parent to decide.
//
// The rows themselves render through the recursive NavBuildRows, which reads what this
// component shares by injection.
import { computed, provide, useTemplateRef } from "vue";
import BaseButton from "./ui/BaseButton.vue";

import BaseInput from "./ui/BaseInput.vue";
import HistoryButtons from "./ui/HistoryButtons.vue";
import NavBuildRows from "./NavBuildRows.vue";
import DropIndicator from "./ui/DropIndicator.vue";
import { FolderPlus, Plus } from "@lucide/vue";

import { matchesQuery } from "../lib/text-filter";
import type { NavMenuItem } from "../lib/nav-menu";
import * as navHistory from "../stores/navHistory";
import {
  dragSource,
  useDragHandles,
  useDropList,
  type DragSource,
  type DropZone,
} from "../composables/useDragAndDrop";
import { useKeyedCache } from "../composables/useKeyedCache";
import { useReorderMotion } from "../composables/useReorderMotion";
import { useFoldSlide } from "../composables/useFoldSlide";
import {
  NAV_BUILDS_CONTEXT,
  type NavBuildRow,
} from "../composables/navBuildsContext";
import type { BuildFolder, BuildNavEntry } from "../types";

const props = defineProps<{
  /** Top-level rows in order: loose builds and folders with their contents. */
  entries: BuildNavEntry[];
  selectedId: string | null;
  filter: string;
  /** Which row is being renamed (build id or folder id), or null. */
  renamingId: string | null;
  renameText: string;
  /** Menu items for the open menu, position, and which row's menu is open. */
  menuOpenId: string | null;
  menuItems: NavMenuItem[];
  /** The kebab's bounding rect (placement) and element (focus-restore), for NavContextMenu. */
  menuOrigin: { anchor: DOMRect; trigger: HTMLElement } | null;
  /** Whether a row may move into a folder (the top level when null). */
  canPlace: (id: string, folderId: string | null) => boolean;
}>();

const emit = defineEmits<{
  "update:filter": [value: string];
  select: [id: string];
  "rename-start": [id: string, name: string];
  "rename-commit": [];
  "rename-cancel": [];
  "move-up": [id: string];
  "move-down": [id: string];
  /** Drop a row at `toIndex` of `folderId`, or of the top level when null. */
  place: [id: string, folderId: string | null, toIndex: number];
  /** Drop a row onto a folder: it goes in at the end. */
  "move-into": [id: string, folderId: string];
  "folder-toggle": [id: string];
  "delete-request": [id: string, skipConfirm: boolean];
  "menu-open": [id: string, event: MouseEvent];
  "menu-action": [action: string, id: string, skipConfirm: boolean];
  "menu-close": [];
  create: [];
  "create-folder": [];
}>();

const countBuilds = (entries: BuildNavEntry[]): number =>
  entries.reduce(
    (n, e) => n + (e.kind === "build" ? 1 : countBuilds(e.entries)),
    0,
  );

/** A folder matching by its own name keeps everything inside it; otherwise it is narrowed to
 *  the rows that match, and drops out entirely when none do. */
function toRows(entries: BuildNavEntry[], query: string): NavBuildRow[] {
  return entries.flatMap<NavBuildRow>((entry, index) => {
    if (entry.kind === "build")
      return !query || matchesQuery(entry.build.name, query)
        ? [{ kind: "build", build: entry.build, index }]
        : [];
    const byName = !!query && matchesQuery(entry.folder.name, query);
    const rows = toRows(entry.entries, byName ? "" : query);
    if (query && !byName && !rows.length) return [];
    const count = countBuilds(entry.entries);
    return [{ kind: "folder", folder: entry.folder, rows, index, count }];
  });
}

const rows = computed(() => toRows(props.entries, props.filter));

/** Each folder's unfiltered rows by id, for resolving a drop's index back to a row. */
const entriesById = computed(() => {
  const map = new Map<string, BuildNavEntry[]>();
  const walk = (entries: BuildNavEntry[]) => {
    for (const entry of entries) {
      if (entry.kind !== "folder") continue;
      map.set(entry.folder.id, entry.entries);
      walk(entry.entries);
    }
  };
  walk(props.entries);
  return map;
});

const list = useTemplateRef("list");

/** Every build and folder at every depth, so moving a row into or out of a folder reads as a
 *  reorder. Read off the unfiltered entries, so a filter or a fold leaves it as is. */
useReorderMotion(list, () => {
  const keys = (entries: BuildNavEntry[]): string[] =>
    entries.flatMap((entry) =>
      entry.kind === "build"
        ? [entry.build.id]
        : [entry.folder.id, ...keys(entry.entries)],
    );
  return keys(props.entries);
});

/** A filter overrides the stored collapsed state: hiding the matches inside a collapsed
 *  folder would make the folder look empty rather than filtered. */
function isOpen(folder: BuildFolder) {
  return !!props.filter || !folder.collapsed;
}

// Opening or closing a folder slides the rows below it.
useFoldSlide(list, () => {
  const shown: BuildFolder[] = [];
  const walk = (list: NavBuildRow[]) => {
    for (const row of list) {
      if (row.kind !== "folder") continue;
      shown.push(row.folder);
      walk(row.rows);
    }
  };
  walk(rows.value);
  return {
    folds: shown.map((folder) => folder.id),
    open: shown.filter(isOpen).map((folder) => folder.id),
  };
});

const isRow = (source: DragSource) =>
  source.kind === "build" || source.kind === "folder";

/** A list takes the rows its folder may hold. One it refuses passes the drop on to the list
 *  around it, so a folder dragged over a place it cannot nest still reorders beside it. */
function dropInto(folderId: string | null) {
  return {
    accepts: (source: DragSource) =>
      isRow(source) && props.canPlace(source.key, folderId),
    onDrop: (source: DragSource, index: number, zone: DropZone) => {
      if (zone === "into") {
        const entries =
          folderId === null
            ? props.entries
            : (entriesById.value.get(folderId) ?? []);
        const entry = entries[index];
        if (entry?.kind === "folder")
          emit("move-into", source.key, entry.folder.id);
        return;
      }
      emit("place", source.key, folderId, index);
    },
  };
}

const rootDrop = useDropList(dropInto(null));

// One drop list per folder, cached by id. `useDropList` owns a few `computed`s, so a cache
// avoids rebuilding them every render. Entries for removed folders die with the component.
const folderDrop = useKeyedCache((id: string) => useDropList(dropInto(id)));

const dragHandle = useDragHandles();

provide(NAV_BUILDS_CONTEXT, {
  state: props,
  isOpen,
  canDropInto: (folderId) => {
    const source = dragSource.value;
    return !!source && isRow(source) && props.canPlace(source.key, folderId);
  },
  folderDrop,
  handleProps: (kind, id, index, parentId) =>
    dragHandle({
      kind,
      containerId: parentId ? `nav-folder:${parentId}` : "nav-builds",
      key: id,
      index,
    }),
  on: {
    select: (id) => emit("select", id),
    toggle: (id) => emit("folder-toggle", id),
    renameStart: (id, name) => emit("rename-start", id, name),
    renameCommit: () => emit("rename-commit"),
    renameCancel: () => emit("rename-cancel"),
    moveUp: (id) => emit("move-up", id),
    moveDown: (id) => emit("move-down", id),
    deleteRequest: (id, skip) => emit("delete-request", id, skip),
    menuOpen: (id, event) => emit("menu-open", id, event),
    menuAction: (action, id, skip) => emit("menu-action", action, id, skip),
    menuClose: () => emit("menu-close"),
  },
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="mb-1 flex items-center justify-between px-1 py-0.5">
      <span class="text-sm font-semibold uppercase text-muted">Builds</span>
      <!-- Workspace operations (create, rename, move, delete, folders) across the whole
           sidebar, so the pair sits on the first heading rather than on each section. -->
      <HistoryButtons
        testid="nav"
        :can-undo="navHistory.canUndo.value"
        :can-redo="navHistory.canRedo.value"
        :undo-label="navHistory.undoLabel.value"
        :redo-label="navHistory.redoLabel.value"
        @undo="navHistory.undo()"
        @redo="navHistory.redo()"
      />
    </div>

    <BaseInput
      :model-value="filter"
      type="text"
      placeholder="Filter…"
      data-testid="nav-builds-filter"
      class="mb-1"
      @update:model-value="$emit('update:filter', String($event))"
    />

    <div
      ref="list"
      v-bind="rootDrop.listProps()"
      data-testid="nav-builds-list"
      data-nav-list
      class="relative space-y-1 overflow-y-auto pl-1 pb-1"
    >
      <!-- Rendered first: resolveInList measures `listContentBottom` from the list root's last
           DOM child. Rendered after the rows, this absolute element would become that child
           once visible. -->
      <DropIndicator :pos="rootDrop.separatorStyle.value" />

      <NavBuildRows :rows="rows" :drop="rootDrop" :parent-id="null" />
    </div>

    <!-- Fills the rest of the section, so a drop anywhere below the rows appends. -->
    <div
      v-bind="rootDrop.tailProps()"
      class="flex flex-1 items-start justify-center gap-1 pt-2"
    >
      <BaseButton data-testid="nav-add-build" @click="$emit('create')"
        ><Plus />New</BaseButton
      >
      <BaseButton data-testid="nav-add-folder" @click="$emit('create-folder')"
        ><FolderPlus />Folder</BaseButton
      >
    </div>
  </div>
</template>
