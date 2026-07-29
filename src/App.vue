<script setup lang="ts">
// Root component (plan §4.2).
//
// State container, as recommended in the handoff §8.2: one reactive build document plus a
// `computed` that calls `resolveBuild`. No store library -- `resolveBuild` is pure and ~2 ms,
// so recomputing the whole result on every keystroke is cheaper than any incremental machinery
// would be (handoff §6).
//
// Every mutation goes through a method here rather than being written into the build from a
// child component. That is what makes the undo stack a dozen lines instead of a subsystem:
// `snapshot()` runs at exactly one layer, and nothing can edit a build behind its back.
import { ref, computed, watch, onMounted, onUnmounted, markRaw } from 'vue';
import BuildBar from './components/BuildBar.vue';
import BuildNav from './components/BuildNav.vue';
import BonusInspector from './components/BonusInspector.vue';
import ComboBox from './components/ComboBox.vue';
import DataEditor from './components/DataEditor.vue';
import QuickOptions from './components/QuickOptions.vue';
import SlotList from './components/SlotList.vue';
import StatPanel from './components/StatPanel.vue';
import * as storage from './storage';
import * as router from './router';
import * as format from './format';
import * as catalog from './catalog';
import * as engine from './engine';
import * as fsStore from './fs-store';
import type { Build, Collection, CatalogOverlay, ResolvedBuild } from './types';

interface HistoryEntry { json: string; label: string; }
interface BuildHistory { past: HistoryEntry[]; future: HistoryEntry[]; lastKey: string | null; lastAt: number; }
type Resolution = { ok: true; result: ResolvedBuild } | { ok: false; message: string; stack: string };

// Context keys whose title-cased name would read oddly in an undo tooltip.
const FIELD_LABELS: Record<string, string> = {
  combatType: 'Combat type',
  damageType: 'Damage type',
  m32Forte: 'M32 Forte',
  duration: 'Duration (s)',
};

const FORTE_LABELS: Record<string, string> = { primary: 'Forte 1', secondaryA: 'Forte 2A', secondaryB: 'Forte 2B' };

const SAVE_DEBOUNCE_MS = 250;
const UNDO_LIMIT = 50;

// Consecutive edits of the same thing inside this window collapse into one undo step, so
// typing 3589 into a number field is one undo, not four.
const COALESCE_MS = 700;

// --- initial state (was data()) ---------------------------------------------------------
// `builds`/`build` is the live, possibly-unsaved draft, loaded from its own key so a
// reload never loses work in progress. `savedById` is the last-saved copy of each build
// (the `nw:builds` library) -- `dirty` compares the active build against its entry here.
const savedLibrary = storage.loadLibrary();
const draftLibrary = storage.loadDraft(savedLibrary);

// Collections are a grouping layer over the flat pool above -- see storage.ts's own
// "--- collections ---" section comment. Same draft/saved split, same reasoning.
const savedCollectionsState = storage.loadCollections(savedLibrary.builds);
const draftCollectionsState = storage.loadCollectionsDraft(draftLibrary.builds, savedCollectionsState);

// A `?build=`/`collection=`/`view=`/`tab=` from the URL (a refresh, or a back/forward
// landing here) wins over the draft's own idea of what was active, as long as it still
// exists -- a specific `build=` wins over `collection=` (jumping to a build implies
// jumping to whichever collection actually owns it).
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
for (const build of savedLibrary.builds) initialSavedById[build.id] = build;
const initialSavedCollections: Record<string, Collection> = {};
for (const collection of savedCollectionsState.collections) initialSavedCollections[collection.id] = collection;

const builds = ref<Build[]>(draftLibrary.builds);
const activeId = ref<string>(initialActiveId);
const savedById = ref<Record<string, Build>>(initialSavedById);
const collections = ref<Collection[]>(draftCollectionsState.collections);
const activeCollectionId = ref<string>(initialActiveCollectionId);
const savedCollections = ref<Record<string, Collection>>(initialSavedCollections);
// FileSystemFileHandle per collection id, for collections linked to a file on disk
// (BuildNav's collection menu -> Save As -> File on this PC). Populated lazily --
// never eagerly from `fsStore`'s IndexedDB on load, since using a handle needs a user
// gesture (Chromium re-checks permission per session) anyway, so there's nothing to
// gain by fetching it before a Save is actually clicked.
const fileLinks = ref<Record<string, FileSystemFileHandle>>({});
// The editor's layer over the shipped catalogue. Persisted separately from builds --
// it is a workspace, not part of any one build.
const workspaceOverlay = ref<CatalogOverlay>(storage.loadOverlay());
const view = ref<'builder' | 'editor'>(initialRoute.view === 'editor' ? 'editor' : 'builder');

// buildId -> { past, future, … } of JSON snapshots. Per build, so switching away and
// back preserves what you could undo. Strings, so Vue does not deep-proxy 50 copies.
// Never persisted: history is a session concept, not part of the document.
const histories = ref<Record<string, BuildHistory>>({});

const tab = ref<'stats' | 'bonuses'>(initialRoute.tab === 'bonuses' ? 'bonuses' : 'stats');
let saveTimer: number | undefined;
let collectionsSaveTimer: number | undefined;
let noticeTimer: number | undefined;
const notice = ref('');
const storageFailed = ref(false);

// --- computed ------------------------------------------------------------------------

const build = computed(() => builds.value.find((b) => b.id === activeId.value) ?? builds.value[0]);

const activeCollection = computed(() => collections.value.find((c) => c.id === activeCollectionId.value) ?? collections.value[0]);

/** buildId -> bool, for BuildNav's per-tab unsaved-dot -- same comparison `dirty` below
 * already does for just the active build, extended to every build in the pool. */
const dirtyByBuild = computed(() => {
  const map: Record<string, boolean> = {};
  for (const b of builds.value) map[b.id] = !storage.sameBuild(b, savedById.value[b.id]);
  return map;
});

/** The active collection's other builds, for SlotList.vue's per-section "copy from"
 * control. Scoped to the collection (not every build in the app) -- collections exist
 * to group related builds, and that's the set a "copy a section over" is actually
 * useful against. */
const otherBuildsInCollection = computed(() => {
  const ids = new Set(activeCollection.value.buildIds);
  return builds.value
    .filter((b) => b.id !== activeId.value && ids.has(b.id))
    .map((b) => ({ value: b.id, label: b.name }));
});

/**
 * Catalogue layers, lowest priority first. The shipped data is the base (inside
 * `catalog.makeDb`); everything here is folded over it.
 *
 * Custom gear saved with a build slots in as one more entry -- `build.catalog` -- and
 * nothing else in the app has to change. `storage.normalise` already preserves that key
 * on a build so it survives a save/reload round trip.
 */
const overlays = computed(() => [workspaceOverlay.value, build.value.catalog].filter(Boolean));

/**
 * markRaw: 369 items plus several Maps. Vue deep-proxying it would cost more than the
 * whole calculation. Rebuilt only when a layer actually changes -- indexing is well
 * under a millisecond, so there is no reason to be cleverer than this.
 */
const db = computed(() => markRaw(catalog.makeDb(overlays.value)));

/**
 * The engine is verified, so a throw here is a bug worth seeing rather than hiding --
 * but it must not blank the page, or there would be nothing left to debug with.
 */
const resolved = computed<Resolution>(() => {
  try {
    return { ok: true, result: engine.resolveBuild(db.value, build.value) };
  } catch (error: any) {
    return { ok: false, message: String(error), stack: error?.stack ?? '' };
  }
});

const filledSlots = computed(() => Object.values(build.value.choices).filter(Boolean).length);

// --- quick compare ----------------------------------------------------------------------
// Picker + toggles live on `build.compare` -- saved with the build (storage.ts), not
// session state -- so reopening a build remembers what it was being sized up against.

const compareOptions = computed(() => [
  { value: '', label: '— none —' },
  ...builds.value.filter((b) => b.id !== activeId.value).map((b) => ({ value: b.id, label: b.name })),
]);

const compareBuild = computed(() => {
  const id = build.value.compare.id;
  if (!id || id === activeId.value) return null;
  return builds.value.find((b) => b.id === id) ?? null;
});

/**
 * Resolved against the *active* build's own `db`, not one composed for the compare
 * build's own `catalog` -- this is a quick "how does this other build stack up" glance,
 * not the editor's per-build custom-gear machinery. A compare build whose custom items
 * live only in its own catalog would show those slots as unresolved; acceptable for what
 * this is.
 */
const compareResolved = computed<Resolution | null>(() => {
  if (!compareBuild.value) return null;
  try {
    return { ok: true, result: engine.resolveBuild(db.value, compareBuild.value) };
  } catch (error: any) {
    return { ok: false, message: String(error), stack: error?.stack ?? '' };
  }
});

/** Summarised here so the tab can show it without mounting the inspector. */
const bonusCounts = computed(() => {
  if (!resolved.value.ok) return { total: 0, active: 0, nearMiss: 0 };
  const all = resolved.value.result.bonuses;
  return {
    total: all.length,
    active: all.filter((bonus) => bonus.active).length,
    nearMiss: all.filter((bonus) => !bonus.active && !bonus.excluded
      && (bonus.gate?.unmet?.length ?? 0) === 1).length,
  };
});

// Read without creating: a computed must not mutate state, so these tolerate a build
// that has not been edited yet and therefore has no history entry.
const overlayCount = computed(() => Object.keys(workspaceOverlay.value.items ?? {}).length
  + Object.keys(workspaceOverlay.value.bonusSets ?? {}).length);

const canUndo = computed(() => (histories.value[activeId.value]?.past.length ?? 0) > 0);
const canRedo = computed(() => (histories.value[activeId.value]?.future.length ?? 0) > 0);

/** Compared against the saved copy, not a plain equality: `storage.sameBuild` is
 * key-order-insensitive and ignores `updated`, or a save-then-revert (or a build the
 * `updated` stamp alone touched) would read as still dirty. */
const dirty = computed(() => !storage.sameBuild(build.value, savedById.value[activeId.value]));

/** What the buttons would actually reverse, for their tooltips. */
const undoLabel = computed(() => {
  const past = histories.value[activeId.value]?.past;
  return past?.length ? past[past.length - 1].label : '';
});

const redoLabel = computed(() => {
  const future = histories.value[activeId.value]?.future;
  return future?.length ? future[future.length - 1].label : '';
});

// --- undo -----------------------------------------------------------------------------

/** The active build's history, created on first use. */
function historyFor(id: string = activeId.value) {
  let history = histories.value[id];
  if (!history) {
    history = { past: [], future: [], lastKey: null, lastAt: 0 };
    histories.value[id] = history;
  }
  return history;
}

/** A deleted build's history would otherwise sit in memory forever. */
function dropHistory(id: string) {
  delete histories.value[id];
}

/**
 * Record the build as it is *before* a change. `key` identifies the thing being edited
 * so repeated edits of one field coalesce; pass a unique key to force a distinct step.
 * `label` describes the change in the user's words and ends up in the undo tooltip.
 *
 * Coalesced edits keep the first label, which is correct: a matching key means the same
 * field, so "Duration → 45" still names the step even after it becomes "→ 4500".
 */
function snapshot(key: string | null, label: string) {
  const history = historyFor();
  const now = Date.now();
  const coalesce = key != null
    && key === history.lastKey
    && now - history.lastAt < COALESCE_MS
    && history.past.length > 0;

  if (!coalesce) {
    history.past.push({ json: JSON.stringify(build.value), label });
    if (history.past.length > UNDO_LIMIT) history.past.shift();
  }
  history.lastKey = key;
  history.lastAt = now;
  history.future.length = 0;
}

/** Slot ids are internal; the tooltip should say "Ring 1", not "gear.ring1". */
function slotLabel(slotId: string) {
  return db.value.slotById.get(slotId)?.label ?? slotId;
}

function replaceActive(newBuild: Build) {
  const index = builds.value.findIndex((item) => item.id === activeId.value);
  if (index === -1) builds.value.push(newBuild);
  else builds.value.splice(index, 1, newBuild);
  activeId.value = newBuild.id;
}

// The label travels with the state it describes, so after undoing "Duration → 45" the
// redo button offers exactly that same step back.
function undo() {
  if (!canUndo.value) return;
  const history = historyFor();
  const entry = history.past.pop()!;  // non-null: canUndo.value already confirmed past.length > 0
  history.future.push({ json: JSON.stringify(build.value), label: entry.label });
  replaceActive(JSON.parse(entry.json));
  history.lastKey = null;
}

function redo() {
  if (!canRedo.value) return;
  const history = historyFor();
  const entry = history.future.pop()!;  // non-null: canRedo.value already confirmed future.length > 0
  history.past.push({ json: JSON.stringify(build.value), label: entry.label });
  replaceActive(JSON.parse(entry.json));
  history.lastKey = null;
}

function onKeydown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key !== 'z' && key !== 'y') return;

  // Leave the browser's own undo alone inside free-text fields, where the user means
  // "undo my typing" rather than "undo my last build edit".
  const target = event.target as HTMLElement;
  if (target?.tagName === 'TEXTAREA' || target?.classList?.contains('name-input')) return;

  event.preventDefault();
  if (key === 'y' || event.shiftKey) redo();
  else undo();
}

// --- build edits ----------------------------------------------------------------------

function setChoice(slotId: string, name: string) {
  const slot = slotLabel(slotId);
  snapshot(`choice:${slotId}`, name ? `${slot} → ${name}` : `clear ${slot}`);
  if (name) {
    build.value.choices[slotId] = name;
  } else {
    delete build.value.choices[slotId];
    delete build.value.values[slotId];
  }
}

function setValue(slotId: string, raw: string) {
  snapshot(`value:${slotId}`, `${slotLabel(slotId)} value`);
  if (raw === '' || raw == null) delete build.value.values[slotId];
  else build.value.values[slotId] = Number(raw);
}

/** The quick-compare picker's row: this build's slot made to match the compare build's,
 * choice and typed value together, in one undo step. Unlike `setChoice`, silently no-ops
 * with nothing selected to compare against -- the "apply" link only exists on a row a
 * compare build is already lighting up. */
function applyFromCompare(slotId: string) {
  const other = compareBuild.value;
  if (!other) return;
  const slot = slotLabel(slotId);
  const name = other.choices[slotId] || '';
  snapshot(`choice:${slotId}`,
    name ? `${slot} → ${name} (from “${other.name}”)` : `clear ${slot} (from “${other.name}”)`);
  if (name) {
    build.value.choices[slotId] = name;
    const value = other.values?.[slotId];
    if (value != null) build.value.values[slotId] = value;
    else delete build.value.values[slotId];
  } else {
    delete build.value.choices[slotId];
    delete build.value.values[slotId];
  }
}

// Picker + toggles are a view preference, not a build edit -- saved with the build (so
// reopening it remembers what it was compared against) but deliberately not run through
// `snapshot()`, so flipping them never costs an undo step.
function setCompareBuild(id: string) {
  build.value.compare.id = id;
}

function setCompareFlag(key: string, value: boolean) {
  (build.value.compare as unknown as Record<string, boolean>)[key] = value;
}

// Same reasoning as compare above: which sections are open is saved with the build, but
// toggling one is not a "build edit" worth an undo step.
function toggleSection(sectionId: string) {
  build.value.expanded[sectionId] = !build.value.expanded[sectionId];
}

/** "expand all"/"collapse all" -- `db.sections` only, same as before: the Options header
 * isn't a real section and has never been part of this. */
function setExpanded(open: boolean) {
  for (const section of db.value.sections) build.value.expanded[section.id] = open;
}

function setContext(key: string, value: string | number | boolean) {
  const name = FIELD_LABELS[key] ?? format.titleCase(key);
  const shown = typeof value === 'boolean'
    ? (value ? 'on' : 'off')
    : format.titleCase(String(value));
  snapshot(`context:${key}`, `${name} → ${shown}`);
  // BuildContext's fields are individually typed; this writes by a caller-supplied key
  // (QuickOptions/SlotList's context controls), so it can't be narrowed further than that.
  (build.value.context as unknown as Record<string, string | number | boolean>)[key] = value;
}

function setToggle(name: string, value: boolean) {
  snapshot(`toggle:${name}`, `${format.titleCase(name)} ${value ? 'on' : 'off'}`);
  build.value.context.toggles[name] = value;
}

function setForte(slot: string, statKey: string) {
  const target = statKey ? format.label(statKey) : 'none';
  snapshot(`forte:${slot}`, `${FORTE_LABELS[slot] ?? slot} → ${target}`);
  const forte = build.value.context.forte as unknown as Record<string, string | undefined>;
  if (statKey) forte[slot] = statKey;
  else delete forte[slot];
}

function renameBuild(name: string) {
  snapshot('name', 'rename build');
  build.value.name = name;
}

function clearSlots() {
  snapshot(null, `clear all ${filledSlots.value} slots`);
  build.value.choices = {};
  build.value.values = {};
}

function resetAll() {
  snapshot(null, 'reset build');
  const fresh = storage.defaultBuild(build.value.name);
  fresh.id = build.value.id;
  replaceActive(fresh);
}

// --- library --------------------------------------------------------------------------
// Switching, creating and importing never touch history: each build keeps its own, and
// a build that has just been created has nothing to undo to yet.

/** BuildNav's own collection row. */
function selectCollection(id: string) {
  const collection = collections.value.find((c) => c.id === id);
  if (!collection) return;
  activeCollectionId.value = id;
  activeId.value = collection.buildIds.includes(collection.activeBuildId)
    ? collection.activeBuildId
    : collection.buildIds[0];
}

/** BuildNav's own build row -- also remembers it as that collection's own `activeBuildId`,
 * so reopening the collection later returns to the same tab. */
function selectBuild(collectionId: string, id: string) {
  const collection = collections.value.find((c) => c.id === collectionId);
  if (!collection || !collection.buildIds.includes(id)) return;
  activeCollectionId.value = collectionId;
  activeId.value = id;
  collection.activeBuildId = id;
}

/** The build tab menu's own actions (save/revert/duplicate/reset/delete/rename) don't
 * know or care which collection a build lives in -- they just need it made active first,
 * so the existing active-build methods below can do the rest unchanged. */
function ownerOfBuild(buildId: string) {
  return collections.value.find((c) => c.buildIds.includes(buildId));
}

function selectBuildById(id: string) {
  const owner = ownerOfBuild(id);
  if (owner) selectBuild(owner.id, id);
}

/** Refreshes `savedCollections[id]`'s own membership snapshot to match the live
 * collection, without touching any build's content -- for the structural methods below,
 * which promote a build's *content* into `savedById` themselves (`storage.cloneBuild`)
 * but would otherwise leave the collection's own saved copy still missing the build id
 * they just added or removed, showing a false "unsaved" dot forever after. */
function syncSavedCollection(collection: Collection) {
  savedCollections.value[collection.id] = { ...collection, buildIds: [...collection.buildIds] };
}

// Create/duplicate/delete/import/share all save themselves immediately, unlike an
// ordinary edit: there is nothing pending to lose, since the build's own saved copy
// starts out identical to what was just built. All four act on `activeCollection` --
// BuildNav's own per-collection "+ New build"/"Import" buttons select that collection
// active first (see `onCreateBuildIn`/`onImportBuildsIn` below) when it isn't already.
function createBuild() {
  const newBuild = storage.defaultBuild(`Build ${builds.value.length + 1}`);
  builds.value.push(newBuild);
  savedById.value[newBuild.id] = storage.cloneBuild(newBuild);
  activeCollection.value.buildIds.push(newBuild.id);
  activeCollection.value.activeBuildId = newBuild.id;
  activeId.value = newBuild.id;
  syncSavedCollection(activeCollection.value);
  persistSaved();
  persistSavedCollections();
}

function duplicateBuild() {
  const copy = storage.duplicate(build.value);
  builds.value.push(copy);
  savedById.value[copy.id] = storage.cloneBuild(copy);
  activeCollection.value.buildIds.push(copy.id);
  activeCollection.value.activeBuildId = copy.id;
  activeId.value = copy.id;
  notice.value = `Duplicated as “${copy.name}”`;
  syncSavedCollection(activeCollection.value);
  persistSaved();
  persistSavedCollections();
}

/** Guarded per collection (at least one build must remain in it), not globally -- how
 * many builds exist in *other* collections is irrelevant to whether this one can lose
 * its last tab. */
function removeBuild() {
  const collection = activeCollection.value;
  if (collection.buildIds.length < 2) return;
  const index = builds.value.findIndex((item) => item.id === activeId.value);
  const [removed] = builds.value.splice(index, 1);
  delete savedById.value[removed.id];
  dropHistory(removed.id);
  const buildIndex = collection.buildIds.indexOf(removed.id);
  collection.buildIds.splice(buildIndex, 1);
  activeId.value = collection.buildIds[Math.min(buildIndex, collection.buildIds.length - 1)];
  collection.activeBuildId = activeId.value;
  notice.value = `Deleted “${removed.name}”`;
  syncSavedCollection(collection);
  persistSaved();
  persistSavedCollections();
}

function importBuilds(newBuilds: Build[]) {
  builds.value.push(...newBuilds);
  for (const b of newBuilds) savedById.value[b.id] = storage.cloneBuild(b);
  activeCollection.value.buildIds.push(...newBuilds.map((b) => b.id));
  activeId.value = newBuilds[newBuilds.length - 1].id;
  activeCollection.value.activeBuildId = activeId.value;
  notice.value = `Imported ${newBuilds.length} build(s)`;
  syncSavedCollection(activeCollection.value);
  persistSaved();
  persistSavedCollections();
}

/** A single build's own JSON download -- BuildNav's build tab menu -> Export. Same
 * Blob/anchor technique as BuildBar.vue's own single-build export drawer. */
function exportBuild(id: string) {
  const b = builds.value.find((item) => item.id === id);
  if (!b) return;
  const blob = new Blob([storage.toJson(b)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${b.name.replace(/[^\w.-]+/g, '-') || 'build'}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

// --- collections ------------------------------------------------------------------------

function createCollection() {
  const newBuild = storage.defaultBuild('New build');
  const collection = storage.defaultCollection(`Collection ${collections.value.length + 1}`, newBuild);
  builds.value.push(newBuild);
  savedById.value[newBuild.id] = storage.cloneBuild(newBuild);
  collections.value.push(collection);
  savedCollections.value[collection.id] = { ...collection, buildIds: [...collection.buildIds] };
  activeCollectionId.value = collection.id;
  activeId.value = newBuild.id;
  persistSaved();
  persistSavedCollections();
}

function renameCollection({ id, name }: { id: string; name: string }) {
  const collection = collections.value.find((c) => c.id === id);
  if (collection) collection.name = name;
}

function duplicateCollection(id: string) {
  const source = collections.value.find((c) => c.id === id);
  if (!source) return;
  const buildsById = Object.fromEntries(builds.value.map((b) => [b.id, b]));
  const { collection, builds: newBuilds } = storage.duplicateCollection(source, buildsById);
  builds.value.push(...newBuilds);
  for (const b of newBuilds) savedById.value[b.id] = storage.cloneBuild(b);
  collections.value.push(collection);
  savedCollections.value[collection.id] = { ...collection, buildIds: [...collection.buildIds] };
  activeCollectionId.value = collection.id;
  activeId.value = collection.activeBuildId;
  notice.value = `Duplicated as “${collection.name}”`;
  persistSaved();
  persistSavedCollections();
}

/** Guarded so at least one collection always remains -- mirrors `removeBuild`'s own
 * guard, one level up. Drops its builds from the flat pool entirely (nothing else can
 * reference them once their collection is gone) and its file link, if any. */
function deleteCollection(id: string) {
  if (collections.value.length < 2) return;
  const index = collections.value.findIndex((c) => c.id === id);
  if (index === -1) return;
  const [removed] = collections.value.splice(index, 1);
  for (const buildId of removed.buildIds) {
    const buildIndex = builds.value.findIndex((b) => b.id === buildId);
    if (buildIndex !== -1) builds.value.splice(buildIndex, 1);
    delete savedById.value[buildId];
    dropHistory(buildId);
  }
  delete savedCollections.value[removed.id];
  delete fileLinks.value[removed.id];
  fsStore.deleteHandle(removed.id);
  const next = collections.value[Math.min(index, collections.value.length - 1)];
  activeCollectionId.value = next.id;
  activeId.value = next.activeBuildId;
  notice.value = `Deleted “${removed.name}”`;
  persistSaved();
  persistSavedCollections();
}

/** BuildNav's collection menu -> Save: commits every build the collection contains
 * (same promotion `saveActive` does for just the active one) and persists the grouping,
 * then -- if this collection is linked to a file -- writes it there too. */
async function saveCollection(id: string) {
  const collection = collections.value.find((c) => c.id === id);
  if (!collection) return;
  for (const buildId of collection.buildIds) {
    const b = builds.value.find((item) => item.id === buildId);
    if (b) savedById.value[buildId] = { ...storage.cloneBuild(b), updated: Date.now() };
  }
  savedCollections.value[id] = { ...collection, buildIds: [...collection.buildIds] };
  persistSaved();
  persistSavedCollections();
  const handle = await fileHandleFor(id);
  if (handle) await writeCollectionFile(id, handle);
}

/** `fileLinks[id]` only holds a handle picked *this session* (Save As -> File) -- a
 * reload loses that in-memory link even though the handle itself is still sitting in
 * `fsStore`'s IndexedDB, so a Save has to fall back to looking it up there before
 * concluding the collection isn't file-linked at all. */
async function fileHandleFor(id: string) {
  if (fileLinks.value[id]) return fileLinks.value[id];
  const handle = await fsStore.getHandle(id);
  if (handle) fileLinks.value[id] = handle;
  return handle;
}

async function writeCollectionFile(id: string, handle: FileSystemFileHandle) {
  const collection = collections.value.find((c) => c.id === id);
  if (!collection) return;
  try {
    if (!(await fsStore.verifyPermission(handle))) throw new Error('permission denied');
    const buildsById = Object.fromEntries(builds.value.map((b) => [b.id, b]));
    const bundle = storage.bundleCollection(collection, buildsById);
    await fsStore.writeText(handle, storage.toJson(bundle));
  } catch (error: any) {
    delete fileLinks.value[id];
    notice.value = `Could not write “${collection.name}” to its linked file: ${error.message ?? error}`;
  }
}

/** BuildNav's collection menu -> Save As. `target: 'storage'` is just `duplicateCollection`
 * under another name (both produce an independent saved copy); `target: 'file'` picks a
 * file, links it to *this* collection going forward, and writes it immediately. */
async function saveCollectionAs({ id, target }: { id: string; target: string }) {
  if (target === 'storage') {
    duplicateCollection(id);
    return;
  }
  const collection = collections.value.find((c) => c.id === id);
  if (!collection || !fsStore.supported) return;
  try {
    const suggested = `${collection.name.replace(/[^\w.-]+/g, '-') || 'collection'}.json`;
    const handle = await fsStore.pickSaveFile(suggested);
    fileLinks.value[id] = handle;
    await fsStore.setHandle(id, handle);
    await saveCollection(id);
    notice.value = `“${collection.name}” now saves to that file`;
  } catch (error: any) {
    if (error?.name !== 'AbortError') {
      notice.value = `Could not link that file: ${error.message ?? error}`;
    }
  }
}

/** BuildNav's collection menu -> Export: a one-shot download, no persistent link --
 * distinct from Save As -> File, which remembers the file for future Saves. Same
 * Blob/anchor technique as `exportBuild` above. */
function exportCollection(id: string) {
  const collection = collections.value.find((c) => c.id === id);
  if (!collection) return;
  const buildsById = Object.fromEntries(builds.value.map((b) => [b.id, b]));
  const bundle = storage.bundleCollection(collection, buildsById);
  const blob = new Blob([storage.toJson(bundle)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${collection.name.replace(/[^\w.-]+/g, '-') || 'collection'}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/** BuildNav's own "Import collection" button at the bottom of the sidebar. Parsing (and
 * its failure) happens here, not in BuildNav, so it can share the one `notice` channel
 * every other library-level error already uses. */
function importCollectionText(text: string) {
  try {
    const { collection, builds: newBuilds } = storage.parseCollectionJson(text);
    builds.value.push(...newBuilds);
    for (const b of newBuilds) savedById.value[b.id] = storage.cloneBuild(b);
    collections.value.push(collection);
    savedCollections.value[collection.id] = { ...collection, buildIds: [...collection.buildIds] };
    activeCollectionId.value = collection.id;
    activeId.value = collection.activeBuildId;
    notice.value = `Imported “${collection.name}” (${newBuilds.length} build(s))`;
    persistSaved();
    persistSavedCollections();
  } catch (error: any) {
    notice.value = `That collection file could not be read: ${error.message ?? error}`;
  }
}

/** BuildNav's per-collection "+ New build"/"Import" row -- makes that collection active
 * first (a no-op if it already is) so `createBuild`/`importBuilds` land in it. */
function onCreateBuildIn(collectionId: string) {
  selectCollection(collectionId);
  createBuild();
}

function onImportBuildsIn({ collectionId, text }: { collectionId: string; text: string }) {
  selectCollection(collectionId);
  try {
    importBuilds(storage.parseJson(text));
  } catch (error: any) {
    notice.value = `That file could not be read: ${error.message ?? error}`;
  }
}

// BuildNav's per-build tab menu: select the build (and its collection) active, then
// reuse the same active-build method the top toolbar's own buttons call.
function onSaveBuild(id: string) { selectBuildById(id); saveActive(); }
function onRevertBuild(id: string) { selectBuildById(id); revertActive(); }
function onDuplicateBuild(id: string) { selectBuildById(id); duplicateBuild(); }
function onResetBuild(id: string) { selectBuildById(id); resetAll(); }
function onDeleteBuild(id: string) { selectBuildById(id); removeBuild(); }
function onRenameBuild({ id, name }: { id: string; name: string }) { selectBuildById(id); renameBuild(name); }

/**
 * Slot-id keyed, so it cannot misalign the way a spreadsheet range paste can. Slots the
 * source leaves empty are cleared in the target -- "copy this section" means the section
 * ends up matching, not "merge whatever happens to be set".
 */
function copySection({ fromId, sectionIds }: { fromId: string; sectionIds: string[] }) {
  const source = builds.value.find((item) => item.id === fromId);
  if (!source) return;

  snapshot(null, `copy ${sectionIds.length} section(s) from “${source.name}”`);
  const wanted = new Set(sectionIds);
  for (const slot of db.value.slots) {
    if (!wanted.has(slot.section)) continue;

    const choice = source.choices[slot.id];
    if (choice) build.value.choices[slot.id] = choice;
    else delete build.value.choices[slot.id];

    const value = source.values[slot.id];
    if (value != null) build.value.values[slot.id] = value;
    else delete build.value.values[slot.id];
  }
  notice.value = `Copied ${sectionIds.length} section(s) from “${source.name}”`;
}

/** One slot's own "revert" icon (SlotList.vue): undoes just that slot's unsaved edit,
 * leaving the rest of the draft alone -- unlike `revertActive`, which throws away
 * everything unsaved in the build. */
function revertSlot(slotId: string) {
  const saved = savedById.value[activeId.value];
  if (!saved) return;
  snapshot(null, `revert ${slotLabel(slotId)}`);
  const choice = saved.choices[slotId];
  if (choice) build.value.choices[slotId] = choice;
  else delete build.value.choices[slotId];
  const value = saved.values[slotId];
  if (value != null) build.value.values[slotId] = value;
  else delete build.value.values[slotId];
}

/** Same, for every slot in one section at once (a section header's own "revert" icon). */
function revertSection(sectionId: string) {
  const saved = savedById.value[activeId.value];
  const slots = db.value.slots.filter((slot) => slot.section === sectionId);
  if (!saved || !slots.length) return;
  const label = db.value.sections.find((section) => section.id === sectionId)?.label ?? sectionId;
  snapshot(null, `revert ${label}`);
  for (const slot of slots) {
    const choice = saved.choices[slot.id];
    if (choice) build.value.choices[slot.id] = choice;
    else delete build.value.choices[slot.id];
    const value = saved.values[slot.id];
    if (value != null) build.value.values[slot.id] = value;
    else delete build.value.values[slot.id];
  }
}

// --- plumbing -------------------------------------------------------------------------

/** The continuous, debounced "don't lose this on a reload" write -- not a save the user
 * asked for, so it never touches `savedById` or clears `storageFailed`'s one-shot notice. */
function saveDraft() {
  const ok = storage.saveDraft({ builds: builds.value, activeId: activeId.value });
  if (!ok && !storageFailed.value) {
    storageFailed.value = true;
    notice.value = 'Could not save to localStorage — export your build to keep it.';
  }
}

/** Writes `savedById` as it stands right now to `nw:builds`. Shared by the explicit Save
 * button and by structural changes that save themselves immediately. */
function persistSaved() {
  const ok = storage.saveLibrary({ builds: Object.values(savedById.value), activeId: activeId.value });
  if (!ok && !storageFailed.value) {
    storageFailed.value = true;
    notice.value = 'Could not save to localStorage — export your build to keep it.';
  }
}

/** The collections analogue of `saveDraft` above -- continuous, debounced, never touches
 * `savedCollections`. */
function saveCollectionsDraft() {
  const ok = storage.saveCollectionsDraft({
    collections: collections.value,
    activeCollectionId: activeCollectionId.value,
  });
  if (!ok && !storageFailed.value) {
    storageFailed.value = true;
    notice.value = 'Could not save to localStorage — export your build to keep it.';
  }
}

/** The collections analogue of `persistSaved` above -- writes `savedCollections` as it
 * stands right now to `nw:collections`. */
function persistSavedCollections() {
  const ok = storage.saveCollections({
    collections: Object.values(savedCollections.value),
    activeCollectionId: activeCollectionId.value,
  });
  if (!ok && !storageFailed.value) {
    storageFailed.value = true;
    notice.value = 'Could not save to localStorage — export your build to keep it.';
  }
}

/** The Save button: promotes the live draft to the saved library. */
function saveActive() {
  savedById.value[activeId.value] = { ...storage.cloneBuild(build.value), updated: Date.now() };
  persistSaved();
}

/** Discards unsaved edits back to what was last saved. BuildBar.vue gates this behind
 * its own two-step confirm, same as delete -- this is the one place an ordinary edit can
 * be lost, since the draft otherwise survives everything (including a reload). */
function revertActive() {
  const saved = savedById.value[activeId.value];
  if (!saved) return;
  snapshot(null, 'revert unsaved changes');
  replaceActive(storage.cloneBuild(saved));
}

/** A `#b=…` link is consumed once: the build joins the library and the hash is dropped. */
async function consumeShareLink() {
  const payload = storage.readHash();
  if (!payload) return;
  try {
    const shared = await storage.decodeShare(payload);
    if (!shared) return;
    builds.value.push(shared);
    savedById.value[shared.id] = storage.cloneBuild(shared);
    activeId.value = shared.id;
    notice.value = `Opened “${shared.name}” from a share link`;
    persistSaved();
  } catch (error: any) {
    notice.value = `That share link could not be read: ${error.message ?? error}`;
  }
  storage.clearHash();
}

// --- routing --------------------------------------------------------------------------
// Only view/build/tab live here. The editor's own "which item is open" is a level down
// (DataEditor.vue) and reads/writes the `item` param itself -- App.vue already knows
// nothing about the editor's internals, and routing keeps to that boundary.

/** Writes the current view/build/tab to the URL. `push: false` for changes that
 * shouldn't be their own back/forward stop (see the `tab` watcher). */
function syncRoute({ push = true }: { push?: boolean } = {}) {
  router.apply({
    view: view.value === 'editor' ? 'editor' : null,
    collection: activeCollectionId.value,
    build: activeId.value,
    tab: tab.value === 'bonuses' ? 'bonuses' : null,
  }, { push });
}

/** Ctrl+click on a filled slot (SlotList.vue): jump straight into that item in the data
 * editor. `item` has to land in the URL before `view` flips -- the `view` watcher's own
 * `syncRoute()` runs (flush: pre, so before the DOM patches DataEditor into existence) and
 * merges `view=editor` onto whatever is already there, and DataEditor reads `item` off the
 * URL once, in its own `onMounted`. */
function editItem(itemName: string) {
  router.apply({ item: itemName });
  view.value = 'editor';
}

/** Back/forward landed here: read the URL rather than trust the popstate payload, since
 * the payload is whatever was current when *this* session pushed it, not necessarily
 * what's now in the address bar (a page reload rebuilds history-less). */
function onPopState() {
  const route = router.parse();
  view.value = route.view === 'editor' ? 'editor' : 'builder';
  if (route.collection && collections.value.some((c) => c.id === route.collection)) {
    activeCollectionId.value = route.collection;
  }
  if (route.build && builds.value.some((b) => b.id === route.build)) {
    activeId.value = route.build;
  }
  tab.value = route.tab === 'bonuses' ? 'bonuses' : 'stats';
}

// --- watchers --------------------------------------------------------------------------

// The draft autosaves continuously -- this is "don't lose work on a reload", not "save
// my changes"; that is `saveActive()`, wired to the Save button.
watch(builds, () => {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveDraft(), SAVE_DEBOUNCE_MS);
}, { deep: true });

// Same continuous "don't lose this on a reload" autosave as `builds` above, for the
// collections grouping (creating/renaming/reordering) rather than build content.
watch(collections, () => {
  window.clearTimeout(collectionsSaveTimer);
  collectionsSaveTimer = window.setTimeout(() => saveCollectionsDraft(), SAVE_DEBOUNCE_MS);
}, { deep: true });

// Every one of these is either a deliberate navigation (switch build, open/close the
// editor) or, via `onPopState`, the URL catching us up after the user already navigated
// with the browser's own back/forward -- `router.apply`'s no-op guard means the latter
// case can't turn into a duplicate history entry.
watch(activeId, () => { saveDraft(); syncRoute(); });
watch(activeCollectionId, () => { saveCollectionsDraft(); syncRoute(); });
watch(view, () => { syncRoute(); });
// The sidebar tab is a lighter switch than a build/view change -- it still belongs in
// the URL for a refresh to restore, but it would clutter the back button if every click
// were its own stop.
watch(tab, () => { syncRoute({ push: false }); });

watch(notice, (value) => {
  window.clearTimeout(noticeTimer);
  if (value) noticeTimer = window.setTimeout(() => { notice.value = ''; }, 6000);
});

watch(workspaceOverlay, (value) => { storage.saveOverlay(value); }, { deep: true });

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('popstate', onPopState);
  // Establishes the canonical `?view=&build=&tab=` for a first-ever visit, without
  // pushing a history entry for it.
  syncRoute({ push: false });
  consumeShareLink();
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('popstate', onPopState);
});
</script>

<template>
  <DataEditor
    v-if="view === 'editor'"
    :db="db"
    :overlay="workspaceOverlay"
    @update-overlay="workspaceOverlay = $event"
    @close="view = 'builder'" />

  <template v-else>
  <div class="page">
    <BuildNav
      :collections="collections"
      :builds="builds"
      :active-collection-id="activeCollectionId"
      :active-id="activeId"
      :dirty-by-build="dirtyByBuild"
      :saved-collections="savedCollections"
      @select-collection="selectCollection"
      @select-build="({ collectionId, id }) => selectBuild(collectionId, id)"
      @create-collection="createCollection"
      @import-collection="importCollectionText"
      @rename-collection="renameCollection"
      @save-collection="saveCollection"
      @save-collection-as="saveCollectionAs"
      @duplicate-collection="duplicateCollection"
      @export-collection="exportCollection"
      @delete-collection="deleteCollection"
      @create-build="onCreateBuildIn"
      @import-builds="onImportBuildsIn"
      @rename-build="onRenameBuild"
      @save-build="onSaveBuild"
      @revert-build="onRevertBuild"
      @duplicate-build="onDuplicateBuild"
      @export-build="exportBuild"
      @reset-build="onResetBuild"
      @delete-build="onDeleteBuild" />

    <div class="page-main">
      <header class="topbar">
        <div class="brand">
          <h1>Neverwinter build planner</h1>
        </div>

        <BuildBar
          :build="build"
          :can-undo="canUndo"
          :can-redo="canRedo"
          :undo-label="undoLabel"
          :redo-label="redoLabel"
          :dirty="dirty"
          @rename="renameBuild"
          @import="importBuilds"
          @undo="undo"
          @redo="redo"
          @save="saveActive"
          @revert="revertActive" />

        <QuickOptions
          :context="build.context"
          @set="setContext"
          @set-toggle="setToggle" />

        <div class="topbar-actions">
          <span v-if="notice" class="notice" @click="notice = ''">{{ notice }}</span>
          <div class="compare-quick">
            <span class="field-label">Compare</span>
            <ComboBox class="compare-select" :model-value="build.compare.id" :options="compareOptions"
                      @update:model-value="setCompareBuild" />
            <label class="check">
              <input type="checkbox" :checked="build.compare.highlight" :disabled="!compareBuild"
                     @change="setCompareFlag('highlight', ($event.target as HTMLInputElement).checked)">
              <span>highlight diffs</span>
            </label>
            <label class="check">
              <input type="checkbox" :checked="build.compare.onlyDiff" :disabled="!compareBuild"
                     @change="setCompareFlag('onlyDiff', ($event.target as HTMLInputElement).checked)">
              <span>only diffs</span>
            </label>
          </div>

          <button type="button" class="link" @click="resetAll">reset</button>
          <span class="hint">{{ filledSlots }}/{{ db.slots.length }} slots</span>
          <button type="button" class="btn" @click="view = 'editor'">
            Edit data<span v-if="overlayCount" class="badge badge--edited">{{ overlayCount }}</span>
          </button>
        </div>
      </header>

      <main class="layout" v-if="resolved.ok">
        <div class="content">
        <SlotList
          :db="db"
          :build="build"
          :result="resolved.result"
          :context="build.context"
          :expanded="build.expanded"
          :compare-build="compareBuild"
          :highlight-diff="build.compare.highlight"
          :only-diff="build.compare.onlyDiff"
          :saved-build="savedById[activeId]"
          :other-builds="otherBuildsInCollection"
          @choose="setChoice"
          @set-value="setValue"
          @set="setContext"
          @set-forte="setForte"
          @apply-slot="applyFromCompare"
          @toggle-section="toggleSection"
          @set-expanded="setExpanded"
          @edit-item="editItem"
          @revert-slot="revertSlot"
          @revert-section="revertSection"
          @copy-section="copySection" />
        </div>
        <aside class="sidebar">
          <div class="tabs">
            <button type="button" class="tab" :class="{ 'is-on': tab === 'stats' }"
                    @click="tab = 'stats'">Stats</button>
            <button type="button" class="tab" :class="{ 'is-on': tab === 'bonuses' }"
                    @click="tab = 'bonuses'">
              Bonuses <span class="tab-count">{{ bonusCounts.active }}/{{ bonusCounts.total }}</span>
              <span v-if="bonusCounts.nearMiss" class="badge badge--near">
                {{ bonusCounts.nearMiss }} away
              </span>
            </button>
          </div>

          <!-- v-show, not v-if: switching tabs must not discard the inspector's filter. -->
          <StatPanel v-show="tab === 'stats'" :result="resolved.result"
                     :compare-result="compareResolved?.ok ? compareResolved.result : null"
                     :compare-name="compareBuild?.name ?? ''" />
          <BonusInspector v-show="tab === 'bonuses'" :result="resolved.result" :db="db" />
        </aside>
      </main>

      <main v-else class="crash">
        <h2>The engine threw</h2>
        <p>{{ resolved.message }}</p>
        <pre>{{ resolved.stack }}</pre>
      </main>
    </div>
  </div>
  </template>
</template>

<style scoped>
/* --- page shell --------------------------------------------------------------------- */
.page { display: flex; align-items: stretch; min-height: 100vh; }
.page-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; height: 100vh; }

/* --- top bar -------------------------------------------------------------------------- */

.topbar {
  flex: none;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 12px 20px;
  padding: 8px 14px;
}

.brand { display: flex; flex-direction: column; gap: 4px; min-width: 150px; }
.brand h1 { font-size: 1.083rem; letter-spacing: .01em; }

.topbar-actions {
  flex: 1 1 100%;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

/* Quick compare: pick another build, see it inline against the active one (slot highlights,
 * the stat panel's headline row) -- deliberately just a picker in the top bar, not a page of
 * its own. */
.compare-quick { align-items: center; display: flex; flex-wrap: wrap; gap: 6px; }
.compare-select { min-width: 170px; }

/* --- builder layout --------------------------------------------------------------------- */

.layout {
  display: flex;
  align-items: stretch;
  flex: 1 1 auto;
  min-height: 0;
  gap: 16px;
  padding: 14px;
}

.content { flex: 1 1 auto; min-width: 0; overflow-y: auto; }

.sidebar { flex: none; width: 460px; overflow-y: auto; }

.panel { border-radius: 0 var(--radius) var(--radius) var(--radius); }
.tabs { padding-left: 0 }

.crash { flex: 1 1 auto; min-height: 0; overflow-y: auto; color: var(--danger); padding: 24px; }
.crash pre { background: var(--surface); border-radius: var(--radius); overflow-x: auto; padding: 12px; }

@media (max-width: 1100px) {
  /* Below this width `.build-nav` itself gives up its own `height: 100vh` pane (see its
   * media query) and goes back to plain document flow -- match that here instead of running
   * two different "who owns the scrollbar" models at once. The top bar goes back to
   * `position: sticky` since it's the page, not a pane, that scrolls in this mode. */
  .page { flex-direction: column; }
  .page-main { height: auto; }
  .topbar { position: sticky; top: 0; z-index: 20; }
  .layout { flex-direction: column; }
  .content, .sidebar { width: auto; overflow-y: visible; }
}

@media (max-width: 560px) {
  /* Below this the compare picker and the reset/edit-data actions no longer fit on one
   * line with the notice -- let the whole action cluster wrap onto its own row rather than
   * squeezing every control down to nothing. */
  .topbar-actions { justify-content: flex-start; }
}
</style>
