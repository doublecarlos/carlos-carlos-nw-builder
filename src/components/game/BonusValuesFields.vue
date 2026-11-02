<script setup lang="ts">
// The settings of a set of bonuses, once per bonus: each dynamic stat and each input, by the
// input's type. Edits `bonusValues` drafts in place (lib/bonus-values-draft.ts). An input left
// out reads as its default, so emptying a typed one drops it rather than storing a blank.
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import BaseInput from "../ui/BaseInput.vue";
import FormField from "../ui/FormField.vue";
import FormGrid from "../ui/FormGrid.vue";
import NumberStepper from "../ui/NumberStepper.vue";
import PercentInput from "../ui/PercentInput.vue";
import StatValueInput from "./StatValueInput.vue";
import { numberControl } from "../../engine/inputs";
import type {
  BonusSettingGroup,
  BonusValuesDraft,
} from "../../lib/bonus-values-draft";
import type { InputDef, InputValue } from "../../types";

const props = defineProps<{
  groups: BonusSettingGroup[];
  /** Leads each control's test id, as `<prefix>-bonus-stat-<bonus>-<stat>`. */
  testidPrefix: string;
}>();
const values = defineModel<Record<string, BonusValuesDraft>>("values", {
  required: true,
});

const draftOf = (bonusId: string): BonusValuesDraft =>
  values.value[bonusId] ?? { stat: {}, input: {} };

function stat(bonusId: string, key: string) {
  return values.value[bonusId]?.stat[key] ?? "";
}

function setStat(bonusId: string, key: string, value: number | string | null) {
  const current = draftOf(bonusId);
  values.value[bonusId] = {
    ...current,
    stat: { ...current.stat, [key]: value },
  };
}

/** An input as set here, or its default while left alone. */
function input(bonusId: string, name: string, def: InputDef) {
  return values.value[bonusId]?.input[name] ?? def.default;
}

/** `null` leaves the input out, so it keeps whatever the build holds. */
function setInput(bonusId: string, name: string, value: InputValue | null) {
  const current = draftOf(bonusId);
  const { [name]: _dropped, ...rest } = current.input;
  values.value[bonusId] = {
    ...current,
    input: value === null ? rest : { ...rest, [name]: value },
  };
}

/** A typed number applies as it is typed. An emptied field writes nothing yet, since the
 *  default would refill it mid-edit; once left empty, the input drops out. */
function onField(bonusId: string, name: string, raw: string | number | null) {
  if (typeof raw === "number" && Number.isFinite(raw))
    setInput(bonusId, name, raw);
}

function onBlur(bonusId: string, name: string, event: FocusEvent) {
  if ((event.target as HTMLInputElement).value.trim() === "")
    setInput(bonusId, name, null);
}

/** PercentInput holds its own text while focused, so an emptied one can clear at once. */
function onPercent(bonusId: string, name: string, raw: string | number | null) {
  if (raw === "" || raw === null) setInput(bonusId, name, null);
  else onField(bonusId, name, raw);
}

const testid = (kind: string, bonusId: string, key: string) =>
  `${props.testidPrefix}-bonus-${kind}-${bonusId}-${key}`;
</script>

<template>
  <FormGrid
    v-for="group in groups"
    :key="group.bonusId"
    class="mb-1"
    :data-testid="`${testidPrefix}-bonus-settings`"
  >
    <FormField
      v-for="config in group.configs"
      :key="config.stat"
      :label="`${group.name}: ${config.label ?? config.stat}`"
    >
      <StatValueInput
        class="w-24"
        :stat-key="config.stat"
        :data-testid="testid('stat', group.bonusId, config.stat)"
        :model-value="stat(group.bonusId, config.stat)"
        @update:model-value="setStat(group.bonusId, config.stat, $event)"
      />
    </FormField>
    <FormField
      v-for="entry in group.inputs"
      :key="entry.name"
      :label="`${group.name}: ${entry.def.label ?? entry.name}`"
    >
      <BaseCheckbox
        v-if="entry.def.type === 'boolean'"
        :data-testid="testid('input', group.bonusId, entry.name)"
        :model-value="Boolean(input(group.bonusId, entry.name, entry.def))"
        @update:model-value="
          setInput(group.bonusId, entry.name, $event as boolean)
        "
      />
      <NumberStepper
        v-else-if="numberControl(entry.def) === 'stepper'"
        :min="entry.def.min ?? 0"
        :max="entry.def.max ?? 0"
        :step="entry.def.step"
        :data-testid="testid('input', group.bonusId, entry.name)"
        :model-value="Number(input(group.bonusId, entry.name, entry.def))"
        @update:model-value="setInput(group.bonusId, entry.name, $event)"
      />
      <PercentInput
        v-else-if="entry.def.type === 'percent'"
        class="w-24"
        :data-testid="testid('input', group.bonusId, entry.name)"
        :model-value="Number(input(group.bonusId, entry.name, entry.def))"
        @update:model-value="onPercent(group.bonusId, entry.name, $event)"
      />
      <BaseInput
        v-else
        type="number"
        class="w-24"
        :min="entry.def.min"
        :max="entry.def.max"
        :step="entry.def.step"
        :data-testid="testid('input', group.bonusId, entry.name)"
        :model-value="Number(input(group.bonusId, entry.name, entry.def))"
        @update:model-value="onField(group.bonusId, entry.name, $event)"
        @blur="onBlur(group.bonusId, entry.name, $event)"
      />
    </FormField>
  </FormGrid>
</template>
