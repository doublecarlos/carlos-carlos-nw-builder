<script setup lang="ts">
// Left sidebar: collections of builds, replacing the old dropdown-based build switcher in
// BuildBar.vue. A collection is a named group of build tabs that can be saved (browser storage
// or a linked file, via fs-store.ts) and exported as a whole; an individual build keeps its own
// independent save/revert (BuildBar.vue), unchanged.
//
// Every mutation is emitted to App.vue, same discipline as every other component here -- this
// file only renders the tree and the popup menus, and reads storage.ts/fs-store.ts directly for
// the read-only bits (parsing an imported build file), same as BuildBar.vue already does for
// its own import/export drawer.
import { ref, reactive, computed, nextTick, onMounted, onUnmounted, type ComponentPublicInstance } from 'vue';
import * as fsStore from '../fs-store';
import type { Build, Collection } from '../types';

const CONFIRM_MS = 4000;

const props = defineProps<{
  collections: Collection[];
  builds: Build[];
  activeCollectionId?: string;
  activeId?: string;
  // buildId -> bool, App.vue's `dirtyByBuild` computed (mirrors the existing per-build
  // `dirty` check BuildBar.vue's Save button already gates on).
  dirtyByBuild: Record<string, boolean>;
  // collectionId -> last-saved { name, buildIds }, App.vue's `savedCollections` -- compared
  // against the live `collections` prop to decide a collection's own unsaved-dot.
  savedCollections: Record<string, Collection>;
}>();

const emit = defineEmits<{
  'select-collection': [id: string];
  'select-build': [payload: { collectionId: string; id: string }];
  'create-collection': [];
  'import-collection': [text: string];
  'rename-collection': [payload: { id: string; name: string }];
  'save-collection': [id: string];
  'save-collection-as': [payload: { id: string; target: string }];
  'duplicate-collection': [id: string];
  'export-collection': [id: string];
  'delete-collection': [id: string];
  'create-build': [collectionId: string];
  'import-builds': [payload: { collectionId: string; text: string }];
  'rename-build': [payload: { id: string; name: string }];
  'save-build': [id: string];
  'revert-build': [id: string];
  'duplicate-build': [id: string];
  'export-build': [id: string];
  'reset-build': [id: string];
  'delete-build': [id: string];
}>();

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

const buildById = computed(() => new Map(props.builds.map((build) => [build.id, build])));

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
  const saved = props.savedCollections[collection.id];
  if (!saved || saved.name !== collection.name
    || saved.buildIds.length !== collection.buildIds.length
    || saved.buildIds.some((id, index) => id !== collection.buildIds[index])) return true;
  return collection.buildIds.some((id) => props.dirtyByBuild[id]);
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
  if (type === 'collection') emit('rename-collection', { id, name });
  else emit('rename-build', { id, name });
}

// --- two-step confirm for delete/reset --------------------------------------------------

function isConfirming(type: string, id: string, action: string) {
  return confirm.value?.type === type && confirm.value?.id === id && confirm.value?.action === action;
}

function confirmLabel(type: string, id: string, action: string, label: string) {
  return isConfirming(type, id, action) ? 'Really?' : label;
}

/** `action` names one of this component's own delete/reset events -- always a literal at the
 * call site (see the template), but dynamically forwarded to `emit` here, which no static
 * union of event names makes straightforward without the cast. */
function runConfirmed(type: string, id: string, action: 'delete-collection' | 'reset-build' | 'delete-build') {
  if (!isConfirming(type, id, action)) {
    confirm.value = { type, id, action };
    window.clearTimeout(confirmTimer);
    confirmTimer = window.setTimeout(() => { confirm.value = null; }, CONFIRM_MS);
    return;
  }
  window.clearTimeout(confirmTimer);
  confirm.value = null;
  (emit as (event: string, id: string) => void)(action, id);
  closeMenu();
}

// --- save as -----------------------------------------------------------------------------

function toggleSaveAs(id: string) {
  saveAsFor.value = saveAsFor.value === id ? null : id;
}

function saveAsStorage(id: string) {
  emit('duplicate-collection', id);
  closeMenu();
}

function saveAsFile(id: string) {
  emit('save-collection-as', { id, target: 'file' });
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
  // Parsing (and its error notice) happens in App.vue's `importBuildsIn` -- same `notice`
  // channel as every other library-level error here, rather than a blocking alert().
  emit('import-builds', { collectionId, text: await file.text() });
}

function triggerImportCollection() {
  collectionFileInput.value?.click();
}

async function onImportCollectionFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  emit('import-collection', await file.text());
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
  <nav class="build-nav" ref="root">
    <div v-for="collection in collections" :key="collection.id" class="nav-collection">
      <div class="nav-row nav-row--collection" :class="{ 'is-active': collection.id === activeCollectionId }">
        <button type="button" class="nav-chevron" @click="toggleExpanded(collection.id)">
          {{ isExpanded(collection.id) ? '▾' : '▸' }}
        </button>

        <input v-if="isRenaming('collection', collection.id)" :ref="setRenameInputRef" v-model="renameText"
               class="nav-rename" @keydown.enter="commitRename" @keydown.esc="renaming = null"
               @blur="commitRename">
        <button v-else type="button" class="nav-name" @click="$emit('select-collection', collection.id)"
                @dblclick="startRename('collection', collection.id, collection.name)"
                @contextmenu.prevent="openMenuFor('collection', collection.id, $event)">
          {{ collection.name }}
        </button>

        <span v-if="collectionDirty(collection)" class="unsaved-dot" title="Unsaved changes"></span>

        <div class="nav-menu-wrap">
          <button type="button" class="nav-kebab" title="Collection menu"
                  @click="openMenuFor('collection', collection.id, $event)">⋮</button>

          <div v-if="isMenuOpen('collection', collection.id)" class="navmenu"
               :style="{ top: menuPos.top + 'px', left: menuPos.left + 'px' }">
            <button type="button" class="navmenu-item"
                    @click="startRename('collection', collection.id, collection.name)">Rename</button>
            <button type="button" class="navmenu-item" @click="$emit('save-collection', collection.id); closeMenu()">
              Save
            </button>
            <button type="button" class="navmenu-item" @click="toggleSaveAs(collection.id)">Save As…</button>
            <div v-if="saveAsFor === collection.id" class="nav-saveas">
              <button type="button" class="navmenu-item" @click="saveAsStorage(collection.id)">
                Browser storage (new copy)
              </button>
              <button type="button" class="navmenu-item" :disabled="!fsSupported"
                      :title="fsSupported ? '' : 'This browser cannot keep a file linked -- use Export instead'"
                      @click="saveAsFile(collection.id)">
                File on this PC…
              </button>
            </div>
            <button type="button" class="navmenu-item"
                    @click="$emit('duplicate-collection', collection.id); closeMenu()">Duplicate</button>
            <button type="button" class="navmenu-item"
                    @click="$emit('export-collection', collection.id); closeMenu()">Export…</button>
            <button type="button" class="navmenu-item navmenu-item--danger"
                    @click="runConfirmed('collection', collection.id, 'delete-collection')">
              {{ confirmLabel('collection', collection.id, 'delete-collection', 'Delete') }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="isExpanded(collection.id)" class="nav-builds">
        <div v-for="build in buildsIn(collection)" :key="build.id" class="nav-row nav-row--build"
             :class="{ 'is-active': build.id === activeId }">
          <input v-if="isRenaming('build', build.id)" :ref="setRenameInputRef" v-model="renameText"
                 class="nav-rename" @keydown.enter="commitRename" @keydown.esc="renaming = null"
                 @blur="commitRename">
          <button v-else type="button" class="nav-name"
                  @click="$emit('select-build', { collectionId: collection.id, id: build.id })"
                  @dblclick="startRename('build', build.id, build.name)"
                  @contextmenu.prevent="openMenuFor('build', build.id, $event)">
            {{ build.name }}
          </button>

          <span v-if="dirtyByBuild[build.id]" class="unsaved-dot" title="Unsaved changes"></span>

          <div class="nav-menu-wrap">
            <button type="button" class="nav-kebab" title="Build menu"
                    @click="openMenuFor('build', build.id, $event)">⋮</button>

            <div v-if="isMenuOpen('build', build.id)" class="navmenu"
                 :style="{ top: menuPos.top + 'px', left: menuPos.left + 'px' }">
              <button type="button" class="navmenu-item"
                      @click="startRename('build', build.id, build.name)">Rename</button>
              <button type="button" class="navmenu-item"
                      :disabled="!dirtyByBuild[build.id]"
                      @click="$emit('save-build', build.id); closeMenu()">Save</button>
              <button type="button" class="navmenu-item"
                      :disabled="!dirtyByBuild[build.id]"
                      @click="$emit('revert-build', build.id); closeMenu()">Revert</button>
              <button type="button" class="navmenu-item"
                      @click="$emit('duplicate-build', build.id); closeMenu()">Duplicate</button>
              <button type="button" class="navmenu-item"
                      @click="$emit('export-build', build.id); closeMenu()">Export…</button>
              <button type="button" class="navmenu-item"
                      @click="runConfirmed('build', build.id, 'reset-build')">
                {{ confirmLabel('build', build.id, 'reset-build', 'Reset') }}
              </button>
              <button type="button" class="navmenu-item navmenu-item--danger"
                      :disabled="buildsIn(collection).length < 2"
                      @click="runConfirmed('build', build.id, 'delete-build')">
                {{ confirmLabel('build', build.id, 'delete-build', 'Delete') }}
              </button>
            </div>
          </div>
        </div>

        <div class="nav-row nav-row--actions">
          <button type="button" class="link" @click="$emit('create-build', collection.id)">+ New build</button>
          <button type="button" class="link" @click="triggerImportBuild(collection.id)">Import</button>
        </div>
      </div>
    </div>

    <div class="nav-row nav-row--actions nav-row--top">
      <button type="button" class="link" @click="$emit('create-collection')">+ New collection</button>
      <button type="button" class="link" @click="triggerImportCollection">Import collection</button>
    </div>

    <input ref="buildFileInput" type="file" accept=".json,application/json" class="nav-hidden-file"
           @change="onImportBuildFile">
    <input ref="collectionFileInput" type="file" accept=".json,application/json" class="nav-hidden-file"
           @change="onImportCollectionFile">
  </nav>
</template>

<style scoped>

.build-nav {
  flex: none;
  width: 236px;
  height: 100vh;
  position: sticky;
  top: 0;
  overflow-y: auto;
  background: var(--surface);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 1rem;
  padding: 10px 8px;
}

.nav-collection { margin-bottom: 4px; }

.nav-row {
  align-items: center;
  border-radius: var(--radius);
  display: flex;
  gap: 4px;
  padding: 3px 4px;
  position: relative;
}
.nav-row--collection { font-weight: 600; }
.nav-row--build { padding-left: 18px; }
.nav-row--build.is-active { background: var(--accent-soft); }
.nav-row--collection.is-active .nav-name { text-decoration: underline; }
.nav-row--actions { color: var(--muted); gap: 10px; padding-left: 18px; }
.nav-row--build.nav-row--actions { padding-left: 18px; }
.nav-row--top { border-top: 1px solid var(--line); margin-top: 4px; padding-left: 4px; padding-top: 6px; }

.nav-builds {
  margin-left: 5px;
  border-left: 1px solid var(--accent)
}

.nav-chevron {
  background: none;
  border: 0;
  color: var(--muted);
  cursor: pointer;
  flex: none;
  font: inherit;
  padding: 0 2px;
  width: 14px;
}

.nav-name {
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  flex: 1;
  font: inherit;
  min-width: 0;
  overflow: hidden;
  padding: 2px 0;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-rename {
  flex: 1;
  font: inherit;
  min-width: 0;
  padding: 2px 4px;
}

.nav-menu-wrap { position: relative; }

.nav-kebab {
  background: none;
  border: 0;
  border-radius: var(--radius);
  color: var(--muted);
  cursor: pointer;
  flex: none;
  font: inherit;
  line-height: 1;
  padding: 2px 5px;
}
.nav-kebab:hover { background: var(--surface-2); color: var(--text); }

/* `position: fixed`, not `absolute` -- `.build-nav` is a scrolling container in its own right
 * now (full page height), and an absolutely-positioned menu got clipped at its bottom edge for
 * any row near the end of the list. `top`/`left` are computed in `openMenuFor` from the
 * trigger's own viewport rect; `translateX(-100%)` right-aligns the menu to that point, the
 * fixed-position equivalent of the `right: 0` this replaced. */
.navmenu {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .18);
  display: flex;
  flex-direction: column;
  min-width: 190px;
  padding: 4px;
  position: fixed;
  transform: translateX(-100%);
  z-index: 30;
}

.navmenu-item {
  background: none;
  border: 0;
  border-radius: var(--radius);
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 5px 8px;
  text-align: left;
}
.navmenu-item:hover:not(:disabled) { background: var(--surface-2); }
.navmenu-item:disabled { color: var(--muted); cursor: default; }
.navmenu-item--danger:hover:not(:disabled) { background: var(--danger-soft); color: var(--danger); }

.nav-saveas {
  border-left: 2px solid var(--line);
  display: flex;
  flex-direction: column;
  margin: 2px 0 2px 8px;
}

.nav-hidden-file { display: none; }

/* Must come after the base `.build-nav` rule above -- an override with equal specificity
 * defined earlier in the cascade loses the tie to a later rule, which is exactly what left
 * this sidebar stuck at `height: 100vh` under the stacked mobile layout even though
 * `.page`'s own breakpoint (App.vue) had already switched to `flex-direction: column`. */
@media (max-width: 1100px) {
  .build-nav {
    position: static;
    height: auto;
    max-height: none;
    width: auto;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
}
</style>
