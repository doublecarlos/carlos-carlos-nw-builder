<script setup lang="ts">
// "Bonuses" -- every bonus group the open item belongs to, editable in place.
//
// A thin orchestrator over BonusForm.vue: this owns which ids are attached to the item
// (attach/detach, the "+ Add bonus"/"attach existing" affordances, one pending not-yet-saved
// slot per in-progress new bonus) and defers all of the actual editing -- name, id preview,
// stacking, excludes, grants, undo/redo, save/revert/delete -- to BonusForm itself, the same
// component the standalone "Bonuses" section uses. One bonus-editing surface, not two that
// can drift apart (the bug this replaced: a hand-rolled id-generation copy here froze the id the
// instant "+ Add bonus" was clicked, seeded from the *item's* name, instead of previewing it
// live from whatever the user types into the bonus's own Name field the way BonusForm does).
//
// A pending slot has no id at all until its first save: BonusForm previews one live off
// Name (seeded from the item's own name as a starting point), and that same Save both persists
// the bonus and attaches the resulting id to the item, in one step -- there is nothing to decide
// up front any more.
import { ref, computed, provide } from "vue";
import BonusForm from "./BonusForm.vue";
import ComboBox from "../ui/ComboBox.vue";
import IconButton from "../ui/IconButton.vue";
import FormField from "../ui/FormField.vue";
import FormGrid from "../ui/FormGrid.vue";
import { CirclePlus, Plus, Trash } from "@lucide/vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseBadge from "../ui/BaseBadge.vue";
import FormSection from "../ui/FormSection.vue";
import type { Db, Bonus } from "../../types";
import type { BonusDraft } from "../../engine/bonus-draft";
import type { BonusDraftStore } from "../../stores/bonus-draft";
import type { OccurrenceDraft } from "./ItemForm.vue";
import { bonusDraftRegistryKey } from "../../composables/bonusDraftRegistry";

// Lets a condition be dragged from one bonus's tree straight into another's, both attached to
// this same item (see bonusDraftRegistry.ts) -- each BonusForm below registers its own
// store under its slot's key.
provide(bonusDraftRegistryKey, new Map<string, BonusDraftStore>());

const props = withDefaults(
  defineProps<{
    /** Bonus ids the item currently declares. */
    attachedBonusIds?: string[];
    /** Occurrence config for an attached id upgraded from a plain attachment (always 1
     *  occurrence) to a typed, player-set count -- absent means plain. Keyed by bonus id. */
    occurrenceConfigs?: Record<string, OccurrenceDraft>;
    /** Seeds the Name field of a brand-new private bonus. */
    itemName?: string;
    db: Db;
    /** Every known bonus id, for "attach an existing bonus" and id-collision avoidance. */
    allBonusIds?: string[];
    tags?: string[];
    bonusIds?: string[];
    /** All existing ids for collision-free id allocation. */
    allocatableIds?: string[];
  }>(),
  {
    attachedBonusIds: () => [],
    occurrenceConfigs: () => ({}),
    itemName: "",
    allBonusIds: () => [],
    tags: () => [],
    bonusIds: () => [],
    allocatableIds: () => [],
  },
);

const emit = defineEmits<{
  "save-bonus": [payload: { id: string; bonus: Bonus }];
  "delete-bonus": [id: string];
  "detach-bonus": [id: string];
  "attach-bonus": [id: string];
  "update-bonus": [payload: { id: string; bonus: Bonus }];
  "update-occurrence": [
    payload: { id: string; occurrence: OccurrenceDraft | null },
  ];
}>();

interface Slot {
  key: string;
  id: string | null;
  /** Source bonus copied by "Duplicate" -- seeds a fresh pending slot's draft via
   *  BonusForm's `duplicate-from` prop instead of leaving it blank. */
  seed?: Bonus | null;
}

let nextPendingKey = 0;
const pending = ref<Slot[]>([]);

/** One slot per attached id, plus however many pending (not-yet-saved, not-yet-attached) ones
 * are in progress. An attached slot is keyed by its id; a pending slot keeps its own key across
 * the save transition (see `onSlotSave`) so its BonusForm instance is never remounted --
 * and so never loses its in-progress draft/undo history -- right at the moment it's saved. */
const slots = computed<Slot[]>(() => [
  ...props.attachedBonusIds.map((id): Slot => ({ key: `id:${id}`, id })),
  ...pending.value,
]);

/** Existing bonuses not already attached, for "attach an existing bonus". */
const attachable = computed(() => {
  const attached = new Set(props.attachedBonusIds);
  return props.allBonusIds
    .filter((id) => !attached.has(id))
    .map((id) => ({
      value: id,
      label: props.db.bonusById.get(id)?.name ?? id,
    }));
});

function sourceFor(slot: Slot): Bonus | null {
  return slot.id ? (props.db.bonusById.get(slot.id) ?? null) : null;
}

/** An occurrence config only makes sense once the attachment has a real bonus id -- a pending
 *  (not-yet-saved) slot has none yet, so this reads as "no config" for it too. */
function occurrenceFor(id: string | null): OccurrenceDraft | null {
  return id ? (props.occurrenceConfigs[id] ?? null) : null;
}

const emptyOccurrence: OccurrenceDraft = {
  min: null,
  max: null,
  default: null,
  label: "",
};

function addOccurrence(id: string | null) {
  if (!id) return;
  emit("update-occurrence", { id, occurrence: { ...emptyOccurrence } });
}

function removeOccurrence(id: string | null) {
  if (!id) return;
  emit("update-occurrence", { id, occurrence: null });
}

function updateOccurrenceField(
  id: string | null,
  field: keyof OccurrenceDraft,
  value: number | string | null,
) {
  if (!id) return;
  const current = occurrenceFor(id) ?? emptyOccurrence;
  emit("update-occurrence", {
    id,
    occurrence: { ...current, [field]: value },
  });
}

/** A pending slot's id previews from Name, so it's seeded with the item's own name -- the
 * common case is a bonus that's only this item's business. Read once at creation (`initialDraft`
 * is only ever consulted on mount) -- not kept in sync with later edits to the item's own name. */
function initialDraftFor(slot: Slot): BonusDraft | null {
  if (slot.id || slot.seed) return null;
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
  emit("attach-bonus", id);
}

/** A pending slot's first save both persists the bonus (forwarded as-is) and attaches the
 * resulting id to the item -- see the module comment above. The pending slot itself is then
 * dropped: the id it just got now flows through `props.attachedBonusIds` instead, same as any
 * other attached bonus, so keeping both around would double-render it. BonusForm resets its own
 * draft/undo history after every save regardless (its own comment on why), so there's nothing
 * lost by letting the real, `props.attachedBonusIds`-driven instance mount fresh rather than
 * trying to keep this exact component instance alive across the transition. An already-attached
 * slot's save is just a plain re-save, forwarded as-is. */
function onSlotSave(slot: Slot, payload: { id: string; bonus: Bonus }) {
  emit("save-bonus", payload);
  if (!slot.id) {
    emit("attach-bonus", payload.id);
    pending.value = pending.value.filter((s) => s !== slot);
  }
}

/** Live-edit handler: debounced changes from existing bonuses go here. */
function onSlotUpdate(slot: Slot, payload: { id: string; bonus: Bonus }) {
  if (slot.id) {
    emit("update-bonus", payload);
  }
}

/** Stop this item from listing the bonus -- always valid, whether or not the bonus is defined,
 * shared, or brand-new. A pending slot has nothing attached yet, so this just discards it. */
function onSlotDetach(slot: Slot) {
  if (slot.id) emit("detach-bonus", slot.id);
  else pending.value = pending.value.filter((s) => s !== slot);
}

function onSlotDelete(slot: Slot) {
  if (slot.id) emit("delete-bonus", slot.id);
}

/** "Duplicate" on an attached bonus adds a new pending slot seeded from it -- same
 * unsaved-until-Save flow as "Add bonus", just pre-filled instead of blank. */
function onSlotDuplicate(slot: Slot) {
  const source = sourceFor(slot);
  if (!source) return;
  pending.value.push({
    key: `pending:${nextPendingKey}`,
    id: null,
    seed: source,
  });
  nextPendingKey += 1;
}
</script>

<template>
  <div>
    <FormSection>
      Bonuses
      <IconButton title="Add bonus" @click="addBonus"
        ><CirclePlus
      /></IconButton>
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

    <p v-if="!slots.length" class="text-muted">
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
           typically) has nothing else to signal it: BonusForm's own `status` badge needs
           overlay access this component doesn't have, so it stays 'base' here throughout. -->
      <BaseBadge v-if="slot.id && !sourceFor(slot)" variant="warn" class="mb-1"
        >not defined yet</BaseBadge
      >
      <div
        v-if="slot.id"
        class="mb-1.5 flex flex-wrap items-center gap-1.5"
        data-testid="occurrence-config-row"
      >
        <IconButton
          v-if="!occurrenceFor(slot.id)"
          title="Add custom occurence count"
          data-testid="add-occurrence-config"
          @click="addOccurrence(slot.id)"
          ><Plus
        /></IconButton>
        <IconButton
          v-else
          title="Back to default occurence count"
          data-testid="remove-occurrence-config"
          @click="removeOccurrence(slot.id)"
          ><Trash
        /></IconButton>
        <span v-if="!occurrenceFor(slot.id)" class="text-muted"
          >Occurrence count: default (1 per item copy)</span
        >
        <template v-else>
          <span class="text-muted">Occurrence count:</span>
          <FormGrid data-testid="occurrence-config-fields">
            <FormField label="Min">
              <input
                class="w-16 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
                type="number"
                :value="occurrenceFor(slot.id)?.min ?? ''"
                @input="
                  updateOccurrenceField(
                    slot.id,
                    'min',
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
            </FormField>
            <FormField label="Max">
              <input
                class="w-16 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
                type="number"
                :value="occurrenceFor(slot.id)?.max ?? ''"
                @input="
                  updateOccurrenceField(
                    slot.id,
                    'max',
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
            </FormField>
            <FormField label="Default">
              <input
                class="w-16 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
                type="number"
                :value="occurrenceFor(slot.id)?.default ?? ''"
                @input="
                  updateOccurrenceField(
                    slot.id,
                    'default',
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
            </FormField>
            <FormField
              label="Label (optional, overrides the bonus name on this row)"
            >
              <input
                class="w-40 rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
                type="text"
                data-testid="occurrence-config-label-input"
                :value="occurrenceFor(slot.id)?.label ?? ''"
                @input="
                  updateOccurrenceField(
                    slot.id,
                    'label',
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
            </FormField>
          </FormGrid>
        </template>
      </div>
      <BonusForm
        :source="sourceFor(slot)"
        :fixed-id="slot.id"
        :initial-draft="initialDraftFor(slot)"
        :duplicate-from="slot.seed ?? null"
        :registry-id="slot.key"
        :db="db"
        :all-bonus-ids="allBonusIds"
        :tags="tags"
        :bonus-ids="bonusIds"
        :allocatable-ids="props.allocatableIds"
        @save="onSlotSave(slot, $event)"
        @update:bonus="onSlotUpdate(slot, $event)"
        @delete="onSlotDelete(slot)"
        @duplicate="onSlotDuplicate(slot)"
      >
        <template #extra-actions>
          <BaseButton @click="onSlotDetach(slot)">Detach</BaseButton>
        </template>
      </BonusForm>
    </div>
  </div>
</template>
