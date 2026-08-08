<script setup lang="ts">
// Editing form for one item. Hybrid approach:
// - Existing items (source != null): live edits, changes emit immediately
// - New items (source == null): explicit Save button, draft until name is finalized
import { ref, computed, watch } from "vue";
import BonusGroups from "./BonusGroups.vue";
import TokenInput from "../ui/TokenInput.vue";
import PercentInput from "../ui/PercentInput.vue";
import ComboBox from "../ui/ComboBox.vue";
import IconButton from "../ui/IconButton.vue";
import { Copy, Plus, Save, Trash, Undo2 } from "@lucide/vue";
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
import { deepEqual } from "../../lib/deep-equal";
import { useDraftHistory } from "../../composables/useDraftHistory";
import { isPercentKind, kindOf } from "../../lib/format";
import { focusNextCombo } from "../../lib/stat-row-nav";
import type { Item, Db, BonusSet } from "../../types";
import type { StatRow } from "../../engine/bonus-draft";
import BaseCheckbox from "../ui/BaseCheckbox.vue";

const props = withDefaults(
  defineProps<{
    /** The item being edited, or null for a brand-new one. */
    source?: Item | null;
    /** Seed values for a brand-new draft, copied from an existing item ("Duplicate").
     *  Ignored once `source` is set -- only meaningful while creating a new item. */
    duplicateFrom?: Item | null;
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
    duplicateFrom: null,
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
  duplicate: [];
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
  pointMin: number | string | null;
  pointMax: number | string | null;
  pointDefault: number | string | null;
  pointPriority: number | string | null;
  stats: StatRow[];
}

/** Point assignment fields count as "set" once they hold a real number, not just an
 *  empty string left behind by a cleared number input. */
function hasPointField(v: number | string | null): boolean {
  return v != null && v !== "";
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
    pointMin: source.pointAssignment?.min ?? null,
    pointMax: source.pointAssignment?.max ?? null,
    pointDefault: source.pointAssignment?.default ?? null,
    pointPriority: source.pointAssignment?.priority ?? null,
    stats: Object.keys(source)
      .filter((key) => statKeys.has(key))
      .map((key) => ({ key, value: source[key as keyof Item] as number })),
  };
}

// Existing items: live edits. New items: draft until Save.
const isNew = computed(() => !props.source);

const draft = ref<ReturnType<typeof buildDraft>>(
  buildDraft(props.source ?? props.duplicateFrom),
);
const error = ref("");
// Initialize with item JSON for correct comparison on existing items.
let lastEmittedJson = JSON.stringify(toItem());

function diffLabel(oldJson: string, newJson: string): string {
  try {
    const old = JSON.parse(oldJson);
    const nw = JSON.parse(newJson);
    if (old.name !== nw.name) return `edit name → "${nw.name}"`;
    if (old.filter !== nw.filter) return `edit filter → "${nw.filter}"`;
    if (old.maxCopies !== nw.maxCopies)
      return `edit max copies → ${nw.maxCopies ?? "(none)"}`;
    if (JSON.stringify(old.allowedClass) !== JSON.stringify(nw.allowedClass))
      return "edit classes";
    if (JSON.stringify(old.tags) !== JSON.stringify(nw.tags))
      return diffArrayLabel("tag", old.tags ?? [], nw.tags ?? []);
    if (JSON.stringify(old.bonuses) !== JSON.stringify(nw.bonuses))
      return diffArrayLabel("bonus", old.bonuses ?? [], nw.bonuses ?? []);
    if (JSON.stringify(old.excludes) !== JSON.stringify(nw.excludes))
      return diffArrayLabel("exclude", old.excludes ?? [], nw.excludes ?? []);
    if (old.dynamicStat !== nw.dynamicStat)
      return `edit dynamic stat → "${nw.dynamicStat || "(none)"}"`;
    if (old.dynamicMin !== nw.dynamicMin || old.dynamicMax !== nw.dynamicMax)
      return `edit dynamic range → ${nw.dynamicMin ?? "_"}–${nw.dynamicMax ?? "_"}`;
    if (
      JSON.stringify(old.pointAssignment) !== JSON.stringify(nw.pointAssignment)
    )
      return "edit point assignment";
    if (JSON.stringify(old.stats) !== JSON.stringify(nw.stats))
      return diffStatsLabel(old.stats ?? [], nw.stats ?? []);
  } catch {
    // JSON parse error -- shouldn't happen but be safe.
  }
  return "edit item";
}

/** Label array mutations as add/remove with the changed entry count. */
function diffArrayLabel(
  noun: string,
  oldArr: unknown[],
  newArr: unknown[],
): string {
  const oldSet = new Set(oldArr.map(String));
  const newSet = new Set(newArr.map(String));
  const added = newArr.filter((v) => !oldSet.has(String(v))).length;
  const removed = oldArr.filter((v) => !newSet.has(String(v))).length;
  if (added && removed) return `edit ${noun}s (+${added} / −${removed})`;
  if (added) return `add ${noun}${added > 1 ? "s" : ""} (${added})`;
  if (removed) return `remove ${noun}${removed > 1 ? "s" : ""} (${removed})`;
  return `edit ${noun}s`;
}

/** Label stat changes with the specific stat key(s) that changed. */
function diffStatsLabel(
  oldStats: { key: string; value: number }[],
  newStats: { key: string; value: number }[],
): string {
  const oldMap = new Map(oldStats.map((s) => [s.key, s.value]));
  const newMap = new Map(newStats.map((s) => [s.key, s.value]));
  const changed: string[] = [];
  for (const [key, val] of newMap) {
    if (!oldMap.has(key)) changed.push(`+${key}`);
    else if (oldMap.get(key) !== val) changed.push(key);
  }
  for (const key of oldMap.keys()) {
    if (!newMap.has(key)) changed.push(`−${key}`);
  }
  if (changed.length === 1) return `edit stat: ${changed[0]}`;
  if (changed.length <= 3) return `edit stats: ${changed.join(", ")}`;
  return `edit stats (${changed.length} changed)`;
}

// --- Live edit emit (existing items) ---------------------------------------------------

function emitChange() {
  const item = toItem();
  const currentJson = JSON.stringify(item);
  if (currentJson === lastEmittedJson) return;
  const label = diffLabel(lastEmittedJson, currentJson);
  lastEmittedJson = currentJson;
  emit("update:item", { item, label });
}

const { resetDraftHistory } = useDraftHistory({
  draft,
  isNew,
  diffLabel,
  onEmit: emitChange,
});

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
// The class slot's own "— none —" row is for the build editor, not for restricting an
// item to no class at all -- drop the empty value from the checkbox list.
const classes = (classSlot?.options?.map((o) => o.value) ?? []).filter(Boolean);

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

  if (
    hasPointField(local.pointMin) ||
    hasPointField(local.pointMax) ||
    hasPointField(local.pointDefault)
  ) {
    item.pointAssignment = {
      min: Number(local.pointMin) || 0,
      max: Number(local.pointMax) || 0,
      default: Number(local.pointDefault) || 0,
      ...(hasPointField(local.pointPriority)
        ? { priority: Number(local.pointPriority) }
        : {}),
    };
  }

  return item;
}

const dirty = computed(() => {
  const item = toItem();
  if (!props.source)
    return Boolean(item.name || item.filter || draft.value.stats.length);
  return !deepEqual(item, props.source);
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

// Dynamic modification and point assignment are single field groups rather than arrays,
// so "added"/"removed" is tracked as its own flag instead of splicing a list. Both start
// active whenever the source item already carries values for them.
function hasDynamicModification(d: ItemDraft): boolean {
  return d.dynamicStat !== "";
}
function hasPointAssignment(d: ItemDraft): boolean {
  return (
    hasPointField(d.pointMin) ||
    hasPointField(d.pointMax) ||
    hasPointField(d.pointDefault) ||
    hasPointField(d.pointPriority)
  );
}

const dynamicModActive = ref(hasDynamicModification(draft.value));
const pointActive = ref(hasPointAssignment(draft.value));

// Draft undo/redo (new-item history) replaces `draft.value` wholesale, bypassing the
// add/remove handlers below -- resurface the group automatically whenever its fields come
// back populated so a redo of "add" doesn't leave the fields hidden behind a stale flag.
// Never flips a flag to false itself; only the explicit remove handlers do that.
watch(
  () => draft.value.dynamicStat,
  (stat) => {
    if (stat !== "") dynamicModActive.value = true;
  },
);
watch(
  () => [
    draft.value.pointMin,
    draft.value.pointMax,
    draft.value.pointDefault,
    draft.value.pointPriority,
  ],
  () => {
    if (hasPointAssignment(draft.value)) pointActive.value = true;
  },
);

function addDynamicModification() {
  dynamicModActive.value = true;
}
function removeDynamicModification() {
  draft.value.dynamicStat = "";
  draft.value.dynamicMin = null;
  draft.value.dynamicMax = null;
  dynamicModActive.value = false;
}

function addPointAssignment() {
  pointActive.value = true;
}
function removePointAssignment() {
  draft.value.pointMin = null;
  draft.value.pointMax = null;
  draft.value.pointDefault = null;
  draft.value.pointPriority = null;
  pointActive.value = false;
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
    dynamicModActive.value = hasDynamicModification(draft.value);
    pointActive.value = hasPointAssignment(draft.value);
    error.value = "";
    lastEmittedJson = JSON.stringify(toItem());
    resetDraftHistory();
  },
);
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
        ><Save />Save item</BaseButton
      >
      <BaseButton v-if="status === 'edited'" @click="$emit('revert')"
        ><Undo2 />Revert to shipped</BaseButton
      >
      <BaseButton
        v-if="source"
        data-testid="duplicate-item"
        @click="$emit('duplicate')"
        ><Copy />Duplicate</BaseButton
      >
      <BaseButton v-if="source" @click="$emit('delete')"
        ><Trash />Delete</BaseButton
      >
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
      <IconButton title="Add stat" @click="addStat"><Plus /></IconButton>
      <IconButton title="Remove stat" @click="removeStat(index)"
        ><Trash
      /></IconButton>
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
      <IconButton title="Add stat" @click="addStat"><Plus /></IconButton>
    </div>

    <FormSection>Dynamic modification (user types the value)</FormSection>
    <div class="flex flex-wrap items-center gap-1.5 mb-2">
      <IconButton
        v-if="!dynamicModActive"
        title="Add dynamic modification"
        data-testid="add-dynamic-modification"
        @click="addDynamicModification"
        ><Plus
      /></IconButton>
      <IconButton
        v-else
        title="Remove dynamic modification"
        data-testid="remove-dynamic-modification"
        @click="removeDynamicModification"
        ><Trash
      /></IconButton>
      <FormGrid
        v-if="dynamicModActive"
        data-testid="dynamic-modification-fields"
      >
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
    </div>

    <FormSection
      >Point assignment (boons, attributes, other point_assignment slots
      filter)</FormSection
    >
    <div class="flex flex-wrap items-center gap-1.5 mb-2">
      <IconButton
        v-if="!pointActive"
        title="Add point assignment"
        data-testid="add-point-assignment"
        @click="addPointAssignment"
        ><Plus
      /></IconButton>
      <IconButton
        v-else
        title="Remove point assignment"
        data-testid="remove-point-assignment"
        @click="removePointAssignment"
        ><Trash
      /></IconButton>
      <FormGrid v-if="pointActive" data-testid="point-assignment-fields">
        <FormField label="Min">
          <input
            v-model.number="draft.pointMin"
            class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
            type="number"
          />
        </FormField>
        <FormField label="Max">
          <input
            v-model.number="draft.pointMax"
            class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
            type="number"
          />
        </FormField>
        <FormField label="Default">
          <input
            v-model.number="draft.pointDefault"
            class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
            type="number"
          />
        </FormField>
        <FormField label="Priority">
          <input
            v-model.number="draft.pointPriority"
            class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
            type="number"
          />
        </FormField>
      </FormGrid>
    </div>

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
