<script setup lang="ts">
// "Bonuses": every bonus group the open item belongs to, editable in place.
//
// A thin orchestrator over BonusForm.vue: this owns which ids are attached, each
// attachment's occurrence config and which cards are open; all bonus editing is BonusForm's,
// the same component the standalone "Bonuses" section uses, so there is one editing surface.
// A pending slot has no id until its first save, which persists the bonus and attaches the
// resulting id in one step. Each card's single header row is BonusForm's embedded
// DraftFormBar, filled through its slots (chevron, occurrence chip, Detach); the chevron is
// the accessible toggle and the rest of the row a wider hit area for the same fold. A lone
// attached bonus starts open, several start closed, and a pending one is always open.
import { ref, computed, provide } from "vue";
import BonusForm from "./BonusForm.vue";
import BonusComboBox from "./BonusComboBox.vue";
import BonusOccurrenceSection from "./BonusOccurrenceSection.vue";
import IconButton from "../ui/IconButton.vue";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CirclePlus,
  Unlink,
} from "@lucide/vue";
import BaseBadge from "../ui/BaseBadge.vue";
import BaseButton from "../ui/BaseButton.vue";
import FormSection from "../ui/FormSection.vue";
import type { Db, Bonus, BonusOption } from "../../types";
import type { BonusDraft } from "../../lib/bonus-draft";
import type { BonusDraftStore } from "../../stores/bonus-draft";
import type { OccurrenceDraft } from "../../lib/item-draft";
import { occurrenceSummary } from "../../lib/occurrence-mode";
import { bonusDraftRegistryKey } from "../../composables/bonusDraftRegistry";
import FormSectionDescription from "../ui/FormSectionDescription.vue";

// Lets a condition be dragged from one bonus's tree straight into another's, both attached to
// this same item (see bonusDraftRegistry.ts): each BonusForm below registers its own
// store under its slot's key.
provide(bonusDraftRegistryKey, new Map<string, BonusDraftStore>());

const props = withDefaults(
  defineProps<{
    /** Bonus ids the item currently declares. */
    attachedBonusIds?: string[];
    /** Occurrence config for an attached id upgraded from a plain attachment (always 1
     *  occurrence) to a typed, player-set count; absent means plain. Keyed by bonus id. */
    occurrenceConfigs?: Record<string, OccurrenceDraft>;
    /** Seeds the Name field of a brand-new private bonus. */
    itemName?: string;
    /** The item being edited, so its own "Granted by" entry is not a link to itself. */
    itemId?: string;
    db: Db;
    /** Every known bonus id, for id-collision avoidance. */
    allBonusIds?: string[];
    tags?: string[];
    /** Every known bonus, for "attach an existing bonus" and the pickers in each form. */
    bonusOptions?: BonusOption[];
    /** All existing ids for collision-free id allocation. */
    allocatableIds?: string[];
  }>(),
  {
    attachedBonusIds: () => [],
    occurrenceConfigs: () => ({}),
    itemName: "",
    itemId: undefined,
    allBonusIds: () => [],
    tags: () => [],
    bonusOptions: () => [],
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
  "open-item": [itemId: string];
}>();

interface Slot {
  key: string;
  id: string | null;
  /** Source bonus copied by "Duplicate": seeds a fresh pending slot's draft via
   *  BonusForm's `duplicate-from` prop instead of leaving it blank. */
  seed?: Bonus | null;
}

let nextPendingKey = 0;
const pending = ref<Slot[]>([]);

function attachedKey(id: string): string {
  return `id:${id}`;
}

/** Slot keys whose card is open: local UI state, neither saved nor undone. Seeded once per
 *  mount (ItemForm is keyed by item) with a lone attached bonus open. */
const expandedKeys = ref(
  new Set<string>(
    props.attachedBonusIds.length === 1
      ? props.attachedBonusIds.map(attachedKey)
      : [],
  ),
);

function isExpanded(slot: Slot): boolean {
  return expandedKeys.value.has(slot.key);
}

function toggleExpanded(slot: Slot) {
  if (expandedKeys.value.has(slot.key)) expandedKeys.value.delete(slot.key);
  else expandedKeys.value.add(slot.key);
}

const openCount = computed(
  () => slots.value.filter((slot) => isExpanded(slot)).length,
);

function expandAll() {
  for (const slot of slots.value) expandedKeys.value.add(slot.key);
}

function collapseAll() {
  expandedKeys.value.clear();
}

/** One slot per attached id, plus however many pending (not-yet-saved, not-yet-attached) ones
 * are in progress. An attached slot is keyed by its id, a pending one by its own counter. */
const slots = computed<Slot[]>(() => [
  ...props.attachedBonusIds.map((id): Slot => ({ key: attachedKey(id), id })),
  ...pending.value,
]);

/** Existing bonuses not already attached, for "attach an existing bonus". */
const attachable = computed(() => {
  const attached = new Set(props.attachedBonusIds);
  return props.bonusOptions.filter((option) => !attached.has(option.value));
});

function sourceFor(slot: Slot): Bonus | null {
  return slot.id ? (props.db.bonusById.get(slot.id) ?? null) : null;
}

/** An occurrence config only makes sense once the attachment has a real bonus id; a pending
 *  (not-yet-saved) slot has none yet, so this reads as "no config" for it too. */
function occurrenceFor(id: string | null): OccurrenceDraft | null {
  return id ? (props.occurrenceConfigs[id] ?? null) : null;
}

/** The compact chip beside the title: how many times this attachment counts. A pending slot
 *  has no attachment yet, so it shows none. */
function occurrenceChip(slot: Slot): string | null {
  return slot.id ? occurrenceSummary(occurrenceFor(slot.id)) : null;
}

/** A pending slot's id previews from Name, so it's seeded with the item's own name: the
 * common case is a bonus that's only this item's business. Read once at creation (`initialDraft`
 * is only ever consulted on mount), not kept in sync with later edits to the item's own name. */
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

function addPending(seed: Bonus | null) {
  const key = `pending:${nextPendingKey}`;
  nextPendingKey += 1;
  pending.value.push({ key, id: null, seed });
  expandedKeys.value.add(key);
}

function addBonus() {
  addPending(null);
}

function attachExisting(id: string) {
  if (!id) return;
  emit("attach-bonus", id);
}

/** Forwards the save; a pending slot's first save also attaches the new id. The pending slot
 *  is then dropped, since the id now arrives through `props.attachedBonusIds` and keeping
 *  both would render the bonus twice; the fresh attached card inherits the open state. */
function onSlotSave(slot: Slot, payload: { id: string; bonus: Bonus }) {
  emit("save-bonus", payload);
  if (!slot.id) {
    emit("attach-bonus", payload.id);
    pending.value = pending.value.filter((s) => s !== slot);
    expandedKeys.value.delete(slot.key);
    expandedKeys.value.add(attachedKey(payload.id));
  }
}

/** Live-edit handler: debounced changes from existing bonuses go here. */
function onSlotUpdate(slot: Slot, payload: { id: string; bonus: Bonus }) {
  if (slot.id) {
    emit("update-bonus", payload);
  }
}

/** Stop this item from listing the bonus; always valid, whether or not the bonus is defined,
 * shared, or brand-new. A pending slot has nothing attached yet, so this just discards it. */
function onSlotDetach(slot: Slot) {
  if (slot.id) emit("detach-bonus", slot.id);
  else pending.value = pending.value.filter((s) => s !== slot);
  expandedKeys.value.delete(slot.key);
}

function onSlotDelete(slot: Slot) {
  if (slot.id) emit("delete-bonus", slot.id);
}

/** "Duplicate" on an attached bonus adds a new pending slot seeded from it: the same
 * unsaved-until-Save flow as "Add bonus", just pre-filled instead of blank. */
function onSlotDuplicate(slot: Slot) {
  const source = sourceFor(slot);
  if (source) addPending(source);
}
</script>

<template>
  <div>
    <FormSection>
      Bonuses
      <IconButton title="Add bonus" @click="addBonus"
        ><CirclePlus
      /></IconButton>
      <!-- A control inside the heading, not heading text: drops the heading's own case,
           weight and tracking so the picker and its menu read like every other picker. -->
      <span
        v-if="attachable.length"
        class="inline-flex items-center gap-1.5 font-normal normal-case tracking-normal"
      >
        or
        <BonusComboBox
          class="w-56"
          model-value=""
          :options="attachable"
          placeholder="Attach an existing one…"
          @update:model-value="attachExisting"
        />
      </span>
      <!-- Same pair, order and icons as the build editor's own section controls; only worth
           a row's width once there is more than one card to fold. -->
      <span
        v-if="slots.length > 1"
        class="ml-auto inline-flex items-center gap-1.5 font-normal normal-case tracking-normal"
      >
        <BaseButton
          :disabled="openCount === slots.length"
          data-testid="bonus-expand-all"
          @click="expandAll"
          ><ChevronsUpDown />expand all</BaseButton
        >
        <BaseButton
          :disabled="!openCount"
          data-testid="bonus-collapse-all"
          @click="collapseAll"
          ><ChevronsDownUp />collapse all</BaseButton
        >
      </span>
    </FormSection>

    <FormSectionDescription v-if="!slots.length">
      This item has no bonuses.
    </FormSectionDescription>

    <div
      v-for="slot in slots"
      :key="slot.key"
      data-testid="bonus-card"
      :data-expanded="isExpanded(slot)"
      class="mb-2.5 rounded-md border border-line bg-accent-soft/30 px-2.5 py-1"
    >
      <BonusForm
        :source="sourceFor(slot)"
        :fixed-id="slot.id"
        :initial-draft="initialDraftFor(slot)"
        :duplicate-from="slot.seed ?? null"
        :registry-id="slot.key"
        :db="db"
        :all-bonus-ids="allBonusIds"
        :tags="tags"
        :bonus-options="bonusOptions"
        :allocatable-ids="props.allocatableIds"
        :current-item-id="itemId"
        embedded
        toggleable
        :collapsed="!isExpanded(slot)"
        @save="onSlotSave(slot, $event)"
        @toggle="toggleExpanded(slot)"
        @update:bonus="onSlotUpdate(slot, $event)"
        @delete="onSlotDelete(slot)"
        @duplicate="onSlotDuplicate(slot)"
        @open-item="emit('open-item', $event)"
      >
        <template #leading>
          <IconButton
            :title="isExpanded(slot) ? 'Collapse' : 'Expand'"
            :aria-expanded="isExpanded(slot)"
            data-testid="bonus-card-toggle"
            @click="toggleExpanded(slot)"
          >
            <ChevronDown v-if="isExpanded(slot)" />
            <ChevronRight v-else />
          </IconButton>
        </template>
        <template #after-title>
          <!-- A dangling reference (attached id with no catalog entry, typically a hand-edited
               import) has nothing else to signal it: BonusForm's own `status` badge needs
               overlay access this component doesn't have, so it stays 'base' here throughout. -->
          <BaseBadge v-if="slot.id && !sourceFor(slot)" variant="warn"
            >not defined yet</BaseBadge
          >
          <span
            v-if="occurrenceChip(slot)"
            class="rounded-full bg-surface-2 px-1.5 text-muted"
            data-testid="occurrence-chip"
            >{{ occurrenceChip(slot) }}</span
          >
        </template>
        <template #extra-actions>
          <IconButton title="Detach" @click="onSlotDetach(slot)"
            ><Unlink
          /></IconButton>
        </template>
        <BonusOccurrenceSection
          v-if="slot.id"
          :occurrence="occurrenceFor(slot.id)"
          :bonus-id="slot.id"
          :bonus-name="sourceFor(slot)?.name ?? ''"
          @update:occurrence="
            emit('update-occurrence', { id: slot.id, occurrence: $event })
          "
        />
      </BonusForm>
    </div>
  </div>
</template>
