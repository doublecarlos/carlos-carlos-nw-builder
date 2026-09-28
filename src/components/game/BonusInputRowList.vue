<script setup lang="ts">
// A repeatable list of a bonus's input declarations (id / type / label / default, plus
// bounds, step, presets and control for a number). The same row-mutating shape as
// `DynamicStatRowList`.
import ComboBox from "../ui/ComboBox.vue";
import RepeatableRows from "../ui/RepeatableRows.vue";
import BaseInput from "../ui/BaseInput.vue";
import FormField from "../ui/FormField.vue";
import IdField from "../ui/IdField.vue";
import type { InputDraft } from "../../lib/bonus-draft";

defineProps<{ rows: InputDraft[] }>();
const emit = defineEmits<{ add: []; remove: [index: number] }>();

const typeOptions = [
  { value: "boolean", label: "on/off" },
  { value: "number", label: "number" },
  { value: "percent", label: "percent" },
];

const onOffOptions = [
  { value: "false", label: "off" },
  { value: "true", label: "on" },
];

const controlOptions = [
  { value: "", label: "stepper if bounded" },
  { value: "stepper", label: "stepper" },
  { value: "field", label: "field" },
];
</script>

<template>
  <RepeatableRows
    :rows="rows"
    row-class="bonus-input-row flex flex-wrap items-start gap-1.5 mb-1"
    labeled-fields
    add-label="Add input"
    remove-label="Remove input"
    add-testid="add-bonus-input"
    @add="emit('add')"
    @remove="(i) => emit('remove', i)"
  >
    <template #row="{ row }">
      <IdField
        v-if="row.frozen"
        :id="row.name"
        label="Id"
        existing
        class="w-32"
        data-testid="bonus-input-id"
      />
      <FormField v-else label="Id">
        <BaseInput
          v-model="row.name"
          class="w-32"
          type="text"
          data-testid="bonus-input-id"
        />
      </FormField>
      <FormField label="Type">
        <ComboBox
          class="w-28"
          :model-value="row.type"
          :options="typeOptions"
          data-testid="bonus-input-type"
          @update:model-value="(v) => (row.type = v as InputDraft['type'])"
        />
      </FormField>
      <FormField label="Label (optional)">
        <BaseInput
          v-model="row.label"
          class="w-40"
          type="text"
          data-testid="bonus-input-label"
        />
      </FormField>
      <FormField v-if="row.type === 'boolean'" label="Default">
        <ComboBox
          class="w-20"
          :model-value="String(row.on)"
          :options="onOffOptions"
          data-testid="bonus-input-default"
          @update:model-value="(v) => (row.on = v === 'true')"
        />
      </FormField>
      <template v-else>
        <FormField
          label="Default"
          :hint="row.type === 'percent' ? 'decimal, 0.1 = 10%' : undefined"
        >
          <BaseInput
            v-model="row.default"
            class="w-20"
            type="number"
            data-testid="bonus-input-default"
          />
        </FormField>
        <FormField label="Min">
          <BaseInput
            v-model="row.min"
            class="w-20"
            type="number"
            data-testid="bonus-input-min"
          />
        </FormField>
        <FormField label="Max">
          <BaseInput
            v-model="row.max"
            class="w-20"
            type="number"
            data-testid="bonus-input-max"
          />
        </FormField>
        <FormField label="Step">
          <BaseInput
            v-model="row.step"
            class="w-20"
            type="number"
            data-testid="bonus-input-step"
          />
        </FormField>
        <FormField label="Presets" hint="comma-separated">
          <BaseInput
            v-model="row.presets"
            class="w-32"
            type="text"
            data-testid="bonus-input-presets"
          />
        </FormField>
        <FormField v-if="row.type === 'number'" label="Control">
          <ComboBox
            class="w-44"
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
    <template #empty>
      <span class="text-muted">No inputs.</span>
    </template>
  </RepeatableRows>
</template>
