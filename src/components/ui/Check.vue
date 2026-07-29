<script setup lang="ts">
// A checkbox + its label as one clickable unit. `inline` pushes it to the end of a flex row
// (App.vue's compare toggles, BonusInspector's near-miss filter).
withDefaults(defineProps<{
  modelValue: boolean;
  disabled?: boolean;
  inline?: boolean;
}>(), {
  disabled: false,
  inline: false,
});

defineEmits<{ 'update:modelValue': [value: boolean] }>();
</script>

<template>
  <label class="inline-flex cursor-pointer items-center gap-1" :class="inline && 'ml-auto text-muted'">
    <input type="checkbox" :checked="modelValue" :disabled="disabled"
           @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)">
    <span><slot /></span>
  </label>
</template>
