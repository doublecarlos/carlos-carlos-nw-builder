<script setup lang="ts">
// Sticky action bar at the top of an editing form (ItemForm/BonusForm/PresetForm).
// The parent's scroll container carries no top padding, so this bar's own `p-3` sits
// flush against the container's top edge: a sticky element needing a negative margin to
// cancel a fractional-pixel top padding would round to a different device pixel than the
// padding itself and leave a hairline gap. The container's horizontal padding is still
// canceled the usual way, via the caller's `-mx-3`.
//
// `embedded`: a plain in-flow row inside another form's card, never a second sticky strip.
import { computed } from "vue";

const props = withDefaults(defineProps<{ embedded?: boolean }>(), {
  embedded: false,
});

const classes = computed(() =>
  props.embedded
    ? "py-1"
    : "sticky top-0 z-sticky border-b border-line bg-surface p-3",
);
</script>

<template>
  <div
    data-testid="form-bar"
    class="flex flex-wrap items-center gap-1.5"
    :class="classes"
  >
    <slot />
  </div>
</template>
