<script setup lang="ts" generic="T extends string">
// "Pick exactly one of a few options", the segmented-button look that used to be hand-copied at
// every call site (bonus payload kind, problem severity, condition range/exact). Tone is per
// option rather than per control: problem severity's error/warning pair share one control but
// read in two different palettes when active.
defineProps<{
  options: {
    value: T;
    label: string;
    tone?: "accent" | "danger" | "warn";
    testid?: string;
  }[];
}>();

const model = defineModel<T>({ required: true });

const toneClasses: Record<"accent" | "danger" | "warn", string> = {
  accent: "border-accent bg-accent-soft text-text",
  danger: "border-danger bg-danger-soft text-danger",
  warn: "border-warn bg-warn/25 text-warn",
};
</script>

<template>
  <div class="inline-flex">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :data-testid="option.testid"
      class="border border-line px-2 py-0.5 first:rounded-l-md last:rounded-r-md last:border-l-0"
      :class="
        model === option.value
          ? toneClasses[option.tone ?? 'accent']
          : 'bg-surface text-muted'
      "
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>
