<script setup lang="ts">
// A number field, or a `PercentInput` when `percent` is set: for a form field that holds a plain
// number or a decimal-stored percent depending on what it describes. The model is the stored
// value either way. Attributes land on whichever field renders.
import BaseInput from "./BaseInput.vue";
import PercentInput from "./PercentInput.vue";

defineProps<{ percent?: boolean }>();

const model = defineModel<string | number | null>({ default: null });
</script>

<template>
  <PercentInput
    v-if="percent"
    :model-value="model ?? ''"
    @update:model-value="(value) => (model = value)"
  />
  <BaseInput v-else v-model="model" type="number" />
</template>
