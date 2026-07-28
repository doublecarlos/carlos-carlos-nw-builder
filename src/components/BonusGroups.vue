<script setup lang="ts">
// "Bonuses" -- every bonus group the open item belongs to, editable in place.
//
// There is no separate "bonuses on this item" section any more: a bonus that only this item
// grants is just a group with one member, which this component already renders correctly with
// no special-casing (a card's "Currently 1 item(s)" line falls out of `db.setMembers` for
// free). Bonuses used to live behind their own tab; they moved here so editing one is not a
// context switch away from the item that grants it.
//
// Each group saves independently of the item: a shared group is referenced by every item that
// lists its id, so folding its Save into the item's would imply an ownership that does not
// exist.
import { reactive, computed, watch } from 'vue';
import BonusRows from './BonusRows.vue';
import ComboBox from './ComboBox.vue';
import IconButton from './IconButton.vue';
import TokenInput from './TokenInput.vue';
import * as bonusDraft from '../bonus-draft';

const slugify = (text: string) => String(text).toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Key-order-insensitive comparison -- same convention (and same duplication, one copy per
 * editing surface) as ItemForm's `sameItem` and BonusSetForm's `sameSet`. */
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

const props = withDefaults(defineProps<{
  /** Bonus group ids the item currently declares. */
  setIds?: string[];
  /** Seeds the id of a brand-new private bonus. */
  itemName?: string;
  db: any;
  allSetIds?: string[];
  tags?: string[];
  bonusIds?: string[];
}>(), {
  setIds: () => [],
  itemName: '',
  allSetIds: () => [],
  tags: () => [],
  bonusIds: () => [],
});

const emit = defineEmits<{
  'save-set': [payload: { id: string; previousId: string | null; set: any }];
  'delete-set': [id: string];
  'detach-set': [id: string];
  'rename-set': [payload: { oldId: string; newId: string }];
  'attach-set': [id: string];
}>();

const drafts = reactive<Record<string, any>>({});
const errors = reactive<Record<string, string>>({});

/**
 * One card per declared group, whether or not a definition exists for it yet. Cards
 * without a draft are skipped rather than rendered half-built: the watcher creates the
 * draft, and a render that raced it used to throw on `drafts[id].name`.
 */
const cards = computed(() => props.setIds
  .filter((id) => drafts[id])
  .map((id) => {
    const set = props.db.bonusSetById.get(id) ?? null;
    return { id, set, defined: Boolean(set) };
  }));

/** Existing groups not already attached, for "attach an existing bonus". */
const attachable = computed(() => {
  const attached = new Set(props.setIds);
  return props.allSetIds
    .filter((id) => !attached.has(id))
    .map((id) => ({ value: id, label: props.db.bonusSetById.get(id)?.name ?? id }));
});

const stackingOptions = [
  { value: '', label: 'once, however many sources' },
  { value: 'perSource', label: 'once per contributing slot' },
];

/**
 * Rebuild drafts for groups we are not already editing. Existing drafts are left alone
 * so an in-progress edit survives an unrelated change elsewhere in the form.
 */
function sync() {
  for (const id of props.setIds) {
    if (drafts[id]) continue;
    const set = props.db.bonusSetById.get(id);
    drafts[id] = {
      id,
      name: set?.name ?? id,
      grants: (set?.grants ?? []).map((grant: any) => bonusDraft.toDraft(grant)),
      stacking: set?.stacking ?? '',
      maxStacks: set?.maxStacks ?? null,
      excludes: [...(set?.excludes ?? [])],
    };
  }
}

// `deep` as well as `immediate`: callers should hand us a fresh array, but a single
// in-place mutation anywhere would otherwise leave a card with no draft behind it.
watch(() => props.setIds, sync, { immediate: true, deep: true });
watch(() => props.db, sync);

/** Discard a draft so it is rebuilt from the saved data on the next sync. */
function reset(id: string) {
  delete drafts[id];
  errors[id] = '';
  sync();
}

/** Gates the card's own Save button, same as the item form's and the top-level bonus set
 * form's -- a card with no saved definition yet always has something worth saving, but a
 * defined one is compared against the catalogue so an untouched card's Save stays
 * disabled instead of sitting clickable with nothing to commit. */
function isDirty(id: string) {
  const local = drafts[id];
  if (!local) return false;
  const set = props.db.bonusSetById.get(id) ?? null;
  if (!set) return true;
  try {
    return !sameSet(bonusDraft.toSet({ ...local, id: local.id || id }), set);
  } catch {
    return true;
  }
}

function save(id: string) {
  const local = drafts[id];
  if (!local) return;
  const newId = (local.id || '').trim();
  if (!newId) {
    errors[id] = 'The group needs an id.';
    return;
  }
  if (newId !== id && props.allSetIds.includes(newId)) {
    errors[id] = `“${newId}” is already used by another bonus group.`;
    return;
  }
  let set;
  try {
    set = bonusDraft.toSet({ ...local, id: newId });
  } catch (error: any) {
    errors[id] = `A grant has invalid JSON: ${error.message}`;
    return;
  }
  errors[id] = '';
  const renamed = newId !== id;
  emit('save-set', { id: newId, previousId: renamed ? id : null, set });
  // Rekey the draft under the new id so the card survives the id change without
  // waiting on a round trip through `setIds` -> `sync()`, which would otherwise
  // momentarily render it with a blank draft rebuilt from whatever `db` has yet.
  if (renamed) {
    delete drafts[id];
    delete errors[id];
    drafts[newId] = { ...local, id: newId };
    emit('rename-set', { oldId: id, newId });
  }
}

/** Fill the id field from the current name -- the common case, since a private bonus's
 * id is almost always just its item's name slugified. */
function generateId(id: string) {
  const local = drafts[id];
  local.id = slugify(local.name) || local.id;
}

function remove(id: string) {
  delete drafts[id];
  emit('delete-set', id);
}

/** A card with no saved definition yet has nothing to remove from the catalogue -- just
 * detach the id from this item so it stops showing up. */
function detach(id: string) {
  delete drafts[id];
  delete errors[id];
  emit('detach-set', id);
}

/** A brand-new grant is unconditional by default -- the common case now that most
 * bonuses are private to one item, not a multi-piece set requirement. */
function addGrant(id: string) {
  drafts[id].grants.push(bonusDraft.toDraft({ when: {}, stats: {} }));
}

/** Create a bonus group and attach it to the item in one step, seeded from the item's
 * own name -- the common case is a bonus that is only this item's business. */
function addBonus() {
  const base = slugify(props.itemName || 'new-bonus') || 'new-bonus';
  let id = base;
  let n = 2;
  while (props.allSetIds.includes(id)) { id = `${base}-${n}`; n += 1; }
  emit('attach-set', id);
}

function attachExisting(id: string) {
  if (!id) return;
  emit('attach-set', id);
}
</script>

<template>
  <div>
    <div class="form-section">
      Bonuses
      <IconButton icon="circle-plus" title="Add bonus" @click="addBonus" />
      <span v-if="attachable.length" class="bonus-attach">
        or
        <ComboBox class="bonus-attach-combo" model-value="" :options="attachable"
                  placeholder="attach an existing one…" @update:model-value="attachExisting" />
      </span>
    </div>

    <p v-if="!cards.length" class="hint">
      This item has no bonuses yet. Add one above -- most are private to a single item;
      attaching an existing bonus id shares it with whatever else already lists it.
    </p>

    <div v-for="card in cards" :key="card.id" class="setcard">
      <div class="setcard-head">
        <label class="field"><span class="field-label">Group name</span>
          <input class="setcard-name" type="text" v-model="drafts[card.id].name"></label>
        <label class="field"><span class="field-label">Group id</span>
          <span class="setcard-id-row">
            <input class="setcard-id" type="text" v-model="drafts[card.id].id">
            <IconButton icon="wand-sparkles" title="Generate id from name" @click="generateId(card.id)" />
          </span>
        </label>
        <span v-if="!card.defined" class="badge badge--warn">not defined yet</span>
        <span v-if="isDirty(card.id)" class="badge badge--near">unsaved</span>
        <span class="spacer"></span>
        <button type="button" class="btn btn--primary" :disabled="!isDirty(card.id)"
                @click="save(card.id)">Save</button>
        <button type="button" class="btn" @click="reset(card.id)">Reset</button>
        <button v-if="card.defined" type="button" class="btn"
                @click="remove(card.id)">Delete</button>
        <button v-else type="button" class="btn"
                @click="detach(card.id)">Remove</button>
      </div>

      <p v-if="errors[card.id]" class="drawer-error">{{ errors[card.id] }}</p>

      <p class="hint">
        <template v-if="(db.setMembers.get(card.id) ?? []).length > 1">
          Shared by <strong>{{ (db.setMembers.get(card.id) ?? []).length }}</strong> items —
          {{ (db.setMembers.get(card.id) ?? []).join(', ') }}.
        </template>
        <template v-else>Only on this item.</template>
      </p>

      <div class="sub-section">Stacking</div>
      <div class="cond-row">
        <ComboBox class="combo--stacking" :model-value="drafts[card.id].stacking" :options="stackingOptions"
                  @update:model-value="v => drafts[card.id].stacking = v" />
        <template v-if="drafts[card.id].stacking === 'perSource'">
          <label class="field"><span class="field-label">Max stacks</span>
            <input type="number" min="0" class="tier-pieces" v-model.number="drafts[card.id].maxStacks"></label>
          <span class="hint">maximum stacks (blank = no limit)</span>
        </template>
      </div>

      <div class="sub-section">Suppresses these bonuses</div>
      <TokenInput v-model="drafts[card.id].excludes" :options="bonusIds"
                  placeholder="bonus id to suppress…" />

      <div class="sub-section">
        Grants
        <IconButton icon="circle-plus" title="Add grant" @click="addGrant(card.id)" />
        <span v-if="!drafts[card.id].grants.length" class="hint">none yet</span>
      </div>

      <BonusRows
        :rows="drafts[card.id].grants"
        :set-ids="allSetIds"
        :tags="tags"
        @error="errors[card.id] = $event" />
    </div>
  </div>
</template>
