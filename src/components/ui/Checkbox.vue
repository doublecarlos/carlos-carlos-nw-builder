<script setup lang="ts">
// A checkbox + its label as one clickable unit. `inline` pushes it to the end of a flex row
// (App.vue's compare toggles, BonusInspector's near-miss filter). State is `v-model` only --
// `model-value`/`update:model-value`, spelled out where a caller needs to route the change
// through a named store action instead of a plain ref -- never a parallel `checked`/`change`
// prop pair, which drove the input's checked state out of sync with callers that don't also
// bind `v-model` (Vue's checkbox `v-model` is a directive that sets `el.checked` itself,
// stomping a plain `:checked` prop on every mount).
withDefaults(defineProps<{
  disabled?: boolean;
  inline?: boolean;
  value?: string;
}>(), {
  disabled: false,
  inline: false,
  value: '',
});

const model = defineModel({ required: true });
</script>

<template>
  <label class="flex cursor-pointer items-center gap-1 select-none" :class="inline && 'ml-auto text-muted'">
    <input type="checkbox" :value="value" v-model="model" :disabled="disabled">
    <span><slot /></span>
  </label>
</template>
