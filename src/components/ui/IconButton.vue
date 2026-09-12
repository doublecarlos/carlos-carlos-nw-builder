<script setup lang="ts">
// Slot-receiver icon button: the consumer supplies the icon (typically a lucide component)
// as the default slot. `title` is both the button's accessible name (it has no visible text)
// and the text of the tooltip showing it on hover or keyboard focus; `label` splits the two
// when the tooltip carries detail that would leave the name unstable (a step, a count). Icon
// svgs are auto-sized to match the old BaseIcon's 14px default.
//
// `inheritAttrs: false` plus an explicit `v-bind="$attrs"`: BaseTooltip wraps the button, so
// without this a caller's `class` would settle on that wrapper rather than the button itself.
import BaseTooltip from "./BaseTooltip.vue";

defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    title: string;
    /** The accessible name, when it should stay put while `title` changes. */
    label?: string;
    disabled?: boolean;
    /** Button chrome around a native `<label>` instead of a button: the one spot that needs
     *  it is LayerEditor's Import, a label wrapping a hidden file input. */
    as?: "button" | "label";
  }>(),
  {
    label: undefined,
    disabled: false,
    as: "button",
  },
);

defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <BaseTooltip :text="title">
    <component
      :is="as"
      v-bind="{
        ...(as === 'button' ? { type: 'button', disabled } : {}),
        ...$attrs,
      }"
      class="[&_svg]:size-[1em] cursor-pointer inline-flex items-center justify-center rounded p-1 text-muted enabled:hover:bg-surface-2 enabled:hover:text-accent disabled:cursor-default disabled:opacity-35"
      :aria-label="label ?? title"
      @click="$emit('click', $event)"
    >
      <slot />
    </component>
  </BaseTooltip>
</template>
