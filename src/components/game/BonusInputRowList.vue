<script setup lang="ts">
// A repeatable list of a bonus's input declarations (id / type / label / default, plus
// bounds, step, presets and control for a number), or a reference to a shared input that
// defines all of those. The same row-mutating shape as `DynamicStatRowList`, the id leading
// the row so a phone gives it the card's first line. With `canMakeShared`, the row's action
// group offers to turn the input into a shared input, disabled until the bonus defines it
// under a name.
import { computed } from "vue";
import ComboBox from "../ui/ComboBox.vue";
import RepeatableRows from "../ui/RepeatableRows.vue";
import BaseInput from "../ui/BaseInput.vue";
import NumberOrPercentInput from "../ui/NumberOrPercentInput.vue";
import FormField from "../ui/FormField.vue";
import IconButton from "../ui/IconButton.vue";
import IdField from "../ui/IdField.vue";
import OptionRow from "../ui/OptionRow.vue";
import { Link2 } from "@lucide/vue";
import type { InputDraft } from "../../lib/bonus-draft";
import type { SharedInputs } from "../../engine/shared-inputs";

const props = defineProps<{
  rows: InputDraft[];
  sharedInputs: SharedInputs;
  canMakeShared?: boolean;
}>();
const emit = defineEmits<{
  add: [];
  remove: [index: number];
  "make-shared": [index: number];
}>();

/** Where an input's definition comes from: a shared input, picked like a bonus by its label
 *  or id, or the bonus itself as the empty value. */
const sharedOptions = computed(() =>
  [...props.sharedInputs.values()].map((slot) => ({
    value: slot.id,
    label: slot.label,
    search: slot.id,
  })),
);

/** What a reference reads, in place of the fields it does not save. The picker already names
 *  the shared input, so this gives its type. */
function sharedSummary(id: string): string {
  const slot = props.sharedInputs.get(id);
  if (!slot) return `"${id}" is not a shared input`;
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

/** Whether this input can become a shared input: the bonus defines it under a name, and no
 *  higher layer overrides the bonus. The button stays in place and disabled otherwise, so
 *  naming a row never shifts the ones beside it. */
function shareable(row: InputDraft): boolean {
  return Boolean(props.canMakeShared && !row.shared && row.name.trim());
}
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
    <template #actions="{ row, index }">
      <IconButton
        :disabled="!shareable(row)"
        title="Share this input with other bonuses through a new shared input"
        data-testid="bonus-input-make-shared"
        @click="emit('make-shared', index)"
        ><Link2
      /></IconButton>
    </template>
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
    <template #row="{ row }">
      <FormField
        v-if="sharedInputs.size || row.shared"
        label="Defined by"
        class="max-md:w-full"
      >
        <ComboBox
          class="w-full md:w-56"
          :model-value="row.shared"
          :options="sharedOptions"
          show-empty-option
          show-value
          :closed-display="
            !row.shared
              ? 'this bonus'
              : sharedInputs.has(row.shared)
                ? ''
                : row.shared
          "
          menu-class="w-max min-w-(--anchor-width) max-w-[min(22rem,80vw)]"
          data-testid="bonus-input-shared"
          @update:model-value="(v) => (row.shared = v)"
        >
          <template #empty>this bonus</template>
          <template #option="{ option }">
            <OptionRow :option="option" />
          </template>
        </ComboBox>
      </FormField>
      <!-- Keeps a control's border and padding so it sits level with the picker. It wraps
           beside the picker until the row runs out of room. -->
      <FormField
        v-if="row.shared"
        label="Reads"
        class="max-md:w-full md:min-w-40 md:flex-1"
      >
        <p
          class="border-y border-transparent py-0.5 text-muted"
          data-testid="bonus-input-shared-summary"
        >
          {{ sharedSummary(row.shared) }}
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
