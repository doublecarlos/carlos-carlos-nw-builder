<script setup lang="ts">
// An action link sitting inline in running text, aligned to the text baseline: the "apply"
// after a compare build's value, a validation finding's name. It is a button, not an anchor,
// since it triggers an action rather than navigating. Chromeless icon-bearing buttons are
// `BaseButton variant="ghost"`, not this.
withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: false });
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    class="m-0 inline-block cursor-pointer border-0 bg-transparent p-0 align-baseline text-accent underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-default disabled:text-muted disabled:no-underline"
  >
    <slot />
  </button>
</template>
