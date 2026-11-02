<script setup lang="ts">
// The settings of a set of bonuses, headed once per bonus: each dynamic stat and each input, by
// the input's type. Edits `bonusValues` drafts in place (lib/bonus-values-draft.ts). A setting
// left out keeps whatever the build holds. With `keepable`, every control shows that unset
// state on its own ("- keep -", a blank field) instead of the default it would read as.
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import BaseInput from "../ui/BaseInput.vue";
import ComboBox from "../ui/ComboBox.vue";
import FormField from "../ui/FormField.vue";
import FormGrid from "../ui/FormGrid.vue";
import FormSection from "../ui/FormSection.vue";
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
  keepable?: boolean;
}>();
const values = defineModel<Record<string, BonusValuesDraft>>("values", {
  required: true,
});

const KEEP = { value: "", label: "- keep -" };
const ON_OFF = [
  KEEP,
  { value: "true", label: "on" },
  { value: "false", label: "off" },
];

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

const stored = (bonusId: string, name: string) =>
  values.value[bonusId]?.input[name];

/** An input as set here, or its default while left alone. */
function input(bonusId: string, name: string, def: InputDef) {
  return stored(bonusId, name) ?? def.default;
}

/** A number input's field: blank while left alone when `keepable`. */
function field(bonusId: string, name: string, def: InputDef) {
  const value = props.keepable
    ? stored(bonusId, name)
    : input(bonusId, name, def);
  return value === undefined ? "" : Number(value);
}

/** An on/off picker's value: `KEEP` while left alone. */
function picked(bonusId: string, name: string) {
  const value = stored(bonusId, name);
  return value === undefined ? KEEP.value : String(value);
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

function onPick(bonusId: string, name: string, raw: string) {
  setInput(bonusId, name, raw === KEEP.value ? null : raw === "true");
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
  <template v-for="group in groups" :key="group.bonusId">
    <FormSection sub>{{ group.name }}</FormSection>
    <FormGrid class="mb-1" :data-testid="`${testidPrefix}-bonus-settings`">
      <FormField
        v-for="config in group.configs"
        :key="config.stat"
        :label="config.label ?? config.stat"
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
        :label="entry.def.label ?? entry.name"
      >
        <ComboBox
          v-if="keepable && entry.def.type === 'boolean'"
          class="w-40"
          :data-testid="testid('input', group.bonusId, entry.name)"
          :model-value="picked(group.bonusId, entry.name)"
          :options="ON_OFF"
          :phone-screen="true"
          :screen-label="entry.def.label ?? entry.name"
          @update:model-value="onPick(group.bonusId, entry.name, $event)"
        />
        <BaseCheckbox
          v-else-if="entry.def.type === 'boolean'"
          :data-testid="testid('input', group.bonusId, entry.name)"
          :model-value="Boolean(input(group.bonusId, entry.name, entry.def))"
          @update:model-value="
            setInput(group.bonusId, entry.name, $event as boolean)
          "
        />
        <NumberStepper
          v-else-if="!keepable && numberControl(entry.def) === 'stepper'"
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
          :model-value="field(group.bonusId, entry.name, entry.def)"
          @update:model-value="onPercent(group.bonusId, entry.name, $event)"
        />
        <BaseInput
          v-else
          type="number"
          class="w-24"
          :min="entry.def.min"
          :max="entry.def.max"
          :step="entry.def.step"
          :placeholder="keepable ? 'keep' : undefined"
          :data-testid="testid('input', group.bonusId, entry.name)"
          :model-value="field(group.bonusId, entry.name, entry.def)"
          @update:model-value="onField(group.bonusId, entry.name, $event)"
          @blur="onBlur(group.bonusId, entry.name, $event)"
        />
      </FormField>
    </FormGrid>
  </template>
</template>
