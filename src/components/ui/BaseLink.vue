<script setup lang="ts">
// An action link sitting inline in running text, aligned to the text baseline: the "apply"
// after a compare build's value, a validation finding's name. It is a button, not an anchor,
// since it triggers an action rather than navigating. `plain` writes the same content as
// text instead, for a name with nowhere to go (an excluder the build no longer resolves).
// Chromeless icon-bearing buttons are `BaseButton variant="ghost"`, not this.
withDefaults(defineProps<{ disabled?: boolean; plain?: boolean }>(), {
  disabled: false,
  plain: false,
});
</script>

<template>
  <span v-if="plain"><slot /></span>
  <button
    v-else
    type="button"
    :disabled="disabled"
    class="m-0 inline-block cursor-pointer border-0 bg-transparent p-0 text-left align-baseline text-accent underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-default disabled:text-muted disabled:no-underline"
  >
    <slot />
  </button>
</template>
