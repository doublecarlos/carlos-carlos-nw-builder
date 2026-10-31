<script setup lang="ts">
// One-click values next to a number field. The button matching the current value is
// highlighted; `format` sets each button's text. On touch the buttons opt out of the full tap
// size and join into one segmented strip, which as a whole stays an easy target.
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
  <div class="inline-flex gap-0.5 pointer-coarse:gap-0">
    <button
      v-for="preset in presets"
      :key="preset"
      type="button"
      class="relative rounded-md border px-1.5 py-0.5 pointer-coarse:-ml-px pointer-coarse:min-h-8 pointer-coarse:min-w-0 pointer-coarse:rounded-none pointer-coarse:px-2.5 pointer-coarse:first:ml-0 pointer-coarse:first:rounded-l-md pointer-coarse:last:rounded-r-md"
      :class="
        model != null && Number(model) === preset
          ? 'z-base border-accent bg-accent-soft text-text'
          : 'border-line bg-surface-2 text-muted'
      "
      :aria-pressed="model != null && Number(model) === preset"
      @click="model = preset"
    >
      {{ format(preset) }}
    </button>
  </div>
</template>
