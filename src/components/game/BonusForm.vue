<script setup lang="ts">
// Editing form for one bonus. Hybrid approach:
// - Existing bonuses (source != null): live edits, changes emit immediately
// - New bonuses (source == null): explicit Save button, draft until name is finalized
import { computed, inject, onMounted, onUnmounted } from "vue";
import BonusRows from "./BonusRows.vue";
import IconButton from "../ui/IconButton.vue";
import { CirclePlus } from "@lucide/vue";
import ComboBox from "../ui/ComboBox.vue";
import TokenInput from "../ui/TokenInput.vue";
import BaseInput from "../ui/BaseInput.vue";
import BaseLink from "../ui/BaseLink.vue";
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
import type { Bonus, BonusOption, Db } from "../../types";
import type { EntryStatus } from "../../data/catalog";

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
  },
);

const emit = defineEmits<{
  /** Emitted on every change for existing bonuses (debounced). */
  "update:bonus": [payload: { id: string; bonus: Bonus; label: string }];
  /** Emitted on Save click for new bonuses. */
  save: [payload: { id: string; bonus: Bonus }];
  delete: [];
  duplicate: [];
  revert: [];
  /** A "Granted by" member link was clicked: open that item in the editor. */
  "open-item": [itemId: string];
}>();

function buildDraft(bonus: Bonus | null | undefined): bonusDraft.BonusDraft {
  const source = bonus ?? ({} as Partial<Bonus>);
  return {
    id: source.id ?? "",
    name: source.name ?? "",
    grants: (source.grants ?? []).map((grant) => bonusDraft.toDraft(grant)),
    stacking: source.stacking ?? "",
    maxStacks: source.maxStacks ?? null,
    excludes: [...(source.excludes ?? [])],
  };
}

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
    // JSON parse error, shouldn't happen but be safe.
  }
  return "edit bonus";
}

// Existing bonuses: live edits. New bonuses: draft until Save.
const isNew = computed(() => !props.source && !props.fixedId);

const { draft, error, dirty, displayId, scheduleSnapshot, scheduleEmit } =
  useEditorDraft<Bonus, bonusDraft.BonusDraft, Bonus>({
    source: () => props.source,
    isNew,
    buildDraft: (source) =>
      buildDraft(
        source ??
          (props.duplicateFrom ? { ...props.duplicateFrom, id: "" } : null),
      ),
    initialDraft: () =>
      props.initialDraft
        ? JSON.parse(JSON.stringify(props.initialDraft))
        : undefined,
    toEntity: toBonus,
    diffLabel,
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
  });

// --- Common ---------------------------------------------------------------------------

const members = computed(() => {
  if (!props.source) return [];
  return (props.db.bonusMembers.get(props.source.id) ?? []).map((id) => ({
    id,
    name: props.db.get(id)?.name ?? id,
  }));
});

const stackingOptions = [
  { value: "", label: "once, however many sources" },
  { value: "perSource", label: "once per contributing slot" },
];

defineExpose({ draft, dirty });

function addGrant() {
  draft.value.grants.push(bonusDraft.toDraft({ when: {}, stats: {} }));
}

function save() {
  error.value = "";
  const name = draft.value.name.trim();
  if (!name) {
    error.value = "The bonus needs a name.";
    return;
  }
  if (
    !draft.value.grants.every((grant) => bonusDraft.grantWhenIsComplete(grant))
  ) {
    error.value =
      "A grant has an unfinished condition -- fill in its value or remove the condition before saving.";
    return;
  }
  let bonus: Bonus;
  try {
    bonus = toBonus(draft.value);
  } catch (err: unknown) {
    error.value = `A grant has invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
    return;
  }
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
      :error="error"
      duplicate-testid="duplicate-bonus"
      @save="save"
      @revert="$emit('revert')"
      @duplicate="$emit('duplicate')"
      @delete="$emit('delete')"
    >
      <!-- ItemBonuses.vue's per-item embedding injects its own "Detach" here -->
      <template #extra-actions>
        <slot name="extra-actions" />
      </template>
    </DraftFormBar>

    <FormGrid class="mb-2">
      <FormField label="Name">
        <BaseInput
          v-model="draft.name"
          class="w-full"
          type="text"
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
        <template v-for="(member, index) in members" :key="member.id"
          ><template v-if="index > 0">, </template
          ><span v-if="member.id === currentItemId">{{ member.name }}</span
          ><BaseLink
            v-else
            data-testid="bonus-member-link"
            @click="$emit('open-item', member.id)"
            >{{ member.name }}</BaseLink
          ></template
        >.
      </template>
      <template v-else>
        Not granted by any item yet -- attach this id from an item's Bonuses
        section.
      </template>
    </p>

    <FormSection sub>Stacking</FormSection>
    <div class="flex flex-wrap items-center gap-1.5 mb-1">
      <FormField label="Behavior">
        <ComboBox
          class="w-64"
          :model-value="draft.stacking"
          :options="stackingOptions"
          @update:model-value="(v) => (draft.stacking = v)"
        />
      </FormField>
      <template v-if="draft.stacking === 'perSource'">
        <FormField label="Max stacks (0 = unlimited)">
          <BaseInput
            v-model.number="draft.maxStacks"
            type="number"
            min="0"
            class="w-16"
          />
        </FormField>
      </template>
    </div>

    <FormSection sub>Suppresses these bonuses</FormSection>
    <TokenInput
      v-model="draft.excludes"
      data-testid="bonus-excludes-input"
      :options="bonusOptions"
      :allow-free="false"
      placeholder="bonus to suppress…"
    >
      <template #option="{ option }">
        <BonusOptionRow :option="option" />
      </template>
    </TokenInput>

    <FormSection>
      Grants
      <IconButton title="Add grant" @click="addGrant"
        ><CirclePlus
      /></IconButton>
      <span v-if="!draft.grants.length" class="text-muted">none yet</span>
    </FormSection>

    <BonusRows
      :store="draftStore"
      :tags="tags"
      :bonus-options="bonusOptions"
      :registry-id="registryId"
      @error="error = $event"
    />
  </div>
</template>
