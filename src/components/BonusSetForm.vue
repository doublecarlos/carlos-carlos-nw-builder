<script setup lang="ts">
// Editing form for one bonus set, browsed and edited on its own -- not from inside the item
// that happens to grant it. Same effect editor as BonusGroups's per-card view (BonusRows), but
// full-page like ItemForm and independent of any item: a bonus set here may be granted by
// zero, one, or many items, and this form does not care which.
import { ref, computed, watch, onUnmounted } from "vue";
import BonusRows from "./BonusRows.vue";
import IconButton from "./ui/IconButton.vue";
import ComboBox from "./ui/ComboBox.vue";
import TokenInput from "./ui/TokenInput.vue";
import BaseButton from "./ui/BaseButton.vue";
import HistoryButton from "./ui/HistoryButton.vue";
import BaseBadge from "./ui/BaseBadge.vue";
import FormBar from "./ui/FormBar.vue";
import FormField from "./ui/FormField.vue";
import FormGrid from "./ui/FormGrid.vue";
import FormSection from "./ui/FormSection.vue";
import IdField from "./ui/IdField.vue";
import * as bonusDraft from "../bonus-draft";
import * as catalog from "../catalog";
import { BonusDraftStore } from "../stores/bonus-draft";
import type { BonusSet, Db } from "../types";

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

// Same draft-level undo as ItemForm.vue -- see its own comment for why a debounced deep watch
// instead of a snapshot-per-field-method the way the build form does it.
const SNAPSHOT_DEBOUNCE_MS = 700;
const UNDO_LIMIT = 50;

const props = withDefaults(
  defineProps<{
    /** The bonus set being edited, or null for a brand-new one. */
    source?: BonusSet | null;
    status?: string;
    db: Db;
    /** Every bonus set id -- both for the "tiered by set pieces" combo and the id-collision check. */
    setIds?: string[];
    tags?: string[];
    bonusIds?: string[];
    /** Same stash/restore as ItemForm.vue's own `initialDraft` -- see there for why. */
    initialDraft?: bonusDraft.SetDraft | null;
    /** An id already decided elsewhere, for a `source`-less instance that is *not* a brand-new
     * bonus set -- BonusGroups.vue's case of an item referencing an id with no catalogue entry
     * (a dangling reference, e.g. from a hand-edited import). Without this, `displayId`/`save()`
     * would treat any `!source` instance as brand-new and preview an id derived from the typed
     * name instead of the id that's already fixed. Absent for both the top-level "browse one"
     * editor and a genuinely new, not-yet-attached bonus, where the id should keep following the
     * name until first save. */
    fixedId?: string | null;
  }>(),
  {
    source: null,
    status: "base",
    setIds: () => [],
    tags: () => [],
    bonusIds: () => [],
    initialDraft: null,
    fixedId: null,
  },
);

const emit = defineEmits<{
  save: [payload: { id: string; set: BonusSet }];
  delete: [];
  revert: [];
  dirty: [value: boolean];
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
const confirmRevert = ref(false);
let confirmRevertTimer: number | undefined;

/** `db.setMembers` is keyed by item id -- resolved to display names here, same reasoning as
 * BonusGroups.vue's own `memberNames`. */
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

/** Best-effort conversion for the dirty check -- a row mid-edit as invalid JSON just
 * reads as "changed" rather than throwing here too. */
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

/** The id shown next to Name -- the frozen one for an existing set or a known `fixedId`, or a
 * live preview of what `save()` would assign on first save for a brand-new one. Same reasoning
 * as ItemForm.vue's own `displayId`: never a form field a user edits directly. */
const displayId = computed(
  () =>
    props.source?.id ??
    props.fixedId ??
    (draft.value.name.trim()
      ? catalog.nextId(draft.value.name.trim(), props.setIds, "bonus-set")
      : ""),
);

const canUndoDraft = computed(() => draftHistory.value.past.length > 0);
const canRedoDraft = computed(() => draftHistory.value.future.length > 0);

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

/** Same "discard the unsaved draft" as ItemForm.vue's own `revertDraft` -- see there. */
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
    catalog.nextId(name, props.setIds, "bonus-set");
  let set;
  try {
    set = bonusDraft.toSet({ ...draft.value, id });
  } catch (err: unknown) {
    error.value = `A grant has invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
    return;
  }
  emit("save", { id, set });
}

watch(
  () => props.source,
  (value) => {
    draft.value = buildDraft(value);
    error.value = "";
    resetDraftHistory();
  },
);

watch(dirty, (value) => emit("dirty", value), { immediate: true });

// The store drives all grant-list mutations — BonusRows calls store methods instead of
// emitting replaced arrays. It writes directly onto `draft.value.grants` so Vue's deep
// watch (below) picks up the change and schedules an undo snapshot.
const draftStore = new BonusDraftStore(
  () => draft.value.grants,
  scheduleSnapshot,
  undefined,
);

watch(draft, () => scheduleSnapshot(), { deep: true });

onUnmounted(() => {
  window.clearTimeout(snapshotTimer);
  window.clearTimeout(confirmRevertTimer);
});
</script>

<template>
  <div>
    <FormBar class="-m-3 mb-3">
      <strong>{{ draft.name || draft.id || "New bonus set" }}</strong>
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
        >Save bonus set</BaseButton
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
      <!-- BonusGroups.vue's per-item embedding injects its own "Detach" here -- stopping this
           item from listing the set is always valid (whether or not the set is defined,
           shared, or brand-new), and is not something a standalone editor has any use for. -->
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
