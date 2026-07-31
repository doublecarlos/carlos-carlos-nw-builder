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
import { ref, computed, watch, onUnmounted } from "vue";
import BonusGroups from "./BonusGroups.vue";
import TokenInput from "./ui/TokenInput.vue";
import PercentInput from "./ui/PercentInput.vue";
import ComboBox from "./ui/ComboBox.vue";
import IconButton from "./ui/IconButton.vue";
import BaseButton from "./ui/BaseButton.vue";
import HistoryButton from "./ui/HistoryButton.vue";
import BaseBadge from "./ui/BaseBadge.vue";
import FormBar from "./ui/FormBar.vue";
import FormField from "./ui/FormField.vue";
import FormGrid from "./ui/FormGrid.vue";
import IdField from "./ui/IdField.vue";
import FormSection from "./ui/FormSection.vue";
import { NW_SCHEMA, NW_SLOTS } from "../data";
import { findParamSlot } from "../build-path";
import * as catalog from "../catalog";
import { isPercentKind, kindOf } from "../format";
import { focusNextCombo } from "../stat-row-nav";
import type { Item, Db, BonusSet } from "../types";
import type { StatRow } from "../bonus-draft";
import BaseCheckbox from "./ui/BaseCheckbox.vue";

/**
 * Key-order-insensitive comparison. `toItem` rebuilds the object in the exporter's key
 * order, which almost never matches the order the source happens to have, so a plain
 * `JSON.stringify` comparison reports every untouched item as modified.
 */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort())
      out[key] = canonical((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
};

const sameItem = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

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

const props = withDefaults(
  defineProps<{
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
  }>(),
  {
    source: null,
    status: "base",
    filters: () => [],
    setIds: () => [],
    tags: () => [],
    bonusIds: () => [],
    initialDraft: null,
  },
);

const emit = defineEmits<{
  save: [payload: { item: Item }];
  delete: [];
  revert: [];
  dirty: [value: boolean];
  "save-set": [payload: { id: string; set: BonusSet }];
  "delete-set": [id: string];
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
  const source = item ?? ({} as Partial<Item>);
  const statKeys = new Set(NW_SCHEMA.statKeys);
  return {
    name: source.name ?? "",
    filter: source.filter ?? "",
    maxCopies: source.maxCopies ?? null,
    allowedClass: [...(source.allowedClass ?? [])],
    tags: [...(source.tags ?? [])],
    bonuses: [...(source.bonuses ?? [])],
    excludes: [...(source.excludes ?? [])],
    dynamicStat: source.dynamicStat ?? "",
    dynamicMin: source.dynamicMin ?? null,
    dynamicMax: source.dynamicMax ?? null,
    stats: Object.keys(source)
      .filter((key) => statKeys.has(key))
      .map((key) => ({ key, value: source[key as keyof Item] as number })),
  };
}

const draft = ref<ReturnType<typeof buildDraft>>(
  props.initialDraft
    ? JSON.parse(JSON.stringify(props.initialDraft))
    : buildDraft(props.source),
);
const error = ref("");
const draftHistory = ref<{ past: string[]; future: string[] }>({
  past: [],
  future: [],
});
const lastSnapshotJson = ref(JSON.stringify(draft.value));
let snapshotTimer: number | undefined;
// Two-step confirm for "discard my unsaved edits" -- same pattern (and same 4s window)
// as BuildBar's own Revert. No watch needed to reset it on an identity change the
// way BuildBar resets on `build.id`: this component remounts fresh every time the
// selected item changes, via DataEditor's `:key`.
const confirmRevert = ref(false);
let confirmRevertTimer: number | undefined;

/** The id shown next to Name -- the frozen one for an existing item, or a live preview of
 * what `toItem()` would assign on first save for a brand-new one. Read-only either way: an
 * item's id is never a form field a user edits directly. */
const displayId = computed(
  () =>
    props.source?.id ??
    (draft.value.name.trim()
      ? catalog.nextId(
          draft.value.name.trim(),
          props.db.items.map((i) => i.id),
          "item",
        )
      : ""),
);

const statOptions = NW_SCHEMA.stats;
const classSlot = findParamSlot(NW_SLOTS.slots, "class");
const classes = classSlot?.options?.map((o) => o.value) ?? [];

const statComboOptions = statOptions.map((s) => ({
  value: s.key,
  label: `${s.label} (${s.key})`,
}));
const dynamicStatOptions = statOptions.map((s) => ({
  value: s.key,
  label: s.label,
}));

/** Draft -> the sparse item object the engine and the exporter expect. Id is frozen at
 * first save (`catalog.nextId`, from the name typed at that moment) and never regenerated
 * afterwards -- editing the name on later saves only ever changes display text. */
function toItem(): Item {
  const local = draft.value;
  const id =
    props.source?.id ??
    catalog.nextId(
      local.name.trim(),
      props.db.items.map((i) => i.id),
      "item",
    );
  const item: Item = {
    id,
    name: local.name.trim(),
    filter: local.filter.trim(),
  };

  for (const { key, value } of local.stats) {
    if (!key) continue;
    const number = Number(value);
    if (value === "" || value == null || !Number.isFinite(number)) continue;
    item[key] = number;
  }

  if (local.tags.length) item.tags = [...local.tags];
  if (local.bonuses.length) item.bonuses = [...local.bonuses];
  if (local.excludes.length) item.excludes = [...local.excludes];
  if (local.maxCopies) item.maxCopies = Number(local.maxCopies);
  if (local.allowedClass.length) item.allowedClass = [...local.allowedClass];

  if (local.dynamicStat) {
    item.dynamicStat = local.dynamicStat;
    if (local.dynamicMin != null && local.dynamicMin !== "") {
      item.dynamicMin = Number(local.dynamicMin);
    }
    if (local.dynamicMax != null && local.dynamicMax !== "") {
      item.dynamicMax = Number(local.dynamicMax);
    }
  }

  return item;
}

const dirty = computed(() => {
  const item = toItem();
  // An untouched blank form is not a pending change.
  if (!props.source)
    return Boolean(item.name || item.filter || draft.value.stats.length);
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
  snapshotTimer = window.setTimeout(
    () => commitSnapshot(),
    SNAPSHOT_DEBOUNCE_MS,
  );
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
  if (draftHistory.value.past.length > UNDO_LIMIT)
    draftHistory.value.past.shift();
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
    confirmRevertTimer = window.setTimeout(() => {
      confirmRevert.value = false;
    }, 4000);
    return;
  }
  window.clearTimeout(confirmRevertTimer);
  confirmRevert.value = false;
  draft.value = buildDraft(props.source);
  error.value = "";
  resetDraftHistory();
}

function save() {
  error.value = "";
  const item = toItem();
  if (!item.name) {
    error.value = "The item needs a name.";
    return;
  }
  if (!item.filter) {
    error.value = "The item needs a filter, or no slot can hold it.";
    return;
  }
  emit("save", { item });
}

function addStat() {
  draft.value.stats.push({ key: "", value: 0 });
}
function removeStat(index: number) {
  draft.value.stats.splice(index, 1);
}
function focusNextStat(event: KeyboardEvent) {
  focusNextCombo(event);
}

/** A bonus created (on its first save) or attached from the Bonuses section joins this
 * item's own list straight away. */
function attachSet(id: string) {
  if (draft.value.bonuses.includes(id)) return;
  draft.value.bonuses = [...draft.value.bonuses, id];
}

/** A card with no saved definition has nothing in the catalogue to remove -- just drop
 * the id from this item's own list. */
function detachSet(id: string) {
  draft.value.bonuses = draft.value.bonuses.filter(
    (setId: string) => setId !== id,
  );
}

watch(
  () => props.source,
  (value) => {
    draft.value = buildDraft(value);
    error.value = "";
    // A save (the common way `source` changes under an unchanged key) makes the prior
    // draft history meaningless -- there is nothing left upstream of the just-saved state
    // worth undoing back to.
    resetDraftHistory();
  },
);

watch(dirty, (value) => emit("dirty", value), { immediate: true });

watch(draft, () => scheduleSnapshot(), { deep: true });

onUnmounted(() => {
  window.clearTimeout(snapshotTimer);
  window.clearTimeout(confirmRevertTimer);
});
</script>

<template>
  <div>
    <FormBar>
      <strong>{{ draft.name || "New item" }}</strong>
      <BaseBadge v-if="status !== 'base'" :variant="status as any">{{
        status
      }}</BaseBadge>
      <BaseBadge v-if="dirty">unsaved</BaseBadge>
      <span class="flex-1"></span>
      <HistoryButton
        type="undo"
        :disabled="!canUndoDraft"
        title="Undo edit (Ctrl+Z)"
        @click="undoDraft"
        >Undo</HistoryButton
      >
      <HistoryButton
        type="redo"
        :disabled="!canRedoDraft"
        title="Redo edit (Ctrl+Shift+Z)"
        @click="redoDraft"
        >Redo</HistoryButton
      >
      <BaseButton variant="primary" :disabled="!dirty" @click="save"
        >Save item</BaseButton
      >
      <BaseButton
        :danger="confirmRevert"
        :disabled="!dirty"
        @click="revertDraft"
      >
        {{ confirmRevert ? "Really revert?" : "Revert" }}
      </BaseButton>
      <BaseButton v-if="status === 'edited'" @click="$emit('revert')"
        >Revert to shipped</BaseButton
      >
      <BaseButton v-if="source" @click="$emit('delete')">Delete</BaseButton>
    </FormBar>

    <p v-if="error" class="mt-1 text-danger">{{ error }}</p>

    <FormGrid>
      <FormField label="Name">
        <input
          v-model="draft.name"
          class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          type="text"
        />
      </FormField>
      <IdField :id="displayId" label="Id" :existing="Boolean(source)" />
      <FormField label="Filter (slot category)">
        <input
          v-model="draft.filter"
          class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          type="text"
          list="nw-filters"
        />
      </FormField>
      <FormField label="Max copies (0 = unlimited)">
        <input
          v-model.number="draft.maxCopies"
          class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          type="number"
          min="0"
        />
      </FormField>
    </FormGrid>

    <datalist id="nw-filters">
      <option v-for="f in filters" :key="f" :value="f"></option>
    </datalist>
    <datalist id="nw-tags">
      <option v-for="t in tags" :key="t" :value="t"></option>
    </datalist>

    <FormGrid>
      <FormField label="Tags" class="min-w-80 flex-1">
        <TokenInput
          v-model="draft.tags"
          :options="tags"
          placeholder="Add a tag…"
        />
      </FormField>
    </FormGrid>

    <FormSection>Restricted to classes</FormSection>
    <div class="mb-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
      <BaseCheckbox
        v-for="cls in classes"
        :key="cls"
        v-model="draft.allowedClass"
        :value="cls"
      >
        {{ cls }}
      </BaseCheckbox>
    </div>

    <FormSection>Stats</FormSection>
    <div
      v-for="(stat, index) in draft.stats"
      :key="index"
      class="stat-row flex flex-wrap items-center gap-1.5 mb-1"
    >
      <IconButton icon="plus" title="Add stat" @click="addStat" />
      <IconButton icon="trash" title="Remove stat" @click="removeStat(index)" />
      <ComboBox
        class="combo--stat w-52"
        :model-value="stat.key"
        :options="statComboOptions"
        placeholder="— pick a stat —"
        @update:model-value="(v) => (stat.key = v)"
      />
      <PercentInput
        v-if="isPercent(stat.key)"
        v-model="stat.value"
        @keydown="focusNextStat"
      />
      <input
        v-else
        v-model.number="stat.value"
        class="w-28 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
        type="number"
        step="any"
        @keydown="focusNextStat"
      />
    </div>
    <div
      v-if="!draft.stats.length"
      class="stat-row flex flex-wrap items-center gap-1.5 mb-1"
    >
      <IconButton icon="plus" title="Add stat" @click="addStat" />
    </div>

    <FormSection>Dynamic modification (user types the value)</FormSection>
    <FormGrid>
      <FormField label="Stat">
        <ComboBox
          :model-value="draft.dynamicStat"
          :options="dynamicStatOptions"
          placeholder="— none —"
          @update:model-value="(v) => (draft.dynamicStat = v)"
        />
      </FormField>
      <FormField label="Min">
        <input
          v-model.number="draft.dynamicMin"
          class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent disabled:opacity-50"
          type="number"
          :disabled="!draft.dynamicStat"
        />
      </FormField>
      <FormField label="Max">
        <input
          v-model.number="draft.dynamicMax"
          class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent disabled:opacity-50"
          type="number"
          :disabled="!draft.dynamicStat"
        />
      </FormField>
    </FormGrid>

    <FormSection>Equipping this item suppresses</FormSection>
    <TokenInput
      v-model="draft.excludes"
      :options="bonusIds"
      placeholder="bonus id this item overrides…"
    />
    <p class="text-sm text-muted">
      Item-level override: those bonuses go inactive whenever this item is
      equipped, whatever grants them.
    </p>

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
      @attach-set="attachSet"
    />
  </div>
</template>
