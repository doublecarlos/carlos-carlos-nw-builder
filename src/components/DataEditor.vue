<script setup lang="ts">
// The data editor: browse/add/edit/remove items and shared bonus sets, lint the result, and
// export it back to the `data/*.json` files.
//
// The editor never writes to disk -- it cannot, this is a static client app. It edits the
// workspace *overlay* (see catalog.ts) and hands you the file contents to paste back.
// The same overlay shape is what per-build custom gear will use later, so nothing here is
// throwaway: only the layer the overlay lives in changes.
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';
import ItemForm from './ItemForm.vue';
import type { ItemDraft } from './ItemForm.vue';
import BonusSetForm from './BonusSetForm.vue';
import ComboBox from './ui/ComboBox.vue';
import Button from './ui/Button.vue';
import HistoryButton from './ui/HistoryButton.vue';
import Badge from './ui/Badge.vue';
import Notice from './ui/Notice.vue';
import Drawer from './ui/Drawer.vue';
import CodeBlock from './ui/CodeBlock.vue';
import TabStrip from './ui/TabStrip.vue';
import TabButton from './ui/TabButton.vue';
import * as catalog from '../catalog';
import * as router from '../router';
import * as engine from '../stores/engine';
import * as workspace from '../stores/workspace';
import * as ui from '../stores/ui';
import type { CatalogGroup, Item, BonusSet, LintFinding } from '../types';
import type { SetDraft } from '../bonus-draft';

const UNDO_LIMIT = 50;

const db = engine.db;
const overlay = workspace.workspaceOverlay;

const query = ref('');
const statusFilter = ref('all');      // all | changed | added | edited | removed
const section = ref('items');         // items | bonusSets
const selectedId = ref<string | null>(null);
const selectedSetId = ref<string | null>(null);
const showExport = ref(false);
const exportTab = ref('items');       // items | bonuses | overlay
const formDirty = ref(false);
const notice = ref('');
const confirmReset = ref(false);
let confirmResetTimer: number | undefined;
// JSON snapshots of `overlay` (this component's prop), taken right before each committed
// change (save/delete/revert/restore/reset/import) -- the same "snapshot before, restore
// by re-emitting the JSON" shape as App.vue's build undo, just one stream instead of one
// per build, since there is only ever one overlay. Strings, not objects, so undoing a
// hundred-item overlay a dozen times doesn't keep a dozen live deep copies around.
const history = ref<{ past: { json: string; label: string }[]; future: { json: string; label: string }[] }>({ past: [], future: [] });
// itemName/setId -> that form's in-progress `draft`, stashed just before switching away
// from it while dirty (see `stashCurrentDraft`) so picking a different row doesn't
// silently throw the edit away -- restored via `initialDraft` if the same row is
// reselected. Only ever keyed by a *real* name/id, never the new-item/-set placeholder:
// "+ New item" is a deliberate "start fresh" action, not a navigation to preserve.
const itemDrafts = reactive<Record<string, ItemDraft>>({});
const setDrafts = reactive<Record<string, SetDraft>>({});

const form = ref<InstanceType<typeof ItemForm> | null>(null);
const setForm = ref<InstanceType<typeof BonusSetForm> | null>(null);

interface ItemRow { key: string; name: string; filter: string; item: Item | null; status: string; kind: 'item' }
interface BonusSetRow { key: string; name: string; filter: string; set: BonusSet | null; status: string; kind: 'bonusSet' }
type EditorRow = ItemRow | BonusSetRow;

// Removed entries are gone from `db`, so the list is built from the composed catalogue
// plus the overlay's tombstones -- otherwise a deletion would vanish with no way back.
const itemRows = computed<ItemRow[]>(() => {
  const rows: ItemRow[] = db.value.items.map((item) => ({
    key: item.id,
    name: item.name,
    filter: item.filter ?? '',
    item,
    status: catalog.statusOf(overlay.value, 'items', item.id),
    kind: 'item',
  }));
  for (const [id, value] of Object.entries(overlay.value.items ?? {})) {
    if (value === null) {
      // A tombstone only ever hides a shipped item, so its display name is still in `base()`.
      const name = catalog.base().items.find((item) => item.id === id)?.name ?? id;
      rows.push({ key: id, name, filter: '—', item: null, status: 'removed', kind: 'item' });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
});

/** Same shape as `itemRows`, one row per bonus set rather than per item -- so the same
 * list/search/keyboard-nav code serves both without knowing which it's showing. */
const bonusSetRows = computed<BonusSetRow[]>(() => {
  const rows: BonusSetRow[] = db.value.bonusSets.map((set) => ({
    key: set.id,
    name: set.name || set.id,
    filter: `${(set.grants ?? []).length} grant(s)`,
    set,
    status: catalog.statusOf(overlay.value, 'bonusSets', set.id),
    kind: 'bonusSet',
  }));
  for (const [id, value] of Object.entries(overlay.value.bonusSets ?? {})) {
    if (value === null) {
      rows.push({ key: id, name: id, filter: '—', set: null, status: 'removed', kind: 'bonusSet' });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
});

const rows = computed(() => (section.value === 'bonusSets' ? bonusSetRows.value : itemRows.value));

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return rows.value.filter((row) => {
    if (statusFilter.value === 'changed' && row.status === 'base') return false;
    if (['added', 'edited', 'removed'].includes(statusFilter.value)
      && row.status !== statusFilter.value) return false;
    if (!q) return true;
    return row.name.toLowerCase().includes(q)
      || (row.filter ?? '').toLowerCase().includes(q);
  });
});

const statusFilterOptions = [
  { value: 'all', label: 'all' },
  { value: 'changed', label: 'changed only' },
  { value: 'added', label: 'added' },
  { value: 'edited', label: 'edited' },
  { value: 'removed', label: 'removed' },
];

const selected = computed(() => {
  if (selectedId.value == null) return null;
  return db.value.get(selectedId.value);
});

const selectedStatus = computed(() => (selectedId.value == null
  ? 'base'
  : catalog.statusOf(overlay.value, 'items', selectedId.value)));

const selectedSet = computed(() => {
  if (selectedSetId.value == null) return null;
  return db.value.bonusSetById.get(selectedSetId.value) ?? null;
});

const selectedSetStatus = computed(() => (selectedSetId.value == null
  ? 'base'
  : catalog.statusOf(overlay.value, 'bonusSets', selectedSetId.value)));

const filters = computed<string[]>(() => [...new Set<string>(db.value.items.map((item) => item.filter).filter((f): f is string => Boolean(f)))].sort());

const setIds = computed<string[]>(() => [...new Set<string>(db.value.bonusSets.map((set) => set.id))].sort());

const tagList = computed<string[]>(() => [...db.value.itemsByTag.keys()].sort());

/** The vocabulary for `excludes`. A set now resolves as one unit, so only sets (not
 * individual grants) are addressable -- same list as `setIds`, kept as its own computed
 * since the two are used for unrelated purposes at the call sites. */
const bonusIds = computed(() => setIds.value);

const changedCount = computed(() => Object.keys(overlay.value.items ?? {}).length
  + Object.keys(overlay.value.bonusSets ?? {}).length);

const findings = computed(() => catalog.validate(db.value.items, db.value.bonusSets));

const errorCount = computed(() => findings.value.filter((f) => f.level === 'error').length);
const warnCount = computed(() => findings.value.filter((f) => f.level === 'warn').length);

const exportText = computed(() => {
  if (exportTab.value === 'items') return catalog.toItemsFile(db.value.items);
  if (exportTab.value === 'bonuses') return catalog.toBonusesFile(db.value.bonusSets);
  return JSON.stringify(overlay.value, null, 2);
});

const exportName = computed(() => {
  if (exportTab.value === 'items') return 'db-items.json';
  if (exportTab.value === 'bonuses') return 'db-bonuses.json';
  return 'catalog-overlay.json';
});

const canUndo = computed(() => history.value.past.length > 0);
const canRedo = computed(() => history.value.future.length > 0);
const undoLabel = computed(() => {
  const past = history.value.past;
  return past.length ? past[past.length - 1].label : '';
});
const redoLabel = computed(() => {
  const future = history.value.future;
  return future.length ? future[future.length - 1].label : '';
});

// --- undo -----------------------------------------------------------------------------
// The *editor's* undo, over committed overlay changes (save/delete/revert/restore/reset/
// import) -- one stream, not one per build the way App.vue keys its own history, since
// there is only ever one overlay. Ordinary in-progress editing (typing, checking a class
// box) has its own separate, lower-level undo scoped to whichever form is open --
// ItemForm's/BonusSetForm's own `draftHistory` -- that `onKeydown` below tries
// first; this one only ever sees a fresh snapshot right before a commit lands.

function snapshot(label: string) {
  history.value.past.push({ json: JSON.stringify(overlay.value), label });
  if (history.value.past.length > UNDO_LIMIT) history.value.past.shift();
  history.value.future.length = 0;
}

function undo() {
  if (!canUndo.value) return;
  const entry = history.value.past.pop()!;
  history.value.future.push({ json: JSON.stringify(overlay.value), label: entry.label });
  workspace.setWorkspaceOverlay(JSON.parse(entry.json));
}

function redo() {
  if (!canRedo.value) return;
  const entry = history.value.future.pop()!;
  history.value.past.push({ json: JSON.stringify(overlay.value), label: entry.label });
  workspace.setWorkspaceOverlay(JSON.parse(entry.json));
}

/**
 * Same Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y convention as App.vue's builder undo, including which
 * fields it defers to native undo for -- only `<textarea>` (the export/import JSON boxes),
 * not every `<input>`. App.vue hijacks Ctrl+Z inside ordinary fields on purpose, and the
 * open item/bonus-set form's own draft-level undo (ItemForm.vue/BonusSetForm.vue) is
 * exactly that same convention one level down, so this defers to it first: only once the
 * open form has nothing left to undo does this fall through to the editor's own undo over
 * *committed* changes (save/delete/revert/…).
 */
function onKeydown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key !== 'z' && key !== 'y') return;
  if ((event.target as HTMLElement)?.tagName === 'TEXTAREA') return;
  event.preventDefault();
  const activeForm = section.value === 'bonusSets' ? setForm.value : form.value;
  if (key === 'y' || event.shiftKey) {
    if (activeForm?.redoDraft?.()) return;
    redo();
  } else {
    if (activeForm?.undoDraft?.()) return;
    undo();
  }
}

// --- unsaved form drafts ----------------------------------------------------------------
// Switching rows used to remount the form fresh (`:key="selectedId ?? '__new__'"`) and
// silently drop whatever was mid-edit. Stashing here, right before the key changes, means
// the draft survives the trip and comes back via `initialDraft` if the same row is
// reselected -- see `itemDrafts`/`setDrafts` above.

function stashItemDraft() {
  if (selectedId.value == null) return;
  if (form.value?.dirty) itemDrafts[selectedId.value] = form.value.draft;
  else delete itemDrafts[selectedId.value];
}

function stashSetDraft() {
  if (selectedSetId.value == null) return;
  if (setForm.value?.dirty) setDrafts[selectedSetId.value] = setForm.value.draft;
  else delete setDrafts[selectedSetId.value];
}

/** Whichever form is actually on screen right now matches `section`, not the row's own
 * kind -- `select()` never changes `section` itself, so at the moment this runs the two
 * always agree. */
function stashCurrentDraft() {
  if (section.value === 'bonusSets') stashSetDraft();
  else stashItemDraft();
}

/** The list row's own red "unsaved" badge: true for the open form's live dirty state, or
 * for any other row still holding a stashed draft from an earlier visit. */
function hasUnsavedDraft(row: EditorRow) {
  if (row.kind === 'bonusSet') {
    if (row.key === selectedSetId.value) return formDirty.value;
    return Boolean(setDrafts[row.key]);
  }
  if (row.key === selectedId.value) return formDirty.value;
  return Boolean(itemDrafts[row.key]);
}

// --- filters ---------------------------------------------------------------------------

function clearFilters() {
  query.value = '';
  statusFilter.value = 'all';
}

// --- routing --------------------------------------------------------------------------
// `item`/`set`/`section`/`status`/`q` are this component's own corner of the URL --
// App.vue owns view/build/tab and knows nothing about what's selected in here. `select`'s
// `push` flag is what keeps arrow-key browsing from filling the back/forward stack with
// one stop per keystroke: a click is a real "go to this row" navigation, an arrow key is
// just skimming.

function isValidStatusFilter(value: unknown) {
  return statusFilterOptions.some((option) => option.value === value);
}

/** Back/forward landed on this component while it was already mounted (still in the
 * editor, just a different item/set/section/status filter/query). A fresh mount reads the
 * same params in `onMounted`. */
function onPopState() {
  const route = router.parse();
  if (route.section === 'bonusSets') {
    section.value = 'bonusSets';
    selectedSetId.value = (route.set && db.value.bonusSetById.get(route.set)) ? route.set : null;
  } else {
    section.value = 'items';
    selectedId.value = (route.item && db.value.get(route.item)) ? route.item : null;
  }
  statusFilter.value = isValidStatusFilter(route.status) ? route.status : 'all';
  query.value = route.q ?? '';
}

function switchSection(target: string) {
  if (section.value === target) return;
  stashCurrentDraft();
  section.value = target;
  router.apply(target === 'bonusSets'
    ? { section: 'bonusSets', item: null, set: selectedSetId.value }
    : { section: null, set: null, item: selectedId.value });
}

function select(row: EditorRow, { push = true }: { push?: boolean } = {}) {
  if (row.status === 'removed') return;
  stashCurrentDraft();
  if (row.kind === 'bonusSet') {
    selectedSetId.value = row.key;
    router.apply({ set: row.key, item: null }, { push });
  } else {
    selectedId.value = row.key;
    router.apply({ item: row.key, set: null }, { push });
  }
}

/**
 * ArrowUp/Down drive the list from either the search box (kept focused, command-palette
 * style -- typing still filters normally) or a focused row. The current section's selected
 * key doubles as the keyboard cursor: the existing click UX has no separate "highlighted
 * but not open" state, so keyboard nav matches it exactly rather than inventing one.
 * Guarded to the search input or an `.editor-row` so the status ComboBox's own dropdown
 * keeps its arrows.
 */
function onListKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  const isSearch = target.matches?.('input[type="search"]');
  const isRow = target.closest?.('.editor-row');
  if (!isSearch && !isRow) return;
  if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
  const rowsList = filtered.value;
  if (!rowsList.length) return;
  event.preventDefault();
  const currentKey = section.value === 'bonusSets' ? selectedSetId.value : selectedId.value;
  const idx = rowsList.findIndex((row) => row.key === currentKey);
  if (event.key === 'Enter') {
    if (idx !== -1) select(rowsList[idx]);
    return;
  }
  const dir = event.key === 'ArrowDown' ? 1 : -1;
  const next = idx === -1
    ? (dir === 1 ? 0 : rowsList.length - 1)
    : Math.min(Math.max(idx + dir, 0), rowsList.length - 1);
  select(rowsList[next], { push: false });
}

function newItem() {
  stashItemDraft();
  selectedId.value = null;
  router.apply({ item: null });
  // Remounts ItemForm with an empty draft even if it was already showing a new item.
  // $forceUpdate is a real Vue instance method but not part of ItemForm's own defineExpose
  // surface (draft/dirty/undoDraft/redoDraft only), hence the cast to reach it anyway.
  (form.value as unknown as { $forceUpdate?: () => void })?.$forceUpdate?.();
}

function newSet() {
  stashSetDraft();
  selectedSetId.value = null;
  router.apply({ set: null });
  (setForm.value as unknown as { $forceUpdate?: () => void })?.$forceUpdate?.();
}

function onSave({ item }: { item: Item }) {
  snapshot(`Save item “${item.name}”`);
  const next = catalog.upsert(overlay.value, 'items', item.id, item);
  workspace.setWorkspaceOverlay(next);
  delete itemDrafts[item.id];
  selectedId.value = item.id;
  router.apply({ item: item.id });
  notice.value = `Saved “${item.name}”`;
}

function onDelete() {
  const id = selectedId.value!;
  const name = selected.value?.name ?? id;
  snapshot(`Delete item “${name}”`);
  workspace.setWorkspaceOverlay(catalog.remove(overlay.value, 'items', id));
  delete itemDrafts[id];
  selectedId.value = null;
  router.apply({ item: null });
  notice.value = `Removed “${name}”`;
}

function onRevert() {
  const id = selectedId.value!;
  const name = selected.value?.name ?? id;
  snapshot(`Revert item “${name}”`);
  workspace.setWorkspaceOverlay(catalog.revert(overlay.value, 'items', id));
  delete itemDrafts[id];
  notice.value = `Reverted “${name}” to the shipped version`;
}

function restore(row: EditorRow) {
  const group: CatalogGroup = row.kind === 'bonusSet' ? 'bonusSets' : 'items';
  snapshot(`Restore “${row.name}”`);
  workspace.setWorkspaceOverlay(catalog.revert(overlay.value, group, row.key));
  if (row.kind === 'bonusSet') delete setDrafts[row.key];
  else delete itemDrafts[row.key];
  notice.value = `Restored “${row.name}”`;
}

/** Two-step, not a `confirm()` dialog -- same pattern as BuildBar.vue's delete: this
 *  wipes every change in the overlay, and a blocking modal would stall anything driving
 *  the editor programmatically. */
function resetAll() {
  if (!confirmReset.value) {
    confirmReset.value = true;
    confirmResetTimer = window.setTimeout(() => { confirmReset.value = false; }, 4000);
    return;
  }
  window.clearTimeout(confirmResetTimer);
  confirmReset.value = false;
  snapshot('Discard all changes');
  workspace.setWorkspaceOverlay(catalog.emptyOverlay());
  selectedId.value = null;
  selectedSetId.value = null;
  for (const key of Object.keys(itemDrafts)) delete itemDrafts[key];
  for (const key of Object.keys(setDrafts)) delete setDrafts[key];
  router.apply({ item: null, set: null });
  notice.value = 'Discarded every change — back to the shipped data';
}

/** Jump to whatever a validation finding points at, switching section if needed --
 * findings carry `kind` precisely so this doesn't have to guess from the id/name shape. */
function selectFinding(finding: LintFinding) {
  if (!finding.name) return;
  if (finding.kind === 'bonusSet') {
    section.value = 'bonusSets';
    selectedSetId.value = finding.name;
    router.apply({ section: 'bonusSets', set: finding.name, item: null });
  } else {
    section.value = 'items';
    selectedId.value = finding.name;
    router.apply({ section: null, item: finding.name, set: null });
  }
}

// --- bonus sets -----------------------------------------------------------------------
// `onSaveSet`/`onDeleteSet` are the sub-editor inside the item form (a bonus this item
// attaches or detaches); `onSaveSetTop`/`onDeleteSetTop`/`onRevertSetTop` are this
// component's own "Bonus sets" section, browsing and editing a set on its own.

function onSaveSet({ id, set }: { id: string; set: BonusSet }) {
  snapshot(`Save bonus “${set.name || id}”`);
  workspace.setWorkspaceOverlay(catalog.upsert(overlay.value, 'bonusSets', id, set));
  delete setDrafts[id];
  notice.value = `Saved set “${set.name || id}”`;
}

function onDeleteSet(id: string) {
  snapshot(`Delete bonus “${id}”`);
  workspace.setWorkspaceOverlay(catalog.remove(overlay.value, 'bonusSets', id));
  delete setDrafts[id];
  notice.value = `Removed set “${id}”`;
}

function onSaveSetTop({ id, set }: { id: string; set: BonusSet }) {
  snapshot(`Save bonus set “${set.name || id}”`);
  workspace.setWorkspaceOverlay(catalog.upsert(overlay.value, 'bonusSets', id, set));
  delete setDrafts[id];
  selectedSetId.value = id;
  router.apply({ set: id });
  notice.value = `Saved bonus set “${set.name || id}”`;
}

function onDeleteSetTop() {
  const id = selectedSetId.value!;
  snapshot(`Delete bonus set “${id}”`);
  workspace.setWorkspaceOverlay(catalog.remove(overlay.value, 'bonusSets', id));
  delete setDrafts[id];
  selectedSetId.value = null;
  router.apply({ set: null });
  notice.value = `Removed bonus set “${id}”`;
}

function onRevertSetTop() {
  const id = selectedSetId.value!;
  snapshot(`Revert bonus set “${id}”`);
  workspace.setWorkspaceOverlay(catalog.revert(overlay.value, 'bonusSets', id));
  delete setDrafts[id];
  notice.value = `Reverted bonus set “${id}” to the shipped version`;
}

// --- export ---------------------------------------------------------------------------

async function copyExport() {
  try {
    await navigator.clipboard.writeText(exportText.value);
    notice.value = `Copied ${exportName.value} to the clipboard`;
  } catch {
    notice.value = 'Clipboard blocked — select the text and copy it manually';
  }
}

function downloadExport() {
  const blob = new Blob([exportText.value], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = exportName.value;
  link.click();
  URL.revokeObjectURL(url);
}

async function importOverlay(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    snapshot('Import overlay');
    workspace.setWorkspaceOverlay(catalog.normaliseOverlay(parsed));
    notice.value = 'Overlay imported';
  } catch (error: any) {
    notice.value = `Could not read that overlay: ${error.message}`;
  }
  input.value = '';
}

function selectAllText(event: Event) { (event.target as HTMLInputElement).select(); }

watch(statusFilter, (value) => {
  router.apply({ status: value === 'all' ? null : value }, { push: false });
});
watch(query, (value) => {
  router.apply({ q: value || null }, { push: false });
});

onMounted(() => {
  const routed = router.parse();
  if (routed.section === 'bonusSets') {
    section.value = 'bonusSets';
    if (routed.set && db.value.bonusSetById.get(routed.set)) selectedSetId.value = routed.set;
  } else if (routed.item && db.value.get(routed.item)) {
    selectedId.value = routed.item;
  }
  if (isValidStatusFilter(routed.status)) statusFilter.value = routed.status;
  if (routed.q) query.value = routed.q;
  window.addEventListener('popstate', onPopState);
  window.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  window.removeEventListener('popstate', onPopState);
  window.removeEventListener('keydown', onKeydown);
  // This component owns `item`/`set`/`section`/`status`/`q` (App.vue's routing comment above
  // its own `syncRoute` -- it knows nothing about the editor's internals). App.vue's `close`
  // handler and its `view` watcher only ever clear `view` itself, so without this a closed
  // editor would leave stale editor params sitting in the URL. `push: false`: App.vue's own
  // `view` watcher (flush: pre, so it runs first, before this unmount) already pushed the
  // "editor closed" history entry -- this just replaces it with the params stripped, rather
  // than adding a second stop right behind it.
  router.apply({ item: null, set: null, section: null, status: null, q: null }, { push: false });
});
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col p-3">
    <div class="mb-2 flex flex-none flex-wrap items-center gap-1.5">
      <strong>Data editor</strong>
      <TabStrip>
        <TabButton :active="section === 'items'" @click="switchSection('items')">
          Items <span class="text-sm opacity-75 tabular-nums">{{ db.items.length }}</span>
        </TabButton>
        <TabButton :active="section === 'bonusSets'" @click="switchSection('bonusSets')">
          Bonus sets <span class="text-sm opacity-75 tabular-nums">{{ db.bonusSets.length }}</span>
        </TabButton>
      </TabStrip>

      <span class="flex-1"></span>

      <Badge v-if="changedCount" variant="edited">{{ changedCount }} changed</Badge>
      <Badge v-if="errorCount" variant="error">{{ errorCount }} error(s)</Badge>
      <Badge v-if="warnCount" variant="warn">{{ warnCount }} warning(s)</Badge>

      <Button :active="showExport" @click="showExport = !showExport">Export…</Button>
      <Button as="label">Import overlay
        <input type="file" accept=".json" hidden @change="importOverlay"></Button>
      <Button :danger="confirmReset" :disabled="!changedCount" @click="resetAll">
        {{ confirmReset ? 'Really discard?' : 'Discard changes' }}
      </Button>

      <span class="mx-1 h-4 w-px bg-line"></span>

      <HistoryButton type="undo" :disabled="!canUndo" :detail="canUndo ? undoLabel : ''"
              :title="canUndo ? 'Undo: ' + undoLabel + ' (Ctrl+Z)' : 'Nothing to undo'" @click="undo">Undo</HistoryButton>
      <HistoryButton type="redo" :disabled="!canRedo" :detail="canRedo ? redoLabel : ''"
              :title="canRedo ? 'Redo: ' + redoLabel + ' (Ctrl+Shift+Z)' : 'Nothing to redo'" @click="redo">Redo</HistoryButton>

      <Button @click="ui.closeEditor()">✕ Close</Button>
    </div>

    <Notice v-if="notice" class="mb-2" @dismiss="notice = ''">{{ notice }}</Notice>

    <Drawer v-if="showExport" class="mb-2">
      <div class="mb-1.5 flex flex-wrap items-end gap-2">
        <TabStrip>
          <TabButton :active="exportTab === 'items'" @click="exportTab = 'items'">db-items.json</TabButton>
          <TabButton :active="exportTab === 'bonuses'" @click="exportTab = 'bonuses'">db-bonuses.json</TabButton>
          <TabButton :active="exportTab === 'overlay'" @click="exportTab = 'overlay'">overlay only</TabButton>
        </TabStrip>
        <span class="flex-1"></span>
        <Button @click="copyExport">Copy</Button>
        <Button @click="downloadExport">Download {{ exportName }}</Button>
      </div>
      <CodeBlock :value="exportText" :rows="12" />
      <p class="mt-1 text-sm text-muted">
        <template v-if="exportTab === 'overlay'">
          Just your changes. Small, reviewable, and the same shape custom gear will use when
          it is stored with a build.
        </template>
        <template v-else>Replace data/{{ exportName }} with this.</template>
      </p>
    </Drawer>

    <Drawer v-if="findings.length" class="mb-2 max-h-48 flex-none overflow-y-auto">
      <div class="text-sm uppercase text-muted">Validation</div>
      <ul class="mt-1 list-none">
        <li v-for="(finding, i) in findings.slice(0, 40)" :key="i" class="flex gap-2 py-0.5 text-sm">
          <span class="flex-none rounded px-1.5 uppercase"
                :class="finding.level === 'error' ? 'bg-danger-soft text-danger' : 'bg-warn/25 text-warn'">{{ finding.level }}</span>
          <Button v-if="finding.name" variant="link" @click="selectFinding(finding)">{{ finding.name }}</Button>
          <span>{{ finding.message }}</span>
        </li>
      </ul>
      <p v-if="findings.length > 40" class="mt-1 text-sm text-muted">…and {{ findings.length - 40 }} more.</p>
    </Drawer>

    <div class="flex min-h-0 flex-1 flex-col items-stretch gap-3 lg:flex-row">
      <div class="flex min-h-0 flex-none flex-col rounded-md border border-line bg-surface lg:w-96" @keydown="onListKeydown">
        <div class="flex flex-none gap-1.5 border-b border-line p-2">
          <input type="search" class="editor-search min-w-0 flex-1 rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
                 v-model="query" :placeholder="section === 'bonusSets' ? 'Filter bonus sets…' : 'Filter items…'">
          <ComboBox class="w-25" :model-value="statusFilter" :options="statusFilterOptions"
                    @update:model-value="v => statusFilter = v" />
          <Button v-if="query || statusFilter !== 'all'" variant="link" @click="clearFilters">clear filters</Button>
          <Button v-if="section === 'bonusSets'" variant="primary" @click="newSet">+ New bonus set</Button>
          <Button v-else variant="primary" @click="newItem">+ New item</Button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <div v-for="row in filtered" :key="row.key" tabindex="0"
               class="editor-row flex cursor-pointer items-center gap-1.5 border-b border-line/45 px-2 py-1 hover:bg-surface-2"
               :class="row.key === (section === 'bonusSets' ? selectedSetId : selectedId) && 'is-on bg-accent-soft'"
               @click="select(row)">
            <span class="editor-row-name min-w-0 flex-1 truncate">{{ row.name }}</span>
            <Badge v-if="row.status !== 'base'" :variant="row.status as any">{{ row.status }}</Badge>
            <Badge v-if="hasUnsavedDraft(row)" variant="unsaved" title="Unsaved edits in the form">unsaved</Badge>
            <Button v-if="row.status === 'removed'" variant="link" @click.stop="restore(row)">restore</Button>
            <span v-else class="text-sm text-muted">{{ row.filter }}</span>
          </div>
          <p v-if="!filtered.length" class="p-2 text-muted">Nothing matches.</p>
        </div>
      </div>

      <div class="min-w-0 flex-1 overflow-y-auto rounded-md border border-line bg-surface p-2.5">
        <ItemForm
          v-if="section === 'items'"
          ref="form"
          :key="selectedId ?? '__new__'"
          :source="selected"
          :status="selectedStatus"
          :initial-draft="selectedId != null ? (itemDrafts[selectedId] ?? null) : null"
          :db="db"
          :filters="filters"
          :set-ids="setIds"
          :tags="tagList"
          :bonus-ids="bonusIds"
          @save="onSave"
          @delete="onDelete"
          @revert="onRevert"
          @save-set="onSaveSet"
          @delete-set="onDeleteSet"
          @dirty="formDirty = $event" />
        <BonusSetForm
          v-else
          ref="setForm"
          :key="selectedSetId ?? '__new__'"
          :source="selectedSet"
          :status="selectedSetStatus"
          :initial-draft="selectedSetId != null ? (setDrafts[selectedSetId] ?? null) : null"
          :db="db"
          :set-ids="setIds"
          :tags="tagList"
          :bonus-ids="bonusIds"
          @save="onSaveSetTop"
          @delete="onDeleteSetTop"
          @revert="onRevertSetTop"
          @dirty="formDirty = $event" />
      </div>
    </div>
  </div>
</template>
