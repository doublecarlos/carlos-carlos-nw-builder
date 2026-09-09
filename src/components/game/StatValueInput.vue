<script setup lang="ts">
// A stat's value field: `PercentInput` when the stat's kind is a percent/mult, a plain number
// `BaseInput` otherwise. The one place that owns that branch, so no call site repeats the
// `isPercent(...)` ternary.
import PercentInput from "../ui/PercentInput.vue";
import BaseInput from "../ui/BaseInput.vue";
import { isPercentKind, kindOf } from "../../lib/format";

withDefaults(
  defineProps<{
    statKey: string;
    /** Forwarded to the number branch only; meaningless on a percent field. */
    step?: string | number;
    min?: string | number;
    max?: string | number;
  }>(),
  { step: undefined, min: undefined, max: undefined },
);

const model = defineModel<number | string | null>({ default: "" });
</script>

<template>
  <PercentInput
    v-if="isPercentKind(kindOf(statKey))"
    :model-value="model ?? ''"
    @update:model-value="(v) => (model = v)"
  />
  <BaseInput
    v-else
    v-model="model"
    type="number"
    :step="step"
    :min="min"
    :max="max"
  />
</template>
