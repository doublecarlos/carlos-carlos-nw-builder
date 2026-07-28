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
import BonusSetForm from './BonusSetForm.vue';
import ComboBox from './ComboBox.vue';
import * as catalog from '../catalog';
import * as router from '../router';

const UNDO_LIMIT = 50;

const props = defineProps<{
  db: any;
  overlay: any;
}>();

const emit = defineEmits<{
  'update-overlay': [overlay: any];
  close: [];
}>();

const query = ref('');
const statusFilter = ref('all');      // all | changed | added | edited | removed
const section = ref('items');         // items | bonusSets
const selectedName = ref<string | null>(null);
const selectedSetId = ref<string | null>(null);
const showExport = ref(false);
const exportTab = ref('items');       // items | bonuses | overlay
const formDirty = ref(false);
const notice = ref('');
const confirmReset = ref(false);
let confirmResetTimer: number | undefined;
// JSON snapshots of `overlay` (this component's prop), taken right before each committed
// change (save/delete/revert/restore/reset/import) -- the same "snapshot before, restore
// by re-emitting the JSON" shape as app.js's build undo, just one stream instead of one
// per build, since there is only ever one overlay. Strings, not objects, so undoing a
// hundred-item overlay a dozen times doesn't keep a dozen live deep copies around.
const history = ref<{ past: { json: string; label: string }[]; future: { json: string; label: string }[] }>({ past: [], future: [] });
// itemName/setId -> that form's in-progress `draft`, stashed just before switching away
// from it while dirty (see `stashCurrentDraft`) so picking a different row doesn't
// silently throw the edit away -- restored via `initialDraft` if the same row is
// reselected. Only ever keyed by a *real* name/id, never the new-item/-set placeholder:
// "+ New item" is a deliberate "start fresh" action, not a navigation to preserve.
const itemDrafts = reactive<Record<string, any>>({});
const setDrafts = reactive<Record<string, any>>({});

const form = ref<InstanceType<typeof ItemForm> | null>(null);
const setForm = ref<InstanceType<typeof BonusSetForm> | null>(null);

// Removed entries are gone from `db`, so the list is built from the composed catalogue
// plus the overlay's tombstones -- otherwise a deletion would vanish with no way back.
const itemRows = computed(() => {
  const rows: any[] = props.db.items.map((item: any) => ({
    key: item.name,
    name: item.name,
    filter: item.filter,
    item,
    status: catalog.statusOf(props.overlay, 'items', item.name),
    kind: 'item',
  }));
  for (const [name, value] of Object.entries(props.overlay.items ?? {})) {
    if (value === null) {
      rows.push({ key: name, name, filter: '—', item: null, status: 'removed', kind: 'item' });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
});

/** Same shape as `itemRows`, one row per bonus set rather than per item -- so the same
 * list/search/keyboard-nav code serves both without knowing which it's showing. */
const bonusSetRows = computed(() => {
  const rows: any[] = props.db.bonusSets.map((set: any) => ({
    key: set.id,
    name: set.name || set.id,
    filter: `${(set.grants ?? []).length} grant(s)`,
    set,
    status: catalog.statusOf(props.overlay, 'bonusSets', set.id),
    kind: 'bonusSet',
  }));
  for (const [id, value] of Object.entries(props.overlay.bonusSets ?? {})) {
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
  if (selectedName.value == null) return null;
  return props.db.get(selectedName.value);
});

const selectedStatus = computed(() => (selectedName.value == null
  ? 'base'
  : catalog.statusOf(props.overlay, 'items', selectedName.value)));

const selectedSet = computed(() => {
  if (selectedSetId.value == null) return null;
  return props.db.bonusSetById.get(selectedSetId.value) ?? null;
});

const selectedSetStatus = computed(() => (selectedSetId.value == null
  ? 'base'
  : catalog.statusOf(props.overlay, 'bonusSets', selectedSetId.value)));

const filters = computed<string[]>(() => [...new Set<string>(props.db.items.map((item: any) => item.filter).filter(Boolean))].sort());

const setIds = computed<string[]>(() => [...new Set<string>(props.db.bonusSets.map((set: any) => set.id))].sort());

const tagList = computed<string[]>(() => [...props.db.itemsByTag.keys()].sort());

/** The vocabulary for `excludes`. A set now resolves as one unit, so only sets (not
 * individual grants) are addressable -- same list as `setIds`, kept as its own computed
 * since the two are used for unrelated purposes at the call sites. */
const bonusIds = computed(() => setIds.value);

const changedCount = computed(() => Object.keys(props.overlay.items ?? {}).length
  + Object.keys(props.overlay.bonusSets ?? {}).length);

const findings = computed(() => catalog.validate(props.db.items, props.db.bonusSets));

const errorCount = computed(() => findings.value.filter((f) => f.level === 'error').length);
const warnCount = computed(() => findings.value.filter((f) => f.level === 'warn').length);

const exportText = computed(() => {
  if (exportTab.value === 'items') return catalog.toItemsFile(props.db.items);
  if (exportTab.value === 'bonuses') return catalog.toBonusesFile(props.db.bonusSets);
  return JSON.stringify(props.overlay, null, 2);
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
// import) -- one stream, not one per build the way app.js keys its own history, since
// there is only ever one overlay. Ordinary in-progress editing (typing, checking a class
// box) has its own separate, lower-level undo scoped to whichever form is open --
// ItemForm's/BonusSetForm's own `draftHistory` -- that `onKeydown` below tries
// first; this one only ever sees a fresh snapshot right before a commit lands.

function snapshot(label: string) {
  history.value.past.push({ json: JSON.stringify(props.overlay), label });
  if (history.value.past.length > UNDO_LIMIT) history.value.past.shift();
  history.value.future.length = 0;
}

function undo() {
  if (!canUndo.value) return;
  const entry = history.value.past.pop()!;
  history.value.future.push({ json: JSON.stringify(props.overlay), label: entry.label });
  emit('update-overlay', JSON.parse(entry.json));
}

function redo() {
  if (!canRedo.value) return;
  const entry = history.value.future.pop()!;
  history.value.past.push({ json: JSON.stringify(props.overlay), label: entry.label });
  emit('update-overlay', JSON.parse(entry.json));
}

/**
 * Same Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y convention as app.js's builder undo, including which
 * fields it defers to native undo for -- only `<textarea>` (the export/import JSON boxes),
 * not every `<input>`. app.js hijacks Ctrl+Z inside ordinary fields on purpose, and the
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
  const activeForm: any = section.value === 'bonusSets' ? setForm.value : form.value;
  if (key === 'y' || event.shiftKey) {
    if (activeForm?.redoDraft?.()) return;
    redo();
  } else {
    if (activeForm?.undoDraft?.()) return;
    undo();
  }
}

// --- unsaved form drafts ----------------------------------------------------------------
// Switching rows used to remount the form fresh (`:key="selectedName ?? '__new__'"`) and
// silently drop whatever was mid-edit. Stashing here, right before the key changes, means
// the draft survives the trip and comes back via `initialDraft` if the same row is
// reselected -- see `itemDrafts`/`setDrafts` above.

function stashItemDraft() {
  if (selectedName.value == null) return;
  const f: any = form.value;
  if (f?.dirty) itemDrafts[selectedName.value] = f.draft;
  else delete itemDrafts[selectedName.value];
}

function stashSetDraft() {
  if (selectedSetId.value == null) return;
  const f: any = setForm.value;
  if (f?.dirty) setDrafts[selectedSetId.value] = f.draft;
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
function hasUnsavedDraft(row: any) {
  if (row.kind === 'bonusSet') {
    if (row.key === selectedSetId.value) return formDirty.value;
    return Boolean(setDrafts[row.key]);
  }
  if (row.key === selectedName.value) return formDirty.value;
  return Boolean(itemDrafts[row.key]);
}

// --- filters ---------------------------------------------------------------------------

function clearFilters() {
  query.value = '';
  statusFilter.value = 'all';
}

// --- routing --------------------------------------------------------------------------
// `item`/`set`/`section`/`status`/`q` are this component's own corner of the URL --
// app.js owns view/build/tab and knows nothing about what's selected in here. `select`'s
// `push` flag is what keeps arrow-key browsing from filling the back/forward stack with
// one stop per keystroke: a click is a real "go to this row" navigation, an arrow key is
// just skimming.

function isValidStatusFilter(value: any) {
  return statusFilterOptions.some((option) => option.value === value);
}

/** Back/forward landed on this component while it was already mounted (still in the
 * editor, just a different item/set/section/status filter/query). A fresh mount reads the
 * same params in `onMounted`. */
function onPopState() {
  const route = router.parse();
  if (route.section === 'bonusSets') {
    section.value = 'bonusSets';
    selectedSetId.value = (route.set && props.db.bonusSetById.get(route.set)) ? route.set : null;
  } else {
    section.value = 'items';
    selectedName.value = (route.item && props.db.get(route.item)) ? route.item : null;
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
    : { section: null, set: null, item: selectedName.value });
}

function select(row: any, { push = true }: { push?: boolean } = {}) {
  if (row.status === 'removed') return;
  stashCurrentDraft();
  if (row.kind === 'bonusSet') {
    selectedSetId.value = row.key;
    router.apply({ set: row.key, item: null }, { push });
  } else {
    selectedName.value = row.key;
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
  const currentKey = section.value === 'bonusSets' ? selectedSetId.value : selectedName.value;
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
  selectedName.value = null;
  router.apply({ item: null });
  // Remounts ItemForm with an empty draft even if it was already showing a new item.
  (form.value as any)?.$forceUpdate?.();
}

function newSet() {
  stashSetDraft();
  selectedSetId.value = null;
  router.apply({ set: null });
  (setForm.value as any)?.$forceUpdate?.();
}

function onSave({ item, previousName }: { item: any; previousName: string | null }) {
  snapshot(`Save item “${item.name}”`);
  const next = catalog.upsert(props.overlay, 'items', item.name, item, previousName ?? undefined);
  emit('update-overlay', next);
  delete itemDrafts[item.name];
  if (previousName && previousName !== item.name) delete itemDrafts[previousName];
  selectedName.value = item.name;
  router.apply({ item: item.name });
  notice.value = `Saved “${item.name}”`;
}

function onDelete() {
  const name = selectedName.value!;
  snapshot(`Delete item “${name}”`);
  emit('update-overlay', catalog.remove(props.overlay, 'items', name));
  delete itemDrafts[name];
  selectedName.value = null;
  router.apply({ item: null });
  notice.value = `Removed “${name}”`;
}

function onRevert() {
  const name = selectedName.value!;
  snapshot(`Revert item “${name}”`);
  emit('update-overlay', catalog.revert(props.overlay, 'items', name));
  delete itemDrafts[name];
  notice.value = `Reverted “${name}” to the shipped version`;
}

function restore(row: any) {
  const group = row.kind === 'bonusSet' ? 'bonusSets' : 'items';
  snapshot(`Restore “${row.name}”`);
  emit('update-overlay', catalog.revert(props.overlay, group, row.key));
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
  emit('update-overlay', catalog.emptyOverlay());
  selectedName.value = null;
  selectedSetId.value = null;
  for (const key of Object.keys(itemDrafts)) delete itemDrafts[key];
  for (const key of Object.keys(setDrafts)) delete setDrafts[key];
  router.apply({ item: null, set: null });
  notice.value = 'Discarded every change — back to the shipped data';
}

/** Jump to whatever a validation finding points at, switching section if needed --
 * findings carry `kind` precisely so this doesn't have to guess from the id/name shape. */
function selectFinding(finding: any) {
  if (!finding.name) return;
  if (finding.kind === 'bonusSet') {
    section.value = 'bonusSets';
    selectedSetId.value = finding.name;
    router.apply({ section: 'bonusSets', set: finding.name, item: null });
  } else {
    section.value = 'items';
    selectedName.value = finding.name;
    router.apply({ section: null, item: finding.name, set: null });
  }
}

// --- bonus sets -----------------------------------------------------------------------
// `onSaveSet`/`onDeleteSet` are the sub-editor inside the item form (a bonus this item
// attaches or detaches); `onSaveSetTop`/`onDeleteSetTop`/`onRevertSetTop` are this
// component's own "Bonus sets" section, browsing and editing a set on its own.

/**
 * Renaming a shared bonus set's *id* (not its display name -- items never reference that)
 * would otherwise only ever patch the array of whichever item's form happened to be open;
 * every other item that also lists the old id is left pointing at a dead one, and just
 * silently stops granting it. Every item currently granting `oldId` gets its own overlay
 * entry rewritten to `newId`, folded into the same overlay update as the rename itself --
 * including the item whose form triggered the rename, so the fix holds even if that item
 * is never explicitly re-saved.
 */
function cascadeSetRename(overlay: any, oldId: string, newId: string) {
  const affected = (props.db.setMembers.get(oldId) ?? [])
    .map((name: string) => props.db.get(name))
    .filter((item: any) => item?.bonuses?.includes(oldId));
  let next = overlay;
  for (const item of affected) {
    const updated = { ...item, bonuses: item.bonuses.map((bid: string) => (bid === oldId ? newId : bid)) };
    next = catalog.upsert(next, 'items', item.name, updated, item.name);
  }
  return { overlay: next, count: affected.length };
}

function onSaveSet({ id, set, previousId }: { id: string; set: any; previousId: string | null }) {
  snapshot(`Save bonus “${set.name || id}”`);
  let next = catalog.upsert(props.overlay, 'bonusSets', id, set, previousId ?? id);
  let extra = '';
  if (previousId && previousId !== id) {
    const cascade = cascadeSetRename(next, previousId, id);
    next = cascade.overlay;
    if (cascade.count) extra = ` — updated ${cascade.count} other item(s) that referenced the old id`;
  }
  emit('update-overlay', next);
  delete setDrafts[id];
  if (previousId && previousId !== id) delete setDrafts[previousId];
  notice.value = `Saved set “${set.name || id}”${extra}`;
}

function onDeleteSet(id: string) {
  snapshot(`Delete bonus “${id}”`);
  emit('update-overlay', catalog.remove(props.overlay, 'bonusSets', id));
  delete setDrafts[id];
  notice.value = `Removed set “${id}”`;
}

function onSaveSetTop({ id, set, previousId }: { id: string; set: any; previousId: string | null }) {
  snapshot(`Save bonus set “${set.name || id}”`);
  let next = catalog.upsert(props.overlay, 'bonusSets', id, set, previousId ?? undefined);
  let extra = '';
  if (previousId && previousId !== id) {
    const cascade = cascadeSetRename(next, previousId, id);
    next = cascade.overlay;
    if (cascade.count) extra = ` — updated ${cascade.count} item(s) that referenced the old id`;
  }
  emit('update-overlay', next);
  delete setDrafts[id];
  if (previousId && previousId !== id) delete setDrafts[previousId];
  selectedSetId.value = id;
  router.apply({ set: id });
  notice.value = `Saved bonus set “${set.name || id}”${extra}`;
}

function onDeleteSetTop() {
  const id = selectedSetId.value!;
  snapshot(`Delete bonus set “${id}”`);
  emit('update-overlay', catalog.remove(props.overlay, 'bonusSets', id));
  delete setDrafts[id];
  selectedSetId.value = null;
  router.apply({ set: null });
  notice.value = `Removed bonus set “${id}”`;
}

function onRevertSetTop() {
  const id = selectedSetId.value!;
  snapshot(`Revert bonus set “${id}”`);
  emit('update-overlay', catalog.revert(props.overlay, 'bonusSets', id));
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
    emit('update-overlay', catalog.normaliseOverlay(parsed));
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
    if (routed.set && props.db.bonusSetById.get(routed.set)) selectedSetId.value = routed.set;
  } else if (routed.item && props.db.get(routed.item)) {
    selectedName.value = routed.item;
  }
  if (isValidStatusFilter(routed.status)) statusFilter.value = routed.status;
  if (routed.q) query.value = routed.q;
  window.addEventListener('popstate', onPopState);
  window.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  window.removeEventListener('popstate', onPopState);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="editor">
    <div class="editor-bar">
      <strong>Data editor</strong>
      <div class="tabs">
        <button type="button" class="tab" :class="{ 'is-on': section === 'items' }"
                @click="switchSection('items')">Items <span class="tab-count">{{ db.items.length }}</span></button>
        <button type="button" class="tab" :class="{ 'is-on': section === 'bonusSets' }"
                @click="switchSection('bonusSets')">Bonus sets <span class="tab-count">{{ db.bonusSets.length }}</span></button>
      </div>

      <span class="spacer"></span>

      <span v-if="changedCount" class="badge badge--edited">{{ changedCount }} changed</span>
      <span v-if="errorCount" class="badge badge--error">{{ errorCount }} error(s)</span>
      <span v-if="warnCount" class="badge badge--warn">{{ warnCount }} warning(s)</span>

      <button type="button" class="btn" :class="{ 'is-on': showExport }"
              @click="showExport = !showExport">Export…</button>
      <label class="btn">Import overlay
        <input type="file" accept=".json" hidden @change="importOverlay"></label>
      <button type="button" class="btn" :class="{ 'is-danger': confirmReset }"
              :disabled="!changedCount" @click="resetAll">
        {{ confirmReset ? 'Really discard?' : 'Discard changes' }}
      </button>

      <span class="sep"></span>

      <button type="button" class="btn btn--history" :disabled="!canUndo"
              :title="canUndo ? 'Undo: ' + undoLabel + ' (Ctrl+Z)' : 'Nothing to undo'" @click="undo">
        ↶ Undo<span v-if="canUndo" class="btn-detail">{{ undoLabel }}</span>
      </button>
      <button type="button" class="btn btn--history" :disabled="!canRedo"
              :title="canRedo ? 'Redo: ' + redoLabel + ' (Ctrl+Shift+Z)' : 'Nothing to redo'" @click="redo">
        ↷ Redo<span v-if="canRedo" class="btn-detail">{{ redoLabel }}</span>
      </button>

      <button type="button" class="btn" @click="$emit('close')">← Back to builder</button>
    </div>

    <p v-if="notice" class="notice" @click="notice = ''">{{ notice }}</p>

    <div v-if="showExport" class="drawer">
      <div class="drawer-row">
        <div class="tabs">
          <button type="button" class="tab" :class="{ 'is-on': exportTab === 'items' }"
                  @click="exportTab = 'items'">db-items.json</button>
          <button type="button" class="tab" :class="{ 'is-on': exportTab === 'bonuses' }"
                  @click="exportTab = 'bonuses'">db-bonuses.json</button>
          <button type="button" class="tab" :class="{ 'is-on': exportTab === 'overlay' }"
                  @click="exportTab = 'overlay'">overlay only</button>
        </div>
        <span class="spacer"></span>
        <button type="button" class="btn" @click="copyExport">Copy</button>
        <button type="button" class="btn" @click="downloadExport">Download {{ exportName }}</button>
      </div>
      <textarea class="code" rows="12" readonly :value="exportText" @focus="selectAllText"></textarea>
      <p class="hint">
        <template v-if="exportTab === 'overlay'">
          Just your changes. Small, reviewable, and the same shape custom gear will use when
          it is stored with a build.
        </template>
        <template v-else>
          The whole file, in the key order tools/migrate_bonuses.py emits — replace
          data/{{ exportName }} with this.
        </template>
      </p>
    </div>

    <div v-if="findings.length" class="drawer drawer--findings">
      <div class="drawer-head">Validation</div>
      <ul class="findings">
        <li v-for="(finding, i) in findings.slice(0, 40)" :key="i" :class="finding.level">
          <span class="finding-level">{{ finding.level }}</span>
          <button v-if="finding.name" type="button" class="link"
                  @click="selectFinding(finding)">{{ finding.name }}</button>
          <span>{{ finding.message }}</span>
        </li>
      </ul>
      <p v-if="findings.length > 40" class="hint">…and {{ findings.length - 40 }} more.</p>
    </div>

    <div class="editor-body">
      <div class="editor-list" @keydown="onListKeydown">
        <div class="editor-list-head">
          <input type="search" class="editor-search" v-model="query"
                 :placeholder="section === 'bonusSets' ? 'Filter bonus sets…' : 'Filter items…'">
          <ComboBox class="combo--status" :model-value="statusFilter" :options="statusFilterOptions"
                    @update:model-value="v => statusFilter = v" />
          <button v-if="query || statusFilter !== 'all'" type="button" class="link"
                  @click="clearFilters">clear filters</button>
          <button v-if="section === 'bonusSets'" type="button" class="btn btn--primary"
                  @click="newSet">+ New bonus set</button>
          <button v-else type="button" class="btn btn--primary" @click="newItem">+ New item</button>
        </div>
        <div class="editor-list-body">
          <div v-for="row in filtered" :key="row.key" class="editor-row" tabindex="0"
               :class="{ 'is-on': row.key === (section === 'bonusSets' ? selectedSetId : selectedName) }"
               @click="select(row)">
            <span class="editor-row-name">{{ row.name }}</span>
            <span v-if="row.status !== 'base'" class="badge" :class="'badge--' + row.status">
              {{ row.status }}
            </span>
            <span v-if="hasUnsavedDraft(row)" class="badge badge--unsaved"
                  title="Unsaved edits in the form">unsaved</span>
            <button v-if="row.status === 'removed'" type="button" class="link"
                    @click.stop="restore(row)">restore</button>
            <span v-else class="editor-row-filter">{{ row.filter }}</span>
          </div>
          <p v-if="!filtered.length" class="dim" style="padding:8px">Nothing matches.</p>
        </div>
      </div>

      <div class="editor-form">
        <ItemForm
          v-if="section === 'items'"
          ref="form"
          :key="selectedName ?? '__new__'"
          :source="selected"
          :status="selectedStatus"
          :initial-draft="selectedName != null ? (itemDrafts[selectedName] ?? null) : null"
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
