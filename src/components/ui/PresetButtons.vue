<script setup lang="ts">
// One-click values next to a number field. The button matching the current value is
// highlighted; `format` sets each button's text.
withDefaults(
  defineProps<{
    presets: number[];
    format?: (value: number) => string;
  }>(),
  { format: String },
);

const model = defineModel<number | null | undefined>();
</script>

<template>
  <div class="inline-flex gap-0.5">
    <button
      v-for="preset in presets"
      :key="preset"
      type="button"
      class="rounded-md border px-1.5 py-0.5"
      :class="
        model != null && Number(model) === preset
          ? 'border-accent bg-accent-soft text-text'
          : 'border-line bg-surface-2 text-muted'
      "
      @click="model = preset"
    >
      {{ format(preset) }}
    </button>
  </div>
</template>
