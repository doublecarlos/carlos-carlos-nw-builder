<script setup lang="ts">
// "Bonuses" -- every bonus group the open item belongs to, editable in place.
//
// A thin orchestrator over BonusSetForm.vue: this owns which ids are attached to the item
// (attach/detach, the "+ Add bonus"/"attach existing" affordances, one pending not-yet-saved
// slot per in-progress new bonus) and defers all of the actual editing -- name, id preview,
// stacking, excludes, grants, undo/redo, save/revert/delete -- to BonusSetForm itself, the same
// component the standalone "Bonus sets" section uses. One bonus-editing surface, not two that
// can drift apart (the bug this replaced: a hand-rolled id-generation copy here froze the id the
// instant "+ Add bonus" was clicked, seeded from the *item's* name, instead of previewing it
// live from whatever the user types into the bonus's own Name field the way BonusSetForm does).
//
// A pending slot has no id at all until its first save: BonusSetForm previews one live off
// Name (seeded from the item's own name as a starting point), and that same Save both persists
// the set and attaches the resulting id to the item, in one step -- there is nothing to decide
// up front any more.
import { ref, computed } from "vue";
import BonusSetForm from "./BonusSetForm.vue";
import ComboBox from "../ui/ComboBox.vue";
import IconButton from "../ui/IconButton.vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseBadge from "../ui/BaseBadge.vue";
import FormSection from "../ui/FormSection.vue";
import type { Db, BonusSet } from "../../types";
import type { SetDraft } from "../../engine/bonus-draft";

const props = withDefaults(
  defineProps<{
    /** Bonus group ids the item currently declares. */
    setIds?: string[];
    /** Seeds the Name field of a brand-new private bonus. */
    itemName?: string;
    db: Db;
    allSetIds?: string[];
    tags?: string[];
    bonusIds?: string[];
    /** All existing ids for collision-free id allocation. */
    allocatableIds?: string[];
  }>(),
  {
    setIds: () => [],
    itemName: "",
    allSetIds: () => [],
    tags: () => [],
    bonusIds: () => [],
    allocatableIds: () => [],
  },
);

const emit = defineEmits<{
  "save-set": [payload: { id: string; set: BonusSet }];
  "delete-set": [id: string];
  "detach-set": [id: string];
  "attach-set": [id: string];
  "update-set": [payload: { id: string; set: BonusSet }];
}>();

interface Slot {
  key: string;
  id: string | null;
}

let nextPendingKey = 0;
const pending = ref<Slot[]>([]);

/** One slot per attached id, plus however many pending (not-yet-saved, not-yet-attached) ones
 * are in progress. An attached slot is keyed by its id; a pending slot keeps its own key across
 * the save transition (see `onSlotSave`) so its BonusSetForm instance is never remounted --
 * and so never loses its in-progress draft/undo history -- right at the moment it's saved. */
const slots = computed<Slot[]>(() => [
  ...props.setIds.map((id): Slot => ({ key: `id:${id}`, id })),
  ...pending.value,
]);

/** Existing groups not already attached, for "attach an existing bonus". */
const attachable = computed(() => {
  const attached = new Set(props.setIds);
  return props.allSetIds
    .filter((id) => !attached.has(id))
    .map((id) => ({
      value: id,
      label: props.db.bonusSetById.get(id)?.name ?? id,
    }));
});

function sourceFor(slot: Slot): BonusSet | null {
  return slot.id ? (props.db.bonusSetById.get(slot.id) ?? null) : null;
}

/** A pending slot's id previews from Name, so it's seeded with the item's own name -- the
 * common case is a bonus that's only this item's business. Read once at creation (`initialDraft`
 * is only ever consulted on mount) -- not kept in sync with later edits to the item's own name. */
function initialDraftFor(slot: Slot): SetDraft | null {
  if (slot.id) return null;
  return {
    id: "",
    name: props.itemName,
    grants: [],
    stacking: "",
    maxStacks: null,
    excludes: [],
  };
}

function addBonus() {
  pending.value.push({ key: `pending:${nextPendingKey}`, id: null });
  nextPendingKey += 1;
}

function attachExisting(id: string) {
  if (!id) return;
  emit("attach-set", id);
}

/** A pending slot's first save both persists the set (forwarded as-is) and attaches the
 * resulting id to the item -- see the module comment above. The pending slot itself is then
 * dropped: the id it just got now flows through `props.setIds` instead, same as any other
 * attached bonus, so keeping both around would double-render it. BonusSetForm resets its own
 * draft/undo history after every save regardless (its own comment on why), so there's nothing
 * lost by letting the real, `props.setIds`-driven instance mount fresh rather than trying to
 * keep this exact component instance alive across the transition. An already-attached slot's
 * save is just a plain re-save, forwarded as-is. */
function onSlotSave(slot: Slot, payload: { id: string; set: BonusSet }) {
  emit("save-set", payload);
  if (!slot.id) {
    emit("attach-set", payload.id);
    pending.value = pending.value.filter((s) => s !== slot);
  }
}

/** Live-edit handler: debounced changes from existing bonus sets go here. */
function onSlotUpdate(slot: Slot, payload: { id: string; set: BonusSet }) {
  if (slot.id) {
    emit("update-set", payload);
  }
}

/** Stop this item from listing the set -- always valid, whether or not the set is defined,
 * shared, or brand-new. A pending slot has nothing attached yet, so this just discards it. */
function onSlotDetach(slot: Slot) {
  if (slot.id) emit("detach-set", slot.id);
  else pending.value = pending.value.filter((s) => s !== slot);
}

function onSlotDelete(slot: Slot) {
  if (slot.id) emit("delete-set", slot.id);
}
</script>

<template>
  <div>
    <FormSection>
      Bonuses
      <IconButton icon="circle-plus" title="Add bonus" @click="addBonus" />
      <span v-if="attachable.length" class="inline-flex items-center gap-1.5">
        or
        <ComboBox
          class="w-56"
          model-value=""
          :options="attachable"
          placeholder="attach an existing one…"
          @update:model-value="attachExisting"
        />
      </span>
    </FormSection>

    <p v-if="!slots.length" class="text-sm text-muted">
      This item has no bonuses yet. Add one above -- most are private to a
      single item; attaching an existing bonus id shares it with whatever else
      already lists it.
    </p>

    <div
      v-for="slot in slots"
      :key="slot.key"
      data-testid="bonus-card"
      class="mb-2.5 rounded-md border border-line bg-accent-soft/30 px-2.5 py-2"
    >
      <!-- A dangling reference (attached id with no catalogue entry -- a hand-edited import,
           typically) has nothing else to signal it: BonusSetForm's own `status` badge needs
           overlay access this component doesn't have, so it stays 'base' here throughout. -->
      <BaseBadge v-if="slot.id && !sourceFor(slot)" variant="warn" class="mb-1"
        >not defined yet</BaseBadge
      >
      <BonusSetForm
        :source="sourceFor(slot)"
        :fixed-id="slot.id"
        :initial-draft="initialDraftFor(slot)"
        :db="db"
        :set-ids="allSetIds"
        :tags="tags"
        :bonus-ids="bonusIds"
        :allocatable-ids="props.allocatableIds"
        @save="onSlotSave(slot, $event)"
        @update:set="onSlotUpdate(slot, $event)"
        @delete="onSlotDelete(slot)"
      >
        <template #extra-actions>
          <BaseButton @click="onSlotDetach(slot)">Detach</BaseButton>
        </template>
      </BonusSetForm>
    </div>
  </div>
</template>
