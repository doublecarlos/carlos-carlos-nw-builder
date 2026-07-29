<script setup lang="ts">
// A checkbox + its label as one clickable unit. `inline` pushes it to the end of a flex row

withDefaults(defineProps<{
  disabled?: boolean;
  inline?: boolean;
  checked?: boolean;
  value?: string;
}>(), {
  disabled: false,
  inline: false,
  value: ''
});

const model = defineModel();

const emit = defineEmits<{
  'change': [checked: boolean];
}>();

function handleChange(event: Event) {
  const target = event.target as HTMLInputElement;
  emit('change', target.checked);
}
</script>

<template>
  <label class="flex cursor-pointer items-center gap-1 select-none" :class="inline && 'ml-auto text-muted'">
    <input type="checkbox" :checked="checked" :value="value" v-model="model" :disabled="disabled" @change="handleChange">
    <span><slot /></span>
  </label>
</template>
