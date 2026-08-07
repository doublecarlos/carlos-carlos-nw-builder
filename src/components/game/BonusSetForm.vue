<script setup lang="ts">
// Editing form for one bonus set. Hybrid approach:
// - Existing sets (source != null): live edits, changes emit immediately
// - New sets (source == null): explicit Save button, draft until name is finalized
import { ref, computed, watch } from "vue";
import BonusRows from "./BonusRows.vue";
import IconButton from "../ui/IconButton.vue";
import { CirclePlus, Copy, Save, Trash, Undo2 } from "@lucide/vue";
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
import { deepEqual } from "../../lib/deep-equal";
import { useDraftHistory } from "../../composables/useDraftHistory";
import { BonusDraftStore } from "../../stores/bonus-draft";
import type { BonusSet, Db } from "../../types";

const props = withDefaults(
  defineProps<{
    /** The bonus set being edited, or null for a brand-new one. */
    source?: BonusSet | null;
    /** Seed values for a brand-new draft, copied from an existing set ("Duplicate").
     *  Ignored once `source` or `initialDraft` is set -- only meaningful while creating
     *  a new top-level set. */
    duplicateFrom?: BonusSet | null;
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
    duplicateFrom: null,
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
  duplicate: [];
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
    : buildDraft(
        props.source ??
          (props.duplicateFrom ? { ...props.duplicateFrom, id: "" } : null),
      ),
);
const error = ref("");
// Initialize with set JSON for correct comparison on existing sets.
let lastEmittedJson = JSON.stringify(
  props.source
    ? bonusDraft.toSet({ ...draft.value, id: props.source.id })
    : draft.value,
);

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

// --- Live edit emit (existing sets) ---------------------------------------------------

function emitChange() {
  const name = draft.value.name.trim();
  if (!name) return;
  // Hold off saving while any grant's condition tree is half-drawn (a leaf with no value
  // yet, an empty group branch): `rowsToWhen` drops it silently, and the source round-trip
  // would then wipe the row from the form. The next mutation re-schedules this emit.
  if (
    !draft.value.grants.every((grant) => bonusDraft.grantWhenIsComplete(grant))
  )
    return;
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

const { resetDraftHistory, scheduleSnapshot, scheduleEmit } = useDraftHistory({
  draft,
  isNew,
  diffLabel,
  onEmit: emitChange,
});

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
  return !set || !deepEqual(set, props.source);
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
  if (
    !draft.value.grants.every((grant) => bonusDraft.grantWhenIsComplete(grant))
  ) {
    error.value =
      "A grant has an unfinished condition -- fill in its value or remove the condition before saving.";
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
  props.setIds,
);

// Rebuild draft when source changes (e.g. after undo/redo reverts the overlay).
watch(
  () => props.source,
  (value) => {
    // Live edits round-trip through the layer overlay: emitChange → updateOverlay → db
    // recompute → this prop. Rebuilding from that echo would wipe half-drawn rows —
    // rowsToStats drops empty stat rows on serialize, so an "add the rows first, fill
    // them later" session would lose the still-empty ones. Skip the rebuild when the
    // new source is byte-identical to what this form last emitted.
    if (value && lastEmittedJson && JSON.stringify(value) === lastEmittedJson)
      return;
    draft.value = buildDraft(value);
    error.value = "";
    lastEmittedJson = JSON.stringify(
      bonusDraft.toSet({ ...draft.value, id: value?.id ?? "" }),
    );
    resetDraftHistory();
  },
);
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
        ><Save />Save bonus set</BaseButton
      >
      <BaseButton v-if="status === 'edited'" @click="$emit('revert')"
        ><Undo2 />Revert to shipped</BaseButton
      >
      <BaseButton
        v-if="source"
        data-testid="duplicate-bonus-set"
        @click="$emit('duplicate')"
        ><Copy />Duplicate</BaseButton
      >
      <BaseButton v-if="source" @click="$emit('delete')"
        ><Trash />Delete</BaseButton
      >
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
          data-testid="bonus-set-name-input"
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
      <IconButton title="Add grant" @click="addGrant"
        ><CirclePlus
      /></IconButton>
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
