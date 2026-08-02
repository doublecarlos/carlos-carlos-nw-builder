<script setup lang="ts">
// Editing form for one item. Hybrid approach:
// - Existing items (source != null): live edits, changes emit immediately
// - New items (source == null): explicit Save button, draft until name is finalized
import { ref, computed, watch, onUnmounted } from "vue";
import BonusGroups from "./BonusGroups.vue";
import TokenInput from "../ui/TokenInput.vue";
import PercentInput from "../ui/PercentInput.vue";
import ComboBox from "../ui/ComboBox.vue";
import IconButton from "../ui/IconButton.vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseBadge from "../ui/BaseBadge.vue";
import FormBar from "../ui/FormBar.vue";
import FormField from "../ui/FormField.vue";
import FormGrid from "../ui/FormGrid.vue";
import IdField from "../ui/IdField.vue";
import FormSection from "../ui/FormSection.vue";
import { NW_SCHEMA, NW_SLOTS } from "../../data/data";
import { findParamSlot } from "../../lib/build-path";
import * as catalog from "../../data/catalog";
import * as formUndo from "../../stores/formUndo";
import { isPercentKind, kindOf } from "../../lib/format";
import { focusNextCombo } from "../../lib/stat-row-nav";
import type { Item, Db, BonusSet } from "../../types";
import type { StatRow } from "../../engine/bonus-draft";
import BaseCheckbox from "../ui/BaseCheckbox.vue";

const DEBOUNCE_MS = 700;
const UNDO_LIMIT = 50;

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
    allocatableIds?: string[];
  }>(),
  {
    source: null,
    status: "base",
    filters: () => [],
    setIds: () => [],
    tags: () => [],
    bonusIds: () => [],
    allocatableIds: () => [],
  },
);

const emit = defineEmits<{
  /** Emitted on every change for existing items (debounced). */
  "update:item": [payload: { item: Item; label: string }];
  /** Emitted on Save click for new items. */
  save: [payload: { item: Item }];
  delete: [];
  revert: [];
  "save-set": [payload: { id: string; set: BonusSet }];
  "delete-set": [id: string];
  "update-set": [payload: { id: string; set: BonusSet }];
}>();

export interface ItemDraft {
  name: string;
  filter: string;
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

// Existing items: live edits. New items: draft until Save.
const isNew = computed(() => !props.source);

const draft = ref<ReturnType<typeof buildDraft>>(buildDraft(props.source));
const error = ref("");
let debounceTimer: number | undefined;
// Initialize with item JSON for correct comparison on existing items.
let lastEmittedJson = JSON.stringify(toItem());

// --- Draft undo (new items only) -------------------------------------------------------
interface DraftEntry {
  json: string;
  label: string;
}

const draftHistory = ref<{ past: DraftEntry[]; future: DraftEntry[] }>({
  past: [],
  future: [],
});
const lastSnapshotJson = ref(JSON.stringify(draft.value));
let snapshotTimer: number | undefined;

const canUndoDraft = computed(() => draftHistory.value.past.length > 0);
const canRedoDraft = computed(() => draftHistory.value.future.length > 0);
const undoDraftLabel = computed(() => {
  const past = draftHistory.value.past;
  return past.length ? past[past.length - 1].label : "";
});
const redoDraftLabel = computed(() => {
  const future = draftHistory.value.future;
  return future.length ? future[future.length - 1].label : "";
});

function diffLabel(oldJson: string, newJson: string): string {
  try {
    const old = JSON.parse(oldJson);
    const nw = JSON.parse(newJson);
    if (old.name !== nw.name) return "edit name";
    if (old.filter !== nw.filter) return "edit filter";
    if (old.maxCopies !== nw.maxCopies) return "edit max copies";
    if (JSON.stringify(old.allowedClass) !== JSON.stringify(nw.allowedClass))
      return "edit classes";
    if (JSON.stringify(old.tags) !== JSON.stringify(nw.tags))
      return "edit tags";
    if (JSON.stringify(old.bonuses) !== JSON.stringify(nw.bonuses))
      return "edit bonuses";
    if (JSON.stringify(old.excludes) !== JSON.stringify(nw.excludes))
      return "edit excludes";
    if (old.dynamicStat !== nw.dynamicStat) return "edit dynamic stat";
    if (old.dynamicMin !== nw.dynamicMin || old.dynamicMax !== nw.dynamicMax)
      return "edit dynamic range";
    if (JSON.stringify(old.stats) !== JSON.stringify(nw.stats))
      return "edit stats";
  } catch {
    // JSON parse error -- shouldn't happen but be safe.
  }
  return "edit item";
}

function resetDraftHistory() {
  window.clearTimeout(snapshotTimer);
  draftHistory.value = { past: [], future: [] };
  lastSnapshotJson.value = JSON.stringify(draft.value);
}

function scheduleSnapshot() {
  window.clearTimeout(snapshotTimer);
  snapshotTimer = window.setTimeout(commitSnapshot, DEBOUNCE_MS);
}

function commitSnapshot() {
  window.clearTimeout(snapshotTimer);
  const current = JSON.stringify(draft.value);
  if (current === lastSnapshotJson.value) return;
  const label = diffLabel(lastSnapshotJson.value, current);
  draftHistory.value.past.push({ json: lastSnapshotJson.value, label });
  if (draftHistory.value.past.length > UNDO_LIMIT)
    draftHistory.value.past.shift();
  draftHistory.value.future.length = 0;
  lastSnapshotJson.value = current;
}

function undoDraft() {
  commitSnapshot();
  if (!draftHistory.value.past.length) return false;
  const entry = draftHistory.value.past.pop()!;
  draftHistory.value.future.push({
    json: lastSnapshotJson.value,
    label: entry.label,
  });
  lastSnapshotJson.value = entry.json;
  draft.value = JSON.parse(entry.json);
  return true;
}

function redoDraft() {
  if (!draftHistory.value.future.length) return false;
  const entry = draftHistory.value.future.pop()!;
  draftHistory.value.past.push({
    json: lastSnapshotJson.value,
    label: entry.label,
  });
  lastSnapshotJson.value = entry.json;
  draft.value = JSON.parse(entry.json);
  return true;
}

// --- Live edit emit (existing items) ---------------------------------------------------

function scheduleEmit() {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(emitChange, DEBOUNCE_MS);
}

function emitChange() {
  window.clearTimeout(debounceTimer);
  const item = toItem();
  const currentJson = JSON.stringify(item);
  if (currentJson === lastEmittedJson) return;
  const label = diffLabel(lastEmittedJson, currentJson);
  lastEmittedJson = currentJson;
  emit("update:item", { item, label });
}

// --- Common ---------------------------------------------------------------------------

const displayId = computed(
  () =>
    props.source?.id ??
    (draft.value.name.trim()
      ? catalog.nextId(
          draft.value.name.trim(),
          props.allocatableIds.length
            ? props.allocatableIds
            : props.db.items.map((i) => i.id),
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

function toItem(): Item {
  const local = draft.value;
  const id =
    props.source?.id ??
    catalog.nextId(
      local.name.trim(),
      props.allocatableIds.length
        ? props.allocatableIds
        : props.db.items.map((i) => i.id),
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
  if (!props.source)
    return Boolean(item.name || item.filter || draft.value.stats.length);
  return !sameItem(item, props.source);
});

const isPercent = (key: string) => isPercentKind(kindOf(key));

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

function attachSet(id: string) {
  if (draft.value.bonuses.includes(id)) return;
  draft.value.bonuses = [...draft.value.bonuses, id];
}

function detachSet(id: string) {
  draft.value.bonuses = draft.value.bonuses.filter(
    (setId: string) => setId !== id,
  );
}

// Rebuild draft when source changes (e.g. after undo/redo reverts the overlay).
watch(
  () => props.source,
  (value) => {
    draft.value = buildDraft(value);
    error.value = "";
    lastEmittedJson = JSON.stringify(toItem());
    resetDraftHistory();
  },
);

// For existing items: schedule emit on draft change.
// For new items: schedule snapshot for draft undo.
watch(
  draft,
  () => {
    if (isNew.value) {
      scheduleSnapshot();
    } else {
      scheduleEmit();
    }
  },
  { deep: true },
);

// Register formUndo for new items (draft undo).
let unregisterFormUndo: (() => void) | undefined;

function registerFormUndo() {
  unregisterFormUndo?.();
  if (isNew.value) {
    unregisterFormUndo = formUndo.register({
      get canUndo() {
        return canUndoDraft.value;
      },
      get canRedo() {
        return canRedoDraft.value;
      },
      undo: undoDraft,
      redo: redoDraft,
      get undoLabel() {
        return undoDraftLabel.value;
      },
      get redoLabel() {
        return redoDraftLabel.value;
      },
    });
  } else {
    unregisterFormUndo = undefined;
  }
}

watch(isNew, registerFormUndo, { immediate: true });

onUnmounted(() => {
  window.clearTimeout(debounceTimer);
  window.clearTimeout(snapshotTimer);
  unregisterFormUndo?.();
});
</script>

<template>
  <div>
    <FormBar class="-m-3 mb-3">
      <strong>{{ draft.name || "New item" }}</strong>
      <BaseBadge v-if="status !== 'base'" :variant="status as any">{{
        status
      }}</BaseBadge>
      <BaseBadge v-if="dirty && isNew">unsaved</BaseBadge>
      <span class="flex-1"></span>
      <!-- Save button only for new items -->
      <BaseButton
        v-if="isNew"
        variant="primary"
        :disabled="!dirty"
        @click="save"
        >Save item</BaseButton
      >
      <BaseButton v-if="status === 'edited'" @click="$emit('revert')"
        >Revert to shipped</BaseButton
      >
      <BaseButton v-if="source" @click="$emit('delete')">Delete</BaseButton>
    </FormBar>

    <p v-if="error" class="mt-1 text-danger">{{ error }}</p>

    <FormGrid class="mb-2">
      <FormField label="Name">
        <input
          v-model="draft.name"
          class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          type="text"
          data-testid="item-name-input"
        />
      </FormField>
      <IdField :id="displayId" label="Id" :existing="Boolean(source)" />
      <FormField label="Filter (slot category)">
        <input
          v-model="draft.filter"
          class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          type="text"
          list="nw-filters"
          data-testid="item-filter-input"
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

    <FormGrid class="mb-2">
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
        class="w-28"
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
    <FormGrid class="mb-2">
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
      :allocatable-ids="props.allocatableIds"
      @save-set="$emit('save-set', $event)"
      @delete-set="$emit('delete-set', $event)"
      @update-set="$emit('update-set', $event)"
      @detach-set="detachSet"
      @attach-set="attachSet"
    />
  </div>
</template>
