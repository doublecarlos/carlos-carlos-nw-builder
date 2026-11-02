<script setup lang="ts">
// Shared button look, replacing base.css's `.btn`/`.link`/`.btn--primary`/`.is-on`/`.is-danger`
// vocabulary. `title` is shown as a BaseTooltip; IconButton builds on this with `shape="icon"`
// and a required title. A file picker is a button that clicks a hidden file input, so it stays
// focusable and honors `disabled`.
//
// `inheritAttrs: false` plus an explicit `v-bind="$attrs"`: BaseTooltip wraps the button, so
// without this a caller's `class` would settle on that wrapper rather than the button itself.
import { computed, useTemplateRef } from "vue";
import BaseTooltip from "./BaseTooltip.vue";

defineOptions({ inheritAttrs: false });

type Variant = "default" | "primary" | "subtle" | "ghost";
type Tone = Exclude<Variant, "ghost"> | "active" | "danger";
type Shape = "label" | "icon";

// Centered, so content stays in the middle when a coarse pointer's tap-size minimum widens the
// button past it.
const CONTENT =
  "inline-flex items-center justify-center gap-1 cursor-pointer transition-colors";
const GHOST = `${CONTENT} [&_svg]:size-[14px] bg-transparent border-0 px-1 py-0.5 enabled:hover:text-accent`;
const BOX = `${CONTENT} rounded-md border disabled:cursor-default disabled:opacity-60`;

const SHAPES: Record<Shape, string> = {
  // Sized to sit level with the inputs beside it. The icon's box is a line of text tall, so an
  // icon-only button stands as tall as a labeled one.
  label: "[&_svg]:w-[14px] [&_svg]:h-lh px-2 py-0.5 text-[13px]",
  // The icon follows the surrounding font size; the padding leaves room for the border.
  icon: "[&_svg]:size-[1em] p-[3px]",
};

const ACCENT = "bg-accent-soft border-accent";

const TONES: Record<Tone, string> = {
  default: "bg-surface border-line enabled:hover:border-accent",
  subtle:
    "bg-transparent border-transparent text-muted enabled:hover:bg-surface-2 enabled:hover:text-text",
  primary: ACCENT,
  active: ACCENT,
  danger: "bg-danger-soft border-danger text-danger",
};

const props = withDefaults(
  defineProps<{
    // `subtle` drops the chrome until hover, for icon buttons and clusters of toolbar actions.
    variant?: Variant;
    shape?: Shape;
    /** Tooltip text. Empty means no tooltip. */
    title?: string;
    active?: boolean;
    danger?: boolean;
    disabled?: boolean;
  }>(),
  {
    variant: "default",
    shape: "label",
    title: "",
    active: false,
    danger: false,
    disabled: false,
  },
);

// `danger` and `active` are states, so they recolor whichever variant they sit on.
const tone = computed<Tone | null>(() => {
  if (props.variant === "ghost") return null;
  if (props.danger) return "danger";
  if (props.active) return "active";
  return props.variant;
});

const classes = computed(() =>
  tone.value === null
    ? [GHOST, props.disabled && "text-muted cursor-default"]
    : [
        BOX,
        SHAPES[props.shape],
        TONES[tone.value],
        props.variant === "primary" && "font-semibold",
      ],
);

const root = useTemplateRef("root");

defineExpose({ focus: () => root.value?.focus() });
</script>

<template>
  <BaseTooltip :text="title">
    <button
      ref="root"
      type="button"
      :disabled="disabled"
      v-bind="$attrs"
      :class="classes"
    >
      <slot />
    </button>
  </BaseTooltip>
</template>
