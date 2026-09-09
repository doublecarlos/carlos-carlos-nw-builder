<script setup lang="ts">
// A text filter with a clear button anchored inside the field, shown once there's something to
// clear. A wrapper around BaseInput rather than a variant of it: the clear affordance is layout
// (a positioned button taking the field's right padding), not a look BaseInput should carry.
import { X } from "@lucide/vue";
import BaseInput from "./BaseInput.vue";
import IconButton from "./IconButton.vue";

withDefaults(
  defineProps<{
    placeholder?: string;
    /** Leading part of the clear button's own `data-testid`: `<testid>-clear`. */
    testid?: string;
  }>(),
  { placeholder: "", testid: undefined },
);

const model = defineModel<string>({ default: "" });
</script>

<template>
  <div class="relative">
    <BaseInput
      v-model="model"
      type="text"
      class="w-full pr-7!"
      :placeholder="placeholder"
      :data-testid="testid"
    />
    <IconButton
      v-if="model"
      class="absolute right-1 top-1/2 -translate-y-1/2"
      title="Clear filter"
      :data-testid="testid && `${testid}-clear`"
      @click="model = ''"
    >
      <X />
    </IconButton>
  </div>
</template>
