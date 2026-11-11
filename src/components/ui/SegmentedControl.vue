<script setup lang="ts" generic="T extends string">
// "Pick exactly one of a few options" as a row of joined buttons: bonus payload kind, problem
// severity, condition range/exact, the phone's Editor | Stats switch. Tone is per option rather
// than per control: problem severity's error/warning pair share one control but read in two
// different palettes when active.
//
// A label never wraps inside its segment. When the row does not fit, segments wrap onto more
// lines and each line's segments grow to fill it, so the control stays a rectangle. The group's
// background shows through the 1px gaps as the dividers, and its overflow clips the segments to
// the border's inner curve, so a segment draws its focus outline inside itself. The group never
// shrinks below its widest label.
import { useFormFieldLabelId } from "../../composables/useFormField";

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

const labelledBy = useFormFieldLabelId();

/** The active segment's fill and its tone border, drawn as an inset ring over the divider.
 *  Opaque, since the group's divider color sits behind every segment. */
const toneClasses: Record<"accent" | "danger" | "warn", string> = {
  accent: "bg-accent-soft text-text ring-accent",
  danger: "bg-danger-soft text-danger ring-danger",
  warn: "bg-warn-soft text-warn ring-warn",
};
</script>

<template>
  <div
    role="group"
    :aria-labelledby="labelledBy"
    class="flex min-w-0 max-w-full"
  >
    <div
      data-testid="segmented-group"
      class="flex min-w-min max-w-full flex-wrap gap-px overflow-hidden rounded-md border border-line bg-line"
      :class="fill && 'w-full'"
    >
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        :data-testid="option.testid"
        :aria-pressed="model === option.value"
        class="whitespace-nowrap px-2 py-0.5 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        :class="[
          fill ? 'flex-1' : 'flex-auto',
          model === option.value
            ? ['ring-1 ring-inset', toneClasses[option.tone ?? 'accent']]
            : 'bg-surface text-muted',
        ]"
        @click="model = option.value"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>
