<script setup lang="ts">
// Editing form for one bonus set. Hybrid approach:
// - Existing sets (source != null): live edits, changes emit immediately
// - New sets (source == null): explicit Save button, draft until name is finalized
import { ref, computed, watch, onUnmounted } from "vue";
import BonusRows from "./BonusRows.vue";
import IconButton from "../ui/IconButton.vue";
import ComboBox from "../ui/ComboBox.vue";
import TokenInput from "../ui/TokenInput.vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseBadge from "../ui/BaseBadge.vue";
import FormBar from "../ui/FormBar.vue";
import FormField from "../ui/FormField.vue";
import FormGrid from "../ui/FormGrid.vue";
import FormSection from "../ui/FormSection.vue";
import IdField from "../ui/IdField.vue";
import * as bonusDraft from "../../engine/bonus-draft";
import * as catalog from "../../data/catalog";
import * as formUndo from "../../stores/formUndo";
import { BonusDraftStore } from "../../stores/bonus-draft";
import type { BonusSet, Db } from "../../types";

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

const sameSet = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const props = withDefaults(
  defineProps<{
    /** The bonus set being edited, or null for a brand-new one. */
    source?: BonusSet | null;
    status?: string;
    db: Db;
    setIds?: string[];
    tags?: string[];
    bonusIds?: string[];
    allocatableIds?: string[];
    fixedId?: string | null;
    /** Initial draft for pending slots (BonusGroups embedded case). */
    initialDraft?: bonusDraft.SetDraft | null;
  }>(),
  {
    source: null,
    status: "base",
    setIds: () => [],
    tags: () => [],
    bonusIds: () => [],
    allocatableIds: () => [],
    fixedId: null,
    initialDraft: null,
  },
);

const emit = defineEmits<{
  /** Emitted on every change for existing sets (debounced). */
  "update:set": [payload: { id: string; set: BonusSet; label: string }];
  /** Emitted on Save click for new sets. */
  save: [payload: { id: string; set: BonusSet }];
  delete: [];
  revert: [];
}>();

function buildDraft(set: BonusSet | null | undefined): bonusDraft.SetDraft {
  const source = set ?? ({} as Partial<BonusSet>);
  return {
    id: source.id ?? "",
    name: source.name ?? "",
    grants: (source.grants ?? []).map((grant) => bonusDraft.toDraft(grant)),
    stacking: source.stacking ?? "",
    maxStacks: source.maxStacks ?? null,
    excludes: [...(source.excludes ?? [])],
  };
}

// Existing sets: live edits. New sets: draft until Save.
const isNew = computed(() => !props.source && !props.fixedId);

const draft = ref<ReturnType<typeof buildDraft>>(
  props.initialDraft
    ? JSON.parse(JSON.stringify(props.initialDraft))
    : buildDraft(props.source),
);
const error = ref("");
let debounceTimer: number | undefined;
// Initialize with set JSON for correct comparison on existing sets.
let lastEmittedJson = JSON.stringify(
  props.source
    ? bonusDraft.toSet({ ...draft.value, id: props.source.id })
    : draft.value,
);

// --- Draft undo (new sets only) -------------------------------------------------------
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
    if (old.name !== nw.name) return `edit name → "${nw.name}"`;
    if (old.stacking !== nw.stacking)
      return `edit stacking → "${nw.stacking || "(none)"}"`;
    if (old.maxStacks !== nw.maxStacks)
      return `edit max stacks → ${nw.maxStacks ?? "(none)"}`;
    if (JSON.stringify(old.excludes) !== JSON.stringify(nw.excludes)) {
      const oldSet = new Set(old.excludes ?? []);
      const newSet = new Set(nw.excludes ?? []);
      const added = (nw.excludes ?? []).filter(
        (v: string) => !oldSet.has(v),
      ).length;
      const removed = (old.excludes ?? []).filter(
        (v: string) => !newSet.has(v),
      ).length;
      if (added && removed) return `edit excludes (+${added} / −${removed})`;
      if (added) return `add exclude${added > 1 ? "s" : ""} (${added})`;
      if (removed)
        return `remove exclude${removed > 1 ? "s" : ""} (${removed})`;
      return "edit excludes";
    }
    if (JSON.stringify(old.grants) !== JSON.stringify(nw.grants)) {
      const oldCount = (old.grants ?? []).length;
      const newCount = (nw.grants ?? []).length;
      if (newCount > oldCount)
        return `add grant${newCount - oldCount > 1 ? "s" : ""} (${newCount} total)`;
      if (newCount < oldCount)
        return `remove grant${oldCount - newCount > 1 ? "s" : ""} (${newCount} total)`;
      return `edit grants (${newCount} total)`;
    }
  } catch {
    // JSON parse error -- shouldn't happen but be safe.
  }
  return "edit bonus set";
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

// --- Live edit emit (existing sets) ---------------------------------------------------

function scheduleEmit() {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(emitChange, DEBOUNCE_MS);
}

function emitChange() {
  window.clearTimeout(debounceTimer);
  const name = draft.value.name.trim();
  if (!name) return;
  const id =
    props.source?.id ??
    props.fixedId ??
    catalog.nextId(
      name,
      props.allocatableIds.length ? props.allocatableIds : props.setIds,
      "bonus-set",
    );
  let set: BonusSet;
  try {
    set = bonusDraft.toSet({ ...draft.value, id });
  } catch {
    return;
  }
  const currentJson = JSON.stringify(set);
  if (currentJson === lastEmittedJson) return;
  const label = diffLabel(lastEmittedJson, currentJson);
  lastEmittedJson = currentJson;
  emit("update:set", { id, set, label });
}

// --- Common ---------------------------------------------------------------------------

const members = computed(() => {
  if (!props.source) return [];
  return (props.db.setMembers.get(props.source.id) ?? []).map(
    (id) => props.db.get(id)?.name ?? id,
  );
});

const stackingOptions = [
  { value: "", label: "once, however many sources" },
  { value: "perSource", label: "once per contributing slot" },
];

const asSet = computed(() => {
  try {
    return bonusDraft.toSet(draft.value);
  } catch {
    return null;
  }
});

const dirty = computed(() => {
  if (!props.source) {
    return Boolean(draft.value.name || draft.value.grants.length);
  }
  const set = asSet.value;
  return !set || !sameSet(set, props.source);
});

defineExpose({ draft, dirty });

const displayId = computed(
  () =>
    props.source?.id ??
    props.fixedId ??
    (draft.value.name.trim()
      ? catalog.nextId(
          draft.value.name.trim(),
          props.allocatableIds.length ? props.allocatableIds : props.setIds,
          "bonus-set",
        )
      : ""),
);

function addGrant() {
  draft.value.grants.push(bonusDraft.toDraft({ when: {}, stats: {} }));
}

function save() {
  error.value = "";
  const name = draft.value.name.trim();
  if (!name) {
    error.value = "The bonus set needs a name.";
    return;
  }
  const id =
    props.source?.id ??
    props.fixedId ??
    catalog.nextId(
      name,
      props.allocatableIds.length ? props.allocatableIds : props.setIds,
      "bonus-set",
    );
  let set;
  try {
    set = bonusDraft.toSet({ ...draft.value, id });
  } catch (err: unknown) {
    error.value = `A grant has invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
    return;
  }
  emit("save", { id, set });
}

// The store drives all grant-list mutations — BonusRows calls store methods instead of
// emitting replaced arrays. It writes directly onto `draft.value.grants`.
const draftStore = new BonusDraftStore(
  () => draft.value.grants,
  isNew.value ? scheduleSnapshot : scheduleEmit,
  undefined,
);

// Rebuild draft when source changes (e.g. after undo/redo reverts the overlay).
watch(
  () => props.source,
  (value) => {
    draft.value = buildDraft(value);
    error.value = "";
    lastEmittedJson = JSON.stringify(
      bonusDraft.toSet({ ...draft.value, id: value?.id ?? "" }),
    );
    resetDraftHistory();
  },
);

// For existing sets: schedule emit on draft change.
// For new sets: schedule snapshot for draft undo.
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

// Register formUndo for new sets (draft undo).
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
      <strong>{{ draft.name || draft.id || "New bonus set" }}</strong>
      <BaseBadge v-if="status !== 'base'" :variant="status as any">{{
        status
      }}</BaseBadge>
      <BaseBadge v-if="dirty && isNew">unsaved</BaseBadge>
      <span class="flex-1"></span>
      <!-- Save button only for new sets -->
      <BaseButton
        v-if="isNew"
        variant="primary"
        :disabled="!dirty"
        @click="save"
        >Save bonus set</BaseButton
      >
      <BaseButton v-if="status === 'edited'" @click="$emit('revert')"
        >Revert to shipped</BaseButton
      >
      <BaseButton v-if="source" @click="$emit('delete')">Delete</BaseButton>
      <!-- BonusGroups.vue's per-item embedding injects its own "Detach" here -->
      <slot name="extra-actions" />
    </FormBar>

    <p v-if="error" class="mt-1 text-danger">{{ error }}</p>

    <FormGrid class="mb-2">
      <FormField label="Group name">
        <input
          v-model="draft.name"
          class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          type="text"
        />
      </FormField>
      <IdField
        :id="displayId"
        label="Group id"
        :existing="Boolean(source || fixedId)"
      />
    </FormGrid>

    <p class="text-sm text-muted">
      <template v-if="members.length">
        Granted by <strong>{{ members.length }}</strong> item(s) —
        {{ members.join(", ") }}.
      </template>
      <template v-else>
        Not granted by any item yet -- attach this id from an item's Bonuses
        section.
      </template>
    </p>

    <FormSection sub>Stacking</FormSection>
    <div class="flex flex-wrap items-center gap-1.5 mb-1">
      <ComboBox
        class="w-64"
        :model-value="draft.stacking"
        :options="stackingOptions"
        @update:model-value="(v) => (draft.stacking = v)"
      />
      <template v-if="draft.stacking === 'perSource'">
        <FormField label="Max stacks">
          <input
            v-model.number="draft.maxStacks"
            type="number"
            min="0"
            class="w-16 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          />
        </FormField>
        <span class="text-sm text-muted"
          >maximum stacks (blank = no limit)</span
        >
      </template>
    </div>

    <FormSection sub>Suppresses these bonuses</FormSection>
    <TokenInput
      v-model="draft.excludes"
      :options="bonusIds"
      placeholder="bonus id to suppress…"
    />

    <FormSection>
      Grants
      <IconButton icon="circle-plus" title="Add grant" @click="addGrant" />
      <span v-if="!draft.grants.length" class="text-sm text-muted"
        >none yet</span
      >
    </FormSection>

    <BonusRows
      :store="draftStore"
      :set-ids="setIds"
      :tags="tags"
      @error="error = $event"
    />
  </div>
</template>
