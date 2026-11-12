<script setup lang="ts">
// A repeatable list of a bonus's input declarations (id / type / label / default, plus
// bounds, step, presets and control for a number), or a reference to a global input that
// defines all of those. The same row-mutating shape as `DynamicStatRowList`, the id leading
// the row so a phone gives it the card's first line. With `canMakeGlobal`, an input the bonus
// defines offers to become a global input.
import { computed } from "vue";
import BaseButton from "../ui/BaseButton.vue";
import ComboBox from "../ui/ComboBox.vue";
import RepeatableRows from "../ui/RepeatableRows.vue";
import BaseInput from "../ui/BaseInput.vue";
import NumberOrPercentInput from "../ui/NumberOrPercentInput.vue";
import FormField from "../ui/FormField.vue";
import IdField from "../ui/IdField.vue";
import BonusOptionRow from "./BonusOptionRow.vue";
import type { InputDraft } from "../../lib/bonus-draft";
import type { GlobalInputs } from "../../engine/global-inputs";

const props = defineProps<{
  rows: InputDraft[];
  globals: GlobalInputs;
  canMakeGlobal?: boolean;
}>();
const emit = defineEmits<{
  add: [];
  remove: [index: number];
  "make-global": [index: number];
}>();

/** Where an input's definition comes from: a global input, picked like a bonus by its label
 *  or id, or the bonus itself as the empty value. */
const globalOptions = computed(() =>
  [...props.globals.values()].map((slot) => ({
    value: slot.id,
    label: slot.label,
    search: slot.id,
  })),
);

/** What a reference reads, in place of the fields it does not save. The picker already names
 *  the global input, so this gives its type. */
function globalSummary(id: string): string {
  const slot = props.globals.get(id);
  if (!slot) return `"${id}" is not a global input`;
  const type =
    typeOptions.find((option) => option.value === slot.paramType)?.label ??
    slot.paramType;
  return `${type}, shared with every bonus reading it`;
}

const typeOptions = [
  { value: "boolean", label: "on/off" },
  { value: "number", label: "number" },
  { value: "percent", label: "percent" },
];

const onOffOptions = [
  { value: "false", label: "off" },
  { value: "true", label: "on" },
];

/** A number or percent input's numeric fields, typed in the units the input shows. */
const NUMBER_FIELDS = [
  { key: "default", label: "Default" },
  { key: "min", label: "Min" },
  { key: "max", label: "Max" },
  { key: "step", label: "Step" },
] as const;

const controlOptions = [
  { value: "", label: "stepper if bounded" },
  { value: "stepper", label: "stepper" },
  { value: "field", label: "field" },
];
</script>

<template>
  <RepeatableRows
    :rows="rows"
    row-class="bonus-input-row mb-1"
    labeled-fields
    header-actions
    add-label="Add input"
    remove-label="Remove input"
    add-testid="add-bonus-input"
    @add="emit('add')"
    @remove="(i) => emit('remove', i)"
  >
    <template #lead="{ row }">
      <IdField
        v-if="row.frozen"
        :id="row.name"
        label="Id"
        existing
        class="md:w-32"
        data-testid="bonus-input-id"
      />
      <FormField v-else label="Id">
        <BaseInput
          v-model="row.name"
          class="w-full md:w-32"
          type="text"
          data-testid="bonus-input-id"
        />
      </FormField>
    </template>
    <template #row="{ row, index }">
      <FormField
        v-if="globals.size || row.global"
        label="Defined by"
        class="max-md:w-full"
      >
        <ComboBox
          class="w-full md:w-56"
          :model-value="row.global"
          :options="globalOptions"
          show-empty-option
          :closed-display="
            !row.global
              ? 'this bonus'
              : globals.has(row.global)
                ? ''
                : row.global
          "
          menu-class="w-max min-w-(--anchor-width) max-w-[min(22rem,80vw)]"
          data-testid="bonus-input-global"
          @update:model-value="(v) => (row.global = v)"
        >
          <template #empty>this bonus</template>
          <template #option="{ option }">
            <BonusOptionRow :option="option" />
          </template>
        </ComboBox>
      </FormField>
      <BaseButton
        v-if="canMakeGlobal && !row.global && row.name.trim()"
        class="self-end"
        title="Share this input with other bonuses through a new global input"
        data-testid="bonus-input-make-global"
        @click="emit('make-global', index)"
        >Make global</BaseButton
      >
      <!-- Keeps a control's border and padding so it sits level with the picker. It wraps
           beside the picker until the row runs out of room. -->
      <FormField
        v-if="row.global"
        label="Reads"
        class="max-md:w-full md:min-w-40 md:flex-1"
      >
        <p
          class="border-y border-transparent py-0.5 text-muted"
          data-testid="bonus-input-global-summary"
        >
          {{ globalSummary(row.global) }}
        </p>
      </FormField>
      <template v-else>
        <!-- A phone card stacks the fields at full width, the numbers two to a line. -->
        <FormField label="Type" class="max-md:w-full">
          <ComboBox
            class="w-full md:w-28"
            :model-value="row.type"
            :options="typeOptions"
            data-testid="bonus-input-type"
            @update:model-value="(v) => (row.type = v as InputDraft['type'])"
          />
        </FormField>
        <FormField label="Label (optional)" class="max-md:w-full">
          <BaseInput
            v-model="row.label"
            class="w-full md:w-40"
            type="text"
            data-testid="bonus-input-label"
          />
        </FormField>
        <FormField
          v-if="row.type === 'boolean'"
          label="Default"
          class="max-md:w-full"
        >
          <ComboBox
            class="w-full md:w-20"
            :model-value="String(row.on)"
            :options="onOffOptions"
            data-testid="bonus-input-default"
            @update:model-value="(v) => (row.on = v === 'true')"
          />
        </FormField>
        <template v-else>
          <div class="grid w-full grid-cols-2 gap-1.5 md:flex md:w-auto">
            <FormField
              v-for="field in NUMBER_FIELDS"
              :key="field.key"
              :label="field.label"
            >
              <NumberOrPercentInput
                v-model="row[field.key]"
                :percent="row.type === 'percent'"
                class="w-full md:w-20"
                :data-testid="`bonus-input-${field.key}`"
              />
            </FormField>
          </div>
          <FormField
            label="Presets"
            class="max-md:w-full"
            :hint="
              row.type === 'percent'
                ? 'comma-separated, in %'
                : 'comma-separated'
            "
          >
            <BaseInput
              v-model="row.presets"
              class="w-full md:w-32"
              type="text"
              data-testid="bonus-input-presets"
            />
          </FormField>
          <FormField
            v-if="row.type === 'number'"
            label="Control"
            class="max-md:w-full"
          >
            <ComboBox
              class="w-full md:w-44"
              :model-value="row.control"
              :options="controlOptions"
              data-testid="bonus-input-control"
              @update:model-value="
                (v) => (row.control = v as InputDraft['control'])
              "
            />
          </FormField>
        </template>
      </template>
    </template>
    <template #empty>
      <span class="text-muted">No inputs.</span>
    </template>
  </RepeatableRows>
</template>
