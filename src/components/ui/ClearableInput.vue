<script setup lang="ts">
// A text filter with a clear button anchored inside the field, shown once there's something to
// clear -- the stable reference's mount/bonus search. A wrapper around BaseInput rather than a
// BaseInput variant, since the clear affordance is layout (an absolutely positioned button
// stealing the field's own right padding), not a look BaseInput itself should carry.
import { X } from "@lucide/vue";
import BaseInput from "./BaseInput.vue";
import IconButton from "./IconButton.vue";

withDefaults(
  defineProps<{
    placeholder?: string;
    /** Leading part of the clear button's own `data-testid`, so it can be found relative to
     *  the field's -- `<testid>-clear`. */
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
