<script setup lang="ts">
// The control that collapses a side rail or brings it back.
//
// It sits in the rail itself and stays put across both states, so the button a user pressed to
// hide something is where they look to get it back -- rather than appearing in one place when
// open and somewhere else when closed.
import { computed } from "vue";
import { ChevronLeft, ChevronRight } from "@lucide/vue";
import BaseTooltip from "./BaseTooltip.vue";

// `inheritAttrs: false` with an explicit `v-bind="$attrs"`: this component's root is a
// BaseTooltip, whose wrapper is `display: contents` and so has no box of its own. A caller's
// positioning classes have to reach the button, or they land on the wrapper and do nothing.
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  collapsed: boolean;
  /** Which edge the rail lives on -- a left rail closes leftward, a right one rightward. */
  side: "left" | "right";
  /** What the rail holds, as it reads in "Hide builds" / "Show builds". */
  label: string;
}>();

defineEmits<{ toggle: [] }>();

/** Always points the way pressing it will move the rail. */
const icon = computed(() => {
  const pointsLeft = props.side === "left" ? !props.collapsed : props.collapsed;
  return pointsLeft ? ChevronLeft : ChevronRight;
});

const action = computed(() =>
  props.collapsed ? `Show ${props.label}` : `Hide ${props.label}`,
);
</script>

<template>
  <BaseTooltip :text="action">
    <button
      v-bind="$attrs"
      type="button"
      class="cursor-pointer rounded p-0.5 text-muted hover:bg-surface-2 hover:text-accent [&_svg]:size-[14px]"
      :aria-label="action"
      :aria-expanded="!collapsed"
      :data-testid="`rail-toggle-${side}`"
      @click="$emit('toggle')"
    >
      <component :is="icon" />
    </button>
  </BaseTooltip>
</template>
