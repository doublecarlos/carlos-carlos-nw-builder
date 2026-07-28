<script setup lang="ts">
// Editing form for one bonus set, browsed and edited on its own -- not from inside the item
// that happens to grant it. Same effect editor as BonusGroups's per-card view (BonusRows), but
// full-page like ItemForm and independent of any item: a bonus set here may be granted by
// zero, one, or many items, and this form does not care which.
import { ref, computed, watch, onUnmounted } from 'vue';
import BonusRows from './BonusRows.vue';
import IconButton from './IconButton.vue';
import ComboBox from './ComboBox.vue';
import TokenInput from './TokenInput.vue';
import * as bonusDraft from '../bonus-draft';

const canonical = (value: any): any => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
};

const sameSet = (a: any, b: any) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const slugify = (text: string) => String(text).toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Same draft-level undo as ItemForm.vue -- see its own comment for why a debounced deep watch
// instead of a snapshot-per-field-method the way the build form does it.
const SNAPSHOT_DEBOUNCE_MS = 700;
const UNDO_LIMIT = 50;

const props = withDefaults(defineProps<{
  /** The bonus set being edited, or null for a brand-new one. */
  source?: any;
  status?: string;
  db: any;
  /** Every bonus set id -- both for the "tiered by set pieces" combo and the id-collision check. */
  setIds?: string[];
  tags?: string[];
  bonusIds?: string[];
  /** Same stash/restore as ItemForm.vue's own `initialDraft` -- see there for why. */
  initialDraft?: any;
}>(), {
  source: null,
  status: 'base',
  setIds: () => [],
  tags: () => [],
  bonusIds: () => [],
  initialDraft: null,
});

const emit = defineEmits<{
  save: [payload: { id: string; previousId: string | null; set: any }];
  delete: [];
  revert: [];
  dirty: [value: boolean];
}>();

function buildDraft(set: any) {
  const source = set ?? {};
  return {
    id: source.id ?? '',
    name: source.name ?? '',
    grants: (source.grants ?? []).map((grant: any) => bonusDraft.toDraft(grant)),
    stacking: source.stacking ?? '',
    maxStacks: source.maxStacks ?? null,
    excludes: [...(source.excludes ?? [])],
  };
}

const draft = ref<ReturnType<typeof buildDraft>>(props.initialDraft
  ? JSON.parse(JSON.stringify(props.initialDraft))
  : buildDraft(props.source));
const error = ref('');
const draftHistory = ref<{ past: string[]; future: string[] }>({ past: [], future: [] });
const lastSnapshotJson = ref(JSON.stringify(draft.value));
let snapshotTimer: number | undefined;
const confirmRevert = ref(false);
let confirmRevertTimer: number | undefined;

const members = computed(() => {
  if (!props.source) return [];
  return props.db.setMembers.get(props.source.id) ?? [];
});

const stackingOptions = [
  { value: '', label: 'once, however many sources' },
  { value: 'perSource', label: 'once per contributing slot' },
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
    return Boolean(draft.value.name || draft.value.id || draft.value.grants.length);
  }
  const set = asSet.value;
  return !set || !sameSet(set, props.source);
});

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
  snapshotTimer = window.setTimeout(() => commitSnapshot(), SNAPSHOT_DEBOUNCE_MS);
}

function commitSnapshot() {
  window.clearTimeout(snapshotTimer);
  const current = JSON.stringify(draft.value);
  if (current === lastSnapshotJson.value) return;
  draftHistory.value.past.push(lastSnapshotJson.value);
  if (draftHistory.value.past.length > UNDO_LIMIT) draftHistory.value.past.shift();
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
    confirmRevertTimer = window.setTimeout(() => { confirmRevert.value = false; }, 4000);
    return;
  }
  window.clearTimeout(confirmRevertTimer);
  confirmRevert.value = false;
  draft.value = buildDraft(props.source);
  error.value = '';
  resetDraftHistory();
}

/** Same convention as the item form and the per-card group editor: fill the id from the
 * current name. */
function generateId() { draft.value.id = slugify(draft.value.name) || draft.value.id; }

function addGrant() {
  draft.value.grants.push(bonusDraft.toDraft({ when: {}, stats: {} }));
}

function save() {
  error.value = '';
  const id = draft.value.id.trim();
  if (!id) { error.value = 'The bonus set needs an id.'; return; }
  if (id !== props.source?.id && props.setIds.includes(id)) {
    error.value = `“${id}” is already used by another bonus set.`;
    return;
  }
  let set;
  try {
    set = bonusDraft.toSet(draft.value);
  } catch (err: any) {
    error.value = `A grant has invalid JSON: ${err.message}`;
    return;
  }
  emit('save', { id, previousId: props.source?.id ?? null, set });
}

watch(() => props.source, (value) => {
  draft.value = buildDraft(value);
  error.value = '';
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
      <strong>{{ draft.name || draft.id || 'New bonus set' }}</strong>
      <span v-if="status !== 'base'" class="badge" :class="'badge--' + status">{{ status }}</span>
      <span v-if="dirty" class="badge badge--near">unsaved</span>
      <span class="spacer"></span>
      <button type="button" class="btn btn--history" :disabled="!canUndoDraft"
              title="Undo edit (Ctrl+Z)" @click="undoDraft">↶ Undo</button>
      <button type="button" class="btn btn--history" :disabled="!canRedoDraft"
              title="Redo edit (Ctrl+Shift+Z)" @click="redoDraft">↷ Redo</button>
      <button type="button" class="btn btn--primary" :disabled="!dirty" @click="save">Save bonus set</button>
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
      <label class="field"><span class="field-label">Group name</span>
        <input type="text" v-model="draft.name"></label>
      <label class="field"><span class="field-label">Group id</span>
        <span class="setcard-id-row">
          <input class="setcard-id" type="text" v-model="draft.id">
          <IconButton icon="wand-sparkles" title="Generate id from name" @click="generateId" />
        </span>
      </label>
    </div>

    <p class="hint">
      <template v-if="members.length">
        Granted by <strong>{{ members.length }}</strong> item(s) — {{ members.join(', ') }}.
      </template>
      <template v-else>
        Not granted by any item yet -- attach this id from an item's Bonuses section.
      </template>
    </p>

    <div class="sub-section">Stacking</div>
    <div class="cond-row">
      <ComboBox class="combo--stacking" :model-value="draft.stacking" :options="stackingOptions"
                @update:model-value="v => draft.stacking = v" />
      <template v-if="draft.stacking === 'perSource'">
        <label class="field"><span class="field-label">Max stacks</span>
          <input type="number" min="0" class="tier-pieces" v-model.number="draft.maxStacks"></label>
        <span class="hint">maximum stacks (blank = no limit)</span>
      </template>
    </div>

    <div class="sub-section">Suppresses these bonuses</div>
    <TokenInput v-model="draft.excludes" :options="bonusIds"
                placeholder="bonus id to suppress…" />

    <div class="form-section">
      Grants
      <IconButton icon="circle-plus" title="Add grant" @click="addGrant" />
      <span v-if="!draft.grants.length" class="hint">none yet</span>
    </div>

    <BonusRows
      :rows="draft.grants"
      :set-ids="setIds"
      :tags="tags"
      @error="error = $event" />
  </div>
</template>
