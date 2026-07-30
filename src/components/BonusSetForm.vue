<script setup lang="ts">
// Editing form for one bonus set, browsed and edited on its own -- not from inside the item
// that happens to grant it. Same effect editor as BonusGroups's per-card view (BonusRows), but
// full-page like ItemForm and independent of any item: a bonus set here may be granted by
// zero, one, or many items, and this form does not care which.
import { ref, computed, watch, onUnmounted } from 'vue';
import BonusRows from './BonusRows.vue';
import IconButton from './ui/IconButton.vue';
import ComboBox from './ui/ComboBox.vue';
import TokenInput from './ui/TokenInput.vue';
import Button from './ui/Button.vue';
import HistoryButton from './ui/HistoryButton.vue';
import Badge from './ui/Badge.vue';
import FormBar from './ui/FormBar.vue';
import FormField from './ui/FormField.vue';
import FormGrid from './ui/FormGrid.vue';
import FormSection from './ui/FormSection.vue';
import * as bonusDraft from '../bonus-draft';
import type { BonusSet, Db } from '../types';

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
};

const sameSet = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const slugify = (text: string) => String(text).toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Same draft-level undo as ItemForm.vue -- see its own comment for why a debounced deep watch
// instead of a snapshot-per-field-method the way the build form does it.
const SNAPSHOT_DEBOUNCE_MS = 700;
const UNDO_LIMIT = 50;

const props = withDefaults(defineProps<{
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
}>(), {
  source: null,
  status: 'base',
  setIds: () => [],
  tags: () => [],
  bonusIds: () => [],
  initialDraft: null,
});

const emit = defineEmits<{
  save: [payload: { id: string; previousId: string | null; set: BonusSet }];
  delete: [];
  revert: [];
  dirty: [value: boolean];
}>();

function buildDraft(set: BonusSet | null | undefined): bonusDraft.SetDraft {
  const source = set ?? {} as Partial<BonusSet>;
  return {
    id: source.id ?? '',
    name: source.name ?? '',
    grants: (source.grants ?? []).map((grant) => bonusDraft.toDraft(grant)),
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
  <div>
    <FormBar>
      <strong>{{ draft.name || draft.id || 'New bonus set' }}</strong>
      <Badge v-if="status !== 'base'" :variant="status as any">{{ status }}</Badge>
      <Badge v-if="dirty">unsaved</Badge>
      <span class="flex-1"></span>
      <HistoryButton type="undo" :disabled="!canUndoDraft" title="Undo edit (Ctrl+Z)" @click="undoDraft">Undo</HistoryButton>
      <HistoryButton type="redo" :disabled="!canRedoDraft" title="Redo edit (Ctrl+Shift+Z)" @click="redoDraft">Redo</HistoryButton>
      <Button variant="primary" :disabled="!dirty" @click="save">Save bonus set</Button>
      <Button :danger="confirmRevert" :disabled="!dirty" @click="revertDraft">
        {{ confirmRevert ? 'Really revert?' : 'Revert' }}
      </Button>
      <Button v-if="status === 'edited'" @click="$emit('revert')">Revert to shipped</Button>
      <Button v-if="source" @click="$emit('delete')">Delete</Button>
    </FormBar>

    <p v-if="error" class="mt-1 text-danger">{{ error }}</p>

    <FormGrid>
      <FormField label="Group name">
        <input class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
               type="text" v-model="draft.name">
      </FormField>
      <FormField label="Group id">
        <span class="flex items-center gap-1">
          <input class="w-full rounded bg-surface-2 px-1.5 text-sm text-muted focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
                 type="text" v-model="draft.id">
          <IconButton icon="wand-sparkles" title="Generate id from name" @click="generateId" />
        </span>
      </FormField>
    </FormGrid>

    <p class="text-sm text-muted">
      <template v-if="members.length">
        Granted by <strong>{{ members.length }}</strong> item(s) — {{ members.join(', ') }}.
      </template>
      <template v-else>
        Not granted by any item yet -- attach this id from an item's Bonuses section.
      </template>
    </p>

    <FormSection sub>Stacking</FormSection>
    <div class="flex flex-wrap items-center gap-1.5 mb-1">
      <ComboBox class="w-64" :model-value="draft.stacking" :options="stackingOptions"
                @update:model-value="v => draft.stacking = v" />
      <template v-if="draft.stacking === 'perSource'">
        <FormField label="Max stacks">
          <input type="number" min="0"
                 class="w-16 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
                 v-model.number="draft.maxStacks">
        </FormField>
        <span class="text-sm text-muted">maximum stacks (blank = no limit)</span>
      </template>
    </div>

    <FormSection sub>Suppresses these bonuses</FormSection>
    <TokenInput v-model="draft.excludes" :options="bonusIds"
                placeholder="bonus id to suppress…" />

    <FormSection>
      Grants
      <IconButton icon="circle-plus" title="Add grant" @click="addGrant" />
      <span v-if="!draft.grants.length" class="text-sm text-muted">none yet</span>
    </FormSection>

    <BonusRows
      :rows="draft.grants"
      :set-ids="setIds"
      :tags="tags"
      @error="error = $event" />
  </div>
</template>
