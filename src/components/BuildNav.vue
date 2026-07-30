<script setup lang="ts">
// Left sidebar: collections of builds. A collection is a named group of build tabs that can
// be saved (browser storage or a linked file, via fs-store.ts) and exported as a whole; an
// individual build keeps its own independent save/revert (BuildBar.vue).
import { ref, reactive, computed, nextTick, onMounted, onUnmounted, type ComponentPublicInstance } from 'vue';
import Button from './ui/Button.vue';
import UnsavedDot from './ui/UnsavedDot.vue';
import * as fsStore from '../fs-store';
import * as library from '../stores/library';
import * as buildEditor from '../stores/buildEditor';
import type { Build, Collection } from '../types';

const CONFIRM_MS = 4000;

const collections = library.collections;
const builds = library.builds;
const activeCollectionId = library.activeCollectionId;
const activeId = library.activeId;
const dirtyByBuild = library.dirtyByBuild;
const savedCollections = library.savedCollections;

const root = ref<HTMLElement | null>(null);
const collapsed = reactive<Record<string, boolean>>({});          // collectionId -> true when collapsed (absent = expanded)
const openMenu = ref<{ type: string; id: string } | null>(null);
const menuPos = reactive({ top: 0, left: 0 });   // viewport coords for the open menu, see `openMenuFor`
const saveAsFor = ref<string | null>(null);      // collection id currently showing the Save As sub-panel
const renaming = ref<{ type: string; id: string } | null>(null);
const renameText = ref('');
const renameInputEl = ref<HTMLInputElement | null>(null);
function setRenameInputRef(el: Element | ComponentPublicInstance | null) { renameInputEl.value = el as HTMLInputElement | null; }
const confirm = ref<{ type: string; id: string; action: string } | null>(null);   // two-step delete/reset
let confirmTimer: number | undefined;
const importTarget = ref<string | null>(null);   // collection id the hidden build-file input is armed for
const buildFileInput = ref<HTMLInputElement | null>(null);
const collectionFileInput = ref<HTMLInputElement | null>(null);

const buildById = computed(() => new Map(builds.value.map((build) => [build.id, build])));

const fsSupported = fsStore.supported;

function buildsIn(collection: Collection): Build[] {
  return collection.buildIds.map((id) => buildById.value.get(id)).filter((b): b is Build => Boolean(b));
}

function isExpanded(id: string) {
  return !collapsed[id];
}

function toggleExpanded(id: string) {
  collapsed[id] = !collapsed[id];
}

/** Metadata (name/membership) differs from last saved, or any build it contains is
 * itself dirty -- either is "this collection has something unsaved in it". */
function collectionDirty(collection: Collection) {
  const saved = savedCollections.value[collection.id];
  if (!saved || saved.name !== collection.name
    || saved.buildIds.length !== collection.buildIds.length
    || saved.buildIds.some((id, index) => id !== collection.buildIds[index])) return true;
  return collection.buildIds.some((id) => dirtyByBuild.value[id]);
}

// --- menus ---------------------------------------------------------------------------

function isMenuOpen(type: string, id: string) {
  return openMenu.value?.type === type && openMenu.value?.id === id;
}

/**
 * `.build-nav` is its own scrolling container (full page height, see this file's own
 * `<style>` block) -- a
 * `position: absolute` menu clipped at its bottom edge for any row near the end of the
 * list, which is exactly the "bugs weirdly on the last tabs" report. `position: fixed`
 * escapes that clipping the same way `.itemcard` does in SlotList.vue, so the menu's
 * coordinates have to be computed from the trigger's own viewport rect instead of just
 * `right: 0` inside a `position: relative` wrapper.
 */
function openMenuFor(type: string, id: string, event: MouseEvent) {
  saveAsFor.value = null;
  if (isMenuOpen(type, id)) {
    openMenu.value = null;
    return;
  }
  const wrap = (event.currentTarget as HTMLElement).closest('.nav-row')?.querySelector('.nav-menu-wrap') as HTMLElement;
  const rect = wrap.getBoundingClientRect();
  menuPos.top = rect.bottom + 2;
  menuPos.left = rect.right;
  openMenu.value = { type, id };

  // Flip above the trigger if the menu (measured once it exists) would run off the
  // bottom of the viewport -- same technique as SlotList.vue's `place()`.
  nextTick(() => {
    const menu = root.value?.querySelector('.navmenu') as HTMLElement | null;
    if (!menu) return;
    const margin = 8;
    if (menuPos.top + menu.offsetHeight <= window.innerHeight - margin) return;
    menuPos.top = Math.max(rect.top - menu.offsetHeight - 2, margin);
  });
}

function closeMenu() {
  openMenu.value = null;
  saveAsFor.value = null;
}

/** Closes any open menu/confirm when a click lands outside the sidebar entirely --
 * inside it, each control (menu, rename input) already closes itself on its own action. */
function onDocumentClick(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('.navmenu')) return;
  closeMenu();
}

/** The menu is `position: fixed`, anchored at open time -- if the sidebar (or the page)
 * scrolls afterward, the anchor point moves out from under it, so close it rather than
 * leave it floating over the wrong row. Capture phase, same as SlotList.vue's own
 * `onScroll`, so it fires for the sidebar's internal scroll too. */
function onScroll(event: Event) {
  if (!openMenu.value || (event.target as HTMLElement)?.closest?.('.navmenu')) return;
  closeMenu();
}

// --- rename (both collection and build rows share this) -------------------------------

function isRenaming(type: string, id: string) {
  return renaming.value?.type === type && renaming.value?.id === id;
}

function startRename(type: string, id: string, name: string) {
  closeMenu();
  renaming.value = { type, id };
  renameText.value = name;
  nextTick(() => renameInputEl.value?.focus());
}

function commitRename() {
  if (!renaming.value) return;
  const { type, id } = renaming.value;
  const name = renameText.value.trim();
  renaming.value = null;
  if (!name) return;
  if (type === 'collection') library.renameCollection(id, name);
  else { library.selectBuildById(id); buildEditor.renameBuild(name); }
}

// --- per-build actions (select the row's build active first, then delegate) -------------
// A row's build isn't necessarily the active one, and every undo-tracked action (save,
// revert, rename, reset) only ever operates on "whichever build is active".

function saveBuild(id: string) { library.selectBuildById(id); buildEditor.saveActive(); }
function revertBuild(id: string) { library.selectBuildById(id); buildEditor.revertActive(); }
function duplicateBuildRow(id: string) { library.selectBuildById(id); library.duplicateBuild(); }
function resetBuild(id: string) { library.selectBuildById(id); buildEditor.resetAll(); }
function deleteBuildRow(id: string) { library.selectBuildById(id); library.removeBuild(); }

// --- two-step confirm for delete/reset --------------------------------------------------

function isConfirming(type: string, id: string, action: string) {
  return confirm.value?.type === type && confirm.value?.id === id && confirm.value?.action === action;
}

function confirmLabel(type: string, id: string, action: string, label: string) {
  return isConfirming(type, id, action) ? 'Really?' : label;
}

/** `run` is the actual action, invoked only once the same trigger has been clicked twice in
 * a row (within `CONFIRM_MS`) -- same two-step confirm as before, just carrying a closure
 * instead of an event name for `emit` to forward. */
function runConfirmed(type: string, id: string, action: string, run: () => void) {
  if (!isConfirming(type, id, action)) {
    confirm.value = { type, id, action };
    window.clearTimeout(confirmTimer);
    confirmTimer = window.setTimeout(() => { confirm.value = null; }, CONFIRM_MS);
    return;
  }
  window.clearTimeout(confirmTimer);
  confirm.value = null;
  run();
  closeMenu();
}

// --- save as -----------------------------------------------------------------------------

function toggleSaveAs(id: string) {
  saveAsFor.value = saveAsFor.value === id ? null : id;
}

function saveAsStorage(id: string) {
  library.duplicateCollection(id);
  closeMenu();
}

function saveAsFile(id: string) {
  library.saveCollectionAs(id, 'file');
  closeMenu();
}

// --- import --------------------------------------------------------------------------

function triggerImportBuild(collectionId: string) {
  importTarget.value = collectionId;
  buildFileInput.value?.click();
}

async function onImportBuildFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  const collectionId = importTarget.value;
  input.value = '';
  if (!file || !collectionId) return;
  library.importBuildsIn(collectionId, await file.text());
}

function triggerImportCollection() {
  collectionFileInput.value?.click();
}

async function onImportCollectionFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  library.importCollectionText(await file.text());
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentClick);
  window.addEventListener('scroll', onScroll, true);
});

onUnmounted(() => {
  window.clearTimeout(confirmTimer);
  document.removeEventListener('mousedown', onDocumentClick);
  window.removeEventListener('scroll', onScroll, true);
});
</script>

<template>
  <!-- Stacks above the builder below `lg`, matching App.vue's own `.page` breakpoint -- a
       sticky full-height sidebar makes no sense once the two are stacked instead of
       side-by-side. -->
  <nav class="flex flex-none flex-col gap-0.5 overflow-y-auto border-b border-line bg-surface p-2 text-sm lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:border-b-0 lg:border-r" ref="root">
    <div v-for="collection in collections" :key="collection.id" class="mb-1">
      <div class="nav-row nav-row--collection relative flex items-center gap-1 rounded-md px-1 py-1 font-semibold"
           :class="collection.id === activeCollectionId && 'is-active'">
        <button type="button" class="w-4 flex-none cursor-pointer px-0.5 text-muted" @click="toggleExpanded(collection.id)">
          {{ isExpanded(collection.id) ? '▾' : '▸' }}
        </button>

        <input v-if="isRenaming('collection', collection.id)" :ref="setRenameInputRef" v-model="renameText"
               class="nav-rename min-w-0 flex-1 rounded-md border border-line bg-surface px-1 py-0.5"
               @keydown.enter="commitRename" @keydown.esc="renaming = null" @blur="commitRename">
        <button v-else type="button"
                class="nav-name min-w-0 flex-1 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap py-0.5 text-left"
                :class="collection.id === activeCollectionId && 'underline'"
                @click="library.selectCollection(collection.id)"
                @dblclick="startRename('collection', collection.id, collection.name)"
                @contextmenu.prevent="openMenuFor('collection', collection.id, $event)">
          {{ collection.name }}
        </button>

        <UnsavedDot v-if="collectionDirty(collection)" title="Unsaved changes" />

        <div class="nav-menu-wrap relative">
          <button type="button" class="nav-kebab flex-none cursor-pointer rounded-md px-1.5 leading-none text-muted hover:bg-surface-2 hover:text-text"
                  title="Collection menu" @click="openMenuFor('collection', collection.id, $event)">⋮</button>

          <div v-if="isMenuOpen('collection', collection.id)" class="navmenu fixed z-30 flex min-w-48 -translate-x-full flex-col rounded-md border border-line bg-surface p-1 shadow-lg"
               :style="{ top: menuPos.top + 'px', left: menuPos.left + 'px' }">
            <button type="button" class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                    @click="startRename('collection', collection.id, collection.name)">Rename</button>
            <button type="button" class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                    @click="library.saveCollection(collection.id); closeMenu()">Save</button>
            <button type="button" class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                    @click="toggleSaveAs(collection.id)">Save As…</button>
            <div v-if="saveAsFor === collection.id" class="my-0.5 ml-2 flex flex-col border-l-2 border-line">
              <button type="button" class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                      @click="saveAsStorage(collection.id)">Browser storage (new copy)</button>
              <button type="button" class="rounded-md px-2 py-1 text-left enabled:cursor-pointer disabled:text-muted enabled:hover:bg-surface-2"
                      :disabled="!fsSupported"
                      :title="fsSupported ? '' : 'This browser cannot keep a file linked -- use Export instead'"
                      @click="saveAsFile(collection.id)">File on this PC…</button>
            </div>
            <button type="button" class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                    @click="library.duplicateCollection(collection.id); closeMenu()">Duplicate</button>
            <button type="button" class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                    @click="library.exportCollection(collection.id); closeMenu()">Export…</button>
            <button type="button" class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-danger-soft hover:text-danger"
                    @click="runConfirmed('collection', collection.id, 'delete-collection', () => library.deleteCollection(collection.id))">
              {{ confirmLabel('collection', collection.id, 'delete-collection', 'Delete') }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="isExpanded(collection.id)" class="ml-1.5 border-l border-accent">
        <div v-for="build in buildsIn(collection)" :key="build.id"
             class="nav-row nav-row--build relative flex items-center gap-1 rounded-md py-1 pl-5 pr-1"
             :class="build.id === activeId && 'is-active bg-accent-soft'">
          <input v-if="isRenaming('build', build.id)" :ref="setRenameInputRef" v-model="renameText"
                 class="nav-rename min-w-0 flex-1 rounded-md border border-line bg-surface px-1 py-0.5"
                 @keydown.enter="commitRename" @keydown.esc="renaming = null" @blur="commitRename">
          <button v-else type="button"
                  class="nav-name min-w-0 flex-1 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap py-0.5 text-left"
                  @click="library.selectBuild(collection.id, build.id)"
                  @dblclick="startRename('build', build.id, build.name)"
                  @contextmenu.prevent="openMenuFor('build', build.id, $event)">
            {{ build.name }}
          </button>

          <UnsavedDot v-if="dirtyByBuild[build.id]" title="Unsaved changes" />

          <div class="nav-menu-wrap relative">
            <button type="button" class="nav-kebab flex-none cursor-pointer rounded-md px-1.5 leading-none text-muted hover:bg-surface-2 hover:text-text"
                    title="Build menu" @click="openMenuFor('build', build.id, $event)">⋮</button>

            <div v-if="isMenuOpen('build', build.id)" class="navmenu fixed z-30 flex min-w-48 -translate-x-full flex-col rounded-md border border-line bg-surface p-1 shadow-lg"
                 :style="{ top: menuPos.top + 'px', left: menuPos.left + 'px' }">
              <button type="button" class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                      @click="startRename('build', build.id, build.name)">Rename</button>
              <button type="button" class="rounded-md px-2 py-1 text-left enabled:cursor-pointer disabled:text-muted enabled:hover:bg-surface-2"
                      :disabled="!dirtyByBuild[build.id]" @click="saveBuild(build.id); closeMenu()">Save</button>
              <button type="button" class="rounded-md px-2 py-1 text-left enabled:cursor-pointer disabled:text-muted enabled:hover:bg-surface-2"
                      :disabled="!dirtyByBuild[build.id]" @click="revertBuild(build.id); closeMenu()">Revert</button>
              <button type="button" class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                      @click="duplicateBuildRow(build.id); closeMenu()">Duplicate</button>
              <button type="button" class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                      @click="library.exportBuild(build.id); closeMenu()">Export…</button>
              <button type="button" class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                      @click="runConfirmed('build', build.id, 'reset-build', () => resetBuild(build.id))">
                {{ confirmLabel('build', build.id, 'reset-build', 'Reset') }}
              </button>
              <button type="button" class="rounded-md px-2 py-1 text-left enabled:cursor-pointer disabled:text-muted enabled:hover:bg-danger-soft enabled:hover:text-danger"
                      :disabled="buildsIn(collection).length < 2"
                      @click="runConfirmed('build', build.id, 'delete-build', () => deleteBuildRow(build.id))">
                {{ confirmLabel('build', build.id, 'delete-build', 'Delete') }}
              </button>
            </div>
          </div>
        </div>

        <div class="nav-row--actions flex items-center gap-2.5 pl-5 text-muted">
          <Button variant="link" @click="library.createBuildIn(collection.id)">+ New build</Button>
          <Button variant="link" @click="triggerImportBuild(collection.id)">Import</Button>
        </div>
      </div>
    </div>

    <div class="nav-row--actions mt-1 flex items-center gap-2.5 border-t border-line pl-1 pt-1.5 text-muted">
      <Button variant="link" @click="library.createCollection()">+ New collection</Button>
      <Button variant="link" @click="triggerImportCollection">Import collection</Button>
    </div>

    <input ref="buildFileInput" type="file" accept=".json,application/json" class="hidden"
           @change="onImportBuildFile">
    <input ref="collectionFileInput" type="file" accept=".json,application/json" class="hidden"
           @change="onImportCollectionFile">
  </nav>
</template>
