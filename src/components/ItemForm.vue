<script setup lang="ts">
// Editing form for one item: its fields, and the bonus groups it belongs to.
//
// Works on a *draft* and saves explicitly. Live-editing the overlay would mean a rename fires
// once per keystroke, each one creating and tombstoning entries -- and the whole point of the
// overlay is that it is a clean record of what the user changed.
//
// Bonus editing itself lives entirely in BonusGroups below -- there is no separate "this
// item's own bonuses" concept here any more; a bonus only this item grants is just a group
// with one member.
import { ref, computed, watch, onUnmounted } from 'vue';
import BonusGroups from './BonusGroups.vue';
import TokenInput from './TokenInput.vue';
import PercentInput from './PercentInput.vue';
import ComboBox from './ComboBox.vue';
import IconButton from './IconButton.vue';
import { NW_SCHEMA } from '../data';
import { isPercentKind, kindOf } from '../format';
import { focusNextCombo } from '../stat-row-nav';
import type { Item, Db, BonusSet } from '../types';
import type { StatRow } from '../bonus-draft';

/**
 * Key-order-insensitive comparison. `toItem` rebuilds the object in the exporter's key
 * order, which almost never matches the order the source happens to have, so a plain
 * `JSON.stringify` comparison reports every untouched item as modified.
 */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
};

const sameItem = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// Draft-level undo: separate from (and beneath) DataEditor's own undo over *committed*
// overlay changes -- this one covers ordinary editing (typing, checking a class box, adding a
// stat row) before a Save ever happens, the same thing App.vue's undo does for the build form.
// The build form gets there by having every mutation go through a named method that snapshots
// first; a form this size (name/filter/tags/classes/stats/dynamic mod/excludes) would need a
// wrapper per field to do the same. A debounced deep watch on `draft` gets the same result
// without one: `commitSnapshot` compares the settled draft against `lastSnapshotJson` (the
// draft as of the last step) and pushes *that* onto `past` if anything moved -- so a burst of
// keystrokes between pauses becomes one undo step, same grouping App.vue's own `COALESCE_MS`
// gives the build form's fields.
const SNAPSHOT_DEBOUNCE_MS = 700;
const UNDO_LIMIT = 50;

const props = withDefaults(defineProps<{
  /** The item being edited, or null for a brand-new one. */
  source?: Item | null;
  status?: string;
  db: Db;
  filters?: string[];
  setIds?: string[];
  tags?: string[];
  bonusIds?: string[];
  /** A draft stashed by DataEditor the last time this item's form was navigated away
   * from while dirty -- read once, on mount, so re-selecting an item you were mid-edit on
   * picks back up instead of silently reverting to the saved version. Plain-data only (no
   * functions), so a JSON round trip is enough to give this component its own copy rather
   * than sharing references with the stash. */
  initialDraft?: ItemDraft | null;
}>(), {
  source: null,
  status: 'base',
  filters: () => [],
  setIds: () => [],
  tags: () => [],
  bonusIds: () => [],
  initialDraft: null,
});

const emit = defineEmits<{
  save: [payload: { item: Item; previousName: string | null }];
  delete: [];
  revert: [];
  dirty: [value: boolean];
  'save-set': [payload: { id: string; previousId: string | null; set: BonusSet }];
  'delete-set': [id: string];
}>();

export interface ItemDraft {
  name: string;
  filter: string;
  // `number | string | null`, not just `number`: v-model.number (see the template) leaves an
  // emptied number input as the literal string '', not 0 -- same convention as PercentInput's
  // own modelValue.
  maxCopies: number | string | null;
  allowedClass: string[];
  tags: string[];
  bonuses: string[];
  excludes: string[];
  dynamicStat: string;
  dynamicMin: number | string | null;
  dynamicMax: number | string | null;
  stats: StatRow[];
}

function buildDraft(item: Item | null | undefined): ItemDraft {
  const source = item ?? {} as Partial<Item>;
  const statKeys = new Set(NW_SCHEMA.statKeys);
  return {
    name: source.name ?? '',
    filter: source.filter ?? '',
    maxCopies: source.maxCopies ?? null,
    allowedClass: [...(source.allowedClass ?? [])],
    tags: [...(source.tags ?? [])],
    bonuses: [...(source.bonuses ?? [])],
    excludes: [...(source.excludes ?? [])],
    dynamicStat: source.dynamicStat ?? '',
    dynamicMin: source.dynamicMin ?? null,
    dynamicMax: source.dynamicMax ?? null,
    stats: Object.keys(source)
      .filter((key) => statKeys.has(key))
      .map((key) => ({ key, value: source[key as keyof Item] as number })),
  };
}

const draft = ref<ReturnType<typeof buildDraft>>(props.initialDraft
  ? JSON.parse(JSON.stringify(props.initialDraft))
  : buildDraft(props.source));
const error = ref('');
const draftHistory = ref<{ past: string[]; future: string[] }>({ past: [], future: [] });
const lastSnapshotJson = ref(JSON.stringify(draft.value));
let snapshotTimer: number | undefined;
// Two-step confirm for "discard my unsaved edits" -- same pattern (and same 4s window)
// as BuildBar's own Revert. No watch needed to reset it on an identity change the
// way BuildBar resets on `build.id`: this component remounts fresh every time the
// selected item changes, via DataEditor's `:key`.
const confirmRevert = ref(false);
let confirmRevertTimer: number | undefined;

const statOptions = NW_SCHEMA.stats;
const classes = NW_SCHEMA.context.classes;

const statComboOptions = statOptions.map((s) => ({ value: s.key, label: `${s.label} (${s.key})` }));
const dynamicStatOptions = statOptions.map((s) => ({ value: s.key, label: s.label }));

/** Draft -> the sparse item object the engine and the exporter expect. */
function toItem(): Item {
  const local = draft.value;
  const item: Item = { name: local.name.trim(), filter: local.filter.trim() };

  for (const { key, value } of local.stats) {
    if (!key) continue;
    const number = Number(value);
    if (value === '' || value == null || !Number.isFinite(number)) continue;
    item[key] = number;
  }

  if (local.tags.length) item.tags = [...local.tags];
  if (local.bonuses.length) item.bonuses = [...local.bonuses];
  if (local.excludes.length) item.excludes = [...local.excludes];
  if (local.maxCopies) item.maxCopies = Number(local.maxCopies);
  if (local.allowedClass.length) item.allowedClass = [...local.allowedClass];

  if (local.dynamicStat) {
    item.dynamicStat = local.dynamicStat;
    if (local.dynamicMin != null && local.dynamicMin !== '') {
      item.dynamicMin = Number(local.dynamicMin);
    }
    if (local.dynamicMax != null && local.dynamicMax !== '') {
      item.dynamicMax = Number(local.dynamicMax);
    }
  }

  return item;
}

const dirty = computed(() => {
  const item = toItem();
  // An untouched blank form is not a pending change.
  if (!props.source) return Boolean(item.name || item.filter || draft.value.stats.length);
  return !sameItem(item, props.source);
});

const canUndoDraft = computed(() => draftHistory.value.past.length > 0);
const canRedoDraft = computed(() => draftHistory.value.future.length > 0);

const isPercent = (key: string) => isPercentKind(kindOf(key));

// --- draft undo -------------------------------------------------------------------------

function resetDraftHistory() {
  window.clearTimeout(snapshotTimer);
  draftHistory.value = { past: [], future: [] };
  lastSnapshotJson.value = JSON.stringify(draft.value);
}

function scheduleSnapshot() {
  window.clearTimeout(snapshotTimer);
  snapshotTimer = window.setTimeout(() => commitSnapshot(), SNAPSHOT_DEBOUNCE_MS);
}

/** Pushes the draft as it stood at the last commit onto `past`, then moves the baseline
 * up to the now-settled draft -- called after typing pauses (`scheduleSnapshot`) and
 * flushed immediately before `undoDraft` reads `past`, so a `Ctrl+Z` right after a
 * keystroke (before the debounce would have fired on its own) still undoes it. */
function commitSnapshot() {
  window.clearTimeout(snapshotTimer);
  const current = JSON.stringify(draft.value);
  if (current === lastSnapshotJson.value) return;
  draftHistory.value.past.push(lastSnapshotJson.value);
  if (draftHistory.value.past.length > UNDO_LIMIT) draftHistory.value.past.shift();
  draftHistory.value.future.length = 0;
  lastSnapshotJson.value = current;
}

/** Returns whether it actually undid anything, so the caller (DataEditor's keydown
 * handler) knows to fall back to the editor's own undo over *committed* changes once this
 * form has nothing left to give back. Exposed via defineExpose for that same caller, which
 * reaches it through a template ref (`<script setup>` components are closed by default). */
function undoDraft() {
  commitSnapshot();
  if (!draftHistory.value.past.length) return false;
  draftHistory.value.future.push(lastSnapshotJson.value);
  lastSnapshotJson.value = draftHistory.value.past.pop()!;
  draft.value = JSON.parse(lastSnapshotJson.value);
  return true;
}

function redoDraft() {
  if (!draftHistory.value.future.length) return false;
  draftHistory.value.past.push(lastSnapshotJson.value);
  lastSnapshotJson.value = draftHistory.value.future.pop()!;
  draft.value = JSON.parse(lastSnapshotJson.value);
  return true;
}

defineExpose({ draft, dirty, undoDraft, redoDraft });

/** Discards the unsaved draft, back to whatever is currently saved (the shipped item, or
 * an already-saved overlay edit -- unlike `@revert`/"Revert to shipped", this never
 * touches the overlay itself). Two-step, not a `confirm()` dialog, same reasoning as
 * BuildBar's own Revert. */
function revertDraft() {
  if (!confirmRevert.value) {
    confirmRevert.value = true;
    confirmRevertTimer = window.setTimeout(() => { confirmRevert.value = false; }, 4000);
    return;
  }
  window.clearTimeout(confirmRevertTimer);
  confirmRevert.value = false;
  draft.value = buildDraft(props.source);
  error.value = '';
  resetDraftHistory();
}

function save() {
  error.value = '';
  const item = toItem();
  if (!item.name) { error.value = 'The item needs a name.'; return; }
  if (!item.filter) { error.value = 'The item needs a filter, or no slot can hold it.'; return; }
  emit('save', { item, previousName: props.source?.name ?? null });
}

function addStat() { draft.value.stats.push({ key: '', value: 0 }); }
function removeStat(index: number) { draft.value.stats.splice(index, 1); }
function focusNextStat(event: KeyboardEvent) { focusNextCombo(event); }

/**
 * A bonus created or attached from the Bonuses section is attached to this item straight
 * away. Assigns a new array rather than pushing: BonusGroups watches `setIds`, and an
 * in-place push keeps the same reference, so the watcher would not fire and the new
 * group would render with no draft behind it.
 */
function attachSet(id: string) {
  if (draft.value.bonuses.includes(id)) return;
  draft.value.bonuses = [...draft.value.bonuses, id];
}

/** A card with no saved definition has nothing in the catalogue to remove -- just drop
 * the id from this item's own list. */
function detachSet(id: string) {
  draft.value.bonuses = draft.value.bonuses.filter((setId: string) => setId !== id);
}

/** Keep this item pointed at a bonus group that was just renamed (same array-replace
 * trick as `attachSet`, so BonusGroups's `setIds` watcher fires). */
function renameSet({ oldId, newId }: { oldId: string; newId: string }) {
  draft.value.bonuses = draft.value.bonuses.map((id: string) => (id === oldId ? newId : id));
}

watch(() => props.source, (value) => {
  draft.value = buildDraft(value);
  error.value = '';
  // A save (the common way `source` changes under an unchanged key) makes the prior
  // draft history meaningless -- there is nothing left upstream of the just-saved state
  // worth undoing back to.
  resetDraftHistory();
});

watch(dirty, (value) => emit('dirty', value), { immediate: true });

watch(draft, () => scheduleSnapshot(), { deep: true });

onUnmounted(() => {
  window.clearTimeout(snapshotTimer);
  window.clearTimeout(confirmRevertTimer);
});
</script>

<template>
  <div class="form">
    <div class="form-bar">
      <strong>{{ draft.name || 'New item' }}</strong>
      <span v-if="status !== 'base'" class="badge" :class="'badge--' + status">{{ status }}</span>
      <span v-if="dirty" class="badge badge--near">unsaved</span>
      <span class="spacer"></span>
      <button type="button" class="btn btn--history" :disabled="!canUndoDraft"
              title="Undo edit (Ctrl+Z)" @click="undoDraft">↶ Undo</button>
      <button type="button" class="btn btn--history" :disabled="!canRedoDraft"
              title="Redo edit (Ctrl+Shift+Z)" @click="redoDraft">↷ Redo</button>
      <button type="button" class="btn btn--primary" :disabled="!dirty" @click="save">Save item</button>
      <button type="button" class="btn" :class="{ 'is-danger': confirmRevert }"
              :disabled="!dirty" @click="revertDraft">
        {{ confirmRevert ? 'Really revert?' : 'Revert' }}
      </button>
      <button v-if="status === 'edited'" type="button" class="btn"
              @click="$emit('revert')">Revert to shipped</button>
      <button v-if="source" type="button" class="btn" @click="$emit('delete')">Delete</button>
    </div>

    <p v-if="error" class="drawer-error">{{ error }}</p>

    <div class="form-grid">
      <label class="field"><span class="field-label">Name</span>
        <input type="text" v-model="draft.name"></label>
      <label class="field"><span class="field-label">Filter (slot category)</span>
        <input type="text" v-model="draft.filter" list="nw-filters"></label>
      <label class="field"><span class="field-label">Max copies (0 = unlimited)</span>
        <input type="number" min="0" v-model.number="draft.maxCopies"></label>
    </div>

    <datalist id="nw-filters">
      <option v-for="f in filters" :key="f" :value="f"></option>
    </datalist>
    <datalist id="nw-tags">
      <option v-for="t in tags" :key="t" :value="t"></option>
    </datalist>

    <div class="form-grid form-grid--tokens">
      <div class="field"><span class="field-label">Tags</span>
        <TokenInput v-model="draft.tags" :options="tags" placeholder="Add a tag…" /></div>
    </div>

    <div class="form-section">Restricted to classes</div>
    <div class="drawer-grid">
      <label v-for="cls in classes" :key="cls" class="check">
        <input type="checkbox" :value="cls" v-model="draft.allowedClass">
        <span>{{ cls }}</span>
      </label>
    </div>

    <div class="form-section">Stats</div>
    <div v-for="(stat, index) in draft.stats" :key="index" class="stat-row">
      <IconButton icon="plus" title="Add stat" @click="addStat" />
      <IconButton icon="trash" title="Remove stat" @click="removeStat(index)" />
      <ComboBox class="combo--stat" :model-value="stat.key" :options="statComboOptions"
                placeholder="— pick a stat —" @update:model-value="v => stat.key = v" />
      <PercentInput v-if="isPercent(stat.key)" v-model="stat.value" @keydown="focusNextStat" />
      <input v-else type="number" step="any" v-model.number="stat.value" @keydown="focusNextStat">
    </div>
    <div v-if="!draft.stats.length" class="stat-row">
      <IconButton icon="plus" title="Add stat" @click="addStat" />
    </div>

    <div class="form-section">Dynamic modification (user types the value)</div>
    <div class="form-grid">
      <label class="field"><span class="field-label">Stat</span>
        <ComboBox :model-value="draft.dynamicStat" :options="dynamicStatOptions"
                  placeholder="— none —" @update:model-value="v => draft.dynamicStat = v" /></label>
      <label class="field"><span class="field-label">Min</span>
        <input type="number" v-model.number="draft.dynamicMin" :disabled="!draft.dynamicStat"></label>
      <label class="field"><span class="field-label">Max</span>
        <input type="number" v-model.number="draft.dynamicMax" :disabled="!draft.dynamicStat"></label>
    </div>

    <div class="form-section">Equipping this item suppresses</div>
    <TokenInput v-model="draft.excludes" :options="bonusIds"
                placeholder="bonus id this item overrides…" />
    <p class="hint">Item-level override: those bonuses go inactive whenever this item is
      equipped, whatever grants them.</p>

    <BonusGroups
      :set-ids="draft.bonuses"
      :item-name="draft.name"
      :db="db"
      :all-set-ids="setIds"
      :tags="tags"
      :bonus-ids="bonusIds"
      @save-set="$emit('save-set', $event)"
      @delete-set="$emit('delete-set', $event)"
      @detach-set="detachSet"
      @rename-set="renameSet"
      @attach-set="attachSet" />
  </div>
</template>

<style scoped>
.drawer-grid {
  display: grid;
  gap: 2px 12px;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  margin-bottom: 6px;
}

.form-grid--tokens .field { flex: 1; min-width: 240px; }
</style>
