<script setup lang="ts">
// Build list section inside the left sidebar, one level deep: top-level builds and folders,
// each folder holding builds. Pure presentation - actions, menu items, and rename state are
// provided by the parent (Nav.vue), which also resolves whether a row id names a build or a
// folder (ids are unique across both, so one `menuOpenId`/`renamingId` covers each).
import { computed, useTemplateRef, type Component, type Directive } from "vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseTooltip from "./ui/BaseTooltip.vue";
import NavBuildRow from "./NavBuildRow.vue";
import {
  ChevronDown,
  ChevronRight,
  EllipsisVertical,
  FolderPlus,
  GripVertical,
  Plus,
} from "@lucide/vue";
import NavContextMenu from "./NavContextMenu.vue";
import { isMac } from "../lib/platform";
import { matchesQuery } from "../lib/text-filter";
import {
  dragSource,
  useDragHandle,
  useDropList,
  type DragSource,
} from "../composables/useDragAndDrop";
import type { Build, BuildFolder, BuildNavEntry } from "../types";

const vRenameFocus: Directive<HTMLInputElement> = {
  mounted(el) {
    el.focus();
    el.select();
  },
};

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
  "delete-request": [id: string];
  "menu-open": [id: string, event: MouseEvent];
  "menu-action": [action: string, id: string];
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

// One drop list per folder, cached by id. `useDropList` is a plain function with no lifecycle
// hooks of its own, so calling it per row is safe, but it does own a `computed` -- caching
// keeps a re-render from building a fresh one for every folder every time. Entries for
// folders that go away are inert and die with the component.
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

/** The folder header's own keyboard handling. Enter/Space are left to the native button
 *  (= expand/collapse); the rest mirrors a build row's, minus selection - a folder has no
 *  editor to open. */
function onFolderKeydown(event: KeyboardEvent, folder: BuildFolder) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const dir = event.key === "ArrowDown" ? 1 : -1;
    if (isMac ? event.metaKey : event.ctrlKey) {
      if (dir === 1) emit("move-down", folder.id);
      else emit("move-up", folder.id);
    } else {
      moveFocus(dir);
    }
    return;
  }
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault();
    // Already in the state the key asks for.
    if (folder.collapsed === (event.key === "ArrowLeft")) return;
    emit("folder-toggle", folder.id);
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    emit("delete-request", folder.id);
    return;
  }
  if (event.key === "F2") {
    event.preventDefault();
    emit("rename-start", folder.id, folder.name);
  }
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
    </div>

    <input
      :value="filter"
      type="text"
      placeholder="Filter…"
      data-testid="nav-builds-filter"
      class="mb-1 rounded-md border border-line bg-surface px-2 py-0.5 text-sm focus:outline-accent"
      @input="$emit('update:filter', ($event.target as HTMLInputElement).value)"
    />

    <div class="overflow-y-auto">
      <template
        v-for="row in rows"
        :key="row.kind === 'build' ? row.build.id : row.folder.id"
      >
        <NavBuildRow
          v-if="row.kind === 'build'"
          :build="row.build"
          :active="selectedId === row.build.id"
          :renaming="renamingId === row.build.id"
          :rename-text="renameText"
          :menu-open="menuOpenId === row.build.id"
          :menu-items="menuOpenId === row.build.id ? menuItems : []"
          :menu-anchor="menuAnchor"
          :handle-props="buildHandleProps(row.build.id, row.index, null)"
          :drop-props="rootDrop.rowProps(row.index)"
          :indicator="rootDrop.indicatorAt(row.index)"
          :nested="false"
          @select="(id) => $emit('select', id)"
          @rename-start="(id, name) => $emit('rename-start', id, name)"
          @rename-commit="$emit('rename-commit')"
          @rename-cancel="$emit('rename-cancel')"
          @move-up="(id) => $emit('move-up', id)"
          @move-down="(id) => $emit('move-down', id)"
          @focus-move="moveFocus"
          @delete-request="(id) => $emit('delete-request', id)"
          @menu-open="(id, ev) => $emit('menu-open', id, ev)"
          @menu-action="(a, id) => $emit('menu-action', a, id)"
          @menu-close="$emit('menu-close')"
        />

        <template v-else>
          <div
            class="nav-row nav-row--folder relative flex items-center gap-1 rounded-md border-b-2 border-t-2 border-transparent py-1 pl-1 pr-1"
            :class="[
              rootDrop.indicatorAt(row.index) === 'before' &&
                '!border-t-accent',
              rootDrop.indicatorAt(row.index) === 'after' && '!border-b-accent',
              rootDrop.indicatorAt(row.index) === 'into' &&
                'is-drop-into bg-accent-soft !border-b-accent !border-t-accent',
            ]"
            v-bind="rootDrop.rowProps(row.index, { into: canDropInto })"
          >
            <BaseTooltip text="Drag to reorder. Ctrl + ↑ or ↓ to move up/down.">
              <span
                data-testid="folder-drag-handle"
                class="cursor-grab text-muted hover:text-accent [&_svg]:size-[14px]"
                v-bind="folderHandleProps(row.folder.id, row.index)"
              >
                <GripVertical />
              </span>
            </BaseTooltip>

            <component
              :is="isOpen(row.folder) ? ChevronDown : ChevronRight"
              class="size-[14px] flex-none text-muted"
            />

            <input
              v-if="renamingId === row.folder.id"
              v-rename-focus
              :value="renameText"
              class="nav-rename min-w-0 flex-1 rounded-md border border-line bg-surface px-1 py-0.5"
              @input="
                $emit(
                  'rename-start',
                  row.folder.id,
                  ($event.target as HTMLInputElement).value,
                )
              "
              @keydown.enter="$emit('rename-commit')"
              @keydown.esc="$emit('rename-cancel')"
              @blur="$emit('rename-commit')"
            />

            <BaseTooltip v-else :text="row.folder.name">
              <button
                type="button"
                class="nav-name min-w-0 flex-1 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap py-0.5 text-left font-medium"
                :data-nav-key="row.folder.id"
                data-nav-kind="folder"
                :aria-expanded="isOpen(row.folder)"
                @click="$emit('folder-toggle', row.folder.id)"
                @dblclick="
                  $emit('rename-start', row.folder.id, row.folder.name)
                "
                @contextmenu.prevent="$emit('menu-open', row.folder.id, $event)"
                @keydown="onFolderKeydown($event, row.folder)"
              >
                {{ row.folder.name }}
              </button>
            </BaseTooltip>

            <span class="flex-none text-sm tabular-nums text-muted">{{
              row.folder.builds.length
            }}</span>

            <div class="nav-menu-wrap relative">
              <BaseTooltip text="Folder menu">
                <button
                  type="button"
                  class="nav-kebab flex-none cursor-pointer rounded-md px-1.5 leading-none text-muted hover:bg-surface-2 hover:text-text"
                  aria-label="Folder menu"
                  @click="$emit('menu-open', row.folder.id, $event)"
                >
                  <EllipsisVertical class="size-[14px]" />
                </button>
              </BaseTooltip>

              <NavContextMenu
                v-if="menuOpenId === row.folder.id"
                :anchor="menuAnchor"
                :items="menuItems"
                :ignore="['.nav-kebab']"
                @action="(a) => $emit('menu-action', a, row.folder.id)"
                @close="$emit('menu-close')"
              />
            </div>
          </div>

          <template v-if="isOpen(row.folder)">
            <NavBuildRow
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
              :drop-props="folderDrop(row.folder.id).rowProps(child.index)"
              :indicator="folderDrop(row.folder.id).indicatorAt(child.index)"
              :nested="true"
              @select="(id) => $emit('select', id)"
              @rename-start="(id, name) => $emit('rename-start', id, name)"
              @rename-commit="$emit('rename-commit')"
              @rename-cancel="$emit('rename-cancel')"
              @move-up="(id) => $emit('move-up', id)"
              @move-down="(id) => $emit('move-down', id)"
              @focus-move="moveFocus"
              @delete-request="(id) => $emit('delete-request', id)"
              @menu-open="(id, ev) => $emit('menu-open', id, ev)"
              @menu-action="(a, id) => $emit('menu-action', a, id)"
              @menu-close="$emit('menu-close')"
            />

            <div
              v-if="!row.builds.length"
              class="nav-folder-empty ml-9 mr-1 rounded-md border border-dashed px-2 py-1 text-sm text-muted"
              :class="
                folderDrop(row.folder.id).isActiveContainer.value
                  ? 'border-accent'
                  : 'border-line'
              "
              data-testid="folder-empty"
              v-bind="folderDrop(row.folder.id).emptyProps()"
            >
              Drop builds here
            </div>
          </template>
        </template>
      </template>

      <div class="mt-2 flex items-center justify-center gap-1">
        <BaseButton data-testid="nav-add-build" @click="$emit('create')"
          ><Plus />New</BaseButton
        >
        <BaseButton data-testid="nav-add-folder" @click="$emit('create-folder')"
          ><FolderPlus />Folder</BaseButton
        >
      </div>
    </div>
  </div>
</template>
