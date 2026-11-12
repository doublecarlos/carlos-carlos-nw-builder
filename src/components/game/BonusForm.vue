<script setup lang="ts">
// Editing form for one bonus. Hybrid approach:
// - Existing bonuses (source != null): live edits, changes emit immediately
// - New bonuses (source == null): explicit Save button, draft until name is finalized
import { computed, inject, onMounted, onUnmounted, shallowRef } from "vue";
import BonusRows from "./BonusRows.vue";
import ComboBox from "../ui/ComboBox.vue";
import TokenInput from "../ui/TokenInput.vue";
import BaseInput from "../ui/BaseInput.vue";
import LinkList from "../ui/LinkList.vue";
import type { LinkListItem } from "../ui/LinkList.vue";
import DraftFormBar from "../ui/DraftFormBar.vue";
import FormField from "../ui/FormField.vue";
import FormGrid from "../ui/FormGrid.vue";
import FormSection from "../ui/FormSection.vue";
import IdField from "../ui/IdField.vue";
import * as bonusDraft from "../../lib/bonus-draft";
import * as catalog from "../../data/catalog";
import { useEditorDraft } from "../../composables/useEditorDraft";
import { BonusDraftStore } from "../../stores/bonus-draft";
import { bonusDraftRegistryKey } from "../../composables/bonusDraftRegistry";
import BonusOptionRow from "./BonusOptionRow.vue";
import BonusInputRowList from "./BonusInputRowList.vue";
import MakeGlobalDialog from "./MakeGlobalDialog.vue";
import NamedFormulaRowList from "./NamedFormulaRowList.vue";
import { provideFormulaContext } from "../../composables/useFormulaContext";
import { inputFormulaClashes, namedCycles } from "../../engine/formula";
import type { Bonus, BonusOption, Db } from "../../types";
import type { MakeGlobalRequest } from "../../lib/make-global";
import type { EntryStatus } from "../../data/catalog";
import FormSectionDescription from "../ui/FormSectionDescription.vue";
import OcrTextField from "../ui/OcrTextField.vue";

const props = withDefaults(
  defineProps<{
    /** The bonus being edited, or null for a brand-new one. */
    source?: Bonus | null;
    /** Seed values for a brand-new draft, copied from an existing bonus ("Duplicate").
     *  Ignored once `source` or `initialDraft` is set: only meaningful while creating
     *  a new top-level bonus. */
    duplicateFrom?: Bonus | null;
    status?: EntryStatus;
    db: Db;
    /** Every known bonus id, for id-collision avoidance. */
    allBonusIds?: string[];
    tags?: string[];
    /** Every known bonus, for `excludes` and the "which bonus does this tier/condition count"
     *  pickers. */
    bonusOptions?: BonusOption[];
    allocatableIds?: string[];
    fixedId?: string | null;
    /** Initial draft for pending slots (ItemBonuses embedded case). */
    initialDraft?: bonusDraft.BonusDraft | null;
    /** This instance's stable key in ItemBonuses' cross-bonus condition-drag registry (its
     *  slot key, see bonusDraftRegistry.ts). Empty on the standalone "Bonuses" page,
     *  which isn't embedded in ItemBonuses and has no registry to register into. */
    registryId?: string;
    /** The item whose form embeds this bonus (ItemBonuses case). Its own "Granted by" entry
     *  is plain text since it is already on screen. */
    currentItemId?: string;
    /** Nested inside another form's card (ItemBonuses case): the header bar is an in-flow
     *  row with icon actions instead of a sticky strip, see DraftFormBar.vue. */
    embedded?: boolean;
    /** Whether the header bar shows its Delete action. Off when embedded in an item form,
     *  where Detach is the only way to remove the bonus. */
    canDelete?: boolean;
    /** Shows only the header bar. The draft and its undo history live in this instance
     *  either way, so collapsing a card never loses an edit in progress. */
    collapsed?: boolean;
    /** Whether the header bar's inert area raises `toggle`, see DraftFormBar.vue. */
    toggleable?: boolean;
    /** Where "Make global" writes. When set, a saved bonus's own inputs offer it, and the host
     *  writes the result as one layer edit (`make-global`). */
    makeGlobalScope?: bonusDraft.MakeGlobalScope | null;
  }>(),
  {
    source: null,
    duplicateFrom: null,
    status: "base",
    allBonusIds: () => [],
    tags: () => [],
    bonusOptions: () => [],
    allocatableIds: () => [],
    fixedId: null,
    initialDraft: null,
    registryId: "",
    currentItemId: undefined,
    embedded: false,
    canDelete: true,
    collapsed: false,
    toggleable: false,
    makeGlobalScope: null,
  },
);

const emit = defineEmits<{
  /** Emitted on every change for existing bonuses (debounced). */
  "update:bonus": [payload: { id: string; bonus: Bonus; label: string }];
  /** Emitted on Save click for new bonuses. */
  save: [payload: { id: string; bonus: Bonus }];
  delete: [event: MouseEvent];
  duplicate: [];
  revert: [];
  /** The header bar of a `toggleable` form was clicked outside its controls. */
  toggle: [];
  /** A "Granted by" member link was clicked: open that item in the editor. */
  "open-item": [itemId: string];
  /** "Make global" was confirmed on input `name`: a new global input `id` defined as `def`,
   *  read by every bonus in `readers` under that name. The first reader is this bonus, as drafted. */
  "make-global": [payload: MakeGlobalRequest];
}>();

function computeId(local: bonusDraft.BonusDraft): string {
  return local.name.trim()
    ? catalog.nextId(
        local.name.trim(),
        props.allocatableIds.length ? props.allocatableIds : props.allBonusIds,
        "bonus",
      )
    : "";
}

function toBonus(local: bonusDraft.BonusDraft): Bonus {
  const id = props.source?.id ?? props.fixedId ?? computeId(local);
  return bonusDraft.toBonus({ ...local, id });
}

// Existing bonuses: live edits. New bonuses: draft until Save.
const isNew = computed(() => !props.source && !props.fixedId);

const { draft, error, dirty, displayId, scheduleSnapshot, scheduleEmit } =
  useEditorDraft<Bonus, bonusDraft.BonusDraft, Bonus>({
    source: () => props.source,
    isNew,
    buildDraft: (source) =>
      source
        ? bonusDraft.buildDraft(source)
        : bonusDraft.buildDraft(
            props.duplicateFrom ? { ...props.duplicateFrom, id: "" } : null,
            false,
          ),
    initialDraft: () =>
      props.initialDraft
        ? JSON.parse(JSON.stringify(props.initialDraft))
        : undefined,
    toEntity: toBonus,
    diffLabel: bonusDraft.diffLabel,
    hasContent: (d) => Boolean(d.name || d.grants.length),
    // Hold off saving while any grant's condition tree is half-drawn (a leaf with no value
    // yet, an empty group branch): `rowsToWhen` drops it silently, and the source round-trip
    // would then wipe the row from the form. The next mutation re-schedules this emit.
    canEmit: (d) =>
      Boolean(d.name.trim()) &&
      d.grants.every((grant) => bonusDraft.grantWhenIsComplete(grant)),
    emit: (bonus, label) =>
      emit("update:bonus", { id: bonus.id, bonus, label }),
    displayId: {
      sourceId: () => props.source?.id ?? props.fixedId ?? undefined,
      computeId,
    },
    draftNoun: "bonus",
  });

// --- Common ---------------------------------------------------------------------------

const members = computed<LinkListItem[]>(() => {
  if (!props.source) return [];
  return (props.db.bonusMembers.get(props.source.id) ?? []).map((id) => ({
    key: id,
    label: props.db.get(id)?.name ?? id,
    plain: id === props.currentItemId,
  }));
});

const stackingOptions = [
  { value: "", label: "once, however many sources" },
  { value: "perSource", label: "once per contributing slot" },
];

/** What every formula field of the form checks and previews against, read live off the
 *  draft so a just-declared input or named formula is usable before saving. */
const formulaContext = provideFormulaContext(() =>
  bonusDraft.formulaOwner(draft.value, displayId.value),
);
const formulaCycles = computed(() =>
  namedCycles(formulaContext.owner.value.formulas ?? {}),
);
const formulaInputClashes = computed(() =>
  inputFormulaClashes(formulaContext.owner.value),
);
const duplicateFormulaNames = computed(() =>
  bonusDraft.duplicateFormulaNames(draft.value.formulas),
);

/** The bonus's inputs as the `input` condition leaf offers them, read live off the draft so a
 *  just-declared input is pickable before saving. */
const inputOptions = computed(() =>
  bonusDraft.inputOptions(draft.value.inputs, props.db.globalInputs),
);
const duplicateInputNames = computed(() =>
  bonusDraft.duplicateInputNames(draft.value.inputs),
);

const canMakeGlobal = computed(() =>
  bonusDraft.canMakeGlobal(props.makeGlobalScope, props.source?.id),
);

/** The open "Make global" offer, or null. */
const makeGlobal = shallowRef<bonusDraft.MakeGlobalOffer | null>(null);

function offerMakeGlobal(index: number) {
  if (!props.source || !props.makeGlobalScope || !canMakeGlobal.value) return;
  makeGlobal.value = bonusDraft.makeGlobalOffer(
    draft.value.inputs[index],
    props.source.id,
    props.db.bonuses,
    props.makeGlobalScope,
  );
}

function confirmMakeGlobal(id: string, otherIds: string[]) {
  const offer = makeGlobal.value;
  // Written as drafted, so it passes the same checks as a save.
  const bonus = offer && checkedBonus();
  if (!offer || !bonus) return;
  const others = offer.others
    .filter((other) => otherIds.includes(other.bonus.id))
    .map((other) => other.bonus);
  emit("make-global", {
    id,
    name: offer.name,
    def: offer.def,
    readers: [bonus, ...others],
  });
}

defineExpose({ draft, dirty });

/** The draft as a bonus, or null with `error` saying why it cannot be written yet: no name,
 *  a half-drawn condition `toBonus` would drop, or a grant's invalid JSON. */
function checkedBonus(): Bonus | null {
  error.value = "";
  if (!draft.value.name.trim()) {
    error.value = "The bonus needs a name.";
    return null;
  }
  if (
    !draft.value.grants.every((grant) => bonusDraft.grantWhenIsComplete(grant))
  ) {
    error.value =
      "A grant has an unfinished condition; fill in its value or remove the condition before saving.";
    return null;
  }
  try {
    return toBonus(draft.value);
  } catch (err: unknown) {
    error.value = `A grant has invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
    return null;
  }
}

function save() {
  const bonus = checkedBonus();
  if (!bonus) return;
  emit("save", { id: bonus.id, bonus });
}

// The store drives all grant-list mutations - BonusRows calls store methods instead of
// emitting replaced arrays. It writes directly onto `draft.value.grants`.
const draftStore = new BonusDraftStore(
  () => draft.value.grants,
  isNew.value ? scheduleSnapshot : scheduleEmit,
);

// Registers this instance's store for cross-bonus condition dragging (see
// bonusDraftRegistry.ts). `registryId` is stable for this component's whole lifetime:
// ItemBonuses.vue keys its `v-for` by the same slot key, so a slot whose id changes (a
// pending bonus's first save) mounts a fresh BonusForm instance rather than reusing this
// one, and there's nothing on the standalone "Bonuses" page (no registry, no registryId).
const bonusDraftRegistry = inject(bonusDraftRegistryKey, null);
if (bonusDraftRegistry && props.registryId) {
  const registryId = props.registryId;
  onMounted(() => bonusDraftRegistry.set(registryId, draftStore));
  onUnmounted(() => {
    if (bonusDraftRegistry.get(registryId) === draftStore)
      bonusDraftRegistry.delete(registryId);
  });
}
</script>

<template>
  <div>
    <DraftFormBar
      noun="bonus"
      :title="draft.name || draft.id || 'New bonus'"
      :status="status"
      :dirty="dirty"
      :is-new="isNew"
      :has-source="Boolean(source)"
      can-duplicate
      :can-delete="canDelete"
      :embedded="embedded"
      :toggleable="toggleable"
      :error="error"
      duplicate-testid="duplicate-bonus"
      @save="save"
      @toggle="$emit('toggle')"
      @revert="$emit('revert')"
      @duplicate="$emit('duplicate')"
      @delete="emit('delete', $event)"
    >
      <!-- ItemBonuses fills these: chevron, occurrence chip, Detach. -->
      <template #leading>
        <slot name="leading" />
      </template>
      <template #after-title>
        <slot name="after-title" />
      </template>
      <template #extra-actions>
        <slot name="extra-actions" />
      </template>
    </DraftFormBar>

    <div v-if="!collapsed" class="animate-fade-in">
      <!-- The embedding item's per-attachment settings, ahead of the bonus's own definition. -->
      <slot />
      <FormSection :nested="embedded">Identification</FormSection>
      <FormGrid class="mb-2">
        <FormField label="Name" class="min-w-60 flex-1">
          <OcrTextField
            v-model="draft.name"
            type="input"
            single-line
            :rows="1"
            class="w-full"
            data-testid="bonus-name-input"
          />
        </FormField>
        <IdField
          :id="displayId"
          label="Id"
          :existing="Boolean(source || fixedId)"
        />
      </FormGrid>

      <p class="text-muted">
        <template v-if="members.length">
          Granted by <strong>{{ members.length }}</strong> item(s) -
          <LinkList
            :items="members"
            link-testid="bonus-member-link"
            @select="$emit('open-item', $event)"
          />.
        </template>
        <template v-else> Not granted by any item. </template>
      </p>

      <FormSection :nested="embedded">Inputs</FormSection>
      <FormSectionDescription
        >Values the player sets on the build, on the first item carrying this
        bonus. A global input is shared with every other bonus reading it. Can
        be used in formulas and in "input" conditions.</FormSectionDescription
      >
      <BonusInputRowList
        :rows="draft.inputs"
        :globals="db.globalInputs"
        :can-make-global="canMakeGlobal"
        @add="draft.inputs.push(bonusDraft.newInput())"
        @remove="(i) => draft.inputs.splice(i, 1)"
        @make-global="offerMakeGlobal"
      />
      <MakeGlobalDialog
        v-if="makeGlobal && makeGlobalScope"
        :name="makeGlobal.name"
        :def="makeGlobal.def"
        :others="makeGlobal.others"
        :taken="makeGlobalScope.taken"
        @confirm="confirmMakeGlobal"
        @close="makeGlobal = null"
      />
      <p
        v-if="duplicateInputNames.length"
        class="mb-2 text-danger"
        data-testid="bonus-input-duplicate"
      >
        Input ids must be unique: {{ duplicateInputNames.join(", ") }}. Only the
        last of each is saved.
      </p>

      <FormSection :nested="embedded">Formulas</FormSection>
      <FormSectionDescription
        >Named formulas. Can be referenced in other formulas as
        <code>$name</code>.</FormSectionDescription
      >
      <NamedFormulaRowList
        :rows="draft.formulas"
        :cycles="formulaCycles"
        :clashes="formulaInputClashes"
        @add="draft.formulas.push(bonusDraft.newNamedFormula())"
        @remove="(i) => draft.formulas.splice(i, 1)"
      />
      <p
        v-if="duplicateFormulaNames.length"
        class="mb-2 text-danger"
        data-testid="bonus-formula-duplicate"
      >
        Formula names must be unique: {{ duplicateFormulaNames.join(", ") }}.
        Only the last of each is saved.
      </p>

      <!-- Owns its own "Grants" heading, since the heading's fold controls act on its cards. -->
      <BonusRows
        :store="draftStore"
        :tags="tags"
        :bonus-options="bonusOptions"
        :input-options="inputOptions"
        :registry-id="registryId"
        :nested="embedded"
        @error="error = $event"
      />

      <FormSection :nested="embedded">Stacking</FormSection>
      <div
        class="mb-1 flex items-center gap-1.5 max-md:flex-col max-md:items-stretch md:flex-wrap"
      >
        <FormField label="Behavior">
          <ComboBox
            class="md:w-64"
            :model-value="draft.stacking"
            :options="stackingOptions"
            data-testid="bonus-stacking"
            @update:model-value="(v) => (draft.stacking = v)"
          />
        </FormField>
        <template v-if="draft.stacking === 'perSource'">
          <FormField label="Max stacks (0 = unlimited)">
            <BaseInput
              v-model.number="draft.maxStacks"
              type="number"
              min="0"
              class="md:w-16"
            />
          </FormField>
        </template>
      </div>

      <FormSection :nested="embedded">Suppressed bonuses</FormSection>
      <FormSectionDescription
        >If this bonus has at least one active grant, it will suppress the
        bonuses listed below.</FormSectionDescription
      >
      <TokenInput
        v-model="draft.excludes"
        data-testid="bonus-excludes-input"
        :options="bonusOptions"
        :allow-free="false"
        placeholder="Bonus to suppress…"
      >
        <template #option="{ option }">
          <BonusOptionRow :option="option" />
        </template>
      </TokenInput>
    </div>
  </div>
</template>
