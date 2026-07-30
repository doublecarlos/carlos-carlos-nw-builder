// The build/collection library: the flat pool of builds, the collections grouping layer over
// it, which build/collection is active, last-saved snapshots (for dirty-checking and revert),
// and file links for collections saved to disk. Bootstraps itself, including honouring a
// `?build=`/`collection=` already in the URL on first load.
import { computed, ref, watch } from 'vue';
import * as storage from '../storage';
import * as router from '../router';
import * as fsStore from '../fs-store';
import { flagStorageFailed, showNotice } from './notice';
import type { Build, Collection } from '../types';

const SAVE_DEBOUNCE_MS = 250;

// --- bootstrap ---------------------------------------------------------------------------

const savedLibrary = storage.loadLibrary();
const draftLibrary = storage.loadDraft(savedLibrary);
const savedCollectionsState = storage.loadCollections(savedLibrary.builds);
const draftCollectionsState = storage.loadCollectionsDraft(draftLibrary.builds, savedCollectionsState);

const initialRoute = router.parse();
const ownerOf = (buildId: string) => draftCollectionsState.collections.find((c) => c.buildIds.includes(buildId));

let initialActiveId: string;
let initialActiveCollectionId: string;
const owner = initialRoute.build && draftLibrary.builds.some((b) => b.id === initialRoute.build) && ownerOf(initialRoute.build);
if (owner) {
  initialActiveId = initialRoute.build;
  initialActiveCollectionId = owner.id;
} else {
  initialActiveCollectionId = draftCollectionsState.collections.some((c) => c.id === initialRoute.collection)
    ? initialRoute.collection
    : draftCollectionsState.activeCollectionId;
  // Non-null: `initialActiveCollectionId` is always either a real collection id or
  // `draftCollectionsState.activeCollectionId`, and `collections` is never empty (storage.ts's
  // `loadCollections`/`loadCollectionsDraft` guarantee at least one).
  const collection = draftCollectionsState.collections.find((c) => c.id === initialActiveCollectionId)!;
  initialActiveId = collection.buildIds.includes(collection.activeBuildId)
    ? collection.activeBuildId
    : collection.buildIds[0];
}

const initialSavedById: Record<string, Build> = {};
for (const b of savedLibrary.builds) initialSavedById[b.id] = b;
const initialSavedCollections: Record<string, Collection> = {};
for (const c of savedCollectionsState.collections) initialSavedCollections[c.id] = c;

// --- state (module-private; see each export's own readonly/computed wrapper) --------------

const _builds = ref<Build[]>(draftLibrary.builds);
const _activeId = ref<string>(initialActiveId);
const _savedById = ref<Record<string, Build>>(initialSavedById);
const _collections = ref<Collection[]>(draftCollectionsState.collections);
const _activeCollectionId = ref<string>(initialActiveCollectionId);
const _savedCollections = ref<Record<string, Collection>>(initialSavedCollections);
// FileSystemFileHandle per collection id, for collections linked to a file on disk. Populated
// lazily -- never eagerly from `fsStore`'s IndexedDB, since using a handle needs a user gesture
// (Chromium re-checks permission per session) anyway, so there's nothing to gain fetching it
// before a Save is actually clicked.
const _fileLinks = ref<Record<string, FileSystemFileHandle>>({});

// Exported as `computed`, not the raw refs above: a `computed` has no setter, so reassigning
// `library.builds.value` from outside is already a compile error. Nested-field mutation isn't
// runtime-blocked (Vue's `readonly()` would deep-freeze types incompatibly with `Build`-typed
// utilities elsewhere) -- that discipline is a convention: call a named action below instead.
export const builds = computed(() => _builds.value);
export const activeId = computed(() => _activeId.value);
export const savedById = computed(() => _savedById.value);
export const collections = computed(() => _collections.value);
export const activeCollectionId = computed(() => _activeCollectionId.value);
export const savedCollections = computed(() => _savedCollections.value);

const activeBuild = computed(() => _builds.value.find((b) => b.id === _activeId.value) ?? _builds.value[0]);
export const build = activeBuild;

/** The active build's content, named distinctly from `build` above to flag every call site
 * that's about to write into it: only buildEditor.ts (snapshot-tracked content edits) and
 * compare.ts (the deliberately-untracked compare-picker fields) call this. Everything else
 * reads `build` and calls a named action to change something. */
export function activeBuildForEdit() {
  return activeBuild.value;
}

const activeCollection = computed(() => _collections.value.find((c) => c.id === _activeCollectionId.value) ?? _collections.value[0]);

/** buildId -> bool, for Library's per-tab unsaved-dot -- same comparison `dirty` below does
 * for just the active build, extended to every build in the pool. */
export const dirtyByBuild = computed(() => {
  const map: Record<string, boolean> = {};
  for (const b of _builds.value) map[b.id] = !storage.sameBuild(b, _savedById.value[b.id]);
  return map;
});

/** Compared against the saved copy, not a plain equality: `storage.sameBuild` is key-order-
 * insensitive and ignores `updated`, or a save-then-revert would read as still dirty. */
export const dirty = computed(() => !storage.sameBuild(build.value, _savedById.value[_activeId.value]));

/** The active collection's other builds, for BuildEditor.vue's per-section "copy from" control.
 * Scoped to the collection, not every build in the app -- collections exist to group related
 * builds, and that's the set a "copy a section over" is actually useful against. */
export const otherBuildsInCollection = computed(() => {
  const ids = new Set(activeCollection.value.buildIds);
  return _builds.value
    .filter((b) => b.id !== _activeId.value && ids.has(b.id))
    .map((b) => ({ value: b.id, label: b.name }));
});

// --- mutation (the only way to change the state above) ------------------------------------

/** Replaces the active build's content in place -- undo/redo and reset use this, so it lives
 * here (the store owning the `builds` array) rather than in buildEditor.ts. */
export function replaceActive(newBuild: Build) {
  const index = _builds.value.findIndex((item) => item.id === _activeId.value);
  if (index === -1) _builds.value.push(newBuild);
  else _builds.value.splice(index, 1, newBuild);
  _activeId.value = newBuild.id;
}

export function selectCollection(id: string) {
  const collection = _collections.value.find((c) => c.id === id);
  if (!collection) return;
  _activeCollectionId.value = id;
  _activeId.value = collection.buildIds.includes(collection.activeBuildId)
    ? collection.activeBuildId
    : collection.buildIds[0];
}

/** Also remembers it as that collection's own `activeBuildId`, so reopening the collection
 * later returns to the same tab. */
export function selectBuild(collectionId: string, id: string) {
  const collection = _collections.value.find((c) => c.id === collectionId);
  if (!collection || !collection.buildIds.includes(id)) return;
  _activeCollectionId.value = collectionId;
  _activeId.value = id;
  collection.activeBuildId = id;
}

export function ownerOfBuild(buildId: string) {
  return _collections.value.find((c) => c.buildIds.includes(buildId));
}

/** Makes a build active (and its collection) without needing the caller to know which
 * collection it lives in -- Library's per-build tab menu (save/revert/duplicate/reset/
 * delete/rename) selects a build this way before delegating to buildEditor.ts. */
export function selectBuildById(id: string) {
  const owner = ownerOfBuild(id);
  if (owner) selectBuild(owner.id, id);
}

/** Promotes a build's current content to its saved snapshot -- buildEditor.ts's Save button
 * (`saveActive`) is the only caller. */
export function markBuildSaved(id: string, snapshot: Build) {
  _savedById.value[id] = snapshot;
  persistSaved();
}

/** Restores active collection/build straight from the URL (browser back/forward) -- unlike
 * `selectCollection`/`selectBuild`, doesn't touch a collection's own `activeBuildId`, since
 * this is catching the app up to navigation that already happened rather than a fresh pick. */
export function restoreFromRoute(collectionId: string | undefined, buildId: string | undefined) {
  if (collectionId && _collections.value.some((c) => c.id === collectionId)) {
    _activeCollectionId.value = collectionId;
  }
  if (buildId && _builds.value.some((b) => b.id === buildId)) {
    _activeId.value = buildId;
  }
}

// --- library: create/duplicate/delete/import/export ----------------------------------------
// These save themselves immediately, unlike an ordinary content edit: there is nothing
// pending to lose, since a just-built build's saved copy starts out identical to it.

export function createBuild() {
  const newBuild = storage.defaultBuild(`Build ${_builds.value.length + 1}`);
  _builds.value.push(newBuild);
  _savedById.value[newBuild.id] = storage.cloneBuild(newBuild);
  activeCollection.value.buildIds.push(newBuild.id);
  activeCollection.value.activeBuildId = newBuild.id;
  _activeId.value = newBuild.id;
  syncSavedCollection(activeCollection.value);
  persistSaved();
  persistSavedCollections();
}

/** Library's per-collection "+ New build" -- makes that collection active first (a no-op if
 * it already is) so the new build lands in it. */
export function createBuildIn(collectionId: string) {
  selectCollection(collectionId);
  createBuild();
}

export function duplicateBuild() {
  const copy = storage.duplicate(build.value);
  _builds.value.push(copy);
  _savedById.value[copy.id] = storage.cloneBuild(copy);
  activeCollection.value.buildIds.push(copy.id);
  activeCollection.value.activeBuildId = copy.id;
  _activeId.value = copy.id;
  showNotice(`Duplicated as “${copy.name}”`);
  syncSavedCollection(activeCollection.value);
  persistSaved();
  persistSavedCollections();
}

/** Guarded per collection (at least one build must remain in it), not globally -- how many
 * builds exist in *other* collections is irrelevant to whether this one can lose its last tab. */
export function removeBuild() {
  const collection = activeCollection.value;
  if (collection.buildIds.length < 2) return;
  const index = _builds.value.findIndex((item) => item.id === _activeId.value);
  const [removed] = _builds.value.splice(index, 1);
  delete _savedById.value[removed.id];
  const buildIndex = collection.buildIds.indexOf(removed.id);
  collection.buildIds.splice(buildIndex, 1);
  _activeId.value = collection.buildIds[Math.min(buildIndex, collection.buildIds.length - 1)];
  collection.activeBuildId = _activeId.value;
  showNotice(`Deleted “${removed.name}”`);
  syncSavedCollection(collection);
  persistSaved();
  persistSavedCollections();
}

export function importBuilds(newBuilds: Build[]) {
  _builds.value.push(...newBuilds);
  for (const b of newBuilds) _savedById.value[b.id] = storage.cloneBuild(b);
  activeCollection.value.buildIds.push(...newBuilds.map((b) => b.id));
  _activeId.value = newBuilds[newBuilds.length - 1].id;
  activeCollection.value.activeBuildId = _activeId.value;
  showNotice(`Imported ${newBuilds.length} build(s)`);
  syncSavedCollection(activeCollection.value);
  persistSaved();
  persistSavedCollections();
}

export function importBuildsIn(collectionId: string, text: string) {
  selectCollection(collectionId);
  try {
    const { builds, catalogStale } = storage.parseJson(text);
    importBuilds(builds);
    if (catalogStale) {
      showNotice(`Imported ${builds.length} build(s) — made against an older item catalogue; some items may no longer resolve`);
    }
  } catch (error: any) {
    showNotice(`That file could not be read: ${error.message ?? error}`);
  }
}

/** A single build's own JSON download. Same Blob/anchor technique as `exportCollection`. */
export function exportBuild(id: string) {
  const b = _builds.value.find((item) => item.id === id);
  if (!b) return;
  downloadJson(storage.toBuildJson(b), `${b.name.replace(/[^\w.-]+/g, '-') || 'build'}.json`);
}

// --- collections -----------------------------------------------------------------------------

export function createCollection() {
  const newBuild = storage.defaultBuild('New build');
  const collection = storage.defaultCollection(`Collection ${_collections.value.length + 1}`, newBuild);
  _builds.value.push(newBuild);
  _savedById.value[newBuild.id] = storage.cloneBuild(newBuild);
  _collections.value.push(collection);
  _savedCollections.value[collection.id] = { ...collection, buildIds: [...collection.buildIds] };
  _activeCollectionId.value = collection.id;
  _activeId.value = newBuild.id;
  persistSaved();
  persistSavedCollections();
}

export function renameCollection(id: string, name: string) {
  const collection = _collections.value.find((c) => c.id === id);
  if (collection) collection.name = name;
}

export function duplicateCollection(id: string) {
  const source = _collections.value.find((c) => c.id === id);
  if (!source) return;
  const buildsById = Object.fromEntries(_builds.value.map((b) => [b.id, b]));
  const { collection, builds: newBuilds } = storage.duplicateCollection(source, buildsById);
  _builds.value.push(...newBuilds);
  for (const b of newBuilds) _savedById.value[b.id] = storage.cloneBuild(b);
  _collections.value.push(collection);
  _savedCollections.value[collection.id] = { ...collection, buildIds: [...collection.buildIds] };
  _activeCollectionId.value = collection.id;
  _activeId.value = collection.activeBuildId;
  showNotice(`Duplicated as “${collection.name}”`);
  persistSaved();
  persistSavedCollections();
}

/** Guarded so at least one collection always remains. Drops its builds from the flat pool
 * entirely (nothing else can reference them once their collection is gone) and its file link. */
export function deleteCollection(id: string) {
  if (_collections.value.length < 2) return;
  const index = _collections.value.findIndex((c) => c.id === id);
  if (index === -1) return;
  const [removed] = _collections.value.splice(index, 1);
  for (const buildId of removed.buildIds) {
    const buildIndex = _builds.value.findIndex((b) => b.id === buildId);
    if (buildIndex !== -1) _builds.value.splice(buildIndex, 1);
    delete _savedById.value[buildId];
  }
  delete _savedCollections.value[removed.id];
  delete _fileLinks.value[removed.id];
  fsStore.deleteHandle(removed.id);
  const next = _collections.value[Math.min(index, _collections.value.length - 1)];
  _activeCollectionId.value = next.id;
  _activeId.value = next.activeBuildId;
  showNotice(`Deleted “${removed.name}”`);
  persistSaved();
  persistSavedCollections();
}

/** `fileLinks[id]` only holds a handle picked *this session* (Save As -> File on this PC) --
 * a reload loses that in-memory link even though the handle itself is still sitting in
 * `fsStore`'s IndexedDB, so a Save has to fall back to looking it up there. */
async function fileHandleFor(id: string) {
  if (_fileLinks.value[id]) return _fileLinks.value[id];
  const handle = await fsStore.getHandle(id);
  if (handle) _fileLinks.value[id] = handle;
  return handle;
}

async function writeCollectionFile(id: string, handle: FileSystemFileHandle) {
  const collection = _collections.value.find((c) => c.id === id);
  if (!collection) return;
  try {
    if (!(await fsStore.verifyPermission(handle))) throw new Error('permission denied');
    const buildsById = Object.fromEntries(_builds.value.map((b) => [b.id, b]));
    const bundle = storage.bundleCollection(collection, buildsById);
    await fsStore.writeText(handle, storage.toCollectionJson(bundle));
  } catch (error: any) {
    delete _fileLinks.value[id];
    showNotice(`Could not write “${collection.name}” to its linked file: ${error.message ?? error}`);
  }
}

/** Commits every build the collection contains (same promotion `saveActive` does for just
 * the active one) and persists the grouping, then -- if linked to a file -- writes it there. */
export async function saveCollection(id: string) {
  const collection = _collections.value.find((c) => c.id === id);
  if (!collection) return;
  for (const buildId of collection.buildIds) {
    const b = _builds.value.find((item) => item.id === buildId);
    if (b) _savedById.value[buildId] = { ...storage.cloneBuild(b), updated: Date.now() };
  }
  _savedCollections.value[id] = { ...collection, buildIds: [...collection.buildIds] };
  persistSaved();
  persistSavedCollections();
  const handle = await fileHandleFor(id);
  if (handle) await writeCollectionFile(id, handle);
}

/** `target: 'storage'` is just `duplicateCollection` under another name; `target: 'file'`
 * picks a file, links it to *this* collection going forward, and writes it immediately. */
export async function saveCollectionAs(id: string, target: string) {
  if (target === 'storage') {
    duplicateCollection(id);
    return;
  }
  const collection = _collections.value.find((c) => c.id === id);
  if (!collection || !fsStore.supported) return;
  try {
    const suggested = `${collection.name.replace(/[^\w.-]+/g, '-') || 'collection'}.json`;
    const handle = await fsStore.pickSaveFile(suggested);
    _fileLinks.value[id] = handle;
    await fsStore.setHandle(id, handle);
    await saveCollection(id);
    showNotice(`“${collection.name}” now saves to that file`);
  } catch (error: any) {
    if (error?.name !== 'AbortError') {
      showNotice(`Could not link that file: ${error.message ?? error}`);
    }
  }
}

/** A one-shot download, no persistent link -- distinct from Save As -> File, which
 * remembers the file for future Saves. */
export function exportCollection(id: string) {
  const collection = _collections.value.find((c) => c.id === id);
  if (!collection) return;
  const buildsById = Object.fromEntries(_builds.value.map((b) => [b.id, b]));
  const bundle = storage.bundleCollection(collection, buildsById);
  downloadJson(storage.toCollectionJson(bundle), `${collection.name.replace(/[^\w.-]+/g, '-') || 'collection'}.json`);
}

export function importCollectionText(text: string) {
  try {
    const { collection, builds: newBuilds, catalogStale } = storage.parseCollectionJson(text);
    _builds.value.push(...newBuilds);
    for (const b of newBuilds) _savedById.value[b.id] = storage.cloneBuild(b);
    _collections.value.push(collection);
    _savedCollections.value[collection.id] = { ...collection, buildIds: [...collection.buildIds] };
    _activeCollectionId.value = collection.id;
    _activeId.value = collection.activeBuildId;
    const stale = catalogStale ? ' — made against an older item catalogue; some items may no longer resolve' : '';
    showNotice(`Imported “${collection.name}” (${newBuilds.length} build(s))${stale}`);
    persistSaved();
    persistSavedCollections();
  } catch (error: any) {
    showNotice(`That collection file could not be read: ${error.message ?? error}`);
  }
}

// --- a share link's build joins the pool ----------------------------------------------------

/** Adds a build decoded from a `#b=…` share link, once the payload is decoded. */
export function addSharedBuild(shared: Build) {
  _builds.value.push(shared);
  _savedById.value[shared.id] = storage.cloneBuild(shared);
  _activeId.value = shared.id;
  showNotice(`Opened “${shared.name}” from a share link`);
  persistSaved();
}

// --- persistence -----------------------------------------------------------------------------

/** Writes `savedById` as it stands right now to `nw:builds`. Shared by the explicit Save
 * button (buildEditor.ts's `saveActive`) and by structural changes that save themselves
 * immediately. */
export function persistSaved() {
  const ok = storage.saveLibrary({ builds: Object.values(_savedById.value), activeId: _activeId.value });
  if (!ok) flagStorageFailed('Could not save to localStorage — export your build to keep it.');
}

export function persistSavedCollections() {
  const ok = storage.saveCollections({
    collections: Object.values(_savedCollections.value),
    activeCollectionId: _activeCollectionId.value,
  });
  if (!ok) flagStorageFailed('Could not save to localStorage — export your build to keep it.');
}

/** Refreshes `savedCollections[id]`'s own membership snapshot to match the live collection --
 * the structural methods above promote a build's *content* into `savedById` themselves but
 * would otherwise leave the collection's saved copy missing the build id they just added or
 * removed, showing a false "unsaved" dot forever after. */
function syncSavedCollection(collection: Collection) {
  _savedCollections.value[collection.id] = { ...collection, buildIds: [...collection.buildIds] };
}

function saveDraft() {
  const ok = storage.saveDraft({ builds: _builds.value, activeId: _activeId.value });
  if (!ok) flagStorageFailed('Could not save to localStorage — export your build to keep it.');
}

function saveCollectionsDraft() {
  const ok = storage.saveCollectionsDraft({
    collections: _collections.value,
    activeCollectionId: _activeCollectionId.value,
  });
  if (!ok) flagStorageFailed('Could not save to localStorage — export your build to keep it.');
}

function downloadJson(text: string, filename: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

let saveTimer: number | undefined;
let collectionsSaveTimer: number | undefined;

// The draft autosaves continuously -- this is "don't lose work on a reload", not "save my
// changes" (that's `saveActive()` in buildEditor.ts, wired to the Save button).
watch(_builds, () => {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveDraft(), SAVE_DEBOUNCE_MS);
}, { deep: true });

watch(_collections, () => {
  window.clearTimeout(collectionsSaveTimer);
  collectionsSaveTimer = window.setTimeout(() => saveCollectionsDraft(), SAVE_DEBOUNCE_MS);
}, { deep: true });
