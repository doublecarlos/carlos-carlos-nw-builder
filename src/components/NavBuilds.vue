<script setup lang="ts">
// Build list section inside the left sidebar, one level deep: top-level builds and folders,
// each folder holding builds. Pure presentation - actions, menu items, and rename state are
// provided by the parent (NavBar.vue), which also resolves whether a row id names a build or a
// folder (ids are unique across both, so one `menuOpenId`/`renamingId` covers each). The one
// store read here is the nav history behind the heading's undo/redo pair: it is the sidebar's
// own stack, with nothing for the parent to decide.
import { computed, useTemplateRef, type Component } from "vue";
import BaseButton from "./ui/BaseButton.vue";

import BaseInput from "./ui/BaseInput.vue";
import HistoryButtons from "./ui/HistoryButtons.vue";
import NavRowBuild from "./NavRowBuild.vue";
import NavRowFolder from "./NavRowFolder.vue";
import DropIndicator from "./ui/DropIndicator.vue";
import { ChevronDown, ChevronRight, FolderPlus, Plus } from "@lucide/vue";

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
  /** Bounding rect of the row that opened the menu, for popover anchoring. */
  menuAnchor: DOMRect | null;
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

const root = useTemplateRef("root");

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

function moveFocus(dir: 1 | -1) {
  const focusable = root.value?.querySelectorAll<HTMLElement>("[data-nav-key]");
  if (!focusable?.length) return;
  const current = document.activeElement?.closest("[data-nav-key]");
  const idx = current
    ? Array.from(focusable).indexOf(current as HTMLElement)
    : -1;
  const next =
    focusable[Math.min(Math.max(idx + dir, 0), focusable.length - 1)];
  next.focus();
  // A folder has nothing to select - moving onto one just parks the keyboard cursor there.
  if (next.dataset.navKind === "build") emit("select", next.dataset.navKey!);
}
</script>

<template>
  <div ref="root" class="flex min-h-0 flex-1 flex-col">
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
      class="relative overflow-y-auto pb-8"
    >
      <!-- Rendered first: resolveInList measures `listContentBottom` from the list root's last
           DOM child. Rendered after the rows, this absolute element would become that child
           once visible. -->
      <DropIndicator :pos="rootDrop.separatorStyle.value" />

      <template
        v-for="row in rows"
        :key="row.kind === 'build' ? row.build.id : row.folder.id"
      >
        <NavRowBuild
          v-if="row.kind === 'build'"
          :build="row.build"
          :active="selectedId === row.build.id"
          :renaming="renamingId === row.build.id"
          :rename-text="renameText"
          :menu-open="menuOpenId === row.build.id"
          :menu-items="menuOpenId === row.build.id ? menuItems : []"
          :menu-anchor="menuAnchor"
          :handle-props="buildHandleProps(row.build.id, row.index, null)"
          :row-props="rootDrop.rowProps(row.index)"
          :nested="false"
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
        />

        <template v-else>
          <NavRowFolder
            :id="row.folder.id"
            :name="row.folder.name"
            :renaming="renamingId === row.folder.id"
            :rename-text="renameText"
            :menu-open="menuOpenId === row.folder.id"
            :menu-items="menuOpenId === row.folder.id ? menuItems : []"
            :menu-anchor="menuAnchor"
            :handle-props="folderHandleProps(row.folder.id, row.index)"
            :row-props="rootDrop.rowProps(row.index, { into: canDropInto })"
            :is-drop-into="rootDrop.intoIndex.value === row.index"
            :nested="false"
            :collapsed="row.folder.collapsed"
            :build-count="row.folder.builds.length"
            @select="(id) => $emit('folder-toggle', id)"
            @folder-toggle="(id) => $emit('folder-toggle', id)"
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
              <button
                type="button"
                tabindex="-1"
                data-no-drag
                data-testid="folder-toggle"
                class="nav-folder-toggle flex-none cursor-pointer rounded-md p-0.5 leading-none text-muted hover:bg-surface-2 hover:text-text"
                :aria-label="
                  isOpen(row.folder) ? 'Collapse folder' : 'Expand folder'
                "
                @click="$emit('folder-toggle', row.folder.id)"
              >
                <component
                  :is="isOpen(row.folder) ? ChevronDown : ChevronRight"
                  class="size-[14px]"
                />
              </button>
            </template>
            <template #after>
              <span class="flex-none text-sm tabular-nums text-muted">{{
                row.folder.builds.length
              }}</span>
            </template>
          </NavRowFolder>

          <div
            v-if="isOpen(row.folder)"
            v-bind="folderDrop(row.folder.id).listProps()"
            data-testid="nav-folder-list"
            class="relative ml-6 border-l-1 border-solid border-line pl-1"
          >
            <DropIndicator
              :pos="folderDrop(row.folder.id).separatorStyle.value"
            />

            <NavRowBuild
              v-for="child in row.builds"
              :key="child.build.id"
              :build="child.build"
              :active="selectedId === child.build.id"
              :renaming="renamingId === child.build.id"
              :rename-text="renameText"
              :menu-open="menuOpenId === child.build.id"
              :menu-items="menuOpenId === child.build.id ? menuItems : []"
              :menu-anchor="menuAnchor"
              :handle-props="
                buildHandleProps(child.build.id, child.index, row.folder.id)
              "
              :row-props="folderDrop(row.folder.id).rowProps(child.index)"
              :nested="true"
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
            />
          </div>
        </template>
      </template>
    </div>

    <div class="mt-2 flex items-center justify-center gap-1">
      <BaseButton data-testid="nav-add-build" @click="$emit('create')"
        ><Plus />New</BaseButton
      >
      <BaseButton data-testid="nav-add-folder" @click="$emit('create-folder')"
        ><FolderPlus />Folder</BaseButton
      >
    </div>
  </div>
</template>
