<script setup lang="ts">
// Build list section inside the left sidebar, one level deep: top-level builds and folders,
// each folder holding builds. Pure presentation - actions, menu items, and rename state are
// provided by the parent (NavBar.vue), which also resolves whether a row id names a build or a
// folder (ids are unique across both, so one `menuOpenId`/`renamingId` covers each). The one
// store read here is the nav history behind the heading's undo/redo pair: it is the sidebar's
// own stack, with nothing for the parent to decide.
import { computed, type Component } from "vue";
import BaseButton from "./ui/BaseButton.vue";

import BaseInput from "./ui/BaseInput.vue";
import HistoryButtons from "./ui/HistoryButtons.vue";
import NavRow from "./NavRow.vue";
import DropIndicator from "./ui/DropIndicator.vue";
import { FileSliders, Folder, FolderPlus, FolderOpen, Plus } from "@lucide/vue";

import { matchesQuery } from "../lib/text-filter";
import * as navHistory from "../stores/navHistory";
import {
  dragSource,
  useDragHandle,
  useDropList,
  type DragSource,
} from "../composables/useDragAndDrop";
import type { Build, BuildFolder, BuildNavEntry } from "../types";

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
  menuItems: {
    action: string;
    label: string;
    /** Lucide component rendered left of the label. */
    icon?: Component;
    danger?: boolean;
    disabled?: boolean;
  }[];
  /** The kebab's bounding rect (placement) and element (focus-restore), for NavContextMenu. */
  menuOrigin: { anchor: DOMRect; trigger: HTMLElement } | null;
}>();

const emit = defineEmits<{
  "update:filter": [value: string];
  select: [id: string];
  "rename-start": [id: string, name: string];
  "rename-commit": [];
  "rename-cancel": [];
  "move-up": [id: string];
  "move-down": [id: string];
  /** Drop a build at `toIndex` of `folderId`, or of the top level when null. */
  reorder: [id: string, toIndex: number, folderId: string | null];
  "reorder-folder": [id: string, toIndex: number];
  "move-into-folder": [buildId: string, folderId: string];
  "folder-toggle": [id: string];
  "delete-request": [id: string, skipConfirm: boolean];
  "menu-open": [id: string, event: MouseEvent];
  "menu-action": [action: string, id: string, skipConfirm: boolean];
  "menu-close": [];
  create: [];
  "create-folder": [];
}>();

/** A rendered row, carrying its index in the *unfiltered* list it belongs to -- drop targets
 *  and drag sources are expressed against the real order, so reordering keeps working while
 *  a filter is hiding rows. */
type Row =
  | { kind: "build"; build: Build; index: number }
  | {
      kind: "folder";
      folder: BuildFolder;
      builds: { build: Build; index: number }[];
      index: number;
    };

/** A folder matching by its own name keeps all of its builds; otherwise it is narrowed to the
 *  builds that match, and drops out entirely when none do. */
const rows = computed<Row[]>(() => {
  const query = props.filter;
  const out: Row[] = [];
  props.entries.forEach((entry, index) => {
    if (entry.kind === "build") {
      if (!query || matchesQuery(entry.build.name, query))
        out.push({ kind: "build", build: entry.build, index });
      return;
    }
    const all = entry.builds.map((build, i) => ({ build, index: i }));
    const byFolderName = !!query && matchesQuery(entry.folder.name, query);
    const kept =
      !query || byFolderName
        ? all
        : all.filter((b) => matchesQuery(b.build.name, query));
    if (query && !byFolderName && !kept.length) return;
    out.push({ kind: "folder", folder: entry.folder, builds: kept, index });
  });
  return out;
});

/** A filter overrides the stored collapsed state: hiding the matches inside a collapsed
 *  folder would make the folder look empty rather than filtered. */
function isOpen(folder: BuildFolder) {
  return !!props.filter || !folder.collapsed;
}

/** Only a build can go *inside* a folder - folders never nest, so a dragged folder gets the
 *  plain before/after reorder gesture on a folder header. */
const canDropInto = computed(() => dragSource.value?.kind === "build");

const rootDrop = useDropList({
  containerId: "nav-builds",
  accepts: (source) => source.kind === "build" || source.kind === "folder",
  onDrop: (source, index, zone) => {
    if (zone === "into") {
      const entry = props.entries[index];
      if (entry?.kind === "folder" && source.kind === "build")
        emit("move-into-folder", source.key, entry.folder.id);
      return;
    }
    if (source.kind === "folder") emit("reorder-folder", source.key, index);
    else emit("reorder", source.key, index, null);
  },
});

// One drop list per folder, cached by id. `useDropList` owns a few `computed`s, so a cache
// avoids rebuilding them every render. Entries for removed folders die with the component.
const folderDrops = new Map<string, ReturnType<typeof useDropList>>();
function folderDrop(id: string) {
  let list = folderDrops.get(id);
  if (!list) {
    list = useDropList({
      containerId: `nav-folder:${id}`,
      accepts: (source) => source.kind === "build",
      onDrop: (source, index) => emit("reorder", source.key, index, id),
    });
    folderDrops.set(id, list);
  }
  return list;
}

function buildHandleProps(id: string, index: number, folderId: string | null) {
  return useDragHandle((): DragSource => ({
    kind: "build",
    containerId: folderId ? `nav-folder:${folderId}` : "nav-builds",
    key: id,
    index,
  }));
}

function folderHandleProps(id: string, index: number) {
  return useDragHandle((): DragSource => ({
    kind: "folder",
    containerId: "nav-builds",
    key: id,
    index,
  }));
}
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
      v-bind="rootDrop.listProps()"
      data-testid="nav-builds-list"
      data-nav-list
      class="relative space-y-1 overflow-y-auto pl-1 pb-1"
    >
      <!-- Rendered first: resolveInList measures `listContentBottom` from the list root's last
           DOM child. Rendered after the rows, this absolute element would become that child
           once visible. -->
      <DropIndicator :pos="rootDrop.separatorStyle.value" />

      <template
        v-for="row in rows"
        :key="row.kind === 'build' ? row.build.id : row.folder.id"
      >
        <NavRow
          v-if="row.kind === 'build'"
          :id="row.build.id"
          :name="row.build.name"
          kind="build"
          :icon="FileSliders"
          :active="selectedId === row.build.id"
          :renaming="renamingId === row.build.id"
          :rename-text="renameText"
          :menu-open="menuOpenId === row.build.id"
          :menu-items="menuOpenId === row.build.id ? menuItems : []"
          :menu-origin="menuOrigin"
          :handle-props="buildHandleProps(row.build.id, row.index, null)"
          :row-props="rootDrop.rowProps(row.index)"
          :is-drop-into="false"
          @activate="(id) => $emit('select', id)"
          @select="(id) => $emit('select', id)"
          @rename-start="(id, name) => $emit('rename-start', id, name)"
          @rename-commit="$emit('rename-commit')"
          @rename-cancel="$emit('rename-cancel')"
          @move-up="(id) => $emit('move-up', id)"
          @move-down="(id) => $emit('move-down', id)"
          @delete-request="(id, skip) => $emit('delete-request', id, skip)"
          @menu-open="(id, ev) => $emit('menu-open', id, ev)"
          @menu-action="(a, id, skip) => $emit('menu-action', a, id, skip)"
          @menu-close="$emit('menu-close')"
        />

        <template v-else>
          <NavRow
            :id="row.folder.id"
            :name="row.folder.name"
            kind="folder"
            :icon="isOpen(row.folder) ? FolderOpen : Folder"
            :count="row.folder.builds.length"
            :active="false"
            :renaming="renamingId === row.folder.id"
            :rename-text="renameText"
            :menu-open="menuOpenId === row.folder.id"
            :menu-items="menuOpenId === row.folder.id ? menuItems : []"
            :menu-origin="menuOrigin"
            :handle-props="folderHandleProps(row.folder.id, row.index)"
            :row-props="rootDrop.rowProps(row.index, { into: canDropInto })"
            :is-drop-into="rootDrop.intoIndex.value === row.index"
            :collapsed="row.folder.collapsed"
            @activate="(id) => $emit('folder-toggle', id)"
            @select="(id) => $emit('select', id)"
            @folder-toggle="(id) => $emit('folder-toggle', id)"
            @rename-start="(id, name) => $emit('rename-start', id, name)"
            @rename-commit="$emit('rename-commit')"
            @rename-cancel="$emit('rename-cancel')"
            @move-up="(id) => $emit('move-up', id)"
            @move-down="(id) => $emit('move-down', id)"
            @delete-request="(id, skip) => $emit('delete-request', id, skip)"
            @menu-open="(id, ev) => $emit('menu-open', id, ev)"
            @menu-action="(a, id, skip) => $emit('menu-action', a, id, skip)"
            @menu-close="$emit('menu-close')"
          />

          <div
            v-if="isOpen(row.folder)"
            v-bind="folderDrop(row.folder.id).listProps()"
            data-testid="nav-folder-list"
            class="relative ml-3 space-y-1 pl-2 before:absolute before:inset-y-1 before:left-0 before:w-px before:bg-line before:content-['']"
          >
            <DropIndicator
              :pos="folderDrop(row.folder.id).separatorStyle.value"
            />

            <NavRow
              v-for="child in row.builds"
              :id="child.build.id"
              :key="child.build.id"
              :name="child.build.name"
              kind="build"
              class="nav-row--nested"
              :icon="FileSliders"
              :active="selectedId === child.build.id"
              :renaming="renamingId === child.build.id"
              :rename-text="renameText"
              :menu-open="menuOpenId === child.build.id"
              :menu-items="menuOpenId === child.build.id ? menuItems : []"
              :menu-origin="menuOrigin"
              :handle-props="
                buildHandleProps(child.build.id, child.index, row.folder.id)
              "
              :row-props="folderDrop(row.folder.id).rowProps(child.index)"
              :is-drop-into="false"
              @activate="(id) => $emit('select', id)"
              @select="(id) => $emit('select', id)"
              @rename-start="(id, name) => $emit('rename-start', id, name)"
              @rename-commit="$emit('rename-commit')"
              @rename-cancel="$emit('rename-cancel')"
              @move-up="(id) => $emit('move-up', id)"
              @move-down="(id) => $emit('move-down', id)"
              @delete-request="(id, skip) => $emit('delete-request', id, skip)"
              @menu-open="(id, ev) => $emit('menu-open', id, ev)"
              @menu-action="(a, id, skip) => $emit('menu-action', a, id, skip)"
              @menu-close="$emit('menu-close')"
            />
          </div>
        </template>
      </template>
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
