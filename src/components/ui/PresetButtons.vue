<script setup lang="ts">
// One-click values next to a number field. The button matching the current value is
// highlighted; `format` sets each button's text. On touch the buttons drop their sideways tap
// area, which would reach into a neighbor, and join into one segmented strip instead. A label
// stays on one line, and buttons that do not fit wrap onto the next.
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
  <div
    class="inline-flex flex-wrap gap-0.5 pointer-coarse:gap-x-0 pointer-coarse:gap-y-1"
  >
    <button
      v-for="preset in presets"
      :key="preset"
      type="button"
      class="tap-area relative whitespace-nowrap rounded-md border px-1.5 py-0.5 pointer-coarse:-ml-px pointer-coarse:min-w-0 pointer-coarse:after:inset-x-0 pointer-coarse:rounded-none pointer-coarse:px-2.5 pointer-coarse:first:ml-0 pointer-coarse:first:rounded-l-md pointer-coarse:last:rounded-r-md"
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
