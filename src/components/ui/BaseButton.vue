<script setup lang="ts">
// Shared button look, replacing base.css's `.btn`/`.link`/`.btn--primary`/`.is-on`/`.is-danger`
// vocabulary. `as="label"` covers the one spot (DataEditor's file-picker) that needs button
// chrome around a native `<label>` instead of a `<button>`.
import { computed } from "vue";
import BaseIcon from "./BaseIcon.vue";

const props = withDefaults(
  defineProps<{
    as?: "button" | "label";
    variant?: "default" | "primary" | "link";
    active?: boolean;
    danger?: boolean;
    disabled?: boolean;
    icon?: string;
  }>(),
  {
    as: "button",
    variant: "default",
    active: false,
    danger: false,
    disabled: false,
    icon: "",
  },
);

const classes = computed(() => {
  if (props.variant === "link") {
    return [
      "bg-transparent border-0 cursor-pointer px-1 py-0.5",
      props.disabled && "text-muted cursor-default",
    ];
  }

  let tone = "bg-surface-2 border-line enabled:hover:border-accent";
  if (props.danger) tone = "bg-danger-soft border-danger text-danger";
  else if (props.active || props.variant === "primary")
    tone = "bg-accent-soft border-accent";

  return [
    "inline-flex items-center gap-1 rounded-md border cursor-pointer px-2.5 py-1",
    "disabled:cursor-default disabled:opacity-45",
    tone,
    props.variant === "primary" && "font-semibold",
  ];
});
</script>

<template>
  <component
    :is="as"
    v-bind="as === 'button' ? { type: 'button', disabled } : {}"
    :class="classes"
  >
    <BaseIcon v-if="icon !== ''" :name="icon"></BaseIcon>
    <slot />
  </component>
</template>
