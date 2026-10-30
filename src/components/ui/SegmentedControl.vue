<script setup lang="ts" generic="T extends string">
// "Pick exactly one of a few options" as a row of joined buttons: bonus payload kind, problem
// severity, condition range/exact, the phone's Editor | Stats switch. Tone is per option rather
// than per control: problem severity's error/warning pair share one control but read in two
// different palettes when active.
withDefaults(
  defineProps<{
    options: {
      value: T;
      label: string;
      tone?: "accent" | "danger" | "warn";
      testid?: string;
    }[];
    /** Spread across the full width, the options sharing it equally. */
    fill?: boolean;
  }>(),
  { fill: false },
);

const model = defineModel<T>({ required: true });

const toneClasses: Record<"accent" | "danger" | "warn", string> = {
  accent: "border-accent bg-accent-soft text-text",
  danger: "border-danger bg-danger-soft text-danger",
  warn: "border-warn bg-warn/25 text-warn",
};
</script>

<template>
  <div :class="fill ? 'flex' : 'inline-flex'">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :data-testid="option.testid"
      :aria-pressed="model === option.value"
      class="border border-line px-2 py-0.5 first:rounded-l-md last:rounded-r-md last:border-l-0"
      :class="[
        model === option.value
          ? toneClasses[option.tone ?? 'accent']
          : 'bg-surface text-muted',
        fill && 'flex-1',
      ]"
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>
